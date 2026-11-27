/**
 * Account sign-in through the OpenSocial identity canister.
 *
 * Every method (Internet Identity, passkey, email code) is verified by
 * the canister, which then signs a delegation for the same account principal.
 * The frontend keeps an Ed25519 session key and the delegation chain in the
 * encrypted device store until it expires or the user signs out.
 */
import { secureDelete, secureGet, secureSet } from '../../core/storage/secureStore';
import type {
  AccountProvider,
  AccountSession,
  EmailCodeParams,
  EmailCodeSent,
  EmailServiceStatus,
  SignInMethod,
} from '../../core/interfaces';
import { OpenSocialError } from '../../core/types';
import { identityIdl } from './identityIdl';
import { iiDerivationOrigin } from '../../config';
import { InternetIdentityProvider } from './internetIdentity';

type Agent = import('@icp-sdk/core/agent').HttpAgent;
type Identity = import('@icp-sdk/core/agent').Identity;


const STORAGE_KEY = 'account-session';
const SESSION_TTL_NS = BigInt(8 * 3600) * 1_000_000_000n;
const REFRESH_MARGIN_NS = BigInt(5 * 60) * 1_000_000_000n;

interface StoredSession {
  sessionKey: string;
  chain: string;
  principal: string;
  method: SignInMethod;
}

interface Prepared {
  user_key: Uint8Array | number[];
  expiration_ns: bigint;
  account_principal: { toText(): string };
  new_account: boolean;
}

type Res<T> = { Ok: T } | { Err: string };

const unwrap = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new OpenSocialError('IDENTITY_REJECTED', r.Err);
  return r.Ok;
};

const bytes = (v: Uint8Array | number[]) => (v instanceof Uint8Array ? v : Uint8Array.from(v));

export interface OpenSocialIdentityOptions {
  canisterId: string;
  /** Defaults to the boundary node of the current host (icp0.io) or icp-api.io. */
  host?: string;
  ii?: InternetIdentityProvider;
  /** Overridable for tests. */
  window?: Window & typeof globalThis;
}

export class OpenSocialIdentityProvider implements AccountProvider {
  private emailAvailable = false;
  private identity: Identity | null = null;

  get methods(): readonly SignInMethod[] {
    const base: SignInMethod[] = ['ii', 'passkey', 'passkey-new'];
    return this.emailAvailable ? [...base, 'email'] : base;
  }

  private async refreshEmailAvailability(): Promise<void> {
    try {
      const actor = await this.actor();
      const status = (await actor.email_sender_status()) as { configured: boolean };
      this.emailAvailable = status.configured;
    } catch {
      this.emailAvailable = false;
    }
  }
  private readonly ii: InternetIdentityProvider;
  private readonly win: Window & typeof globalThis;

  constructor(private readonly options: OpenSocialIdentityOptions) {
    this.win = options.window ?? window;
    this.ii =
      options.ii ?? new InternetIdentityProvider({ derivationOrigin: iiDerivationOrigin(this.win.location.origin) });
  }

  /** The delegated account identity, for calling other OpenSocial canisters. */
  currentIdentity(): Identity | null {
    return this.identity;
  }

  agentIdentity(): Identity | null {
    return this.identity;
  }

  get mailboxCanisterId(): string {
    return this.options.canisterId;
  }

  private async agent(identity?: Identity): Promise<Agent> {
    const { HttpAgent } = await import('@icp-sdk/core/agent');
    return HttpAgent.create({
      ...(identity ? { identity } : {}),
      ...(this.options.host ? { host: this.options.host } : {}),
      shouldFetchRootKey: false,
    });
  }

  private async actor(identity?: Identity) {
    const { Actor } = await import('@icp-sdk/core/agent');
    const agent = await this.agent(identity);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Actor.createActor<any>(identityIdl, { agent, canisterId: this.options.canisterId });
  }

  async restore(): Promise<AccountSession | null> {
    // Load the II SDK and the identity module now, so a later click can open the
    // II window synchronously (browsers and the SDK require that).
    await Promise.all([
      this.refreshEmailAvailability(),
      this.ii.preload().catch(() => undefined),
      import('@icp-sdk/core/identity'),
    ]);
    let stored: StoredSession | null;
    try {
      stored = await secureGet<StoredSession>(STORAGE_KEY);
    } catch {
      return null; // device store unavailable (e.g. blocked by another tab): sign in shows why
    }
    if (!stored) return null;
    try {
      const { DelegationChain, DelegationIdentity, Ed25519KeyIdentity, isDelegationValid } =
        await import('@icp-sdk/core/identity');
      const chain = DelegationChain.fromJSON(stored.chain);
      const soon = new Date(Date.now() + Number(REFRESH_MARGIN_NS / 1_000_000n));
      if (!isDelegationValid(chain, { scope: [] }) || chain.delegations.some((d) => Number(d.delegation.expiration / 1_000_000n) < soon.getTime())) {
        await secureDelete(STORAGE_KEY);
        return null;
      }
      const key = Ed25519KeyIdentity.fromJSON(stored.sessionKey);
      this.identity = DelegationIdentity.fromDelegation(key, chain);
      return { principal: stored.principal, provider: 'open-social-identity', method: stored.method };
    } catch {
      await secureDelete(STORAGE_KEY);
      return null;
    }
  }

  async sendEmailCode(email: string): Promise<EmailCodeSent> {
    const actor = await this.actor();
    const res = unwrap(await actor.email_challenge(email, this.win.location.origin)) as {
      challenge_id: string;
      sent_to: string;
    };
    return { challengeId: res.challenge_id, sentTo: res.sent_to };
  }

  async linkEmail(challengeId: string, code: string): Promise<void> {
    if (!this.identity) throw new OpenSocialError('NOT_SIGNED_IN', 'Sign in first.');
    unwrap(await (await this.actor(this.identity)).link_email(challengeId, code.trim()));
  }

  readonly emailAdmin = {
    isAdmin: async (): Promise<boolean> => {
      if (!this.identity) return false;
      return (await (await this.actor(this.identity)).am_i_admin()) as boolean;
    },
    status: async (): Promise<EmailServiceStatus> => {
      const s = (await (await this.actor()).email_sender_status()) as {
        configured: boolean;
        from: [] | [string];
        sent_today: number;
        daily_limit: number;
      };
      return {
        configured: s.configured,
        from: s.from[0] ?? null,
        sentToday: s.sent_today,
        dailyLimit: s.daily_limit,
      };
    },
    configure: async (config: { apiKey: string; from: string; dailyLimit?: number } | null) => {
      if (!this.identity) throw new OpenSocialError('NOT_SIGNED_IN', 'Sign in first.');
      const actor = await this.actor(this.identity);
      const arg = config
        ? [{ api_key: config.apiKey, from: config.from, daily_limit: config.dailyLimit ? [config.dailyLimit] : [] }]
        : [];
      unwrap(await actor.set_email_sender(arg));
      await this.refreshEmailAvailability();
    },
  };

  private emailParams: EmailCodeParams | undefined;

  signIn(method: SignInMethod = 'ii', params?: EmailCodeParams): Promise<AccountSession> {
    // Open the II window first, synchronously, while still inside the click.
    const iiIdentity = method === 'ii' ? this.ii.startSignIn() : null;
    return this.signInAfterGesture(method, params, iiIdentity);
  }

  private iiPending: Promise<Identity> | null = null;

  private async signInAfterGesture(
    method: SignInMethod,
    params: EmailCodeParams | undefined,
    iiIdentity: Promise<Identity> | null,
  ): Promise<AccountSession> {
    this.emailParams = params;
    this.iiPending = iiIdentity;
    const { Ed25519KeyIdentity } = await import('@icp-sdk/core/identity');
    const sessionKey = Ed25519KeyIdentity.generate();
    const session = {
      session_key: new Uint8Array(sessionKey.getPublicKey().toDer()),
      max_time_to_live_ns: [SESSION_TTL_NS],
    };
    let prepared: Prepared;
    try {
      prepared = await this.prepare(method, session);
    } catch (e) {
      if (e instanceof OpenSocialError) throw e;
      throw new OpenSocialError('AUTH_SIGN_IN_FAILED', e instanceof Error ? e.message : String(e));
    }
    return this.finish(method, sessionKey, prepared);
  }

  private async prepare(
    method: SignInMethod,
    session: { session_key: Uint8Array; max_time_to_live_ns: bigint[] },
  ): Promise<Prepared> {
    const origin = this.win.location.origin;
    switch (method) {
      case 'ii': {
        const iiIdentity = await (this.iiPending ?? this.ii.signInIdentity());
        const actor = await this.actor(iiIdentity);
        return unwrap(await actor.sign_in_with_ii(session));
      }
      case 'passkey':
      case 'passkey-new':
        return this.passkey(method === 'passkey-new', session, origin);
      case 'email': {
        const p = this.emailParams;
        if (!p) throw new OpenSocialError('EMAIL_CODE_MISSING', 'Enter the code from the email.');
        const actor = await this.actor();
        return unwrap(await actor.email_sign_in(p.challengeId, p.code, session));
      }
    }
  }

  private async passkey(
    create: boolean,
    session: { session_key: Uint8Array; max_time_to_live_ns: bigint[] },
    origin: string,
  ): Promise<Prepared> {
    const nav = this.win.navigator;
    if (!nav.credentials || !this.win.PublicKeyCredential) {
      throw new OpenSocialError('PASSKEY_UNSUPPORTED', 'This browser does not support passkeys.');
    }
    const actor = await this.actor();
    const ch = unwrap(await actor.passkey_challenge(origin)) as {
      challenge_id: string;
      challenge: Uint8Array | number[];
      rp_id: string;
    };
    const challenge = bytes(ch.challenge);
    if (create) {
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const cred = (await nav.credentials.create({
        publicKey: {
          challenge,
          rp: { id: ch.rp_id, name: 'OpenSocial' },
          user: { id: userId, name: 'OpenSocial account', displayName: 'OpenSocial account' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          attestation: 'none',
          timeout: 120_000,
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new OpenSocialError('PASSKEY_CANCELLED', 'Passkey creation was cancelled.');
      const res = cred.response as AuthenticatorAttestationResponse;
      return unwrap(
        await actor.passkey_register(
          {
            challenge_id: ch.challenge_id,
            origin,
            credential_id: new Uint8Array(cred.rawId),
            attestation_object: new Uint8Array(res.attestationObject),
            client_data_json: new Uint8Array(res.clientDataJSON),
          },
          session,
        ),
      );
    }
    const cred = (await nav.credentials.get({
      publicKey: { challenge, rpId: ch.rp_id, userVerification: 'required', timeout: 120_000 },
    })) as PublicKeyCredential | null;
    if (!cred) throw new OpenSocialError('PASSKEY_CANCELLED', 'Passkey sign-in was cancelled.');
    const res = cred.response as AuthenticatorAssertionResponse;
    return unwrap(
      await actor.passkey_sign_in(
        {
          challenge_id: ch.challenge_id,
          origin,
          credential_id: new Uint8Array(cred.rawId),
          authenticator_data: new Uint8Array(res.authenticatorData),
          client_data_json: new Uint8Array(res.clientDataJSON),
          signature: new Uint8Array(res.signature),
        },
        session,
      ),
    );
  }

  private async finish(
    method: SignInMethod,
    sessionKey: import('@icp-sdk/core/identity').Ed25519KeyIdentity,
    prepared: Prepared,
  ): Promise<AccountSession> {
    const { Delegation, DelegationChain, DelegationIdentity } = await import('@icp-sdk/core/identity');
    const actor = await this.actor();
    // get_delegation is a query: the replica answering it can lag the update
    // that prepared the signature by a moment, so retry briefly.
    let result: Res<unknown> = { Err: 'not tried' };
    for (let attempt = 0; attempt < 8; attempt++) {
      result = (await actor.get_delegation(
        prepared.account_principal,
        new Uint8Array(sessionKey.getPublicKey().toDer()),
        prepared.expiration_ns,
      )) as Res<unknown>;
      if ('Ok' in result) break;
      await new Promise((r) => setTimeout(r, 750));
    }
    const signed = unwrap(result) as { pubkey: Uint8Array | number[]; expiration_ns: bigint; signature: Uint8Array | number[] };
    const chain = DelegationChain.fromDelegations(
      [
        {
          delegation: new Delegation(bytes(signed.pubkey), signed.expiration_ns),
          signature: bytes(signed.signature) as never,
        },
      ],
      bytes(prepared.user_key) as never,
    );
    this.identity = DelegationIdentity.fromDelegation(sessionKey, chain);
    const principal = this.identity.getPrincipal().toText();
    if (principal !== prepared.account_principal.toText()) {
      throw new OpenSocialError('IDENTITY_MISMATCH', 'Delegation does not match the account.');
    }
    const stored: StoredSession = {
      sessionKey: JSON.stringify(sessionKey.toJSON()),
      chain: JSON.stringify(chain.toJSON()),
      principal,
      method,
    };
    await secureSet(STORAGE_KEY, stored);
    return { principal, provider: 'open-social-identity', method };
  }

  async signOut(): Promise<void> {
    this.identity = null;
    await secureDelete(STORAGE_KEY);
    try {
      await this.ii.signOut();
    } catch {
      // II may not have been used for this session.
    }
  }
}

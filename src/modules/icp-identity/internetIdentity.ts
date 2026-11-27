/**
 * Live Internet Identity sign-in using @icp-sdk/auth.
 *
 * - Sign-in opens the identity provider (id.ai) in a new browser tab and returns a
 *   delegation for this origin. The SDK stores it in IndexedDB.
 * - The principal is specific to the app origin, so another origin would get
 *   different principals unless a derivation origin is configured (see
 *   docs/AUTH_INTERNET_IDENTITY.md).
 * - The SDK is loaded lazily so the rest of the app (and tests) never touch it
 *   until sign-in state is needed.
 */
import type { AccountProvider, AccountSession } from '../../core/interfaces';
import { OpenSocialError } from '../../core/types';

type AuthClientType = import('@icp-sdk/auth/client').AuthClient;
type Identity = Awaited<ReturnType<AuthClientType['getIdentity']>>;


export interface InternetIdentityOptions {
  /** Override for local development (local II canister). Mainnet when omitted. */
  identityProvider?: { authorizeUrl: string; canisterId: string };
  /** Shared origin for principals across deployments. */
  derivationOrigin?: string;
  /** Session length in nanoseconds. Default 8 hours. */
  maxTimeToLive?: bigint;
}

const EIGHT_HOURS_NS = BigInt(8 * 60 * 60) * BigInt(1_000_000_000);

export class InternetIdentityProvider implements AccountProvider {
  readonly methods = ['ii'] as const;
  private client: Promise<AuthClientType> | null = null;
  /** Set once the SDK is loaded, so sign-in can start synchronously inside a click. */
  private loaded: AuthClientType | null = null;

  constructor(private readonly options: InternetIdentityOptions = {}) {}

  /** Loads the SDK ahead of time. Call on page load. */
  async preload(): Promise<void> {
    await this.getClient();
  }

  /**
   * Starts the II ceremony synchronously. Must be called directly inside a click
   * handler, with no await before it: the SDK refuses to open the II window
   * otherwise. Requires preload() to have finished.
   */
  startSignIn(): Promise<Identity> {
    if (!this.loaded) {
      return Promise.reject(
        new OpenSocialError('AUTH_NOT_READY', 'Sign-in is still loading. Try again in a moment.'),
      );
    }
    return this.loaded
      .signIn({ maxTimeToLive: this.options.maxTimeToLive ?? EIGHT_HOURS_NS })
      .catch((e: unknown) => {
        throw new OpenSocialError(
          'AUTH_SIGN_IN_FAILED',
          `Internet Identity sign-in did not complete: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
  }

  private getClient(): Promise<AuthClientType> {
    if (!this.client) {
      this.client = import('@icp-sdk/auth/client').then(
        ({ AuthClient }) =>
          new AuthClient({
            ...(this.options.identityProvider
              ? { identityProvider: this.options.identityProvider }
              : {}),
            ...(this.options.derivationOrigin
              ? { derivationOrigin: this.options.derivationOrigin }
              : {}),
          }),
      ).then((c) => {
        this.loaded = c;
        return c;
      });
    }
    return this.client;
  }

  async restore(): Promise<AccountSession | null> {
    const client = await this.getClient();
    if (!client.isAuthenticated()) return null;
    const identity = await client.getIdentity();
    return { principal: identity.getPrincipal().toText(), provider: 'internet-identity' };
  }

  /** Runs the II ceremony and returns the II identity (used by the OpenSocial identity canister). */
  async signInIdentity(): Promise<Identity> {
    const client = await this.getClient();
    try {
      return await client.signIn({ maxTimeToLive: this.options.maxTimeToLive ?? EIGHT_HOURS_NS });
    } catch (e) {
      throw new OpenSocialError(
        'AUTH_SIGN_IN_FAILED',
        `Internet Identity sign-in did not complete: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async signIn(): Promise<AccountSession> {
    const client = await this.getClient();
    try {
      const identity = await client.signIn({
        maxTimeToLive: this.options.maxTimeToLive ?? EIGHT_HOURS_NS,
      });
      return { principal: identity.getPrincipal().toText(), provider: 'internet-identity' };
    } catch (e) {
      throw new OpenSocialError(
        'AUTH_SIGN_IN_FAILED',
        `Internet Identity sign-in did not complete: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async signOut(): Promise<void> {
    const client = await this.getClient();
    await client.signOut();
  }
}

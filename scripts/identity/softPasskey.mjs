/**
 * Software passkey for live tests: a P-256 WebAuthn authenticator in Node that
 * registers with and signs in to the OpenSocial identity canister exactly like
 * a browser passkey (attestation format "none"), then returns the account's
 * delegated identity.
 */
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Delegation, DelegationChain, DelegationIdentity, Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { identityIdl } from './identityIdl.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest();
const b64url = (b) => Buffer.from(b).toString('base64url');

/* Minimal CBOR encoder: unsigned/negative integers, byte strings, text strings, maps. */
function cborHead(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  throw new Error('CBOR length too large');
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([cborHead(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([cborHead(2, v.length), Buffer.from(v)]);
  if (v instanceof Map) {
    const parts = [cborHead(5, v.size)];
    for (const [k, val] of v) parts.push(cbor(k), cbor(val));
    return Buffer.concat(parts);
  }
  throw new Error('Unsupported CBOR value');
}

const unwrap = (r) => {
  if ('Err' in r) throw new Error(r.Err);
  return r.Ok;
};

export class SoftPasskey {
  constructor({ canisterId, origin, host = 'https://icp-api.io' }) {
    this.canisterId = canisterId;
    this.origin = origin;
    this.host = host;
    this.rpId = new URL(origin).host;
    this.credentialId = randomBytes(16);
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    this.jwk = publicKey.export({ format: 'jwk' });
  }

  async actor() {
    this.anon ??= Actor.createActor(identityIdl, {
      agent: await HttpAgent.create({ host: this.host }),
      canisterId: this.canisterId,
    });
    return this.anon;
  }

  clientData(type, challenge) {
    return Buffer.from(JSON.stringify({ type, challenge: b64url(challenge), origin: this.origin }));
  }

  /** authenticatorData with user presence and user verification set. */
  authData(attested) {
    const flags = 0x05 | (attested ? 0x40 : 0);
    const head = Buffer.concat([sha256(this.rpId), Buffer.from([flags]), Buffer.from([0, 0, 0, 0])]);
    return attested ? Buffer.concat([head, attested]) : head;
  }

  attestedCredential() {
    const cose = new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(this.jwk.x, 'base64url')],
      [-3, Buffer.from(this.jwk.y, 'base64url')],
    ]);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([Buffer.alloc(16), len, this.credentialId, cbor(cose)]);
  }

  /** Creates a new account with this passkey. */
  async register(sessionTtlSeconds = 1800) {
    const actor = await this.actor();
    const ch = unwrap(await actor.passkey_challenge(this.origin));
    const attestation = new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', this.authData(this.attestedCredential())],
    ]);
    return this.finish(sessionTtlSeconds, (session) =>
      actor.passkey_register(
        {
          challenge_id: ch.challenge_id,
          origin: this.origin,
          credential_id: this.credentialId,
          attestation_object: cbor(attestation),
          client_data_json: this.clientData('webauthn.create', Uint8Array.from(ch.challenge)),
        },
        session,
      ),
    );
  }

  /** Signs in to the account this passkey belongs to. */
  async signIn(sessionTtlSeconds = 1800, { tamper = false } = {}) {
    const actor = await this.actor();
    const ch = unwrap(await actor.passkey_challenge(this.origin));
    const authData = this.authData(null);
    const clientData = this.clientData('webauthn.get', Uint8Array.from(ch.challenge));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), this.privateKey);
    if (tamper) signature[signature.length - 1] ^= 1;
    return this.finish(sessionTtlSeconds, (session) =>
      actor.passkey_sign_in(
        {
          challenge_id: ch.challenge_id,
          origin: this.origin,
          credential_id: this.credentialId,
          authenticator_data: authData,
          client_data_json: clientData,
          signature,
        },
        session,
      ),
    );
  }

  async finish(ttlSeconds, call) {
    const sessionKey = Ed25519KeyIdentity.generate();
    const session = {
      session_key: new Uint8Array(sessionKey.getPublicKey().toDer()),
      max_time_to_live_ns: [BigInt(ttlSeconds) * 1_000_000_000n],
    };
    const prepared = unwrap(await call(session));
    const actor = await this.actor();
    // Query replicas can lag the update by a moment: retry like the app does.
    let r = { Err: '' };
    for (let i = 0; i < 8; i++) {
      r = await actor.get_delegation(prepared.account_principal, session.session_key, prepared.expiration_ns);
      if ('Ok' in r) break;
      await new Promise((res) => setTimeout(res, 750));
    }
    const signed = unwrap(r);
    const chain = DelegationChain.fromDelegations(
      [
        {
          delegation: new Delegation(Uint8Array.from(signed.pubkey), signed.expiration_ns),
          signature: Uint8Array.from(signed.signature),
        },
      ],
      Uint8Array.from(prepared.user_key),
    );
    return { prepared, identity: DelegationIdentity.fromDelegation(sessionKey, chain) };
  }
}

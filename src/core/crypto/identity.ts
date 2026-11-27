/**
 * Local identity keys.
 *
 * Uses only standard Web Crypto primitives:
 *   - ECDH P-256 for key agreement
 *   - ECDSA P-256 / SHA-256 for signatures
 * No custom cryptography. Private keys are created non-extractable.
 */
import { concatBytes, sha256, toHex } from './bytes';

export interface PublicIdentity {
  /** Raw uncompressed P-256 ECDH public key (65 bytes). */
  readonly encryptionKey: Uint8Array;
  /** Raw uncompressed P-256 ECDSA public key (65 bytes). */
  readonly signingKey: Uint8Array;
  /** Hex SHA-256 over both public keys. Stable contact identifier. */
  readonly id: string;
}

export interface LocalIdentity {
  readonly publicIdentity: PublicIdentity;
  readonly encryptionPrivateKey: CryptoKey;
  readonly signingPrivateKey: CryptoKey;
}

export const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
export const ECDSA_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

export async function computeIdentityId(
  encryptionKey: Uint8Array,
  signingKey: Uint8Array,
): Promise<string> {
  return toHex(await sha256(concatBytes(encryptionKey, signingKey)));
}

export async function createIdentity(): Promise<LocalIdentity> {
  const enc = await crypto.subtle.generateKey(ECDH_PARAMS, false, ['deriveBits']);
  const sig = await crypto.subtle.generateKey(ECDSA_PARAMS, false, ['sign', 'verify']);
  const encryptionKey = new Uint8Array(await crypto.subtle.exportKey('raw', enc.publicKey));
  const signingKey = new Uint8Array(await crypto.subtle.exportKey('raw', sig.publicKey));
  return {
    publicIdentity: {
      encryptionKey,
      signingKey,
      id: await computeIdentityId(encryptionKey, signingKey),
    },
    encryptionPrivateKey: enc.privateKey,
    signingPrivateKey: sig.privateKey,
  };
}

/** Human-comparable safety number: first 120 bits in 6 groups of 5 hex chars. */
export function fingerprint(identity: PublicIdentity): string {
  const hex = identity.id.slice(0, 30);
  return (hex.match(/.{5}/g) ?? []).join(' ');
}

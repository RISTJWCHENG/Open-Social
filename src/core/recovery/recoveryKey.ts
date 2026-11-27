/**
 * Recovery key: 160 random bits shown to the user once, encoded in RFC 4648
 * base32 with a 20-bit SHA-256 checksum so typos are caught.
 *
 * Format: 9 groups of 4 characters, e.g. ABCD-EFGH-...-WXYZ
 *   groups 1-8: base32 of 20 random bytes (32 chars)
 *   group 9:    base32 of the first 20 bits of SHA-256(label || key) (4 chars)
 *
 * Only a commitment (SHA-256 with a domain label) is ever stored or sent.
 * The key itself has 160 bits of entropy, so a plain hash commitment is safe.
 */
import { concatBytes, sha256, toHex, utf8 } from '../crypto/bytes';
import { OpenSocialError } from '../types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const KEY_BYTES = 20;
const CHECKSUM_LABEL = utf8('opensocial/v1/recovery-key-checksum');
const COMMITMENT_LABEL = utf8('opensocial/v1/recovery-key-commitment');
export const RECOVERY_KEY_GROUPS = 9;

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new OpenSocialError('RECOVERY_KEY_INVALID', `Invalid character “${ch}”.`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

async function checksum(key: Uint8Array): Promise<string> {
  const digest = await sha256(concatBytes(CHECKSUM_LABEL, key));
  // 20 bits -> 4 base32 characters.
  return base32Encode(digest.slice(0, 3)).slice(0, 4);
}

export const groupKey = (chars: string): string[] => chars.match(/.{4}/g) ?? [];

/** Uppercase and drop separators; maps common look-alikes (0→O, 1→I, 8→B). */
export function normalizeRecoveryInput(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B');
}

export async function commitmentOf(key: Uint8Array): Promise<string> {
  return toHex(await sha256(concatBytes(COMMITMENT_LABEL, key)));
}

export interface RecoveryKey {
  /** Display form: 9 groups joined by dashes. */
  readonly text: string;
  readonly groups: readonly string[];
  readonly commitment: string;
}

export async function generateRecoveryKey(): Promise<RecoveryKey> {
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const body = base32Encode(key);
  const groups = groupKey(body + (await checksum(key)));
  return { text: groups.join('-'), groups, commitment: await commitmentOf(key) };
}

/** Parse a typed key, verify its checksum and return the commitment. */
export async function parseRecoveryKey(input: string): Promise<{ commitment: string }> {
  const chars = normalizeRecoveryInput(input);
  if (chars.length !== RECOVERY_KEY_GROUPS * 4) {
    throw new OpenSocialError(
      'RECOVERY_KEY_INVALID',
      `A recovery key has ${RECOVERY_KEY_GROUPS * 4} characters; this one has ${chars.length}.`,
    );
  }
  const key = base32Decode(chars.slice(0, 32)).slice(0, KEY_BYTES);
  if ((await checksum(key)) !== chars.slice(32)) {
    throw new OpenSocialError('RECOVERY_KEY_CHECKSUM', 'This recovery key has a typo.');
  }
  return { commitment: await commitmentOf(key) };
}

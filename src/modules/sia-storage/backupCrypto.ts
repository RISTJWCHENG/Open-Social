/**
 * Extra encryption layer for backups stored on Sia. The Sia SDK already
 * encrypts objects with the user's app key; this adds AES-256-GCM with a key
 * derived (HKDF-SHA-256) from the same 32-byte app key seed, so a backup is
 * unreadable even if the Sia layer were misconfigured. Standard primitives only.
 */
import { concatBytes, randomBytes, utf8 } from '../../core/crypto/bytes';
import { OpenSocialError } from '../../core/types';

const MAGIC = utf8('ZCB1');
const INFO = utf8('opensocial/v1/sia-backup');

async function backupKey(appKeySeed: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', appKeySeed, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealBackup(appKeySeed: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const key = await backupKey(appKeySeed);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, key, plaintext),
  );
  return concatBytes(MAGIC, iv, ct);
}

export async function openBackup(appKeySeed: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 4 + 12 + 16 || new TextDecoder().decode(sealed.subarray(0, 4)) !== 'ZCB1') {
    throw new OpenSocialError('BACKUP_MALFORMED', 'This is not an OpenSocial backup.');
  }
  const key = await backupKey(appKeySeed);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.subarray(4, 16), additionalData: MAGIC },
        key,
        sealed.subarray(16),
      ),
    );
  } catch {
    throw new OpenSocialError('BACKUP_DECRYPT_FAILED', 'Backup could not be decrypted with this key.');
  }
}

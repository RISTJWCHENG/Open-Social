import { describe, expect, it } from 'vitest';
import { openBackup, sealBackup } from '../../src/modules/sia-storage/backupCrypto';

const key = (n: number) => new Uint8Array(32).fill(n);

describe('Sia backup encryption', () => {
  it('round-trips and hides the plaintext', async () => {
    const data = new TextEncoder().encode('{"chats":{"emily":[{"body":"secret-marker"}]}}');
    const sealed = await sealBackup(key(1), data);
    expect(new TextDecoder('latin1').decode(sealed)).not.toContain('secret-marker');
    expect(new TextDecoder().decode(await openBackup(key(1), sealed))).toContain('secret-marker');
  });

  it('uses a fresh IV each time', async () => {
    const a = await sealBackup(key(1), new Uint8Array([1, 2, 3]));
    const b = await sealBackup(key(1), new Uint8Array([1, 2, 3]));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('rejects the wrong key, tampering and foreign data', async () => {
    const sealed = await sealBackup(key(1), new Uint8Array([9, 9, 9]));
    await expect(openBackup(key(2), sealed)).rejects.toMatchObject({ code: 'BACKUP_DECRYPT_FAILED' });
    const t = sealed.slice();
    t[t.length - 1]! ^= 1;
    await expect(openBackup(key(1), t)).rejects.toMatchObject({ code: 'BACKUP_DECRYPT_FAILED' });
    await expect(openBackup(key(1), new Uint8Array(40))).rejects.toMatchObject({ code: 'BACKUP_MALFORMED' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  RECOVERY_KEY_GROUPS,
  generateRecoveryKey,
  normalizeRecoveryInput,
  parseRecoveryKey,
} from '../../src/core/recovery/recoveryKey';

describe('recovery key', () => {
  it('has 9 groups of 4 base32 characters', async () => {
    const k = await generateRecoveryKey();
    expect(k.groups).toHaveLength(RECOVERY_KEY_GROUPS);
    expect(k.text).toMatch(/^([A-Z2-7]{4}-){8}[A-Z2-7]{4}$/);
    expect(k.commitment).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is random each time', async () => {
    const [a, b] = await Promise.all([generateRecoveryKey(), generateRecoveryKey()]);
    expect(a.text).not.toBe(b.text);
    expect(a.commitment).not.toBe(b.commitment);
  });

  it('parses back to the same commitment, tolerating case, spaces and dashes', async () => {
    const k = await generateRecoveryKey();
    const typed = k.groups.join(' ').toLowerCase();
    expect((await parseRecoveryKey(typed)).commitment).toBe(k.commitment);
  });

  it('detects a single-character typo', async () => {
    const k = await generateRecoveryKey();
    const chars = k.groups.join('');
    const swapped = (chars[5] === 'A' ? 'B' : 'A') as string;
    const typo = chars.slice(0, 5) + swapped + chars.slice(6);
    await expect(parseRecoveryKey(typo)).rejects.toMatchObject({ code: 'RECOVERY_KEY_CHECKSUM' });
  });

  it('rejects wrong length and invalid characters', async () => {
    await expect(parseRecoveryKey('ABCD-EFGH')).rejects.toMatchObject({
      code: 'RECOVERY_KEY_INVALID',
    });
    await expect(parseRecoveryKey('9'.repeat(36))).rejects.toMatchObject({
      code: 'RECOVERY_KEY_INVALID',
    });
  });

  it('maps look-alike digits to letters', () => {
    expect(normalizeRecoveryInput('o0-i1 b8')).toBe('OOIIBB');
  });
});

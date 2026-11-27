import { describe, expect, it } from 'vitest';
import { emptyProfile, validateProfile } from '../../src/core/profile/profile';
import { isBirthDate, normalizeProfile } from '../../src/core/profile/sealedProfile';
import { birthDateText } from '../../src/ui/ProfilePanel';

describe('Location and birth date', () => {
  const now = new Date(2026, 10, 18);

  it('accepts real past dates from 1900 only', () => {
    expect(isBirthDate('1990-03-04', now)).toBe(true);
    expect(isBirthDate('2026-11-18', now)).toBe(true);
    expect(isBirthDate('2026-11-19', now)).toBe(false);
    expect(isBirthDate('1899-12-31', now)).toBe(false);
    expect(isBirthDate('2023-02-29', now)).toBe(false);
    expect(isBirthDate('1990-3-4', now)).toBe(false);
  });

  it('limits the location to 30 characters and checks the date', () => {
    const p = { ...emptyProfile(), location: 'x'.repeat(31), birthDate: '3000-01-01' };
    const e = validateProfile(p);
    expect(e.location).toMatch(/30/);
    expect(e.birthDate).toBeTruthy();
    expect(validateProfile({ ...emptyProfile(), location: 'Brussels, Belgium', birthDate: '1990-03-04' })).toEqual({});
  });

  it('keeps them through normalization, and older profiles get empty values', () => {
    expect(normalizeProfile({ location: 'Brussels, Belgium', birthDate: '1990-03-04' })).toMatchObject({
      location: 'Brussels, Belgium',
      birthDate: '1990-03-04',
    });
    expect(normalizeProfile({ displayName: 'Old' })).toMatchObject({ location: '', birthDate: '' });
  });

  it('writes the birth date as on the profile', () => {
    expect(birthDateText('1990-03-04')).toBe('March 4, 1990');
  });
});

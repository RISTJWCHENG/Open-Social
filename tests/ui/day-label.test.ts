import { describe, expect, it } from 'vitest';
import { dayLabel, isNewDay } from '../../src/ui/dayLabel';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('dayLabel', () => {
  const now = at(2026, 11, 17, 23);

  it('says Today, Yesterday, then the weekday within a week', () => {
    expect(dayLabel(at(2026, 11, 17, 0), now)).toBe('Today');
    expect(dayLabel(at(2026, 11, 16, 23), now)).toBe('Yesterday');
    expect(dayLabel(at(2026, 11, 13), now)).toBe('Friday');
    expect(dayLabel(at(2026, 11, 11), now)).toBe('Wednesday');
  });

  it('gives the date for older days, with the year when not this year', () => {
    expect(dayLabel(at(2026, 11, 10), now)).toBe('Tue 10 Nov');
    expect(dayLabel(at(2025, 12, 31), now)).toBe('Wed 31 Dec 2025');
  });

  it('starts a new day at local midnight', () => {
    expect(isNewDay(undefined, now)).toBe(true);
    expect(isNewDay(at(2026, 11, 17, 0), at(2026, 11, 17, 23))).toBe(false);
    expect(isNewDay(at(2026, 11, 16, 23), at(2026, 11, 17, 0))).toBe(true);
  });
});

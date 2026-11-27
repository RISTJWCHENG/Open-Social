import { describe, expect, it } from 'vitest';
import { formatDuration, waveform, WAVE_BARS } from '../../src/ui/voice/recorder';

describe('Voice recording helpers', () => {
  it('turns levels into a fixed number of bars, loudest at full height', () => {
    const levels = Array.from({ length: 500 }, (_, i) => (i === 250 ? 0.5 : 0.1));
    const w = waveform(levels);
    expect(w.length).toBe(WAVE_BARS);
    expect(Math.max(...w)).toBe(255);
    expect(Math.min(...w)).toBe(51); // 0.1 / 0.5
  });

  it('handles silence and very short recordings', () => {
    expect([...waveform([])]).toEqual(new Array(WAVE_BARS).fill(0));
    expect(waveform([0.2, 0.4]).length).toBe(WAVE_BARS);
  });

  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(12_400)).toBe('0:12');
    expect(formatDuration(15 * 60_000)).toBe('15:00');
  });
});

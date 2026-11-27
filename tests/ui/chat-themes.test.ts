import { describe, expect, it } from 'vitest';
import { CHAT_THEMES } from '../../src/ui/chatThemes';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('Chat themes', () => {
  it('has eight light and eight dark themes; dark ones have a gradient background', () => {
    expect(CHAT_THEMES.filter((t) => !t.dark)).toHaveLength(8);
    const dark = CHAT_THEMES.filter((t) => t.dark);
    expect(dark).toHaveLength(8);
    for (const t of dark) expect(t.background).toMatch(/^linear-gradient\(/);
    expect(new Set(CHAT_THEMES.map((t) => t.id)).size).toBe(16);
  });

  it('keeps every bubble readable (WCAG AA, 4.5:1)', () => {
    for (const t of CHAT_THEMES) {
      expect(contrast(t.bubbleOut, '#ffffff'), `${t.id} ours`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.bubbleIn, t.dark ? '#eef0f6' : '#1a1714'), `${t.id} theirs`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { jumboEmojiCount } from '../../src/ui/jumboEmoji';

describe('jumboEmojiCount', () => {
  it('counts messages made of one to three emoji, flags and joined emoji included', () => {
    expect(jumboEmojiCount('💯')).toBe(1);
    expect(jumboEmojiCount(' 🇨🇳 ')).toBe(1);
    expect(jumboEmojiCount('👨‍👩‍👧')).toBe(1);
    expect(jumboEmojiCount('❤️👍🏽')).toBe(2);
    expect(jumboEmojiCount('😂 😂 😂')).toBe(3);
  });

  it('is 0 for text, mixed text and more than three emoji', () => {
    expect(jumboEmojiCount('ok')).toBe(0);
    expect(jumboEmojiCount('ok 👍')).toBe(0);
    expect(jumboEmojiCount('12')).toBe(0);
    expect(jumboEmojiCount('😂😂😂😂')).toBe(0);
    expect(jumboEmojiCount('')).toBe(0);
  });
});

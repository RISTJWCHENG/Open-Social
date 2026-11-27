/** Messages of only a few emoji are shown large, like a sticker. */

/** Most emoji shown large; more than this reads as text. */
export const JUMBO_MAX = 3;

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** How many emoji the text is made of (1..JUMBO_MAX), or 0 when it has anything else or more of them. */
export function jumboEmojiCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed || typeof Intl === 'undefined' || !('Segmenter' in Intl)) return 0;
  let count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)) {
    if (/^\s+$/.test(segment)) continue;
    if (!EMOJI.test(segment) || ++count > JUMBO_MAX) return 0;
  }
  return count;
}

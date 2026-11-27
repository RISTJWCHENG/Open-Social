/**
 * A round avatar: the person's photo, or — when they have none — a gradient
 * circle with the first letter of their name in white. The gradient is chosen
 * from a seed (the account id where known), so the same person always gets
 * the same colours, on every device.
 */
import type { CSSProperties } from 'react';

/** First letter of a name (any script), upper-cased; '?' when there is none. */
export function initial(name: string): string {
  const text = name.trim().replace(/^[@#]+/, '');
  if (!text) return '?';
  let first = text[0]!;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
    first = seg[Symbol.iterator]().next().value?.segment ?? first;
  } else {
    first = Array.from(text)[0] ?? first;
  }
  return first.toLocaleUpperCase();
}

/** FNV-1a: a small, stable hash of the seed. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Background for an avatar without a photo: a diagonal two-colour gradient
 * whose hues come from the seed. Colours stay deep enough for white text.
 */
export function avatarGradient(seed: string): string {
  const h = hash(seed || '?');
  const hue = h % 360;
  const shift = 30 + ((h >>> 9) % 40);
  const hue2 = (hue + shift) % 360;
  // Yellows and greens look lighter at the same lightness: darken them so the
  // white letter stays readable.
  const bright = (x: number) => x >= 40 && x <= 180;
  const l1 = bright(hue) ? 44 : 58;
  const l2 = bright(hue2) ? 34 : 44;
  return `linear-gradient(135deg, hsl(${hue} 72% ${l1}%), hsl(${hue2} 68% ${l2}%))`;
}

/** Inline style for a photo-less avatar. */
export function avatarStyle(seed: string): CSSProperties {
  return { background: avatarGradient(seed), color: '#ffffff' };
}

export function Avatar({
  name,
  className,
  src,
  seed,
}: {
  name: string;
  className: string;
  src?: string;
  /** What picks the colours: the account id where known (defaults to the name). */
  seed?: string;
}) {
  if (src) return <img className={`avatar avatar-img ${className}`} src={src} alt="" />;
  return (
    <span className={`avatar avatar-letter ${className}`} style={avatarStyle(seed ?? name)} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

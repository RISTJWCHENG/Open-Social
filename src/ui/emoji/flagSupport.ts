/**
 * Flag emoji on systems that have none (Windows shows "BE" instead of 🇧🇪).
 *
 * The flag font is declared in styles.css (the site's style policy allows only
 * its own stylesheet, so it can't be injected at run time) and used only when
 * <html> has the "flag-font" class, which this sets after checking that the
 * system draws emoji in colour but not flags. Elsewhere the system's own flags
 * are kept.
 */

const EMOJI_FONTS = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/** True if the system draws `emoji` as a colour glyph (letters stay one colour). */
function drawsInColour(ctx: CanvasRenderingContext2D, emoji: string): boolean {
  const pixel = (fill: string) => {
    ctx.clearRect(0, 0, 100, 100);
    ctx.fillStyle = fill;
    ctx.fillText(emoji, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data.join(',');
  };
  // A colour glyph ignores fillStyle: drawn the same in white and in black, and not empty.
  const onWhite = pixel('#fff');
  const onBlack = pixel('#000');
  return onWhite === onBlack && !onBlack.startsWith('0,0,0,');
}

export function needsFlagFont(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.textBaseline = 'top';
  ctx.font = `100px ${EMOJI_FONTS}`;
  ctx.scale(0.01, 0.01);
  return drawsInColour(ctx, '\u{1F60A}') && !drawsInColour(ctx, '\u{1F1E7}\u{1F1EA}');
}

/** Turns the flag font on where the system can't show flags. */
export function enableFlagFontIfNeeded(): boolean {
  const needed = needsFlagFont();
  if (needed) document.documentElement.classList.add('flag-font');
  return needed;
}

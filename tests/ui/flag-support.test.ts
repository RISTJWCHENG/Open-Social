// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableFlagFontIfNeeded } from '../../src/ui/emoji/flagSupport';

/** A canvas that draws colour glyphs for `colour` emoji and plain (fillStyle-coloured) text otherwise. */
function fakeCanvas(colour: (text: string) => boolean) {
  let pixel = '0,0,0,0';
  const ctx = {
    textBaseline: '',
    font: '',
    fillStyle: '',
    scale() {},
    clearRect() {
      pixel = '0,0,0,0';
    },
    fillText(text: string) {
      pixel = colour(text) ? '255,204,77,255' : this.fillStyle === '#fff' ? '255,255,255,255' : '0,0,0,255';
    },
    getImageData: () => ({ data: pixel.split(',').map(Number) }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove('flag-font');
});

describe('Flag font', () => {
  it('turns on where emoji are in colour but flags are letters (Windows)', () => {
    fakeCanvas((t) => t === '\u{1F60A}');
    expect(enableFlagFontIfNeeded()).toBe(true);
    expect(document.documentElement.classList.contains('flag-font')).toBe(true);
  });

  it('stays off where the system has its own flags (Mac, iPhone, Android)', () => {
    fakeCanvas(() => true);
    expect(enableFlagFontIfNeeded()).toBe(false);
    expect(document.documentElement.classList.contains('flag-font')).toBe(false);
  });

  it('stays off where there are no colour emoji at all', () => {
    fakeCanvas(() => false);
    expect(enableFlagFontIfNeeded()).toBe(false);
  });
});

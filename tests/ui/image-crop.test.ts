import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, clampView, cropOf } from '../../src/ui/ImageCropDialog';

describe('Image crop', () => {
  // A 1000 × 500 photo under a 300 px square frame: at zoom 1 its height fills the frame (scale 0.6).
  const square = { frameW: 300, frameH: 300, width: 1000, height: 500 };

  it('keeps the frame covered and the zoom between 1 and the maximum', () => {
    expect(clampView({ zoom: 1, x: 50, y: 20 }, square)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampView({ zoom: 1, x: -900, y: -50 }, square)).toEqual({ zoom: 1, x: -300, y: 0 });
    expect(clampView({ zoom: 0.5, x: 0, y: 0 }, square).zoom).toBe(1);
    expect(clampView({ zoom: 9, x: 0, y: 0 }, square).zoom).toBe(MAX_ZOOM);
  });

  it('turns the view into the part of the photo under a square frame', () => {
    expect(cropOf({ zoom: 1, x: -150, y: 0 }, square)).toEqual({ x: 250, y: 0, width: 500, height: 500 });
    const v = clampView({ zoom: 2, x: -5000, y: -5000 }, square);
    const c = cropOf(v, square);
    expect(c.width).toBeCloseTo(250);
    expect(c.x + c.width).toBeCloseTo(1000);
    expect(c.y + c.height).toBeCloseTo(500);
  });

  it('works for a wide cover frame: a tall photo is filled by its width', () => {
    // 340 × 180 frame over a 600 × 1200 photo: scale 340 / 600.
    const cover = { frameW: 340, frameH: 180, width: 600, height: 1200 };
    const c = cropOf(clampView({ zoom: 1, x: 0, y: -100 }, cover), cover);
    expect(c.x).toBe(0);
    expect(c.width).toBeCloseTo(600);
    expect(c.width / c.height).toBeCloseTo(340 / 180);
  });
});

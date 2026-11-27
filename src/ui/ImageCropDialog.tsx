/**
 * Choosing what part of a new photo to use (profile photo or cover): the photo
 * under a frame of the shape it is shown in (a square with a round guide for
 * the profile photo, the cover's shape for the cover). Drag to move it, zoom
 * with the slider, the buttons, the mouse wheel or a pinch; the frame is
 * always filled. Apply returns the part under the frame in the photo's pixels.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ImageCrop } from '../core/profile/profile';
import { BackIcon, ZoomInIcon, ZoomOutIcon } from './icons';

/** Largest zoom (times the size that just fills the frame). */
export const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export interface CropView {
  zoom: number;
  /** Photo's top-left corner relative to the frame's, in screen pixels. */
  x: number;
  y: number;
}

/** Frame size on screen, and the photo's size in its own pixels. */
export interface CropBox {
  frameW: number;
  frameH: number;
  width: number;
  height: number;
}

const scaleOf = (zoom: number, b: CropBox) => Math.max(b.frameW / b.width, b.frameH / b.height) * zoom;

/** Keeps the frame covered: the photo may not leave a gap at any edge. */
export function clampView(v: CropView, b: CropBox): CropView {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const s = scaleOf(zoom, b);
  return {
    zoom,
    x: Math.min(0, Math.max(b.frameW - b.width * s, v.x)),
    y: Math.min(0, Math.max(b.frameH - b.height * s, v.y)),
  };
}

/** The part of the photo under the frame, in the photo's pixels. */
export function cropOf(v: CropView, b: CropBox): ImageCrop {
  const s = scaleOf(v.zoom, b);
  return { x: Math.max(0, -v.x / s), y: Math.max(0, -v.y / s), width: b.frameW / s, height: b.frameH / s };
}

interface Props {
  file: File;
  /** Frame width ÷ height. */
  aspect: number;
  /** Show the round shape the photo is shown in (profile photos). */
  round?: boolean;
  title: string;
  onApply: (crop: ImageCrop) => void;
  onCancel: () => void;
}

export function ImageCropDialog({ file, aspect, round = false, title, onApply, onCancel }: Props) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<CropView>({ zoom: 1, x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const frameEl = useRef<HTMLDivElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const box: CropBox | null =
    size && frame.w ? { frameW: frame.w, frameH: frame.h, width: size.w, height: size.h } : null;

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // Escape cancels; focus starts on Apply and returns where it was.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    applyRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [onCancel]);

  // The frame's size on screen; the photo starts centred, just filling it.
  useLayoutEffect(() => {
    const measure = () => setFrame({ w: frameEl.current?.offsetWidth ?? 0, h: frameEl.current?.offsetHeight ?? 0 });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    if (!box) return;
    const s = scaleOf(1, box);
    setView({ zoom: 1, x: (box.frameW - box.width * s) / 2, y: (box.frameH - box.height * s) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, frame.w, frame.h]);

  /** Zooms keeping a point (frame coordinates, default its centre) still. */
  const zoomAround = (v: CropView, zoom: number, at: { x: number; y: number }): CropView => {
    if (!box) return v;
    const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
    const k = next / v.zoom;
    return clampView({ zoom: next, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, box);
  };
  const zoomTo = (zoom: number, at = { x: frame.w / 2, y: frame.h / 2 }) => setView((v) => zoomAround(v, zoom, at));

  const framePoint = (clientX: number, clientY: number) => {
    const r = frameEl.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a!.x - b!.x, a!.y - b!.y), zoom: view.zoom };
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const last = pointers.current.get(e.pointerId);
    if (!last || !box) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = framePoint((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      zoomTo((pinch.current.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / pinch.current.distance, mid);
      return;
    }
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, box));
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = framePoint(e.clientX, e.clientY);
      setView((v) => zoomAround(v, v.zoom * Math.exp(-e.deltaY / 400), at));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const scale = box ? scaleOf(view.zoom, box) : 0;

  return createPortal(
    <div
      className="crop-backdrop"
      role="presentation"
      onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <header className="crop-head">
          <button type="button" className="crop-back" aria-label="Cancel" title="Cancel" onClick={onCancel}>
            <BackIcon />
          </button>
          <h2 id="crop-title">{title}</h2>
          <button
            type="button"
            ref={applyRef}
            className="crop-apply"
            disabled={!box}
            onClick={() => box && onApply(cropOf(view, box))}
          >
            Apply
          </button>
        </header>
        <div
          className="crop-stage"
          ref={stage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="crop-frame" ref={frameEl} style={{ '--crop-aspect': aspect } as CSSProperties}>
            <img
              src={url}
              alt=""
              draggable={false}
              className="crop-img"
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={
                scale
                  ? {
                      width: size!.w * scale,
                      height: size!.h * scale,
                      transform: `translate(${view.x}px, ${view.y}px)`,
                    }
                  : { visibility: 'hidden' }
              }
            />
            {round && <span className="crop-circle" aria-hidden="true" />}
          </div>
        </div>
        <div className="crop-zoom">
          <button
            type="button"
            className="crop-zoom-btn"
            aria-label="Zoom out"
            onClick={() => zoomTo(view.zoom - ZOOM_STEP)}
            disabled={view.zoom <= 1}
          >
            <ZoomOutIcon />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            aria-label="Zoom"
            onChange={(e) => zoomTo(Number(e.target.value))}
            style={{ '--fill': `${((view.zoom - 1) / (MAX_ZOOM - 1)) * 100}%` } as CSSProperties}
          />
          <button
            type="button"
            className="crop-zoom-btn"
            aria-label="Zoom in"
            onClick={() => zoomTo(view.zoom + ZOOM_STEP)}
            disabled={view.zoom >= MAX_ZOOM}
          >
            <ZoomInIcon />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Stops pinch and double-tap zoom while the calling page is shown (the
 * sign-in and sign-up pages, and the app on phones), and restores normal
 * zooming when it closes. The page also stops bouncing past its edges.
 *
 * Browsers differ, so three things are combined:
 * - the viewport meta tag gets maximum-scale=1 and user-scalable=no
 *   (Android browsers; also stops iOS zooming into a focused field);
 * - html gets the no-zoom class (touch-action: pan-x pan-y in styles.css),
 *   which leaves scrolling but no pinch or double-tap zoom (Chrome, Firefox,
 *   newer Safari);
 * - iOS Safari ignores user-scalable=no, so its pinch gesture events are
 *   cancelled directly.
 */
import { useEffect } from 'react';

const LOCKED = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

// Several screens may ask at once (the sign-in page inside the phone app):
// the lock is applied by the first and lifted by the last.
let holders = 0;
let before: string | null = null;
const cancel = (e: Event) => e.preventDefault();

function lock() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  before = meta?.getAttribute('content') ?? null;
  meta?.setAttribute('content', LOCKED);
  document.documentElement.classList.add('no-zoom');
  document.addEventListener('gesturestart', cancel);
  document.addEventListener('gesturechange', cancel);
}

function unlock() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta && before !== null) meta.setAttribute('content', before);
  document.documentElement.classList.remove('no-zoom');
  document.removeEventListener('gesturestart', cancel);
  document.removeEventListener('gesturechange', cancel);
}

export function useNoZoom(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (holders++ === 0) lock();
    return () => {
      if (--holders === 0) unlock();
    };
  }, [enabled]);
}

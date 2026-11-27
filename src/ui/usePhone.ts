/** Whether the window is phone-sized (the layout's 760px breakpoint), kept up to date. */
import { useSyncExternalStore } from 'react';

const QUERY = '(max-width: 760px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
}

export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

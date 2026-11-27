/**
 * A small "i" button with an explanation that shows on hover, keyboard focus
 * or tap (tap again, Escape or a tap elsewhere hides it). Place it next to a
 * heading inside a positioned row (e.g. `.about-heading`): the explanation
 * opens below that row, across its full width.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { InfoIcon } from './icons';

export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPinned(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [pinned]);

  return (
    <span ref={ref} className={`info-tip${pinned ? ' is-open' : ''}`}>
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={pinned}
        onClick={() => setPinned((o) => !o)}
      >
        <InfoIcon />
      </button>
      <span id={id} role="tooltip" className="info-tip-text">
        {children}
      </span>
    </span>
  );
}

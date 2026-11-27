/**
 * A simple menu opened from a button: positioned next to it on screen (so a
 * scrolling list can't clip it), kept inside the window; arrow keys move,
 * Escape or a click elsewhere closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';

export type MenuItem =
  | {
      label: string;
      icon: ReactElement;
      onSelect: () => void;
      danger?: boolean;
      /** Shown but not usable yet (marked Soon). */
      soon?: boolean;
      /** For a choice among options: whether this one is chosen. */
      checked?: boolean;
    }
  | 'divider';

interface Props {
  label: string;
  anchor: HTMLElement;
  items: MenuItem[];
  onClose: () => void;
  /** Shown above the items (e.g. a row of reactions). */
  header?: ReactNode;
}

export function PopoverMenu({ label, anchor, items, onClose, header }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    // offsetWidth/Height: the real size (the opening animation scales the box).
    const m = { width: ref.current!.offsetWidth, height: ref.current!.offsetHeight };
    const top = a.bottom + 4 + m.height > window.innerHeight - 8 ? Math.max(8, a.top - 4 - m.height) : a.bottom + 4;
    const left = Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  const move = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <div className="chat-menu" role="menu" aria-label={label} ref={ref} style={pos} onKeyDown={move}>
      {header}
      {items.map((it, i) =>
        it === 'divider' ? (
          <span key={`d${i}`} className="chat-menu-divider" role="separator" />
        ) : (
          <button
            key={it.label}
            type="button"
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked}
            className={`chat-menu-item ${it.danger ? 'danger' : ''} ${it.soon ? 'is-soon' : ''} ${it.checked ? 'is-checked' : ''}`}
            aria-disabled={it.soon || undefined}
            onClick={() => {
              if (it.soon) return;
              it.onSelect();
              onClose();
            }}
          >
            <span className="chat-menu-icon" aria-hidden="true">
              {it.icon}
            </span>
            <span className="chat-menu-label">{it.label}</span>
            {it.soon && <span className="soon">Soon</span>}
          </button>
        ),
      )}
    </div>
  );
}

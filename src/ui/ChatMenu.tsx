/**
 * The menu behind a chat's ▾ arrow in the chat list: archive, mute, pin,
 * mark as unread, favourite, add to list, block, clear and delete.
 * Positioned on screen next to the arrow (so the list's scrolling can't clip
 * it), kept inside the window; Escape or a click elsewhere closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  ArchiveIcon,
  BellOffIcon,
  BlockIcon,
  ChevronRightIcon,
  ClearIcon,
  HeartIcon,
  ListAddIcon,
  MarkUnreadIcon,
  PinIcon,
  TrashIcon,
} from './icons';

export interface ChatMenuState {
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  /** Has unread messages or is marked unread. */
  unread: boolean;
  /** Notes to yourself: only clearing applies. */
  self: boolean;
}

export type ChatMenuAction =
  | 'archive'
  | 'unarchive'
  | 'pin'
  | 'unpin'
  | 'mark-unread'
  | 'mark-read'
  | 'favorite'
  | 'unfavorite'
  | 'unmute'
  | { mute: number }
  | 'block'
  | 'clear'
  | 'delete';

const HOUR = 3_600_000;
const MUTE_OPTIONS: { label: string; ms: number }[] = [
  { label: '8 hours', ms: 8 * HOUR },
  { label: '1 week', ms: 7 * 24 * HOUR },
  { label: 'Always', ms: Infinity },
];

interface Props {
  state: ChatMenuState;
  /** The arrow button the menu opens from. */
  anchor: HTMLElement;
  onAction: (action: ChatMenuAction) => void;
  onClose: () => void;
}

type Item = { label: string; icon: ReactElement; action?: ChatMenuAction; sub?: 'mute' | 'lists'; danger?: boolean };

export function ChatMenu({ state, anchor, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [sub, setSub] = useState<'mute' | 'lists' | null>(null);

  // Below the arrow, right-aligned to it; flipped above when there's no room.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const m = ref.current!.getBoundingClientRect();
    const top = a.bottom + 4 + m.height > window.innerHeight - 8 ? Math.max(8, a.top - 4 - m.height) : a.bottom + 4;
    const left = Math.min(Math.max(8, a.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  const items: (Item | 'divider')[] = state.self
    ? [{ label: 'Clear chat', icon: <ClearIcon />, action: 'clear' }]
    : [
        state.archived
          ? { label: 'Unarchive chat', icon: <ArchiveIcon />, action: 'unarchive' }
          : { label: 'Archive chat', icon: <ArchiveIcon />, action: 'archive' },
        state.muted
          ? { label: 'Unmute notifications', icon: <BellOffIcon />, action: 'unmute' }
          : { label: 'Mute notifications', icon: <BellOffIcon />, sub: 'mute' },
        ...(state.archived
          ? []
          : [
              state.pinned
                ? { label: 'Unpin chat', icon: <PinIcon />, action: 'unpin' as const }
                : { label: 'Pin chat', icon: <PinIcon />, action: 'pin' as const },
            ]),
        state.unread
          ? { label: 'Mark as read', icon: <MarkUnreadIcon />, action: 'mark-read' }
          : { label: 'Mark as unread', icon: <MarkUnreadIcon />, action: 'mark-unread' },
        state.favorite
          ? { label: 'Remove from Favorites', icon: <HeartIcon />, action: 'unfavorite' }
          : { label: 'Add to Favorites', icon: <HeartIcon />, action: 'favorite' },
        { label: 'Add to list', icon: <ListAddIcon />, sub: 'lists' },
        'divider',
        { label: 'Block', icon: <BlockIcon />, action: 'block', danger: true },
        { label: 'Clear chat', icon: <ClearIcon />, action: 'clear' },
        { label: 'Delete chat', icon: <TrashIcon />, action: 'delete', danger: true },
      ];

  const choose = (a: ChatMenuAction) => {
    onAction(a);
    onClose();
  };

  // Arrow keys move between items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>(':scope > .chat-menu-row > [role="menuitem"]') ?? []),
    ];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <div
      className="chat-menu"
      role="menu"
      aria-label="Chat options"
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) =>
        it === 'divider' ? (
          <span key={`d${i}`} className="chat-menu-divider" role="separator" />
        ) : (
          <div key={it.label} className="chat-menu-row" onMouseEnter={() => setSub(it.sub ?? null)}>
            <button
              type="button"
              role="menuitem"
              className={`chat-menu-item ${it.danger ? 'danger' : ''}`}
              aria-haspopup={it.sub ? 'menu' : undefined}
              aria-expanded={it.sub ? sub === it.sub : undefined}
              onClick={() => (it.sub ? setSub(it.sub) : choose(it.action!))}
              onKeyDown={(e) => {
                if (it.sub && e.key === 'ArrowRight') {
                  setSub(it.sub);
                  requestAnimationFrame(() =>
                    e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.chat-submenu button')?.focus(),
                  );
                }
              }}
            >
              <span className="chat-menu-icon" aria-hidden="true">
                {it.icon}
              </span>
              <span className="chat-menu-label">{it.label}</span>
              {it.sub && (
                <span className="chat-menu-more" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              )}
            </button>
            {it.sub === sub && it.sub === 'mute' && (
              <div className="chat-submenu" role="menu" aria-label="Mute for">
                {MUTE_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="menuitem"
                    className="chat-menu-item"
                    onClick={() => choose({ mute: o.ms })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
            {it.sub === sub && it.sub === 'lists' && (
              <div className="chat-submenu" role="menu" aria-label="Lists">
                <button
                  type="button"
                  role="menuitem"
                  aria-disabled="true"
                  className="chat-menu-item is-soon"
                  onClick={(e) => e.preventDefault()}
                >
                  New list <span className="soon">Soon</span>
                </button>
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

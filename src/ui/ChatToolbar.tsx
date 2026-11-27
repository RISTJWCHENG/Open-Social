/**
 * Icons at the top right of a chat: search, highlights, shared media, voice
 * call, video call, contact info and last the ⋮ menu (favourite, translate,
 * mute, theme), all the same size, on a small blurred backdrop so they read
 * over the messages. Search opens an oval search box in their place (the other icons
 * step aside until it is closed): matches counted, up / down to move.
 *
 * On phones the row becomes one round button with a down arrow at the right
 * of the chat; tapping it drops the same actions down as a column of round
 * buttons, which close again on any choice or a tap elsewhere.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChatMoreMenu, type ChatMoreAction, type ChatMoreState } from './ChatMoreMenu';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  MoreIcon,
  MoreVerticalIcon,
  PanelExpandIcon,
  PersonIcon,
  PhoneIcon,
  SearchIcon,
  SharedIcon,
  StarIcon,
  VideoIcon,
} from './icons';

interface Props {
  /** Absent: calls not possible here (yourself, not a friend, or in a call). */
  onCall?: (kind: 'voice' | 'video') => void;
  /** Expands the collapsed right panel (absent while it is open). */
  onExpand?: () => void;
  /** The chat's highlighted messages: how many, and showing / hiding them on the right. */
  highlights?: { count: number; open: boolean; onToggle: () => void };
  /** What was shared in the chat (media, files, links) in the right panel. */
  shared?: { open: boolean; onToggle: () => void };
  /** Contact info in the right panel: whether it is showing, and showing / hiding it. */
  info?: { open: boolean; onToggle: () => void };
  /** Tucked away (it stays shown while its menu or search is open). */
  hidden?: boolean;
  /** Phone layout: a round button that drops the actions down as a column. */
  compact?: boolean;
  /** The ⋮ menu (absent for notes to yourself). */
  more?: { state: ChatMoreState; onAction: (a: ChatMoreAction) => void };
  search: {
    open: boolean;
    query: string;
    count: number;
    /** 0-based index of the current match. */
    index: number;
    onOpen: () => void;
    onClose: () => void;
    onQuery: (q: string) => void;
    onPrev: () => void;
    onNext: () => void;
  };
}

export function ChatToolbar({
  onCall,
  highlights,
  shared,
  search,
  onExpand,
  info,
  more,
  hidden = false,
  compact = false,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (search.open) input.current?.focus();
  }, [search.open]);

  if (search.open) {
    return (
      <div className="chat-toolbar searching">
        <div
          className="chat-search"
          role="search"
          onKeyDown={(e) => {
            // Escape closes from anywhere in the box (also after using the arrows).
            if (e.key === 'Escape') search.onClose();
          }}
        >
          <SearchIcon />
          <input
            ref={input}
            type="search"
            placeholder="Search this chat"
            aria-label="Search this chat"
            value={search.query}
            onChange={(e) => search.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.shiftKey ? search.onPrev : search.onNext)();
            }}
          />
          {search.query.trim() && (
            <span className="chat-search-count" aria-live="polite">
              {search.count ? `${search.index + 1} of ${search.count}` : 'No results'}
            </span>
          )}
          <button type="button" className="chat-search-nav" aria-label="Previous result" disabled={!search.count} onClick={search.onPrev}>
            <ChevronUpIcon />
          </button>
          <button type="button" className="chat-search-nav" aria-label="Next result" disabled={!search.count} onClick={search.onNext}>
            <ChevronDownIcon />
          </button>
          <button type="button" className="chat-search-nav" aria-label="Close search" onClick={search.onClose}>
            <CloseIcon />
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <ChatFab
        onCall={onCall}
        highlights={highlights}
        shared={shared}
        search={search}
        info={info}
        more={more}
        hidden={hidden}
      />
    );
  }

  return (
    <div
      className={`chat-toolbar ${hidden && !moreAnchor ? 'is-hidden' : ''}`}
      role="toolbar"
      aria-label="Chat actions"
      aria-hidden={hidden && !moreAnchor ? true : undefined}
    >
      <button type="button" className="chat-toolbar-btn" aria-label="Search this chat" title="Search" onClick={search.onOpen}>
        <SearchIcon />
      </button>
      {highlights && (
        <button
          type="button"
          className={`chat-toolbar-btn ${highlights.open ? 'is-on' : ''}`}
          aria-label={`Highlighted messages (${highlights.count})`}
          aria-pressed={highlights.open}
          title="Highlighted messages"
          onClick={highlights.onToggle}
        >
          <StarIcon />
          {highlights.count > 0 && <span className="toolbar-count">{highlights.count}</span>}
        </button>
      )}
      {shared && (
        <button
          type="button"
          className={`chat-toolbar-btn ${shared.open ? 'is-on' : ''}`}
          aria-label="Media, files and links"
          aria-pressed={shared.open}
          title="Media, files and links"
          onClick={shared.onToggle}
        >
          <SharedIcon />
        </button>
      )}
      {onCall && (
        <>
          <button type="button" className="chat-toolbar-btn" aria-label="Voice call" title="Voice call" onClick={() => onCall('voice')}>
            <PhoneIcon />
          </button>
          <button type="button" className="chat-toolbar-btn" aria-label="Video call" title="Video call" onClick={() => onCall('video')}>
            <VideoIcon />
          </button>
        </>
      )}
      {onExpand && (
        <button type="button" className="chat-toolbar-btn" aria-label="Expand panel" title="Expand" onClick={onExpand}>
          <PanelExpandIcon />
        </button>
      )}
      {info && (
        <button
          type="button"
          className={`chat-toolbar-btn ${info.open ? 'is-on' : ''}`}
          aria-label="Contact info"
          aria-pressed={info.open}
          title="Contact info"
          onClick={info.onToggle}
        >
          <PersonIcon />
        </button>
      )}
      {more && (
        <button
          type="button"
          className={`chat-toolbar-btn ${moreAnchor ? 'is-on' : ''}`}
          aria-label="More options"
          title="More"
          aria-haspopup="menu"
          aria-expanded={!!moreAnchor}
          onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)}
        >
          <MoreVerticalIcon />
        </button>
      )}
      {more && moreAnchor && (
        <ChatMoreMenu state={more.state} anchor={moreAnchor} onAction={more.onAction} onClose={() => setMoreAnchor(null)} />
      )}
    </div>
  );
}

/** The phone version: one round button that drops the chat actions down. */
function ChatFab({ onCall, highlights, shared, search, info, more, hidden }: Omit<Props, 'onExpand' | 'compact'>) {
  const [open, setOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A tap anywhere else closes the column (the ⋮ menu closes itself).
  useEffect(() => {
    if (!open || moreAnchor) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open, moreAnchor]);
  const shown = !hidden || open;
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const actions: { key: string; label: string; icon: ReactNode; on?: boolean; count?: number; run: (e: MouseEvent<HTMLButtonElement>) => void }[] = [
    { key: 'search', label: 'Search this chat', icon: <SearchIcon />, run: pick(search.onOpen) },
    ...(highlights
      ? [{ key: 'highlights', label: `Highlighted messages (${highlights.count})`, icon: <StarIcon />, on: highlights.open, count: highlights.count, run: pick(highlights.onToggle) }]
      : []),
    ...(shared
      ? [{ key: 'shared', label: 'Media, files and links', icon: <SharedIcon />, on: shared.open, run: pick(shared.onToggle) }]
      : []),
    ...(onCall
      ? [
          { key: 'voice', label: 'Voice call', icon: <PhoneIcon />, run: pick(() => onCall('voice')) },
          { key: 'video', label: 'Video call', icon: <VideoIcon />, run: pick(() => onCall('video')) },
        ]
      : []),
    ...(info ? [{ key: 'info', label: 'Contact info', icon: <PersonIcon />, on: info.open, run: pick(info.onToggle) }] : []),
    ...(more
      ? [
          {
            key: 'more',
            label: 'More options',
            icon: <MoreIcon />,
            on: !!moreAnchor,
            run: (e: MouseEvent<HTMLButtonElement>) => setMoreAnchor(moreAnchor ? null : e.currentTarget),
          },
        ]
      : []),
  ];
  return (
    <div ref={root} className={`chat-fab${shown ? '' : ' is-hidden'}${open ? ' is-open' : ''}`} aria-hidden={shown ? undefined : true}>
      <button
        type="button"
        className="chat-fab-toggle"
        aria-label={open ? 'Close chat actions' : 'Chat actions'}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setMoreAnchor(null);
        }}
      >
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="chat-fab-menu" role="toolbar" aria-label="Chat actions" aria-orientation="vertical">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`chat-fab-btn${a.on ? ' is-on' : ''}`}
              aria-label={a.label}
              title={a.label}
              onClick={a.run}
              {...(a.key === 'more' ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': !!moreAnchor } : {})}
            >
              {a.icon}
              {!!a.count && <span className="toolbar-count">{a.count}</span>}
            </button>
          ))}
        </div>
      )}
      {more && moreAnchor && (
        <ChatMoreMenu
          state={more.state}
          anchor={moreAnchor}
          onAction={(a) => {
            setMoreAnchor(null);
            setOpen(false);
            more.onAction(a);
          }}
          onClose={() => {
            setMoreAnchor(null);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Text with the parts matching `query` marked (case-insensitive). */
export function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let at = 0;
  for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, at)) {
    if (i > at) out.push(text.slice(at, i));
    out.push(<mark key={i}>{text.slice(i, i + q.length)}</mark>);
    at = i + q.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

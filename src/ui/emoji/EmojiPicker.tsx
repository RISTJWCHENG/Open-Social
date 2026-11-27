/**
 * Emoji panel above the message box: category tabs, search, recently used,
 * and every emoji by category; bottom tabs switch between emoji, GIFs and
 * stickers. Emoji are shown in the device's own emoji font (flags through a
 * bundled font where the system has none). Data loads on first open.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { SearchIcon } from '../icons';
import {
  ActivityIcon,
  FlagsIcon,
  FoodIcon,
  NatureIcon,
  ObjectsIcon,
  RecentIcon,
  SmileysIcon,
  StickerTabIcon,
  SymbolsIcon,
  TravelIcon,
} from './categoryIcons';

/** [emoji, name, keywords, category, flag code] as built by scripts/emoji/build-emoji-data.mjs. */
type EmojiRow = [string, string, string, number, string?];

const CATEGORIES: { label: string; icon: ReactElement }[] = [
  { label: 'Smileys & people', icon: <SmileysIcon /> },
  { label: 'Animals & nature', icon: <NatureIcon /> },
  { label: 'Food & drink', icon: <FoodIcon /> },
  { label: 'Activity', icon: <ActivityIcon /> },
  { label: 'Travel & places', icon: <TravelIcon /> },
  { label: 'Objects', icon: <ObjectsIcon /> },
  { label: 'Symbols', icon: <SymbolsIcon /> },
  { label: 'Flags', icon: <FlagsIcon /> },
];

let cached: Promise<EmojiRow[]> | null = null;
const loadEmoji = () => (cached ??= import('./emojiData.json').then((m) => m.default as unknown as EmojiRow[]));

type Tab = 'emoji' | 'gif' | 'stickers';

interface Props {
  /** Recently used emoji, most recent first. */
  recent: string[];
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Element that toggles the panel (clicks on it aren't "outside"). */
  anchor?: HTMLElement | null;
  /** Emoji only: no GIF and sticker tabs (for reactions). */
  emojiOnly?: boolean;
}

export function EmojiPicker({ recent, onPick, onClose, anchor, emojiOnly = false }: Props) {
  const [rows, setRows] = useState<EmojiRow[] | null>(null);
  const [tab, setTab] = useState<Tab>('emoji');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number>(recent.length ? -1 : 0);
  const panel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sections = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    let alive = true;
    void loadEmoji().then((r) => alive && setRows(r));
    return () => {
      alive = false;
    };
  }, []);

  // Close on Escape or a click outside the panel and its button.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchor]);

  const byCategory = useMemo(() => {
    const groups: EmojiRow[][] = CATEGORIES.map(() => []);
    for (const r of rows ?? []) groups[r[3]]?.push(r);
    return groups;
  }, [rows]);

  const results = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length || !rows) return null;
    return rows.filter((r) => {
      const hay = `${r[1]} ${r[2]}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [query, rows]);

  const info = useMemo(() => new Map((rows ?? []).map((r) => [r[0], r])), [rows]);

  const jump = (cat: number) => {
    setQuery('');
    setActive(cat);
    const el = sections.current.get(cat);
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - scroller.current.offsetTop;
  };

  // Highlight the category being scrolled through.
  const onScroll = () => {
    const sc = scroller.current;
    if (!sc || results) return;
    let current = recent.length ? -1 : 0;
    for (const [cat, el] of [...sections.current.entries()].sort((a, b) => a[0] - b[0])) {
      if (el.offsetTop - sc.offsetTop <= sc.scrollTop + 8) current = cat;
    }
    setActive(current);
  };

  const cell = (e: string) => {
    const row = info.get(e);
    const name = row?.[1] ?? e;
    const code = row?.[4];
    // Flags show their country code under the flag; the full name is the label.
    return (
      <button
        key={e}
        type="button"
        className={code ? 'emoji-cell emoji-flag' : 'emoji-cell'}
        onClick={() => onPick(e)}
        aria-label={code ? `Flag: ${name}` : name}
        title={code ? `${name} (${code})` : name}
      >
        <span className="emoji-glyph">{e}</span>
        {code && <span className="emoji-code">{code}</span>}
      </button>
    );
  };

  return (
    <div
      className={`emoji-panel${emojiOnly ? ' is-emoji-only' : ''}`}
      role="dialog"
      aria-label={emojiOnly ? 'Emoji' : 'Emoji, GIFs and stickers'}
      ref={panel}
    >
      {tab === 'emoji' && (
        <>
          <div className="emoji-cats" role="tablist" aria-label="Emoji categories">
            {recent.length > 0 && (
              <button
                type="button"
                role="tab"
                aria-selected={active === -1 && !results}
                className="emoji-cat"
                aria-label="Recent"
                title="Recent"
                onClick={() => jump(-1)}
              >
                <RecentIcon />
              </button>
            )}
            {CATEGORIES.map((c, i) => (
              <button
                key={c.label}
                type="button"
                role="tab"
                aria-selected={active === i && !results}
                className="emoji-cat"
                aria-label={c.label}
                title={c.label}
                onClick={() => jump(i)}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <label className="emoji-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search emoji"
              aria-label="Search emoji"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="emoji-scroll" ref={scroller} onScroll={onScroll}>
            {!rows ? (
              <p className="emoji-note">Loading…</p>
            ) : results ? (
              results.length ? (
                <section aria-label="Search results">
                  <h3 className="emoji-heading">Search results</h3>
                  <div className="emoji-grid">{results.map((r) => cell(r[0]))}</div>
                </section>
              ) : (
                <p className="emoji-note">No emoji found</p>
              )
            ) : (
              <>
                {recent.length > 0 && (
                  <section
                    aria-label="Recent"
                    ref={(el) => {
                      if (el) sections.current.set(-1, el);
                    }}
                  >
                    <h3 className="emoji-heading">Recent</h3>
                    <div className="emoji-grid">{recent.map((e) => cell(e))}</div>
                  </section>
                )}
                {CATEGORIES.map((c, i) => (
                  <section
                    key={c.label}
                    aria-label={c.label}
                    ref={(el) => {
                      if (el) sections.current.set(i, el);
                    }}
                  >
                    <h3 className="emoji-heading">{c.label}</h3>
                    <div className="emoji-grid">{byCategory[i]!.map((r) => cell(r[0]))}</div>
                  </section>
                ))}
              </>
            )}
          </div>
        </>
      )}
      {tab === 'gif' && (
        <div className="emoji-soon">
          <p className="emoji-soon-title">GIFs are coming soon</p>
          <p>
            GIF search runs through a GIF service, which would see what you search for. OpenSocial will add it in a way
            that keeps your searches private.
          </p>
        </div>
      )}
      {tab === 'stickers' && (
        <div className="emoji-soon">
          <p className="emoji-soon-title">Stickers are coming soon</p>
          <p>Sticker packs, and stickers made from your own photos, will appear here.</p>
        </div>
      )}
      {!emojiOnly && (
        <div className="emoji-bottom" role="tablist" aria-label="Emoji, GIFs or stickers">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'emoji'}
            aria-label="Emoji"
            onClick={() => setTab('emoji')}
          >
            <SmileysIcon />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'gif'}
            aria-label="GIFs"
            onClick={() => setTab('gif')}
          >
            <span className="emoji-gif-label">GIF</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'stickers'}
            aria-label="Stickers"
            onClick={() => setTab('stickers')}
          >
            <StickerTabIcon />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Emoji reactions to a message: the quick row to add or take back one (in
 * the message's menu, and from the 😊 button beside a message on computers),
 * the full emoji panel opened from the row's grey 😊, and the row under the
 * message showing every reaction with its count. Each person can add several
 * different emoji to one message.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EmojiPicker } from './emoji/EmojiPicker';
import { SmileIcon } from './icons';

/** Quick reactions shown until enough have been used. */
export const DEFAULT_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'] as const;
/** How many quick reactions the row shows beside the grey 😊. */
export const QUICK_COUNT = 5;
/** How many recently used reactions are kept. */
export const RECENT_REACTIONS_MAX = 36;

/** The quick row's emoji: the most recently used reactions, topped up with the defaults. */
export function quickReactions(recent: readonly string[]): string[] {
  const out = recent.slice(0, QUICK_COUNT);
  for (const e of DEFAULT_REACTIONS) if (out.length < QUICK_COUNT && !out.includes(e)) out.push(e);
  return out;
}

/** The recent list after using `emoji`, most recent first. */
export function withRecentReaction(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_REACTIONS_MAX);
}

/** The grey 😊 (every emoji) followed by the recent reactions; ours are marked, and picking one of ours takes it back. */
export function ReactionRow({
  recent = [],
  mine = [],
  onToggle,
  onMore,
}: {
  recent?: readonly string[];
  mine?: string[];
  onToggle: (emoji: string, on: boolean) => void;
  /** Opens every emoji; `anchor` is the grey 😊 button. */
  onMore?: (anchor: HTMLElement) => void;
}) {
  return (
    <div className="reaction-row" role="group" aria-label="React">
      {onMore && (
        <button
          type="button"
          className="reaction-choice reaction-more"
          aria-label="More reactions"
          title="More reactions"
          aria-haspopup="dialog"
          onClick={(e) => onMore(e.currentTarget)}
        >
          <SmileIcon />
        </button>
      )}
      {quickReactions(recent).map((e) => {
        const on = mine.includes(e);
        return (
          <button
            key={e}
            type="button"
            className={`reaction-choice${on ? ' is-on' : ''}`}
            aria-pressed={on}
            aria-label={on ? `Remove reaction ${e}` : `React ${e}`}
            onClick={() => onToggle(e, !on)}
          >
            {e}
          </button>
        );
      })}
    </div>
  );
}

/** The quick row in a small bubble beside the 😊 button; a click elsewhere or Escape closes it. */
export function ReactionPicker({
  recent,
  mine,
  onToggle,
  onMore,
  onClose,
}: {
  recent?: readonly string[];
  mine?: string[];
  onToggle: (emoji: string, on: boolean) => void;
  onMore?: (anchor: HTMLElement) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="reaction-picker" ref={ref}>
      <ReactionRow
        recent={recent}
        mine={mine}
        onToggle={(e, on) => {
          onToggle(e, on);
          onClose();
        }}
        onMore={
          onMore &&
          ((button) => {
            onMore(button);
            onClose();
          })
        }
      />
    </div>
  );
}

const GAP = 8;

/**
 * Every emoji, in a panel floating beside `anchor` (the same panel as the
 * message box's, without GIFs and stickers). Picking one of ours takes it back.
 */
export function ReactionEmojiPanel({
  anchor,
  recent,
  mine = [],
  onToggle,
  onClose,
}: {
  anchor: HTMLElement;
  recent: readonly string[];
  mine?: string[];
  onToggle: (emoji: string, on: boolean) => void;
  onClose: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const panel = holder.current?.firstElementChild as HTMLElement | null;
    if (!panel) return;
    const a = anchor.getBoundingClientRect();
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Below the anchor when it fits, else above, else as low as the window allows.
    let top = a.bottom + GAP;
    if (top + h > vh - GAP) top = a.top - GAP - h >= GAP ? a.top - GAP - h : Math.max(GAP, vh - GAP - h);
    const left = Math.min(Math.max(GAP, a.left + a.width / 2 - w / 2), vw - GAP - w);
    setPos({ left, top });
  }, [anchor]);
  return createPortal(
    <div
      ref={holder}
      className="reaction-emoji-holder"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <EmojiPicker
        emojiOnly
        recent={[...recent]}
        anchor={anchor}
        onClose={onClose}
        onPick={(e) => {
          onToggle(e, !mine.includes(e));
          onClose();
        }}
      />
    </div>,
    document.body,
  );
}

/** Every reaction on a message, once per emoji with how many added it; tapping one adds or takes back ours. */
export function ReactionBadge({
  reactions,
  theirName,
  onToggle,
}: {
  reactions: { me?: string[]; them?: string[] };
  theirName: string;
  onToggle: (emoji: string, on: boolean) => void;
}) {
  const me = reactions.me ?? [];
  const them = reactions.them ?? [];
  const all = [...new Set([...them, ...me])];
  return (
    <div className="bubble-reactions">
      {all.map((e) => {
        const mine = me.includes(e);
        const theirs = them.includes(e);
        const who = [mine ? 'You' : '', theirs ? theirName : ''].filter(Boolean).join(' and ');
        return (
          <button
            key={e}
            type="button"
            className={`reaction-chip${mine ? ' is-mine' : ''}`}
            title={`${who} reacted ${e}`}
            aria-label={`${e}, ${who}; ${mine ? 'remove yours' : 'add yours'}`}
            aria-pressed={mine}
            onClick={() => onToggle(e, !mine)}
          >
            {e}
            {mine && theirs && <span className="reaction-count">2</span>}
          </button>
        );
      })}
    </div>
  );
}

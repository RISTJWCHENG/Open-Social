/**
 * The right panel showing a chat's highlighted messages instead of the profile
 * (same panel, same width), in chat order with the newest at the bottom.
 * Each shows the same bubble as in the chat (playable voice, photo and video
 * previews, file cards, text) under a line with the sender's photo, name and
 * when. Choosing one shows it in the chat; each highlight can be removed.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import type { RealMessage } from '../core/delivery/realMessaging';
import { Avatar } from './Avatar';
import { CloseIcon, StarIcon } from './icons';

interface Person {
  name: string;
  avatar?: string;
  /** Picks the avatar colours (the account id). */
  seed?: string;
}

interface Props {
  me: Person;
  them: Person;
  messages: RealMessage[];
  /** The message's file, rendered as in the chat. */
  renderAttachment: (m: RealMessage) => ReactNode;
  onJump: (messageId: string) => void;
  onRemove: (messageId: string) => void;
  /** The panel's top bar (collapse and view switcher). */
  bar: ReactNode;
}

const when = (ts: number) =>
  new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function HighlightsPanel({ me, them, messages, renderAttachment, onJump, onRemove, bar }: Props) {
  const list = useRef<HTMLUListElement>(null);
  // Like the chat: start at the newest (bottom).
  useEffect(() => {
    list.current?.scrollTo?.({ top: list.current.scrollHeight });
  }, [messages.length]);

  return (
    <aside className="profile-panel highlights-panel" aria-label="Highlighted messages">
      {bar}
      {messages.length === 0 ? (
        <div className="highlights-empty">
          <StarIcon />
          <p>No highlighted messages</p>
          <span>Highlight a message from its menu to keep it here.</span>
        </div>
      ) : (
        <ul className="highlights-list" ref={list}>
          {messages.map((m) => {
            const who = m.direction === 'out' ? me : them;
            return (
              <li key={m.id} className={`highlights-item ${m.direction}`}>
                {/* Friend: photo, name, date. Ours, mirrored: date, name, photo. */}
                <div className="highlights-meta">
                  <Avatar name={who.name} className="highlights-avatar" seed={who.seed} src={who.avatar} />
                  <strong>{who.name}</strong>
                  <time dateTime={new Date(m.sentAt).toISOString()}>{when(m.sentAt)}</time>
                  <button
                    type="button"
                    className="highlights-jump"
                    onClick={() => onJump(m.id)}
                    aria-label="Show in chat"
                    title="Show in chat"
                  >
                    Show in chat
                  </button>
                  <button
                    type="button"
                    className="highlights-remove"
                    aria-label="Remove highlight"
                    title="Remove highlight"
                    onClick={() => onRemove(m.id)}
                  >
                    <CloseIcon />
                  </button>
                </div>
                <div className={`message ${m.direction}`}>
                  <div
                    className={`bubble ${m.attachment ? 'has-attachment' : ''} ${m.attachment?.voice ? 'has-voice' : ''}`}
                  >
                    {renderAttachment(m)}
                    {m.body && <p className="bubble-text">{m.body}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

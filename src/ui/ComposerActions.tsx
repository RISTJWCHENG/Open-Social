/**
 * Right end of the message box: the send button while there is text to send;
 * otherwise a "more" button (⋮) that opens Send Crypto (coming soon).
 */
import { useEffect, useRef, useState } from 'react';
import { BitcoinIcon, MoreVerticalIcon, SendIcon } from './icons';

interface Props {
  /** The draft has text: show the send button. */
  hasText: boolean;
  /** Messaging not ready yet. */
  disabled?: boolean;
}

export function ComposerActions({ hasText, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Typing replaces the more button with send: close the menu with it.
  useEffect(() => {
    if (hasText) setOpen(false);
  }, [hasText]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hasText) {
    return (
      <button type="submit" className="send-btn appear" aria-label="Send encrypted" aria-disabled={disabled}>
        <SendIcon />
      </button>
    );
  }

  return (
    <div className="composer-more" ref={ref}>
      <button
        type="button"
        className="ghost-btn composer-tool more-btn appear"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVerticalIcon />
      </button>
      {open && (
        <div className="composer-menu" role="menu" aria-label="More options">
          <button
            type="button"
            role="menuitem"
            className="composer-menu-item"
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
            title="Coming soon"
          >
            <span className="composer-menu-icon" aria-hidden="true">
              <BitcoinIcon />
            </span>
            <span className="composer-menu-label">Send Crypto</span>
            <span className="soon">Soon</span>
          </button>
        </div>
      )}
    </div>
  );
}

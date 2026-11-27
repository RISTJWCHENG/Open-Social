/**
 * A message's text. When the chat is translated, an incoming message shows
 * its translation with a line underneath to switch back to the original.
 * A text of one to three emoji alone is shown large. Web addresses are links
 * that open in a new tab.
 */
import { useState, type ReactNode } from 'react';
import { inAppHash, linkParts } from '../core/delivery/linkPreview';
import type { RealMessage } from '../core/delivery/realMessaging';
import { languageName } from '../core/translate/onDeviceTranslation';
import { highlight } from './ChatToolbar';
import { jumboEmojiCount } from './jumboEmoji';
import type { ChatTranslation } from './useChatTranslation';

interface Props {
  m: RealMessage;
  translation: ChatTranslation;
  /** Search query to mark in the text ('' for none). */
  search: string;
}

export function MessageText({ m, translation, search }: Props) {
  const [original, setOriginal] = useState(false);
  const t = m.direction === 'in' ? translation.of(m.id) : undefined;
  const translated = t?.kind === 'done' && !original;
  const text = translated ? t.text : m.body;
  const jumbo = m.attachment ? 0 : jumboEmojiCount(text);

  let note = null;
  if (t?.kind === 'done') {
    note = (
      <button type="button" className="bubble-translation" onClick={() => setOriginal((o) => !o)}>
        {original ? 'Show translation' : `Translated from ${languageName(t.from)} · Show original`}
      </button>
    );
  } else if (t?.kind === 'pending') {
    note = <span className="bubble-translation is-quiet">Translating…</span>;
  } else if (t?.kind === 'needs-download') {
    note = <span className="bubble-translation is-quiet">Waiting for a one-time language download</span>;
  } else if (t?.kind === 'unsupported') {
    note = (
      <span className="bubble-translation is-quiet">
        {t.from ? `This browser can’t translate ${languageName(t.from)}` : 'This browser can’t translate'}
      </span>
    );
  } else if (t?.kind === 'error') {
    note = <span className="bubble-translation is-quiet">Couldn’t translate this message</span>;
  }

  return (
    <>
      <p className={jumbo ? `bubble-text is-jumbo jumbo-${jumbo}` : 'bubble-text'}>
        {withLinks(text, search)}
      </p>
      {note}
    </>
  );
}

/** The text with its web addresses as links (and the search query marked). */
function withLinks(text: string, search: string): ReactNode {
  const mark = (t: string) => (search ? highlight(t, search) : t);
  const parts = linkParts(text);
  if (!parts.some((p) => p.url)) return mark(text);
  return parts.map((p, i) =>
    p.url ? (
      <a
        key={i}
        className="bubble-link"
        href={p.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          const route = inAppHash(p.url!);
          if (!route) return;
          e.preventDefault();
          location.hash = route;
        }}
      >
        {mark(p.text)}
      </a>
    ) : (
      <span key={i}>{mark(p.text)}</span>
    ),
  );
}

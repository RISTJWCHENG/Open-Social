/**
 * News in the left column: HashFirst Global's sections, one under another.
 * Choosing one changes the right column (its stories, prices or indexes)
 * and what the main area shows. On a phone the section's list follows the
 * sections here, since there is no right column.
 */
import type { ReactNode } from 'react';
import { SECTIONS, type NewsSection } from '../core/news/hashfirst';

interface Props {
  section: NewsSection;
  onSection(section: NewsSection): void;
  /** The section's list, shown here on a phone. */
  children: ReactNode;
}

export function NewsPanel({ section, onSection, children }: Props) {
  return (
    <section className="chat-list news-panel" aria-label="News">
      <nav className="news-sections" aria-label="HashFirst Global sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`news-section${s.id === section ? ' active' : ''}`}
            aria-current={s.id === section ? 'page' : undefined}
            style={{ '--section-accent': s.accent } as React.CSSProperties}
            onClick={() => onSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="news-inline">{children}</div>
    </section>
  );
}

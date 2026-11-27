/**
 * A news story in the main area, laid out like the story on the news site:
 * protocol and source, headline, standfirst, byline, actions, cover and the
 * full text. The text and cover come through the identity canister, so the
 * news site never sees the reader.
 */
import { useEffect, useRef, useState } from 'react';
import { NEWS_SITE, protocolColor, type NewsItem } from '../core/news/news';
import { sectionInfo } from '../core/news/hashfirst';
import { PopoverMenu } from './PopoverMenu';
import { Avatar } from './Avatar';
import { readingMinutes } from './sanitizeArticle';
import { BackIcon, ExternalLinkIcon, NewsIcon, ShareIcon } from './icons';

export interface ShareTarget {
  account: string;
  name: string;
  avatar?: string;
}

interface Props {
  item: NewsItem | null;
  /** Chats to share to, most recent first. */
  chats: ShareTarget[];
  /** The story's full text as safe HTML. */
  loadBody(id: string): Promise<string>;
  /** The story's full-size cover (an object URL), if it has one. */
  loadCover(id: string): Promise<string | undefined>;
  onShare(account: string, item: NewsItem): void;
  onBack(): void;
}

/** "Nov 26, 2026, 05:12 UTC", as the news site shows times. */
export function newsDateTime(at: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}

type Body = { id: string; html?: string; failed?: boolean };

export function NewsArticle({ item, chats, loadBody, loadCover, onShare, onBack }: Props) {
  const [shareMenu, setShareMenu] = useState<HTMLElement | null>(null);
  const [body, setBody] = useState<Body | null>(null);
  const [cover, setCover] = useState<{ id: string; url?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scroller = useRef<HTMLElement>(null);
  const id = item?.id;

  useEffect(() => {
    if (!id) return;
    let live = true;
    setBody({ id });
    if (scroller.current) scroller.current.scrollTop = 0;
    loadBody(id).then(
      (html) => live && setBody({ id, html }),
      () => live && setBody({ id, failed: true }),
    );
    void loadCover(id).then((url) => live && setCover({ id, url }));
    return () => {
      live = false;
    };
  }, [id, attempt, loadBody, loadCover]);

  if (!item) {
    return (
      <main className="chat-main chat-empty" aria-label="No story open">
        <div className="chat-empty-inner">
          <NewsIcon />
          <h2>Choose a story</h2>
          <p>Pick a story on the left to read it here, then share it to a chat.</p>
        </div>
      </main>
    );
  }

  const html = body?.id === item.id ? body.html : undefined;
  const failed = body?.id === item.id && body.failed;
  const coverSrc = (cover?.id === item.id && cover.url) || item.thumb;

  return (
    <main className="chat-main news-article" aria-label={item.title} ref={scroller}>
      <header className="news-article-bar">
        <button type="button" className="hdr-btn back" onClick={onBack} aria-label="Back to news">
          <BackIcon />
        </button>
        <span className="news-article-site">{NEWS_SITE}</span>
      </header>
      <div className="news-article-body">
        <p className="news-meta">
          {item.protocol && (
            <span
              className="news-badge"
              style={{
                background:
                  (item.section ?? 'ecosystem') === 'ecosystem'
                    ? protocolColor(item.protocol)
                    : `color-mix(in srgb, ${sectionInfo(item.section!).accent} 30%, #ffffff)`,
              }}
            >
              {item.protocol}
            </span>
          )}
          {item.source && <span className="news-source">{item.source}</span>}
        </p>
        <h1 className="news-article-title">{item.title}</h1>
        {item.summary && <p className="news-dek">{item.summary}</p>}
        <p className="news-byline">
          <span>By HashFirstGlobal {sectionInfo(item.section ?? 'ecosystem').name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(item.publishedAt).toISOString()}>{newsDateTime(item.publishedAt)}</time>
        </p>
        <div className="news-actions">
          {html && <span className="news-reading">{readingMinutes(html)} min read</span>}
          <span className="news-actions-end">
            <button
              type="button"
              className="news-action"
              disabled={!chats.length}
              title={chats.length ? 'Share to a chat' : 'Start a chat first'}
              aria-haspopup="menu"
              aria-expanded={!!shareMenu}
              onClick={(e) => setShareMenu(shareMenu ? null : e.currentTarget)}
            >
              <ShareIcon />
              Share to chat
            </button>
            <a className="news-action" href={item.url} target="_blank" rel="noopener noreferrer">
              Read on {NEWS_SITE}
              <ExternalLinkIcon />
            </a>
          </span>
          {shareMenu && (
            <PopoverMenu
              label="Share to"
              anchor={shareMenu}
              onClose={() => setShareMenu(null)}
              items={chats.slice(0, 8).map((c) => ({
                label: c.name,
                icon: <Avatar name={c.name} src={c.avatar} seed={c.account} className="avatar-24" />,
                onSelect: () => onShare(c.account, item),
              }))}
            />
          )}
        </div>
        {coverSrc && (
          <figure className="news-figure">
            <img className="news-cover" src={coverSrc} alt="" />
          </figure>
        )}
        {html ? (
          <article className="news-text" dangerouslySetInnerHTML={{ __html: html }} />
        ) : html === '' ? (
          <p className="news-text-status">
            {item.section === 'video' ? 'This is a video.' : 'The full text of this story is on the news site.'}{' '}
            <a className="link-btn" href={item.url} target="_blank" rel="noopener noreferrer">
              {item.section === 'video' ? 'Watch it on' : 'Read it on'} {NEWS_SITE}
            </a>
          </p>
        ) : failed ? (
          <p className="news-text-status" role="status">
            The full story could not be loaded.{' '}
            <button type="button" className="link-btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </p>
        ) : (
          <p className="news-text-status" role="status" aria-busy="true">
            Loading the story…
          </p>
        )}
        <footer className="news-article-foot">
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            Read the original on {NEWS_SITE}
            <ExternalLinkIcon />
          </a>
        </footer>
      </div>
    </main>
  );
}

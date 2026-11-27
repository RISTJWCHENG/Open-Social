/**
 * HOME: HashFirst Global's front page across the main area and the right
 * column, laid out like the site's home: Latest Global News | Highlights |
 * Latest Opinions, Ecosystems and Videos. Choosing a story opens it in its
 * section. Covers come through the canister, like everything else.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sectionInfo } from '../core/news/hashfirst';
import { newsRelative, protocolColor, type NewsItem } from '../core/news/news';

interface Props {
  stories: NewsItem[];
  /** The ecosystem feed (has protocols and covers). */
  ecosystem: NewsItem[];
  loading: boolean;
  loadCover(id: string): Promise<string | undefined>;
  onOpen(item: NewsItem): void;
  onSection(section: 'news' | 'opinion' | 'ecosystem' | 'video'): void;
}

const ROTATION_MS = 8_000;
const FADE_MS = 220;
const HOUR = 3_600_000;

/** "3 hrs 5 min ago", or the date after a week, as the site's home shows times. */
function homeAge(at: number, now: number): string {
  if (now - at >= 7 * 24 * HOUR)
    return new Date(at).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return newsRelative(at, now);
}

function Time({ at, now }: { at: number; now: number }) {
  return (
    <time className={`home-time${now - at < HOUR ? ' is-fresh' : ''}`} dateTime={new Date(at).toISOString()}>
      {homeAge(at, now)}
    </time>
  );
}

function SectionHead({ title, link, onLink }: { title: string; link?: string; onLink?(): void }) {
  return (
    <div className="home-head">
      <h2>{title}</h2>
      {link && onLink && (
        <button type="button" className="home-head-link" onClick={onLink}>
          {link}
          <svg viewBox="0 0 20 14" width="14" height="10" fill="none" aria-hidden="true">
            <path
              d="M1 7h17m-5-5 5 5-5 5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/** A cover from the canister for each of these stories (object URLs, as they arrive). */
function useCovers(ids: string[], loadCover: (id: string) => Promise<string | undefined>) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  const key = ids.join('|');
  useEffect(() => {
    let live = true;
    for (const id of ids)
      void loadCover(id).then((url) => {
        if (live && url) setCovers((c) => (c[id] === url ? c : { ...c, [id]: url }));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadCover]);
  return covers;
}

/** Three stories, mixed from the top two of News, Opinion and Ecosystem, avoiding the last set. */
function pickHighlights(pool: NewsItem[], previous: NewsItem[]): NewsItem[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const fresh = shuffled.filter((i) => !previous.some((p) => p.id === i.id));
  return [...fresh, ...shuffled.filter((i) => !fresh.includes(i))].slice(0, 3);
}

export function NewsHome({ stories, ecosystem, loading, loadCover, onOpen, onSection }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const of = useCallback((section: string) => stories.filter((s) => s.section === section), [stories]);
  const news = useMemo(() => of('news').slice(0, 9), [of]);
  const opinions = useMemo(() => of('opinion').slice(0, 3), [of]);
  const eco = useMemo(() => (ecosystem.length ? ecosystem : of('ecosystem')).slice(0, 5), [ecosystem, of]);
  const videos = useMemo(() => of('video').slice(0, 3), [of]);
  const pool = useMemo(
    () => [...of('news').slice(0, 2), ...of('opinion').slice(0, 2), ...of('ecosystem').slice(0, 2)],
    [of],
  );

  const [selected, setSelected] = useState<NewsItem[]>([]);
  const [fading, setFading] = useState(false);
  const last = useRef<NewsItem[]>([]);
  useEffect(() => {
    last.current = pool.slice(0, 3);
    setSelected(pool.slice(0, 3));
  }, [pool]);
  const rotate = useCallback(() => {
    if (pool.length < 2) return;
    setFading(true);
    setTimeout(() => {
      last.current = pickHighlights(pool, last.current);
      setSelected(last.current);
      setFading(false);
    }, FADE_MS);
  }, [pool]);
  useEffect(() => {
    const t = setInterval(rotate, ROTATION_MS);
    return () => clearInterval(t);
  }, [rotate]);

  const covers = useCovers([...pool.map((i) => i.id), ...videos.slice(0, 1).map((v) => v.id)], loadCover);
  const coverOf = (i: NewsItem) => covers[i.id] ?? i.thumb;
  const label = (i: NewsItem) => sectionInfo(i.section ?? 'ecosystem').name;
  const [hero, ...cards] = selected;

  if (!stories.length) {
    return (
      <main className="chat-main chat-empty" aria-label="Home">
        <div className="chat-empty-inner">
          <h2>{loading ? 'Loading HashFirst Global…' : 'Nothing to show yet'}</h2>
        </div>
      </main>
    );
  }

  return (
    <main className="chat-main news-home" aria-label="HashFirst Global home">
      <div className="home-grid">
        <section className="home-col" aria-label="Latest Global News">
          <SectionHead title="Latest Global News" link="News Archive" onLink={() => onSection('news')} />
          {news.map((a) => (
            <article key={a.id} className="home-item">
              <Time at={a.publishedAt} now={now} />
              <button type="button" className="home-title" onClick={() => onOpen(a)}>
                {a.title}
              </button>
              {a.summary && <p className="home-dek">{a.summary}</p>}
            </article>
          ))}
        </section>

        <span className="home-rule" aria-hidden="true" />

        <section className="home-col" aria-label="Highlights">
          <div className="home-head">
            <h2>Highlights</h2>
            <button
              type="button"
              className="home-head-link"
              onClick={rotate}
              disabled={pool.length < 2 || fading}
              aria-label="Refresh Highlights"
            >
              Refresh
              <svg
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={fading ? 'is-spinning' : ''}
                aria-hidden="true"
              >
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
            </button>
          </div>
          <p className="home-note">
            3 stories randomly assembled from the top 2 in Latest Crypto News, Opinion and Ecosystem.
          </p>
          <div className={`home-highlights${fading ? ' is-fading' : ''}`}>
            {hero && (
              <article className="home-hero">
                <button type="button" className="home-card-link" onClick={() => onOpen(hero)}>
                  {coverOf(hero) ? (
                    <img className="home-hero-img" src={coverOf(hero)} alt="" />
                  ) : (
                    <span className="home-hero-img is-empty" />
                  )}
                  <span className="home-kicker">
                    {label(hero)}
                    {hero.protocol && <> · {hero.protocol}</>}
                  </span>
                  <span className="home-hero-title">{hero.title}</span>
                  {hero.summary && <span className="home-hero-dek">{hero.summary}</span>}
                  <Time at={hero.publishedAt} now={now} />
                </button>
              </article>
            )}
            <div className="home-cards">
              {cards.map((a) => (
                <article key={a.id} className="home-card">
                  <button type="button" className="home-card-link" onClick={() => onOpen(a)}>
                    {coverOf(a) ? (
                      <img className="home-card-img" src={coverOf(a)} alt="" />
                    ) : (
                      <span className="home-card-img is-empty" />
                    )}
                    <span className="home-kicker">
                      {label(a)}
                      {a.protocol && <> · {a.protocol}</>}
                    </span>
                    <span className="home-card-title">{a.title}</span>
                    {a.summary && <span className="home-card-dek">{a.summary}</span>}
                    <Time at={a.publishedAt} now={now} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <span className="home-rule" aria-hidden="true" />

        <section className="home-col" aria-label="Latest Opinions, Ecosystems and Videos">
          <SectionHead title="Latest Opinions" link="Opinion" onLink={() => onSection('opinion')} />
          {opinions.map((a) => (
            <article key={a.id} className="home-item">
              <Time at={a.publishedAt} now={now} />
              <button type="button" className="home-title" onClick={() => onOpen(a)}>
                {a.title}
              </button>
              <span className="home-byline">By HashFirstGlobal Opinion</span>
            </article>
          ))}

          <div className="home-block">
            <SectionHead title="Latest Ecosystems" link="Ecosystem" onLink={() => onSection('ecosystem')} />
            {eco.map((a) => (
              <article key={a.id} className="home-item is-compact">
                {a.protocol && (
                  <span className="news-badge" style={{ background: protocolColor(a.protocol) }}>
                    {a.protocol}
                  </span>
                )}
                <button type="button" className="home-title is-small" onClick={() => onOpen(a)}>
                  {a.title}
                </button>
                <Time at={a.publishedAt} now={now} />
              </article>
            ))}
          </div>

          {videos.length > 0 && (
            <div className="home-block">
              <SectionHead title="Latest Videos" link="Video" onLink={() => onSection('video')} />
              {videos.map((v, i) => (
                <article key={v.id} className="home-item is-compact">
                  {i === 0 && coverOf(v) && (
                    <button type="button" className="home-card-link" onClick={() => onOpen(v)} tabIndex={-1}>
                      <img className="home-video-img" src={coverOf(v)} alt="" />
                    </button>
                  )}
                  <button type="button" className="home-title is-small" onClick={() => onOpen(v)}>
                    {v.title}
                  </button>
                  <Time at={v.publishedAt} now={now} />
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

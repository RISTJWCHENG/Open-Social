/**
 * A HashFirst Global story list, set like the lists on the site: List /
 * Protocol (or Category, or Section on Home) / Period / Search controls over
 * the stories, each with its time (UTC and how long ago), badge, serif title
 * and byline. Choosing one shows it in the main area.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  filterNews,
  newsAgeColor,
  newsDateTimeUTC,
  newsInPeriod,
  NEWS_PERIODS,
  newsProtocols,
  newsRelative,
  protocolColor,
  utcDay,
  type NewsItem,
  type NewsPeriod,
} from '../core/news/news';
import { SECTIONS, SITE, sectionInfo, type StorySection } from '../core/news/hashfirst';
import type { NewsState } from './useNews';
import { PopoverMenu } from './PopoverMenu';
import { SearchIcon } from './icons';

interface Props {
  news: NewsState;
  selectedId: string | null;
  onSelect(item: NewsItem): void;
}

const HOUR = 3_600_000;

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 20 20" fill="none" className={`news-chevron${open ? ' is-open' : ''}`} aria-hidden="true">
    <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Arrow = () => (
  <svg viewBox="0 0 22 16" width="19" height="13" fill="none" className="news-arrow" aria-hidden="true">
    <path
      d="M1.5 8h16M14 4.5 17.5 8 14 11.5"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** "Nov 22" for a UTC day. */
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

type Menu = { kind: 'list' | 'protocol' | 'date'; anchor: HTMLElement } | null;

/** What the second filter groups by, and the foot link, per section. */
function sectionSetup(section: StorySection) {
  const info = sectionInfo(section);
  if (section === 'home')
    return {
      filter: 'Section',
      all: 'All Sections',
      key: (i: NewsItem) => sectionInfo(i.section ?? 'ecosystem').name,
      color: (k: string) => tint(SECTIONS.find((s) => s.name === k)?.accent),
      foot: { href: `${SITE}/`, label: 'Open HashFirst Global' },
    };
  if (section === 'ecosystem')
    return {
      filter: 'Protocol',
      all: 'All Protocols',
      key: (i: NewsItem) => i.protocol,
      color: protocolColor,
      foot: { href: `${SITE}/ecosystem/history`, label: 'Go To Ecosystem History Page' },
    };
  return {
    filter: 'Category',
    all: 'All Categories',
    key: (i: NewsItem) => i.protocol,
    color: () => tint(info.accent),
    foot:
      section === 'news'
        ? { href: `${SITE}/news/en/history`, label: 'Go To News History Page' }
        : { href: info.href, label: `Open ${info.name} on HashFirst Global` },
  };
}

/** A light badge background from a section colour. */
const tint = (accent = '#8c8c8c') => `color-mix(in srgb, ${accent} 30%, #ffffff)`;

export function NewsList({
  news,
  selectedId,
  onSelect,
  section = 'ecosystem',
  className = '',
}: Props & { section?: StorySection; className?: string }) {
  const setup = sectionSetup(section);
  const sectionName = sectionInfo(section).name;
  const [period, setPeriod] = useState<NewsPeriod>('latest');
  const [protocol, setProtocol] = useState<string | undefined>(undefined);
  const [day, setDay] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<Menu>(null);
  const [now, setNow] = useState(() => Date.now());

  // Keep the "… ago" times current.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const protocols = useMemo(
    () => newsProtocols(news.items.map((i) => ({ ...i, protocol: setup.key(i) }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [news.items, section],
  );
  const days = useMemo(() => [...new Set(news.items.map((i) => utcDay(i.publishedAt)))], [news.items]);
  const shown = useMemo(() => {
    const listed = day
      ? news.items.filter((i) => utcDay(i.publishedAt) === day)
      : newsInPeriod(news.items, period, now);
    return filterNews(
      listed.filter((i) => !protocol || setup.key(i) === protocol),
      undefined,
      query,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [news.items, period, day, protocol, query, now, section]);

  const open = (kind: 'list' | 'protocol' | 'date') => (e: React.MouseEvent<HTMLButtonElement>) =>
    setMenu(menu?.kind === kind ? null : { kind, anchor: e.currentTarget });

  const dot = (color: string) => <span className="news-dot" style={{ background: color }} />;
  const none = <span className="news-dot is-empty" />;

  return (
    <section className={`news-stories ${className}`.trim()} aria-label={`${sectionName} stories`}>
      <div className="news-controls">
        <div className="news-control">
          <span className="news-label">List</span>
          <button
            type="button"
            className="news-select"
            aria-label="Choose list"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'list'}
            onClick={open('list')}
          >
            <span>{day ? 'All Articles' : NEWS_PERIODS[period]}</span>
            <Chevron open={menu?.kind === 'list'} />
          </button>
        </div>
        <div className="news-control">
          <span className="news-label">{setup.filter}</span>
          <button
            type="button"
            className="news-select"
            aria-label={`Choose ${setup.filter.toLowerCase()}`}
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'protocol'}
            onClick={open('protocol')}
          >
            <span>{protocol ?? setup.all}</span>
            <Chevron open={menu?.kind === 'protocol'} />
          </button>
        </div>
        <div className="news-control">
          <span className="news-label">Period</span>
          <button
            type="button"
            className="news-select"
            aria-label="Choose date"
            aria-haspopup="menu"
            aria-expanded={menu?.kind === 'date'}
            onClick={open('date')}
          >
            <span>{day ? dayLabel(day) : 'Date'}</span>
            <Chevron open={menu?.kind === 'date'} />
          </button>
        </div>
        <label className="news-control news-control-search">
          <span className="news-label">Search Title</span>
          <span className="news-search">
            <SearchIcon />
            <input
              type="search"
              placeholder={`Search ${sectionName.toLowerCase()} title...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
        </label>
      </div>

      {menu?.kind === 'list' && (
        <PopoverMenu
          label="List"
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={(Object.keys(NEWS_PERIODS) as NewsPeriod[]).map((p) => ({
            label: NEWS_PERIODS[p],
            icon: none,
            checked: !day && period === p,
            onSelect: () => {
              setPeriod(p);
              setDay(undefined);
            },
          }))}
        />
      )}
      {menu?.kind === 'protocol' && (
        <PopoverMenu
          label={setup.filter}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[undefined, ...protocols].map((p) => ({
            label: p ?? setup.all,
            icon: p ? dot(setup.color(p)) : none,
            checked: protocol === p,
            onSelect: () => setProtocol(p),
          }))}
        />
      )}
      {menu?.kind === 'date' && (
        <PopoverMenu
          label="Date"
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          items={[undefined, ...days].map((d) => ({
            label: d ? dayLabel(d) : 'Any date',
            icon: none,
            checked: day === d,
            onSelect: () => setDay(d),
          }))}
        />
      )}

      <div className="news-list" aria-busy={news.loading}>
        {shown.map((item) => {
          const current = item.id === selectedId;
          const fresh = now - item.publishedAt < HOUR;
          return (
            <article key={item.id} className="news-entry">
              <button
                type="button"
                className={`news-row${current ? ' active' : ''}`}
                aria-current={current ? 'true' : undefined}
                onClick={() => onSelect(item)}
              >
                <span
                  className={`news-time${fresh ? ' is-fresh' : ''}`}
                  style={fresh ? undefined : { color: newsAgeColor(item.publishedAt, now) }}
                >
                  <time dateTime={new Date(item.publishedAt).toISOString()}>{newsDateTimeUTC(item.publishedAt)}</time>
                  {' | '}
                  {newsRelative(item.publishedAt, now)}
                </span>
                {setup.key(item) && (
                  <span className="news-badges">
                    <span className="news-badge" style={{ background: setup.color(setup.key(item)!) }}>
                      {setup.key(item)}
                    </span>
                    {section === 'home' && item.protocol && (
                      <span className="news-badge" style={{ background: '#f1f1ef' }}>
                        {item.protocol}
                      </span>
                    )}
                  </span>
                )}
                <span className="news-row-title">{item.title}</span>
                <span className="news-by">
                  By <strong>HashFirstGlobal {sectionInfo(item.section ?? 'ecosystem').name}</strong>
                  {item.source && (
                    <>
                      <span aria-hidden="true">·</span>
                      Source: <strong>{item.source}</strong>
                    </>
                  )}
                  <Arrow />
                </span>
              </button>
            </article>
          );
        })}
        {!shown.length && (
          <p className="news-empty" role="status">
            {news.loading
              ? 'Loading news…'
              : news.error
                ? 'News could not be loaded right now.'
                : news.items.length
                  ? `No matching ${sectionName.toLowerCase()} reports.`
                  : `No ${sectionName.toLowerCase()} stories yet.`}
            {!news.loading && news.error && (
              <button type="button" className="link-btn" onClick={news.reload}>
                Try again
              </button>
            )}
          </p>
        )}
      </div>

      <div className="news-foot">
        <a className="news-history" href={setup.foot.href} target="_blank" rel="noopener noreferrer">
          {setup.foot.label}
          <Arrow />
        </a>
      </div>
    </section>
  );
}

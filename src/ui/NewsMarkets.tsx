/**
 * PRICE and INDEX from HashFirst Global: a list in the stories column (coins
 * by market cap, or the site's indexes) and the chosen one in the main area,
 * with a line chart drawn from its recent values.
 */
import { useMemo, useState } from 'react';
import { SITE, type Coin, type MarketIndex } from '../core/news/hashfirst';
import { newsDateTimeUTC } from '../core/news/news';
import { BackIcon, ExternalLinkIcon, SearchIcon } from './icons';

export function formatPrice(v: number | undefined): string {
  if (v === undefined) return '—';
  const max = v < 0.01 ? 8 : v < 1 ? 6 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: v >= 1 ? 2 : 0,
    maximumFractionDigits: max,
  }).format(v);
}

export function formatCompact(v: number | undefined): string {
  return v === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
}

export function formatPercent(v: number | undefined): string {
  return v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

const tone = (v: number | undefined) => (v === undefined || v === 0 ? '' : v > 0 ? ' is-up' : ' is-down');

/** A line through the values, scaled to the box; green when it ends higher. */
export function Sparkline({
  values,
  width,
  height,
  label,
}: {
  values: number[];
  width: number;
  height: number;
  label?: string;
}) {
  if (values.length < 2) return <span className="spark-empty" style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 2) - 1).toFixed(1)}`,
  );
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg
      className={`sparkline${up ? ' is-up' : ' is-down'}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <polyline points={pts.join(' ')} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange(v: string): void;
  placeholder: string;
}) {
  return (
    <div className="news-controls">
      <label className="news-control news-control-search">
        <span className="news-label">Search</span>
        <span className="news-search">
          <SearchIcon />
          <input type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        </span>
      </label>
    </div>
  );
}

interface ListState {
  loading: boolean;
  error: string | null;
  reload(): void;
}

function Empty({ state, count, what }: { state: ListState; count: number; what: string }) {
  if (count) return null;
  return (
    <p className="news-empty" role="status">
      {state.loading
        ? `Loading ${what}…`
        : state.error
          ? `${what[0]!.toUpperCase()}${what.slice(1)} could not be loaded.`
          : `No ${what}.`}
      {!state.loading && state.error && (
        <button type="button" className="link-btn" onClick={state.reload}>
          Try again
        </button>
      )}
    </p>
  );
}

export function PriceList({
  coins,
  state,
  selectedId,
  onSelect,
  className = '',
}: {
  coins: Coin[];
  state: ListState;
  selectedId: string | null;
  onSelect(coin: Coin): void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? coins.filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)) : coins;
  }, [coins, query]);
  return (
    <section className={`news-stories ${className}`.trim()} aria-label="Prices">
      <SearchField value={query} onChange={setQuery} placeholder="Search coin..." />
      <div className="news-list" aria-busy={state.loading}>
        <div className="market-head" aria-hidden="true">
          <span>#</span>
          <span>Asset</span>
          <span>Price</span>
          <span>24h</span>
          <span>7d</span>
        </div>
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`market-row${c.id === selectedId ? ' active' : ''}`}
            aria-current={c.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(c)}
          >
            <span className="market-rank">{c.rank ?? ''}</span>
            <span className="market-asset">
              <span className="market-symbol">{c.symbol}</span>
              <span className="market-name">{c.name}</span>
            </span>
            <span className="market-price">{formatPrice(c.price)}</span>
            <span className={`market-change${tone(c.change24h)}`}>{formatPercent(c.change24h)}</span>
            <Sparkline values={c.sparkline} width={64} height={22} />
          </button>
        ))}
        <Empty state={state} count={shown.length} what="prices" />
      </div>
      <div className="news-foot">
        <span className="market-credit">Market data: CoinGecko, via HashFirst Global</span>
        <a className="news-history" href={`${SITE}/price`} target="_blank" rel="noopener noreferrer">
          Open Price on HashFirst Global
          <ExternalLinkIcon />
        </a>
      </div>
    </section>
  );
}

function Stat({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="market-stat">
      <span className="news-label">{label}</span>
      <span className={`market-stat-value ${className}`.trim()}>{value}</span>
    </div>
  );
}

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <main className="chat-main chat-empty" aria-label={title}>
      <div className="chat-empty-inner">
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
    </main>
  );
}

export function PriceDetail({ coin, onBack }: { coin: Coin | null; onBack(): void }) {
  if (!coin)
    return <Placeholder title="Choose a coin" text="Pick a coin on the right to see its price and last 7 days." />;
  return (
    <main className="chat-main news-article" aria-label={coin.name}>
      <header className="news-article-bar">
        <button type="button" className="hdr-btn back" onClick={onBack} aria-label="Back to prices">
          <BackIcon />
        </button>
        <span className="news-article-site">Price</span>
      </header>
      <div className="news-article-body">
        <p className="news-meta">
          <span className="market-symbol">{coin.symbol}</span>
          {coin.rank && <span className="news-source">Rank #{coin.rank} by market cap</span>}
        </p>
        <h1 className="news-article-title">{coin.name}</h1>
        <p className="market-big">
          {formatPrice(coin.price)}
          <span className={`market-change${tone(coin.change24h)}`}>{formatPercent(coin.change24h)} 24h</span>
        </p>
        <div className="market-chart">
          <span className="news-label">Last 7 days</span>
          <Sparkline
            values={coin.sparkline}
            width={640}
            height={200}
            label={`${coin.name} price over the last 7 days`}
          />
        </div>
        <div className="market-stats">
          <Stat label="1h" value={formatPercent(coin.change1h)} className={tone(coin.change1h)} />
          <Stat label="24h" value={formatPercent(coin.change24h)} className={tone(coin.change24h)} />
          <Stat label="7d" value={formatPercent(coin.change7d)} className={tone(coin.change7d)} />
          <Stat label="Market cap" value={`$${formatCompact(coin.marketCap)}`} />
          <Stat label="24h volume" value={`$${formatCompact(coin.volume)}`} />
          <Stat label="24h range" value={`${formatPrice(coin.low24h)} – ${formatPrice(coin.high24h)}`} />
        </div>
        <footer className="news-article-foot">
          <a href={`${SITE}/price`} target="_blank" rel="noopener noreferrer">
            See all prices on HashFirst Global
            <ExternalLinkIcon />
          </a>
        </footer>
      </div>
    </main>
  );
}

export function IndexList({
  indexes,
  state,
  selectedSlug,
  onSelect,
  className = '',
}: {
  indexes: MarketIndex[];
  state: ListState;
  selectedSlug: string | null;
  onSelect(index: MarketIndex): void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? indexes.filter((i) => `${i.name} ${i.ticker}`.toLowerCase().includes(q)) : indexes;
  }, [indexes, query]);
  return (
    <section className={`news-stories ${className}`.trim()} aria-label="Indexes">
      <SearchField value={query} onChange={setQuery} placeholder="Search index..." />
      <div className="news-list" aria-busy={state.loading}>
        {shown.map((i) => (
          <article key={i.slug} className="news-entry">
            <button
              type="button"
              className={`news-row index-row${i.slug === selectedSlug ? ' active' : ''}`}
              aria-current={i.slug === selectedSlug ? 'true' : undefined}
              onClick={() => onSelect(i)}
            >
              <span className="index-row-top">
                <span className="market-symbol">{i.ticker}</span>
                {i.level === undefined ? (
                  <span className="market-change">Pending</span>
                ) : (
                  <>
                    <span className="index-level">{i.level.toFixed(2)}</span>
                    <span className={`market-change${tone(i.change24h)}`}>{formatPercent(i.change24h)}</span>
                  </>
                )}
              </span>
              <span className="news-row-title">{i.name}</span>
              {i.family && <span className="news-by">{i.family}</span>}
            </button>
          </article>
        ))}
        <Empty state={state} count={shown.length} what="indexes" />
      </div>
      <div className="news-foot">
        <a className="news-history" href={`${SITE}/indexes`} target="_blank" rel="noopener noreferrer">
          Open Index on HashFirst Global
          <ExternalLinkIcon />
        </a>
      </div>
    </section>
  );
}

export function IndexDetail({ index, onBack }: { index: MarketIndex | null; onBack(): void }) {
  if (!index)
    return <Placeholder title="Choose an index" text="Pick an index on the right to see its level and history." />;
  return (
    <main className="chat-main news-article" aria-label={index.name}>
      <header className="news-article-bar">
        <button type="button" className="hdr-btn back" onClick={onBack} aria-label="Back to indexes">
          <BackIcon />
        </button>
        <span className="news-article-site">Index</span>
      </header>
      <div className="news-article-body">
        <p className="news-meta">
          <span className="market-symbol">{index.ticker}</span>
          {index.family && <span className="news-source">{index.family}</span>}
        </p>
        <h1 className="news-article-title">{index.name}</h1>
        {index.level === undefined ? (
          <p className="news-text-status">This index has no calculated level yet.</p>
        ) : (
          <p className="market-big">
            {index.level.toFixed(2)}
            <span className={`market-change${tone(index.change24h)}`}>{formatPercent(index.change24h)} 24h</span>
          </p>
        )}
        {index.points.length > 1 && (
          <div className="market-chart">
            <span className="news-label">Level history</span>
            <Sparkline values={index.points} width={640} height={200} label={`${index.name} level history`} />
          </div>
        )}
        <div className="market-stats">
          <Stat label="24h" value={formatPercent(index.change24h)} className={tone(index.change24h)} />
          <Stat label="30d" value={formatPercent(index.change30d)} className={tone(index.change30d)} />
          <Stat
            label="Since inception"
            value={formatPercent(index.sinceInception)}
            className={tone(index.sinceInception)}
          />
          <Stat label="Updated" value={index.updatedAt ? newsDateTimeUTC(index.updatedAt) : '—'} />
        </div>
        {index.description && <p className="news-summary market-description">{index.description}</p>}
        <footer className="news-article-foot">
          <a href={`${SITE}/indexes/${index.slug}`} target="_blank" rel="noopener noreferrer">
            Open {index.ticker} on HashFirst Global
            <ExternalLinkIcon />
          </a>
        </footer>
      </div>
    </main>
  );
}

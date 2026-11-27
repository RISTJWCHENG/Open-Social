/**
 * Market left column: search, Browse / Saved / Selling, and categories with
 * the number of listings in each.
 */
import { CATEGORIES, type MarketQuery } from '../../core/market/market';
import { PlusIcon, SearchIcon } from '../icons';

export type MarketTab = 'browse' | 'saved' | 'selling';

interface Props {
  tab: MarketTab;
  onTab(t: MarketTab): void;
  query: MarketQuery;
  onQuery(q: MarketQuery): void;
  counts: Record<string, number>;
  savedCount: number;
  sellingCount: number;
  onSell(): void;
}

export function MarketPanel({ tab, onTab, query, onQuery, counts, savedCount, sellingCount, onSell }: Props) {
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const pick = (category?: string) => {
    onTab('browse');
    onQuery({ ...query, category });
  };
  return (
    <section className="chat-list market-panel" aria-label="Market">
      <div className="chat-list-header">
        <h2>Market</h2>
        <button type="button" className="plus-btn" aria-label="Sell an item" title="Sell an item" onClick={onSell}>
          <PlusIcon />
        </button>
      </div>
      <label className="search-box">
        <SearchIcon />
        <span className="sr-only">Search the market</span>
        <input
          type="search"
          placeholder="Search the market..."
          value={query.text}
          onChange={(e) => {
            if (tab !== 'browse') onTab('browse');
            onQuery({ ...query, text: e.target.value });
          }}
        />
      </label>
      <div className="contacts-tabs" role="tablist" aria-label="Show">
        {(
          [
            ['browse', 'Browse', 0],
            ['saved', 'Saved', savedCount],
            ['selling', 'Selling', sellingCount],
          ] as const
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="contacts-tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
          >
            {label}
            {n > 0 && <span className="mk-tab-count">{n}</span>}
          </button>
        ))}
      </div>
      <nav className="mk-cats" aria-label="Categories">
        <p className="mk-cats-title">Categories</p>
        <button
          type="button"
          className={`mk-cat${tab === 'browse' && !query.category ? ' active' : ''}`}
          aria-current={tab === 'browse' && !query.category ? 'true' : undefined}
          onClick={() => pick(undefined)}
        >
          <span>All categories</span>
          <span className="mk-cat-n">{all || ''}</span>
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`mk-cat${tab === 'browse' && query.category === c.id ? ' active' : ''}`}
            aria-current={tab === 'browse' && query.category === c.id ? 'true' : undefined}
            onClick={() => pick(c.id)}
          >
            <span>{c.label}</span>
            <span className="mk-cat-n">{counts[c.id] || ''}</span>
          </button>
        ))}
      </nav>
      <p className="mk-note">
        Listings are public. Talk to sellers in encrypted chat; payment and handover are arranged between you.
      </p>
    </section>
  );
}

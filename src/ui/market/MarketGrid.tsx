/**
 * Market main area: filters and sort (when browsing), then a grid of
 * listings with "Load more".
 */
import {
  categoryLabel,
  CONDITIONS,
  CURRENCIES,
  parsePrice,
  priceText,
  type Listing,
  type MarketQuery,
  type MarketSort,
} from '../../core/market/market';
import { BackIcon } from '../icons';
import { ListingCard } from './ListingCard';
import type { PhotoLoader } from './marketPhotos';
import type { MarketTab } from './MarketPanel';
import { EMPTY_QUERY } from './useMarket';
import { useEffect, useState } from 'react';

interface Props {
  tab: MarketTab;
  items: Listing[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  query: MarketQuery;
  onQuery(q: MarketQuery): void;
  onMore(): void;
  onRetry(): void;
  onOpen(id: string): void;
  saved: string[];
  onToggleSave(id: string): void;
  photo: PhotoLoader;
  onSell(): void;
  me?: string;
  onBack(): void;
}

function PriceBox({ query, onQuery }: { query: MarketQuery; onQuery(q: MarketQuery): void }) {
  const currency = query.currency ?? 'EUR';
  const [min, setMin] = useState(query.minPrice ? priceText(query.minPrice, currency) : '');
  const [max, setMax] = useState(query.maxPrice ? priceText(query.maxPrice, currency) : '');
  useEffect(() => {
    if (query.minPrice === undefined) setMin('');
    if (query.maxPrice === undefined) setMax('');
  }, [query.minPrice, query.maxPrice]);
  const apply = (lo: string, hi: string, cur = currency) => {
    const a = parsePrice(lo, cur);
    const b = parsePrice(hi, cur);
    const any = a !== null || b !== null;
    onQuery({ ...query, minPrice: a ?? undefined, maxPrice: b ?? undefined, currency: any ? cur : undefined });
  };
  return (
    <div className="mk-price-filter" role="group" aria-label="Price">
      <input
        inputMode="decimal"
        placeholder="Min"
        aria-label="Minimum price"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        onBlur={() => apply(min, max)}
        onKeyDown={(e) => e.key === 'Enter' && apply(min, max)}
      />
      <span aria-hidden="true">–</span>
      <input
        inputMode="decimal"
        placeholder="Max"
        aria-label="Maximum price"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onBlur={() => apply(min, max)}
        onKeyDown={(e) => e.key === 'Enter' && apply(min, max)}
      />
      <select aria-label="Price currency" value={currency} onChange={(e) => apply(min, max, e.target.value)}>
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MarketGrid(p: Props) {
  const q = p.query;
  const filtered =
    !!q.condition ||
    q.minPrice !== undefined ||
    q.maxPrice !== undefined ||
    q.freeOnly ||
    q.shippingOnly ||
    !!q.location ||
    !!q.seller;
  const heading =
    p.tab === 'saved'
      ? 'Saved'
      : p.tab === 'selling'
        ? 'Your listings'
        : q.seller
          ? 'Listings from this seller'
          : q.text
            ? `Results for “${q.text.trim()}”`
            : q.category
              ? categoryLabel(q.category)
              : "Today's picks";
  const empty =
    p.tab === 'saved'
      ? 'Tap the heart on a listing to save it here. Saved items stay on this device.'
      : p.tab === 'selling'
        ? 'You have no listings yet.'
        : q.text || q.category || filtered
          ? 'No listings match. Try other words or fewer filters.'
          : 'Nothing for sale yet. Be the first to list something.';

  return (
    <main className="chat-main mk-main" aria-label="Market listings">
      <header className="mk-head">
        <div className="mk-head-row">
          <button
            type="button"
            className="hdr-btn back mk-grid-back"
            onClick={p.onBack}
            aria-label="Back to categories"
          >
            <BackIcon />
          </button>
          <h2>{heading}</h2>
          {p.tab === 'browse' && !p.loading && (
            <span className="mk-total">{p.total.toLocaleString('en-US')} listings</span>
          )}
          <button type="button" className="ev-btn is-primary mk-sell" onClick={p.onSell}>
            Sell an item
          </button>
        </div>
        {p.tab === 'browse' && (
          <div className="mk-filters">
            <select
              aria-label="Sort"
              value={q.sort}
              onChange={(e) => p.onQuery({ ...q, sort: e.target.value as MarketSort })}
            >
              <option value="newest">Newest first</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
            </select>
            <select
              aria-label="Condition"
              value={q.condition ?? ''}
              onChange={(e) => p.onQuery({ ...q, condition: e.target.value || undefined })}
            >
              <option value="">Any condition</option>
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <PriceBox query={q} onQuery={p.onQuery} />
            <input
              className="mk-place"
              type="search"
              placeholder="Location"
              aria-label="Location"
              value={q.location}
              onChange={(e) => p.onQuery({ ...q, location: e.target.value })}
            />
            <button
              type="button"
              className="mk-chip"
              aria-pressed={q.freeOnly}
              onClick={() => p.onQuery({ ...q, freeOnly: !q.freeOnly })}
            >
              Free
            </button>
            <button
              type="button"
              className="mk-chip"
              aria-pressed={q.shippingOnly}
              onClick={() => p.onQuery({ ...q, shippingOnly: !q.shippingOnly })}
            >
              Ships
            </button>
            {filtered && (
              <button
                type="button"
                className="link-btn"
                onClick={() => p.onQuery({ ...EMPTY_QUERY, text: q.text, category: q.category, sort: q.sort })}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </header>

      {p.error ? (
        <div className="mk-empty" role="alert">
          <p>Couldn't load listings. {p.error}</p>
          <button type="button" className="ev-btn" onClick={p.onRetry}>
            Try again
          </button>
        </div>
      ) : p.items.length === 0 && !p.loading ? (
        <div className="mk-empty">
          <p>{empty}</p>
          {p.tab !== 'saved' && (
            <button type="button" className="ev-btn is-primary" onClick={p.onSell}>
              Sell an item
            </button>
          )}
        </div>
      ) : (
        <div className="mk-grid" aria-busy={p.loading}>
          {p.items.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              photo={p.photo}
              saved={p.saved.includes(l.id)}
              onOpen={() => p.onOpen(l.id)}
              onToggleSave={l.seller === p.me ? undefined : () => p.onToggleSave(l.id)}
            />
          ))}
          {p.loading &&
            p.items.length === 0 &&
            Array.from({ length: 8 }, (_, i) => <div key={i} className="mk-card is-skeleton" aria-hidden="true" />)}
        </div>
      )}
      {p.hasMore && (
        <div className="mk-more">
          <button type="button" className="ev-btn" disabled={p.loading} onClick={p.onMore}>
            {p.loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </main>
  );
}

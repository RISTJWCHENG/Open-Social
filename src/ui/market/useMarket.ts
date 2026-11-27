/**
 * Market state for the app: the current search and its pages, category
 * counts, the account's own listings, and saved listings (kept on this
 * device only, so what someone saves never leaves their browser).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE, type Listing, type ListingInput, type MarketQuery } from '../../core/market/market';
import { MarketClient } from '../../modules/market/marketClient';
import { SearchClient } from '../../modules/search/searchClient';

const searchClient = new SearchClient();

type Identity = import('@icp-sdk/core/agent').Identity;

export const EMPTY_QUERY: MarketQuery = {
  text: '',
  freeOnly: false,
  shippingOnly: false,
  location: '',
  sort: 'newest',
};

const savedKey = (account: string) => `zc-market-saved:${account}`;

function readSaved(account: string | undefined): string[] {
  if (!account) return [];
  try {
    const v = JSON.parse(localStorage.getItem(savedKey(account)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^\d{1,19}$/.test(x)) : [];
  } catch {
    return [];
  }
}

export function useMarket(identity: () => Identity | null, account: string | undefined, active: boolean) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => new MarketClient(identity), [account]);
  const [query, setQuery] = useState<MarketQuery>(EMPTY_QUERY);
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Listing[]>([]);
  const [saved, setSaved] = useState<string[]>(() => readSaved(account));
  const [savedItems, setSavedItems] = useState<Listing[]>([]);
  const [known, setKnown] = useState<Record<string, Listing>>({});
  const run = useRef(0);

  const remember = useCallback((ls: Listing[]) => {
    if (ls.length) setKnown((k) => ({ ...k, ...Object.fromEntries(ls.map((l) => [l.id, l])) }));
  }, []);

  const search = useCallback(
    async (q: MarketQuery, offset = 0) => {
      const me = ++run.current;
      setLoading(true);
      setError(null);
      try {
        // Words are matched by the search canister; the market applies its filters to those matches.
        const words = q.text.trim();
        const page = words
          ? await client.search({ ...q, text: '' }, offset, PAGE_SIZE, await searchClient.ids(words, 'listing'))
          : await client.search(q, offset, PAGE_SIZE);
        if (me !== run.current) return;
        setItems((prev) => (offset ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        setNextOffset(page.nextOffset);
        remember(page.items);
      } catch (e) {
        if (me === run.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (me === run.current) setLoading(false);
      }
    },
    [client, remember],
  );

  const refreshCounts = useCallback(() => {
    void client.counts().then(setCounts, () => undefined);
  }, [client]);

  const refreshMine = useCallback(async () => {
    if (!account) return;
    const ls = await client.mine();
    setMine(ls);
    remember(ls);
  }, [client, account, remember]);

  useEffect(() => {
    setSaved(readSaved(account));
  }, [account]);

  // Search again shortly after the query changes (typing is debounced).
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void search(query), query.text || query.location ? 300 : 0);
    return () => clearTimeout(t);
  }, [active, query, search]);

  useEffect(() => {
    if (!active) return;
    refreshCounts();
    void refreshMine().catch(() => undefined);
  }, [active, refreshCounts, refreshMine]);

  const refreshSaved = useCallback(async () => {
    const ls = await client.getMany(saved);
    setSavedItems(saved.map((id) => ls.find((l) => l.id === id)).filter((l): l is Listing => !!l));
    remember(ls);
  }, [client, saved, remember]);

  useEffect(() => {
    if (active) void refreshSaved().catch(() => undefined);
  }, [active, refreshSaved]);

  const toggleSave = useCallback(
    (id: string) => {
      setSaved((s) => {
        const next = s.includes(id) ? s.filter((x) => x !== id) : [id, ...s].slice(0, 200);
        if (account) {
          try {
            localStorage.setItem(savedKey(account), JSON.stringify(next));
          } catch {
            /* storage unavailable: kept for this session only */
          }
        }
        return next;
      });
    },
    [account],
  );

  const load = useCallback(
    async (id: string) => {
      const l = await client.get(id);
      if (l) remember([l]);
      else setKnown((k) => Object.fromEntries(Object.entries(k).filter(([key]) => key !== id)));
      return l;
    },
    [client, remember],
  );

  const afterChange = useCallback(async () => {
    await refreshMine().catch(() => undefined);
    refreshCounts();
    void search(query);
  }, [refreshMine, refreshCounts, search, query]);

  return {
    client,
    query,
    setQuery,
    items,
    total,
    nextOffset,
    loading,
    error,
    loadMore: () => nextOffset !== null && search(query, nextOffset),
    retry: () => search(query),
    counts,
    mine,
    saved,
    savedItems,
    toggleSave,
    known,
    load,
    photo: useCallback((id: string, hash: string) => client.photo(id, hash), [client]),
    create: async (i: ListingInput) => {
      const id = await client.create(i);
      await afterChange();
      await load(id);
      return id;
    },
    update: async (id: string, i: ListingInput) => {
      await client.update(id, i);
      await load(id);
      await afterChange();
    },
    setStatus: async (id: string, s: 'active' | 'reserved' | 'sold') => {
      await client.setStatus(id, s);
      await load(id);
      await afterChange();
    },
    remove: async (id: string) => {
      await client.remove(id);
      setKnown((k) => Object.fromEntries(Object.entries(k).filter(([key]) => key !== id)));
      await afterChange();
    },
    report: (id: string, reason: string) => client.report(id, reason),
  };
}

export type MarketState = ReturnType<typeof useMarket>;

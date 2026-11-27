/**
 * HashFirst Global data for the open News section: the site's article list
 * (all sections), coin prices or indexes, read through the canister and
 * refreshed every few minutes while the section is open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  parseIndexes,
  parsePrices,
  parseSearch,
  type Coin,
  type MarketIndex,
  type NewsSection,
} from '../core/news/hashfirst';
import { cleanNews, type NewsItem } from '../core/news/news';

const PATHS: Partial<Record<NewsSection, string>> = {
  home: '/api/search',
  news: '/api/search',
  opinion: '/api/search',
  video: '/api/search',
  sponsored: '/api/search',
  price: '/api/prices',
  index: '/api/indexes',
};
const POLL_MS: Partial<Record<string, number>> = { '/api/prices': 2 * 60_000 };

export interface HashFirstState {
  stories: NewsItem[];
  coins: Coin[];
  indexes: MarketIndex[];
  loading: boolean;
  error: string | null;
  reload(): void;
}

export function useHashFirst(section: NewsSection | null, fetch: (path: string) => Promise<string>): HashFirstState {
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(new Set<string>());
  const path = section ? PATHS[section] : undefined;

  const load = useCallback(
    async (p: string) => {
      if (busy.current.has(p)) return;
      busy.current.add(p);
      setLoading(true);
      try {
        const body = await fetch(p);
        setBodies((b) => ({ ...b, [p]: body }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load this section.');
      } finally {
        busy.current.delete(p);
        setLoading(busy.current.size > 0);
      }
    },
    [fetch],
  );

  useEffect(() => {
    if (!path) return;
    void load(path);
    const t = setInterval(() => void load(path), POLL_MS[path] ?? 10 * 60_000);
    return () => clearInterval(t);
  }, [path, load]);

  const parsed = useMemo(() => {
    const safe = <T>(body: string | undefined, parse: (s: string) => T[]): T[] => {
      try {
        return body ? parse(body) : [];
      } catch {
        return [];
      }
    };
    return {
      stories: cleanNews(safe(bodies['/api/search'], parseSearch)),
      coins: safe(bodies['/api/prices'], parsePrices),
      indexes: safe(bodies['/api/indexes'], parseIndexes),
    };
  }, [bodies]);

  return { ...parsed, loading, error, reload: () => path && void load(path) };
}

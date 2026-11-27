/**
 * The news feed while News is open: shown at once from the canister's copy,
 * which is refreshed first when it is empty or stale, and again every few
 * minutes while News stays open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cleanNews, NEWS_STALE_MS, type NewsFeed, type NewsItem } from '../core/news/news';

const POLL_MS = 10 * 60_000;

export interface NewsState {
  items: NewsItem[];
  fetchedAt: number;
  loading: boolean;
  error: string | null;
  reload(): void;
}

export function useNews(open: boolean, fetchNews: (refresh: boolean) => Promise<NewsFeed>): NewsState {
  const [feed, setFeed] = useState<NewsFeed>({ items: [], fetchedAt: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      let f = await fetchNews(false);
      setFeed(f);
      if (!f.items.length || Date.now() - f.fetchedAt > NEWS_STALE_MS) {
        f = await fetchNews(true);
        setFeed(f);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'News could not be loaded.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [fetchNews]);

  useEffect(() => {
    if (!open) return;
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [open, load]);

  const items = useMemo(() => cleanNews(feed.items), [feed.items]);
  return { items, fetchedAt: feed.fetchedAt, loading, error, reload: () => void load() };
}

/**
 * HashFirst Global's sections and the JSON its public APIs return, read
 * through the identity canister. Everything is checked here before use:
 * links are built from slugs, never taken from the data.
 */
import type { NewsItem } from './news';

export type NewsSection = 'home' | 'news' | 'opinion' | 'ecosystem' | 'video' | 'price' | 'index' | 'sponsored';
/** Sections whose content is a list of stories. */
export type StorySection = 'home' | 'news' | 'opinion' | 'ecosystem' | 'video' | 'sponsored';

export const SITE = 'https://hashfirstglobal.com';

export const SECTIONS: { id: NewsSection; label: string; name: string; accent: string; href: string }[] = [
  { id: 'home', label: 'HOME', name: 'Home', accent: '#111111', href: `${SITE}/` },
  { id: 'news', label: 'NEWS', name: 'News', accent: '#2968CF', href: `${SITE}/news` },
  { id: 'opinion', label: 'OPINION', name: 'Opinion', accent: '#9973BA', href: `${SITE}/opinion` },
  { id: 'ecosystem', label: 'ECOSYSTEM', name: 'Ecosystem', accent: '#14AFBD', href: `${SITE}/ecosystem` },
  { id: 'video', label: 'VIDEO', name: 'Video', accent: '#E0763E', href: `${SITE}/video` },
  { id: 'price', label: 'PRICE', name: 'Price', accent: '#7787CF', href: `${SITE}/price` },
  { id: 'index', label: 'INDEX', name: 'Index', accent: '#2F8A72', href: `${SITE}/indexes` },
  { id: 'sponsored', label: 'SPONSORED', name: 'Sponsored', accent: '#BD9525', href: `${SITE}/sponsored` },
];

export const sectionInfo = (id: string) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]!;

const SLUG = /^[A-Za-z0-9._-]{1,200}$/;
const STORY_SECTIONS = new Set(['news', 'opinion', 'ecosystem', 'video', 'sponsored']);
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined;

/** The story's page on the site. */
export function storyUrl(section: string, slug: string): string {
  if (section === 'news') return `${SITE}/news/en/${slug}`;
  if (section === 'video') return `${SITE}/video?video=${slug}`;
  return `${SITE}/${section}/${slug}`;
}

/** Stories from /api/search (all sections, newest first). */
export function parseSearch(json: string): NewsItem[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  const items = data.flatMap((raw): NewsItem[] => {
    const r = raw as Record<string, unknown>;
    const section = typeof r.section === 'string' ? r.section : '';
    const slug = typeof r.slug === 'string' ? r.slug : '';
    const title = text(r.title, 200);
    const publishedAt = typeof r.publishedAt === 'string' ? Date.parse(r.publishedAt) : NaN;
    if (!STORY_SECTIONS.has(section) || !SLUG.test(slug) || !title || !Number.isFinite(publishedAt)) return [];
    const category = text(r.category, 40);
    return [
      {
        id: `${section}/${slug}`,
        section,
        title,
        summary: text(r.dek, 400),
        ...(category && category !== 'General' ? { protocol: category } : {}),
        url: storyUrl(section, slug),
        publishedAt,
      },
    ];
  });
  return items.sort((a, b) => b.publishedAt - a.publishedAt);
}

/** The text of a story from /api/news/article or /api/opinion/article. */
export function parseArticleJson(json: string): string {
  const r = JSON.parse(json) as Record<string, unknown>;
  return typeof r.contentHtml === 'string' ? r.contentHtml : '';
}

/** The API path for a story's text, for sections that have one. */
export function articleApiPath(id: string): string | undefined {
  const [section, slug] = id.split('/');
  if (!slug || !SLUG.test(slug)) return undefined;
  if (section === 'news') return `/api/news/article?slug=${slug}&language=en`;
  if (section === 'opinion') return `/api/opinion/article?slug=${slug}`;
  return undefined;
}

export interface Coin {
  id: string;
  symbol: string;
  name: string;
  rank?: number;
  price: number;
  marketCap?: number;
  volume?: number;
  high24h?: number;
  low24h?: number;
  change1h?: number;
  change24h?: number;
  change7d?: number;
  /** Hourly prices over the last 7 days. */
  sparkline: number[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Coins from /api/prices (CoinGecko markets, by market cap). */
export function parsePrices(json: string): Coin[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw): Coin[] => {
    const r = raw as Record<string, unknown>;
    const price = num(r.current_price);
    const id = text(r.id, 80);
    const name = text(r.name, 80);
    const symbol = text(r.symbol, 20);
    if (price === undefined || !id || !name || !symbol) return [];
    const spark = (r.sparkline_in_7d as { price?: unknown } | undefined)?.price;
    return [
      {
        id,
        name,
        symbol: symbol.toUpperCase(),
        rank: num(r.market_cap_rank),
        price,
        marketCap: num(r.market_cap),
        volume: num(r.total_volume),
        high24h: num(r.high_24h),
        low24h: num(r.low_24h),
        change1h: num(r.price_change_percentage_1h_in_currency),
        change24h: num(r.price_change_percentage_24h_in_currency) ?? num(r.price_change_percentage_24h),
        change7d: num(r.price_change_percentage_7d_in_currency),
        sparkline: Array.isArray(spark) ? spark.filter((p): p is number => typeof p === 'number').slice(-200) : [],
      },
    ];
  });
}

export interface MarketIndex {
  slug: string;
  ticker: string;
  name: string;
  description?: string;
  family?: string;
  level?: number;
  change24h?: number;
  change30d?: number;
  sinceInception?: number;
  updatedAt?: number;
  status?: string;
  points: number[];
}

/** Indexes from /api/indexes. */
export function parseIndexes(json: string): MarketIndex[] {
  const data = JSON.parse(json) as { indexes?: unknown };
  if (!Array.isArray(data.indexes)) return [];
  return data.indexes.flatMap((raw): MarketIndex[] => {
    const r = raw as Record<string, unknown>;
    const slug = typeof r.slug === 'string' && SLUG.test(r.slug) ? r.slug : undefined;
    const name = text(r.name, 120);
    if (!slug || !name) return [];
    const m = (r.market ?? {}) as Record<string, unknown>;
    const updated = typeof m.lastCalculatedAt === 'string' ? Date.parse(m.lastCalculatedAt) : NaN;
    const points = Array.isArray(m.points)
      ? m.points.flatMap((p) => {
          const level = num((p as Record<string, unknown>).level);
          return level === undefined ? [] : [level];
        })
      : [];
    return [
      {
        slug,
        name,
        ticker: text(r.ticker, 20) ?? slug.toUpperCase(),
        description: text(r.description, 600),
        family: text(r.family, 40),
        level: num(m.currentLevel),
        change24h: num(m.change24hPct),
        change30d: num(m.change30dPct),
        sinceInception: num(m.sinceInceptionPct),
        updatedAt: Number.isFinite(updated) ? updated : undefined,
        status: text(m.status, 20),
        points: points.slice(-400),
      },
    ];
  });
}

/**
 * News stories (from HashFirst Global), as the identity canister serves them.
 * The canister already checks the feed; the app checks again before showing
 * anything, since a story's link and image end up in the page.
 */

export interface NewsItem {
  /** The ecosystem feed's id, or "section/slug" for the site's other sections. */
  id: string;
  /** The site section ("news", "opinion", "ecosystem", "video", "sponsored"); ecosystem when absent. */
  section?: string;
  title: string;
  summary?: string;
  /** e.g. "Internet Computer", "Ethereum". */
  protocol?: string;
  /** Where the story comes from, e.g. a governance forum. */
  source?: string;
  /** The story on the news site. */
  url: string;
  publishedAt: number;
  /** A small cover image as a data URL. */
  thumb?: string;
}

export interface NewsFeed {
  items: NewsItem[];
  /** When the canister fetched the feed (ms; 0: never). */
  fetchedAt: number;
}

export const NEWS_SITE = 'HashFirst Global';
const SITE = /^https:\/\/(www\.)?hashfirstglobal\.com\//;
const THUMB = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_THUMB = 30_000;
/** Older feeds are refreshed when News is opened. */
export const NEWS_STALE_MS = 15 * 60_000;

/** Only stories that link to the news site, with a title; images only as small raster data URLs. */
export function cleanNews(items: NewsItem[]): NewsItem[] {
  return items.flatMap((i) => {
    if (!i.title.trim() || !SITE.test(i.url)) return [];
    const thumb = i.thumb && i.thumb.length <= MAX_THUMB && THUMB.test(i.thumb) ? i.thumb : undefined;
    // The site names some protocols in CamelCase ("InternetComputer"), and
    // filed some early Zcash governance stories under Bitcoin.
    const named = i.protocol === 'Bitcoin' && i.source === 'Zcash Community Governance' ? 'Zcash' : i.protocol;
    const protocol = named?.replace(/([a-z])([A-Z])/g, '$1 $2');
    return [{ ...i, protocol, thumb }];
  });
}

/** The protocols present, most stories first (ties by name). */
export function newsProtocols(items: NewsItem[]): string[] {
  const counts = new Map<string, number>();
  for (const i of items) if (i.protocol) counts.set(i.protocol, (counts.get(i.protocol) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

/** Stories for a protocol filter (undefined: all) and a search over title, summary, protocol and source. */
export function filterNews(items: NewsItem[], protocol: string | undefined, query: string): NewsItem[] {
  const q = query.trim().toLowerCase();
  return items.filter(
    (i) =>
      (!protocol || i.protocol === protocol) &&
      (!q || [i.title, i.summary, i.protocol, i.source].some((f) => f?.toLowerCase().includes(q))),
  );
}

/** "Just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function newsAge(at: number, now = Date.now()): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Protocol badge colours, as the news site sets them. */
const PROTOCOL_COLORS: Record<string, string> = {
  bitcoin: '#FFE066',
  zcash: '#E6B96A',
  ethereum: '#9EC5FF',
  litecoin: '#C9D4FF',
  worldlibertyfinancial: '#FF9BC2',
  solana: '#D08AA8',
  cosmos: '#A2B9FF',
  aleo: '#67C8FF',
  nym: '#4BEA92',
  aave: '#80AB36',
  hashkeychain: '#FFC85A',
  internetcomputer: '#A99CF0',
};

export function protocolColor(protocol: string | undefined): string {
  return PROTOCOL_COLORS[(protocol ?? '').toLowerCase().replace(/[\s_-]+/g, '')] ?? '#E5E5E5';
}

/** "Nov 22, 2026, 1:00 PM UTC", as the news site lists stories. */
export function newsDateTimeUTC(at: number): string {
  return (
    new Date(at).toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' UTC'
  );
}

/** "just now", "12 min ago", "3 hrs 5 min ago", "4 days 3 hrs ago". */
export function newsRelative(at: number, now = Date.now()): string {
  const totalMinutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${totalMinutes} min ago`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hr = (n: number) => `${n} ${n === 1 ? 'hr' : 'hrs'}`;
  if (hours < 24) return minutes > 0 ? `${hr(hours)} ${minutes} min ago` : `${hr(hours)} ago`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const d = `${days} ${days === 1 ? 'day' : 'days'}`;
  return rest > 0 ? `${d} ${hr(rest)} ago` : `${d} ago`;
}

/** The time line's colour: sky blue in the first hour, fading to grey over a day. */
export function newsAgeColor(at: number, now = Date.now()): string {
  const age = Math.max(0, now - at);
  const hour = 3_600_000;
  if (age < hour) return '#38BDF8';
  if (age >= 24 * hour) return '#6B7280';
  const p = (age - hour) / (23 * hour);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * p);
  return `rgb(${mix(56, 107)}, ${mix(189, 114)}, ${mix(248, 128)})`;
}

export type NewsPeriod = 'latest' | 'today' | 'week' | 'month' | 'all';

export const NEWS_PERIODS: Record<NewsPeriod, string> = {
  latest: 'Latest 20 Articles',
  today: "Today's Articles",
  week: 'This Week Articles',
  month: 'This Month Articles',
  all: 'All Articles',
};

/** The UTC day of a time, as "2026-11-22". */
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Stories for a list period (items newest first). */
export function newsInPeriod(items: NewsItem[], period: NewsPeriod, now = Date.now()): NewsItem[] {
  if (period === 'latest') return items.slice(0, 20);
  if (period === 'all') return items;
  const d = new Date(now);
  const start =
    period === 'today'
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      : period === 'week'
        ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
        : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return items.filter((i) => i.publishedAt >= start);
}

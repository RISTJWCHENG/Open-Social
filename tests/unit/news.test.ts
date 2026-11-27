import { describe, expect, it } from 'vitest';
import {
  cleanNews,
  filterNews,
  newsAge,
  newsAgeColor,
  newsDateTimeUTC,
  newsInPeriod,
  newsProtocols,
  newsRelative,
  protocolColor,
  type NewsItem,
} from '../../src/core/news/news';

const item = (over: Partial<NewsItem>): NewsItem => ({
  id: 'x',
  title: 'Title',
  url: 'https://hashfirstglobal.com/ecosystem/x',
  publishedAt: 0,
  ...over,
});

describe('news', () => {
  it('keeps only stories that link to the news site, with small raster thumbnails', () => {
    const ok = 'data:image/webp;base64,AAAA';
    const out = cleanNews([
      item({ id: 'a', thumb: ok }),
      item({ id: 'b', url: 'https://evil.example/x' }),
      item({ id: 'c', thumb: 'data:image/svg+xml;base64,AAAA' }),
      item({ id: 'd', title: '  ' }),
      item({ id: 'e', url: 'https://www.hashfirstglobal.com/y' }),
    ]);
    expect(out.map((i) => i.id)).toEqual(['a', 'c', 'e']);
    expect(out[0]!.thumb).toBe(ok);
    expect(out[1]!.thumb).toBeUndefined();
    expect(cleanNews([item({ protocol: 'InternetComputer' })])[0]!.protocol).toBe('Internet Computer');
  });

  it('lists protocols by number of stories, and filters by protocol and search', () => {
    const items = [
      item({ id: '1', protocol: 'Ethereum', title: 'Upgrade' }),
      item({ id: '2', protocol: 'Internet Computer', title: 'NNS vote', source: 'Forum' }),
      item({ id: '3', protocol: 'Internet Computer', title: 'Subnet', summary: 'New upgrade' }),
    ];
    expect(newsProtocols(items)).toEqual(['Internet Computer', 'Ethereum']);
    expect(filterNews(items, 'Internet Computer', '').map((i) => i.id)).toEqual(['2', '3']);
    expect(filterNews(items, undefined, 'upgrade').map((i) => i.id)).toEqual(['1', '3']);
    expect(filterNews(items, undefined, 'forum').map((i) => i.id)).toEqual(['2']);
  });

  it('says how long ago a story came out', () => {
    const now = Date.UTC(2026, 10, 26, 12);
    expect(newsAge(now - 20_000, now)).toBe('Just now');
    expect(newsAge(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(newsAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(newsAge(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(newsAge(now - 30 * 86_400_000, now)).toMatch(/2026/);
  });

  it('formats times, colours and periods like the news site', () => {
    const now = Date.UTC(2026, 10, 26, 17, 0);
    expect(newsDateTimeUTC(Date.UTC(2026, 10, 22, 13, 0))).toBe('Nov 22, 2026, 1:00 PM UTC');
    expect(newsRelative(now - (4 * 24 + 3) * 3_600_000, now)).toBe('4 days 3 hrs ago');
    expect(newsRelative(now - 65 * 60_000, now)).toBe('1 hr 5 min ago');
    expect(newsAgeColor(now - 10 * 60_000, now)).toBe('#38BDF8');
    expect(newsAgeColor(now - 2 * 86_400_000, now)).toBe('#6B7280');
    expect(protocolColor('Internet Computer')).toBe('#A99CF0');
    expect(cleanNews([item({ protocol: 'Bitcoin', source: 'Zcash Community Governance' })])[0]!.protocol).toBe('Zcash');
    const list = Array.from({ length: 25 }, (_, i) => item({ id: `${i}`, publishedAt: now - i * 86_400_000 }));
    expect(newsInPeriod(list, 'latest', now)).toHaveLength(20);
    expect(newsInPeriod(list, 'today', now)).toHaveLength(1);
    expect(newsInPeriod(list, 'all', now)).toHaveLength(25);
  });
});

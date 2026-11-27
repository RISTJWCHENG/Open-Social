import { describe, expect, it } from 'vitest';
import { articleApiPath, parseIndexes, parsePrices, parseSearch, storyUrl } from '../../src/core/news/hashfirst';

describe('HashFirst Global data', () => {
  it('reads stories from the search list, building links from slugs', () => {
    const items = parseSearch(
      JSON.stringify([
        {
          title: 'Old',
          slug: 'old',
          section: 'news',
          category: 'Markets',
          dek: 'd',
          publishedAt: '2026-11-01T00:00:00Z',
        },
        { title: 'New', slug: 'new-one', section: 'opinion', category: 'General', publishedAt: '2026-11-20T00:00:00Z' },
        { title: 'Bad slug', slug: '../x', section: 'news', publishedAt: '2026-11-20T00:00:00Z' },
        { title: 'Bad section', slug: 'y', section: 'dashboard', publishedAt: '2026-11-20T00:00:00Z' },
        { title: 'No date', slug: 'z', section: 'news' },
      ]),
    );
    expect(items.map((i) => i.id)).toEqual(['opinion/new-one', 'news/old']);
    expect(items[0]!.protocol).toBeUndefined();
    expect(items[1]).toMatchObject({
      protocol: 'Markets',
      summary: 'd',
      url: 'https://hashfirstglobal.com/news/en/old',
    });
    expect(storyUrl('video', 'v1')).toBe('https://hashfirstglobal.com/video?video=v1');
    expect(articleApiPath('news/a')).toBe('/api/news/article?slug=a&language=en');
    expect(articleApiPath('opinion/a')).toBe('/api/opinion/article?slug=a');
    expect(articleApiPath('sponsored/a')).toBeUndefined();
  });

  it('reads coins and indexes, skipping malformed entries', () => {
    const coins = parsePrices(
      JSON.stringify([
        {
          id: 'bitcoin',
          symbol: 'btc',
          name: 'Bitcoin',
          current_price: 90000,
          market_cap_rank: 1,
          price_change_percentage_24h_in_currency: 1.5,
          sparkline_in_7d: { price: [1, 2, 'x', 3] },
        },
        { id: 'broken', symbol: 'x', name: 'X' },
      ]),
    );
    expect(coins).toHaveLength(1);
    expect(coins[0]).toMatchObject({ symbol: 'BTC', price: 90000, rank: 1, change24h: 1.5, sparkline: [1, 2, 3] });
    const indexes = parseIndexes(
      JSON.stringify({
        indexes: [
          {
            slug: 'hf-top10',
            ticker: 'HF10',
            name: 'HashFirst Top 10',
            market: { currentLevel: 1012.5, change24hPct: -0.4, points: [{ level: 1000 }, { level: 1012.5 }] },
          },
          { slug: 'bad slug', name: 'Nope' },
        ],
      }),
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]).toMatchObject({ ticker: 'HF10', level: 1012.5, change24h: -0.4, points: [1000, 1012.5] });
  });
});

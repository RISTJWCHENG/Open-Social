// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewsPanel } from '../../src/ui/NewsPanel';
import { NewsList } from '../../src/ui/NewsList';
import { NewsArticle } from '../../src/ui/NewsArticle';
import { useNews } from '../../src/ui/useNews';
import { sanitizeArticle } from '../../src/ui/sanitizeArticle';
import type { NewsItem } from '../../src/core/news/news';

const items: NewsItem[] = [
  {
    id: 'a',
    title: 'NNS vote passes',
    protocol: 'Internet Computer',
    source: 'Forum',
    url: 'https://hashfirstglobal.com/a',
    publishedAt: Date.now(),
  },
  {
    id: 'b',
    title: 'Fork scheduled',
    protocol: 'Ethereum',
    url: 'https://hashfirstglobal.com/b',
    publishedAt: Date.now(),
  },
];
const state = { items, fetchedAt: Date.now(), loading: false, error: null, reload: () => undefined };

describe('News', () => {
  it('lists stories like the news site, filters by protocol, date and title, and opens one', () => {
    const onSelect = vi.fn();
    render(<NewsList news={state} selectedId={null} onSelect={onSelect} />);
    expect(document.querySelectorAll('.news-entry')).toHaveLength(2);
    const times = [...document.querySelectorAll('.news-time')].map((t) => t.textContent);
    expect(times.every((t) => /UTC \| just now$/.test(t ?? ''))).toBe(true);
    expect(document.querySelector('.news-by')!.textContent).toContain('Source: Forum');
    fireEvent.click(screen.getByRole('button', { name: 'Choose protocol' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Ethereum/ }));
    expect(document.querySelectorAll('.news-entry')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Choose protocol' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /All Protocols/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    expect(screen.getByRole('menuitemradio', { name: 'Any date' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Any date' }));
    fireEvent.change(screen.getByPlaceholderText('Search ecosystem title...'), { target: { value: 'nns' } });
    expect(document.querySelectorAll('.news-entry')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /NNS vote passes/ }));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('lists the news site sections one under another and switches between them', () => {
    const onSection = vi.fn();
    render(
      <NewsPanel section="ecosystem" onSection={onSection}>
        <p>list</p>
      </NewsPanel>,
    );
    const nav = screen.getByRole('navigation', { name: 'HashFirst Global sections' });
    expect([...nav.children].map((c) => c.textContent)).toEqual([
      'HOME',
      'NEWS',
      'OPINION',
      'ECOSYSTEM',
      'VIDEO',
      'PRICE',
      'INDEX',
      'SPONSORED',
    ]);
    expect(screen.getByRole('button', { name: 'ECOSYSTEM' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'OPINION' }));
    expect(onSection).toHaveBeenCalledWith('opinion');
  });

  it('a section list groups by category and names the section in the byline', () => {
    const opinion = [
      {
        id: 'opinion/a',
        section: 'opinion',
        title: 'Why ICP',
        protocol: 'Analysis',
        url: 'https://hashfirstglobal.com/opinion/a',
        publishedAt: Date.now(),
      },
    ];
    render(
      <NewsList section="opinion" news={{ ...state, items: opinion }} selectedId={null} onSelect={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Choose category' })).toBeInTheDocument();
    expect(document.querySelector('.news-by')!.textContent).toContain('By HashFirstGlobal Opinion');
    expect(screen.getByPlaceholderText('Search opinion title...')).toBeInTheDocument();
  });

  it('a story shows its full text (cleaned), links to the site and can be shared to a chat', async () => {
    const onShare = vi.fn();
    const loadBody = vi.fn(async () =>
      sanitizeArticle(
        '<p>Hello <a href="https://x.example/">there</a><img src="https://t.example/p.png"><script>bad()</script></p><h2>More</h2>',
      ),
    );
    render(
      <NewsArticle
        item={items[0]!}
        chats={[{ account: 'bob', name: 'Bob' }]}
        loadBody={loadBody}
        loadCover={async () => undefined}
        onShare={onShare}
        onBack={() => undefined}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'More' })).toBeInTheDocument();
    const article = document.querySelector('.news-text')!;
    expect(article.querySelector('img, script')).toBeNull();
    expect(article.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('1 min read')).toBeInTheDocument();
    const read = screen.getAllByRole('link', { name: /HashFirst Global/ })[0]!;
    expect(read.getAttribute('href')).toBe('https://hashfirstglobal.com/a');
    expect(read.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: /Share to chat/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Bob/ }));
    expect(onShare).toHaveBeenCalledWith('bob', items[0]);
  });

  it('offers to try again when the text could not be loaded', async () => {
    const loadBody = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce('<p>Back</p>');
    render(
      <NewsArticle
        item={items[0]!}
        chats={[]}
        loadBody={loadBody}
        loadCover={async () => undefined}
        onShare={vi.fn()}
        onBack={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back')).toBeInTheDocument();
  });

  it('refreshes an empty or stale feed when opened', async () => {
    const fetchNews = vi.fn(async (refresh: boolean) => ({
      items: refresh ? items : [],
      fetchedAt: refresh ? Date.now() : 0,
    }));
    const { result } = renderHook(() => useNews(true, fetchNews));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(fetchNews.mock.calls.map((c) => c[0])).toEqual([false, true]);
  });
});

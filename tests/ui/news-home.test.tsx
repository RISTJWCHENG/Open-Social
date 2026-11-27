// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewsHome } from '../../src/ui/NewsHome';
import type { NewsItem } from '../../src/core/news/news';

const at = Date.now() - 2 * 3_600_000;
const story = (section: string, n: number): NewsItem => ({
  id: `${section}/${section}-${n}`,
  section,
  title: `${section} story ${n}`,
  summary: `About ${section} ${n}`,
  url: `https://hashfirstglobal.com/${section}/${section}-${n}`,
  publishedAt: at - n * 60_000,
});
const stories = ['news', 'opinion', 'ecosystem', 'video'].flatMap((s) => [1, 2, 3].map((n) => story(s, n)));

describe('NewsHome', () => {
  it('lays out the front page: latest news, highlights, opinions, ecosystems and videos', () => {
    const onOpen = vi.fn();
    const onSection = vi.fn();
    render(
      <NewsHome
        stories={stories}
        ecosystem={[]}
        loading={false}
        loadCover={async () => undefined}
        onOpen={onOpen}
        onSection={onSection}
      />,
    );
    for (const h of ['Latest Global News', 'Highlights', 'Latest Opinions', 'Latest Ecosystems', 'Latest Videos'])
      expect(screen.getByRole('heading', { name: h })).toBeInTheDocument();
    // The highlights start with the top stories of News, Opinion and Ecosystem.
    expect(document.querySelector('.home-hero-title')!.textContent).toBe('news story 1');
    fireEvent.click(screen.getAllByRole('button', { name: 'opinion story 1' })[0]!);
    expect(onOpen).toHaveBeenCalledWith(stories[3]);
    fireEvent.click(screen.getByRole('button', { name: /News Archive/ }));
    expect(onSection).toHaveBeenCalledWith('news');
  });
});

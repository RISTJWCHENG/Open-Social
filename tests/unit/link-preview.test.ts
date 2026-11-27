import { describe, expect, it } from 'vitest';
import { firstUrl, linkParts, previewHost, sanitizeLinkPreview } from '../../src/core/delivery/linkPreview';

describe('link previews', () => {
  it('finds web addresses in text without trailing punctuation', () => {
    expect(firstUrl('see https://example.com/a?b=1, ok')).toBe('https://example.com/a?b=1');
    expect(firstUrl('(https://en.wikipedia.org/wiki/Foo_(bar))')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(firstUrl('“http://a.example/x.”')).toBe('http://a.example/x');
    expect(firstUrl('no link here, nor http://localhost/x')).toBeUndefined();
    expect(firstUrl('https://user:pw@a.example/')).toBeUndefined();
  });

  it('splits text into plain runs and links', () => {
    expect(linkParts('a https://x.example/1. b https://y.example')).toEqual([
      { text: 'a ' },
      { text: 'https://x.example/1', url: 'https://x.example/1' },
      { text: '. b ' },
      { text: 'https://y.example', url: 'https://y.example' },
    ]);
    expect(linkParts('plain')).toEqual([{ text: 'plain' }]);
  });

  it('shows the host without www', () => {
    expect(previewHost('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('accepts only a titled https preview of the first link in the text, with a small image', () => {
    const body = 'read https://news.example/a';
    expect(sanitizeLinkPreview({ url: 'https://news.example/a', title: '  Big   news ' }, body)).toEqual({
      url: 'https://news.example/a',
      title: 'Big news',
    });
    expect(sanitizeLinkPreview({ url: 'https://other.example/', title: 'x' }, body)).toBeUndefined();
    expect(sanitizeLinkPreview({ url: 'https://news.example/a' }, body)).toBeUndefined();
    expect(sanitizeLinkPreview({ url: 'http://news.example/a', title: 'x' }, 'http://news.example/a')).toBeUndefined();
    // http links in the text are previewed as their https address.
    expect(sanitizeLinkPreview({ url: 'https://news.example/a', title: 'x' }, 'http://news.example/a')?.url).toBe(
      'https://news.example/a',
    );
    const big = 'data:image/webp;base64,' + 'A'.repeat(50_000);
    expect(sanitizeLinkPreview({ url: 'https://news.example/a', title: 'x', image: big }, body)?.image).toBeUndefined();
    expect(
      sanitizeLinkPreview({ url: 'https://news.example/a', title: 'x', image: 'data:image/svg+xml;base64,AAAA' }, body)
        ?.image,
    ).toBeUndefined();
    expect(sanitizeLinkPreview({ url: 'https://news.example/a', title: 't'.repeat(500) }, body)?.title).toHaveLength(
      200,
    );
  });
});

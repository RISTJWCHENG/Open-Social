// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LinkPreviewBar, LinkPreviewCard } from '../../src/ui/LinkPreviewCard';
import { MessageText } from '../../src/ui/MessageText';
import { useLinkDraftPreview } from '../../src/ui/useLinkDraftPreview';
import type { RealMessage } from '../../src/core/delivery/realMessaging';
import type { ChatTranslation } from '../../src/ui/useChatTranslation';

const image = 'data:image/webp;base64,AAAA';
const preview = { url: 'https://www.example.com/a', title: 'A title', description: 'Some words', site: 'Example' };

describe('link previews in the UI', () => {
  it('a card opens the page in a new tab, without referrer, and shows site, title, text and host', () => {
    render(<LinkPreviewCard preview={preview} />);
    const a = screen.getByRole('link');
    expect(a.getAttribute('href')).toBe('https://www.example.com/a');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe('ExampleA titleSome wordsexample.com');
  });

  it('the composer bar loads, then shows the preview, and can be removed', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<LinkPreviewBar url={preview.url} preview={undefined} onRemove={onRemove} />);
    expect(screen.getByRole('status').textContent).toContain('Loading link preview');
    rerender(<LinkPreviewBar url={preview.url} preview={preview} onRemove={onRemove} />);
    expect(screen.getByRole('status').textContent).toContain('A title');
    fireEvent.click(screen.getByRole('button', { name: 'Remove link preview' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('links in message text are clickable', () => {
    const m = {
      id: '1',
      direction: 'in',
      body: 'go to https://x.example/p. now',
      sentAt: 0,
      status: 'delivered',
      verified: true,
    } as RealMessage;
    const translation = { of: () => undefined } as unknown as ChatTranslation;
    render(<MessageText m={m} translation={translation} search="" />);
    const a = screen.getByRole('link');
    expect(a.textContent).toBe('https://x.example/p');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('looks up the first link after a pause, hands it to send, and remembers a removed one', async () => {
    vi.useFakeTimers();
    try {
      const fetchPreview = vi.fn(async () => ({ preview, imageUrl: 'https://www.example.com/i.png' }));
      const fetchImage = vi.fn(async () => image);
      const full = { ...preview, image };
      const { result, rerender } = renderHook(({ d }) => useLinkDraftPreview(d, true, fetchPreview, fetchImage), {
        initialProps: { d: 'hi https://www.example.com/a' },
      });
      expect(result.current.shown).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(fetchPreview).toHaveBeenCalledWith('https://www.example.com/a');
      expect(fetchImage).toHaveBeenCalledWith('https://www.example.com/i.png');
      expect(result.current.shown).toEqual({ url: preview.url, preview: full });
      await expect(result.current.take('hi https://www.example.com/a')).resolves.toEqual(full);
      // Sent: the draft is emptied, then the same link is typed again.
      rerender({ d: '' });
      rerender({ d: 'again https://www.example.com/a' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(result.current.shown?.preview).toEqual(full);
      // Removed: it stays away for that link.
      act(() => result.current.dismiss());
      expect(result.current.shown).toBeNull();
      await expect(result.current.take('again https://www.example.com/a')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

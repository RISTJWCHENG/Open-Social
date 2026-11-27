// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmojiPicker } from '../../src/ui/emoji/EmojiPicker';
import data from '../../src/ui/emoji/emojiData.json';

const setup = (recent: string[] = []) => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<EmojiPicker recent={recent} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
};

describe('Emoji data', () => {
  it('covers every category in Unicode order, with names and keywords', () => {
    const rows = data as [string, string, string, number, string?][];
    expect(rows.length).toBeGreaterThan(1500);
    expect(new Set(rows.map((r) => r[3]))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(rows[0]![0]).toBe('😀');
    expect(rows.find((r) => r[0] === '🇧🇪')).toEqual(['🇧🇪', 'Belgium', expect.stringContaining('be'), 7, 'BE']);
  });

  it('flags are countries and regions only, sorted by name, each with a code', () => {
    const flags = (data as [string, string, string, number, string?][]).filter((r) => r[3] === 7);
    expect(flags.length).toBeGreaterThan(250);
    for (const f of flags) expect(f[4]).toMatch(/^[A-Z]{2,3}$/);
    const symbolFlags = ['🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️'];
    expect(flags.filter((f) => symbolFlags.includes(f[0]))).toEqual([]);
    expect((data as [string][]).filter((r) => symbolFlags.includes(r[0]))).toEqual([]);
    const names = flags.map((f) => f[1]);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('Emoji picker', () => {
  it('shows category tabs, every category section and the bottom tabs', async () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Emoji, GIFs and stickers' });
    const cats = within(screen.getByRole('tablist', { name: 'Emoji categories' })).getAllByRole('tab');
    expect(cats.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Smileys & people',
      'Animals & nature',
      'Food & drink',
      'Activity',
      'Travel & places',
      'Objects',
      'Symbols',
      'Flags',
    ]);
    await within(dialog).findByRole('button', { name: 'grinning face' });
    expect(within(dialog).getByRole('region', { name: 'Flags' })).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: 'Emoji, GIFs or stickers' })).getAllByRole('tab')).toHaveLength(3);
  });

  it('inserts what is clicked, searches by name and keyword, and shows recents first', async () => {
    const { onPick } = setup(['🎉']);
    await screen.findByRole('button', { name: 'grinning face' });
    expect(screen.getAllByRole('tab', { name: 'Recent' })).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Recent' })).getByRole('button')).toHaveTextContent('🎉');
    await userEvent.click(screen.getByRole('button', { name: 'grinning face' }));
    expect(onPick).toHaveBeenCalledWith('😀');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search emoji' }), 'red heart');
    const results = screen.getByRole('region', { name: 'Search results' });
    expect(within(results).getByRole('button', { name: 'red heart' })).toHaveTextContent('❤️');
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search emoji' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search emoji' }), 'zzzqqq');
    expect(screen.getByText('No emoji found')).toBeInTheDocument();
  });

  it('shows flags with their country code and finds them by code', async () => {
    setup();
    const flags = await screen.findByRole('region', { name: 'Flags' });
    const be = within(flags).getByRole('button', { name: 'Flag: Belgium' });
    expect(be).toHaveTextContent('🇧🇪BE');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search emoji' }), 'cn');
    expect(within(screen.getByRole('region', { name: 'Search results' })).getByRole('button', { name: 'Flag: China' })).toBeInTheDocument();
  });

  it('GIF and sticker tabs say they are coming; Escape closes the panel', async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole('tab', { name: 'GIFs' }));
    expect(screen.getByText('GIFs are coming soon')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }));
    expect(screen.getByText('Stickers are coming soon')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

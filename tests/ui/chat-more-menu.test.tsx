// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMoreMenu, type ChatMoreState } from '../../src/ui/ChatMoreMenu';

const base: ChatMoreState = { favorite: false, muted: false, translateTo: null, canTranslate: true };

function setup(state: Partial<ChatMoreState> = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(<ChatMoreMenu state={{ ...base, ...state }} anchor={anchor} onAction={onAction} onClose={onClose} />);
  return { onAction, onClose };
}

describe('ChatMoreMenu', () => {
  it('adds to and removes from favourites', async () => {
    const { onAction, onClose } = setup();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to Favorites' }));
    expect(onAction).toHaveBeenCalledWith({ favorite: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Remove from Favorites for a favourite chat', () => {
    setup({ favorite: true });
    expect(screen.getByRole('menuitem', { name: 'Remove from Favorites' })).toBeInTheDocument();
  });

  it('chooses a translation language, and stops translating', async () => {
    const { onAction } = setup({ translateTo: 'en' });
    await userEvent.click(screen.getByRole('menuitem', { name: /Translate this chat/ }));
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('menuitemradio', { name: '中文（简体）' }));
    expect(onAction).toHaveBeenCalledWith({ translateTo: 'zh' });
  });

  it('turns translation off', async () => {
    const { onAction } = setup({ translateTo: 'en' });
    await userEvent.click(screen.getByRole('menuitem', { name: /Translate this chat/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Stop translating' }));
    expect(onAction).toHaveBeenCalledWith({ translateTo: null });
  });

  it('explains when the browser cannot translate', async () => {
    setup({ canTranslate: false });
    await userEvent.click(screen.getByRole('menuitem', { name: /Translate this chat/ }));
    expect(screen.getByText(/needs Chrome or Edge on a computer/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('mutes for a while, goes back, and unmutes', async () => {
    const { onAction } = setup();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mute notifications' }));
    await userEvent.click(screen.getByRole('menuitem', { name: '8 hours' }));
    expect(onAction).toHaveBeenCalledWith({ mute: 8 * 3_600_000 });
  });

  it('back returns to the main items', async () => {
    setup();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mute notifications' }));
    await userEvent.click(screen.getAllByRole('menuitem', { name: 'Mute notifications' })[0]!);
    expect(screen.getByRole('menuitem', { name: 'Add to Favorites' })).toBeInTheDocument();
  });

  it('offers unmute for a muted chat', async () => {
    const { onAction } = setup({ muted: true });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unmute notifications' }));
    expect(onAction).toHaveBeenCalledWith({ unmute: true });
  });
});

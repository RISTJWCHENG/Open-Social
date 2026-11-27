// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatMenu, type ChatMenuState } from '../../src/ui/ChatMenu';

const base: ChatMenuState = { archived: false, pinned: false, muted: false, favorite: false, unread: false, self: false };
const open = (state: Partial<ChatMenuState> = {}) => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(<ChatMenu state={{ ...base, ...state }} anchor={anchor} onAction={onAction} onClose={onClose} />);
  return { onAction, onClose };
};
const labels = () =>
  within(screen.getByRole('menu', { name: 'Chat options' }))
    .getAllByRole('menuitem')
    .map((i) => i.textContent);

describe('Chat options menu', () => {
  it('lists the options in English, in order', () => {
    open();
    expect(labels()).toEqual([
      'Archive chat',
      'Mute notifications',
      'Pin chat',
      'Mark as unread',
      'Add to Favorites',
      'Add to list',
      'Block',
      'Clear chat',
      'Delete chat',
    ]);
  });

  it('offers the opposite actions for a pinned, muted, favourite, unread chat; archived chats can’t be pinned', () => {
    open({ pinned: true, muted: true, favorite: true, unread: true });
    expect(labels()).toEqual(expect.arrayContaining(['Unpin chat', 'Unmute notifications', 'Mark as read', 'Remove from Favorites']));
  });

  it('archived chat: Unarchive, no pin', () => {
    open({ archived: true });
    expect(labels()).toContain('Unarchive chat');
    expect(labels().some((l) => l?.includes('Pin'))).toBe(false);
  });

  it('notes to yourself: only Clear chat', () => {
    open({ self: true });
    expect(labels()).toEqual(['Clear chat']);
  });

  it('mute opens durations; choosing one acts and closes', async () => {
    const { onAction, onClose } = open();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mute notifications' }));
    const sub = screen.getByRole('menu', { name: 'Mute for' });
    expect(within(sub).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['8 hours', '1 week', 'Always']);
    await userEvent.click(within(sub).getByRole('menuitem', { name: '1 week' }));
    expect(onAction).toHaveBeenCalledWith({ mute: 7 * 24 * 3_600_000 });
    expect(onClose).toHaveBeenCalled();
  });

  it('add to list says it is coming; Escape closes', async () => {
    const { onAction, onClose } = open();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to list' }));
    const lists = screen.getByRole('menu', { name: 'Lists' });
    expect(lists).toHaveTextContent('New list');
    expect(within(lists).getByText('Soon')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });
});

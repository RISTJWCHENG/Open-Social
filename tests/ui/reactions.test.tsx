// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ReactionBadge,
  ReactionPicker,
  ReactionRow,
  quickReactions,
  withRecentReaction,
} from '../../src/ui/Reactions';

describe('Reactions', () => {
  it('the quick row shows the five most recent reactions, topped up with the defaults', () => {
    expect(quickReactions([])).toEqual(['👍', '❤️', '😂', '😮', '😢']);
    expect(quickReactions(['🔥', '👍'])).toEqual(['🔥', '👍', '❤️', '😂', '😮']);
    expect(quickReactions(['1', '2', '3', '4', '5', '6'])).toEqual(['1', '2', '3', '4', '5']);
    expect(withRecentReaction(['👍', '🔥'], '🔥')).toEqual(['🔥', '👍']);
  });

  it('the grey 😊 opens every emoji, before the recent reactions', async () => {
    const onMore = vi.fn();
    render(<ReactionRow recent={['🔥']} onToggle={vi.fn()} onMore={onMore} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'More reactions',
      'React 🔥',
      'React 👍',
      'React ❤️',
      'React 😂',
      'React 😮',
    ]);
    await userEvent.click(buttons[0]!);
    expect(onMore).toHaveBeenCalledWith(buttons[0]);
  });

  it('the quick row adds an emoji, and takes back one of ours', async () => {
    const onToggle = vi.fn();
    render(<ReactionRow mine={['❤️']} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: 'React 👍' }));
    expect(onToggle).toHaveBeenLastCalledWith('👍', true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove reaction ❤️' }));
    expect(onToggle).toHaveBeenLastCalledWith('❤️', false);
  });

  it('the picker closes after a pick and on Escape', async () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    render(<ReactionPicker onToggle={onToggle} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'React 😂' }));
    expect(onToggle).toHaveBeenCalledWith('😂', true);
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows each emoji once, counts one both added, and toggles ours', async () => {
    const onToggle = vi.fn();
    render(<ReactionBadge reactions={{ me: ['👍', '❤️'], them: ['👍', '😂'] }} theirName="Bob" onToggle={onToggle} />);
    const chips = screen.getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['👍2', '😂', '❤️']);
    await userEvent.click(screen.getByRole('button', { name: /^😂/ }));
    expect(onToggle).toHaveBeenLastCalledWith('😂', true);
    await userEvent.click(screen.getByRole('button', { name: /^❤️/ }));
    expect(onToggle).toHaveBeenLastCalledWith('❤️', false);
  });
});

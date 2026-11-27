// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatToolbar, highlight } from '../../src/ui/ChatToolbar';

const search = (over = {}) => ({
  open: false,
  query: '',
  count: 0,
  index: 0,
  onOpen: vi.fn(),
  onClose: vi.fn(),
  onQuery: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  ...over,
});

describe('Chat toolbar', () => {
  it('can be tucked away, but stays while its menu is open', async () => {
    const more = { state: { favorite: false, muted: false, translateTo: null, canTranslate: false }, onAction: vi.fn() };
    const { rerender } = render(<ChatToolbar search={search()} more={more} hidden />);
    const bar = screen.getByRole('toolbar', { hidden: true });
    expect(bar).toHaveClass('is-hidden');
    rerender(<ChatToolbar search={search()} more={more} hidden={false} />);
    expect(bar).not.toHaveClass('is-hidden');
    await userEvent.click(screen.getByRole('button', { name: 'More options' }));
    rerender(<ChatToolbar search={search()} more={more} hidden />);
    expect(bar).not.toHaveClass('is-hidden');
  });

  it('puts contact info just before the ⋮ menu, at the right end', async () => {
    const onToggle = vi.fn();
    render(
      <ChatToolbar
        search={search()}
        info={{ open: true, onToggle }}
        more={{ state: { favorite: false, muted: false, translateTo: null, canTranslate: false }, onAction: vi.fn() }}
      />,
    );
    const labels = within(screen.getByRole('toolbar', { name: 'Chat actions' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels.slice(-2)).toEqual(['Contact info', 'More options']);
    const info = screen.getByRole('button', { name: 'Contact info' });
    expect(info).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(info);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows shared media after the highlights, pressed while it is showing', async () => {
    const onToggle = vi.fn();
    render(
      <ChatToolbar
        search={search()}
        highlights={{ count: 0, open: false, onToggle: vi.fn() }}
        shared={{ open: true, onToggle }}
        info={{ open: false, onToggle: vi.fn() }}
      />,
    );
    const labels = within(screen.getByRole('toolbar', { name: 'Chat actions' }))
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Search this chat', 'Highlighted messages (0)', 'Media, files and links', 'Contact info']);
    const shared = screen.getByRole('button', { name: 'Media, files and links' });
    expect(shared).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(shared);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows search, highlights, voice and video icons; each acts', async () => {
    const onCall = vi.fn();
    const onToggle = vi.fn();
    const s = search();
    render(<ChatToolbar onCall={onCall} highlights={{ count: 0, open: false, onToggle }} search={s} />);
    const bar = screen.getByRole('toolbar', { name: 'Chat actions' });
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Search this chat',
      'Highlighted messages (0)',
      'Voice call',
      'Video call',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Highlighted messages (0)' }));
    expect(onToggle).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Video call' }));
    expect(onCall).toHaveBeenCalledWith('video');
    await userEvent.click(screen.getByRole('button', { name: 'Search this chat' }));
    expect(s.onOpen).toHaveBeenCalled();
  });

  it('the star shows how many messages are highlighted, pressed while they are shown', () => {
    render(<ChatToolbar highlights={{ count: 2, open: true, onToggle: vi.fn() }} search={search()} />);
    const star = screen.getByRole('button', { name: 'Highlighted messages (2)' });
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toHaveTextContent('2');
  });

  it('notes to yourself: search only', () => {
    render(<ChatToolbar search={search()} />);
    expect(within(screen.getByRole('toolbar')).getAllByRole('button')).toHaveLength(1);
  });

  it('searching: only the oval box, other icons gone; counts, Enter / Shift+Enter, Escape', async () => {
    const s = search({ open: true, query: 'sia', count: 3, index: 1 });
    render(<ChatToolbar onCall={vi.fn()} highlights={{ count: 0, open: false, onToggle: vi.fn() }} search={s} />);
    expect(screen.queryByRole('button', { name: /Highlighted messages/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Video call' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search this chat' })).toHaveFocus();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(s.onNext).toHaveBeenCalled();
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(s.onPrev).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous result' }));
    await userEvent.keyboard('{Escape}');
    expect(s.onClose).toHaveBeenCalled();
  });

  it('says when nothing matches', () => {
    render(<ChatToolbar search={search({ open: true, query: 'zzz', count: 0 })} />);
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next result' })).toBeDisabled();
  });

  it('marks every match, case-insensitively', () => {
    const { container } = render(<p>{highlight('Save to my Sia, said Sia', 'sia')}</p>);
    expect([...container.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Sia', 'Sia']);
    expect(container.textContent).toBe('Save to my Sia, said Sia');
  });
});

describe('Chat toolbar on phones', () => {
  const more = () => ({ state: { favorite: false, muted: false, translateTo: null, canTranslate: false }, onAction: vi.fn() });

  it('is one round button that drops the actions down, in order, and closes on a choice', async () => {
    const onCall = vi.fn();
    const s = search();
    render(
      <ChatToolbar
        compact
        search={s}
        onCall={onCall}
        highlights={{ count: 2, open: false, onToggle: vi.fn() }}
        info={{ open: false, onToggle: vi.fn() }}
        more={more()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Search this chat' })).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Chat actions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    const column = screen.getByRole('toolbar', { name: 'Chat actions' });
    expect(within(column).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Search this chat',
      'Highlighted messages (2)',
      'Voice call',
      'Video call',
      'Contact info',
      'More options',
    ]);
    expect(screen.getByRole('button', { name: 'Close chat actions' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Video call' }));
    expect(onCall).toHaveBeenCalledWith('video');
    expect(screen.queryByRole('toolbar', { name: 'Chat actions' })).toBeNull();
  });

  it('closes on a tap elsewhere', async () => {
    render(
      <>
        <p>outside</p>
        <ChatToolbar compact search={search()} />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    expect(screen.getByRole('toolbar', { name: 'Chat actions' })).toBeInTheDocument();
    await userEvent.click(screen.getByText('outside'));
    expect(screen.queryByRole('toolbar', { name: 'Chat actions' })).toBeNull();
  });

  it('tucks away while reading down, but not while open', async () => {
    const { container, rerender } = render(<ChatToolbar compact search={search()} hidden />);
    const fab = container.querySelector('.chat-fab')!;
    expect(fab).toHaveClass('is-hidden');
    rerender(<ChatToolbar compact search={search()} hidden={false} />);
    expect(fab).not.toHaveClass('is-hidden');
    await userEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    rerender(<ChatToolbar compact search={search()} hidden />);
    expect(fab).not.toHaveClass('is-hidden');
  });

  it('keeps the column open while the ⋮ menu is open', async () => {
    const m = more();
    render(<ChatToolbar compact search={search()} more={m} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    await userEvent.click(screen.getByRole('button', { name: 'More options' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Chat actions' })).toBeInTheDocument();
  });
});

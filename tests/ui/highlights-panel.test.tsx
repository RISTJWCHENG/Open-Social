// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HighlightsPanel } from '../../src/ui/HighlightsPanel';
import type { RealMessage } from '../../src/core/delivery/realMessaging';

const msg = (id: string, sentAt: number, over: Partial<RealMessage>): RealMessage =>
  ({ id, direction: 'in', body: '', sentAt, status: 'delivered', verified: true, highlightedAt: 1, ...over }) as RealMessage;

const props = (messages: RealMessage[]) => ({
  me: { name: 'Ada', avatar: 'data:image/webp;base64,TUU=' },
  them: { name: 'Unbreakable', avatar: 'data:image/webp;base64,VEhFTQ==' },
  messages,
  renderAttachment: (m: RealMessage) => (m.attachment ? <div data-testid="attachment">{m.attachment.name}</div> : null),
  onJump: vi.fn(),
  onRemove: vi.fn(),
  bar: <div data-testid="bar" />,
});

describe('Highlighted messages panel', () => {
  it('shows each message as in the chat: sender photo, bubble, attachment view, newest last', async () => {
    const p = props([
      msg('a', 1_000, { body: 'old one' }),
      msg('b', 2_000, {
        direction: 'out',
        attachment: { fileId: 'e'.repeat(24), name: 'voice.webm', mime: 'audio/webm', size: 9000, via: 'inline', state: 'ready', done: 1, total: 1, voice: { ms: 4000, wave: '' } },
      }),
      msg('c', 3_000, { body: 'newest' }),
    ]);
    render(<HighlightsPanel {...p} />);
    const items = within(screen.getByRole('complementary', { name: 'Highlighted messages' })).getAllByRole('listitem');
    expect(items.map((i) => i.querySelector('.bubble')!.textContent)).toEqual(['old one', 'voice.webm', 'newest']);
    // The sender's photo and name on the date line; your own messages on the right side.
    expect(items[0]!.querySelector('.highlights-meta img.highlights-avatar')).toHaveAttribute('src', 'data:image/webp;base64,VEhFTQ==');
    expect(items[1]!.querySelector('.highlights-meta img.highlights-avatar')).toHaveAttribute('src', 'data:image/webp;base64,TUU=');
    expect(items[1]!.querySelector('.message')).toHaveClass('out');
    expect(within(items[1]!).getByTestId('attachment')).toBeInTheDocument(); // the chat's own attachment view
    expect(items[1]).toHaveTextContent('Ada');
    expect(items[0]).toHaveTextContent('Unbreakable');
    await userEvent.click(within(items[2]!).getByRole('button', { name: 'Show in chat' }));
    expect(p.onJump).toHaveBeenCalledWith('c');
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Remove highlight' }));
    expect(p.onRemove).toHaveBeenCalledWith('a');
  });

  it('says how to highlight when nothing is highlighted', () => {
    render(<HighlightsPanel {...props([])} />);
    expect(screen.getByText('No highlighted messages')).toBeInTheDocument();
  });
});

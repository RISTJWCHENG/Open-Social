// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ComposerActions } from '../../src/ui/ComposerActions';

function Harness() {
  const [draft, setDraft] = useState('');
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <input aria-label="Message" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <ComposerActions hasText={!!draft.trim()} />
    </form>
  );
}

describe('Composer actions', () => {
  it('shows ⋮ when empty and the send button only while there is text', async () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Send encrypted' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'hi');
    expect(screen.getByRole('button', { name: 'Send encrypted' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    await userEvent.clear(screen.getByLabelText('Message'));
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), '   ');
    expect(screen.queryByRole('button', { name: 'Send encrypted' })).toBeNull(); // spaces only
  });

  it('opens a menu with Send Crypto, marked as coming soon; Escape closes it', async () => {
    render(<Harness />);
    const more = screen.getByRole('button', { name: 'More options' });
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'More options' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Send CryptoSoon']);
    for (const i of items) expect(i).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes the menu when the user starts typing', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'More options' }));
    await userEvent.type(screen.getByLabelText('Message'), 'x');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

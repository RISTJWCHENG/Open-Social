// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpPage } from '../../src/ui/SignUpPage';
import type { PublicProfile } from '../../src/modules/profiles/profilesClient';

const person = (username: string, displayName: string): PublicProfile => ({
  account: `${username}-principal`,
  username,
  displayName,
  bio: '',
  links: [],
  avatarHash: null,
});

describe('SignUpPage', () => {
  it('rejects invalid usernames and taken ones, ignoring case', async () => {
    const profiles = {
      search: vi.fn(async (q: string) => (q.toLowerCase() === 'alice' ? [person('alice', 'Alice')] : [])),
      getPublicAvatar: async () => null,
    };
    render(<SignUpPage busy={false} onSubmit={vi.fn()} onClose={vi.fn()} profiles={profiles} />);
    const name = screen.getByRole('textbox', { name: /Username/ });
    await userEvent.type(name, 'a');
    expect(screen.getByText(/2–20 characters/)).toBeInTheDocument();
    await userEvent.clear(name);
    // Latin "p" with a Cyrillic "а": a look-alike of "paypal".
    await userEvent.type(name, 'p\u0430ypal');
    expect(screen.getByText(/one writing system/)).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'Alice');
    expect(await screen.findByText('This username is taken.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await userEvent.type(name, '2');
    expect(await screen.findByText('Available.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('keeps the case and accepts any language', async () => {
    const onSubmit = vi.fn();
    const profiles = { search: vi.fn(async () => []), getPublicAvatar: async () => null };
    render(<SignUpPage busy={false} onSubmit={onSubmit} onClose={vi.fn()} profiles={profiles} />);
    const name = screen.getByRole('textbox', { name: /Username/ });
    await userEvent.type(name, '王小明');
    expect(await screen.findByText('Available.')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'Rist.Cheng');
    expect(await screen.findByText('Available.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).toHaveBeenCalledWith({ username: 'Rist.Cheng', displayName: 'Rist.Cheng', email: '', inviter: null });
  });

  it('submits the username, display name and the chosen inviter', async () => {
    const profiles = {
      search: vi.fn(async (q: string) => (q.startsWith('b') ? [person('bob', 'Bob Lee'), person('bella', 'Bella Ray')] : [])),
      getPublicAvatar: async () => null,
    };
    const onSubmit = vi.fn();
    render(<SignUpPage busy={false} onSubmit={onSubmit} onClose={vi.fn()} profiles={profiles} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Username/ }), 'carol');
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Display name/ }), 'Carol');
    const search = screen.getByRole('textbox', { name: /Did someone invite you/ });
    await userEvent.type(search, 'b');
    const list = await screen.findByRole('list', { name: 'People found' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText('B', { selector: 'strong' })).toHaveLength(2);
    await userEvent.click(within(list).getByRole('button', { name: /Bob Lee/ }));
    expect(screen.getByText('@bob')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).toHaveBeenCalledWith({
      username: 'carol',
      displayName: 'Carol',
      email: '',
      inviter: { account: 'bob-principal', name: 'Bob Lee' },
    });
  });

  it('uses the username as display name when none is given, and closes with Back', async () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    render(<SignUpPage busy={false} onSubmit={onSubmit} onClose={onClose} profiles={{ search: async () => [], getPublicAvatar: async () => null }} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Username/ }), 'dave');
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).toHaveBeenCalledWith({ username: 'dave', displayName: 'dave', email: '', inviter: null });
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign-in' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('checks the optional email and passes it on', async () => {
    const onSubmit = vi.fn();
    render(<SignUpPage busy={false} onSubmit={onSubmit} onClose={vi.fn()} profiles={{ search: async () => [], getPublicAvatar: async () => null }} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Username/ }), 'erin');
    await userEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    const email = screen.getByRole('textbox', { name: /Email address/ });
    await userEvent.type(email, 'erin@');
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await userEvent.type(email, 'example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(onSubmit).toHaveBeenCalledWith({ username: 'erin', displayName: 'erin', email: 'erin@example.com', inviter: null });
  });

  it('opens the terms and agreeing ticks the box', async () => {
    render(<SignUpPage busy={false} onSubmit={vi.fn()} onClose={vi.fn()} profiles={{ search: async () => [], getPublicAvatar: async () => null }} />);
    await userEvent.click(screen.getByRole('button', { name: 'OpenSocial terms & conditions' }));
    const terms = screen.getByRole('dialog', { name: 'OpenSocial Terms and Conditions' });
    expect(terms).toHaveTextContent('Acceptable use');
    await userEvent.click(screen.getByRole('button', { name: 'Agree' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('checkbox', { name: /I agree/ })).toBeChecked();
  });

  it('says when nobody matches and clears the search', async () => {
    render(
      <SignUpPage
        busy={false}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
        profiles={{ search: async () => [], getPublicAvatar: async () => null }}
      />,
    );
    const search = screen.getByRole('textbox', { name: /Did someone invite you/ });
    await userEvent.type(search, 'z');
    expect(await screen.findByText('No public profiles match “z”.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(search).toHaveValue('');
    expect(screen.queryByText(/No public profiles match/)).toBeNull();
  });

  it('opening the terms takes focus off the username field (no phone keyboard)', async () => {
    const profiles = { search: vi.fn(async () => []), getPublicAvatar: async () => null };
    render(<SignUpPage busy={false} onSubmit={vi.fn()} onClose={vi.fn()} profiles={profiles} />);
    const name = screen.getByRole('textbox', { name: /Username/ });
    expect(name).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /terms/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(name).not.toHaveFocus();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactsPanel } from '../../src/ui/ContactsPanel';
import type { RealContact } from '../../src/core/delivery/realMessaging';

const c = (account: string, name: string, extra: Partial<RealContact> & { username?: string } = {}): RealContact => {
  const { username, ...rest } = extra;
  return { account, name, known: true, addedAt: 0, ...(username ? { profile: { username } } : {}), ...rest } as RealContact;
};

const setup = (over: Partial<Parameters<typeof ContactsPanel>[0]> = {}) => {
  const props = {
    myAccount: 'me-account-id',
    contacts: [
      c('aaaaa-1', 'Bob', { favorite: true }),
      c('bbbbb-2', 'alice', { username: 'alice', nickname: 'alice' }),
      c('ccccc-3', 'Émile'),
      c('ddddd-4', '9lives'),
      c('eeeee-5', 'Stranger', { known: false }),
    ],
    blocked: [c('fffff-6', 'Spammer', { blocked: true })],
    ready: true,
    profiles: null,
    isActive: (a: string) => a === 'aaaaa-1',
    onAdd: vi.fn(async () => {}),
    onOpen: vi.fn(),
    onProfile: vi.fn(),
    onAccept: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onFavorite: vi.fn(async () => {}),
    onRemove: vi.fn(),
    onBlock: vi.fn(),
    onUnblock: vi.fn(async () => {}),
    groups: [],
    onNewGroup: vi.fn(),
    ...over,
  };
  render(<ContactsPanel {...props} />);
  return props;
};
const friends = () => screen.getByRole('region', { name: 'Friends' });

describe('Contacts panel', () => {
  it('lists requests, favourites, friends A–Z with counts, and shows who is active', () => {
    setup();
    expect(within(friends()).getByText('Friends · 4')).toBeInTheDocument();
    expect([...friends().querySelectorAll('.contacts-letter')].map((e) => e.textContent)).toEqual(['A', 'B', 'E', '#']);
    expect(within(friends()).getByText('@alice')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Requests' })).getByText('Stranger')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Favorites' })).getByText('Bob')).toBeInTheDocument();
    expect(within(friends()).getAllByRole('img', { name: 'Active now' })).toHaveLength(1);
  });

  it('sorts friends Z–A, by latest chat or newest, remembers it, and jumps by letter', async () => {
    localStorage.clear();
    const lastChatAt = (a: string) => ({ 'ccccc-3': 20, 'ddddd-4': 10 })[a];
    setup({ lastChatAt });
    const names = () => [...friends().querySelectorAll('.contact-name .name-text')].map((e) => e.textContent);
    expect(screen.getByRole('navigation', { name: 'Jump to letter' })).toBeInTheDocument();
    await userEvent.click(within(friends()).getByRole('button', { name: 'Sort: Name (A–Z)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Name (Z–A)' }));
    expect(names()).toEqual(['Émile', 'Bob', 'alice', '9lives']);
    await userEvent.click(within(friends()).getByRole('button', { name: 'Sort: Name (Z–A)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Recent chats' }));
    expect(names()).toEqual(['Émile', '9lives', 'alice', 'Bob']);
    expect(friends().querySelector('.contacts-letter')).toBeNull(); // no letters out of name order
    expect(localStorage.getItem('contacts-sort')).toBe('recent-chat');
    localStorage.clear();
  });

  it('each friend has a menu: message, profile, rename, favourite, remove, block', async () => {
    const p = setup();
    await userEvent.click(within(friends()).getByRole('button', { name: 'Options for Émile' }));
    const menu = screen.getByRole('menu', { name: 'Options for Émile' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Message',
      'View profile',
      'Rename',
      'Add to Favorites',
      'Remove contact',
      'Block',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'View profile' }));
    expect(p.onProfile).toHaveBeenCalledWith('ccccc-3');
    await userEvent.click(within(friends()).getByRole('button', { name: 'Options for Émile' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to Favorites' }));
    expect(p.onFavorite).toHaveBeenCalledWith('ccccc-3', true);
    await userEvent.click(within(friends()).getByRole('button', { name: 'Options for Émile' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove contact' }));
    expect(p.onRemove).toHaveBeenCalledWith('ccccc-3');
  });

  it('a favourite listed twice opens one menu, on the row used', async () => {
    setup();
    const fav = screen.getByRole('region', { name: 'Favorites' });
    await userEvent.click(within(fav).getByRole('button', { name: 'Options for Bob' }));
    expect(screen.getAllByRole('menu', { name: 'Options for Bob' })).toHaveLength(1);
    expect(within(friends()).getByRole('button', { name: 'Options for Bob' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renames a contact', async () => {
    const p = setup();
    await userEvent.click(within(friends()).getByRole('button', { name: 'Options for 9lives' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename 9lives' });
    const input = within(dialog).getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Nina{Enter}');
    expect(p.onRename).toHaveBeenCalledWith('ddddd-4', 'Nina');
  });

  it('requests: accept or block; blocked: unblock', async () => {
    const p = setup();
    const req = screen.getByRole('region', { name: 'Requests' });
    await userEvent.click(within(req).getByRole('button', { name: 'Accept' }));
    expect(p.onAccept).toHaveBeenCalledWith('eeeee-5');
    await userEvent.click(within(req).getByRole('button', { name: 'Block' }));
    expect(p.onBlock).toHaveBeenCalledWith('eeeee-5');
    const blocked = screen.getByRole('region', { name: 'Blocked' });
    await userEvent.click(within(blocked).getByRole('button', { name: /Blocked · 1/ }));
    await userEvent.click(within(blocked).getByRole('button', { name: 'Unblock' }));
    expect(p.onUnblock).toHaveBeenCalledWith('fffff-6');
  });

  it('searches by name, @username or ID', async () => {
    setup();
    expect(screen.getByRole('searchbox', { name: 'Search people' })).toHaveAttribute('placeholder', 'Search people...');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search people' }), '@ali');
    expect([...friends().querySelectorAll('.contact-name')].map((e) => e.textContent)).toEqual(['alice']);
  });

  it('adds by ID (not your own) and offers to say hello; the form shows no share card', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add person' }));
    expect(screen.queryByRole('img', { name: 'QR code to add you on OpenSocial' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Their OpenSocial ID'), 'me-account-id');
    await userEvent.click(screen.getByRole('button', { name: 'Add to contacts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That is your own OpenSocial ID.');
    await userEvent.clear(screen.getByLabelText('Their OpenSocial ID'));
    await userEvent.type(screen.getByLabelText('Their OpenSocial ID'), 'zzzzz-9');
    await userEvent.type(screen.getByLabelText('Nickname (optional, only you see it)'), 'Zoe');
    await userEvent.click(screen.getByRole('button', { name: 'Add to contacts' }));
    expect(p.onAdd).toHaveBeenCalledWith('zzzzz-9', 'Zoe');
    expect(await screen.findByRole('status')).toHaveTextContent('Zoe is now in your contacts.');
    await userEvent.click(screen.getByRole('button', { name: 'Say hello' }));
    expect(p.onOpen).toHaveBeenCalledWith('zzzzz-9');
  });

  it('switches between people, groups and communities; + offers friend, group and community', async () => {
    setup();
    const tabs = within(screen.getByRole('tablist', { name: 'Show' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['People', 'Groups', 'Communities']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(tabs[1]!);
    // The title stays Contacts; the list below changes.
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search groups...');
    expect(screen.getByText(/No groups yet/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Friends' })).toBeNull();
    await userEvent.click(tabs[2]!);
    expect(screen.getByText('No communities yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const menu = screen.getByRole('menu', { name: 'Add' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Add person',
      'New group',
      'New communitySoon',
    ]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add person' }));
    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByLabelText('Their OpenSocial ID')).toBeInTheDocument();
  });

  it('lists groups (invitations first) and starts a new one', async () => {
    const props = setup({
      groups: [
        { key: 'g:0000000000000001', name: 'Book club', members: 5, left: false, request: false },
        { key: 'g:0000000000000002', name: 'Neighbours', members: 12, left: false, request: true },
        { key: 'g:0000000000000003', name: 'Old team', members: 3, left: true, request: false },
      ],
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    const panel = screen.getByRole('tabpanel', { name: 'Groups' });
    // Each row: the avatar's letter, the name, then the line below it.
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'NNeighboursInvitation',
      'BBook club5 members',
      'OOld teamYou left',
    ]);
    await userEvent.click(within(panel).getByRole('button', { name: /Book club/ }));
    expect(props.onOpen).toHaveBeenCalledWith('g:0000000000000001');
    await userEvent.click(within(panel).getByRole('button', { name: /New group/ }));
    expect(props.onNewGroup).toHaveBeenCalled();
  });

  it('an opened invite link fills in the ID', () => {
    setup({ prefillId: 'invited-account-id' });
    expect(screen.getByLabelText('Their OpenSocial ID')).toHaveValue('invited-account-id');
  });
});

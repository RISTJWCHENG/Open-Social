/**
 * The address book, opened from the left rail.
 * - Add contact: search public profiles, or an OpenSocial ID with a private name.
 * - Share your contact: a QR code and an invite link that opens "Add contact"
 *   with your ID filled in.
 * - Search (name, @username, location, ID); People / Groups / Communities.
 * - Requests (accept / block), Favorites, every friend (a green dot when
 *   active in the last minutes), and Blocked (unblock). Friends sort A–Z
 *   (under letters, with a letter index to jump), Z–A, by latest chat or by
 *   newest contact; the choice is remembered on this device.
 * - Each friend: message, view profile, rename, favourite, remove, block.
 * - Groups: every group chat (invitations first), and New group.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { RealContact } from '../core/delivery/realMessaging';
import type { ProfilesClient } from '../modules/profiles/profilesClient';
import { Avatar } from './Avatar';
import { PeopleSearch } from './PeopleSearch';
import { PopoverMenu, type MenuItem } from './PopoverMenu';
import { PromptDialog } from './PromptDialog';
import { LevelBadge } from './LevelBadge';
import {
  CONTACT_SORTS,
  contactMatches,
  groupByLetter,
  isContactSort,
  sortContacts,
  type ContactSort,
} from './contactSort';
import {
  BlockIcon,
  ChatsIcon,
  CheckIcon,
  ChevronDownIcon,
  EditIcon,
  HeartIcon,
  ProfileCardIcon,
  SearchIcon,
  UserMinusIcon,
  CommunityIcon,
  GroupIcon,
  PersonIcon,
  PlusIcon,
  SortIcon,
} from './icons';

interface Props {
  myAccount: string;
  contacts: RealContact[];
  blocked: RealContact[];
  ready: boolean;
  /** Messaging status line shown while not ready (starting, or why it failed). */
  status?: ReactNode;
  profiles: ProfilesClient | null;
  /** An ID to add, from an invite link that was opened. */
  prefillId?: string;
  isActive: (account: string) => boolean;
  /** When the last message with this contact was sent, if any (for "Recent chats"). */
  lastChatAt?: (account: string) => number | undefined;
  onAdd: (account: string, name?: string) => Promise<void>;
  onOpen: (account: string) => void;
  onProfile: (account: string) => void;
  onAccept: (account: string) => Promise<void>;
  onRename: (account: string, name: string) => Promise<void>;
  onFavorite: (account: string, favorite: boolean) => Promise<void>;
  onRemove: (account: string) => void;
  onBlock: (account: string) => void;
  onUnblock: (account: string) => Promise<void>;
  /** Group chats (the Groups tab), and starting a new one. */
  groups: GroupItem[];
  onNewGroup: () => void;
}

/** A group as the Groups tab lists it. */
export interface GroupItem {
  /** The group's chat key. */
  key: string;
  name: string;
  photo?: string;
  members: number;
  /** We left or were removed. */
  left: boolean;
  /** Someone who isn't our friend added us: not joined yet. */
  request: boolean;
}

type ContactsTab = 'people' | 'groups' | 'communities';
/** What each tab lists, as on its button (the panel's title stays Contacts). */
const TAB_TITLES: Record<ContactsTab, string> = { people: 'People', groups: 'Groups', communities: 'Communities' };

/** A short form of an account ID for the second line. */
const shortId = (a: string) => `${a.slice(0, 5)}…${a.slice(-3)}`;

const SORT_KEY = 'contacts-sort';
const loadSort = (): ContactSort => {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return isContactSort(v) ? v : 'az';
  } catch {
    return 'az';
  }
};

export function ContactsPanel(p: Props) {
  const { myAccount, contacts, blocked } = p;
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(!!p.prefillId);
  const [id, setId] = useState(p.prefillId ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; account?: string } | null>(null);
  // The open menu belongs to one row (a favourite is listed twice).
  const [menu, setMenu] = useState<{ row: string; anchor: HTMLElement } | null>(null);
  const [renaming, setRenaming] = useState<RealContact | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  // What the panel lists, and the + menu.
  const [tab, setTab] = useState<ContactsTab>('people');
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (p.prefillId) {
      setAdding(true);
      setId(p.prefillId);
    }
  }, [p.prefillId]);

  // How friends are listed (remembered on this device).
  const [sort, setSort] = useState<ContactSort>(loadSort);
  const [sortMenu, setSortMenu] = useState<HTMLElement | null>(null);
  const chooseSort = (s: ContactSort) => {
    setSort(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // Not remembered: the choice still applies now.
    }
  };
  const scroller = useRef<HTMLDivElement>(null);

  const matches = (c: RealContact) => contactMatches(c, query);
  const requests = contacts.filter((c) => !c.known && matches(c));
  const friends = contacts.filter((c) => c.known);
  const { favorites, shown, groups } = useMemo(() => {
    const sorted = sortContacts(
      friends.filter((c) => contactMatches(c, query)),
      sort,
      p.lastChatAt,
    );
    return {
      favorites: sorted.filter((c) => c.favorite),
      shown: sorted,
      // Under letters only when sorted by name.
      groups: sort === 'az' || sort === 'za' ? groupByLetter(sorted) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, query, sort, p.lastChatAt]);
  const jumpTo = (letter: string) =>
    scroller.current
      ?.querySelector(`[data-letter="${CSS.escape(letter)}"]`)
      ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });

  const run = async (f: () => Promise<void>) => {
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  const add = async (account: string, label?: string) => {
    if (account === myAccount) {
      setMsg({ ok: false, text: 'That is your own OpenSocial ID.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await p.onAdd(account, label);
      setMsg({ ok: true, text: `${label?.trim() || shortId(account)} is now in your contacts.`, account });
      setId('');
      setName('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (id.trim()) void add(id.trim(), name);
  };

  const menuItems = (c: RealContact): MenuItem[] => [
    { label: 'Message', icon: <ChatsIcon />, onSelect: () => p.onOpen(c.account) },
    { label: 'View profile', icon: <ProfileCardIcon />, onSelect: () => p.onProfile(c.account) },
    { label: 'Rename', icon: <EditIcon />, onSelect: () => setRenaming(c) },
    c.favorite
      ? {
          label: 'Remove from Favorites',
          icon: <HeartIcon />,
          onSelect: () => void run(() => p.onFavorite(c.account, false)),
        }
      : {
          label: 'Add to Favorites',
          icon: <HeartIcon />,
          onSelect: () => void run(() => p.onFavorite(c.account, true)),
        },
    'divider',
    { label: 'Remove contact', icon: <UserMinusIcon />, onSelect: () => p.onRemove(c.account), danger: true },
    { label: 'Block', icon: <BlockIcon />, onSelect: () => p.onBlock(c.account), danger: true },
  ];

  const row = (c: RealContact, kind: 'friend' | 'request' | 'blocked', key = c.account) => {
    const open = menu?.row === key && kind === 'friend';
    const active = kind === 'friend' && p.isActive(c.account);
    return (
      <li key={key} className={`contact-row ${open ? 'menu-open' : ''}`}>
        <button
          type="button"
          className="contact-main"
          disabled={kind === 'blocked'}
          onClick={() => p.onOpen(c.account)}
          title={kind === 'blocked' ? undefined : `Message ${c.name}`}
        >
          <span className="contact-avatar">
            <Avatar name={c.name} className="avatar-40" src={c.profile?.avatar || undefined} seed={c.account} />
            {active && <span className="active-dot" role="img" aria-label="Active now" />}
          </span>
          <span className="contact-text">
            <span className="contact-name">
              <span className="name-text">{c.name}</span>
              <LevelBadge size={14} />
            </span>
            <span className="contact-sub">{c.profile?.username ? `@${c.profile.username}` : shortId(c.account)}</span>
          </span>
        </button>
        {kind === 'request' && (
          <span className="contact-actions">
            <button type="button" className="pill-btn small" onClick={() => void run(() => p.onAccept(c.account))}>
              Accept
            </button>
            <button type="button" className="link-btn danger" onClick={() => p.onBlock(c.account)}>
              Block
            </button>
          </span>
        )}
        {kind === 'blocked' && (
          <span className="contact-actions">
            <button type="button" className="link-btn" onClick={() => void run(() => p.onUnblock(c.account))}>
              Unblock
            </button>
          </span>
        )}
        {kind === 'friend' && (
          <>
            <button
              type="button"
              className="convo-more contact-more"
              aria-label={`Options for ${c.name}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={(e) => setMenu(open ? null : { row: key, anchor: e.currentTarget })}
            >
              <ChevronDownIcon />
            </button>
            {open && (
              <PopoverMenu
                label={`Options for ${c.name}`}
                anchor={menu.anchor}
                items={menuItems(c)}
                onClose={() => setMenu(null)}
              />
            )}
          </>
        )}
      </li>
    );
  };

  const q = query.trim().toLowerCase();
  const listedGroups = p.groups
    .filter((g) => !q || g.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.request) - Number(a.request) || Number(a.left) - Number(b.left) || a.name.localeCompare(b.name));
  const groupsTab = (
    <div className="contacts-scroll" role="tabpanel" aria-label="Groups">
      <section aria-label="Groups">
        <div className="contacts-heading-row">
          <h3 className="contacts-heading">Groups · {p.groups.length}</h3>
          <button type="button" className="contacts-sort" onClick={p.onNewGroup} disabled={!p.ready}>
            <PlusIcon /> New group
          </button>
        </div>
        {listedGroups.length === 0 ? (
          <p className="list-empty">
            {p.groups.length ? `No groups match “${query}”.` : 'No groups yet. Start one with your friends: New group.'}
          </p>
        ) : (
          <ul className="contacts-list">
            {listedGroups.map((g) => (
              <li key={g.key} className="contact-row">
                <button type="button" className="contact-main" onClick={() => p.onOpen(g.key)} title={`Open ${g.name}`}>
                  <span className="contact-avatar">
                    <Avatar name={g.name} className="avatar-40" src={g.photo} seed={g.key} />
                  </span>
                  <span className="contact-text">
                    <span className="contact-name">
                      <span className="name-text">{g.name}</span>
                    </span>
                    <span className="contact-sub">
                      {g.request ? 'Invitation' : g.left ? 'You left' : `${g.members} ${g.members === 1 ? 'member' : 'members'}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );

  return (
    <section className="chat-list contacts" aria-label="Contacts">
      <div className="chat-list-header">
        <h2>Contacts</h2>
        <div className="contacts-tools">
          <button
            type="button"
            className={`plus-btn${adding ? ' is-on' : ''}`}
            disabled={!p.ready}
            aria-label={adding ? 'Close add person' : 'Add'}
            title={!p.ready ? 'Secure messaging is not running yet' : adding ? 'Close' : 'Add a person, group or community'}
            aria-haspopup={adding ? undefined : 'menu'}
            aria-expanded={adding ? undefined : !!addMenu}
            // While adding a friend the + shows ×: it closes that form.
            onClick={(e) => (adding ? setAdding(false) : setAddMenu(addMenu ? null : e.currentTarget))}
          >
            <PlusIcon />
          </button>
          {addMenu && (
            <PopoverMenu
              label="Add"
              anchor={addMenu}
              onClose={() => setAddMenu(null)}
              items={[
                {
                  label: 'Add person',
                  icon: <PersonIcon />,
                  onSelect: () => {
                    setTab('people');
                    setAdding(true);
                    setMsg(null);
                  },
                },
                {
                  label: 'New group',
                  icon: <GroupIcon />,
                  onSelect: () => {
                    setTab('groups');
                    p.onNewGroup();
                  },
                },
                { label: 'New community', icon: <CommunityIcon />, onSelect: () => setTab('communities'), soon: true },
              ]}
            />
          )}
        </div>
      </div>

      {p.status}

      <label className="search-box">
        <SearchIcon />
        <span className="sr-only">Search {TAB_TITLES[tab].toLowerCase()}</span>
        <input
          type="search"
          placeholder={`Search ${TAB_TITLES[tab].toLowerCase()}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="contacts-tabs" role="tablist" aria-label="Show">
        {(
          [
            ['people', 'People'],
            ['groups', 'Groups'],
            ['communities', 'Communities'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="contacts-tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
              setQuery('');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'communities' && (
        <div className="contacts-soon" role="tabpanel" aria-label={TAB_TITLES[tab]}>
          <CommunityIcon />
          <p className="contacts-soon-title">No communities yet</p>
          <p>Communities, with several groups under one roof, are coming soon. Those you join will be listed here.</p>
        </div>
      )}
      {tab === 'groups' && groupsTab}
      {tab === 'people' && (
        <>
          {adding && (
            // Closed with the × at the top (the + while adding) or Escape.
            <form
              className="new-chat"
              onSubmit={submit}
              aria-label="Add a contact"
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
            >
              {p.profiles && (
                <PeopleSearch
                  profiles={p.profiles}
                  myAccount={myAccount}
                  isContact={(a) => contacts.some((c) => c.account === a && c.known)}
                  onAdd={(r) => add(r.account, r.displayName)}
                />
              )}
              <p className="settings-note">Or add someone by their OpenSocial ID:</p>
              <label className="field">
                <span>Their OpenSocial ID</span>
                <input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="xxxxx-xxxxx-…-xxx"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span>Nickname (optional, only you see it)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice from work" />
              </label>
              <div className="settings-actions">
                <button type="submit" className="pill-btn" disabled={busy || !id.trim()}>
                  {busy ? 'Checking…' : 'Add to contacts'}
                </button>
              </div>
            </form>
          )}
          {msg && (
            <p className={`result ${msg.ok ? 'ok' : 'bad'} contacts-msg`} role={msg.ok ? 'status' : 'alert'}>
              {msg.text}
              {msg.ok && msg.account && (
                <button type="button" className="link-btn" onClick={() => p.onOpen(msg.account!)}>
                  Say hello
                </button>
              )}
            </p>
          )}

          <div className="contacts-scroll" ref={scroller}>
            {requests.length > 0 && (
              <section aria-label="Requests">
                <h3 className="contacts-heading">Requests · {requests.length}</h3>
                <ul className="contacts-list">{requests.map((c) => row(c, 'request'))}</ul>
              </section>
            )}
            {favorites.length > 0 && (
              <section aria-label="Favorites">
                <h3 className="contacts-heading">Favorites · {favorites.length}</h3>
                <ul className="contacts-list">{favorites.map((c) => row(c, 'friend', `fav:${c.account}`))}</ul>
              </section>
            )}
            <section aria-label="Friends">
              <div className="contacts-heading-row">
                <h3 className="contacts-heading">Friends · {friends.length}</h3>
                {friends.length > 1 && (
                  <button
                    type="button"
                    className="contacts-sort"
                    aria-label={`Sort: ${CONTACT_SORTS.find((x) => x.id === sort)!.label}`}
                    aria-haspopup="menu"
                    aria-expanded={!!sortMenu}
                    onClick={(e) => setSortMenu(sortMenu ? null : e.currentTarget)}
                  >
                    <SortIcon />
                    {CONTACT_SORTS.find((x) => x.id === sort)!.short}
                  </button>
                )}
                {sortMenu && (
                  <PopoverMenu
                    label="Sort friends"
                    anchor={sortMenu}
                    onClose={() => setSortMenu(null)}
                    items={CONTACT_SORTS.map((x) => ({
                      label: x.label,
                      icon: x.id === sort ? <CheckIcon /> : <span />,
                      onSelect: () => chooseSort(x.id),
                    }))}
                  />
                )}
              </div>
              {shown.length === 0 ? (
                <p className="list-empty">
                  {friends.length
                    ? `No contacts match “${query}”.`
                    : 'No contacts yet. Add someone with the button above.'}
                </p>
              ) : groups ? (
                groups.map(([letter, list]) => (
                  <div key={letter} className="contacts-group" data-letter={letter} aria-label={letter}>
                    <span className="contacts-letter" aria-hidden="true">
                      {letter}
                    </span>
                    <ul className="contacts-list">{list.map((c) => row(c, 'friend'))}</ul>
                  </div>
                ))
              ) : (
                <ul className="contacts-list">{shown.map((c) => row(c, 'friend'))}</ul>
              )}
            </section>
            {blocked.length > 0 && (
              <section aria-label="Blocked">
                <button
                  type="button"
                  className="contacts-heading contacts-toggle"
                  aria-expanded={showBlocked}
                  onClick={() => setShowBlocked((v) => !v)}
                >
                  Blocked · {blocked.length}
                  <ChevronDownIcon />
                </button>
                {showBlocked && <ul className="contacts-list">{blocked.map((c) => row(c, 'blocked'))}</ul>}
              </section>
            )}
          </div>
          {groups && groups.length > 2 && !query && (
            <nav className="contacts-index" aria-label="Jump to letter">
              {groups.map(([letter]) => (
                <button key={letter} type="button" onClick={() => jumpTo(letter)} aria-label={`Jump to ${letter}`}>
                  {letter}
                </button>
              ))}
            </nav>
          )}
        </>
      )}

      {renaming && (
        <PromptDialog
          title={`Rename ${renaming.name}`}
          label="Name"
          initial={renaming.nickname ?? renaming.name}
          hint="Only you see this name. Leave it empty to use the name they chose."
          confirmLabel="Save"
          onConfirm={(value) => {
            const c = renaming;
            setRenaming(null);
            void run(() => p.onRename(c.account, value));
          }}
          onCancel={() => setRenaming(null)}
        />
      )}
    </section>
  );
}

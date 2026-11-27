/**
 * Right column of Space: you at the top, then your friends, with a search
 * that filters friends and finds public profiles (or opens an OpenSocial ID).
 * Picking anyone opens their space.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ProfilesClient, PublicProfile } from '../../modules/profiles/profilesClient';
import { Avatar } from '../Avatar';
import { SearchIcon } from '../icons';
import { ProfileAvatar } from '../ProfileAvatar';
import type { Person } from './useSpace';

export interface SpaceFriend {
  account: string;
  name: string;
  username?: string;
  avatar?: string;
}

interface Props {
  me?: string;
  myPerson: Person;
  friends: SpaceFriend[];
  openOwner: string | null;
  profiles: ProfilesClient | null;
  onOpenSpace(owner: string): void;
  /** Inside the left column on narrow screens, instead of a column of its own. */
  inline?: boolean;
}

const ID = /^[a-z0-9]{5}(-[a-z0-9]{5}){1,9}(-[a-z0-9]{1,5})?$/;
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-3)}`;

export function SpacePeople({ me, myPerson, friends, openOwner, profiles, onOpenSpace, inline = false }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const query = q.trim().toLowerCase().replace(/^@/, '');

  const shown = useMemo(() => {
    const list = [...friends].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (!query) return list;
    return list.filter(
      (f) =>
        f.name.toLowerCase().includes(query) ||
        (f.username ?? '').toLowerCase().includes(query) ||
        f.account.startsWith(query),
    );
  }, [friends, query]);

  // Public profiles beyond your friends, once a name is typed.
  useEffect(() => {
    if (query.length < 2 || ID.test(query) || !profiles) {
      setResults([]);
      setStatus(null);
      return;
    }
    let alive = true;
    setStatus('Searching…');
    const t = setTimeout(() => {
      profiles
        .search(query)
        .then((r) => {
          if (!alive) return;
          setResults(r.filter((p) => p.account !== me && !friends.some((f) => f.account === p.account)));
          setStatus(null);
        })
        .catch(() => alive && setStatus(null));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, profiles, me, friends]);

  const row = (account: string, name: string, sub: string, avatar: React.ReactNode, mine = false) => (
    <li key={account}>
      <button
        type="button"
        className={`sp-person${openOwner === account ? ' active' : ''}`}
        aria-current={openOwner === account ? 'page' : undefined}
        onClick={() => onOpenSpace(account)}
      >
        {avatar}
        <span className="sp-nav-text">
          <strong>{name}</strong>
          <span>{sub}</span>
        </span>
        {mine && <span className="sp-you">You</span>}
      </button>
    </li>
  );

  const meMatches =
    !query || myPerson.name.toLowerCase().includes(query) || (myPerson.username ?? '').toLowerCase().includes(query);

  return (
    <aside className={inline ? 'sp-people is-inline' : 'sp-people'} aria-label="People">
      <div className="sp-people-head">
        <h2>People</h2>
        <label className="search-box sp-people-search">
          <SearchIcon />
          <span className="sr-only">Search people</span>
          <input
            type="search"
            placeholder="Search names, @username or ID"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </div>
      <div className="sp-people-scroll">
        <ul className="sp-people-list">
          {me &&
            meMatches &&
            row(
              me,
              myPerson.name,
              'My Space',
              <Avatar name={myPerson.name} src={myPerson.avatar} seed={me} className="avatar-40" />,
              true,
            )}
          {ID.test(q.trim()) &&
            q.trim() !== me &&
            !friends.some((f) => f.account === q.trim()) &&
            row(
              q.trim(),
              'Open this space',
              short(q.trim()),
              <Avatar name="?" seed={q.trim()} className="avatar-40" />,
            )}
        </ul>

        <p className="mk-cats-title sp-people-title">
          Friends <span className="sp-people-n">{friends.length}</span>
        </p>
        {shown.length === 0 && (
          <p className="sp-panel-note">{friends.length ? 'No friends match.' : 'Your contacts appear here.'}</p>
        )}
        <ul className="sp-people-list">
          {shown.map((f) =>
            row(
              f.account,
              f.name,
              f.username ? `@${f.username}` : short(f.account),
              <Avatar name={f.name} src={f.avatar} seed={f.account} className="avatar-40" />,
            ),
          )}
        </ul>

        {(results.length > 0 || status) && (
          <>
            <p className="mk-cats-title sp-people-title">Public profiles</p>
            {status && <p className="sp-panel-note">{status}</p>}
            <ul className="sp-people-list">
              {results.map((r) =>
                row(
                  r.account,
                  r.displayName || r.username,
                  `@${r.username}`,
                  profiles ? <ProfileAvatar profiles={profiles} profile={r} /> : null,
                ),
              )}
            </ul>
          </>
        )}
      </div>
    </aside>
  );
}

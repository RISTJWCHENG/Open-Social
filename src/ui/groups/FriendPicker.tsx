/** A searchable list of friends with checkboxes (who to put in a group). */
import { useMemo, useState } from 'react';
import { Avatar } from '../Avatar';
import { SearchIcon } from '../icons';

export interface PickFriend {
  account: string;
  name: string;
  avatar?: string;
}

export function FriendPicker(p: {
  friends: PickFriend[];
  picked: string[];
  onChange: (picked: string[]) => void;
  legend: string;
  empty: string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? p.friends.filter((f) => f.name.toLowerCase().includes(q) || f.account.includes(q)) : p.friends;
  }, [p.friends, query]);
  const toggle = (a: string) => p.onChange(p.picked.includes(a) ? p.picked.filter((x) => x !== a) : [...p.picked, a]);
  return (
    <fieldset className="ev-field ev-invite">
      <legend>
        {p.legend} <span className="ev-hint">{p.picked.length} selected</span>
      </legend>
      {p.friends.length > 0 ? (
        <>
          <label className="search-box ev-invite-search">
            <SearchIcon />
            <span className="sr-only">Search friends</span>
            <input
              type="search"
              placeholder="Search friends..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ul className="ev-invite-list">
            {shown.map((f) => (
              <li key={f.account}>
                <label className={`ev-invite-row${p.picked.includes(f.account) ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={p.picked.includes(f.account)} onChange={() => toggle(f.account)} />
                  <Avatar name={f.name} src={f.avatar} seed={f.account} className="avatar-32" />
                  <span>{f.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="ev-hint">{p.empty}</p>
      )}
    </fieldset>
  );
}

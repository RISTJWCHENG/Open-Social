/**
 * Search over public profiles (open-social-profiles). Shows every similar
 * match; the user picks the right person and adds them.
 */
import { useEffect, useState } from 'react';
import type { ProfilesClient, PublicProfile } from '../modules/profiles/profilesClient';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  profiles: ProfilesClient;
  myAccount: string;
  isContact: (account: string) => boolean;
  onAdd: (r: PublicProfile) => Promise<void>;
}

export function PeopleSearch({ profiles, myAccount, isContact, onAdd }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reported, setReported] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const query = q.trim();
    if (query.replace(/^@/, '').length < 1) {
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
          const others = r.filter((x) => x.account !== myAccount);
          setResults(others);
          setStatus(others.length ? null : 'No public profiles match.');
        })
        .catch((e) => alive && setStatus(e instanceof Error ? e.message : String(e)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, profiles, myAccount]);

  return (
    <div className="people-search">
      <label className="field">
        <span>Search public profiles</span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or @username"
          aria-label="Search public profiles"
        />
      </label>
      {status && <p className="settings-note">{status}</p>}
      {results.length > 0 && (
        <ul className="search-results" aria-label="Search results">
          {results.map((r) => (
            <li key={r.account}>
              <ProfileAvatar profiles={profiles} profile={r} />
              <span className="sr-text">
                <span className="sr-name">{r.displayName}</span>
                <span className="sr-user">@{r.username}</span>
                {r.bio && <span className="sr-bio">{r.bio}</span>}
              </span>
              <span className="sr-actions">
                {isContact(r.account) ? (
                  <span className="settings-note">Added</span>
                ) : (
                  <button
                    type="button"
                    className="pill-btn"
                    disabled={busy === r.account}
                    onClick={async () => {
                      setBusy(r.account);
                      try {
                        await onAdd(r);
                      } catch (e) {
                        setStatus(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {busy === r.account ? 'Adding…' : 'Add'}
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn sr-report"
                  disabled={reported[r.account]}
                  onClick={async () => {
                    await profiles.report(r.account, 'Reported from search').catch(() => undefined);
                    setReported((x) => ({ ...x, [r.account]: true }));
                  }}
                >
                  {reported[r.account] ? 'Reported' : 'Report'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

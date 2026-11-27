/**
 * Left column for spaces: your own space, Explore, Following feed, and the
 * spaces you follow. People to visit are listed in the right column.
 */
import type { ProfilesClient } from '../../modules/profiles/profilesClient';
import { Avatar } from '../Avatar';
import type { Person } from './useSpace';

export type SpacePage = 'mine' | 'explore' | 'following' | 'other';

interface Props {
  me?: string;
  myPerson: Person;
  page: SpacePage;
  openOwner: string | null;
  follows: string[];
  person(account: string): Person;
  profiles: ProfilesClient | null;
  onMine(): void;
  onExplore(): void;
  onFollowing(): void;
  onOpenSpace(owner: string): void;
  /** The people list, shown here only on narrow screens. */
  people?: React.ReactNode;
}

export function SpacePanel(p: Props) {
  const row = (key: string, active: boolean, onClick: () => void, children: React.ReactNode) => (
    <button
      key={key}
      type="button"
      className={`sp-nav${active ? ' active' : ''}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <section className="chat-list sp-panel" aria-label="Spaces">
      <div className="chat-list-header">
        <h2>Spaces</h2>
      </div>
      <div className="sp-panel-scroll">
        {p.me &&
          row(
            'mine',
            p.page === 'mine',
            p.onMine,
            <>
              <Avatar name={p.myPerson.name} src={p.myPerson.avatar} seed={p.me} className="avatar-40" />
              <span className="sp-nav-text">
                <strong>My Space</strong>
                <span>{p.myPerson.name}</span>
              </span>
            </>,
          )}
        {row(
          'explore',
          p.page === 'explore',
          p.onExplore,
          <>
            <span className="sp-nav-icon is-explore" aria-hidden="true" />
            <span className="sp-nav-text">
              <strong>Explore</strong>
              <span>The latest from every space</span>
            </span>
          </>,
        )}
        {row(
          'following',
          p.page === 'following',
          p.onFollowing,
          <>
            <span className="sp-nav-icon is-following" aria-hidden="true" />
            <span className="sp-nav-text">
              <strong>Following</strong>
              <span>
                {p.follows.length} {p.follows.length === 1 ? 'space' : 'spaces'}
              </span>
            </span>
          </>,
        )}

        <p className="mk-cats-title sp-section-title">Spaces you follow</p>
        {p.follows.length === 0 && <p className="sp-panel-note">Follow a space to keep it here.</p>}
        {p.follows.map((o) => {
          const who = p.person(o);
          return row(
            `f-${o}`,
            p.openOwner === o,
            () => p.onOpenSpace(o),
            <>
              <Avatar name={who.name} src={who.avatar} seed={o} className="avatar-40" />
              <span className="sp-nav-text">
                <strong>{who.name}</strong>
                <span>{who.username ? `@${who.username}` : `${o.slice(0, 5)}…${o.slice(-3)}`}</span>
              </span>
            </>,
          );
        })}
        {p.people}
      </div>
    </section>
  );
}

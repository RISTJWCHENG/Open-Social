/**
 * A space: header (accent band, photo, name, about, counts, actions), tabs
 * by kind plus Market, the pinned item first, then everything else.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Listing } from '../../core/market/market';
import { ACCENT_COLORS, KINDS, spaceLink, type ItemKind, type SpaceInfo, type SpaceItem } from '../../core/space/space';
import { Avatar } from '../Avatar';
import { BackIcon, PlusIcon, ShareIcon } from '../icons';
import { ListingCard } from '../market/ListingCard';
import type { PhotoLoader } from '../market/marketPhotos';
import { ItemCard } from './ItemCard';
import { PAGE, usePagedItems, type Person, type SpaceState } from './useSpace';

type Tab = 'all' | ItemKind | 'market';

interface Props {
  owner: string;
  me?: string;
  person: Person;
  space: SpaceState;
  info: SpaceInfo | null | undefined;
  following: boolean;
  onFollow(): void;
  onOpenItem(id: string): void;
  onAdd(kind?: ItemKind): void;
  onEditSpace(): void;
  onMessage(): void;
  onBack(): void;
  loadListings(owner: string): Promise<Listing[]>;
  listingPhoto: PhotoLoader;
  onOpenListing(id: string): void;
}

export function SpaceHome(p: Props) {
  const mine = !!p.me && p.owner === p.me;
  const [tab, setTab] = useState<Tab>('all');
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const kind = tab === 'all' || tab === 'market' ? null : tab;
  const { client, remember } = p.space;
  const load = useCallback((offset: number) => client.items(p.owner, kind, offset, PAGE), [client, p.owner, kind]);
  const list = usePagedItems(
    tab === 'market' || p.info === null ? null : `${p.owner}:${tab}:${p.info?.items ?? ''}`,
    load,
    remember,
  );
  const pinned = p.info?.pinned ? p.space.items[p.info.pinned] : undefined;

  useEffect(() => {
    setTab('all');
    setListings(null);
  }, [p.owner]);
  useEffect(() => {
    if (p.info?.pinned && !p.space.items[p.info.pinned]) void p.space.loadItem(p.info.pinned).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.info?.pinned]);
  useEffect(() => {
    if (p.info?.showMarket) void p.loadListings(p.owner).then(setListings, () => setListings([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.owner, p.info?.showMarket]);

  const [c1, c2] = ACCENT_COLORS[p.info?.accent ?? 'violet'] ?? ACCENT_COLORS.violet;
  const share = async () => {
    const link = spaceLink(p.owner, undefined, location.origin);
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link to this space copied.');
    } catch {
      setNotice(link);
    }
  };
  const card = (i: SpaceItem, isPinned = false) => (
    <ItemCard
      key={`${isPinned ? 'pin-' : ''}${i.id}`}
      item={i}
      image={p.space.image}
      liked={p.space.liked.has(i.id)}
      likes={p.space.likeCount(i)}
      onLike={p.me ? () => void p.space.toggleLike(i).catch(() => undefined) : undefined}
      onOpen={() => p.onOpenItem(i.id)}
      pinned={isPinned}
    />
  );

  return (
    <main className="chat-main mk-main sp-main" aria-label={mine ? 'My Space' : `${p.person.name}'s Space`}>
      <header className="sp-hero" style={{ ['--sp-a' as string]: c1, ['--sp-b' as string]: c2 }}>
        <div className="sp-band">
          <button type="button" className="hdr-btn back sp-hero-back" onClick={p.onBack} aria-label="Back">
            <BackIcon />
          </button>
        </div>
        <div className="sp-hero-body">
          <Avatar name={p.person.name} src={p.person.avatar} seed={p.owner} className="avatar-96 sp-hero-avatar" />
          <div className="sp-hero-text">
            <h1>{mine ? 'My Space' : `${p.person.name}'s Space`}</h1>
            <p className="sp-hero-sub">
              {mine
                ? p.person.name
                : p.person.username
                  ? `@${p.person.username}`
                  : `${p.owner.slice(0, 5)}…${p.owner.slice(-3)}`}
              {p.info && (
                <>
                  {' · '}
                  {p.info.items} {p.info.items === 1 ? 'item' : 'items'} · {p.info.likes}{' '}
                  {p.info.likes === 1 ? 'like' : 'likes'}
                </>
              )}
              {mine && p.info && !p.info.visible && <span className="sp-private-tag">Hidden</span>}
            </p>
            {p.info?.about && <p className="sp-about">{p.info.about}</p>}
          </div>
          <div className="sp-hero-actions">
            {mine ? (
              <>
                <button type="button" className="ev-btn is-primary" onClick={() => p.onAdd()}>
                  <PlusIcon />
                  Add
                </button>
                <button type="button" className="ev-btn" onClick={p.onEditSpace}>
                  Edit space
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`ev-btn${p.following ? '' : ' is-primary'}`}
                  aria-pressed={p.following}
                  onClick={p.onFollow}
                >
                  {p.following ? 'Following' : 'Follow'}
                </button>
                {p.me && (
                  <button type="button" className="ev-btn" onClick={p.onMessage}>
                    Message
                  </button>
                )}
              </>
            )}
            <button type="button" className="ev-btn" onClick={() => void share()} aria-label="Share this space">
              <ShareIcon />
            </button>
          </div>
        </div>
        {notice && (
          <p className="mk-notice sp-hero-notice" role="status">
            {notice}
          </p>
        )}
      </header>

      {p.info === null ? (
        <div className="mk-empty">
          <p>This space is private or doesn't exist.</p>
        </div>
      ) : (
        <>
          <nav className="sp-tabs" aria-label="Show">
            {(
              [
                ['all', 'All'],
                ...KINDS.map((k) => [k.id, k.plural]),
                ...(p.info?.showMarket ? [['market', 'Market']] : []),
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} type="button" className="mk-chip" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
                {id === 'market' && listings?.length ? <span className="sp-tab-n">{listings.length}</span> : null}
              </button>
            ))}
          </nav>

          {tab === 'market' ? (
            listings && listings.length ? (
              <div className="mk-grid">
                {listings.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    photo={p.listingPhoto}
                    saved={false}
                    onOpen={() => p.onOpenListing(l.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="mk-empty">
                <p>{listings ? 'Nothing for sale right now.' : 'Loading…'}</p>
              </div>
            )
          ) : list.error ? (
            <div className="mk-empty" role="alert">
              <p>Couldn't load this space. {list.error}</p>
              <button type="button" className="ev-btn" onClick={() => void list.reload()}>
                Try again
              </button>
            </div>
          ) : list.items.length === 0 && !list.loading ? (
            <div className="mk-empty">
              <p>
                {mine
                  ? tab === 'all'
                    ? 'Your space is empty. Share a post, a link, your work, videos, music or a dapp you built.'
                    : `No ${KINDS.find((k) => k.id === tab)?.plural.toLowerCase()} yet.`
                  : 'Nothing here yet.'}
              </p>
              {mine && (
                <button type="button" className="ev-btn is-primary" onClick={() => p.onAdd(kind ?? undefined)}>
                  Add {kind ? KINDS.find((k) => k.id === kind)?.label.toLowerCase() : 'something'}
                </button>
              )}
            </div>
          ) : (
            <div className="sp-grid" aria-busy={list.loading}>
              {tab === 'all' && pinned && card(pinned, true)}
              {list.items.filter((i) => !(tab === 'all' && i.id === pinned?.id)).map((i) => card(i))}
              {list.loading &&
                list.items.length === 0 &&
                Array.from({ length: 6 }, (_, i) => <div key={i} className="mk-card is-skeleton" aria-hidden="true" />)}
            </div>
          )}
          {list.hasMore && tab !== 'market' && (
            <div className="mk-more">
              <button type="button" className="ev-btn" disabled={list.loading} onClick={() => void list.more()}>
                {list.loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

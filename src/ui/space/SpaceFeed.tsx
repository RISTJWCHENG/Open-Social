/** Explore (latest from every space) and Following (latest from spaces you follow). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { KINDS, type ItemKind } from '../../core/space/space';
import { SearchClient } from '../../modules/search/searchClient';
import { BackIcon, SearchIcon } from '../icons';
import { ItemCard } from './ItemCard';
import { PAGE, usePagedItems, type SpaceState } from './useSpace';

interface Props {
  mode: 'explore' | 'following';
  me?: string;
  space: SpaceState;
  onOpenItem(id: string): void;
  onOpenSpace(owner: string): void;
  onBack(): void;
}

export function SpaceFeed({ mode, me, space, onOpenItem, onOpenSpace, onBack }: Props) {
  const [kind, setKind] = useState<ItemKind | null>(null);
  const [typed, setTyped] = useState('');
  const [words, setWords] = useState('');
  const { client, follows, remember } = space;
  const searchClient = useMemo(() => new SearchClient(), []);
  useEffect(() => {
    const t = setTimeout(() => setWords(typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const searching = mode === 'explore' && words.length > 0;
  const load = useCallback(
    async (offset: number) => {
      if (searching) {
        // Matches come from the search canister; the items themselves from the space canister.
        const page = await searchClient.search(words, ['space'], offset, PAGE);
        const items = await client.itemsByIds(page.hits.map((h) => h.id));
        return { items, total: page.total, nextOffset: page.nextOffset };
      }
      return mode === 'explore' ? client.recent(kind, offset, PAGE) : client.feed(follows, offset, PAGE);
    },
    [client, searchClient, searching, words, mode, kind, follows],
  );
  const list = usePagedItems(
    `${mode}:${kind}:${mode === 'following' ? follows.join(',') : ''}:${searching ? words : ''}`,
    load,
    remember,
  );
  const items = (mode === 'following' || searching) && kind ? list.items.filter((i) => i.kind === kind) : list.items;

  return (
    <main className="chat-main mk-main sp-feed-main" aria-label={mode === 'explore' ? 'Explore spaces' : 'Following'}>
      <header className="mk-head">
        <div className="mk-head-row">
          <button type="button" className="hdr-btn back mk-grid-back" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
          <h2>{mode === 'explore' ? 'Explore' : 'Following'}</h2>
          <span className="mk-total">
            {mode === 'explore'
              ? 'The latest from every space'
              : `${follows.length} ${follows.length === 1 ? 'space' : 'spaces'}`}
          </span>
        </div>
        {mode === 'explore' && (
          <label className="search-box sp-feed-search">
            <SearchIcon />
            <span className="sr-only">Search spaces</span>
            <input
              type="search"
              placeholder="Search posts, works, videos, music, dapps…"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        )}
        <div className="mk-filters">
          <button type="button" className="mk-chip" aria-pressed={kind === null} onClick={() => setKind(null)}>
            All
          </button>
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              className="mk-chip"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.plural}
            </button>
          ))}
        </div>
      </header>
      {list.error ? (
        <div className="mk-empty" role="alert">
          <p>Couldn't load. {list.error}</p>
          <button type="button" className="ev-btn" onClick={() => void list.reload()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 && !list.loading ? (
        <div className="mk-empty">
          <p>
            {searching
              ? 'Nothing matches. Try other words.'
              : mode === 'following'
                ? follows.length
                  ? 'Nothing new from the spaces you follow.'
                  : 'Follow spaces to see what they share here. Who you follow stays on this device.'
                : 'Nothing has been shared yet.'}
          </p>
        </div>
      ) : (
        <div className="sp-feed" aria-busy={list.loading}>
          {items.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              image={space.image}
              liked={space.liked.has(i.id)}
              likes={space.likeCount(i)}
              onLike={me ? () => void space.toggleLike(i).catch(() => undefined) : undefined}
              onOpen={() => onOpenItem(i.id)}
              owner={space.person(i.owner)}
              onOpenOwner={() => onOpenSpace(i.owner)}
            />
          ))}
        </div>
      )}
      {list.hasMore && (
        <div className="mk-more">
          <button type="button" className="ev-btn" disabled={list.loading} onClick={() => void list.more()}>
            {list.loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </main>
  );
}

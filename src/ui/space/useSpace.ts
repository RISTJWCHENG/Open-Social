/**
 * Space state: follows (kept on this device), likes, cached spaces and
 * items, public profiles of owners, and paged item lists.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { followsKey, type ItemPage, type SpaceInfo, type SpaceItem } from '../../core/space/space';
import { bytesToDataUrl } from '../../core/profile/profile';
import type { ProfilesClient } from '../../modules/profiles/profilesClient';
import { SpaceClient } from '../../modules/space/spaceClient';

type Identity = import('@icp-sdk/core/agent').Identity;

export interface Person {
  name: string;
  username?: string;
  avatar?: string;
}

export const PAGE = 24;

function readFollows(account: string | undefined): string[] {
  if (!account) return [];
  try {
    const v = JSON.parse(localStorage.getItem(followsKey(account)) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 300) : [];
  } catch {
    return [];
  }
}

export function useSpace(
  identity: () => Identity | null,
  account: string | undefined,
  profiles: ProfilesClient | null,
  /** Names and photos of contacts, when known. */
  contact: (account: string) => Person | null,
) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => new SpaceClient(identity), [account]);
  const [follows, setFollows] = useState<string[]>(() => readFollows(account));
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [likes, setLikes] = useState<Record<string, number>>({});
  const [spaces, setSpaces] = useState<Record<string, SpaceInfo | null>>({});
  const [items, setItems] = useState<Record<string, SpaceItem>>({});
  const [people, setPeople] = useState<Record<string, Person>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => setFollows(readFollows(account)), [account]);

  const toggleFollow = useCallback(
    (owner: string) => {
      setFollows((f) => {
        const next = f.includes(owner) ? f.filter((x) => x !== owner) : [owner, ...f].slice(0, 300);
        if (account) {
          try {
            localStorage.setItem(followsKey(account), JSON.stringify(next));
          } catch {
            /* kept for this session */
          }
        }
        return next;
      });
    },
    [account],
  );

  const remember = useCallback(
    (list: SpaceItem[]) => {
      if (!list.length) return;
      setItems((m) => ({ ...m, ...Object.fromEntries(list.map((i) => [i.id, i])) }));
      setLikes((m) => ({ ...m, ...Object.fromEntries(list.map((i) => [i.id, i.likes])) }));
      if (account) {
        void client.liked(list.map((i) => i.id)).then(
          (ids) =>
            setLiked((s) => {
              const n = new Set(s);
              list.forEach((i) => n.delete(i.id));
              ids.forEach((id) => n.add(id));
              return n;
            }),
          () => undefined,
        );
      }
    },
    [client, account],
  );

  const loadSpace = useCallback(
    async (owner: string) => {
      const s = await client.get(owner).catch(() => null);
      setSpaces((m) => ({ ...m, [owner]: s }));
      return s;
    },
    [client],
  );

  const loadItem = useCallback(
    async (id: string) => {
      const i = await client.item(id);
      if (i) remember([i]);
      return i;
    },
    [client, remember],
  );

  const toggleLike = useCallback(
    async (item: SpaceItem) => {
      const on = !liked.has(item.id);
      setLiked((s) => {
        const n = new Set(s);
        if (on) n.add(item.id);
        else n.delete(item.id);
        return n;
      });
      setLikes((m) => ({ ...m, [item.id]: Math.max(0, (m[item.id] ?? item.likes) + (on ? 1 : -1)) }));
      try {
        const n = await client.like(item.id, on);
        setLikes((m) => ({ ...m, [item.id]: n }));
      } catch (e) {
        setLiked((s) => {
          const n = new Set(s);
          if (on) n.delete(item.id);
          else n.add(item.id);
          return n;
        });
        setLikes((m) => ({ ...m, [item.id]: item.likes }));
        throw e;
      }
    },
    [client, liked],
  );

  /** Name and photo of an account: a contact, else its public profile, else a short ID. */
  const person = useCallback(
    (owner: string): Person => {
      const c = contact(owner);
      if (c) return c;
      const p = people[owner];
      if (p) return p;
      if (profiles && !asked.current.has(owner)) {
        asked.current.add(owner);
        void profiles
          .getPublic(owner)
          .then(async (pub) => {
            if (!pub) return;
            const bytes = pub.avatarHash ? await profiles.getPublicAvatar(owner).catch(() => null) : null;
            setPeople((m) => ({
              ...m,
              [owner]: {
                name: pub.displayName || pub.username,
                username: pub.username || undefined,
                avatar: bytes ? bytesToDataUrl(bytes) : undefined,
              },
            }));
          })
          .catch(() => undefined);
      }
      return { name: `${owner.slice(0, 5)}…${owner.slice(-3)}` };
    },
    [contact, people, profiles],
  );

  return {
    client,
    follows,
    toggleFollow,
    liked,
    likeCount: (i: SpaceItem) => likes[i.id] ?? i.likes,
    toggleLike,
    spaces,
    loadSpace,
    items,
    loadItem,
    remember,
    forget: (id: string) => setItems((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id))),
    person,
    image: useCallback((id: string, hash: string) => client.image(id, hash), [client]),
  };
}

export type SpaceState = ReturnType<typeof useSpace>;

/** A paged list of items that reloads when `key` changes. */
export function usePagedItems(
  key: string | null,
  load: (offset: number) => Promise<ItemPage>,
  onItems: (i: SpaceItem[]) => void,
) {
  const [list, setList] = useState<SpaceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchPage = useCallback(
    async (offset: number) => {
      const me = ++run.current;
      setLoading(true);
      setError(null);
      try {
        const p = await loadRef.current(offset);
        if (me !== run.current) return;
        setList((prev) => (offset ? [...prev, ...p.items] : p.items));
        setTotal(p.total);
        setNext(p.nextOffset);
        onItems(p.items);
      } catch (e) {
        if (me === run.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (me === run.current) setLoading(false);
      }
    },
    [onItems],
  );

  useEffect(() => {
    setList([]);
    setNext(null);
    if (key !== null) void fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    items: list,
    total,
    loading,
    error,
    hasMore: next !== null,
    more: () => next !== null && fetchPage(next),
    reload: () => fetchPage(0),
    drop: (id: string) => setList((l) => l.filter((i) => i.id !== id)),
  };
}

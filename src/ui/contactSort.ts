/** Orders and groups the address book: by name (A–Z or Z–A), latest chat, or newest contact. */
import type { RealContact } from '../core/delivery/realMessaging';

export type ContactSort = 'az' | 'za' | 'recent-chat' | 'recent-added';

export const CONTACT_SORTS: readonly { id: ContactSort; label: string; short: string }[] = [
  { id: 'az', label: 'Name (A–Z)', short: 'A–Z' },
  { id: 'za', label: 'Name (Z–A)', short: 'Z–A' },
  { id: 'recent-chat', label: 'Recent chats', short: 'Recent' },
  { id: 'recent-added', label: 'Recently added', short: 'New' },
];

export const isContactSort = (v: unknown): v is ContactSort => CONTACT_SORTS.some((s) => s.id === v);

/** Names compared as people expect: case and accents ignored, numbers in order. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** First letter for grouping ("#" for anything that isn't a letter). */
export function letterOf(name: string): string {
  // Accents don't make a letter of their own: "Émile" is under E.
  const l = name.trim().charAt(0).normalize('NFD').charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(l) ? l : '#';
}

/** Whether a contact matches a search: name, @username, location or OpenSocial ID. */
export function contactMatches(c: RealContact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    (c.profile?.username ?? '').toLowerCase().includes(q.replace(/^@/, '')) ||
    (c.profile?.location ?? '').toLowerCase().includes(q) ||
    c.account.toLowerCase().includes(q)
  );
}

export function sortContacts(
  list: readonly RealContact[],
  sort: ContactSort,
  lastChatAt: (account: string) => number | undefined = () => undefined,
): RealContact[] {
  const byName = (a: RealContact, b: RealContact) => collator.compare(a.name, b.name);
  const out = [...list];
  switch (sort) {
    case 'az':
      return out.sort(byName);
    case 'za':
      return out.sort((a, b) => byName(b, a));
    case 'recent-chat':
      return out.sort((a, b) => (lastChatAt(b.account) ?? 0) - (lastChatAt(a.account) ?? 0) || byName(a, b));
    case 'recent-added':
      return out.sort((a, b) => b.addedAt - a.addedAt || byName(a, b));
  }
}

/** Contacts under their first letter, letters in the list's order ("#" always last). */
export function groupByLetter(sorted: readonly RealContact[]): [string, RealContact[]][] {
  const groups = new Map<string, RealContact[]>();
  for (const c of sorted) {
    const l = letterOf(c.name);
    groups.set(l, [...(groups.get(l) ?? []), c]);
  }
  const entries = [...groups.entries()];
  const hash = entries.findIndex(([l]) => l === '#');
  if (hash >= 0) entries.push(...entries.splice(hash, 1));
  return entries;
}

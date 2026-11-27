import { describe, expect, it } from 'vitest';
import type { RealContact } from '../../src/core/delivery/realMessaging';
import { contactMatches, groupByLetter, sortContacts } from '../../src/ui/contactSort';

const c = (name: string, addedAt: number, extra: Partial<RealContact> = {}) =>
  ({ account: `acc-${name}`, name, addedAt, known: true, ...extra }) as RealContact;
const list = [c('bob', 3), c('Émile', 1), c('alice', 2), c('42 club', 4), c('Zoë', 5)];
const names = (l: RealContact[]) => l.map((x) => x.name);

describe('Contact sorting', () => {
  it('sorts by name ignoring case and accents, both ways', () => {
    expect(names(sortContacts(list, 'az'))).toEqual(['42 club', 'alice', 'bob', 'Émile', 'Zoë']);
    expect(names(sortContacts(list, 'za'))).toEqual(['Zoë', 'Émile', 'bob', 'alice', '42 club']);
  });

  it('sorts by latest chat (no chat last) and by date added', () => {
    const last: Record<string, number> = { 'acc-bob': 50, 'acc-Zoë': 90 };
    expect(names(sortContacts(list, 'recent-chat', (a) => last[a]))).toEqual([
      'Zoë',
      'bob',
      '42 club',
      'alice',
      'Émile',
    ]);
    expect(names(sortContacts(list, 'recent-added'))).toEqual(['Zoë', '42 club', 'bob', 'alice', 'Émile']);
  });

  it('groups under first letters with "#" last, in either direction', () => {
    expect(groupByLetter(sortContacts(list, 'az')).map(([l]) => l)).toEqual(['A', 'B', 'E', 'Z', '#']);
    expect(groupByLetter(sortContacts(list, 'za')).map(([l]) => l)).toEqual(['Z', 'E', 'B', 'A', '#']);
  });

  it('searches names, @usernames, locations and IDs', () => {
    const x = c('Ada', 1, { profile: { username: 'ada', location: 'Portland, Oregon' } as RealContact['profile'] });
    expect(contactMatches(x, '@ad')).toBe(true);
    expect(contactMatches(x, 'portland')).toBe(true);
    expect(contactMatches(x, 'acc-a')).toBe(true);
    expect(contactMatches(x, 'paris')).toBe(false);
  });
});

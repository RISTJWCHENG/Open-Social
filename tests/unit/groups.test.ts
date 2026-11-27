import { describe, expect, it } from 'vitest';
import {
  diffGroup,
  mayChange,
  nextGroup,
  sanitizeGroup,
  withoutMember,
  type GroupState,
} from '../../src/core/groups/groups';

const base: GroupState = {
  id: '0123456789abcdef',
  name: 'G',
  about: '',
  photo: '',
  members: [
    { account: 'owner-a', role: 'owner', addedBy: 'owner-a', addedAt: 1 },
    { account: 'admin-b', role: 'admin', addedBy: 'owner-a', addedAt: 2 },
    { account: 'member-c', role: 'member', addedBy: 'owner-a', addedAt: 3 },
  ],
  onlyAdminsPost: false,
  onlyAdminsEdit: true,
  version: 1,
  updatedAt: 1,
  updatedBy: 'owner-a',
};
const add = (g: GroupState, account: string, role: 'member' | 'admin' = 'member') => [
  ...g.members,
  { account, role, addedBy: 'x', addedAt: 9 },
];

describe('group rules', () => {
  it('checks received states', () => {
    expect(sanitizeGroup(base)).toEqual(base);
    expect(sanitizeGroup({ ...base, id: 'nope' })).toBeNull();
    expect(sanitizeGroup({ ...base, name: '  ' })).toBeNull();
    expect(sanitizeGroup({ ...base, members: base.members.map((m) => ({ ...m, role: 'owner' })) })).toBeNull();
    expect(sanitizeGroup({ ...base, photo: 'https://evil.example/x.png' })!.photo).toBe('');
  });

  it('admins add members and promote; only the owner demotes admins or changes settings', () => {
    expect(mayChange(base, nextGroup(base, 'admin-b', { members: add(base, 'new-d') }), 'admin-b')).toBe(true);
    expect(mayChange(base, nextGroup(base, 'member-c', { members: add(base, 'new-d') }), 'member-c')).toBe(false);
    // New people join as members.
    expect(mayChange(base, nextGroup(base, 'admin-b', { members: add(base, 'new-d', 'admin') }), 'admin-b')).toBe(
      false,
    );
    const promoteC = base.members.map((m) => (m.account === 'member-c' ? { ...m, role: 'admin' as const } : m));
    expect(mayChange(base, nextGroup(base, 'admin-b', { members: promoteC }), 'admin-b')).toBe(true);
    const demoteB = base.members.map((m) => (m.account === 'admin-b' ? { ...m, role: 'member' as const } : m));
    expect(mayChange(base, nextGroup(base, 'admin-b', { members: demoteB }), 'admin-b')).toBe(true); // own demotion
    expect(mayChange(base, nextGroup(base, 'owner-a', { members: demoteB }), 'owner-a')).toBe(true);
    const noOwner = base.members.filter((m) => m.account !== 'owner-a');
    expect(mayChange(base, nextGroup(base, 'admin-b', { members: noOwner }), 'admin-b')).toBe(false);
    expect(mayChange(base, nextGroup(base, 'admin-b', { onlyAdminsPost: true }), 'admin-b')).toBe(false);
    expect(mayChange(base, nextGroup(base, 'owner-a', { onlyAdminsPost: true }), 'owner-a')).toBe(true);
  });

  it('members edit the info only when the group allows it; anyone may leave', () => {
    expect(mayChange(base, nextGroup(base, 'member-c', { name: 'New' }), 'member-c')).toBe(false);
    const open = { ...base, onlyAdminsEdit: false };
    expect(mayChange(open, nextGroup(open, 'member-c', { name: 'New' }), 'member-c')).toBe(true);
    expect(mayChange(base, nextGroup(base, 'member-c', { members: withoutMember(base, 'member-c') }), 'member-c')).toBe(
      true,
    );
    // Someone else's name on the change is refused.
    expect(mayChange(base, nextGroup(base, 'owner-a', { name: 'X' }), 'admin-b')).toBe(false);
  });

  it('an owner who leaves hands the group to the longest-serving admin', () => {
    const members = withoutMember(base, 'owner-a');
    expect(members.map((m) => [m.account, m.role])).toEqual([
      ['admin-b', 'owner'],
      ['member-c', 'member'],
    ]);
    const next = nextGroup(base, 'owner-a', { members });
    expect(mayChange(base, next, 'owner-a')).toBe(true);
    expect(diffGroup(base, next)).toMatchObject({ removed: ['owner-a'], owner: 'admin-b' });
  });
});

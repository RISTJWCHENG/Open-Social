/**
 * Group chats. Every member's app keeps the group's state (name, photo,
 * members and their roles, settings). Owners and admins change it and send
 * the new state, end-to-end encrypted over each member's MLS channels, to
 * everyone in the group (before and after the change). A copy is accepted
 * only from someone who may make that change, and only if it is newer than
 * the one held. Messages go from the sender's app to every member's devices
 * the same way, so the inbox shards never learn who is in a group.
 */

export type GroupRole = 'owner' | 'admin' | 'member';

export interface GroupMember {
  account: string;
  role: GroupRole;
  /** Who added them, and when (ms). */
  addedBy: string;
  addedAt: number;
}

export interface GroupState {
  /** 16 hex characters, chosen by the creator. */
  id: string;
  name: string;
  about: string;
  /** Data URL of a small photo (webp/jpeg/png), or ''. */
  photo: string;
  members: GroupMember[];
  /** Only the owner and admins may send messages. */
  onlyAdminsPost: boolean;
  /** Only the owner and admins may change the name, photo and description. */
  onlyAdminsEdit: boolean;
  /** Raised by one at every change; a higher version replaces a lower one. */
  version: number;
  /** When (ms) and by whom the last change was made. */
  updatedAt: number;
  updatedBy: string;
}

export const GROUP_LIMITS = { name: 80, about: 500, photo: 80_000, members: 256 } as const;

const ID = /^[0-9a-f]{16}$/;
/** An account (an ICP principal in text form). */
const ACCOUNT = /^(?=.{1,64}$)[a-z0-9]+(-[a-z0-9]+)*$/;
const PHOTO = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
const ROLES: GroupRole[] = ['owner', 'admin', 'member'];

/** The chat key of a group in the chat list and message store. */
export const groupKey = (id: string) => `g:${id}`;
export const isGroupKey = (key: string) => key.startsWith('g:');
export const groupIdOf = (key: string) => (isGroupKey(key) ? key.slice(2) : null);
export const isGroupId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);

export function roleOf(g: GroupState, account: string): GroupRole | null {
  return g.members.find((m) => m.account === account)?.role ?? null;
}

export const isMember = (g: GroupState, account: string) => roleOf(g, account) !== null;

export function isAdmin(g: GroupState, account: string): boolean {
  const r = roleOf(g, account);
  return r === 'owner' || r === 'admin';
}

export const canPost = (g: GroupState, account: string) =>
  isMember(g, account) && (!g.onlyAdminsPost || isAdmin(g, account));
export const canEditInfo = (g: GroupState, account: string) =>
  isMember(g, account) && (!g.onlyAdminsEdit || isAdmin(g, account));

const text = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) : null);

/** A group state received from someone else, checked field by field; null if malformed. */
export function sanitizeGroup(raw: unknown): GroupState | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Partial<GroupState>;
  if (!isGroupId(g.id)) return null;
  const name = text(g.name, GROUP_LIMITS.name);
  const about = text(g.about ?? '', GROUP_LIMITS.about);
  if (!name || about === null) return null;
  const photo =
    typeof g.photo === 'string' && g.photo.length <= GROUP_LIMITS.photo && PHOTO.test(g.photo) ? g.photo : '';
  if (!Array.isArray(g.members) || g.members.length === 0 || g.members.length > GROUP_LIMITS.members) return null;
  const members: GroupMember[] = [];
  for (const m of g.members as Partial<GroupMember>[]) {
    if (!m || typeof m.account !== 'string' || !ACCOUNT.test(m.account)) return null;
    if (!ROLES.includes(m.role as GroupRole)) return null;
    if (typeof m.addedBy !== 'string' || !ACCOUNT.test(m.addedBy) || !Number.isFinite(m.addedAt)) return null;
    if (members.some((x) => x.account === m.account)) return null;
    members.push({ account: m.account, role: m.role as GroupRole, addedBy: m.addedBy, addedAt: m.addedAt! });
  }
  if (members.filter((m) => m.role === 'owner').length !== 1) return null;
  if (!Number.isInteger(g.version) || g.version! < 1) return null;
  if (!Number.isFinite(g.updatedAt) || typeof g.updatedBy !== 'string' || !ACCOUNT.test(g.updatedBy)) return null;
  return {
    id: g.id,
    name,
    about,
    photo,
    members,
    onlyAdminsPost: g.onlyAdminsPost === true,
    onlyAdminsEdit: g.onlyAdminsEdit === true,
    version: g.version!,
    updatedAt: g.updatedAt!,
    updatedBy: g.updatedBy,
  };
}

/** True if `next` is a newer copy than `cur` (version, then time, then author breaks ties). */
export function isNewer(next: GroupState, cur: GroupState): boolean {
  if (next.version !== cur.version) return next.version > cur.version;
  if (next.updatedAt !== cur.updatedAt) return next.updatedAt > cur.updatedAt;
  return next.updatedBy > cur.updatedBy;
}

/**
 * Whether `from` may turn `cur` into `next`. Members who are not admins may
 * only change the name, photo and description (when the group allows it).
 * Admins may also add and remove members and make members admins; only the
 * owner may remove or demote an admin, change the settings, or hand over
 * ownership. Nobody but the owner themselves (by leaving) removes the owner.
 */
export function mayChange(cur: GroupState, next: GroupState, from: string): boolean {
  if (next.id !== cur.id || next.updatedBy !== from) return false;
  const role = roleOf(cur, from);
  if (!role) return false;
  const infoChanged = next.name !== cur.name || next.about !== cur.about || next.photo !== cur.photo;
  if (infoChanged && !canEditInfo(cur, from)) return false;
  const settingsChanged = next.onlyAdminsPost !== cur.onlyAdminsPost || next.onlyAdminsEdit !== cur.onlyAdminsEdit;
  if (settingsChanged && role !== 'owner') return false;
  const before = new Map(cur.members.map((m) => [m.account, m.role]));
  const after = new Map(next.members.map((m) => [m.account, m.role]));
  const ownerBefore = cur.members.find((m) => m.role === 'owner')?.account;
  const ownerAfter = next.members.find((m) => m.role === 'owner')?.account;
  if (!ownerAfter || next.members.filter((m) => m.role === 'owner').length !== 1) return false;
  if (ownerAfter !== ownerBefore && role !== 'owner') return false;
  for (const [account, r] of before) {
    const now = after.get(account);
    if (now === r) continue;
    if (account === from && now === undefined) continue; // leaving
    if (account === from && r === 'admin' && now === 'member') continue; // stepping down
    if (role === 'member') return false;
    // Removing or demoting an admin (or the owner) is the owner's call.
    if (r !== 'member' && role !== 'owner') return false;
  }
  for (const [account, r] of after) {
    if (before.has(account)) continue;
    // New members join as members; only admins add them.
    if (role === 'member' || r !== 'member') return false;
  }
  return true;
}

/** What changed between two states, for the "Alice added Bob" lines in the chat. */
export interface GroupChange {
  added: string[];
  removed: string[];
  promoted: string[];
  demoted: string[];
  owner?: string;
  renamed?: string;
  photo?: boolean;
  about?: boolean;
  settings?: boolean;
}

export function diffGroup(cur: GroupState, next: GroupState): GroupChange {
  const before = new Map(cur.members.map((m) => [m.account, m.role]));
  const after = new Map(next.members.map((m) => [m.account, m.role]));
  const change: GroupChange = { added: [], removed: [], promoted: [], demoted: [] };
  for (const a of after.keys()) if (!before.has(a)) change.added.push(a);
  for (const a of before.keys()) if (!after.has(a)) change.removed.push(a);
  for (const [a, r] of after) {
    const was = before.get(a);
    if (!was || was === r) continue;
    if (r === 'owner') change.owner = a;
    else if (r === 'admin') change.promoted.push(a);
    else if (was === 'admin') change.demoted.push(a);
  }
  if (next.name !== cur.name) change.renamed = next.name;
  if (next.photo !== cur.photo) change.photo = true;
  if (next.about !== cur.about) change.about = true;
  if (next.onlyAdminsPost !== cur.onlyAdminsPost || next.onlyAdminsEdit !== cur.onlyAdminsEdit) change.settings = true;
  return change;
}

/** The next version of a group, changed by `by`. */
export function nextGroup(cur: GroupState, by: string, patch: Partial<Omit<GroupState, 'id' | 'version'>>): GroupState {
  return {
    ...cur,
    ...patch,
    version: cur.version + 1,
    updatedAt: Math.max(Date.now(), cur.updatedAt + 1),
    updatedBy: by,
  };
}

/**
 * The group without `account` (who is leaving). An owner who leaves hands the
 * group to the longest-serving admin, else the longest-serving member.
 */
export function withoutMember(g: GroupState, account: string): GroupMember[] {
  const rest = g.members.filter((m) => m.account !== account);
  if (roleOf(g, account) === 'owner' && rest.length > 0) {
    const byAge = [...rest].sort((a, b) => a.addedAt - b.addedAt);
    const heir = byAge.find((m) => m.role === 'admin') ?? byAge[0]!;
    return rest.map((m) => (m.account === heir.account ? { ...m, role: 'owner' as const } : m));
  }
  return rest;
}

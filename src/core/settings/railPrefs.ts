/**
 * Which features show in the left rail, and in what order. Chats is always
 * shown. Stored per account on this device.
 */

export const RAIL_IDS = [
  'chats',
  'updates',
  'news',
  'video',
  'contacts',
  'lounge',
  'events',
  'market',
  'space',
  'ideas',
  'spaces',
  'network',
  'circles',
] as const;

export type RailId = (typeof RAIL_IDS)[number];

/** Always in the rail. */
export const LOCKED: RailId[] = ['chats'];

export interface RailPrefs {
  order: RailId[];
  hidden: RailId[];
}

export const DEFAULT_RAIL: RailPrefs = { order: [...RAIL_IDS], hidden: [] };

const isId = (v: unknown): v is RailId => typeof v === 'string' && (RAIL_IDS as readonly string[]).includes(v);

/** Repairs stored prefs: unknown ids dropped, new features appended, Chats never hidden. */
export function normalizeRail(raw: unknown): RailPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown };
  const order = Array.isArray(r.order) ? [...new Set(r.order.filter(isId))] : [];
  for (const id of RAIL_IDS) if (!order.includes(id)) order.push(id);
  const hidden = Array.isArray(r.hidden)
    ? [...new Set(r.hidden.filter(isId))].filter((id) => !LOCKED.includes(id))
    : [];
  return { order, hidden };
}

export const visibleRail = (p: RailPrefs): RailId[] => p.order.filter((id) => !p.hidden.includes(id));

export function setShown(p: RailPrefs, id: RailId, shown: boolean): RailPrefs {
  if (LOCKED.includes(id)) return p;
  const hidden = shown ? p.hidden.filter((x) => x !== id) : [...new Set([...p.hidden, id])];
  return { ...p, hidden };
}

/** Moves an item up (-1) or down (+1). */
export function moveRail(p: RailPrefs, id: RailId, delta: -1 | 1): RailPrefs {
  const i = p.order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= p.order.length) return p;
  const order = [...p.order];
  [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...p, order };
}

export const isDefaultRail = (p: RailPrefs) =>
  p.hidden.length === 0 && p.order.every((id, i) => id === DEFAULT_RAIL.order[i]);

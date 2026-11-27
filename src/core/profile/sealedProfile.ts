/**
 * Friends-only profile: name, username, about, location, birth date and a 256 px photo, encrypted
 * on the device with the owner's profile key (AES-256-GCM). The ciphertext is
 * stored in open-social-profiles; the key reaches friends inside MLS.
 */
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from '../crypto/bytes';

/** What the person says they are up to, shown to friends while they are online. */
export type PresenceStatus = 'available' | 'busy' | 'dnd' | 'away';
export const PRESENCE_STATUSES: readonly PresenceStatus[] = ['available', 'busy', 'dnd', 'away'];

export interface ProfileContent {
  displayName: string;
  username: string;
  bio: string;
  /** Data URL of the photo, or ''. */
  avatar: string;
  /** Data URL of the cover image shown at the top of the profile panel, or ''. */
  cover: string;
  /** Where the person is (free text, e.g. "Brussels, Belgium"), or ''. Friends only. */
  location: string;
  /** Birth date as YYYY-MM-DD, or ''. Friends only. */
  birthDate: string;
  /** Labelled https links. */
  links: { label: string; url: string }[];
  /** Friends only: never part of the public profile. */
  status: PresenceStatus;
  updatedAt: number;
}

export const MAX_LINKS = 10;
export const MAX_LOCATION = 30;

/** A real calendar date written YYYY-MM-DD, from 1900 to today. */
export function isBirthDate(value: string, now = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return y >= 1900 && date.getTime() <= today;
}

/** https URL with a dotted host and nothing that could make it a script or credential URL. */
export function isSafeLink(url: string): boolean {
  if (url.length > 200 || /\s/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password;
  } catch {
    return false;
  }
}

const MAGIC = utf8('ZSP1');

export function newProfileKey(): string {
  return toBase64(randomBytes(32));
}

async function aes(key: string, usage: KeyUsage) {
  return crypto.subtle.importKey('raw', fromBase64(key), 'AES-GCM', false, [usage]);
}

export async function sealProfile(p: ProfileContent, key: string): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: MAGIC }, await aes(key, 'encrypt'), utf8(JSON.stringify(p))),
  );
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export async function openProfile(blob: Uint8Array, key: string): Promise<ProfileContent> {
  if (blob.length < 32 || fromUtf8(blob.subarray(0, 4)) !== 'ZSP1') throw new Error('Not a sealed profile');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.subarray(4, 16), additionalData: MAGIC },
    await aes(key, 'decrypt'),
    blob.subarray(16),
  );
  return normalizeProfile(JSON.parse(fromUtf8(new Uint8Array(pt))));
}

/**
 * Turns any stored or received value into a valid profile: known fields with
 * limits, safe photo and links, defaults for anything missing (e.g. data saved
 * before a field existed).
 */
export function normalizeProfile(value: unknown): ProfileContent {
  const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  const avatar = str(p.avatar, 200_000);
  const cover = str(p.cover, 200_000);
  const image = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
  return {
    displayName: str(p.displayName, 40),
    username: str(p.username, 40),
    bio: str(p.bio, 160),
    location: str(p.location, MAX_LOCATION),
    birthDate: typeof p.birthDate === 'string' && isBirthDate(p.birthDate) ? p.birthDate : '',
    avatar: image.test(avatar) ? avatar : '',
    cover: image.test(cover) ? cover : '',
    links: (Array.isArray(p.links) ? p.links : [])
      .slice(0, MAX_LINKS)
      .map((l) => ({ label: str((l as { label?: unknown })?.label, 30), url: str((l as { url?: unknown })?.url, 200) }))
      .filter((l) => isSafeLink(l.url)),
    status: PRESENCE_STATUSES.includes(p.status as PresenceStatus) ? (p.status as PresenceStatus) : 'available',
    updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
  };
}

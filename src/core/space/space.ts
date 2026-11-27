/**
 * My Space: each account's public personal page. Item kinds, limits,
 * validation of drafts, links into the app, and follows (kept on the device).
 */

export type ItemKind = 'post' | 'link' | 'work' | 'video' | 'music' | 'dapp';

export interface ImageMeta {
  hash: string;
  mime: string;
  size: number;
}

export interface MediaMeta {
  id: string;
  mime: string;
  size: number;
  chunks: number;
}

export interface SpaceItem {
  id: string;
  owner: string;
  kind: ItemKind;
  title: string;
  body: string;
  url: string;
  tags: string[];
  images: ImageMeta[];
  media: MediaMeta | null;
  canisterId: string;
  likes: number;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceInfo {
  owner: string;
  about: string;
  accent: Accent;
  pinned: string | null;
  visible: boolean;
  showMarket: boolean;
  items: number;
  likes: number;
  usedBytes: number | null;
  quotaBytes: number;
}

export interface SpaceSettingsInput {
  about: string;
  accent: Accent;
  pinned: string | null;
  visible: boolean;
  showMarket: boolean;
}

export type ImageInput = { keep: string } | { add: Uint8Array };

export interface ItemInput {
  kind: ItemKind;
  title: string;
  body: string;
  url: string;
  tags: string[];
  images: ImageInput[];
  /** An upload id, or the item's current media id to keep it. */
  media: string | null;
  canisterId: string;
}

export interface ItemPage {
  items: SpaceItem[];
  total: number;
  nextOffset: number | null;
}

export const KINDS: { id: ItemKind; label: string; plural: string; hint: string }[] = [
  { id: 'post', label: 'Post', plural: 'Posts', hint: 'Thoughts, news and photos' },
  { id: 'link', label: 'Link', plural: 'Links', hint: 'Something worth sharing on the web' },
  { id: 'work', label: 'Work', plural: 'Works', hint: 'Art, design, photography, projects' },
  { id: 'video', label: 'Video', plural: 'Videos', hint: 'Upload a clip or link to one' },
  { id: 'music', label: 'Music', plural: 'Music', hint: 'Upload a track or link to one' },
  { id: 'dapp', label: 'Dapp', plural: 'Dapps', hint: 'An app you built, on ICP or elsewhere' },
];

export const kindLabel = (k: ItemKind) => KINDS.find((x) => x.id === k)?.label ?? 'Item';

export const ACCENTS = ['violet', 'blue', 'teal', 'green', 'amber', 'rose', 'slate'] as const;
export type Accent = (typeof ACCENTS)[number];
export const ACCENT_COLORS: Record<Accent, [string, string]> = {
  violet: ['#4f3fb2', '#9b8cf0'],
  blue: ['#2968cf', '#7fb1f5'],
  teal: ['#0f8a8a', '#6fd3c9'],
  green: ['#2f8a4f', '#9bd98b'],
  amber: ['#b26b00', '#f5c76a'],
  rose: ['#c0365f', '#f29ab4'],
  slate: ['#3d4452', '#a3acbd'],
};

export const LIMITS = {
  title: 120,
  body: 5000,
  about: 500,
  url: 500,
  tags: 5,
  tag: 24,
  images: 6,
  imageBytes: 240 * 1024,
  chunk: 1536 * 1024,
  video: 25 * 1024 * 1024,
  audio: 12 * 1024 * 1024,
};

/** How many images each kind takes. */
export const IMAGE_SLOTS: Record<ItemKind, number> = { post: 6, link: 1, work: 6, video: 1, music: 1, dapp: 1 };

export interface ItemDraft {
  kind: ItemKind;
  title: string;
  body: string;
  url: string;
  tags: string;
  canisterId: string;
  imageCount: number;
  hasMedia: boolean;
}

const PRINCIPAL = /^[a-z0-9]{5}(-[a-z0-9]{5}){1,9}(-[a-z0-9]{1,5})?$/;

/** Splits "art, #music  photo" into ["art", "music", "photo"]. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const t = raw.replace(/^#/, '').toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function itemDraftErrors(d: ItemDraft): Partial<Record<keyof ItemDraft, string>> {
  const e: Partial<Record<keyof ItemDraft, string>> = {};
  const title = d.title.trim();
  const url = d.url.trim();
  if (title.length > LIMITS.title) e.title = `At most ${LIMITS.title} characters.`;
  if (d.body.trim().length > LIMITS.body) e.body = `At most ${LIMITS.body} characters.`;
  if (url && (!/^https:\/\/[^\s]+$/i.test(url) || url.length > LIMITS.url)) e.url = 'Use an https:// address.';
  const tags = parseTags(d.tags);
  if (tags.length > LIMITS.tags) e.tags = `At most ${LIMITS.tags} tags.`;
  else if (tags.some((t) => t.length > LIMITS.tag || !/^[\p{L}\p{N}_-]+$/u.test(t)))
    e.tags = 'Tags are single words (letters, numbers, - and _).';
  if (d.canisterId.trim() && !PRINCIPAL.test(d.canisterId.trim())) e.canisterId = 'That is not a valid canister ID.';
  const needTitle = d.kind !== 'post' && d.kind !== 'link';
  if (needTitle && !title) e.title = 'Add a title.';
  if (d.kind === 'post' && !d.body.trim() && d.imageCount === 0) e.body = 'Write something or add a photo.';
  if ((d.kind === 'link' || d.kind === 'dapp') && !url && !e.url) e.url = 'Add the address.';
  if (d.kind === 'work' && d.imageCount === 0) e.imageCount = 'Add at least one image of your work.';
  if ((d.kind === 'video' || d.kind === 'music') && !d.hasMedia && !url && !e.url)
    e.url = 'Upload a file or add a link.';
  return e;
}

/** A link that opens a space, or one item in it. */
export const spaceLink = (owner: string, itemId?: string, origin = 'https://chat.opensocial.cc') =>
  `${origin}/#/space/${owner}${itemId ? `/${itemId}` : ''}`;

export function spaceRouteFromHash(hash: string): { owner: string; itemId?: string } | null {
  const m = /^#\/space\/([a-z0-9-]{5,63})(?:\/(\d{1,19}))?$/.exec(hash);
  if (!m || !PRINCIPAL.test(m[1]!)) return null;
  return m[2] ? { owner: m[1]!, itemId: m[2] } : { owner: m[1]! };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The host of a link, without "www.". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Mime type for an upload (browsers sometimes leave it empty). */
export function mediaMime(name: string, type: string): string {
  if (type.startsWith('video/') || type.startsWith('audio/')) return type;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/mp4',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/mp4',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    flac: 'audio/flac',
  };
  return map[ext] ?? type;
}

export const followsKey = (account: string) => `zc-space-follows:${account}`;

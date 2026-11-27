/**
 * Link previews carried inside an encrypted text message. The sender's app
 * fetches the preview once (through the identity canister) and sends it with
 * the text, so receivers show the card without ever contacting the site.
 * Everything received is checked here before it is stored or shown.
 */

export interface LinkPreview {
  /** The address the preview describes; it appears in the message text. */
  url: string;
  title?: string;
  description?: string;
  /** Site name, e.g. "YouTube". */
  site?: string;
  /** A small image as a data URL (webp, jpeg or png). */
  image?: string;
}

/** A preview as looked up for a link being written: the card's text, and its image to fetch. */
export interface FetchedPreview {
  preview: LinkPreview;
  imageUrl?: string;
}

export const LP_MAX_URL = 2048;
export const LP_MAX_TITLE = 200;
export const LP_MAX_DESCRIPTION = 300;
export const LP_MAX_SITE = 60;
/** Longest image data URL accepted (keeps a message well under the mailbox's 64 KB entry limit). */
export const LP_MAX_IMAGE = 40_000;

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[).,;:!?\]}'"»”’]+$/;
const IMAGE_RE = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A web address as typed in a text, without trailing punctuation; undefined if it isn't one. */
function cleanUrl(raw: string): string | undefined {
  let url = raw;
  // Keep a closing bracket that belongs to the URL, e.g. ".../Foo_(bar)".
  while (TRAILING.test(url)) {
    const last = url.at(-1)!;
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    url = url.slice(0, -1);
  }
  try {
    const u = new URL(url);
    if (!u.hostname.includes('.') || u.username || u.password) return undefined;
  } catch {
    return undefined;
  }
  return url;
}

/** A text split into plain runs and web addresses, in order. */
export function linkParts(text: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const url = cleanUrl(m[0]);
    if (!url) continue;
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: url, url });
    at = m.index + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The first web address in a text (trailing punctuation removed), if any. */
export function firstUrl(text: string): string | undefined {
  // OpenSocial's own links (e.g. a market listing) open in the app, so they get no preview card.
  return linkParts(text).find((p) => p.url && !inAppHash(p.url))?.url;
}

const APP_HOSTS = ['chat.opensocial.cc', 'ydmpv-niaaa-aaaak-qzlua-cai.icp0.io'];

/** The in-app route ("#/market/12", "#/space/<id>/3") of a link to OpenSocial itself, if it is one. */
export function inAppHash(url: string): string | null {
  try {
    const u = new URL(url);
    const own = APP_HOSTS.includes(u.hostname) || (typeof location !== 'undefined' && u.host === location.host);
    return own && /^#\/(market\/\d{1,19}|space\/[a-z0-9-]{5,63}(\/\d{1,19})?)$/.test(u.hash) ? u.hash : null;
  } catch {
    return null;
  }
}

/** The address to fetch for a link typed in a message (http is upgraded to https). */
export function previewTarget(url: string): string {
  return url.replace(/^http:\/\//i, 'https://');
}

/** The host shown on the card, without "www.". */
export function previewHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
};

/**
 * Checks a preview (from the wire or the canister). Returns undefined when it
 * is unusable: no title, a non-https address, or an address that isn't in the
 * message text (`body`) - a card must never point somewhere the text doesn't.
 */
export function sanitizeLinkPreview(raw: unknown, body: string): LinkPreview | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const url = typeof r.url === 'string' ? r.url : '';
  if (!url || url.length > LP_MAX_URL || !/^https:\/\//i.test(url)) return undefined;
  try {
    new URL(url);
  } catch {
    return undefined;
  }
  const linked = firstUrl(body);
  if (!linked || previewTarget(linked) !== url) return undefined;
  const title = text(r.title, LP_MAX_TITLE);
  if (!title) return undefined;
  const description = text(r.description, LP_MAX_DESCRIPTION);
  const site = text(r.site, LP_MAX_SITE);
  const image =
    typeof r.image === 'string' && r.image.length <= LP_MAX_IMAGE && IMAGE_RE.test(r.image) ? r.image : undefined;
  return {
    url,
    title,
    ...(description ? { description } : {}),
    ...(site ? { site } : {}),
    ...(image ? { image } : {}),
  };
}

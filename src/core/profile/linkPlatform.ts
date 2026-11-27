/**
 * Which known service a profile link points to, from its host name, so the
 * profile can show that service's logo. The logos are part of the app (see
 * linkServices.ts) and are loaded on demand; nothing is fetched from the
 * services themselves, and any other address gets the standard web icon.
 */
import type { LinkService } from './linkServices';

export interface LinkPlatform {
  name: string;
  /** SVG path in a 24 x 24 box. */
  path: string;
  /** Brand colour, #rrggbb. */
  color: string;
  /**
   * The logo is itself a circle (Facebook, Telegram, …): shown as is, not on a
   * backdrop, with its cut-outs in this colour, as in the original.
   */
  roundInner: string | null;
}

/** Host name to service, longest names first so music.youtube.com wins over youtube.com. */
let byHost: [host: string, platform: LinkPlatform][] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function index(services: readonly LinkService[]): [string, LinkPlatform][] {
  const entries: [string, LinkPlatform][] = [];
  for (const [icon, hosts, roundInner] of services) {
    const platform = { name: icon.title, path: icon.path, color: `#${icon.hex}`, roundInner: roundInner ?? null };
    for (const host of hosts) entries.push([host, platform]);
  }
  return entries.sort((a, b) => b[0].length - a[0].length);
}

/** Load the built-in logos (once). Components re-render through subscribeLinkPlatforms. */
export function loadLinkPlatforms(): Promise<void> {
  loading ??= import('./linkServices').then(({ LINK_SERVICES }) => {
    byHost = index(LINK_SERVICES);
    for (const listener of listeners) listener();
  });
  return loading;
}

export function subscribeLinkPlatforms(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the built-in logos are loaded (a snapshot for useSyncExternalStore). */
export function linkPlatformsReady(): boolean {
  return byHost !== null;
}

/** The service a link belongs to, or null for any other website (or before the logos load). */
export function linkPlatform(url: string): LinkPlatform | null {
  if (!byHost) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  for (const [known, platform] of byHost) {
    if (host === known || host.endsWith(`.${known}`)) return platform;
  }
  return null;
}

/** Black or white, whichever reads better on the given #rrggbb background. */
export function glyphOn(color: string): '#000000' | '#ffffff' {
  const n = parseInt(color.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#000000' : '#ffffff';
}

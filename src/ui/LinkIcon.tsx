/**
 * A round icon for a profile link: logos that are circles (Facebook, Telegram,
 * …) as they are; other logos (Instagram, Discord, …) on a circle of their
 * brand colour; the standard web icon for any other address. The logos ship
 * with the app: showing one never contacts the website the link points to.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  glyphOn,
  linkPlatform,
  linkPlatformsReady,
  loadLinkPlatforms,
  subscribeLinkPlatforms,
} from '../core/profile/linkPlatform';

// Fetch the logo table (from this app's own canister) as soon as the app
// starts, so it is in by the time anyone types an address.
if (typeof window !== 'undefined') void loadLinkPlatforms();

/** Load the built-in logos and re-render once they are in. */
export function useLinkPlatforms(): boolean {
  useEffect(() => {
    void loadLinkPlatforms();
  }, []);
  return useSyncExternalStore(subscribeLinkPlatforms, linkPlatformsReady);
}

export function LinkIcon({ url, size = 36 }: { url: string; size?: number }) {
  useLinkPlatforms();
  const platform = linkPlatform(url);
  const glyph = Math.round(size * 0.5);
  if (!platform) {
    return (
      <span className="link-icon is-web" style={{ width: size, height: size }} aria-hidden="true">
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
        </svg>
      </span>
    );
  }
  if (platform.roundInner) {
    // Already a circle: the logo itself, full size, in its colour (its cut-outs
    // filled with the colour that reads on it, as in the original).
    return (
      <span className="link-icon" style={{ width: size, height: size }} aria-hidden="true">
        <svg width={size} height={size} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10.6" fill={platform.roundInner} />
          <path d={platform.path} fill={platform.color} />
        </svg>
      </span>
    );
  }
  return (
    <span
      className={`link-icon${nearWhite(platform.color) ? ' is-light' : ''}`}
      style={{ width: size, height: size, background: platform.color, color: glyphOn(platform.color) }}
      aria-hidden="true"
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="currentColor">
        <path d={platform.path} />
      </svg>
    </span>
  );
}

/** A brand colour so pale its circle would vanish on a white page. */
function nearWhite(color: string): boolean {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].every((v) => v >= 0xf0);
}

/** The service's name for a link ("Instagram"), or null for any other website. */
export function linkServiceName(url: string): string | null {
  return linkPlatform(url)?.name ?? null;
}

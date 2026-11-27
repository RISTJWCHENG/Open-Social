/**
 * The link preview for the message being written: after a short pause in
 * typing, the first link in the draft is looked up; its text shows first and
 * the image follows. The preview can be removed (for that link) before
 * sending; `take` hands it to the send call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { firstUrl, type FetchedPreview, type LinkPreview } from '../core/delivery/linkPreview';

const DEBOUNCE_MS = 600;
/** How long sending waits for a preview (text, then image) that is still loading. */
const SEND_WAIT_MS = 4_000;
const IMAGE_WAIT_MS = 3_000;

export interface DraftPreview {
  url: string;
  /** undefined while loading. */
  preview: LinkPreview | undefined;
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

export function useLinkDraftPreview(
  draft: string,
  enabled: boolean,
  fetchPreview: (url: string) => Promise<FetchedPreview | null>,
  fetchImage: (imageUrl: string) => Promise<string | undefined>,
) {
  const [shown, setShown] = useState<DraftPreview | null>(null);
  const dismissed = useRef(new Set<string>());
  const url = enabled ? firstUrl(draft) : undefined;

  /** The card's text, and a promise of the card with its image. */
  const lookup = useCallback(
    async (u: string): Promise<{ preview: LinkPreview; full: Promise<LinkPreview> } | null> => {
      const found = await fetchPreview(u).catch(() => null);
      if (!found) return null;
      const { preview, imageUrl } = found;
      const full = imageUrl
        ? fetchImage(imageUrl)
            .catch(() => undefined)
            .then((image) => (image ? { ...preview, image } : preview))
        : Promise.resolve(preview);
      return { preview, full };
    },
    [fetchPreview, fetchImage],
  );

  useEffect(() => {
    if (!url || dismissed.current.has(url)) {
      setShown(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setShown((s) => (s?.url === url ? s : { url, preview: undefined }));
      void lookup(url).then((found) => {
        if (!live) return;
        setShown(found ? { url, preview: found.preview } : null);
        void found?.full.then((preview) => {
          if (live) setShown((s) => (s?.url === url ? { url, preview } : s));
        });
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, lookup]);

  const dismiss = useCallback(() => {
    if (shown) dismissed.current.add(shown.url);
    setShown(null);
  }, [shown]);

  /** The preview to send with `body` (waits briefly if it is still loading), then clears it. */
  const take = useCallback(
    async (body: string): Promise<LinkPreview | undefined> => {
      const u = firstUrl(body);
      setShown(null);
      if (!u || dismissed.current.has(u)) return undefined;
      const found = await within(lookup(u), SEND_WAIT_MS);
      if (!found) return undefined;
      return (await within(found.full, IMAGE_WAIT_MS)) ?? found.preview;
    },
    [lookup],
  );

  return { shown, dismiss, take };
}

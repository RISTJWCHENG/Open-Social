/**
 * Photos for listings: shrinks a picked image for upload (at most 1600 px on
 * the longer side, WebP or JPEG, under the size limit) and caches downloaded
 * listing photos as object URLs.
 */
import { useEffect, useState } from 'react';
import { MAX_PHOTO_BYTES } from '../../core/market/market';

const MAX_SIDE = 1600;
const QUALITIES = [0.82, 0.7, 0.58, 0.46];

async function encode(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

/** Returns the image ready to upload, or throws with a message for the user. */
export async function shrinkPhoto(file: Blob): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('That file is not an image this browser can open.');
    });
    let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    for (let round = 0; round < 4; round++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of QUALITIES) {
        let blob = await encode(canvas, 'image/webp', q);
        if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', q);
        if (blob && blob.size <= MAX_PHOTO_BYTES) return new Uint8Array(await blob.arrayBuffer());
      }
      scale *= 0.75;
    }
    throw new Error('That photo could not be made small enough.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type PhotoLoader = (listingId: string, hash: string) => Promise<Uint8Array | null>;

const cache = new Map<string, Promise<string | null>>();

/** Object URL of a listing photo (cached for the session). */
export function photoUrl(load: PhotoLoader, listingId: string, hash: string, mime = 'image/webp') {
  const key = `${listingId}:${hash}`;
  let p = cache.get(key);
  if (!p) {
    p = load(listingId, hash)
      .then((b) => (b ? URL.createObjectURL(new Blob([b as BlobPart], { type: mime })) : null))
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}

export function usePhoto(load: PhotoLoader, listingId: string, hash: string | undefined, mime?: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!hash) return;
    let alive = true;
    void photoUrl(load, listingId, hash, mime).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [load, listingId, hash, mime]);
  return url;
}

/**
 * Shrinks a link preview's image so it fits in a message: at most 480 px on
 * its longer side, WebP (JPEG where WebP can't be encoded), and under the
 * preview size limit. Returns undefined when the image can't be used.
 */
import { LP_MAX_IMAGE } from '../core/delivery/linkPreview';

const MAX_SIDE = 480;
const QUALITIES = [0.78, 0.62, 0.48];

export async function previewImage(bytes: Uint8Array, type: string): Promise<string | undefined> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return undefined;
    let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    for (let round = 0; round < 3; round++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of QUALITIES) {
        let out = canvas.toDataURL('image/webp', q);
        if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= LP_MAX_IMAGE) return out;
      }
      scale *= 0.7;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    URL.revokeObjectURL(url);
  }
}

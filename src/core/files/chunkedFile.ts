/**
 * Streaming file encryption for large attachments ("OSF1").
 *
 * The plaintext is split into chunks (4 MiB); each is sealed with AES-256-GCM
 * under the file key. Chunk i uses the nonce base(8 bytes) || i (u32, big
 * endian) and the additional data "OSF1" || i || last-flag, so chunks can't be
 * reordered, dropped, duplicated or cut off without the decryption failing.
 * Only a few chunks are in memory at a time, whatever the file size.
 */

export const FILE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
const TAG = 16;
const MAGIC = new TextEncoder().encode('OSF1');

/** A file to send: read in ranges, never all at once. */
export interface FileSource {
  name: string;
  mime: string;
  size: number;
  read(start: number, end: number): Promise<Uint8Array>;
}

export function chunkCount(size: number, chunk = FILE_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(size / chunk));
}

/** Size of the encrypted stream for a plaintext of `size` bytes. */
export function ciphertextSize(size: number, chunk = FILE_CHUNK_BYTES): number {
  return size + chunkCount(size, chunk) * TAG;
}

function nonce(base: Uint8Array, i: number): Uint8Array {
  const n = new Uint8Array(12);
  n.set(base.subarray(0, 8));
  new DataView(n.buffer).setUint32(8, i);
  return n;
}

function aad(i: number, last: boolean): Uint8Array {
  const a = new Uint8Array(9);
  a.set(MAGIC);
  new DataView(a.buffer).setUint32(4, i);
  a[8] = last ? 1 : 0;
  return a;
}

export async function importFileKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypted stream of a file, read and sealed chunk by chunk as the consumer pulls. */
export function encryptStream(
  src: FileSource,
  key: CryptoKey,
  base: Uint8Array,
  onChunk?: (done: number, total: number) => void,
  chunk = FILE_CHUNK_BYTES,
): ReadableStream<Uint8Array> {
  const n = chunkCount(src.size, chunk);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= n) {
        controller.close();
        return;
      }
      const plain = await src.read(i * chunk, Math.min(src.size, (i + 1) * chunk));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonce(base, i), additionalData: aad(i, i === n - 1) },
          key,
          plain,
        ),
      );
      controller.enqueue(sealed);
      i++;
      onChunk?.(i, n);
    },
  });
}

/**
 * Decrypts an OSF1 stream of a file of `size` plaintext bytes. Fails on any
 * tampering, on truncation and on trailing data.
 */
export function decryptStream(
  cipher: ReadableStream<Uint8Array>,
  key: CryptoKey,
  base: Uint8Array,
  size: number,
  chunk = FILE_CHUNK_BYTES,
): ReadableStream<Uint8Array> {
  const n = chunkCount(size, chunk);
  const sealedLen = (i: number) => (i < n - 1 ? chunk : size - (n - 1) * chunk) + TAG;
  const reader = cipher.getReader();
  let buf = new Uint8Array(0);
  let i = 0;
  const take = async (len: number): Promise<Uint8Array | null> => {
    while (buf.length < len) {
      const r = await reader.read();
      if (r.done) return null;
      const next = new Uint8Array(buf.length + r.value.length);
      next.set(buf);
      next.set(r.value, buf.length);
      buf = next;
    }
    const out = buf.slice(0, len);
    buf = buf.slice(len);
    return out;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= n) {
        // Nothing may follow the last chunk.
        if (buf.length > 0 || !(await reader.read()).done) {
          controller.error(new Error('The file has unexpected extra data.'));
          return;
        }
        controller.close();
        return;
      }
      const sealed = await take(sealedLen(i));
      if (!sealed) {
        controller.error(new Error('The file is incomplete.'));
        return;
      }
      try {
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonce(base, i), additionalData: aad(i, i === n - 1) },
          key,
          sealed,
        );
        controller.enqueue(new Uint8Array(plain));
        i++;
      } catch {
        controller.error(new Error('The file failed its integrity check.'));
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** A FileSource over bytes already in memory (small files, tests). */
export function bytesSource(name: string, mime: string, bytes: Uint8Array): FileSource {
  return {
    name,
    mime,
    size: bytes.length,
    read: async (s, e) => bytes.subarray(s, e),
  };
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Seals chunk `i` of `n` (same bytes as encryptStream produces for it). */
export async function sealChunk(key: CryptoKey, base: Uint8Array, i: number, n: number, plain: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(base, i), additionalData: aad(i, i === n - 1) }, key, plain),
  );
}

/** Opens chunk `i` of `n`; throws if it was altered, moved or isn't the expected last one. */
export async function openChunk(key: CryptoKey, base: Uint8Array, i: number, n: number, sealed: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(base, i), additionalData: aad(i, i === n - 1) }, key, sealed),
  );
}

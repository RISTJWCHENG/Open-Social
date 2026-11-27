import { describe, expect, it } from 'vitest';
import {
  bytesSource,
  ciphertextSize,
  decryptStream,
  encryptStream,
  importFileKey,
  readAll,
} from '../../src/core/files/chunkedFile';

const CH = 1000; // small chunks keep the tests fast; the format is the same
const data = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);
const streamOf = (b: Uint8Array, piece = 333) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < b.length; i += piece) c.enqueue(b.slice(i, i + piece));
      c.close();
    },
  });

async function seal(plain: Uint8Array) {
  const key = await importFileKey(crypto.getRandomValues(new Uint8Array(32)));
  const base = crypto.getRandomValues(new Uint8Array(8));
  const ct = await readAll(encryptStream(bytesSource('f', 'x', plain), key, base, undefined, CH));
  return { key, base, ct };
}
const open = (ct: Uint8Array, key: CryptoKey, base: Uint8Array, size: number) =>
  readAll(decryptStream(streamOf(ct), key, base, size, CH));

describe('OSF1 streaming file encryption', () => {
  it('round-trips at every size around chunk boundaries', async () => {
    for (const n of [0, 1, CH - 1, CH, CH + 1, 3 * CH + 5]) {
      const plain = data(n);
      const { key, base, ct } = await seal(plain);
      expect(ct.length).toBe(ciphertextSize(n, CH));
      expect(Buffer.from(await open(ct, key, base, n)).equals(Buffer.from(plain))).toBe(true);
    }
  });

  it('detects tampering, truncation, reordering and trailing data', async () => {
    const n = 3 * CH + 5;
    const { key, base, ct } = await seal(data(n));
    const flipped = ct.slice();
    flipped[CH + 20] = flipped[CH + 20]! ^ 1;
    await expect(open(flipped, key, base, n)).rejects.toThrow(/integrity/);
    await expect(open(ct.slice(0, ct.length - 10), key, base, n)).rejects.toThrow(/incomplete/);
    // Drop the last chunk and claim a shorter file: the new "last" chunk isn't marked last.
    await expect(open(ct.slice(0, 3 * (CH + 16)), key, base, 3 * CH)).rejects.toThrow(/integrity/);
    const swapped = new Uint8Array(ct);
    swapped.set(ct.subarray(CH + 16, 2 * (CH + 16)), 0);
    swapped.set(ct.subarray(0, CH + 16), CH + 16);
    await expect(open(swapped, key, base, n)).rejects.toThrow(/integrity/);
    const extra = new Uint8Array(ct.length + 1);
    extra.set(ct);
    await expect(open(extra, key, base, n)).rejects.toThrow(/extra data/);
  });

  it('reads the source chunk by chunk, not all at once', async () => {
    const reads: number[] = [];
    const src = { ...bytesSource('f', 'x', data(5 * CH)), read: async (s: number, e: number) => (reads.push(e - s), data(e - s)) };
    const key = await importFileKey(new Uint8Array(32));
    await readAll(encryptStream(src, key, new Uint8Array(8), undefined, CH));
    expect(reads).toEqual([CH, CH, CH, CH, CH]);
  });
});

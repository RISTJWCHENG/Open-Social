import { describe, expect, it } from 'vitest';
import { inlineChunks } from '../../src/core/delivery/realMessaging';

const CHUNK = 32 * 1024;
const LIMIT = 64 * 1024;
/** Size of the first chunk's payload text: base64 data plus what rides with it, plus JSON keys. */
const firstPayload = (data: number, extras: { thumb?: string; caption?: string }) =>
  Math.ceil(data / 3) * 4 + (extras.thumb?.length ?? 0) + JSON.stringify(extras.caption ?? '').length + 400;

describe('Inline chunk plan', () => {
  it('covers the whole file in order, with no gaps', () => {
    for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 10 * 1024 * 1024]) {
      const plan = inlineChunks(size, {});
      expect(plan[0]![0]).toBe(0);
      for (let i = 1; i < plan.length; i++) expect(plan[i]![0]).toBe(plan[i - 1]![1]);
      expect(plan.at(-1)![1]).toBe(size);
    }
  });

  it('gives up room in the first chunk for a large preview and caption, so entries stay under 64 KB', () => {
    const thumb = `data:image/webp;base64,${'A'.repeat(37_900)}`; // the largest preview allowed
    const caption = '“' + 'é'.repeat(4000) + '”';
    const plan = inlineChunks(500_000, { thumb, caption });
    const first = plan[0]![1] - plan[0]![0];
    expect(first).toBeLessThan(CHUNK);
    // Plus MLS and the signed entry (well under 2 KB together).
    expect(firstPayload(first, { thumb, caption }) + 2048).toBeLessThan(LIMIT);
    // Without extras the first chunk is full size.
    expect(inlineChunks(500_000, {})[0]).toEqual([0, CHUNK]);
  });
});

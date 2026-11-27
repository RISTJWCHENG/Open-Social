import { describe, expect, it } from 'vitest';
import { SiaStorageClient, SMALL_OBJECT_BYTES, shardsFor } from '../../src/modules/sia-storage/siaStorage';

/** A fake Sia SDK: records each upload's shard setting and bytes; can refuse 1+2. */
function fakeClient(refuseSmall: boolean) {
  const uploads: { dataShards: number; parityShards: number; bytes: number }[] = [];
  const client = new SiaStorageClient('acct', 'https://example.test');
  const sdk = {
    async upload(_obj: unknown, stream: ReadableStream<Uint8Array>, opts: { dataShards: number; parityShards: number }) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      if (refuseSmall && opts.dataShards === 1) throw new Error('minimum 10 data shards');
      uploads.push({ dataShards: opts.dataShards, parityShards: opts.parityShards, bytes: bytes.length });
      return { updateMetadata() {}, id: () => `obj${uploads.length}` };
    },
    async pinObject() {},
    async createSharingKey() {
      return { seed: () => 'seed' };
    },
    async shareObject() {},
  };
  Object.assign(client as unknown as Record<string, unknown>, { sdk, mod: { PinnedObject: class {} } });
  return { client, uploads };
}

const reopenable = (n: number) => () => new Blob([new Uint8Array(n).fill(7)]).stream();

describe('Sia shard settings', () => {
  it('uses 1+2 up to 10 MB and 10+20 above', () => {
    expect(shardsFor(1)).toEqual({ dataShards: 1, parityShards: 2 });
    expect(shardsFor(SMALL_OBJECT_BYTES)).toEqual({ dataShards: 1, parityShards: 2 });
    expect(shardsFor(SMALL_OBJECT_BYTES + 1)).toEqual({ dataShards: 10, parityShards: 20 });
    expect(shardsFor(1, false)).toEqual({ dataShards: 10, parityShards: 20 });
  });

  it('uploads small objects with 1+2 when the indexer accepts it', async () => {
    const { client, uploads } = fakeClient(false);
    await client.uploadShared(reopenable(5000), 5000);
    await client.uploadShared(reopenable(20 * 1024 * 1024), 20 * 1024 * 1024);
    expect(uploads.map((u) => u.dataShards)).toEqual([1, 10]);
  });

  it('falls back to 10+20 once if 1+2 is refused, re-reading the same bytes, and remembers it', async () => {
    const { client, uploads } = fakeClient(true);
    await client.uploadShared(reopenable(5000), 5000);
    expect(uploads).toEqual([{ dataShards: 10, parityShards: 20, bytes: 5000 }]); // complete retry
    await client.uploadShared(reopenable(3000), 3000);
    expect(uploads.map((u) => u.dataShards)).toEqual([10, 10]); // no second 1+2 attempt
  });
});

/** Client for the space module: public personal pages and their items. */
import {
  LIMITS,
  type Accent,
  type ItemInput,
  type ItemKind,
  type ItemPage,
  type SpaceInfo,
  type SpaceItem,
  type SpaceSettingsInput,
} from '../../core/space/space';
import { SPACE_CANISTER_ID, spaceIdl } from './spaceIdl';

type Identity = import('@icp-sdk/core/agent').Identity;
type Res<T> = { Ok: T } | { Err: string };

const ok = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new Error(r.Err);
  return r.Ok;
};
const bytes = (v: Uint8Array | number[]) => (v instanceof Uint8Array ? v : Uint8Array.from(v));

const KIND_OUT: Record<ItemKind, string> = {
  post: 'Post',
  link: 'Link',
  work: 'Work',
  video: 'Video',
  music: 'Music',
  dapp: 'Dapp',
};
const kindIn = (v: Record<string, null>): ItemKind => (Object.keys(v)[0] ?? 'Post').toLowerCase() as ItemKind;

interface RawItem {
  id: bigint;
  owner: { toText(): string };
  kind: Record<string, null>;
  title: string;
  body: string;
  url: string;
  tags: string[];
  images: { hash: string; mime: string; size: number }[];
  media: [] | [{ id: bigint; mime: string; size: bigint; chunks: number }];
  canister_id: string;
  likes: number;
  hidden: boolean;
  created_at_ns: bigint;
  updated_at_ns: bigint;
}

export const itemFromRaw = (r: RawItem): SpaceItem => ({
  id: String(r.id),
  owner: r.owner.toText(),
  kind: kindIn(r.kind),
  title: r.title,
  body: r.body,
  url: r.url,
  tags: r.tags,
  images: r.images,
  media: r.media[0]
    ? { id: String(r.media[0].id), mime: r.media[0].mime, size: Number(r.media[0].size), chunks: r.media[0].chunks }
    : null,
  canisterId: r.canister_id,
  likes: r.likes,
  hidden: r.hidden,
  createdAt: Number(r.created_at_ns / 1_000_000n),
  updatedAt: Number(r.updated_at_ns / 1_000_000n),
});

const pageFromRaw = (r: { items: RawItem[]; total: bigint; next_offset: [] | [bigint] }): ItemPage => ({
  items: r.items.map(itemFromRaw),
  total: Number(r.total),
  nextOffset: r.next_offset[0] === undefined ? null : Number(r.next_offset[0]),
});

export class SpaceClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(
    private readonly identity: () => Identity | null,
    private readonly canisterId = SPACE_CANISTER_ID,
  ) {}

  private actor() {
    return (this.actorPromise ??= (async () => {
      const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
      const id = this.identity();
      const agent = await HttpAgent.create(id ? { identity: id } : {});
      return Actor.createActor(spaceIdl, { agent, canisterId: this.canisterId });
    })());
  }

  private async principal(text: string) {
    const { Principal } = await import('@icp-sdk/core/principal');
    return Principal.fromText(text);
  }

  async get(owner: string): Promise<SpaceInfo | null> {
    const r = (await (await this.actor()).space_get(await this.principal(owner))) as [] | [Record<string, never>];
    const v = r[0] as
      | undefined
      | {
          owner: { toText(): string };
          about: string;
          accent: string;
          pinned: [] | [bigint];
          visible: boolean;
          show_market: boolean;
          items: bigint;
          likes: bigint;
          used_bytes: [] | [bigint];
          quota_bytes: bigint;
        };
    if (!v) return null;
    return {
      owner: v.owner.toText(),
      about: v.about,
      accent: v.accent as Accent,
      pinned: v.pinned[0] === undefined ? null : String(v.pinned[0]),
      visible: v.visible,
      showMarket: v.show_market,
      items: Number(v.items),
      likes: Number(v.likes),
      usedBytes: v.used_bytes[0] === undefined ? null : Number(v.used_bytes[0]),
      quotaBytes: Number(v.quota_bytes),
    };
  }

  async setSettings(s: SpaceSettingsInput): Promise<void> {
    ok(
      await (
        await this.actor()
      ).space_set({
        about: s.about,
        accent: s.accent,
        pinned: s.pinned ? [BigInt(s.pinned)] : [],
        visible: s.visible,
        show_market: s.showMarket,
      }),
    );
  }

  async items(owner: string, kind: ItemKind | null, offset: number, limit: number): Promise<ItemPage> {
    return pageFromRaw(
      await (
        await this.actor()
      ).space_items(await this.principal(owner), kind ? [{ [KIND_OUT[kind]]: null }] : [], BigInt(offset), limit),
    );
  }

  async item(id: string): Promise<SpaceItem | null> {
    const r = (await (await this.actor()).space_item(BigInt(id))) as [] | [RawItem];
    return r[0] ? itemFromRaw(r[0]) : null;
  }

  /** Several items by id, in the given order (ones the caller may not see are left out). */
  async itemsByIds(ids: string[]): Promise<SpaceItem[]> {
    if (!ids.length) return [];
    return ((await (await this.actor()).space_items_by_ids(ids.map((i) => BigInt(i)))) as RawItem[]).map(itemFromRaw);
  }

  async recent(kind: ItemKind | null, offset: number, limit: number): Promise<ItemPage> {
    return pageFromRaw(
      await (await this.actor()).space_recent(kind ? [{ [KIND_OUT[kind]]: null }] : [], BigInt(offset), limit),
    );
  }

  async feed(owners: string[], offset: number, limit: number): Promise<ItemPage> {
    if (!owners.length) return { items: [], total: 0, nextOffset: null };
    const ps = await Promise.all(owners.map((o) => this.principal(o)));
    return pageFromRaw(await (await this.actor()).space_feed(ps, BigInt(offset), limit));
  }

  async image(id: string, hash: string): Promise<Uint8Array | null> {
    const r = (await (await this.actor()).space_image(BigInt(id), hash)) as [] | [Uint8Array | number[]];
    return r[0] ? bytes(r[0]) : null;
  }

  /** Downloads a video or audio file, reporting progress (0..1). */
  async media(m: { id: string; chunks: number; mime: string }, onProgress?: (p: number) => void): Promise<Blob> {
    const actor = await this.actor();
    const parts: Uint8Array[] = [];
    for (let i = 0; i < m.chunks; i++) {
      const r = (await actor.space_media_chunk(BigInt(m.id), i)) as [] | [Uint8Array | number[]];
      if (!r[0]) throw new Error('This file is not available.');
      parts.push(bytes(r[0]));
      onProgress?.((i + 1) / m.chunks);
    }
    return new Blob(parts as BlobPart[], { type: m.mime });
  }

  /** Uploads a video or audio file in parts; returns its upload id. */
  async upload(file: Blob, mime: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
    const actor = await this.actor();
    const id = ok(await actor.space_upload_begin(mime, BigInt(file.size))) as bigint;
    try {
      const n = Math.ceil(file.size / LIMITS.chunk);
      for (let i = 0; i < n; i++) {
        if (signal?.aborted) throw new Error('Upload cancelled.');
        const part = new Uint8Array(await file.slice(i * LIMITS.chunk, (i + 1) * LIMITS.chunk).arrayBuffer());
        ok(await actor.space_upload_chunk(id, i, part));
        onProgress?.((i + 1) / n);
      }
      return String(id);
    } catch (e) {
      await actor.space_upload_cancel(id).catch(() => undefined);
      throw e;
    }
  }

  private input(i: ItemInput) {
    return {
      kind: { [KIND_OUT[i.kind]]: null },
      title: i.title,
      body: i.body,
      url: i.url,
      tags: i.tags,
      images: i.images.map((p) => ('keep' in p ? { Keep: p.keep } : { Add: p.add })),
      media: i.media ? [BigInt(i.media)] : [],
      canister_id: i.canisterId,
    };
  }

  async create(i: ItemInput): Promise<string> {
    return String(ok(await (await this.actor()).space_create(this.input(i))));
  }

  async update(id: string, i: ItemInput): Promise<void> {
    ok(await (await this.actor()).space_update(BigInt(id), this.input(i)));
  }

  async remove(id: string): Promise<void> {
    ok(await (await this.actor()).space_delete(BigInt(id)));
  }

  async like(id: string, like: boolean): Promise<number> {
    return ok(await (await this.actor()).space_like(BigInt(id), like)) as number;
  }

  async liked(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    return ((await (await this.actor()).space_liked(ids.map((i) => BigInt(i)))) as bigint[]).map(String);
  }

  /** Deletes everything the caller published in the space canister (listings and space). */
  async deleteMyData(): Promise<void> {
    ok(await (await this.actor()).delete_my_data());
  }

  async report(id: string, reason: string): Promise<void> {
    ok(await (await this.actor()).space_report(BigInt(id), reason));
  }
}

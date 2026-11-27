/**
 * Client for the market module: public listings anyone can browse; posting
 * and managing listings is done as the signed-in account.
 */
import type {
  Listing,
  ListingInput,
  ListingStatus,
  MarketPage,
  MarketQuery,
  MarketSort,
} from '../../core/market/market';
import { MARKET_CANISTER_ID, marketIdl } from './marketIdl';

type Identity = import('@icp-sdk/core/agent').Identity;
type Res<T> = { Ok: T } | { Err: string };

const ok = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new Error(r.Err);
  return r.Ok;
};

interface RawListing {
  id: bigint;
  seller: { toText(): string };
  seller_name: string;
  title: string;
  description: string;
  category: string;
  condition: string;
  price: bigint;
  currency: string;
  negotiable: boolean;
  location: string;
  shipping: boolean;
  pickup: boolean;
  photos: { hash: string; mime: string; size: number }[];
  status: Record<string, null>;
  created_at_ns: bigint;
  updated_at_ns: bigint;
}

const STATUS: Record<string, ListingStatus> = {
  Active: 'active',
  Reserved: 'reserved',
  Sold: 'sold',
  Hidden: 'hidden',
};
const SORT: Record<MarketSort, string> = { newest: 'Newest', 'price-low': 'PriceLow', 'price-high': 'PriceHigh' };

export const fromRaw = (r: RawListing): Listing => ({
  id: String(r.id),
  seller: r.seller.toText(),
  sellerName: r.seller_name,
  title: r.title,
  description: r.description,
  category: r.category,
  condition: r.condition,
  price: Number(r.price),
  currency: r.currency,
  negotiable: r.negotiable,
  location: r.location,
  shipping: r.shipping,
  pickup: r.pickup,
  photos: r.photos,
  status: STATUS[Object.keys(r.status)[0] ?? 'Active'] ?? 'active',
  createdAt: Number(r.created_at_ns / 1_000_000n),
  updatedAt: Number(r.updated_at_ns / 1_000_000n),
});

const opt = <T>(v: T | undefined | null): [] | [T] => (v === undefined || v === null || v === '' ? [] : [v]);

export class MarketClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(
    private readonly identity: () => Identity | null,
    private readonly canisterId = MARKET_CANISTER_ID,
  ) {}

  private actor() {
    return (this.actorPromise ??= (async () => {
      const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
      const id = this.identity();
      const agent = await HttpAgent.create(id ? { identity: id } : {});
      return Actor.createActor(marketIdl, { agent, canisterId: this.canisterId });
    })());
  }

  private async principal(text: string) {
    const { Principal } = await import('@icp-sdk/core/principal');
    return Principal.fromText(text);
  }

  private input(i: ListingInput) {
    return {
      seller_name: i.sellerName,
      title: i.title,
      description: i.description,
      category: i.category,
      condition: i.condition,
      price: BigInt(i.price),
      currency: i.currency,
      negotiable: i.negotiable,
      location: i.location,
      shipping: i.shipping,
      pickup: i.pickup,
      photos: i.photos.map((p) => ('keep' in p ? { Keep: p.keep } : { Add: p.add })),
    };
  }

  /** `ids`: only these listings, in this order (the search canister's matches for `q.text`). */
  async search(q: MarketQuery, offset: number, limit: number, ids?: string[]): Promise<MarketPage> {
    const raw = (await (
      await this.actor()
    ).market_search({
      text: q.text,
      category: opt(q.category),
      condition: opt(q.condition),
      currency: opt(q.currency),
      min_price: opt(q.minPrice === undefined ? undefined : BigInt(q.minPrice)),
      max_price: opt(q.maxPrice === undefined ? undefined : BigInt(q.maxPrice)),
      free_only: q.freeOnly,
      shipping_only: q.shippingOnly,
      location: q.location,
      seller: q.seller ? [await this.principal(q.seller)] : [],
      sort: { [SORT[q.sort]]: null },
      offset: BigInt(offset),
      limit,
      ids: ids ? [ids.map((i) => BigInt(i))] : [],
    })) as { items: RawListing[]; total: bigint; next_offset: [] | [bigint] };
    return {
      items: raw.items.map(fromRaw),
      total: Number(raw.total),
      nextOffset: raw.next_offset[0] === undefined ? null : Number(raw.next_offset[0]),
    };
  }

  async get(id: string): Promise<Listing | null> {
    const r = (await (await this.actor()).market_listing(BigInt(id))) as [] | [RawListing];
    return r[0] ? fromRaw(r[0]) : null;
  }

  async getMany(ids: string[]): Promise<Listing[]> {
    if (!ids.length) return [];
    return ((await (await this.actor()).market_listings(ids.map((i) => BigInt(i)))) as RawListing[]).map(fromRaw);
  }

  async mine(): Promise<Listing[]> {
    return ((await (await this.actor()).market_my_listings()) as RawListing[]).map(fromRaw);
  }

  async counts(): Promise<Record<string, number>> {
    const r = (await (await this.actor()).market_counts()) as [string, bigint][];
    return Object.fromEntries(r.map(([k, v]) => [k, Number(v)]));
  }

  async photo(id: string, hash: string): Promise<Uint8Array | null> {
    const r = (await (await this.actor()).market_photo(BigInt(id), hash)) as [] | [Uint8Array | number[]];
    if (!r[0]) return null;
    return r[0] instanceof Uint8Array ? r[0] : Uint8Array.from(r[0]);
  }

  async create(i: ListingInput): Promise<string> {
    return String(ok(await (await this.actor()).market_create(this.input(i))));
  }

  async update(id: string, i: ListingInput): Promise<void> {
    ok(await (await this.actor()).market_update(BigInt(id), this.input(i)));
  }

  async setStatus(id: string, status: 'active' | 'reserved' | 'sold'): Promise<void> {
    const v = { active: 'Active', reserved: 'Reserved', sold: 'Sold' }[status];
    ok(await (await this.actor()).market_set_status(BigInt(id), { [v]: null }));
  }

  async remove(id: string): Promise<void> {
    ok(await (await this.actor()).market_delete(BigInt(id)));
  }

  async report(id: string, reason: string): Promise<void> {
    ok(await (await this.actor()).market_report(BigInt(id), reason));
  }
}

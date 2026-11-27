/**
 * Client for the OpenSocial search canister: one full-text index of public
 * profiles, market listings and space items. Searching needs no sign-in.
 */
import { SEARCH_CANISTER_ID, searchIdl } from './searchIdl';

export type SearchKind = 'profile' | 'listing' | 'space';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  owner: string;
  title: string;
  snippet: string;
  score: number;
  updatedAt: number;
}

export interface SearchPage {
  hits: SearchHit[];
  total: number;
  nextOffset: number | null;
}

/** Candidate ids a search hands to a source canister for its own filters. */
export const MAX_IDS = 1000;

export class SearchClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(private readonly canisterId = SEARCH_CANISTER_ID) {}

  private actor() {
    return (this.actorPromise ??= (async () => {
      const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
      const agent = await HttpAgent.create({});
      return Actor.createActor(searchIdl, { agent, canisterId: this.canisterId });
    })());
  }

  /** Ranked matches (all words must match; the last one as a prefix while typing). */
  async search(text: string, kinds: SearchKind[], offset: number, limit: number): Promise<SearchPage> {
    const r = (await (await this.actor()).search({ text, kinds, offset, limit })) as {
      hits: {
        kind: string;
        id: string;
        owner: { toText(): string };
        title: string;
        snippet: string;
        score: number;
        updated_at_ns: bigint;
      }[];
      total: bigint;
      next_offset: [] | [number];
    };
    return {
      hits: r.hits.map((h) => ({
        kind: h.kind as SearchKind,
        id: h.id,
        owner: h.owner.toText(),
        title: h.title,
        snippet: h.snippet,
        score: h.score,
        updatedAt: Number(h.updated_at_ns / 1_000_000n),
      })),
      total: Number(r.total),
      nextOffset: r.next_offset[0] ?? null,
    };
  }

  /** Ids of matching documents of one kind, best first. */
  async ids(text: string, kind: SearchKind, limit = MAX_IDS): Promise<string[]> {
    return (await (await this.actor()).search_ids(text, kind, limit)) as string[];
  }
}

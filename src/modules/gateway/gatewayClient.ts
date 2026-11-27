/**
 * Client for the OpenSocial gateway canister: link previews, the news feed and
 * stories, and HashFirst Global data, read from the web by the canister.
 * Calls are made as the signed-in account (the gateway serves accounts only).
 */
import { OpenSocialError } from '../../core/types';
import type { NewsFeed } from '../../core/news/news';
import { GATEWAY_CANISTER_ID, gatewayIdl } from './gatewayIdl';

type Identity = import('@icp-sdk/core/agent').Identity;
type Res<T> = { Ok: T } | { Err: string };

const unwrap = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new OpenSocialError('MAILBOX_REJECTED', r.Err);
  return r.Ok;
};
const bytes = (v: Uint8Array | number[]) => (v instanceof Uint8Array ? v : Uint8Array.from(v));

/** A page preview as the canister returns it (the image still to fetch). */
export interface RawLinkPreview {
  url: string;
  title?: string;
  description?: string;
  site?: string;
  imageUrl?: string;
}

type WireNewsItem = {
  id: string;
  title: string;
  summary: [] | [string];
  protocol: [] | [string];
  source: [] | [string];
  url: string;
  published_at_ms: bigint;
  thumb: [] | [string];
};

function newsFeed(raw: unknown): NewsFeed {
  const r = raw as { items: WireNewsItem[]; fetched_at_ns: bigint };
  return {
    fetchedAt: Number(r.fetched_at_ns / 1_000_000n),
    items: r.items.map((i) => ({
      id: i.id,
      title: i.title,
      summary: i.summary[0],
      protocol: i.protocol[0],
      source: i.source[0],
      url: i.url,
      publishedAt: Number(i.published_at_ms),
      thumb: i.thumb[0],
    })),
  };
}

export class GatewayClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(
    private readonly identity: () => Identity | null,
    private readonly canisterId = GATEWAY_CANISTER_ID,
    private readonly host?: string,
  ) {}

  private async actor() {
    if (!this.actorPromise) {
      const id = this.identity();
      if (!id) throw new OpenSocialError('NOT_SIGNED_IN', 'Sign in first.');
      this.actorPromise = (async () => {
        const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
        const agent = await HttpAgent.create({ identity: id, ...(this.host ? { host: this.host } : {}) });
        return Actor.createActor(gatewayIdl, { agent, canisterId: this.canisterId });
      })();
    }
    return this.actorPromise;
  }

  /** Reads a web page's preview text and image address through the canister (nothing is stored there). */
  async linkPreview(url: string): Promise<RawLinkPreview> {
    const a = await this.actor();
    const r = unwrap(await a.link_preview(url)) as {
      url: string;
      title: [] | [string];
      description: [] | [string];
      site_name: [] | [string];
      image_url: [] | [string];
    };
    return {
      url: r.url,
      title: r.title[0],
      description: r.description[0],
      site: r.site_name[0],
      imageUrl: r.image_url[0],
    };
  }

  /** Fetches a preview image through the canister. */
  async linkPreviewImage(url: string): Promise<{ bytes: Uint8Array; type: string }> {
    const a = await this.actor();
    const r = unwrap(await a.link_preview_image(url)) as { bytes: Uint8Array | number[]; content_type: string };
    return { bytes: bytes(r.bytes), type: r.content_type };
  }

  /** The news feed as the canister last fetched it. */
  async news(): Promise<NewsFeed> {
    const a = await this.actor();
    return newsFeed(await a.news());
  }

  /** Asks the canister to fetch the news again (it skips this when the feed is fresh). */
  async refreshNews(): Promise<NewsFeed> {
    const a = await this.actor();
    return newsFeed(unwrap(await a.refresh_news()));
  }

  /** A HashFirst Global API response (JSON text), from the canister's cache when it has one. */
  async hashfirst(path: string): Promise<string> {
    const a = await this.actor();
    const cached = (await a.cached_hashfirst(path)) as [] | [string];
    return cached[0] ?? (unwrap(await a.hashfirst(path)) as string);
  }

  /** A story's body HTML (unsanitized: the app cleans it before showing it). */
  async newsArticle(id: string): Promise<string> {
    const a = await this.actor();
    type Wire = { content_html: string };
    const cached = (await a.cached_news_article(id)) as [] | [Wire];
    return (cached[0] ?? (unwrap(await a.news_article(id)) as Wire)).content_html;
  }

  /** A story's cover image. */
  async newsCover(id: string): Promise<{ bytes: Uint8Array; type: string }> {
    const a = await this.actor();
    type Wire = { bytes: Uint8Array | number[]; content_type: string };
    const cached = (await a.cached_news_cover(id)) as [] | [Wire];
    const r = cached[0] ?? (unwrap(await a.news_cover(id)) as Wire);
    return { bytes: bytes(r.bytes), type: r.content_type };
  }
}

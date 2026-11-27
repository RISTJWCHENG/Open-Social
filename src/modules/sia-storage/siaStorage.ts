/**
 * The user's own Sia Storage space (https://sia.storage), used for encrypted
 * chat backups and for sharing large attachments.
 *
 * The user approves OpenSocial once; the SDK derives a per-user app key from a
 * recovery phrase only the user holds. The 32-byte app key seed is kept in
 * the encrypted device store, so the user stays connected. The SDK
 * (WebAssembly) is loaded only when Sia is used.
 */
import { OpenSocialError } from '../../core/types';
import { secureGet, secureSet } from '../../core/storage/secureStore';
import { openBackup, sealBackup } from './backupCrypto';

type SiaModule = typeof import('@siafoundation/sia-storage');
type Sdk = import('@siafoundation/sia-storage').Sdk;
type Builder = import('@siafoundation/sia-storage').Builder;


export const SIA_INDEXER_URL = 'https://sia.storage';

/** 32-byte app id: SHA-256("opensocial/sia-app-id/v1"), fixed for the app's lifetime. */
export const OPENSOCIAL_SIA_APP_ID = 'a40461cdab059bf85cbefe8e45d0fa6179d56ff600d7c1a3391b92413b45b00a';

/** Object kinds OpenSocial stores (in object metadata). */
export const KIND_BACKUP = 'open-social-backup';
export const KIND_FILE = 'open-social-file';

export interface SiaAccountInfo {
  pinnedBytes: number;
  remainingBytes: number;
  maxBytes: number;
}

/** An object OpenSocial stored: a chat backup or a file shared with friends. */
export interface SiaItem {
  id: string;
  kind: 'backup' | 'file';
  createdAt: Date;
  sizeBytes: number;
}

export interface BackupInfo {
  id: string;
  createdAt: Date;
  sizeBytes: number;
}

const SECTOR = 4 * 1024 * 1024;

/**
 * Erasure coding per object size. Hosts store whole 4 MiB sectors, so an
 * object takes at least one sector per shard:
 * - small (up to 10 MB): 1 data + 2 parity = three full copies on three hosts;
 *   at least 4 MiB counted, about 12 MiB uploaded;
 * - larger: 10 data + 20 parity across 30 hosts; at least 40 MiB counted,
 *   faster parallel downloads and more host failures tolerated.
 * Both store three times the data.
 */
export const SMALL_OBJECT_BYTES = 10 * 1024 * 1024;
const SMALL_SHARDS = { dataShards: 1, parityShards: 2 };
const LARGE_SHARDS = { dataShards: 10, parityShards: 20 };

export function shardsFor(size: number, smallAllowed = true) {
  return smallAllowed && size <= SMALL_OBJECT_BYTES ? SMALL_SHARDS : LARGE_SHARDS;
}

/** A source that can be read again (the same bytes each time), so an upload can be retried. */
export type ReopenableStream = () => ReadableStream<Uint8Array>;

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

async function loadModule(): Promise<SiaModule> {
  const mod = await import('@siafoundation/sia-storage');
  await mod.initSia();
  return mod;
}

export class SiaStorageClient {
  private mod: SiaModule | null = null;
  private sdk: Sdk | null = null;
  private builder: Builder | null = null;
  private readonly keyName: string;

  constructor(
    accountPrincipal: string,
    private readonly origin: string = window.location.origin,
  ) {
    this.keyName = `sia-app-key:${accountPrincipal}`;
  }

  private async load(): Promise<SiaModule> {
    return (this.mod ??= await loadModule());
  }

  private appMeta() {
    return {
      appId: OPENSOCIAL_SIA_APP_ID,
      name: 'OpenSocial',
      description: 'Private messaging. Stores your encrypted backups and shared files in your own Sia space.',
      serviceUrl: this.origin,
      logoUrl: undefined,
      callbackUrl: undefined,
    };
  }

  isConnected(): boolean {
    return !!this.sdk;
  }

  /** Reconnects with the saved app key. False if there is none (nothing is loaded then). */
  async resume(): Promise<boolean> {
    if (this.sdk) return true;
    const hex = await secureGet<string>(this.keyName);
    if (!hex) return false;
    const mod = await this.load();
    const sdk = await new mod.Builder(SIA_INDEXER_URL, this.appMeta()).connected(new mod.AppKey(fromHex(hex)));
    if (!sdk) {
      await secureSet(this.keyName, null);
      return false;
    }
    this.sdk = sdk;
    return true;
  }

  /** Step 1: ask the indexer for a connection; returns the URL the user opens to approve. */
  async requestApproval(): Promise<string> {
    const mod = await this.load();
    this.builder = new mod.Builder(SIA_INDEXER_URL, this.appMeta());
    await this.builder.requestConnection();
    return this.builder.responseUrl();
  }

  /** Step 2: waits for approval. True if this Sia account used OpenSocial before. */
  async waitForApproval(): Promise<boolean> {
    if (!this.builder) throw new OpenSocialError('SIA_NO_REQUEST', 'Start the connection first.');
    await this.builder.waitForApproval();
    return this.builder.reconnecting();
  }

  /** Step 3a (new): creates a recovery phrase and registers. Returns the phrase to show once. */
  async registerNew(): Promise<string> {
    const mod = await this.load();
    const phrase = mod.generateRecoveryPhrase();
    await this.finishRegister(phrase);
    return phrase;
  }

  /** Step 3b (returning): registers with the phrase the user saved earlier. */
  async registerExisting(phrase: string): Promise<void> {
    const mod = await this.load();
    if (!this.builder) throw new OpenSocialError('SIA_NO_REQUEST', 'Start the connection first.');
    const clean = phrase.trim().toLowerCase().split(/\s+/).join(' ');
    try {
      mod.validateRecoveryPhrase(clean);
    } catch {
      throw new OpenSocialError('SIA_BAD_PHRASE', 'That recovery phrase is not valid.');
    }
    if (!(await this.builder.matchesExistingAppKey(clean))) {
      throw new OpenSocialError('SIA_PHRASE_MISMATCH', 'This phrase does not match the one used with this Sia account before.');
    }
    await this.finishRegister(clean);
  }

  private async finishRegister(phrase: string) {
    if (!this.builder) throw new OpenSocialError('SIA_NO_REQUEST', 'Start the connection first.');
    const sdk = await this.builder.register(phrase);
    await secureSet(this.keyName, toHex(sdk.appKey().export()));
    this.sdk = sdk;
    this.builder = null;
  }

  async disconnect(): Promise<void> {
    await secureSet(this.keyName, null);
    this.sdk = null;
    this.builder = null;
  }

  private need(): Sdk {
    if (!this.sdk) throw new OpenSocialError('SIA_NOT_CONNECTED', 'Connect your Sia storage first.');
    return this.sdk;
  }

  async account(): Promise<SiaAccountInfo> {
    const a = await this.need().account();
    return { pinnedBytes: a.pinnedData, remainingBytes: a.remainingStorage, maxBytes: a.maxPinnedData };
  }

  /** Whether the indexer accepts the small-object setting (unknown until tried; remembered per session). */
  private smallShards: boolean | null = null;

  /** Last setting used, for diagnostics and tests. */
  lastShards: { dataShards: number; parityShards: number } | null = null;

  /**
   * Uploads `size` bytes (read as they upload) and pins them. Small objects use
   * 1+2 shards; if the indexer refuses that, the upload is retried once with
   * 10+20 from a fresh copy of the stream, and 10+20 is used from then on.
   */
  private async put(kind: string, open: ReopenableStream, size: number, onProgress?: (f: number) => void) {
    const attempt = async (shards: { dataShards: number; parityShards: number }) => {
      const sdk = this.need();
      const mod = await this.load();
      const total = Math.max(1, Math.ceil(size / (shards.dataShards * SECTOR))) * (shards.dataShards + shards.parityShards);
      let done = 0;
      this.lastShards = shards;
      const obj = await sdk.upload(new mod.PinnedObject(), open(), {
        ...shards,
        onShardUploaded: () => onProgress?.(Math.min(1, ++done / total)),
      });
      obj.updateMetadata(new TextEncoder().encode(JSON.stringify({ kind, v: 1, at: Date.now() })));
      await sdk.pinObject(obj);
      return obj;
    };
    const shards = shardsFor(size, this.smallShards !== false);
    if (shards === LARGE_SHARDS) return attempt(LARGE_SHARDS);
    try {
      const obj = await attempt(SMALL_SHARDS);
      this.smallShards = true;
      return obj;
    } catch (e) {
      if (this.smallShards === true) throw e; // worked before: a real error, not the setting
      this.smallShards = false;
      console.warn('OpenSocial: Sia refused 1+2 shards, using 10+20:', e);
      return attempt(LARGE_SHARDS);
    }
  }

  /** All live objects of a kind. */
  async objectsOfKind(kind: string): Promise<BackupInfo[]> {
    const sdk = this.need();
    const found = new Map<string, BackupInfo>();
    let cursor: { id: string; after: Date } | undefined;
    for (let page = 0; page < 50; page++) {
      const events = await sdk.objectEvents(cursor ?? null, 100);
      if (events.length === 0) break;
      for (const ev of events) {
        if (ev.deleted || !ev.object) {
          found.delete(ev.id);
          continue;
        }
        const obj = ev.object;
        try {
          const meta = JSON.parse(new TextDecoder().decode(obj.metadata())) as { kind?: string };
          if (meta.kind !== kind) continue;
        } catch {
          continue;
        }
        found.set(obj.id(), { id: obj.id(), createdAt: obj.createdAt(), sizeBytes: obj.size() });
      }
      const last = events[events.length - 1]!;
      cursor = { id: last.id, after: last.updatedAt };
      if (events.length < 100) break;
    }
    return [...found.values()];
  }

  private async read(id: string): Promise<Uint8Array> {
    const sdk = this.need();
    const obj = await sdk.object(id);
    return new Uint8Array(await new Response(sdk.download(obj)).arrayBuffer());
  }

  /* ------------------------------------------------------------ backups --- */

  async uploadBackup(plaintext: Uint8Array): Promise<string> {
    const sealed = await sealBackup(this.need().appKey().export(), plaintext);
    return (await this.put(KIND_BACKUP, () => new Blob([sealed]).stream(), sealed.length)).id();
  }

  async latestBackup(): Promise<BackupInfo | null> {
    const all = await this.objectsOfKind(KIND_BACKUP);
    return all.reduce<BackupInfo | null>((b, o) => (!b || o.createdAt > b.createdAt ? o : b), null);
  }

  async downloadBackup(id: string): Promise<Uint8Array> {
    return openBackup(this.need().appKey().export(), await this.read(id));
  }

  /* ------------------------------------------------------ shared files --- */

  /**
   * Uploads an already-encrypted stream (a large attachment, read as it
   * uploads) and shares it with a new sharing key. Recipients read it with
   * the seed, without a Sia account; downloads are paid by this account.
   */
  async uploadShared(
    ciphertext: ReopenableStream,
    size: number,
    onProgress?: (f: number) => void,
  ): Promise<{ seed: string; objectId: string }> {
    const obj = await this.put(KIND_FILE, ciphertext, size, onProgress);
    const sdk = this.need();
    const key = await sdk.createSharingKey('OpenSocial file', null);
    await sdk.shareObject(key, obj);
    return { seed: key.seed(), objectId: obj.id() };
  }

  /* ----------------------------------------------------------- deletion --- */

  /** Everything OpenSocial stored in this space, newest first. */
  async listMine(): Promise<SiaItem[]> {
    const backups = (await this.objectsOfKind(KIND_BACKUP)).map((o) => ({ ...o, kind: 'backup' as const }));
    const files = (await this.objectsOfKind(KIND_FILE)).map((o) => ({ ...o, kind: 'file' as const }));
    return [...backups, ...files].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Deletes one object (frees its space). Shared files can no longer be downloaded by anyone. */
  async deleteObject(id: string): Promise<void> {
    await this.need().deleteObject(id);
  }

  /** Deletes every object OpenSocial stored (backups and shared files). */
  async deleteAll(): Promise<number> {
    const sdk = this.need();
    let n = 0;
    for (const kind of [KIND_BACKUP, KIND_FILE]) {
      for (const o of await this.objectsOfKind(kind)) {
        await sdk.deleteObject(o.id);
        n++;
      }
    }
    return n;
  }
}

/** Opens a shared object with its sharing seed as a stream (no Sia account needed). */
export async function downloadSharedFromSia(seed: string, objectId: string): Promise<ReadableStream<Uint8Array>> {
  const mod = await loadModule();
  const shared = await mod.SharedSdk.connect(SIA_INDEXER_URL, seed);
  const obj = await shared.object(objectId);
  return shared.download(obj) as ReadableStream<Uint8Array>;
}

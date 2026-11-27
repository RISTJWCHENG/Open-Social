/**
 * What group chats need from the inbox shards (docs/GROUPS.md): each group
 * has a stream in one shard; members post MLS messages and commits there and
 * read them back with queries. Implemented over ICP by ShardedMailbox, and
 * in memory by tests.
 */

export type GroupRole = 'Member' | 'Admin' | 'Owner';

export interface StreamEntry {
  seq: number;
  from: string;
  device: string;
  kind: 'Message' | 'Commit';
  epoch: number;
  atMs: number;
  data: Uint8Array;
  /** A commit adding members: the blob with its Welcome. */
  welcome?: bigint;
}

export interface StreamHead {
  group: string;
  lastSeq: number;
  epoch: number;
  role: GroupRole;
}

export interface CommitPost {
  group: string;
  device: string;
  epoch: number;
  commit: Uint8Array;
  welcome?: bigint;
  add: string[];
  remove: string[];
}

/** A commit made in an older epoch: catch up and make it again. */
export class StaleEpoch extends Error {
  constructor(readonly current: number) {
    super(`StaleEpoch(${current})`);
  }
}

export interface GroupTransport {
  /** The shard where new groups of ours live (our own inbox's home). */
  homeShard(): Promise<string>;
  create(shard: string, group: string): Promise<void>;
  post(shard: string, group: string, device: string, epoch: number, data: Uint8Array): Promise<number>;
  /** Throws StaleEpoch if another commit came first. */
  postCommit(shard: string, c: CommitPost): Promise<number>;
  setRole(shard: string, group: string, account: string, role: GroupRole): Promise<void>;
  leave(shard: string, group: string, heir?: string): Promise<void>;
  blobPut(
    shard: string,
    group: string,
    blob: bigint,
    index: number,
    chunks: number,
    size: number,
    data: Uint8Array,
  ): Promise<void>;
  blobGet(shard: string, group: string, blob: bigint, index: number): Promise<Uint8Array>;
  read(shard: string, group: string, after: number): Promise<StreamEntry[]>;
  heads(shard: string, groups: string[]): Promise<StreamHead[]>;
  /** Key packages for many devices (each in its own home), in order; null where a device has none. */
  claimKeyPackages(devices: { account: string; deviceId: string }[]): Promise<(Uint8Array | null)[]>;
}

/** Largest blob chunk (fits one ingress message). */
export const BLOB_CHUNK = 1_800_000;

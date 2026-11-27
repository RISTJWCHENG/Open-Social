/**
 * Inbox delivery across inbox shards (docs/INBOX_SHARDING.md).
 *
 * Every account's inbox lives in one canister: an inbox shard, or the
 * identity canister itself ("shard 000"). This class finds each account's
 * home (asking the identity canister once, then caching it), sends to the
 * recipient's home directly, and reads and manages this device's own inbox in
 * its own home. End-to-end encryption is untouched: only ciphertext passes
 * through here, exactly as before.
 *
 * Senders whose own inbox is elsewhere attach a send ticket from the identity
 * canister; the identity canister never needs one. Entries for several homes
 * go out in parallel, so a message to a contact plus the copy for our other
 * devices costs no extra time.
 */
import type { DeliveredItem, DeviceAddress, PublishedDevice } from '../../core/delivery/offlineDelivery';
import { OpenSocialError } from '../../core/types';
import { IcpMailbox, type SendTicket } from './icpMailbox';
import type { CommitPost, GroupRole, GroupTransport } from '../../core/groups/transport';

type Identity = import('@icp-sdk/core/agent').Identity;

/** Refresh a ticket this long before it expires. */
const TICKET_MARGIN_MS = 60 * 60 * 1000;

type Item = { to: DeviceAddress; entry: Uint8Array; ephemeral?: boolean };

/** What this class needs from one canister's mailbox client (an IcpMailbox, or a fake in tests). */
export type Box = Pick<
  IcpMailbox,
  | 'register'
  | 'publishKeyPackages'
  | 'fetch'
  | 'ack'
  | 'deleteAccount'
  | 'devicesOf'
  | 'claimKeyPackage'
  | 'deposit'
  | 'depositMany'
  | 'homeOf'
  | 'sendTicket'
  | 'claimKeyPackagesHere'
  | 'groupCreate'
  | 'groupPost'
  | 'groupPostCommit'
  | 'groupSetRole'
  | 'groupLeave'
  | 'groupBlobPut'
  | 'groupBlobGet'
  | 'groupRead'
  | 'groupHeads'
>;

/** Errors after which an account's home is looked up again: it moved, or the cache was wrong. */
const isWrongHome = (e: unknown) => /\b(NotHere|Moved)\b/.test(e instanceof Error ? e.message : String(e));
const isTicketProblem = (e: unknown) =>
  /\b(TicketExpired|TicketRequired)\b|Invalid send ticket/.test(e instanceof Error ? e.message : String(e));

export class ShardedMailbox extends IcpMailbox implements GroupTransport {
  private readonly boxes = new Map<string, Box>();
  private readonly homes = new Map<string, Promise<string>>();
  private ticket: { value: SendTicket; expiresAtMs: number } | null = null;
  private ticketPending: Promise<SendTicket> | null = null;

  constructor(
    private readonly identityCanisterId: string,
    private readonly signedIn: () => Identity | null,
    hostUrl?: string,
    private readonly makeBox: (canisterId: string) => Box = (id) => new IcpMailbox(id, signedIn, hostUrl),
  ) {
    super(identityCanisterId, signedIn, hostUrl);
  }

  /** The mailbox client for one canister (a plain one for the identity canister too, never `this`). */
  private box(canisterId: string): Box {
    let b = this.boxes.get(canisterId);
    if (!b) {
      b = this.makeBox(canisterId);
      this.boxes.set(canisterId, b);
    }
    return b;
  }

  /** Our own account principal (the signed-in identity). */
  private me(): string {
    const id = this.signedIn();
    if (!id) throw new OpenSocialError('NOT_SIGNED_IN', 'Sign in first.');
    return id.getPrincipal().toText();
  }

  /** Where an account's inbox lives. Unknown accounts resolve to the identity canister, which reports them. */
  homeOfAccount(account: string): Promise<string> {
    let h = this.homes.get(account);
    if (!h) {
      h = this.box(this.identityCanisterId)
        .homeOf(account)
        .then((home) => home ?? this.identityCanisterId);
      h.catch(() => this.homes.delete(account));
      this.homes.set(account, h);
    }
    return h;
  }

  /** Remembers a home learnt elsewhere (an invite link or a contact's profile). */
  rememberHome(account: string, canisterId: string) {
    this.homes.set(account, Promise.resolve(canisterId));
  }

  private forgetHome(account: string) {
    this.homes.delete(account);
  }

  /** A valid send ticket (fetched once a day). */
  private async sendTicketCached(fresh = false): Promise<SendTicket> {
    if (!fresh && this.ticket && this.ticket.expiresAtMs - TICKET_MARGIN_MS > Date.now()) return this.ticket.value;
    this.ticketPending ??= this.box(this.identityCanisterId)
      .sendTicket()
      .then((t) => {
        this.ticket = { value: t, expiresAtMs: Number(t.expires_at_ns / 1_000_000n) };
        return t;
      })
      .finally(() => {
        this.ticketPending = null;
      });
    return this.ticketPending;
  }

  /** The ticket to attach when writing to `home`: none for the identity canister or our own home. */
  private async ticketFor(home: string, fresh = false): Promise<SendTicket | undefined> {
    if (home === this.identityCanisterId) return undefined;
    if (home === (await this.homeOfAccount(this.me()))) return undefined;
    return this.sendTicketCached(fresh);
  }

  /**
   * Runs `f` against an account's home; if the home was wrong (the account
   * moved) or the ticket was refused, looks up again / refreshes and retries once.
   */
  private async atHome<T>(account: string, f: (box: Box, ticket?: SendTicket) => Promise<T>): Promise<T> {
    const home = await this.homeOfAccount(account);
    try {
      return await f(this.box(home), await this.ticketFor(home));
    } catch (e) {
      if (isWrongHome(e)) {
        this.forgetHome(account);
        const again = await this.homeOfAccount(account);
        return f(this.box(again), await this.ticketFor(again));
      }
      if (isTicketProblem(e)) return f(this.box(home), await this.ticketFor(home, true));
      throw e;
    }
  }

  private async ownBox(): Promise<Box> {
    return this.box(await this.homeOfAccount(this.me()));
  }

  /* --------------------------------------------------- our own inbox --- */

  override async register(device: PublishedDevice): Promise<void> {
    return (await this.ownBox()).register(device);
  }

  override async publishKeyPackages(deviceId: string, lastResort: Uint8Array | null, singleUse: Uint8Array[]) {
    return (await this.ownBox()).publishKeyPackages(deviceId, lastResort, singleUse);
  }

  override async fetch(deviceId: string, after: bigint): Promise<DeliveredItem[]> {
    try {
      return await (await this.ownBox()).fetch(deviceId, after);
    } catch (e) {
      if (!isWrongHome(e)) throw e;
      // Our inbox moved. Shards number entries above any id they took in, so
      // the same `after` still finds everything there.
      this.forgetHome(this.me());
      return (await this.ownBox()).fetch(deviceId, after);
    }
  }

  override async ack(deviceId: string, upTo: bigint): Promise<void> {
    return (await this.ownBox()).ack(deviceId, upTo);
  }

  /** Deletes our inbox in its shard, then the account in the identity canister. */
  override async deleteAccount(): Promise<void> {
    const home = await this.homeOfAccount(this.me());
    if (home !== this.identityCanisterId) await this.box(home).deleteAccount();
    await this.box(this.identityCanisterId).deleteAccount();
  }

  /* -------------------------------------------------- other accounts --- */

  override async devicesOf(account: string): Promise<PublishedDevice[]> {
    const home = await this.homeOfAccount(account);
    const list = await this.box(home).devicesOf(account);
    if (list.length || home === this.identityCanisterId) return list;
    // None where we thought: the account may have moved.
    this.forgetHome(account);
    const again = await this.homeOfAccount(account);
    return again === home ? list : this.box(again).devicesOf(account);
  }

  override async claimKeyPackage(account: string, deviceId: string) {
    return this.atHome(account, (box, ticket) => box.claimKeyPackage(account, deviceId, ticket));
  }

  override async deposit(to: DeviceAddress, entry: Uint8Array): Promise<void> {
    return this.atHome(to.account, (box, ticket) => box.deposit(to, entry, ticket));
  }

  /**
   * Sends entries for several accounts: grouped by home, one call per home,
   * all in parallel. Returns the indexes (in `items`) skipped because their
   * device's inbox is full.
   */
  override async depositMany(items: Item[]): Promise<number[]> {
    const homes = await Promise.all(items.map((i) => this.homeOfAccount(i.to.account)));
    const groups = new Map<string, number[]>();
    homes.forEach((h, i) => groups.set(h, [...(groups.get(h) ?? []), i]));
    const skipped = await Promise.all(
      [...groups.values()].map(async (idx) => {
        const part = idx.map((i) => items[i]!);
        const send = async (home: string, fresh = false) =>
          this.box(home).depositMany(part, await this.ticketFor(home, fresh));
        let local: number[];
        try {
          local = await send(homes[idx[0]!]!);
        } catch (e) {
          if (isTicketProblem(e)) {
            local = await send(homes[idx[0]!]!, true);
          } else if (isWrongHome(e)) {
            // Someone in this group moved: resend each account's entries to its current home.
            part.forEach((p) => this.forgetHome(p.to.account));
            local = await this.depositMany(part);
          } else {
            throw e;
          }
        }
        return Array.from(local, (k) => idx[k]!);
      }),
    );
    return skipped.flat().sort((a, b) => a - b);
  }

  /* ------------------------------------------------- group chat streams --- */

  homeShard(): Promise<string> {
    return this.homeOfAccount(this.me());
  }

  async create(shard: string, group: string): Promise<void> {
    return this.box(shard).groupCreate(group, await this.ticketFor(shard));
  }

  post(shard: string, group: string, device: string, epoch: number, data: Uint8Array) {
    return this.box(shard).groupPost(group, device, epoch, data);
  }

  postCommit(shard: string, c: CommitPost) {
    return this.box(shard).groupPostCommit(c);
  }

  setRole(shard: string, group: string, account: string, role: GroupRole) {
    return this.box(shard).groupSetRole(group, account, role);
  }

  leave(shard: string, group: string, heir?: string) {
    return this.box(shard).groupLeave(group, heir);
  }

  blobPut(shard: string, group: string, blob: bigint, index: number, chunks: number, size: number, data: Uint8Array) {
    return this.box(shard).groupBlobPut(group, blob, index, chunks, size, data);
  }

  blobGet(shard: string, group: string, blob: bigint, index: number) {
    return this.box(shard).groupBlobGet(group, blob, index);
  }

  read(shard: string, group: string, after: number) {
    return this.box(shard).groupRead(group, after);
  }

  heads(shard: string, groups: string[]) {
    return this.box(shard).groupHeads(groups);
  }

  /** Key packages for many devices: one call per home (200 devices at most each), all in parallel. */
  async claimKeyPackages(devices: { account: string; deviceId: string }[]): Promise<(Uint8Array | null)[]> {
    const homes = await Promise.all(devices.map((d) => this.homeOfAccount(d.account)));
    const out: (Uint8Array | null)[] = devices.map(() => null);
    const byHome = new Map<string, number[]>();
    homes.forEach((h, i) => byHome.set(h, [...(byHome.get(h) ?? []), i]));
    const calls: Promise<void>[] = [];
    for (const [home, idx] of byHome) {
      for (let i = 0; i < idx.length; i += 200) {
        const part = idx.slice(i, i + 200);
        calls.push(
          (async () => {
            const got = await this.box(home).claimKeyPackagesHere(
              part.map((k) => devices[k]!),
              await this.ticketFor(home),
            );
            got.forEach((kp, j) => (out[part[j]!] = kp));
          })(),
        );
      }
    }
    await Promise.all(calls);
    return out;
  }
}

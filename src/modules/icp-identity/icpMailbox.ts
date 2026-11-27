/**
 * ICP implementation of OfflineDelivery and DeviceDirectory, backed by the
 * OpenSocial identity canister (devices + mailbox endpoints). Calls are made
 * as the signed-in account, so the canister knows who deposits and fetches.
 */
import type {
  DeliveredItem,
  DeviceAddress,
  DeviceDirectory,
  OfflineDelivery,
  PublishedDevice,
} from '../../core/delivery/offlineDelivery';
import { OpenSocialError } from '../../core/types';
import { StaleEpoch, type CommitPost, type GroupRole, type StreamEntry, type StreamHead } from '../../core/groups/transport';
import { identityIdl } from './identityIdl';

type Identity = import('@icp-sdk/core/agent').Identity;

/** A send ticket from the identity canister, as Candid hands it over. */
export type SendTicket = { principal: unknown; expires_at_ns: bigint; epoch: number; mac: Uint8Array | number[] };
type Res<T> = { Ok: T } | { Err: string };

const unwrap = <T>(r: Res<T>): T => {
  if ('Err' in r) throw new OpenSocialError('MAILBOX_REJECTED', r.Err);
  return r.Ok;
};
const bytes = (v: Uint8Array | number[]) => (v instanceof Uint8Array ? v : Uint8Array.from(v));

type GroupRes<T> = { Ok: T } | { Err: Record<string, unknown> };
/** A group call's result, or its error (StaleEpoch as its own type, so callers can catch up and retry). */
const groupOk = <T>(r: GroupRes<T>): T => {
  if ('Ok' in r) return r.Ok;
  const [kind, detail] = Object.entries(r.Err)[0]!;
  if (kind === 'StaleEpoch') throw new StaleEpoch(Number(detail as bigint));
  throw new OpenSocialError(
    kind === 'NotMember' ? 'GROUP_NOT_MEMBER' : 'GROUP_REJECTED',
    typeof detail === 'string' ? detail : kind === 'NotMember' ? 'You are not in this group.' : kind,
  );
};

export class IcpMailbox implements OfflineDelivery, DeviceDirectory {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actorPromise: Promise<any> | null = null;

  constructor(
    private readonly canisterId: string,
    private readonly identity: () => Identity | null,
    private readonly host?: string,
  ) {}

  private async actor() {
    if (!this.actorPromise) {
      const id = this.identity();
      if (!id) throw new OpenSocialError('NOT_SIGNED_IN', 'Sign in first.');
      this.actorPromise = (async () => {
        const { Actor, HttpAgent } = await import('@icp-sdk/core/agent');
        const agent = await HttpAgent.create({ identity: id, ...(this.host ? { host: this.host } : {}) });
        return Actor.createActor(identityIdl, { agent, canisterId: this.canisterId });
      })();
    }
    return this.actorPromise;
  }

  async register(device: PublishedDevice): Promise<void> {
    const a = await this.actor();
    unwrap(
      await a.register_device({
        device_id: device.deviceId,
        encryption_key: device.encryptionKey,
        signing_key: device.signingKey,
        label: device.label,
      }),
    );
  }

  async devicesOf(account: string): Promise<PublishedDevice[]> {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    const list = (await a.get_devices(Principal.fromText(account))) as {
      device_id: string;
      encryption_key: Uint8Array | number[];
      signing_key: Uint8Array | number[];
      label: string;
    }[];
    return list.map((d) => ({
      deviceId: d.device_id,
      encryptionKey: bytes(d.encryption_key),
      signingKey: bytes(d.signing_key),
      label: d.label,
    }));
  }

  async publishKeyPackages(deviceId: string, lastResort: Uint8Array | null, singleUse: Uint8Array[]): Promise<number> {
    const a = await this.actor();
    return unwrap(await a.publish_key_packages(deviceId, lastResort ? [lastResort] : [], singleUse)) as number;
  }

  async claimKeyPackage(account: string, deviceId: string, ticket?: SendTicket) {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    const r = unwrap(await a.claim_key_package(Principal.fromText(account), deviceId, ticket ? [ticket] : [])) as
      [] | [{ last_resort: Uint8Array | number[]; single_use: [] | [Uint8Array | number[]] }];
    const v = r[0];
    if (!v) return null;
    return { lastResort: bytes(v.last_resort), singleUse: v.single_use[0] ? bytes(v.single_use[0]) : null };
  }

  async deposit(to: DeviceAddress, entry: Uint8Array, ticket?: SendTicket): Promise<void> {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    unwrap(await a.deposit(Principal.fromText(to.account), to.deviceId, entry, ticket ? [ticket] : []));
  }

  async depositMany(
    items: { to: DeviceAddress; entry: Uint8Array; ephemeral?: boolean }[],
    ticket?: SendTicket,
  ): Promise<number[]> {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    const r = unwrap(
      await a.deposit_batch(
        items.map((i) => ({
          to: Principal.fromText(i.to.account),
          device_id: i.to.deviceId,
          entry: i.entry,
          ephemeral: i.ephemeral === true,
        })),
        ticket ? [ticket] : [],
      ),
    );
    // Candid hands `vec nat32` over as a Uint32Array: make it a plain array.
    return Array.from((r as { skipped: ArrayLike<number> }).skipped, Number);
  }

  async fetch(deviceId: string, after: bigint): Promise<DeliveredItem[]> {
    const a = await this.actor();
    const items = unwrap(await a.fetch_mail(deviceId, after)) as {
      id: bigint;
      from: { toText(): string };
      received_at_ns: bigint;
      entry: Uint8Array | number[];
    }[];
    return items.map((m) => ({
      id: m.id,
      from: m.from.toText(),
      receivedAtMs: Number(m.received_at_ns / 1_000_000n),
      entry: bytes(m.entry),
    }));
  }

  async ack(deviceId: string, upTo: bigint): Promise<void> {
    const a = await this.actor();
    unwrap(await a.ack_mail(deviceId, upTo));
  }

  /** Where an account's inbox lives (a shard's canister id), or null for unknown accounts. */
  async homeOf(account: string): Promise<string | null> {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    const r = (await a.home_of(Principal.fromText(account))) as [] | [{ toText(): string }];
    return r[0] ? r[0].toText() : null;
  }

  /** A send ticket for depositing into inbox shards (valid for a day). */
  async sendTicket(): Promise<SendTicket> {
    const a = await this.actor();
    return unwrap(await a.send_ticket()) as SendTicket;
  }

  /** Deletes the caller's account in the identity canister. */
  async deleteAccount(): Promise<void> {
    const a = await this.actor();
    unwrap(await a.delete_account());
  }

  /* ------------------------------------------------- group chat streams --- */
  // This canister as a group's shard (see core/groups/transport.ts).

  async claimKeyPackagesHere(devices: { account: string; deviceId: string }[], ticket?: SendTicket) {
    const { Principal } = await import('@icp-sdk/core/principal');
    const a = await this.actor();
    const r = unwrap(
      await a.claim_key_packages(
        devices.map((d) => [Principal.fromText(d.account), d.deviceId]),
        ticket ? [ticket] : [],
      ),
    ) as ([] | [{ last_resort: Uint8Array | number[]; single_use: [] | [Uint8Array | number[]] }])[];
    return r.map((o) => (o[0] ? bytes(o[0].single_use[0] ?? o[0].last_resort) : null));
  }

  async groupCreate(group: string, ticket?: SendTicket): Promise<void> {
    groupOk(await (await this.actor()).group_create(group, ticket ? [ticket] : []));
  }

  async groupPost(group: string, device: string, epoch: number, data: Uint8Array): Promise<number> {
    return Number(groupOk(await (await this.actor()).group_post(group, device, BigInt(epoch), data)));
  }

  async groupPostCommit(c: CommitPost): Promise<number> {
    const { Principal } = await import('@icp-sdk/core/principal');
    const r = await (
      await this.actor()
    ).group_post_commit({
      group: c.group,
      device: c.device,
      epoch: BigInt(c.epoch),
      commit: c.commit,
      welcome: c.welcome === undefined ? [] : [c.welcome],
      add: c.add.map((p) => Principal.fromText(p)),
      remove: c.remove.map((p) => Principal.fromText(p)),
    });
    return Number(groupOk(r));
  }

  async groupSetRole(group: string, account: string, role: GroupRole): Promise<void> {
    const { Principal } = await import('@icp-sdk/core/principal');
    groupOk(await (await this.actor()).group_set_role(group, Principal.fromText(account), { [role]: null }));
  }

  async groupLeave(group: string, heir?: string): Promise<void> {
    const { Principal } = await import('@icp-sdk/core/principal');
    groupOk(await (await this.actor()).group_leave(group, heir ? [Principal.fromText(heir)] : []));
  }

  async groupBlobPut(group: string, blob: bigint, index: number, chunks: number, size: number, data: Uint8Array) {
    groupOk(await (await this.actor()).group_blob_put(group, blob, index, chunks, BigInt(size), data));
  }

  async groupBlobGet(group: string, blob: bigint, index: number): Promise<Uint8Array> {
    return bytes(groupOk(await (await this.actor()).group_blob_get(group, blob, index)) as Uint8Array | number[]);
  }

  async groupRead(group: string, after: number): Promise<StreamEntry[]> {
    const list = groupOk(await (await this.actor()).group_read(group, BigInt(after))) as {
      seq: bigint;
      from: { toText(): string };
      device: string;
      kind: { Message?: null; Commit?: null };
      epoch: bigint;
      at_ns: bigint;
      data: Uint8Array | number[];
      welcome: [] | [bigint];
    }[];
    return list.map((e) => ({
      seq: Number(e.seq),
      from: e.from.toText(),
      device: e.device,
      kind: 'Commit' in e.kind ? 'Commit' : 'Message',
      epoch: Number(e.epoch),
      atMs: Number(e.at_ns / 1_000_000n),
      data: bytes(e.data),
      ...(e.welcome[0] !== undefined ? { welcome: e.welcome[0] } : {}),
    }));
  }

  async groupHeads(groups: string[]): Promise<StreamHead[]> {
    const list = (await (await this.actor()).group_heads(groups)) as {
      group: string;
      last_seq: bigint;
      epoch: bigint;
      role: Record<string, null>;
    }[];
    return list.map((h) => ({
      group: h.group,
      lastSeq: Number(h.last_seq),
      epoch: Number(h.epoch),
      role: Object.keys(h.role)[0] as GroupRole,
    }));
  }
}

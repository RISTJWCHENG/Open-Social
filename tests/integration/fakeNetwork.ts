import { RealMessaging } from '../../src/core/delivery/realMessaging';
import { MemoryStore } from '../../src/core/delivery/localStore';
import { FakeGroupShard } from './fakeGroupShard';
import type {
  DeliveredItem,
  DeviceAddress,
  DeviceDirectory,
  OfflineDelivery,
  PublishedDevice,
} from '../../src/core/delivery/offlineDelivery';

/** In-memory stand-in for the mailbox canister, with per-caller views. */
export class FakeNetwork {
  devices = new Map<string, PublishedDevice[]>();
  prekeys = new Map<string, { bundle: Uint8Array; oneTime: Uint8Array[] }>();
  /** Fake profiles canister: account -> sealed profile. */
  sealed = new Map<string, Uint8Array>();
  keys = new Map<string, string>();
  batches = 0;
  /** Entries per window, as the canister's per-minute limit (Infinity: none). */
  rateLimit = Infinity;
  private window = { at: 0, n: 0 };
  /** Batch calls to fail from now on (more than 2 outlasts the automatic retries). */
  failBatches = 0;
  /** Batch calls that succeed before the failures start. */
  failAfter = 0;
  /** Entries a device mailbox holds (the canister allows 2,000). */
  boxLimit = 2000;
  /** Entries stored so far (all mailboxes). */
  deposits = 0;
  boxes = new Map<string, DeliveredItem[]>();
  /** Group chat streams (one shard). */
  groupShard = new FakeGroupShard(async (account, deviceId) => {
    const e = this.prekeys.get(`${account}:${deviceId}`);
    if (!e) return null;
    return e.oneTime.shift() ?? e.bundle;
  });
  nextId = 1n;
  as(account: string): DeviceDirectory & OfflineDelivery {
    return {
      register: async (d) => {
        const list = this.devices.get(account) ?? [];
        if (!list.some((x) => x.deviceId === d.deviceId)) list.push(d);
        this.devices.set(account, list);
      },
      devicesOf: async (a) => this.devices.get(a) ?? [],
      publishKeyPackages: async (deviceId, lastResort, singleUse) => {
        const k = `${account}:${deviceId}`;
        const e = this.prekeys.get(k);
        if (!e && !lastResort) throw new Error('Publish a last-resort key package first');
        const next = lastResort ? { bundle: lastResort, oneTime: [] as Uint8Array[] } : e!;
        next.oneTime.push(...singleUse);
        this.prekeys.set(k, next);
        return next.oneTime.length;
      },
      claimKeyPackage: async (a, deviceId) => {
        const e = this.prekeys.get(`${a}:${deviceId}`);
        if (!e) return null;
        return { lastResort: e.bundle, singleUse: e.oneTime.shift() ?? null };
      },
      deposit: async (to: DeviceAddress, entry) => {
        if (!(this.devices.get(to.account) ?? []).some((d) => d.deviceId === to.deviceId)) {
          throw new Error('Unknown recipient device');
        }
        // Same limit as the canister (MAX_ENTRY_BYTES).
        if (entry.length < 1 || entry.length > 64 * 1024) throw new Error('Message must be 1 to 65536 bytes');
        const k = `${to.account}:${to.deviceId}`;
        const q = this.boxes.get(k) ?? [];
        this.deposits++;
        q.push({ id: this.nextId++, from: account, receivedAtMs: Date.now(), entry });
        this.boxes.set(k, q);
      },
      depositMany: async (items) => {
        // Same limits as the canister's deposit_batch.
        if (items.length > 50) throw new Error('Send 1 to 50 entries at a time');
        if (items.reduce((n, i) => n + i.entry.length, 0) > 512 * 1024) throw new Error('Batch is too large');
        if (items.some((i) => i.entry.length > 64 * 1024)) throw new Error('Message must be 1 to 65536 bytes');
        // A "minute" here is 20 ms (the client waits msToNextMinute between tries).
        if (Date.now() - this.window.at > 20) this.window = { at: Date.now(), n: 0 };
        if (this.window.n + items.length > this.rateLimit) throw new Error('Sending too fast. Wait a moment.');
        this.window.n += items.length;
        if (this.failBatches > 0 && this.failAfter-- <= 0) {
          this.failBatches--;
          throw new Error('network down');
        }
        this.batches++;
        // Same rule as the canister: a device whose mailbox can't take its entries is skipped.
        const full = new Set<string>();
        const extra = new Map<string, number>();
        for (const i of items) {
          const k = `${i.to.account}:${i.to.deviceId}`;
          const n = (extra.get(k) ?? 0) + 1;
          extra.set(k, n);
          if ((this.boxes.get(k)?.length ?? 0) + n > this.boxLimit) full.add(k);
        }
        const skipped: number[] = [];
        for (const [idx, i] of items.entries()) {
          if (full.has(`${i.to.account}:${i.to.deviceId}`)) skipped.push(idx);
          else await this.as(account).deposit(i.to, i.entry);
        }
        return skipped;
      },
      fetch: async (deviceId, after) => (this.boxes.get(`${account}:${deviceId}`) ?? []).filter((m) => m.id > after),
      ack: async (deviceId, upTo) => {
        const k = `${account}:${deviceId}`;
        this.boxes.set(
          k,
          (this.boxes.get(k) ?? []).filter((m) => m.id > upTo),
        );
      },
    };
  }
}

export async function user(net: FakeNetwork, name: string, store = new MemoryStore()) {
  const api = net.as(name);
  const m = new RealMessaging(
    name,
    api,
    api,
    store,
    'Test',
    undefined,
    async (a) => net.sealed.get(a) ?? null,
    net.groupShard.as(name),
  );
  await m.init();
  return { m, store };
}

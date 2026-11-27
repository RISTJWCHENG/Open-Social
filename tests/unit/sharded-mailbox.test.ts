import { describe, expect, it } from 'vitest';
import { ShardedMailbox, type Box } from '../../src/modules/icp-identity/shardedMailbox';
import type { SendTicket } from '../../src/modules/icp-identity/icpMailbox';

const IDENTITY = 'identity-canister';
const ME = 'me-principal';
const ticket: SendTicket = {
  principal: ME,
  expires_at_ns: BigInt(Date.now() + 86_400_000) * 1_000_000n,
  epoch: 1,
  mac: [],
};

type Call = { canister: string; method: string; args: unknown[] };

/** Fake canisters: `homes` says where each account lives; each canister records its calls. */
function world(homes: Record<string, string>, behave: Partial<Record<string, (args: unknown[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const make = (canister: string): Box => {
    const rec =
      (method: string, result: (args: unknown[]) => unknown = () => undefined) =>
      async (...args: unknown[]) => {
        calls.push({ canister, method, args });
        const custom = behave[`${canister}.${method}`];
        return (custom ?? result)(args) as never;
      };
    return {
      register: rec('register'),
      publishKeyPackages: rec('publishKeyPackages', () => 5),
      fetch: rec('fetch', () => []),
      ack: rec('ack'),
      deleteAccount: rec('deleteAccount'),
      devicesOf: rec('devicesOf', () => []),
      claimKeyPackage: rec('claimKeyPackage', () => null),
      deposit: rec('deposit'),
      depositMany: rec('depositMany', () => []),
      homeOf: rec('homeOf', (a) => homes[a[0] as string] ?? null),
      sendTicket: rec('sendTicket', () => ticket),
    } as unknown as Box;
  };
  const identity = { getPrincipal: () => ({ toText: () => ME }) } as never;
  const box = new ShardedMailbox(IDENTITY, () => identity, undefined, make);
  return { box, calls, homes };
}

const item = (account: string, n: number) => ({ to: { account, deviceId: 'd' }, entry: new Uint8Array([n]) });

describe('ShardedMailbox', () => {
  it('keeps everything in the identity canister while accounts live there (as today)', async () => {
    const { box, calls } = world({ [ME]: IDENTITY, bob: IDENTITY });
    await box.depositMany([item('bob', 1), item(ME, 2)]);
    await box.fetch('d', 0n);
    expect(calls.filter((c) => c.method !== 'homeOf').map((c) => `${c.canister}.${c.method}`)).toEqual([
      'identity-canister.depositMany',
      'identity-canister.fetch',
    ]);
    expect(calls.find((c) => c.method === 'depositMany')!.args[1]).toBeUndefined();
    expect(calls.some((c) => c.method === 'sendTicket')).toBe(false);
  });

  it('sends to each home in parallel, with a ticket only where we do not live', async () => {
    const { box, calls } = world({ [ME]: 'shard-1', bob: 'shard-2', carol: 'shard-1', dan: IDENTITY });
    await box.depositMany([item('bob', 1), item(ME, 2), item('carol', 3), item('dan', 4)]);
    const sends = calls.filter((c) => c.method === 'depositMany');
    expect(sends.map((c) => c.canister).sort()).toEqual([IDENTITY, 'shard-1', 'shard-2']);
    const by = (c: string) => sends.find((s) => s.canister === c)!;
    expect((by('shard-1').args[0] as unknown[]).length).toBe(2);
    expect(by('shard-1').args[1]).toBeUndefined();
    expect(by(IDENTITY).args[1]).toBeUndefined();
    expect(by('shard-2').args[1]).toEqual(ticket);
    expect(calls.filter((c) => c.method === 'sendTicket')).toHaveLength(1);
  });

  it('maps skipped entries back to their place in the original list', async () => {
    const { box } = world({ [ME]: 'shard-1', bob: 'shard-2' }, { 'shard-2.depositMany': () => [1] });
    expect(await box.depositMany([item(ME, 0), item('bob', 1), item(ME, 2), item('bob', 3)])).toEqual([3]);
  });

  it('returns plain arrays even when a canister answers with a Uint32Array (as Candid does)', async () => {
    const { box } = world(
      { [ME]: 'shard-1', bob: 'shard-2' },
      { 'shard-1.depositMany': () => new Uint32Array([]), 'shard-2.depositMany': () => new Uint32Array([0]) },
    );
    const skipped = await box.depositMany([item(ME, 0), item('bob', 1)]);
    expect(skipped).toEqual([1]);
    expect(Array.isArray(skipped) && typeof skipped[0] === 'number').toBe(true);
  });

  it('looks a home up again when a contact moved', async () => {
    const homes: Record<string, string> = { [ME]: 'shard-1', bob: 'shard-2' };
    let moved = false;
    const { box, calls } = world(homes, {
      'shard-2.deposit': () => {
        if (moved) throw new Error('NotHere: bob has no inbox in this shard');
      },
    });
    await box.deposit({ account: 'bob', deviceId: 'd' }, new Uint8Array([1]));
    moved = true;
    homes.bob = 'shard-3';
    await box.deposit({ account: 'bob', deviceId: 'd' }, new Uint8Array([2]));
    expect(calls.filter((c) => c.method === 'deposit').map((c) => c.canister)).toEqual([
      'shard-2',
      'shard-2',
      'shard-3',
    ]);
  });

  it('gets a fresh ticket when a shard refuses the old one', async () => {
    let refuse = true;
    const { box, calls } = world(
      { [ME]: IDENTITY, bob: 'shard-2' },
      {
        'shard-2.claimKeyPackage': () => {
          if (refuse) {
            refuse = false;
            throw new Error('TicketExpired: get a new send ticket');
          }
          return null;
        },
      },
    );
    await box.claimKeyPackage('bob', 'd');
    expect(calls.filter((c) => c.method === 'sendTicket')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'claimKeyPackage')).toHaveLength(2);
  });

  it('uses our own home for our devices, reads after a move without losing the cursor, and deletes everywhere', async () => {
    const homes: Record<string, string> = { [ME]: 'shard-1' };
    let moved = false;
    const { box, calls } = world(homes, {
      'shard-1.fetch': () => {
        if (moved) throw new Error('Moved: inbox is moving');
        return [];
      },
    });
    await box.register({ deviceId: 'd', encryptionKey: new Uint8Array(), signingKey: new Uint8Array(), label: 'x' });
    await box.fetch('d', 41n);
    moved = true;
    homes[ME] = 'shard-9';
    await box.fetch('d', 41n);
    const fetches = calls.filter((c) => c.method === 'fetch');
    expect(fetches.map((c) => [c.canister, c.args[1]])).toEqual([
      ['shard-1', 41n],
      ['shard-1', 41n],
      ['shard-9', 41n],
    ]);
    await box.deleteAccount();
    expect(calls.filter((c) => c.method === 'deleteAccount').map((c) => c.canister)).toEqual(['shard-9', IDENTITY]);
    expect(calls.find((c) => c.method === 'register')!.canister).toBe('shard-1');
  });
});

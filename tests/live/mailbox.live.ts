/**
 * Live end-to-end test on ICP mainnet: two fresh accounts (software passkeys)
 * exchange end-to-end encrypted messages through the mailbox in the
 * identity canister, with the recipient offline at send time.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setMlsWasm } from '../../src/core/mls/mls';

beforeAll(() => setMlsWasm(readFileSync('src/vendor/open-social-mls/open_social_mls_bg.wasm')));
import { Actor, HttpAgent, type Identity } from '@icp-sdk/core/agent';
import { identityIdl } from '../../src/modules/icp-identity/identityIdl';
import { profilesIdl, PROFILES_CANISTER_ID } from '../../src/modules/profiles/profilesIdl';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity as KeyId } from '@icp-sdk/core/identity';
import { IcpMailbox } from '../../src/modules/icp-identity/icpMailbox';
import { RealMessaging } from '../../src/core/delivery/realMessaging';
import { MemoryStore } from '../../src/core/delivery/localStore';
import { SoftPasskey } from '../../scripts/identity/softPasskey.mjs';

const CANISTER = process.env.IDENTITY_CANISTER_ID ?? 'bbyqw-cyaaa-aaaao-qqlna-cai';
const ORIGIN = 'https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io';
const HOST = 'https://icp-api.io';

/** Accounts created by this run, deleted again when it ends. */
const created: Identity[] = [];

/** Creates an account with a new software passkey and returns its delegated identity. */
async function newAccount(): Promise<{ identity: Identity; principal: string }> {
  const { prepared, identity } = await new SoftPasskey({ canisterId: CANISTER, origin: ORIGIN, host: HOST }).register();
  created.push(identity);
  return { identity, principal: prepared.account_principal.toText() };
}

afterAll(async () => {
  for (const identity of created) {
    // Tests that delete their account already did; the rest are removed here.
    await new IcpMailbox(CANISTER, () => identity, HOST).deleteAccount().catch(() => undefined);
  }
});

async function client(acct: { identity: Identity; principal: string }) {
  const mailbox = new IcpMailbox(CANISTER, () => acct.identity, HOST);
  const m = new RealMessaging(acct.principal, mailbox, mailbox, new MemoryStore(), 'Live test');
  await m.init();
  return { m, mailbox };
}

describe('ICP mailbox, live', () => {
  it('two accounts exchange E2E-encrypted messages; recipient offline at send time', async () => {
    const aliceAcct = await newAccount();
    const bobAcct = await newAccount();
    const alice = await client(aliceAcct);
    const bob = await client(bobAcct);

    // Published device keys are visible to others.
    const bobDevices = await alice.mailbox.devicesOf(bobAcct.principal);
    expect(bobDevices.map((d) => d.deviceId)).toEqual([bob.m.deviceId]);

    await alice.m.addContact(bobAcct.principal, 'Bob');
    await alice.m.send(bobAcct.principal, 'Hello Bob, this waited in the mailbox.');
    await alice.m.send(bobAcct.principal, 'Second one.');
    expect(alice.m.messages(bobAcct.principal).every((x) => x.status === 'sent')).toBe(true);

    // A third account cannot read Bob's mailbox.
    const eveAcct = await newAccount();
    const eve = new IcpMailbox(CANISTER, () => eveAcct.identity, HOST);
    expect(await eve.fetch(bob.m.deviceId, 0n)).toEqual([]);

    // Bob comes online.
    expect(await bob.m.poll()).toBe(2);
    expect(bob.m.messages(aliceAcct.principal).map((x) => x.body)).toEqual([
      'Hello Bob, this waited in the mailbox.',
      'Second one.',
    ]);
    // Acknowledged entries are gone from the canister.
    expect(await bob.mailbox.fetch(bob.m.deviceId, 0n)).toEqual([]);

    await bob.m.send(aliceAcct.principal, 'Got them, thanks!');
    expect(await alice.m.poll()).toBe(1);
    expect(alice.m.messages(bobAcct.principal).at(-1)).toMatchObject({
      direction: 'in',
      body: 'Got them, thanks!',
      verified: true,
    });
  });

  it('refuses deposits from callers who are not signed in to OpenSocial', async () => {
    const bobAcct = await newAccount();
    const bob = await client(bobAcct);
    const anon = await HttpAgent.create({ host: HOST });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = Actor.createActor(identityIdl, { agent: anon, canisterId: CANISTER });
    const { Principal } = await import('@icp-sdk/core/principal');
    const r = await a.deposit(Principal.fromText(bobAcct.principal), bob.m.deviceId, new Uint8Array([1, 2, 3]));
    expect(r).toEqual({ Err: 'Sign in to send messages' });
  });
});

describe('Direct-link offers in the mailbox, live', () => {
  it('keeps at most 2 offers per sender and never counts them against the mailbox', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const bobBox = await client(bob);
    const aliceBox = new IcpMailbox(CANISTER, () => alice.identity, HOST);
    for (let i = 0; i < 5; i++) {
      await aliceBox.depositMany([
        { to: { account: bob.principal, deviceId: bobBox.m.deviceId }, entry: new Uint8Array([i + 1]), ephemeral: true },
      ]);
    }
    await aliceBox.depositMany([{ to: { account: bob.principal, deviceId: bobBox.m.deviceId }, entry: new Uint8Array([99]) }]);
    const items = await bobBox.mailbox.fetch(bobBox.m.deviceId, 0n);
    expect(items.map((i) => i.entry[0])).toEqual([4, 5, 99]);
  });
});

describe('Profiles canister, live', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles = async (identity?: Identity): Promise<any> =>
    Actor.createActor(profilesIdl, {
      agent: await HttpAgent.create({ host: HOST, ...(identity ? { identity } : {}) }),
      canisterId: PROFILES_CANISTER_ID,
    });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const eventually = async (f: () => Promise<any>, ok: (v: any) => boolean): Promise<any> => {
    let v = await f();
    for (let i = 0; i < 10 && !ok(v); i++) {
      await new Promise((r) => setTimeout(r, 1500));
      v = await f();
    }
    return v;
  };

  it('stores public and friends-only layers, searches, and deletes everything on request', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    const acct = await newAccount();
    await client(acct); // registers a device: makes it an OpenSocial account
    const me = await profiles(acct.identity);
    const anon = await profiles();
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3]);

    expect(
      await me.set_public_profile({ username: `p_${tag}`, display_name: `Profile ${tag}`, bio: 'Hi', links: [], avatar: { Set: webp } }),
    ).toEqual({ Ok: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view: any = ((await eventually(() => anon.get_public_profile(Principal.fromText(acct.principal)), (r: unknown[]) => r.length === 1)) as any[])[0];
    expect(view).toMatchObject({ username: `p_${tag}`, display_name: `Profile ${tag}` });
    expect(view.avatar[0].mime).toBe('image/webp');
    expect(Array.from((await anon.get_public_avatar(Principal.fromText(acct.principal)))[0])).toEqual(Array.from(webp));
    const hits = await eventually(() => anon.search_profiles(tag.slice(0, 4)), (r: { Ok?: unknown[] }) => (r.Ok?.length ?? 0) > 0);
    expect(hits.Ok.map((h: { username: string }) => h.username)).toContain(`p_${tag}`);

    // Friends-only layer: an opaque blob.
    const sealed = new Uint8Array(2000).fill(7);
    expect(await me.set_sealed_profile([sealed])).toEqual({ Ok: null });
    expect(await anon.get_sealed_profile(Principal.fromText(acct.principal))).toEqual([]); // anonymous: nothing
    const s = await eventually(() => me.get_sealed_profile(Principal.fromText(acct.principal)), (r: unknown[]) => r.length === 1);
    expect(s[0].meta.size).toBe(2000);

    // Back to friends only: the public layer is gone at once.
    expect(await me.clear_public_profile()).toEqual({ Ok: null });
    expect(await eventually(() => anon.get_public_profile(Principal.fromText(acct.principal)), (r: unknown[]) => r.length === 0)).toEqual([]);

    // Delete everything.
    expect(await me.delete_my_data()).toEqual({ Ok: null });
    const mine = await eventually(() => me.my_data(), (r: { record: unknown[] }) => r.record.length === 0);
    expect(mine).toEqual({ record: [], stored_bytes: 0n });
  });

  it('refuses writes from callers that are not OpenSocial accounts', async () => {
    const stranger = await profiles(KeyId.generate());
    const r = await stranger.set_sealed_profile([new Uint8Array([1, 2, 3])]);
    expect(r).toEqual({ Err: 'Not an OpenSocial account' });
    expect(await (await profiles()).delete_my_data()).toEqual({ Err: 'Sign in first' });
  });
});

describe('Account deletion, live', () => {
  it('delete_account removes devices and key packages; the account can no longer send', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const a = await client(alice);
    const b = await client(bob);
    expect((await a.mailbox.devicesOf(bob.principal)).length).toBe(1);
    await b.mailbox.deleteAccount();
    // Queries can lag the update by a moment.
    let devices = await a.mailbox.devicesOf(bob.principal);
    for (let i = 0; i < 10 && devices.length > 0; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      devices = await a.mailbox.devicesOf(bob.principal);
    }
    expect(devices).toEqual([]);
    expect(await a.mailbox.claimKeyPackage(bob.principal, b.m.deviceId).catch((e: Error) => e.message)).toMatch(/Unknown account|null/);
    await expect(b.mailbox.deposit({ account: alice.principal, deviceId: a.m.deviceId }, new Uint8Array([1]))).rejects.toThrow();
  });
});

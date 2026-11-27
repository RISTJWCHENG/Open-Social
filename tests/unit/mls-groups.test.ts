import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadMls, setMlsWasm, type MlsDevice } from '../../src/core/mls/mls';

let mls: Awaited<ReturnType<typeof loadMls>>;
beforeAll(async () => {
  setMlsWasm(readFileSync('src/vendor/open-social-mls/open_social_mls_bg.wasm'));
  mls = await loadMls();
});

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const device = (id: string) => mls.MlsDevice.create(id);
const kp = (d: MlsDevice) => d.keyPackages(1, false)[0] as Uint8Array;

type Result = { commit: Uint8Array; welcome?: Uint8Array };
type Processed = {
  kind: string;
  sender: string;
  data?: Uint8Array;
  added?: string[];
  removed?: string[];
  selfRemoved?: boolean;
};

describe('MLS group chats', () => {
  it('one ciphertext per message reaches every member; removed members are out', () => {
    const [a, b, c] = ['alice/1', 'bob/1', 'carol/1'].map(device);
    const gid = '00112233aabbccdd';
    a!.groupCreate(gid);
    const add = a!.groupAdd(gid, [kp(b!), kp(c!)]) as Result;
    a!.groupMerge(gid);
    expect(b!.groupJoin(add.welcome!)).toBe(gid);
    expect(c!.groupJoin(add.welcome!)).toBe(gid);
    expect([...(b!.groupMembers(gid) as string[])].sort()).toEqual(['alice/1', 'bob/1', 'carol/1']);
    expect(b!.groupEpoch(gid)).toBe(1n);

    const msg = a!.groupEncrypt(gid, enc('hello group'));
    for (const d of [b!, c!]) {
      const r = d.groupProcess(gid, msg) as Processed;
      expect(r).toMatchObject({ kind: 'app', sender: 'alice/1' });
      expect(dec(r.data!)).toBe('hello group');
    }

    // Bob sends just before Alice's commit removing Carol: still readable after it.
    const late = b!.groupEncrypt(gid, enc('sent in epoch 1'));
    const rm = a!.groupRemove(gid, ['carol/1']) as Result;
    a!.groupMerge(gid);
    const atBob = b!.groupProcess(gid, rm.commit) as Processed;
    expect(atBob).toMatchObject({ kind: 'commit', removed: ['carol/1'], selfRemoved: false });
    expect((c!.groupProcess(gid, rm.commit) as Processed).selfRemoved).toBe(true);
    expect(dec((a!.groupProcess(gid, late) as Processed).data!)).toBe('sent in epoch 1');

    const after = a!.groupEncrypt(gid, enc('without carol'));
    expect(dec((b!.groupProcess(gid, after) as Processed).data!)).toBe('without carol');
    expect(() => c!.groupProcess(gid, after)).toThrow();
  });

  it('a refused commit is discarded and made again after catching up', () => {
    const [a, b, c, d] = ['alice/1', 'bob/1', 'carol/1', 'dave/1'].map(device);
    const gid = 'ffeeddccbbaa0099';
    a!.groupCreate(gid);
    const add = a!.groupAdd(gid, [kp(b!)]) as Result;
    a!.groupMerge(gid);
    b!.groupJoin(add.welcome!);
    // Both commit in epoch 1; the shard takes Alice's first.
    const fromA = a!.groupAdd(gid, [kp(c!)]) as Result;
    const fromB = b!.groupAdd(gid, [kp(d!)]) as Result;
    expect(fromB.commit.length).toBeGreaterThan(0);
    a!.groupMerge(gid);
    b!.groupDiscard(gid);
    expect(b!.groupHasPending(gid)).toBe(false);
    b!.groupProcess(gid, fromA.commit);
    const again = b!.groupAdd(gid, [kp(d!)]) as Result;
    b!.groupMerge(gid);
    a!.groupProcess(gid, again.commit);
    c!.groupJoin(fromA.welcome!);
    c!.groupProcess(gid, again.commit);
    d!.groupJoin(again.welcome!);
    const m = d!.groupEncrypt(gid, enc('hi from dave'));
    for (const x of [a!, b!, c!]) expect(dec((x.groupProcess(gid, m) as Processed).data!)).toBe('hi from dave');
    expect(a!.groupEpoch(gid)).toBe(3n);
  });

  it('scales: 1,000 devices, one add commit, one message decrypted by a member', { timeout: 300_000 }, () => {
    const a = device('owner/1');
    const gid = '1234567812345678';
    a.groupCreate(gid);
    const others = Array.from({ length: 999 }, (_, i) => device(`m${i}/1`));
    let t = performance.now();
    const kps = others.map(kp);
    const kpMs = performance.now() - t;
    t = performance.now();
    const add = a.groupAdd(gid, kps) as Result;
    a.groupMerge(gid);
    const addMs = performance.now() - t;
    t = performance.now();
    const last = others.at(-1)!;
    last.groupJoin(add.welcome!);
    const joinMs = performance.now() - t;
    t = performance.now();
    const m = a.groupEncrypt(gid, enc('x'.repeat(200)));
    const encMs = performance.now() - t;
    t = performance.now();
    expect(dec((last.groupProcess(gid, m) as Processed).data!)).toBe('x'.repeat(200));
    const decMs = performance.now() - t;
    t = performance.now();
    const rm = a.groupRemove(gid, ['m0/1']) as Result;
    a.groupMerge(gid);
    last.groupProcess(gid, rm.commit);
    const removeMs = performance.now() - t;
    const stateKb = Math.round(last.exportState().length / 1024);
    console.log(
      `1000 devices: welcome ${Math.round(add.welcome!.length / 1024)} KB, commit ${add.commit.length} B, message ${m.length} B, ` +
        `remove commit ${rm.commit.length} B, member state ${stateKb} KB; ms: key packages ${kpMs.toFixed(0)}, add ${addMs.toFixed(0)}, ` +
        `join ${joinMs.toFixed(0)}, encrypt ${encMs.toFixed(1)}, decrypt ${decMs.toFixed(1)}, remove+process ${removeMs.toFixed(0)}`,
    );
    expect(m.length).toBeLessThan(600);
  });
});

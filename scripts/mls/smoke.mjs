// Smoke test of the OpenMLS WebAssembly build used by OpenSocial:
// key packages, Welcome, application messages both ways, self-update commits,
// export/restore, tamper, replay and wrong-identity rejection, and timing.
// Run: node scripts/mls/smoke.mjs   (MLS_PKG=<dir> to test another build)
import { readFileSync } from 'node:fs';
const PKG = process.env.MLS_PKG ?? new URL('../../src/vendor/open-social-mls', import.meta.url).pathname;
const { default: init, MlsDevice, mlsVersion } = await import(`${PKG}/open_social_mls.js`);
await init({ module_or_path: readFileSync(`${PKG}/open_social_mls_bg.wasm`) });
console.log(mlsVersion());
const enc = new TextEncoder(), dec = new TextDecoder();
const A = 'alice.d1', B = 'bob.d1';
let alice = MlsDevice.create(A), bob = MlsDevice.create(B);
const [aKp] = alice.keyPackages(1, false), [bKp] = bob.keyPackages(1, false);
const [bLast] = bob.keyPackages(0, true);
console.log('key package bytes', bKp.length, 'last resort', bLast.length);
const must = (c, m) => { if (!c) throw new Error(m); };
const fails = async (f, label) => { try { await f(); throw new Error(label + ' NOT REJECTED'); } catch (e) { if (String(e).includes('NOT REJECTED')) throw e; console.log(label, 'rejected:', String(e).slice(0, 70)); } };

let t = performance.now();
const welcomeAB = alice.startOutbound(B, bKp);
bob.acceptWelcome(A, welcomeAB);
bob.acceptWelcome; const welcomeBA = bob.startOutbound(A, aKp); alice.acceptWelcome(B, welcomeBA);
console.log('setup both directions ms', (performance.now() - t).toFixed(1));

const send = (from, to, fromName, toName, text) => {
  const msgs = from.encrypt(toName, enc.encode(text));
  let out = null;
  for (const m of msgs) { const p = to.decrypt(fromName, m); if (p) out = dec.decode(p); }
  return [out, msgs.length];
};
let commits = 0;
t = performance.now();
for (let i = 0; i < 120; i++) {
  const [got, n] = i % 2 ? send(bob, alice, B, A, 'm' + i) : send(alice, bob, A, B, 'm' + i);
  must(got === 'm' + i, 'mismatch ' + i); if (n === 2) commits++;
}
console.log('120 alternating messages OK, self-update commits:', commits, 'avg ms', ((performance.now() - t) / 120).toFixed(2));

const bob2 = MlsDevice.restore(bob.exportState());
const [r] = alice.encrypt(B, enc.encode('after restore')).slice(-1).map((m) => bob2.decrypt(A, m));
must(dec.decode(r) === 'after restore', 'restore'); console.log('restore OK, state bytes', bob2.exportState().length);

const m = alice.encrypt(B, enc.encode('x')).at(-1);
const bad = m.slice(); bad[bad.length - 3] ^= 1;
await fails(() => bob2.decrypt(A, bad), 'tampered message');
must(dec.decode(bob2.decrypt(A, m)) === 'x', 'genuine');
await fails(() => bob2.decrypt(A, m), 'replayed message');
const eve = MlsDevice.create('eve.d1'); const [eKp] = eve.keyPackages(1, false);
await fails(() => alice.startOutbound(B, eKp), 'key package of another device');
const w = eve.startOutbound(B, bob.keyPackages(1, false)[0]);
await fails(() => bob.acceptWelcome(A, w), 'welcome from an impostor');
must(alice.remoteSignatureKey(B)?.length === 32, 'remote key');
console.log('all checks passed');

/**
 * End-to-end check of the OpenSocial recovery pass (zPass pattern) with the
 * maintained Aleo SDK, fully offline from the Aleo ledger:
 *
 *   1. JS-side credential hash equals the circuit's hash.
 *   2. Issuer signs the credential hash.
 *   3. Holder proves prove_recovery locally (real zk-SNARK).
 *   4. Verifier checks the proof with the function's verifying key and checks
 *      the public inputs (issuer, account, nonce, now).
 *   5. Negative cases: wrong account, expired credential, wrong holder.
 *
 * Needs internet access to download Aleo proving parameters (SRS), so it runs
 * in CI. Writes a summary for GitHub Actions and exits non-zero on failure.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import {
  Account,
  Plaintext,
  Poseidon2,
  Program,
  ProgramManager,
  verifyFunctionExecution,
} from '@provablehq/sdk/mainnet.js';

const PROGRAM_PATH = 'contracts/aleo/open_social_recovery_pass/compiled/open_social_recovery_pass.aleo';
const program = readFileSync(PROGRAM_PATH, 'utf8');
// Verification rules depend on the consensus version, chosen by block height.
async function latestHeight() {
  try {
    const r = await fetch('https://api.explorer.provable.com/v1/mainnet/block/height/latest');
    return Number(await r.text());
  } catch {
    return null;
  }
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  const tag = ok ? 'notice' : 'error';
  console.log(`::${tag} title=${name}::${ok ? 'PASS' : 'FAIL'} ${detail}`);
};
const time = async (fn) => {
  const t = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t };
};

const credentialHash = (issuer, subject, account, expiry) =>
  new Poseidon2()
    .hash(
      Plaintext.fromString(
        `{ issuer: ${issuer}, subject: ${subject}, account: ${account}, expiry: ${expiry} }`,
      ).toFields(),
    )
    .toString();

const publicInputs = (execution) => {
  const t = JSON.parse(execution.transitions()[0].toString());
  return t.inputs.map((i) => ({ type: i.type, value: i.value }));
};

async function main() {
  const issuer = new Account();
  const holder = new Account();
  const other = new Account();
  const I = issuer.address().to_string();
  const S = holder.address().to_string();
  const account = '987654321123456789field';
  const nowMinutes = Math.floor(Date.now() / 60000);
  const expiry = `${nowMinutes + 60 * 24 * 365}u32`;
  const now = `${nowMinutes}u32`;
  const nonce = `${BigInt('0x' + crypto.randomUUID().replace(/-/g, '')) % 10n ** 30n}field`;

  const pm = new ProgramManager();

  // 1. Hash compatibility.
  const jsHash = credentialHash(I, S, account, expiry);
  pm.setAccount(holder);
  const hashRun = await time(() => pm.run(program, 'credential_hash', [I, S, account, expiry], false));
  const circuitHash = String(hashRun.value.getOutputs()[0]);
  record('credential hash matches circuit', circuitHash === jsHash, `${jsHash} (${hashRun.ms} ms)`);

  // 2. Issuer signs.
  const sig = issuer.privateKey().signValue(jsHash).to_string();

  // 3. Holder proves (edition 0: the program declares @noupgrade and is not deployed).
  const proveInputs = [sig, I, account, expiry, nonce, now];
  const proved = await time(() =>
    pm.run(program, 'prove_recovery', proveInputs, true, undefined, undefined, undefined, undefined, undefined, undefined, 0),
  );
  const execution = proved.value.getExecution();
  record('proof generated', !!execution, `${proved.ms} ms`);
  if (!execution) throw new Error('No execution returned');

  // 4. Verify proof and public inputs. Try the current mainnet height first,
  // then a spread of heights, and report which consensus rules accept it.
  const vk = proved.value.getVerifyingKey();
  const latest = await latestHeight();
  const heights = [latest, 0, 2_000_000, 5_000_000, 8_000_000, 11_000_000, 14_000_000, 17_000_000, 20_000_000]
    .filter((h) => h !== null);
  const accepted = [];
  const errors = [];
  const verifyStart = Date.now();
  for (const h of heights) {
    try {
      if (verifyFunctionExecution(execution, vk, Program.fromString(program), 'prove_recovery', null, null, h)) {
        accepted.push(h);
      }
    } catch (e) {
      errors.push(`${h}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160));
    }
  }
  record(
    'proof verifies',
    latest !== null ? accepted.includes(latest) : accepted.length > 0,
    `latest height ${latest}; accepted at ${JSON.stringify(accepted)}; ${Date.now() - verifyStart} ms` +
      (errors.length ? `; errors ${errors.join(' / ')}` : ''),
  );
  const tampered = execution.toString().replace(nonce, `${BigInt(nonce.replace('field', '')) + 1n}field`);
  let tamperedOk = false;
  try {
    const { FunctionExecution } = await import('@provablehq/sdk/mainnet.js');
    tamperedOk = verifyFunctionExecution(
      FunctionExecution.fromString(tampered), vk, Program.fromString(program), 'prove_recovery', null, null,
      accepted[0] ?? latest ?? 0,
    );
  } catch {
    tamperedOk = false;
  }
  record('proof with a changed nonce is rejected', tamperedOk === false, '');

  const inputs = publicInputs(execution);
  const pub = inputs.filter((i) => i.type === 'public').map((i) => String(i.value));
  record(
    'public inputs are issuer, account, nonce, now',
    JSON.stringify(pub) === JSON.stringify([I, account, nonce, now]),
    JSON.stringify(pub),
  );
  const priv = inputs.filter((i) => i.type === 'private').map((i) => String(i.value));
  record(
    'signature and expiry stay private',
    priv.length === 2 && !priv.some((v) => v.includes(sig) || v.includes(expiry)),
    `${priv.length} private inputs, encrypted`,
  );

  // 5. Negative cases: execution must fail.
  const mustFail = async (name, account_, inputs_, acct) => {
    pm.setAccount(acct);
    try {
      await pm.run(program, 'prove_recovery', inputs_, false);
      record(name, false, 'execution unexpectedly succeeded');
    } catch {
      record(name, true, 'rejected');
    }
  };
  await mustFail('wrong account is rejected', account, [sig, I, '1field', expiry, nonce, now], holder);
  await mustFail(
    'expired credential is rejected',
    account,
    [sig, I, account, expiry, nonce, `${nowMinutes + 60 * 24 * 366}u32`],
    holder,
  );
  await mustFail('another holder cannot use the credential', account, proveInputs, other);
}

try {
  await main();
} catch (e) {
  record('script', false, e instanceof Error ? e.message : String(e));
}

const summary = [
  '## OpenSocial recovery pass (Aleo) check',
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} | ${r.detail.replace(/\|/g, '/')} |`),
].join('\n');
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
process.exit(results.length > 0 && results.every((r) => r.ok) ? 0 : 1);

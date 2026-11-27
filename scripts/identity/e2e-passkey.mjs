/**
 * Live end-to-end check of the OpenSocial identity canister on ICP mainnet,
 * using a software passkey:
 *
 *   passkey_register -> get_delegation
 *   -> call my_sign_in_methods as the account principal
 *   -> passkey_sign_in and get the same account principal
 *   -> a tampered assertion is rejected
 *   -> delete_account removes the test account again.
 *
 * Usage: IDENTITY_CANISTER_ID=<id> ORIGIN=<allowed origin> node scripts/identity/e2e-passkey.mjs
 */
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { identityIdl } from './identityIdl.mjs';
import { SoftPasskey } from './softPasskey.mjs';

const canisterId = process.env.IDENTITY_CANISTER_ID;
const origin = process.env.ORIGIN ?? 'https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io';
if (!canisterId) throw new Error('Set IDENTITY_CANISTER_ID');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

const passkey = new SoftPasskey({ canisterId, origin });
const first = await passkey.register(600);
const principal = first.prepared.account_principal.toText();
check('registration creates an account', first.prepared.new_account === true, principal);
check('delegation principal equals account principal', first.identity.getPrincipal().toText() === principal);

const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity: first.identity });
const asAccount = Actor.createActor(identityIdl, { agent, canisterId });
const links = (await asAccount.my_sign_in_methods()).Ok ?? [];
check('authenticated call as account works', links.length === 1 && links[0].kind === 'passkey', JSON.stringify(links.map((l) => l.label)));

const second = await passkey.signIn(600);
check(
  'passkey sign-in returns the same account',
  second.prepared.new_account === false && second.prepared.account_principal.toText() === principal,
);

const rejected = await passkey.signIn(600, { tamper: true }).then(
  () => false,
  () => true,
);
check('tampered assertion is rejected', rejected);

const deleted = await asAccount.delete_account();
check('test account is deleted', 'Ok' in deleted);

process.exit(results.every(Boolean) ? 0 : 1);

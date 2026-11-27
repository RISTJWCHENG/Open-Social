# Account recovery

Status: **Stage A** (first sign-in setup and recovery key). Recovery itself is
not possible yet: it needs the ICP recovery canister (Stage C).

## Model

```
First factor:  Internet Identity (passkey), required
Second factor: any ONE registered method (users may register several as backup)
  - Recovery key (recommended)            24 h waiting period
  - Email one-time code                   72 h waiting period
  - SMS one-time code                     72 h waiting period
  - Aleo zPass credential (optional)      24 h waiting period
Protection:    waiting period per method + notice to other devices
After:         new device key on ICP (old revoked), chats from Sia backup,
               contacts see the new safety number
```

Not layered: security comes from independent factors, and a second layer of
the same kind would only add ways to get locked out. Because any registered
method is enough, the account is as strong as its weakest method; weaker
methods therefore get a longer waiting period.

### Aleo zPass factor (decided: OpenSocial is the issuer)

- **Issuer:** OpenSocial. Before signing, it checks only that the request comes
  from the Internet Identity principal of the account. **No ID documents, no
  KYC.**
- **Credential:** `{ issuer, subject: user's Aleo address, account: commitment
  to the principal, expiry }`, signed with the issuer's Aleo key and held in the
  user's Aleo wallet.
- **Recovery:** the user runs `prove_recovery` with a fresh nonce from the
  verifier; the proof shows they hold the credential for this account without
  revealing the signature or expiry.
- **What it is, honestly:** a possession factor like the recovery key, kept in
  an Aleo wallet, private to verify, expirable and revocable. It does not help
  if the Aleo wallet is lost together with the device, and it does not prove a
  real-world identity.
- **Open design:** where the issuer's Aleo signing key lives. ICP threshold
  signatures do not support Aleo's curve, so the options are an off-chain
  issuer service (HSM or secret manager) that verifies Internet Identity
  delegations, or a canister-held key accepting that canister state is not
  confidential from node providers. To be decided with the recovery canister.

## Stage A (implemented)

- After the first Internet Identity sign-in, a 4-step setup asks the user
  which second factors to register (one or more):
  - **Recovery key** (available, recommended): 160 random bits, base32, 9
    groups of 4 with a 20-bit checksum. The user saves it and re-types two
    random groups to prove it was saved.
  - **Email**, **Phone** (shown, not available): need a verification service.
- Aleo zPass credential is shown as an optional, later factor.
- Only `SHA-256("opensocial/v1/recovery-key-commitment" || key)` is stored, in
  this browser's localStorage, keyed by the II principal. The key is never
  stored or sent.
- The user can skip. A reminder in the chat list leads to **Settings**.
- **Settings > Account recovery** lists every step of the target flow with its
  status (set up / not set up / later phase). There the user can create,
  replace (old key becomes useless) or remove the recovery key. Email and phone
  appear as "coming later".
- Internet Identity's own recovery (other passkeys, recovery phrase) is managed
  at id.ai; Settings links there.

## Stage B (in progress): Aleo recovery pass

Instead of the unmaintained `zpass-sdk` (0.1.3, Feb 2025), OpenSocial follows the
zPass pattern with its own Leo program and the maintained `@provablehq/sdk`
0.12.0. See `contracts/aleo/README.md`.

Verified in CI (`.github/workflows/aleo-recovery-pass.yml`, GitHub-hosted
2-core runner, no ledger access, no credits):

| Check | Result |
| --- | --- |
| JS credential hash equals circuit hash | pass |
| Proof generation (`prove_recovery`) | pass, about 2 minutes |
| Proof verification at current mainnet consensus | pass, about 0.1 s |
| Public inputs are issuer, account, nonce, now | pass |
| Signature and expiry stay private (encrypted) | pass |
| Wrong account / expired / another holder | rejected |
| Proof with a changed nonce | rejected |

Findings:

- Verification depends on the consensus version selected by block height;
  the verifier must use the current height (an old height rejects the proof).
- Proving takes about 2 minutes on a 2-core machine; browser proving needs
  measurement (WASM, threads need cross-origin isolation, which conflicts with
  the Internet Identity popup).

Still open: who issues credentials (the issuer key must live in a backend),
where verification runs (ICP canister via HTTPS outcalls, or a verifier
service), where the holder's Aleo key and signed credential are kept, and the
browser UI.

## Design rules for later stages

1. The zPass credential must be bound to the account (a commitment to the
   principal) and proofs must carry a fresh verifier nonce.
2. The Aleo key that proves zPass must not live only on the lost device.
3. Email and SMS are weaker (SIM swap, mailbox takeover) and expose contact
   data to a provider; store only hashes and prefer the recovery key.
4. Recovery waits out a cool-down and notifies old devices.
5. Contacts are told when keys change.

## Open decisions

- Where the zPass issuer key is kept (see above).
- Email / SMS provider, if wanted.
- Cool-down length.

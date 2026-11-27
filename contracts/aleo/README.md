# Aleo programs

## open_social_recovery_pass

First recovery check, following the zPass pattern: an issuer signs a
credential; the holder later proves in zero knowledge that they hold it.

- `credential_hash(issuer, subject, account, expiry)`: the message the issuer
  signs (Poseidon2 over the `Credential` struct).
- `prove_recovery(sig, issuer, account, expiry, nonce, now)`: proves the caller
  is the credential subject, the issuer signed it for `account`, and it has not
  expired. Public: issuer, account, nonce, now. Private: signature, expiry.

The program is **not deployed**. Proofs are generated and verified offline with
`@provablehq/sdk` (no ledger, no credits). Compiled with Leo 4.4.4; the
committed `compiled/*.aleo` must match `leo build` (checked in CI by
`.github/workflows/aleo-recovery-pass.yml`).

Issuer: OpenSocial, after checking only that the request comes from the
account's Internet Identity principal (no KYC). Still open: where the issuer
key is kept and where the verifier runs (ICP canister via HTTPS outcalls, or a
verifier service). See `docs/RECOVERY.md`.

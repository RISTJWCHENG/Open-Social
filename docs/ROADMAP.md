# OpenSocial Roadmap

## Phase 1 - Prototype and architecture (current)

- Project structure, React + TypeScript frontend, Vite build.
- ICP asset canister configuration and hosting detection.
- Interfaces and mock adapters for Aleo zPass, Sia, Nym and Holepunch.
- Prototype end-to-end envelope encryption with standard Web Crypto primitives.
- Threat model, automated tests, CI workflow.

## Phase 2 - Live adapters (proposed)

1. Nym: integrate the official browser SDK behind `Transport`; measure latency,
   bundle size and CSP requirements.
2. Holepunch: decide runtime (Pear desktop client vs relay); implement
   `PeerSwarm` over Hyperswarm with Noise-encrypted streams.
3. Sia: choose renter node or indexer; implement `EncryptedBlobStore`; design
   the mailbox model.
4. Aleo zPass: integrate the SDK for one predicate claim on testnet only.
5. Local deployment to a dfx replica.

## Phase 3 - Protocol hardening (proposed)

- Replace the ZCE1 envelope with an audited protocol implementation that
  provides forward secrecy and post-compromise security (for example a
  Double Ratchet or MLS library), selected after review.
- Encrypted local key persistence.
- External security audit before any mainnet deployment.

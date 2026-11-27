# OpenSocial

Privacy-first communication platform built on decentralized infrastructure.

> **Status: Phase 1 development prototype.** Four of the five integration
> modules are **simulated** in-process. The prototype provides **no network
> anonymity, no decentralized storage and no zero-knowledge verification**.
> Do not use it to protect real communications.

## Technology stack

| Layer | Technology | Phase 1 status |
| --- | --- | --- |
| Frontend hosting | Internet Computer (ICP) asset canister | Config + hosting detection implemented; not deployed |
| Account sign-in | ICP Internet Identity (`@icp-sdk/auth`) | Implemented; principal not yet linked to message keys |
| Credentials | Aleo zPass | Mock (`MockZPassVerifier`) |
| Encrypted storage | Sia | Mock (`MockSiaStore`), ciphertext-only enforced |
| Anonymous transport | Nym mixnet | Mock (`MockNymTransport`), no anonymity |
| P2P transport | Holepunch / Hyperswarm | Mock (`MockHyperswarm`), direct P2P is never anonymous |
| End-to-end encryption | Web Crypto (ECDH P-256, HKDF-SHA-256, AES-256-GCM, ECDSA P-256) | Prototype envelope, not audited |

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run check        # typecheck + tests + production build
```

Requirements: Node.js 20 or newer.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and build static assets into `dist/` |
| `npm run test` | Run the Vitest suite once |
| `npm run test:coverage` | Tests with V8 coverage |
| `npm run typecheck` | TypeScript project check |

## Repository layout

```
src/
  core/
    types.ts              Shared types, ModuleDescriptor, OpenSocialError
    interfaces.ts         Interfaces for all five integration layers
    registry.ts           Module descriptor registry
    crypto/               Identity keys and sealed envelope (ZCE1)
    messaging/            Transport frames (ZCF1) and Messenger orchestration
    transport/            In-process bus used only by mock transports
  modules/
    icp-hosting/          Hosting detection (implemented)
    icp-identity/         Internet Identity sign-in (implemented) and a test mock
    aleo-zpass/           Credential verifier (mock)
    sia-storage/          Encrypted blob store (mock)
    nym-transport/        Mixnet transport (mock)
    holepunch-p2p/        Hyperswarm peer swarm (mock)
  ui/                     React prototype UI
tests/
  unit/ integration/ ui/
docs/
  ARCHITECTURE.md  THREAT_MODEL.md  DEPLOYMENT_ICP.md  ROADMAP.md
  AUTH_INTERNET_IDENTITY.md  RECOVERY.md
public/.ic-assets.json5   Security headers for the ICP asset canister
dfx.json                  ICP canister definition
```

The app is published at https://chat.opensocial.cc (and its canister address
https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io; accounts are the same on both).
The OpenSocial Official Website, https://opensocial.cc (canister
`z3efs-jaaaa-aaaam-qjtlq-cai`), lives in its own repository,
`RISTJWCHENG/zcontact-official-website`.

## Honesty rules enforced in code

- Every module publishes a `ModuleDescriptor`. Mock modules must declare zero
  security guarantees; `tests/unit/honesty.test.ts` fails otherwise.
- Direct P2P (`MockHyperswarm`, and the future live adapter) always reports
  `hidesIpFromPeer: false`.
- The UI labels every mock module as **Simulated**.
- Storage and transport frames reject anything that is not a sealed envelope.

See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) before relying on any property.

## Licence

OpenSocial is proprietary software (see `LICENSE`). End-to-end encryption uses
OpenMLS (MIT). Every build writes `dist/third-party-licenses.txt` with the
notices of all shipped third-party components (npm production dependencies
and the Rust crates in the OpenMLS WebAssembly module); the app links to it
from Settings > About.

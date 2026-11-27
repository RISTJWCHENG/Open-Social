# Deploying the frontend to ICP

> Mainnet deployment consumes cycles (paid). It requires explicit approval
> and has **not** been performed.

## Local replica (free)

```bash
# Install dfx: https://internetcomputer.org/docs/building-apps/getting-started/install
dfx start --background --clean
dfx deploy open-social-frontend
# Open http://<canister-id>.localhost:4943
```

`dfx deploy` runs `npm run build` and uploads `dist/` to the asset canister
defined in `dfx.json`. Security headers come from `public/.ic-assets.json5`,
which Vite copies into `dist/`.

## Mainnet (requires approval)

```bash
dfx deploy --network ic open-social-frontend
```

Before running this:

1. Confirm cycles budget and controller identities.
2. Decide on controller policy (multiple controllers or governance).
3. Add live Nym / Sia endpoints to the CSP `connect-src` directive.
4. Verify the deployed asset hashes against a local reproducible build.

## Mainnet canister

- Canister: `ydmpv-niaaa-aaaak-qzlua-cai` ("OpenSocial Chat"), recorded in
  `canister_ids.json`.
- URL after the first deploy: https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io
- Custom domain: https://chat.opensocial.cc (DNS at Namecheap: CNAME `chat` to
  `chat.opensocial.cc.icp1.io`, CNAME `_acme-challenge.chat` to
  `_acme-challenge.chat.opensocial.cc.icp2.io`, TXT `_canister-id.chat` with the
  canister id; listed in `public/.well-known/ic-domains` and registered with
  `POST https://icp0.io/custom-domains/v1/chat.opensocial.cc`). Internet Identity
  uses the canister address as derivation origin there and passkeys keep its
  rp_id (`ii-alternative-origins`, `webauthn` in `public/.well-known/`).
- Deploys run from GitHub Actions (`.github/workflows/deploy-icp.yml`), manual
  only: Actions > Deploy to ICP > Run workflow, type `DEPLOY`.

### One-time setup (owner)

1. Create a deployer identity on your own computer (macOS, Linux or WSL):

   ```bash
   sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"
   dfx identity new open-social-deployer --storage-mode plaintext
   dfx identity get-principal --identity open-social-deployer
   dfx identity export open-social-deployer
   ```

2. Add the printed principal as a controller of the canister (NNS dapp:
   canister > Controllers > Add). Keep your own principal as a controller.
3. Save the exported PEM as the repository secret `DFX_IDENTITY_PEM`
   (Settings > Secrets and variables > Actions). Never paste it anywhere else.
4. Make sure the canister holds enough cycles.

Internet Identity principals are origin-specific: a new frontend origin
(for example a custom domain) needs a `derivationOrigin` to keep them.

## Identity canister

- Canister: `bbyqw-cyaaa-aaaao-qqlna-cai` (`open-social-identity`, Rust, `backend/identity`).
- Frontend builds read its id from `.env.production`
  (`VITE_OPENSOCIAL_IDENTITY_CANISTER_ID`).
- Deploy: `dfx deploy --network ic open-social-identity` (needs Rust with the
  `wasm32-unknown-unknown` target). Allowed origins are set in `dfx.json`
  (`init_arg`) and re-applied on upgrade.
- Live checks: `IDENTITY_CANISTER_ID=bbyqw-cyaaa-aaaao-qqlna-cai node scripts/identity/e2e-passkey.mjs`.

## Names

| dfx name | Canister id | NNS name |
| --- | --- | --- |
| `open-social-frontend` | `ydmpv-niaaa-aaaak-qzlua-cai` | OpenSocial Chat |
| `open-social-identity` | `bbyqw-cyaaa-aaaao-qqlna-cai` | OpenSocial Identity |
| `open-social-profiles` | `bansl-ciaaa-aaaam-ajq7a-cai` | open-social-profiles |

Canister ids never change; the dfx names are local labels.

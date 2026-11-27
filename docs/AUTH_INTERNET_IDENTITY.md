# Internet Identity sign-in

OpenSocial uses Internet Identity (II) for account sign-in through
[`@icp-sdk/auth`](https://js.icp.build/auth) (pinned to 10.0.1).

## Flow

1. On load, `InternetIdentityProvider.restore()` checks for a stored, unexpired
   delegation (IndexedDB, managed by the SDK). If found, the user is signed in.
2. **Sign in** must run from a click. The SDK opens `https://id.ai/authorize` in
   a new window; the user confirms with a passkey; the window returns a
   delegation over `postMessage` (ICRC-29). Session length: 8 hours.
3. After sign-in, the app creates **new message keys on the device**
   (ECDH/ECDSA, non-extractable) and starts messaging.
4. **Sign out** calls `AuthClient.signOut()`, which clears the stored
   delegation, and discards the message keys and all messages from memory.
5. The SDK only detects a closed sign-in window after its establish timeout
   (120 s), so the UI offers **Cancel sign-in** while waiting.

## What the principal is (and is not)

- The principal identifies the user to ICP canisters **for this app origin**.
- The OpenSocial identity canister turns it into the account principal; device
  keys are published under that account (see TARGET_ARCHITECTURE.md).
- Principals are origin-specific. Adding another frontend origin (for example
  a custom domain) needs `derivationOrigin` plus the
  `/.well-known/ii-alternative-origins` file on the canonical origin.

## Network and headers

- Sign-in opens `id.ai` in a window and calls ICP boundary nodes
  (`icp-api.io`, or the canister's own `icp0.io` host) to mint delegations.
- `public/.ic-assets.json5` allows those hosts in `connect-src` and sets
  `Cross-Origin-Opener-Policy: same-origin-allow-popups`; `same-origin` would
  cut the window link and break sign-in.
- Signing in costs the user nothing and deploys nothing.

## Local development against a local II

```ts
new InternetIdentityProvider({
  identityProvider: {
    authorizeUrl: 'http://<ii-canister-id>.localhost:4943/authorize',
    canisterId: '<ii-canister-id>',
  },
});
```

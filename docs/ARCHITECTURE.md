# OpenSocial Architecture

## Goals

1. Message content is readable only by the intended recipient (end-to-end encryption).
2. Infrastructure providers (hosting, storage, transport) only ever handle ciphertext.
3. Users can choose a transport that hides their IP address (Nym) instead of a
   direct connection (Hyperswarm), and the trade-off is always shown.
4. Users can prove eligibility claims (for example, age over 18) without
   revealing the underlying data (Aleo zPass).
5. The client is served as static, certified assets from ICP.

## Layered design

```
+-------------------------------------------------------------+
|  React UI (src/ui)                                          |
+-------------------------------------------------------------+
|  Messenger (src/core/messaging)                             |
|    seal -> store -> frame -> transport                      |
|    transport -> unframe -> open + verify                    |
+---------------+----------------+-------------+--------------+
| Crypto        | Credential     | Storage     | Transports   |
| (Web Crypto)  | Verifier       | BlobStore   | Transport /  |
|               | (Aleo zPass)   | (Sia)       | PeerSwarm    |
|               |                |             | (Nym,        |
|               |                |             |  Hyperswarm) |
+---------------+----------------+-------------+--------------+
| Hosting: ICP asset canister (static build, CSP headers)     |
+-------------------------------------------------------------+
```

All integration code depends only on interfaces in `src/core/interfaces.ts`.
Swapping a mock for a live adapter must not require changes above the
interface line.

## Module interfaces

| Module | Interface | Phase 1 implementation |
| --- | --- | --- |
| ICP hosting | `HostingDetector` | `icpHosting` (real detection logic) |
| ICP identity | `AccountProvider` | `InternetIdentityProvider` (live, `@icp-sdk/auth`) |
| Aleo zPass | `CredentialVerifier` | `MockZPassVerifier` |
| Sia | `EncryptedBlobStore` | `MockSiaStore` |
| Nym | `Transport` (`kind: 'mixnet'`) | `MockNymTransport` |
| Holepunch | `PeerSwarm` (`kind: 'direct-p2p'`) | `MockHyperswarm` |

Every implementation exposes `descriptor: ModuleDescriptor` with
`implementation`, `securityGuarantees` and `limitations`. Transports also expose
`anonymity: AnonymityProperties`.

### CredentialVerifier

```ts
createRequest(claim): ProofRequest       // verifier issues fresh nonce
prove(request): Promise<CredentialProof> // wallet side (zPass wallet in production)
verify(proof): Promise<VerificationResult> // { valid, simulated, reason? }
```

Nonces are single-use. `simulated: true` means the result proves nothing.

### EncryptedBlobStore

```ts
put(sealedEnvelope): Promise<BlobRef>   // rejects non-envelope bytes
get(ref) / has(ref) / delete(ref)
```

`BlobRef` is the hex SHA-256 of the stored bytes, so integrity is checked on read.

### Transport / PeerSwarm

```ts
connect() / close() / localAddress()
send(toAddress, frame) / onFrame(handler)
join(topic) / leave(topic) / peersOn(topic)   // PeerSwarm only
```

## Data formats

### Sealed envelope (OSE1)

```
"OSE1" (4) | ephemeral P-256 public key (65) | HKDF salt (32) | AES-GCM IV (12) | ciphertext+tag
```

- Key agreement: ephemeral-static ECDH P-256.
- KDF: HKDF-SHA-256, info binds label, ephemeral key and recipient key.
- AEAD: AES-256-GCM with the header as associated data.
- Inside the ciphertext: sender public keys, timestamp, body and an ECDSA
  P-256 signature over (label, recipient id, ephemeral key, timestamp, body).
  The sender identity is therefore hidden from storage and transport.

This is a composition of standard primitives. It is a placeholder until an
audited messaging protocol library is adopted (see ROADMAP).

### Transport frame (OSF1)

```
"OSF1" (4) | type (1, 0x01 = message) | sealed envelope
```

## Runtime constraints to resolve in Phase 2

- **Hyperswarm** relies on UDP hole punching and cannot run in a standard
  browser tab. Options: a Pear/Bare desktop client, or a relay. A relay sees
  connection metadata and must be covered in the threat model.
- **Nym** has a browser-capable SDK; bundle size, CSP `connect-src` entries
  and gateway selection must be evaluated.
- **Sia** storage requires a renter node or an indexer/gateway service. Who
  operates it, and what metadata it sees, must be decided.
- **Aleo zPass**: SDK availability, wallet integration and on-chain versus
  off-chain verification cost must be verified against current documentation.

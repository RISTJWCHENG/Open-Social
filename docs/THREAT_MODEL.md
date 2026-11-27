# OpenSocial Threat Model

Version: Phase 1 (prototype). Method: assets, adversaries, trust boundaries,
threats per layer (STRIDE-style), with explicit current status.

## 1. Scope and current status

Phase 1 is a single-tab prototype. Four of five integration modules are
simulated. **None of the network-anonymity, decentralized-storage or
zero-knowledge properties described below are provided yet.** The only
security mechanism actually executing is the prototype envelope encryption,
which is not audited.

## 2. Assets

| Asset | Sensitivity |
| --- | --- |
| Message content | High |
| Identity private keys | Critical |
| Social graph (who talks to whom) | High |
| User IP address and location | High |
| Credential attributes (age, membership) | High |
| Timing and volume of messages | Medium |
| Availability of the service | Medium |

## 3. Adversaries

| Adversary | Capabilities |
| --- | --- |
| A1 Passive network observer (ISP, Wi-Fi operator) | Sees packets, timing, IPs |
| A2 Global passive adversary | Observes large parts of the internet simultaneously |
| A3 Malicious peer / contact | Receives direct connections and messages |
| A4 Malicious storage host (Sia host, gateway, indexer) | Stores and serves blobs, sees access patterns |
| A5 Malicious mixnet node / gateway | Controls some Nym nodes or the entry gateway |
| A6 Compromised frontend delivery | Serves modified JavaScript |
| A7 Credential forger | Attempts to pass checks without valid credentials |
| A8 Device attacker | Malware, physical access, malicious browser extension |

## 4. Trust boundaries

1. User device (trusted while uncompromised) | everything else.
2. Browser JavaScript runtime | static assets delivered from ICP.
3. Client | storage providers (Sia).
4. Client | network transport (Nym or Hyperswarm).
5. Prover (user wallet) | verifier (OpenSocial).

## 5. Threats and mitigations

### 5.1 Content confidentiality and integrity

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| A1/A4/A5 read message content | Client-side envelope encryption before any I/O | Implemented (prototype, unaudited) |
| Tampering in transit or storage | AES-GCM with header as AAD; content-addressed blobs | Implemented, tested |
| Sender impersonation | ECDSA signature inside the envelope, contact key verification by safety number | Implemented; safety-number comparison is manual |
| Recipient key compromise exposes past messages | Forward secrecy via ratcheting protocol | **Not provided.** Planned (audited library) |
| Post-compromise recovery | Ratcheting | **Not provided** |
| Surreptitious forwarding | Signature binds recipient id and ephemeral key | Implemented |

### 5.2 Metadata and network anonymity

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| Peer learns user IP | Use Nym mixnet route | **Not provided** (mock). Direct P2P always exposes IP. |
| A1 links sender and receiver | Nym mixing, cover traffic | **Not provided** |
| A2 timing correlation | Nym delays and cover traffic reduce, but do not eliminate, risk | **Not provided** |
| Storage host learns sender | Sender identity only inside ciphertext | Implemented in envelope format |
| Storage host learns recipient via access patterns | Mailbox design with unlinkable fetch (to design) | **Open** |
| Hyperswarm DHT exposes topic membership and IP | Never use direct P2P for anonymity-sensitive contacts; UI warning | UI warning implemented |
| Link previews reveal shared links | The sender's app asks the identity canister to fetch the page (one node, non-replicated outcall); the site and that node see the address, not who receives it. The preview travels inside the encrypted message, so receivers never contact the site. The canister stores nothing; the sender can remove a preview before sending | Implemented |
| News reveals what a reader reads | The identity canister fetches HashFirst Global's lists, article text, covers, prices and indexes (allow-listed paths, cached) and serves them to the app; the site sees only the canister until the reader opens a story on the site. Article HTML is reduced to text markup in the app | Implemented |

**Policy:** Direct P2P (Hyperswarm) is never described as anonymous. It
reveals each peer's IP address to the other and to DHT nodes involved in
discovery.

### 5.3 Credentials (Aleo zPass)

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| A7 forges a credential | Zero-knowledge proof verified against issuer key | **Not provided** (mock accepts any request it issued) |
| Proof replay | Single-use verifier nonce bound into proof | Implemented in mock flow, tested |
| Over-disclosure of attributes | Request only predicate claims | Interface restricted to predicate claims |
| Verifier links users across sessions | Fresh nonces, no persistent identifiers in proof | To be confirmed with real SDK |

### 5.4 Frontend delivery (ICP)

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| A6 serves modified code | Certified assets; raw access disabled | Configured in `.ic-assets.json5`, not deployed |
| Third-party script injection | Strict CSP, no CDNs, fonts self-hosted | Configured |
| Supply-chain compromise via npm | Pinned versions, lockfile, CI | Lockfile + CI configured; no dependency audit tooling yet |
| Controller key compromise of the canister | Multi-party controller / SNS or reproducible builds | **Open** |

### 5.4a Account sign-in (Internet Identity)

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| Password phishing | Passkey-based II; OpenSocial never handles credentials | Implemented |
| Stolen session on a shared device | 8-hour delegation; sign-out clears it and all message keys | Implemented |
| Cross-app tracking via principal | II issues origin-specific principals | Provided by II |
| Account not bound to message keys (impersonation by key swap) | Key directory canister signed by the principal | **Open** (Phase 2) |
| Principal changes between preview and production origins | Canonical origin + `derivationOrigin` | **Open**, documented |

### 5.5 Device

| Threat | Mitigation (target) | Phase 1 status |
| --- | --- | --- |
| Key theft from storage | Non-extractable Web Crypto keys, encrypted persistence | Keys non-extractable; not persisted at all |
| Malware or malicious extension | Out of scope for the app; document clearly | Documented |

### 5.6 Availability

Mixnets and decentralized storage add latency and failure modes. Denial of
service against gateways and relays is in scope for Phase 2 design.

## 6. Non-goals

- Protection against a compromised user device.
- Hiding the fact that a user runs OpenSocial from a local network observer
  (Nym usage may itself be observable).
- Designing new cryptographic primitives or protocols.

## 7. Required reviews before any production use

1. Replace the prototype envelope with an audited protocol implementation.
2. Independent security audit of the client and each live adapter.
3. Review of every live adapter's metadata exposure.
4. Reproducible builds for the ICP-hosted frontend.

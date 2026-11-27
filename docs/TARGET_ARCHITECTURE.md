# OpenSocial target architecture

Status: agreed direction. Rows marked "open" still need a decision.

| Layer | Technology | Role | Status |
| --- | --- | --- | --- |
| Frontend | ICP asset canister | Hosts the web app | Live |
| Identity | ICP identity canister | Account principal, linked sign-in methods, device keys and authorisation | Live (device key directory to do) |
| Encryption | MLS (RFC 9420) with OpenMLS 0.9.2 | Forward secrecy and post-compromise security; groups with a ratchet tree | Live (1:1); groups to do |
| Local database | IndexedDB, encrypted at rest | Fast display and search | To do |
| Real-time transport | Hyperswarm/HyperDHT (apps), relay for the web; WebRTC considered | Direct delivery when online | Open |
| Group distribution | Autobase multi-writer logs, relays | Large rooms | Open |
| Sync | Hypercore-style signed append-only logs (ZLE1 entries: seq, prev hash, device signature) | Incremental sync, de-duplication, gap and replay detection | Live (1:1) |
| Offline delivery | ICP mailbox (in the identity canister) now, home-shard inboxes next (`docs/INBOX_SHARDING.md`); blind peers later behind the same `OfflineDelivery` interface | Hold ciphertext while users are offline | Live (ICP mailbox) |
| Profiles | open-social-profiles canister | Sealed friends-only profile, optional public profile | Live |
| Long-term storage | Sia, each user's own space | Encrypted backups, large attachments | Live |
| High-privacy mode (optional) | Nym mixnet | Hides IP address and who-talks-to-whom metadata | Decided: keep, optional |
| Human verification | Aleo zPass | "Verified human" / anti-spam proofs; not used for account recovery | Decided: keep |

## Decisions

- **Nym**: kept as an optional high-privacy mode. Default transport favours
  speed; users who need metadata privacy route through the mixnet.
- **Aleo zPass**: kept for attribute proofs such as "verified human" to curb
  spam and bots. Account recovery relies on linked sign-in methods instead.
- **Sia**: long-term, user-owned storage only. Not used for per-message
  mailboxes: every Sia object costs a full slab.

## Open questions

1. Platform: web only (Holepunch through a relay) or also Pear desktop and
   Bare Kit mobile apps with the full Holepunch stack.
2. Encryption: Hypercore room-key encryption alone, or Signal/MLS on top for
   forward secrecy.

## Offline delivery (live)

- Device directory: each device publishes its P-256 encryption and signing
  public keys under the account (`register_device`, `get_devices`).
- Mailbox: `deposit` / `deposit_batch` (signed-in callers only, 300 per
  minute, 64 KiB per entry, 2,000 per device), `fetch_mail` (owner only,
  query), `ack_mail` (deletes delivered entries). Entries nobody fetches are
  deleted after 30 days. The canister stores ciphertext only, directly in
  stable memory (ic-stable-structures), so upgrades never copy it.
- Entries are ZLE1 log entries: per recipient device chain with sequence
  number, previous-entry hash and the sender device's ECDSA signature,
  wrapping a ZCE1 envelope sealed for that device.
- Receivers check: transport sender = claimed sender, entry signature against
  the published device key, conversation id, envelope signer = that device,
  chain order (duplicates dropped, gaps flagged).
- Local data: device private keys as non-extractable CryptoKeys and messages
  encrypted with a non-extractable AES-GCM key, both in IndexedDB.
- Tests: unit and integration (`tests/integration/real-messaging.test.ts`),
  live canister (`npm run test:live`), live two-user browser test
  (`tests/live/two_users_browser.e2e.py`).

Not yet: forward secrecy (Signal/MLS), copies to the sender's other devices,
read receipts, real-time push (polling every 4 s), groups.

## Profiles (live)

Profiles live in `open-social-profiles` (see `docs/PROFILES_CANISTER.md`).

- **Friends only (default):** name, username, about and a 256 px photo are
  sealed on the device with the user's profile key (AES-256-GCM) and stored
  in the profiles canister as an opaque blob. The key goes to contacts the
  user added or accepted, inside MLS (`{ t: "profile-key" }`, with the
  profile's version). Friends fetch the blob and decrypt it; a newer version
  makes them fetch again.
- **Public:** additionally username, display name, about and a small photo
  (<= 64 KB) in the canister's public layer, searchable by prefix. Going
  back to friends only removes the public layer at once.
- The user's own profile and profile key are kept in the encrypted device
  store. Nicknames stay on the device.
- Public profiles can be reported; administrators can remove them.

## Account deletion (live)

Settings > Delete account (type DELETE): friends are told
(`{ t: "account-deleted" }`, their apps drop the profile and key), then the
profiles canister (`delete_my_data`), the user's Sia space (all backups and
shared files) and the identity canister (`delete_account`: sign-in methods,
passkeys, devices, key packages, waiting mail) are cleared, and the device
is wiped. Copies already on friends' devices can't be deleted remotely.

## Device storage

Secrets and private data (login session, Sia app key, own profile, profile
key) are AES-256-GCM encrypted in IndexedDB under a non-extractable key
(`src/core/storage/secureStore.ts`); so are chats, MLS state and files.
localStorage only holds non-sensitive preferences.

## MLS with OpenMLS (live)

- OpenMLS 0.9.2 (MIT; includes the October 2026 security fixes), compiled to
  WebAssembly by `wasm/mls` (`wasm/mls/build.sh`), vendored in
  `src/vendor/open-social-mls`, loaded lazily. Ciphersuite
  MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519.
- Each device is an MLS member `<account>.<deviceId>` with an Ed25519
  signature key. Devices publish 50 single-use key packages and one
  last-resort key package to the identity canister (`publish_prekeys`; a
  full republish replaces the set); senders `claim_prekeys` (one handed out
  once). Top-up when fewer than 20 remain.
- One-to-one: for each pair of devices each side owns an outbound
  two-member group and is the only committer there, so commits never race.
  The first send carries a Welcome (entry kind 1), then MLS messages (kind
  2). The sender commits a self-update every 50 messages. Welcomes are
  accepted only if the group holds exactly the expected two devices, and
  messages only from the expected sender.
- Known limitation: the receiving side does not yet send update proposals
  in the sender's group, so healing after a compromise of the receiving
  device relies on that device's own outbound group and on key rotation
  when the device re-registers. Planned with group chats, where the canister
  will order commits.
- No post-quantum ciphersuite yet: OpenMLS's X-Wing suite is experimental.
- The frontend is proprietary. `dist/third-party-licenses.txt` (built by
  `scripts/licenses/notices.mjs` and `scripts/licenses/rust-notices.mjs`)
  lists all shipped third-party components and their licence texts; MPL-2.0
  crates (hpke-rs) are used unmodified, with source links.
- Tests: `scripts/mls/smoke.mjs`, integration tests, live tests, CI job
  "MLS WebAssembly".

## Delivery speed (live)

- One send = one `deposit_batch` call (all recipient devices, Welcome and
  messages; all or nothing, in order). Chains advance only after success.
- Polling every 1.5 s while the app is visible (queries are free), 15 s in
  the background, immediately when the app regains focus.
- Device lists are cached for 60 s.
- Measured on mainnet between two browsers (both online): median about
  2.9 s from pressing send to display (`tests/live/latency_browser.e2e.py`).
  The floor is the ICP update call (consensus, about 2 s). Faster delivery
  between online users needs a direct channel (WebRTC/Hyperswarm), with the
  mailbox as the offline fallback.

## Direct links between online friends (live)

- WebRTC data channels between devices of friends (added or accepted
  contacts only). Signaling (offer/answer with all ICE candidates) is an
  MLS-encrypted payload sent through the mailbox, so DTLS fingerprints are
  authenticated end to end. STUN: Google and Cloudflare public servers. No
  TURN relay yet: when a direct path is impossible, messages keep using the
  mailbox.
- Same ZLE1/MLS entries over the link. The receiver reports the last
  sequence number it processed ("hello" on open, "ack" after every entry,
  from either path). Entry n goes over the link only if n-1 was already sent
  there or acknowledged, so processing stays in order; unacknowledged
  entries are re-sent through the mailbox when a link drops (duplicates are
  dropped by sequence number).
- Glare: the device with the smaller address keeps its offer. Setup times
  out after 20 s.
- When offers are sent: the device that comes back offers. On start, when
  the app returns to the foreground after more than 10 s, or when the
  network comes back, a device sends one offer each to up to five friends
  active in the last week. The side that stayed never retries a dropped
  link, and opening a chat or accepting a request offers only if that friend
  sent something in the last 2 minutes. So a friend who is offline or whose
  phone is locked receives no offers at all; they offer when they return.
  Safety net: at most one offer per 5 s and six per hour per device.
- Offers are marked `ephemeral` in `deposit_batch`: the canister keeps at
  most two per sender per mailbox, drops them after 10 minutes, and never
  counts them against the 2,000-entry limit, so they can't block real
  messages. Welcomes and commits are never ephemeral.
- Cost: an established reconnect is about 50 million cycles (~$0.00007).
- Settings > Connections: "Allow direct connections with friends" (on by
  default; friends can see your IP address). The high-privacy mode (Nym)
  will turn it off.
- Measured on mainnet (two browsers): the link opened about 7 s after the
  request was accepted; then median about 0.18 s per message (was about
  2.9 s through the mailbox). `tests/live/latency_browser.e2e.py`.

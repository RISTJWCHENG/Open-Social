# Sia storage: each user's own space

OpenSocial connects every user to **their own** Sia Storage account
(`https://sia.storage`, the Sia Foundation's hosted indexer) through the
official SDK `@siafoundation/sia-storage` 0.1.3 (WebAssembly, loaded lazily).

## Connect (Settings > Your Sia storage)

1. OpenSocial asks the indexer for a connection and shows an approval link.
2. The user opens it, signs in or creates a Sia Storage account, and approves OpenSocial.
3. New Sia account for OpenSocial: the SDK generates a recovery phrase; OpenSocial
   shows it once and the user must confirm they saved it. Returning account:
   the user types the phrase they saved before (checked with
   `matchesExistingAppKey`).
4. The derived 32-byte app key seed is kept in this browser's localStorage,
   keyed by the OpenSocial account principal, so the user stays connected.

OpenSocial app id: `a40461cd…5b00a` = SHA-256("opensocial/sia-app-id/v1").

## Backups

- "Back up chats now" serialises this device's chats, encrypts them with
  AES-256-GCM (key = HKDF-SHA-256 of the app key seed, info
  `opensocial/v1/sia-backup`), uploads the object with the SDK (which encrypts
  again) and pins it with metadata `{ kind: "open-social-backup", v: 1 }`.
- "Restore last backup" finds the newest such object and decrypts it.

## Security notes

- The Sia recovery phrase and app key never leave the device.
- The CSP adds `'wasm-unsafe-eval'` (WebAssembly) and allows `https:` in
  `connect-src`, because the SDK talks to storage hosts across the network.
- Not yet: syncing the app key to new devices automatically (planned with
  ICP vetKeys), automatic backups, per-message storage on Sia.

## Attachments: Sia is optional

- Up to 10 MB: encrypted entries over the direct link or the ICP mailbox
  (arrives even if the friend is offline).
- 10 MB to 2 GB: device to device. The file is kept on the sender's device
  in encrypted 4 MiB chunks and offered to every device of the friend (key
  and chunk count in an MLS message). Each receiving device fetches it over
  a direct link when one is open, asking from its first missing chunk, so a
  dropped link resumes where it stopped; each chunk is checked (OSF1: AES-256-
  GCM bound to its index and the last flag) and stored as it arrives, and the
  receiver confirms the whole file.
- Optional, with the user's own Sia space connected: "Send via Sia now" for a
  waiting file (same key; the friend fetches it from Sia without waiting),
  and "Save to my Sia" to keep a copy of any file stored on the device.
- Saving to disk streams download and decryption (save dialog where the
  browser has one). Deleting the account deletes all OpenSocial objects from
  the user's space.

## Erasure coding by size

Hosts store whole 4 MiB sectors, so an object takes at least one sector per
shard. Objects up to 10 MB use 1 data + 2 parity shards (three full copies on
three hosts: at least 4 MiB counted, about 12 MiB uploaded); larger objects
use 10 + 20 across 30 hosts (at least 40 MiB counted, faster parallel
downloads). Both store three times the data. If the indexer refuses 1 + 2, the
upload is retried once with 10 + 20 from a fresh copy of the stream (the
encryption is deterministic for a given key), and 10 + 20 is used for the
rest of the session.

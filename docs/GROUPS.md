# Group chats: one MLS group per chat, up to 2,000 members

Status: built and deployed (identity canister upgraded 2026-11-27).

Code: `wasm/mls/src/lib.rs` (group API), `backend/inbox_core/src/groups.rs`
(streams; tests in `groups_tests.rs`), group endpoints in
`backend/identity/src/lib.rs` and `backend/inbox/src/lib.rs`,
`src/core/groups/` (state and rules, transport interface), the "groups"
section of `src/core/delivery/realMessaging.ts` (engine), `src/ui/groups/*`.
Tests: `tests/unit/mls-groups.test.ts`, `tests/unit/groups.test.ts`,
`tests/integration/groups.test.ts` (with `fakeGroupShard.ts`).

## 1. Goals

| Goal | Target |
|---|---|
| Members per group | 2,000 accounts (up to ~4,000 devices) |
| Encryption | One MLS group (RFC 9420) per chat; each message encrypted once |
| Canister cost per message | One write, about 10M cycles (~$0.000014), independent of group size |
| Reading | Query calls only (free) |
| Latency | Sender: 0 (shown at once). Members viewing the chat: 1.4-2.3 s measured on mainnet, median 1.7 s (the write ~1.35 s + one read query ~0.3 s). Others: within their 1.5 s inbox poll after that |
| New canisters | None: group streams live in the inbox shards |
| Privacy | Shards see member accounts (needed to authorise reads/writes) and ciphertext sizes and times; never content, names, photos or roles |

## 2. Overview

```
 sender device                       group's shard (inbox_core)              member devices
 ─────────────                       ──────────────────────────              ──────────────
 MLS encrypt once ──── group_post ──▶ stream: seq → (sender, epoch,  ◀── group_heads (query, free)
   │                   (1 update)     kind, ciphertext), 30 days    ◀── group_read  (query, free)
   └── direct link ─────────────────────────────────────────────────────▶ online friends (0.1-0.3 s)
```

- Every group has one **home shard** (the creator's home shard at creation;
  the identity canister while sharding is off). Its principal is part of the
  group's encrypted state, so members know where to read and write.
- The shard keeps per group: an **access list** (member accounts, admin
  accounts), the **current epoch**, and the **stream** of entries.
- All content (texts, edits, reactions, files' keys, the group's name, photo,
  description, roles and settings) travels as MLS application messages in the
  stream. The shard can't read any of it.

## 3. MLS

- One MLS group per chat, one leaf per device. Ciphersuite unchanged
  (`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`). Credential identity is
  the device address (`account/deviceId`), as in one-to-one chats.
- Config: `max_past_epochs = 8` (late messages from the previous epochs still
  decrypt), sender ratchet tolerance for out-of-order messages, ratchet tree
  in the Welcome (the Welcome is stored once as a blob).
- `wasm/mls` gains a group API:
  `groupCreate`, `groupAdd(keyPackages) → {commit, welcome}`,
  `groupRemove(identities) → commit`, `groupSelfUpdate → commit`,
  `groupEncrypt(plaintext) → message`, `groupProcess(bytes) → plaintext |
  commit summary`, `groupJoin(welcome, ratchetTree)`, `groupExportTree`,
  `groupEpoch`, `groupMembers`, `groupMerge`, `groupDiscard`,
  `groupHasPending`, `groupDelete`.

### 3.1 Commit ordering

MLS needs one order of commits. The shard provides it: `group_post_commit`
carries the epoch it was made in and is accepted only if that is the shard's
current epoch, which then advances by one. A device whose commit is refused
reads the stream, processes what it missed, and makes its commit again.
Application messages are never refused for their epoch.

### 3.2 Adding members

1. An admin's device claims key packages for every device of the new
   accounts in **one** call (`claim_key_packages_batch`, new).
2. It makes one commit adding up to 100 accounts at a time.
3. It uploads the Welcome (with the ratchet tree) as a blob, then posts the
   commit with the access-list change in one update. The shard adds the
   accounts before anyone reads the Welcome.
4. Each new account gets a small notice in its personal inbox (over the
   existing one-to-one MLS channel): "group G on shard S, Welcome at seq N".
5. The new device reads the Welcome with queries and joins.

Sizes for 2,000 members / 4,000 devices: tree about 1.3 MB, Welcome about
0.5 MB per 100 accounts added; one add costs about 4G cycles (~$0.005).

### 3.3 Removing, leaving, devices

- **Remove (admin):** commit removing all the account's leaves + access-list
  removal, in one update. The removed account can no longer read the
  stream, and can't decrypt anything after that epoch.
- **Leave:** the leaving device posts the group without itself and removes
  its account from the access list (`group_leave`). The next admin device
  that sees it commits the removal of its leaves.
- **A member's new device:** another device of the same account adds it
  (a member may add or remove leaves of its own account; nothing else).
- **A member's deleted device:** removed the same way by the account's
  other devices, or by an admin when the account itself is removed.
- Every device commits a self-update after 200 messages it sent or once a
  week, for post-compromise security.

## 4. Group state and roles

`GroupState` (name, about, photo, members with roles, onlyAdminsPost,
onlyAdminsEdit, version) stays as in v1 and keeps `mayChange`. Changes are
application messages in the stream (encrypted), so every member applies the
same changes in the same order; the stream's total order removes v1's
last-writer-wins ties. The shard enforces only what it must for access:

| Shard rule | Why |
|---|---|
| Only accounts on the access list read or post | Strangers can't read ciphertext metadata or fill the stream |
| Only admins change the access list (adds, removes) | Matches `mayChange` |
| Only the owner changes the admin set in the access list | Matches `mayChange` |
| Commits must be for the current epoch | MLS commit order |

Members' apps still check every change with `mayChange` and ignore the rest.

## 5. Shard API (inbox_core; same on identity and every inbox shard)

| Method | Kind | Who | What |
|---|---|---|---|
| `group_create(gid, members, admins)` | update | anyone (becomes owner) | New stream, epoch 0 |
| `group_post(gid, payload)` | update | member | Application message → seq |
| `group_post_commit(gid, epoch, commit, welcome?, tree?, add, remove, admins?)` | update | member (adds/removes: admin; own devices: anyone) | Commit at `epoch` → seq, or `StaleEpoch(current)` |
| `group_leave(gid)` | update | member | Leaves the access list |
| `group_heads(gids)` | query | member | Latest seq per group (one call for all of a device's groups on that shard) |
| `group_read(gid, after, max_bytes)` | query | member | Entries after a seq, up to 2 MB |
| `group_set_role(gid, account, role)` | update | admins promote; owner demotes or hands over | Access-list role |
| `group_blob_put / group_blob_get` | update / query | member | Encrypted files and Welcomes, stored once in 1.8 MB chunks |
| `claim_key_packages(devices)` | update | signed-in account | Key packages of up to 200 devices in one call |

Limits: 2,000 accounts per group; application message up to 1 MB (the
group's state with 2,000 members is about 340 KB); commit up to 1.5 MB; files up
to 25 MB (larger ones through Sia); entries and blobs kept 30 days; at most
20,000 entries or 200 MB per group (oldest dropped first). A device away
longer than 30 days rejoins through a fresh add by an admin.

## 6. Client

- **Sending:** encrypt once, show at once, `group_post` in the background.
  Before encrypting, the stream is read to its end unless it was read in the
  last second (so the message is in the current epoch).
- **Receiving:** the open group's stream is read directly (`group_read`),
  again as soon as the last read returns (at least 250 ms apart), outside
  the group's lock so sending never waits for it. All other groups: one
  `group_heads` query per shard with every inbox poll (1.5 s visible, 5 s
  hidden), then `group_read` for groups that moved. Entries are processed in seq
  order; our own entries are skipped.
- **Files:** encrypted with a random key, uploaded once with
  `group_blob_put` (chunks of 1.5 MB, 4 at a time), downloaded with
  `group_blob_get` (query, free); the message carries the blob id, key and
  hash. Over 25 MB: Sia, as today.
- **Unread counts, notices, names, replies, reactions, edits, deletions,
  invitations from non-friends, admin-only posting, the group info panel:**
  unchanged from v1 (`src/ui/groups/*`).

## 7. Costs

| Action | Cycles | ~USD |
|---|---|---|
| Text message (1 KB) | ~10M | $0.000014 |
| Read messages | 0 | 0 |
| Add 100 accounts to a 2,000-member group | ~4G | $0.005 |
| Remove a member | ~20M | $0.00003 |
| 1 MB file (upload once, kept 30 days) | ~2.2G | $0.003 |
| Storage of a busy group (10,000 messages/month) | <0.01T/month | <$0.01 |

## 8. As built: details and limits

- Invitations (`group-invite`, over the one-to-one channel) carry only the
  group's name and where its Welcome is. Until the group's state arrives in
  the stream the chat holds a placeholder (version 0); the first state from
  an admin (or our own device) that lists us replaces it.
- Removed members are told over their own channel (`group-removed`); if
  they miss it, a `group_heads` reply without the group tells them.
- Leaving: the state without us is posted, the shard forgets us
  (`group_leave`, naming the next owner), and an admin's device commits the
  removal of our MLS leaves when it reads the change.
- New devices of a member: every 10 minutes the member's device with the
  smallest id in the group adds the account's missing devices and invites
  them, then reposts the group's state for them.
- Key packages the group refuses (`UnsupportedExtension`, from devices that
  last ran an old app version) are left out of the add; those devices join
  once updated (the check above).
- Every device renews its MLS keys after 200 messages or 7 days.
- Group files up to 25 MB: encrypted once (the file key travels in the
  message, like a Sia file, with seed `zgroup:<shard>:<group>`), stored as a
  blob; files up to 5 MB are fetched as they arrive.
- A chat backup restores a group's messages only (left, read-only): the MLS
  keys never leave the devices.
- The v1 groups (pairwise fan-out, live for a few hours on 2026-11-27) are
  gone: their code is removed and their chats stay read-only.

## 8a. Measured

- MLS (Node, `tests/unit/mls-groups.test.ts`): 2,000 devices in one add:
  commit 563 KB, Welcome 644 KB, member state 2.6 MB; a message is 349 bytes
  whatever the group size; encrypt 30 ms, decrypt 31 ms; remove commit 165 KB.
- Mainnet, 4 members: group created in 9.4 s (stream, Welcome upload,
  commit, state, invitations); a 30 KB photo 6.3 s.
- Mainnet, message timing (8 messages, browser network timings): the write
  (`group_post`, sync call v4) 1.27-1.50 s, median 1.35 s; a read query
  median 0.31 s; seen by the other member 1.36-2.27 s, median 1.7 s.

## 8b. Next

- Direct-link fast path: the same ciphertext to online friends in the
  group over open links (0.1-0.3 s), deduplicated by hash.
- Device management in Settings (an account holds at most 10 devices).

## Keeping this document current

Any change to group rules, the group wire format, the streams, MLS group
handling or the group UI updates this file in the same commit.

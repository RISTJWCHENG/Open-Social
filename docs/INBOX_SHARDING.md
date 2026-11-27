# Inbox sharding

Status: built (section 18). Live on mainnet: the identity canister runs the
shared inbox code as "shard 000", issues send tickets and answers `home_of`,
and the app routes by home. The orchestrator and inbox shards are built and
tested on a local replica; they go live once the deploy identity has cycles.
Target: 10 million registered users, with up to about one million online at
peak.

## 1. Summary

Every account gets a **home shard**: one `open-social-app-inbox-NNN` canister
that holds that account's devices, MLS key packages and the per-device
queues of end-to-end encrypted entries waiting for it. A shard holds up to
**100,000 accounts** (accounts, not conversations: a one-to-one chat spans
the two people's home shards, which may differ). Senders write straight to
the recipient's home shard; each device polls only its own home shard.

New canisters:

| Canister | Role | Count |
|---|---|---|
| `open-social-app-identity` | Sign-in (Internet Identity, passkeys, email), account principals, send tickets, account -> home shard (`home_of`), and the inbox of accounts not yet in a shard ("shard 000") | 1 |
| `open-social-app-inbox-001` ... | Devices, key packages, inbox queues for up to 100,000 accounts each | ~100 for 10M accounts |
| `open-social-app-orchestrator` | Creates shards, assigns new accounts, upgrades in waves, cycles, metrics | 1 |

Groups and communities (not built yet) follow the same idea later: section 14.

## 2. Today

All of this lives in the identity canister (`backend/identity/src/mailbox.rs`):

- Devices (`register_device`, `get_devices`), up to 10 per account.
- MLS key packages (`publish_key_packages`, `claim_key_package`): one
  last-resort package (<= 8 KiB) and up to 200 single-use ones (<= 1 KiB).
- Per-device queues (`deposit`, `deposit_batch`, `fetch_mail`, `ack_mail`):
  entries <= 64 KiB, <= 2,000 per device, 30-day expiry; direct-link offers
  are ephemeral (10 minutes, 2 per sender).
- A per-account rate limit of 300 entries per minute.
- Attachments travel through the queues in 32 KiB pieces (a 10 MB file is
  about 320 entries per receiving device).

Clients poll `fetch_mail` every 1.5 s when visible and 5 s when hidden,
and use direct WebRTC links for live chats when both sides are online.

One canister executes its updates one at a time, and a subnet's capacity
is shared by all its canisters, so this cannot serve millions of accounts.

## 3. Goals and non-goals

Goals:

- Add capacity by adding shards, with no change to clients beyond lookups.
- Keep every message path to one canister call where possible (no
  canister-to-canister calls on the send or receive path).
- Keep privacy as today: shards only see ciphertext, account principals,
  device ids and sizes and times.
- Survive the loss of a shard's cycles or a bad upgrade without losing
  other shards' users.

Non-goals (separate work):

- Groups and communities (section 14).
- Moving Market, Space and the news gateway out of their canisters.
- Profiles sharding (profiles stay in `open-social-app-profiles`).

## 4. Addressing: home shards

- When an account is created, the identity canister asks the orchestrator
  for a shard. The orchestrator picks the **open shard with the fewest
  accounts** (as OpenChat's LocalUserIndex does), preferring subnets with
  the fewest inbox shards, and records the account there.
- The assignment is permanent unless the orchestrator migrates the account
  (section 11). The identity canister stores `account -> shard` (it already
  maps principals to accounts, so no separate index canister is needed; it
  can be split out later if lookups ever become heavy).
- Clients find a shard once and keep it:
  - Their own: returned at sign-in by the identity canister.
  - A contact's: from the invite link and the profile-key exchange (both
    carry `home: CanisterId`), else `identity.home_of(principal)` (a query),
    then cached.
- If a shard answers `Moved { to }` (after a migration), the client updates
  its cache and retries there.

The mapping holds 10M entries of about 40 bytes, well under 1 GB. Its read
load is low because clients cache, and its writes are one per new account.

## 5. Sender authentication: send tickets

A shard must accept entries only from real OpenSocial accounts (anti-spam),
without calling the identity canister on every send.

- The identity canister issues a **send ticket** at sign-in and when the
  client asks for a fresh one:
  `ticket = { principal, expires_at, epoch, mac }`, where
  `mac = HMAC-SHA256(key[epoch], principal || expires_at)`.
  Tickets live 24 hours.
- The orchestrator gives every shard the ticket keys (current and previous
  epoch; keys rotate monthly). A shard checks the MAC and that
  `principal == msg_caller()`: a few microseconds, no inter-canister call.
- A banned account gets no new tickets, so it can send for at most 24 hours.
- These keys only prove "is an OpenSocial account". Node operators of a
  subnet can read canister state, so the keys protect against spam, not
  against those operators; message contents stay end-to-end encrypted.

Each shard also keeps the per-sender rate limit (300 entries per minute).
A sender spreading across shards gets that per shard; the ticket's expiry
and the identity canister's own limits bound the total.

## 6. Shard state

Stable memories (ids permanent, like the other canisters):

| Id | Store | Key | Value |
|---|---|---|---|
| 0 | `ACCOUNTS` | principal | `{ local_id: u32, created_at, moving_to: Option<CanisterId> }` |
| 1 | `DEVICES` | (local_id, device_id) | public keys, label, added_at |
| 2 | `KEY_PACKAGES` | (local_id, device_id) | last-resort package |
| 3 | `SINGLE_USE` | (local_id, device_id, n) | single-use package |
| 4 | `BOXES` | (local_id, device_id, entry id) | entry (ciphertext, sender, time, ephemeral) |
| 5 | `BOX_STATS` | (local_id, device_id) | count, bytes, newest id |
| 6 | `CONFIG` | | shard number, ticket keys, limits |
| 7 | `METRICS` | hour | updates, queries, bytes in/out |

Changes from today's limits, to fit 100,000 accounts per shard:

- Single-use key packages: at most 50 per device (was 200). Clients top up
  when below 20.
- A byte cap per device queue: 32 MiB (besides 2,000 entries); a full queue
  rejects with `QueueFull` so the sender keeps the entry and retries later.
- Attachments no longer travel through queues: the file goes to Sia
  (`docs/SIA_STORAGE.md`) and the entry carries only its reference and key.
  This is the single biggest saving in storage and update calls.

## 7. Shard API

```candid
type Ticket = record { principal : principal; expires_at : nat64; epoch : nat32; mac : blob };

// Devices and key packages (caller = the account; must live here).
register_device : (DeviceInput) -> (Result);
remove_device : (text) -> (Result);
publish_key_packages : (text, opt blob, vec blob) -> (Result_1);   // -> single-use left
get_devices : (principal) -> (DevicesResult) query;                // DevicesResult: ok | Moved
claim_key_package : (principal, text, Ticket) -> (ClaimResult);

// Sending (caller = any account with a valid ticket).
deposit_batch : (vec DepositItem, Ticket) -> (BatchResult);       // all items for accounts here

// Receiving (caller = the account).
fetch_mail : (text, nat64) -> (FetchResult) query;                  // device, after
ack_mail : (text, nat64) -> (Result_2);                             // device, up_to

// Orchestrator only.
adopt_account : (principal) -> (Result);
export_account : (principal, opt nat64) -> (ExportChunk);           // migration
import_account : (ExportChunk) -> (Result);
set_config : (Config) -> ();
metrics : () -> (Metrics) query;
```

## 8. Flows

**Sign-up.** identity creates the account -> orchestrator `assign(principal)`
-> shard `adopt_account` -> index stores the mapping -> identity returns the
delegation, the send ticket and `home`.

**First message to someone.** Client finds their home (invite link,
profile key or `index.home_of`), calls `get_devices` there, then
`claim_key_package` for each device, then sends.

**Sending one message.** One `deposit_batch` call to the recipient's home
(all of the recipient's devices in one call) and one to the sender's own
home for their other devices. When both people are online, the direct
WebRTC link carries the message and the queues are only the fallback.

**Receiving.** Each device polls `fetch_mail` on its home shard (section 12
for the cadence) and acknowledges in batches: after 50 entries or 10
seconds, whichever comes first (one update per batch, not per entry).

**Adding or removing a device.** Calls go to the account's home shard only.

**Deleting an account.** identity removes the sign-in methods; the
orchestrator tells the home shard to drop the account and the index to
forget it.

## 8a. Latency across shards

Two people on different shards (even different subnets) see no slower
messages than two on the same shard:

- The sender's client calls the recipient's shard directly; there is no
  canister-to-canister hop. An update costs one round of consensus on that
  subnet (about 1-2 s) whichever subnet it is, and sharing a shard would not
  skip it.
- The deposit to the recipient's home and the copy to the sender's own home
  are sent in parallel, so two shards cost no more time than one.
- The recipient polls only its own home shard (a query, about 0.1-0.3 s).
- When both are online, the direct link carries the message: measured on
  mainnet at about 0.18 s per message, against about 2.9 s through the
  mailbox (`docs/TARGET_ARCHITECTURE.md`).
- Only the first message to a new contact pays extra: finding their home,
  `get_devices` and `claim_key_package` (about 1-2 s once), then cached.

What can make one person slower is their shard's subnet being busy; the
placement rules (section 10) and the closing thresholds (section 9) guard
against that.

## 9. Capacity model for 100,000 accounts per shard

Assumptions (check them with load tests and production metrics):

- 2 devices per account on average; 10% online at peak (10,000 accounts).
- An online account sends 1 message per minute on average at peak.
- Half of live messages go over direct links when both sides are online.

Updates per second on one shard at peak:

| Source | Per second |
|---|---|
| Deposits from others (10,000 / 60 x 0.5 through the queue) | ~85 |
| Deposits to own other devices | ~85 |
| Batched acks | ~60 |
| Device, key package and other updates | ~20 |
| **Total** | **~250** |

Queries per second on one shard at peak: 20,000 online devices polling on
average every 6 s (section 12) is about 3,300 per second, spread over the
subnet's replicas.

Storage on one shard (typical, not worst case):

| Data | Estimate |
|---|---|
| Devices (200,000) | < 0.2 GB |
| Key packages (200,000 x (8 KiB + 50 x 1 KiB)) | ~11 GB |
| Queued entries (200,000 devices x ~200 KiB backlog) | ~40 GB |
| **Total** | **~50 GB** |

A canister's stable memory allows hundreds of GiB, so 100,000 accounts fit
with room. At roughly USD 5 per GB-year that is about USD 250 per shard per
year for storage, plus compute; check current prices before budgeting.

**When a shard closes to new accounts.** It stops taking new accounts at
100,000 accounts **or** earlier if, over a day, any of these is exceeded:
peak updates above 600 per second, stable memory above 150 GB, or average
instructions per round above 60% of the limit. The orchestrator then opens
the next shard. Numbers are starting points, tuned from load tests.

## 10. Placement

- At most 5 inbox shards per subnet, so one busy subnet can't hold many of
  them; 100 shards use about 20 subnets.
- New shards go to the subnet with the fewest inbox shards and spare
  capacity.
- The index, orchestrator and identity sit on different subnets from each
  other.

## 11. Orchestrator

- **Pool.** Keeps 2 empty shards created ahead of need, so opening one is
  instant.
- **Cycles.** Checks every shard hourly; below 10T it adds 5T. Alerts when
  its own balance can't cover two weeks of top-ups.
- **Upgrades in waves.** Snapshot, then upgrade 1 shard, wait an hour while
  watching errors and metrics, then 10%, then the rest. Any failure stops
  the wave; a snapshot restores the shard.
- **Migration.** Moves an account between shards: mark `moving_to` in the
  old shard (it answers `Moved` to new deposits after the move), copy
  devices, key packages and queued entries in chunks with `export_account`
  / `import_account`, switch the index, then delete the old copy. Used to
  split a hot shard and for the migration from today's mailbox (section 13).
- **Metrics.** Collects every shard's metrics hourly for a dashboard:
  accounts, devices, memory, updates and queries per second, queue sizes,
  errors, cycles.

## 12. Client polling

Polling is the largest load at scale. Cadence of `fetch_mail` per device:

| State | Interval |
|---|---|
| Visible, a message in the last minute | 2 s |
| Visible, idle | 5 s |
| Hidden | 30 s |
| A direct link open with everyone recently active | 15 s (the link carries live messages) |

Each poll goes to one canister. A later step can replace polling for
visible tabs with IC WebSockets (a gateway pushing notices from the shard).

## 13. Migration from today's mailbox

1. **Extract** the mailbox code into a shared Rust crate used by both the
   identity canister and the inbox shards; add the send tickets.
2. **Create** `index`, `orchestrator` and `inbox-001`. New accounts go to
   shards from then on.
3. **Release clients** that resolve each contact's home and talk to shards
   (one frontend release; open tabs reload on the version check).
4. **Move existing accounts** in batches with the migration flow; the
   identity canister acts as "shard 000" meanwhile and answers `Moved` for
   accounts already moved.
5. **Remove** the mailbox from the identity canister once it is empty.

Each step is released on its own and can be rolled back.

## 14. Groups and communities

- **Group chats live in the inbox shards as streams.** Each group has one
  home shard (its creator's at creation; the identity canister while
  sharding is off) holding its access list, MLS epoch and stream; messages
  are encrypted once (one MLS group per chat), written once and read by
  every member with free queries. No canister of its own is needed; new
  shards get the group code with the shard wasm. Details: docs/GROUPS.md.
- Moving an account to another shard does not move the groups whose stream
  is in its old shard: group ids carry no shard, members find the shard in
  their group record.
- `open-social-app-community-NNN` (later): communities (channels, history for
  new members, moderation) will get their own canisters, created and
  numbered by the orchestrator like the inbox shards.

## 15. Testing

- Unit tests for tickets, limits, migration chunks and `Moved` handling.
- PocketIC load tests of one shard with 100,000 accounts and 200,000
  devices: deposits, fetches and acks at 2x the section 9 rates; pass if
  latency stays under 2 s and memory under the thresholds.
- A multi-subnet PocketIC test with 5 shards, a migration under load and
  an upgrade wave.
- Live tests (`tests/live`) for sign-up, first message, multi-device and
  account deletion across two shards.

## 16. Risks and open questions

- Real throughput per shard and per subnet must come from load tests; the
  numbers here are estimates.
- Ticket keys are visible to node operators of the subnets that hold
  them; acceptable for anti-spam only.
- A shard that runs out of cycles freezes and its accounts can't receive;
  the orchestrator's alerts and two-week buffer are the guard.
- `get_devices` for a contact on another shard is one extra query on first
  contact; cached afterwards.

## 17. Compared with OpenChat

OpenChat moved from one canister per user to `MultiUser` canisters in
October 2026. A MultiUser canister holds at most 32,767 users (a 15-bit
index carried in the user id), new users go to the one with the fewest
users, and a new canister is created when all are full. OpenSocial's shards
can hold more accounts because they only queue ciphertext in transit:
history stays on the devices, and live messages often take direct links.

## 18. Implementation

Code:

| Path | What |
|---|---|
| `backend/inbox_core` | Shared Rust crate: devices, key packages, per-device queues (moved unchanged from the identity canister, with its tests), account export/import for moves, send tickets (HMAC-SHA256) |
| `backend/identity` | Uses `inbox_core` on its original memories (6-12, data untouched). New: `send_ticket`, `ticket_keys`, `rotate_ticket_key`, `home_of`, `set_home`, `set_sharding` / `sharding`, `export_account` / `cancel_move` / `drop_account` (moves out of shard 000), optional ticket argument on `deposit`, `deposit_batch`, `claim_key_package` (ignored here). New accounts are assigned to a shard when an orchestrator is set |
| `backend/inbox` | The shard canister: same mailbox methods as the identity canister, plus `adopt_account`, `set_ticket_keys`, `set_open`, `export_account` / `import_account` / `drop_account` / `cancel_move`, `stats`. Entry ids are at least the current time, so a moved device's read cursor stays valid |
| `backend/orchestrator` | Assigns accounts (fewest accounts first, a new shard when all are full), creates shards from the stored wasm, upgrades in waves, refreshes hourly (stats, closing, top-ups, ticket keys), moves accounts (refuses new entries during a move, undoes a failed one) |
| `src/modules/icp-identity/shardedMailbox.ts` | Client routing: finds and caches each account's home, sends to every home in parallel, attaches a ticket only where needed, retries once after `NotHere` / `Moved` or a refused ticket |

Tests: `inbox_core` unit tests (11), identity (23), orchestrator (3),
`tests/unit/sharded-mailbox.test.ts`, `tests/integration/sharded-messaging.test.ts`
(MLS messaging both ways through the router, same shard and different
shards), and a local-replica run of: two accounts assigned to two shards
(the second created automatically), tickets (missing, someone else's,
valid), wrong shard, fetch and ack, an account move with its mail and key
packages, entries refused during a move, a failed move undone, and upgrades
in waves with data kept. On mainnet: the identity upgrade kept device data
byte-for-byte (snapshot taken first), and two browsers exchanged messages
(first message through the inbox 1.9 s, then 0.1-0.3 s over the direct link).

Current state on mainnet:

- `open-social-app-orchestrator` (`oy56c-4yaaa-aaaac-bgguq-cai`) is installed
  with the shard wasm and holds about 9.9T cycles.
- Sharding is **off**: `identity.sharding()` returns `orchestrator = null`,
  so every account still lives in shard 000 (the identity canister). Add
  5-10T to the orchestrator before turning it on (step 3 below).

Turning shards on (needs cycles on the deploy identity, about 20T to start):

```bash
# 1. Create and install the orchestrator (it pays for shards from its balance).
dfx deploy --network ic open-social-app-orchestrator --no-wallet \
  --argument '(record { identity = principal "bbyqw-cyaaa-aaaao-qqlna-cai"; limits = null })'
dfx canister --network ic deposit-cycles 20000000000000 open-social-app-orchestrator
# 2. Give it the shard wasm and the people who may fix shards by hand.
scripts/upload-inbox-wasm.sh ic
dfx canister --network ic call open-social-app-orchestrator set_shard_controllers '(vec { principal "<deploy identity>" })'
# 3. Point the identity canister at it: new accounts now go to shards.
dfx canister --network ic call open-social-identity set_sharding \
  '(record { orchestrator = opt principal "<orchestrator id>" })'
# 4. Upgrading shards later: upload the new wasm, then upgrade in waves.
#    scripts/upload-inbox-wasm.sh ic
#    dfx canister --network ic call open-social-app-orchestrator upgrade_shards '(1)'   # watch, then '(1000)'
# 5. Later: move existing accounts out of shard 000 in batches.
dfx canister --network ic call open-social-app-orchestrator move_account \
  '(principal "<account>", principal "bbyqw-cyaaa-aaaao-qqlna-cai", principal "<shard>")'
```

Undo: `set_sharding(record { orchestrator = null })` sends new accounts back
to the identity canister; accounts already in shards keep working.

## 19. Keeping this document current

This file is the reference for anyone (people or AI assistants) changing
inbox routing, send tickets, shards, the orchestrator or account moves.
Any change to `backend/inbox_core`, `backend/inbox`, `backend/orchestrator`,
the sharding parts of `backend/identity`, or
`src/modules/icp-identity/shardedMailbox.ts` must update the matching
sections here in the same commit, including section 18's "Current state"
when something is deployed or switched on.

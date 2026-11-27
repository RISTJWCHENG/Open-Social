# OpenSocial - notes for AI assistants

OpenSocial is a privacy messaging app on the Internet Computer (ICP).

## Language

- Talk to the owner in Simplified Chinese.
- Everything in the repository is English: code, comments, docs, commits.

## Where to start

- `docs/CANISTERS.md` - every canister, its id, role and code folder.
- `docs/INBOX_SHARDING.md` - how messages reach devices: home shards, send
  tickets, the orchestrator, account moves, latency, capacity and the
  current mainnet state.
- `docs/GROUPS.md` - group chats: wire format, fan-out, state and roles.
- `docs/PROFILES_CANISTER.md` - profiles and people search.

## Rules

- Keep the docs true. A change to inbox routing, tickets, shards, the
  orchestrator or account moves updates `docs/INBOX_SHARDING.md` in the same
  commit; a change to group chats updates `docs/GROUPS.md`; a new or changed
  canister updates `docs/CANISTERS.md`.
- No mainnet deploys or operations that spend cycles without the owner's
  approval.
- Clean code only: no legacy or compatibility paths.
- Messaging stays end-to-end encrypted (MLS) and instant; sharding must not
  add delay to delivery.

# Canisters

| Name | Id | Role | Code |
|---|---|---|---|
| open-social-app-frontend | `ydmpv-niaaa-aaaak-qzlua-cai` | The web app (chat.opensocial.cc) | `src/` |
| open-social-app-identity | `bbyqw-cyaaa-aaaao-qqlna-cai` | Accounts and sign-in, send tickets, account -> inbox shard, and the inbox of accounts not yet in a shard ("shard 000") | `backend/identity` |
| open-social-app-profiles | `bansl-ciaaa-aaaam-ajq7a-cai` | Profiles, avatars, people search | `backend/profiles` |
| open-social-app-orchestrator | `oy56c-4yaaa-aaaac-bgguq-cai` | Runs the inbox shards (assign, create, upgrade, top up, move) | `backend/orchestrator` |
| open-social-app-inbox-NNN | created by the orchestrator | Devices, key packages and inbox queues of up to 100,000 accounts each | `backend/inbox` |
| open-social-app-gateway | `ey3tv-myaaa-aaaae-ahhcq-cai` | Reads the web for accounts: link previews, news, HashFirst Global | `backend/gateway` |
| open-social-app-space | `464na-uaaaa-aaaao-qqoua-cai` | Personal spaces and market listings | `backend/space` |
| open-social-app-search | `4z5lu-zyaaa-aaaao-qqouq-cai` | Full-text index of public content: profiles, listings, space items | `backend/search` |

dfx still deploys the first three under their original labels
(`open-social-frontend`, `open-social-identity`, `open-social-profiles`);
the names above are the ones shown in the NNS dapp.

The gateway and the space canister accept writes from OpenSocial accounts
only: they ask the identity canister once (`home_of`) and trust the answer
for a day. Controllers may also call them, for operations.

## Space canister

### Market module

`backend/space/src/market.rs` holds public classified listings: title, description,
category, condition, price (minor units) and currency, location, pickup and
shipping, up to 6 photos (<= 240 KiB each) and a status (Active, Reserved,
Sold, Hidden). Anyone can browse with `market_search` (text, category,
condition, price range, free only, shipping only, location, sort, paging);
OpenSocial accounts post with `market_create` / `market_update` and manage with
`market_set_status` / `market_delete` (max 50 open listings each). There are
no payments: buyers contact sellers in end-to-end encrypted chat. Three
distinct reports hide a listing until an administrator restores it
(`market_reported`, `market_moderate`). `delete_my_data` also removes the
caller's listings. The module uses its own memories (10-14), so it can move
to a separate canister later.

### Space module

`backend/space/src/space.rs` is each account's public personal page ("My Space"): posts,
links, works (image sets), videos, music and dapps, with tags, likes,
pinning, a short "about", an accent colour and a visible/hidden switch.
Images (<= 240 KiB, up to 6 per item) are stored like market photos. Video
(<= 25 MiB) and audio (<= 12 MiB) are uploaded in 1.5 MiB chunks
(`space_upload_begin`, `space_upload_chunk`, `space_upload_cancel`) and
read back chunk by chunk (`space_media_chunk`); the first bytes are checked
(MP4, WebM, MP3, M4A, OGG, WAV, FLAC). Each account may store 60 MiB and
all spaces together 1 GiB, so media cannot drain the canister's cycles.
Unfinished uploads expire after a day. Readers' follows stay on their
device; `space_feed` takes the list of followed accounts. Three reports
hide an item until an administrator restores it. `delete_my_data` also
removes the caller's space.

### Moving a module to another canister

Each module can copy itself page by page: the target canister, as a
controller-run job, calls `move_pull(source, module, map, start, pages)`
until done and `move_pull_cells`, then `move_counts` on both sides must
match. This is how both modules moved out of the profiles canister.

## Search canister

`backend/search` is one full-text index for every kind of public content.
It stores no content of its own beyond what ranking needs: each document is
`(kind, id, owner, title, text, tags, updated_at)`, and a search returns ids;
the caller then loads the items from their own canister (`market_search`
with `ids`, `space_items_by_ids`).

- **Kinds today:** `profile` (profiles canister), `listing` and `space`
  (space canister). A new kind needs no change here: a source just sends
  documents with a new `kind` string and implements `search_docs`.
- **Text:** lower-cased words; Chinese, Japanese and Korean text is indexed
  as overlapping two-character pairs, so "自行车" finds "二手自行车". Title
  words weigh 3, tags 2, body 1. The last word of a query also matches as a
  prefix ("brus" finds "Brussels"), so results appear while typing.
- **Ranking:** every query word must match (AND); hits are ordered by the
  sum of weight x idf, then by recency.
- **Memories:** 0 config, 1 documents, 2 postings (`term \0 kind \0 id` ->
  weight), 3 document frequency per term.

### Keeping the index in step

Sources are listed with `set_sources` and are the only callers allowed to
`index(put, remove)`. They push every change as it happens (create, edit,
status change, delete, `delete_my_data`) in a fire-and-forget call, so a
slow or upgrading search canister never blocks a write. Hidden, sold or
reported content is sent as a removal.

If the index is ever lost or the text rules change, a controller rebuilds it
with `reindex(source, kind, cursor, pages)`, which pulls `search_docs(kind,
cursor)` pages from the source until `next_cursor` is empty.

### Growing

The API (`search`, `search_ids`, `index`, `reindex`) does not expose where
documents live. When one canister is no longer enough, the same canister
becomes the router and the postings are split by term hash across
`open-social-app-search-NNN` canisters created like the inbox shards; clients
and sources keep calling `open-social-app-search`.

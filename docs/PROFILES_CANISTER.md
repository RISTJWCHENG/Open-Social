# open-social-profiles

Canister `bansl-ciaaa-aaaam-ajq7a-cai`. Stores only user avatars and profile
data. Everything else (accounts, sign-in, devices, mailbox) stays in
`open-social-identity`.

## Principles

- **Two layers per account.**
  - *Sealed profile* (friends only): an opaque blob encrypted on the device
    (name, username, about, 256 px avatar). The key goes to friends inside
    MLS. The canister never sees the plaintext.
  - *Public profile* (opt-in): username, display name, about, and a small
    public avatar, readable and searchable by anyone. Removed at once when
    the user goes back to friends only.
- **Owner-only writes.** Only the account principal itself can write or
  delete its records. The canister checks with the identity canister, once
  per principal, that the caller is an OpenSocial account (cached).
- **Complete deletion.** `delete_my_data` removes every record of the caller
  (profile, avatar, username, search entries, reports filed against it).
- **Stable memory, versioned records.** All data lives in stable structures
  (survives upgrades without copying). Records are Candid with a `version`
  and optional fields, so new fields can be added without migrations.
- **Bounded.** Size limits per field and per account, update rate limits,
  bounded search results.

## Stable memory layout (MemoryManager ids are permanent; never reuse one)

| Id | Structure | Key | Value |
| --- | --- | --- | --- |
| 0 | `PROFILES` StableBTreeMap | account principal | `ProfileRecord` (Candid) |
| 1 | `AVATARS` StableBTreeMap | (account principal, kind) | image bytes (`PublicAvatar` <= 64 KiB) |
| 2 | `SEALED` StableBTreeMap | account principal | sealed blob (<= 160 KiB) |
| 3 | `USERNAMES` StableBTreeMap | lower-case username | account principal |
| 4 | `TOKENS` StableBTreeMap | (search token, account principal) | () |
| 5 | `REPORTS` StableBTreeMap | (target, reporter) | `Report` |
| 6 | `CONFIG` StableCell | | `Config` (identity canister, admins, limits) |
| 7 | `ACCOUNTS` StableBTreeMap | principal | verified-at time (cache of identity check) |
| 8-9 | reserved | | (future: sharding map, certified avatars) |
| 10 | (retired: `LISTINGS`, now in open-social-app-space) | listing id | `Listing` (Candid), market module |
| 11 | `PHOTOS` StableBTreeMap | (listing id, photo hash) | image bytes (<= 240 KiB) |
| 12 | `BY_SELLER` StableBTreeMap | (seller, listing id) | () |
| 13 | `MARKET_REPORTS` StableBTreeMap | (listing id, reporter) | `Report` |
| 14 | `MARKET_SEQ` StableCell | | last listing id |
| 15 | reserved | | |
| 16-26 | space module | | items, images, owner index, settings, likes, media, chunks, sequences, reports, total bytes |

Large values (avatars, sealed blobs) are kept out of `ProfileRecord`, so
profile reads and search stay cheap. Maps get stable memory in 1 MiB buckets.

## ProfileRecord

```
visibility: Friends | Public
username: opt text              // public only, unique (see Usernames)
display_name: opt text          // public only, 1-40 chars
bio: opt text                   // public only, <= 160 chars
links: vec ProfileLink          // public only, at most 5
avatar: opt AvatarMeta          // public avatar: hash, mime, size, updated
sealed: opt SealedMeta          // sealed blob: hash, size, updated
created_at_ns, updated_at_ns: nat64
```

## Usernames

- Letters and digits of any language, plus `.` and `_`; 2-20 characters
  (Unicode code points). Accents and vowel signs are allowed, but not first.
- Stored as typed after NFKC normalization (full-width and other compatibility
  forms become ordinary characters), so the case the user chose is shown.
- Unique case-insensitively: `USERNAMES` is keyed by `username_key`, the
  lower-cased NFKC form, so `Rist`, `rist` and `ＲＩＳＴ` are one username.
- One writing system per username (Unicode Script property; Common and
  Inherited characters such as digits, `.`, `_` and marks are neutral). Latin
  may be combined with Han and Hiragana/Katakana, Hangul or Bopomofo. This stops
  look-alike letters from different alphabets (Latin `a` and Cyrillic `а`) being
  mixed to imitate another name.
- The app applies the same rules while typing (`src/core/profile/username.ts`);
  the canister has the final say.

## Search

`TOKENS` holds prefixes of the username and of each display-name word
(lower case). `search_profiles(q)` scans the token range for `q`, ranks
exact username > username prefix > word prefix, at most 20 results, at
least 2 characters. Scales to many users without scanning everything; a
dedicated search canister can replace it later behind the same API.

## Future extension points

- More avatar kinds (e.g. a 512 px public avatar) by adding an `AvatarKind`
  variant; keys already carry the kind.
- Sharding: `Config.shard` and memory id 8 reserved for a principal -> shard
  map when one canister is no longer enough.
- Certified HTTP serving of public avatars (memory id 9 reserved).

## Market and space modules

They moved to the space canister (`open-social-app-space`, see
`docs/CANISTERS.md`) with all their data. Memory ids 10-14 and 16-26 here
still hold the old copy and are never reused.

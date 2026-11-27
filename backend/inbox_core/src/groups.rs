//! Group chat streams. One MLS group per chat; its home shard keeps:
//!
//! - an access list: the member accounts and their role (owner, admin,
//!   member), so only members read and post;
//! - the current MLS epoch: a commit is accepted only if it was made in this
//!   epoch, which gives every member the same order of commits;
//! - the stream: numbered entries (application messages and commits), each
//!   stored once and read by every member with query calls;
//! - blobs: encrypted files and Welcomes, stored once in chunks.
//!
//! Everything stored is ciphertext; the shard never sees names, roles as the
//! members see them, or content. Entries and blobs expire after 30 days.
//! Members are accounts (principals), wherever their own inbox lives.

#[cfg(test)]
#[path = "groups_tests.rs"]
mod tests;

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{Memory, StableBTreeMap, Storable};
use std::borrow::Cow;

pub const MAX_MEMBERS: u32 = 2_000;
/// One application message (text, edit, reaction, file key, or the group's
/// state: name, photo and up to 2,000 members with their roles).
pub const MAX_MESSAGE_BYTES: usize = 1_000_000;
/// One commit (an add of up to 100 accounts with all their devices fits).
pub const MAX_COMMIT_BYTES: usize = 1_500_000;
/// One blob chunk (fits an ingress message with room to spare).
pub const MAX_CHUNK_BYTES: usize = 1_800_000;
/// One blob: a file or a Welcome.
pub const MAX_BLOB_BYTES: u64 = 26 * 1024 * 1024;
/// Live entries and blobs of one group, in bytes; the oldest go first.
pub const MAX_GROUP_BYTES: u64 = 200 * 1024 * 1024;
/// Live entries of one group; the oldest go first.
pub const MAX_GROUP_ENTRIES: u64 = 20_000;
pub const ENTRY_TTL_NS: u64 = 30 * 86_400 * 1_000_000_000;
/// Bytes of entries in one read reply (the reply limit is 3 MiB).
pub const MAX_READ_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_READ_ENTRIES: usize = 500;
/// Groups asked about in one `heads` call.
pub const MAX_HEADS: usize = 200;
/// Expired entries or blobs removed per call that changes a group.
const SWEEP_PER_CALL: usize = 50;

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Member,
    Admin,
    Owner,
}

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryKind {
    /// An MLS application message.
    Message,
    /// An MLS commit (moves the group to the next epoch).
    Commit,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub seq: u64,
    pub from: Principal,
    /// The sending device (as the sender says; the MLS signature is what counts).
    pub device: String,
    pub kind: EntryKind,
    /// The epoch the entry was made in.
    pub epoch: u64,
    pub at_ns: u64,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
    /// A commit that adds members: the blob holding its Welcome.
    pub welcome: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct GroupMeta {
    pub owner: Principal,
    pub epoch: u64,
    pub next_seq: u64,
    pub members: u32,
    /// Bytes of live entries and blobs.
    pub bytes: u64,
    /// Live entries.
    pub entries: u64,
    pub created_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct BlobMeta {
    pub size: u64,
    pub chunks: u32,
    pub received: u32,
    pub created_ns: u64,
    pub by: Principal,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Head {
    pub group: String,
    /// Seq of the latest entry (0: none yet).
    pub last_seq: u64,
    pub epoch: u64,
    /// The asker's role (they are a member, or the group isn't listed).
    pub role: Role,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub enum PostError {
    NotFound,
    NotMember,
    NotAllowed(String),
    /// A commit made in an older epoch: catch up to `current` and make it again.
    StaleEpoch(u64),
    Invalid(String),
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct CommitArgs {
    pub group: String,
    pub device: String,
    pub epoch: u64,
    #[serde(with = "serde_bytes")]
    pub commit: Vec<u8>,
    pub welcome: Option<u64>,
    /// Accounts to give access (admins only).
    pub add: Vec<Principal>,
    /// Accounts to take access from (admins remove members; the owner anyone).
    pub remove: Vec<Principal>,
}

macro_rules! candid_storable {
    ($($t:ty),*) => {$(
        impl Storable for $t {
            fn to_bytes(&self) -> Cow<'_, [u8]> {
                Cow::Owned(Encode!(self).expect("encode"))
            }
            fn into_bytes(self) -> Vec<u8> {
                Encode!(&self).expect("encode")
            }
            fn from_bytes(bytes: Cow<[u8]>) -> Self {
                Decode!(bytes.as_ref(), $t).expect("decode")
            }
            const BOUND: Bound = Bound::Unbounded;
        }
    )*};
}
candid_storable!(Entry, GroupMeta, BlobMeta, Role);

/// The memories the group streams use (each its own, permanent memory).
pub struct GroupMemories<M> {
    pub meta: M,
    pub members: M,
    pub entries: M,
    pub blobs: M,
    pub chunks: M,
    pub expiry: M,
}

pub struct Groups<M: Memory> {
    /// group id (8 bytes) -> meta
    meta: StableBTreeMap<Vec<u8>, GroupMeta, M>,
    /// group ++ account -> role
    members: StableBTreeMap<Vec<u8>, Role, M>,
    /// group ++ seq -> entry
    entries: StableBTreeMap<Vec<u8>, Entry, M>,
    /// group ++ blob id -> blob
    blobs: StableBTreeMap<Vec<u8>, BlobMeta, M>,
    /// group ++ blob id ++ chunk index -> bytes
    chunks: StableBTreeMap<Vec<u8>, Vec<u8>, M>,
    /// expiry time ++ kind (0 entry, 1 blob) ++ key -> ()
    expiry: StableBTreeMap<Vec<u8>, (), M>,
}

/// A group id is 16 hex characters (8 bytes).
pub fn parse_group(id: &str) -> Option<Vec<u8>> {
    if id.len() != 16 || !id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        return None;
    }
    Some((0..16).step_by(2).map(|i| u8::from_str_radix(&id[i..i + 2], 16).unwrap()).collect())
}

fn cat(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut k = a.to_vec();
    k.extend_from_slice(b);
    k
}

fn member_key(g: &[u8], p: &Principal) -> Vec<u8> {
    cat(g, p.as_slice())
}

fn seq_key(g: &[u8], seq: u64) -> Vec<u8> {
    cat(g, &seq.to_be_bytes())
}

fn blob_key(g: &[u8], blob: u64) -> Vec<u8> {
    cat(g, &blob.to_be_bytes())
}

fn chunk_key(g: &[u8], blob: u64, i: u32) -> Vec<u8> {
    cat(&blob_key(g, blob), &i.to_be_bytes())
}

fn expiry_key(at: u64, kind: u8, key: &[u8]) -> Vec<u8> {
    let mut k = at.to_be_bytes().to_vec();
    k.push(kind);
    k.extend_from_slice(key);
    k
}

fn valid_device(d: &str) -> bool {
    crate::valid_device_id(d)
}

impl<M: Memory> Groups<M> {
    pub fn init(m: GroupMemories<M>) -> Self {
        Self {
            meta: StableBTreeMap::init(m.meta),
            members: StableBTreeMap::init(m.members),
            entries: StableBTreeMap::init(m.entries),
            blobs: StableBTreeMap::init(m.blobs),
            chunks: StableBTreeMap::init(m.chunks),
            expiry: StableBTreeMap::init(m.expiry),
        }
    }

    pub fn role(&self, g: &[u8], p: &Principal) -> Option<Role> {
        self.members.get(&member_key(g, p))
    }

    fn member_meta(&self, group: &str, caller: &Principal) -> Result<(Vec<u8>, GroupMeta, Role), PostError> {
        let g = parse_group(group).ok_or(PostError::Invalid("bad group id".into()))?;
        let meta = self.meta.get(&g).ok_or(PostError::NotFound)?;
        let role = self.role(&g, caller).ok_or(PostError::NotMember)?;
        Ok((g, meta, role))
    }

    /// A new group with the caller as its only member and owner.
    pub fn create(&mut self, group: &str, caller: Principal, now: u64) -> Result<(), PostError> {
        let g = parse_group(group).ok_or(PostError::Invalid("bad group id".into()))?;
        if self.meta.contains_key(&g) {
            return Err(PostError::NotAllowed("This group id is taken".into()));
        }
        self.meta.insert(
            g.clone(),
            GroupMeta { owner: caller, epoch: 0, next_seq: 1, members: 1, bytes: 0, entries: 0, created_ns: now },
        );
        self.members.insert(member_key(&g, &caller), Role::Owner);
        Ok(())
    }

    fn append(&mut self, g: &[u8], meta: &mut GroupMeta, entry: Entry) -> u64 {
        let seq = entry.seq;
        let key = seq_key(g, seq);
        meta.bytes += entry.data.len() as u64;
        meta.entries += 1;
        self.expiry.insert(expiry_key(entry.at_ns + ENTRY_TTL_NS, 0, &key), ());
        self.entries.insert(key, entry);
        meta.next_seq = seq + 1;
        self.trim(g, meta);
        seq
    }

    /// Keeps a group within its entry and byte limits, dropping its oldest entries.
    fn trim(&mut self, g: &[u8], meta: &mut GroupMeta) {
        while meta.entries > MAX_GROUP_ENTRIES || meta.bytes > MAX_GROUP_BYTES {
            let Some(key) = self.entries.keys_range(g.to_vec()..).take_while(|k| k.starts_with(g)).next() else {
                break;
            };
            if let Some(e) = self.entries.remove(&key) {
                self.expiry.remove(&expiry_key(e.at_ns + ENTRY_TTL_NS, 0, &key));
                meta.bytes = meta.bytes.saturating_sub(e.data.len() as u64);
                meta.entries = meta.entries.saturating_sub(1);
            }
        }
    }

    /// An application message from a member → its seq.
    pub fn post(
        &mut self,
        group: &str,
        caller: Principal,
        device: String,
        epoch: u64,
        data: Vec<u8>,
        now: u64,
    ) -> Result<u64, PostError> {
        let (g, mut meta, _) = self.member_meta(group, &caller)?;
        if data.is_empty() || data.len() > MAX_MESSAGE_BYTES || !valid_device(&device) {
            return Err(PostError::Invalid("message too large or empty".into()));
        }
        self.sweep(now, SWEEP_PER_CALL);
        let entry = Entry {
            seq: meta.next_seq,
            from: caller,
            device,
            kind: EntryKind::Message,
            epoch,
            at_ns: now,
            data,
            welcome: None,
        };
        let seq = self.append(&g, &mut meta, entry);
        self.meta.insert(g, meta);
        Ok(seq)
    }

    /// A commit made in the current epoch → its seq; the epoch moves on and
    /// the access list changes with it, in one step.
    pub fn post_commit(&mut self, caller: Principal, a: CommitArgs, now: u64) -> Result<u64, PostError> {
        let (g, mut meta, role) = self.member_meta(&a.group, &caller)?;
        if a.commit.is_empty() || a.commit.len() > MAX_COMMIT_BYTES || !valid_device(&a.device) {
            return Err(PostError::Invalid("commit too large or empty".into()));
        }
        if a.epoch != meta.epoch {
            return Err(PostError::StaleEpoch(meta.epoch));
        }
        if (!a.add.is_empty() || !a.remove.is_empty()) && role == Role::Member {
            return Err(PostError::NotAllowed("Only admins add or remove members".into()));
        }
        for p in &a.remove {
            match self.role(&g, p) {
                Some(Role::Owner) => return Err(PostError::NotAllowed("The owner can't be removed".into())),
                Some(Role::Admin) if role != Role::Owner && *p != caller => {
                    return Err(PostError::NotAllowed("Only the owner removes admins".into()))
                }
                _ => {}
            }
        }
        if let Some(w) = a.welcome {
            let b = self.blobs.get(&blob_key(&g, w)).ok_or(PostError::Invalid("Welcome not uploaded".into()))?;
            if b.received != b.chunks {
                return Err(PostError::Invalid("Welcome upload incomplete".into()));
            }
        }
        let new: Vec<&Principal> = a.add.iter().filter(|p| self.role(&g, p).is_none()).collect();
        let gone = a.remove.iter().filter(|p| self.role(&g, p).is_some()).count() as u32;
        if meta.members + new.len() as u32 - gone > MAX_MEMBERS {
            return Err(PostError::NotAllowed(format!("A group can have up to {MAX_MEMBERS} members")));
        }
        self.sweep(now, SWEEP_PER_CALL);
        for p in &a.remove {
            if self.members.remove(&member_key(&g, p)).is_some() {
                meta.members -= 1;
            }
        }
        for p in new {
            self.members.insert(member_key(&g, p), Role::Member);
            meta.members += 1;
        }
        let entry = Entry {
            seq: meta.next_seq,
            from: caller,
            device: a.device,
            kind: EntryKind::Commit,
            epoch: meta.epoch,
            at_ns: now,
            data: a.commit,
            welcome: a.welcome,
        };
        meta.epoch += 1;
        let seq = self.append(&g, &mut meta, entry);
        self.meta.insert(g, meta);
        Ok(seq)
    }

    /// Changes a member's role: admins make members admins; the owner makes
    /// admins members again, or hands the group over (becoming an admin).
    pub fn set_role(
        &mut self,
        group: &str,
        caller: Principal,
        account: Principal,
        role: Role,
    ) -> Result<(), PostError> {
        let (g, mut meta, mine) = self.member_meta(group, &caller)?;
        let cur = self.role(&g, &account).ok_or(PostError::NotFound)?;
        let ok = match (cur, role) {
            (Role::Member, Role::Admin) => mine >= Role::Admin,
            (Role::Admin, Role::Member) => mine == Role::Owner || account == caller,
            (Role::Member | Role::Admin, Role::Owner) => mine == Role::Owner,
            _ => cur == role,
        };
        if !ok {
            return Err(PostError::NotAllowed("Not allowed".into()));
        }
        if role == Role::Owner {
            self.members.insert(member_key(&g, &caller), Role::Admin);
            meta.owner = account;
            self.meta.insert(g.clone(), meta);
        }
        self.members.insert(member_key(&g, &account), role);
        Ok(())
    }

    /// The caller leaves; an owner names who takes over (else the group ends when the last one leaves).
    pub fn leave(&mut self, group: &str, caller: Principal, heir: Option<Principal>) -> Result<(), PostError> {
        let (g, mut meta, role) = self.member_meta(group, &caller)?;
        if role == Role::Owner && meta.members > 1 {
            let heir = heir.ok_or(PostError::Invalid("Name the next owner".into()))?;
            if heir == caller || self.role(&g, &heir).is_none() {
                return Err(PostError::Invalid("The next owner must be a member".into()));
            }
            self.members.insert(member_key(&g, &heir), Role::Owner);
            meta.owner = heir;
        }
        self.members.remove(&member_key(&g, &caller));
        meta.members -= 1;
        if meta.members == 0 {
            self.drop_group(&g);
        } else {
            self.meta.insert(g, meta);
        }
        Ok(())
    }

    fn drop_group(&mut self, g: &[u8]) {
        let prefix = |k: &Vec<u8>| k.starts_with(g);
        let entries: Vec<_> = self.entries.keys_range(g.to_vec()..).take_while(prefix).collect();
        for k in entries {
            if let Some(e) = self.entries.remove(&k) {
                self.expiry.remove(&expiry_key(e.at_ns + ENTRY_TTL_NS, 0, &k));
            }
        }
        let blobs: Vec<_> = self.blobs.keys_range(g.to_vec()..).take_while(prefix).collect();
        for k in blobs {
            self.remove_blob(&k);
        }
        let members: Vec<_> = self.members.keys_range(g.to_vec()..).take_while(prefix).collect();
        for k in members {
            self.members.remove(&k);
        }
        self.meta.remove(&g.to_vec());
    }

    /// Stores one chunk of a blob (a file or a Welcome). The first chunk sets its size.
    #[allow(clippy::too_many_arguments)]
    pub fn blob_put(
        &mut self,
        group: &str,
        caller: Principal,
        blob: u64,
        index: u32,
        chunks: u32,
        size: u64,
        data: Vec<u8>,
        now: u64,
    ) -> Result<(), PostError> {
        let (g, mut meta, _) = self.member_meta(group, &caller)?;
        if data.is_empty() || data.len() > MAX_CHUNK_BYTES || size == 0 || size > MAX_BLOB_BYTES || index >= chunks {
            return Err(PostError::Invalid("bad chunk".into()));
        }
        if chunks as u64 > size || chunks > 1_000 {
            return Err(PostError::Invalid("bad chunk count".into()));
        }
        let bk = blob_key(&g, blob);
        let mut b = match self.blobs.get(&bk) {
            Some(b) if b.by != caller || b.chunks != chunks || b.size != size => {
                return Err(PostError::NotAllowed("This blob id is taken".into()))
            }
            Some(b) => b,
            None => {
                self.sweep(now, SWEEP_PER_CALL);
                meta.bytes += size;
                self.expiry.insert(expiry_key(now + ENTRY_TTL_NS, 1, &bk), ());
                BlobMeta { size, chunks, received: 0, created_ns: now, by: caller }
            }
        };
        let ck = chunk_key(&g, blob, index);
        if !self.chunks.contains_key(&ck) {
            self.chunks.insert(ck, data);
            b.received += 1;
        }
        self.blobs.insert(bk, b);
        self.trim(&g, &mut meta);
        self.meta.insert(g, meta);
        Ok(())
    }

    pub fn blob_get(&self, group: &str, caller: Principal, blob: u64, index: u32) -> Result<Vec<u8>, PostError> {
        let (g, _, _) = self.member_meta(group, &caller)?;
        self.chunks.get(&chunk_key(&g, blob, index)).ok_or(PostError::NotFound)
    }

    fn remove_blob(&mut self, bk: &Vec<u8>) {
        if let Some(b) = self.blobs.remove(bk) {
            for i in 0..b.chunks {
                self.chunks.remove(&cat(bk, &i.to_be_bytes()));
            }
            self.expiry.remove(&expiry_key(b.created_ns + ENTRY_TTL_NS, 1, bk));
            if let Some(mut meta) = self.meta.get(&bk[..8].to_vec()) {
                meta.bytes = meta.bytes.saturating_sub(b.size);
                self.meta.insert(bk[..8].to_vec(), meta);
            }
        }
    }

    /// Entries after `after`, oldest first, up to the reply limits.
    pub fn read(&self, group: &str, caller: Principal, after: u64) -> Result<Vec<Entry>, PostError> {
        let (g, _, _) = self.member_meta(group, &caller)?;
        let mut out = Vec::new();
        let mut bytes = 0;
        for item in self.entries.range(seq_key(&g, after + 1)..).take_while(|e| e.key().starts_with(&g)) {
            let e = item.value();
            if !out.is_empty() && (bytes + e.data.len() > MAX_READ_BYTES || out.len() >= MAX_READ_ENTRIES) {
                break;
            }
            bytes += e.data.len() + 128;
            out.push(e);
        }
        Ok(out)
    }

    /// For each group the caller is in: its latest seq and epoch.
    pub fn heads(&self, groups: &[String], caller: Principal) -> Vec<Head> {
        groups
            .iter()
            .take(MAX_HEADS)
            .filter_map(|id| {
                let g = parse_group(id)?;
                let role = self.role(&g, &caller)?;
                let meta = self.meta.get(&g)?;
                Some(Head { group: id.clone(), last_seq: meta.next_seq - 1, epoch: meta.epoch, role })
            })
            .collect()
    }

    pub fn meta(&self, group: &str) -> Option<GroupMeta> {
        self.meta.get(&parse_group(group)?)
    }

    /// Deletes up to `limit` expired entries and blobs.
    pub fn sweep(&mut self, now: u64, limit: usize) -> usize {
        let due: Vec<Vec<u8>> = self
            .expiry
            .keys_range(Vec::new()..)
            .take_while(|k| u64::from_be_bytes(k[..8].try_into().unwrap()) <= now)
            .take(limit)
            .collect();
        for k in &due {
            self.expiry.remove(k);
            let key = k[9..].to_vec();
            if k[8] == 0 {
                if let Some(e) = self.entries.remove(&key) {
                    if let Some(mut meta) = self.meta.get(&key[..8].to_vec()) {
                        meta.bytes = meta.bytes.saturating_sub(e.data.len() as u64);
                        meta.entries = meta.entries.saturating_sub(1);
                        self.meta.insert(key[..8].to_vec(), meta);
                    }
                }
            } else {
                self.remove_blob(&key);
            }
        }
        due.len()
    }

    /// Groups this shard holds (for stats).
    pub fn count(&self) -> u64 {
        self.meta.len()
    }
}

//! Canister state.
//!
//! Durable data lives directly in stable memory (ic-stable-structures), so
//! upgrades never copy it and the heap stays small. Signatures, challenges and
//! rate-limit counters are short-lived and kept in the heap only.

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_canister_sig_creation::signature_map::SignatureMap;
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeMap;

pub type AccountId = u64;
type Mem = VirtualMemory<DefaultMemoryImpl>;

/* ---------------------------------------------------------------- types --- */

/// Where the frontend runs. WebAuthn needs the relying party id (a domain).
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct AllowedOrigin {
    /// e.g. "https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io"
    pub origin: String,
    /// e.g. "ydmpv-niaaa-aaaak-qzlua-cai.icp0.io"
    pub rp_id: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Config {
    pub origins: Vec<AllowedOrigin>,
}

/// A way to sign in to an account: the method it was created with, or a
/// recovery email added at sign-up.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Link {
    /// "ii", "passkey" or "email"
    pub kind: String,
    /// Stable identifier within the kind (principal, credential id, email hash).
    pub id: String,
    /// Short, non-secret label for display.
    pub label: String,
    pub added_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Passkey {
    pub account: AccountId,
    /// Uncompressed SEC1 P-256 public key (65 bytes).
    pub public_key: Vec<u8>,
    pub rp_id: String,
}

// Devices and queued entries are kept by the shared inbox crate (same types
// and encoding as before they moved there).
use open_social_inbox_core::ticket::TicketKey;
pub use open_social_inbox_core::{Device, Inbox, MailItem};

/// Resend (resend.com) account used to send sign-in codes.
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct EmailSender {
    pub api_key: String,
    /// e.g. "OpenSocial <login@example.com>"
    pub from: String,
    /// Stop sending after this many emails per UTC day (provider plan limit).
    pub daily_limit: u32,
}

/// Canister-wide settings and counters.
#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct Settings {
    pub config: Config,
    /// Secret salt for account seeds and email hashes; empty until first needed.
    pub salt: Vec<u8>,
    /// Outbound email service for email sign-in. The API key is never returned by any query.
    pub email_sender: Option<EmailSender>,
    /// Account principals allowed to configure the email sender (besides controllers).
    pub admins: Vec<Principal>,
    /// Last account id issued (ids start at 1).
    pub last_account: AccountId,
    /// Last mailbox entry id issued (ids start at 1).
    pub last_mail_id: u64,
    /// (UTC day number, emails sent that day)
    pub email_day: (u64, u32),
}

#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Links(pub Vec<Link>);

/// Send-ticket keys, newest last (at most two kept).
#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct TicketKeys(pub Vec<TicketKey>);

/// How accounts are spread over inbox shards.
#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Sharding {
    /// The orchestrator that assigns new accounts to inbox shards. None: new
    /// accounts live here, in this canister's own inbox ("shard 000").
    pub orchestrator: Option<Principal>,
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
candid_storable!(Settings, Links, Passkey, TicketKeys, Sharding);

/* --------------------------------------------------------------- stores --- */

// Memory ids are permanent. Never reuse or renumber them.
const MEM_SETTINGS: u8 = 0;
const MEM_LINKS: u8 = 1;
const MEM_LINK_INDEX: u8 = 2;
const MEM_PASSKEYS: u8 = 3;
const MEM_PRINCIPALS: u8 = 4;
const MEM_ACCOUNTS: u8 = 5;
const MEM_DEVICES: u8 = 6;
const MEM_MAIL: u8 = 7;
const MEM_MAIL_COUNT: u8 = 8;
const MEM_EXPIRY: u8 = 9;
const MEM_OFFERS: u8 = 10;
const MEM_LAST_RESORT: u8 = 11;
const MEM_SINGLE_USE: u8 = 12;
const MEM_TICKET_KEYS: u8 = 13;
const MEM_HOMES: u8 = 14;
const MEM_SHARDING: u8 = 15;
const MEM_GROUP_META: u8 = 16;
const MEM_GROUP_MEMBERS: u8 = 17;
const MEM_GROUP_ENTRIES: u8 = 18;
const MEM_GROUP_BLOBS: u8 = 19;
const MEM_GROUP_CHUNKS: u8 = 20;
const MEM_GROUP_EXPIRY: u8 = 21;

/// Stable memory is handed to the maps in 1 MiB buckets (the library default
/// is 8 MiB per map, which would reserve over 100 MiB for 16 small maps).
const BUCKET_PAGES: u16 = 16;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), BUCKET_PAGES));

    pub static SETTINGS: RefCell<StableCell<Settings, Mem>> =
        RefCell::new(StableCell::init(mem(MEM_SETTINGS), Settings::default()));
    /// account -> sign-in methods
    pub static LINKS: RefCell<StableBTreeMap<AccountId, Links, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_LINKS)));
    /// "<kind>:<id>" -> account
    pub static LINK_INDEX: RefCell<StableBTreeMap<String, AccountId, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_LINK_INDEX)));
    /// credential id (base64url) -> passkey
    pub static PASSKEYS: RefCell<StableBTreeMap<String, Passkey, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_PASSKEYS)));
    /// account principal -> account (never accepted as an II principal)
    pub static PRINCIPALS: RefCell<StableBTreeMap<Principal, AccountId, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_PRINCIPALS)));
    /// account -> account principal
    pub static ACCOUNTS: RefCell<StableBTreeMap<AccountId, Principal, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_ACCOUNTS)));
    /// Devices, key packages and queued entries of the accounts that live here.
    pub static INBOX: RefCell<Inbox<Mem>> = RefCell::new(Inbox::init(open_social_inbox_core::Memories {
        devices: mem(MEM_DEVICES),
        mail: mem(MEM_MAIL),
        mail_count: mem(MEM_MAIL_COUNT),
        expiry: mem(MEM_EXPIRY),
        offers: mem(MEM_OFFERS),
        last_resort: mem(MEM_LAST_RESORT),
        single_use: mem(MEM_SINGLE_USE),
    }));
    pub static TICKET_KEYS: RefCell<StableCell<TicketKeys, Mem>> =
        RefCell::new(StableCell::init(mem(MEM_TICKET_KEYS), TicketKeys::default()));
    /// account -> its inbox shard (absent: this canister)
    pub static HOMES: RefCell<StableBTreeMap<AccountId, Principal, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_HOMES)));
    pub static SHARDING: RefCell<StableCell<Sharding, Mem>> =
        RefCell::new(StableCell::init(mem(MEM_SHARDING), Sharding::default()));
    /// Streams of the group chats whose home is this shard.
    pub static GROUPS: RefCell<open_social_inbox_core::groups::Groups<Mem>> =
        RefCell::new(open_social_inbox_core::groups::Groups::init(open_social_inbox_core::groups::GroupMemories {
            meta: mem(MEM_GROUP_META),
            members: mem(MEM_GROUP_MEMBERS),
            entries: mem(MEM_GROUP_ENTRIES),
            blobs: mem(MEM_GROUP_BLOBS),
            chunks: mem(MEM_GROUP_CHUNKS),
            expiry: mem(MEM_GROUP_EXPIRY),
        }));

    pub static SIGS: RefCell<SignatureMap> = RefCell::new(SignatureMap::default());
    /// challenge id -> challenge
    pub static CHALLENGES: RefCell<BTreeMap<String, Challenge>> = RefCell::new(BTreeMap::new());
    /// email hash -> recent send times (ns), for rate limiting
    pub static EMAIL_SENDS: RefCell<BTreeMap<String, Vec<u64>>> = RefCell::new(BTreeMap::new());
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

pub fn settings() -> Settings {
    SETTINGS.with(|s| s.borrow().get().clone())
}

pub fn update_settings<R>(f: impl FnOnce(&mut Settings) -> R) -> R {
    SETTINGS.with(|cell| {
        let mut cell = cell.borrow_mut();
        let mut s = cell.get().clone();
        let out = f(&mut s);
        cell.set(s);
        out
    })
}

/* ----------------------------------------------------------- challenges --- */

#[derive(Clone, Debug)]
pub struct Challenge {
    pub kind: ChallengeKind,
    pub expires_at_ns: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ChallengeKind {
    /// WebAuthn challenge bytes, for registering or using a passkey.
    Passkey { challenge: Vec<u8> },
    /// One-time code sent by email. Only hashes are kept.
    Email { email_hash: String, label: String, code_hash: Vec<u8>, attempts: u8 },
}

pub const MAX_CHALLENGES: usize = 10_000;
pub const CHALLENGE_TTL_NS: u64 = 5 * 60 * 1_000_000_000;

pub fn prune_challenges(now: u64) {
    CHALLENGES.with(|c| c.borrow_mut().retain(|_, ch| ch.expires_at_ns > now));
}

/* ------------------------------------------------------------- accounts --- */

pub fn account_of(p: &Principal) -> Option<AccountId> {
    PRINCIPALS.with(|m| m.borrow().get(p))
}

pub fn links_of(account: AccountId) -> Vec<Link> {
    LINKS.with(|m| m.borrow().get(&account)).map(|l| l.0).unwrap_or_default()
}

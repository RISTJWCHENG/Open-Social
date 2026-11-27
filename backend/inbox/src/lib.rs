//! OpenSocial inbox shard (`open-social-app-inbox-NNN`): the home of up to
//! `capacity` accounts (100,000 by default). It keeps their devices' public
//! keys, MLS key packages and queues of end-to-end encrypted entries; it only
//! ever sees ciphertext.
//!
//! The methods have the same names and arguments as the identity canister's
//! inbox ("shard 000"), so clients use one interface for both. Senders whose
//! account lives elsewhere pass a send ticket from the identity canister,
//! checked here without an inter-canister call. Accounts are added by the
//! orchestrator. See docs/INBOX_SHARDING.md.

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{msg_caller, stable_size, time};
use ic_cdk::{init, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use serde_bytes::ByteBuf;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeMap;
use open_social_inbox_core::groups::{CommitArgs, Entry as GroupEntry, GroupMemories, Groups, Head, PostError, Role};
use open_social_inbox_core::ticket::{self, Ticket, TicketKey};
use open_social_inbox_core::{AccountExport, AccountId, BatchResult, Device, Inbox, Memories};

type Mem = VirtualMemory<DefaultMemoryImpl>;
type R<T> = Result<T, String>;

/// Accounts a shard takes by default.
pub const DEFAULT_CAPACITY: u64 = 100_000;
/// Inbox entries (and key-package claims) one sender may make per minute here.
const CALLS_PER_MINUTE: u32 = 300;

/* ---------------------------------------------------------------- state --- */

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    pub identity: Principal,
    pub orchestrator: Principal,
    pub shard_number: u32,
    pub capacity: u64,
    /// Whether new accounts may be added.
    pub open: bool,
    pub ticket_keys: Vec<TicketKey>,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Counters {
    pub last_account: AccountId,
    pub last_mail_id: u64,
    pub accounts: u64,
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
candid_storable!(Config, Counters);

// Memory ids are permanent. Never reuse or renumber them.
const MEM_CONFIG: u8 = 0;
const MEM_COUNTERS: u8 = 1;
const MEM_ACCOUNTS: u8 = 2;
const MEM_PRINCIPALS: u8 = 3;
const MEM_DEVICES: u8 = 4;
const MEM_MAIL: u8 = 5;
const MEM_MAIL_COUNT: u8 = 6;
const MEM_EXPIRY: u8 = 7;
const MEM_OFFERS: u8 = 8;
const MEM_LAST_RESORT: u8 = 9;
const MEM_SINGLE_USE: u8 = 10;
const MEM_MOVING: u8 = 11;
const MEM_GROUP_META: u8 = 12;
const MEM_GROUP_MEMBERS: u8 = 13;
const MEM_GROUP_ENTRIES: u8 = 14;
const MEM_GROUP_BLOBS: u8 = 15;
const MEM_GROUP_CHUNKS: u8 = 16;
const MEM_GROUP_EXPIRY: u8 = 17;
const BUCKET_PAGES: u16 = 16;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), BUCKET_PAGES));
    static CONFIG: RefCell<StableCell<Option<Config>, Mem>> = RefCell::new(StableCell::init(mem(MEM_CONFIG), None));
    static COUNTERS: RefCell<StableCell<Counters, Mem>> =
        RefCell::new(StableCell::init(mem(MEM_COUNTERS), Counters::default()));
    /// account principal -> account number here
    static ACCOUNTS: RefCell<StableBTreeMap<Principal, AccountId, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_ACCOUNTS)));
    /// account number -> account principal
    static PRINCIPALS: RefCell<StableBTreeMap<AccountId, Principal, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_PRINCIPALS)));
    static INBOX: RefCell<Inbox<Mem>> = RefCell::new(Inbox::init(Memories {
        devices: mem(MEM_DEVICES),
        mail: mem(MEM_MAIL),
        mail_count: mem(MEM_MAIL_COUNT),
        expiry: mem(MEM_EXPIRY),
        offers: mem(MEM_OFFERS),
        last_resort: mem(MEM_LAST_RESORT),
        single_use: mem(MEM_SINGLE_USE),
    }));
    /// Accounts being moved to another shard: new entries are refused until the move ends.
    static MOVING: RefCell<StableBTreeMap<Principal, (), Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_MOVING)));
    /// Streams of the group chats whose home is this shard.
    static GROUPS: RefCell<Groups<Mem>> = RefCell::new(Groups::init(GroupMemories {
        meta: mem(MEM_GROUP_META),
        members: mem(MEM_GROUP_MEMBERS),
        entries: mem(MEM_GROUP_ENTRIES),
        blobs: mem(MEM_GROUP_BLOBS),
        chunks: mem(MEM_GROUP_CHUNKS),
        expiry: mem(MEM_GROUP_EXPIRY),
    }));
    /// sender -> (minute, calls in that minute); heap only
    static RATE: RefCell<BTreeMap<Principal, (u64, u32)>> = RefCell::new(BTreeMap::new());
    /// Calls since the last upgrade, for the orchestrator's dashboard; heap only.
    static USAGE: RefCell<Usage> = RefCell::new(Usage::default());
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone()).expect("initialised in init")
}

fn update_config(f: impl FnOnce(&mut Config)) {
    CONFIG.with(|c| {
        let mut c = c.borrow_mut();
        let mut v = c.get().clone().expect("initialised in init");
        f(&mut v);
        c.set(Some(v));
    });
}

fn update_counters<T>(f: impl FnOnce(&mut Counters) -> T) -> T {
    COUNTERS.with(|c| {
        let mut c = c.borrow_mut();
        let mut v = c.get().clone();
        let out = f(&mut v);
        c.set(v);
        out
    })
}

/// Entry ids increase and are at least the current time (ns), so ids of
/// entries moved in from another shard (or from the identity canister, which
/// counts from 1) are above every id the device read before the move, and its
/// read cursor stays valid.
fn next_mail_id() -> u64 {
    update_counters(|c| {
        c.last_mail_id = (c.last_mail_id + 1).max(time());
        c.last_mail_id
    })
}

fn local(p: &Principal) -> Option<AccountId> {
    ACCOUNTS.with(|m| m.borrow().get(p))
}

fn me() -> R<AccountId> {
    local(&msg_caller()).ok_or_else(|| "NotHere: this account's inbox is in another shard".to_string())
}

/// The recipient's number here, or an error that tells the client to look its home up again.
fn recipient(p: &Principal) -> R<AccountId> {
    if MOVING.with(|m| m.borrow().contains_key(p)) {
        return Err(format!("Moved: {p}'s inbox is moving; look it up again and retry"));
    }
    local(p).ok_or_else(|| format!("NotHere: {p} has no inbox in this shard"))
}

/// Accounts of this shard may always send; others need a valid ticket.
fn check_sender(t: Option<&Ticket>) -> R<()> {
    let caller = msg_caller();
    if local(&caller).is_some() {
        return Ok(());
    }
    let t = t.ok_or("TicketRequired: get a send ticket from the identity canister")?;
    ticket::verify(&config().ticket_keys, t, &caller, time())
}

fn rate_limit(caller: Principal, n: u32) -> R<()> {
    let minute = time() / 60_000_000_000;
    RATE.with(|r| {
        let mut r = r.borrow_mut();
        r.retain(|_, (m, _)| *m == minute);
        let e = r.entry(caller).or_insert((minute, 0));
        if e.1 + n > CALLS_PER_MINUTE {
            return Err("Sending too fast. Wait a moment.".to_string());
        }
        e.1 += n;
        Ok(())
    })
}

fn require_orchestrator() -> R<()> {
    let c = msg_caller();
    if c == config().orchestrator || ic_cdk::api::is_controller(&c) {
        Ok(())
    } else {
        Err("Only the orchestrator can do this".into())
    }
}

#[derive(Default, Clone, CandidType, Deserialize, Debug)]
pub struct Usage {
    pub deposits: u64,
    pub entries: u64,
    pub acks: u64,
    pub claims: u64,
    pub since_ns: u64,
}

fn count(f: impl FnOnce(&mut Usage)) {
    USAGE.with(|u| f(&mut u.borrow_mut()));
}

/* ----------------------------------------------------------- lifecycle --- */

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub identity: Principal,
    pub orchestrator: Principal,
    pub shard_number: u32,
    pub capacity: Option<u64>,
}

#[init]
fn init(args: InitArgs) {
    CONFIG.with(|c| {
        c.borrow_mut().set(Some(Config {
            identity: args.identity,
            orchestrator: args.orchestrator,
            shard_number: args.shard_number,
            capacity: args.capacity.unwrap_or(DEFAULT_CAPACITY),
            open: true,
            ticket_keys: vec![],
        }))
    });
    count(|u| u.since_ns = time());
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    count(|u| u.since_ns = time());
}

/* ------------------------------------------------------------ wire types --- */

#[derive(CandidType, Deserialize)]
pub struct DeviceInput {
    pub device_id: String,
    pub encryption_key: ByteBuf,
    pub signing_key: ByteBuf,
    pub label: String,
}

#[derive(CandidType, Deserialize)]
pub struct PublicDevice {
    pub device_id: String,
    pub encryption_key: ByteBuf,
    pub signing_key: ByteBuf,
    pub label: String,
    pub added_at_ns: u64,
}

#[derive(CandidType, Deserialize)]
pub struct Mail {
    pub id: u64,
    pub from: Principal,
    pub received_at_ns: u64,
    pub entry: ByteBuf,
}

#[derive(CandidType, Deserialize)]
pub struct ClaimedKeyPackage {
    pub last_resort: ByteBuf,
    pub single_use: Option<ByteBuf>,
}

#[derive(CandidType, Deserialize)]
pub struct DepositItem {
    pub to: Principal,
    pub device_id: String,
    pub entry: ByteBuf,
    /// Direct-link offer: capped per sender and dropped after 10 minutes.
    pub ephemeral: bool,
}

/* ------------------------------------------------------ devices and keys --- */

#[update]
fn register_device(input: DeviceInput) -> R<()> {
    let account = me()?;
    let device = Device {
        device_id: input.device_id,
        encryption_key: input.encryption_key.into_vec(),
        signing_key: input.signing_key.into_vec(),
        label: input.label,
        added_at_ns: time(),
    };
    INBOX.with(|i| i.borrow_mut().register_device(account, device))
}

#[update]
fn remove_device(device_id: String) -> R<()> {
    let account = me()?;
    INBOX.with(|i| i.borrow_mut().remove_device(account, &device_id))
}

#[update]
fn publish_key_packages(device_id: String, last_resort: Option<ByteBuf>, single_use: Vec<ByteBuf>) -> R<u32> {
    let account = me()?;
    INBOX.with(|i| {
        i.borrow_mut().publish_key_packages(
            account,
            &device_id,
            last_resort.map(|b| b.into_vec()),
            single_use.into_iter().map(|b| b.into_vec()).collect(),
        )
    })
}

/// Public device keys of an account whose home is this shard (empty otherwise).
#[query]
fn get_devices(account: Principal) -> Vec<PublicDevice> {
    let Some(a) = local(&account) else {
        return vec![];
    };
    INBOX
        .with(|i| i.borrow().devices_of(a))
        .into_iter()
        .map(|d| PublicDevice {
            device_id: d.device_id,
            encryption_key: ByteBuf::from(d.encryption_key),
            signing_key: ByteBuf::from(d.signing_key),
            label: d.label,
            added_at_ns: d.added_at_ns,
        })
        .collect()
}

#[update]
fn claim_key_package(account: Principal, device_id: String, ticket: Option<Ticket>) -> R<Option<ClaimedKeyPackage>> {
    check_sender(ticket.as_ref())?;
    let to = recipient(&account)?;
    rate_limit(msg_caller(), 1)?;
    count(|u| u.claims += 1);
    Ok(INBOX
        .with(|i| i.borrow_mut().claim_key_package(to, &device_id))
        .map(|(b, o)| ClaimedKeyPackage { last_resort: ByteBuf::from(b), single_use: o.map(ByteBuf::from) }))
}

/* --------------------------------------------------------------- inbox --- */

#[update]
fn deposit(to: Principal, device_id: String, entry: ByteBuf, ticket: Option<Ticket>) -> R<u64> {
    check_sender(ticket.as_ref())?;
    let to = recipient(&to)?;
    let caller = msg_caller();
    rate_limit(caller, 1)?;
    count(|u| {
        u.deposits += 1;
        u.entries += 1
    });
    INBOX.with(|i| {
        i.borrow_mut().deposit_item(&mut next_mail_id, caller, to, &device_id, entry.into_vec(), time(), false)
    })
}

/// Queues several entries in one call (all or nothing, in order). Every
/// recipient must live in this shard.
#[update]
fn deposit_batch(items: Vec<DepositItem>, ticket: Option<Ticket>) -> R<BatchResult> {
    check_sender(ticket.as_ref())?;
    let caller = msg_caller();
    rate_limit(caller, items.len() as u32)?;
    let mut resolved = Vec::with_capacity(items.len());
    for i in items {
        resolved.push((recipient(&i.to)?, i.device_id, i.entry.into_vec(), i.ephemeral));
    }
    let n = resolved.len() as u64;
    count(|u| {
        u.deposits += 1;
        u.entries += n
    });
    INBOX.with(|i| i.borrow_mut().deposit_batch(&mut next_mail_id, caller, resolved, time()))
}

#[query]
fn fetch_mail(device_id: String, after: u64) -> R<Vec<Mail>> {
    let account = me()?;
    Ok(INBOX
        .with(|i| i.borrow().fetch(account, &device_id, after, time()))
        .into_iter()
        .map(|m| Mail { id: m.id, from: m.from, received_at_ns: m.received_at_ns, entry: ByteBuf::from(m.entry) })
        .collect())
}

#[update]
fn ack_mail(device_id: String, up_to: u64) -> R<u32> {
    let account = me()?;
    count(|u| u.acks += 1);
    Ok(INBOX.with(|i| i.borrow_mut().ack(account, &device_id, up_to, time())) as u32)
}

/// Deletes the caller's devices, key packages and queued entries here (the
/// client also deletes its account in the identity canister).
#[update]
fn delete_account() -> R<()> {
    let caller = msg_caller();
    let account = me()?;
    remove_local(&caller, account);
    Ok(())
}

fn remove_local(p: &Principal, account: AccountId) {
    INBOX.with(|i| i.borrow_mut().delete_account(account));
    ACCOUNTS.with(|m| m.borrow_mut().remove(p));
    PRINCIPALS.with(|m| m.borrow_mut().remove(&account));
    update_counters(|c| c.accounts = c.accounts.saturating_sub(1));
}

/* -------------------------------------------------------- orchestrator --- */

fn add_account(p: Principal) -> R<AccountId> {
    if let Some(a) = local(&p) {
        return Ok(a);
    }
    let cfg = config();
    let accounts = COUNTERS.with(|c| c.borrow().get().accounts);
    if !cfg.open || accounts >= cfg.capacity {
        return Err("CanisterFull".into());
    }
    let a = update_counters(|c| {
        c.last_account += 1;
        c.accounts += 1;
        c.last_account
    });
    ACCOUNTS.with(|m| m.borrow_mut().insert(p, a));
    PRINCIPALS.with(|m| m.borrow_mut().insert(a, p));
    Ok(a)
}

/// Makes this shard the home of a new account.
#[update]
fn adopt_account(account: Principal) -> R<()> {
    require_orchestrator()?;
    add_account(account).map(|_| ())
}

#[update]
fn set_ticket_keys(keys: Vec<TicketKey>) -> R<()> {
    require_orchestrator()?;
    update_config(|c| c.ticket_keys = keys);
    Ok(())
}

/// Opens or closes the shard to new accounts.
#[update]
fn set_open(open: bool) -> R<()> {
    require_orchestrator()?;
    update_config(|c| c.open = open);
    Ok(())
}

/// An account's data, to move it to another shard. From now until
/// `drop_account` or `cancel_move`, new entries for it are refused ("Moved").
#[update]
fn export_account(account: Principal) -> R<AccountExport> {
    require_orchestrator()?;
    let a = local(&account).ok_or("Unknown account")?;
    MOVING.with(|m| m.borrow_mut().insert(account, ()));
    Ok(INBOX.with(|i| i.borrow().export_account(a)))
}

/// Ends a failed move: the account takes entries here again.
#[update]
fn cancel_move(account: Principal) -> R<()> {
    require_orchestrator()?;
    MOVING.with(|m| m.borrow_mut().remove(&account));
    Ok(())
}

/// Takes in an account moved from another shard (or from the identity canister).
#[update]
fn import_account(account: Principal, data: AccountExport) -> R<()> {
    require_orchestrator()?;
    let a = add_account(account)?;
    INBOX.with(|i| i.borrow_mut().import_account(&mut next_mail_id, a, data));
    Ok(())
}

/// Removes an account after it moved to another shard.
#[update]
fn drop_account(account: Principal) -> R<()> {
    require_orchestrator()?;
    let a = local(&account).ok_or("Unknown account")?;
    remove_local(&account, a);
    MOVING.with(|m| m.borrow_mut().remove(&account));
    Ok(())
}

#[derive(CandidType, Deserialize, Debug)]
pub struct Stats {
    pub shard_number: u32,
    pub accounts: u64,
    pub capacity: u64,
    pub open: bool,
    pub queued_entries: u64,
    pub stable_memory_bytes: u64,
    pub cycles: u128,
    pub usage: Usage,
}

#[query]
fn stats() -> Stats {
    let cfg = config();
    Stats {
        shard_number: cfg.shard_number,
        accounts: COUNTERS.with(|c| c.borrow().get().accounts),
        capacity: cfg.capacity,
        open: cfg.open,
        queued_entries: INBOX.with(|i| i.borrow().queued_entries()),
        stable_memory_bytes: stable_size() * 65_536,
        cycles: ic_cdk::api::canister_cycle_balance(),
        usage: USAGE.with(|u| u.borrow().clone()),
    }
}

/* --------------------------------------------------------------- groups --- */

/// Key packages of many devices in one call (adding people to a group chat).
/// At most 200 devices; each must live in this shard.
#[update]
fn claim_key_packages(devices: Vec<(Principal, String)>, ticket: Option<Ticket>) -> R<Vec<Option<ClaimedKeyPackage>>> {
    if devices.len() > 200 {
        return Err("At most 200 devices per call".into());
    }
    check_sender(ticket.as_ref())?;
    rate_limit(msg_caller(), 1)?;
    let wanted: Vec<(AccountId, String)> =
        devices.into_iter().map(|(p, d)| recipient(&p).map(|a| (a, d))).collect::<R<_>>()?;
    count(|u| u.claims += wanted.len() as u64);
    Ok(INBOX
        .with(|i| i.borrow_mut().claim_key_packages(&wanted))
        .into_iter()
        .map(|c| c.map(|(b, o)| ClaimedKeyPackage { last_resort: ByteBuf::from(b), single_use: o.map(ByteBuf::from) }))
        .collect())
}

/// Starts a group chat's stream here, with the caller as its owner.
#[update]
fn group_create(group: String, ticket: Option<Ticket>) -> Result<(), PostError> {
    check_sender(ticket.as_ref()).map_err(PostError::NotAllowed)?;
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().create(&group, msg_caller(), time()))
}

/// An MLS application message for the group → its seq.
#[update]
fn group_post(group: String, device: String, epoch: u64, data: ByteBuf) -> Result<u64, PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().post(&group, msg_caller(), device, epoch, data.into_vec(), time()))
}

/// An MLS commit made in the current epoch, with the access-list change it brings → its seq.
#[update]
fn group_post_commit(args: CommitArgs) -> Result<u64, PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().post_commit(msg_caller(), args, time()))
}

#[update]
fn group_set_role(group: String, account: Principal, role: Role) -> Result<(), PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().set_role(&group, msg_caller(), account, role))
}

#[update]
fn group_leave(group: String, heir: Option<Principal>) -> Result<(), PostError> {
    GROUPS.with(|g| g.borrow_mut().leave(&group, msg_caller(), heir))
}

/// One chunk of an encrypted file or Welcome, stored once for the whole group.
#[update]
fn group_blob_put(
    group: String,
    blob: u64,
    index: u32,
    chunks: u32,
    size: u64,
    data: ByteBuf,
) -> Result<(), PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().blob_put(&group, msg_caller(), blob, index, chunks, size, data.into_vec(), time()))
}

#[query]
fn group_blob_get(group: String, blob: u64, index: u32) -> Result<ByteBuf, PostError> {
    GROUPS.with(|g| g.borrow().blob_get(&group, msg_caller(), blob, index)).map(ByteBuf::from)
}

/// Entries after `after`, oldest first (members only).
#[query]
fn group_read(group: String, after: u64) -> Result<Vec<GroupEntry>, PostError> {
    GROUPS.with(|g| g.borrow().read(&group, msg_caller(), after))
}

/// Latest seq and epoch of each listed group the caller is in.
#[query]
fn group_heads(groups: Vec<String>) -> Vec<Head> {
    GROUPS.with(|g| g.borrow().heads(&groups, msg_caller()))
}

fn rate_limit_group() -> Result<(), PostError> {
    rate_limit(msg_caller(), 1).map_err(PostError::NotAllowed)
}

ic_cdk::export_candid!();

#[cfg(test)]
mod candid_file {
    /// Writes the Candid interface (kept in the repo).
    #[test]
    fn write_did() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_inbox.did"), super::__export_service()).unwrap();
    }
}

//! OpenSocial space canister (`open-social-app-space`): public content people
//! publish. Two modules with their own stable memories, so either can move
//! to a canister of its own later:
//!
//! - `space`: each account's personal page (posts, links, works, videos,
//!   music, dapps), likes, reports and chunked media (ids 16..=26);
//! - `market`: classified listings with photos (ids 10..=14).
//!
//! Writers must be OpenSocial accounts: the identity canister confirms an
//! account once (`home_of`) and the answer is kept for a day.

mod kv;
mod market;
mod model;
mod search_sync;
mod space;

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{msg_caller, time};
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableCell, Storable};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeMap;

// Types named in the exported Candid interface.
use market::{Listing, ListingInput, ListingStatus, MarketPage, MarketQuery};
use space::{ItemInput, ItemKind, ItemPage, SpaceInput, SpaceItem, SpaceView};

type Mem = VirtualMemory<DefaultMemoryImpl>;
type R<T> = Result<T, String>;

// Memory ids are permanent. Never reuse or renumber them.
const MEM_CONFIG: u8 = 0;
// 1..=9 reserved; 10..=14 market module; 16..=26 space module.

/// Writes (publishing, editing, reporting) one account may make per minute.
const WRITES_PER_MINUTE: u32 = 30;
/// How long a confirmed account is trusted without asking again.
const ACCOUNT_TTL_NS: u64 = 24 * 3600 * 1_000_000_000;
const MAX_KNOWN: usize = 200_000;
/// Bytes per page when copying a module between canisters (replies are at most 2 MiB).
const MOVE_PAGE_BYTES: usize = 1_800_000;

#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct Config {
    pub identity_canister: Option<Principal>,
    pub admins: Vec<Principal>,
    /// OpenSocial search canister, told about public listings and items as they change.
    pub search_canister: Option<Principal>,
}

impl Storable for Config {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode config"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode config")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Config).expect("decode config")
    }
    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), 16));
    static CONFIG: RefCell<StableCell<Config, Mem>> = RefCell::new(StableCell::init(mem(MEM_CONFIG), Config::default()));
    /// account principal -> confirmed until (ns); heap only
    static KNOWN: RefCell<BTreeMap<Principal, u64>> = RefCell::new(BTreeMap::new());
    /// principal -> (minute, writes in that minute); heap only
    static RATE: RefCell<BTreeMap<Principal, (u64, u32)>> = RefCell::new(BTreeMap::new());
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

fn pkey(p: &Principal) -> Vec<u8> {
    p.as_slice().to_vec()
}

fn hash_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone())
}

fn search_canister() -> Option<Principal> {
    config().search_canister
}

fn is_admin(p: &Principal) -> bool {
    ic_cdk::api::is_controller(p) || config().admins.contains(p)
}

fn rate_limit(p: &Principal) -> R<()> {
    let minute = time() / 60_000_000_000;
    RATE.with(|r| {
        let mut r = r.borrow_mut();
        r.retain(|_, (m, _)| *m == minute);
        let e = r.entry(*p).or_insert((minute, 0));
        if e.1 >= WRITES_PER_MINUTE {
            return Err("Too many changes. Wait a minute.".to_string());
        }
        e.1 += 1;
        Ok(())
    })
}

/// Checks that the caller is an OpenSocial account (asking the identity canister at most once a day).
async fn require_account() -> R<Principal> {
    let caller = msg_caller();
    if caller == Principal::anonymous() {
        return Err("Sign in first".into());
    }
    let now = time();
    if KNOWN.with(|k| k.borrow().get(&caller).is_some_and(|until| *until > now)) {
        return Ok(caller);
    }
    let identity = config().identity_canister.ok_or("Not configured")?;
    let home: Option<Principal> = Call::bounded_wait(identity, "home_of")
        .with_arg(caller)
        .await
        .map_err(|e| format!("Could not check the account: {e:?}"))?
        .candid()
        .map_err(|e| format!("Could not check the account: {e:?}"))?;
    if home.is_none() {
        return Err("Sign in first".into());
    }
    KNOWN.with(|k| {
        let mut k = k.borrow_mut();
        if k.len() >= MAX_KNOWN {
            k.retain(|_, until| *until > now);
            if k.len() >= MAX_KNOWN {
                k.clear();
            }
        }
        k.insert(caller, now + ACCOUNT_TTL_NS);
    });
    Ok(caller)
}

/* ----------------------------------------------------------- lifecycle --- */

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub identity_canister: Principal,
}

fn set_identity(p: Principal) {
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        cfg.identity_canister = Some(p);
        c.borrow_mut().set(cfg);
    });
}

#[init]
fn init(args: InitArgs) {
    set_identity(args.identity_canister);
}

#[post_upgrade]
fn post_upgrade(args: InitArgs) {
    set_identity(args.identity_canister);
}

/* -------------------------------------------------------------- admin --- */

/// Controllers: adds a moderator (reviews reported listings and items).
#[update]
fn add_admin(p: Principal) -> R<()> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Only controllers can add administrators".into());
    }
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        if !cfg.admins.contains(&p) {
            cfg.admins.push(p);
        }
        c.borrow_mut().set(cfg);
    });
    Ok(())
}

/// Deletes everything the caller published here: listings with their photos,
/// and their space with its items and files (when they delete their account).
#[update]
fn delete_my_data() -> R<()> {
    let me = msg_caller();
    if me == Principal::anonymous() {
        return Err("Sign in first".into());
    }
    market::remove_all_listings(&me);
    space::remove_all_space(&me);
    Ok(())
}

/* ------------------------------------------------------------ search --- */

/// Controllers: sets the search canister that is told about public content.
#[update]
fn set_search_canister(search: Option<Principal>) -> R<()> {
    require_controller()?;
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        cfg.search_canister = search;
        c.borrow_mut().set(cfg);
    });
    Ok(())
}

/// Public listings ("listing") or space items ("space") for the search
/// canister's `reindex`, 200 at a time, by id after `cursor`.
#[query]
fn search_docs(kind: String, cursor: Option<String>) -> R<search_sync::DocPage> {
    let c = msg_caller();
    if !ic_cdk::api::is_controller(&c) && search_canister() != Some(c) {
        return Err("Only the search canister can read this".into());
    }
    let cursor = cursor.map(|c| c.parse::<u64>().map_err(|_| "Bad cursor".to_string())).transpose()?;
    Ok(match kind.as_str() {
        "listing" => market::search_docs(cursor),
        "space" => space::search_docs(cursor),
        _ => search_sync::DocPage::default(),
    })
}

/* ------------------------------------------------------------ moving --- */

fn require_controller() -> R<()> {
    if ic_cdk::api::is_controller(&msg_caller()) {
        Ok(())
    } else {
        Err("Only controllers can do this".into())
    }
}

#[derive(CandidType, Deserialize, Debug)]
pub struct PullResult {
    /// Where to continue (the last key copied), unless done.
    pub next: Option<ByteBuf>,
    pub done: bool,
    pub copied: u64,
}

/// Controllers: copies up to `pages` pages of one map of a module ("market"
/// or "space") from another canister running the same module. Repeat with
/// `next` until done; copying again is safe (entries are overwritten).
#[update]
async fn move_pull(source: Principal, module: String, map: u8, start: Option<ByteBuf>, pages: u32) -> R<PullResult> {
    require_controller()?;
    let mut start = start.map(|b| b.into_vec());
    let mut copied = 0u64;
    for _ in 0..pages.max(1) {
        let page: R<kv::Page> = Call::unbounded_wait(source, "move_dump")
            .with_args(&(module.clone(), map, start.clone().map(ByteBuf::from)))
            .await
            .map_err(|e| format!("move_dump failed: {e:?}"))?
            .candid()
            .map_err(|e| format!("move_dump reply: {e:?}"))?;
        let page = page?;
        let last = page.entries.last().map(|(k, _)| k.to_vec());
        copied += page.entries.len() as u64;
        let done = page.done;
        match module.as_str() {
            "market" => market::move_load(map, page.entries)?,
            "space" => space::move_load(map, page.entries)?,
            _ => return Err("No such module".into()),
        }
        if done {
            return Ok(PullResult { next: None, done: true, copied });
        }
        start = last;
    }
    Ok(PullResult { next: start.map(ByteBuf::from), done: false, copied })
}

/// Controllers: copies a module's counters from another canister.
#[update]
async fn move_pull_cells(source: Principal, module: String) -> R<Vec<u64>> {
    require_controller()?;
    let cells: R<Vec<u64>> = Call::unbounded_wait(source, "move_cells")
        .with_arg(module.clone())
        .await
        .map_err(|e| format!("move_cells failed: {e:?}"))?
        .candid()
        .map_err(|e| format!("move_cells reply: {e:?}"))?;
    let cells = cells?;
    match module.as_str() {
        "market" => market::move_set_cells(cells.clone()),
        "space" => space::move_set_cells(cells.clone()),
        _ => return Err("No such module".into()),
    }
    Ok(cells)
}

/// One page of a module's map, for another canister taking the module over.
#[query]
fn move_dump(module: String, map: u8, start: Option<ByteBuf>) -> R<kv::Page> {
    require_controller()?;
    let start = start.map(|b| b.into_vec());
    match module.as_str() {
        "market" => market::move_dump(map, start, MOVE_PAGE_BYTES),
        "space" => space::move_dump(map, start, MOVE_PAGE_BYTES),
        _ => Err("No such module".into()),
    }
}

/// Entries per map of a module (to check a copy).
#[query]
fn move_counts(module: String) -> R<Vec<u64>> {
    match module.as_str() {
        "market" => Ok(market::move_counts()),
        "space" => Ok(space::move_counts()),
        _ => Err("No such module".into()),
    }
}

#[query]
fn move_cells(module: String) -> R<Vec<u64>> {
    require_controller()?;
    match module.as_str() {
        "market" => Ok(market::move_cells()),
        "space" => Ok(space::move_cells()),
        _ => Err("No such module".into()),
    }
}

ic_cdk::export_candid!();

#[cfg(test)]
mod candid_file {
    /// Writes the Candid interface (kept in the repo).
    #[test]
    fn write_did() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_space.did"), super::__export_service()).unwrap();
    }
}

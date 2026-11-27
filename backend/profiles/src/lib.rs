//! OpenSocial profiles canister: avatars and profile data only.
//! See docs/PROFILES_CANISTER.md for the design.

mod model;
mod search_sync;

use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::{msg_caller, time};
use ic_cdk::{init, post_upgrade, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell};
use model::*;
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::BTreeMap;

type Mem = VirtualMemory<DefaultMemoryImpl>;
type R<T> = Result<T, String>;

// Memory ids are permanent. Never reuse or renumber them.
const MEM_PROFILES: u8 = 0;
const MEM_AVATARS: u8 = 1;
const MEM_SEALED: u8 = 2;
const MEM_USERNAMES: u8 = 3;
const MEM_TOKENS: u8 = 4;
const MEM_REPORTS: u8 = 5;
const MEM_CONFIG: u8 = 6;
const MEM_ACCOUNTS: u8 = 7;
// 8..=9 reserved. 10..=14 and 16..=26 held the market and space modules,
// which moved to open-social-app-space; never reuse these ids.

/// Avatar kinds stored under (principal, kind). Only the public avatar for now.
const AVATAR_PUBLIC: u8 = 1;

/// Stable memory is handed to the maps in 1 MiB buckets (the library default
/// is 8 MiB per map, which would reserve 64 MiB for 8 small maps).
const BUCKET_PAGES: u16 = 16;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), BUCKET_PAGES));
    static PROFILES: RefCell<StableBTreeMap<Vec<u8>, ProfileRecord, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_PROFILES)));
    static AVATARS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_AVATARS)));
    static SEALED: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_SEALED)));
    static USERNAMES: RefCell<StableBTreeMap<String, Vec<u8>, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_USERNAMES)));
    static TOKENS: RefCell<StableBTreeMap<Vec<u8>, (), Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_TOKENS)));
    static REPORTS: RefCell<StableBTreeMap<Vec<u8>, Report, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_REPORTS)));
    static CONFIG: RefCell<StableCell<Config, Mem>> =
        RefCell::new(StableCell::init(mem(MEM_CONFIG), Config::default()));
    static ACCOUNTS: RefCell<StableBTreeMap<Vec<u8>, u64, Mem>> =
        RefCell::new(StableBTreeMap::init(mem(MEM_ACCOUNTS)));
    /// Heap only: principal -> (minute, writes).
    static RATE: RefCell<BTreeMap<Vec<u8>, (u64, u32)>> = RefCell::new(BTreeMap::new());
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

fn pkey(p: &Principal) -> Vec<u8> {
    p.as_slice().to_vec()
}

fn avatar_key(p: &Principal, kind: u8) -> Vec<u8> {
    let mut k = pkey(p);
    k.push(kind);
    k
}

/// Token index key: token bytes, 0x00, principal bytes (tokens never contain 0x00).
fn token_key(token: &str, p: &Principal) -> Vec<u8> {
    let mut k = token.as_bytes().to_vec();
    k.push(0);
    k.extend_from_slice(p.as_slice());
    k
}

fn report_key(target: &Principal, by: &Principal) -> Vec<u8> {
    let mut k = vec![target.as_slice().len() as u8];
    k.extend_from_slice(target.as_slice());
    k.extend_from_slice(by.as_slice());
    k
}

fn hash_hex(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone())
}

fn is_admin(p: &Principal) -> bool {
    ic_cdk::api::is_controller(p) || config().admins.contains(p)
}

/* ---------------------------------------------------------- lifecycle --- */

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub identity_canister: Principal,
}

#[init]
fn init(args: InitArgs) {
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        cfg.identity_canister = Some(args.identity_canister);
        c.borrow_mut().set(cfg);
    });
}

#[post_upgrade]
fn post_upgrade(args: Option<InitArgs>) {
    // Stable structures need no restore step. Optionally update the identity canister.
    if let Some(a) = args {
        init(a);
    }
}

/* ------------------------------------------------------ authorization --- */

/// The caller must be an OpenSocial account: checked once with the identity
/// canister (an account with at least one registered device), then cached.
async fn require_account() -> R<Principal> {
    let caller = msg_caller();
    if caller == Principal::anonymous() {
        return Err("Sign in first".into());
    }
    if ACCOUNTS.with(|a| a.borrow().contains_key(&pkey(&caller))) {
        return Ok(caller);
    }
    let identity = config().identity_canister.ok_or("Not configured")?;
    #[derive(CandidType, Deserialize)]
    struct Device {
        device_id: String,
    }
    let res = ic_cdk::call::Call::bounded_wait(identity, "get_devices")
        .with_arg(caller)
        .await
        .map_err(|e| format!("Identity check failed: {e:?}"))?;
    let devices: Vec<Device> = res.candid().map_err(|e| format!("Identity check failed: {e:?}"))?;
    if devices.iter().all(|d| d.device_id.is_empty()) {
        return Err("Not an OpenSocial account".into());
    }
    ACCOUNTS.with(|a| a.borrow_mut().insert(pkey(&caller), time()));
    Ok(caller)
}

fn rate_limit(p: &Principal) -> R<()> {
    let limit = config().writes_per_minute;
    let minute = time() / 60_000_000_000;
    RATE.with(|r| {
        let mut r = r.borrow_mut();
        r.retain(|_, (m, _)| *m == minute);
        let e = r.entry(pkey(p)).or_insert((minute, 0));
        if e.1 >= limit {
            return Err("Too many changes. Wait a minute.".to_string());
        }
        e.1 += 1;
        Ok(())
    })
}

/* -------------------------------------------------------- internals --- */

fn load(p: &Principal) -> Option<ProfileRecord> {
    PROFILES.with(|m| m.borrow().get(&pkey(p)))
}

fn save(p: &Principal, mut r: ProfileRecord) {
    r.updated_at_ns = time();
    search_sync::sync(config().search_canister, "profile", p.to_text(), search_doc(p, &r));
    if r.is_empty() {
        PROFILES.with(|m| m.borrow_mut().remove(&pkey(p)));
    } else {
        PROFILES.with(|m| m.borrow_mut().insert(pkey(p), r));
    }
}

/// A profile as the search canister indexes it (public profiles only).
fn search_doc(p: &Principal, r: &ProfileRecord) -> Option<search_sync::Doc> {
    if r.visibility != Visibility::Public {
        return None;
    }
    let username = r.username.clone().unwrap_or_default();
    Some(search_sync::Doc {
        kind: "profile".into(),
        id: p.to_text(),
        owner: *p,
        title: r.display_name.clone().unwrap_or_else(|| username.clone()),
        text: format!("@{username}\n{}", r.bio.clone().unwrap_or_default()),
        tags: vec![username],
        updated_at_ns: r.updated_at_ns,
    })
}

/// Public profiles for the search canister's `reindex`, by principal, after `cursor`.
#[query]
fn search_docs(kind: String, cursor: Option<String>) -> R<search_sync::DocPage> {
    let c = msg_caller();
    if !ic_cdk::api::is_controller(&c) && config().search_canister != Some(c) {
        return Err("Only the search canister can read this".into());
    }
    if kind != "profile" {
        return Ok(search_sync::DocPage::default());
    }
    let start = match cursor {
        Some(t) => pkey(&Principal::from_text(&t).map_err(|_| "Bad cursor")?),
        None => vec![],
    };
    // One entry more than a page tells whether another page follows.
    let entries: Vec<(Vec<u8>, ProfileRecord)> = PROFILES.with(|m| {
        m.borrow()
            .range(start.clone()..)
            .filter(|e| *e.key() != start)
            .take(201)
            .map(|e| (e.key().clone(), e.value()))
            .collect()
    });
    let more = entries.len() > 200;
    let mut page = search_sync::DocPage::default();
    let mut last = None;
    for (k, r) in entries.into_iter().take(200) {
        let Ok(p) = Principal::try_from_slice(&k) else { continue };
        last = Some(p);
        page.docs.extend(search_doc(&p, &r));
    }
    page.next = if more { last.map(|p| p.to_text()) } else { None };
    Ok(page)
}

/// Controllers: sets the search canister that is told about public profiles.
#[update]
fn set_search_canister(search: Option<Principal>) -> R<()> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Controllers only".into());
    }
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        cfg.search_canister = search;
        c.borrow_mut().set(cfg);
    });
    Ok(())
}

fn unindex(p: &Principal, r: &ProfileRecord) {
    for t in search_tokens(r.username.as_deref(), r.display_name.as_deref()) {
        TOKENS.with(|m| m.borrow_mut().remove(&token_key(&t, p)));
    }
    if let Some(u) = &r.username {
        let key = username_key(u);
        USERNAMES.with(|m| {
            let mut m = m.borrow_mut();
            if m.get(&key).as_deref() == Some(p.as_slice()) {
                m.remove(&key);
            }
        });
    }
}

fn index(p: &Principal, r: &ProfileRecord) {
    if r.visibility != Visibility::Public {
        return;
    }
    for t in search_tokens(r.username.as_deref(), r.display_name.as_deref()) {
        TOKENS.with(|m| m.borrow_mut().insert(token_key(&t, p), ()));
    }
    if let Some(u) = &r.username {
        USERNAMES.with(|m| m.borrow_mut().insert(username_key(u), pkey(p)));
    }
}

/* ------------------------------------------------------- public layer --- */

#[derive(CandidType, Deserialize)]
pub enum AvatarChange {
    Keep,
    Remove,
    Set(ByteBuf),
}

#[derive(CandidType, Deserialize)]
pub struct PublicProfileInput {
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub links: Vec<ProfileLink>,
    pub avatar: AvatarChange,
}

/// Publishes or updates the caller's public profile (searchable, readable by anyone).
#[update]
async fn set_public_profile(input: PublicProfileInput) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let username = normalize_username(&input.username);
    if let Some(problem) = username_problem(&username) {
        return Err(problem.into());
    }
    let username_id = username_key(&username);
    let display_name = clean_text(&input.display_name, MAX_DISPLAY_NAME)?;
    if display_name.is_empty() {
        return Err("Add a display name".into());
    }
    let bio = clean_text(&input.bio, MAX_BIO)?;
    let links = clean_links(input.links)?;
    if let Some(owner) = USERNAMES.with(|m| m.borrow().get(&username_id)) {
        if owner != pkey(&me) {
            return Err("That username is taken".into());
        }
    }
    let now = time();
    let mut r = load(&me).unwrap_or_else(|| ProfileRecord::new(now));
    unindex(&me, &r);
    match input.avatar {
        AvatarChange::Keep => {}
        AvatarChange::Remove => {
            AVATARS.with(|m| m.borrow_mut().remove(&avatar_key(&me, AVATAR_PUBLIC)));
            r.avatar = None;
        }
        AvatarChange::Set(img) => {
            let img = img.into_vec();
            if img.len() > MAX_PUBLIC_AVATAR {
                return Err("Photo is too large (max 64 KB)".into());
            }
            let mime = image_mime(&img).ok_or("Photo must be WebP, JPEG or PNG")?;
            r.avatar = Some(AvatarMeta {
                hash: hash_hex(&img),
                mime: mime.into(),
                size: img.len() as u32,
                updated_at_ns: now,
            });
            AVATARS.with(|m| m.borrow_mut().insert(avatar_key(&me, AVATAR_PUBLIC), img));
        }
    }
    r.visibility = Visibility::Public;
    r.username = Some(username);
    r.display_name = Some(display_name);
    r.bio = Some(bio);
    r.links = links;
    index(&me, &r);
    save(&me, r);
    Ok(())
}

/// Back to friends only: removes the public layer (fields, avatar, username, search entries).
#[update]
async fn clear_public_profile() -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let Some(mut r) = load(&me) else { return Ok(()) };
    unindex(&me, &r);
    AVATARS.with(|m| m.borrow_mut().remove(&avatar_key(&me, AVATAR_PUBLIC)));
    r.visibility = Visibility::Friends;
    r.username = None;
    r.display_name = None;
    r.bio = None;
    r.links = Vec::new();
    r.avatar = None;
    save(&me, r);
    Ok(())
}

#[derive(CandidType, Deserialize)]
pub struct PublicProfileView {
    pub account: Principal,
    pub username: String,
    pub display_name: String,
    pub bio: String,
    pub links: Vec<ProfileLink>,
    pub avatar: Option<AvatarMeta>,
    pub updated_at_ns: u64,
}

fn public_view(p: Principal, r: &ProfileRecord) -> Option<PublicProfileView> {
    (r.visibility == Visibility::Public).then(|| PublicProfileView {
        account: p,
        username: r.username.clone().unwrap_or_default(),
        display_name: r.display_name.clone().unwrap_or_default(),
        bio: r.bio.clone().unwrap_or_default(),
        links: r.links.clone(),
        avatar: r.avatar.clone(),
        updated_at_ns: r.updated_at_ns,
    })
}

#[query]
fn get_public_profile(account: Principal) -> Option<PublicProfileView> {
    load(&account).and_then(|r| public_view(account, &r))
}

/// Public avatar bytes (fetch separately so lists stay light; cache by `AvatarMeta.hash`).
#[query]
fn get_public_avatar(account: Principal) -> Option<ByteBuf> {
    let r = load(&account)?;
    if r.visibility != Visibility::Public {
        return None;
    }
    AVATARS.with(|m| m.borrow().get(&avatar_key(&account, AVATAR_PUBLIC))).map(ByteBuf::from)
}

/// Prefix search over usernames and display-name words of public profiles.
#[query]
fn search_profiles(q: String) -> R<Vec<PublicProfileView>> {
    let q = search_text(q.trim().trim_start_matches('@'));
    if q.chars().count() < SEARCH_MIN {
        return Err(format!("Type at least {SEARCH_MIN} characters"));
    }
    let token: String = q.chars().take(20).collect::<String>();
    let token = token.split_whitespace().next().unwrap_or("").to_string();
    let mut start = token.as_bytes().to_vec();
    start.push(0);
    let mut found: Vec<(u32, PublicProfileView)> = vec![];
    TOKENS.with(|m| {
        for entry in m.borrow().range(start.clone()..).take(200) {
            let k = entry.key();
            if !k.starts_with(&start) {
                break;
            }
            if let Ok(p) = Principal::try_from_slice(&k[start.len()..]) {
                if let Some(v) = load(&p).and_then(|r| public_view(p, &r)) {
                    let key = username_key(&v.username);
                    let score = if key == q {
                        100
                    } else if key.starts_with(&token) {
                        80
                    } else {
                        70
                    };
                    found.push((score, v));
                }
            }
        }
    });
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| username_key(&a.1.username).cmp(&username_key(&b.1.username))));
    found.dedup_by(|a, b| a.1.account == b.1.account);
    Ok(found.into_iter().take(SEARCH_MAX_RESULTS).map(|(_, v)| v).collect())
}

/* ------------------------------------------------------- sealed layer --- */

/// Stores the caller's friends-only profile: a blob encrypted on the device.
#[update]
async fn set_sealed_profile(blob: Option<ByteBuf>) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let now = time();
    let mut r = load(&me).unwrap_or_else(|| ProfileRecord::new(now));
    match blob {
        None => {
            SEALED.with(|m| m.borrow_mut().remove(&pkey(&me)));
            r.sealed = None;
        }
        Some(b) => {
            let b = b.into_vec();
            if b.is_empty() || b.len() > MAX_SEALED {
                return Err("Profile is too large (max 160 KB)".into());
            }
            r.sealed = Some(SealedMeta { hash: hash_hex(&b), size: b.len() as u32, updated_at_ns: now });
            SEALED.with(|m| m.borrow_mut().insert(pkey(&me), b));
        }
    }
    save(&me, r);
    Ok(())
}

#[derive(CandidType, Deserialize)]
pub struct SealedView {
    pub blob: ByteBuf,
    pub meta: SealedMeta,
}

/// A friends-only profile, still encrypted; only friends hold the key.
#[query]
fn get_sealed_profile(account: Principal) -> Option<SealedView> {
    if msg_caller() == Principal::anonymous() {
        return None;
    }
    let meta = load(&account)?.sealed?;
    let blob = SEALED.with(|m| m.borrow().get(&pkey(&account)))?;
    Some(SealedView { blob: ByteBuf::from(blob), meta })
}

/* ---------------------------------------------------------- ownership --- */

#[derive(CandidType, Deserialize)]
pub struct MyData {
    pub record: Option<ProfileRecord>,
    pub stored_bytes: u64,
}

#[query]
fn my_data() -> MyData {
    let me = msg_caller();
    let record = load(&me);
    let avatar = AVATARS.with(|m| m.borrow().get(&avatar_key(&me, AVATAR_PUBLIC)).map(|v| v.len()).unwrap_or(0));
    let sealed = SEALED.with(|m| m.borrow().get(&pkey(&me)).map(|v| v.len()).unwrap_or(0));
    MyData { record, stored_bytes: (avatar + sealed) as u64 }
}

/// Deletes everything this canister holds about the caller.
#[update]
fn delete_my_data() -> R<()> {
    let me = msg_caller();
    if me == Principal::anonymous() {
        return Err("Sign in first".into());
    }
    remove_all(&me);
    Ok(())
}

fn remove_all(p: &Principal) {
    search_sync::sync(config().search_canister, "profile", p.to_text(), None);
    if let Some(r) = load(p) {
        unindex(p, &r);
    }
    PROFILES.with(|m| m.borrow_mut().remove(&pkey(p)));
    AVATARS.with(|m| m.borrow_mut().remove(&avatar_key(p, AVATAR_PUBLIC)));
    SEALED.with(|m| m.borrow_mut().remove(&pkey(p)));
    ACCOUNTS.with(|m| m.borrow_mut().remove(&pkey(p)));
    // Reports filed against this account.
    let prefix = {
        let mut k = vec![p.as_slice().len() as u8];
        k.extend_from_slice(p.as_slice());
        k
    };
    let keys: Vec<Vec<u8>> = REPORTS.with(|m| {
        m.borrow()
            .range(prefix.clone()..)
            .take_while(|e| e.key().starts_with(&prefix))
            .map(|e| e.key().clone())
            .collect()
    });
    REPORTS.with(|m| {
        let mut m = m.borrow_mut();
        for k in keys {
            m.remove(&k);
        }
    });
}

/* -------------------------------------------------------- moderation --- */

#[update]
async fn report_profile(account: Principal, reason: String) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let r = load(&account).ok_or("No public profile")?;
    if r.visibility != Visibility::Public {
        return Err("No public profile".into());
    }
    let reason: String = reason.chars().take(MAX_REPORT_REASON).collect();
    REPORTS.with(|m| m.borrow_mut().insert(report_key(&account, &me), Report { reason, at_ns: time() }));
    Ok(())
}

#[query]
fn reported_profiles() -> R<Vec<(Principal, u32)>> {
    if !is_admin(&msg_caller()) {
        return Err("Administrators only".into());
    }
    let mut counts: BTreeMap<Vec<u8>, u32> = BTreeMap::new();
    REPORTS.with(|m| {
        for e in m.borrow().iter() {
            let k = e.key();
            let n = k[0] as usize;
            *counts.entry(k[1..1 + n].to_vec()).or_default() += 1;
        }
    });
    Ok(counts.into_iter().filter_map(|(k, n)| Principal::try_from_slice(&k).ok().map(|p| (p, n))).collect())
}

/// Removes an account's public layer (moderation). The sealed layer is untouched.
#[update]
fn remove_public_profile(account: Principal) -> R<()> {
    if !is_admin(&msg_caller()) {
        return Err("Administrators only".into());
    }
    if let Some(mut r) = load(&account) {
        unindex(&account, &r);
        AVATARS.with(|m| m.borrow_mut().remove(&avatar_key(&account, AVATAR_PUBLIC)));
        r.visibility = Visibility::Friends;
        r.username = None;
        r.display_name = None;
        r.bio = None;
        r.links = Vec::new();
        r.avatar = None;
        save(&account, r);
    }
    Ok(())
}

#[update]
fn add_admin(p: Principal) -> R<()> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Controllers only".into());
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

#[derive(CandidType, Deserialize)]
pub struct Stats {
    pub profiles: u64,
    pub public_avatars: u64,
    pub sealed_profiles: u64,
    pub usernames: u64,
}

#[query]
fn stats() -> Stats {
    Stats {
        profiles: PROFILES.with(|m| m.borrow().len()),
        public_avatars: AVATARS.with(|m| m.borrow().len()),
        sealed_profiles: SEALED.with(|m| m.borrow().len()),
        usernames: USERNAMES.with(|m| m.borrow().len()),
    }
}

ic_cdk::export_candid!();

#[cfg(test)]
mod candid_file {
    /// Writes the Candid interface (kept in the repo and checked in CI).
    #[test]
    fn write_did() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_profiles.did"), super::__export_service())
            .unwrap();
    }
}

//! Space: each account's public personal page. Items are posts, links,
//! works (image sets), videos, music and dapps; anyone can browse a visible
//! space, like items, and follow spaces (follows are kept on the device).
//! Video and audio are uploaded in chunks, with per-account and canister-wide
//! storage quotas so media can't exhaust the canister.
//!
//! Own stable memories (ids 16..=26), so it can move to a separate canister.

use crate::market::PhotoInput;
use crate::model::{clean_text, image_mime, Report, MAX_REPORT_REASON};
use crate::{hash_hex, is_admin, mem, pkey, rate_limit, require_account, Mem, R};
use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{msg_caller, time};
use ic_cdk::{query, update};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{StableBTreeMap, StableCell, Storable};
use serde_bytes::ByteBuf;
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeSet;

// Memory ids are permanent. Never reuse or renumber them.
const MEM_ITEMS: u8 = 16;
const MEM_IMAGES: u8 = 17;
const MEM_BY_OWNER: u8 = 18;
const MEM_SETTINGS: u8 = 19;
const MEM_LIKES: u8 = 20;
const MEM_MEDIA: u8 = 21;
const MEM_CHUNKS: u8 = 22;
const MEM_SEQ: u8 = 23;
const MEM_MEDIA_SEQ: u8 = 24;
const MEM_REPORTS: u8 = 25;
const MEM_TOTAL: u8 = 26;

pub const MAX_TITLE: usize = 120;
pub const MAX_BODY: usize = 5000;
pub const MAX_ABOUT: usize = 500;
pub const MAX_URL: usize = 500;
pub const MAX_TAGS: usize = 5;
pub const MAX_TAG: usize = 24;
pub const MAX_IMAGES: usize = 6;
pub const MAX_IMAGE: usize = 240 * 1024;
pub const MAX_CHUNK: usize = 1536 * 1024;
pub const MAX_VIDEO: u64 = 25 * 1024 * 1024;
pub const MAX_AUDIO: u64 = 12 * 1024 * 1024;
/// Media and image bytes one account may store.
pub const USER_QUOTA: u64 = 60 * 1024 * 1024;
/// Media and image bytes the whole canister may hold for spaces.
pub const TOTAL_QUOTA: u64 = 1024 * 1024 * 1024;
pub const MAX_ITEMS_PER_OWNER: usize = 500;
pub const MAX_PAGE: u32 = 50;
pub const REPORTS_TO_HIDE: u32 = 3;
const MAX_PENDING_UPLOADS: usize = 3;
const PENDING_TTL_NS: u64 = 24 * 3600 * 1_000_000_000;
pub const ACCENTS: &[&str] = &["violet", "blue", "teal", "green", "amber", "rose", "slate"];

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    Post,
    Link,
    Work,
    Video,
    Music,
    Dapp,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct ImageMeta {
    pub hash: String,
    pub mime: String,
    pub size: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct MediaMeta {
    pub id: u64,
    pub owner: Principal,
    pub mime: String,
    pub size: u64,
    pub chunks: u32,
    pub received: u32,
    pub item: Option<u64>,
    pub created_at_ns: u64,
}

impl Storable for MediaMeta {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode media"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode media")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), MediaMeta).expect("decode media")
    }
    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SpaceItem {
    pub id: u64,
    pub owner: Principal,
    pub kind: ItemKind,
    pub title: String,
    pub body: String,
    pub url: String,
    pub tags: Vec<String>,
    pub images: Vec<ImageMeta>,
    pub media: Option<MediaMeta>,
    pub canister_id: String,
    pub likes: u32,
    pub hidden: bool,
    pub created_at_ns: u64,
    pub updated_at_ns: u64,
}

impl Storable for SpaceItem {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode item"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode item")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), SpaceItem).expect("decode item")
    }
    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SpaceSettings {
    pub about: String,
    pub accent: String,
    pub pinned: Option<u64>,
    pub visible: bool,
    pub show_market: bool,
    pub used_bytes: u64,
    pub updated_at_ns: u64,
}

impl Default for SpaceSettings {
    fn default() -> Self {
        SpaceSettings {
            about: String::new(),
            accent: "violet".into(),
            pinned: None,
            visible: true,
            show_market: true,
            used_bytes: 0,
            updated_at_ns: 0,
        }
    }
}

impl Storable for SpaceSettings {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode space"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode space")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), SpaceSettings).expect("decode space")
    }
    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    static ITEMS: RefCell<StableBTreeMap<u64, SpaceItem, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_ITEMS)));
    /// (item id, image hash) -> bytes.
    static IMAGES: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_IMAGES)));
    /// (owner, item id) -> ().
    static BY_OWNER: RefCell<StableBTreeMap<Vec<u8>, (), Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_BY_OWNER)));
    static SETTINGS: RefCell<StableBTreeMap<Vec<u8>, SpaceSettings, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_SETTINGS)));
    /// (item id, liker) -> ().
    static LIKES: RefCell<StableBTreeMap<Vec<u8>, (), Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_LIKES)));
    static MEDIA: RefCell<StableBTreeMap<u64, MediaMeta, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_MEDIA)));
    /// (media id, chunk index) -> bytes.
    static CHUNKS: RefCell<StableBTreeMap<(u64, u32), Vec<u8>, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_CHUNKS)));
    static SEQ: RefCell<StableCell<u64, Mem>> = RefCell::new(StableCell::init(mem(MEM_SEQ), 0));
    static MEDIA_SEQ: RefCell<StableCell<u64, Mem>> = RefCell::new(StableCell::init(mem(MEM_MEDIA_SEQ), 0));
    /// (item id, reporter) -> report.
    static REPORTS: RefCell<StableBTreeMap<Vec<u8>, Report, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_REPORTS)));
    static TOTAL: RefCell<StableCell<u64, Mem>> = RefCell::new(StableCell::init(mem(MEM_TOTAL), 0));
}

fn next(cell: &'static std::thread::LocalKey<RefCell<StableCell<u64, Mem>>>) -> u64 {
    cell.with(|s| {
        let n = *s.borrow().get() + 1;
        s.borrow_mut().set(n);
        n
    })
}

fn id_key(id: u64, rest: &[u8]) -> Vec<u8> {
    let mut k = id.to_be_bytes().to_vec();
    k.extend_from_slice(rest);
    k
}

fn owner_key(p: &Principal, id: u64) -> Vec<u8> {
    let mut k = pkey(p);
    k.extend_from_slice(&id.to_be_bytes());
    k
}

fn settings(p: &Principal) -> SpaceSettings {
    SETTINGS.with(|m| m.borrow().get(&pkey(p))).unwrap_or_default()
}

fn save_settings(p: &Principal, s: SpaceSettings) {
    SETTINGS.with(|m| m.borrow_mut().insert(pkey(p), s));
}

/// Adds (or with a negative delta frees) stored bytes for an account, within quotas.
fn charge(p: &Principal, delta: i64) -> R<()> {
    let mut s = settings(p);
    let total = TOTAL.with(|t| *t.borrow().get());
    if delta > 0 {
        let d = delta as u64;
        if s.used_bytes + d > USER_QUOTA {
            return Err(format!("Your space is full ({} MB). Delete something first.", USER_QUOTA / 1024 / 1024));
        }
        if total + d > TOTAL_QUOTA {
            return Err("Space storage is full right now. Try again later.".into());
        }
        s.used_bytes += d;
        TOTAL.with(|t| t.borrow_mut().set(total + d));
    } else {
        let d = delta.unsigned_abs();
        s.used_bytes = s.used_bytes.saturating_sub(d);
        TOTAL.with(|t| t.borrow_mut().set(total.saturating_sub(d)));
    }
    save_settings(p, s);
    Ok(())
}

fn prefix_keys<V: Storable>(map: &StableBTreeMap<Vec<u8>, V, Mem>, prefix: &[u8]) -> Vec<Vec<u8>> {
    map.range(prefix.to_vec()..).take_while(|e| e.key().starts_with(prefix)).map(|e| e.key().clone()).collect()
}

/* ------------------------------------------------------- validation --- */

/// Kinds of media a file is, from its first bytes: ("video" | "audio" | "either", mime).
pub fn sniff_media(b: &[u8]) -> Option<(&'static str, &'static str)> {
    if b.len() >= 12 && &b[4..8] == b"ftyp" {
        let brand = &b[8..12];
        return Some(if brand.starts_with(b"M4A") { ("audio", "audio/mp4") } else { ("either", "video/mp4") });
    }
    if b.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some(("either", "video/webm"));
    }
    if b.starts_with(b"OggS") {
        return Some(("audio", "audio/ogg"));
    }
    if b.len() >= 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WAVE" {
        return Some(("audio", "audio/wav"));
    }
    if b.starts_with(b"ID3") || (b.len() >= 2 && b[0] == 0xFF && (b[1] & 0xE0) == 0xE0) {
        return Some(("audio", "audio/mpeg"));
    }
    if b.starts_with(b"fLaC") {
        return Some(("audio", "audio/flac"));
    }
    None
}

fn https_url(u: &str) -> R<String> {
    let u = u.trim();
    if u.is_empty() {
        return Ok(String::new());
    }
    if u.len() > MAX_URL || !u.starts_with("https://") || u.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Links must be https:// addresses".into());
    }
    Ok(u.to_string())
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ItemInput {
    pub kind: ItemKind,
    pub title: String,
    pub body: String,
    pub url: String,
    pub tags: Vec<String>,
    pub images: Vec<PhotoInput>,
    /// A finished upload (from space_upload_begin / space_upload_chunk), or keep: the current one.
    pub media: Option<u64>,
    pub canister_id: String,
}

#[derive(Debug, PartialEq)]
pub struct CleanItem {
    pub title: String,
    pub body: String,
    pub url: String,
    pub tags: Vec<String>,
    pub canister_id: String,
}

/// Checks the text fields and what each kind needs. `has_media`: an upload is attached.
pub fn check_item(i: &ItemInput, has_media: bool) -> R<CleanItem> {
    let title = clean_text(&i.title, MAX_TITLE).map_err(|e| format!("Title: {e}"))?;
    if title.contains('\n') {
        return Err("Use a single line for the title".into());
    }
    let body = clean_text(&i.body, MAX_BODY).map_err(|e| format!("Text: {e}"))?;
    let url = https_url(&i.url)?;
    if i.tags.len() > MAX_TAGS {
        return Err(format!("At most {MAX_TAGS} tags"));
    }
    let mut tags: Vec<String> = vec![];
    for t in &i.tags {
        let t: String = t.trim().trim_start_matches('#').to_lowercase();
        if t.is_empty() {
            continue;
        }
        if t.chars().count() > MAX_TAG || !t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
            return Err("Tags are single words (letters, numbers, - and _)".into());
        }
        if !tags.contains(&t) {
            tags.push(t);
        }
    }
    let canister_id = i.canister_id.trim().to_string();
    if !canister_id.is_empty() && Principal::from_text(&canister_id).is_err() {
        return Err("That is not a valid canister ID".into());
    }
    if i.images.len() > MAX_IMAGES {
        return Err(format!("At most {MAX_IMAGES} images"));
    }
    let need_title = || if title.is_empty() { Err("Add a title".to_string()) } else { Ok(()) };
    match i.kind {
        ItemKind::Post => {
            if body.is_empty() && i.images.is_empty() {
                return Err("Write something or add a photo".into());
            }
        }
        ItemKind::Link => {
            if url.is_empty() {
                return Err("Add the link".into());
            }
        }
        ItemKind::Work => {
            need_title()?;
            if i.images.is_empty() {
                return Err("Add at least one image of your work".into());
            }
        }
        ItemKind::Video | ItemKind::Music => {
            need_title()?;
            if !has_media && url.is_empty() {
                return Err("Upload a file or add a link".into());
            }
        }
        ItemKind::Dapp => {
            need_title()?;
            if url.is_empty() {
                return Err("Add the dapp's address".into());
            }
        }
    }
    if !canister_id.is_empty() && i.kind != ItemKind::Dapp {
        return Err("Only dapps have a canister ID".into());
    }
    Ok(CleanItem { title, body, url, tags, canister_id })
}

/* --------------------------------------------------------- internals --- */

fn load(id: u64) -> Option<SpaceItem> {
    ITEMS.with(|m| m.borrow().get(&id))
}

fn store(i: SpaceItem) {
    crate::search_sync::sync(crate::search_canister(), "space", i.id.to_string(), search_doc(&i));
    ITEMS.with(|m| m.borrow_mut().insert(i.id, i));
}

/// An item as the search canister indexes it (public ones only: not hidden, in a visible space).
pub fn search_doc(i: &SpaceItem) -> Option<crate::search_sync::Doc> {
    if i.hidden || !settings(&i.owner).visible {
        return None;
    }
    let first_line = i.body.lines().next().unwrap_or("").chars().take(100).collect::<String>();
    let mut tags = i.tags.clone();
    tags.push(format!("{:?}", i.kind).to_lowercase());
    Some(crate::search_sync::Doc {
        kind: "space".into(),
        id: i.id.to_string(),
        owner: i.owner,
        title: if i.title.is_empty() { first_line } else { i.title.clone() },
        text: format!("{}\n{}\n{}", i.body, i.url, i.canister_id),
        tags,
        updated_at_ns: i.updated_at_ns,
    })
}

/// Public items for the search canister's `reindex`, by id, after `cursor`.
pub fn search_docs(cursor: Option<u64>) -> crate::search_sync::DocPage {
    let start = cursor.map_or(0, |c| c + 1);
    let rows: Vec<SpaceItem> = ITEMS.with(|m| m.borrow().range(start..).take(201).map(|e| e.value()).collect());
    let more = rows.len() > 200;
    let last = rows.iter().take(200).last().map(|i| i.id);
    crate::search_sync::DocPage {
        docs: rows.iter().take(200).filter_map(search_doc).collect(),
        next: if more { last.map(|i| i.to_string()) } else { None },
    }
}

/// Re-sends all of an owner's items (after their space was shown or hidden).
fn sync_owner(owner: &Principal) {
    let items: Vec<SpaceItem> = owner_ids(owner).into_iter().filter_map(load).collect();
    let mut put = vec![];
    let mut remove = vec![];
    for i in &items {
        match search_doc(i) {
            Some(d) => put.push(d),
            None => remove.push(crate::search_sync::DocRef { kind: "space".into(), id: i.id.to_string() }),
        }
    }
    crate::search_sync::send(crate::search_canister(), put, remove);
}

fn visible_to(i: &SpaceItem, me: &Principal) -> bool {
    i.owner == *me || is_admin(me) || (!i.hidden && settings(&i.owner).visible)
}

fn own(id: u64, me: &Principal) -> R<SpaceItem> {
    let i = load(id).ok_or("Item not found")?;
    if i.owner != *me {
        return Err("Only the owner can change this".into());
    }
    Ok(i)
}

fn owner_ids(p: &Principal) -> Vec<u64> {
    let prefix = pkey(p);
    BY_OWNER.with(|m| {
        m.borrow()
            .range(prefix.clone()..)
            .take_while(|e| e.key().starts_with(&prefix))
            .filter_map(|e| e.key()[prefix.len()..].try_into().ok().map(u64::from_be_bytes))
            .collect()
    })
}

fn remove_media(m: &MediaMeta) {
    CHUNKS.with(|c| {
        let mut c = c.borrow_mut();
        for i in 0..m.chunks {
            c.remove(&(m.id, i));
        }
    });
    MEDIA.with(|x| x.borrow_mut().remove(&m.id));
    let _ = charge(&m.owner, -(m.size as i64));
}

/// Stores images for an item in order; frees images no longer used. Returns the list and the byte change.
fn put_images(id: u64, owner: &Principal, old: &[ImageMeta], input: Vec<PhotoInput>) -> R<Vec<ImageMeta>> {
    let mut out: Vec<ImageMeta> = vec![];
    let mut added: Vec<(String, Vec<u8>)> = vec![];
    for p in input {
        let meta = match p {
            PhotoInput::Keep(hash) => old.iter().find(|m| m.hash == hash).cloned().ok_or("An image is missing")?,
            PhotoInput::Add(bytes) => {
                let bytes = bytes.into_vec();
                if bytes.len() > MAX_IMAGE {
                    return Err(format!("Each image must be at most {} KB", MAX_IMAGE / 1024));
                }
                let mime = image_mime(&bytes).ok_or("Images must be WebP, JPEG or PNG")?;
                let meta = ImageMeta { hash: hash_hex(&bytes), mime: mime.into(), size: bytes.len() as u32 };
                if !added.iter().any(|(h, _)| *h == meta.hash) && !old.iter().any(|o| o.hash == meta.hash) {
                    added.push((meta.hash.clone(), bytes));
                }
                meta
            }
        };
        if !out.iter().any(|m| m.hash == meta.hash) {
            out.push(meta);
        }
    }
    let freed: Vec<&ImageMeta> = old.iter().filter(|o| !out.iter().any(|n| n.hash == o.hash)).collect();
    let add: i64 = added.iter().map(|(_, b)| b.len() as i64).sum();
    let free: i64 = freed.iter().map(|f| f.size as i64).sum();
    if add != free {
        charge(owner, add - free)?;
    }
    IMAGES.with(|m| {
        let mut m = m.borrow_mut();
        for f in freed {
            m.remove(&id_key(id, f.hash.as_bytes()));
        }
        for (hash, bytes) in added {
            m.insert(id_key(id, hash.as_bytes()), bytes);
        }
    });
    Ok(out)
}

/// A finished, unattached upload of the caller, checked against the item kind.
fn take_media(media_id: u64, me: &Principal, kind: ItemKind) -> R<MediaMeta> {
    let m = MEDIA.with(|x| x.borrow().get(&media_id)).ok_or("The upload was not found")?;
    if m.owner != *me {
        return Err("The upload was not found".into());
    }
    if m.received != m.chunks {
        return Err("The upload is not finished".into());
    }
    let first = CHUNKS.with(|c| c.borrow().get(&(m.id, 0))).unwrap_or_default();
    let (what, _) = sniff_media(&first).ok_or("Unsupported media file")?;
    let ok = match kind {
        ItemKind::Video => what != "audio",
        ItemKind::Music => what != "video",
        _ => false,
    };
    if !ok {
        return Err(if kind == ItemKind::Video { "That file is not a video" } else { "That file is not audio" }.into());
    }
    Ok(m)
}

fn delete_item(i: &SpaceItem) {
    crate::search_sync::sync(crate::search_canister(), "space", i.id.to_string(), None);
    IMAGES.with(|m| {
        let mut m = m.borrow_mut();
        for im in &i.images {
            m.remove(&id_key(i.id, im.hash.as_bytes()));
        }
    });
    let freed: i64 = i.images.iter().map(|x| x.size as i64).sum();
    let _ = charge(&i.owner, -freed);
    if let Some(m) = &i.media {
        remove_media(m);
    }
    let prefix = i.id.to_be_bytes();
    LIKES.with(|m| {
        let keys = prefix_keys(&m.borrow(), &prefix);
        let mut m = m.borrow_mut();
        for k in keys {
            m.remove(&k);
        }
    });
    REPORTS.with(|m| {
        let keys = prefix_keys(&m.borrow(), &prefix);
        let mut m = m.borrow_mut();
        for k in keys {
            m.remove(&k);
        }
    });
    BY_OWNER.with(|m| m.borrow_mut().remove(&owner_key(&i.owner, i.id)));
    ITEMS.with(|m| m.borrow_mut().remove(&i.id));
    let mut s = settings(&i.owner);
    if s.pinned == Some(i.id) {
        s.pinned = None;
        save_settings(&i.owner, s);
    }
}

/// Deletes an account's whole space (used when it deletes its data).
pub fn remove_all_space(p: &Principal) {
    for id in owner_ids(p) {
        if let Some(i) = load(id) {
            delete_item(&i);
        }
    }
    let pending: Vec<MediaMeta> =
        MEDIA.with(|m| m.borrow().iter().map(|e| e.value()).filter(|m| m.owner == *p).collect());
    for m in pending {
        remove_media(&m);
    }
    SETTINGS.with(|m| m.borrow_mut().remove(&pkey(p)));
}

/* ------------------------------------------------------------ views --- */

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SpaceView {
    pub owner: Principal,
    pub about: String,
    pub accent: String,
    pub pinned: Option<u64>,
    pub visible: bool,
    pub show_market: bool,
    pub items: u64,
    pub likes: u64,
    /// Only for the owner: bytes stored and the quota.
    pub used_bytes: Option<u64>,
    pub quota_bytes: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ItemPage {
    pub items: Vec<SpaceItem>,
    pub total: u64,
    pub next_offset: Option<u64>,
}

pub fn page(all: Vec<SpaceItem>, offset: u64, limit: u32) -> ItemPage {
    let total = all.len() as u64;
    let limit = limit.clamp(1, MAX_PAGE) as usize;
    let start = (offset as usize).min(all.len());
    let items: Vec<SpaceItem> = all.into_iter().skip(start).take(limit).collect();
    let end = start as u64 + items.len() as u64;
    ItemPage { items, total, next_offset: (end < total).then_some(end) }
}

/* -------------------------------------------------------------- API --- */

#[query]
fn space_get(owner: Principal) -> Option<SpaceView> {
    let me = msg_caller();
    let s = settings(&owner);
    if !s.visible && owner != me && !is_admin(&me) {
        return None;
    }
    let ids = owner_ids(&owner);
    let mut likes = 0u64;
    let mut count = 0u64;
    for i in ids.iter().filter_map(|id| load(*id)) {
        if !i.hidden || owner == me {
            count += 1;
            likes += i.likes as u64;
        }
    }
    Some(SpaceView {
        owner,
        about: s.about,
        accent: s.accent,
        pinned: s.pinned,
        visible: s.visible,
        show_market: s.show_market,
        items: count,
        likes,
        used_bytes: (owner == me).then_some(s.used_bytes),
        quota_bytes: USER_QUOTA,
    })
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SpaceInput {
    pub about: String,
    pub accent: String,
    pub pinned: Option<u64>,
    pub visible: bool,
    pub show_market: bool,
}

#[update]
async fn space_set(input: SpaceInput) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let about = clean_text(&input.about, MAX_ABOUT).map_err(|e| format!("About: {e}"))?;
    if !ACCENTS.contains(&input.accent.as_str()) {
        return Err("Pick a colour".into());
    }
    if let Some(p) = input.pinned {
        if load(p).is_none_or(|i| i.owner != me) {
            return Err("Only your own items can be pinned".into());
        }
    }
    let mut s = settings(&me);
    let visibility_changed = s.visible != input.visible;
    s.about = about;
    s.accent = input.accent;
    s.pinned = input.pinned;
    s.visible = input.visible;
    s.show_market = input.show_market;
    s.updated_at_ns = time();
    save_settings(&me, s);
    if visibility_changed {
        sync_owner(&me);
    }
    Ok(())
}

fn kind_matches(i: &SpaceItem, kind: &Option<ItemKind>) -> bool {
    kind.is_none_or(|k| k == i.kind)
}

/// One space's items, newest first (hidden items only for the owner).
#[query]
fn space_items(owner: Principal, kind: Option<ItemKind>, offset: u64, limit: u32) -> ItemPage {
    let me = msg_caller();
    if !settings(&owner).visible && owner != me && !is_admin(&me) {
        return page(vec![], 0, limit);
    }
    let mut v: Vec<SpaceItem> = owner_ids(&owner)
        .into_iter()
        .rev()
        .filter_map(load)
        .filter(|i| kind_matches(i, &kind) && (!i.hidden || owner == me))
        .collect();
    v.sort_by(|a, b| b.id.cmp(&a.id));
    page(v, offset, limit)
}

#[query]
fn space_item(id: u64) -> Option<SpaceItem> {
    let i = load(id)?;
    visible_to(&i, &msg_caller()).then_some(i)
}

/// Several items by id, in the given order (e.g. search matches); ones the caller may not see are left out.
#[query]
fn space_items_by_ids(ids: Vec<u64>) -> Vec<SpaceItem> {
    let me = msg_caller();
    ids.into_iter().take(200).filter_map(load).filter(|i| visible_to(i, &me)).collect()
}

/// Latest items across all visible spaces.
#[query]
fn space_recent(kind: Option<ItemKind>, offset: u64, limit: u32) -> ItemPage {
    let mut seen_hidden: BTreeSet<Vec<u8>> = BTreeSet::new();
    let mut shown: BTreeSet<Vec<u8>> = BTreeSet::new();
    let v: Vec<SpaceItem> = ITEMS.with(|m| {
        m.borrow()
            .iter()
            .rev()
            .map(|e| e.value())
            .filter(|i| !i.hidden && kind_matches(i, &kind))
            .filter(|i| {
                let k = pkey(&i.owner);
                if shown.contains(&k) {
                    return true;
                }
                if seen_hidden.contains(&k) {
                    return false;
                }
                if settings(&i.owner).visible {
                    shown.insert(k);
                    true
                } else {
                    seen_hidden.insert(k);
                    false
                }
            })
            .take(2000)
            .collect()
    });
    page(v, offset, limit)
}

/// Latest items from the given spaces (a reader's follows, sent from their device).
#[query]
fn space_feed(owners: Vec<Principal>, offset: u64, limit: u32) -> ItemPage {
    let set: BTreeSet<Principal> = owners.into_iter().take(300).filter(|o| settings(o).visible).collect();
    let mut v: Vec<SpaceItem> = set
        .iter()
        .flat_map(|o| owner_ids(o).into_iter().rev().take(100).collect::<Vec<_>>())
        .filter_map(load)
        .filter(|i| !i.hidden)
        .collect();
    v.sort_by(|a, b| b.id.cmp(&a.id));
    page(v, offset, limit)
}

#[query]
fn space_image(id: u64, hash: String) -> Option<ByteBuf> {
    let i = load(id)?;
    if !visible_to(&i, &msg_caller()) {
        return None;
    }
    IMAGES.with(|m| m.borrow().get(&id_key(id, hash.as_bytes()))).map(ByteBuf::from)
}

#[query]
fn space_media_chunk(media_id: u64, index: u32) -> Option<ByteBuf> {
    let m = MEDIA.with(|x| x.borrow().get(&media_id))?;
    let me = msg_caller();
    let ok = match m.item.and_then(load) {
        Some(i) => visible_to(&i, &me),
        None => m.owner == me,
    };
    if !ok {
        return None;
    }
    CHUNKS.with(|c| c.borrow().get(&(media_id, index))).map(ByteBuf::from)
}

#[update]
async fn space_upload_begin(mime: String, size: u64) -> R<u64> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let audio = mime.starts_with("audio/");
    let video = mime.starts_with("video/");
    if !audio && !video {
        return Err("Upload a video or audio file".into());
    }
    let max = if video { MAX_VIDEO } else { MAX_AUDIO };
    if size == 0 || size > max {
        return Err(format!("{} files can be at most {} MB", if video { "Video" } else { "Audio" }, max / 1024 / 1024));
    }
    // Drop this account's stale unfinished uploads; cap the open ones.
    let now = time();
    let mine: Vec<MediaMeta> =
        MEDIA.with(|m| m.borrow().iter().map(|e| e.value()).filter(|m| m.owner == me && m.item.is_none()).collect());
    let mut open = 0;
    for m in mine {
        if now.saturating_sub(m.created_at_ns) > PENDING_TTL_NS {
            remove_media(&m);
        } else {
            open += 1;
        }
    }
    if open >= MAX_PENDING_UPLOADS {
        return Err("Finish or cancel your other uploads first".into());
    }
    charge(&me, size as i64)?;
    let id = next(&MEDIA_SEQ);
    let chunks = size.div_ceil(MAX_CHUNK as u64) as u32;
    let mime: String = mime.chars().take(60).collect();
    MEDIA.with(|m| {
        m.borrow_mut()
            .insert(id, MediaMeta { id, owner: me, mime, size, chunks, received: 0, item: None, created_at_ns: now })
    });
    Ok(id)
}

#[update]
fn space_upload_chunk(media_id: u64, index: u32, bytes: ByteBuf) -> R<()> {
    let me = msg_caller();
    let mut m = MEDIA.with(|x| x.borrow().get(&media_id)).ok_or("Upload not found")?;
    if m.owner != me || m.item.is_some() {
        return Err("Upload not found".into());
    }
    if index >= m.chunks {
        return Err("Too many parts".into());
    }
    let expected = if index + 1 == m.chunks { m.size - (MAX_CHUNK as u64) * index as u64 } else { MAX_CHUNK as u64 };
    if bytes.len() as u64 != expected {
        return Err("A part has the wrong size".into());
    }
    if index == 0 && sniff_media(&bytes).is_none() {
        return Err("Unsupported media file (use MP4, WebM, MP3, M4A, OGG, WAV or FLAC)".into());
    }
    let fresh = CHUNKS.with(|c| c.borrow_mut().insert((media_id, index), bytes.into_vec())).is_none();
    if fresh {
        m.received += 1;
        MEDIA.with(|x| x.borrow_mut().insert(media_id, m));
    }
    Ok(())
}

/// Cancels an unfinished upload and frees its space.
#[update]
fn space_upload_cancel(media_id: u64) -> R<()> {
    let me = msg_caller();
    let m = MEDIA.with(|x| x.borrow().get(&media_id)).ok_or("Upload not found")?;
    if m.owner != me || m.item.is_some() {
        return Err("Upload not found".into());
    }
    remove_media(&m);
    Ok(())
}

#[update]
async fn space_create(input: ItemInput) -> R<u64> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let media = match (input.kind, input.media) {
        (ItemKind::Video | ItemKind::Music, Some(mid)) => Some(take_media(mid, &me, input.kind)?),
        (_, Some(_)) => return Err("Only videos and music have an upload".into()),
        _ => None,
    };
    let c = check_item(&input, media.is_some())?;
    if owner_ids(&me).len() >= MAX_ITEMS_PER_OWNER {
        return Err(format!("A space holds at most {MAX_ITEMS_PER_OWNER} items"));
    }
    let id = next(&SEQ);
    let images = put_images(id, &me, &[], input.images)?;
    let media = media.map(|mut m| {
        m.item = Some(id);
        MEDIA.with(|x| x.borrow_mut().insert(m.id, m.clone()));
        m
    });
    let now = time();
    store(SpaceItem {
        id,
        owner: me,
        kind: input.kind,
        title: c.title,
        body: c.body,
        url: c.url,
        tags: c.tags,
        images,
        media,
        canister_id: c.canister_id,
        likes: 0,
        hidden: false,
        created_at_ns: now,
        updated_at_ns: now,
    });
    BY_OWNER.with(|m| m.borrow_mut().insert(owner_key(&me, id), ()));
    Ok(id)
}

#[update]
async fn space_update(id: u64, input: ItemInput) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let mut item = own(id, &me)?;
    if input.kind != item.kind {
        return Err("The kind of an item can't change".into());
    }
    let current = item.media.as_ref().map(|m| m.id);
    let new_media = match input.media {
        Some(mid) if Some(mid) != current => Some(take_media(mid, &me, input.kind)?),
        _ => None,
    };
    let keeps = input.media.is_some() && input.media == current;
    let c = check_item(&input, keeps || new_media.is_some())?;
    item.images = put_images(id, &me, &item.images, input.images)?;
    if let Some(mut m) = new_media {
        if let Some(old) = &item.media {
            remove_media(old);
        }
        m.item = Some(id);
        MEDIA.with(|x| x.borrow_mut().insert(m.id, m.clone()));
        item.media = Some(m);
    } else if !keeps {
        if let Some(old) = item.media.take() {
            remove_media(&old);
        }
    }
    item.title = c.title;
    item.body = c.body;
    item.url = c.url;
    item.tags = c.tags;
    item.canister_id = c.canister_id;
    item.updated_at_ns = time();
    store(item);
    Ok(())
}

#[update]
fn space_delete(id: u64) -> R<()> {
    let me = msg_caller();
    let i = load(id).ok_or("Item not found")?;
    if i.owner != me && !is_admin(&me) {
        return Err("Only the owner can delete this".into());
    }
    delete_item(&i);
    Ok(())
}

/// Likes or unlikes an item; returns its like count.
#[update]
async fn space_like(id: u64, like: bool) -> R<u32> {
    let me = require_account().await?;
    let mut i = load(id).ok_or("Item not found")?;
    if !visible_to(&i, &me) {
        return Err("Item not found".into());
    }
    let key = id_key(id, me.as_slice());
    let had = LIKES.with(|m| m.borrow().contains_key(&key));
    if like && !had {
        LIKES.with(|m| m.borrow_mut().insert(key, ()));
        i.likes += 1;
    } else if !like && had {
        LIKES.with(|m| m.borrow_mut().remove(&key));
        i.likes = i.likes.saturating_sub(1);
    } else {
        return Ok(i.likes);
    }
    let n = i.likes;
    // A like changes nothing the search index holds.
    ITEMS.with(|m| m.borrow_mut().insert(i.id, i));
    Ok(n)
}

/// Which of these items the caller has liked.
#[query]
fn space_liked(ids: Vec<u64>) -> Vec<u64> {
    let me = msg_caller();
    ids.into_iter()
        .take(200)
        .filter(|id| LIKES.with(|m| m.borrow().contains_key(&id_key(*id, me.as_slice()))))
        .collect()
}

#[update]
async fn space_report(id: u64, reason: String) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let mut i = load(id).ok_or("Item not found")?;
    if i.owner == me {
        return Err("You can't report your own item".into());
    }
    let reason: String = reason.chars().take(MAX_REPORT_REASON).collect();
    REPORTS.with(|m| m.borrow_mut().insert(id_key(id, me.as_slice()), Report { reason, at_ns: time() }));
    let n = REPORTS.with(|m| prefix_keys(&m.borrow(), &id.to_be_bytes()).len()) as u32;
    if n >= REPORTS_TO_HIDE && !i.hidden {
        i.hidden = true;
        store(i);
    }
    Ok(())
}

/// Administrators: hide or restore an item (restoring clears its reports).
#[update]
fn space_moderate(id: u64, hide: bool) -> R<()> {
    if !is_admin(&msg_caller()) {
        return Err("Administrators only".into());
    }
    let mut i = load(id).ok_or("Item not found")?;
    i.hidden = hide;
    if !hide {
        REPORTS.with(|m| {
            let keys = prefix_keys(&m.borrow(), &id.to_be_bytes());
            let mut m = m.borrow_mut();
            for k in keys {
                m.remove(&k);
            }
        });
    }
    store(i);
    Ok(())
}

/// Storage used by all spaces, and the limit.
#[query]
fn space_storage() -> (u64, u64) {
    (TOTAL.with(|t| *t.borrow().get()), TOTAL_QUOTA)
}

/* ------------------------------------------------------------ moving --- */

/// One page of a stable map (by number, in declaration order), to copy this
/// module to another canister.
pub fn move_dump(map: u8, start: Option<Vec<u8>>, max_bytes: usize) -> R<crate::kv::Page> {
    Ok(match map {
        0 => ITEMS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        1 => IMAGES.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        2 => BY_OWNER.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        3 => SETTINGS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        4 => LIKES.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        5 => MEDIA.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        6 => CHUNKS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        7 => REPORTS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        _ => return Err("No such map".into()),
    })
}

/// Stores a page copied from another canister.
pub fn move_load(map: u8, entries: Vec<(ByteBuf, ByteBuf)>) -> R<()> {
    match map {
        0 => ITEMS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        1 => IMAGES.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        2 => BY_OWNER.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        3 => SETTINGS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        4 => LIKES.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        5 => MEDIA.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        6 => CHUNKS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        7 => REPORTS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        _ => return Err("No such map".into()),
    }
    Ok(())
}

/// Entries in each map, in declaration order (to check a copy).
pub fn move_counts() -> Vec<u64> {
    vec![
        ITEMS.with(|m| m.borrow().len()),
        IMAGES.with(|m| m.borrow().len()),
        BY_OWNER.with(|m| m.borrow().len()),
        SETTINGS.with(|m| m.borrow().len()),
        LIKES.with(|m| m.borrow().len()),
        MEDIA.with(|m| m.borrow().len()),
        CHUNKS.with(|m| m.borrow().len()),
        REPORTS.with(|m| m.borrow().len()),
    ]
}

/// The module's counters.
pub fn move_cells() -> Vec<u64> {
    vec![SEQ.with(|c| *c.borrow().get()), MEDIA_SEQ.with(|c| *c.borrow().get()), TOTAL.with(|c| *c.borrow().get())]
}

pub fn move_set_cells(values: Vec<u64>) {
    if let Some(v) = values.get(0) {
        SEQ.with(|c| c.borrow_mut().set(*v));
    }
    if let Some(v) = values.get(1) {
        MEDIA_SEQ.with(|c| c.borrow_mut().set(*v));
    }
    if let Some(v) = values.get(2) {
        TOTAL.with(|c| c.borrow_mut().set(*v));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: ItemKind) -> ItemInput {
        ItemInput {
            kind,
            title: "My thing".into(),
            body: "Hello".into(),
            url: String::new(),
            tags: vec!["#Art".into(), "art".into(), "music".into()],
            images: vec![],
            media: None,
            canister_id: String::new(),
        }
    }

    #[test]
    fn checks_each_kind() {
        let c = check_item(&input(ItemKind::Post), false).unwrap();
        assert_eq!(c.tags, vec!["art".to_string(), "music".to_string()]);
        assert!(check_item(&ItemInput { body: String::new(), ..input(ItemKind::Post) }, false).is_err());
        assert!(check_item(&input(ItemKind::Link), false).unwrap_err().contains("link"));
        assert!(check_item(&ItemInput { url: "http://x.com".into(), ..input(ItemKind::Link) }, false).is_err());
        assert!(check_item(&ItemInput { url: "https://x.com".into(), ..input(ItemKind::Link) }, false).is_ok());
        assert!(check_item(&input(ItemKind::Work), false).unwrap_err().contains("image"));
        assert!(check_item(&input(ItemKind::Video), false).is_err());
        assert!(check_item(&input(ItemKind::Video), true).is_ok());
        assert!(check_item(&ItemInput { title: String::new(), ..input(ItemKind::Music) }, true).is_err());
        let dapp = ItemInput { url: "https://app.example".into(), ..input(ItemKind::Dapp) };
        assert!(check_item(&ItemInput { canister_id: "not a principal".into(), ..dapp.clone() }, false).is_err());
        assert!(check_item(&ItemInput { canister_id: "ryjl3-tyaaa-aaaaa-aaaba-cai".into(), ..dapp }, false).is_ok());
        assert!(check_item(&ItemInput { tags: vec!["two words".into()], ..input(ItemKind::Post) }, false).is_err());
    }

    #[test]
    fn sniffs_media() {
        assert_eq!(sniff_media(b"\0\0\0\x18ftypisom....").unwrap().0, "either");
        assert_eq!(sniff_media(b"\0\0\0\x18ftypM4A ....").unwrap().0, "audio");
        assert_eq!(sniff_media(b"ID3\x04....").unwrap().1, "audio/mpeg");
        assert_eq!(sniff_media(b"OggS....").unwrap().0, "audio");
        assert!(sniff_media(b"<html>").is_none());
    }

    #[test]
    fn pages() {
        let p = page(vec![], 0, 10);
        assert_eq!((p.total, p.next_offset), (0, None));
    }
}

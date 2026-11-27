//! Market: public classified listings (title, price, photos, category,
//! condition, location). Anyone can browse; OpenSocial accounts can post.
//! Buyers contact sellers through end-to-end encrypted chat; no payments here.
//!
//! Kept in its own stable memories (ids 10..=14) so it can move to a separate
//! canister later without touching profiles.

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
use std::collections::BTreeMap;

// Memory ids are permanent. Never reuse or renumber them.
const MEM_LISTINGS: u8 = 10;
const MEM_PHOTOS: u8 = 11;
const MEM_BY_SELLER: u8 = 12;
const MEM_REPORTS: u8 = 13;
const MEM_SEQ: u8 = 14;

pub const MAX_TITLE: usize = 80;
pub const MAX_DESCRIPTION: usize = 3000;
pub const MAX_LOCATION: usize = 80;
pub const MAX_SELLER_NAME: usize = 40;
pub const MAX_PHOTOS: usize = 6;
pub const MAX_PHOTO: usize = 240 * 1024;
/// Listings an account may have that are not sold.
pub const MAX_OPEN_PER_SELLER: usize = 50;
pub const MAX_PAGE: u32 = 60;
/// Distinct reports that hide a listing until an administrator looks at it.
pub const REPORTS_TO_HIDE: u32 = 3;
/// Largest price, in minor units (keeps sums and sorting safe).
pub const MAX_PRICE: u64 = 1_000_000_000_000_000;

pub const CATEGORIES: &[&str] = &[
    "electronics",
    "computers",
    "phones",
    "home",
    "furniture",
    "fashion",
    "beauty",
    "kids",
    "sports",
    "hobbies",
    "books",
    "music",
    "vehicles",
    "property",
    "jobs",
    "services",
    "tickets",
    "pets",
    "crypto",
    "other",
];
pub const CONDITIONS: &[&str] = &["new", "like_new", "good", "fair", "for_parts", "not_applicable"];
pub const CURRENCIES: &[&str] = &["EUR", "USD", "GBP", "CHF", "CNY", "JPY", "ICP", "BTC", "ETH", "USDC", "USDT"];

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListingStatus {
    Active,
    Reserved,
    Sold,
    /// Hidden by reports or an administrator; only the seller still sees it.
    Hidden,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct PhotoMeta {
    pub hash: String,
    pub mime: String,
    pub size: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Listing {
    pub id: u64,
    pub seller: Principal,
    pub seller_name: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub condition: String,
    /// Minor units of `currency` (cents; satoshi-like 1e-8 for crypto). 0 = free.
    pub price: u64,
    pub currency: String,
    pub negotiable: bool,
    pub location: String,
    pub shipping: bool,
    pub pickup: bool,
    pub photos: Vec<PhotoMeta>,
    pub status: ListingStatus,
    pub created_at_ns: u64,
    pub updated_at_ns: u64,
}

impl Storable for Listing {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode listing"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode listing")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Listing).expect("decode listing")
    }
    const BOUND: Bound = Bound::Unbounded;
}

thread_local! {
    static LISTINGS: RefCell<StableBTreeMap<u64, Listing, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_LISTINGS)));
    /// (listing id big-endian, photo hash) -> bytes.
    static PHOTOS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_PHOTOS)));
    /// (seller principal, listing id big-endian) -> ().
    static BY_SELLER: RefCell<StableBTreeMap<Vec<u8>, (), Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_BY_SELLER)));
    /// (listing id big-endian, reporter) -> report.
    static REPORTS: RefCell<StableBTreeMap<Vec<u8>, Report, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_REPORTS)));
    static SEQ: RefCell<StableCell<u64, Mem>> = RefCell::new(StableCell::init(mem(MEM_SEQ), 0));
}

fn photo_key(id: u64, hash: &str) -> Vec<u8> {
    let mut k = id.to_be_bytes().to_vec();
    k.extend_from_slice(hash.as_bytes());
    k
}

fn seller_key(p: &Principal, id: u64) -> Vec<u8> {
    let mut k = pkey(p);
    k.extend_from_slice(&id.to_be_bytes());
    k
}

/* ------------------------------------------------------- validation --- */

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum PhotoInput {
    /// Keep a photo already on this listing (by hash), in this position.
    Keep(String),
    Add(ByteBuf),
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ListingInput {
    pub seller_name: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub condition: String,
    pub price: u64,
    pub currency: String,
    pub negotiable: bool,
    pub location: String,
    pub shipping: bool,
    pub pickup: bool,
    pub photos: Vec<PhotoInput>,
}

/// The checked text fields of an input (photos are handled separately).
#[derive(Debug, PartialEq)]
pub struct CleanFields {
    pub seller_name: String,
    pub title: String,
    pub description: String,
    pub location: String,
}

pub fn check_input(i: &ListingInput) -> R<CleanFields> {
    let title = clean_text(&i.title, MAX_TITLE).map_err(|e| format!("Title: {e}"))?;
    if title.chars().count() < 3 {
        return Err("Add a title (at least 3 characters)".into());
    }
    let description = clean_text(&i.description, MAX_DESCRIPTION).map_err(|e| format!("Description: {e}"))?;
    let location = clean_text(&i.location, MAX_LOCATION).map_err(|e| format!("Location: {e}"))?;
    let seller_name = clean_text(&i.seller_name, MAX_SELLER_NAME).map_err(|e| format!("Name: {e}"))?;
    if seller_name.contains('\n') || title.contains('\n') || location.contains('\n') {
        return Err("Use a single line for the title, name and location".into());
    }
    if !CATEGORIES.contains(&i.category.as_str()) {
        return Err("Pick a category".into());
    }
    if !CONDITIONS.contains(&i.condition.as_str()) {
        return Err("Pick a condition".into());
    }
    if !CURRENCIES.contains(&i.currency.as_str()) {
        return Err("Unsupported currency".into());
    }
    if i.price > MAX_PRICE {
        return Err("Price is too high".into());
    }
    if !i.shipping && !i.pickup {
        return Err("Choose pickup, shipping or both".into());
    }
    if i.photos.is_empty() {
        return Err("Add at least one photo".into());
    }
    if i.photos.len() > MAX_PHOTOS {
        return Err(format!("At most {MAX_PHOTOS} photos"));
    }
    Ok(CleanFields { seller_name, title, description, location })
}

/* ------------------------------------------------------------ search --- */

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketSort {
    Newest,
    PriceLow,
    PriceHigh,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct MarketQuery {
    pub text: String,
    pub category: Option<String>,
    pub condition: Option<String>,
    /// With min/max price: only listings in this currency.
    pub currency: Option<String>,
    pub min_price: Option<u64>,
    pub max_price: Option<u64>,
    pub free_only: bool,
    pub shipping_only: bool,
    pub location: String,
    pub seller: Option<Principal>,
    pub sort: MarketSort,
    pub offset: u64,
    pub limit: u32,
    /// Only these listings, in this order (the search canister's matches for
    /// the words; `text` is then left empty). With Newest, the order is kept.
    pub ids: Option<Vec<u64>>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct MarketPage {
    pub items: Vec<Listing>,
    pub total: u64,
    pub next_offset: Option<u64>,
}

fn fold(s: &str) -> String {
    s.to_lowercase()
}

/// Whether a public (Active or Reserved) listing matches the query.
pub fn matches(l: &Listing, q: &MarketQuery, words: &[String], place: &str) -> bool {
    if !matches!(l.status, ListingStatus::Active | ListingStatus::Reserved) {
        return false;
    }
    if q.category.as_ref().is_some_and(|c| *c != l.category)
        || q.condition.as_ref().is_some_and(|c| *c != l.condition)
        || q.seller.is_some_and(|s| s != l.seller)
        || (q.free_only && l.price != 0)
        || (q.shipping_only && !l.shipping)
    {
        return false;
    }
    if q.min_price.is_some() || q.max_price.is_some() {
        if q.currency.as_ref().is_some_and(|c| *c != l.currency) {
            return false;
        }
        if q.min_price.is_some_and(|m| l.price < m) || q.max_price.is_some_and(|m| l.price > m) {
            return false;
        }
    }
    if !place.is_empty() && !fold(&l.location).contains(place) {
        return false;
    }
    if !words.is_empty() {
        let hay = fold(&format!("{} {} {}", l.title, l.description, l.location));
        if !words.iter().all(|w| hay.contains(w.as_str())) {
            return false;
        }
    }
    true
}

/// Runs a query over listings given newest first.
pub fn search(all: impl Iterator<Item = Listing>, q: &MarketQuery) -> MarketPage {
    let words: Vec<String> = fold(&q.text).split_whitespace().take(8).map(String::from).collect();
    let place = fold(q.location.trim());
    let mut hits: Vec<Listing> = all.filter(|l| matches(l, q, &words, &place)).take(5000).collect();
    match q.sort {
        MarketSort::Newest => {}
        MarketSort::PriceLow => hits.sort_by(|a, b| a.price.cmp(&b.price).then(b.id.cmp(&a.id))),
        MarketSort::PriceHigh => hits.sort_by(|a, b| b.price.cmp(&a.price).then(b.id.cmp(&a.id))),
    }
    let total = hits.len() as u64;
    let limit = q.limit.clamp(1, MAX_PAGE) as usize;
    let start = (q.offset as usize).min(hits.len());
    let items: Vec<Listing> = hits.into_iter().skip(start).take(limit).collect();
    let end = start as u64 + items.len() as u64;
    MarketPage { items, total, next_offset: (end < total).then_some(end) }
}

/* --------------------------------------------------------- internals --- */

fn load(id: u64) -> Option<Listing> {
    LISTINGS.with(|m| m.borrow().get(&id))
}

fn store(l: Listing) {
    crate::search_sync::sync(crate::search_canister(), "listing", l.id.to_string(), search_doc(&l));
    LISTINGS.with(|m| m.borrow_mut().insert(l.id, l));
}

/// A listing as the search canister indexes it (public ones only: available or reserved).
pub fn search_doc(l: &Listing) -> Option<crate::search_sync::Doc> {
    if !matches!(l.status, ListingStatus::Active | ListingStatus::Reserved) {
        return None;
    }
    Some(crate::search_sync::Doc {
        kind: "listing".into(),
        id: l.id.to_string(),
        owner: l.seller,
        title: l.title.clone(),
        text: format!("{}\n{}", l.description, l.location),
        tags: vec![l.category.clone(), l.condition.clone()],
        updated_at_ns: l.updated_at_ns,
    })
}

/// Public listings for the search canister's `reindex`, by id, after `cursor`.
pub fn search_docs(cursor: Option<u64>) -> crate::search_sync::DocPage {
    let start = cursor.map_or(0, |c| c + 1);
    let rows: Vec<Listing> = LISTINGS.with(|m| m.borrow().range(start..).take(201).map(|e| e.value()).collect());
    let more = rows.len() > 200;
    let last = rows.iter().take(200).last().map(|l| l.id);
    crate::search_sync::DocPage {
        docs: rows.iter().take(200).filter_map(search_doc).collect(),
        next: if more { last.map(|i| i.to_string()) } else { None },
    }
}

fn own(id: u64, me: &Principal) -> R<Listing> {
    let l = load(id).ok_or("Listing not found")?;
    if l.seller != *me {
        return Err("Only the seller can change this listing".into());
    }
    Ok(l)
}

/// Stores the photos for a listing in the given order; drops photos no longer used.
fn put_photos(id: u64, old: &[PhotoMeta], input: Vec<PhotoInput>) -> R<Vec<PhotoMeta>> {
    let mut out: Vec<PhotoMeta> = vec![];
    let mut added: Vec<(String, Vec<u8>)> = vec![];
    for p in input {
        let meta = match p {
            PhotoInput::Keep(hash) => old.iter().find(|m| m.hash == hash).cloned().ok_or("A photo is missing")?,
            PhotoInput::Add(bytes) => {
                let bytes = bytes.into_vec();
                if bytes.len() > MAX_PHOTO {
                    return Err(format!("Each photo must be at most {} KB", MAX_PHOTO / 1024));
                }
                let mime = image_mime(&bytes).ok_or("Photos must be WebP, JPEG or PNG")?;
                let meta = PhotoMeta { hash: hash_hex(&bytes), mime: mime.into(), size: bytes.len() as u32 };
                added.push((meta.hash.clone(), bytes));
                meta
            }
        };
        if !out.iter().any(|m| m.hash == meta.hash) {
            out.push(meta);
        }
    }
    PHOTOS.with(|m| {
        let mut m = m.borrow_mut();
        for o in old.iter().filter(|o| !out.iter().any(|n| n.hash == o.hash)) {
            m.remove(&photo_key(id, &o.hash));
        }
        for (hash, bytes) in added {
            m.insert(photo_key(id, &hash), bytes);
        }
    });
    Ok(out)
}

fn remove_listing(l: &Listing) {
    crate::search_sync::sync(crate::search_canister(), "listing", l.id.to_string(), None);
    PHOTOS.with(|m| {
        let mut m = m.borrow_mut();
        for p in &l.photos {
            m.remove(&photo_key(l.id, &p.hash));
        }
    });
    BY_SELLER.with(|m| m.borrow_mut().remove(&seller_key(&l.seller, l.id)));
    let prefix = l.id.to_be_bytes().to_vec();
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
    LISTINGS.with(|m| m.borrow_mut().remove(&l.id));
}

fn seller_ids(p: &Principal) -> Vec<u64> {
    let prefix = pkey(p);
    BY_SELLER.with(|m| {
        m.borrow()
            .range(prefix.clone()..)
            .take_while(|e| e.key().starts_with(&prefix))
            .filter_map(|e| e.key()[prefix.len()..].try_into().ok().map(u64::from_be_bytes))
            .collect()
    })
}

/// Deletes every listing of an account (used when it deletes its data).
pub fn remove_all_listings(p: &Principal) {
    for id in seller_ids(p) {
        if let Some(l) = load(id) {
            remove_listing(&l);
        }
    }
}

/* -------------------------------------------------------------- API --- */

#[update]
async fn market_create(input: ListingInput) -> R<u64> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let f = check_input(&input)?;
    let open = seller_ids(&me).into_iter().filter_map(load).filter(|l| l.status != ListingStatus::Sold).count();
    if open >= MAX_OPEN_PER_SELLER {
        return Err(format!("You can have at most {MAX_OPEN_PER_SELLER} open listings"));
    }
    let id = SEQ.with(|s| {
        let next = *s.borrow().get() + 1;
        s.borrow_mut().set(next);
        next
    });
    let photos = put_photos(id, &[], input.photos)?;
    let now = time();
    store(Listing {
        id,
        seller: me,
        seller_name: f.seller_name,
        title: f.title,
        description: f.description,
        category: input.category,
        condition: input.condition,
        price: input.price,
        currency: input.currency,
        negotiable: input.negotiable,
        location: f.location,
        shipping: input.shipping,
        pickup: input.pickup,
        photos,
        status: ListingStatus::Active,
        created_at_ns: now,
        updated_at_ns: now,
    });
    BY_SELLER.with(|m| m.borrow_mut().insert(seller_key(&me, id), ()));
    Ok(id)
}

#[update]
async fn market_update(id: u64, input: ListingInput) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let mut l = own(id, &me)?;
    let f = check_input(&input)?;
    l.photos = put_photos(id, &l.photos, input.photos)?;
    l.seller_name = f.seller_name;
    l.title = f.title;
    l.description = f.description;
    l.category = input.category;
    l.condition = input.condition;
    l.price = input.price;
    l.currency = input.currency;
    l.negotiable = input.negotiable;
    l.location = f.location;
    l.shipping = input.shipping;
    l.pickup = input.pickup;
    l.updated_at_ns = time();
    store(l);
    Ok(())
}

/// Seller marks a listing Active, Reserved or Sold.
#[update]
fn market_set_status(id: u64, status: ListingStatus) -> R<()> {
    let me = msg_caller();
    rate_limit(&me)?;
    let mut l = own(id, &me)?;
    if status == ListingStatus::Hidden || l.status == ListingStatus::Hidden {
        return Err("This listing is under review".into());
    }
    l.status = status;
    l.updated_at_ns = time();
    store(l);
    Ok(())
}

#[update]
fn market_delete(id: u64) -> R<()> {
    let me = msg_caller();
    let l = load(id).ok_or("Listing not found")?;
    if l.seller != me && !is_admin(&me) {
        return Err("Only the seller can delete this listing".into());
    }
    remove_listing(&l);
    Ok(())
}

#[query]
fn market_search(q: MarketQuery) -> MarketPage {
    match &q.ids {
        Some(ids) => search(ids.iter().take(1000).filter_map(|id| load(*id)), &q),
        None => LISTINGS.with(|m| search(m.borrow().iter().rev().map(|e| e.value()), &q)),
    }
}

/// One listing. Hidden listings are only shown to their seller and administrators.
#[query]
fn market_listing(id: u64) -> Option<Listing> {
    let l = load(id)?;
    let me = msg_caller();
    (l.status != ListingStatus::Hidden || l.seller == me || is_admin(&me)).then_some(l)
}

#[query]
fn market_photo(id: u64, hash: String) -> Option<ByteBuf> {
    PHOTOS.with(|m| m.borrow().get(&photo_key(id, &hash))).map(ByteBuf::from)
}

/// The caller's own listings (all statuses), newest first.
#[query]
fn market_my_listings() -> Vec<Listing> {
    let me = msg_caller();
    let mut v: Vec<Listing> = seller_ids(&me).into_iter().filter_map(load).collect();
    v.sort_by(|a, b| b.id.cmp(&a.id));
    v
}

/// Several listings by id (e.g. a buyer's saved list); hidden ones are left out.
#[query]
fn market_listings(ids: Vec<u64>) -> Vec<Listing> {
    let me = msg_caller();
    ids.into_iter().take(200).filter_map(load).filter(|l| l.status != ListingStatus::Hidden || l.seller == me).collect()
}

/// Number of public listings per category.
#[query]
fn market_counts() -> Vec<(String, u64)> {
    let mut c: BTreeMap<String, u64> = BTreeMap::new();
    LISTINGS.with(|m| {
        for e in m.borrow().iter() {
            let l = e.value();
            if matches!(l.status, ListingStatus::Active | ListingStatus::Reserved) {
                *c.entry(l.category).or_default() += 1;
            }
        }
    });
    c.into_iter().collect()
}

#[update]
async fn market_report(id: u64, reason: String) -> R<()> {
    let me = require_account().await?;
    rate_limit(&me)?;
    let mut l = load(id).ok_or("Listing not found")?;
    if l.seller == me {
        return Err("You can't report your own listing".into());
    }
    let reason: String = reason.chars().take(MAX_REPORT_REASON).collect();
    let mut key = id.to_be_bytes().to_vec();
    key.extend_from_slice(me.as_slice());
    REPORTS.with(|m| m.borrow_mut().insert(key, Report { reason, at_ns: time() }));
    let prefix = id.to_be_bytes().to_vec();
    let n = REPORTS.with(|m| m.borrow().range(prefix.clone()..).take_while(|e| e.key().starts_with(&prefix)).count());
    if n as u32 >= REPORTS_TO_HIDE && l.status != ListingStatus::Hidden {
        l.status = ListingStatus::Hidden;
        store(l);
    }
    Ok(())
}

/// Administrators: reported listings with their report counts.
#[query]
fn market_reported() -> R<Vec<(u64, u32)>> {
    if !is_admin(&msg_caller()) {
        return Err("Administrators only".into());
    }
    let mut counts: BTreeMap<u64, u32> = BTreeMap::new();
    REPORTS.with(|m| {
        for e in m.borrow().iter() {
            if let Ok(b) = e.key()[..8].try_into() {
                *counts.entry(u64::from_be_bytes(b)).or_default() += 1;
            }
        }
    });
    Ok(counts.into_iter().collect())
}

/// Administrators: hide or restore a listing (restoring clears its reports).
#[update]
fn market_moderate(id: u64, hide: bool) -> R<()> {
    if !is_admin(&msg_caller()) {
        return Err("Administrators only".into());
    }
    let mut l = load(id).ok_or("Listing not found")?;
    l.status = if hide { ListingStatus::Hidden } else { ListingStatus::Active };
    if !hide {
        let prefix = id.to_be_bytes().to_vec();
        REPORTS.with(|m| {
            let keys: Vec<Vec<u8>> = m
                .borrow()
                .range(prefix.clone()..)
                .take_while(|e| e.key().starts_with(&prefix))
                .map(|e| e.key().clone())
                .collect();
            let mut m = m.borrow_mut();
            for k in keys {
                m.remove(&k);
            }
        });
    }
    store(l);
    Ok(())
}

/* ------------------------------------------------------------ moving --- */

/// One page of a stable map (by number, in declaration order), to copy this
/// module to another canister.
pub fn move_dump(map: u8, start: Option<Vec<u8>>, max_bytes: usize) -> R<crate::kv::Page> {
    Ok(match map {
        0 => LISTINGS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        1 => PHOTOS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        2 => BY_SELLER.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        3 => REPORTS.with(|m| crate::kv::dump(&m.borrow(), start, max_bytes)),
        _ => return Err("No such map".into()),
    })
}

/// Stores a page copied from another canister.
pub fn move_load(map: u8, entries: Vec<(ByteBuf, ByteBuf)>) -> R<()> {
    match map {
        0 => LISTINGS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        1 => PHOTOS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        2 => BY_SELLER.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        3 => REPORTS.with(|m| crate::kv::load(&mut m.borrow_mut(), entries)),
        _ => return Err("No such map".into()),
    }
    Ok(())
}

/// Entries in each map, in declaration order (to check a copy).
pub fn move_counts() -> Vec<u64> {
    vec![
        LISTINGS.with(|m| m.borrow().len()),
        PHOTOS.with(|m| m.borrow().len()),
        BY_SELLER.with(|m| m.borrow().len()),
        REPORTS.with(|m| m.borrow().len()),
    ]
}

/// The module's counters.
pub fn move_cells() -> Vec<u64> {
    vec![SEQ.with(|c| *c.borrow().get())]
}

pub fn move_set_cells(values: Vec<u64>) {
    if let Some(v) = values.get(0) {
        SEQ.with(|c| c.borrow_mut().set(*v));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> ListingInput {
        ListingInput {
            seller_name: "Alice".into(),
            title: "Road bike".into(),
            description: "Carbon frame, size 56".into(),
            category: "sports".into(),
            condition: "good".into(),
            price: 45_000,
            currency: "EUR".into(),
            negotiable: true,
            location: "Portland".into(),
            shipping: false,
            pickup: true,
            photos: vec![PhotoInput::Keep("x".into())],
        }
    }

    fn listing(id: u64, price: u64, status: ListingStatus) -> Listing {
        let i = input();
        Listing {
            id,
            seller: Principal::anonymous(),
            seller_name: i.seller_name,
            title: format!("Item {id}"),
            description: i.description,
            category: if id % 2 == 0 { "home".into() } else { "sports".into() },
            condition: i.condition,
            price,
            currency: "EUR".into(),
            negotiable: false,
            location: "Portland, Downtown".into(),
            shipping: id % 3 == 0,
            pickup: true,
            photos: vec![],
            status,
            created_at_ns: id,
            updated_at_ns: id,
        }
    }

    fn query() -> MarketQuery {
        MarketQuery {
            text: String::new(),
            category: None,
            condition: None,
            currency: None,
            min_price: None,
            max_price: None,
            free_only: false,
            shipping_only: false,
            location: String::new(),
            seller: None,
            sort: MarketSort::Newest,
            offset: 0,
            limit: 2,
            ids: None,
        }
    }

    #[test]
    fn checks_input() {
        assert!(check_input(&input()).is_ok());
        assert!(check_input(&ListingInput { title: "ab".into(), ..input() }).unwrap_err().contains("title"));
        assert!(check_input(&ListingInput { category: "weapons".into(), ..input() }).is_err());
        assert!(check_input(&ListingInput { currency: "XYZ".into(), ..input() }).is_err());
        assert!(check_input(&ListingInput { shipping: false, pickup: false, ..input() }).is_err());
        assert!(check_input(&ListingInput { photos: vec![], ..input() }).is_err());
        assert!(check_input(&ListingInput { title: "Bike\nnew".into(), ..input() }).is_err());
    }

    #[test]
    fn searches_filters_sorts_and_pages() {
        let all: Vec<Listing> = vec![
            listing(5, 900, ListingStatus::Active),
            listing(4, 0, ListingStatus::Reserved),
            listing(3, 300, ListingStatus::Sold),
            listing(2, 100, ListingStatus::Hidden),
            listing(1, 500, ListingStatus::Active),
        ];
        let page = search(all.clone().into_iter(), &query());
        assert_eq!(page.items.iter().map(|l| l.id).collect::<Vec<_>>(), vec![5, 4]);
        assert_eq!((page.total, page.next_offset), (3, Some(2)));

        let q = MarketQuery { sort: MarketSort::PriceLow, limit: 10, ..query() };
        assert_eq!(search(all.clone().into_iter(), &q).items.iter().map(|l| l.id).collect::<Vec<_>>(), vec![4, 1, 5]);

        let q = MarketQuery { category: Some("sports".into()), max_price: Some(600), limit: 10, ..query() };
        assert_eq!(search(all.clone().into_iter(), &q).items.iter().map(|l| l.id).collect::<Vec<_>>(), vec![1]);

        let q = MarketQuery { free_only: true, limit: 10, ..query() };
        assert_eq!(search(all.clone().into_iter(), &q).total, 1);

        let q = MarketQuery { text: "ITEM 5".into(), location: "downtown".into(), limit: 10, ..query() };
        assert_eq!(search(all.into_iter(), &q).items[0].id, 5);
    }
}

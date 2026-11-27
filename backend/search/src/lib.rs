//! OpenSocial search canister (`open-social-app-search`): one full-text index of
//! everything public in OpenSocial, so every search box asks one place.
//!
//! Documents are public profiles, market listings and space items (`kind`
//! is open: new kinds need no change here). The canisters that hold them
//! (`sources`) send each change with `index` as it happens, and a controller
//! can rebuild a kind from its source with `reindex`. Only public content is
//! sent: friends-only profiles, hidden spaces, reported items and sold
//! listings are removed.
//!
//! Index: postings (term, document) -> weight, document frequencies per
//! term, and each document's terms (to remove them on update). Queries match
//! all terms (the last one as a prefix while it is being typed), rank by
//! weight x rarity, then recency. Chinese, Japanese and Korean are indexed as
//! character pairs (see `text`).
//!
//! When it outgrows one canister, this one becomes the router and postings
//! move to shards by term; the query API stays the same.

mod text;

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{msg_caller, time};
use ic_cdk::call::Call;
use ic_cdk::{init, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

type Mem = VirtualMemory<DefaultMemoryImpl>;
type R<T> = Result<T, String>;

pub const MAX_TITLE: usize = 160;
pub const MAX_TEXT: usize = 6000;
pub const MAX_SNIPPET: usize = 200;
pub const MAX_TERMS_PER_DOC: usize = 400;
pub const MAX_BATCH: usize = 200;
/// Documents read per query term (rare terms decide; very common ones are cut).
const MAX_POSTINGS_PER_TERM: usize = 5000;
/// Index terms a prefix may expand to.
const MAX_PREFIX_TERMS: usize = 40;
pub const MAX_PAGE: u32 = 100;
/// Candidate ids one search may return for a source to filter (e.g. market filters).
pub const MAX_IDS: u32 = 1000;

/* ---------------------------------------------------------------- types --- */

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Doc {
    /// "profile", "listing", "space", ...
    pub kind: String,
    /// Unique within its kind (a principal, a listing id, ...).
    pub id: String,
    pub owner: Principal,
    pub title: String,
    pub text: String,
    pub tags: Vec<String>,
    pub updated_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct DocRef {
    pub kind: String,
    pub id: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
struct Stored {
    owner: Principal,
    title: String,
    snippet: String,
    terms: Vec<(String, u16)>,
    updated_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct Config {
    /// Canisters allowed to change the index.
    pub sources: Vec<Principal>,
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
candid_storable!(Stored, Config);

// Memory ids are permanent. Never reuse or renumber them.
const MEM_CONFIG: u8 = 0;
const MEM_DOCS: u8 = 1;
const MEM_POSTINGS: u8 = 2;
const MEM_DF: u8 = 3;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), 16));
    static CONFIG: RefCell<StableCell<Config, Mem>> = RefCell::new(StableCell::init(mem(MEM_CONFIG), Config::default()));
    /// kind 0x00 id -> document
    static DOCS: RefCell<StableBTreeMap<Vec<u8>, Stored, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_DOCS)));
    /// term 0x00 kind 0x00 id -> weight
    static POSTINGS: RefCell<StableBTreeMap<Vec<u8>, u16, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_POSTINGS)));
    /// term -> documents containing it
    static DF: RefCell<StableBTreeMap<String, u32, Mem>> = RefCell::new(StableBTreeMap::init(mem(MEM_DF)));
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

fn doc_key(kind: &str, id: &str) -> Vec<u8> {
    let mut k = kind.as_bytes().to_vec();
    k.push(0);
    k.extend_from_slice(id.as_bytes());
    k
}

fn split_doc_key(k: &[u8]) -> Option<(String, String)> {
    let i = k.iter().position(|b| *b == 0)?;
    Some((String::from_utf8(k[..i].to_vec()).ok()?, String::from_utf8(k[i + 1..].to_vec()).ok()?))
}

fn posting_key(term: &str, dk: &[u8]) -> Vec<u8> {
    let mut k = term.as_bytes().to_vec();
    k.push(0);
    k.extend_from_slice(dk);
    k
}

fn clip(s: &str, max: usize) -> String {
    s.chars().filter(|c| !c.is_control() || *c == '\n').take(max).collect()
}

/* ------------------------------------------------------------- indexing --- */

fn check_doc(d: &Doc) -> R<()> {
    let ok = |s: &str| !s.is_empty() && s.len() <= 64 && !s.contains('\0');
    if !ok(&d.kind) || !ok(&d.id) {
        return Err("Each document needs a kind and an id (1 to 64 bytes)".into());
    }
    Ok(())
}

pub fn remove_doc(kind: &str, id: &str) {
    let dk = doc_key(kind, id);
    let Some(old) = DOCS.with(|m| m.borrow_mut().remove(&dk)) else {
        return;
    };
    for (term, _) in old.terms {
        POSTINGS.with(|m| m.borrow_mut().remove(&posting_key(&term, &dk)));
        DF.with(|m| {
            let mut m = m.borrow_mut();
            match m.get(&term).unwrap_or(0) {
                0 | 1 => {
                    m.remove(&term);
                }
                n => {
                    m.insert(term, n - 1);
                }
            }
        });
    }
}

pub fn put_doc(d: Doc) -> R<()> {
    check_doc(&d)?;
    remove_doc(&d.kind, &d.id);
    let title = clip(&d.title, MAX_TITLE);
    let text = clip(&d.text, MAX_TEXT);
    let tags: Vec<String> = d.tags.iter().take(10).map(|t| clip(t, 40)).collect();
    let terms = text::weighted_terms(&title, &tags, &text, MAX_TERMS_PER_DOC);
    let dk = doc_key(&d.kind, &d.id);
    for (term, w) in &terms {
        POSTINGS.with(|m| m.borrow_mut().insert(posting_key(term, &dk), *w));
        DF.with(|m| {
            let mut m = m.borrow_mut();
            let n = m.get(term).unwrap_or(0);
            m.insert(term.clone(), n + 1);
        });
    }
    let snippet = clip(text.trim(), MAX_SNIPPET);
    DOCS.with(|m| {
        m.borrow_mut().insert(dk, Stored { owner: d.owner, title, snippet, terms, updated_at_ns: d.updated_at_ns })
    });
    Ok(())
}

/* -------------------------------------------------------------- queries --- */

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SearchQuery {
    pub text: String,
    /// Kinds to search; empty: all.
    pub kinds: Vec<String>,
    pub offset: u32,
    pub limit: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Hit {
    pub kind: String,
    pub id: String,
    pub owner: Principal,
    pub title: String,
    pub snippet: String,
    pub score: f32,
    pub updated_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct SearchPage {
    pub hits: Vec<Hit>,
    pub total: u64,
    pub next_offset: Option<u32>,
}

/// Index terms for one query term: itself, or (while typed) every term it starts.
fn expand(term: &str, prefix: bool) -> Vec<String> {
    if !prefix {
        return vec![term.to_string()];
    }
    DF.with(|m| {
        m.borrow().keys_range(term.to_string()..).take_while(|k| k.starts_with(term)).take(MAX_PREFIX_TERMS).collect()
    })
}

/// Ranked documents matching every query term, filtered by kind.
pub fn run(q: &SearchQuery) -> Vec<Hit> {
    let (terms, typing) = text::query_terms(&q.text);
    if terms.is_empty() {
        return vec![];
    }
    let kinds: BTreeSet<&str> = q.kinds.iter().map(String::as_str).collect();
    let n_docs = DOCS.with(|m| m.borrow().len()).max(1) as f32;
    let last = terms.len() - 1;
    let mut scores: BTreeMap<Vec<u8>, (usize, f32)> = BTreeMap::new();
    for (i, term) in terms.iter().enumerate() {
        let mut here: BTreeMap<Vec<u8>, f32> = BTreeMap::new();
        for t in expand(term, typing && i == last) {
            let df = DF.with(|m| m.borrow().get(&t)).unwrap_or(0) as f32;
            if df == 0.0 {
                continue;
            }
            let idf = (1.0 + n_docs / df).ln();
            let prefix = posting_key(&t, &[]);
            POSTINGS.with(|m| {
                for e in m
                    .borrow()
                    .range(prefix.clone()..)
                    .take_while(|e| e.key().starts_with(&prefix))
                    .take(MAX_POSTINGS_PER_TERM)
                {
                    let dk = e.key()[prefix.len()..].to_vec();
                    let s = here.entry(dk).or_default();
                    *s = s.max(e.value() as f32 * idf);
                }
            });
        }
        for (dk, s) in here {
            if i == 0 {
                scores.insert(dk, (1, s));
            } else if let Some(e) = scores.get_mut(&dk) {
                e.0 += 1;
                e.1 += s;
            }
        }
    }
    let mut hits: Vec<Hit> = scores
        .into_iter()
        .filter(|(_, (matched, _))| *matched == terms.len())
        .filter_map(|(dk, (_, score))| {
            let (kind, id) = split_doc_key(&dk)?;
            if !kinds.is_empty() && !kinds.contains(kind.as_str()) {
                return None;
            }
            let d = DOCS.with(|m| m.borrow().get(&dk))?;
            Some(Hit {
                kind,
                id,
                owner: d.owner,
                title: d.title,
                snippet: d.snippet,
                score,
                updated_at_ns: d.updated_at_ns,
            })
        })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(b.updated_at_ns.cmp(&a.updated_at_ns)));
    hits
}

/* -------------------------------------------------------------- canister --- */

fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone())
}

fn require_source() -> R<()> {
    let c = msg_caller();
    if ic_cdk::api::is_controller(&c) || config().sources.contains(&c) {
        Ok(())
    } else {
        Err("Only OpenSocial canisters can change the index".into())
    }
}

fn require_controller() -> R<()> {
    if ic_cdk::api::is_controller(&msg_caller()) {
        Ok(())
    } else {
        Err("Only controllers can do this".into())
    }
}

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub sources: Vec<Principal>,
}

#[init]
fn init(args: InitArgs) {
    CONFIG.with(|c| c.borrow_mut().set(Config { sources: args.sources }));
}

/// Sources: adds or replaces documents and removes others, in one call.
#[update]
fn index(put: Vec<Doc>, remove: Vec<DocRef>) -> R<()> {
    require_source()?;
    if put.len() + remove.len() > MAX_BATCH {
        return Err(format!("At most {MAX_BATCH} changes per call"));
    }
    for r in remove {
        remove_doc(&r.kind, &r.id);
    }
    for d in put {
        put_doc(d)?;
    }
    Ok(())
}

/// Ranked matches for a query.
#[query]
fn search(q: SearchQuery) -> SearchPage {
    let all = run(&q);
    let total = all.len() as u64;
    let limit = q.limit.clamp(1, MAX_PAGE) as usize;
    let start = (q.offset as usize).min(all.len());
    let hits: Vec<Hit> = all.into_iter().skip(start).take(limit).collect();
    let end = start + hits.len();
    SearchPage { hits, total, next_offset: ((end as u64) < total).then_some(end as u32) }
}

/// Ids of matching documents of one kind, best first (for a source to apply its own filters).
#[query]
fn search_ids(text: String, kind: String, limit: u32) -> Vec<String> {
    run(&SearchQuery { text, kinds: vec![kind], offset: 0, limit: 0 })
        .into_iter()
        .take(limit.clamp(1, MAX_IDS) as usize)
        .map(|h| h.id)
        .collect()
}

#[derive(CandidType, Deserialize, Debug)]
pub struct DocPage {
    pub docs: Vec<Doc>,
    /// Where to continue, unless done.
    pub next: Option<String>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct ReindexResult {
    pub indexed: u64,
    pub next: Option<String>,
    pub done: bool,
}

/// Controllers: rebuilds one kind from its source canister, a few pages per
/// call (`search_docs` there). Repeat with `next` until done. With no cursor,
/// the kind's current documents are dropped first.
#[update]
async fn reindex(source: Principal, kind: String, cursor: Option<String>, pages: u32) -> R<ReindexResult> {
    require_controller()?;
    if cursor.is_none() {
        let prefix = doc_key(&kind, "");
        let ids: Vec<String> = DOCS.with(|m| {
            m.borrow()
                .keys_range(prefix.clone()..)
                .take_while(|k| k.starts_with(&prefix))
                .filter_map(|k| split_doc_key(&k).map(|(_, id)| id))
                .collect()
        });
        for id in ids {
            remove_doc(&kind, &id);
        }
    }
    let mut cursor = cursor;
    let mut indexed = 0u64;
    for _ in 0..pages.max(1) {
        let page: R<DocPage> = Call::unbounded_wait(source, "search_docs")
            .with_args(&(kind.clone(), cursor.clone()))
            .await
            .map_err(|e| format!("search_docs failed: {e:?}"))?
            .candid()
            .map_err(|e| format!("search_docs reply: {e:?}"))?;
        let page = page?;
        for d in page.docs {
            if d.kind == kind {
                put_doc(d)?;
                indexed += 1;
            }
        }
        match page.next {
            Some(n) => cursor = Some(n),
            None => return Ok(ReindexResult { indexed, next: None, done: true }),
        }
    }
    Ok(ReindexResult { indexed, next: cursor, done: false })
}

#[update]
fn set_sources(sources: Vec<Principal>) -> R<()> {
    require_controller()?;
    CONFIG.with(|c| c.borrow_mut().set(Config { sources }));
    Ok(())
}

#[derive(CandidType, Deserialize, Debug)]
pub struct Stats {
    pub documents: u64,
    pub terms: u64,
    pub postings: u64,
    pub by_kind: Vec<(String, u64)>,
    pub sources: Vec<Principal>,
    pub cycles: u128,
}

#[query]
fn stats() -> Stats {
    let mut by_kind: BTreeMap<String, u64> = BTreeMap::new();
    DOCS.with(|m| {
        for k in m.borrow().keys() {
            if let Some((kind, _)) = split_doc_key(&k) {
                *by_kind.entry(kind).or_default() += 1;
            }
        }
    });
    Stats {
        documents: DOCS.with(|m| m.borrow().len()),
        terms: DF.with(|m| m.borrow().len()),
        postings: POSTINGS.with(|m| m.borrow().len()),
        by_kind: by_kind.into_iter().collect(),
        sources: config().sources,
        cycles: ic_cdk::api::canister_cycle_balance(),
    }
}

/// The time, for documents a controller adds by hand.
#[query]
fn now() -> u64 {
    time()
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(kind: &str, id: &str, title: &str, text: &str, at: u64) -> Doc {
        Doc {
            kind: kind.into(),
            id: id.into(),
            owner: Principal::anonymous(),
            title: title.into(),
            text: text.into(),
            tags: vec![],
            updated_at_ns: at,
        }
    }

    fn q(text: &str, kinds: &[&str]) -> Vec<String> {
        run(&SearchQuery {
            text: text.into(),
            kinds: kinds.iter().map(|k| k.to_string()).collect(),
            offset: 0,
            limit: 50,
        })
        .into_iter()
        .map(|h| h.id)
        .collect()
    }

    #[test]
    fn finds_ranks_updates_and_removes() {
        put_doc(doc("listing", "1", "Vintage road bike", "Steel frame, Brussels", 1)).unwrap();
        put_doc(doc("listing", "2", "Bike lights", "Front and back", 2)).unwrap();
        put_doc(doc("space", "9", "My bike trip", "Road to Ghent", 3)).unwrap();
        put_doc(doc("listing", "3", "二手自行车出售", "在布鲁塞尔", 4)).unwrap();

        assert_eq!(q("bike", &["listing"]), vec!["2".to_string(), "1".to_string()], "same weight: newest first");
        assert_eq!(q("road bike", &[]).len(), 2, "all terms must match");
        assert_eq!(q("road bi", &["listing"]), vec!["1".to_string()], "the last word is a prefix while typed");
        assert!(q("road bi ", &["listing"]).is_empty(), "a finished word must match whole");
        assert_eq!(q("自行车", &[]), vec!["3".to_string()]);
        assert_eq!(q("布鲁塞尔", &[]), vec!["3".to_string()]);
        assert!(q("自行车 ghent", &[]).is_empty());

        put_doc(doc("listing", "1", "Vintage road bike", "Sold to a friend in Antwerp", 5)).unwrap();
        assert!(q("brussels", &[]).is_empty(), "old terms are gone after an update");
        assert_eq!(q("antwerp", &[]), vec!["1".to_string()]);

        remove_doc("listing", "1");
        assert!(q("vintage", &[]).is_empty());
        assert_eq!(DF.with(|m| m.borrow().get(&"vintage".to_string())), None, "unused terms are dropped");
    }

    #[test]
    fn title_matches_rank_above_text_matches() {
        put_doc(doc("space", "a", "Lamp", "A desk light", 1)).unwrap();
        put_doc(doc("space", "b", "Desk", "with a lamp on it", 2)).unwrap();
        assert_eq!(q("lamp", &[]), vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn rejects_bad_documents() {
        assert!(put_doc(doc("", "1", "x", "", 0)).is_err());
        assert!(put_doc(doc("listing", "a\0b", "x", "", 0)).is_err());
    }

    #[test]
    fn candid_file() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_search.did"), __export_service()).unwrap();
    }
}

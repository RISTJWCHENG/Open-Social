//! Keeps the search canister (`open-social-app-search`) up to date: after a
//! change, the current public state of a document is sent there (or its
//! removal). Sending is best-effort and does not hold up the change; a
//! controller can rebuild the index from `search_docs` at any time.

use candid::{CandidType, Deserialize, Principal};
use ic_cdk::call::Call;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Doc {
    pub kind: String,
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

/// A page of documents for the search canister's `reindex`.
#[derive(CandidType, Deserialize, Debug, Default)]
pub struct DocPage {
    pub docs: Vec<Doc>,
    pub next: Option<String>,
}

/// Documents sent per call (the search canister takes 200).
const BATCH: usize = 150;

/// Sends documents to index and removals to the search canister, if one is set.
pub fn send(search: Option<Principal>, put: Vec<Doc>, remove: Vec<DocRef>) {
    let Some(search) = search else { return };
    if put.is_empty() && remove.is_empty() {
        return;
    }
    let mut put = put;
    let mut remove = remove;
    while !put.is_empty() || !remove.is_empty() {
        let r: Vec<DocRef> = remove.drain(..remove.len().min(BATCH)).collect();
        let p: Vec<Doc> = put.drain(..put.len().min(BATCH - r.len())).collect();
        ic_cdk::futures::spawn(async move {
            let _ = Call::bounded_wait(search, "index").with_args(&(p, r)).await;
        });
    }
}

/// Sends one document's current state: indexed when public, removed otherwise.
pub fn sync(search: Option<Principal>, kind: &str, id: String, doc: Option<Doc>) {
    match doc {
        Some(d) => send(search, vec![d], vec![]),
        None => send(search, vec![], vec![DocRef { kind: kind.into(), id }]),
    }
}

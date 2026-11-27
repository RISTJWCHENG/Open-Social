//! Copies stable maps between canisters page by page, as raw key and value
//! bytes (both sides use the same types), to move a module's data.

use candid::{CandidType, Deserialize};
use ic_stable_structures::{Memory, StableBTreeMap, Storable};
use serde_bytes::ByteBuf;
use std::borrow::Cow;
use std::ops::Bound;

/// Entries after `start`, up to about `max_bytes` (always at least one), and whether the map is done.
#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct Page {
    pub entries: Vec<(ByteBuf, ByteBuf)>,
    pub done: bool,
}

pub fn dump<K: Storable + Ord + Clone, V: Storable, M: Memory>(
    map: &StableBTreeMap<K, V, M>,
    start: Option<Vec<u8>>,
    max_bytes: usize,
) -> Page {
    let lower = match start {
        Some(b) => Bound::Excluded(K::from_bytes(Cow::Owned(b))),
        None => Bound::Unbounded,
    };
    let mut page = Page::default();
    let mut size = 0;
    for e in map.range((lower, Bound::Unbounded)) {
        let k = e.key().to_bytes().into_owned();
        let v = e.value().to_bytes().into_owned();
        size += k.len() + v.len();
        page.entries.push((ByteBuf::from(k), ByteBuf::from(v)));
        if size >= max_bytes {
            return page;
        }
    }
    page.done = true;
    page
}

pub fn load<K: Storable + Ord + Clone, V: Storable, M: Memory>(
    map: &mut StableBTreeMap<K, V, M>,
    entries: Vec<(ByteBuf, ByteBuf)>,
) {
    for (k, v) in entries {
        map.insert(K::from_bytes(Cow::Owned(k.into_vec())), V::from_bytes(Cow::Owned(v.into_vec())));
    }
}

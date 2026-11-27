//! Small shared pieces of the content modules: reports, text and image checks.

use candid::{CandidType, Decode, Deserialize, Encode};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::Storable;
use std::borrow::Cow;

pub const MAX_REPORT_REASON: usize = 300;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Report {
    pub reason: String,
    pub at_ns: u64,
}

impl Storable for Report {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode report"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode report")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), Report).expect("decode report")
    }
    const BOUND: Bound = Bound::Unbounded;
}

/// WebP, JPEG or PNG by magic bytes.
pub fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

pub fn clean_text(s: &str, max: usize) -> Result<String, String> {
    let t = s.trim();
    if t.chars().any(|c| c.is_control() && c != '\n') {
        return Err("Text contains control characters".into());
    }
    if t.chars().count() > max {
        return Err(format!("At most {max} characters"));
    }
    Ok(t.to_string())
}

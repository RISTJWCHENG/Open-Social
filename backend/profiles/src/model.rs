//! Records and limits. Records are Candid-encoded in stable memory.

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::Storable;
use std::borrow::Cow;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;
use unicode_script::{Script, UnicodeScript};

pub const MAX_PUBLIC_AVATAR: usize = 64 * 1024;
pub const MAX_SEALED: usize = 160 * 1024;
pub const MAX_DISPLAY_NAME: usize = 40;
pub const MAX_BIO: usize = 160;
pub const MAX_REPORT_REASON: usize = 300;
pub const MAX_LINKS: usize = 10;
pub const MAX_LINK_LABEL: usize = 30;
pub const MAX_LINK_URL: usize = 200;
pub const SEARCH_MIN: usize = 1;
pub const SEARCH_MAX_RESULTS: usize = 20;

#[derive(CandidType, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Visibility {
    Friends,
    Public,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct AvatarMeta {
    /// Hex SHA-256 of the image bytes (lets clients cache by content).
    pub hash: String,
    pub mime: String,
    pub size: u32,
    pub updated_at_ns: u64,
}

/// A labelled link on a public profile (https only).
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfileLink {
    pub label: String,
    pub url: String,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct SealedMeta {
    pub hash: String,
    pub size: u32,
    pub updated_at_ns: u64,
}

/// One account's profile. Large values (images, sealed blob) live in their own maps.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct ProfileRecord {
    pub visibility: Visibility,
    pub username: Option<String>,
    pub display_name: Option<String>,
    pub bio: Option<String>,
    /// Public links (public layer only).
    pub links: Vec<ProfileLink>,
    pub avatar: Option<AvatarMeta>,
    pub sealed: Option<SealedMeta>,
    pub created_at_ns: u64,
    pub updated_at_ns: u64,
}

impl ProfileRecord {
    pub fn new(now: u64) -> Self {
        ProfileRecord {
            visibility: Visibility::Friends,
            username: None,
            display_name: None,
            bio: None,
            links: Vec::new(),
            avatar: None,
            sealed: None,
            created_at_ns: now,
            updated_at_ns: now,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.visibility == Visibility::Friends && self.sealed.is_none() && self.avatar.is_none()
    }
}

impl Storable for ProfileRecord {
    fn to_bytes(&self) -> Cow<'_, [u8]> {
        Cow::Owned(Encode!(self).expect("encode profile"))
    }
    fn into_bytes(self) -> Vec<u8> {
        Encode!(&self).expect("encode profile")
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        Decode!(bytes.as_ref(), ProfileRecord).expect("decode profile")
    }
    const BOUND: Bound = Bound::Unbounded;
}

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

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Config {
    /// OpenSocial identity canister: only its accounts may store profiles.
    pub identity_canister: Option<Principal>,
    pub admins: Vec<Principal>,
    /// Profile writes per account per minute.
    pub writes_per_minute: u32,
    /// OpenSocial search canister, told about public profiles as they change.
    pub search_canister: Option<Principal>,
}

impl Default for Config {
    fn default() -> Self {
        Config { identity_canister: None, admins: vec![], writes_per_minute: 20, search_canister: None }
    }
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

/* ---------------------------------------------------------- validation --- */

pub const USERNAME_MIN: usize = 2;
pub const USERNAME_MAX: usize = 20;

/// The stored form of a username: NFKC (so full-width and other compatibility
/// forms become ordinary characters), trimmed, case kept as typed.
pub fn normalize_username(u: &str) -> String {
    u.trim().nfkc().collect()
}

/// The uniqueness and lookup key: the normalized username in lower case, so
/// "Ada", "ada" and "ＡＤＡ" are the same username.
pub fn username_key(u: &str) -> String {
    normalize_username(u).to_lowercase().nfkc().collect()
}

/// Checks a normalized username. Letters and digits of any language plus
/// dots and underscores, 2 to 20 characters, written in one writing system
/// (Latin may be combined with Chinese, Japanese or Korean) so that look-alike
/// letters from different alphabets cannot be mixed to imitate another name.
pub fn username_problem(u: &str) -> Option<&'static str> {
    let n = u.chars().count();
    if !(USERNAME_MIN..=USERNAME_MAX).contains(&n) {
        return Some("Username: 2-20 characters");
    }
    if !u.chars().all(|c| c.is_alphanumeric() || is_combining_mark(c) || c == '_' || c == '.') {
        return Some("Username: only letters, numbers, dots and underscores");
    }
    if u.chars().next().is_some_and(is_combining_mark) {
        return Some("Username: cannot start with an accent or vowel sign");
    }
    if !one_writing_system(u) {
        return Some("Username: use letters from one writing system");
    }
    None
}

fn one_writing_system(u: &str) -> bool {
    use Script::*;
    let mut used: Vec<Script> = u.chars().map(|c| c.script()).filter(|s| !matches!(s, Common | Inherited)).collect();
    used.dedup();
    if used.iter().all(|s| *s == used[0]) {
        return true;
    }
    let allowed: [&[Script]; 3] = [&[Latin, Han, Hiragana, Katakana], &[Latin, Han, Hangul], &[Latin, Han, Bopomofo]];
    allowed.iter().any(|set| used.iter().all(|s| set.contains(s)))
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

/// Checks and trims links: at most MAX_LINKS, https URLs only, short labels.
pub fn clean_links(links: Vec<ProfileLink>) -> Result<Vec<ProfileLink>, String> {
    if links.len() > MAX_LINKS {
        return Err(format!("At most {MAX_LINKS} links"));
    }
    links
        .into_iter()
        .map(|l| {
            let label = clean_text(&l.label, MAX_LINK_LABEL)?;
            let url = l.url.trim().to_string();
            let host_ok = url
                .strip_prefix("https://")
                .and_then(|rest| rest.split(['/', '?', '#']).next())
                .is_some_and(|h| h.contains('.') && !h.contains(['@', ' ']));
            if url.len() > MAX_LINK_URL || !host_ok || url.chars().any(|c| c.is_control() || c.is_whitespace()) {
                return Err("Links must be https:// web addresses".to_string());
            }
            Ok(ProfileLink { label, url })
        })
        .collect()
}

/// Lower-case search tokens: every prefix of the username key and of
/// each display-name word. Kept short so the index stays small.
pub fn search_tokens(username: Option<&str>, display_name: Option<&str>) -> Vec<String> {
    let mut words: Vec<String> = vec![];
    if let Some(u) = username {
        let key = username_key(u);
        words.extend(key.split(['.', '_']).filter(|w| !w.is_empty()).map(str::to_string));
        words.push(key);
    }
    if let Some(n) = display_name {
        words.extend(
            search_text(n)
                .split(|c: char| !c.is_alphanumeric() && !is_combining_mark(c))
                .filter(|w| !w.is_empty())
                .map(str::to_string),
        );
    }
    let mut out = vec![];
    for w in words {
        let chars: Vec<char> = w.chars().take(20).collect();
        for end in SEARCH_MIN..=chars.len() {
            out.push(chars[..end].iter().collect::<String>());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Folds text for search: compatibility forms to ordinary ones, lower case.
pub fn search_text(s: &str) -> String {
    s.nfkc().collect::<String>().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_cover_prefixes_of_username_and_words() {
        let t = search_tokens(Some("ada.lovelace"), Some("Ada Lovelace"));
        for want in ["ad", "ada", "ada.lovelace", "lo", "lovelace"] {
            assert!(t.contains(&want.to_string()), "{want}");
        }
        assert!(t.contains(&"a".to_string()) && t.contains(&"l".to_string()), "single letters");
    }

    #[test]
    fn record_roundtrip_and_images() {
        let r = ProfileRecord::new(5);
        assert_eq!(ProfileRecord::from_bytes(r.to_bytes()), r);
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a"), None);
        assert!(clean_text("x\u{0007}", 10).is_err());
        let ok =
            clean_links(vec![ProfileLink { label: " Site ".into(), url: "https://example.com/a".into() }]).unwrap();
        assert_eq!(ok[0].label, "Site");
        for bad in
            ["http://example.com", "javascript:alert(1)", "https://localhost", "https://a b.com", "https://u@x.com"]
        {
            assert!(clean_links(vec![ProfileLink { label: "x".into(), url: bad.into() }]).is_err(), "{bad}");
        }
    }

    #[test]
    fn usernames_in_any_language() {
        for ok in [
            "ada_l.1",
            "Ada.Lovelace",
            "张三",
            "王小明",
            "山田たろう",
            "김민수",
            "Tom王",
            "Müller",
            "Δημήτρης",
            "Иван",
            "محمد",
            "नमस्ते",
            "สมชาย",
            "ab",
        ] {
            assert_eq!(username_problem(&normalize_username(ok)), None, "{ok}");
        }
        for bad in [
            "a",
            "a b",
            "x\u{200B}y",
            "pаypal",
            "Ivаn",
            "abc\u{202E}",
            "\u{0301}abc",
            "a-b",
            "a@b",
            "abcdefghijklmnopqrstu",
        ] {
            assert!(username_problem(&normalize_username(bad)).is_some(), "{bad}");
        }
        assert_eq!(username_key("Ada"), "ada");
        assert_eq!(username_key("ＡＤＡ"), "ada");
        assert_eq!(normalize_username(" ＡＤＡ "), "ADA");
        let t = search_tokens(Some("Ada.Lovelace"), Some("王小明 Müller"));
        for want in ["ada", "lovelace", "ada.lovelace", "王", "王小明", "mü"] {
            assert!(t.contains(&want.to_string()), "{want}");
        }
        let hindi = search_tokens(None, Some("नमस्ते दुनिया"));
        assert!(hindi.contains(&"नमस्ते".to_string()), "marks stay inside words");
    }

    #[test]
    fn allows_up_to_ten_links() {
        let link = |i: usize| ProfileLink { label: format!("L{i}"), url: format!("https://site{i}.example") };
        assert_eq!(clean_links((0..10).map(link).collect()).unwrap().len(), 10);
        assert!(clean_links((0..11).map(link).collect()).is_err());
    }
}

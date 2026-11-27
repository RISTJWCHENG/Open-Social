//! A small gateway to HashFirst Global's public JSON APIs (article lists,
//! article text, prices, indexes), so the app reads the news site without its
//! readers ever contacting it. Only the paths below can be fetched; responses
//! are cached on the heap for a while and returned as text for the app to
//! parse and check.

const SITE: &str = "https://hashfirstglobal.com";
const MAX_BODY: u64 = 2_000_000;
const MAX_ENTRIES: usize = 60;
const MAX_TOTAL_BYTES: usize = 12_000_000;
const MINUTE_NS: u64 = 60 * 1_000_000_000;

type Cache = std::collections::BTreeMap<String, (u64, String)>;

thread_local! {
    static CACHE: std::cell::RefCell<Cache> = std::cell::RefCell::new(Cache::new());
}

fn slug_ok(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 200
        && slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// How long a path's response is kept, or None for a path that may not be fetched.
pub fn ttl(path: &str) -> Option<u64> {
    match path {
        "/api/search" | "/api/indexes" => return Some(10 * MINUTE_NS),
        "/api/prices" => return Some(2 * MINUTE_NS),
        _ => {}
    }
    if let Some(rest) = path.strip_prefix("/api/news/article?slug=") {
        let slug = rest.strip_suffix("&language=en")?;
        return slug_ok(slug).then_some(6 * 60 * MINUTE_NS);
    }
    let slug = path.strip_prefix("/api/opinion/article?slug=")?;
    slug_ok(slug).then_some(6 * 60 * MINUTE_NS)
}

pub fn cached(path: &str, now: u64) -> Option<String> {
    let ttl = ttl(path)?;
    CACHE.with(|c| c.borrow().get(path).filter(|(at, _)| now.saturating_sub(*at) < ttl).map(|(_, b)| b.clone()))
}

fn remember(path: &str, now: u64, body: String) {
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        c.insert(path.to_string(), (now, body));
        while c.len() > MAX_ENTRIES || c.values().map(|(_, b)| b.len()).sum::<usize>() > MAX_TOTAL_BYTES {
            let Some(oldest) = c.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) else { break };
            c.remove(&oldest);
        }
    });
}

/// The response body for an allowed path (from the cache when fresh).
pub async fn fetch(path: &str, now: u64) -> Result<String, String> {
    ttl(path).ok_or("This page can't be read here.")?;
    if let Some(body) = cached(path, now) {
        return Ok(body);
    }
    let bytes = crate::linkpreview::get_page(&format!("{SITE}{path}"), MAX_BODY, "application/json").await?;
    let body = String::from_utf8(bytes).map_err(|_| "The site sent unreadable data.")?;
    if serde_json::from_str::<serde_json::Value>(&body).is_err() {
        return Err("The site sent unreadable data.".into());
    }
    remember(path, now, body.clone());
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_known_api_paths() {
        assert!(ttl("/api/search").is_some());
        assert!(ttl("/api/prices").is_some());
        assert!(ttl("/api/indexes").is_some());
        assert!(ttl("/api/news/article?slug=btc-up&language=en").is_some());
        assert!(ttl("/api/opinion/article?slug=view_1").is_some());
        for bad in [
            "/api/dashboard/articles",
            "/api/news/article?slug=x&language=zh",
            "/api/news/article?slug=../x&language=en",
            "/api/opinion/article?slug=a&b=c",
            "/api/prices?page=2",
            "https://evil.example/api/search",
        ] {
            assert!(ttl(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn caches_and_evicts_the_oldest() {
        for i in 0..(MAX_ENTRIES as u64 + 3) {
            remember(&format!("/api/news/article?slug=s{i}&language=en"), i + 1, "{}".into());
        }
        assert!(cached("/api/news/article?slug=s0&language=en", 10).is_none());
        assert!(cached(&format!("/api/news/article?slug=s{}&language=en", MAX_ENTRIES + 2), 70).is_some());
        assert!(cached("/api/search", 1).is_none());
    }
}

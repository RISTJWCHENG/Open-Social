//! News: the latest ecosystem stories from HashFirst Global, fetched by the
//! canister and served to the app, so readers never contact the news site
//! (images arrive as small data URLs inside the feed). The feed is refreshed
//! on demand, at most every few minutes, when a signed-in reader asks; it
//! lives on the heap and is fetched again after an upgrade.

use candid::{CandidType, Deserialize};

pub const FEED_URL: &str = "https://hashfirstglobal.com/api/zcontact/ecosystem";
/// Stories must link to the news site itself.
const ARTICLE_PREFIXES: [&str; 2] = ["https://hashfirstglobal.com/", "https://www.hashfirstglobal.com/"];
const MAX_FEED_BYTES: u64 = 1_500_000;
pub const MAX_ITEMS: usize = 40;
const MAX_ID: usize = 100;
const MAX_TITLE: usize = 200;
const MAX_SUMMARY: usize = 400;
const MAX_PROTOCOL: usize = 40;
const MAX_SOURCE: usize = 60;
const MAX_URL: usize = 400;
/// Largest thumbnail (a data URL) per story.
pub const MAX_THUMB: usize = 30_000;
/// A refresh is skipped when the feed is younger than this.
pub const MIN_REFRESH_NS: u64 = 10 * 60 * 1_000_000_000;
/// A refresh that started this long ago without finishing is considered dead.
const REFRESH_TIMEOUT_NS: u64 = 2 * 60 * 1_000_000_000;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub summary: Option<String>,
    pub protocol: Option<String>,
    pub source: Option<String>,
    pub url: String,
    pub published_at_ms: u64,
    /// A small cover image as a data URL (webp, jpeg or png).
    pub thumb: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct NewsFeed {
    pub items: Vec<NewsItem>,
    /// When the feed was fetched (0: never).
    pub fetched_at_ns: u64,
}

/// A story's full text, as shown on the news site.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct NewsArticle {
    pub id: String,
    /// The article body HTML (the app keeps only safe text markup).
    pub content_html: String,
    /// The story's cover image, to fetch with `news_cover`.
    pub cover_url: Option<String>,
}

/// Longest article body kept.
const MAX_ARTICLE_HTML: usize = 300_000;
/// Articles and covers are fetched again after this long.
const ARTICLE_TTL_NS: u64 = 6 * 3_600 * 1_000_000_000;
const MAX_CACHED_ARTICLES: usize = 40;
const MAX_CACHED_COVERS: usize = 12;
const MAX_PAGE_BYTES: u64 = 2_000_000;

type Cached<T> = std::collections::BTreeMap<String, (u64, T)>;

thread_local! {
    static ARTICLES: std::cell::RefCell<Cached<NewsArticle>> = std::cell::RefCell::new(Cached::new());
    static COVERS: std::cell::RefCell<Cached<crate::linkpreview::PreviewImage>> =
        std::cell::RefCell::new(Cached::new());
    static FEED: std::cell::RefCell<NewsFeed> = std::cell::RefCell::new(NewsFeed::default());
    /// When the running refresh started (0: none).
    static REFRESHING_SINCE: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

pub fn feed() -> NewsFeed {
    FEED.with(|f| f.borrow().clone())
}

fn text(v: &serde_json::Value, max: usize) -> Option<String> {
    let s = v.as_str()?.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(max).collect())
}

fn is_thumb(s: &str) -> bool {
    let Some(data) = ["data:image/webp;base64,", "data:image/jpeg;base64,", "data:image/png;base64,"]
        .iter()
        .find_map(|p| s.strip_prefix(p))
    else {
        return false;
    };
    s.len() <= MAX_THUMB
        && !data.is_empty()
        && data.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

/// Reads the feed JSON (`{"items": [...]}`), keeping only well-formed stories
/// that link to the news site, newest first.
pub fn parse_feed(body: &[u8]) -> Result<Vec<NewsItem>, String> {
    let v: serde_json::Value = serde_json::from_slice(body).map_err(|_| "The news feed is not valid JSON")?;
    let list = v.get("items").and_then(|i| i.as_array()).ok_or("The news feed has no items")?;
    let mut items: Vec<NewsItem> = list
        .iter()
        .filter_map(|it| {
            let url = it.get("url")?.as_str()?.trim().to_string();
            if url.len() > MAX_URL
                || !ARTICLE_PREFIXES.iter().any(|p| url.starts_with(p))
                || url.chars().any(|c| c.is_whitespace() || c.is_control())
            {
                return None;
            }
            Some(NewsItem {
                id: text(it.get("id")?, MAX_ID)?,
                title: text(it.get("title")?, MAX_TITLE)?,
                summary: it.get("summary").and_then(|s| text(s, MAX_SUMMARY)),
                protocol: it.get("protocol").and_then(|s| text(s, MAX_PROTOCOL)),
                source: it.get("source").and_then(|s| text(s, MAX_SOURCE)),
                url,
                published_at_ms: it.get("publishedAt")?.as_u64()?,
                thumb: it.get("thumb").and_then(|t| t.as_str()).filter(|t| is_thumb(t)).map(str::to_string),
            })
        })
        .collect();
    items.sort_by(|a, b| b.published_at_ms.cmp(&a.published_at_ms));
    items.dedup_by(|a, b| a.id == b.id);
    items.truncate(MAX_ITEMS);
    Ok(items)
}

/// Fetches the feed again unless it is fresh or a refresh is running; returns the current feed.
pub async fn refresh(now: u64) -> Result<NewsFeed, String> {
    let fetched = FEED.with(|f| f.borrow().fetched_at_ns);
    let running = REFRESHING_SINCE.with(|r| r.get());
    if (fetched != 0 && now.saturating_sub(fetched) < MIN_REFRESH_NS)
        || (running != 0 && now.saturating_sub(running) < REFRESH_TIMEOUT_NS)
    {
        return Ok(feed());
    }
    REFRESHING_SINCE.with(|r| r.set(now));
    let result = crate::linkpreview::get_page(FEED_URL, MAX_FEED_BYTES, "application/json").await;
    REFRESHING_SINCE.with(|r| r.set(0));
    let items = parse_feed(&result?)?;
    FEED.with(|f| *f.borrow_mut() = NewsFeed { items, fetched_at_ns: ic_cdk::api::time() });
    Ok(feed())
}

fn cached<T: Clone>(
    cache: &'static std::thread::LocalKey<std::cell::RefCell<Cached<T>>>,
    id: &str,
    now: u64,
) -> Option<T> {
    cache
        .with(|c| c.borrow().get(id).filter(|(at, _)| now.saturating_sub(*at) < ARTICLE_TTL_NS).map(|(_, v)| v.clone()))
}

fn remember<T>(
    cache: &'static std::thread::LocalKey<std::cell::RefCell<Cached<T>>>,
    id: &str,
    now: u64,
    v: T,
    max: usize,
) {
    cache.with(|c| {
        let mut c = c.borrow_mut();
        c.insert(id.to_string(), (now, v));
        while c.len() > max {
            let oldest = c.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone());
            match oldest {
                Some(k) => c.remove(&k),
                None => break,
            };
        }
    });
}

pub fn cached_article(id: &str, now: u64) -> Option<NewsArticle> {
    cached(&ARTICLES, id, now)
}

pub fn cached_cover(id: &str, now: u64) -> Option<crate::linkpreview::PreviewImage> {
    cached(&COVERS, id, now)
}

/// The article's page address, for stories in the current feed only.
/// Stories are named by their ecosystem feed id, or "section/slug" for the
/// site's other sections.
fn story_url(id: &str) -> Result<String, String> {
    if let Some((section, slug)) = id.split_once('/') {
        let slug_ok = !slug.is_empty()
            && slug.len() <= 200
            && slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.');
        if !slug_ok {
            return Err("Invalid story".into());
        }
        let site = "https://hashfirstglobal.com";
        return match section {
            "news" => Ok(format!("{site}/news/en/{slug}")),
            "opinion" | "ecosystem" | "sponsored" => Ok(format!("{site}/{section}/{slug}")),
            "video" => Ok(format!("{site}/video?video={slug}")),
            _ => Err("Invalid story".into()),
        };
    }
    FEED.with(|f| f.borrow().items.iter().find(|i| i.id == id).map(|i| i.url.clone()))
        .ok_or_else(|| "This story is no longer in the news.".to_string())
}

/// The inner HTML of the page's article body: the `<article>` element styled
/// as the story text (its class carries the body's line height).
pub fn extract_body(html: &str) -> Option<String> {
    let marker = html.find("leading-[1.78]")?;
    let start = html[..marker].rfind('<')?;
    let name: String = html[start + 1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    if name.is_empty() {
        return None;
    }
    let open_end = start + tag_end(&html[start..])? + 1;
    let close = open_end + closing_tag(&html[open_end..], &name)?;
    let body = html[open_end..close].trim();
    (!body.is_empty() && body.len() <= MAX_ARTICLE_HTML).then(|| body.to_string())
}

/// Where the element's closing tag starts, skipping nested elements of the same name.
fn closing_tag(rest: &str, name: &str) -> Option<usize> {
    let (open, close) = (format!("<{name}"), format!("</{name}>"));
    let mut depth = 0usize;
    let mut i = 0;
    while i < rest.len() {
        let r = &rest[i..];
        if r.starts_with(&close) {
            if depth == 0 {
                return Some(i);
            }
            depth -= 1;
            i += close.len();
        } else if r.starts_with(&open) && r[open.len()..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace()) {
            depth += 1;
            i += open.len();
        } else {
            i += r.chars().next()?.len_utf8();
        }
    }
    None
}

/// Where a start tag ends: its first `>` outside quoted attribute values.
fn tag_end(tag: &str) -> Option<usize> {
    let mut quote = None;
    for (i, b) in tag.bytes().enumerate() {
        match (quote, b) {
            (None, b'"' | b'\'') => quote = Some(b),
            (Some(q), _) if b == q => quote = None,
            (None, b'>') => return Some(i),
            _ => {}
        }
    }
    None
}

/// Fetches a story's page and keeps its body and cover address.
pub async fn fetch_article(id: &str, now: u64) -> Result<NewsArticle, String> {
    let url = story_url(id)?;
    let page = crate::linkpreview::get_page(&url, MAX_PAGE_BYTES, "text/html").await?;
    let html = String::from_utf8_lossy(&page);
    // Some pages (videos, or text the app reads from the site's JSON) have no body here.
    let content_html = extract_body(&html).unwrap_or_default();
    let cover_url =
        crate::linkpreview::parse_page(&html, &url).image_url.filter(|u| crate::linkpreview::check_url(u).is_ok());
    let article = NewsArticle { id: id.to_string(), content_html, cover_url };
    remember(&ARTICLES, id, now, article.clone(), MAX_CACHED_ARTICLES);
    Ok(article)
}

/// Fetches a story's cover image (via its article page).
pub async fn fetch_cover(id: &str, now: u64) -> Result<crate::linkpreview::PreviewImage, String> {
    let article = match cached_article(id, now) {
        Some(a) => a,
        None => fetch_article(id, now).await?,
    };
    let url = article.cover_url.ok_or("This story has no cover.")?;
    let image = crate::linkpreview::fetch_image(&url).await?;
    remember(&COVERS, id, now, image.clone(), MAX_CACHED_COVERS);
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_well_formed_stories_from_the_site_newest_first() {
        let thumb = format!("data:image/webp;base64,{}", "A".repeat(40));
        let body = serde_json::json!({ "items": [
            { "id": "a", "title": "  Old   story ", "url": "https://hashfirstglobal.com/ecosystem/a", "publishedAt": 1 },
            { "id": "b", "title": "New", "summary": "Sum", "protocol": "Internet Computer", "source": "Forum",
              "url": "https://www.hashfirstglobal.com/ecosystem/b", "publishedAt": 5, "thumb": thumb },
            { "id": "c", "title": "Elsewhere", "url": "https://evil.example/c", "publishedAt": 3 },
            { "id": "d", "url": "https://hashfirstglobal.com/d", "publishedAt": 3 },
            { "id": "e", "title": "Bad thumb", "url": "https://hashfirstglobal.com/e", "publishedAt": 2,
              "thumb": "javascript:alert(1)" },
            { "id": "b", "title": "Duplicate", "url": "https://hashfirstglobal.com/b2", "publishedAt": 5 }
        ]});
        let items = parse_feed(body.to_string().as_bytes()).unwrap();
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["b", "e", "a"]);
        assert_eq!(items[0].thumb.as_deref(), Some(thumb.as_str()));
        assert_eq!(items[0].protocol.as_deref(), Some("Internet Computer"));
        assert_eq!(items[1].thumb, None);
        assert_eq!(items[2].title, "Old story");
    }

    #[test]
    fn caps_counts_and_lengths() {
        let list: Vec<_> = (0..60)
            .map(|i| {
                serde_json::json!({ "id": format!("{i}"), "title": "x".repeat(500),
                "url": format!("https://hashfirstglobal.com/{i}"), "publishedAt": i })
            })
            .collect();
        let items = parse_feed(serde_json::json!({ "items": list }).to_string().as_bytes()).unwrap();
        assert_eq!(items.len(), MAX_ITEMS);
        assert_eq!(items[0].id, "59");
        assert_eq!(items[0].title.chars().count(), MAX_TITLE);
    }

    #[test]
    fn extracts_the_story_body() {
        let html = r#"<main><article class="x">nav</article><h1>T</h1>
            <article class="
              font-serif text-[17px] leading-[1.78]
              [&>p]:mb-6"><p>One</p><h2>Two</h2></article><footer/></main>"#;
        assert_eq!(extract_body(html).as_deref(), Some("<p>One</p><h2>Two</h2>"));
        assert_eq!(extract_body("<article>no marker</article>"), None);
    }

    #[test]
    fn extracts_a_body_div_with_nested_divs() {
        let html = r#"<div class="a"><div class="mt-6 font-serif leading-[1.78]"><p>A</p><div>B</div></div><div>after</div></div>"#;
        assert_eq!(extract_body(html).as_deref(), Some("<p>A</p><div>B</div>"));
    }

    #[test]
    fn names_section_stories_by_section_and_slug() {
        assert_eq!(story_url("news/btc-rally").unwrap(), "https://hashfirstglobal.com/news/en/btc-rally");
        assert_eq!(story_url("opinion/x_1").unwrap(), "https://hashfirstglobal.com/opinion/x_1");
        assert_eq!(story_url("video/clip").unwrap(), "https://hashfirstglobal.com/video?video=clip");
        assert!(story_url("news/../admin").is_err());
        assert!(story_url("dashboard/x").is_err());
        assert!(story_url("news/a b").is_err());
    }

    #[test]
    fn caches_with_a_size_limit() {
        for i in 0..(MAX_CACHED_ARTICLES as u64 + 5) {
            let a = NewsArticle { id: format!("{i}"), content_html: "x".into(), cover_url: None };
            remember(&ARTICLES, &format!("{i}"), i + 1, a, MAX_CACHED_ARTICLES);
        }
        assert!(cached_article("0", 10).is_none(), "the oldest entries are dropped");
        assert!(cached_article("44", 50).is_some());
        assert!(cached_article("44", 50 + ARTICLE_TTL_NS).is_none(), "entries expire");
    }

    #[test]
    fn rejects_non_json_and_oversized_thumbs() {
        assert!(parse_feed(b"<html>").is_err());
        assert!(!is_thumb(&format!("data:image/webp;base64,{}", "A".repeat(MAX_THUMB))));
        assert!(!is_thumb("data:image/svg+xml;base64,AAAA"));
    }
}

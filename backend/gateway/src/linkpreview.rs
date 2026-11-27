//! Link previews: the sender's app asks the canister to read a web page's
//! Open Graph tags (title, description, site name, image) so the preview can be
//! embedded, end-to-end encrypted, in the message. Receivers never contact the
//! site. The page is fetched with a non-replicated HTTPS outcall (one node), and
//! nothing is stored: the preview goes straight back to the caller. The image is
//! a second call, so the app can show the text while the image loads.

use candid::{CandidType, Deserialize, Principal};
use ic_management_canister_types::{HttpHeader, HttpMethod, HttpRequestArgs, HttpRequestResult};
use serde_bytes::ByteBuf;

pub const MAX_URL_LEN: usize = 2_048;
pub const MAX_TITLE: usize = 200;
pub const MAX_DESCRIPTION: usize = 300;
pub const MAX_SITE: usize = 60;
/// Largest page and image the outcall accepts (the outcall hard limit is 2 MB).
const MAX_PAGE_BYTES: u64 = 2_000_000;
const MAX_IMAGE_BYTES: u64 = 1_500_000;
const MAX_REDIRECTS: usize = 3;
const OUTCALL_CYCLES: u128 = 30_000_000_000;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; OpenSocialBot/1.0; +https://opensocial.cc; like TwitterBot)";

#[derive(CandidType, Deserialize, Debug, Default, PartialEq)]
pub struct LinkPreview {
    /// The page address after redirects.
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    /// The page's preview image, to fetch with `fetch_image`.
    pub image_url: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct PreviewImage {
    /// The image as fetched (the app resizes it before sending).
    pub bytes: ByteBuf,
    pub content_type: String,
}

/// Accepts only absolute https URLs without credentials or whitespace.
pub fn check_url(url: &str) -> Result<(), String> {
    let rest = url.strip_prefix("https://").ok_or("Only https links can be previewed")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let ok = url.len() <= MAX_URL_LEN
        && !host.is_empty()
        && host.contains('.')
        && !host.contains('@')
        && !url.chars().any(|c| c.is_whitespace() || c.is_control());
    if ok {
        Ok(())
    } else {
        Err("Invalid link".into())
    }
}

/// Resolves `href` (absolute, protocol-relative, root-relative or relative) against `base`.
pub fn resolve(base: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty() || href.starts_with("data:") || href.starts_with("javascript:") {
        return None;
    }
    if href.starts_with("https://") || href.starts_with("http://") {
        return Some(href.replacen("http://", "https://", 1));
    }
    let scheme_end = base.find("://")? + 3;
    let host_end = base[scheme_end..].find('/').map(|i| scheme_end + i).unwrap_or(base.len());
    let origin = &base[..host_end];
    if let Some(rest) = href.strip_prefix("//") {
        return Some(format!("https://{rest}"));
    }
    if href.starts_with('/') {
        return Some(format!("{origin}{href}"));
    }
    let path = base[host_end..].split(['?', '#']).next().unwrap_or("");
    let dir = &path[..path.rfind('/').map(|i| i + 1).unwrap_or(0)];
    let dir = if dir.is_empty() { "/" } else { dir };
    Some(format!("{origin}{dir}{href}"))
}

/// Decodes the common HTML character references.
pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest[..rest.len().min(12)].find(';');
        let decoded = end.and_then(|e| {
            let name = &rest[1..e];
            let c = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => {
                    let n = if let Some(h) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                        u32::from_str_radix(h, 16).ok()
                    } else {
                        name.strip_prefix('#').and_then(|d| d.parse().ok())
                    };
                    n.and_then(char::from_u32)
                }
            };
            c.map(|c| (c, e))
        });
        match decoded {
            Some((c, e)) => {
                out.push(c);
                rest = &rest[e + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Collapses whitespace, decodes entities and caps the length (in characters).
fn clean(s: &str, max: usize) -> Option<String> {
    let s = decode_entities(s);
    let s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() {
        return None;
    }
    let mut chars = s.chars();
    let mut out: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        out.pop();
        out.push('…');
    }
    Some(out)
}

/// The attributes of one tag, names lower-cased.
fn attributes(tag: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = tag.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let start = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' {
            i += 1;
        }
        let name = tag[start..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut value = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                let vs = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                value = tag[vs..i].to_string();
                i += 1;
            } else {
                let vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() {
                    i += 1;
                }
                value = tag[vs..i].to_string();
            }
        }
        if !name.is_empty() {
            out.push((name, value));
        }
    }
    out
}

/// Preview fields found in a page (the image as an absolute URL).
#[derive(Debug, Default, PartialEq)]
pub struct PageMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_url: Option<String>,
}

/// Reads Open Graph / Twitter / standard meta tags and `<title>` from the page head.
pub fn parse_page(html: &str, page_url: &str) -> PageMeta {
    // Meta tags live in the head; stop at <body> to avoid scanning large pages.
    let lower = html.to_ascii_lowercase();
    let head_end = lower.find("<body").unwrap_or(lower.len());
    let (html, lower) = (&html[..head_end], &lower[..head_end]);
    let mut og = std::collections::HashMap::<String, String>::new();
    let mut pos = 0;
    while let Some(i) = lower[pos..].find("<meta") {
        let start = pos + i + 5;
        let Some(len) = lower[start..].find('>') else { break };
        let attrs = attributes(&html[start..start + len]);
        let key = attrs.iter().find(|(n, _)| n == "property" || n == "name").map(|(_, v)| v.to_ascii_lowercase());
        let content = attrs.iter().find(|(n, _)| n == "content").map(|(_, v)| v.clone());
        if let (Some(k), Some(c)) = (key, content) {
            og.entry(k).or_insert(c);
        }
        pos = start + len;
    }
    let title_tag = lower.find("<title").and_then(|i| {
        let open = i + lower[i..].find('>')? + 1;
        let close = open + lower[open..].find("</title")?;
        Some(html[open..close].to_string())
    });
    let pick = |keys: &[&str]| keys.iter().find_map(|k| og.get(*k).filter(|v| !v.trim().is_empty()).cloned());
    PageMeta {
        title: pick(&["og:title", "twitter:title"]).or(title_tag).and_then(|t| clean(&t, MAX_TITLE)),
        description: pick(&["og:description", "twitter:description", "description"])
            .and_then(|d| clean(&d, MAX_DESCRIPTION)),
        site_name: pick(&["og:site_name", "application-name"]).and_then(|s| clean(&s, MAX_SITE)),
        image_url: pick(&["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"])
            .and_then(|u| resolve(page_url, &decode_entities(&u))),
    }
}

fn header<'a>(res: &'a HttpRequestResult, name: &str) -> Option<&'a str> {
    res.headers.iter().find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

async fn get(url: &str, max_bytes: u64, accept: &str) -> Result<HttpRequestResult, String> {
    let args = HttpRequestArgs {
        url: url.to_string(),
        max_response_bytes: Some(max_bytes),
        method: HttpMethod::GET,
        headers: vec![
            HttpHeader { name: "User-Agent".into(), value: USER_AGENT.into() },
            HttpHeader { name: "Accept".into(), value: accept.into() },
            HttpHeader { name: "Accept-Language".into(), value: "en,*;q=0.5".into() },
        ],
        body: None,
        transform: None,
        is_replicated: Some(false),
        pricing_version: Some(2),
    };
    let res = ic_cdk::call::Call::unbounded_wait(Principal::management_canister(), "http_request")
        .with_arg(args)
        .with_cycles(OUTCALL_CYCLES)
        .await
        .map_err(|_| "The site could not be reached".to_string())?;
    res.candid().map_err(|_| "The site could not be reached".to_string())
}

/// GET that follows a few redirects; returns the final URL and response.
async fn get_following(url: &str, max_bytes: u64, accept: &str) -> Result<(String, HttpRequestResult), String> {
    let mut url = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let res = get(&url, max_bytes, accept).await?;
        let status: u64 = res.status.0.clone().try_into().unwrap_or(0);
        if (300..400).contains(&status) {
            let next = header(&res, "location").and_then(|l| resolve(&url, l)).ok_or("Bad redirect")?;
            check_url(&next)?;
            url = next;
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(format!("The site answered {status}"));
        }
        return Ok((url, res));
    }
    Err("Too many redirects".into())
}

/// The body of a successful GET (following redirects), for other canister features.
pub async fn get_page(url: &str, max_bytes: u64, accept: &str) -> Result<Vec<u8>, String> {
    Ok(get_following(url, max_bytes, accept).await?.1.body)
}

/// YouTube pages carry no useful tags for bots; its oEmbed endpoint does.
pub fn youtube_oembed(url: &str) -> Option<String> {
    let host = url.strip_prefix("https://")?.split(['/', '?', '#']).next()?.to_ascii_lowercase();
    let host = host.strip_prefix("www.").or_else(|| host.strip_prefix("m.")).unwrap_or(&host);
    if host != "youtube.com" && host != "youtu.be" {
        return None;
    }
    let encoded: String = url
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    Some(format!("https://www.youtube.com/oembed?format=json&url={encoded}"))
}

/// Reads a page's preview text and image address.
pub async fn fetch(url: &str) -> Result<LinkPreview, String> {
    check_url(url)?;
    if let Some(oembed) = youtube_oembed(url) {
        let (_, res) = get_following(&oembed, 64_000, "application/json").await?;
        let v: serde_json::Value = serde_json::from_slice(&res.body).map_err(|_| "No preview for this page")?;
        let field = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
        let title = field("title").and_then(|t| clean(&t, MAX_TITLE)).ok_or("No preview for this page")?;
        return Ok(LinkPreview {
            url: url.to_string(),
            title: Some(title),
            description: field("author_name").and_then(|a| clean(&a, MAX_DESCRIPTION)),
            site_name: Some("YouTube".into()),
            image_url: field("thumbnail_url").and_then(|u| resolve(url, &u)).filter(|u| check_url(u).is_ok()),
        });
    }
    let (final_url, page) = get_following(url, MAX_PAGE_BYTES, "text/html,application/xhtml+xml").await?;
    let content_type = header(&page, "content-type").unwrap_or("").to_ascii_lowercase();
    if !content_type.is_empty() && !content_type.contains("html") {
        return Err("Not a web page".into());
    }
    let meta = parse_page(&String::from_utf8_lossy(&page.body), &final_url);
    if meta.title.is_none() && meta.description.is_none() {
        return Err("No preview for this page".into());
    }
    Ok(LinkPreview {
        url: final_url,
        title: meta.title,
        description: meta.description,
        site_name: meta.site_name,
        image_url: meta.image_url.filter(|u| check_url(u).is_ok()),
    })
}

/// Fetches a preview image (raster formats only).
pub async fn fetch_image(url: &str) -> Result<PreviewImage, String> {
    check_url(url)?;
    let (_, img) = get_following(url, MAX_IMAGE_BYTES, "image/webp,image/png,image/jpeg,image/*").await?;
    let kind = header(&img, "content-type").unwrap_or("").split(';').next().unwrap_or("").trim().to_lowercase();
    if !kind.starts_with("image/") || kind == "image/svg+xml" || img.body.is_empty() {
        return Err(format!("Not a usable image ({kind})"));
    }
    Ok(PreviewImage { bytes: ByteBuf::from(img.body), content_type: kind })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_urls() {
        assert!(check_url("https://example.com/a?b=1").is_ok());
        for bad in [
            "http://example.com",
            "https://",
            "https://localhost/x",
            "https://a@b.com",
            "https://a.com/ x",
            "ftp://a.com",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn resolves_relative_urls() {
        let base = "https://a.com/news/item.html?x=1";
        assert_eq!(resolve(base, "/img.png").unwrap(), "https://a.com/img.png");
        assert_eq!(resolve(base, "img.png").unwrap(), "https://a.com/news/img.png");
        assert_eq!(resolve(base, "//cdn.a.com/i.jpg").unwrap(), "https://cdn.a.com/i.jpg");
        assert_eq!(resolve(base, "http://b.com/i.jpg").unwrap(), "https://b.com/i.jpg");
        assert_eq!(resolve("https://a.com", "i.png").unwrap(), "https://a.com/i.png");
        assert!(resolve(base, "data:image/png;base64,xx").is_none());
    }

    #[test]
    fn uses_oembed_for_youtube_only() {
        assert_eq!(
            youtube_oembed("https://www.youtube.com/watch?v=dQw4w9WgXcQ").unwrap(),
            "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
        );
        assert!(youtube_oembed("https://youtu.be/abc").is_some());
        assert!(youtube_oembed("https://notyoutube.com/x").is_none());
    }

    #[test]
    fn decodes_entities() {
        assert_eq!(
            decode_entities("Tom &amp; Jerry &#39;s &#x4E2D; &quot;x&quot; &bogus; &"),
            "Tom & Jerry 's 中 \"x\" &bogus; &"
        );
    }

    #[test]
    fn parses_open_graph() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Big &amp; News">
            <meta name='description' content='  A   long
               description '>
            <meta content="Example" property="og:site_name" />
            <meta property=og:image content="/cover.jpg">
            </head><body><meta property="og:title" content="ignored"></body></html>"#;
        let m = parse_page(html, "https://example.com/post/1");
        assert_eq!(m.title.as_deref(), Some("Big & News"));
        assert_eq!(m.description.as_deref(), Some("A long description"));
        assert_eq!(m.site_name.as_deref(), Some("Example"));
        assert_eq!(m.image_url.as_deref(), Some("https://example.com/cover.jpg"));
    }

    #[test]
    fn falls_back_to_title_tag_and_caps_length() {
        let long = "x".repeat(500);
        let html = format!("<head><TITLE> Plain {long} </TITLE></head>");
        let m = parse_page(&html, "https://e.com");
        let t = m.title.unwrap();
        assert_eq!(t.chars().count(), MAX_TITLE);
        assert!(t.starts_with("Plain x") && t.ends_with('…'));
        assert_eq!(m.image_url, None);
    }
}

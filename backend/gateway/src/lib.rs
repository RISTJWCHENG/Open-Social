//! OpenSocial gateway (`open-social-app-gateway`): reads the web on behalf of
//! OpenSocial accounts, so the identity canister only handles accounts and
//! sign-in. Link previews (embedded by the sender's app in the encrypted
//! message; nothing is stored), the news feed with stories and covers, and
//! the HashFirst Global API. Responses are cached in the heap; outcalls are
//! non-replicated and limited per account, since each costs cycles.
//!
//! Callers must be OpenSocial accounts. The identity canister confirms an
//! account once (`home_of`); the answer is kept for a day, so later calls
//! need no inter-canister call.

mod hashfirst;
mod linkpreview;
mod news;

use candid::{CandidType, Deserialize, Principal};
use ic_cdk::api::{msg_caller, time};
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

type R<T> = Result<T, String>;

/// Outcalls (pages and images) one account may cause per hour.
const PREVIEW_CALLS_PER_HOUR: u32 = 120;
/// How long a confirmed account is trusted without asking again.
const ACCOUNT_TTL_NS: u64 = 24 * 3600 * 1_000_000_000;
/// Confirmed accounts kept at most (the oldest go first).
const MAX_KNOWN: usize = 200_000;

thread_local! {
    static IDENTITY: Cell<Option<Principal>> = const { Cell::new(None) };
    /// account principal -> confirmed until (ns)
    static KNOWN: RefCell<BTreeMap<Principal, u64>> = RefCell::new(BTreeMap::new());
    /// account principal -> (hour, outcalls in that hour)
    static PREVIEWS: RefCell<BTreeMap<Principal, (u64, u32)>> = RefCell::new(BTreeMap::new());
}

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub identity: Principal,
}

#[init]
fn init(args: InitArgs) {
    IDENTITY.with(|c| c.set(Some(args.identity)));
}

#[post_upgrade]
fn post_upgrade(args: InitArgs) {
    IDENTITY.with(|c| c.set(Some(args.identity)));
}

/// Checks that the caller is an OpenSocial account (asking the identity canister at most once a day).
async fn require_account() -> R<Principal> {
    let caller = msg_caller();
    let now = time();
    if KNOWN.with(|k| k.borrow().get(&caller).is_some_and(|until| *until > now)) {
        return Ok(caller);
    }
    if caller == Principal::anonymous() {
        return Err("Sign in first".into());
    }
    // Controllers may call too (operations and checks).
    if ic_cdk::api::is_controller(&caller) {
        return Ok(caller);
    }
    let identity = IDENTITY.with(|c| c.get()).ok_or("Not configured")?;
    let home: Option<Principal> = Call::bounded_wait(identity, "home_of")
        .with_arg(caller)
        .await
        .map_err(|e| format!("Could not check the account: {e:?}"))?
        .candid()
        .map_err(|e| format!("Could not check the account: {e:?}"))?;
    if home.is_none() {
        return Err("Sign in first".into());
    }
    KNOWN.with(|k| {
        let mut k = k.borrow_mut();
        if k.len() >= MAX_KNOWN {
            k.retain(|_, until| *until > now);
            if k.len() >= MAX_KNOWN {
                k.clear();
            }
        }
        k.insert(caller, now + ACCOUNT_TTL_NS);
    });
    Ok(caller)
}

fn allowance(account: Principal) -> R<()> {
    let hour = time() / 3_600_000_000_000;
    PREVIEWS.with(|p| {
        let mut p = p.borrow_mut();
        p.retain(|_, (h, _)| *h == hour);
        let e = p.entry(account).or_insert((hour, 0));
        if e.1 >= PREVIEW_CALLS_PER_HOUR {
            return Err("Too many link previews. Try again later.".to_string());
        }
        e.1 += 1;
        Ok(())
    })
}

/// Reads a web page's preview (title, description, site name, image address)
/// for the sender's app, which embeds it in the encrypted message. Nothing is stored.
#[update]
async fn link_preview(url: String) -> R<linkpreview::LinkPreview> {
    linkpreview::check_url(&url)?;
    allowance(require_account().await?)?;
    linkpreview::fetch(&url).await
}

/// Fetches a link preview's image for the sender's app. Nothing is stored.
#[update]
async fn link_preview_image(url: String) -> R<linkpreview::PreviewImage> {
    linkpreview::check_url(&url)?;
    allowance(require_account().await?)?;
    linkpreview::fetch_image(&url).await
}

/// The latest news stories (as last fetched; empty until someone refreshes).
#[query]
fn news() -> news::NewsFeed {
    news::feed()
}

/// Fetches the news again if it is older than a few minutes; any signed-in reader may ask.
#[update]
async fn refresh_news() -> R<news::NewsFeed> {
    require_account().await?;
    news::refresh(time()).await
}

/// A story's full text if the canister has it at hand (no fetch).
#[query]
fn cached_news_article(id: String) -> Option<news::NewsArticle> {
    news::cached_article(&id, time())
}

/// A story's full text; fetched from the news site when not at hand.
#[update]
async fn news_article(id: String) -> R<news::NewsArticle> {
    let account = require_account().await?;
    if let Some(a) = news::cached_article(&id, time()) {
        return Ok(a);
    }
    allowance(account)?;
    news::fetch_article(&id, time()).await
}

/// A story's cover image if the canister has it at hand (no fetch).
#[query]
fn cached_news_cover(id: String) -> Option<linkpreview::PreviewImage> {
    news::cached_cover(&id, time())
}

/// A story's cover image; fetched from the news site when not at hand.
#[update]
async fn news_cover(id: String) -> R<linkpreview::PreviewImage> {
    let account = require_account().await?;
    if let Some(c) = news::cached_cover(&id, time()) {
        return Ok(c);
    }
    allowance(account)?;
    news::fetch_cover(&id, time()).await
}

/// A HashFirst Global API response if the canister has it at hand (no fetch).
#[query]
fn cached_hashfirst(path: String) -> Option<String> {
    hashfirst::cached(&path, time())
}

/// A HashFirst Global API response (allowed paths only); fetched when not at hand.
#[update]
async fn hashfirst(path: String) -> R<String> {
    let account = require_account().await?;
    hashfirst::ttl(&path).ok_or("This page can't be read here.")?;
    if let Some(body) = hashfirst::cached(&path, time()) {
        return Ok(body);
    }
    allowance(account)?;
    hashfirst::fetch(&path, time()).await
}

ic_cdk::export_candid!();

#[cfg(test)]
mod candid_file {
    /// Writes the Candid interface (kept in the repo).
    #[test]
    fn write_did() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_gateway.did"), super::__export_service())
            .unwrap();
    }
}

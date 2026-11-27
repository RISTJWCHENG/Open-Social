//! OpenSocial identity canister.
//!
//! Each OpenSocial account is created by one sign-in method (Internet Identity,
//! passkey or email code). After the method is verified, the canister issues a
//! canister-signed delegation for the account principal, the same mechanism
//! Internet Identity uses. The account principal never changes, whichever
//! frontend origin is used. The canister also keeps the device key directory,
//! MLS key packages and the offline mailbox.

mod email;
mod mailbox;
mod state;

mod verify;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use candid::{CandidType, Deserialize, Principal};
use ic_canister_sig_creation::{
    delegation_signature_msg, hash_bytes, signature_map::CanisterSigInputs, CanisterSigPublicKey, DELEGATION_SIG_DOMAIN,
};
use ic_cdk::api::{canister_self, certified_data_set, msg_caller, time};
use ic_cdk::{init, post_upgrade, query, update};
use ic_certification::labeled_hash;
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use state::{
    account_of, prune_challenges, settings, update_settings, AccountId, Challenge, ChallengeKind, Config, Link, Links,
    Passkey, Sharding, TicketKeys, ACCOUNTS, CHALLENGES, CHALLENGE_TTL_NS, EMAIL_SENDS, GROUPS, HOMES, INBOX, LINKS,
    LINK_INDEX, MAX_CHALLENGES, PASSKEYS, PRINCIPALS, SHARDING, SIGS, TICKET_KEYS,
};
use open_social_inbox_core::groups::{CommitArgs, Entry as GroupEntry, Head, PostError, Role};
use open_social_inbox_core::ticket::{Ticket, TicketKey};

const DEFAULT_TTL_NS: u64 = 8 * 3600 * 1_000_000_000;
const MAX_TTL_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
const MAX_SESSION_KEY_LEN: usize = 300;

/* ------------------------------------------------------------------ API --- */

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub config: Config,
}

#[derive(CandidType, Deserialize)]
pub struct SessionRequest {
    /// DER-encoded public key of the frontend session key pair.
    pub session_key: ByteBuf,
    pub max_time_to_live_ns: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct Prepared {
    /// DER-encoded canister signature public key of the account.
    pub user_key: ByteBuf,
    pub expiration_ns: u64,
    pub account_principal: Principal,
    pub new_account: bool,
}

#[derive(CandidType, Deserialize)]
pub struct SignedDelegation {
    pub pubkey: ByteBuf,
    pub expiration_ns: u64,
    pub signature: ByteBuf,
}

#[derive(CandidType, Deserialize)]
pub struct PasskeyChallenge {
    pub challenge_id: String,
    pub challenge: ByteBuf,
    pub rp_id: String,
}

#[derive(CandidType, Deserialize)]
pub struct PasskeyRegistration {
    pub challenge_id: String,
    pub origin: String,
    pub credential_id: ByteBuf,
    pub attestation_object: ByteBuf,
    pub client_data_json: ByteBuf,
}

#[derive(CandidType, Deserialize)]
pub struct PasskeyAssertion {
    pub challenge_id: String,
    pub origin: String,
    pub credential_id: ByteBuf,
    pub authenticator_data: ByteBuf,
    pub client_data_json: ByteBuf,
    pub signature: ByteBuf,
}

type R<T> = Result<T, String>;

/* ------------------------------------------------------------ lifecycle --- */

#[init]
fn init(args: InitArgs) {
    update_settings(|s| s.config = args.config);
}

/// State lives in stable memory, so nothing is copied on upgrade. Signatures
/// and pending challenges are short-lived and start empty.
#[post_upgrade]
fn post_upgrade(args: Option<InitArgs>) {
    if let Some(a) = args {
        update_settings(|s| s.config = a.config);
    }
    update_certified_data();
}

/* -------------------------------------------------------------- helpers --- */

async fn random_bytes() -> R<Vec<u8>> {
    let res = ic_cdk::call::Call::unbounded_wait(Principal::management_canister(), "raw_rand")
        .await
        .map_err(|e| format!("raw_rand failed: {e:?}"))?;
    let bytes: ByteBuf = res.candid().map_err(|e| format!("raw_rand decode failed: {e:?}"))?;
    Ok(bytes.into_vec())
}

async fn ensure_salt() -> R<Vec<u8>> {
    let salt = settings().salt;
    if !salt.is_empty() {
        return Ok(salt);
    }
    let fresh = random_bytes().await?;
    Ok(update_settings(|s| {
        if s.salt.is_empty() {
            s.salt = fresh;
        }
        s.salt.clone()
    }))
}

fn salt() -> R<Vec<u8>> {
    let salt = settings().salt;
    if salt.is_empty() {
        return Err("Not initialised".into());
    }
    Ok(salt)
}

fn seed_for(salt: &[u8], account: AccountId) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(b"opensocial/v1/account-seed");
    h.update(salt);
    h.update(account.to_be_bytes());
    h.finalize().to_vec()
}

fn account_key(salt: &[u8], account: AccountId) -> CanisterSigPublicKey {
    CanisterSigPublicKey::new(canister_self(), seed_for(salt, account))
}

fn update_certified_data() {
    let root = SIGS.with(|s| s.borrow().root_hash());
    certified_data_set(labeled_hash(b"sig", &root));
}

fn origin_rp_id(origin: &str) -> R<String> {
    settings()
        .config
        .origins
        .into_iter()
        .find(|o| o.origin == origin)
        .map(|o| o.rp_id)
        .ok_or_else(|| format!("Origin {origin} is not allowed"))
}

fn take_challenge(id: &str) -> R<ChallengeKind> {
    prune_challenges(time());
    CHALLENGES
        .with(|c| c.borrow_mut().remove(id))
        .map(|c| c.kind)
        .ok_or_else(|| "Challenge expired or unknown. Start again.".to_string())
}

fn put_challenge(id: String, kind: ChallengeKind, ttl_ns: u64) -> R<()> {
    let now = time();
    prune_challenges(now);
    CHALLENGES.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= MAX_CHALLENGES {
            return Err("Too many pending sign-ins. Try again shortly.".to_string());
        }
        c.insert(id, Challenge { kind, expires_at_ns: now + ttl_ns });
        Ok(())
    })
}

/// The OpenSocial account the caller is signed in to, if any.
fn caller_account() -> Option<AccountId> {
    account_of(&msg_caller())
}

/// Finds or creates the account for a verified sign-in method, then prepares a delegation.
async fn complete(kind: &str, id: String, label: String, session: SessionRequest) -> R<Prepared> {
    if session.session_key.len() > MAX_SESSION_KEY_LEN || session.session_key.is_empty() {
        return Err("Invalid session key".into());
    }
    let salt = ensure_salt().await?;
    let key = format!("{kind}:{id}");
    let now = time();

    let (account, new_account) = match LINK_INDEX.with(|m| m.borrow().get(&key)) {
        Some(a) => (a, false),
        None => {
            let account = update_settings(|s| {
                s.last_account += 1;
                s.last_account
            });
            let link = Link { kind: kind.into(), id, label, added_at_ns: now };
            LINK_INDEX.with(|m| m.borrow_mut().insert(key, account));
            LINKS.with(|m| m.borrow_mut().insert(account, Links(vec![link])));
            (account, true)
        }
    };

    let pk = account_key(&salt, account);
    let principal = Principal::self_authenticating(pk.to_der());
    if new_account {
        PRINCIPALS.with(|m| m.borrow_mut().insert(principal, account));
        ACCOUNTS.with(|m| m.borrow_mut().insert(account, principal));
        assign_home(account, principal).await;
    }

    let ttl = session.max_time_to_live_ns.unwrap_or(DEFAULT_TTL_NS).min(MAX_TTL_NS);
    let expiration = now.saturating_add(ttl);
    let seed = seed_for(&salt, account);
    let msg = delegation_signature_msg(&session.session_key, expiration, None);
    SIGS.with(|s| {
        s.borrow_mut().add_signature(&CanisterSigInputs { domain: DELEGATION_SIG_DOMAIN, seed: &seed, message: &msg })
    });
    update_certified_data();

    Ok(Prepared {
        user_key: ByteBuf::from(pk.to_der()),
        expiration_ns: expiration,
        account_principal: principal,
        new_account,
    })
}

/* ------------------------------------------------- delegation retrieval --- */

/// Returns the canister signature for a prepared delegation. Must be a query
/// (certified via the data certificate).
#[query]
fn get_delegation(account_principal: Principal, session_key: ByteBuf, expiration_ns: u64) -> R<SignedDelegation> {
    let account = account_of(&account_principal).ok_or("Unknown account")?;
    let seed = seed_for(&salt()?, account);
    let msg = delegation_signature_msg(&session_key, expiration_ns, None);
    let signature = SIGS
        .with(|s| {
            s.borrow().get_signature_as_cbor(
                &CanisterSigInputs { domain: DELEGATION_SIG_DOMAIN, seed: &seed, message: &msg },
                None,
            )
        })
        .map_err(|e| format!("No signature: {e:?}"))?;
    Ok(SignedDelegation { pubkey: session_key, expiration_ns, signature: ByteBuf::from(signature) })
}

/* ------------------------------------------------- Internet Identity --- */

/// The caller authenticates with their Internet Identity delegation.
#[update]
async fn sign_in_with_ii(session: SessionRequest) -> R<Prepared> {
    let caller = msg_caller();
    if caller == Principal::anonymous() {
        return Err("Anonymous callers cannot sign in".into());
    }
    if caller_account().is_some() {
        return Err("Account principals cannot be used as Internet Identity".into());
    }
    let text = caller.to_text();
    let label = format!("{}…{}", &text[..5], &text[text.len() - 3..]);
    complete("ii", text, label, session).await
}

/* ------------------------------------------------------------ Passkey --- */

#[update]
async fn passkey_challenge(origin: String) -> R<PasskeyChallenge> {
    let rp_id = origin_rp_id(&origin)?;
    let bytes = random_bytes().await?;
    let challenge = bytes[..32].to_vec();
    let id = URL_SAFE_NO_PAD.encode(&hash_bytes(&challenge)[..16]);
    put_challenge(id.clone(), ChallengeKind::Passkey { challenge: challenge.clone() }, CHALLENGE_TTL_NS)?;
    Ok(PasskeyChallenge { challenge_id: id, challenge: ByteBuf::from(challenge), rp_id })
}

fn check_client_data(json: &[u8], expected_type: &str, challenge: &[u8], origin: &str) -> R<()> {
    let cd = verify::parse_client_data(json)?;
    if cd.type_ != expected_type {
        return Err("Unexpected WebAuthn operation".into());
    }
    if cd.challenge != challenge {
        return Err("Challenge mismatch".into());
    }
    if cd.origin != origin {
        return Err("Origin mismatch".into());
    }
    Ok(())
}

/// Creates a new account with a new passkey.
#[update]
async fn passkey_register(reg: PasskeyRegistration, session: SessionRequest) -> R<Prepared> {
    let rp_id = origin_rp_id(&reg.origin)?;
    let ChallengeKind::Passkey { challenge } = take_challenge(&reg.challenge_id)? else {
        return Err("Wrong challenge type".into());
    };
    check_client_data(&reg.client_data_json, "webauthn.create", &challenge, &reg.origin)?;
    let auth_data = verify::auth_data_from_attestation(&reg.attestation_object)?;
    let parsed = verify::parse_auth_data(&auth_data)?;
    verify::check_auth_data(&parsed, &rp_id)?;
    let attested = parsed.attested.ok_or("No credential in registration")?;
    let (cred_id, public_key) = verify::parse_attested_credential(attested)?;
    if cred_id != reg.credential_id.as_slice() {
        return Err("Credential id mismatch".into());
    }
    let cred_b64 = URL_SAFE_NO_PAD.encode(&cred_id);
    if PASSKEYS.with(|m| m.borrow().contains_key(&cred_b64)) {
        return Err("This passkey is already registered".into());
    }
    let label = format!("Passkey on {rp_id}");
    let prepared = complete("passkey", cred_b64.clone(), label, session).await?;
    let account = account_of(&prepared.account_principal).ok_or("Account missing")?;
    PASSKEYS.with(|m| m.borrow_mut().insert(cred_b64, Passkey { account, public_key, rp_id }));
    Ok(prepared)
}

#[update]
async fn passkey_sign_in(a: PasskeyAssertion, session: SessionRequest) -> R<Prepared> {
    let rp_id = origin_rp_id(&a.origin)?;
    let ChallengeKind::Passkey { challenge } = take_challenge(&a.challenge_id)? else {
        return Err("Wrong challenge type".into());
    };
    check_client_data(&a.client_data_json, "webauthn.get", &challenge, &a.origin)?;
    let cred_b64 = URL_SAFE_NO_PAD.encode(&a.credential_id);
    let pk = PASSKEYS.with(|m| m.borrow().get(&cred_b64)).ok_or("Unknown passkey. Register it first.")?;
    if pk.rp_id != rp_id {
        return Err("Passkey was registered for a different site".into());
    }
    let parsed = verify::parse_auth_data(&a.authenticator_data)?;
    verify::check_auth_data(&parsed, &rp_id)?;
    verify::verify_assertion(&pk.public_key, &a.authenticator_data, &a.client_data_json, &a.signature)?;
    complete("passkey", cred_b64, format!("Passkey on {rp_id}"), session).await
}

/* ---------------------------------------------------------------- Email --- */

fn is_admin(p: &Principal) -> bool {
    ic_cdk::api::is_controller(p) || settings().admins.contains(p)
}

fn email_hash(salt: &[u8], email: &str) -> String {
    let mut h = Sha256::new();
    h.update(b"opensocial/v1/email");
    h.update(salt);
    h.update(email.as_bytes());
    hex::encode(h.finalize())
}

fn code_hash(salt: &[u8], challenge_id: &str, code: &str) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(b"opensocial/v1/email-code");
    h.update(salt);
    h.update(challenge_id.as_bytes());
    h.update(code.as_bytes());
    h.finalize().to_vec()
}

const DAY_NS: u64 = 86_400 * 1_000_000_000;

/// Sends a sign-in code to `email`. Rate limited per address and per day.
#[update]
async fn email_challenge(email: String, origin: String) -> R<email::EmailChallenge> {
    origin_rp_id(&origin)?;
    let email = email::normalize_email(&email)?;
    let sender = settings().email_sender.ok_or("Email sign-in is not available yet")?;
    let salt = ensure_salt().await?;
    let hash = email_hash(&salt, &email);
    let now = time();
    let today = now / DAY_NS;

    // Reserve a send slot before the outcall so concurrent requests can't exceed limits.
    update_settings(|s| {
        if s.email_day.0 != today {
            s.email_day = (today, 0);
        }
        if s.email_day.1 >= sender.daily_limit {
            return Err("Too many sign-in emails today. Try another sign-in method.".to_string());
        }
        s.email_day.1 += 1;
        Ok(())
    })?;
    EMAIL_SENDS.with(|m| {
        let mut sends = m.borrow_mut();
        sends.retain(|_, v| {
            v.retain(|t| now.saturating_sub(*t) < email::PER_EMAIL_WINDOW_NS);
            !v.is_empty()
        });
        let mine = sends.entry(hash.clone()).or_default();
        if mine.len() >= email::PER_EMAIL_MAX {
            return Err("Too many codes for this address. Wait 15 minutes.".to_string());
        }
        mine.push(now);
        Ok(())
    })?;

    let rand = random_bytes().await?;
    let challenge_id = hex::encode(&rand[..16]);
    let code = email::code_from(&rand[16..20]);
    email::send_with_resend(&sender.api_key, &sender.from, &email, &challenge_id, &code, &origin).await?;

    let label = email::mask_email(&email);
    let kind = ChallengeKind::Email {
        email_hash: hash,
        label: label.clone(),
        code_hash: code_hash(&salt, &challenge_id, &code),
        attempts: 0,
    };
    put_challenge(challenge_id.clone(), kind, email::CODE_TTL_NS)?;
    Ok(email::EmailChallenge { challenge_id, sent_to: label, expires_at_ns: now + email::CODE_TTL_NS })
}

/// Checks an emailed code; returns (email hash, masked address). Five wrong
/// attempts invalidate the challenge.
fn verify_email_code(challenge_id: &str, code: &str) -> R<(String, String)> {
    let salt = salt()?;
    prune_challenges(time());
    let code = code.trim();
    CHALLENGES.with(|c| {
        let mut c = c.borrow_mut();
        let Some(ch) = c.get_mut(challenge_id) else {
            return Err("Code expired. Ask for a new one.".to_string());
        };
        let ChallengeKind::Email { email_hash, label, code_hash: expected, attempts } = &mut ch.kind else {
            return Err("Wrong challenge type".to_string());
        };
        let given = code_hash(&salt, challenge_id, code);
        let matches = given.len() == expected.len()
            && given.iter().zip(expected.iter()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0;
        if matches {
            let out = (email_hash.clone(), label.clone());
            c.remove(challenge_id);
            return Ok(out);
        }
        *attempts += 1;
        if *attempts >= email::MAX_ATTEMPTS {
            c.remove(challenge_id);
            return Err("Too many wrong codes. Ask for a new one.".to_string());
        }
        Err(format!("Wrong code. {} tries left.", email::MAX_ATTEMPTS - *attempts))
    })
}

#[update]
async fn email_sign_in(challenge_id: String, code: String, session: SessionRequest) -> R<Prepared> {
    let (hash, label) = verify_email_code(&challenge_id, &code)?;
    complete("email", hash, label, session).await
}

/// How long after creating an account its owner may add a recovery email.
/// Later additions need a fresh re-authentication, which is not built yet, so
/// a stolen session cannot attach an attacker's email.
const LINK_EMAIL_WINDOW_NS: u64 = 30 * 60 * 1_000_000_000;

/// Adds a verified email to the caller's new account, so signing in with that
/// email later opens the same account (account recovery).
#[update]
fn link_email(challenge_id: String, code: String) -> R<Link> {
    let account = caller_account().ok_or("Not signed in")?;
    let mut links = state::links_of(account);
    let created = links.iter().map(|l| l.added_at_ns).min().unwrap_or(0);
    if time().saturating_sub(created) > LINK_EMAIL_WINDOW_NS {
        return Err("A recovery email can only be added while creating the account".into());
    }
    let (hash, label) = verify_email_code(&challenge_id, &code)?;
    let key = format!("email:{hash}");
    let link = Link { kind: "email".into(), id: hash, label, added_at_ns: time() };
    match LINK_INDEX.with(|m| m.borrow().get(&key)) {
        Some(owner) if owner == account => return Ok(link),
        Some(_) => return Err("This email already belongs to another OpenSocial account".into()),
        None => {}
    }
    if links.iter().any(|l| l.kind == "email") {
        return Err("This account already has a recovery email".into());
    }
    links.push(link.clone());
    LINK_INDEX.with(|m| m.borrow_mut().insert(key, account));
    LINKS.with(|m| m.borrow_mut().insert(account, Links(links)));
    Ok(link)
}

/// Configures (or removes, with None) the email service. Controllers and admins only.
#[update]
fn set_email_sender(input: Option<email::EmailSenderInput>) -> R<()> {
    if !is_admin(&msg_caller()) {
        return Err("Only administrators can configure email".into());
    }
    let sender = match input {
        None => None,
        Some(i) => {
            if !i.api_key.starts_with("re_") || i.api_key.len() > 200 {
                return Err("That doesn't look like a Resend API key".into());
            }
            if i.from.trim().is_empty() || i.from.len() > 200 || !i.from.contains('@') {
                return Err("Enter a sender like: OpenSocial <login@yourdomain.com>".into());
            }
            Some(state::EmailSender {
                api_key: i.api_key,
                from: i.from.trim().to_string(),
                daily_limit: i.daily_limit.unwrap_or(100).clamp(1, 100_000),
            })
        }
    };
    update_settings(|s| s.email_sender = sender);
    Ok(())
}

#[query]
fn email_sender_status() -> email::EmailStatus {
    let s = settings();
    let today = time() / DAY_NS;
    let sender = s.email_sender.as_ref();
    email::EmailStatus {
        configured: sender.is_some(),
        from: sender.map(|e| e.from.clone()),
        sent_today: if s.email_day.0 == today { s.email_day.1 } else { 0 },
        daily_limit: sender.map_or(0, |e| e.daily_limit),
    }
}

/// Grants an account principal the right to configure email. Controllers only.
#[update]
fn add_admin(p: Principal) -> R<()> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Only controllers can add administrators".into());
    }
    update_settings(|s| {
        if !s.admins.contains(&p) {
            s.admins.push(p);
        }
    });
    Ok(())
}

#[query]
fn am_i_admin() -> bool {
    is_admin(&msg_caller())
}

/* ------------------------------------------------------ Account methods --- */

/// Sign-in methods of the caller's account.
#[query]
fn my_sign_in_methods() -> R<Vec<Link>> {
    let account = caller_account().ok_or("Not signed in")?;
    Ok(state::links_of(account))
}

/* ------------------------------------------------- Devices and mailbox --- */

#[derive(CandidType, Deserialize)]
pub struct DeviceInput {
    pub device_id: String,
    pub encryption_key: ByteBuf,
    pub signing_key: ByteBuf,
    pub label: String,
}

#[derive(CandidType, Deserialize)]
pub struct PublicDevice {
    pub device_id: String,
    pub encryption_key: ByteBuf,
    pub signing_key: ByteBuf,
    pub label: String,
    pub added_at_ns: u64,
}

#[derive(CandidType, Deserialize)]
pub struct Mail {
    pub id: u64,
    pub from: Principal,
    pub received_at_ns: u64,
    pub entry: ByteBuf,
}

fn public(d: state::Device) -> PublicDevice {
    PublicDevice {
        device_id: d.device_id,
        encryption_key: ByteBuf::from(d.encryption_key),
        signing_key: ByteBuf::from(d.signing_key),
        label: d.label,
        added_at_ns: d.added_at_ns,
    }
}

thread_local! {
    /// caller -> (minute, calls in that minute); heap only.
    static RATE: std::cell::RefCell<std::collections::BTreeMap<Principal, (u64, u32)>> =
        std::cell::RefCell::new(Default::default());
}
/// Mailbox entries (and key-package claims) one account may make per minute
/// (anti-spam). A 10 MB file is about 320 entries per device; clients pace
/// themselves at the limit.
const CALLS_PER_MINUTE: u32 = 300;

fn rate_limit(caller: Principal, n: u32, message: &str) -> R<()> {
    let minute = time() / 60_000_000_000;
    RATE.with(|r| {
        let mut r = r.borrow_mut();
        r.retain(|_, (m, _)| *m == minute);
        let e = r.entry(caller).or_insert((minute, 0));
        if e.1 + n > CALLS_PER_MINUTE {
            return Err(message.to_string());
        }
        e.1 += n;
        Ok(())
    })
}

/// Publishes this device's public keys under the caller's account.
#[update]
fn register_device(input: DeviceInput) -> R<()> {
    let account = caller_account().ok_or("Not signed in")?;
    mailbox::register_device(
        account,
        state::Device {
            device_id: input.device_id,
            encryption_key: input.encryption_key.into_vec(),
            signing_key: input.signing_key.into_vec(),
            label: input.label,
            added_at_ns: time(),
        },
    )
}

#[update]
fn remove_device(device_id: String) -> R<()> {
    let account = caller_account().ok_or("Not signed in")?;
    mailbox::remove_device(account, &device_id)
}

/// Publishes this device's last-resort key package (replacing the set when
/// given) and adds single-use key packages. Returns how many single-use ones
/// are left.
#[update]
fn publish_key_packages(device_id: String, last_resort: Option<ByteBuf>, single_use: Vec<ByteBuf>) -> R<u32> {
    let account = caller_account().ok_or("Not signed in")?;
    mailbox::publish_key_packages(
        account,
        &device_id,
        last_resort.map(|b| b.into_vec()),
        single_use.into_iter().map(|b| b.into_vec()).collect(),
    )
}

#[derive(CandidType, Deserialize)]
pub struct ClaimedKeyPackage {
    pub last_resort: ByteBuf,
    pub single_use: Option<ByteBuf>,
}

/// Hands out a device's last-resort key package and one single-use key
/// package (used once). Signed-in callers only, rate limited like deposits.
#[update]
fn claim_key_package(account: Principal, device_id: String, _ticket: Option<Ticket>) -> R<Option<ClaimedKeyPackage>> {
    caller_account().ok_or("Sign in first")?;
    let to = account_of(&account).ok_or("Unknown account")?;
    rate_limit(msg_caller(), 1, "Too many requests. Wait a moment.")?;
    Ok(mailbox::claim_key_package(to, &device_id)
        .map(|(b, o)| ClaimedKeyPackage { last_resort: ByteBuf::from(b), single_use: o.map(ByteBuf::from) }))
}

/// Public device keys of any OpenSocial account (empty if unknown).
#[query]
fn get_devices(account: Principal) -> Vec<PublicDevice> {
    account_of(&account).map(mailbox::devices_of).unwrap_or_default().into_iter().map(public).collect()
}

/// Queues an end-to-end encrypted log entry for an offline device.
#[update]
fn deposit(to: Principal, device_id: String, entry: ByteBuf, _ticket: Option<Ticket>) -> R<u64> {
    let caller = msg_caller();
    caller_account().ok_or("Sign in to send messages")?;
    let to_account = account_of(&to).ok_or("Unknown recipient")?;
    moving(to_account)?;
    rate_limit(caller, 1, "Sending too fast. Wait a moment.")?;
    mailbox::deposit_item(caller, to_account, &device_id, entry.into_vec(), time(), false)
}

#[derive(CandidType, Deserialize)]
pub struct DepositItem {
    pub to: Principal,
    pub device_id: String,
    pub entry: ByteBuf,
    /// Direct-link offer: capped per sender and dropped after 10 minutes.
    pub ephemeral: bool,
}

/// Queues several encrypted entries in one call (all or nothing, in order).
#[update]
fn deposit_batch(items: Vec<DepositItem>, _ticket: Option<Ticket>) -> R<mailbox::BatchResult> {
    let caller = msg_caller();
    caller_account().ok_or("Sign in to send messages")?;
    rate_limit(caller, items.len() as u32, "Sending too fast. Wait a moment.")?;
    let mut resolved = Vec::with_capacity(items.len());
    for i in items {
        let to = account_of(&i.to).ok_or("Unknown recipient")?;
        moving(to)?;
        resolved.push((to, i.device_id, i.entry.into_vec(), i.ephemeral));
    }
    mailbox::deposit_batch(caller, resolved, time())
}

/// Entries waiting for one of the caller's devices, oldest first, after `after`.
#[query]
fn fetch_mail(device_id: String, after: u64) -> R<Vec<Mail>> {
    let account = caller_account().ok_or("Not signed in")?;
    Ok(mailbox::fetch(account, &device_id, after, time())
        .into_iter()
        .map(|m| Mail { id: m.id, from: m.from, received_at_ns: m.received_at_ns, entry: ByteBuf::from(m.entry) })
        .collect())
}

/// Deletes entries up to and including `up_to` once they are stored on the device.
#[update]
fn ack_mail(device_id: String, up_to: u64) -> R<u32> {
    let account = caller_account().ok_or("Not signed in")?;
    Ok(mailbox::ack(account, &device_id, up_to, time()) as u32)
}

/* -------------------------------------------------------- Inbox shards --- */

/// Where an account's inbox lives: an inbox shard, or this canister ("shard
/// 000") when it has none. None for principals that are not OpenSocial accounts.
#[query]
fn home_of(account: Principal) -> Option<Principal> {
    let a = account_of(&account)?;
    Some(HOMES.with(|m| m.borrow().get(&a)).unwrap_or_else(canister_self))
}

/// The orchestrator's assignment of a new account to an inbox shard. If there
/// is no orchestrator, or it fails, the account lives here (shard 000).
async fn assign_home(account: AccountId, principal: Principal) {
    let Some(orchestrator) = SHARDING.with(|c| c.borrow().get().orchestrator) else {
        return;
    };
    let r = ic_cdk::call::Call::bounded_wait(orchestrator, "assign")
        .with_arg(principal)
        .await
        .ok()
        .and_then(|r| r.candid::<R<Principal>>().ok());
    if let Some(Ok(shard)) = r {
        HOMES.with(|m| m.borrow_mut().insert(account, shard));
    }
}

/// Orchestrator: records an account's new home after moving it.
#[update]
fn set_home(account: Principal, shard: Principal) -> R<()> {
    require_orchestrator()?;
    let a = account_of(&account).ok_or("Unknown account")?;
    if shard == canister_self() {
        HOMES.with(|m| m.borrow_mut().remove(&a));
    } else {
        HOMES.with(|m| m.borrow_mut().insert(a, shard));
    }
    Ok(())
}

fn require_orchestrator() -> R<()> {
    let c = msg_caller();
    if SHARDING.with(|s| s.borrow().get().orchestrator) == Some(c) || ic_cdk::api::is_controller(&c) {
        Ok(())
    } else {
        Err("Only the orchestrator can do this".into())
    }
}

/// Orchestrator: an account's inbox data, to move it to an inbox shard. From
/// now until `drop_account` or `cancel_move`, new entries for it are refused.
#[update]
fn export_account(account: Principal) -> R<open_social_inbox_core::AccountExport> {
    require_orchestrator()?;
    let a = account_of(&account).ok_or("Unknown account")?;
    MOVING.with(|m| m.borrow_mut().insert(a));
    Ok(INBOX.with(|i| i.borrow().export_account(a)))
}

/// Orchestrator: ends a failed move.
#[update]
fn cancel_move(account: Principal) -> R<()> {
    require_orchestrator()?;
    let a = account_of(&account).ok_or("Unknown account")?;
    MOVING.with(|m| m.borrow_mut().remove(&a));
    Ok(())
}

/// Orchestrator: removes an account's inbox data here after it moved (the
/// account itself, its sign-in methods and principal stay).
#[update]
fn drop_account(account: Principal) -> R<()> {
    require_orchestrator()?;
    let a = account_of(&account).ok_or("Unknown account")?;
    INBOX.with(|i| i.borrow_mut().delete_account(a));
    MOVING.with(|m| m.borrow_mut().remove(&a));
    Ok(())
}

fn moving(a: AccountId) -> R<()> {
    if MOVING.with(|m| m.borrow().contains(&a)) {
        Err("Moved: this inbox is moving; look it up again and retry".into())
    } else {
        Ok(())
    }
}

/// Controllers: sets the orchestrator (None keeps new accounts here).
#[update]
fn set_sharding(sharding: Sharding) -> R<()> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Only controllers can change sharding".into());
    }
    SHARDING.with(|c| c.borrow_mut().set(sharding));
    Ok(())
}

#[query]
fn sharding() -> Sharding {
    SHARDING.with(|c| c.borrow().get().clone())
}

async fn ensure_ticket_key() -> R<TicketKey> {
    if let Some(k) = TICKET_KEYS.with(|c| c.borrow().get().0.last().cloned()) {
        return Ok(k);
    }
    rotate_key().await
}

async fn rotate_key() -> R<TicketKey> {
    let fresh = random_bytes().await?;
    Ok(TICKET_KEYS.with(|c| {
        let mut keys = c.borrow().get().0.clone();
        let epoch = keys.last().map_or(1, |k| k.epoch + 1);
        let key = TicketKey { epoch, key: fresh };
        keys.push(key.clone());
        let drop = keys.len().saturating_sub(2);
        keys.drain(..drop);
        c.borrow_mut().set(TicketKeys(keys));
        key
    }))
}

/// A send ticket for the caller's account, for depositing into inbox shards.
#[update]
async fn send_ticket() -> R<Ticket> {
    let account = caller_account().ok_or("Not signed in")?;
    let principal = ACCOUNTS.with(|m| m.borrow().get(&account)).ok_or("Unknown account")?;
    let key = ensure_ticket_key().await?;
    Ok(open_social_inbox_core::ticket::issue(&key, principal, time()))
}

/// Orchestrator: the ticket keys inbox shards accept (created if missing).
#[update]
async fn ticket_keys() -> R<Vec<TicketKey>> {
    require_orchestrator()?;
    ensure_ticket_key().await?;
    Ok(TICKET_KEYS.with(|c| c.borrow().get().0.clone()))
}

/// Controllers: starts a new ticket key; the previous one stays valid until the next rotation.
#[update]
async fn rotate_ticket_key() -> R<u32> {
    if !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Only controllers can rotate keys".into());
    }
    Ok(rotate_key().await?.epoch)
}

/* ------------------------------------------------------ Account deletion --- */

/// Deletes the caller's account: sign-in method, passkey, devices, key
/// packages and queued mail. The account principal stops working.
#[update]
fn delete_account() -> R<()> {
    let account = caller_account().ok_or("Not signed in")?;
    mailbox::delete_account(account);
    Ok(())
}

thread_local! {
    /// Accounts whose inbox is being moved to a shard (heap: a move is short,
    /// and an upgrade in the middle of one makes the orchestrator retry it).
    static MOVING: std::cell::RefCell<std::collections::BTreeSet<AccountId>> = Default::default();
}

/* --------------------------------------------------------------- groups --- */

/// Key packages of many devices in one call (adding people to a group chat).
/// At most 200 devices; each must live in this shard.
#[update]
fn claim_key_packages(devices: Vec<(Principal, String)>, ticket: Option<Ticket>) -> R<Vec<Option<ClaimedKeyPackage>>> {
    if devices.len() > 200 {
        return Err("At most 200 devices per call".into());
    }
    caller_account().ok_or("Sign in first")?;
    let _ = ticket;
    rate_limit(msg_caller(), 1, "Too many requests. Wait a moment.")?;
    let wanted: Vec<(AccountId, String)> =
        devices.into_iter().filter_map(|(p, d)| account_of(&p).map(|a| (a, d))).collect();
    Ok(INBOX
        .with(|i| i.borrow_mut().claim_key_packages(&wanted))
        .into_iter()
        .map(|c| c.map(|(b, o)| ClaimedKeyPackage { last_resort: ByteBuf::from(b), single_use: o.map(ByteBuf::from) }))
        .collect())
}

/// Starts a group chat's stream here, with the caller as its owner.
#[update]
fn group_create(group: String, ticket: Option<Ticket>) -> Result<(), PostError> {
    let _ = ticket;
    caller_account().ok_or(PostError::NotAllowed("Sign in first".into()))?;
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().create(&group, msg_caller(), time()))
}

/// An MLS application message for the group → its seq.
#[update]
fn group_post(group: String, device: String, epoch: u64, data: ByteBuf) -> Result<u64, PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().post(&group, msg_caller(), device, epoch, data.into_vec(), time()))
}

/// An MLS commit made in the current epoch, with the access-list change it brings → its seq.
#[update]
fn group_post_commit(args: CommitArgs) -> Result<u64, PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().post_commit(msg_caller(), args, time()))
}

#[update]
fn group_set_role(group: String, account: Principal, role: Role) -> Result<(), PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().set_role(&group, msg_caller(), account, role))
}

#[update]
fn group_leave(group: String, heir: Option<Principal>) -> Result<(), PostError> {
    GROUPS.with(|g| g.borrow_mut().leave(&group, msg_caller(), heir))
}

/// One chunk of an encrypted file or Welcome, stored once for the whole group.
#[update]
fn group_blob_put(
    group: String,
    blob: u64,
    index: u32,
    chunks: u32,
    size: u64,
    data: ByteBuf,
) -> Result<(), PostError> {
    rate_limit_group()?;
    GROUPS.with(|g| g.borrow_mut().blob_put(&group, msg_caller(), blob, index, chunks, size, data.into_vec(), time()))
}

#[query]
fn group_blob_get(group: String, blob: u64, index: u32) -> Result<ByteBuf, PostError> {
    GROUPS.with(|g| g.borrow().blob_get(&group, msg_caller(), blob, index)).map(ByteBuf::from)
}

/// Entries after `after`, oldest first (members only).
#[query]
fn group_read(group: String, after: u64) -> Result<Vec<GroupEntry>, PostError> {
    GROUPS.with(|g| g.borrow().read(&group, msg_caller(), after))
}

/// Latest seq and epoch of each listed group the caller is in.
#[query]
fn group_heads(groups: Vec<String>) -> Vec<Head> {
    GROUPS.with(|g| g.borrow().heads(&groups, msg_caller()))
}

fn rate_limit_group() -> Result<(), PostError> {
    rate_limit(msg_caller(), 1, "Sending too fast. Wait a moment.").map_err(PostError::NotAllowed)
}

ic_cdk::export_candid!();

#[cfg(test)]
mod candid_file {
    /// Writes the Candid interface (kept in the repo and checked in CI).
    #[test]
    fn write_did() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_identity.did"), super::__export_service())
            .unwrap();
    }
}

//! OpenSocial orchestrator (`open-social-app-orchestrator`): runs the inbox shards.
//!
//! - Assigns each new account to the open shard with the fewest accounts,
//!   opening a new shard when all are full (called by the identity canister).
//! - Creates shards with the stored inbox wasm and keeps one spare with room.
//! - Upgrades shards in waves (`upgrade_shards(n)` upgrades at most n).
//! - Every hour: refreshes each shard's stats, closes shards over their
//!   thresholds, tops up cycles and hands out the identity canister's
//!   send-ticket keys.
//! - Moves an account between shards (`move_account`).
//!
//! It must be a controller of every shard. See docs/INBOX_SHARDING.md.

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_cdk::api::{canister_cycle_balance, canister_self, msg_caller, time};
use ic_cdk::call::Call;
use ic_cdk::{init, post_upgrade, query, update};
use ic_management_canister_types::{
    CanisterIdRecord, CanisterInstallMode, CanisterSettings, CreateCanisterArgs, InstallCodeArgs, UpgradeFlags,
};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{DefaultMemoryImpl, StableCell, Storable};
use serde_bytes::ByteBuf;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;
use std::time::Duration;
use open_social_inbox_core::ticket::TicketKey;
use open_social_inbox_core::AccountExport;

type Mem = VirtualMemory<DefaultMemoryImpl>;
type R<T> = Result<T, String>;

const T: u128 = 1_000_000_000_000;
const REFRESH_EVERY: Duration = Duration::from_secs(3600);

/* ---------------------------------------------------------------- state --- */

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Limits {
    /// Accounts per shard.
    pub capacity: u64,
    /// A shard closes to new accounts above this much stable memory.
    pub max_stable_memory_bytes: u64,
    /// Top up a shard below this balance ...
    pub topup_below: u128,
    /// ... by this much.
    pub topup_amount: u128,
    /// Cycles a new shard starts with (besides the creation fee).
    pub initial_cycles: u128,
    /// The orchestrator keeps this much for itself and stops topping up below it.
    pub reserve: u128,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            capacity: 100_000,
            max_stable_memory_bytes: 150 * 1024 * 1024 * 1024,
            topup_below: 10 * T,
            topup_amount: 5 * T,
            initial_cycles: 5 * T,
            reserve: 2 * T,
        }
    }
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Shard {
    pub id: Principal,
    pub number: u32,
    pub accounts: u64,
    pub open: bool,
    pub cycles: u128,
    pub stable_memory_bytes: u64,
    pub queued_entries: u64,
    /// sha256 of the wasm it runs (as installed by this orchestrator).
    pub wasm_hash: String,
    pub checked_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default)]
pub struct State {
    pub identity: Option<Principal>,
    pub limits: Option<Limits>,
    pub shards: Vec<Shard>,
    pub ticket_keys: Vec<TicketKey>,
    pub wasm_hash: String,
    pub log: Vec<String>,
    /// Extra controllers given to new shards (besides this canister).
    pub shard_controllers: Vec<Principal>,
}

#[derive(CandidType, Deserialize, Clone, Default)]
struct Wasm(#[serde(with = "serde_bytes")] Vec<u8>);

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
candid_storable!(State, Wasm);

// Memory ids are permanent. Never reuse or renumber them.
const MEM_STATE: u8 = 0;
const MEM_WASM: u8 = 1;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static STATE: RefCell<StableCell<State, Mem>> = RefCell::new(StableCell::init(mem(MEM_STATE), State::default()));
    static WASM: RefCell<StableCell<Wasm, Mem>> = RefCell::new(StableCell::init(mem(MEM_WASM), Wasm::default()));
    /// Set while a shard is being created, so concurrent assignments don't create two.
    static CREATING: RefCell<bool> = const { RefCell::new(false) };
}

fn mem(id: u8) -> Mem {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}

fn state() -> State {
    STATE.with(|s| s.borrow().get().clone())
}

fn update_state<X>(f: impl FnOnce(&mut State) -> X) -> X {
    STATE.with(|c| {
        let mut c = c.borrow_mut();
        let mut s = c.get().clone();
        let out = f(&mut s);
        c.set(s);
        out
    })
}

fn limits() -> Limits {
    state().limits.unwrap_or_default()
}

fn log(line: String) {
    update_state(|s| {
        s.log.push(format!("{} {line}", time() / 1_000_000_000));
        let extra = s.log.len().saturating_sub(200);
        s.log.drain(..extra);
    });
}

fn require_controller() -> R<()> {
    if ic_cdk::api::is_controller(&msg_caller()) {
        Ok(())
    } else {
        Err("Only controllers can do this".into())
    }
}

/* ------------------------------------------------------------ choosing --- */

/// The open shard with room and the fewest accounts (ties: the oldest).
pub fn pick(shards: &[Shard], capacity: u64, excluded: &[Principal]) -> Option<Principal> {
    shards
        .iter()
        .filter(|s| s.open && s.accounts < capacity && !excluded.contains(&s.id))
        .min_by_key(|s| (s.accounts, s.number))
        .map(|s| s.id)
}

/// Whether a shard should close to new accounts.
pub fn over_limits(s: &Shard, l: &Limits) -> bool {
    s.accounts >= l.capacity || s.stable_memory_bytes >= l.max_stable_memory_bytes
}

/* ----------------------------------------------------------- lifecycle --- */

#[derive(CandidType, Deserialize)]
pub struct InitArgs {
    pub identity: Principal,
    pub limits: Option<Limits>,
}

#[init]
fn init(args: InitArgs) {
    update_state(|s| {
        s.identity = Some(args.identity);
        s.limits = args.limits;
    });
    start_timer();
}

#[post_upgrade]
fn post_upgrade() {
    start_timer();
}

fn start_timer() {
    ic_cdk_timers::set_timer_interval(REFRESH_EVERY, || async {
        let _ = refresh_all().await;
    });
}

/* ---------------------------------------------------------- management --- */

async fn mgmt<A: CandidType, B: for<'a> Deserialize<'a> + CandidType>(method: &str, arg: A, cycles: u128) -> R<B> {
    Call::unbounded_wait(Principal::management_canister(), method)
        .with_arg(arg)
        .with_cycles(cycles)
        .await
        .map_err(|e| format!("{method} failed: {e:?}"))?
        .candid::<B>()
        .map_err(|e| format!("{method} reply: {e:?}"))
}

async fn shard_call<A: CandidType, B: for<'a> Deserialize<'a> + CandidType>(
    id: Principal,
    method: &str,
    arg: A,
) -> R<B> {
    Call::bounded_wait(id, method)
        .with_arg(arg)
        .await
        .map_err(|e| format!("{method} on {id} failed: {e:?}"))?
        .candid::<B>()
        .map_err(|e| format!("{method} reply from {id}: {e:?}"))
}

#[derive(CandidType, Deserialize)]
struct ShardInit {
    identity: Principal,
    orchestrator: Principal,
    shard_number: u32,
    capacity: Option<u64>,
}

fn wasm() -> R<(Vec<u8>, String)> {
    let w = WASM.with(|c| c.borrow().get().0.clone());
    if w.is_empty() {
        return Err("Upload the inbox wasm first (set_inbox_wasm)".into());
    }
    let h = hex::encode(Sha256::digest(&w));
    Ok((w, h))
}

/// Creates a shard, installs the inbox wasm and hands it the ticket keys.
async fn create_shard_inner() -> R<Principal> {
    let (module, hash) = wasm()?;
    let l = limits();
    // Creating costs the fee (about 0.5T on a 13-node subnet) on top of the start balance.
    let cost = l.initial_cycles + T;
    if canister_cycle_balance() < cost + l.reserve {
        return Err("Not enough cycles to create a shard".into());
    }
    let identity = state().identity.ok_or("No identity canister set")?;
    // This canister plus the people who run it, so a shard can be fixed by hand if needed.
    let mut controllers = vec![canister_self()];
    controllers.extend(state().shard_controllers.into_iter().take(9));
    let created: CanisterIdRecord = mgmt(
        "create_canister",
        CreateCanisterArgs {
            settings: Some(CanisterSettings { controllers: Some(controllers), ..Default::default() }),
            sender_canister_version: None,
        },
        cost,
    )
    .await?;
    let id = created.canister_id;
    let number = state().shards.iter().map(|s| s.number).max().unwrap_or(0) + 1;
    let arg = Encode!(&ShardInit {
        identity,
        orchestrator: canister_self(),
        shard_number: number,
        capacity: Some(l.capacity)
    })
    .map_err(|e| e.to_string())?;
    let _: () = mgmt(
        "install_code",
        InstallCodeArgs {
            mode: CanisterInstallMode::Install,
            canister_id: id,
            wasm_module: module,
            arg,
            sender_canister_version: None,
        },
        0,
    )
    .await?;
    register(id, number, hash);
    push_keys(id).await?;
    log(format!("created shard {number} {id}"));
    Ok(id)
}

fn register(id: Principal, number: u32, wasm_hash: String) {
    update_state(|s| {
        if !s.shards.iter().any(|x| x.id == id) {
            s.shards.push(Shard {
                id,
                number,
                accounts: 0,
                open: true,
                cycles: 0,
                stable_memory_bytes: 0,
                queued_entries: 0,
                wasm_hash,
                checked_at_ns: 0,
            });
        }
    });
}

/// Like `shard_call`, for methods that take two arguments.
async fn shard_call2<A: CandidType, B: CandidType, Out: for<'a> Deserialize<'a> + CandidType>(
    id: Principal,
    method: &str,
    a: A,
    b: B,
) -> R<Out> {
    Call::bounded_wait(id, method)
        .with_args(&(a, b))
        .await
        .map_err(|e| format!("{method} on {id} failed: {e:?}"))?
        .candid::<Out>()
        .map_err(|e| format!("{method} reply from {id}: {e:?}"))
}

async fn fetch_keys() -> R<Vec<TicketKey>> {
    let identity = state().identity.ok_or("No identity canister set")?;
    let r: R<Vec<TicketKey>> = shard_call(identity, "ticket_keys", ()).await?;
    let keys = r?;
    update_state(|s| s.ticket_keys = keys.clone());
    Ok(keys)
}

async fn push_keys(id: Principal) -> R<()> {
    let keys = match state().ticket_keys {
        k if k.is_empty() => fetch_keys().await?,
        k => k,
    };
    let r: R<()> = shard_call(id, "set_ticket_keys", keys).await?;
    r
}

/* ------------------------------------------------------------------ API --- */

/// Identity canister: makes a shard the home of a new account; returns the shard.
#[update]
async fn assign(account: Principal) -> R<Principal> {
    if Some(msg_caller()) != state().identity && !ic_cdk::api::is_controller(&msg_caller()) {
        return Err("Only the identity canister assigns accounts".into());
    }
    let mut tried: Vec<Principal> = vec![];
    loop {
        let s = state();
        let id = match pick(&s.shards, limits().capacity, &tried) {
            Some(id) => id,
            None => {
                if CREATING.with(|c| c.replace(true)) {
                    return Err("A new shard is being created. Try again shortly.".into());
                }
                let r = create_shard_inner().await;
                CREATING.with(|c| *c.borrow_mut() = false);
                r?
            }
        };
        let r: R<()> = shard_call(id, "adopt_account", account).await?;
        match r {
            Ok(()) => {
                update_state(|s| {
                    if let Some(x) = s.shards.iter_mut().find(|x| x.id == id) {
                        x.accounts += 1;
                    }
                });
                return Ok(id);
            }
            Err(e) if e.starts_with("CanisterFull") => {
                update_state(|s| {
                    if let Some(x) = s.shards.iter_mut().find(|x| x.id == id) {
                        x.open = false;
                    }
                });
                tried.push(id);
            }
            Err(e) => return Err(e),
        }
    }
}

/// Controllers: stores the inbox wasm used for new shards and upgrades.
#[update]
fn set_inbox_wasm(module: ByteBuf) -> R<String> {
    require_controller()?;
    WASM.with(|c| c.borrow_mut().set(Wasm(module.into_vec())));
    let (_, h) = wasm()?;
    update_state(|s| s.wasm_hash = h.clone());
    log(format!("inbox wasm set {h}"));
    Ok(h)
}

/// Controllers: creates a new shard now.
#[update]
async fn create_shard() -> R<Principal> {
    require_controller()?;
    create_shard_inner().await
}

/// Controllers: adds a shard created elsewhere (this canister must control it).
#[update]
async fn add_shard(id: Principal, number: u32) -> R<()> {
    require_controller()?;
    register(id, number, String::new());
    push_keys(id).await
}

/// Controllers: upgrades at most `max` shards not yet on the stored wasm,
/// lowest number first. Upgrade 1, watch, then more (waves).
#[update]
async fn upgrade_shards(max: u32) -> R<Vec<Principal>> {
    require_controller()?;
    let (module, hash) = wasm()?;
    let due: Vec<Principal> =
        state().shards.iter().filter(|s| s.wasm_hash != hash).take(max as usize).map(|s| s.id).collect();
    let mut done = vec![];
    for id in due {
        let r: R<()> = mgmt(
            "install_code",
            InstallCodeArgs {
                mode: CanisterInstallMode::Upgrade(Some(UpgradeFlags {
                    skip_pre_upgrade: None,
                    wasm_memory_persistence: None,
                })),
                canister_id: id,
                wasm_module: module.clone(),
                arg: Encode!(&()).unwrap(),
                sender_canister_version: None,
            },
            0,
        )
        .await;
        match r {
            Ok(()) => {
                update_state(|s| {
                    if let Some(x) = s.shards.iter_mut().find(|x| x.id == id) {
                        x.wasm_hash = hash.clone();
                    }
                });
                log(format!("upgraded {id}"));
                done.push(id);
            }
            Err(e) => {
                log(format!("upgrade of {id} failed: {e}"));
                return Err(format!("Stopped: {e}"));
            }
        }
    }
    Ok(done)
}

#[derive(CandidType, Deserialize, Debug)]
struct ShardStats {
    shard_number: u32,
    accounts: u64,
    capacity: u64,
    open: bool,
    queued_entries: u64,
    stable_memory_bytes: u64,
    cycles: u128,
}

/// Refreshes stats, closes full shards, tops up cycles, hands out the
/// current ticket keys, and opens a spare shard when none has room.
async fn refresh_all() -> R<()> {
    let keys_before = state().ticket_keys;
    let keys = fetch_keys().await.unwrap_or(keys_before.clone());
    let l = limits();
    for shard in state().shards {
        let Ok(st) = shard_call::<_, ShardStats>(shard.id, "stats", ()).await else {
            log(format!("stats from {} failed", shard.id));
            continue;
        };
        let mut s = shard.clone();
        s.accounts = st.accounts;
        s.open = st.open;
        s.cycles = st.cycles;
        s.stable_memory_bytes = st.stable_memory_bytes;
        s.queued_entries = st.queued_entries;
        s.checked_at_ns = time();
        if s.open && over_limits(&s, &l) {
            let _: R<R<()>> = shard_call(s.id, "set_open", false).await;
            s.open = false;
            log(format!("closed shard {} to new accounts", s.number));
        }
        if s.cycles < l.topup_below && canister_cycle_balance() > l.topup_amount + l.reserve {
            let r: R<()> = mgmt("deposit_cycles", CanisterIdRecord { canister_id: s.id }, l.topup_amount).await;
            if r.is_ok() {
                s.cycles += l.topup_amount;
                log(format!("topped up shard {}", s.number));
            }
        }
        if keys != keys_before || shard.checked_at_ns == 0 {
            let _: R<R<()>> = shard_call(s.id, "set_ticket_keys", keys.clone()).await;
        }
        update_state(|x| {
            if let Some(y) = x.shards.iter_mut().find(|y| y.id == s.id) {
                *y = s;
            }
        });
    }
    if pick(&state().shards, l.capacity, &[]).is_none() && !state().shards.is_empty() && wasm().is_ok() {
        let _ = create_shard_inner().await;
    }
    Ok(())
}

/// Controllers: runs the hourly refresh now.
#[update]
async fn refresh() -> R<()> {
    require_controller()?;
    refresh_all().await
}

/// Controllers: moves an account to another shard (copy, switch its home in
/// the identity canister, then drop the old copy). `from` may be the identity
/// canister ("shard 000").
#[update]
async fn move_account(account: Principal, from: Principal, to: Principal) -> R<()> {
    require_controller()?;
    let identity = state().identity.ok_or("No identity canister set")?;
    let data: R<AccountExport> = shard_call(from, "export_account", account).await?;
    let data = data?;
    // From here `from` refuses new entries for the account ("Moved").
    let switched = async {
        let r: R<()> = shard_call2(to, "import_account", account, data).await?;
        r?;
        let r: R<()> = shard_call2(identity, "set_home", account, to).await?;
        r
    }
    .await;
    if let Err(e) = switched {
        // Undo: the account stays where it was; drop any partial copy.
        let _: R<R<()>> = shard_call(to, "drop_account", account).await;
        let _: R<R<()>> = shard_call(from, "cancel_move", account).await;
        log(format!("move of {account} failed: {e}"));
        return Err(e);
    }
    let r: R<()> = shard_call(from, "drop_account", account).await?;
    r?;
    log(format!("moved {account} from {from} to {to}"));
    Ok(())
}

#[update]
fn set_shard_controllers(list: Vec<Principal>) -> R<()> {
    require_controller()?;
    update_state(|s| s.shard_controllers = list.into_iter().take(9).collect());
    Ok(())
}

#[update]
fn set_limits(l: Limits) -> R<()> {
    require_controller()?;
    update_state(|s| s.limits = Some(l));
    Ok(())
}

#[derive(CandidType, Deserialize, Debug)]
pub struct Overview {
    pub identity: Option<Principal>,
    pub limits: Limits,
    pub shards: Vec<Shard>,
    pub wasm_hash: String,
    pub cycles: u128,
    pub accounts: u64,
    pub log: Vec<String>,
}

#[query]
fn overview() -> Overview {
    let s = state();
    Overview {
        identity: s.identity,
        limits: s.limits.unwrap_or_default(),
        accounts: s.shards.iter().map(|x| x.accounts).sum(),
        shards: s.shards,
        wasm_hash: s.wasm_hash,
        cycles: canister_cycle_balance(),
        log: s.log,
    }
}

ic_cdk::export_candid!();

#[cfg(test)]
mod tests {
    use super::*;

    fn shard(n: u8, accounts: u64, open: bool) -> Shard {
        Shard {
            id: Principal::from_slice(&[n]),
            number: n as u32,
            accounts,
            open,
            cycles: 0,
            stable_memory_bytes: 0,
            queued_entries: 0,
            wasm_hash: String::new(),
            checked_at_ns: 0,
        }
    }

    #[test]
    fn picks_the_open_shard_with_the_fewest_accounts() {
        let shards = vec![shard(1, 90_000, true), shard(2, 40_000, true), shard(3, 10, false), shard(4, 40_000, true)];
        assert_eq!(pick(&shards, 100_000, &[]), Some(Principal::from_slice(&[2])), "fewest, then oldest");
        assert_eq!(pick(&shards, 100_000, &[Principal::from_slice(&[2])]), Some(Principal::from_slice(&[4])));
        assert_eq!(pick(&[shard(1, 100_000, true)], 100_000, &[]), None, "full");
        assert_eq!(pick(&[], 100_000, &[]), None);
    }

    #[test]
    fn closes_at_capacity_or_memory() {
        let l = Limits::default();
        assert!(!over_limits(&shard(1, 10, true), &l));
        assert!(over_limits(&shard(1, l.capacity, true), &l));
        let mut big = shard(1, 10, true);
        big.stable_memory_bytes = l.max_stable_memory_bytes;
        assert!(over_limits(&big, &l));
    }

    #[test]
    fn candid_file() {
        std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/open_social_orchestrator.did"), __export_service()).unwrap();
    }
}

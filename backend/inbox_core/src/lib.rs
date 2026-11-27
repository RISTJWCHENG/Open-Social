//! Inbox logic shared by the identity canister ("shard 000") and the inbox
//! shards (`open-social-app-inbox-NNN`): the device key directory, MLS key
//! packages, and per-device queues of end-to-end encrypted entries.
//!
//! The inbox only stores and hands out opaque ciphertext. It never sees
//! plaintext. Entries are deleted once the receiving device acknowledges
//! them, or when they expire.
//!
//! Storage is passed in (`Inbox::init`), so each canister keeps its own,
//! permanent memory ids; the identity canister keeps the ids it always used.

pub mod groups;
pub mod ticket;

use candid::{CandidType, Decode, Deserialize, Encode, Principal};
use ic_stable_structures::storable::Bound;
use ic_stable_structures::{Memory, StableBTreeMap, Storable};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

/// An account as numbered inside one canister.
pub type AccountId = u64;

pub const MAX_ENTRY_BYTES: usize = 64 * 1024;
pub const MAX_QUEUE_PER_DEVICE: u32 = 2_000;
pub const MAX_DEVICES_PER_ACCOUNT: usize = 10;
pub const MAX_FETCH: usize = 100;
/// Bytes of entries in one fetch reply (the reply limit is 3 MiB).
pub const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;
/// Room per item for its other fields (ids, sender, times) in the reply.
const FETCH_ITEM_OVERHEAD: usize = 256;
pub const MAX_LABEL: usize = 60;
/// Unfetched entries are deleted after this long (a device that stays away
/// this long resynchronises from its peers or backup instead).
pub const MAIL_TTL_NS: u64 = 30 * 86_400 * 1_000_000_000;
/// Direct-link offers kept per sender in one mailbox (the oldest is replaced).
pub const MAX_EPHEMERAL_PER_SENDER: usize = 2;
/// Direct-link offers older than this are useless and dropped.
pub const EPHEMERAL_TTL_NS: u64 = 10 * 60 * 1_000_000_000;
/// Expired entries removed per call that changes the mailbox.
pub const SWEEP_PER_CALL: usize = 100;

pub const MAX_KEY_PACKAGE_BYTES: usize = 8 * 1024;
pub const MAX_SINGLE_USE_BYTES: usize = 1024;
pub const MAX_SINGLE_USE_KEYS: usize = 200;

pub const MAX_BATCH: usize = 50;
pub const MAX_BATCH_BYTES: usize = 512 * 1024;

/* ---------------------------------------------------------------- types --- */

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Device {
    pub device_id: String,
    pub encryption_key: Vec<u8>,
    pub signing_key: Vec<u8>,
    pub label: String,
    pub added_at_ns: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct MailItem {
    pub id: u64,
    pub from: Principal,
    pub received_at_ns: u64,
    pub entry: Vec<u8>,
    pub ephemeral: bool,
}

#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Devices(pub Vec<Device>);

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
candid_storable!(Devices, MailItem);

/// Stored entry ids, and the indexes of entries skipped because their device's mailbox is full.
#[derive(CandidType, Deserialize, Default, Debug, PartialEq)]
pub struct BatchResult {
    pub ids: Vec<u64>,
    pub skipped: Vec<u32>,
}

/// The memories an inbox uses (each must be its own, permanent memory).
pub struct Memories<M> {
    pub devices: M,
    pub mail: M,
    pub mail_count: M,
    pub expiry: M,
    pub offers: M,
    pub last_resort: M,
    pub single_use: M,
}

/// Devices, key packages and queued entries of the accounts in one canister.
pub struct Inbox<M: Memory> {
    /// account -> registered devices (public keys only)
    devices: StableBTreeMap<AccountId, Devices, M>,
    /// box key ++ mail id -> queued encrypted entry
    mail: StableBTreeMap<Vec<u8>, MailItem, M>,
    /// box key -> number of queued regular (non-ephemeral) entries
    mail_count: StableBTreeMap<Vec<u8>, u32, M>,
    /// expiry time ++ mail id -> mail key, oldest first
    expiry: StableBTreeMap<Vec<u8>, Vec<u8>, M>,
    /// box key ++ sender ++ mail id -> () for queued direct-link offers
    offers: StableBTreeMap<Vec<u8>, (), M>,
    /// box key -> last-resort MLS key package
    last_resort: StableBTreeMap<Vec<u8>, Vec<u8>, M>,
    /// box key ++ sequence -> single-use MLS key package
    single_use: StableBTreeMap<Vec<u8>, Vec<u8>, M>,
}

/* ----------------------------------------------------------------- keys --- */

/// Mailbox and key-package key of one device: account ++ id length ++ id.
pub fn box_key(account: AccountId, device_id: &str) -> Vec<u8> {
    let mut k = account.to_be_bytes().to_vec();
    k.push(device_id.len() as u8);
    k.extend_from_slice(device_id.as_bytes());
    k
}

fn with_u64(prefix: &[u8], n: u64) -> Vec<u8> {
    let mut k = prefix.to_vec();
    k.extend_from_slice(&n.to_be_bytes());
    k
}

fn tail_u64(k: &[u8]) -> u64 {
    u64::from_be_bytes(k[k.len() - 8..].try_into().unwrap())
}

fn offer_prefix(bx: &[u8], from: &Principal) -> Vec<u8> {
    let mut k = bx.to_vec();
    k.push(from.as_slice().len() as u8);
    k.extend_from_slice(from.as_slice());
    k
}

fn ttl(ephemeral: bool) -> u64 {
    if ephemeral {
        EPHEMERAL_TTL_NS
    } else {
        MAIL_TTL_NS
    }
}

fn expiry_key(m: &MailItem) -> Vec<u8> {
    with_u64(&m.received_at_ns.saturating_add(ttl(m.ephemeral)).to_be_bytes(), m.id)
}

fn expired(m: &MailItem, now: u64) -> bool {
    now >= m.received_at_ns.saturating_add(ttl(m.ephemeral))
}

/// Keys of a map that start with `prefix`, in order.
fn keys_with_prefix<V: Storable, M: Memory>(map: &StableBTreeMap<Vec<u8>, V, M>, prefix: &[u8]) -> Vec<Vec<u8>> {
    map.keys_range(prefix.to_vec()..).take_while(|k| k.starts_with(prefix)).collect()
}

pub fn valid_device_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

impl<M: Memory> Inbox<M> {
    pub fn init(m: Memories<M>) -> Self {
        Inbox {
            devices: StableBTreeMap::init(m.devices),
            mail: StableBTreeMap::init(m.mail),
            mail_count: StableBTreeMap::init(m.mail_count),
            expiry: StableBTreeMap::init(m.expiry),
            offers: StableBTreeMap::init(m.offers),
            last_resort: StableBTreeMap::init(m.last_resort),
            single_use: StableBTreeMap::init(m.single_use),
        }
    }

    /* ---------------------------------------------------------- devices --- */

    pub fn devices_of(&self, account: AccountId) -> Vec<Device> {
        self.devices.get(&account).map(|d| d.0).unwrap_or_default()
    }

    fn has_device(&self, account: AccountId, device_id: &str) -> bool {
        self.devices_of(account).iter().any(|x| x.device_id == device_id)
    }

    pub fn register_device(&mut self, account: AccountId, device: Device) -> Result<(), String> {
        if !valid_device_id(&device.device_id) {
            return Err("Invalid device id".into());
        }
        if device.encryption_key.len() != 65 || device.signing_key.len() != 65 {
            return Err("Device keys must be 65-byte uncompressed P-256 keys".into());
        }
        if device.label.chars().count() > MAX_LABEL {
            return Err("Device name is too long".into());
        }
        let mut list = self.devices_of(account);
        if let Some(existing) = list.iter_mut().find(|x| x.device_id == device.device_id) {
            if existing.encryption_key != device.encryption_key || existing.signing_key != device.signing_key {
                return Err("This device id is already registered with different keys".into());
            }
            existing.label = device.label;
        } else {
            if list.len() >= MAX_DEVICES_PER_ACCOUNT {
                return Err("Too many devices on this account. Remove one first.".into());
            }
            list.push(device);
        }
        self.devices.insert(account, Devices(list));
        Ok(())
    }

    pub fn remove_device(&mut self, account: AccountId, device_id: &str) -> Result<(), String> {
        let mut list = self.devices_of(account);
        let before = list.len();
        list.retain(|x| x.device_id != device_id);
        if list.len() == before {
            return Err("Device not found".into());
        }
        self.devices.insert(account, Devices(list));
        self.clear_device_data(&box_key(account, device_id));
        Ok(())
    }

    /// Removes a device's queued mail and key packages.
    fn clear_device_data(&mut self, bx: &[u8]) {
        for k in keys_with_prefix(&self.mail, bx) {
            self.remove_mail(&k);
        }
        for k in keys_with_prefix(&self.single_use, bx) {
            self.single_use.remove(&k);
        }
        self.last_resort.remove(&bx.to_vec());
        self.mail_count.remove(&bx.to_vec());
    }

    /// Removes an account's devices, key packages and queued mail.
    pub fn delete_account(&mut self, account: AccountId) {
        for dev in self.devices.remove(&account).map(|d| d.0).unwrap_or_default() {
            self.clear_device_data(&box_key(account, &dev.device_id));
        }
    }

    /* ----------------------------------------------------- key packages --- */

    /// Publishes a device's last-resort key package (a new one replaces the whole
    /// set) and adds single-use key packages. Returns how many single-use ones are left.
    pub fn publish_key_packages(
        &mut self,
        account: AccountId,
        device_id: &str,
        last_resort: Option<Vec<u8>>,
        single_use: Vec<Vec<u8>>,
    ) -> Result<u32, String> {
        if !self.has_device(account, device_id) {
            return Err("Register the device first".into());
        }
        if last_resort.as_ref().is_some_and(|b| b.is_empty() || b.len() > MAX_KEY_PACKAGE_BYTES) {
            return Err("Key package is too large".into());
        }
        if single_use.iter().any(|k| k.is_empty() || k.len() > MAX_SINGLE_USE_BYTES) {
            return Err("Invalid key package".into());
        }
        let bx = box_key(account, device_id);
        if let Some(b) = last_resort {
            for k in keys_with_prefix(&self.single_use, &bx) {
                self.single_use.remove(&k);
            }
            self.last_resort.insert(bx.clone(), b);
        }
        if !self.last_resort.contains_key(&bx) {
            return Err("Publish a last-resort key package first".into());
        }
        let existing = keys_with_prefix(&self.single_use, &bx);
        let mut next = existing.last().map_or(0, |k| tail_u64(k) + 1);
        let room = MAX_SINGLE_USE_KEYS.saturating_sub(existing.len());
        let mut added = 0;
        for kp in single_use.into_iter().take(room) {
            self.single_use.insert(with_u64(&bx, next), kp);
            next += 1;
            added += 1;
        }
        Ok((existing.len() + added) as u32)
    }

    /// Last-resort key package of a device plus one single-use key package, which is removed.
    pub fn claim_key_package(&mut self, account: AccountId, device_id: &str) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
        let bx = box_key(account, device_id);
        let last = self.last_resort.get(&bx)?;
        let one = keys_with_prefix(&self.single_use, &bx).first().and_then(|k| self.single_use.remove(k));
        Some((last, one))
    }

    /// Claims key packages for many devices at once (adding people to a group).
    pub fn claim_key_packages(&mut self, devices: &[(AccountId, String)]) -> Vec<Option<(Vec<u8>, Option<Vec<u8>>)>> {
        devices.iter().map(|(a, d)| self.claim_key_package(*a, d)).collect()
    }

    /* ---------------------------------------------------------- mailbox --- */

    fn regular_count(&self, bx: &[u8]) -> u32 {
        self.mail_count.get(&bx.to_vec()).unwrap_or(0)
    }

    fn add_count(&mut self, bx: &[u8], delta: i64) {
        let n = (self.mail_count.get(&bx.to_vec()).unwrap_or(0) as i64 + delta).max(0) as u32;
        if n == 0 {
            self.mail_count.remove(&bx.to_vec());
        } else {
            self.mail_count.insert(bx.to_vec(), n);
        }
    }

    /// Removes one queued entry and its index records.
    fn remove_mail(&mut self, key: &Vec<u8>) {
        let Some(item) = self.mail.remove(key) else {
            return;
        };
        let bx = &key[..key.len() - 8];
        self.expiry.remove(&expiry_key(&item));
        if item.ephemeral {
            self.offers.remove(&with_u64(&offer_prefix(bx, &item.from), item.id));
        } else {
            self.add_count(bx, -1);
        }
    }

    /// Deletes up to `limit` expired entries, oldest first.
    pub fn sweep(&mut self, now: u64, limit: usize) -> usize {
        let due: Vec<Vec<u8>> = self
            .expiry
            .iter()
            .take(limit)
            .take_while(|e| u64::from_be_bytes(e.key()[..8].try_into().unwrap()) <= now)
            .map(|e| e.value())
            .collect();
        for k in &due {
            self.remove_mail(k);
        }
        due.len()
    }

    fn store(&mut self, id: u64, from: Principal, bx: &[u8], entry: Vec<u8>, now: u64, ephemeral: bool) -> u64 {
        let item = MailItem { id, from, received_at_ns: now, entry, ephemeral };
        let key = with_u64(bx, id);
        self.expiry.insert(expiry_key(&item), key.clone());
        if ephemeral {
            self.offers.insert(with_u64(&offer_prefix(bx, &from), id), ());
        } else {
            self.add_count(bx, 1);
        }
        self.mail.insert(key, item);
        id
    }

    fn check_entry(&self, to: AccountId, device_id: &str, entry: &[u8]) -> Result<(), String> {
        if entry.is_empty() || entry.len() > MAX_ENTRY_BYTES {
            return Err(format!("Message must be 1 to {MAX_ENTRY_BYTES} bytes"));
        }
        if !self.has_device(to, device_id) {
            return Err("Unknown recipient device".into());
        }
        Ok(())
    }

    /// Stores an entry. Direct-link offers never fill a mailbox: each sender keeps
    /// at most a couple per device and they expire after minutes. `next_id`
    /// hands out increasing entry ids.
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_item(
        &mut self,
        next_id: &mut dyn FnMut() -> u64,
        from: Principal,
        to: AccountId,
        device_id: &str,
        entry: Vec<u8>,
        now: u64,
        ephemeral: bool,
    ) -> Result<u64, String> {
        self.check_entry(to, device_id, &entry)?;
        self.sweep(now, SWEEP_PER_CALL);
        let bx = box_key(to, device_id);
        if ephemeral {
            let mine = keys_with_prefix(&self.offers, &offer_prefix(&bx, &from));
            let surplus = (mine.len() + 1).saturating_sub(MAX_EPHEMERAL_PER_SENDER);
            for k in &mine[..surplus] {
                self.remove_mail(&with_u64(&bx, tail_u64(k)));
            }
        } else if self.regular_count(&bx) >= MAX_QUEUE_PER_DEVICE {
            return Err("Recipient's mailbox is full".into());
        }
        Ok(self.store(next_id(), from, &bx, entry, now, ephemeral))
    }

    /// Deposits several entries: all are validated first, then stored in order.
    /// A device whose mailbox can't take its entries is skipped as a whole (so its
    /// chain stays intact); the other devices still get theirs.
    pub fn deposit_batch(
        &mut self,
        next_id: &mut dyn FnMut() -> u64,
        from: Principal,
        items: Vec<(AccountId, String, Vec<u8>, bool)>,
        now: u64,
    ) -> Result<BatchResult, String> {
        if items.is_empty() || items.len() > MAX_BATCH {
            return Err(format!("Send 1 to {MAX_BATCH} entries at a time"));
        }
        if items.iter().map(|i| i.2.len()).sum::<usize>() > MAX_BATCH_BYTES {
            return Err("Batch is too large".into());
        }
        let mut extra: BTreeMap<Vec<u8>, u32> = BTreeMap::new();
        let mut full: BTreeSet<Vec<u8>> = BTreeSet::new();
        for (to, device, entry, ephemeral) in &items {
            self.check_entry(*to, device, entry)?;
            if *ephemeral {
                continue; // never blocked by a full mailbox, never fills one
            }
            let k = box_key(*to, device);
            let n = extra.entry(k.clone()).or_default();
            *n += 1;
            if self.regular_count(&k) + *n > MAX_QUEUE_PER_DEVICE {
                full.insert(k);
            }
        }
        let mut out = BatchResult::default();
        for (i, (to, device, entry, ephemeral)) in items.into_iter().enumerate() {
            if full.contains(&box_key(to, &device)) {
                out.skipped.push(i as u32);
                continue;
            }
            out.ids.push(self.deposit_item(next_id, from, to, &device, entry, now, ephemeral)?);
        }
        Ok(out)
    }

    /// Unexpired entries after `after`, oldest first.
    pub fn fetch(&self, account: AccountId, device_id: &str, after: u64, now: u64) -> Vec<MailItem> {
        let bx = box_key(account, device_id);
        let start = with_u64(&bx, after.saturating_add(1));
        // At most MAX_FETCH entries and MAX_FETCH_BYTES of them (a reply may not
        // exceed 3 MiB; 100 file chunks would); always at least one, so a large
        // entry still goes out on its own.
        let mut out = Vec::new();
        let mut bytes = 0usize;
        for e in self.mail.range(start..).take_while(|e| e.key().starts_with(&bx)) {
            let item = e.value();
            if expired(&item, now) {
                continue;
            }
            let size = item.entry.len() + FETCH_ITEM_OVERHEAD;
            if out.len() == MAX_FETCH || (!out.is_empty() && bytes + size > MAX_FETCH_BYTES) {
                break;
            }
            bytes += size;
            out.push(item);
        }
        out
    }

    /// Deletes every queued entry with id <= up_to. Returns how many were removed.
    pub fn ack(&mut self, account: AccountId, device_id: &str, up_to: u64, now: u64) -> usize {
        let bx = box_key(account, device_id);
        let done: Vec<Vec<u8>> =
            keys_with_prefix(&self.mail, &bx).into_iter().take_while(|k| tail_u64(k) <= up_to).collect();
        for k in &done {
            self.remove_mail(k);
        }
        self.sweep(now, SWEEP_PER_CALL);
        done.len()
    }

    /* -------------------------------------------------------- migration --- */

    /// Everything of one account, to move it to another canister.
    pub fn export_account(&self, account: AccountId) -> AccountExport {
        let devices = self.devices_of(account);
        let mut out = AccountExport { devices: devices.clone(), ..Default::default() };
        for d in &devices {
            let bx = box_key(account, &d.device_id);
            out.last_resort.extend(self.last_resort.get(&bx).map(|b| (d.device_id.clone(), b)));
            for k in keys_with_prefix(&self.single_use, &bx) {
                out.single_use.extend(self.single_use.get(&k).map(|b| (d.device_id.clone(), b)));
            }
            for k in keys_with_prefix(&self.mail, &bx) {
                out.mail.extend(self.mail.get(&k).map(|m| (d.device_id.clone(), m)));
            }
        }
        out
    }

    /// Stores an exported account under `account` here. Entry ids are given
    /// anew (in order), so they stay increasing in this canister.
    pub fn import_account(&mut self, next_id: &mut dyn FnMut() -> u64, account: AccountId, a: AccountExport) {
        self.devices.insert(account, Devices(a.devices));
        for (device, b) in a.last_resort {
            self.last_resort.insert(box_key(account, &device), b);
        }
        let mut seq: BTreeMap<String, u64> = BTreeMap::new();
        for (device, b) in a.single_use {
            let n = seq.entry(device.clone()).or_default();
            self.single_use.insert(with_u64(&box_key(account, &device), *n), b);
            *n += 1;
        }
        for (device, m) in a.mail {
            let bx = box_key(account, &device);
            self.store(next_id(), m.from, &bx, m.entry, m.received_at_ns, m.ephemeral);
        }
    }

    /* ------------------------------------------------------------ stats --- */

    pub fn queued_entries(&self) -> u64 {
        self.mail.len()
    }
}

/// One account's data, as moved between canisters.
#[derive(CandidType, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct AccountExport {
    pub devices: Vec<Device>,
    pub last_resort: Vec<(String, Vec<u8>)>,
    pub single_use: Vec<(String, Vec<u8>)>,
    pub mail: Vec<(String, MailItem)>,
}

#[cfg(test)]
mod tests;

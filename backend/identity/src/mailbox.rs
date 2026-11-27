//! Device key directory and offline mailbox of the accounts that live in
//! this canister ("shard 000"). The logic is in the shared inbox crate
//! (`open_social_inbox_core`), also used by the inbox shards; these wrappers
//! give it this canister's storage and entry ids.

use crate::state::{AccountId, Device, MailItem, ACCOUNTS, HOMES, INBOX, LINKS, LINK_INDEX, PASSKEYS, PRINCIPALS};
use candid::Principal;
pub use open_social_inbox_core::BatchResult;

fn next_mail_id() -> u64 {
    crate::state::update_settings(|s| {
        s.last_mail_id += 1;
        s.last_mail_id
    })
}

pub fn devices_of(account: AccountId) -> Vec<Device> {
    INBOX.with(|i| i.borrow().devices_of(account))
}

pub fn register_device(account: AccountId, device: Device) -> Result<(), String> {
    INBOX.with(|i| i.borrow_mut().register_device(account, device))
}

pub fn remove_device(account: AccountId, device_id: &str) -> Result<(), String> {
    INBOX.with(|i| i.borrow_mut().remove_device(account, device_id))
}

pub fn publish_key_packages(
    account: AccountId,
    device_id: &str,
    last_resort: Option<Vec<u8>>,
    single_use: Vec<Vec<u8>>,
) -> Result<u32, String> {
    INBOX.with(|i| i.borrow_mut().publish_key_packages(account, device_id, last_resort, single_use))
}

pub fn claim_key_package(account: AccountId, device_id: &str) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
    INBOX.with(|i| i.borrow_mut().claim_key_package(account, device_id))
}

pub fn deposit_item(
    from: Principal,
    to: AccountId,
    device_id: &str,
    entry: Vec<u8>,
    now: u64,
    ephemeral: bool,
) -> Result<u64, String> {
    INBOX.with(|i| i.borrow_mut().deposit_item(&mut next_mail_id, from, to, device_id, entry, now, ephemeral))
}

pub fn deposit_batch(
    from: Principal,
    items: Vec<(AccountId, String, Vec<u8>, bool)>,
    now: u64,
) -> Result<BatchResult, String> {
    INBOX.with(|i| i.borrow_mut().deposit_batch(&mut next_mail_id, from, items, now))
}

pub fn fetch(account: AccountId, device_id: &str, after: u64, now: u64) -> Vec<MailItem> {
    INBOX.with(|i| i.borrow().fetch(account, device_id, after, now))
}

pub fn ack(account: AccountId, device_id: &str, up_to: u64, now: u64) -> usize {
    INBOX.with(|i| i.borrow_mut().ack(account, device_id, up_to, now))
}

/* ------------------------------------------------------------- accounts --- */

/// Removes everything stored for an account: sign-in methods, passkeys,
/// devices, key packages, queued mail, principal mappings, home and admin role.
pub fn delete_account(account: AccountId) {
    for link in LINKS.with(|m| m.borrow_mut().remove(&account)).map(|l| l.0).unwrap_or_default() {
        LINK_INDEX.with(|m| m.borrow_mut().remove(&format!("{}:{}", link.kind, link.id)));
        if link.kind == "passkey" {
            PASSKEYS.with(|m| m.borrow_mut().remove(&link.id));
        }
    }
    INBOX.with(|i| i.borrow_mut().delete_account(account));
    HOMES.with(|m| m.borrow_mut().remove(&account));
    if let Some(p) = ACCOUNTS.with(|m| m.borrow_mut().remove(&account)) {
        PRINCIPALS.with(|m| m.borrow_mut().remove(&p));
        crate::state::update_settings(|s| s.admins.retain(|a| *a != p));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Link, Links};

    fn dev(id: &str, b: u8) -> Device {
        Device {
            device_id: id.into(),
            encryption_key: vec![b; 65],
            signing_key: vec![b + 1; 65],
            label: "Laptop".into(),
            added_at_ns: 0,
        }
    }

    fn deposit(from: Principal, to: AccountId, device_id: &str, entry: Vec<u8>, now: u64) -> Result<u64, String> {
        deposit_item(from, to, device_id, entry, now, false)
    }

    #[test]
    fn delete_account_removes_everything_of_that_account_only() {
        for (acct, dev_id) in [(1u64, "a"), (2u64, "b")] {
            register_device(acct, dev(dev_id, 2)).unwrap();
            publish_key_packages(acct, dev_id, Some(vec![1]), vec![vec![2]]).unwrap();
            deposit(Principal::anonymous(), acct, dev_id, vec![3], 0).unwrap();
            let link = Link { kind: "ii".into(), id: format!("p{acct}"), label: String::new(), added_at_ns: 0 };
            LINKS.with(|m| m.borrow_mut().insert(acct, Links(vec![link])));
            LINK_INDEX.with(|m| m.borrow_mut().insert(format!("ii:p{acct}"), acct));
            let p = Principal::from_slice(&[acct as u8, 9]);
            PRINCIPALS.with(|m| m.borrow_mut().insert(p, acct));
            ACCOUNTS.with(|m| m.borrow_mut().insert(acct, p));
        }
        delete_account(1);
        assert!(devices_of(1).is_empty());
        assert!(fetch(1, "a", 0, 0).is_empty());
        assert!(claim_key_package(1, "a").is_none());
        assert!(!LINK_INDEX.with(|m| m.borrow().contains_key(&"ii:p1".to_string())));
        assert!(!LINKS.with(|m| m.borrow().contains_key(&1)));
        assert!(!PRINCIPALS.with(|m| m.borrow().contains_key(&Principal::from_slice(&[1, 9]))));
        // The other account is untouched.
        assert_eq!(devices_of(2).len(), 1);
        assert_eq!(fetch(2, "b", 0, 0).len(), 1);
        assert!(LINK_INDEX.with(|m| m.borrow().contains_key(&"ii:p2".to_string())));
    }
}

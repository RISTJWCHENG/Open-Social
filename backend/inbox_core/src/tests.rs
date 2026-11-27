use super::*;
use ic_stable_structures::VectorMemory;
use std::cell::RefCell;

thread_local! {
    static T: RefCell<Inbox<VectorMemory>> = RefCell::new(Inbox::init(Memories {
        devices: VectorMemory::default(),
        mail: VectorMemory::default(),
        mail_count: VectorMemory::default(),
        expiry: VectorMemory::default(),
        offers: VectorMemory::default(),
        last_resort: VectorMemory::default(),
        single_use: VectorMemory::default(),
    }));
    static SEQ: RefCell<u64> = const { RefCell::new(0) };
}

fn next() -> u64 {
    SEQ.with(|s| {
        *s.borrow_mut() += 1;
        *s.borrow()
    })
}

// The same calls as before the inbox moved into this crate, on one test inbox.
fn register_device(a: AccountId, d: Device) -> Result<(), String> {
    T.with(|t| t.borrow_mut().register_device(a, d))
}
fn remove_device(a: AccountId, id: &str) -> Result<(), String> {
    T.with(|t| t.borrow_mut().remove_device(a, id))
}
fn devices_of(a: AccountId) -> Vec<Device> {
    T.with(|t| t.borrow().devices_of(a))
}
fn publish_key_packages(a: AccountId, id: &str, l: Option<Vec<u8>>, s: Vec<Vec<u8>>) -> Result<u32, String> {
    T.with(|t| t.borrow_mut().publish_key_packages(a, id, l, s))
}
fn claim_key_package(a: AccountId, id: &str) -> Option<(Vec<u8>, Option<Vec<u8>>)> {
    T.with(|t| t.borrow_mut().claim_key_package(a, id))
}
fn deposit_item(f: Principal, to: AccountId, id: &str, e: Vec<u8>, now: u64, eph: bool) -> Result<u64, String> {
    T.with(|t| t.borrow_mut().deposit_item(&mut next, f, to, id, e, now, eph))
}
fn deposit_batch(
    f: Principal,
    items: Vec<(AccountId, String, Vec<u8>, bool)>,
    now: u64,
) -> Result<BatchResult, String> {
    T.with(|t| t.borrow_mut().deposit_batch(&mut next, f, items, now))
}
fn fetch(a: AccountId, id: &str, after: u64, now: u64) -> Vec<MailItem> {
    T.with(|t| t.borrow().fetch(a, id, after, now))
}
fn ack(a: AccountId, id: &str, up_to: u64, now: u64) -> usize {
    T.with(|t| t.borrow_mut().ack(a, id, up_to, now))
}
fn sweep(now: u64, limit: usize) -> usize {
    T.with(|t| t.borrow_mut().sweep(now, limit))
}
fn regular_count(bx: &[u8]) -> u32 {
    T.with(|t| t.borrow().regular_count(bx))
}
fn mail_len() -> u64 {
    T.with(|t| t.borrow().mail.len())
}
fn expiry_len() -> u64 {
    T.with(|t| t.borrow().expiry.len())
}
fn count_len() -> u64 {
    T.with(|t| t.borrow().mail_count.len())
}

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
fn register_rules() {
    assert!(register_device(1, dev("a", 4)).is_ok());
    assert!(register_device(1, dev("a", 4)).is_ok(), "re-register same keys");
    assert!(register_device(1, dev("a", 9)).is_err(), "same id, other keys");
    assert!(register_device(1, dev("bad id!", 4)).is_err());
    let mut short = dev("b", 4);
    short.signing_key = vec![1; 10];
    assert!(register_device(1, short).is_err());
    for i in 0..9 {
        assert!(register_device(1, dev(&format!("d{i}"), 4)).is_ok());
    }
    assert!(register_device(1, dev("x", 4)).is_err(), "device limit");
}

#[test]
fn fetch_replies_stay_under_the_reply_limit() {
    register_device(11, dev("a", 2)).unwrap();
    let p = Principal::anonymous();
    for _ in 0..60 {
        deposit(p, 11, "a", vec![7; MAX_ENTRY_BYTES], 0).unwrap();
    }
    let first = fetch(11, "a", 0, 0);
    let bytes: usize = first.iter().map(|m| m.entry.len()).sum();
    assert!(first.len() < 60 && bytes <= MAX_FETCH_BYTES, "{} entries, {bytes} bytes", first.len());
    // The rest follows on the next fetches, in order, without gaps.
    let mut seen = first.len();
    let mut after = first.last().unwrap().id;
    loop {
        let next = fetch(11, "a", after, 0);
        if next.is_empty() {
            break;
        }
        assert_eq!(next[0].id, after + 1);
        seen += next.len();
        after = next.last().unwrap().id;
    }
    assert_eq!(seen, 60);
    // Small entries: up to MAX_FETCH at a time, as before.
    register_device(12, dev("a", 2)).unwrap();
    for _ in 0..(MAX_FETCH + 5) {
        deposit(p, 12, "a", vec![1; 100], 0).unwrap();
    }
    assert_eq!(fetch(12, "a", 0, 0).len(), MAX_FETCH);
}

#[test]
fn key_packages_are_claimed_once() {
    assert!(publish_key_packages(1, "a", Some(vec![1]), vec![]).is_err(), "unknown device");
    register_device(1, dev("a", 3)).unwrap();
    assert!(publish_key_packages(1, "a", None, vec![vec![9]]).is_err(), "last resort first");
    assert_eq!(publish_key_packages(1, "a", Some(vec![7]), vec![vec![1], vec![2]]).unwrap(), 2);
    assert_eq!(claim_key_package(1, "a"), Some((vec![7], Some(vec![1]))));
    assert_eq!(claim_key_package(1, "a"), Some((vec![7], Some(vec![2]))));
    assert_eq!(claim_key_package(1, "a"), Some((vec![7], None)), "last resort only");
    assert_eq!(claim_key_package(2, "a"), None);
    assert!(publish_key_packages(1, "a", Some(vec![0; MAX_KEY_PACKAGE_BYTES + 1]), vec![]).is_err());
    assert_eq!(publish_key_packages(1, "a", None, vec![vec![3]]).unwrap(), 1);
    assert_eq!(publish_key_packages(1, "a", Some(vec![8]), vec![vec![4]]).unwrap(), 1, "full republish replaces");
    assert_eq!(claim_key_package(1, "a"), Some((vec![8], Some(vec![4]))));
    let many = vec![vec![5]; MAX_SINGLE_USE_KEYS + 10];
    assert_eq!(publish_key_packages(1, "a", None, many).unwrap() as usize, MAX_SINGLE_USE_KEYS);
}

#[test]
fn batch_is_all_or_nothing_and_ordered() {
    register_device(7, dev("a", 2)).unwrap();
    register_device(7, dev("b", 3)).unwrap();
    let p = Principal::anonymous();
    let bad = vec![(7, "a".to_string(), vec![1], false), (7, "nope".to_string(), vec![2], false)];
    assert!(deposit_batch(p, bad, 0).is_err());
    assert_eq!(fetch(7, "a", 0, 0).len(), 0, "nothing stored on error");
    let ids = deposit_batch(
        p,
        vec![(7, "a".into(), vec![1], false), (7, "b".into(), vec![2], false), (7, "a".into(), vec![3], false)],
        0,
    )
    .unwrap()
    .ids;
    assert!(ids.windows(2).all(|w| w[0] < w[1]));
    assert_eq!(fetch(7, "a", 0, 0).iter().map(|m| m.entry[0]).collect::<Vec<_>>(), vec![1, 3]);
    assert!(deposit_batch(p, vec![], 0).is_err());
}

#[test]
fn a_full_device_is_skipped_others_still_receive() {
    register_device(7, dev("old", 2)).unwrap();
    register_device(7, dev("new", 3)).unwrap();
    let p = Principal::anonymous();
    for _ in 0..MAX_QUEUE_PER_DEVICE {
        deposit(p, 7, "old", vec![1], 0).unwrap(); // an abandoned device fills up
    }
    let r = deposit_batch(
        p,
        vec![(7, "old".into(), vec![2], false), (7, "new".into(), vec![3], false), (7, "old".into(), vec![4], false)],
        0,
    )
    .unwrap();
    assert_eq!(r.skipped, vec![0, 2]);
    assert_eq!(r.ids.len(), 1);
    assert_eq!(fetch(7, "new", 0, 0).iter().map(|m| m.entry[0]).collect::<Vec<_>>(), vec![3]);
}

#[test]
fn offers_never_fill_a_mailbox() {
    register_device(7, dev("a", 2)).unwrap();
    let alice = Principal::from_slice(&[1]);
    let bob = Principal::from_slice(&[2]);
    // An online friend keeps offering to an offline one.
    for i in 0..500u64 {
        deposit_batch(alice, vec![(7, "a".into(), vec![(i % 250) as u8], true)], i).unwrap();
    }
    let q = fetch(7, "a", 0, 500);
    assert_eq!(q.len(), MAX_EPHEMERAL_PER_SENDER, "only the latest offers are kept");
    assert_eq!(q.last().unwrap().entry, vec![(499 % 250) as u8]);
    // Real messages still fit: the full regular quota is available.
    for _ in 0..MAX_QUEUE_PER_DEVICE {
        deposit(bob, 7, "a", vec![9], 500).unwrap();
    }
    assert!(deposit(bob, 7, "a", vec![9], 500).is_err());
    // Offers are still accepted with a full mailbox, and they expire.
    assert!(deposit_batch(alice, vec![(7, "a".into(), vec![1], true)], 600).is_ok());
    let later = 600 + EPHEMERAL_TTL_NS + 1;
    assert!(fetch(7, "a", 0, later).iter().all(|m| !m.ephemeral));
}

#[test]
fn unfetched_mail_expires_and_is_swept() {
    register_device(7, dev("a", 2)).unwrap();
    let p = Principal::anonymous();
    deposit(p, 7, "a", vec![1], 0).unwrap();
    deposit(p, 7, "a", vec![2], 10).unwrap();
    assert_eq!(fetch(7, "a", 0, MAIL_TTL_NS - 1).len(), 2);
    assert_eq!(fetch(7, "a", 0, MAIL_TTL_NS).len(), 1, "expired entries are not handed out");
    assert_eq!(sweep(MAIL_TTL_NS + 10, SWEEP_PER_CALL), 2);
    assert_eq!(mail_len(), 0);
    assert_eq!(expiry_len(), 0);
    assert_eq!(regular_count(&box_key(7, "a")), 0, "the quota is freed");
}

#[test]
fn deposit_fetch_ack() {
    register_device(7, dev("phone", 2)).unwrap();
    let p = Principal::anonymous();
    assert!(deposit(p, 7, "nope", vec![1], 0).is_err());
    assert!(deposit(p, 7, "phone", vec![], 0).is_err());
    assert!(deposit(p, 7, "phone", vec![0; MAX_ENTRY_BYTES + 1], 0).is_err());
    let a = deposit(p, 7, "phone", vec![1], 1).unwrap();
    let b = deposit(p, 7, "phone", vec![2], 2).unwrap();
    assert!(b > a);
    assert_eq!(fetch(7, "phone", 0, 0).len(), 2);
    assert_eq!(fetch(7, "phone", a, 0).len(), 1);
    assert_eq!(fetch(8, "phone", 0, 0).len(), 0, "other account sees nothing");
    assert_eq!(ack(7, "phone", a, 0), 1);
    assert_eq!(fetch(7, "phone", 0, 0)[0].entry, vec![2]);
    remove_device(7, "phone").unwrap();
    assert_eq!(fetch(7, "phone", 0, 0).len(), 0);
    assert_eq!(count_len(), 0);
}

#[test]
fn delete_account_removes_only_that_account() {
    for (acct, dev_id) in [(31u64, "a"), (32u64, "b")] {
        register_device(acct, dev(dev_id, 2)).unwrap();
        publish_key_packages(acct, dev_id, Some(vec![1]), vec![vec![2]]).unwrap();
        deposit(Principal::anonymous(), acct, dev_id, vec![3], 0).unwrap();
    }
    T.with(|t| t.borrow_mut().delete_account(31));
    assert!(devices_of(31).is_empty());
    assert!(fetch(31, "a", 0, 0).is_empty());
    assert!(claim_key_package(31, "a").is_none());
    assert_eq!(devices_of(32).len(), 1);
    assert_eq!(fetch(32, "b", 0, 0).len(), 1);
}

#[test]
fn an_account_moves_with_its_devices_keys_and_mail() {
    register_device(41, dev("a", 2)).unwrap();
    publish_key_packages(41, "a", Some(vec![7]), vec![vec![1], vec![2]]).unwrap();
    let p = Principal::from_slice(&[5]);
    deposit(p, 41, "a", vec![10], 3).unwrap();
    deposit_batch(p, vec![(41, "a".into(), vec![11], true)], 4).unwrap();
    let out = T.with(|t| t.borrow().export_account(41));
    assert_eq!(out.mail.len(), 2);
    T.with(|t| t.borrow_mut().delete_account(41));
    T.with(|t| t.borrow_mut().import_account(&mut next, 42, out));
    assert_eq!(devices_of(42).len(), 1);
    let q = fetch(42, "a", 0, 5);
    assert_eq!(
        q.iter().map(|m| (m.entry[0], m.ephemeral, m.from)).collect::<Vec<_>>(),
        vec![(10, false, p), (11, true, p)]
    );
    assert_eq!(regular_count(&box_key(42, "a")), 1);
    assert_eq!(claim_key_package(42, "a"), Some((vec![7], Some(vec![1]))));
}

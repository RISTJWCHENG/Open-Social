use super::*;
use ic_stable_structures::VectorMemory;

fn groups() -> Groups<VectorMemory> {
    Groups::init(GroupMemories {
        meta: VectorMemory::default(),
        members: VectorMemory::default(),
        entries: VectorMemory::default(),
        blobs: VectorMemory::default(),
        chunks: VectorMemory::default(),
        expiry: VectorMemory::default(),
    })
}

fn p(n: u8) -> Principal {
    Principal::from_slice(&[n; 10])
}

const G: &str = "0123456789abcdef";

fn commit(epoch: u64, add: Vec<Principal>, remove: Vec<Principal>) -> CommitArgs {
    CommitArgs { group: G.into(), device: "d1".into(), epoch, commit: vec![1; 100], welcome: None, add, remove }
}

#[test]
fn members_post_and_read_others_cannot() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    assert_eq!(s.post_commit(p(1), commit(0, vec![p(2), p(3)], vec![]), 2), Ok(1));
    assert_eq!(s.post(G, p(2), "d".into(), 1, b"hi".to_vec(), 3), Ok(2));
    assert_eq!(s.post(G, p(9), "d".into(), 1, b"x".to_vec(), 3), Err(PostError::NotMember));
    assert_eq!(s.read(G, p(9), 0), Err(PostError::NotMember));
    let all = s.read(G, p(3), 0).unwrap();
    assert_eq!(
        all.iter().map(|e| (e.seq, e.kind)).collect::<Vec<_>>(),
        vec![(1, EntryKind::Commit), (2, EntryKind::Message)]
    );
    assert_eq!(s.read(G, p(3), 1).unwrap().len(), 1);
    let h = s.heads(&[G.into(), "ffffffffffffffff".into()], p(2));
    assert_eq!(h, vec![Head { group: G.into(), last_seq: 2, epoch: 1, role: Role::Member }]);
    assert!(s.heads(&[G.into()], p(9)).is_empty());
}

#[test]
fn commits_are_ordered_by_epoch() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    s.post_commit(p(1), commit(0, vec![p(2)], vec![]), 2).unwrap();
    s.set_role(G, p(1), p(2), Role::Admin).unwrap();
    // Both admins commit in epoch 1: the second is told to catch up.
    assert_eq!(s.post_commit(p(1), commit(1, vec![p(3)], vec![]), 3), Ok(2));
    assert_eq!(s.post_commit(p(2), commit(1, vec![p(4)], vec![]), 3), Err(PostError::StaleEpoch(2)));
    assert_eq!(s.post_commit(p(2), commit(2, vec![p(4)], vec![]), 4), Ok(3));
    assert_eq!(s.meta(G).unwrap().members, 4);
}

#[test]
fn roles_limit_who_changes_the_access_list() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    s.post_commit(p(1), commit(0, vec![p(2), p(3)], vec![]), 2).unwrap();
    // A member's own commit (a key update, its own devices) is fine; adding people is not.
    assert_eq!(s.post_commit(p(2), commit(1, vec![], vec![]), 3), Ok(2));
    assert!(matches!(s.post_commit(p(2), commit(2, vec![p(4)], vec![]), 3), Err(PostError::NotAllowed(_))));
    s.set_role(G, p(1), p(2), Role::Admin).unwrap();
    // An admin can't remove the owner or another admin.
    assert!(matches!(s.post_commit(p(2), commit(2, vec![], vec![p(1)]), 3), Err(PostError::NotAllowed(_))));
    s.set_role(G, p(2), p(3), Role::Admin).unwrap();
    assert!(matches!(s.post_commit(p(2), commit(2, vec![], vec![p(3)]), 3), Err(PostError::NotAllowed(_))));
    assert!(matches!(s.set_role(G, p(2), p(3), Role::Member), Err(PostError::NotAllowed(_))));
    // The owner can.
    assert_eq!(s.post_commit(p(1), commit(2, vec![], vec![p(3)]), 4), Ok(3));
    assert_eq!(s.read(G, p(3), 0), Err(PostError::NotMember));
}

#[test]
fn leaving_and_handing_over() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    s.post_commit(p(1), commit(0, vec![p(2), p(3)], vec![]), 2).unwrap();
    assert!(matches!(s.leave(G, p(1), None), Err(PostError::Invalid(_))));
    s.leave(G, p(1), Some(p(3))).unwrap();
    assert_eq!(s.meta(G).unwrap().owner, p(3));
    assert_eq!(s.role(&parse_group(G).unwrap(), &p(3)), Some(Role::Owner));
    s.leave(G, p(2), None).unwrap();
    s.leave(G, p(3), None).unwrap();
    assert!(s.meta(G).is_none());
}

#[test]
fn blobs_are_stored_once_and_welcome_must_be_complete() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    s.blob_put(G, p(1), 7, 0, 2, 10, vec![1; 5], 2).unwrap();
    let mut c = commit(0, vec![p(2)], vec![]);
    c.welcome = Some(7);
    assert!(matches!(s.post_commit(p(1), c.clone(), 3), Err(PostError::Invalid(_))));
    s.blob_put(G, p(1), 7, 1, 2, 10, vec![2; 5], 3).unwrap();
    assert_eq!(s.post_commit(p(1), c, 3), Ok(1));
    // The new member reads the Welcome.
    assert_eq!(s.blob_get(G, p(2), 7, 1), Ok(vec![2; 5]));
    assert_eq!(s.read(G, p(2), 0).unwrap()[0].welcome, Some(7));
    // Another member can't overwrite it.
    assert!(matches!(s.blob_put(G, p(2), 7, 0, 2, 10, vec![9; 5], 4), Err(PostError::NotAllowed(_))));
}

#[test]
fn entries_expire_and_groups_stay_within_limits() {
    let mut s = groups();
    s.create(G, p(1), 1).unwrap();
    for i in 0..5 {
        s.post(G, p(1), "d".into(), 0, vec![i; 10], 10 + i as u64).unwrap();
    }
    assert_eq!(s.sweep(11 + ENTRY_TTL_NS, 100), 2);
    assert_eq!(s.read(G, p(1), 0).unwrap().iter().map(|e| e.seq).collect::<Vec<_>>(), vec![3, 4, 5]);
    assert_eq!(s.meta(G).unwrap().entries, 3);
    // Seq numbers go on after expiry.
    assert_eq!(s.post(G, p(1), "d".into(), 0, vec![1], 20), Ok(6));
}

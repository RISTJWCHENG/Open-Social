//! Send tickets: proof, issued by the identity canister, that a principal is
//! an OpenSocial account, so an inbox shard can accept its entries without an
//! inter-canister call. `mac = HMAC-SHA256(key[epoch], domain || principal || expiry)`.
//!
//! The keys only prove "is an OpenSocial account" (anti-spam). Node operators of
//! a subnet can read canister state, so they are not a secret from them;
//! message contents stay end-to-end encrypted regardless.

use candid::{CandidType, Deserialize, Principal};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// How long a ticket is valid.
pub const TICKET_TTL_NS: u64 = 24 * 3600 * 1_000_000_000;
const DOMAIN: &[u8] = b"open-social-send-ticket-v1";

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Ticket {
    pub principal: Principal,
    pub expires_at_ns: u64,
    pub epoch: u32,
    pub mac: Vec<u8>,
}

/// A ticket key. The identity canister signs with the newest; shards accept
/// the newest two, so tickets stay valid across a key rotation.
#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct TicketKey {
    pub epoch: u32,
    pub key: Vec<u8>,
}

fn hmac(key: &[u8], principal: &Principal, expires_at_ns: u64) -> Hmac<Sha256> {
    let mut m = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC takes any key length");
    m.update(DOMAIN);
    m.update(&[principal.as_slice().len() as u8]);
    m.update(principal.as_slice());
    m.update(&expires_at_ns.to_be_bytes());
    m
}

/// A ticket for `principal`, valid for TICKET_TTL_NS from `now`.
pub fn issue(key: &TicketKey, principal: Principal, now: u64) -> Ticket {
    let expires_at_ns = now.saturating_add(TICKET_TTL_NS);
    let mac = hmac(&key.key, &principal, expires_at_ns).finalize().into_bytes().to_vec();
    Ticket { principal, expires_at_ns, epoch: key.epoch, mac }
}

/// Checks that the ticket belongs to `caller`, has not expired, and was made
/// with one of `keys` (compared in constant time).
pub fn verify(keys: &[TicketKey], t: &Ticket, caller: &Principal, now: u64) -> Result<(), String> {
    if t.principal != *caller {
        return Err("This ticket belongs to another account".into());
    }
    if now >= t.expires_at_ns {
        return Err("TicketExpired: get a new send ticket".into());
    }
    let key = keys.iter().find(|k| k.epoch == t.epoch).ok_or("TicketExpired: get a new send ticket")?;
    hmac(&key.key, &t.principal, t.expires_at_ns).verify_slice(&t.mac).map_err(|_| "Invalid send ticket".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_and_verify() {
        let k1 = TicketKey { epoch: 1, key: vec![7; 32] };
        let k2 = TicketKey { epoch: 2, key: vec![8; 32] };
        let alice = Principal::from_slice(&[1, 2, 3]);
        let bob = Principal::from_slice(&[4, 5]);
        let t = issue(&k1, alice, 100);
        assert!(verify(&[k1.clone(), k2.clone()], &t, &alice, 100).is_ok());
        assert!(verify(&[k1.clone()], &t, &bob, 100).is_err(), "another caller");
        assert!(verify(&[k1.clone()], &t, &alice, 100 + TICKET_TTL_NS).unwrap_err().starts_with("TicketExpired"));
        assert!(verify(&[k2.clone()], &t, &alice, 100).unwrap_err().starts_with("TicketExpired"), "retired key");
        let mut forged = t.clone();
        forged.expires_at_ns += 1;
        assert!(verify(&[k1.clone()], &forged, &alice, 100).is_err(), "changed expiry");
        let mut other = t.clone();
        other.mac = issue(&TicketKey { epoch: 1, key: vec![9; 32] }, alice, 100).mac;
        assert!(verify(&[k1], &other, &alice, 100).is_err(), "made with another key");
    }
}

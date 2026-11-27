// OpenSocial recovery pass: the first recovery check, following the zPass
// pattern (an issuer-signed credential whose holder proves possession in zero
// knowledge). Uses only Aleo built-ins: Poseidon2 and signature verification.

// What the issuer signs. `subject` is the holder's Aleo address and must be the
// caller when proving; `account` is a commitment to the OpenSocial account.
struct Credential {
    issuer: address,
    subject: address,
    account: field,
    expiry: u32,
}

program open_social_recovery_pass.aleo {
    @noupgrade
    constructor() {}

    // The message an issuer signs. Exposed so issuers and tests can check they
    // compute exactly the same hash as the circuit.
    fn credential_hash(issuer: address, subject: address, account: field, expiry: u32) -> field {
        let cred: Credential = Credential { issuer: issuer, subject: subject, account: account, expiry: expiry };
        return Poseidon2::hash_to_field(cred);
    }

    // Proves, without revealing the signature or the expiry, that the caller
    // holds a credential the issuer signed for this account and that it has not
    // expired. `nonce` is a fresh verifier challenge (replay protection) and
    // `now` is the verifier's clock in minutes since the Unix epoch.
    fn prove_recovery(
        sig: signature,
        public issuer: address,
        public account: field,
        expiry: u32,
        public nonce: field,
        public now: u32,
    ) -> public field {
        let cred: Credential = Credential {
            issuer: issuer,
            subject: std::ctx::caller(),
            account: account,
            expiry: expiry,
        };
        assert(signature::verify(sig, issuer, Poseidon2::hash_to_field(cred)));
        assert(expiry >= now);
        // A value bound to the challenge, so the proof is useless for other nonces.
        return Poseidon2::hash_to_field(nonce);
    }
}

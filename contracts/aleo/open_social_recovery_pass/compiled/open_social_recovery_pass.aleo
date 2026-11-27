program open_social_recovery_pass.aleo;

struct Credential:
    issuer as address;
    subject as address;
    account as field;
    expiry as u32;

function credential_hash:
    input r0 as address.private;
    input r1 as address.private;
    input r2 as field.private;
    input r3 as u32.private;
    cast r0 r1 r2 r3 into r4 as Credential;
    hash.psd2 r4 into r5 as field;
    output r5 as field.private;

function prove_recovery:
    input r0 as signature.private;
    input r1 as address.public;
    input r2 as field.public;
    input r3 as u32.private;
    input r4 as field.public;
    input r5 as u32.public;
    cast r1 self.caller r2 r3 into r6 as Credential;
    hash.psd2 r6 into r7 as field;
    sign.verify r0 r1 r7 into r8;
    assert.eq r8 true;
    gte r3 r5 into r9;
    assert.eq r9 true;
    hash.psd2 r4 into r10 as field;
    output r10 as field.public;

constructor:
    assert.eq edition 0u16;

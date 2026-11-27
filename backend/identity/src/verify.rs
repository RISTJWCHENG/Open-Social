//! Pure verification logic, independent of the IC runtime so it can be unit tested.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};

/* ------------------------------------------------------------ WebAuthn --- */

#[derive(Debug, PartialEq)]
pub struct ClientData {
    pub type_: String,
    pub challenge: Vec<u8>,
    pub origin: String,
}

pub fn parse_client_data(json: &[u8]) -> Result<ClientData, String> {
    let v: serde_json::Value =
        serde_json::from_slice(json).map_err(|e| format!("Invalid clientDataJSON: {e}"))?;
    let get = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("clientDataJSON is missing `{k}`"))
    };
    let challenge = URL_SAFE_NO_PAD
        .decode(get("challenge")?)
        .map_err(|_| "Invalid challenge encoding".to_string())?;
    Ok(ClientData { type_: get("type")?, challenge, origin: get("origin")? })
}

pub struct AuthData<'a> {
    pub rp_id_hash: &'a [u8],
    pub flags: u8,
    /// Attested credential data (present on registration).
    pub attested: Option<&'a [u8]>,
}

const FLAG_UP: u8 = 0x01;
const FLAG_AT: u8 = 0x40;

pub fn parse_auth_data(data: &[u8]) -> Result<AuthData<'_>, String> {
    if data.len() < 37 {
        return Err("authenticatorData too short".into());
    }
    let flags = data[32];
    let attested = if flags & FLAG_AT != 0 { Some(&data[37..]) } else { None };
    Ok(AuthData { rp_id_hash: &data[..32], flags, attested })
}

pub fn check_auth_data(auth: &AuthData, rp_id: &str) -> Result<(), String> {
    if auth.rp_id_hash != &Sha256::digest(rp_id.as_bytes())[..] {
        return Err("Passkey belongs to a different site".into());
    }
    if auth.flags & FLAG_UP == 0 {
        return Err("User presence was not confirmed".into());
    }
    Ok(())
}

/// Extracts (credential id, uncompressed P-256 key) from attested credential data.
pub fn parse_attested_credential(attested: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    // aaguid (16) | credIdLen (2, BE) | credId | COSE key (CBOR)
    if attested.len() < 18 {
        return Err("Attested credential data too short".into());
    }
    let len = u16::from_be_bytes([attested[16], attested[17]]) as usize;
    if attested.len() < 18 + len {
        return Err("Credential id truncated".into());
    }
    let cred_id = attested[18..18 + len].to_vec();
    let cose: ciborium::Value = ciborium::de::from_reader(&attested[18 + len..])
        .map_err(|e| format!("Invalid COSE key: {e}"))?;
    let map = cose.as_map().ok_or("COSE key is not a map")?;
    let int_key = |k: i64| {
        map.iter().find_map(|(key, val)| match key.as_integer() {
            Some(i) if i128::from(i) == k as i128 => Some(val),
            _ => None,
        })
    };
    let kty = int_key(1).and_then(|v| v.as_integer()).map(i128::from);
    let alg = int_key(3).and_then(|v| v.as_integer()).map(i128::from);
    let crv = int_key(-1).and_then(|v| v.as_integer()).map(i128::from);
    if kty != Some(2) || alg != Some(-7) || crv != Some(1) {
        return Err("Only ES256 (P-256) passkeys are supported".into());
    }
    let x = int_key(-2).and_then(|v| v.as_bytes()).ok_or("COSE key has no x")?;
    let y = int_key(-3).and_then(|v| v.as_bytes()).ok_or("COSE key has no y")?;
    if x.len() != 32 || y.len() != 32 {
        return Err("Invalid P-256 coordinates".into());
    }
    let mut pk = Vec::with_capacity(65);
    pk.push(0x04);
    pk.extend_from_slice(x);
    pk.extend_from_slice(y);
    // Validate the point.
    p256::PublicKey::from_sec1_bytes(&pk).map_err(|_| "Invalid P-256 public key".to_string())?;
    Ok((cred_id, pk))
}

/// Extracts authenticatorData from a CBOR attestation object ("none" or any format;
/// attestation statements are not verified, as is usual for consumer passkeys).
pub fn auth_data_from_attestation(att_obj: &[u8]) -> Result<Vec<u8>, String> {
    let v: ciborium::Value = ciborium::de::from_reader(att_obj)
        .map_err(|e| format!("Invalid attestationObject: {e}"))?;
    let map = v.as_map().ok_or("attestationObject is not a map")?;
    map.iter()
        .find(|(k, _)| k.as_text() == Some("authData"))
        .and_then(|(_, v)| v.as_bytes().cloned())
        .ok_or_else(|| "attestationObject has no authData".to_string())
}

/// Verifies a WebAuthn assertion signature (DER ECDSA P-256 over authData || SHA-256(clientData)).
pub fn verify_assertion(
    public_key: &[u8],
    auth_data: &[u8],
    client_data_json: &[u8],
    signature_der: &[u8],
) -> Result<(), String> {
    use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
    let key = VerifyingKey::from_sec1_bytes(public_key).map_err(|_| "Bad stored key".to_string())?;
    let sig = Signature::from_der(signature_der).map_err(|_| "Bad signature encoding".to_string())?;
    let mut msg = auth_data.to_vec();
    msg.extend_from_slice(&Sha256::digest(client_data_json));
    key.verify(&msg, &sig).map_err(|_| "Passkey signature is invalid".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webauthn_assertion_roundtrip_and_tamper() {
        use p256::ecdsa::{signature::Signer, Signature, SigningKey};
        let sk = SigningKey::from_bytes(&[7u8; 32].into()).unwrap();
        let pk = sk.verifying_key().to_encoded_point(false).as_bytes().to_vec();
        let rp_hash = Sha256::digest(b"example.icp0.io");
        let mut auth = rp_hash.to_vec();
        auth.push(0x05); // UP | UV
        auth.extend_from_slice(&[0, 0, 0, 1]);
        let cd = br#"{"type":"webauthn.get","challenge":"AQID","origin":"https://example.icp0.io"}"#;
        let mut msg = auth.clone();
        msg.extend_from_slice(&Sha256::digest(cd));
        let sig: Signature = sk.sign(&msg);
        let der = sig.to_der();
        assert!(verify_assertion(&pk, &auth, cd, der.as_bytes()).is_ok());
        let parsed = parse_auth_data(&auth).unwrap();
        assert!(check_auth_data(&parsed, "example.icp0.io").is_ok());
        assert!(check_auth_data(&parsed, "evil.example").is_err());
        let cdp = parse_client_data(cd).unwrap();
        assert_eq!(cdp.challenge, vec![1, 2, 3]);
        let mut bad = auth.clone();
        bad[33] ^= 1;
        assert!(verify_assertion(&pk, &bad, cd, der.as_bytes()).is_err());
    }

    #[test]
    fn webauthn_registration_parses_cose_key() {
        use p256::ecdsa::SigningKey;
        let sk = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
        let point = sk.verifying_key().to_encoded_point(false);
        let cose = ciborium::Value::Map(vec![
            (1.into(), 2.into()),
            (3.into(), (-7).into()),
            ((-1).into(), 1.into()),
            ((-2).into(), ciborium::Value::Bytes(point.x().unwrap().to_vec())),
            ((-3).into(), ciborium::Value::Bytes(point.y().unwrap().to_vec())),
        ]);
        let mut cose_bytes = vec![];
        ciborium::ser::into_writer(&cose, &mut cose_bytes).unwrap();
        let mut attested = vec![0u8; 16];
        attested.extend_from_slice(&3u16.to_be_bytes());
        attested.extend_from_slice(&[0xaa, 0xbb, 0xcc]);
        attested.extend_from_slice(&cose_bytes);
        let (id, pk) = parse_attested_credential(&attested).unwrap();
        assert_eq!(id, vec![0xaa, 0xbb, 0xcc]);
        assert_eq!(pk, point.as_bytes().to_vec());
    }
}

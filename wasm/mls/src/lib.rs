//! OpenSocial wrapper around OpenMLS (RFC 9420), compiled to WebAssembly.
//!
//! One-to-one messaging between two devices uses two MLS groups, one per
//! direction: each device creates an "outbound" group with the other device
//! as the only other member and is the only one to commit in it. This avoids
//! concurrent commits (MLS needs a total order of commits) while keeping MLS's
//! forward secrecy; the sender heals its own leaf with a self-update commit
//! every SELF_UPDATE_EVERY messages.
//!
//! Group chats use one MLS group per chat with every member's devices in it:
//! each message is encrypted once. The group's inbox shard orders commits (it
//! accepts a commit only for its current epoch), so a commit made here stays
//! pending until the shard has taken it (`groupMerge`) or refused it
//! (`groupDiscard`).
//!
//! Ciphersuite: MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 (the mandatory one).

use openmls::prelude::tls_codec::{Deserialize as TlsDeserialize, Serialize as TlsSerialize};
use openmls::prelude::*;
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use openmls_traits::OpenMlsProvider;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::BTreeMap;
use wasm_bindgen::prelude::*;

const CIPHERSUITE: Ciphersuite = Ciphersuite::MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519;
const SELF_UPDATE_EVERY: u32 = 50;
/// Epochs whose keys a group member keeps, for messages sent just before a commit.
const GROUP_PAST_EPOCHS: usize = 8;
/// MLS group ids of group chats: this prefix and the chat's 16-hex id.
const GROUP_PREFIX: &str = "zg:";

#[derive(Default)]
struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl OpenMlsProvider for Provider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;
    fn storage(&self) -> &MemoryStorage {
        &self.storage
    }
    fn crypto(&self) -> &RustCrypto {
        &self.crypto
    }
    fn rand(&self) -> &RustCrypto {
        &self.crypto
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Meta {
    identity: String,
    signature_key: Vec<u8>,
    /// remote device address -> group id (hex) of the group we send in
    outbound: BTreeMap<String, String>,
    /// remote device address -> group id (hex) of the group they send in
    inbound: BTreeMap<String, String>,
    sent: BTreeMap<String, u32>,
}

fn err<E: std::fmt::Debug>(e: E) -> JsError {
    JsError::new(&format!("{e:?}"))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).filter_map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn group_id(gid: &str) -> GroupId {
    GroupId::from_slice(format!("{GROUP_PREFIX}{gid}").as_bytes())
}

fn set(obj: &js_sys::Object, key: &str, value: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(obj, &JsValue::from_str(key), value).map_err(|_| JsError::new("set"))?;
    Ok(())
}

fn strings(items: Vec<String>) -> js_sys::Array {
    items.into_iter().map(JsValue::from).collect()
}

fn identity_of(c: &Credential) -> Option<String> {
    BasicCredential::try_from(c.clone()).ok().and_then(|b| String::from_utf8(b.identity().to_vec()).ok())
}

/// Storage values as: count, then (key length, key, value length, value), big-endian u32 lengths.
fn write_storage(st: &MemoryStorage, out: &mut Vec<u8>) {
    let values = st.values.read().expect("storage lock");
    let mut entries: Vec<_> = values.iter().collect();
    entries.sort();
    out.extend_from_slice(&(entries.len() as u32).to_be_bytes());
    for (k, v) in entries {
        out.extend_from_slice(&(k.len() as u32).to_be_bytes());
        out.extend_from_slice(k);
        out.extend_from_slice(&(v.len() as u32).to_be_bytes());
        out.extend_from_slice(v);
    }
}

fn read_storage(mut b: &[u8]) -> Option<MemoryStorage> {
    fn take<'a>(b: &mut &'a [u8], n: usize) -> Option<&'a [u8]> {
        if b.len() < n {
            return None;
        }
        let (h, t) = b.split_at(n);
        *b = t;
        Some(h)
    }
    fn len(b: &mut &[u8]) -> Option<usize> {
        let x = take(b, 4)?;
        Some(u32::from_be_bytes([x[0], x[1], x[2], x[3]]) as usize)
    }
    let count = len(&mut b)?;
    let mut map = std::collections::HashMap::with_capacity(count);
    for _ in 0..count {
        let kl = len(&mut b)?;
        let k = take(&mut b, kl)?.to_vec();
        let vl = len(&mut b)?;
        let v = take(&mut b, vl)?.to_vec();
        map.insert(k, v);
    }
    Some(MemoryStorage { values: std::sync::RwLock::new(map) })
}

#[wasm_bindgen]
pub struct MlsDevice {
    provider: Provider,
    meta: RefCell<Meta>,
}

impl MlsDevice {
    fn signer(&self) -> Result<SignatureKeyPair, JsError> {
        let m = self.meta.borrow();
        SignatureKeyPair::read(self.provider.storage(), &m.signature_key, CIPHERSUITE.signature_algorithm())
            .ok_or_else(|| JsError::new("signature key missing"))
    }

    fn credential(&self) -> CredentialWithKey {
        let m = self.meta.borrow();
        CredentialWithKey {
            credential: BasicCredential::new(m.identity.as_bytes().to_vec()).into(),
            signature_key: m.signature_key.clone().into(),
        }
    }

    fn load_group(&self, id_hex: &str) -> Result<MlsGroup, JsError> {
        MlsGroup::load(self.provider.storage(), &GroupId::from_slice(&unhex(id_hex)))
            .map_err(err)?
            .ok_or_else(|| JsError::new("group not found"))
    }

    fn load_chat(&self, gid: &str) -> Result<MlsGroup, JsError> {
        MlsGroup::load(self.provider.storage(), &group_id(gid))
            .map_err(err)?
            .ok_or_else(|| JsError::new("group not found"))
    }

    fn group_config() -> MlsGroupCreateConfig {
        MlsGroupCreateConfig::builder()
            .ciphersuite(CIPHERSUITE)
            // New members get the tree inside the Welcome (stored once in the group's stream).
            .use_ratchet_tree_extension(true)
            .max_past_epochs(GROUP_PAST_EPOCHS)
            .sender_ratchet_configuration(SenderRatchetConfiguration::new(200, 10_000))
            .build()
    }

    /// The pending commit as bytes (with the Welcome when it adds members).
    fn commit_result(commit: &MlsMessageOut, welcome: Option<&MlsMessageOut>) -> Result<js_sys::Object, JsError> {
        let out = js_sys::Object::new();
        let c = commit.tls_serialize_detached().map_err(err)?;
        set(&out, "commit", &js_sys::Uint8Array::from(c.as_slice()).into())?;
        if let Some(w) = welcome {
            let w = w.tls_serialize_detached().map_err(err)?;
            set(&out, "welcome", &js_sys::Uint8Array::from(w.as_slice()).into())?;
        }
        Ok(out)
    }
}

#[wasm_bindgen]
impl MlsDevice {
    /// New device with a fresh Ed25519 signature key. `identity` is the device address.
    pub fn create(identity: String) -> Result<MlsDevice, JsError> {
        let provider = Provider::default();
        let signer = SignatureKeyPair::new(CIPHERSUITE.signature_algorithm()).map_err(err)?;
        signer.store(provider.storage()).map_err(err)?;
        let meta = Meta { identity, signature_key: signer.public().to_vec(), ..Default::default() };
        Ok(MlsDevice { provider, meta: RefCell::new(meta) })
    }

    /// Restores a device from `exportState`.
    pub fn restore(bytes: &[u8]) -> Result<MlsDevice, JsError> {
        if bytes.len() < 4 {
            return Err(JsError::new("state too short"));
        }
        let meta_len = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let meta: Meta = serde_json::from_slice(&bytes[4..4 + meta_len]).map_err(err)?;
        let storage = read_storage(&bytes[4 + meta_len..]).ok_or_else(|| JsError::new("corrupt state"))?;
        Ok(MlsDevice { provider: Provider { crypto: RustCrypto::default(), storage }, meta: RefCell::new(meta) })
    }

    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        let meta = serde_json::to_vec(&*self.meta.borrow()).map_err(err)?;
        let mut out = (meta.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(&meta);
        write_storage(&self.provider.storage, &mut out);
        Ok(out)
    }

    #[wasm_bindgen(js_name = signatureKey)]
    pub fn signature_key(&self) -> Vec<u8> {
        self.meta.borrow().signature_key.clone()
    }

    /// `count` single-use KeyPackages, or one last-resort KeyPackage, TLS-serialized.
    #[wasm_bindgen(js_name = keyPackages)]
    pub fn key_packages(&self, count: u32, last_resort: bool) -> Result<js_sys::Array, JsError> {
        let signer = self.signer()?;
        let out = js_sys::Array::new();
        let n = if last_resort { 1 } else { count.min(200) };
        for _ in 0..n {
            let mut b = KeyPackage::builder();
            if last_resort {
                // The leaf must list every extension the key package carries
                // (RFC 9420 7.2): without LastResort here, others reject it.
                b = b.mark_as_last_resort().leaf_node_capabilities(Capabilities::new(
                    None,
                    None,
                    Some(&[ExtensionType::LastResort]),
                    None,
                    None,
                ));
            }
            let bundle = b.build(CIPHERSUITE, &self.provider, &signer, self.credential()).map_err(err)?;
            let bytes = bundle.key_package().tls_serialize_detached().map_err(err)?;
            out.push(&js_sys::Uint8Array::from(bytes.as_slice()));
        }
        Ok(out)
    }

    #[wasm_bindgen(js_name = hasOutbound)]
    pub fn has_outbound(&self, remote: &str) -> bool {
        self.meta.borrow().outbound.contains_key(remote)
    }

    /// Creates our outbound group with the remote device; returns the Welcome to send it.
    #[wasm_bindgen(js_name = startOutbound)]
    pub fn start_outbound(&self, remote: String, key_package: &[u8]) -> Result<Vec<u8>, JsError> {
        let kp_in = KeyPackageIn::tls_deserialize_exact(key_package).map_err(err)?;
        let kp = kp_in.validate(self.provider.crypto(), ProtocolVersion::Mls10).map_err(err)?;
        if identity_of(kp.leaf_node().credential()).as_deref() != Some(remote.as_str()) {
            return Err(JsError::new("key package belongs to another device"));
        }
        let signer = self.signer()?;
        let config = MlsGroupCreateConfig::builder().ciphersuite(CIPHERSUITE).use_ratchet_tree_extension(true).build();
        let mut group = MlsGroup::new(&self.provider, &signer, &config, self.credential()).map_err(err)?;
        let (_commit, welcome, _info) = group.add_members(&self.provider, &signer, &[kp]).map_err(err)?;
        group.merge_pending_commit(&self.provider).map_err(err)?;
        let gid = hex(group.group_id().as_slice());
        let mut m = self.meta.borrow_mut();
        m.outbound.insert(remote.clone(), gid);
        m.sent.insert(remote, 0);
        welcome.tls_serialize_detached().map_err(err)
    }

    /// Joins the remote device's outbound group from its Welcome.
    #[wasm_bindgen(js_name = acceptWelcome)]
    pub fn accept_welcome(&self, remote: String, welcome: &[u8]) -> Result<(), JsError> {
        let msg = MlsMessageIn::tls_deserialize_exact(welcome).map_err(err)?;
        let MlsMessageBodyIn::Welcome(w) = msg.extract() else {
            return Err(JsError::new("not a Welcome"));
        };
        let join = MlsGroupJoinConfig::builder().use_ratchet_tree_extension(true).build();
        let group = StagedWelcome::new_from_welcome(&self.provider, &join, w, None)
            .map_err(err)?
            .into_group(&self.provider)
            .map_err(err)?;
        // The group must have exactly us and the expected remote device.
        let ids: Vec<Option<String>> = group.members().map(|m| identity_of(&m.credential)).collect();
        let me = self.meta.borrow().identity.clone();
        if ids.len() != 2 || !ids.contains(&Some(remote.clone())) || !ids.contains(&Some(me)) {
            return Err(JsError::new("unexpected group members"));
        }
        let gid = hex(group.group_id().as_slice());
        // A newer Welcome replaces the previous inbound group from this device.
        if let Some(old) = self.meta.borrow_mut().inbound.insert(remote, gid.clone()) {
            if old != gid {
                if let Ok(mut g) = self.load_group(&old) {
                    let _ = g.delete(self.provider.storage());
                }
            }
        }
        Ok(())
    }

    /// Encrypts for the remote device. Returns 1 or 2 MLS messages (a self-update commit first, sometimes).
    pub fn encrypt(&self, remote: &str, plaintext: &[u8]) -> Result<js_sys::Array, JsError> {
        let gid = self.meta.borrow().outbound.get(remote).cloned().ok_or_else(|| JsError::new("no outbound group"))?;
        let mut group = self.load_group(&gid)?;
        let signer = self.signer()?;
        let out = js_sys::Array::new();
        let count = *self.meta.borrow().sent.get(remote).unwrap_or(&0);
        if count > 0 && count % SELF_UPDATE_EVERY == 0 {
            let bundle = group.self_update(&self.provider, &signer, LeafNodeParameters::default()).map_err(err)?;
            let commit = bundle.commit().tls_serialize_detached().map_err(err)?;
            group.merge_pending_commit(&self.provider).map_err(err)?;
            out.push(&js_sys::Uint8Array::from(commit.as_slice()));
        }
        let msg = group.create_message(&self.provider, &signer, plaintext).map_err(err)?;
        out.push(&js_sys::Uint8Array::from(msg.tls_serialize_detached().map_err(err)?.as_slice()));
        self.meta.borrow_mut().sent.insert(remote.to_string(), count + 1);
        Ok(out)
    }

    /// Processes a message from the remote device's outbound group.
    /// Returns the plaintext of application messages, or undefined for commits.
    pub fn decrypt(&self, remote: &str, bytes: &[u8]) -> Result<Option<Vec<u8>>, JsError> {
        let gid = self.meta.borrow().inbound.get(remote).cloned().ok_or_else(|| JsError::new("no inbound group"))?;
        let mut group = self.load_group(&gid)?;
        let msg = MlsMessageIn::tls_deserialize_exact(bytes).map_err(err)?;
        let pm: ProtocolMessage = msg.try_into_protocol_message().map_err(err)?;
        let processed = group.process_message(&self.provider, pm).map_err(err)?;
        let sender_ok = match processed.credential() {
            c => identity_of(c).as_deref() == Some(remote),
        };
        if !sender_ok {
            return Err(JsError::new("message from an unexpected member"));
        }
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => Ok(Some(a.into_bytes())),
            ProcessedMessageContent::StagedCommitMessage(c) => {
                group.merge_staged_commit(&self.provider, *c).map_err(err)?;
                Ok(None)
            }
            _ => Err(JsError::new("unsupported message")),
        }
    }

    /// Signature key of the remote device in our inbound or outbound group (for safety numbers).
    #[wasm_bindgen(js_name = remoteSignatureKey)]
    pub fn remote_signature_key(&self, remote: &str) -> Option<Vec<u8>> {
        let m = self.meta.borrow();
        let gid = m.inbound.get(remote).or_else(|| m.outbound.get(remote))?.clone();
        drop(m);
        let group = self.load_group(&gid).ok()?;
        let found = group
            .members()
            .find(|mem| identity_of(&mem.credential).as_deref() == Some(remote))
            .map(|mem| mem.signature_key.clone());
        found
    }
}

/* --------------------------------------------------------- group chats --- */

#[wasm_bindgen]
impl MlsDevice {
    /// Starts a group chat with only this device in it (epoch 0).
    #[wasm_bindgen(js_name = groupCreate)]
    pub fn group_create(&self, gid: &str) -> Result<(), JsError> {
        let signer = self.signer()?;
        MlsGroup::new_with_group_id(&self.provider, &signer, &Self::group_config(), group_id(gid), self.credential())
            .map_err(err)?;
        Ok(())
    }

    #[wasm_bindgen(js_name = groupHas)]
    pub fn group_has(&self, gid: &str) -> bool {
        self.load_chat(gid).map(|g| g.is_active()).unwrap_or(false)
    }

    #[wasm_bindgen(js_name = groupEpoch)]
    pub fn group_epoch(&self, gid: &str) -> Result<u64, JsError> {
        Ok(self.load_chat(gid)?.epoch().as_u64())
    }

    /// Device addresses in the group.
    #[wasm_bindgen(js_name = groupMembers)]
    pub fn group_members(&self, gid: &str) -> Result<js_sys::Array, JsError> {
        let g = self.load_chat(gid)?;
        Ok(strings(g.members().filter_map(|m| identity_of(&m.credential)).collect()))
    }

    /// A pending commit adding these devices (TLS key packages): { commit, welcome }.
    #[wasm_bindgen(js_name = groupAdd)]
    pub fn group_add(&self, gid: &str, key_packages: js_sys::Array) -> Result<js_sys::Object, JsError> {
        let mut g = self.load_chat(gid)?;
        let mut kps = Vec::new();
        for v in key_packages.iter() {
            let bytes = js_sys::Uint8Array::new(&v).to_vec();
            let kp_in = KeyPackageIn::tls_deserialize_exact(bytes.as_slice()).map_err(err)?;
            kps.push(kp_in.validate(self.provider.crypto(), ProtocolVersion::Mls10).map_err(err)?);
        }
        if kps.is_empty() {
            return Err(JsError::new("no key packages"));
        }
        let signer = self.signer()?;
        let (commit, welcome, _info) = g.add_members(&self.provider, &signer, &kps).map_err(err)?;
        Self::commit_result(&commit, Some(&welcome))
    }

    /// A pending commit removing every leaf of these device addresses: { commit }.
    #[wasm_bindgen(js_name = groupRemove)]
    pub fn group_remove(&self, gid: &str, identities: Vec<String>) -> Result<js_sys::Object, JsError> {
        let mut g = self.load_chat(gid)?;
        let leaves: Vec<LeafNodeIndex> = g
            .members()
            .filter(|m| identity_of(&m.credential).is_some_and(|id| identities.contains(&id)))
            .map(|m| m.index)
            .collect();
        if leaves.is_empty() {
            return Err(JsError::new("none of them is in the group"));
        }
        let signer = self.signer()?;
        let (commit, _welcome, _info) = g.remove_members(&self.provider, &signer, &leaves).map_err(err)?;
        Self::commit_result(&commit, None)
    }

    /// A pending commit renewing our own leaf's keys (post-compromise security): { commit }.
    #[wasm_bindgen(js_name = groupSelfUpdate)]
    pub fn group_self_update(&self, gid: &str) -> Result<js_sys::Object, JsError> {
        let mut g = self.load_chat(gid)?;
        let signer = self.signer()?;
        let bundle = g.self_update(&self.provider, &signer, LeafNodeParameters::default()).map_err(err)?;
        Self::commit_result(bundle.commit(), None)
    }

    /// The shard took our pending commit: move to the next epoch.
    #[wasm_bindgen(js_name = groupMerge)]
    pub fn group_merge(&self, gid: &str) -> Result<(), JsError> {
        let mut g = self.load_chat(gid)?;
        if g.pending_commit().is_some() {
            g.merge_pending_commit(&self.provider).map_err(err)?;
        }
        Ok(())
    }

    /// The shard refused our pending commit (another came first): forget it.
    #[wasm_bindgen(js_name = groupDiscard)]
    pub fn group_discard(&self, gid: &str) -> Result<(), JsError> {
        let mut g = self.load_chat(gid)?;
        g.clear_pending_commit(self.provider.storage()).map_err(err)?;
        Ok(())
    }

    #[wasm_bindgen(js_name = groupHasPending)]
    pub fn group_has_pending(&self, gid: &str) -> bool {
        self.load_chat(gid).map(|g| g.pending_commit().is_some()).unwrap_or(false)
    }

    /// Encrypts one message for everyone in the group.
    #[wasm_bindgen(js_name = groupEncrypt)]
    pub fn group_encrypt(&self, gid: &str, plaintext: &[u8]) -> Result<Vec<u8>, JsError> {
        let mut g = self.load_chat(gid)?;
        let signer = self.signer()?;
        g.create_message(&self.provider, &signer, plaintext).map_err(err)?.tls_serialize_detached().map_err(err)
    }

    /// Processes a message from the group's stream:
    /// { kind: 'app', sender, data } or
    /// { kind: 'commit', sender, epoch, added: [address], removed: [address], selfRemoved }.
    #[wasm_bindgen(js_name = groupProcess)]
    pub fn group_process(&self, gid: &str, bytes: &[u8]) -> Result<js_sys::Object, JsError> {
        let mut g = self.load_chat(gid)?;
        let msg = MlsMessageIn::tls_deserialize_exact(bytes).map_err(err)?;
        let pm: ProtocolMessage = msg.try_into_protocol_message().map_err(err)?;
        let processed = g.process_message(&self.provider, pm).map_err(err)?;
        let sender = identity_of(processed.credential()).ok_or_else(|| JsError::new("sender without identity"))?;
        let out = js_sys::Object::new();
        set(&out, "sender", &JsValue::from_str(&sender))?;
        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(a) => {
                set(&out, "kind", &"app".into())?;
                set(&out, "data", &js_sys::Uint8Array::from(a.into_bytes().as_slice()).into())?;
            }
            ProcessedMessageContent::StagedCommitMessage(c) => {
                let added: Vec<String> = c
                    .add_proposals()
                    .filter_map(|p| identity_of(p.add_proposal().key_package().leaf_node().credential()))
                    .collect();
                let removed: Vec<String> = c
                    .remove_proposals()
                    .filter_map(|p| g.member(p.remove_proposal().removed()).and_then(identity_of))
                    .collect();
                let self_removed = c.self_removed();
                g.merge_staged_commit(&self.provider, *c).map_err(err)?;
                set(&out, "kind", &"commit".into())?;
                set(&out, "epoch", &JsValue::from_f64(g.epoch().as_u64() as f64))?;
                set(&out, "added", &strings(added).into())?;
                set(&out, "removed", &strings(removed).into())?;
                set(&out, "selfRemoved", &JsValue::from_bool(self_removed))?;
            }
            _ => return Err(JsError::new("unsupported message")),
        }
        Ok(out)
    }

    /// Joins a group chat from a Welcome; returns the chat's id.
    #[wasm_bindgen(js_name = groupJoin)]
    pub fn group_join(&self, welcome: &[u8]) -> Result<String, JsError> {
        let msg = MlsMessageIn::tls_deserialize_exact(welcome).map_err(err)?;
        let MlsMessageBodyIn::Welcome(w) = msg.extract() else {
            return Err(JsError::new("not a Welcome"));
        };
        let join = MlsGroupJoinConfig::builder()
            .use_ratchet_tree_extension(true)
            .max_past_epochs(GROUP_PAST_EPOCHS)
            .sender_ratchet_configuration(SenderRatchetConfiguration::new(200, 10_000))
            .build();
        let staged = StagedWelcome::new_from_welcome(&self.provider, &join, w, None).map_err(err)?;
        let id = String::from_utf8(staged.group_context().group_id().as_slice().to_vec()).unwrap_or_default();
        let Some(gid) = id.strip_prefix(GROUP_PREFIX).map(str::to_string) else {
            return Err(JsError::new("not a group chat"));
        };
        // A Welcome for a group we are already in (a newer add): start over from it.
        if let Ok(mut old) = self.load_chat(&gid) {
            let _ = old.delete(self.provider.storage());
        }
        staged.into_group(&self.provider).map_err(err)?;
        Ok(gid)
    }

    /// Forgets a group chat (left, removed, or deleted).
    #[wasm_bindgen(js_name = groupDelete)]
    pub fn group_delete(&self, gid: &str) -> Result<(), JsError> {
        if let Ok(mut g) = self.load_chat(gid) {
            g.delete(self.provider.storage()).map_err(err)?;
        }
        Ok(())
    }
}

#[wasm_bindgen(js_name = mlsVersion)]
pub fn mls_version() -> String {
    "OpenMLS 0.9.2 (RFC 9420), MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519".into()
}

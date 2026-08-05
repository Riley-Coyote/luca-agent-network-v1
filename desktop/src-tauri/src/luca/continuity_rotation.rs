//! Crash-recoverable authenticated continuity key rotation.
//!
//! Rotation is a trusted-desktop lifecycle operation. It never changes the
//! continuity root, exports a key, or blocks messaging. Every stored record
//! carries its exact physical key version, while an authenticated body-free
//! journal advances in the same SQLite transaction as each bounded batch.

use std::fmt;

use hkdf::Hkdf;
use luca_continuity::{decrypt_record, encrypt_record, NamespaceKey, RecordMetadata};
use luca_protocol::{
    canonicalize, parse_and_canonicalize_strict, CanonicalTimestamp, ContinuityNamespaceKindV1,
    ContinuityNamespaceV1, ContinuityRecordV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use super::{
    continuity_key_custody::ContinuityMasterKey,
    continuity_key_derivation::derive_namespace_key,
    continuity_store::{ContinuityRotationReplacement, ContinuityStore, ContinuityStoreError},
};
use crate::app_state::ContinuityLifecycleLock;

const ROTATION_JOURNAL_KEY_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.key.v1";
const ROTATION_JOURNAL_NAMESPACE_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.namespace.v1";
const ROTATION_JOURNAL_SCOPE_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.scope.v1";
const MAX_JOURNAL_BYTES: usize = 64 * 1024;
const ROTATION_BATCH_SIZE: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RotationPhase {
    Prepared,
    Reencrypting,
    Verifying,
    Activated,
    Complete,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RotationJournalV1 {
    protocol: String,
    rotation_id: OpaqueId,
    owner_pubkey: Hex64,
    from_version: SafeU53,
    to_version: SafeU53,
    phase: RotationPhase,
    cursor: i64,
    snapshot_boundary: i64,
    target_count: u64,
    prepared_at: CanonicalTimestamp,
    request_sha256: Hex64,
}

impl RotationJournalV1 {
    fn validate(&self) -> Result<(), RotationError> {
        if self.protocol != CONTINUITY_PROTOCOL
            || self.from_version.get() == 0
            || self.to_version.get() != self.from_version.get().saturating_add(1)
            || self.cursor < 0
            || self.snapshot_boundary < 0
            || self.cursor > self.snapshot_boundary
            || self.target_count > 100_000
        {
            return Err(RotationError::InvalidJournal);
        }
        Ok(())
    }
}

struct RotationJournalKey(Zeroizing<[u8; 32]>);

impl fmt::Debug for RotationJournalKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RotationJournalKey([REDACTED])")
    }
}

/// Body-free rotation failure. Chat remains independent for every variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RotationError {
    Busy,
    InvalidRequest,
    InvalidJournal,
    JournalAuthentication,
    RecordAuthentication,
    Store(ContinuityStoreError),
    InjectedCrash(RotationCrashPoint),
}

impl From<ContinuityStoreError> for RotationError {
    fn from(error: ContinuityStoreError) -> Self {
        Self::Store(error)
    }
}

/// Deterministic crash boundaries used by focused failure-matrix tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RotationCrashPoint {
    BeforePrepared,
    AfterPrepared,
    BeforeBatch,
    AfterBatch,
    BeforeVerification,
    AfterVerification,
    BeforeActivation,
    AfterActivation,
    BeforeCompletion,
    AfterCompletion,
    BeforeCleanup,
    AfterCleanup,
}

pub(crate) trait RotationCrashInjector {
    fn checkpoint(&mut self, point: RotationCrashPoint) -> Result<(), RotationError>;
}

pub(crate) struct NoRotationCrash;

impl RotationCrashInjector for NoRotationCrash {
    fn checkpoint(&mut self, _point: RotationCrashPoint) -> Result<(), RotationError> {
        Ok(())
    }
}

/// Frozen request needed to start or resume one owner-wide version increment.
pub(crate) struct RotationRequest {
    pub(crate) rotation_id: OpaqueId,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) from_version: SafeU53,
    pub(crate) to_version: SafeU53,
    pub(crate) prepared_at: CanonicalTimestamp,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RotationReceipt {
    pub(crate) rotation_id: OpaqueId,
    pub(crate) owner_pubkey: Hex64,
    pub(crate) active_key_version: SafeU53,
    pub(crate) rotated_records: u64,
}

fn sha_ref(domain: &[u8], values: &[&[u8]]) -> Result<Sha256Ref, RotationError> {
    let mut hash = Sha256::new();
    hash.update(domain);
    for value in values {
        let length = u32::try_from(value.len()).map_err(|_| RotationError::InvalidJournal)?;
        hash.update(length.to_be_bytes());
        hash.update(value);
    }
    Sha256Ref::parse(format!("sha256:{}", hex::encode(hash.finalize())))
        .map_err(|_| RotationError::InvalidJournal)
}

fn request_sha256(request: &RotationRequest) -> Result<Hex64, RotationError> {
    let from = request.from_version.get().to_be_bytes();
    let to = request.to_version.get().to_be_bytes();
    let mut hash = Sha256::new();
    hash.update(b"luca.continuity.rotation-request.v1");
    for value in [
        request.rotation_id.as_str().as_bytes(),
        request.owner_pubkey.as_str().as_bytes(),
        from.as_slice(),
        to.as_slice(),
        request.prepared_at.as_str().as_bytes(),
    ] {
        let length = u32::try_from(value.len()).map_err(|_| RotationError::InvalidRequest)?;
        hash.update(length.to_be_bytes());
        hash.update(value);
    }
    Hex64::parse(hex::encode(hash.finalize())).map_err(|_| RotationError::InvalidRequest)
}

fn derive_journal_key(
    root: &ContinuityMasterKey,
    owner_pubkey: &Hex64,
) -> Result<RotationJournalKey, RotationError> {
    let owner = owner_pubkey
        .decode()
        .map_err(|_| RotationError::InvalidRequest)?;
    let mut info = Zeroizing::new(Vec::with_capacity(128));
    info.extend_from_slice(ROTATION_JOURNAL_KEY_DOMAIN);
    info.extend_from_slice(&(owner.len() as u32).to_be_bytes());
    info.extend_from_slice(&owner);
    let hkdf = Hkdf::<Sha256>::new(None, root.as_bytes());
    let mut key = Zeroizing::new([0_u8; 32]);
    hkdf.expand(&info, key.as_mut())
        .map_err(|_| RotationError::InvalidRequest)?;
    Ok(RotationJournalKey(key))
}

fn journal_metadata(journal: &RotationJournalV1) -> Result<RecordMetadata, RotationError> {
    let canonical = canonicalize(journal).map_err(|_| RotationError::InvalidJournal)?;
    let namespace_ref = sha_ref(
        ROTATION_JOURNAL_NAMESPACE_DOMAIN,
        &[journal.owner_pubkey.as_str().as_bytes()],
    )?;
    let scope_ref = sha_ref(ROTATION_JOURNAL_SCOPE_DOMAIN, &[&canonical])?;
    let namespace = ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        owner_pubkey: journal.owner_pubkey.clone(),
        kind: ContinuityNamespaceKindV1::OwnerBrain,
        resident_pubkey: None,
        namespace_ref: namespace_ref.clone(),
        key_version: SafeU53::new(1).map_err(|_| RotationError::InvalidJournal)?,
    };
    let record_id = OpaqueId::parse(format!(
        "rotation-{}-{}-{}",
        journal.rotation_id.as_str(),
        journal.cursor,
        match journal.phase {
            RotationPhase::Prepared => "prepared",
            RotationPhase::Reencrypting => "reencrypting",
            RotationPhase::Verifying => "verifying",
            RotationPhase::Activated => "activated",
            RotationPhase::Complete => "complete",
        }
    ))
    .map_err(|_| RotationError::InvalidJournal)?;
    Ok(RecordMetadata {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        record_id,
        namespace,
        scope: ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            namespace_ref,
            scope_ref,
            source_id: Some(
                OpaqueId::parse("rotation-journal").map_err(|_| RotationError::InvalidJournal)?,
            ),
            project_id: None,
            room_id: None,
            conversation_id: None,
        },
        record_type: OpaqueId::parse("rotation-journal")
            .map_err(|_| RotationError::InvalidJournal)?,
        revision: SafeU53::new(0).map_err(|_| RotationError::InvalidJournal)?,
        predecessor_record_id: None,
        created_at: journal.prepared_at.clone(),
        author_kind: OpaqueId::parse("system-maintenance")
            .map_err(|_| RotationError::InvalidJournal)?,
        provenance_refs: Vec::new(),
        key_version: SafeU53::new(1).map_err(|_| RotationError::InvalidJournal)?,
    })
}

fn protect_journal(
    root: &ContinuityMasterKey,
    journal: &RotationJournalV1,
) -> Result<ContinuityRecordV1, RotationError> {
    journal.validate()?;
    let canonical =
        Zeroizing::new(canonicalize(journal).map_err(|_| RotationError::InvalidJournal)?);
    if canonical.len() > MAX_JOURNAL_BYTES {
        return Err(RotationError::InvalidJournal);
    }
    let key = derive_journal_key(root, &journal.owner_pubkey)?;
    encrypt_record(journal_metadata(journal)?, &key.0, &canonical)
        .map_err(|_| RotationError::InvalidJournal)
}

fn authenticate_journal(
    root: &ContinuityMasterKey,
    owner_pubkey: &Hex64,
    envelope: &ContinuityRecordV1,
) -> Result<RotationJournalV1, RotationError> {
    let key = derive_journal_key(root, owner_pubkey)?;
    let body =
        decrypt_record(envelope, &key.0).map_err(|_| RotationError::JournalAuthentication)?;
    let canonical = parse_and_canonicalize_strict(body.as_bytes(), MAX_JOURNAL_BYTES)
        .map_err(|_| RotationError::InvalidJournal)?;
    if canonical.as_slice() != body.as_bytes() {
        return Err(RotationError::InvalidJournal);
    }
    let journal: RotationJournalV1 =
        serde_json::from_slice(body.as_bytes()).map_err(|_| RotationError::InvalidJournal)?;
    journal.validate()?;
    if journal.owner_pubkey != *owner_pubkey
        || journal_metadata(&journal)?.scope != envelope.scope
        || journal_metadata(&journal)?.namespace != envelope.namespace
    {
        return Err(RotationError::JournalAuthentication);
    }
    Ok(journal)
}

fn record_metadata_for_version(record: &ContinuityRecordV1, version: SafeU53) -> RecordMetadata {
    let mut namespace = record.namespace.clone();
    namespace.key_version = version;
    RecordMetadata {
        protocol: record.protocol.clone(),
        record_id: record.record_id.clone(),
        namespace,
        scope: record.scope.clone(),
        record_type: record.record_type.clone(),
        revision: record.revision,
        predecessor_record_id: record.predecessor_record_id.clone(),
        created_at: record.created_at.clone(),
        author_kind: record.author_kind.clone(),
        provenance_refs: record.provenance_refs.clone(),
        key_version: version,
    }
}

fn replace_phase(
    store: &mut ContinuityStore,
    root: &ContinuityMasterKey,
    current_envelope: &mut ContinuityRecordV1,
    journal: &mut RotationJournalV1,
    phase: RotationPhase,
) -> Result<(), RotationError> {
    let mut next = journal.clone();
    next.phase = phase;
    let protected = protect_journal(root, &next)?;
    store.cas_rotation_journal(&journal.owner_pubkey, current_envelope, &protected)?;
    *journal = next;
    *current_envelope = protected;
    Ok(())
}

/// Start or resume one authenticated owner-wide key-version rotation.
pub(crate) fn rotate_continuity_keys(
    lifecycle: &ContinuityLifecycleLock,
    store: &mut ContinuityStore,
    root: &ContinuityMasterKey,
    request: &RotationRequest,
    crash: &mut dyn RotationCrashInjector,
) -> Result<RotationReceipt, RotationError> {
    let _guard = lifecycle.lock().map_err(|_| RotationError::Busy)?;
    if request.from_version.get() == 0
        || request.to_version.get() != request.from_version.get().saturating_add(1)
    {
        return Err(RotationError::InvalidRequest);
    }
    let request_sha256 = request_sha256(request)?;

    if let Some((stored_request_sha256, envelope)) =
        store.load_rotation_receipt(&request.owner_pubkey, request.rotation_id.as_str())?
    {
        let journal = authenticate_journal(root, &request.owner_pubkey, &envelope)?;
        if stored_request_sha256 != request_sha256
            || journal.request_sha256 != request_sha256
            || journal.rotation_id != request.rotation_id
            || journal.from_version != request.from_version
            || journal.to_version != request.to_version
            || journal.prepared_at != request.prepared_at
            || journal.phase != RotationPhase::Complete
        {
            return Err(RotationError::InvalidRequest);
        }
        return Ok(RotationReceipt {
            rotation_id: journal.rotation_id,
            owner_pubkey: journal.owner_pubkey,
            active_key_version: journal.to_version,
            rotated_records: journal.target_count,
        });
    }

    let existing = store.load_rotation_journal(&request.owner_pubkey)?;
    if existing.is_none()
        && store.active_owner_key_version(&request.owner_pubkey)? == request.to_version
    {
        return Err(RotationError::InvalidRequest);
    }

    let (mut current_envelope, mut journal) = if let Some(envelope) = existing {
        let journal = authenticate_journal(root, &request.owner_pubkey, &envelope)?;
        if journal.rotation_id != request.rotation_id
            || journal.from_version != request.from_version
            || journal.to_version != request.to_version
            || journal.prepared_at != request.prepared_at
            || journal.request_sha256 != request_sha256
        {
            return Err(RotationError::InvalidRequest);
        }
        (envelope, journal)
    } else {
        crash.checkpoint(RotationCrashPoint::BeforePrepared)?;
        let (snapshot_boundary, target_count) =
            store.rotation_boundary(&request.owner_pubkey, request.from_version)?;
        let journal = RotationJournalV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            rotation_id: request.rotation_id.clone(),
            owner_pubkey: request.owner_pubkey.clone(),
            from_version: request.from_version,
            to_version: request.to_version,
            phase: RotationPhase::Prepared,
            cursor: 0,
            snapshot_boundary,
            target_count: target_count as u64,
            prepared_at: request.prepared_at.clone(),
            request_sha256: request_sha256.clone(),
        };
        let envelope = protect_journal(root, &journal)?;
        store.prepare_rotation(
            &request.owner_pubkey,
            request.rotation_id.as_str(),
            request.from_version,
            snapshot_boundary,
            target_count,
            &envelope,
        )?;
        crash.checkpoint(RotationCrashPoint::AfterPrepared)?;
        (envelope, journal)
    };

    if journal.phase == RotationPhase::Prepared {
        replace_phase(
            store,
            root,
            &mut current_envelope,
            &mut journal,
            RotationPhase::Reencrypting,
        )?;
    }

    if journal.phase == RotationPhase::Reencrypting {
        loop {
            let batch = store.rotation_batch(
                &journal.owner_pubkey,
                journal.from_version,
                journal.snapshot_boundary,
                journal.cursor,
                ROTATION_BATCH_SIZE,
            )?;
            if batch.is_empty() {
                break;
            }
            crash.checkpoint(RotationCrashPoint::BeforeBatch)?;
            let mut replacements = Vec::with_capacity(batch.len());
            for stored in batch {
                let old_namespace = NamespaceKey::new(stored.record.namespace.clone())
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let old_key = derive_namespace_key(root, &old_namespace)
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let body = decrypt_record(&stored.record, old_key.as_bytes())
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let mut new_namespace_protocol = stored.record.namespace.clone();
                new_namespace_protocol.key_version = journal.to_version;
                let new_namespace = NamespaceKey::new(new_namespace_protocol)
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let new_key = derive_namespace_key(root, &new_namespace)
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let replacement = encrypt_record(
                    record_metadata_for_version(&stored.record, journal.to_version),
                    new_key.as_bytes(),
                    body.as_bytes(),
                )
                .map_err(|_| RotationError::RecordAuthentication)?;
                journal.cursor = stored.rowid;
                replacements.push(ContinuityRotationReplacement {
                    rowid: stored.rowid,
                    expected_envelope_sha256: stored.envelope_sha256,
                    expected: stored.record,
                    replacement,
                });
            }
            let next_envelope = protect_journal(root, &journal)?;
            store.cas_rotation_batch(
                &journal.owner_pubkey,
                &current_envelope,
                &next_envelope,
                &replacements,
            )?;
            current_envelope = next_envelope;
            crash.checkpoint(RotationCrashPoint::AfterBatch)?;
        }
        replace_phase(
            store,
            root,
            &mut current_envelope,
            &mut journal,
            RotationPhase::Verifying,
        )?;
    }

    if journal.phase == RotationPhase::Verifying {
        crash.checkpoint(RotationCrashPoint::BeforeVerification)?;
        store.verify_rotation_layout(
            &journal.owner_pubkey,
            journal.snapshot_boundary,
            journal.to_version,
            journal.target_count as usize,
        )?;
        let mut cursor = 0;
        let mut verified = 0u64;
        loop {
            let batch = store.rotation_batch(
                &journal.owner_pubkey,
                journal.to_version,
                journal.snapshot_boundary,
                cursor,
                ROTATION_BATCH_SIZE,
            )?;
            if batch.is_empty() {
                break;
            }
            for stored in &batch {
                let namespace = NamespaceKey::new(stored.record.namespace.clone())
                    .map_err(|_| RotationError::RecordAuthentication)?;
                let key = derive_namespace_key(root, &namespace)
                    .map_err(|_| RotationError::RecordAuthentication)?;
                decrypt_record(&stored.record, key.as_bytes())
                    .map_err(|_| RotationError::RecordAuthentication)?;
                cursor = stored.rowid;
                verified = verified.saturating_add(1);
            }
        }
        if verified != journal.target_count {
            return Err(RotationError::RecordAuthentication);
        }
        crash.checkpoint(RotationCrashPoint::AfterVerification)?;
        crash.checkpoint(RotationCrashPoint::BeforeActivation)?;
        let mut activated = journal.clone();
        activated.phase = RotationPhase::Activated;
        let activated_envelope = protect_journal(root, &activated)?;
        store.activate_rotation(
            &journal.owner_pubkey,
            journal.from_version,
            journal.to_version,
            &current_envelope,
            &activated_envelope,
        )?;
        journal = activated;
        current_envelope = activated_envelope;
        crash.checkpoint(RotationCrashPoint::AfterActivation)?;
    }

    if journal.phase == RotationPhase::Activated {
        crash.checkpoint(RotationCrashPoint::BeforeCompletion)?;
        replace_phase(
            store,
            root,
            &mut current_envelope,
            &mut journal,
            RotationPhase::Complete,
        )?;
        crash.checkpoint(RotationCrashPoint::AfterCompletion)?;
    }
    if journal.phase == RotationPhase::Complete {
        crash.checkpoint(RotationCrashPoint::BeforeCleanup)?;
        store.complete_rotation(
            &journal.owner_pubkey,
            journal.rotation_id.as_str(),
            &journal.request_sha256,
            &current_envelope,
        )?;
        crash.checkpoint(RotationCrashPoint::AfterCleanup)?;
    }
    Ok(RotationReceipt {
        rotation_id: journal.rotation_id,
        owner_pubkey: journal.owner_pubkey,
        active_key_version: journal.to_version,
        rotated_records: journal.target_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_continuity::encrypt_record;
    use luca_protocol::{ContinuityScopeV1, CONTINUITY_PROTOCOL};
    use tempfile::TempDir;

    use crate::luca::continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen};

    fn hex(byte: u8) -> Hex64 {
        Hex64::parse(hex::encode([byte; 32])).unwrap()
    }
    fn sha(byte: u8) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", hex::encode([byte; 32]))).unwrap()
    }
    fn root() -> ContinuityMasterKey {
        ContinuityMasterKey::new_for_test([0x41; 32])
    }
    fn request(owner: Hex64) -> RotationRequest {
        RotationRequest {
            rotation_id: OpaqueId::parse("rotation-test-1").unwrap(),
            owner_pubkey: owner,
            from_version: SafeU53::new(1).unwrap(),
            to_version: SafeU53::new(2).unwrap(),
            prepared_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
        }
    }
    fn open(temp: &TempDir) -> ContinuityStore {
        match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap() {
            ContinuityStoreOpen::Ready(store) => store,
            _ => panic!("store must be ready"),
        }
    }
    fn seed(store: &mut ContinuityStore, root: &ContinuityMasterKey, owner: Hex64) {
        for (index, body) in [b"owner-private-a".as_slice(), b"owner-private-b"]
            .iter()
            .enumerate()
        {
            let namespace = ContinuityNamespaceV1 {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                owner_pubkey: owner.clone(),
                kind: ContinuityNamespaceKindV1::ResidentPrivate,
                resident_pubkey: Some(hex(2)),
                namespace_ref: sha(3),
                key_version: SafeU53::new(1).unwrap(),
            };
            let namespace_key = NamespaceKey::new(namespace.clone()).unwrap();
            let key = derive_namespace_key(root, &namespace_key).unwrap();
            let metadata = RecordMetadata {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                record_id: OpaqueId::parse(format!("record-{index}")).unwrap(),
                namespace: namespace.clone(),
                scope: ContinuityScopeV1 {
                    protocol: CONTINUITY_PROTOCOL.to_owned(),
                    namespace_ref: namespace.namespace_ref.clone(),
                    scope_ref: sha(4),
                    source_id: Some(OpaqueId::parse("seed-source").unwrap()),
                    project_id: None,
                    room_id: None,
                    conversation_id: None,
                },
                record_type: OpaqueId::parse("hypomnema").unwrap(),
                revision: SafeU53::new(index as u64).unwrap(),
                predecessor_record_id: (index > 0)
                    .then(|| OpaqueId::parse(format!("record-{}", index - 1)).unwrap()),
                created_at: CanonicalTimestamp::parse(format!("2026-08-05T00:00:0{index}Z"))
                    .unwrap(),
                author_kind: OpaqueId::parse("resident").unwrap(),
                provenance_refs: vec![sha(5 + index as u8)],
                key_version: SafeU53::new(1).unwrap(),
            };
            store
                .put_encrypted(&encrypt_record(metadata, key.as_bytes(), body).unwrap())
                .unwrap();
        }
    }

    struct FailOnce(Option<RotationCrashPoint>);
    impl RotationCrashInjector for FailOnce {
        fn checkpoint(&mut self, point: RotationCrashPoint) -> Result<(), RotationError> {
            if self.0 == Some(point) {
                self.0 = None;
                Err(RotationError::InjectedCrash(point))
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn every_crash_boundary_resumes_without_mixed_key_ambiguity() {
        let points = [
            RotationCrashPoint::BeforePrepared,
            RotationCrashPoint::AfterPrepared,
            RotationCrashPoint::BeforeBatch,
            RotationCrashPoint::AfterBatch,
            RotationCrashPoint::BeforeVerification,
            RotationCrashPoint::AfterVerification,
            RotationCrashPoint::BeforeActivation,
            RotationCrashPoint::AfterActivation,
            RotationCrashPoint::BeforeCompletion,
            RotationCrashPoint::AfterCompletion,
            RotationCrashPoint::BeforeCleanup,
            RotationCrashPoint::AfterCleanup,
        ];
        for point in points {
            let temp = TempDir::new().unwrap();
            let mut store = open(&temp);
            let root = root();
            let owner = hex(1);
            seed(&mut store, &root, owner.clone());
            let request = request(owner.clone());
            let first = rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root,
                &request,
                &mut FailOnce(Some(point)),
            );
            assert_eq!(first, Err(RotationError::InjectedCrash(point)));
            let receipt = rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root,
                &request,
                &mut NoRotationCrash,
            )
            .unwrap();
            assert_eq!(receipt.active_key_version, SafeU53::new(2).unwrap());
            assert_eq!(
                store.active_owner_key_version(&owner).unwrap(),
                SafeU53::new(2).unwrap()
            );
            assert!(store.load_rotation_journal(&owner).unwrap().is_none());
        }
    }

    #[test]
    fn journal_tamper_fails_closed_without_changing_records() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let root = root();
        let owner = hex(1);
        seed(&mut store, &root, owner.clone());
        let request = request(owner.clone());
        assert_eq!(
            rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root,
                &request,
                &mut FailOnce(Some(RotationCrashPoint::AfterPrepared)),
            ),
            Err(RotationError::InjectedCrash(
                RotationCrashPoint::AfterPrepared
            ))
        );
        let before = store
            .rotation_boundary(&owner, SafeU53::new(1).unwrap())
            .unwrap();
        let mut journal = store.load_rotation_journal(&owner).unwrap().unwrap();
        journal.ciphertext_b64.push('A');
        assert_eq!(
            authenticate_journal(&root, &owner, &journal),
            Err(RotationError::JournalAuthentication)
        );
        assert_eq!(
            before,
            store
                .rotation_boundary(&owner, SafeU53::new(1).unwrap())
                .unwrap()
        );
    }

    #[test]
    fn terminal_receipt_is_authenticated_and_bound_to_exact_request() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let root = root();
        let owner = hex(1);
        seed(&mut store, &root, owner.clone());
        let request = request(owner.clone());
        let lifecycle = ContinuityLifecycleLock::new_for_test();
        let first = rotate_continuity_keys(
            &lifecycle,
            &mut store,
            &root,
            &request,
            &mut NoRotationCrash,
        )
        .unwrap();
        assert_eq!(first.rotated_records, 2);
        let replay = rotate_continuity_keys(
            &lifecycle,
            &mut store,
            &root,
            &request,
            &mut NoRotationCrash,
        )
        .unwrap();
        assert_eq!(replay, first);

        let different_id = RotationRequest {
            rotation_id: OpaqueId::parse("rotation-different-id").unwrap(),
            owner_pubkey: owner.clone(),
            from_version: request.from_version,
            to_version: request.to_version,
            prepared_at: request.prepared_at.clone(),
        };
        assert_eq!(
            rotate_continuity_keys(
                &lifecycle,
                &mut store,
                &root,
                &different_id,
                &mut NoRotationCrash,
            ),
            Err(RotationError::InvalidRequest)
        );
        let changed_timestamp = RotationRequest {
            rotation_id: request.rotation_id.clone(),
            owner_pubkey: owner,
            from_version: request.from_version,
            to_version: request.to_version,
            prepared_at: CanonicalTimestamp::parse("2026-08-05T00:00:01Z").unwrap(),
        };
        assert_eq!(
            rotate_continuity_keys(
                &lifecycle,
                &mut store,
                &root,
                &changed_timestamp,
                &mut NoRotationCrash,
            ),
            Err(RotationError::InvalidRequest)
        );
    }
}

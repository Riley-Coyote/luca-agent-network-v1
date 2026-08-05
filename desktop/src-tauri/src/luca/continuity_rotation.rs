//! Crash-recoverable authenticated continuity key rotation.
//!
//! Rotation is a trusted-desktop lifecycle operation. It never changes the
//! continuity root, exports a key, or blocks messaging. Every stored record
//! carries its exact physical key version, while an authenticated body-free
//! journal advances in the same SQLite transaction as each bounded batch.

use std::{collections::BTreeMap, fmt};

use hkdf::Hkdf;
use luca_continuity::{
    decrypt_record, derive_envelope_replacement_digest, encrypt_record, encrypted_record_reference,
    EnvelopeReplacementV1, NamespaceKey, PurgeExecutionStatusV1, RecordMetadata, RevisionLedger,
    RevisionLedgerSnapshotV1, MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER,
};
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
    continuity_revision_authority::StoredRevisionGenerationV1,
    continuity_store::{ContinuityStore, ContinuityStoreError},
};
use crate::app_state::ContinuityLifecycleLock;

const ROTATION_JOURNAL_KEY_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.key.v1";
const ROTATION_JOURNAL_NAMESPACE_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.namespace.v1";
const ROTATION_JOURNAL_SCOPE_DOMAIN: &[u8] = b"luca.continuity.rotation-journal.scope.v1";
const MAX_JOURNAL_BYTES: usize = 64 * 1024;

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

fn build_rotated_authority_candidate(
    root: &ContinuityMasterKey,
    generation: &StoredRevisionGenerationV1,
    to_version: SafeU53,
) -> Result<RevisionLedgerSnapshotV1, RotationError> {
    let from_version = generation.token.active_root_key_version;
    let existing_replacements = generation
        .snapshot
        .lineages
        .iter()
        .try_fold(0usize, |total, lineage| {
            total.checked_add(lineage.envelope_replacements.len())
        })
        .ok_or(RotationError::InvalidRequest)?;
    if existing_replacements
        .checked_add(generation.snapshot.records.len())
        .is_none_or(|total| total > MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER)
    {
        return Err(RotationError::InvalidRequest);
    }

    let mut candidate = generation.snapshot.clone();
    let mut replacements = BTreeMap::<String, EnvelopeReplacementV1>::new();
    for record in &mut candidate.records {
        if record.namespace.owner_pubkey != generation.token.owner_pubkey
            || record.namespace.key_version != from_version
            || record.key_version != from_version
        {
            return Err(RotationError::InvalidRequest);
        }
        let original = record.clone();
        let old_namespace = NamespaceKey::new(original.namespace.clone())
            .map_err(|_| RotationError::RecordAuthentication)?;
        let old_key = derive_namespace_key(root, &old_namespace)
            .map_err(|_| RotationError::RecordAuthentication)?;
        let body = decrypt_record(&original, old_key.as_bytes())
            .map_err(|_| RotationError::RecordAuthentication)?;

        let mut new_namespace = original.namespace.clone();
        new_namespace.key_version = to_version;
        let new_key = derive_namespace_key(
            root,
            &NamespaceKey::new(new_namespace).map_err(|_| RotationError::RecordAuthentication)?,
        )
        .map_err(|_| RotationError::RecordAuthentication)?;
        let replacement = encrypt_record(
            record_metadata_for_version(&original, to_version),
            new_key.as_bytes(),
            body.as_bytes(),
        )
        .map_err(|_| RotationError::RecordAuthentication)?;
        let verified = decrypt_record(&replacement, new_key.as_bytes())
            .map_err(|_| RotationError::RecordAuthentication)?;
        if verified.as_bytes() != body.as_bytes() {
            return Err(RotationError::RecordAuthentication);
        }

        let original_ref = encrypted_record_reference(&original)
            .map_err(|_| RotationError::RecordAuthentication)?;
        let replacement_ref = encrypted_record_reference(&replacement)
            .map_err(|_| RotationError::RecordAuthentication)?;
        let mut authority = EnvelopeReplacementV1 {
            record_id: original.record_id.clone(),
            original_key_version: original.key_version,
            original_nonce_b64: original.nonce_b64.clone(),
            original_encrypted_record_ref: original_ref.clone(),
            replacement_key_version: replacement.key_version,
            replacement_nonce_b64: replacement.nonce_b64.clone(),
            replacement_encrypted_record_ref: replacement_ref,
            replacement_digest: original_ref,
        };
        authority.replacement_digest = derive_envelope_replacement_digest(&authority)
            .map_err(|_| RotationError::InvalidRequest)?;
        if replacements
            .insert(original.record_id.as_str().to_owned(), authority)
            .is_some()
        {
            return Err(RotationError::InvalidRequest);
        }
        *record = replacement;
    }

    for lineage in &mut candidate.lineages {
        let retained = lineage
            .record_ids
            .iter()
            .filter(|record_id| replacements.contains_key(record_id.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if retained.is_empty() {
            if lineage
                .purge_execution
                .as_ref()
                .is_none_or(|purge| purge.status != PurgeExecutionStatusV1::Completed)
            {
                return Err(RotationError::InvalidRequest);
            }
            continue;
        }
        if retained.len() != lineage.record_ids.len()
            || lineage.namespace.key_version != from_version
            || lineage.lineage_envelope_key_version != from_version
        {
            return Err(RotationError::InvalidRequest);
        }
        lineage.namespace.key_version = to_version;
        lineage.lineage_envelope_key_version = to_version;
        for record_id in retained {
            lineage.envelope_replacements.push(
                replacements
                    .remove(record_id.as_str())
                    .ok_or(RotationError::InvalidRequest)?,
            );
        }
        lineage.envelope_replacements.sort_by(|left, right| {
            (left.record_id.as_str(), left.original_key_version.get())
                .cmp(&(right.record_id.as_str(), right.original_key_version.get()))
        });
    }
    if !replacements.is_empty() {
        return Err(RotationError::InvalidRequest);
    }
    RevisionLedger::from_snapshot(candidate.clone()).map_err(|_| RotationError::InvalidRequest)?;
    candidate
        .fingerprint()
        .map_err(|_| RotationError::InvalidRequest)?;
    Ok(candidate)
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
        let completed = store
            .load_revision_generation(&request.owner_pubkey)?
            .ok_or(RotationError::Store(
                ContinuityStoreError::AuthorityMigrationRequired,
            ))?;
        if completed.token.active_root_key_version != request.to_version
            || completed.snapshot.records.len() as u64 != journal.target_count
            || store
                .load_rotation_journal(&request.owner_pubkey)?
                .is_some()
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

    let generation = store
        .load_revision_generation(&request.owner_pubkey)?
        .ok_or(RotationError::Store(
            ContinuityStoreError::AuthorityMigrationRequired,
        ))?;
    if generation.token.active_root_key_version != request.from_version {
        return Err(RotationError::InvalidRequest);
    }
    let existing = store.load_rotation_journal(&request.owner_pubkey)?;
    let (prepared_envelope, journal) = if let Some(envelope) = existing {
        let journal = authenticate_journal(root, &request.owner_pubkey, &envelope)?;
        if journal.rotation_id != request.rotation_id
            || journal.from_version != request.from_version
            || journal.to_version != request.to_version
            || journal.prepared_at != request.prepared_at
            || journal.request_sha256 != request_sha256
            || journal.phase != RotationPhase::Prepared
            || journal.cursor != 0
            || journal.snapshot_boundary != journal.target_count as i64
            || journal.target_count != generation.snapshot.records.len() as u64
        {
            return Err(RotationError::InvalidRequest);
        }
        (envelope, journal)
    } else {
        crash.checkpoint(RotationCrashPoint::BeforePrepared)?;
        let target_count = generation.snapshot.records.len();
        let snapshot_boundary =
            i64::try_from(target_count).map_err(|_| RotationError::InvalidRequest)?;
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
        store.prepare_authority_rotation_cas(
            &generation.token,
            request.rotation_id.as_str(),
            request.from_version,
            &envelope,
        )?;
        crash.checkpoint(RotationCrashPoint::AfterPrepared)?;
        (envelope, journal)
    };

    crash.checkpoint(RotationCrashPoint::BeforeBatch)?;
    let candidate = build_rotated_authority_candidate(root, &generation, request.to_version)?;
    crash.checkpoint(RotationCrashPoint::AfterBatch)?;
    crash.checkpoint(RotationCrashPoint::BeforeVerification)?;
    RevisionLedger::from_snapshot(candidate.clone()).map_err(|_| RotationError::InvalidRequest)?;
    crash.checkpoint(RotationCrashPoint::AfterVerification)?;
    crash.checkpoint(RotationCrashPoint::BeforeActivation)?;
    let mut completed = journal.clone();
    completed.phase = RotationPhase::Complete;
    completed.cursor = completed.snapshot_boundary;
    let terminal_receipt = protect_journal(root, &completed)?;
    store.commit_authority_rotation_atomically(
        &generation.token,
        request.from_version,
        request.to_version,
        &candidate,
        request.rotation_id.as_str(),
        &request_sha256,
        &prepared_envelope,
        &terminal_receipt,
    )?;
    crash.checkpoint(RotationCrashPoint::AfterActivation)?;
    crash.checkpoint(RotationCrashPoint::BeforeCompletion)?;
    crash.checkpoint(RotationCrashPoint::AfterCompletion)?;
    crash.checkpoint(RotationCrashPoint::BeforeCleanup)?;
    crash.checkpoint(RotationCrashPoint::AfterCleanup)?;
    Ok(RotationReceipt {
        rotation_id: completed.rotation_id,
        owner_pubkey: completed.owner_pubkey,
        active_key_version: completed.to_version,
        rotated_records: completed.target_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_continuity::{
        derive_revision_idempotency_key, encrypt_record, RevisionActor, RevisionLedger,
        RevisionOperation, RevisionRequest,
    };
    use luca_protocol::{ContinuityScopeV1, CONTINUITY_PROTOCOL};
    use tempfile::TempDir;

    use crate::luca::{
        continuity_revision_authority::AuthorityExpectationV1,
        continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen},
    };

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
    fn encrypted_seed_record(
        root: &ContinuityMasterKey,
        owner: &Hex64,
        record_id: &str,
        body: &[u8],
        source_seed: u8,
    ) -> ContinuityRecordV1 {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            owner_pubkey: owner.clone(),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex(2)),
            namespace_ref: sha(3),
            key_version: SafeU53::new(1).unwrap(),
        };
        let key =
            derive_namespace_key(root, &NamespaceKey::new(namespace.clone()).unwrap()).unwrap();
        encrypt_record(
            RecordMetadata {
                protocol: CONTINUITY_PROTOCOL.to_owned(),
                record_id: OpaqueId::parse(record_id).unwrap(),
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
                revision: SafeU53::new(0).unwrap(),
                predecessor_record_id: None,
                created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
                author_kind: OpaqueId::parse("owner").unwrap(),
                provenance_refs: vec![sha(source_seed)],
                key_version: SafeU53::new(1).unwrap(),
            },
            key.as_bytes(),
            body,
        )
        .unwrap()
    }

    fn create_request(record: ContinuityRecordV1, source_seed: u8) -> RevisionRequest {
        let mut request = RevisionRequest {
            idempotency_key: sha(0),
            operation: RevisionOperation::Create,
            lineage_root_id: record.record_id.clone(),
            expected_head_record_id: None,
            actor: RevisionActor::Owner,
            signed_source_event_refs: vec![sha(source_seed)],
            request_ref: sha(source_seed),
            successor_ciphertext_ref: Some(encrypted_record_reference(&record).unwrap()),
            successor: Some(record.clone()),
            rollback_source_record_id: None,
            derived_artifact_refs: Vec::new(),
        };
        request.idempotency_key = derive_revision_idempotency_key(
            &record.namespace,
            &record.scope,
            &record.record_type,
            record.key_version,
            &request,
        )
        .unwrap();
        request
    }

    fn seed_authority(
        store: &mut ContinuityStore,
        root: &ContinuityMasterKey,
        owner: Hex64,
    ) -> (StoredRevisionGenerationV1, RevisionRequest) {
        let mut ledger = RevisionLedger::default();
        let first = create_request(
            encrypted_seed_record(root, &owner, "record-a", b"owner-private-a", 5),
            5,
        );
        ledger.apply(first.clone()).unwrap();
        ledger
            .apply(create_request(
                encrypted_seed_record(root, &owner, "record-b", b"owner-private-b", 6),
                6,
            ))
            .unwrap();

        let purge_create = create_request(
            encrypted_seed_record(root, &owner, "record-purged", b"purged-private", 7),
            7,
        );
        ledger.apply(purge_create).unwrap();
        let snapshot = ledger.export_snapshot().unwrap();
        let lineage = snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id.as_str() == "record-purged")
            .unwrap();
        let mut forget = RevisionRequest {
            idempotency_key: sha(0),
            operation: RevisionOperation::Forget,
            lineage_root_id: OpaqueId::parse("record-purged").unwrap(),
            expected_head_record_id: Some(OpaqueId::parse("record-purged").unwrap()),
            actor: RevisionActor::Owner,
            signed_source_event_refs: vec![sha(8)],
            request_ref: sha(8),
            successor: None,
            successor_ciphertext_ref: None,
            rollback_source_record_id: None,
            derived_artifact_refs: Vec::new(),
        };
        forget.idempotency_key = derive_revision_idempotency_key(
            &lineage.namespace,
            &lineage.scope,
            &lineage.record_type,
            lineage.lineage_envelope_key_version,
            &forget,
        )
        .unwrap();
        ledger.apply(forget).unwrap();
        ledger
            .advance_purge(
                &OpaqueId::parse("record-purged").unwrap(),
                PurgeExecutionStatusV1::InProgress,
            )
            .unwrap();
        ledger
            .advance_purge(
                &OpaqueId::parse("record-purged").unwrap(),
                PurgeExecutionStatusV1::Completed,
            )
            .unwrap();
        let snapshot = ledger.export_snapshot().unwrap();
        store
            .replace_complete_owner_generation_atomically(
                &AuthorityExpectationV1::UninitializedOwner {
                    owner_pubkey: owner.clone(),
                    active_root_key_version: SafeU53::new(1).unwrap(),
                },
                SafeU53::new(1).unwrap(),
                &snapshot,
                &[],
            )
            .unwrap();
        (
            store.load_revision_generation(&owner).unwrap().unwrap(),
            first,
        )
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
            let (before, _) = seed_authority(&mut store, &root, owner.clone());
            let request = request(owner.clone());
            let first = rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root,
                &request,
                &mut FailOnce(Some(point)),
            );
            assert_eq!(first, Err(RotationError::InjectedCrash(point)));
            let after_crash = store.load_revision_generation(&owner).unwrap().unwrap();
            let terminal = store
                .load_rotation_receipt(&owner, request.rotation_id.as_str())
                .unwrap()
                .is_some();
            if terminal {
                assert_eq!(
                    after_crash.token.generation.get(),
                    before.token.generation.get() + 1
                );
                assert_eq!(
                    after_crash.token.active_root_key_version,
                    SafeU53::new(2).unwrap()
                );
                assert!(store.load_rotation_journal(&owner).unwrap().is_none());
            } else {
                assert_eq!(after_crash, before);
                assert_eq!(
                    store.load_rotation_journal(&owner).unwrap().is_some(),
                    point != RotationCrashPoint::BeforePrepared
                );
            }
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
        let (before, _) = seed_authority(&mut store, &root, owner.clone());
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
        let journal = store.load_rotation_journal(&owner).unwrap().unwrap();
        let mut tampered = journal.clone();
        tampered.ciphertext_b64.push('A');
        assert_eq!(
            authenticate_journal(&root, &owner, &tampered),
            Err(RotationError::JournalAuthentication)
        );
        let encoded = canonicalize(&tampered).unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_rotation_journals SET envelope_json=?2
                 WHERE owner_pubkey=?1",
                rusqlite::params![owner.as_str(), encoded],
            )
            .unwrap();
        assert!(matches!(
            rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root,
                &request,
                &mut NoRotationCrash,
            ),
            Err(RotationError::JournalAuthentication)
                | Err(RotationError::Store(ContinuityStoreError::InvalidRecord))
        ));
        assert_eq!(
            store.load_revision_generation(&owner).unwrap().unwrap(),
            before
        );
    }

    #[test]
    fn stale_authority_and_tampered_candidate_cannot_advance_prepared_rotation() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let root = root();
        let owner = hex(1);
        let (before, _) = seed_authority(&mut store, &root, owner.clone());
        let request = request(owner.clone());
        let request_hash = request_sha256(&request).unwrap();

        let mut stale = before.token.clone();
        stale.generation = SafeU53::new(stale.generation.get() + 1).unwrap();
        let prepared_journal = RotationJournalV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            rotation_id: request.rotation_id.clone(),
            owner_pubkey: owner.clone(),
            from_version: request.from_version,
            to_version: request.to_version,
            phase: RotationPhase::Prepared,
            cursor: 0,
            snapshot_boundary: before.snapshot.records.len() as i64,
            target_count: before.snapshot.records.len() as u64,
            prepared_at: request.prepared_at.clone(),
            request_sha256: request_hash.clone(),
        };
        let prepared_envelope = protect_journal(&root, &prepared_journal).unwrap();
        assert_eq!(
            store.prepare_authority_rotation_cas(
                &stale,
                request.rotation_id.as_str(),
                request.from_version,
                &prepared_envelope,
            ),
            Err(ContinuityStoreError::CompareAndSwapConflict)
        );
        assert!(store.load_rotation_journal(&owner).unwrap().is_none());

        store
            .prepare_authority_rotation_cas(
                &before.token,
                request.rotation_id.as_str(),
                request.from_version,
                &prepared_envelope,
            )
            .unwrap();
        let mut candidate =
            build_rotated_authority_candidate(&root, &before, request.to_version).unwrap();
        candidate.lineages[0].envelope_replacements[0].replacement_digest = sha(9);
        let mut completed = prepared_journal;
        completed.phase = RotationPhase::Complete;
        completed.cursor = completed.snapshot_boundary;
        let terminal = protect_journal(&root, &completed).unwrap();
        assert!(matches!(
            store.commit_authority_rotation_atomically(
                &before.token,
                request.from_version,
                request.to_version,
                &candidate,
                request.rotation_id.as_str(),
                &request_hash,
                &prepared_envelope,
                &terminal,
            ),
            Err(ContinuityStoreError::InvalidRecord)
                | Err(ContinuityStoreError::CompareAndSwapConflict)
        ));
        assert_eq!(
            store.load_revision_generation(&owner).unwrap().unwrap(),
            before
        );
        assert_eq!(
            store.load_rotation_journal(&owner).unwrap(),
            Some(prepared_envelope)
        );
        assert!(store
            .load_rotation_receipt(&owner, request.rotation_id.as_str())
            .unwrap()
            .is_none());
    }

    #[test]
    fn receipt_insert_failure_rolls_back_the_complete_authority_swap() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let root = root();
        let owner = hex(1);
        let (before, _) = seed_authority(&mut store, &root, owner.clone());
        let request = request(owner.clone());
        let request_hash = request_sha256(&request).unwrap();
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
        let prepared_envelope = store.load_rotation_journal(&owner).unwrap().unwrap();
        let prepared_journal = authenticate_journal(&root, &owner, &prepared_envelope).unwrap();
        let candidate =
            build_rotated_authority_candidate(&root, &before, request.to_version).unwrap();
        let mut completed = prepared_journal;
        completed.phase = RotationPhase::Complete;
        completed.cursor = completed.snapshot_boundary;
        let terminal = protect_journal(&root, &completed).unwrap();
        store
            .connection
            .execute_batch(
                "CREATE TRIGGER fail_rotation_receipt
                 BEFORE INSERT ON continuity_rotation_receipts
                 BEGIN SELECT RAISE(ABORT, 'forced'); END;",
            )
            .unwrap();
        assert_eq!(
            store.commit_authority_rotation_atomically(
                &before.token,
                request.from_version,
                request.to_version,
                &candidate,
                request.rotation_id.as_str(),
                &request_hash,
                &prepared_envelope,
                &terminal,
            ),
            Err(ContinuityStoreError::Unavailable)
        );
        store
            .connection
            .execute_batch("DROP TRIGGER fail_rotation_receipt;")
            .unwrap();
        assert_eq!(
            store.load_revision_generation(&owner).unwrap().unwrap(),
            before
        );
        assert_eq!(
            store.load_rotation_journal(&owner).unwrap(),
            Some(prepared_envelope)
        );
        assert!(store
            .load_rotation_receipt(&owner, request.rotation_id.as_str())
            .unwrap()
            .is_none());
    }

    #[test]
    fn terminal_receipt_is_authenticated_and_bound_to_exact_request() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let root = root();
        let owner = hex(1);
        let (before, create_replay) = seed_authority(&mut store, &root, owner.clone());
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
        let after = store.load_revision_generation(&owner).unwrap().unwrap();
        assert_eq!(after.token.store_epoch, before.token.store_epoch);
        assert_eq!(
            after.token.generation.get(),
            before.token.generation.get() + 1
        );
        assert_ne!(
            after.token.snapshot_fingerprint,
            before.token.snapshot_fingerprint
        );
        assert_eq!(
            after.snapshot.revision_idempotency,
            before.snapshot.revision_idempotency
        );
        assert_eq!(
            after.snapshot.artifact_idempotency,
            before.snapshot.artifact_idempotency
        );
        for record in &after.snapshot.records {
            assert_eq!(record.key_version, SafeU53::new(2).unwrap());
            assert_eq!(record.namespace.key_version, SafeU53::new(2).unwrap());
            let key =
                derive_namespace_key(&root, &NamespaceKey::new(record.namespace.clone()).unwrap())
                    .unwrap();
            let body = decrypt_record(record, key.as_bytes()).unwrap();
            assert_eq!(
                body.as_bytes(),
                match record.record_id.as_str() {
                    "record-a" => b"owner-private-a".as_slice(),
                    "record-b" => b"owner-private-b".as_slice(),
                    _ => panic!("unexpected retained record"),
                }
            );
        }
        let before_purged = before
            .snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id.as_str() == "record-purged")
            .unwrap();
        let after_purged = after
            .snapshot
            .lineages
            .iter()
            .find(|lineage| lineage.lineage_root_id.as_str() == "record-purged")
            .unwrap();
        assert_eq!(after_purged, before_purged);
        let mut replay_ledger = RevisionLedger::from_snapshot(after.snapshot.clone()).unwrap();
        assert_eq!(
            replay_ledger
                .apply(create_replay)
                .unwrap()
                .lineage_root_id
                .as_str(),
            "record-a"
        );
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

    #[test]
    fn migration_required_and_wrong_versions_fail_before_any_journal() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let owner = hex(1);
        let root_key = root();
        let legacy = encrypted_seed_record(&root_key, &owner, "legacy-record", b"legacy", 9);
        store.put_encrypted(&legacy).unwrap();
        assert_eq!(
            rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root_key,
                &request(owner.clone()),
                &mut NoRotationCrash,
            ),
            Err(RotationError::Store(
                ContinuityStoreError::AuthorityMigrationRequired
            ))
        );
        assert!(store.load_rotation_journal(&owner).unwrap().is_none());

        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let owner = hex(1);
        let root_key = root();
        let (before, _) = seed_authority(&mut store, &root_key, owner.clone());
        let wrong = RotationRequest {
            rotation_id: OpaqueId::parse("wrong-version").unwrap(),
            owner_pubkey: owner.clone(),
            from_version: SafeU53::new(2).unwrap(),
            to_version: SafeU53::new(3).unwrap(),
            prepared_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
        };
        assert_eq!(
            rotate_continuity_keys(
                &ContinuityLifecycleLock::new_for_test(),
                &mut store,
                &root_key,
                &wrong,
                &mut NoRotationCrash,
            ),
            Err(RotationError::InvalidRequest)
        );
        assert!(store.load_rotation_journal(&owner).unwrap().is_none());
        assert_eq!(
            store.load_revision_generation(&owner).unwrap().unwrap(),
            before
        );
    }
}

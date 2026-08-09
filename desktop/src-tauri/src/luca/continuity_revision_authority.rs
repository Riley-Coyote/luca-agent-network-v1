//! Restart-safe v4 revision authority persisted beside encrypted envelopes.
//!
//! The pure `luca-continuity` ledger remains the semantic authority. This
//! module only normalizes its complete validated snapshot into one owner-global
//! SQLite generation and advances that generation with `BEGIN IMMEDIATE` CAS.

use std::collections::{BTreeMap, BTreeSet};

use luca_continuity::{
    ArtifactRegistrationReceipt, EnvelopeReplacementV1, NamespaceScope, PurgeExecutionStateV1,
    PurgeExecutionStatusV1, PurgedArtifactTombstoneV1, PurgedRecordTombstoneV1, RevisionActor,
    RevisionLedger, RevisionLedgerSnapshotV1, RevisionLifecycle, RevisionOperation,
    RevisionReceipt, RevisionRequest, MAX_ARTIFACT_IDEMPOTENCY_ENTRIES,
    MAX_DERIVED_ARTIFACTS_PER_LEDGER, MAX_DERIVED_ARTIFACTS_PER_LINEAGE,
    MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER, MAX_HYDRATED_BODY_BYTES, MAX_HYDRATED_RECORDS,
    MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER, MAX_REVISION_AUTHORITY_HEADS,
    MAX_REVISION_IDEMPOTENCY_ENTRIES, MAX_REVISION_MEMBERS_PER_LEDGER,
    MAX_REVISION_MEMBERS_PER_LINEAGE, MAX_REVISION_SNAPSHOT_CANONICAL_BYTES,
    MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES, MAX_REVISION_SNAPSHOT_RECORDS,
    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES,
};
use luca_protocol::{
    canonicalize, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityRecordV1,
    ContinuityScopeV1, Hex64, OpaqueId, SafeU53, Sha256Ref,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{de::DeserializeOwned, Serialize};
use uuid::Uuid;

use super::continuity_store::{
    insert_record, replace_source_mappings, validate_source_mappings, ContinuitySourceMapping,
    ContinuityStore, ContinuityStoreError,
};

const AUTHORITY_SCHEMA_V1: i64 = 1;
const MAX_TYPED_BLOB_BYTES: usize = 4 * 1024 * 1024;
pub(crate) const MAX_OWNER_BRAIN_IMPORT_TRANSITIONS: usize = 40;

/// Complete v4 body-free authority schema. Encrypted bodies remain exclusively
/// in `continuity_records`; replay rows never duplicate successor ciphertext.
pub(super) const CREATE_AUTHORITY_SCHEMA_SQL: &str = r#"
CREATE TABLE continuity_authority_meta (
    owner_pubkey TEXT PRIMARY KEY NOT NULL,
    store_epoch TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation > 0 AND generation <= 9007199254740991),
    authority_schema INTEGER NOT NULL CHECK(authority_schema = 1),
    active_root_key_version INTEGER NOT NULL CHECK(active_root_key_version > 0),
    snapshot_fingerprint TEXT NOT NULL,
    UNIQUE(owner_pubkey, generation)
);
CREATE TABLE continuity_revision_lineages (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    namespace_json BLOB NOT NULL,
    scope_json BLOB NOT NULL,
    namespace_protocol TEXT NOT NULL,
    namespace_kind TEXT NOT NULL,
    resident_pubkey TEXT,
    namespace_ref TEXT NOT NULL,
    scope_ref TEXT NOT NULL,
    source_id TEXT,
    project_id TEXT,
    room_id TEXT,
    conversation_id TEXT,
    retained_head_record_id TEXT NOT NULL,
    active_head_record_id TEXT,
    lifecycle TEXT NOT NULL CHECK(lifecycle IN ('active','archived','forgotten')),
    pinned_owner_correction INTEGER NOT NULL CHECK(pinned_owner_correction IN (0,1)),
    record_type TEXT NOT NULL,
    lineage_envelope_key_version INTEGER NOT NULL CHECK(lineage_envelope_key_version > 0),
    latest_mutation_domain TEXT NOT NULL CHECK(latest_mutation_domain IN ('revision','artifact')),
    latest_mutation_key TEXT NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id),
    CHECK(
        (namespace_kind = 'owner_brain' AND resident_pubkey IS NULL) OR
        (namespace_kind = 'resident_private' AND resident_pubkey IS NOT NULL)
    ),
    CHECK(
        (lifecycle = 'active' AND active_head_record_id = retained_head_record_id) OR
        (lifecycle IN ('archived','forgotten') AND active_head_record_id IS NULL)
    ),
    FOREIGN KEY(owner_pubkey, authority_generation)
        REFERENCES continuity_authority_meta(owner_pubkey, generation)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_revision_membership (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    record_id TEXT NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id, ordinal),
    UNIQUE(owner_pubkey, authority_generation, record_id),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_lineages(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_envelope_replacements (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    replacement_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id, ordinal),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_lineages(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_revision_artifacts (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    artifact_ref TEXT NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id, ordinal),
    UNIQUE(owner_pubkey, authority_generation, artifact_ref),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_lineages(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_idempotency_keys (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    domain TEXT NOT NULL CHECK(domain IN ('revision','artifact')),
    lineage_root_id TEXT NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, idempotency_key),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_lineages(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_revision_replay (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    canonical_request_digest TEXT NOT NULL,
    binding_json BLOB NOT NULL,
    receipt_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, idempotency_key),
    FOREIGN KEY(owner_pubkey, authority_generation, idempotency_key)
        REFERENCES continuity_idempotency_keys(owner_pubkey, authority_generation, idempotency_key)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_artifact_replay (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    canonical_request_digest TEXT NOT NULL,
    binding_json BLOB NOT NULL,
    receipt_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, idempotency_key),
    FOREIGN KEY(owner_pubkey, authority_generation, idempotency_key)
        REFERENCES continuity_idempotency_keys(owner_pubkey, authority_generation, idempotency_key)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_revision_purges (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('authorized','in_progress','completed','failed')),
    plan_json BLOB NOT NULL,
    progress_receipt_json BLOB NOT NULL,
    authorizing_revision_key TEXT NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_lineages(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_record_tombstones (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    tombstone_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id, ordinal),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_purges(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_artifact_tombstones (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    lineage_root_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    tombstone_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, authority_generation, lineage_root_id, ordinal),
    FOREIGN KEY(owner_pubkey, authority_generation, lineage_root_id)
        REFERENCES continuity_revision_purges(owner_pubkey, authority_generation, lineage_root_id)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE continuity_nonce_reservations (
    owner_pubkey TEXT NOT NULL,
    authority_generation INTEGER NOT NULL,
    namespace_ref TEXT NOT NULL,
    key_version INTEGER NOT NULL CHECK(key_version > 0),
    nonce_b64 TEXT NOT NULL,
    record_id TEXT NOT NULL,
    reservation_state TEXT NOT NULL CHECK(reservation_state IN ('live','retired','purged')),
    PRIMARY KEY(owner_pubkey, authority_generation, namespace_ref, key_version, nonce_b64),
    FOREIGN KEY(owner_pubkey, authority_generation)
        REFERENCES continuity_authority_meta(owner_pubkey, generation)
        DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX continuity_revision_active_scope ON continuity_revision_lineages(
    owner_pubkey, authority_generation, namespace_protocol, namespace_kind, resident_pubkey, namespace_ref,
    scope_ref, source_id, project_id, room_id, conversation_id, lineage_root_id
) WHERE lifecycle = 'active';
CREATE UNIQUE INDEX continuity_revision_unique_active_head ON continuity_revision_lineages(
    owner_pubkey, authority_generation, active_head_record_id
) WHERE active_head_record_id IS NOT NULL;
CREATE INDEX continuity_idempotency_by_lineage_domain ON continuity_idempotency_keys(
    owner_pubkey, authority_generation, lineage_root_id, domain, idempotency_key
);
CREATE INDEX continuity_purge_state ON continuity_revision_purges(
    owner_pubkey, authority_generation, status, lineage_root_id
);
CREATE INDEX continuity_record_tombstones_by_lineage ON continuity_record_tombstones(
    owner_pubkey, authority_generation, lineage_root_id, ordinal
);
CREATE INDEX continuity_artifact_tombstones_by_lineage ON continuity_artifact_tombstones(
    owner_pubkey, authority_generation, lineage_root_id, ordinal
);
"#;

pub(super) const AUTHORITY_TABLES: &[&str] = &[
    "continuity_authority_meta",
    "continuity_revision_lineages",
    "continuity_revision_membership",
    "continuity_envelope_replacements",
    "continuity_revision_artifacts",
    "continuity_idempotency_keys",
    "continuity_revision_replay",
    "continuity_artifact_replay",
    "continuity_revision_purges",
    "continuity_record_tombstones",
    "continuity_artifact_tombstones",
    "continuity_nonce_reservations",
];

pub(super) const AUTHORITY_INDEXES: &[&str] = &[
    "continuity_revision_active_scope",
    "continuity_revision_unique_active_head",
    "continuity_idempotency_by_lineage_domain",
    "continuity_purge_state",
    "continuity_record_tombstones_by_lineage",
    "continuity_artifact_tombstones_by_lineage",
];

/// Owner-global immutable CAS token for one complete persisted generation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RevisionAuthorityTokenV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) store_epoch: String,
    pub(crate) generation: SafeU53,
    pub(crate) authority_schema: u16,
    pub(crate) active_root_key_version: SafeU53,
    pub(crate) snapshot_fingerprint: Sha256Ref,
}

/// The only legal starting authority for a desktop transition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum AuthorityExpectationV1 {
    UninitializedOwner {
        owner_pubkey: Hex64,
        active_root_key_version: SafeU53,
    },
    Existing(RevisionAuthorityTokenV1),
}

impl AuthorityExpectationV1 {
    fn owner(&self) -> &Hex64 {
        match self {
            Self::UninitializedOwner { owner_pubkey, .. } => owner_pubkey,
            Self::Existing(token) => &token.owner_pubkey,
        }
    }

    fn active_key_version(&self) -> SafeU53 {
        match self {
            Self::UninitializedOwner {
                active_root_key_version,
                ..
            } => *active_root_key_version,
            Self::Existing(token) => token.active_root_key_version,
        }
    }
}

/// One complete, pure-validated owner generation loaded from SQLite.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StoredRevisionGenerationV1 {
    pub(crate) token: RevisionAuthorityTokenV1,
    pub(crate) snapshot: RevisionLedgerSnapshotV1,
}

/// One immutable, ciphertext-only exact-scope view bound to the complete
/// owner-global revision authority token that selected it.
///
/// `active_heads` is ordered by lineage root. It contains only the explicit
/// active head of each exact matching lineage; archived and forgotten
/// lineages never contribute an envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ImmutableScopeCaptureV1 {
    pub(crate) token: RevisionAuthorityTokenV1,
    pub(crate) active_heads: Vec<ContinuityRecordV1>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RevisionTransitionResultV1 {
    pub(crate) token: RevisionAuthorityTokenV1,
    pub(crate) receipt: RevisionReceipt,
    pub(crate) replayed: bool,
}

/// One owner-global atomic group of revision transitions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RevisionBatchTransitionResultV1 {
    pub(crate) token: RevisionAuthorityTokenV1,
    pub(crate) receipts: Vec<RevisionReceipt>,
    pub(crate) replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ArtifactTransitionResultV1 {
    pub(crate) token: RevisionAuthorityTokenV1,
    pub(crate) receipt: ArtifactRegistrationReceipt,
    pub(crate) replayed: bool,
}

pub(super) fn validate_authority_schema(
    connection: &Connection,
) -> Result<(), ContinuityStoreError> {
    for name in AUTHORITY_TABLES {
        validate_schema_object(connection, "table", name)?;
    }
    for name in AUTHORITY_INDEXES {
        validate_schema_object(connection, "index", name)?;
    }
    Ok(())
}

fn validate_schema_object(
    connection: &Connection,
    expected_kind: &str,
    name: &str,
) -> Result<(), ContinuityStoreError> {
    let found: Option<(String, Option<String>)> = connection
        .query_row(
            "SELECT type, sql FROM sqlite_master WHERE name = ?1",
            [name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let Some((kind, Some(actual_sql))) = found else {
        return Err(ContinuityStoreError::SchemaIncompatible);
    };
    let expected_sql =
        authority_schema_statement(name).ok_or(ContinuityStoreError::SchemaIncompatible)?;
    if kind != expected_kind
        || normalize_schema_sql(&actual_sql) != normalize_schema_sql(expected_sql)
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    Ok(())
}

fn authority_schema_statement(name: &str) -> Option<&str> {
    CREATE_AUTHORITY_SCHEMA_SQL
        .split(';')
        .map(str::trim)
        .filter(|statement| !statement.is_empty())
        .find(|statement| {
            let tokens = statement.split_whitespace().collect::<Vec<_>>();
            let object_name = match tokens.as_slice() {
                [create, table, object, ..]
                    if create.eq_ignore_ascii_case("create")
                        && table.eq_ignore_ascii_case("table") =>
                {
                    Some(*object)
                }
                [create, index, object, ..]
                    if create.eq_ignore_ascii_case("create")
                        && index.eq_ignore_ascii_case("index") =>
                {
                    Some(*object)
                }
                [create, unique, index, object, ..]
                    if create.eq_ignore_ascii_case("create")
                        && unique.eq_ignore_ascii_case("unique")
                        && index.eq_ignore_ascii_case("index") =>
                {
                    Some(*object)
                }
                _ => None,
            };
            object_name == Some(name)
        })
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace() && *character != ';')
        .flat_map(char::to_uppercase)
        .collect()
}

impl ContinuityStore {
    /// Load and fully hydrate one owner generation. Missing authority is valid
    /// only when no legacy ciphertext/version state exists for that owner.
    pub(crate) fn load_revision_generation(
        &self,
        owner_pubkey: &Hex64,
    ) -> Result<Option<StoredRevisionGenerationV1>, ContinuityStoreError> {
        load_generation(&self.connection, owner_pubkey)
    }

    /// Capture one exact-scope active-head set and its complete owner authority
    /// token from a single immutable SQLite read transaction.
    ///
    /// The returned envelopes remain structural ciphertext. Callers must later
    /// authenticate them with the exact namespace key before using any body.
    pub(crate) fn capture_immutable_active_scope(
        &self,
        owner_pubkey: &Hex64,
        requested: &NamespaceScope,
    ) -> Result<Option<ImmutableScopeCaptureV1>, ContinuityStoreError> {
        if requested.namespace().as_protocol().owner_pubkey != *owner_pubkey {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, owner_pubkey)?;
        let Some(generation) = load_generation_in_snapshot(&transaction, owner_pubkey)? else {
            transaction
                .commit()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            return Ok(None);
        };
        let active_heads = load_exact_active_heads(
            &transaction,
            requested,
            &generation.token,
            &generation.snapshot,
        )?;
        reject_rotation(&transaction, owner_pubkey)?;
        let reread = load_generation_in_snapshot(&transaction, owner_pubkey)?
            .ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
        if reread.token != generation.token {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(Some(ImmutableScopeCaptureV1 {
            token: generation.token,
            active_heads,
        }))
    }

    /// Revalidate a previously captured owner authority token while rejecting
    /// any nonterminal rotation. A normal intervening generation change is
    /// reported as `false`; malformed authority still fails closed.
    pub(crate) fn revalidate_immutable_capture(
        &self,
        expected: &RevisionAuthorityTokenV1,
    ) -> Result<bool, ContinuityStoreError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &expected.owner_pubkey)?;
        let current = load_generation_in_snapshot(&transaction, &expected.owner_pubkey)?;
        reject_rotation(&transaction, &expected.owner_pubkey)?;
        let matches = current
            .as_ref()
            .is_some_and(|generation| generation.token == *expected);
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(matches)
    }

    /// Apply one revision operation through owner-global SQLite CAS.
    pub(crate) fn apply_revision_transition_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        request: RevisionRequest,
    ) -> Result<RevisionTransitionResultV1, ContinuityStoreError> {
        let owner = expectation.owner().clone();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?;
        let mut ledger = match &current {
            Some(current) => RevisionLedger::from_snapshot(current.snapshot.clone())
                .map_err(map_continuity_error)?,
            None => RevisionLedger::default(),
        };
        let before = ledger.export_snapshot().map_err(map_continuity_error)?;
        let receipt = ledger.apply(request).map_err(map_continuity_error)?;
        let candidate = ledger.export_snapshot().map_err(map_continuity_error)?;
        if candidate == before {
            let current = current.ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
            transaction
                .rollback()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            return Ok(RevisionTransitionResultV1 {
                token: current.token,
                receipt,
                replayed: true,
            });
        }
        require_expectation(expectation, current.as_ref())?;
        let token = persist_transition(
            &transaction,
            expectation,
            current.as_ref(),
            expectation.active_key_version(),
            &candidate,
            false,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(RevisionTransitionResultV1 {
            token,
            receipt,
            replayed: false,
        })
    }

    /// Apply a bounded group of independent revision operations in one SQLite
    /// transaction. This is used by V1.1 metabolism so a handoff and its memory
    /// notes become visible together or not at all.
    pub(crate) fn apply_revision_batch_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        requests: Vec<RevisionRequest>,
    ) -> Result<RevisionBatchTransitionResultV1, ContinuityStoreError> {
        self.apply_revision_batch_cas_bounded(expectation, requests, 4)
    }

    /// Apply one bounded Owner Brain import through the existing owner-global
    /// revision transaction. Every successor must stay in the owner-brain
    /// namespace and use the closed import record vocabulary.
    pub(crate) fn apply_owner_brain_import_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        requests: Vec<RevisionRequest>,
    ) -> Result<RevisionBatchTransitionResultV1, ContinuityStoreError> {
        let owner = expectation.owner();
        let expected_scope = requests
            .first()
            .and_then(|request| request.successor.as_ref())
            .map(|record| record.scope.clone());
        let valid = requests.iter().all(|request| {
            matches!(
                request.operation,
                RevisionOperation::Create | RevisionOperation::Revise
            ) && request.actor == RevisionActor::Owner
                && request.successor.as_ref().is_some_and(|record| {
                    record.namespace.owner_pubkey == *owner
                        && record.namespace.kind == ContinuityNamespaceKindV1::OwnerBrain
                        && record.namespace.resident_pubkey.is_none()
                        && expected_scope.as_ref() == Some(&record.scope)
                        && matches!(
                            record.record_type.as_str(),
                            "owner-brain-source" | "owner-brain-binding" | "owner-brain-chunk-page"
                        )
                })
        });
        if !valid {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        self.apply_revision_batch_cas_bounded(
            expectation,
            requests,
            MAX_OWNER_BRAIN_IMPORT_TRANSITIONS,
        )
    }

    /// Apply one owner-authorized Brain grant mutation. The narrow wrapper
    /// prevents generic revision callers from introducing a grant outside an
    /// owner-brain source scope or under a non-owner actor.
    pub(crate) fn apply_owner_brain_grant_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        request: RevisionRequest,
    ) -> Result<RevisionTransitionResultV1, ContinuityStoreError> {
        let owner = expectation.owner();
        let valid = matches!(
            request.operation,
            RevisionOperation::Create | RevisionOperation::Revise
        ) && request.actor == RevisionActor::Owner
            && request.successor.as_ref().is_some_and(|record| {
                record.namespace.owner_pubkey == *owner
                    && record.namespace.kind == ContinuityNamespaceKindV1::OwnerBrain
                    && record.namespace.resident_pubkey.is_none()
                    && record.scope.namespace_ref == record.namespace.namespace_ref
                    && record.scope.source_id.is_some()
                    && record.record_type.as_str() == "owner-brain-grant"
            });
        if !valid {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        self.apply_revision_transition_cas(expectation, request)
    }

    fn apply_revision_batch_cas_bounded(
        &mut self,
        expectation: &AuthorityExpectationV1,
        requests: Vec<RevisionRequest>,
        maximum: usize,
    ) -> Result<RevisionBatchTransitionResultV1, ContinuityStoreError> {
        if requests.is_empty() || requests.len() > maximum {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let owner = expectation.owner().clone();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?;
        let mut ledger = match &current {
            Some(current) => RevisionLedger::from_snapshot(current.snapshot.clone())
                .map_err(map_continuity_error)?,
            None => RevisionLedger::default(),
        };
        let before = ledger.export_snapshot().map_err(map_continuity_error)?;
        let mut receipts = Vec::with_capacity(requests.len());
        for request in requests {
            receipts.push(ledger.apply(request).map_err(map_continuity_error)?);
        }
        let candidate = ledger.export_snapshot().map_err(map_continuity_error)?;
        if candidate == before {
            let current = current.ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
            transaction
                .rollback()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            return Ok(RevisionBatchTransitionResultV1 {
                token: current.token,
                receipts,
                replayed: true,
            });
        }
        require_expectation(expectation, current.as_ref())?;
        let token = persist_transition(
            &transaction,
            expectation,
            current.as_ref(),
            expectation.active_key_version(),
            &candidate,
            false,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(RevisionBatchTransitionResultV1 {
            token,
            receipts,
            replayed: false,
        })
    }

    /// Apply one artifact registration with the same replay-before-CAS rule.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn register_artifacts_transition_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        idempotency_key: Sha256Ref,
        request_ref: Sha256Ref,
        lineage_root_id: &OpaqueId,
        expected_head_record_id: &OpaqueId,
        artifacts: Vec<Sha256Ref>,
    ) -> Result<ArtifactTransitionResultV1, ContinuityStoreError> {
        let owner = expectation.owner().clone();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?
            .ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
        let mut ledger = RevisionLedger::from_snapshot(current.snapshot.clone())
            .map_err(map_continuity_error)?;
        let before = ledger.export_snapshot().map_err(map_continuity_error)?;
        let receipt = ledger
            .register_derived_artifacts(
                idempotency_key,
                request_ref,
                lineage_root_id,
                expected_head_record_id,
                artifacts,
            )
            .map_err(map_continuity_error)?;
        let candidate = ledger.export_snapshot().map_err(map_continuity_error)?;
        if candidate == before {
            transaction
                .rollback()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            return Ok(ArtifactTransitionResultV1 {
                token: current.token,
                receipt,
                replayed: true,
            });
        }
        require_expectation(expectation, Some(&current))?;
        let token = persist_transition(
            &transaction,
            expectation,
            Some(&current),
            current.token.active_root_key_version,
            &candidate,
            false,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(ArtifactTransitionResultV1 {
            token,
            receipt,
            replayed: false,
        })
    }

    /// Advance one exact purge state atomically with ciphertext deletion only
    /// when the pure ledger emits completed tombstones.
    pub(crate) fn advance_purge_transition_cas(
        &mut self,
        expectation: &AuthorityExpectationV1,
        lineage_root_id: &OpaqueId,
        next: PurgeExecutionStatusV1,
    ) -> Result<RevisionAuthorityTokenV1, ContinuityStoreError> {
        let owner = expectation.owner().clone();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?
            .ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
        require_expectation(expectation, Some(&current))?;
        let mut ledger = RevisionLedger::from_snapshot(current.snapshot.clone())
            .map_err(map_continuity_error)?;
        ledger
            .advance_purge(lineage_root_id, next)
            .map_err(map_continuity_error)?;
        let candidate = ledger.export_snapshot().map_err(map_continuity_error)?;
        let token = persist_transition(
            &transaction,
            expectation,
            Some(&current),
            current.token.active_root_key_version,
            &candidate,
            false,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(token)
    }

    /// Replace one complete owner generation for a later confirmed protected
    /// restore. This assigns a fresh epoch so every pre-restore token is stale.
    pub(crate) fn replace_owner_revision_generation_atomically(
        &mut self,
        expectation: &AuthorityExpectationV1,
        active_root_key_version: SafeU53,
        snapshot: &RevisionLedgerSnapshotV1,
    ) -> Result<RevisionAuthorityTokenV1, ContinuityStoreError> {
        let owner = expectation.owner().clone();
        validate_snapshot_owner(snapshot, &owner)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?;
        require_expectation(expectation, current.as_ref())?;
        let token = persist_transition(
            &transaction,
            expectation,
            current.as_ref(),
            active_root_key_version,
            snapshot,
            true,
            true,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(token)
    }

    /// Replace ciphertext, source mappings, owner key version, and complete
    /// revision authority as one owner-global transaction. This is the only
    /// restore-ready seam for an owner that already has v4 authority.
    pub(crate) fn replace_complete_owner_generation_atomically(
        &mut self,
        expectation: &AuthorityExpectationV1,
        active_root_key_version: SafeU53,
        snapshot: &RevisionLedgerSnapshotV1,
        source_mappings: &[ContinuitySourceMapping],
    ) -> Result<RevisionAuthorityTokenV1, ContinuityStoreError> {
        let owner = expectation.owner().clone();
        validate_snapshot_owner(snapshot, &owner)?;
        validate_source_mappings(source_mappings)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &owner)?;
        let current = load_generation_in_snapshot(&transaction, &owner)?;
        require_expectation(expectation, current.as_ref())?;
        replace_source_mappings(&transaction, &owner, source_mappings)?;
        let token = persist_transition(
            &transaction,
            expectation,
            current.as_ref(),
            active_root_key_version,
            snapshot,
            true,
            true,
        )?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(token)
    }

    /// Freeze one exact authority generation behind an authenticated rotation
    /// journal. No ciphertext or authority row changes in this transaction.
    pub(crate) fn prepare_authority_rotation_cas(
        &mut self,
        expected: &RevisionAuthorityTokenV1,
        rotation_id: &str,
        from_version: SafeU53,
        journal: &ContinuityRecordV1,
    ) -> Result<(), ContinuityStoreError> {
        OpaqueId::parse(rotation_id.to_owned()).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let encoded = canonical_rotation_envelope(journal, &expected.owner_pubkey)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        reject_rotation(&transaction, &expected.owner_pubkey)?;
        let current = load_generation_in_snapshot(&transaction, &expected.owner_pubkey)?
            .ok_or(ContinuityStoreError::AuthorityMigrationRequired)?;
        require_expectation(
            &AuthorityExpectationV1::Existing(expected.clone()),
            Some(&current),
        )?;
        if expected.active_root_key_version != from_version {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        let receipt_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_receipts
                 WHERE owner_pubkey=?1 AND rotation_id=?2)",
                params![expected.owner_pubkey.as_str(), rotation_id],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if receipt_exists {
            return Err(ContinuityStoreError::ReplayConflict);
        }
        let changed = transaction
            .execute(
                "INSERT INTO continuity_rotation_journals(owner_pubkey,rotation_id,envelope_json)
                 VALUES (?1,?2,?3)",
                params![expected.owner_pubkey.as_str(), rotation_id, encoded],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    /// Atomically replace retained ciphertext and its complete revision
    /// authority generation, retain the exact terminal receipt, and remove the
    /// exact prepared journal. Readers observe either the old generation plus
    /// its journal or the complete new generation plus its receipt.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn commit_authority_rotation_atomically(
        &mut self,
        expected: &RevisionAuthorityTokenV1,
        from_version: SafeU53,
        to_version: SafeU53,
        candidate: &RevisionLedgerSnapshotV1,
        rotation_id: &str,
        request_sha256: &Hex64,
        expected_journal: &ContinuityRecordV1,
        terminal_receipt: &ContinuityRecordV1,
    ) -> Result<RevisionAuthorityTokenV1, ContinuityStoreError> {
        OpaqueId::parse(rotation_id.to_owned()).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if expected.active_root_key_version != from_version
            || to_version.get() != from_version.get().saturating_add(1)
        {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        validate_snapshot_owner(candidate, &expected.owner_pubkey)?;
        let expected_journal =
            canonical_rotation_envelope(expected_journal, &expected.owner_pubkey)?;
        let terminal_receipt =
            canonical_rotation_envelope(terminal_receipt, &expected.owner_pubkey)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let current = load_generation_in_snapshot(&transaction, &expected.owner_pubkey)?
            .ok_or(ContinuityStoreError::AuthorityMigrationRequired)?;
        let expectation = AuthorityExpectationV1::Existing(expected.clone());
        require_expectation(&expectation, Some(&current))?;

        let journal: Option<(String, Vec<u8>)> = transaction
            .query_row(
                "SELECT rotation_id,envelope_json FROM continuity_rotation_journals
                 WHERE owner_pubkey=?1",
                [expected.owner_pubkey.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if journal.as_ref().map(|value| value.0.as_str()) != Some(rotation_id)
            || journal.as_ref().map(|value| value.1.as_slice()) != Some(expected_journal.as_slice())
        {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        let receipt_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_receipts
                 WHERE owner_pubkey=?1 AND rotation_id=?2)",
                params![expected.owner_pubkey.as_str(), rotation_id],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if receipt_exists {
            return Err(ContinuityStoreError::ReplayConflict);
        }

        let token = persist_transition(
            &transaction,
            &expectation,
            Some(&current),
            to_version,
            candidate,
            true,
            false,
        )?;
        let receipt_changed = transaction
            .execute(
                "INSERT INTO continuity_rotation_receipts(
                    owner_pubkey,rotation_id,request_sha256,envelope_json
                 ) VALUES (?1,?2,?3,?4)",
                params![
                    expected.owner_pubkey.as_str(),
                    rotation_id,
                    request_sha256.as_str(),
                    terminal_receipt,
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let journal_changed = transaction
            .execute(
                "DELETE FROM continuity_rotation_journals
                 WHERE owner_pubkey=?1 AND rotation_id=?2 AND envelope_json=?3",
                params![
                    expected.owner_pubkey.as_str(),
                    rotation_id,
                    expected_journal,
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if receipt_changed != 1 || journal_changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(token)
    }
}

fn canonical_rotation_envelope(
    record: &ContinuityRecordV1,
    owner: &Hex64,
) -> Result<Vec<u8>, ContinuityStoreError> {
    record
        .validate()
        .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if record.namespace.owner_pubkey != *owner {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    let encoded = canonicalize(record).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if encoded.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    Ok(encoded)
}

fn map_continuity_error(error: luca_continuity::ContinuityError) -> ContinuityStoreError {
    use luca_continuity::ContinuityError as E;
    match error {
        E::NonceCollision => ContinuityStoreError::NonceCollision,
        E::LifecycleConflict | E::PinnedOwnerCorrection => ContinuityStoreError::LifecycleConflict,
        E::ReplayConflict | E::IdempotencyConflict => ContinuityStoreError::ReplayConflict,
        E::RevisionConflict => ContinuityStoreError::CompareAndSwapConflict,
        _ => ContinuityStoreError::InvalidRecord,
    }
}

fn require_expectation(
    expectation: &AuthorityExpectationV1,
    current: Option<&StoredRevisionGenerationV1>,
) -> Result<(), ContinuityStoreError> {
    match (expectation, current) {
        (AuthorityExpectationV1::UninitializedOwner { .. }, None) => Ok(()),
        (AuthorityExpectationV1::Existing(expected), Some(current))
            if expected == &current.token =>
        {
            Ok(())
        }
        _ => Err(ContinuityStoreError::CompareAndSwapConflict),
    }
}

fn reject_rotation(connection: &Connection, owner: &Hex64) -> Result<(), ContinuityStoreError> {
    let busy: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM continuity_rotation_journals WHERE owner_pubkey = ?1)",
            [owner.as_str()],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if busy {
        Err(ContinuityStoreError::LifecycleConflict)
    } else {
        Ok(())
    }
}

fn authority_namespace_kind(kind: &ContinuityNamespaceKindV1) -> &'static str {
    match kind {
        ContinuityNamespaceKindV1::OwnerBrain => "owner_brain",
        ContinuityNamespaceKindV1::ResidentPrivate => "resident_private",
    }
}

fn expected_exact_active_heads(
    snapshot: &RevisionLedgerSnapshotV1,
    requested: &NamespaceScope,
) -> Result<BTreeMap<String, ContinuityRecordV1>, ContinuityStoreError> {
    let mut records = BTreeMap::new();
    for record in &snapshot.records {
        if records
            .insert(record.record_id.as_str().to_owned(), record)
            .is_some()
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
    }

    let mut heads = BTreeMap::new();
    for lineage in &snapshot.lineages {
        if lineage.lifecycle != RevisionLifecycle::Active
            || lineage.namespace != *requested.namespace().as_protocol()
            || lineage.scope != *requested.as_protocol()
        {
            continue;
        }
        let head_id = lineage
            .active_head_record_id
            .as_ref()
            .ok_or(ContinuityStoreError::InvalidRecord)?;
        let record = records
            .get(head_id.as_str())
            .copied()
            .ok_or(ContinuityStoreError::InvalidRecord)?;
        if record.record_id != *head_id
            || record.namespace != lineage.namespace
            || record.scope != lineage.scope
            || record.record_type != lineage.record_type
            || record.key_version != lineage.lineage_envelope_key_version
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        if heads
            .insert(lineage.lineage_root_id.as_str().to_owned(), record.clone())
            .is_some()
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
    }
    Ok(heads)
}

fn load_exact_active_heads(
    connection: &Connection,
    requested: &NamespaceScope,
    token: &RevisionAuthorityTokenV1,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<Vec<ContinuityRecordV1>, ContinuityStoreError> {
    let namespace = requested.namespace().as_protocol();
    let scope = requested.as_protocol();
    if token.owner_pubkey != namespace.owner_pubkey
        || token.active_root_key_version != namespace.key_version
    {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    let expected = expected_exact_active_heads(snapshot, requested)?;
    if expected.len() > MAX_HYDRATED_RECORDS {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let kind = authority_namespace_kind(&namespace.kind);
    let resident = namespace.resident_pubkey.as_ref().map(Hex64::as_str);
    let source = scope.source_id.as_ref().map(OpaqueId::as_str);
    let project = scope.project_id.as_ref().map(OpaqueId::as_str);
    let room = scope.room_id.as_ref().map(OpaqueId::as_str);
    let conversation = scope.conversation_id.as_ref().map(OpaqueId::as_str);

    let (count, malformed, encrypted_bytes): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE
                        WHEN typeof(l.lineage_root_id)='text'
                         AND length(CAST(l.lineage_root_id AS BLOB)) BETWEEN 1 AND 128
                         AND typeof(l.active_head_record_id)='text'
                         AND length(CAST(l.active_head_record_id AS BLOB)) BETWEEN 1 AND 128
                         AND typeof(l.record_type)='text'
                         AND length(CAST(l.record_type AS BLOB)) BETWEEN 1 AND 128
                         AND typeof(l.lineage_envelope_key_version)='integer'
                         AND l.lineage_envelope_key_version BETWEEN 1 AND 9007199254740991
                         AND typeof(r.envelope_json)='blob'
                         AND length(r.envelope_json) BETWEEN 1 AND ?13
                        THEN 0 ELSE 1 END),0),
                    COALESCE(SUM(CASE WHEN typeof(r.envelope_json)='blob'
                                      THEN length(r.envelope_json) ELSE 0 END),0)
             FROM continuity_revision_lineages AS l
                  INDEXED BY continuity_revision_active_scope
             LEFT JOIN continuity_records AS r ON r.record_id=l.active_head_record_id
             WHERE l.owner_pubkey=?1 AND l.authority_generation=?2
               AND l.namespace_protocol=?3 AND l.namespace_kind=?4
               AND l.resident_pubkey IS ?5 AND l.namespace_ref=?6
               AND l.lineage_envelope_key_version=?7
               AND l.scope_ref=?8 AND l.source_id IS ?9 AND l.project_id IS ?10
               AND l.room_id IS ?11 AND l.conversation_id IS ?12
               AND l.lifecycle='active' AND l.active_head_record_id IS NOT NULL
               AND l.scope_json IS NOT NULL AND l.namespace_json IS NOT NULL",
            params![
                token.owner_pubkey.as_str(),
                token.generation.get() as i64,
                namespace.protocol.as_str(),
                kind,
                resident,
                namespace.namespace_ref.as_str(),
                namespace.key_version.get() as i64,
                scope.scope_ref.as_str(),
                source,
                project,
                room,
                conversation,
                MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64,
            ],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let count = usize::try_from(count).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    let encrypted_bytes =
        usize::try_from(encrypted_bytes).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if malformed != 0 {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    if count != expected.len() {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    if count > MAX_HYDRATED_RECORDS || encrypted_bytes > MAX_HYDRATED_BODY_BYTES {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }

    let mut statement = connection
        .prepare(
            "SELECT l.lineage_root_id,l.active_head_record_id,l.record_type,
                    l.lineage_envelope_key_version,r.envelope_json
             FROM continuity_revision_lineages AS l
                  INDEXED BY continuity_revision_active_scope
             JOIN continuity_records AS r ON r.record_id=l.active_head_record_id
             WHERE l.owner_pubkey=?1 AND l.authority_generation=?2
               AND l.namespace_protocol=?3 AND l.namespace_kind=?4
               AND l.resident_pubkey IS ?5 AND l.namespace_ref=?6
               AND l.lineage_envelope_key_version=?7
               AND l.scope_ref=?8 AND l.source_id IS ?9 AND l.project_id IS ?10
               AND l.room_id IS ?11 AND l.conversation_id IS ?12
               AND l.lifecycle='active' AND l.active_head_record_id IS NOT NULL
               AND typeof(l.lineage_root_id)='text'
               AND length(CAST(l.lineage_root_id AS BLOB)) BETWEEN 1 AND 128
               AND typeof(l.active_head_record_id)='text'
               AND length(CAST(l.active_head_record_id AS BLOB)) BETWEEN 1 AND 128
               AND typeof(l.record_type)='text'
               AND length(CAST(l.record_type AS BLOB)) BETWEEN 1 AND 128
               AND typeof(l.lineage_envelope_key_version)='integer'
               AND l.lineage_envelope_key_version BETWEEN 1 AND 9007199254740991
               AND typeof(r.envelope_json)='blob'
               AND length(r.envelope_json) BETWEEN 1 AND ?13
             ORDER BY l.lineage_root_id",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(
            params![
                token.owner_pubkey.as_str(),
                token.generation.get() as i64,
                namespace.protocol.as_str(),
                kind,
                resident,
                namespace.namespace_ref.as_str(),
                namespace.key_version.get() as i64,
                scope.scope_ref.as_str(),
                source,
                project,
                room,
                conversation,
                MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64,
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                ))
            },
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;

    let mut active_heads = Vec::with_capacity(count);
    let mut actual_bytes = 0usize;
    let mut previous_root: Option<String> = None;
    for row in rows {
        let (root, head_id, record_type, envelope_key_version, raw) =
            row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if previous_root
            .as_ref()
            .is_some_and(|previous| previous >= &root)
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let expected_record = expected
            .get(&root)
            .ok_or(ContinuityStoreError::InvalidRecord)?;
        let head_id = OpaqueId::parse(head_id).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let record_type =
            OpaqueId::parse(record_type).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let envelope_key_version = parse_safe(envelope_key_version)?;
        actual_bytes = actual_bytes
            .checked_add(raw.len())
            .ok_or(ContinuityStoreError::SnapshotBoundExceeded)?;
        let record: ContinuityRecordV1 =
            serde_json::from_slice(&raw).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if canonicalize(&record).map_err(|_| ContinuityStoreError::InvalidRecord)? != raw
            || record != *expected_record
            || record.record_id != head_id
            || record.record_type != record_type
            || record.namespace != *namespace
            || record.scope != *scope
            || record.key_version != envelope_key_version
            || envelope_key_version != namespace.key_version
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        previous_root = Some(root);
        active_heads.push(record);
    }
    if active_heads.len() != count || actual_bytes != encrypted_bytes {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    Ok(active_heads)
}

fn canonical_blob<T: Serialize>(value: &T) -> Result<Vec<u8>, ContinuityStoreError> {
    let bytes = canonicalize(value).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if bytes.len() > MAX_TYPED_BLOB_BYTES {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    Ok(bytes)
}

fn decode_blob<T: DeserializeOwned + Serialize>(bytes: Vec<u8>) -> Result<T, ContinuityStoreError> {
    if bytes.len() > MAX_TYPED_BLOB_BYTES {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let value: T =
        serde_json::from_slice(&bytes).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if canonical_blob(&value)? != bytes {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    Ok(value)
}

fn parse_safe(value: i64) -> Result<SafeU53, ContinuityStoreError> {
    u64::try_from(value)
        .ok()
        .and_then(|value| SafeU53::new(value).ok())
        .ok_or(ContinuityStoreError::InvalidRecord)
}

fn lifecycle_name(value: RevisionLifecycle) -> &'static str {
    match value {
        RevisionLifecycle::Active => "active",
        RevisionLifecycle::Archived => "archived",
        RevisionLifecycle::Forgotten => "forgotten",
    }
}

fn purge_name(value: PurgeExecutionStatusV1) -> &'static str {
    match value {
        PurgeExecutionStatusV1::Authorized => "authorized",
        PurgeExecutionStatusV1::InProgress => "in_progress",
        PurgeExecutionStatusV1::Completed => "completed",
        PurgeExecutionStatusV1::Failed => "failed",
    }
}

fn load_generation(
    connection: &Connection,
    owner: &Hex64,
) -> Result<Option<StoredRevisionGenerationV1>, ContinuityStoreError> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let result = load_generation_in_snapshot(&transaction, owner)?;
    transaction
        .commit()
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    Ok(result)
}

fn load_generation_in_snapshot(
    connection: &Connection,
    owner: &Hex64,
) -> Result<Option<StoredRevisionGenerationV1>, ContinuityStoreError> {
    let meta_count = preflight_meta(connection, owner)?;
    let meta: Option<(String, i64, i64, i64, String)> = connection
        .query_row(
            "SELECT store_epoch, generation, authority_schema, active_root_key_version,
                    snapshot_fingerprint
             FROM continuity_authority_meta WHERE owner_pubkey = ?1
               AND typeof(store_epoch)='text' AND length(CAST(store_epoch AS BLOB))=36
               AND typeof(snapshot_fingerprint)='text'
               AND length(CAST(snapshot_fingerprint AS BLOB))=71",
            [owner.as_str()],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if usize::from(meta.is_some()) != meta_count {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    let Some((store_epoch, generation, authority_schema, active_key, fingerprint)) = meta else {
        if owner_has_unowned_state(connection, owner)? {
            return Err(ContinuityStoreError::AuthorityMigrationRequired);
        }
        return Ok(None);
    };
    let parsed_epoch =
        Uuid::parse_str(&store_epoch).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    if authority_schema != AUTHORITY_SCHEMA_V1
        || parsed_epoch.get_version_num() != 4
        || parsed_epoch.to_string() != store_epoch
    {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    let generation = parse_safe(generation)?;
    let token = RevisionAuthorityTokenV1 {
        owner_pubkey: owner.clone(),
        store_epoch,
        generation,
        authority_schema: AUTHORITY_SCHEMA_V1 as u16,
        active_root_key_version: parse_safe(active_key)?,
        snapshot_fingerprint: Sha256Ref::parse(fingerprint)
            .map_err(|_| ContinuityStoreError::InvalidRecord)?,
    };
    assert_only_generation(connection, owner, generation)?;
    let manifest = preflight_authority_bounds(connection, owner, generation)?;
    let snapshot = load_snapshot(connection, owner, generation, &manifest)?;
    validate_snapshot_owner(&snapshot, owner)?;
    let round_trip = RevisionLedger::from_snapshot(snapshot.clone())
        .map_err(map_continuity_error)?
        .export_snapshot()
        .map_err(map_continuity_error)?;
    if round_trip != snapshot
        || canonicalize(&round_trip).map_err(|_| ContinuityStoreError::InvalidRecord)?
            != canonicalize(&snapshot).map_err(|_| ContinuityStoreError::InvalidRecord)?
    {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    let actual = snapshot.fingerprint().map_err(map_continuity_error)?;
    if actual != token.snapshot_fingerprint {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    let owner_version: Option<i64> = connection
        .query_row(
            "SELECT active_key_version FROM continuity_owner_versions WHERE owner_pubkey = ?1",
            [owner.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if owner_version.and_then(|value| parse_safe(value).ok()) != Some(token.active_root_key_version)
    {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    Ok(Some(StoredRevisionGenerationV1 { token, snapshot }))
}

fn preflight_meta(connection: &Connection, owner: &Hex64) -> Result<usize, ContinuityStoreError> {
    let (count, malformed, bytes): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE
                        WHEN typeof(owner_pubkey)='text'
                         AND length(CAST(owner_pubkey AS BLOB))=64
                         AND typeof(store_epoch)='text'
                         AND length(CAST(store_epoch AS BLOB))=36
                         AND typeof(snapshot_fingerprint)='text'
                         AND length(CAST(snapshot_fingerprint AS BLOB))=71
                        THEN 0 ELSE 1 END),0),
                    COALESCE(SUM(length(CAST(owner_pubkey AS BLOB))
                               +length(CAST(store_epoch AS BLOB))
                               +length(CAST(snapshot_fingerprint AS BLOB))),0)
             FROM continuity_authority_meta WHERE owner_pubkey=?1",
            [owner.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if !(0..=1).contains(&count) || malformed != 0 || !(0..=171).contains(&bytes) {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    Ok(count as usize)
}

#[derive(Clone, Copy)]
enum SqlFieldBound {
    Text {
        minimum: usize,
        maximum: usize,
        nullable: bool,
    },
    Blob {
        maximum: usize,
        nullable: bool,
    },
}

#[derive(Default)]
struct AuthorityPreflightManifest {
    counts: BTreeMap<&'static str, usize>,
}

impl AuthorityPreflightManifest {
    fn count(&self, table: &'static str) -> Result<usize, ContinuityStoreError> {
        self.counts
            .get(table)
            .copied()
            .ok_or(ContinuityStoreError::InvalidRecord)
    }
}

fn text(minimum: usize, maximum: usize) -> SqlFieldBound {
    SqlFieldBound::Text {
        minimum,
        maximum,
        nullable: false,
    }
}

fn nullable_text(minimum: usize, maximum: usize) -> SqlFieldBound {
    SqlFieldBound::Text {
        minimum,
        maximum,
        nullable: true,
    }
}

fn blob(maximum: usize) -> SqlFieldBound {
    SqlFieldBound::Blob {
        maximum,
        nullable: false,
    }
}

fn preflight_table(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    table: &'static str,
    maximum_rows: usize,
    fields: &[(&str, SqlFieldBound)],
    generation_scoped: bool,
) -> Result<(usize, usize), ContinuityStoreError> {
    let byte_terms = fields
        .iter()
        .map(|(column, _)| format!("COALESCE(length(CAST({column} AS BLOB)),0)"))
        .collect::<Vec<_>>()
        .join("+");
    let malformed_terms = fields
        .iter()
        .map(|(column, bound)| match bound {
            SqlFieldBound::Text {
                minimum,
                maximum,
                nullable,
            } => format!(
                "CASE WHEN {column} IS NULL THEN {} WHEN typeof({column})='text'
                 AND length(CAST({column} AS BLOB)) BETWEEN {minimum} AND {maximum}
                 THEN 0 ELSE 1 END",
                usize::from(!nullable)
            ),
            SqlFieldBound::Blob { maximum, nullable } => format!(
                "CASE WHEN {column} IS NULL THEN {} WHEN typeof({column})='blob'
                 AND length({column}) BETWEEN 0 AND {maximum} THEN 0 ELSE 1 END",
                usize::from(!nullable)
            ),
        })
        .collect::<Vec<_>>()
        .join("+");
    let filter = if generation_scoped {
        "owner_pubkey=?1 AND authority_generation=?2"
    } else {
        "owner_pubkey=?1"
    };
    let sql = format!(
        "SELECT COUNT(*), COALESCE(SUM({byte_terms}),0),
                COALESCE(SUM({malformed_terms}),0)
         FROM {table} WHERE {filter}"
    );
    let (count, bytes, malformed): (i64, i64, i64) = if generation_scoped {
        connection.query_row(
            &sql,
            params![owner.as_str(), generation.get() as i64],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
    } else {
        connection.query_row(&sql, [owner.as_str()], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
    }
    .map_err(|_| ContinuityStoreError::Unavailable)?;
    if count < 0 || bytes < 0 || malformed != 0 {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    let count = usize::try_from(count).map_err(|_| ContinuityStoreError::SnapshotBoundExceeded)?;
    let bytes = usize::try_from(bytes).map_err(|_| ContinuityStoreError::SnapshotBoundExceeded)?;
    if count > maximum_rows {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    Ok((count, bytes))
}

fn preflight_authority_bounds(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
) -> Result<AuthorityPreflightManifest, ContinuityStoreError> {
    let protocol_len = luca_protocol::CONTINUITY_PROTOCOL.len();
    type SnapshotTableSpec = (
        &'static str,
        usize,
        Vec<(&'static str, SqlFieldBound)>,
        bool,
    );
    let specs: Vec<SnapshotTableSpec> = vec![
        (
            "continuity_records",
            MAX_REVISION_SNAPSHOT_RECORDS,
            vec![
                ("record_id", text(1, 128)),
                ("namespace_protocol", text(protocol_len, protocol_len)),
                ("owner_pubkey", text(64, 64)),
                ("namespace_kind", text(11, 16)),
                ("resident_pubkey", nullable_text(64, 64)),
                ("namespace_ref", text(71, 71)),
                ("scope_protocol", text(protocol_len, protocol_len)),
                ("scope_namespace_ref", text(71, 71)),
                ("scope_ref", text(71, 71)),
                ("source_id", nullable_text(1, 128)),
                ("project_id", nullable_text(1, 128)),
                ("room_id", nullable_text(1, 128)),
                ("conversation_id", nullable_text(1, 128)),
                ("record_type", text(1, 128)),
                ("predecessor_record_id", nullable_text(1, 128)),
                ("created_at", text(20, 20)),
                ("author_kind", text(1, 128)),
                ("nonce_b64", text(32, 32)),
                (
                    "envelope_json",
                    blob(luca_continuity::MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES),
                ),
            ],
            false,
        ),
        (
            "continuity_revision_lineages",
            MAX_REVISION_AUTHORITY_HEADS,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("namespace_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("scope_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("namespace_protocol", text(protocol_len, protocol_len)),
                ("namespace_kind", text(11, 16)),
                ("resident_pubkey", nullable_text(64, 64)),
                ("namespace_ref", text(71, 71)),
                ("scope_ref", text(71, 71)),
                ("source_id", nullable_text(1, 128)),
                ("project_id", nullable_text(1, 128)),
                ("room_id", nullable_text(1, 128)),
                ("conversation_id", nullable_text(1, 128)),
                ("retained_head_record_id", text(1, 128)),
                ("active_head_record_id", nullable_text(1, 128)),
                ("lifecycle", text(6, 9)),
                ("record_type", text(1, 128)),
                ("latest_mutation_domain", text(8, 8)),
                ("latest_mutation_key", text(71, 71)),
            ],
            true,
        ),
        (
            "continuity_revision_membership",
            MAX_REVISION_MEMBERS_PER_LEDGER,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("record_id", text(1, 128)),
            ],
            true,
        ),
        (
            "continuity_envelope_replacements",
            MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("replacement_json", blob(MAX_TYPED_BLOB_BYTES)),
            ],
            true,
        ),
        (
            "continuity_revision_artifacts",
            MAX_DERIVED_ARTIFACTS_PER_LEDGER,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("artifact_ref", text(71, 71)),
            ],
            true,
        ),
        (
            "continuity_idempotency_keys",
            MAX_REVISION_IDEMPOTENCY_ENTRIES + MAX_ARTIFACT_IDEMPOTENCY_ENTRIES,
            vec![
                ("idempotency_key", text(71, 71)),
                ("domain", text(8, 8)),
                ("lineage_root_id", text(1, 128)),
            ],
            true,
        ),
        (
            "continuity_revision_replay",
            MAX_REVISION_IDEMPOTENCY_ENTRIES,
            vec![
                ("idempotency_key", text(71, 71)),
                ("canonical_request_digest", text(71, 71)),
                ("binding_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("receipt_json", blob(MAX_TYPED_BLOB_BYTES)),
            ],
            true,
        ),
        (
            "continuity_artifact_replay",
            MAX_ARTIFACT_IDEMPOTENCY_ENTRIES,
            vec![
                ("idempotency_key", text(71, 71)),
                ("canonical_request_digest", text(71, 71)),
                ("binding_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("receipt_json", blob(MAX_TYPED_BLOB_BYTES)),
            ],
            true,
        ),
        (
            "continuity_revision_purges",
            MAX_REVISION_AUTHORITY_HEADS,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("status", text(6, 11)),
                ("plan_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("progress_receipt_json", blob(MAX_TYPED_BLOB_BYTES)),
                ("authorizing_revision_key", text(71, 71)),
            ],
            true,
        ),
        (
            "continuity_record_tombstones",
            MAX_REVISION_MEMBERS_PER_LEDGER,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("tombstone_json", blob(MAX_TYPED_BLOB_BYTES)),
            ],
            true,
        ),
        (
            "continuity_artifact_tombstones",
            MAX_DERIVED_ARTIFACTS_PER_LEDGER,
            vec![
                ("lineage_root_id", text(1, 128)),
                ("tombstone_json", blob(MAX_TYPED_BLOB_BYTES)),
            ],
            true,
        ),
        (
            "continuity_nonce_reservations",
            MAX_REVISION_SNAPSHOT_RECORDS
                + MAX_ENVELOPE_REPLACEMENTS_PER_LEDGER * 2
                + MAX_REVISION_MEMBERS_PER_LEDGER,
            vec![
                ("namespace_ref", text(71, 71)),
                ("nonce_b64", text(32, 32)),
                ("record_id", text(1, 128)),
                ("reservation_state", text(4, 7)),
            ],
            true,
        ),
    ];
    let mut manifest = AuthorityPreflightManifest::default();
    let mut aggregate_bytes = 0usize;
    let mut replay_bytes = 0usize;
    for (table, maximum, fields, generation_scoped) in specs {
        let (count, bytes) = preflight_table(
            connection,
            owner,
            generation,
            table,
            maximum,
            &fields,
            generation_scoped,
        )?;
        manifest.counts.insert(table, count);
        aggregate_bytes = aggregate_bytes
            .checked_add(bytes)
            .ok_or(ContinuityStoreError::SnapshotBoundExceeded)?;
        if matches!(
            table,
            "continuity_revision_replay" | "continuity_artifact_replay"
        ) {
            replay_bytes = replay_bytes
                .checked_add(bytes)
                .ok_or(ContinuityStoreError::SnapshotBoundExceeded)?;
        }
    }
    if aggregate_bytes > MAX_REVISION_SNAPSHOT_CANONICAL_BYTES
        || replay_bytes > MAX_REPLAY_BINDING_CANONICAL_BYTES_PER_LEDGER
    {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    require_group_count_bound(
        connection,
        "continuity_revision_membership",
        owner,
        generation,
        MAX_REVISION_MEMBERS_PER_LINEAGE,
    )?;
    require_group_count_bound(
        connection,
        "continuity_revision_artifacts",
        owner,
        generation,
        MAX_DERIVED_ARTIFACTS_PER_LINEAGE,
    )?;
    Ok(manifest)
}

fn require_group_count_bound(
    connection: &Connection,
    table: &str,
    owner: &Hex64,
    generation: SafeU53,
    maximum: usize,
) -> Result<(), ContinuityStoreError> {
    let sql = format!(
        "SELECT COALESCE(MAX(entry_count),0) FROM (
            SELECT COUNT(*) AS entry_count FROM {table}
            WHERE owner_pubkey=?1 AND authority_generation=?2 GROUP BY lineage_root_id
         )"
    );
    let count: i64 = connection
        .query_row(
            &sql,
            params![owner.as_str(), generation.get() as i64],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if count < 0 || count as usize > maximum {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    Ok(())
}

fn owner_has_unowned_state(
    connection: &Connection,
    owner: &Hex64,
) -> Result<bool, ContinuityStoreError> {
    for table in ["continuity_records", "continuity_owner_versions"]
        .into_iter()
        .chain(
            AUTHORITY_TABLES
                .iter()
                .copied()
                .filter(|name| *name != "continuity_authority_meta"),
        )
    {
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE owner_pubkey = ?1 LIMIT 1)");
        let exists: bool = connection
            .query_row(&sql, [owner.as_str()], |row| row.get(0))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if exists {
            return Ok(true);
        }
    }
    Ok(false)
}

fn assert_only_generation(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
) -> Result<(), ContinuityStoreError> {
    for table in AUTHORITY_TABLES
        .iter()
        .copied()
        .filter(|name| *name != "continuity_authority_meta")
    {
        let sql = format!(
            "SELECT EXISTS(SELECT 1 FROM {table}
             WHERE owner_pubkey = ?1 AND authority_generation != ?2 LIMIT 1)"
        );
        let mixed: bool = connection
            .query_row(
                &sql,
                params![owner.as_str(), generation.get() as i64],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if mixed {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
    }
    Ok(())
}

fn load_snapshot(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    manifest: &AuthorityPreflightManifest,
) -> Result<RevisionLedgerSnapshotV1, ContinuityStoreError> {
    let records = load_records(connection, owner, manifest.count("continuity_records")?)?;
    let mut lineages = load_lineages(
        connection,
        owner,
        generation,
        manifest.count("continuity_revision_lineages")?,
    )?;
    load_membership(
        connection,
        owner,
        generation,
        manifest.count("continuity_revision_membership")?,
        &mut lineages,
    )?;
    load_replacements(
        connection,
        owner,
        generation,
        manifest.count("continuity_envelope_replacements")?,
        &mut lineages,
    )?;
    load_artifacts(
        connection,
        owner,
        generation,
        manifest.count("continuity_revision_artifacts")?,
        &mut lineages,
    )?;
    load_purges(
        connection,
        owner,
        generation,
        manifest.count("continuity_revision_purges")?,
        manifest.count("continuity_record_tombstones")?,
        manifest.count("continuity_artifact_tombstones")?,
        &mut lineages,
    )?;
    let (revision_idempotency, artifact_idempotency) = load_replay(
        connection,
        owner,
        generation,
        manifest.count("continuity_idempotency_keys")?,
        manifest.count("continuity_revision_replay")?,
        manifest.count("continuity_artifact_replay")?,
    )?;
    let snapshot = RevisionLedgerSnapshotV1 {
        schema_version: luca_continuity::REVISION_LEDGER_SNAPSHOT_SCHEMA_V1,
        records,
        lineages: lineages.into_values().collect(),
        revision_idempotency,
        artifact_idempotency,
    };
    RevisionLedger::from_snapshot(snapshot.clone()).map_err(map_continuity_error)?;
    validate_latest_mutation_domains(
        connection,
        owner,
        generation,
        manifest.count("continuity_revision_lineages")?,
        &snapshot,
    )?;
    validate_nonce_reservations(
        connection,
        owner,
        generation,
        manifest.count("continuity_nonce_reservations")?,
        &snapshot,
    )?;
    Ok(snapshot)
}

fn validate_latest_mutation_domains(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    let mut expected = BTreeMap::<String, (&'static str, &str)>::new();
    for entry in &snapshot.revision_idempotency {
        expected.insert(
            entry.idempotency_key.as_str().to_owned(),
            ("revision", entry.receipt.lineage_root_id.as_str()),
        );
    }
    for entry in &snapshot.artifact_idempotency {
        if expected
            .insert(
                entry.idempotency_key.as_str().to_owned(),
                ("artifact", entry.receipt.lineage_root_id.as_str()),
            )
            .is_some()
        {
            return Err(ContinuityStoreError::ReplayConflict);
        }
    }
    let mut statement = connection
        .prepare(
            "SELECT lineage_root_id, latest_mutation_domain, latest_mutation_key
             FROM continuity_revision_lineages
             WHERE owner_pubkey=?1 AND authority_generation=?2",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut loaded_count = 0usize;
    for row in rows {
        let (root, domain, key) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        loaded_count += 1;
        if expected.get(&key).copied() != Some((domain.as_str(), root.as_str())) {
            return Err(ContinuityStoreError::ReplayConflict);
        }
    }
    require_loaded_count(expected_count, loaded_count)
}

fn load_records(
    connection: &Connection,
    owner: &Hex64,
    expected_count: usize,
) -> Result<Vec<ContinuityRecordV1>, ContinuityStoreError> {
    let (count, bytes): (i64, i64) = connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN typeof(envelope_json)='blob'
                    THEN length(envelope_json) ELSE 9223372036854775807 END),0)
             FROM continuity_records WHERE owner_pubkey = ?1",
            [owner.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if !(0..=MAX_REVISION_SNAPSHOT_RECORDS as i64).contains(&count)
        || !(0..=MAX_REVISION_SNAPSHOT_ENCODED_CIPHERTEXT_BYTES as i64).contains(&bytes)
    {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let mut statement = connection
        .prepare(
            "SELECT envelope_json FROM continuity_records
             WHERE owner_pubkey=?1 ORDER BY record_id",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows: Vec<ContinuityRecordV1> = statement
        .query_map([owner.as_str()], |row| row.get::<_, Vec<u8>>(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?
        .map(|row| {
            let raw = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
            if raw.len() > luca_continuity::MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
                return Err(ContinuityStoreError::SnapshotBoundExceeded);
            }
            let record: ContinuityRecordV1 =
                serde_json::from_slice(&raw).map_err(|_| ContinuityStoreError::InvalidRecord)?;
            if canonicalize(&record).map_err(|_| ContinuityStoreError::InvalidRecord)? != raw
                || !record_row_matches(connection, &record)?
            {
                return Err(ContinuityStoreError::InvalidRecord);
            }
            Ok(record)
        })
        .collect::<Result<Vec<_>, _>>()?;
    require_loaded_count(expected_count, rows.len())?;
    Ok(rows)
}

fn record_row_matches(
    connection: &Connection,
    record: &ContinuityRecordV1,
) -> Result<bool, ContinuityStoreError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM continuity_records
                WHERE record_id=?1 AND namespace_protocol=?2 AND owner_pubkey=?3
                  AND namespace_kind=?4 AND resident_pubkey IS ?5 AND namespace_ref=?6
                  AND namespace_key_version=?7 AND scope_protocol=?8
                  AND scope_namespace_ref=?9 AND scope_ref=?10 AND source_id IS ?11
                  AND project_id IS ?12 AND room_id IS ?13 AND conversation_id IS ?14
                  AND record_type=?15 AND revision=?16 AND predecessor_record_id IS ?17
                  AND created_at=?18 AND author_kind=?19 AND key_version=?20
                  AND nonce_b64=?21
            )",
            params![
                record.record_id.as_str(),
                record.namespace.protocol.as_str(),
                record.namespace.owner_pubkey.as_str(),
                match record.namespace.kind {
                    luca_protocol::ContinuityNamespaceKindV1::OwnerBrain => "owner_brain",
                    luca_protocol::ContinuityNamespaceKindV1::ResidentPrivate => "resident_private",
                },
                record
                    .namespace
                    .resident_pubkey
                    .as_ref()
                    .map(|value| value.as_str()),
                record.namespace.namespace_ref.as_str(),
                record.namespace.key_version.get() as i64,
                record.scope.protocol.as_str(),
                record.scope.namespace_ref.as_str(),
                record.scope.scope_ref.as_str(),
                record.scope.source_id.as_ref().map(|value| value.as_str()),
                record.scope.project_id.as_ref().map(|value| value.as_str()),
                record.scope.room_id.as_ref().map(|value| value.as_str()),
                record
                    .scope
                    .conversation_id
                    .as_ref()
                    .map(|value| value.as_str()),
                record.record_type.as_str(),
                record.revision.get() as i64,
                record
                    .predecessor_record_id
                    .as_ref()
                    .map(|value| value.as_str()),
                record.created_at.as_str(),
                record.author_kind.as_str(),
                record.key_version.get() as i64,
                record.nonce_b64.as_str(),
            ],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)
}

fn load_lineages(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
) -> Result<BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>, ContinuityStoreError> {
    let mut statement = connection
        .prepare(
            "SELECT lineage_root_id, namespace_json, scope_json, namespace_protocol,
                    namespace_kind, resident_pubkey, namespace_ref, scope_ref, source_id,
                    project_id, room_id, conversation_id, retained_head_record_id,
                    active_head_record_id, lifecycle, pinned_owner_correction, record_type,
                    lineage_envelope_key_version, latest_mutation_domain, latest_mutation_key
             FROM continuity_revision_lineages
             WHERE owner_pubkey=?1 AND authority_generation=?2 ORDER BY lineage_root_id",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
                row.get::<_, String>(12)?,
                row.get::<_, Option<String>>(13)?,
                row.get::<_, String>(14)?,
                row.get::<_, i64>(15)?,
                row.get::<_, String>(16)?,
                row.get::<_, i64>(17)?,
                row.get::<_, String>(18)?,
                row.get::<_, String>(19)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut result = BTreeMap::new();
    for row in rows {
        let (
            root,
            namespace_raw,
            scope_raw,
            namespace_protocol,
            namespace_kind,
            resident_pubkey,
            namespace_ref,
            scope_ref,
            source_id,
            project_id,
            room_id,
            conversation_id,
            head,
            active,
            lifecycle,
            pinned,
            record_type,
            version,
            latest_domain,
            key,
        ) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let namespace = decode_blob::<ContinuityNamespaceV1>(namespace_raw)?;
        let scope = decode_blob::<ContinuityScopeV1>(scope_raw)?;
        let expected_kind = match namespace.kind {
            luca_protocol::ContinuityNamespaceKindV1::OwnerBrain => "owner_brain",
            luca_protocol::ContinuityNamespaceKindV1::ResidentPrivate => "resident_private",
        };
        if namespace_protocol != namespace.protocol
            || namespace_kind != expected_kind
            || resident_pubkey.as_deref()
                != namespace
                    .resident_pubkey
                    .as_ref()
                    .map(|value| value.as_str())
            || namespace_ref != namespace.namespace_ref.as_str()
            || scope_ref != scope.scope_ref.as_str()
            || source_id.as_deref() != scope.source_id.as_ref().map(|value| value.as_str())
            || project_id.as_deref() != scope.project_id.as_ref().map(|value| value.as_str())
            || room_id.as_deref() != scope.room_id.as_ref().map(|value| value.as_str())
            || conversation_id.as_deref()
                != scope.conversation_id.as_ref().map(|value| value.as_str())
            || !matches!(latest_domain.as_str(), "revision" | "artifact")
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let lifecycle = match lifecycle.as_str() {
            "active" => RevisionLifecycle::Active,
            "archived" => RevisionLifecycle::Archived,
            "forgotten" => RevisionLifecycle::Forgotten,
            _ => return Err(ContinuityStoreError::InvalidRecord),
        };
        if !matches!(pinned, 0 | 1) {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let lineage = luca_continuity::RevisionLineageSnapshotV1 {
            namespace,
            scope,
            lineage_root_id: OpaqueId::parse(root.clone())
                .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            record_ids: Vec::new(),
            lineage_head_record_id: OpaqueId::parse(head)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            active_head_record_id: active
                .map(OpaqueId::parse)
                .transpose()
                .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            lifecycle,
            pinned_owner_correction: pinned == 1,
            record_type: OpaqueId::parse(record_type)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            lineage_envelope_key_version: parse_safe(version)?,
            envelope_replacements: Vec::new(),
            derived_artifact_refs: Vec::new(),
            authority_mutation_idempotency_key: Sha256Ref::parse(key)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            purge_execution: None,
        };
        if result.insert(root, lineage).is_some() {
            return Err(ContinuityStoreError::InvalidRecord);
        }
    }
    require_loaded_count(expected_count, result.len())?;
    Ok(result)
}

fn load_membership(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    lineages: &mut BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>,
) -> Result<(), ContinuityStoreError> {
    load_ordered_ids(
        connection,
        "continuity_revision_membership",
        "record_id",
        owner,
        generation,
        expected_count,
        |root, value| {
            lineages
                .get_mut(root)
                .ok_or(ContinuityStoreError::InvalidRecord)?
                .record_ids
                .push(OpaqueId::parse(value).map_err(|_| ContinuityStoreError::InvalidRecord)?);
            Ok(())
        },
    )
}

fn load_artifacts(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    lineages: &mut BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>,
) -> Result<(), ContinuityStoreError> {
    load_ordered_ids(
        connection,
        "continuity_revision_artifacts",
        "artifact_ref",
        owner,
        generation,
        expected_count,
        |root, value| {
            lineages
                .get_mut(root)
                .ok_or(ContinuityStoreError::InvalidRecord)?
                .derived_artifact_refs
                .push(Sha256Ref::parse(value).map_err(|_| ContinuityStoreError::InvalidRecord)?);
            Ok(())
        },
    )
}

fn load_ordered_ids<F>(
    connection: &Connection,
    table: &str,
    value_column: &str,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    mut consume: F,
) -> Result<(), ContinuityStoreError>
where
    F: FnMut(&str, String) -> Result<(), ContinuityStoreError>,
{
    let sql = format!(
        "SELECT lineage_root_id, ordinal, {value_column} FROM {table}
         WHERE owner_pubkey=?1 AND authority_generation=?2
         ORDER BY lineage_root_id, ordinal"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut next = BTreeMap::<String, i64>::new();
    let mut loaded_count = 0usize;
    for row in rows {
        let (root, ordinal, value) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        loaded_count += 1;
        let expected = next.entry(root.clone()).or_default();
        if ordinal != *expected {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        *expected += 1;
        consume(&root, value)?;
    }
    require_loaded_count(expected_count, loaded_count)
}

fn load_replacements(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    lineages: &mut BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>,
) -> Result<(), ContinuityStoreError> {
    let mut statement = connection
        .prepare(
            "SELECT lineage_root_id, ordinal, replacement_json
             FROM continuity_envelope_replacements
             WHERE owner_pubkey=?1 AND authority_generation=?2
             ORDER BY lineage_root_id, ordinal",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut next = BTreeMap::<String, i64>::new();
    let mut loaded_count = 0usize;
    for row in rows {
        let (root, ordinal, raw) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        loaded_count += 1;
        let expected = next.entry(root.clone()).or_default();
        if ordinal != *expected {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        *expected += 1;
        lineages
            .get_mut(&root)
            .ok_or(ContinuityStoreError::InvalidRecord)?
            .envelope_replacements
            .push(decode_blob::<EnvelopeReplacementV1>(raw)?);
    }
    require_loaded_count(expected_count, loaded_count)
}

fn load_purges(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_purge_count: usize,
    expected_record_tombstones: usize,
    expected_artifact_tombstones: usize,
    lineages: &mut BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>,
) -> Result<(), ContinuityStoreError> {
    let mut statement = connection
        .prepare(
            "SELECT lineage_root_id, status, plan_json, progress_receipt_json,
                    authorizing_revision_key
             FROM continuity_revision_purges
             WHERE owner_pubkey=?1 AND authority_generation=?2 ORDER BY lineage_root_id",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut loaded_count = 0usize;
    for row in rows {
        let (root, status, plan, receipt, authorizing_key) =
            row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        loaded_count += 1;
        let status = match status.as_str() {
            "authorized" => PurgeExecutionStatusV1::Authorized,
            "in_progress" => PurgeExecutionStatusV1::InProgress,
            "completed" => PurgeExecutionStatusV1::Completed,
            "failed" => PurgeExecutionStatusV1::Failed,
            _ => return Err(ContinuityStoreError::InvalidRecord),
        };
        let lineage = lineages
            .get_mut(&root)
            .ok_or(ContinuityStoreError::InvalidRecord)?;
        if lineage.purge_execution.is_some()
            || authorizing_key != lineage.authority_mutation_idempotency_key.as_str()
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        lineage.purge_execution = Some(PurgeExecutionStateV1 {
            status,
            plan: decode_blob(plan)?,
            record_tombstones: Vec::new(),
            artifact_tombstones: Vec::new(),
            progress_receipt: decode_blob(receipt)?,
        });
    }
    require_loaded_count(expected_purge_count, loaded_count)?;
    load_tombstones::<PurgedRecordTombstoneV1, _>(
        connection,
        "continuity_record_tombstones",
        owner,
        generation,
        expected_record_tombstones,
        |purge, value| purge.record_tombstones.push(value),
        lineages,
    )?;
    load_tombstones::<PurgedArtifactTombstoneV1, _>(
        connection,
        "continuity_artifact_tombstones",
        owner,
        generation,
        expected_artifact_tombstones,
        |purge, value| purge.artifact_tombstones.push(value),
        lineages,
    )
}

fn load_tombstones<T, F>(
    connection: &Connection,
    table: &str,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    mut consume: F,
    lineages: &mut BTreeMap<String, luca_continuity::RevisionLineageSnapshotV1>,
) -> Result<(), ContinuityStoreError>
where
    T: DeserializeOwned + Serialize,
    F: FnMut(&mut PurgeExecutionStateV1, T),
{
    let sql = format!(
        "SELECT lineage_root_id, ordinal, tombstone_json FROM {table}
         WHERE owner_pubkey=?1 AND authority_generation=?2
         ORDER BY lineage_root_id, ordinal"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut next = BTreeMap::<String, i64>::new();
    let mut loaded_count = 0usize;
    for row in rows {
        let (root, ordinal, raw) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        loaded_count += 1;
        let expected = next.entry(root.clone()).or_default();
        if ordinal != *expected {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        *expected += 1;
        let purge = lineages
            .get_mut(&root)
            .and_then(|lineage| lineage.purge_execution.as_mut())
            .ok_or(ContinuityStoreError::InvalidRecord)?;
        consume(purge, decode_blob(raw)?);
    }
    require_loaded_count(expected_count, loaded_count)
}

fn load_replay(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_registry_count: usize,
    expected_revision_count: usize,
    expected_artifact_count: usize,
) -> Result<
    (
        Vec<luca_continuity::RevisionIdempotencySnapshotV1>,
        Vec<luca_continuity::ArtifactIdempotencySnapshotV1>,
    ),
    ContinuityStoreError,
> {
    let mut registry = BTreeMap::<String, (String, String)>::new();
    let mut statement = connection
        .prepare(
            "SELECT idempotency_key, domain, lineage_root_id FROM continuity_idempotency_keys
             WHERE owner_pubkey=?1 AND authority_generation=?2 ORDER BY idempotency_key",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut registry_count = 0usize;
    for row in statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?
    {
        let (key, domain, root) = row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        registry_count += 1;
        if registry.insert(key, (domain, root)).is_some() {
            return Err(ContinuityStoreError::ReplayConflict);
        }
    }
    require_loaded_count(expected_registry_count, registry_count)?;
    let revision = load_replay_domain(
        connection,
        owner,
        generation,
        "revision",
        expected_revision_count,
    )?;
    let artifact = load_replay_domain(
        connection,
        owner,
        generation,
        "artifact",
        expected_artifact_count,
    )?;
    let mut seen = BTreeSet::new();
    let revision = revision
        .into_iter()
        .map(|(key, digest, binding, receipt)| {
            let Some((domain, root)) = registry.get(&key) else {
                return Err(ContinuityStoreError::ReplayConflict);
            };
            let binding: luca_continuity::RevisionReplayBindingV1 = decode_blob(binding)?;
            let receipt: RevisionReceipt = decode_blob(receipt)?;
            if domain != "revision"
                || root != receipt.lineage_root_id.as_str()
                || !seen.insert(key.clone())
            {
                return Err(ContinuityStoreError::ReplayConflict);
            }
            Ok(luca_continuity::RevisionIdempotencySnapshotV1 {
                idempotency_key: Sha256Ref::parse(key)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                canonical_request_digest: Sha256Ref::parse(digest)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                replay_binding: binding,
                receipt,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let artifact = artifact
        .into_iter()
        .map(|(key, digest, binding, receipt)| {
            let Some((domain, root)) = registry.get(&key) else {
                return Err(ContinuityStoreError::ReplayConflict);
            };
            let binding: luca_continuity::ArtifactReplayBindingV1 = decode_blob(binding)?;
            let receipt: ArtifactRegistrationReceipt = decode_blob(receipt)?;
            if domain != "artifact"
                || root != receipt.lineage_root_id.as_str()
                || !seen.insert(key.clone())
            {
                return Err(ContinuityStoreError::ReplayConflict);
            }
            Ok(luca_continuity::ArtifactIdempotencySnapshotV1 {
                idempotency_key: Sha256Ref::parse(key)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                canonical_request_digest: Sha256Ref::parse(digest)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                replay_binding: binding,
                receipt,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if seen.len() != registry.len() {
        return Err(ContinuityStoreError::ReplayConflict);
    }
    Ok((revision, artifact))
}

type RawReplayRow = (String, String, Vec<u8>, Vec<u8>);

fn load_replay_domain(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    domain: &str,
    expected_count: usize,
) -> Result<Vec<RawReplayRow>, ContinuityStoreError> {
    let table = if domain == "revision" {
        "continuity_revision_replay"
    } else {
        "continuity_artifact_replay"
    };
    let sql = format!(
        "SELECT idempotency_key, canonical_request_digest, binding_json, receipt_json
         FROM {table} WHERE owner_pubkey=?1 AND authority_generation=?2 ORDER BY idempotency_key"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows: Vec<RawReplayRow> = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?
        .map(|row| row.map_err(|_| ContinuityStoreError::InvalidRecord))
        .collect::<Result<Vec<_>, _>>()?;
    require_loaded_count(expected_count, rows.len())?;
    Ok(rows)
}

fn require_loaded_count(expected: usize, actual: usize) -> Result<(), ContinuityStoreError> {
    if expected == actual {
        Ok(())
    } else {
        Err(ContinuityStoreError::CompareAndSwapConflict)
    }
}

fn persist_transition(
    transaction: &Transaction<'_>,
    expectation: &AuthorityExpectationV1,
    current: Option<&StoredRevisionGenerationV1>,
    active_root_key_version: SafeU53,
    snapshot: &RevisionLedgerSnapshotV1,
    replace_records: bool,
    fresh_epoch: bool,
) -> Result<RevisionAuthorityTokenV1, ContinuityStoreError> {
    require_expectation(expectation, current)?;
    let owner = expectation.owner();
    validate_snapshot_owner(snapshot, owner)?;
    let fingerprint = snapshot.fingerprint().map_err(map_continuity_error)?;
    let generation_value = match current {
        Some(current) => current.token.generation.get().checked_add(1),
        None => Some(1),
    }
    .and_then(|value| SafeU53::new(value).ok())
    .ok_or(ContinuityStoreError::CompareAndSwapConflict)?;
    let epoch = match (fresh_epoch, current) {
        (false, Some(current)) => current.token.store_epoch.clone(),
        _ => Uuid::new_v4().to_string(),
    };

    reconcile_records(transaction, owner, snapshot, replace_records)?;
    clear_authority_rows(transaction, owner)?;
    persist_snapshot_rows(transaction, owner, generation_value, snapshot)?;
    transaction
        .execute(
            "INSERT INTO continuity_owner_versions(owner_pubkey,active_key_version)
             VALUES (?1,?2) ON CONFLICT(owner_pubkey) DO UPDATE
             SET active_key_version=excluded.active_key_version",
            params![owner.as_str(), active_root_key_version.get() as i64],
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;

    let changed = match current {
        Some(current) => transaction
            .execute(
                "UPDATE continuity_authority_meta
                 SET store_epoch=?2,generation=?3,authority_schema=?4,
                     active_root_key_version=?5,snapshot_fingerprint=?6
                 WHERE owner_pubkey=?1 AND store_epoch=?7 AND generation=?8
                   AND authority_schema=?9 AND active_root_key_version=?10
                   AND snapshot_fingerprint=?11",
                params![
                    owner.as_str(),
                    epoch,
                    generation_value.get() as i64,
                    AUTHORITY_SCHEMA_V1,
                    active_root_key_version.get() as i64,
                    fingerprint.as_str(),
                    current.token.store_epoch,
                    current.token.generation.get() as i64,
                    current.token.authority_schema as i64,
                    current.token.active_root_key_version.get() as i64,
                    current.token.snapshot_fingerprint.as_str(),
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?,
        None => transaction
            .execute(
                "INSERT INTO continuity_authority_meta(
                    owner_pubkey,store_epoch,generation,authority_schema,
                    active_root_key_version,snapshot_fingerprint
                 ) VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    owner.as_str(),
                    epoch,
                    generation_value.get() as i64,
                    AUTHORITY_SCHEMA_V1,
                    active_root_key_version.get() as i64,
                    fingerprint.as_str(),
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?,
    };
    if changed != 1 {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    Ok(RevisionAuthorityTokenV1 {
        owner_pubkey: owner.clone(),
        store_epoch: epoch,
        generation: generation_value,
        authority_schema: AUTHORITY_SCHEMA_V1 as u16,
        active_root_key_version,
        snapshot_fingerprint: fingerprint,
    })
}

fn validate_snapshot_owner(
    snapshot: &RevisionLedgerSnapshotV1,
    owner: &Hex64,
) -> Result<(), ContinuityStoreError> {
    RevisionLedger::from_snapshot(snapshot.clone()).map_err(map_continuity_error)?;
    if snapshot
        .records
        .iter()
        .any(|record| &record.namespace.owner_pubkey != owner)
        || snapshot
            .lineages
            .iter()
            .any(|lineage| &lineage.namespace.owner_pubkey != owner)
    {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    Ok(())
}

fn reconcile_records(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    snapshot: &RevisionLedgerSnapshotV1,
    replace: bool,
) -> Result<(), ContinuityStoreError> {
    let candidate: BTreeMap<_, _> = snapshot
        .records
        .iter()
        .map(|record| (record.record_id.as_str(), record))
        .collect();
    let allowed_purged: BTreeSet<_> = snapshot
        .lineages
        .iter()
        .filter_map(|lineage| lineage.purge_execution.as_ref())
        .filter(|purge| purge.status == PurgeExecutionStatusV1::Completed)
        .flat_map(|purge| {
            purge
                .record_tombstones
                .iter()
                .map(|value| value.record_id.as_str())
        })
        .collect();
    let mut statement = transaction
        .prepare("SELECT record_id,envelope_json FROM continuity_records WHERE owner_pubkey=?1")
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let existing = statement
        .query_map([owner.as_str()], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    drop(statement);
    for (record_id, raw) in existing {
        if let Some(record) = candidate.get(record_id.as_str()) {
            if canonicalize(record).map_err(|_| ContinuityStoreError::InvalidRecord)? != raw {
                if !replace {
                    return Err(ContinuityStoreError::ReplayConflict);
                }
                transaction
                    .execute(
                        "DELETE FROM continuity_records WHERE record_id=?1",
                        [&record_id],
                    )
                    .map_err(|_| ContinuityStoreError::Unavailable)?;
            }
        } else if replace || allowed_purged.contains(record_id.as_str()) {
            transaction
                .execute(
                    "DELETE FROM continuity_records WHERE record_id=?1",
                    [&record_id],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
        } else {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
    }
    for record in &snapshot.records {
        let present: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_records WHERE record_id=?1)",
                [record.record_id.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if !present {
            let encoded = canonicalize(record).map_err(|_| ContinuityStoreError::InvalidRecord)?;
            insert_record(transaction, record, &encoded)?;
        }
    }
    Ok(())
}

fn clear_authority_rows(
    transaction: &Transaction<'_>,
    owner: &Hex64,
) -> Result<(), ContinuityStoreError> {
    for table in AUTHORITY_TABLES
        .iter()
        .copied()
        .filter(|name| *name != "continuity_authority_meta")
    {
        let sql = format!("DELETE FROM {table} WHERE owner_pubkey=?1");
        transaction
            .execute(&sql, [owner.as_str()])
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    Ok(())
}

fn persist_snapshot_rows(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    generation: SafeU53,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    let mut registry = BTreeMap::<String, (&str, &str)>::new();
    for entry in &snapshot.revision_idempotency {
        registry.insert(
            entry.idempotency_key.as_str().to_owned(),
            ("revision", entry.receipt.lineage_root_id.as_str()),
        );
    }
    for entry in &snapshot.artifact_idempotency {
        if registry
            .insert(
                entry.idempotency_key.as_str().to_owned(),
                ("artifact", entry.receipt.lineage_root_id.as_str()),
            )
            .is_some()
        {
            return Err(ContinuityStoreError::ReplayConflict);
        }
    }
    for lineage in &snapshot.lineages {
        let (latest_domain, _) = registry
            .get(lineage.authority_mutation_idempotency_key.as_str())
            .ok_or(ContinuityStoreError::ReplayConflict)?;
        transaction.execute(
            "INSERT INTO continuity_revision_lineages(
                owner_pubkey,authority_generation,lineage_root_id,namespace_json,scope_json,
                namespace_protocol,namespace_kind,resident_pubkey,namespace_ref,scope_ref,
                source_id,project_id,room_id,conversation_id,retained_head_record_id,
                active_head_record_id,lifecycle,pinned_owner_correction,record_type,
                lineage_envelope_key_version,latest_mutation_domain,latest_mutation_key
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            params![
                owner.as_str(), generation.get() as i64, lineage.lineage_root_id.as_str(),
                canonical_blob(&lineage.namespace)?, canonical_blob(&lineage.scope)?,
                lineage.namespace.protocol,
                match lineage.namespace.kind { luca_protocol::ContinuityNamespaceKindV1::OwnerBrain => "owner_brain", luca_protocol::ContinuityNamespaceKindV1::ResidentPrivate => "resident_private" },
                lineage.namespace.resident_pubkey.as_ref().map(|value| value.as_str()),
                lineage.namespace.namespace_ref.as_str(), lineage.scope.scope_ref.as_str(),
                lineage.scope.source_id.as_ref().map(|value| value.as_str()),
                lineage.scope.project_id.as_ref().map(|value| value.as_str()),
                lineage.scope.room_id.as_ref().map(|value| value.as_str()),
                lineage.scope.conversation_id.as_ref().map(|value| value.as_str()),
                lineage.lineage_head_record_id.as_str(),
                lineage.active_head_record_id.as_ref().map(|value| value.as_str()),
                lifecycle_name(lineage.lifecycle), i64::from(lineage.pinned_owner_correction),
                lineage.record_type.as_str(), lineage.lineage_envelope_key_version.get() as i64,
                latest_domain, lineage.authority_mutation_idempotency_key.as_str(),
            ],
        ).map_err(|_| ContinuityStoreError::Unavailable)?;
        for (ordinal, record_id) in lineage.record_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO continuity_revision_membership VALUES (?1,?2,?3,?4,?5)",
                    params![
                        owner.as_str(),
                        generation.get() as i64,
                        lineage.lineage_root_id.as_str(),
                        ordinal as i64,
                        record_id.as_str()
                    ],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
        }
        for (ordinal, replacement) in lineage.envelope_replacements.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO continuity_envelope_replacements VALUES (?1,?2,?3,?4,?5)",
                    params![
                        owner.as_str(),
                        generation.get() as i64,
                        lineage.lineage_root_id.as_str(),
                        ordinal as i64,
                        canonical_blob(replacement)?
                    ],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
        }
        for (ordinal, artifact) in lineage.derived_artifact_refs.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO continuity_revision_artifacts VALUES (?1,?2,?3,?4,?5)",
                    params![
                        owner.as_str(),
                        generation.get() as i64,
                        lineage.lineage_root_id.as_str(),
                        ordinal as i64,
                        artifact.as_str()
                    ],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
        }
        if let Some(purge) = &lineage.purge_execution {
            transaction
                .execute(
                    "INSERT INTO continuity_revision_purges VALUES (?1,?2,?3,?4,?5,?6,?7)",
                    params![
                        owner.as_str(),
                        generation.get() as i64,
                        lineage.lineage_root_id.as_str(),
                        purge_name(purge.status),
                        canonical_blob(&purge.plan)?,
                        canonical_blob(&purge.progress_receipt)?,
                        lineage.authority_mutation_idempotency_key.as_str()
                    ],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            for (ordinal, tombstone) in purge.record_tombstones.iter().enumerate() {
                transaction
                    .execute(
                        "INSERT INTO continuity_record_tombstones VALUES (?1,?2,?3,?4,?5)",
                        params![
                            owner.as_str(),
                            generation.get() as i64,
                            lineage.lineage_root_id.as_str(),
                            ordinal as i64,
                            canonical_blob(tombstone)?
                        ],
                    )
                    .map_err(|_| ContinuityStoreError::Unavailable)?;
            }
            for (ordinal, tombstone) in purge.artifact_tombstones.iter().enumerate() {
                transaction
                    .execute(
                        "INSERT INTO continuity_artifact_tombstones VALUES (?1,?2,?3,?4,?5)",
                        params![
                            owner.as_str(),
                            generation.get() as i64,
                            lineage.lineage_root_id.as_str(),
                            ordinal as i64,
                            canonical_blob(tombstone)?
                        ],
                    )
                    .map_err(|_| ContinuityStoreError::Unavailable)?;
            }
        }
    }
    for (key, (domain, root)) in &registry {
        transaction
            .execute(
                "INSERT INTO continuity_idempotency_keys VALUES (?1,?2,?3,?4,?5)",
                params![owner.as_str(), generation.get() as i64, key, domain, root],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    for entry in &snapshot.revision_idempotency {
        transaction
            .execute(
                "INSERT INTO continuity_revision_replay VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    owner.as_str(),
                    generation.get() as i64,
                    entry.idempotency_key.as_str(),
                    entry.canonical_request_digest.as_str(),
                    canonical_blob(&entry.replay_binding)?,
                    canonical_blob(&entry.receipt)?
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    for entry in &snapshot.artifact_idempotency {
        transaction
            .execute(
                "INSERT INTO continuity_artifact_replay VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    owner.as_str(),
                    generation.get() as i64,
                    entry.idempotency_key.as_str(),
                    entry.canonical_request_digest.as_str(),
                    canonical_blob(&entry.replay_binding)?,
                    canonical_blob(&entry.receipt)?
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    persist_nonce_reservations(transaction, owner, generation, snapshot)
}

fn persist_nonce_reservations(
    transaction: &Transaction<'_>,
    owner: &Hex64,
    generation: SafeU53,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    for ((namespace_ref, key_version, nonce), (record_id, state)) in
        expected_nonce_reservations(snapshot)?
    {
        transaction
            .execute(
                "INSERT INTO continuity_nonce_reservations VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![
                    owner.as_str(),
                    generation.get() as i64,
                    namespace_ref,
                    key_version as i64,
                    nonce,
                    record_id,
                    state
                ],
            )
            .map_err(|_| ContinuityStoreError::NonceCollision)?;
    }
    Ok(())
}

type NonceReservationMap = BTreeMap<(String, u64, String), (String, &'static str)>;

fn expected_nonce_reservations(
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<NonceReservationMap, ContinuityStoreError> {
    let mut reservations = NonceReservationMap::new();
    for record in &snapshot.records {
        if reservations
            .insert(
                (
                    record.namespace.namespace_ref.as_str().to_owned(),
                    record.key_version.get(),
                    record.nonce_b64.clone(),
                ),
                (record.record_id.as_str().to_owned(), "live"),
            )
            .is_some()
        {
            return Err(ContinuityStoreError::NonceCollision);
        }
    }
    for lineage in &snapshot.lineages {
        for replacement in &lineage.envelope_replacements {
            for key in [
                (
                    lineage.namespace.namespace_ref.as_str().to_owned(),
                    replacement.original_key_version.get(),
                    replacement.original_nonce_b64.clone(),
                ),
                (
                    lineage.namespace.namespace_ref.as_str().to_owned(),
                    replacement.replacement_key_version.get(),
                    replacement.replacement_nonce_b64.clone(),
                ),
            ] {
                if let Some((existing_record, _)) = reservations.get(&key) {
                    if existing_record != replacement.record_id.as_str() {
                        return Err(ContinuityStoreError::NonceCollision);
                    }
                } else {
                    reservations
                        .insert(key, (replacement.record_id.as_str().to_owned(), "retired"));
                }
            }
        }
        if let Some(purge) = &lineage.purge_execution {
            for tombstone in &purge.record_tombstones {
                let key = (
                    tombstone.namespace_ref.as_str().to_owned(),
                    tombstone.key_version.get(),
                    tombstone.nonce_b64.clone(),
                );
                if let Some((existing_record, _)) = reservations.get(&key) {
                    if existing_record != tombstone.record_id.as_str() {
                        return Err(ContinuityStoreError::NonceCollision);
                    }
                }
                reservations.insert(key, (tombstone.record_id.as_str().to_owned(), "purged"));
            }
        }
    }
    Ok(reservations)
}

fn validate_nonce_reservations(
    connection: &Connection,
    owner: &Hex64,
    generation: SafeU53,
    expected_count: usize,
    snapshot: &RevisionLedgerSnapshotV1,
) -> Result<(), ContinuityStoreError> {
    let expected = expected_nonce_reservations(snapshot)?;
    let mut statement = connection
        .prepare(
            "SELECT namespace_ref,key_version,nonce_b64,record_id,reservation_state
             FROM continuity_nonce_reservations
             WHERE owner_pubkey=?1 AND authority_generation=?2
             ORDER BY namespace_ref,key_version,nonce_b64",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = statement
        .query_map(params![owner.as_str(), generation.get() as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut actual = BTreeMap::new();
    for row in rows {
        let (namespace_ref, version, nonce, record_id, state) =
            row.map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let state = match state.as_str() {
            "live" => "live",
            "retired" => "retired",
            "purged" => "purged",
            _ => return Err(ContinuityStoreError::InvalidRecord),
        };
        let key = (namespace_ref, parse_safe(version)?.get(), nonce);
        if actual.insert(key, (record_id, state)).is_some() {
            return Err(ContinuityStoreError::NonceCollision);
        }
    }
    require_loaded_count(expected_count, actual.len())?;
    if actual != expected {
        return Err(ContinuityStoreError::NonceCollision);
    }
    Ok(())
}

#[cfg(test)]
#[path = "continuity_revision_authority_tests/mod.rs"]
mod continuity_revision_authority_tests;

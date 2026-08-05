//! Trusted, encrypted SQLite persistence for G2 continuity envelopes.
//!
//! This module stores only validated encrypted envelopes and body-free routing
//! metadata. It deliberately does not decrypt records: callers must treat every
//! load as structural and unauthenticated until the encrypted envelope is later
//! authenticated with its exact derived namespace key.

use std::{
    fmt, fs,
    io::Read,
    path::{Path, PathBuf},
};

use luca_continuity::{
    canonical_record_aad, NamespaceKey, NamespaceScope, RecordWriteOutcome,
    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES,
};
use luca_protocol::{
    canonicalize, ContinuityNamespaceKindV1, ContinuityRecordV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref,
};
use rusqlite::{params, Connection, ErrorCode, OpenFlags, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

use super::continuity_key_custody::ContinuityKeyCustodyStatus;

const STORE_DIRECTORY: &str = "continuity";
const STORE_FILENAME: &str = "continuity-v1.sqlite3";
const APPLICATION_ID: i64 = 0x4c55_4341; // "LUCA"
const SCHEMA_VERSION: i64 = 4;
const PREVIOUS_SCHEMA_VERSION: i64 = 3;
const LEGACY_SCHEMA_VERSION_V2: i64 = 2;
const LEGACY_SCHEMA_VERSION: i64 = 1;
pub(crate) const MAX_CONTINUITY_SNAPSHOT_RECORDS: usize = 100_000;
pub(crate) const MAX_CONTINUITY_SNAPSHOT_BYTES: usize = 128 * 1024 * 1024;
const CREATE_TABLE_SQL: &str = "CREATE TABLE continuity_records (
    record_id TEXT PRIMARY KEY NOT NULL,
    namespace_protocol TEXT NOT NULL,
    owner_pubkey TEXT NOT NULL,
    namespace_kind TEXT NOT NULL CHECK(namespace_kind IN ('owner_brain', 'resident_private')),
    resident_pubkey TEXT,
    namespace_ref TEXT NOT NULL,
    namespace_key_version INTEGER NOT NULL,
    scope_protocol TEXT NOT NULL,
    scope_namespace_ref TEXT NOT NULL,
    scope_ref TEXT NOT NULL,
    source_id TEXT,
    project_id TEXT,
    room_id TEXT,
    conversation_id TEXT,
    record_type TEXT NOT NULL,
    revision INTEGER NOT NULL,
    predecessor_record_id TEXT,
    created_at TEXT NOT NULL,
    author_kind TEXT NOT NULL,
    key_version INTEGER NOT NULL,
    nonce_b64 TEXT NOT NULL,
    envelope_json BLOB NOT NULL,
    UNIQUE(namespace_ref, key_version, nonce_b64)
)";
const CREATE_SCOPE_INDEX_SQL: &str =
    "CREATE INDEX continuity_records_exact_scope ON continuity_records(
    namespace_protocol, owner_pubkey, namespace_kind, resident_pubkey,
    namespace_ref, namespace_key_version, scope_protocol, scope_namespace_ref,
    scope_ref, source_id, project_id, room_id, conversation_id, created_at, record_id
)";
const CREATE_OWNER_VERSION_TABLE_SQL: &str = "CREATE TABLE continuity_owner_versions (
    owner_pubkey TEXT PRIMARY KEY NOT NULL,
    active_key_version INTEGER NOT NULL CHECK(active_key_version > 0)
)";
const CREATE_ROTATION_JOURNAL_TABLE_SQL: &str = "CREATE TABLE continuity_rotation_journals (
    owner_pubkey TEXT PRIMARY KEY NOT NULL,
    rotation_id TEXT NOT NULL,
    envelope_json BLOB NOT NULL
)";
const CREATE_ROTATION_RECEIPT_TABLE_SQL: &str = "CREATE TABLE continuity_rotation_receipts (
    owner_pubkey TEXT NOT NULL,
    rotation_id TEXT NOT NULL,
    request_sha256 TEXT NOT NULL,
    envelope_json BLOB NOT NULL,
    PRIMARY KEY(owner_pubkey, rotation_id)
)";
const CREATE_SOURCE_MAPPING_TABLE_SQL: &str = "CREATE TABLE continuity_source_mappings (
    owner_pubkey TEXT NOT NULL,
    mapping_ref TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    resident_pubkey TEXT,
    PRIMARY KEY(owner_pubkey, mapping_ref)
)";

/// Whether continuity key custody permits opening the encrypted local store.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityStoreCustody {
    Ready,
    Locked,
    Unavailable,
    Corrupt,
}

impl From<ContinuityKeyCustodyStatus> for ContinuityStoreCustody {
    fn from(status: ContinuityKeyCustodyStatus) -> Self {
        match status {
            ContinuityKeyCustodyStatus::Ready => Self::Ready,
            ContinuityKeyCustodyStatus::Locked => Self::Locked,
            ContinuityKeyCustodyStatus::Unavailable => Self::Unavailable,
            ContinuityKeyCustodyStatus::Corrupt => Self::Corrupt,
        }
    }
}

/// Body-free reason continuity persistence was not opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityStoreDegradedReason {
    KeyLocked,
    KeyUnavailable,
    KeyCorrupt,
    /// Legacy encrypted rows lack the body-free authority needed for safe
    /// restart hydration. D30 forbids inferring that missing history.
    AuthorityMigrationRequired,
}

/// Store opening never changes messaging availability. A non-ready key custody
/// result yields this body-free degraded state before any directory or database
/// operation occurs.
pub(crate) enum ContinuityStoreOpen {
    Ready(ContinuityStore),
    Degraded(ContinuityStoreDegradedReason),
}

impl fmt::Debug for ContinuityStoreOpen {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(_) => formatter.write_str("ContinuityStoreOpen::Ready"),
            Self::Degraded(reason) => formatter
                .debug_tuple("ContinuityStoreOpen::Degraded")
                .field(reason)
                .finish(),
        }
    }
}

/// Body-free store error. It never retains SQL content, encrypted payloads, or
/// an operating-system path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityStoreError {
    Unavailable,
    SchemaIncompatible,
    InvalidRecord,
    ReplayConflict,
    NonceCollision,
    LifecycleConflict,
    CompareAndSwapConflict,
    SnapshotBoundExceeded,
    AuthorityMigrationRequired,
}

/// One bounded encrypted row selected from a stable SQLite snapshot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityStoredEnvelope {
    pub(crate) rowid: i64,
    pub(crate) envelope_sha256: Hex64,
    pub(crate) record: ContinuityRecordV1,
}

/// Consistent ciphertext-only owner snapshot used by rotation and protected backup.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuityEncryptedSnapshot {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) active_key_version: SafeU53,
    pub(crate) snapshot_boundary: i64,
    pub(crate) records: Vec<ContinuityStoredEnvelope>,
    pub(crate) source_mappings: Vec<ContinuitySourceMapping>,
}

/// Exact encrypted-row replacement used only by authenticated key rotation.
pub(crate) struct ContinuityRotationReplacement {
    pub(crate) rowid: i64,
    pub(crate) expected_envelope_sha256: Hex64,
    pub(crate) expected: ContinuityRecordV1,
    pub(crate) replacement: ContinuityRecordV1,
}

/// One validated body-free import/source mapping persisted with restore.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ContinuitySourceMapping {
    pub(crate) mapping_ref: Sha256Ref,
    pub(crate) source_ref: Sha256Ref,
    pub(crate) resident_pubkey: Option<Hex64>,
}

/// Store-side destination classification used before any restore state write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityRestoreDestination {
    Empty,
    ExactOwner,
}

/// Body-free diagnostic for a malformed persisted envelope that was skipped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContinuityStoreDiagnostic {
    CorruptEnvelopeSkipped,
    OversizedEnvelopeSkipped,
}

/// An encrypted SQLite continuity store. All returned records are structural
/// only and must be authenticated before any record can participate in recall.
pub(crate) struct ContinuityStore {
    pub(super) connection: Connection,
    path: PathBuf,
    diagnostics: Vec<ContinuityStoreDiagnostic>,
}

impl fmt::Debug for ContinuityStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ContinuityStore { path: [REDACTED], diagnostics: body-free }")
    }
}

impl ContinuityStore {
    /// Open the dedicated app-data continuity database only while key custody
    /// is ready. This performs no key acquisition and no record decryption.
    pub(crate) fn open(
        app_data_dir: &Path,
        custody: ContinuityStoreCustody,
    ) -> Result<ContinuityStoreOpen, ContinuityStoreError> {
        let degraded = match custody {
            ContinuityStoreCustody::Ready => None,
            ContinuityStoreCustody::Locked => Some(ContinuityStoreDegradedReason::KeyLocked),
            ContinuityStoreCustody::Unavailable => {
                Some(ContinuityStoreDegradedReason::KeyUnavailable)
            }
            ContinuityStoreCustody::Corrupt => Some(ContinuityStoreDegradedReason::KeyCorrupt),
        };
        if let Some(reason) = degraded {
            return Ok(ContinuityStoreOpen::Degraded(reason));
        }

        let directory = app_data_dir.join(STORE_DIRECTORY);
        let path = directory.join(STORE_FILENAME);
        reject_symlink(&directory)?;
        reject_symlink(&path)?;
        reject_symlink(&path.with_extension("sqlite3-wal"))?;
        reject_symlink(&path.with_extension("sqlite3-shm"))?;
        // Existing bytes are preflighted through a read-only connection before
        // WAL, a checkpoint, permissions, or schema setup can mutate a foreign,
        // newer, or inconsistent database.
        let preflight = path
            .exists()
            .then(|| preflight_existing_schema(&path))
            .transpose()?;
        if preflight == Some(ExistingSchemaPreflight::DegradedLegacy) {
            return Ok(ContinuityStoreOpen::Degraded(
                ContinuityStoreDegradedReason::AuthorityMigrationRequired,
            ));
        }
        ensure_private_directory(&directory)?;
        let connection = Connection::open(&path).map_err(|_| ContinuityStoreError::Unavailable)?;
        ensure_private_file(&path)?;
        // New databases and empty legacy upgrades establish their complete
        // identity and schema in rollback-journal mode. WAL is enabled only
        // after that transaction commits, so a legitimate store never relies
        // on classifying an ambiguous header-zero main file plus sidecars.
        configure_connection_base(&connection)?;
        if preflight == Some(ExistingSchemaPreflight::UpgradeEmptyLegacy) {
            force_rollback_journal(&connection)?;
        }
        initialize_schema(&connection)?;
        enable_wal(&connection)?;
        Ok(ContinuityStoreOpen::Ready(Self {
            connection,
            path,
            diagnostics: Vec::new(),
        }))
    }

    /// Dedicated database path for operational tests; never expose it to UI or logs.
    #[cfg(test)]
    fn path_for_test(&self) -> &Path {
        &self.path
    }

    /// Persist a fully validated encrypted envelope transactionally.
    pub(crate) fn put_encrypted(
        &mut self,
        record: &ContinuityRecordV1,
    ) -> Result<RecordWriteOutcome, ContinuityStoreError> {
        validate_record(record)?;
        let encoded = canonicalize(record).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if encoded.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;

        let lifecycle_busy: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_journals WHERE owner_pubkey = ?1)",
                [record.namespace.owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if lifecycle_busy {
            return Err(ContinuityStoreError::LifecycleConflict);
        }

        let existing: Option<(i64, i64)> = transaction
            .query_row(
                "SELECT rowid,
                        CASE WHEN typeof(envelope_json) = 'blob'
                             THEN length(envelope_json) ELSE -1 END
                 FROM continuity_records WHERE record_id = ?1",
                [&record.record_id.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if let Some((rowid, length)) = existing {
            if !(0..=MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64).contains(&length) {
                return Err(ContinuityStoreError::ReplayConflict);
            }
            // The metadata pass never selects the BLOB. Only a row whose
            // stored length is already within the frozen ceiling reaches this
            // second, independently guarded fetch.
            let existing: Option<Vec<u8>> = transaction
                .query_row(
                    "SELECT envelope_json FROM continuity_records
                     WHERE rowid = ?1 AND record_id = ?2
                       AND CASE WHEN typeof(envelope_json) = 'blob'
                                THEN length(envelope_json) BETWEEN 0 AND ?3
                                ELSE 0 END",
                    params![
                        rowid,
                        record.record_id.as_str(),
                        MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                    ],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            let Some(existing) = existing else {
                return Err(ContinuityStoreError::ReplayConflict);
            };
            return if existing == encoded {
                Ok(RecordWriteOutcome::Replayed)
            } else {
                Err(ContinuityStoreError::ReplayConflict)
            };
        }

        let nonce_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_records WHERE namespace_ref = ?1 AND key_version = ?2 AND nonce_b64 = ?3)",
                params![record.namespace.namespace_ref.as_str(), record.key_version.get() as i64, &record.nonce_b64],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if nonce_exists {
            return Err(ContinuityStoreError::NonceCollision);
        }

        insert_record(&transaction, record, &encoded)?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(RecordWriteOutcome::Inserted)
    }

    /// Load only exact namespace/scope matches. These envelopes have **not**
    /// been authenticated and must be decrypted/authenticated before recall.
    pub(crate) fn load_encrypted_exact(
        &mut self,
        requested: &NamespaceScope,
    ) -> Result<Vec<ContinuityRecordV1>, ContinuityStoreError> {
        let namespace = requested.namespace().as_protocol();
        let scope = requested.as_protocol();
        let mut statement = self.connection.prepare(
            "SELECT rowid,
                    CASE WHEN typeof(envelope_json) = 'blob'
                         THEN length(envelope_json) ELSE -1 END
             FROM continuity_records
             WHERE namespace_protocol = ?1 AND owner_pubkey = ?2 AND namespace_kind = ?3
               AND resident_pubkey IS ?4 AND namespace_ref = ?5 AND namespace_key_version = ?6
               AND scope_protocol = ?7 AND scope_namespace_ref = ?8 AND scope_ref = ?9
               AND source_id IS ?10 AND project_id IS ?11 AND room_id IS ?12 AND conversation_id IS ?13
             ORDER BY rowid ASC",
        ).map_err(|_| ContinuityStoreError::Unavailable)?;
        let kind = namespace_kind(namespace.kind);
        let rows = statement
            .query_map(
                params![
                    namespace.protocol,
                    namespace.owner_pubkey.as_str(),
                    kind,
                    namespace.resident_pubkey.as_ref().map(|key| key.as_str()),
                    namespace.namespace_ref.as_str(),
                    namespace.key_version.get() as i64,
                    scope.protocol,
                    scope.namespace_ref.as_str(),
                    scope.scope_ref.as_str(),
                    scope.source_id.as_ref().map(|id| id.as_str()),
                    scope.project_id.as_ref().map(|id| id.as_str()),
                    scope.room_id.as_ref().map(|id| id.as_str()),
                    scope.conversation_id.as_ref().map(|id| id.as_str()),
                ],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let mut fetch = self
            .connection
            .prepare(
                "SELECT envelope_json FROM continuity_records
                 WHERE rowid = ?1
                   AND CASE WHEN typeof(envelope_json) = 'blob'
                            THEN length(envelope_json) BETWEEN 0 AND ?2
                            ELSE 0 END",
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;

        let mut records = Vec::new();
        for row in rows {
            let Ok((rowid, length)) = row else {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            };
            if length > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64 {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::OversizedEnvelopeSkipped);
                continue;
            }
            if length < 0 {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            }
            // Phase two is performed one eligible record at a time and repeats
            // the ceiling in SQL before requesting a Rust `Vec`. The first
            // phase never reads a persisted string or BLOB and no handle list
            // accumulates.
            let raw = match fetch
                .query_row(
                    params![rowid, MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64],
                    |row| row.get::<_, Vec<u8>>(0),
                )
                .optional()
            {
                Ok(Some(raw)) => raw,
                _ => {
                    self.diagnostics
                        .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                    continue;
                }
            };
            let Ok(record) = serde_json::from_slice::<ContinuityRecordV1>(&raw) else {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            };
            // `rowid` is only a bounded phase-two handle. The denormalized
            // primary key must still equal the bounded, validated envelope ID;
            // compare inside SQLite without ever loading a corrupt stored ID.
            let id_matches = fetch_record_id_matches(&self.connection, rowid, &record)?;
            if !id_matches {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            }
            // Defense in depth: row predicates are never authority. Rebuild the
            // exact K01 address from the envelope before returning it.
            let Ok(namespace) = NamespaceKey::new(record.namespace.clone()) else {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            };
            let Ok(address) = NamespaceScope::new(namespace, record.scope.clone()) else {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            };
            if !address.permits(requested) || validate_record(&record).is_err() {
                self.diagnostics
                    .push(ContinuityStoreDiagnostic::CorruptEnvelopeSkipped);
                continue;
            }
            records.push(record);
        }
        Ok(records)
    }

    /// Capture a consistent, bounded ciphertext-only owner snapshot.
    ///
    /// A nonterminal rotation rejects backup/restore snapshots. No record body
    /// is decrypted and no path or plaintext enters the returned structure.
    pub(crate) fn snapshot_owner_encrypted(
        &mut self,
        owner_pubkey: &Hex64,
    ) -> Result<ContinuityEncryptedSnapshot, ContinuityStoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let lifecycle_busy: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_journals WHERE owner_pubkey = ?1)",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if lifecycle_busy {
            return Err(ContinuityStoreError::LifecycleConflict);
        }
        let active_key_version = active_or_inferred_version(&transaction, owner_pubkey)?;
        let snapshot_boundary: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(rowid), 0) FROM continuity_records WHERE owner_pubkey = ?1",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let expected_count =
            preflight_snapshot_bounds(&transaction, owner_pubkey, snapshot_boundary, None)?;
        let records = snapshot_rows(
            &transaction,
            owner_pubkey,
            snapshot_boundary,
            None,
            0,
            expected_count,
        )?;
        ensure_snapshot_complete(expected_count, records.len())?;
        let source_mappings = load_source_mappings(&transaction, owner_pubkey)?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        Ok(ContinuityEncryptedSnapshot {
            owner_pubkey: owner_pubkey.clone(),
            active_key_version,
            snapshot_boundary,
            records,
            source_mappings,
        })
    }

    /// Return the frozen owner boundary and count for a proposed rotation.
    pub(crate) fn rotation_boundary(
        &self,
        owner_pubkey: &Hex64,
        from_version: SafeU53,
    ) -> Result<(i64, usize), ContinuityStoreError> {
        let boundary: i64 = self
            .connection
            .query_row(
                "SELECT COALESCE(MAX(rowid), 0) FROM continuity_records
                 WHERE owner_pubkey = ?1 AND key_version = ?2",
                params![owner_pubkey.as_str(), from_version.get() as i64],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let count = preflight_snapshot_bounds(
            &self.connection,
            owner_pubkey,
            boundary,
            Some(from_version),
        )?;
        Ok((boundary, count))
    }

    /// Classify the complete persisted destination without loading any body.
    pub(crate) fn restore_destination(
        &self,
        expected_owner: &Hex64,
    ) -> Result<ContinuityRestoreDestination, ContinuityStoreError> {
        let (count, malformed, unexpected): (i64, i64, i64) = self
            .connection
            .query_row(
                "WITH owners(owner_pubkey) AS (
                     SELECT owner_pubkey FROM continuity_records
                     UNION SELECT owner_pubkey FROM continuity_owner_versions
                     UNION SELECT owner_pubkey FROM continuity_rotation_journals
                     UNION SELECT owner_pubkey FROM continuity_rotation_receipts
                     UNION SELECT owner_pubkey FROM continuity_source_mappings
                     UNION SELECT owner_pubkey FROM continuity_authority_meta
                 )
                 SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN typeof(owner_pubkey)='text'
                                              AND length(CAST(owner_pubkey AS BLOB))=64
                                              AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                                         THEN 0 ELSE 1 END),0),
                        COALESCE(SUM(CASE WHEN owner_pubkey=?1 THEN 0 ELSE 1 END),0)
                 FROM owners",
                [expected_owner.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if malformed != 0 {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        if count == 0 {
            return Ok(ContinuityRestoreDestination::Empty);
        }
        if count == 1 && unexpected == 0 {
            return Ok(ContinuityRestoreDestination::ExactOwner);
        }
        Err(ContinuityStoreError::LifecycleConflict)
    }

    pub(crate) fn active_owner_key_version(
        &self,
        owner_pubkey: &Hex64,
    ) -> Result<SafeU53, ContinuityStoreError> {
        active_or_inferred_version(&self.connection, owner_pubkey)
    }

    /// Load the one authenticated rotation-journal envelope for an owner.
    pub(crate) fn load_rotation_journal(
        &self,
        owner_pubkey: &Hex64,
    ) -> Result<Option<ContinuityRecordV1>, ContinuityStoreError> {
        let (count, malformed): (i64, i64) = self
            .connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN typeof(owner_pubkey)='text'
                                              AND length(CAST(owner_pubkey AS BLOB))=64
                                              AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                                              AND typeof(rotation_id)='text'
                                              AND length(CAST(rotation_id AS BLOB)) BETWEEN 1 AND 128
                                              AND rotation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
                                              AND typeof(envelope_json)='blob'
                                              AND length(envelope_json) BETWEEN 0 AND ?2
                                         THEN 0 ELSE 1 END),0)
                 FROM continuity_rotation_journals WHERE owner_pubkey=?1",
                params![
                    owner_pubkey.as_str(),
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if count > 1 || malformed != 0 {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let raw: Option<Vec<u8>> = self
            .connection
            .query_row(
                "SELECT envelope_json FROM continuity_rotation_journals
                 WHERE owner_pubkey = ?1
                   AND typeof(owner_pubkey)='text'
                   AND length(CAST(owner_pubkey AS BLOB))=64
                   AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                   AND typeof(rotation_id)='text'
                   AND length(CAST(rotation_id AS BLOB)) BETWEEN 1 AND 128
                   AND rotation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
                   AND typeof(envelope_json) = 'blob'
                   AND length(envelope_json) BETWEEN 0 AND ?2",
                params![
                    owner_pubkey.as_str(),
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if raw.is_some() != (count == 1) {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        raw.map(|raw| {
            serde_json::from_slice::<ContinuityRecordV1>(&raw)
                .map_err(|_| ContinuityStoreError::InvalidRecord)
                .and_then(|record| {
                    validate_record(&record)?;
                    Ok(record)
                })
        })
        .transpose()
    }

    /// Load one exact durable authenticated terminal rotation envelope.
    pub(crate) fn load_rotation_receipt(
        &self,
        owner_pubkey: &Hex64,
        rotation_id: &str,
    ) -> Result<Option<(Hex64, ContinuityRecordV1)>, ContinuityStoreError> {
        OpaqueId::parse(rotation_id.to_owned()).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let (count, malformed): (i64, i64) = self
            .connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN typeof(owner_pubkey)='text'
                                              AND length(CAST(owner_pubkey AS BLOB))=64
                                              AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                                              AND typeof(rotation_id)='text'
                                              AND length(CAST(rotation_id AS BLOB)) BETWEEN 1 AND 128
                                              AND rotation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
                                              AND typeof(request_sha256)='text'
                                              AND length(CAST(request_sha256 AS BLOB))=64
                                              AND request_sha256 NOT GLOB '*[^0-9a-f]*'
                                              AND typeof(envelope_json)='blob'
                                              AND length(envelope_json) BETWEEN 0 AND ?3
                                         THEN 0 ELSE 1 END),0)
                 FROM continuity_rotation_receipts
                 WHERE owner_pubkey=?1 AND rotation_id=?2",
                params![
                    owner_pubkey.as_str(),
                    rotation_id,
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if count > 1 || malformed != 0 {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let row: Option<(String, Vec<u8>)> = self
            .connection
            .query_row(
                "SELECT request_sha256, envelope_json FROM continuity_rotation_receipts
                 WHERE owner_pubkey = ?1 AND rotation_id = ?2
                   AND typeof(owner_pubkey)='text'
                   AND length(CAST(owner_pubkey AS BLOB))=64
                   AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                   AND typeof(rotation_id)='text'
                   AND length(CAST(rotation_id AS BLOB)) BETWEEN 1 AND 128
                   AND rotation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
                   AND typeof(request_sha256)='text'
                   AND length(CAST(request_sha256 AS BLOB))=64
                   AND request_sha256 NOT GLOB '*[^0-9a-f]*'
                   AND typeof(envelope_json) = 'blob'
                   AND length(envelope_json) BETWEEN 0 AND ?3",
                params![
                    owner_pubkey.as_str(),
                    rotation_id,
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if row.is_some() != (count == 1) {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        row.map(|(request_sha256, raw)| {
            let request_sha256 =
                Hex64::parse(request_sha256).map_err(|_| ContinuityStoreError::InvalidRecord)?;
            let record = serde_json::from_slice::<ContinuityRecordV1>(&raw)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?;
            validate_record(&record)?;
            Ok((request_sha256, record))
        })
        .transpose()
    }

    /// Persist `Prepared` and the frozen boundary before changing any row.
    pub(crate) fn prepare_rotation(
        &mut self,
        owner_pubkey: &Hex64,
        rotation_id: &str,
        from_version: SafeU53,
        expected_boundary: i64,
        expected_count: usize,
        journal: &ContinuityRecordV1,
    ) -> Result<(), ContinuityStoreError> {
        OpaqueId::parse(rotation_id.to_owned()).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        validate_record(journal)?;
        let encoded = canonicalize(journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if encoded.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let existing: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_journals WHERE owner_pubkey = ?1)",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if existing {
            return Err(ContinuityStoreError::LifecycleConflict);
        }
        let active = active_or_inferred_version(&transaction, owner_pubkey)?;
        if active != from_version {
            return Err(ContinuityStoreError::LifecycleConflict);
        }
        let (actual_boundary, actual_count): (i64, i64) = transaction
            .query_row(
                "SELECT COALESCE(MAX(rowid), 0), COUNT(*) FROM continuity_records
                 WHERE owner_pubkey = ?1 AND key_version = ?2",
                params![owner_pubkey.as_str(), from_version.get() as i64],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if actual_boundary != expected_boundary
            || usize::try_from(actual_count).ok() != Some(expected_count)
        {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .execute(
                "INSERT INTO continuity_owner_versions(owner_pubkey, active_key_version)
                 VALUES (?1, ?2)
                 ON CONFLICT(owner_pubkey) DO NOTHING",
                params![owner_pubkey.as_str(), from_version.get() as i64],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        transaction
            .execute(
                "INSERT INTO continuity_rotation_journals(owner_pubkey, rotation_id, envelope_json)
                 VALUES (?1, ?2, ?3)",
                params![owner_pubkey.as_str(), rotation_id, encoded],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    /// Load one deterministic bounded rotation batch after the journal cursor.
    pub(crate) fn rotation_batch(
        &self,
        owner_pubkey: &Hex64,
        from_version: SafeU53,
        snapshot_boundary: i64,
        cursor: i64,
        limit: usize,
    ) -> Result<Vec<ContinuityStoredEnvelope>, ContinuityStoreError> {
        if limit == 0 || limit > 256 {
            return Err(ContinuityStoreError::SnapshotBoundExceeded);
        }
        snapshot_rows(
            &self.connection,
            owner_pubkey,
            snapshot_boundary,
            Some(from_version),
            cursor,
            limit,
        )
    }

    /// Verify the frozen rotation population has one exact physical version.
    pub(crate) fn verify_rotation_layout(
        &self,
        owner_pubkey: &Hex64,
        snapshot_boundary: i64,
        expected_version: SafeU53,
        expected_count: usize,
    ) -> Result<(), ContinuityStoreError> {
        let (total, matching): (i64, i64) = self
            .connection
            .query_row(
                "SELECT COUNT(*),
                        SUM(CASE WHEN key_version = ?1 AND namespace_key_version = ?1
                                 THEN 1 ELSE 0 END)
                 FROM continuity_records WHERE owner_pubkey = ?2 AND rowid <= ?3",
                params![
                    expected_version.get() as i64,
                    owner_pubkey.as_str(),
                    snapshot_boundary
                ],
                |row| Ok((row.get(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0))),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if usize::try_from(total).ok() != Some(expected_count)
            || usize::try_from(matching).ok() != Some(expected_count)
        {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        Ok(())
    }

    /// Atomically replace a bounded batch and advance the authenticated cursor.
    pub(crate) fn cas_rotation_batch(
        &mut self,
        owner_pubkey: &Hex64,
        expected_journal: &ContinuityRecordV1,
        replacement_journal: &ContinuityRecordV1,
        replacements: &[ContinuityRotationReplacement],
    ) -> Result<(), ContinuityStoreError> {
        if replacements.is_empty() || replacements.len() > 256 {
            return Err(ContinuityStoreError::SnapshotBoundExceeded);
        }
        validate_record(expected_journal)?;
        validate_record(replacement_journal)?;
        let expected_journal =
            canonicalize(expected_journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let replacement_journal =
            canonicalize(replacement_journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        for replacement in replacements {
            validate_record(&replacement.expected)?;
            validate_record(&replacement.replacement)?;
            if replacement.expected.namespace.owner_pubkey != *owner_pubkey
                || replacement.replacement.namespace.owner_pubkey != *owner_pubkey
                || replacement.expected.record_id != replacement.replacement.record_id
            {
                return Err(ContinuityStoreError::InvalidRecord);
            }
            let expected_encoded = canonicalize(&replacement.expected)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?;
            if hex::encode(Sha256::digest(&expected_encoded))
                != replacement.expected_envelope_sha256.as_str()
            {
                return Err(ContinuityStoreError::InvalidRecord);
            }
            let encoded = canonicalize(&replacement.replacement)
                .map_err(|_| ContinuityStoreError::InvalidRecord)?;
            if encoded.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
                return Err(ContinuityStoreError::InvalidRecord);
            }
            let changed = transaction
                .execute(
                    "UPDATE continuity_records SET
                         namespace_key_version = ?1, key_version = ?2, nonce_b64 = ?3,
                         envelope_json = ?4
                     WHERE rowid = ?5 AND owner_pubkey = ?6 AND record_id = ?7
                       AND envelope_json = ?8",
                    params![
                        replacement.replacement.namespace.key_version.get() as i64,
                        replacement.replacement.key_version.get() as i64,
                        replacement.replacement.nonce_b64,
                        encoded,
                        replacement.rowid,
                        owner_pubkey.as_str(),
                        replacement.replacement.record_id.as_str(),
                        expected_encoded,
                    ],
                )
                .map_err(|_| ContinuityStoreError::Unavailable)?;
            if changed != 1 {
                return Err(ContinuityStoreError::CompareAndSwapConflict);
            }
        }
        let journal_changed = transaction
            .execute(
                "UPDATE continuity_rotation_journals SET envelope_json = ?1
                 WHERE owner_pubkey = ?2 AND envelope_json = ?3",
                params![replacement_journal, owner_pubkey.as_str(), expected_journal],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if journal_changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    /// Compare-and-swap only the authenticated body-free journal phase.
    pub(crate) fn cas_rotation_journal(
        &mut self,
        owner_pubkey: &Hex64,
        expected: &ContinuityRecordV1,
        replacement: &ContinuityRecordV1,
    ) -> Result<(), ContinuityStoreError> {
        validate_record(expected)?;
        validate_record(replacement)?;
        let expected = canonicalize(expected).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let replacement =
            canonicalize(replacement).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let changed = self
            .connection
            .execute(
                "UPDATE continuity_rotation_journals SET envelope_json = ?1
                 WHERE owner_pubkey = ?2 AND envelope_json = ?3",
                params![replacement, owner_pubkey.as_str(), expected],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        Ok(())
    }

    /// Atomically activate the new owner key version with journal advancement.
    pub(crate) fn activate_rotation(
        &mut self,
        owner_pubkey: &Hex64,
        from_version: SafeU53,
        to_version: SafeU53,
        expected_journal: &ContinuityRecordV1,
        activated_journal: &ContinuityRecordV1,
    ) -> Result<(), ContinuityStoreError> {
        validate_record(expected_journal)?;
        validate_record(activated_journal)?;
        let expected =
            canonicalize(expected_journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let activated =
            canonicalize(activated_journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let version_changed = transaction
            .execute(
                "UPDATE continuity_owner_versions SET active_key_version = ?1
                 WHERE owner_pubkey = ?2 AND active_key_version = ?3",
                params![
                    to_version.get() as i64,
                    owner_pubkey.as_str(),
                    from_version.get() as i64
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let journal_changed = transaction
            .execute(
                "UPDATE continuity_rotation_journals SET envelope_json = ?1
                 WHERE owner_pubkey = ?2 AND envelope_json = ?3",
                params![activated, owner_pubkey.as_str(), expected],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if version_changed != 1 || journal_changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    /// Atomically retain an authenticated request-bound terminal receipt and
    /// remove only the exact completed journal.
    pub(crate) fn complete_rotation(
        &mut self,
        owner_pubkey: &Hex64,
        rotation_id: &str,
        request_sha256: &Hex64,
        completed_journal: &ContinuityRecordV1,
    ) -> Result<(), ContinuityStoreError> {
        OpaqueId::parse(rotation_id.to_owned()).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        validate_record(completed_journal)?;
        let encoded =
            canonicalize(completed_journal).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        if encoded.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        transaction
            .execute(
                "INSERT INTO continuity_rotation_receipts(
                     owner_pubkey, rotation_id, request_sha256, envelope_json
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(owner_pubkey, rotation_id) DO NOTHING",
                params![
                    owner_pubkey.as_str(),
                    rotation_id,
                    request_sha256.as_str(),
                    &encoded
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let stored: Option<(String, Vec<u8>)> = transaction
            .query_row(
                "SELECT request_sha256, envelope_json FROM continuity_rotation_receipts
                 WHERE owner_pubkey = ?1 AND rotation_id = ?2
                   AND typeof(owner_pubkey)='text'
                   AND length(CAST(owner_pubkey AS BLOB))=64
                   AND owner_pubkey NOT GLOB '*[^0-9a-f]*'
                   AND typeof(rotation_id)='text'
                   AND length(CAST(rotation_id AS BLOB)) BETWEEN 1 AND 128
                   AND rotation_id NOT GLOB '*[^A-Za-z0-9._:-]*'
                   AND typeof(request_sha256)='text'
                   AND length(CAST(request_sha256 AS BLOB))=64
                   AND request_sha256 NOT GLOB '*[^0-9a-f]*'
                   AND typeof(envelope_json)='blob'
                   AND length(envelope_json) BETWEEN 0 AND ?3",
                params![
                    owner_pubkey.as_str(),
                    rotation_id,
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let Some(stored) = stored else {
            return Err(ContinuityStoreError::ReplayConflict);
        };
        if stored.0 != request_sha256.as_str() || stored.1 != encoded {
            return Err(ContinuityStoreError::ReplayConflict);
        }
        let changed = transaction
            .execute(
                "DELETE FROM continuity_rotation_journals
                 WHERE owner_pubkey = ?1 AND rotation_id = ?2 AND envelope_json = ?3",
                params![owner_pubkey.as_str(), rotation_id, encoded],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ContinuityStoreError::CompareAndSwapConflict);
        }
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    /// Atomically replace only one owner's visible encrypted snapshot.
    pub(crate) fn replace_owner_snapshot_atomically(
        &mut self,
        owner_pubkey: &Hex64,
        records: &[ContinuityRecordV1],
        mappings: &[ContinuitySourceMapping],
        active_key_version: SafeU53,
    ) -> Result<(), ContinuityStoreError> {
        if records.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS {
            return Err(ContinuityStoreError::SnapshotBoundExceeded);
        }
        let mut encoded = Vec::with_capacity(records.len());
        let mut total = 0usize;
        for record in records {
            validate_record(record)?;
            if record.namespace.owner_pubkey != *owner_pubkey {
                return Err(ContinuityStoreError::InvalidRecord);
            }
            let bytes = canonicalize(record).map_err(|_| ContinuityStoreError::InvalidRecord)?;
            total = total
                .checked_add(bytes.len())
                .ok_or(ContinuityStoreError::SnapshotBoundExceeded)?;
            if bytes.len() > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES
                || total > MAX_CONTINUITY_SNAPSHOT_BYTES
            {
                return Err(ContinuityStoreError::SnapshotBoundExceeded);
            }
            encoded.push((record, bytes));
        }
        if mappings.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS {
            return Err(ContinuityStoreError::SnapshotBoundExceeded);
        }
        validate_source_mappings(mappings)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        let lifecycle_busy: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_rotation_journals WHERE owner_pubkey = ?1)",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if lifecycle_busy {
            return Err(ContinuityStoreError::LifecycleConflict);
        }
        let authority_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM continuity_authority_meta
                 WHERE owner_pubkey=?1)",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        if authority_exists {
            // The legacy seam has no revision snapshot parameter. Refuse an
            // authority-bearing owner rather than silently orphaning or
            // mismatching its complete v4 generation.
            return Err(ContinuityStoreError::LifecycleConflict);
        }
        transaction
            .execute(
                "DELETE FROM continuity_records WHERE owner_pubkey = ?1",
                [owner_pubkey.as_str()],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        replace_source_mappings(&transaction, owner_pubkey, mappings)?;
        for (record, bytes) in encoded {
            insert_record(&transaction, record, &bytes)?;
        }
        transaction
            .execute(
                "INSERT INTO continuity_owner_versions(owner_pubkey, active_key_version)
                 VALUES (?1, ?2)
                 ON CONFLICT(owner_pubkey) DO UPDATE SET active_key_version = excluded.active_key_version",
                params![owner_pubkey.as_str(), active_key_version.get() as i64],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
        transaction
            .commit()
            .map_err(|_| ContinuityStoreError::Unavailable)
    }

    #[cfg(test)]
    pub(super) fn source_mappings_for_test(
        &self,
        owner_pubkey: &Hex64,
    ) -> Result<Vec<ContinuitySourceMapping>, ContinuityStoreError> {
        load_source_mappings(&self.connection, owner_pubkey)
    }

    /// Return body-free corruption diagnostics. They never include record text,
    /// titles, tags, journal data, ciphertext, or key material.
    pub(crate) fn diagnostics(&self) -> &[ContinuityStoreDiagnostic] {
        &self.diagnostics
    }
}

fn fetch_record_id_matches(
    connection: &Connection,
    rowid: i64,
    record: &ContinuityRecordV1,
) -> Result<bool, ContinuityStoreError> {
    connection
        .query_row(
            "SELECT record_id = ?1 FROM continuity_records WHERE rowid = ?2",
            params![record.record_id.as_str(), rowid],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)
}

fn active_or_inferred_version(
    connection: &Connection,
    owner_pubkey: &Hex64,
) -> Result<SafeU53, ContinuityStoreError> {
    let persisted: Option<i64> = connection
        .query_row(
            "SELECT active_key_version FROM continuity_owner_versions WHERE owner_pubkey = ?1",
            [owner_pubkey.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let version = match persisted {
        Some(version) => version,
        None => connection
            .query_row(
                "SELECT COALESCE(MAX(key_version), 1) FROM continuity_records WHERE owner_pubkey = ?1",
                [owner_pubkey.as_str()],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?,
    };
    let version = u64::try_from(version).map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    SafeU53::new(version).map_err(|_| ContinuityStoreError::SchemaIncompatible)
}

fn snapshot_rows(
    connection: &Connection,
    owner_pubkey: &Hex64,
    snapshot_boundary: i64,
    key_version: Option<SafeU53>,
    cursor: i64,
    limit: usize,
) -> Result<Vec<ContinuityStoredEnvelope>, ContinuityStoreError> {
    if limit > MAX_CONTINUITY_SNAPSHOT_RECORDS {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let sql = if key_version.is_some() {
        "SELECT rowid,
                CASE WHEN typeof(envelope_json) = 'blob' THEN length(envelope_json) ELSE -1 END
         FROM continuity_records
         WHERE owner_pubkey = ?1 AND rowid > ?2 AND rowid <= ?3 AND key_version = ?4
         ORDER BY rowid ASC LIMIT ?5"
    } else {
        "SELECT rowid,
                CASE WHEN typeof(envelope_json) = 'blob' THEN length(envelope_json) ELSE -1 END
         FROM continuity_records
         WHERE owner_pubkey = ?1 AND rowid > ?2 AND rowid <= ?3
         ORDER BY rowid ASC LIMIT ?4"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let rows = if let Some(version) = key_version {
        statement
            .query_map(
                params![
                    owner_pubkey.as_str(),
                    cursor,
                    snapshot_boundary,
                    version.get() as i64,
                    limit as i64
                ],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ContinuityStoreError::Unavailable)?
    } else {
        statement
            .query_map(
                params![
                    owner_pubkey.as_str(),
                    cursor,
                    snapshot_boundary,
                    limit as i64
                ],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ContinuityStoreError::Unavailable)?
    };
    drop(statement);

    let mut fetch = connection
        .prepare(
            "SELECT envelope_json FROM continuity_records
             WHERE rowid = ?1 AND owner_pubkey = ?2
               AND CASE WHEN typeof(envelope_json) = 'blob'
                        THEN length(envelope_json) BETWEEN 0 AND ?3 ELSE 0 END",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let mut total = 0usize;
    let mut records = Vec::with_capacity(rows.len());
    for (rowid, length) in rows {
        if !(0..=MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64).contains(&length) {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        total = total
            .checked_add(length as usize)
            .ok_or(ContinuityStoreError::SnapshotBoundExceeded)?;
        if total > MAX_CONTINUITY_SNAPSHOT_BYTES {
            return Err(ContinuityStoreError::SnapshotBoundExceeded);
        }
        let raw: Vec<u8> = fetch
            .query_row(
                params![
                    rowid,
                    owner_pubkey.as_str(),
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64
                ],
                |row| row.get(0),
            )
            .map_err(|_| ContinuityStoreError::InvalidRecord)?;
        let record: ContinuityRecordV1 =
            serde_json::from_slice(&raw).map_err(|_| ContinuityStoreError::InvalidRecord)?;
        validate_record(&record)?;
        if record.namespace.owner_pubkey != *owner_pubkey
            || !fetch_record_id_matches(connection, rowid, &record)?
        {
            return Err(ContinuityStoreError::InvalidRecord);
        }
        let digest = Hex64::parse(hex::encode(Sha256::digest(&raw)))
            .map_err(|_| ContinuityStoreError::InvalidRecord)?;
        records.push(ContinuityStoredEnvelope {
            rowid,
            envelope_sha256: digest,
            record,
        });
    }
    Ok(records)
}

fn preflight_snapshot_bounds(
    connection: &Connection,
    owner_pubkey: &Hex64,
    snapshot_boundary: i64,
    key_version: Option<SafeU53>,
) -> Result<usize, ContinuityStoreError> {
    let (count, bytes, malformed): (i64, i64, i64) = if let Some(version) = key_version {
        connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN typeof(envelope_json) = 'blob'
                                              THEN length(envelope_json) ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN typeof(envelope_json) = 'blob'
                                              AND length(envelope_json) BETWEEN 0 AND ?1
                                         THEN 0 ELSE 1 END), 0)
                 FROM continuity_records
                 WHERE owner_pubkey = ?2 AND rowid <= ?3 AND key_version = ?4",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64,
                    owner_pubkey.as_str(),
                    snapshot_boundary,
                    version.get() as i64
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?
    } else {
        connection
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN typeof(envelope_json) = 'blob'
                                              THEN length(envelope_json) ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN typeof(envelope_json) = 'blob'
                                              AND length(envelope_json) BETWEEN 0 AND ?1
                                         THEN 0 ELSE 1 END), 0)
                 FROM continuity_records
                 WHERE owner_pubkey = ?2 AND rowid <= ?3",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64,
                    owner_pubkey.as_str(),
                    snapshot_boundary
                ],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?
    };
    validate_snapshot_totals(count, bytes, malformed)
}

fn validate_snapshot_totals(
    count: i64,
    bytes: i64,
    malformed: i64,
) -> Result<usize, ContinuityStoreError> {
    if malformed != 0 || count < 0 || bytes < 0 {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    let count = usize::try_from(count).map_err(|_| ContinuityStoreError::SnapshotBoundExceeded)?;
    let bytes = usize::try_from(bytes).map_err(|_| ContinuityStoreError::SnapshotBoundExceeded)?;
    if count > MAX_CONTINUITY_SNAPSHOT_RECORDS || bytes > MAX_CONTINUITY_SNAPSHOT_BYTES {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    Ok(count)
}

fn ensure_snapshot_complete(
    expected_count: usize,
    loaded_count: usize,
) -> Result<(), ContinuityStoreError> {
    if expected_count == loaded_count {
        Ok(())
    } else {
        Err(ContinuityStoreError::CompareAndSwapConflict)
    }
}

fn load_source_mappings(
    connection: &Connection,
    owner_pubkey: &Hex64,
) -> Result<Vec<ContinuitySourceMapping>, ContinuityStoreError> {
    let (count, bytes, malformed): (i64, i64, i64) = connection
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(length(CAST(mapping_ref AS BLOB))
                               +length(CAST(source_ref AS BLOB))
                               +COALESCE(length(CAST(resident_pubkey AS BLOB)),0)),0),
                    COALESCE(SUM(CASE WHEN typeof(mapping_ref)='text'
                                           AND length(CAST(mapping_ref AS BLOB))=71
                                           AND typeof(source_ref)='text'
                                           AND length(CAST(source_ref AS BLOB))=71
                                           AND (resident_pubkey IS NULL OR
                                                (typeof(resident_pubkey)='text' AND
                                                 length(CAST(resident_pubkey AS BLOB))=64))
                                      THEN 0 ELSE 1 END),0)
             FROM continuity_source_mappings WHERE owner_pubkey = ?1",
            [owner_pubkey.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let count = usize::try_from(count).map_err(|_| ContinuityStoreError::SnapshotBoundExceeded)?;
    if bytes < 0 || malformed != 0 {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    if count > MAX_CONTINUITY_SNAPSHOT_RECORDS || bytes as usize > MAX_CONTINUITY_SNAPSHOT_BYTES {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let mut statement = connection
        .prepare(
            "SELECT mapping_ref, source_ref, resident_pubkey
             FROM continuity_source_mappings WHERE owner_pubkey = ?1
               AND typeof(mapping_ref)='text' AND length(CAST(mapping_ref AS BLOB))=71
               AND typeof(source_ref)='text' AND length(CAST(source_ref AS BLOB))=71
               AND (resident_pubkey IS NULL OR
                    (typeof(resident_pubkey)='text' AND
                     length(CAST(resident_pubkey AS BLOB))=64))
             ORDER BY mapping_ref LIMIT ?2",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let result = statement
        .query_map(params![owner_pubkey.as_str(), count as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::Unavailable)?
        .map(|row| {
            let (mapping_ref, source_ref, resident_pubkey) =
                row.map_err(|_| ContinuityStoreError::Unavailable)?;
            Ok(ContinuitySourceMapping {
                mapping_ref: Sha256Ref::parse(mapping_ref)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                source_ref: Sha256Ref::parse(source_ref)
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
                resident_pubkey: resident_pubkey
                    .map(Hex64::parse)
                    .transpose()
                    .map_err(|_| ContinuityStoreError::InvalidRecord)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if result.len() != count {
        return Err(ContinuityStoreError::CompareAndSwapConflict);
    }
    Ok(result)
}

pub(super) fn validate_source_mappings(
    mappings: &[ContinuitySourceMapping],
) -> Result<(), ContinuityStoreError> {
    if mappings.len() > MAX_CONTINUITY_SNAPSHOT_RECORDS {
        return Err(ContinuityStoreError::SnapshotBoundExceeded);
    }
    let mut mapping_refs = std::collections::BTreeSet::new();
    for mapping in mappings {
        if !mapping_refs.insert(mapping.mapping_ref.as_str()) {
            return Err(ContinuityStoreError::InvalidRecord);
        }
    }
    Ok(())
}

pub(super) fn replace_source_mappings(
    transaction: &rusqlite::Transaction<'_>,
    owner_pubkey: &Hex64,
    mappings: &[ContinuitySourceMapping],
) -> Result<(), ContinuityStoreError> {
    validate_source_mappings(mappings)?;
    transaction
        .execute(
            "DELETE FROM continuity_source_mappings WHERE owner_pubkey = ?1",
            [owner_pubkey.as_str()],
        )
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    for mapping in mappings {
        transaction
            .execute(
                "INSERT INTO continuity_source_mappings(
                     owner_pubkey, mapping_ref, source_ref, resident_pubkey
                 ) VALUES (?1, ?2, ?3, ?4)",
                params![
                    owner_pubkey.as_str(),
                    mapping.mapping_ref.as_str(),
                    mapping.source_ref.as_str(),
                    mapping.resident_pubkey.as_ref().map(|value| value.as_str()),
                ],
            )
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    Ok(())
}

impl Drop for ContinuityStore {
    fn drop(&mut self) {
        // Best effort only: close must never affect application shutdown or chat.
        let _ = self
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

fn configure_connection_base(connection: &Connection) -> Result<(), ContinuityStoreError> {
    connection
        .execute_batch(
            "PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;
         PRAGMA trusted_schema = OFF;
         PRAGMA temp_store = MEMORY;
         PRAGMA secure_delete = ON;
         PRAGMA synchronous = FULL;",
        )
        .map_err(|_| ContinuityStoreError::Unavailable)
}

fn enable_wal(connection: &Connection) -> Result<(), ContinuityStoreError> {
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|_| ContinuityStoreError::Unavailable)
}

fn force_rollback_journal(connection: &Connection) -> Result<(), ContinuityStoreError> {
    connection
        .execute_batch("PRAGMA journal_mode = DELETE;")
        .map_err(|_| ContinuityStoreError::Unavailable)
}

fn initialize_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if application_id != 0 && application_id != APPLICATION_ID {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    if user_version > SCHEMA_VERSION {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    if user_version == 0 {
        let existing: Option<String> = connection
            .query_row("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'continuity_records'", [], |row| row.get(0))
            .optional().map_err(|_| ContinuityStoreError::Unavailable)?;
        if existing.is_some() || application_id != 0 {
            return Err(ContinuityStoreError::SchemaIncompatible);
        }
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;
                 {CREATE_TABLE_SQL};
                 {CREATE_SCOPE_INDEX_SQL};
                 {CREATE_OWNER_VERSION_TABLE_SQL};
                 {CREATE_ROTATION_JOURNAL_TABLE_SQL};
                 {CREATE_ROTATION_RECEIPT_TABLE_SQL};
                 {CREATE_SOURCE_MAPPING_TABLE_SQL};
                 {};
                 PRAGMA application_id = {APPLICATION_ID};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;",
                super::continuity_revision_authority::CREATE_AUTHORITY_SCHEMA_SQL,
            ))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    } else if user_version == LEGACY_SCHEMA_VERSION {
        require_empty_legacy(connection, LEGACY_SCHEMA_VERSION)?;
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;
                 {CREATE_OWNER_VERSION_TABLE_SQL};
                 {CREATE_ROTATION_JOURNAL_TABLE_SQL};
                 {CREATE_ROTATION_RECEIPT_TABLE_SQL};
                 {CREATE_SOURCE_MAPPING_TABLE_SQL};
                 {};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;",
                super::continuity_revision_authority::CREATE_AUTHORITY_SCHEMA_SQL,
            ))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    } else if user_version == LEGACY_SCHEMA_VERSION_V2 {
        require_empty_legacy(connection, LEGACY_SCHEMA_VERSION_V2)?;
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;
                 {CREATE_ROTATION_RECEIPT_TABLE_SQL};
                 {CREATE_SOURCE_MAPPING_TABLE_SQL};
                 {};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;",
                super::continuity_revision_authority::CREATE_AUTHORITY_SCHEMA_SQL,
            ))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    } else if user_version == PREVIOUS_SCHEMA_VERSION {
        require_empty_legacy(connection, PREVIOUS_SCHEMA_VERSION)?;
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;
                 {};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;",
                super::continuity_revision_authority::CREATE_AUTHORITY_SCHEMA_SQL,
            ))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    validate_schema(connection)
}

/// Check an existing database without a write-capable connection. Any unknown,
/// newer, corrupted, or inconsistent store is refused before initialization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ExistingSchemaPreflight {
    Current,
    UpgradeEmptyLegacy,
    DegradedLegacy,
}

fn preflight_existing_schema(path: &Path) -> Result<ExistingSchemaPreflight, ContinuityStoreError> {
    reject_symlink(path)?;
    let wal = path.with_extension("sqlite3-wal");
    let shm = path.with_extension("sqlite3-shm");
    reject_symlink(&wal)?;
    reject_symlink(&shm)?;
    let (header_application_id, header_version) = read_sqlite_identity(path)?;
    let sidecar_present = [&wal, &shm].iter().any(|sidecar| {
        fs::metadata(sidecar)
            .map(|metadata| metadata.len() > 0)
            .unwrap_or(false)
    });
    let recognized_header = header_application_id == APPLICATION_ID
        && matches!(
            header_version,
            LEGACY_SCHEMA_VERSION
                | LEGACY_SCHEMA_VERSION_V2
                | PREVIOUS_SCHEMA_VERSION
                | SCHEMA_VERSION
        );
    if !recognized_header {
        // Header-zero plus sidecars is intrinsically ambiguous. Fail closed
        // without entropy, temporary files, SQLite recovery, or source writes.
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let legacy = header_version < SCHEMA_VERSION;
    let legacy_sidecar_present = legacy && sidecar_present;
    // Legacy inspection must not create or mutate SHM/WAL. Immutable mode
    // validates the checkpointed main file; any legacy sidecar then forces the
    // body-free degraded path without attempting recovery or migration.
    let connection = if legacy {
        let escaped = path
            .to_string_lossy()
            .replace('%', "%25")
            .replace('?', "%3F")
            .replace('#', "%23");
        Connection::open_with_flags(
            format!("file:{escaped}?immutable=1"),
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI,
        )
    } else {
        // V4 participates in normal SQLite WAL recovery so an already-committed
        // current generation is never ignored after a crash.
        Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
    }
    .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    classify_existing_connection(&connection, legacy_sidecar_present)
}

fn classify_existing_connection(
    connection: &Connection,
    legacy_sidecar_present: bool,
) -> Result<ExistingSchemaPreflight, ContinuityStoreError> {
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    match user_version {
        LEGACY_SCHEMA_VERSION => validate_legacy_schema(&connection)?,
        LEGACY_SCHEMA_VERSION_V2 => validate_v2_schema(&connection)?,
        PREVIOUS_SCHEMA_VERSION => validate_previous_schema(&connection)?,
        SCHEMA_VERSION => {
            validate_schema(&connection)?;
            return Ok(ExistingSchemaPreflight::Current);
        }
        _ => return Err(ContinuityStoreError::SchemaIncompatible),
    }
    if legacy_sidecar_present {
        Ok(ExistingSchemaPreflight::DegradedLegacy)
    } else if legacy_store_is_empty(&connection, user_version)? {
        Ok(ExistingSchemaPreflight::UpgradeEmptyLegacy)
    } else {
        Ok(ExistingSchemaPreflight::DegradedLegacy)
    }
}

fn read_sqlite_identity(path: &Path) -> Result<(i64, i64), ContinuityStoreError> {
    let mut header = [0u8; 100];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if &header[..16] != b"SQLite format 3\0" {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let version = u32::from_be_bytes(header[60..64].try_into().unwrap()) as i64;
    let application_id = u32::from_be_bytes(header[68..72].try_into().unwrap()) as i64;
    Ok((application_id, version))
}

fn validate_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if application_id != APPLICATION_ID || user_version != SCHEMA_VERSION {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    validate_record_schema(connection)?;
    validate_exact_table(
        connection,
        "continuity_owner_versions",
        CREATE_OWNER_VERSION_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("active_key_version", "INTEGER", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_rotation_journals",
        CREATE_ROTATION_JOURNAL_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("rotation_id", "TEXT", true, 0),
            ("envelope_json", "BLOB", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_rotation_receipts",
        CREATE_ROTATION_RECEIPT_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("rotation_id", "TEXT", true, 2),
            ("request_sha256", "TEXT", true, 0),
            ("envelope_json", "BLOB", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_source_mappings",
        CREATE_SOURCE_MAPPING_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("mapping_ref", "TEXT", true, 2),
            ("source_ref", "TEXT", true, 0),
            ("resident_pubkey", "TEXT", false, 0),
        ],
    )?;
    super::continuity_revision_authority::validate_authority_schema(connection)?;
    validate_exact_schema_inventory(connection, SCHEMA_VERSION)
}

fn validate_previous_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if application_id != APPLICATION_ID || user_version != PREVIOUS_SCHEMA_VERSION {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    validate_record_schema(connection)?;
    validate_exact_table(
        connection,
        "continuity_owner_versions",
        CREATE_OWNER_VERSION_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("active_key_version", "INTEGER", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_rotation_journals",
        CREATE_ROTATION_JOURNAL_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("rotation_id", "TEXT", true, 0),
            ("envelope_json", "BLOB", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_rotation_receipts",
        CREATE_ROTATION_RECEIPT_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("rotation_id", "TEXT", true, 2),
            ("request_sha256", "TEXT", true, 0),
            ("envelope_json", "BLOB", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_source_mappings",
        CREATE_SOURCE_MAPPING_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("mapping_ref", "TEXT", true, 2),
            ("source_ref", "TEXT", true, 0),
            ("resident_pubkey", "TEXT", false, 0),
        ],
    )?;
    validate_exact_schema_inventory(connection, PREVIOUS_SCHEMA_VERSION)
}

fn validate_v2_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if application_id != APPLICATION_ID || user_version != LEGACY_SCHEMA_VERSION_V2 {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    validate_record_schema(connection)?;
    validate_exact_table(
        connection,
        "continuity_owner_versions",
        CREATE_OWNER_VERSION_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("active_key_version", "INTEGER", true, 0),
        ],
    )?;
    validate_exact_table(
        connection,
        "continuity_rotation_journals",
        CREATE_ROTATION_JOURNAL_TABLE_SQL,
        &[
            ("owner_pubkey", "TEXT", true, 1),
            ("rotation_id", "TEXT", true, 0),
            ("envelope_json", "BLOB", true, 0),
        ],
    )?;
    validate_exact_schema_inventory(connection, LEGACY_SCHEMA_VERSION_V2)
}

fn legacy_store_is_empty(
    connection: &Connection,
    version: i64,
) -> Result<bool, ContinuityStoreError> {
    let mut tables = vec!["continuity_records"];
    if version >= LEGACY_SCHEMA_VERSION_V2 {
        tables.extend(["continuity_owner_versions", "continuity_rotation_journals"]);
    }
    if version >= PREVIOUS_SCHEMA_VERSION {
        tables.extend(["continuity_rotation_receipts", "continuity_source_mappings"]);
    }
    for table in tables {
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {table} LIMIT 1)");
        let populated: bool = connection
            .query_row(&sql, [], |row| row.get(0))
            .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
        if populated {
            return Ok(false);
        }
    }
    Ok(true)
}

fn require_empty_legacy(connection: &Connection, version: i64) -> Result<(), ContinuityStoreError> {
    if legacy_store_is_empty(connection, version)? {
        Ok(())
    } else {
        Err(ContinuityStoreError::AuthorityMigrationRequired)
    }
}

fn validate_legacy_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ContinuityStoreError::Unavailable)?;
    if application_id != APPLICATION_ID || user_version != LEGACY_SCHEMA_VERSION {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    validate_record_schema(connection)?;
    validate_exact_schema_inventory(connection, LEGACY_SCHEMA_VERSION)
}

fn validate_exact_schema_inventory(
    connection: &Connection,
    version: i64,
) -> Result<(), ContinuityStoreError> {
    let mut expected = vec!["continuity_records", "continuity_records_exact_scope"];
    if version >= LEGACY_SCHEMA_VERSION_V2 {
        expected.extend(["continuity_owner_versions", "continuity_rotation_journals"]);
    }
    if version >= PREVIOUS_SCHEMA_VERSION {
        expected.extend(["continuity_rotation_receipts", "continuity_source_mappings"]);
    }
    if version >= SCHEMA_VERSION {
        expected.extend_from_slice(super::continuity_revision_authority::AUTHORITY_TABLES);
        expected.extend_from_slice(super::continuity_revision_authority::AUTHORITY_INDEXES);
    }
    let placeholders = std::iter::repeat_n("?", expected.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
           AND (type NOT IN ('table','index') OR name NOT IN ({placeholders}))"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let extras: i64 = statement
        .query_row(rusqlite::params_from_iter(expected.iter()), |row| {
            row.get(0)
        })
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if extras != 0 {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let visible_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if visible_count != expected.len() as i64 {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    Ok(())
}

fn validate_record_schema(connection: &Connection) -> Result<(), ContinuityStoreError> {
    let (object_type, sql): (String, Option<String>) = connection
        .query_row(
            "SELECT type, sql FROM sqlite_master WHERE name = 'continuity_records'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if object_type != "table"
        || normalize_schema_sql(sql.as_deref().unwrap_or_default())
            != normalize_schema_sql(CREATE_TABLE_SQL)
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let required = [
        ("record_id", "TEXT", true, 1),
        ("namespace_protocol", "TEXT", true, 0),
        ("owner_pubkey", "TEXT", true, 0),
        ("namespace_kind", "TEXT", true, 0),
        ("resident_pubkey", "TEXT", false, 0),
        ("namespace_ref", "TEXT", true, 0),
        ("namespace_key_version", "INTEGER", true, 0),
        ("scope_protocol", "TEXT", true, 0),
        ("scope_namespace_ref", "TEXT", true, 0),
        ("scope_ref", "TEXT", true, 0),
        ("source_id", "TEXT", false, 0),
        ("project_id", "TEXT", false, 0),
        ("room_id", "TEXT", false, 0),
        ("conversation_id", "TEXT", false, 0),
        ("record_type", "TEXT", true, 0),
        ("revision", "INTEGER", true, 0),
        ("predecessor_record_id", "TEXT", false, 0),
        ("created_at", "TEXT", true, 0),
        ("author_kind", "TEXT", true, 0),
        ("key_version", "INTEGER", true, 0),
        ("nonce_b64", "TEXT", true, 0),
        ("envelope_json", "BLOB", true, 0),
    ];
    let mut statement = connection
        .prepare("PRAGMA table_info(continuity_records)")
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let actual = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let actual: Result<Vec<_>, _> = actual.collect();
    let actual = actual.map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if actual.len() != required.len()
        || actual.iter().zip(required).any(|(actual, required)| {
            actual.0 != required.0
                || actual.1.to_ascii_uppercase() != required.1
                || actual.2 != required.2
                || actual.3 != required.3
        })
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let nonce_columns = ["namespace_ref", "key_version", "nonce_b64"];
    let scope_columns = [
        "namespace_protocol",
        "owner_pubkey",
        "namespace_kind",
        "resident_pubkey",
        "namespace_ref",
        "namespace_key_version",
        "scope_protocol",
        "scope_namespace_ref",
        "scope_ref",
        "source_id",
        "project_id",
        "room_id",
        "conversation_id",
        "created_at",
        "record_id",
    ];
    let indexes = table_indexes(connection)?;
    if indexes.len() != 3
        || !indexes.iter().any(|index| {
            index.name == "continuity_records_exact_scope"
                && !index.unique
                && index.origin == "c"
                && !index.partial
                && index.columns.iter().map(String::as_str).eq(scope_columns)
        })
        || !indexes.iter().any(|index| {
            index.unique
                && index.origin == "u"
                && !index.partial
                && index.columns.iter().map(String::as_str).eq(nonce_columns)
        })
        || !indexes.iter().any(|index| {
            index.unique
                && index.origin == "pk"
                && !index.partial
                && index.columns.iter().map(String::as_str).eq(["record_id"])
        })
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    Ok(())
}

fn validate_exact_table(
    connection: &Connection,
    name: &str,
    expected_sql: &str,
    required: &[(&str, &str, bool, i64)],
) -> Result<(), ContinuityStoreError> {
    let (object_type, sql): (String, Option<String>) = connection
        .query_row(
            "SELECT type, sql FROM sqlite_master WHERE name = ?1",
            [name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if object_type != "table"
        || normalize_schema_sql(sql.as_deref().unwrap_or_default())
            != normalize_schema_sql(expected_sql)
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let pragma = format!("PRAGMA table_info({name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let actual = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)? != 0,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    if actual.len() != required.len()
        || actual.iter().zip(required).any(|(actual, required)| {
            actual.0 != required.0
                || actual.1.to_ascii_uppercase() != required.1
                || actual.2 != required.2
                || actual.3 != required.3
        })
    {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    Ok(())
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.chars()
        .filter(|character| !character.is_whitespace() && *character != ';')
        .flat_map(char::to_uppercase)
        .collect()
}

#[derive(Debug, PartialEq, Eq)]
struct StoredIndex {
    name: String,
    unique: bool,
    origin: String,
    partial: bool,
    columns: Vec<String>,
}

fn index_columns(
    connection: &Connection,
    index_name: &str,
) -> Result<Vec<String>, ContinuityStoreError> {
    let mut statement = connection
        .prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let rows = statement
        .query_map([index_name], |row| row.get::<_, String>(0))
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)
}

fn table_indexes(connection: &Connection) -> Result<Vec<StoredIndex>, ContinuityStoreError> {
    let mut statement = connection
        .prepare("PRAGMA index_list(continuity_records)")
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    let indexes = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)? != 0,
            ))
        })
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    drop(statement);

    let mut result = Vec::with_capacity(indexes.len());
    for (name, unique, origin, partial) in indexes {
        let columns = index_columns(connection, &name)?;
        result.push(StoredIndex {
            name,
            unique,
            origin,
            partial,
            columns,
        });
    }
    Ok(result)
}

fn validate_record(record: &ContinuityRecordV1) -> Result<(), ContinuityStoreError> {
    record
        .validate()
        .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    let address = NamespaceScope::new(
        NamespaceKey::new(record.namespace.clone())
            .map_err(|_| ContinuityStoreError::InvalidRecord)?,
        record.scope.clone(),
    )
    .map_err(|_| ContinuityStoreError::InvalidRecord)?;
    let aad = canonical_record_aad(record).map_err(|_| ContinuityStoreError::InvalidRecord)?;
    let digest = hex::encode(Sha256::digest(aad));
    if digest != record.aad_sha256.as_str() || address.as_protocol() != &record.scope {
        return Err(ContinuityStoreError::InvalidRecord);
    }
    Ok(())
}

pub(super) fn insert_record(
    transaction: &rusqlite::Transaction<'_>,
    record: &ContinuityRecordV1,
    encoded: &[u8],
) -> Result<(), ContinuityStoreError> {
    transaction.execute(
        "INSERT INTO continuity_records (
            record_id, namespace_protocol, owner_pubkey, namespace_kind, resident_pubkey,
            namespace_ref, namespace_key_version, scope_protocol, scope_namespace_ref, scope_ref,
            source_id, project_id, room_id, conversation_id, record_type, revision,
            predecessor_record_id, created_at, author_kind, key_version, nonce_b64, envelope_json
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
        )",
        params![
            record.record_id.as_str(), &record.namespace.protocol, record.namespace.owner_pubkey.as_str(),
            namespace_kind(record.namespace.kind), record.namespace.resident_pubkey.as_ref().map(|key| key.as_str()),
            record.namespace.namespace_ref.as_str(), record.namespace.key_version.get() as i64,
            &record.scope.protocol, record.scope.namespace_ref.as_str(), record.scope.scope_ref.as_str(),
            record.scope.source_id.as_ref().map(|id| id.as_str()), record.scope.project_id.as_ref().map(|id| id.as_str()),
            record.scope.room_id.as_ref().map(|id| id.as_str()), record.scope.conversation_id.as_ref().map(|id| id.as_str()),
            record.record_type.as_str(), record.revision.get() as i64, record.predecessor_record_id.as_ref().map(|id| id.as_str()),
            record.created_at.as_str(), record.author_kind.as_str(), record.key_version.get() as i64,
            &record.nonce_b64, encoded,
        ],
    ).map_err(|error| match error.sqlite_error_code() {
        Some(ErrorCode::ConstraintViolation) => ContinuityStoreError::NonceCollision,
        _ => ContinuityStoreError::Unavailable,
    })?;
    Ok(())
}

fn namespace_kind(kind: ContinuityNamespaceKindV1) -> &'static str {
    match kind {
        ContinuityNamespaceKindV1::OwnerBrain => "owner_brain",
        ContinuityNamespaceKindV1::ResidentPrivate => "resident_private",
    }
}

fn ensure_private_directory(path: &Path) -> Result<(), ContinuityStoreError> {
    fs::create_dir_all(path).map_err(|_| ContinuityStoreError::Unavailable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), ContinuityStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(ContinuityStoreError::SchemaIncompatible)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ContinuityStoreError::Unavailable),
    }
}

fn ensure_private_file(path: &Path) -> Result<(), ContinuityStoreError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        process::Command,
        thread,
        time::{Duration, Instant},
    };

    use super::*;
    use base64::Engine as _;
    use luca_continuity::{encrypt_record, RecordMetadata};
    use luca_protocol::{
        CanonicalTimestamp, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
        Sha256Ref, CONTINUITY_PROTOCOL,
    };
    use tempfile::TempDir;

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }
    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }
    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).unwrap()
    }
    fn metadata(record_id: &str) -> RecordMetadata {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: hex('1'),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex('2')),
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        };
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: id(record_id),
            namespace: namespace.clone(),
            scope: ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref.clone(),
                scope_ref: sha('4'),
                source_id: Some(id("source-1")),
                project_id: None,
                room_id: None,
                conversation_id: Some(id("conversation-1")),
            },
            record_type: id("hypomnema"),
            revision: SafeU53::new(0).unwrap(),
            predecessor_record_id: None,
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: id("resident"),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).unwrap(),
        }
    }
    fn open(temp: &TempDir) -> ContinuityStore {
        match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap() {
            ContinuityStoreOpen::Ready(store) => store,
            _ => panic!("expected ready"),
        }
    }
    fn address(metadata: &RecordMetadata) -> NamespaceScope {
        NamespaceScope::new(
            NamespaceKey::new(metadata.namespace.clone()).unwrap(),
            metadata.scope.clone(),
        )
        .unwrap()
    }
    fn read(path: &Path) -> Vec<u8> {
        fs::read(path).unwrap_or_default()
    }
    fn sidecar_snapshot(path: &Path) -> Vec<(bool, Vec<u8>)> {
        [
            path.to_owned(),
            path.with_extension("sqlite3-wal"),
            path.with_extension("sqlite3-shm"),
        ]
        .iter()
        .map(|path| (path.exists(), read(path)))
        .collect()
    }
    fn create_custom_schema(temp: &TempDir, table_sql: &str, index_sql: &str) -> PathBuf {
        let directory = temp.path().join(STORE_DIRECTORY);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(STORE_FILENAME);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(&format!(
                "PRAGMA journal_mode = DELETE;
                 {table_sql};
                 {index_sql};
                 PRAGMA application_id = {APPLICATION_ID};
                 PRAGMA user_version = {SCHEMA_VERSION};"
            ))
            .unwrap();
        drop(connection);
        path
    }
    fn create_exact_legacy_store(temp: &TempDir, version: i64, with_record: bool) -> PathBuf {
        let directory = temp.path().join(STORE_DIRECTORY);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(STORE_FILENAME);
        let mut connection = Connection::open(&path).unwrap();
        let mut schema = format!(
            "PRAGMA journal_mode=DELETE;
             {CREATE_TABLE_SQL};
             {CREATE_SCOPE_INDEX_SQL};"
        );
        if version >= LEGACY_SCHEMA_VERSION_V2 {
            schema.push_str(CREATE_OWNER_VERSION_TABLE_SQL);
            schema.push(';');
            schema.push_str(CREATE_ROTATION_JOURNAL_TABLE_SQL);
            schema.push(';');
        }
        if version >= PREVIOUS_SCHEMA_VERSION {
            schema.push_str(CREATE_ROTATION_RECEIPT_TABLE_SQL);
            schema.push(';');
            schema.push_str(CREATE_SOURCE_MAPPING_TABLE_SQL);
            schema.push(';');
        }
        schema.push_str(&format!(
            "PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version={version};"
        ));
        connection.execute_batch(&schema).unwrap();
        if with_record {
            let record = encrypt_record(metadata("legacy-record"), &[0x44; 32], b"legacy").unwrap();
            let encoded = canonicalize(&record).unwrap();
            let transaction = connection.transaction().unwrap();
            insert_record(&transaction, &record, &encoded).unwrap();
            transaction.commit().unwrap();
        }
        drop(connection);
        path
    }
    fn assert_schema_rejected_without_mutation(temp: &TempDir, path: &Path) {
        let before = sidecar_snapshot(path);
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Err(ContinuityStoreError::SchemaIncompatible)
        ));
        assert_eq!(before, sidecar_snapshot(path));
    }

    #[test]
    fn initializes_private_dedicated_database_with_frozen_pragmas() {
        let temp = TempDir::new().unwrap();
        let store = open(&temp);
        assert_eq!(
            store.path_for_test(),
            temp.path().join(STORE_DIRECTORY).join(STORE_FILENAME)
        );
        let journal: String = store
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        let timeout: i64 = store
            .connection
            .pragma_query_value(None, "busy_timeout", |row| row.get(0))
            .unwrap();
        let application_id: i64 = store
            .connection
            .pragma_query_value(None, "application_id", |row| row.get(0))
            .unwrap();
        let user_version: i64 = store
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let foreign_keys: i64 = store
            .connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        let trusted_schema: i64 = store
            .connection
            .pragma_query_value(None, "trusted_schema", |row| row.get(0))
            .unwrap();
        let temp_store: i64 = store
            .connection
            .pragma_query_value(None, "temp_store", |row| row.get(0))
            .unwrap();
        let secure_delete: i64 = store
            .connection
            .pragma_query_value(None, "secure_delete", |row| row.get(0))
            .unwrap();
        let synchronous: i64 = store
            .connection
            .pragma_query_value(None, "synchronous", |row| row.get(0))
            .unwrap();
        assert_eq!(journal, "wal");
        assert_eq!(timeout, 5000);
        assert_eq!(application_id, APPLICATION_ID);
        assert_eq!(user_version, SCHEMA_VERSION);
        assert_eq!(foreign_keys, 1);
        assert_eq!(trusted_schema, 0);
        assert_eq!(temp_store, 2);
        assert_eq!(secure_delete, 1);
        assert_eq!(synchronous, 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(temp.path().join(STORE_DIRECTORY))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(store.path_for_test())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn exact_empty_v1_v2_v3_upgrade_to_v4_without_owner_authority() {
        for version in [
            LEGACY_SCHEMA_VERSION,
            LEGACY_SCHEMA_VERSION_V2,
            PREVIOUS_SCHEMA_VERSION,
        ] {
            let temp = TempDir::new().unwrap();
            create_exact_legacy_store(&temp, version, false);
            let store = open(&temp);
            let user_version: i64 = store
                .connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap();
            let owners: i64 = store
                .connection
                .query_row(
                    "SELECT COUNT(*) FROM continuity_authority_meta",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(user_version, SCHEMA_VERSION);
            assert_eq!(owners, 0);
        }
    }

    #[test]
    fn checkpointed_wal_legacy_is_forced_to_rollback_mode_before_upgrade() {
        let temp = TempDir::new().unwrap();
        let path = create_exact_legacy_store(&temp, PREVIOUS_SCHEMA_VERSION, false);
        let connection = Connection::open(&path).unwrap();
        let mode: String = connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "delete");
        connection
            .execute_batch("PRAGMA journal_mode=WAL;")
            .unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        drop(connection);
        assert!(fs::metadata(path.with_extension("sqlite3-wal"))
            .map(|metadata| metadata.len() == 0)
            .unwrap_or(true));

        let store = open(&temp);
        let version: i64 = store
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let mode: String = store
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(mode, "wal");
    }

    #[test]
    fn nonempty_v1_v2_v3_degrade_without_changing_database_or_sidecars() {
        for version in [
            LEGACY_SCHEMA_VERSION,
            LEGACY_SCHEMA_VERSION_V2,
            PREVIOUS_SCHEMA_VERSION,
        ] {
            let temp = TempDir::new().unwrap();
            let path = create_exact_legacy_store(&temp, version, true);
            let before = sidecar_snapshot(&path);
            assert!(matches!(
                ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
                Ok(ContinuityStoreOpen::Degraded(
                    ContinuityStoreDegradedReason::AuthorityMigrationRequired
                ))
            ));
            assert_eq!(before, sidecar_snapshot(&path));
        }
    }

    #[test]
    fn legacy_wal_state_degrades_without_recovery_or_sidecar_mutation() {
        let temp = TempDir::new().unwrap();
        let path = create_exact_legacy_store(&temp, PREVIOUS_SCHEMA_VERSION, false);
        let mut writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;")
            .unwrap();
        let record = encrypt_record(metadata("legacy-wal-record"), &[0x45; 32], b"legacy").unwrap();
        let encoded = canonicalize(&record).unwrap();
        let transaction = writer.transaction().unwrap();
        insert_record(&transaction, &record, &encoded).unwrap();
        transaction.commit().unwrap();
        let before = sidecar_snapshot(&path);
        assert!(before[1].0 && before[2].0);
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Ok(ContinuityStoreOpen::Degraded(
                ContinuityStoreDegradedReason::AuthorityMigrationRequired
            ))
        ));
        assert_eq!(before, sidecar_snapshot(&path));
        drop(writer);
    }

    #[test]
    fn locked_key_degrades_without_creating_database() {
        let temp = TempDir::new().unwrap();
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Locked).unwrap(),
            ContinuityStoreOpen::Degraded(ContinuityStoreDegradedReason::KeyLocked)
        ));
        assert!(!temp.path().join(STORE_DIRECTORY).exists());
    }

    #[test]
    fn exact_scope_replay_conflict_and_nonce_rules_hold() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [7_u8; 32];
        let record_metadata = metadata("record-1");
        let record =
            encrypt_record(record_metadata.clone(), &key, b"private continuity body").unwrap();
        assert_eq!(
            store.put_encrypted(&record),
            Ok(RecordWriteOutcome::Inserted)
        );
        assert_eq!(
            store.put_encrypted(&record),
            Ok(RecordWriteOutcome::Replayed)
        );
        let changed = encrypt_record(record_metadata.clone(), &key, b"changed").unwrap();
        assert_eq!(
            store.put_encrypted(&changed),
            Err(ContinuityStoreError::ReplayConflict)
        );
        let mut collision = encrypt_record(metadata("record-2"), &key, b"other").unwrap();
        collision.nonce_b64 = record.nonce_b64.clone();
        let aad = canonical_record_aad(&collision).unwrap();
        collision.aad_sha256 = Hex64::parse(hex::encode(Sha256::digest(aad))).unwrap();
        assert_eq!(
            store.put_encrypted(&collision),
            Err(ContinuityStoreError::NonceCollision)
        );
        let results = store
            .load_encrypted_exact(&address(&record_metadata))
            .unwrap();
        assert_eq!(results, vec![record]);
    }

    #[test]
    fn newer_schema_fails_closed() {
        let temp = TempDir::new().unwrap();
        let store = open(&temp);
        let path = store.path_for_test().to_owned();
        drop(store);
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .unwrap();
        drop(connection);
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Err(ContinuityStoreError::SchemaIncompatible)
        ));
    }

    #[test]
    fn incompatible_existing_database_is_rejected_without_mutation() {
        let temp = TempDir::new().unwrap();
        let directory = temp.path().join(STORE_DIRECTORY);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(STORE_FILENAME);
        fs::write(&path, b"FOREIGN_CONTINUITY_DB_SENTINEL").unwrap();
        let before = read(&path);
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Err(ContinuityStoreError::SchemaIncompatible)
        ));
        let after = read(&path);
        assert_eq!(before, after);
        assert!(!path.with_extension("sqlite3-wal").exists());
        assert!(!path.with_extension("sqlite3-shm").exists());
    }

    #[test]
    fn ambiguous_header_zero_with_sidecars_fails_without_any_side_effect() {
        let temp = TempDir::new().unwrap();
        let directory = temp.path().join(STORE_DIRECTORY);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join(STORE_FILENAME);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("CREATE TABLE ambiguous_sentinel(value INTEGER);")
            .unwrap();
        drop(connection);
        assert_eq!(read_sqlite_identity(&path).unwrap(), (0, 0));
        fs::write(path.with_extension("sqlite3-wal"), b"AMBIGUOUS_WAL").unwrap();
        fs::write(path.with_extension("sqlite3-shm"), b"AMBIGUOUS_SHM").unwrap();
        let before = sidecar_snapshot(&path);
        let entries_before = fs::read_dir(&directory).unwrap().count();

        assert_eq!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready).unwrap_err(),
            ContinuityStoreError::SchemaIncompatible
        );
        assert_eq!(before, sidecar_snapshot(&path));
        assert_eq!(entries_before, fs::read_dir(&directory).unwrap().count());
    }

    #[test]
    fn every_schema_version_rejects_extra_application_objects_without_mutation() {
        for version in [
            LEGACY_SCHEMA_VERSION,
            LEGACY_SCHEMA_VERSION_V2,
            PREVIOUS_SCHEMA_VERSION,
            SCHEMA_VERSION,
        ] {
            let temp = TempDir::new().unwrap();
            let path = if version == SCHEMA_VERSION {
                let store = open(&temp);
                let path = store.path_for_test().to_owned();
                drop(store);
                path
            } else {
                create_exact_legacy_store(&temp, version, false)
            };
            let connection = Connection::open(&path).unwrap();
            connection
                .execute_batch(
                    "PRAGMA journal_mode=DELETE;
                     CREATE TABLE rogue_table(value INTEGER);
                     CREATE INDEX rogue_index ON continuity_records(record_type);
                     CREATE VIEW rogue_view AS SELECT record_id FROM continuity_records;
                     CREATE TRIGGER rogue_trigger AFTER INSERT ON continuity_records
                     BEGIN SELECT 1; END;",
                )
                .unwrap();
            drop(connection);
            assert_schema_rejected_without_mutation(&temp, &path);
        }
    }

    #[test]
    fn subprocess_crash_writer_helper() {
        let Ok(root) = std::env::var("LUCA_CONTINUITY_CRASH_TEST_ROOT") else {
            return;
        };
        let ready_path = std::env::var("LUCA_CONTINUITY_CRASH_TEST_READY")
            .expect("parent must provide a readiness path");
        let mut store =
            match ContinuityStore::open(Path::new(&root), ContinuityStoreCustody::Ready).unwrap() {
                ContinuityStoreOpen::Ready(store) => store,
                ContinuityStoreOpen::Degraded(_) => panic!("expected ready"),
            };
        store
            .connection
            .execute_batch("PRAGMA wal_autocheckpoint = 0;")
            .unwrap();
        let record =
            encrypt_record(metadata("subprocess-crash-record"), &[0x42; 32], b"body").unwrap();
        store.put_encrypted(&record).unwrap();
        assert!(store.path_for_test().with_extension("sqlite3-wal").exists());
        fs::write(ready_path, b"ready").unwrap();
        loop {
            thread::park();
        }
    }

    #[test]
    fn normal_wal_shm_crash_state_reopens_and_recovers() {
        let temp = TempDir::new().unwrap();
        let ready_path = temp.path().join("writer-ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("luca::continuity_store::tests::subprocess_crash_writer_helper")
            .arg("--nocapture")
            .env("LUCA_CONTINUITY_CRASH_TEST_ROOT", temp.path())
            .env("LUCA_CONTINUITY_CRASH_TEST_READY", &ready_path)
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready_path.exists() {
            assert!(
                child.try_wait().unwrap().is_none(),
                "crash writer exited before publishing its WAL readiness marker"
            );
            assert!(
                Instant::now() < deadline,
                "crash writer did not publish its readiness marker"
            );
            thread::sleep(Duration::from_millis(10));
        }
        child.kill().unwrap();
        let status = child.wait().unwrap();
        assert!(!status.success());
        let path = temp.path().join(STORE_DIRECTORY).join(STORE_FILENAME);
        assert!(path.with_extension("sqlite3-wal").exists());
        let mut store = open(&temp);
        let record_metadata = metadata("subprocess-crash-record");
        assert_eq!(
            store
                .load_encrypted_exact(&address(&record_metadata))
                .unwrap()
                .len(),
            1
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_store_directory_file_and_sidecar_are_rejected() {
        use std::os::unix::fs::symlink;

        let directory_link = TempDir::new().unwrap();
        let elsewhere = TempDir::new().unwrap();
        symlink(
            elsewhere.path(),
            directory_link.path().join(STORE_DIRECTORY),
        )
        .unwrap();
        assert_eq!(
            ContinuityStore::open(directory_link.path(), ContinuityStoreCustody::Ready)
                .unwrap_err(),
            ContinuityStoreError::SchemaIncompatible
        );

        let file_link = TempDir::new().unwrap();
        let directory = file_link.path().join(STORE_DIRECTORY);
        fs::create_dir_all(&directory).unwrap();
        let target = file_link.path().join("target.sqlite3");
        fs::write(&target, []).unwrap();
        symlink(&target, directory.join(STORE_FILENAME)).unwrap();
        assert_eq!(
            ContinuityStore::open(file_link.path(), ContinuityStoreCustody::Ready).unwrap_err(),
            ContinuityStoreError::SchemaIncompatible
        );

        let sidecar_link = TempDir::new().unwrap();
        let store = open(&sidecar_link);
        let path = store.path_for_test().to_owned();
        drop(store);
        let sidecar_target = sidecar_link.path().join("sidecar-target");
        fs::write(&sidecar_target, []).unwrap();
        symlink(&sidecar_target, path.with_extension("sqlite3-wal")).unwrap();
        assert_eq!(
            ContinuityStore::open(sidecar_link.path(), ContinuityStoreCustody::Ready).unwrap_err(),
            ContinuityStoreError::SchemaIncompatible
        );
    }

    #[test]
    fn snapshot_overflow_and_truncation_guards_fail_closed() {
        assert_eq!(
            validate_snapshot_totals(MAX_CONTINUITY_SNAPSHOT_RECORDS as i64 + 1, 0, 0),
            Err(ContinuityStoreError::SnapshotBoundExceeded)
        );
        assert_eq!(
            validate_snapshot_totals(1, MAX_CONTINUITY_SNAPSHOT_BYTES as i64 + 1, 0),
            Err(ContinuityStoreError::SnapshotBoundExceeded)
        );
        assert_eq!(
            ensure_snapshot_complete(2, 1),
            Err(ContinuityStoreError::CompareAndSwapConflict)
        );
    }

    #[test]
    fn restore_and_rotation_reads_reject_malformed_scalars_before_allocation() {
        let temp = TempDir::new().unwrap();
        let store = open(&temp);
        let owner = hex('1');

        store
            .connection
            .execute(
                "INSERT INTO continuity_owner_versions(owner_pubkey, active_key_version)
                 VALUES (zeroblob(129), 1)",
                [],
            )
            .unwrap();
        assert_eq!(
            store.restore_destination(&owner),
            Err(ContinuityStoreError::InvalidRecord)
        );
        store
            .connection
            .execute("DELETE FROM continuity_owner_versions", [])
            .unwrap();

        store
            .connection
            .execute(
                "INSERT INTO continuity_rotation_journals(owner_pubkey, rotation_id, envelope_json)
                 VALUES (?1, zeroblob(129), x'00')",
                [owner.as_str()],
            )
            .unwrap();
        assert_eq!(
            store.load_rotation_journal(&owner),
            Err(ContinuityStoreError::InvalidRecord)
        );
        store
            .connection
            .execute("DELETE FROM continuity_rotation_journals", [])
            .unwrap();

        store
            .connection
            .execute(
                "INSERT INTO continuity_rotation_receipts(
                     owner_pubkey, rotation_id, request_sha256, envelope_json
                 ) VALUES (?1, 'rotation-1', zeroblob(65), x'00')",
                [owner.as_str()],
            )
            .unwrap();
        assert_eq!(
            store.load_rotation_receipt(&owner, "rotation-1"),
            Err(ContinuityStoreError::InvalidRecord)
        );
        assert_eq!(
            store.load_rotation_receipt(&owner, &"r".repeat(129)),
            Err(ContinuityStoreError::InvalidRecord)
        );
    }

    #[test]
    fn structurally_inconsistent_v1_schema_is_rejected() {
        let temp = TempDir::new().unwrap();
        let store = open(&temp);
        let path = store.path_for_test().to_owned();
        drop(store);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "PRAGMA journal_mode = DELETE;
                 DROP INDEX continuity_records_exact_scope;",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Err(ContinuityStoreError::SchemaIncompatible)
        ));
    }

    #[test]
    fn weakened_namespace_check_is_rejected_without_mutation() {
        let temp = TempDir::new().unwrap();
        let weakened_table = CREATE_TABLE_SQL.replace(
            "CHECK(namespace_kind IN ('owner_brain', 'resident_private'))",
            "CHECK(namespace_kind IN ('owner_brain', 'resident_private') OR 1)",
        );
        let path = create_custom_schema(&temp, &weakened_table, CREATE_SCOPE_INDEX_SQL);
        assert_schema_rejected_without_mutation(&temp, &path);
    }

    #[test]
    fn partial_scope_index_is_rejected_without_mutation() {
        let temp = TempDir::new().unwrap();
        let partial_index = format!("{CREATE_SCOPE_INDEX_SQL} WHERE record_id IS NOT NULL");
        let path = create_custom_schema(&temp, CREATE_TABLE_SQL, &partial_index);
        assert_schema_rejected_without_mutation(&temp, &path);
    }

    #[test]
    fn corrupt_rows_are_skipped_without_repair_or_plaintext_leakage() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [0x42_u8; 32];
        let metadata = metadata("record-1");
        let record = encrypt_record(metadata.clone(), &key, b"UNIQUE_PRIVATE_BODY_7FDE").unwrap();
        store.put_encrypted(&record).unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_records SET envelope_json = x'00' WHERE record_id = ?1",
                [record.record_id.as_str()],
            )
            .unwrap();
        let before = store
            .connection
            .query_row(
                "SELECT envelope_json FROM continuity_records WHERE record_id = ?1",
                [record.record_id.as_str()],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .unwrap();
        assert!(store
            .load_encrypted_exact(&address(&metadata))
            .unwrap()
            .is_empty());
        let after = store
            .connection
            .query_row(
                "SELECT envelope_json FROM continuity_records WHERE record_id = ?1",
                [record.record_id.as_str()],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(
            store.diagnostics(),
            &[ContinuityStoreDiagnostic::CorruptEnvelopeSkipped]
        );
        let mut bytes = read(store.path_for_test());
        bytes.extend(read(&store.path_for_test().with_extension("sqlite3-wal")));
        bytes.extend(read(&store.path_for_test().with_extension("sqlite3-shm")));
        assert!(!String::from_utf8_lossy(&bytes).contains("UNIQUE_PRIVATE_BODY_7FDE"));
        assert!(!bytes.windows(key.len()).any(|window| window == key));
        let key_hex = hex::encode(key);
        let key_b64 = base64::engine::general_purpose::STANDARD.encode(key);
        let printable = String::from_utf8_lossy(&bytes);
        assert!(!printable.contains(&key_hex));
        assert!(!printable.contains(&key_b64));
        assert!(!format!("{:?}", store).contains("UNIQUE_PRIVATE_BODY_7FDE"));
        assert!(!format!("{:?}", store).contains(&key_hex));
    }

    #[test]
    fn envelope_ceiling_is_exact_and_oversized_blob_is_not_loaded() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [7_u8; 32];
        let boundary_metadata = metadata("record-boundary");
        let oversized_metadata = metadata("record-oversized");
        let boundary = encrypt_record(boundary_metadata.clone(), &key, b"small").unwrap();
        let oversized = encrypt_record(oversized_metadata.clone(), &key, b"small").unwrap();
        store.put_encrypted(&boundary).unwrap();
        store.put_encrypted(&oversized).unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_records SET envelope_json = zeroblob(?1) WHERE record_id = ?2",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64,
                    boundary.record_id.as_str()
                ],
            )
            .unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_records SET envelope_json = zeroblob(?1) WHERE record_id = ?2",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64 + 1,
                    oversized.record_id.as_str()
                ],
            )
            .unwrap();
        assert!(store
            .load_encrypted_exact(&address(&boundary_metadata))
            .unwrap()
            .is_empty());
        assert_eq!(
            store.diagnostics(),
            &[
                ContinuityStoreDiagnostic::CorruptEnvelopeSkipped,
                ContinuityStoreDiagnostic::OversizedEnvelopeSkipped,
            ]
        );
    }

    #[test]
    fn replay_path_checks_length_before_loading_existing_blob() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [7_u8; 32];
        let record = encrypt_record(metadata("record-replay-bound"), &key, b"small").unwrap();
        store.put_encrypted(&record).unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_records SET envelope_json = zeroblob(?1)
                 WHERE record_id = ?2",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64 + 1,
                    record.record_id.as_str()
                ],
            )
            .unwrap();

        assert_eq!(
            store.put_encrypted(&record),
            Err(ContinuityStoreError::ReplayConflict)
        );
        assert!(store.diagnostics().is_empty());
    }

    #[test]
    fn load_uses_bounded_rowid_handle_and_rejects_corrupt_stored_id() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [7_u8; 32];
        let record_metadata = metadata("record-corrupt-id");
        let record = encrypt_record(record_metadata.clone(), &key, b"small").unwrap();
        store.put_encrypted(&record).unwrap();
        store
            .connection
            .execute(
                "UPDATE continuity_records SET record_id = zeroblob(?1)
                 WHERE record_id = ?2",
                params![
                    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64 + 1,
                    record.record_id.as_str()
                ],
            )
            .unwrap();

        assert!(store
            .load_encrypted_exact(&address(&record_metadata))
            .unwrap()
            .is_empty());
        assert_eq!(
            store.diagnostics(),
            &[ContinuityStoreDiagnostic::CorruptEnvelopeSkipped]
        );
    }

    #[test]
    fn nul_prefixed_text_storage_never_reaches_blob_fetch() {
        let temp = TempDir::new().unwrap();
        let mut store = open(&temp);
        let key = [7_u8; 32];
        let load_metadata = metadata("record-text-load");
        let replay_metadata = metadata("record-text-replay");
        let load_record = encrypt_record(load_metadata.clone(), &key, b"small").unwrap();
        let replay_record = encrypt_record(replay_metadata, &key, b"small").unwrap();
        store.put_encrypted(&load_record).unwrap();
        store.put_encrypted(&replay_record).unwrap();

        let corrupt_text = format!(
            "\0{}",
            "x".repeat(MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES + 1)
        );
        for record_id in [
            load_record.record_id.as_str(),
            replay_record.record_id.as_str(),
        ] {
            store
                .connection
                .execute(
                    "UPDATE continuity_records SET envelope_json = ?1 WHERE record_id = ?2",
                    params![&corrupt_text, record_id],
                )
                .unwrap();
        }
        let (storage_class, text_length, byte_length): (String, i64, i64) = store
            .connection
            .query_row(
                "SELECT typeof(envelope_json), length(envelope_json),
                        length(CAST(envelope_json AS BLOB))
                 FROM continuity_records WHERE record_id = ?1",
                [load_record.record_id.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(storage_class, "text");
        assert_eq!(text_length, 0);
        assert!(byte_length > MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES as i64);

        assert!(store
            .load_encrypted_exact(&address(&load_metadata))
            .unwrap()
            .is_empty());
        assert_eq!(
            store.put_encrypted(&replay_record),
            Err(ContinuityStoreError::ReplayConflict)
        );
        assert_eq!(
            store.diagnostics(),
            &[
                ContinuityStoreDiagnostic::CorruptEnvelopeSkipped,
                ContinuityStoreDiagnostic::CorruptEnvelopeSkipped,
            ]
        );
    }
}

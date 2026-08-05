//! Trusted, encrypted SQLite persistence for G2 continuity envelopes.
//!
//! This module stores only validated encrypted envelopes and body-free routing
//! metadata. It deliberately does not decrypt records: callers must treat every
//! load as structural and unauthenticated until the encrypted envelope is later
//! authenticated with its exact derived namespace key.

use std::{
    fmt, fs,
    path::{Path, PathBuf},
};

use luca_continuity::{
    canonical_record_aad, NamespaceKey, NamespaceScope, RecordWriteOutcome,
    MAX_SERIALIZED_ENCRYPTED_RECORD_BYTES,
};
use luca_protocol::{canonicalize, ContinuityNamespaceKindV1, ContinuityRecordV1};
use rusqlite::{params, Connection, ErrorCode, OpenFlags, OptionalExtension, TransactionBehavior};
use sha2::{Digest, Sha256};

use super::continuity_key_custody::ContinuityKeyCustodyStatus;

const STORE_DIRECTORY: &str = "continuity";
const STORE_FILENAME: &str = "continuity-v1.sqlite3";
const APPLICATION_ID: i64 = 0x4c55_4341; // "LUCA"
const SCHEMA_VERSION: i64 = 1;
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
    connection: Connection,
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
        // Existing bytes are preflighted through a read-only connection before
        // WAL, a checkpoint, permissions, or schema setup can mutate a foreign,
        // newer, or inconsistent database.
        if path.exists() {
            preflight_existing_schema(&path)?;
        }
        ensure_private_directory(&directory)?;
        let connection = Connection::open(&path).map_err(|_| ContinuityStoreError::Unavailable)?;
        ensure_private_file(&path)?;
        configure_connection(&connection)?;
        initialize_schema(&connection)?;
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
        self.connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
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

impl Drop for ContinuityStore {
    fn drop(&mut self) {
        // Best effort only: close must never affect application shutdown or chat.
        let _ = self
            .connection
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

fn configure_connection(connection: &Connection) -> Result<(), ContinuityStoreError> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
         PRAGMA busy_timeout = 5000;
         PRAGMA foreign_keys = ON;
         PRAGMA trusted_schema = OFF;
         PRAGMA temp_store = MEMORY;
         PRAGMA secure_delete = ON;
         PRAGMA synchronous = FULL;",
        )
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
                 PRAGMA application_id = {APPLICATION_ID};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;"
            ))
            .map_err(|_| ContinuityStoreError::Unavailable)?;
    }
    validate_schema(connection)
}

/// Check an existing database without a write-capable connection. Any unknown,
/// newer, corrupted, or inconsistent store is refused before initialization.
fn preflight_existing_schema(path: &Path) -> Result<(), ContinuityStoreError> {
    // Opening a WAL database read-only can create or update its shared-memory
    // sidecar. Immutable mode avoids that write but intentionally ignores WAL,
    // so a sidecar is an uninspectable freshness ambiguity. G2 is single-writer
    // and fail-soft: reject it without touching any continuity bytes.
    if path.with_extension("sqlite3-wal").exists() || path.with_extension("sqlite3-shm").exists() {
        return Err(ContinuityStoreError::SchemaIncompatible);
    }
    let mut uri =
        url::Url::from_file_path(path).map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    uri.query_pairs_mut().append_pair("immutable", "1");
    let connection = Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|_| ContinuityStoreError::SchemaIncompatible)?;
    validate_schema(&connection).map_err(|_| ContinuityStoreError::SchemaIncompatible)
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

fn insert_record(
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
        connection.pragma_update(None, "user_version", 2).unwrap();
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
    fn wal_mode_rejection_does_not_touch_any_existing_sidecar() {
        let temp = TempDir::new().unwrap();
        let store = open(&temp);
        let path = store.path_for_test().to_owned();
        drop(store);
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA wal_autocheckpoint = 0;
                 PRAGMA user_version = 2;",
            )
            .unwrap();
        let sidecars = [
            path.clone(),
            path.with_extension("sqlite3-wal"),
            path.with_extension("sqlite3-shm"),
        ];
        assert!(sidecars[1].exists());
        assert!(sidecars[2].exists());
        let before: Vec<Vec<u8>> = sidecars.iter().map(|path| read(path)).collect();
        assert!(matches!(
            ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready),
            Err(ContinuityStoreError::SchemaIncompatible)
        ));
        let after: Vec<Vec<u8>> = sidecars.iter().map(|path| read(path)).collect();
        assert_eq!(before, after);
        drop(writer);
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

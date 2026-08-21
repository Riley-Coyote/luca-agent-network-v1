use std::{fs, path::Path};

use rusqlite::{Connection, OpenFlags};

use super::ArtifactStoreError;

pub(super) const APPLICATION_ID: i32 = 0x4c_55_43_41;
pub(super) const SCHEMA_VERSION: i64 = 1;

const SCHEMA_SQL: &str = r#"
CREATE TABLE artifacts (
    owner_pubkey TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    current_version INTEGER NOT NULL CHECK (current_version > 0),
    receipt_state TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
    created_by_pubkey TEXT NOT NULL,
    conversation_id TEXT,
    source_turn_id TEXT,
    dispatch_receipt_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY (owner_pubkey, artifact_id)
) STRICT;

CREATE TABLE artifact_versions (
    owner_pubkey TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    parent_version INTEGER,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    aggregate_hash TEXT NOT NULL,
    blob_hash TEXT,
    media_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    source_type TEXT NOT NULL,
    source_relative_path TEXT,
    working_root_id TEXT,
    created_by_pubkey TEXT NOT NULL,
    conversation_id TEXT,
    source_turn_id TEXT,
    dispatch_receipt_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_pubkey, artifact_id, version),
    UNIQUE (owner_pubkey, idempotency_key),
    FOREIGN KEY (owner_pubkey, artifact_id)
      REFERENCES artifacts(owner_pubkey, artifact_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE artifact_receipts (
    owner_pubkey TEXT NOT NULL,
    receipt_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    resident_pubkey TEXT NOT NULL,
    conversation_id TEXT,
    turn_id TEXT,
    dispatch_receipt_id TEXT,
    message_id TEXT,
    state TEXT NOT NULL,
    created_at TEXT NOT NULL,
    linked_at TEXT,
    PRIMARY KEY (owner_pubkey, receipt_id),
    FOREIGN KEY (owner_pubkey, artifact_id, version)
      REFERENCES artifact_versions(owner_pubkey, artifact_id, version) ON DELETE CASCADE
) STRICT;

CREATE INDEX artifacts_owner_updated
  ON artifacts(owner_pubkey, deleted_at, pinned DESC, updated_at DESC, artifact_id DESC);
CREATE INDEX artifact_versions_owner_artifact
  ON artifact_versions(owner_pubkey, artifact_id, version DESC);
CREATE INDEX artifact_versions_blob
  ON artifact_versions(blob_hash) WHERE blob_hash IS NOT NULL;
CREATE INDEX artifact_receipts_turn
  ON artifact_receipts(owner_pubkey, conversation_id, turn_id, created_at DESC);
"#;

pub(super) fn open_database(path: &Path) -> Result<Connection, ArtifactStoreError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(ArtifactStoreError::SchemaIncompatible);
        }
    }
    for sidecar in [
        path.with_extension("sqlite3-wal"),
        path.with_extension("sqlite3-shm"),
    ] {
        if fs::symlink_metadata(sidecar).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
            return Err(ArtifactStoreError::SchemaIncompatible);
        }
    }

    let existed = path.exists();
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ArtifactStoreError::Unavailable)?;
    connection
        .execute_batch("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;")
        .map_err(|_| ArtifactStoreError::Unavailable)?;

    if existed {
        validate_identity(&connection)?;
    } else {
        connection
            .execute_batch(&format!(
                "BEGIN IMMEDIATE;
                 {SCHEMA_SQL}
                 PRAGMA application_id = {APPLICATION_ID};
                 PRAGMA user_version = {SCHEMA_VERSION};
                 COMMIT;"
            ))
            .map_err(|_| ArtifactStoreError::Unavailable)?;
    }
    connection
        .execute_batch("PRAGMA journal_mode = WAL;")
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    validate_schema(&connection)?;
    Ok(connection)
}

fn validate_identity(connection: &Connection) -> Result<(), ArtifactStoreError> {
    let application_id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    let user_version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    if application_id != i64::from(APPLICATION_ID) || user_version != SCHEMA_VERSION {
        return Err(ArtifactStoreError::SchemaIncompatible);
    }
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<(), ArtifactStoreError> {
    validate_identity(connection)?;
    let mut statement = connection
        .prepare(
            "SELECT name FROM sqlite_schema
             WHERE type = 'table' AND name IN ('artifacts', 'artifact_versions', 'artifact_receipts')
             ORDER BY name",
        )
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    if names != ["artifact_receipts", "artifact_versions", "artifacts"] {
        return Err(ArtifactStoreError::SchemaIncompatible);
    }
    let foreign_keys: i64 = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    if foreign_keys != 1 {
        return Err(ArtifactStoreError::SchemaIncompatible);
    }
    Ok(())
}

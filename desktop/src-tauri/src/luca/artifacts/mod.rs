//! Owner-local durable artifacts and immutable managed snapshots.
//!
//! This store is intentionally independent from the relay-backed Room brief
//! and from encrypted continuity state. It owns local artifact metadata and
//! content-addressed bytes only; callers remain responsible for managed-turn
//! authority and for resolving the opaque working-root handle.

pub(crate) mod presentation;
mod schema;
mod source;

use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use base64::Engine as _;
use chrono::{SecondsFormat, Utc};
use luca_protocol::{
    canonical_sha256, ArtifactBrokerBindingV1, ArtifactCreateArgsV1, ArtifactKindV1,
    ArtifactReadModeV1, ArtifactReceiptStateV1, ArtifactSourceV1, ArtifactUpdateArgsV1, Hex64,
    OpaqueId, SafeU53, MAX_ARTIFACT_LIST_ITEMS, MAX_ARTIFACT_READ_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use self::source::{
    blob_path, capture_source, ensure_private_directory, publish_blob, read_blob, set_private_file,
    CapturedSource,
};

const MAX_OWNER_LOGICAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_RECONCILE_ENTRIES: usize = 10_000;
const UNREFERENCED_BLOB_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_ARTIFACT_QUERY_CHARS: usize = 256;

fn publish_captured_at(root: &Path, captured: &CapturedSource) -> Result<(), ArtifactStoreError> {
    if let (Some(hash), Some(bytes)) = (&captured.blob_hash, &captured.bytes) {
        publish_blob(&root.join("blobs"), &root.join("staging"), hash, bytes)?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ArtifactStoreError {
    Unavailable,
    SchemaIncompatible,
    InvalidRequest,
    InvalidSource,
    UnsafePath,
    SourceMissing,
    WorkingRootUnavailable,
    TooLarge,
    MediaTypeMismatch,
    QuotaExceeded,
    IdempotencyReuse,
    NotFound,
    VersionNotFound,
    Conflict { current_version: u64 },
    CorruptBlob,
    Unsupported,
}

impl std::fmt::Display for ArtifactStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for ArtifactStoreError {}

impl ArtifactStoreError {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::Unavailable => "artifact-unavailable",
            Self::SchemaIncompatible => "artifact-schema-incompatible",
            Self::InvalidRequest => "artifact-invalid",
            Self::InvalidSource => "artifact-source-invalid",
            Self::UnsafePath => "artifact-source-unsafe",
            Self::SourceMissing => "artifact-source-missing",
            Self::WorkingRootUnavailable => "artifact-working-root-unavailable",
            Self::TooLarge => "artifact-too-large",
            Self::MediaTypeMismatch => "artifact-media-type-mismatch",
            Self::QuotaExceeded => "artifact-quota-exceeded",
            Self::IdempotencyReuse => "artifact-idempotency-reuse",
            Self::NotFound => "artifact-not-found",
            Self::VersionNotFound => "artifact-version-not-found",
            Self::Conflict { .. } => "artifact-version-conflict",
            Self::CorruptBlob => "artifact-blob-corrupt",
            Self::Unsupported => "artifact-unsupported",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactRecord {
    pub artifact_id: String,
    pub title: String,
    pub kind: ArtifactKindV1,
    pub current_version: u64,
    pub receipt_state: ArtifactReceiptStateV1,
    pub lifecycle_state: String,
    pub pinned: bool,
    pub created_by_pubkey: String,
    pub conversation_id: Option<String>,
    pub source_turn_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ArtifactDeletedFilter {
    Active,
    Deleted,
    All,
}

#[derive(Debug, Clone)]
pub(crate) struct ArtifactListQuery {
    pub query: Option<String>,
    pub kinds: Vec<ArtifactKindV1>,
    pub deleted: ArtifactDeletedFilter,
    pub cursor: Option<String>,
    pub limit: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactListPage {
    pub artifacts: Vec<ArtifactRecord>,
    pub next_cursor: Option<String>,
    pub total: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactLastPreviewRecord {
    pub origin: String,
    pub port: u16,
    pub attached_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ArtifactListCursor {
    pinned: bool,
    updated_at: String,
    artifact_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactVersionRecord {
    pub artifact_id: String,
    pub version: u64,
    pub parent_version: Option<u64>,
    pub aggregate_hash: String,
    pub media_type: String,
    pub size_bytes: u64,
    pub source_type: String,
    pub source_relative_path: Option<String>,
    pub created_by_pubkey: String,
    pub conversation_id: Option<String>,
    pub source_turn_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactReceiptRecord {
    pub receipt_id: String,
    pub artifact_id: String,
    pub artifact_title: String,
    pub version: u64,
    pub resident_pubkey: String,
    pub conversation_id: Option<String>,
    pub turn_id: Option<String>,
    pub dispatch_receipt_id: Option<String>,
    pub message_id: Option<String>,
    pub state: ArtifactReceiptStateV1,
    pub created_at: String,
    pub linked_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactPreviewRecord {
    pub artifact: ArtifactRecord,
    pub version: ArtifactVersionRecord,
    pub content: Option<Vec<u8>>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ArtifactCommit {
    pub artifact: ArtifactRecord,
    pub version: ArtifactVersionRecord,
    pub receipt: ArtifactReceiptRecord,
    pub duplicate: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct ArtifactWriteContext {
    pub owner_pubkey: Hex64,
    pub author_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: Option<OpaqueId>,
    pub turn_id: Option<OpaqueId>,
    pub dispatch_receipt_id: Option<OpaqueId>,
    pub working_root_id: Option<OpaqueId>,
    pub receipt_state: ArtifactReceiptStateV1,
}

impl ArtifactWriteContext {
    pub(crate) fn from_broker(binding: &ArtifactBrokerBindingV1) -> Self {
        Self {
            owner_pubkey: binding.owner_pubkey.clone(),
            author_pubkey: binding.resident_pubkey.clone(),
            resident_pubkey: binding.resident_pubkey.clone(),
            conversation_id: Some(binding.conversation_id.clone()),
            turn_id: Some(binding.turn_id.clone()),
            dispatch_receipt_id: Some(binding.dispatch_receipt_id.clone()),
            working_root_id: Some(binding.working_root_id.clone()),
            receipt_state: ArtifactReceiptStateV1::Provisional,
        }
    }

    pub(crate) fn owner_import(owner_pubkey: Hex64) -> Self {
        Self {
            owner_pubkey: owner_pubkey.clone(),
            author_pubkey: owner_pubkey.clone(),
            resident_pubkey: owner_pubkey,
            conversation_id: None,
            turn_id: None,
            dispatch_receipt_id: None,
            working_root_id: None,
            receipt_state: ArtifactReceiptStateV1::Linked,
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtifactReconcileReport {
    pub removed_staging_entries: usize,
    pub missing_blob_versions: usize,
    pub removed_unreferenced_blobs: usize,
}

pub(crate) struct ArtifactStore {
    connection: Connection,
    root: PathBuf,
    owner_quota_bytes: u64,
}

impl ArtifactStore {
    pub(crate) fn open(app_data_dir: &Path) -> Result<Self, ArtifactStoreError> {
        Self::open_with_quota(app_data_dir, MAX_OWNER_LOGICAL_BYTES)
    }

    fn open_with_quota(
        app_data_dir: &Path,
        owner_quota_bytes: u64,
    ) -> Result<Self, ArtifactStoreError> {
        let luca_root = app_data_dir.join("luca");
        reject_symlink(&luca_root)?;
        ensure_private_directory(&luca_root)?;
        let root = luca_root.join("artifacts");
        reject_symlink(&root)?;
        ensure_private_directory(&root)?;
        ensure_private_directory(&root.join("blobs"))?;
        ensure_private_directory(&root.join("staging"))?;
        ensure_private_directory(&root.join("quarantine"))?;
        let database_path = root.join("artifacts.sqlite3");
        let connection = schema::open_database(&database_path)?;
        set_private_file(&database_path)?;
        Ok(Self {
            connection,
            root,
            owner_quota_bytes,
        })
    }

    pub(crate) fn create(
        &mut self,
        context: &ArtifactWriteContext,
        args: &ArtifactCreateArgsV1,
        working_root: Option<&Path>,
    ) -> Result<ArtifactCommit, ArtifactStoreError> {
        validate_title(&args.title)?;
        if args.kind == ArtifactKindV1::App
            && !matches!(args.source, ArtifactSourceV1::WorkspaceDirectory { .. })
        {
            return Err(ArtifactStoreError::InvalidSource);
        }
        let captured = capture_source(
            args.kind,
            &args.source,
            context.working_root_id.as_ref(),
            working_root,
        )?;
        let fingerprint = create_fingerprint(context, args, &captured)?;
        let aggregate_hash = aggregate_hash(args.kind, &captured)?;
        let now = now();
        let artifact_id = uuid::Uuid::new_v4().to_string();
        let receipt_id = uuid::Uuid::new_v4().to_string();

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if let Some(existing) = idempotent_commit(
            &transaction,
            context.owner_pubkey.as_str(),
            args.idempotency_key.as_str(),
            &fingerprint,
        )? {
            transaction
                .commit()
                .map_err(|_| ArtifactStoreError::Unavailable)?;
            return Ok(existing);
        }
        enforce_quota(
            &transaction,
            context.owner_pubkey.as_str(),
            captured.size_bytes,
            self.owner_quota_bytes,
        )?;
        publish_captured_at(&self.root, &captured)?;
        transaction
            .execute(
                "INSERT INTO artifacts (
                    owner_pubkey, artifact_id, title, kind, current_version, receipt_state,
                    lifecycle_state, pinned, created_by_pubkey, conversation_id, source_turn_id,
                    dispatch_receipt_id, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, 1, ?5, 'ready', 0, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![
                    context.owner_pubkey.as_str(),
                    artifact_id,
                    args.title.trim(),
                    kind_value(args.kind),
                    receipt_state_value(context.receipt_state),
                    context.author_pubkey.as_str(),
                    context.conversation_id.as_ref().map(OpaqueId::as_str),
                    context.turn_id.as_ref().map(OpaqueId::as_str),
                    context.dispatch_receipt_id.as_ref().map(OpaqueId::as_str),
                    now,
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        insert_version(
            &transaction,
            context,
            &artifact_id,
            1,
            None,
            args.idempotency_key.as_str(),
            &fingerprint,
            &aggregate_hash,
            &captured,
            &now,
        )?;
        insert_receipt(&transaction, context, &receipt_id, &artifact_id, 1, &now)?;
        let commit = load_commit(
            &transaction,
            context.owner_pubkey.as_str(),
            &artifact_id,
            1,
            &receipt_id,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(commit)
    }

    pub(crate) fn update(
        &mut self,
        context: &ArtifactWriteContext,
        args: &ArtifactUpdateArgsV1,
        working_root: Option<&Path>,
    ) -> Result<ArtifactCommit, ArtifactStoreError> {
        if let Some(title) = &args.title {
            validate_title(title)?;
        }
        let artifact = load_artifact(
            &self.connection,
            context.owner_pubkey.as_str(),
            args.artifact_id.as_str(),
        )?;
        let captured = capture_source(
            artifact.kind,
            &args.source,
            context.working_root_id.as_ref(),
            working_root,
        )?;
        let fingerprint = update_fingerprint(context, args, &captured)?;
        let aggregate_hash = aggregate_hash(artifact.kind, &captured)?;
        let now = now();
        let receipt_id = uuid::Uuid::new_v4().to_string();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if let Some(existing) = idempotent_commit(
            &transaction,
            context.owner_pubkey.as_str(),
            args.idempotency_key.as_str(),
            &fingerprint,
        )? {
            transaction
                .commit()
                .map_err(|_| ArtifactStoreError::Unavailable)?;
            return Ok(existing);
        }
        let current_version: u64 = transaction
            .query_row(
                "SELECT current_version FROM artifacts WHERE owner_pubkey = ?1 AND artifact_id = ?2",
                params![context.owner_pubkey.as_str(), args.artifact_id.as_str()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .ok_or(ArtifactStoreError::NotFound)?;
        if current_version != args.expected_current_version.get() {
            return Err(ArtifactStoreError::Conflict { current_version });
        }
        enforce_quota(
            &transaction,
            context.owner_pubkey.as_str(),
            captured.size_bytes,
            self.owner_quota_bytes,
        )?;
        publish_captured_at(&self.root, &captured)?;
        let next_version = current_version
            .checked_add(1)
            .ok_or(ArtifactStoreError::InvalidRequest)?;
        let changed = transaction
            .execute(
                "UPDATE artifacts SET title = COALESCE(?3, title), current_version = ?4,
                    receipt_state = ?5, lifecycle_state = 'ready', updated_at = ?6
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND current_version = ?7",
                params![
                    context.owner_pubkey.as_str(),
                    args.artifact_id.as_str(),
                    args.title.as_ref().map(|value| value.trim()),
                    next_version,
                    receipt_state_value(context.receipt_state),
                    now,
                    current_version,
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if changed != 1 {
            let actual = current_version_for(
                &transaction,
                context.owner_pubkey.as_str(),
                args.artifact_id.as_str(),
            )?;
            return Err(ArtifactStoreError::Conflict {
                current_version: actual,
            });
        }
        insert_version(
            &transaction,
            context,
            args.artifact_id.as_str(),
            next_version,
            Some(current_version),
            args.idempotency_key.as_str(),
            &fingerprint,
            &aggregate_hash,
            &captured,
            &now,
        )?;
        insert_receipt(
            &transaction,
            context,
            &receipt_id,
            args.artifact_id.as_str(),
            next_version,
            &now,
        )?;
        let commit = load_commit(
            &transaction,
            context.owner_pubkey.as_str(),
            args.artifact_id.as_str(),
            next_version,
            &receipt_id,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(commit)
    }

    pub(crate) fn list_page(
        &self,
        owner_pubkey: &Hex64,
        query: &ArtifactListQuery,
    ) -> Result<ArtifactListPage, ArtifactStoreError> {
        self.list_page_scoped(owner_pubkey, query, None)
    }

    fn list_page_scoped(
        &self,
        owner_pubkey: &Hex64,
        query: &ArtifactListQuery,
        conversation_id: Option<&OpaqueId>,
    ) -> Result<ArtifactListPage, ArtifactStoreError> {
        if query.limit == 0 || query.limit > MAX_ARTIFACT_LIST_ITEMS {
            return Err(ArtifactStoreError::InvalidRequest);
        }
        let title_query = query
            .query
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| {
                if value.chars().count() > MAX_ARTIFACT_QUERY_CHARS {
                    return Err(ArtifactStoreError::InvalidRequest);
                }
                Ok(format!(
                    "%{}%",
                    escape_like(value.to_ascii_lowercase().as_str())
                ))
            })
            .transpose()?;
        if query.kinds.len() > 9 {
            return Err(ArtifactStoreError::InvalidRequest);
        }
        let mut kinds = query
            .kinds
            .iter()
            .copied()
            .map(kind_value)
            .collect::<Vec<_>>();
        kinds.sort_unstable();
        kinds.dedup();
        let kind_filter = (!kinds.is_empty()).then(|| format!("|{}|", kinds.join("|")));
        let deleted = match query.deleted {
            ArtifactDeletedFilter::Active => "active",
            ArtifactDeletedFilter::Deleted => "deleted",
            ArtifactDeletedFilter::All => "all",
        };
        let cursor = query.cursor.as_deref().map(decode_cursor).transpose()?;
        let cursor_pinned = cursor.as_ref().map(|value| value.pinned);
        let cursor_updated = cursor.as_ref().map(|value| value.updated_at.as_str());
        let cursor_artifact = cursor.as_ref().map(|value| value.artifact_id.as_str());
        let fetch_limit = u32::from(query.limit) + 1;
        let mut statement = self
            .connection
            .prepare(
                "SELECT artifact_id, title, kind, current_version, receipt_state, lifecycle_state,
                        pinned, created_by_pubkey, conversation_id, source_turn_id,
                        created_at, updated_at, deleted_at
                 FROM artifacts
                 WHERE owner_pubkey = ?1
                   AND (?9 IS NULL OR conversation_id = ?9)
                   AND (?2 IS NULL
                     OR lower(title) LIKE ?2 ESCAPE '\\'
                     OR lower(artifact_id) LIKE ?2 ESCAPE '\\'
                     OR lower(created_by_pubkey) LIKE ?2 ESCAPE '\\'
                     OR lower(COALESCE(conversation_id, '')) LIKE ?2 ESCAPE '\\')
                   AND (?3 IS NULL OR instr(?3, '|' || kind || '|') > 0)
                   AND (?4 = 'all'
                     OR (?4 = 'active' AND deleted_at IS NULL)
                     OR (?4 = 'deleted' AND deleted_at IS NOT NULL))
                   AND (?5 IS NULL
                     OR pinned < ?5
                     OR (pinned = ?5 AND updated_at < ?6)
                     OR (pinned = ?5 AND updated_at = ?6 AND artifact_id < ?7))
                 ORDER BY pinned DESC, updated_at DESC, artifact_id DESC LIMIT ?8",
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let mut records = statement
            .query_map(
                params![
                    owner_pubkey.as_str(),
                    title_query,
                    kind_filter,
                    deleted,
                    cursor_pinned,
                    cursor_updated,
                    cursor_artifact,
                    fetch_limit,
                    conversation_id.map(OpaqueId::as_str),
                ],
                artifact_from_row,
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
        let next_cursor = if records.len() > usize::from(query.limit) {
            records.truncate(usize::from(query.limit));
            records.last().map(encode_cursor).transpose()?
        } else {
            None
        };
        let total = self
            .connection
            .query_row(
                "SELECT COUNT(*) FROM artifacts
                 WHERE owner_pubkey = ?1
                   AND (?5 IS NULL OR conversation_id = ?5)
                   AND (?2 IS NULL
                     OR lower(title) LIKE ?2 ESCAPE '\\'
                     OR lower(artifact_id) LIKE ?2 ESCAPE '\\'
                     OR lower(created_by_pubkey) LIKE ?2 ESCAPE '\\'
                     OR lower(COALESCE(conversation_id, '')) LIKE ?2 ESCAPE '\\')
                   AND (?3 IS NULL OR instr(?3, '|' || kind || '|') > 0)
                   AND (?4 = 'all'
                     OR (?4 = 'active' AND deleted_at IS NULL)
                     OR (?4 = 'deleted' AND deleted_at IS NOT NULL))",
                params![
                    owner_pubkey.as_str(),
                    title_query,
                    kind_filter,
                    deleted,
                    conversation_id.map(OpaqueId::as_str)
                ],
                |row| row.get(0),
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(ArtifactListPage {
            artifacts: records,
            next_cursor,
            total,
        })
    }

    #[cfg(test)]
    pub(crate) fn list(
        &self,
        owner_pubkey: &Hex64,
        include_deleted: bool,
        limit: u16,
    ) -> Result<Vec<ArtifactRecord>, ArtifactStoreError> {
        self.list_page(
            owner_pubkey,
            &ArtifactListQuery {
                query: None,
                kinds: Vec::new(),
                deleted: if include_deleted {
                    ArtifactDeletedFilter::All
                } else {
                    ArtifactDeletedFilter::Active
                },
                cursor: None,
                limit,
            },
        )
        .map(|page| page.artifacts)
    }

    pub(crate) fn list_for_conversation(
        &self,
        owner_pubkey: &Hex64,
        conversation_id: &OpaqueId,
        limit: u16,
    ) -> Result<Vec<ArtifactRecord>, ArtifactStoreError> {
        self.list_page_scoped(
            owner_pubkey,
            &ArtifactListQuery {
                query: None,
                kinds: Vec::new(),
                deleted: ArtifactDeletedFilter::Active,
                cursor: None,
                limit,
            },
            Some(conversation_id),
        )
        .map(|page| page.artifacts)
    }

    pub(crate) fn get(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<ArtifactRecord, ArtifactStoreError> {
        load_artifact(
            &self.connection,
            owner_pubkey.as_str(),
            artifact_id.as_str(),
        )
    }

    pub(crate) fn get_for_conversation(
        &self,
        owner_pubkey: &Hex64,
        conversation_id: &OpaqueId,
        artifact_id: &OpaqueId,
    ) -> Result<ArtifactRecord, ArtifactStoreError> {
        let artifact = self.get(owner_pubkey, artifact_id)?;
        if artifact.conversation_id.as_deref() != Some(conversation_id.as_str()) {
            return Err(ArtifactStoreError::NotFound);
        }
        Ok(artifact)
    }

    pub(crate) fn versions(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<Vec<ArtifactVersionRecord>, ArtifactStoreError> {
        self.get(owner_pubkey, artifact_id)?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT artifact_id, version, parent_version, aggregate_hash, media_type,
                        size_bytes, source_type, source_relative_path, created_by_pubkey,
                        conversation_id, source_turn_id, created_at
                 FROM artifact_versions WHERE owner_pubkey = ?1 AND artifact_id = ?2
                 ORDER BY version DESC",
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let records = statement
            .query_map(
                params![owner_pubkey.as_str(), artifact_id.as_str()],
                version_from_row,
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
        Ok(records)
    }

    pub(crate) fn latest_receipt(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        version: u64,
    ) -> Result<ArtifactReceiptRecord, ArtifactStoreError> {
        self.connection
            .query_row(
                "SELECT receipt_id, artifact_id,
                        (SELECT title FROM artifacts
                         WHERE artifacts.owner_pubkey = artifact_receipts.owner_pubkey
                           AND artifacts.artifact_id = artifact_receipts.artifact_id),
                        version, resident_pubkey, conversation_id, turn_id,
                        dispatch_receipt_id, message_id, state, created_at, linked_at
                 FROM artifact_receipts
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND version = ?3
                 ORDER BY created_at DESC, receipt_id DESC LIMIT 1",
                params![owner_pubkey.as_str(), artifact_id.as_str(), version],
                receipt_from_row,
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .ok_or(ArtifactStoreError::NotFound)
    }

    pub(crate) fn record_preview_attachment(
        &mut self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        origin: &str,
        port: u16,
        attached_at: &str,
    ) -> Result<(), ArtifactStoreError> {
        validate_preview_metadata(origin, port, attached_at)?;
        self.get(owner_pubkey, artifact_id)?;
        self.connection
            .execute(
                "INSERT INTO artifact_preview_history (
                    owner_pubkey, artifact_id, origin, port, attached_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(owner_pubkey, artifact_id) DO UPDATE SET
                    origin = excluded.origin,
                    port = excluded.port,
                    attached_at = excluded.attached_at",
                params![
                    owner_pubkey.as_str(),
                    artifact_id.as_str(),
                    origin,
                    port,
                    attached_at
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(())
    }

    pub(crate) fn last_preview(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<Option<ArtifactLastPreviewRecord>, ArtifactStoreError> {
        self.connection
            .query_row(
                "SELECT origin, port, attached_at FROM artifact_preview_history
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2",
                params![owner_pubkey.as_str(), artifact_id.as_str()],
                |row| {
                    let port: u16 = row.get(1)?;
                    Ok(ArtifactLastPreviewRecord {
                        origin: row.get(0)?,
                        port,
                        attached_at: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)
    }

    pub(crate) fn read(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        version: Option<SafeU53>,
        mode: ArtifactReadModeV1,
    ) -> Result<ArtifactPreviewRecord, ArtifactStoreError> {
        let artifact = self.get(owner_pubkey, artifact_id)?;
        let version_number = version
            .map(SafeU53::get)
            .unwrap_or(artifact.current_version);
        let (record, blob_hash): (ArtifactVersionRecord, Option<String>) = self
            .connection
            .query_row(
                "SELECT artifact_id, version, parent_version, aggregate_hash, media_type,
                        size_bytes, source_type, source_relative_path, created_by_pubkey,
                        conversation_id, source_turn_id, created_at, blob_hash
                 FROM artifact_versions
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND version = ?3",
                params![owner_pubkey.as_str(), artifact_id.as_str(), version_number],
                |row| Ok((version_from_row(row)?, row.get(12)?)),
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .ok_or(ArtifactStoreError::VersionNotFound)?;
        if mode == ArtifactReadModeV1::Metadata {
            return Ok(ArtifactPreviewRecord {
                artifact,
                version: record,
                content: None,
                truncated: false,
            });
        }
        let hash = blob_hash.ok_or(ArtifactStoreError::Unsupported)?;
        let bytes = read_blob(&self.root.join("blobs"), &hash)?;
        let truncated = bytes.len() > MAX_ARTIFACT_READ_BYTES;
        let bounded = bytes[..bytes.len().min(MAX_ARTIFACT_READ_BYTES)].to_vec();
        if !record.media_type.starts_with("text/") && record.media_type != "image/svg+xml" {
            return Err(ArtifactStoreError::Unsupported);
        }
        std::str::from_utf8(&bounded).map_err(|_| ArtifactStoreError::CorruptBlob)?;
        Ok(ArtifactPreviewRecord {
            artifact,
            version: record,
            content: Some(bounded),
            truncated,
        })
    }

    pub(crate) fn read_binary(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        version: Option<SafeU53>,
    ) -> Result<ArtifactPreviewRecord, ArtifactStoreError> {
        let artifact = self.get(owner_pubkey, artifact_id)?;
        let version_number = version
            .map(SafeU53::get)
            .unwrap_or(artifact.current_version);
        let (record, blob_hash): (ArtifactVersionRecord, Option<String>) = self
            .connection
            .query_row(
                "SELECT artifact_id, version, parent_version, aggregate_hash, media_type,
                        size_bytes, source_type, source_relative_path, created_by_pubkey,
                        conversation_id, source_turn_id, created_at, blob_hash
                 FROM artifact_versions
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND version = ?3",
                params![owner_pubkey.as_str(), artifact_id.as_str(), version_number],
                |row| Ok((version_from_row(row)?, row.get(12)?)),
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .ok_or(ArtifactStoreError::VersionNotFound)?;
        let hash = blob_hash.ok_or(ArtifactStoreError::Unsupported)?;
        let bytes = read_blob(&self.root.join("blobs"), &hash)?;
        if bytes.len() as u64 != record.size_bytes {
            return Err(ArtifactStoreError::CorruptBlob);
        }
        Ok(ArtifactPreviewRecord {
            artifact,
            version: record,
            content: Some(bytes),
            truncated: false,
        })
    }

    pub(crate) fn pin(
        &mut self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        pinned: bool,
    ) -> Result<ArtifactRecord, ArtifactStoreError> {
        let changed = self
            .connection
            .execute(
                "UPDATE artifacts SET pinned = ?3, updated_at = ?4
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2",
                params![owner_pubkey.as_str(), artifact_id.as_str(), pinned, now()],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ArtifactStoreError::NotFound);
        }
        self.get(owner_pubkey, artifact_id)
    }

    pub(crate) fn soft_delete(
        &mut self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<ArtifactRecord, ArtifactStoreError> {
        let timestamp = now();
        let changed = self
            .connection
            .execute(
                "UPDATE artifacts SET deleted_at = COALESCE(deleted_at, ?3),
                    lifecycle_state = 'deleted', updated_at = ?3
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2",
                params![owner_pubkey.as_str(), artifact_id.as_str(), timestamp],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ArtifactStoreError::NotFound);
        }
        self.get(owner_pubkey, artifact_id)
    }

    pub(crate) fn restore(
        &mut self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<ArtifactRecord, ArtifactStoreError> {
        let lifecycle = self.current_blob_lifecycle(owner_pubkey, artifact_id)?;
        let changed = self
            .connection
            .execute(
                "UPDATE artifacts SET deleted_at = NULL, lifecycle_state = ?3, updated_at = ?4
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2",
                params![
                    owner_pubkey.as_str(),
                    artifact_id.as_str(),
                    lifecycle,
                    now()
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ArtifactStoreError::NotFound);
        }
        self.get(owner_pubkey, artifact_id)
    }

    fn current_blob_lifecycle(
        &self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
    ) -> Result<&'static str, ArtifactStoreError> {
        let (source_type, blob_hash): (String, Option<String>) = self
            .connection
            .query_row(
                "SELECT v.source_type, v.blob_hash FROM artifacts a
                 JOIN artifact_versions v ON v.owner_pubkey = a.owner_pubkey
                    AND v.artifact_id = a.artifact_id AND v.version = a.current_version
                 WHERE a.owner_pubkey = ?1 AND a.artifact_id = ?2",
                params![owner_pubkey.as_str(), artifact_id.as_str()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .ok_or(ArtifactStoreError::NotFound)?;
        if source_type == "workspace_directory" {
            return Ok("source_unavailable");
        }
        let Some(hash) = blob_hash else {
            return Ok("preview_unavailable");
        };
        Ok(if blob_path(&self.root.join("blobs"), &hash)?.is_file() {
            "ready"
        } else {
            "preview_unavailable"
        })
    }

    pub(crate) fn revert(
        &mut self,
        owner_pubkey: &Hex64,
        artifact_id: &OpaqueId,
        source_version: SafeU53,
        expected_current_version: SafeU53,
    ) -> Result<ArtifactCommit, ArtifactStoreError> {
        let artifact = self.get(owner_pubkey, artifact_id)?;
        if artifact.current_version != expected_current_version.get() {
            return Err(ArtifactStoreError::Conflict {
                current_version: artifact.current_version,
            });
        }
        let source = load_version_with_storage(
            &self.connection,
            owner_pubkey.as_str(),
            artifact_id.as_str(),
            source_version.get(),
        )?;
        if let Some(hash) = &source.blob_hash {
            if !blob_path(&self.root.join("blobs"), hash)?.is_file() {
                return Err(ArtifactStoreError::CorruptBlob);
            }
        }
        let context = ArtifactWriteContext::owner_import(owner_pubkey.clone());
        let now = now();
        let receipt_id = uuid::Uuid::new_v4().to_string();
        let idempotency_key = format!("revert-{}", uuid::Uuid::new_v4());
        let fingerprint = canonical_sha256(&serde_json::json!({
            "operation": "revert",
            "owner": owner_pubkey.as_str(),
            "artifact": artifact_id.as_str(),
            "source_version": source_version.get(),
            "expected_current_version": expected_current_version.get(),
            "aggregate_hash": source.record.aggregate_hash,
        }))
        .map_err(|_| ArtifactStoreError::InvalidRequest)?;
        let next_version = expected_current_version
            .get()
            .checked_add(1)
            .ok_or(ArtifactStoreError::InvalidRequest)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let changed = transaction
            .execute(
                "UPDATE artifacts SET current_version = ?3, receipt_state = 'linked',
                    lifecycle_state = 'ready', updated_at = ?4
                 WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND current_version = ?5",
                params![
                    owner_pubkey.as_str(),
                    artifact_id.as_str(),
                    next_version,
                    now,
                    expected_current_version.get(),
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        if changed != 1 {
            return Err(ArtifactStoreError::Conflict {
                current_version: current_version_for(
                    &transaction,
                    owner_pubkey.as_str(),
                    artifact_id.as_str(),
                )?,
            });
        }
        insert_version_copy(
            &transaction,
            &context,
            artifact_id.as_str(),
            next_version,
            expected_current_version.get(),
            &idempotency_key,
            &fingerprint,
            &source,
            &now,
        )?;
        insert_receipt(
            &transaction,
            &context,
            &receipt_id,
            artifact_id.as_str(),
            next_version,
            &now,
        )?;
        let commit = load_commit(
            &transaction,
            owner_pubkey.as_str(),
            artifact_id.as_str(),
            next_version,
            &receipt_id,
            false,
        )?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(commit)
    }

    pub(crate) fn receipts(
        &self,
        owner_pubkey: &Hex64,
        conversation_id: Option<&OpaqueId>,
        limit: u16,
    ) -> Result<Vec<ArtifactReceiptRecord>, ArtifactStoreError> {
        if limit == 0 || limit > MAX_ARTIFACT_LIST_ITEMS {
            return Err(ArtifactStoreError::InvalidRequest);
        }
        let mut statement = self
            .connection
            .prepare(
                "SELECT receipt_id, artifact_id,
                        (SELECT title FROM artifacts
                         WHERE artifacts.owner_pubkey = artifact_receipts.owner_pubkey
                           AND artifacts.artifact_id = artifact_receipts.artifact_id),
                        version, resident_pubkey, conversation_id, turn_id,
                        dispatch_receipt_id, message_id, state, created_at, linked_at
                 FROM artifact_receipts
                 WHERE owner_pubkey = ?1 AND (?2 IS NULL OR conversation_id = ?2)
                 ORDER BY created_at DESC, receipt_id DESC LIMIT ?3",
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let records = statement
            .query_map(
                params![
                    owner_pubkey.as_str(),
                    conversation_id.map(OpaqueId::as_str),
                    limit,
                ],
                receipt_from_row,
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
        Ok(records)
    }

    pub(crate) fn link_turn_receipts(
        &mut self,
        owner_pubkey: &Hex64,
        conversation_id: &OpaqueId,
        turn_id: &OpaqueId,
        message_id: &Hex64,
    ) -> Result<usize, ArtifactStoreError> {
        let timestamp = now();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let changed = transaction
            .execute(
                "UPDATE artifact_receipts SET state = 'linked', message_id = ?4, linked_at = ?5
                 WHERE owner_pubkey = ?1 AND conversation_id = ?2 AND turn_id = ?3
                   AND state = 'provisional'",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    turn_id.as_str(),
                    message_id.as_str(),
                    timestamp,
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .execute(
                "UPDATE artifacts SET receipt_state = 'linked', updated_at = ?4
                 WHERE owner_pubkey = ?1 AND EXISTS (
                    SELECT 1 FROM artifact_receipts
                    WHERE artifact_receipts.owner_pubkey = artifacts.owner_pubkey
                      AND artifact_receipts.artifact_id = artifacts.artifact_id
                      AND artifact_receipts.version = artifacts.current_version
                      AND artifact_receipts.conversation_id = ?2
                      AND artifact_receipts.turn_id = ?3
                      AND artifact_receipts.state = 'linked'
                 )",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    turn_id.as_str(),
                    timestamp
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(changed)
    }

    pub(crate) fn mark_turn_receipts(
        &mut self,
        owner_pubkey: &Hex64,
        conversation_id: &OpaqueId,
        turn_id: &OpaqueId,
        state: ArtifactReceiptStateV1,
    ) -> Result<usize, ArtifactStoreError> {
        if !matches!(
            state,
            ArtifactReceiptStateV1::Interrupted | ArtifactReceiptStateV1::Orphaned
        ) {
            return Err(ArtifactStoreError::InvalidRequest);
        }
        let timestamp = now();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let changed = transaction
            .execute(
                "UPDATE artifact_receipts SET state = ?4
                 WHERE owner_pubkey = ?1 AND conversation_id = ?2 AND turn_id = ?3
                   AND state = 'provisional'",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    turn_id.as_str(),
                    receipt_state_value(state),
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .execute(
                "UPDATE artifacts SET receipt_state = ?4, updated_at = ?5
                 WHERE owner_pubkey = ?1 AND EXISTS (
                    SELECT 1 FROM artifact_receipts
                    WHERE artifact_receipts.owner_pubkey = artifacts.owner_pubkey
                      AND artifact_receipts.artifact_id = artifacts.artifact_id
                      AND artifact_receipts.version = artifacts.current_version
                      AND artifact_receipts.conversation_id = ?2
                      AND artifact_receipts.turn_id = ?3
                      AND artifact_receipts.state = ?4
                 )",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    turn_id.as_str(),
                    receipt_state_value(state),
                    timestamp,
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(changed)
    }

    pub(crate) fn mark_dispatch_receipts(
        &mut self,
        owner_pubkey: &Hex64,
        conversation_id: &OpaqueId,
        resident_pubkey: &Hex64,
        dispatch_receipt_id: &OpaqueId,
        state: ArtifactReceiptStateV1,
    ) -> Result<usize, ArtifactStoreError> {
        if !matches!(
            state,
            ArtifactReceiptStateV1::Interrupted | ArtifactReceiptStateV1::Orphaned
        ) {
            return Err(ArtifactStoreError::InvalidRequest);
        }
        let timestamp = now();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let changed = transaction
            .execute(
                "UPDATE artifact_receipts SET state = ?5
                 WHERE owner_pubkey = ?1 AND conversation_id = ?2
                   AND resident_pubkey = ?3 AND dispatch_receipt_id = ?4
                   AND state = 'provisional'",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    resident_pubkey.as_str(),
                    dispatch_receipt_id.as_str(),
                    receipt_state_value(state),
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .execute(
                "UPDATE artifacts SET receipt_state = ?5, updated_at = ?6
                 WHERE owner_pubkey = ?1 AND EXISTS (
                    SELECT 1 FROM artifact_receipts
                    WHERE artifact_receipts.owner_pubkey = artifacts.owner_pubkey
                      AND artifact_receipts.artifact_id = artifacts.artifact_id
                      AND artifact_receipts.version = artifacts.current_version
                      AND artifact_receipts.conversation_id = ?2
                      AND artifact_receipts.resident_pubkey = ?3
                      AND artifact_receipts.dispatch_receipt_id = ?4
                      AND artifact_receipts.state = ?5
                 )",
                params![
                    owner_pubkey.as_str(),
                    conversation_id.as_str(),
                    resident_pubkey.as_str(),
                    dispatch_receipt_id.as_str(),
                    receipt_state_value(state),
                    timestamp,
                ],
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        transaction
            .commit()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        Ok(changed)
    }

    pub(crate) fn reconcile(&mut self) -> Result<ArtifactReconcileReport, ArtifactStoreError> {
        let mut report = ArtifactReconcileReport::default();
        for entry in fs::read_dir(self.root.join("staging"))
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .take(MAX_RECONCILE_ENTRIES)
        {
            let entry = entry.map_err(|_| ArtifactStoreError::Unavailable)?;
            let path = entry.path();
            let removed = if path.is_dir() {
                fs::remove_dir_all(path)
            } else {
                fs::remove_file(path)
            };
            if removed.is_ok() {
                report.removed_staging_entries += 1;
            }
        }

        let mut statement = self
            .connection
            .prepare(
                "SELECT a.owner_pubkey, a.artifact_id, v.blob_hash
                 FROM artifacts a JOIN artifact_versions v
                   ON v.owner_pubkey = a.owner_pubkey AND v.artifact_id = a.artifact_id
                    AND v.version = a.current_version
                 WHERE v.blob_hash IS NOT NULL",
            )
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| ArtifactStoreError::Unavailable)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ArtifactStoreError::Unavailable)?;
        drop(statement);
        for (owner, artifact, hash) in rows.into_iter().take(MAX_RECONCILE_ENTRIES) {
            if !blob_path(&self.root.join("blobs"), &hash)?.is_file() {
                self.connection
                    .execute(
                        "UPDATE artifacts SET lifecycle_state = 'preview_unavailable'
                         WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND deleted_at IS NULL",
                        params![owner, artifact],
                    )
                    .map_err(|_| ArtifactStoreError::Unavailable)?;
                report.missing_blob_versions += 1;
            }
        }
        report.removed_unreferenced_blobs = self.garbage_collect(UNREFERENCED_BLOB_RETENTION)?;
        Ok(report)
    }

    fn garbage_collect(&mut self, retention: Duration) -> Result<usize, ArtifactStoreError> {
        let mut removed = 0;
        let root = self.root.join("blobs").join("sha256");
        let Ok(shards) = fs::read_dir(root) else {
            return Ok(0);
        };
        let cutoff = SystemTime::now()
            .checked_sub(retention)
            .unwrap_or(SystemTime::UNIX_EPOCH);
        'outer: for shard in shards.flatten() {
            let Ok(entries) = fs::read_dir(shard.path()) else {
                continue;
            };
            for entry in entries.flatten() {
                if removed >= MAX_RECONCILE_ENTRIES {
                    break 'outer;
                }
                let hash = entry.file_name().to_string_lossy().to_string();
                let referenced: bool = self
                    .connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM artifact_versions WHERE blob_hash = ?1)",
                        params![hash],
                        |row| row.get(0),
                    )
                    .map_err(|_| ArtifactStoreError::Unavailable)?;
                let old_enough = entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .is_ok_and(|modified| modified <= cutoff);
                if !referenced && old_enough && fs::remove_file(entry.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }
}

struct StoredVersion {
    record: ArtifactVersionRecord,
    blob_hash: Option<String>,
    source_relative_path: Option<String>,
    working_root_id: Option<String>,
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn validate_title(title: &str) -> Result<(), ArtifactStoreError> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > luca_protocol::MAX_ARTIFACT_TITLE_CHARS {
        return Err(ArtifactStoreError::InvalidRequest);
    }
    Ok(())
}

fn validate_preview_metadata(
    origin: &str,
    port: u16,
    attached_at: &str,
) -> Result<(), ArtifactStoreError> {
    let url = url::Url::parse(origin).map_err(|_| ArtifactStoreError::InvalidRequest)?;
    let loopback = match url.host() {
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        None => false,
    };
    if url.scheme() != "http"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || port == 0
        || attached_at.is_empty()
        || attached_at.len() > 64
    {
        return Err(ArtifactStoreError::InvalidRequest);
    }
    Ok(())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn encode_cursor(record: &ArtifactRecord) -> Result<String, ArtifactStoreError> {
    let bytes = serde_json::to_vec(&ArtifactListCursor {
        pinned: record.pinned,
        updated_at: record.updated_at.clone(),
        artifact_id: record.artifact_id.clone(),
    })
    .map_err(|_| ArtifactStoreError::InvalidRequest)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_cursor(value: &str) -> Result<ArtifactListCursor, ArtifactStoreError> {
    if value.is_empty() || value.len() > 2048 {
        return Err(ArtifactStoreError::InvalidRequest);
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| ArtifactStoreError::InvalidRequest)?;
    let cursor: ArtifactListCursor =
        serde_json::from_slice(&bytes).map_err(|_| ArtifactStoreError::InvalidRequest)?;
    if cursor.updated_at.is_empty()
        || cursor.updated_at.len() > 64
        || OpaqueId::parse(cursor.artifact_id.clone()).is_err()
    {
        return Err(ArtifactStoreError::InvalidRequest);
    }
    Ok(cursor)
}

fn reject_symlink(path: &Path) -> Result<(), ArtifactStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(ArtifactStoreError::SchemaIncompatible)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(ArtifactStoreError::Unavailable),
    }
}

fn kind_value(kind: ArtifactKindV1) -> &'static str {
    match kind {
        ArtifactKindV1::Html => "html",
        ArtifactKindV1::Markdown => "markdown",
        ArtifactKindV1::Text => "text",
        ArtifactKindV1::Code => "code",
        ArtifactKindV1::Image => "image",
        ArtifactKindV1::Svg => "svg",
        ArtifactKindV1::Pdf => "pdf",
        ArtifactKindV1::File => "file",
        ArtifactKindV1::App => "app",
    }
}

fn parse_kind(value: &str) -> Result<ArtifactKindV1, ArtifactStoreError> {
    match value {
        "html" => Ok(ArtifactKindV1::Html),
        "markdown" => Ok(ArtifactKindV1::Markdown),
        "text" => Ok(ArtifactKindV1::Text),
        "code" => Ok(ArtifactKindV1::Code),
        "image" => Ok(ArtifactKindV1::Image),
        "svg" => Ok(ArtifactKindV1::Svg),
        "pdf" => Ok(ArtifactKindV1::Pdf),
        "file" => Ok(ArtifactKindV1::File),
        "app" => Ok(ArtifactKindV1::App),
        _ => Err(ArtifactStoreError::SchemaIncompatible),
    }
}

fn receipt_state_value(state: ArtifactReceiptStateV1) -> &'static str {
    match state {
        ArtifactReceiptStateV1::Provisional => "provisional",
        ArtifactReceiptStateV1::Linked => "linked",
        ArtifactReceiptStateV1::Interrupted => "interrupted",
        ArtifactReceiptStateV1::Orphaned => "orphaned",
    }
}

fn parse_receipt_state(value: &str) -> Result<ArtifactReceiptStateV1, ArtifactStoreError> {
    match value {
        "provisional" => Ok(ArtifactReceiptStateV1::Provisional),
        "linked" => Ok(ArtifactReceiptStateV1::Linked),
        "interrupted" => Ok(ArtifactReceiptStateV1::Interrupted),
        "orphaned" => Ok(ArtifactReceiptStateV1::Orphaned),
        _ => Err(ArtifactStoreError::SchemaIncompatible),
    }
}

fn artifact_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactRecord> {
    let kind: String = row.get(2)?;
    let receipt_state: String = row.get(4)?;
    Ok(ArtifactRecord {
        artifact_id: row.get(0)?,
        title: row.get(1)?,
        kind: parse_kind(&kind).map_err(|_| rusqlite::Error::InvalidQuery)?,
        current_version: row.get(3)?,
        receipt_state: parse_receipt_state(&receipt_state)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        lifecycle_state: row.get(5)?,
        pinned: row.get(6)?,
        created_by_pubkey: row.get(7)?,
        conversation_id: row.get(8)?,
        source_turn_id: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        deleted_at: row.get(12)?,
    })
}

fn version_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactVersionRecord> {
    Ok(ArtifactVersionRecord {
        artifact_id: row.get(0)?,
        version: row.get(1)?,
        parent_version: row.get(2)?,
        aggregate_hash: row.get(3)?,
        media_type: row.get(4)?,
        size_bytes: row.get(5)?,
        source_type: row.get(6)?,
        source_relative_path: row.get(7)?,
        created_by_pubkey: row.get(8)?,
        conversation_id: row.get(9)?,
        source_turn_id: row.get(10)?,
        created_at: row.get(11)?,
    })
}

fn receipt_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArtifactReceiptRecord> {
    let state: String = row.get(9)?;
    Ok(ArtifactReceiptRecord {
        receipt_id: row.get(0)?,
        artifact_id: row.get(1)?,
        artifact_title: row.get(2)?,
        version: row.get(3)?,
        resident_pubkey: row.get(4)?,
        conversation_id: row.get(5)?,
        turn_id: row.get(6)?,
        dispatch_receipt_id: row.get(7)?,
        message_id: row.get(8)?,
        state: parse_receipt_state(&state).map_err(|_| rusqlite::Error::InvalidQuery)?,
        created_at: row.get(10)?,
        linked_at: row.get(11)?,
    })
}

fn load_artifact(
    connection: &Connection,
    owner_pubkey: &str,
    artifact_id: &str,
) -> Result<ArtifactRecord, ArtifactStoreError> {
    connection
        .query_row(
            "SELECT artifact_id, title, kind, current_version, receipt_state, lifecycle_state,
                    pinned, created_by_pubkey, conversation_id, source_turn_id,
                    created_at, updated_at, deleted_at
             FROM artifacts WHERE owner_pubkey = ?1 AND artifact_id = ?2",
            params![owner_pubkey, artifact_id],
            artifact_from_row,
        )
        .optional()
        .map_err(|_| ArtifactStoreError::Unavailable)?
        .ok_or(ArtifactStoreError::NotFound)
}

fn load_version_with_storage(
    connection: &Connection,
    owner_pubkey: &str,
    artifact_id: &str,
    version: u64,
) -> Result<StoredVersion, ArtifactStoreError> {
    connection
        .query_row(
            "SELECT artifact_id, version, parent_version, aggregate_hash, media_type,
                    size_bytes, source_type, source_relative_path, created_by_pubkey,
                    conversation_id, source_turn_id, created_at, blob_hash,
                    source_relative_path, working_root_id
             FROM artifact_versions
             WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND version = ?3",
            params![owner_pubkey, artifact_id, version],
            |row| {
                Ok(StoredVersion {
                    record: version_from_row(row)?,
                    blob_hash: row.get(12)?,
                    source_relative_path: row.get(13)?,
                    working_root_id: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(|_| ArtifactStoreError::Unavailable)?
        .ok_or(ArtifactStoreError::VersionNotFound)
}

fn current_version_for(
    connection: &Connection,
    owner_pubkey: &str,
    artifact_id: &str,
) -> Result<u64, ArtifactStoreError> {
    connection
        .query_row(
            "SELECT current_version FROM artifacts WHERE owner_pubkey = ?1 AND artifact_id = ?2",
            params![owner_pubkey, artifact_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| ArtifactStoreError::Unavailable)?
        .ok_or(ArtifactStoreError::NotFound)
}

fn idempotent_commit(
    connection: &Connection,
    owner_pubkey: &str,
    idempotency_key: &str,
    fingerprint: &str,
) -> Result<Option<ArtifactCommit>, ArtifactStoreError> {
    let existing: Option<(String, u64, String)> = connection
        .query_row(
            "SELECT artifact_id, version, request_fingerprint FROM artifact_versions
             WHERE owner_pubkey = ?1 AND idempotency_key = ?2",
            params![owner_pubkey, idempotency_key],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    let Some((artifact_id, version, prior_fingerprint)) = existing else {
        return Ok(None);
    };
    if prior_fingerprint != fingerprint {
        return Err(ArtifactStoreError::IdempotencyReuse);
    }
    let receipt_id: String = connection
        .query_row(
            "SELECT receipt_id FROM artifact_receipts
             WHERE owner_pubkey = ?1 AND artifact_id = ?2 AND version = ?3
             ORDER BY created_at, receipt_id LIMIT 1",
            params![owner_pubkey, artifact_id, version],
            |row| row.get(0),
        )
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    load_commit(
        connection,
        owner_pubkey,
        &artifact_id,
        version,
        &receipt_id,
        true,
    )
    .map(Some)
}

fn load_commit(
    connection: &Connection,
    owner_pubkey: &str,
    artifact_id: &str,
    version: u64,
    receipt_id: &str,
    duplicate: bool,
) -> Result<ArtifactCommit, ArtifactStoreError> {
    let artifact = load_artifact(connection, owner_pubkey, artifact_id)?;
    let version = load_version_with_storage(connection, owner_pubkey, artifact_id, version)?.record;
    let receipt = connection
        .query_row(
            "SELECT receipt_id, artifact_id,
                    (SELECT title FROM artifacts
                     WHERE artifacts.owner_pubkey = artifact_receipts.owner_pubkey
                       AND artifacts.artifact_id = artifact_receipts.artifact_id),
                    version, resident_pubkey, conversation_id, turn_id,
                    dispatch_receipt_id, message_id, state, created_at, linked_at
             FROM artifact_receipts WHERE owner_pubkey = ?1 AND receipt_id = ?2",
            params![owner_pubkey, receipt_id],
            receipt_from_row,
        )
        .map_err(|_| ArtifactStoreError::SchemaIncompatible)?;
    Ok(ArtifactCommit {
        artifact,
        version,
        receipt,
        duplicate,
    })
}

fn enforce_quota(
    connection: &Connection,
    owner_pubkey: &str,
    additional_bytes: u64,
    quota: u64,
) -> Result<(), ArtifactStoreError> {
    let used: u64 = connection
        .query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM artifact_versions WHERE owner_pubkey = ?1",
            params![owner_pubkey],
            |row| row.get(0),
        )
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    if used.saturating_add(additional_bytes) > quota {
        return Err(ArtifactStoreError::QuotaExceeded);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_version(
    transaction: &rusqlite::Transaction<'_>,
    context: &ArtifactWriteContext,
    artifact_id: &str,
    version: u64,
    parent_version: Option<u64>,
    idempotency_key: &str,
    fingerprint: &str,
    aggregate_hash: &str,
    captured: &CapturedSource,
    created_at: &str,
) -> Result<(), ArtifactStoreError> {
    transaction
        .execute(
            "INSERT INTO artifact_versions (
                owner_pubkey, artifact_id, version, parent_version, idempotency_key,
                request_fingerprint, aggregate_hash, blob_hash, media_type, size_bytes,
                source_type, source_relative_path, working_root_id, created_by_pubkey,
                conversation_id, source_turn_id, dispatch_receipt_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                       ?14, ?15, ?16, ?17, ?18)",
            params![
                context.owner_pubkey.as_str(),
                artifact_id,
                version,
                parent_version,
                idempotency_key,
                fingerprint,
                aggregate_hash,
                captured.blob_hash,
                captured.media_type,
                captured.size_bytes,
                captured.source_type,
                captured.relative_path,
                captured.working_root_id,
                context.author_pubkey.as_str(),
                context.conversation_id.as_ref().map(OpaqueId::as_str),
                context.turn_id.as_ref().map(OpaqueId::as_str),
                context.dispatch_receipt_id.as_ref().map(OpaqueId::as_str),
                created_at,
            ],
        )
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_version_copy(
    transaction: &rusqlite::Transaction<'_>,
    context: &ArtifactWriteContext,
    artifact_id: &str,
    version: u64,
    parent_version: u64,
    idempotency_key: &str,
    fingerprint: &str,
    source: &StoredVersion,
    created_at: &str,
) -> Result<(), ArtifactStoreError> {
    transaction
        .execute(
            "INSERT INTO artifact_versions (
                owner_pubkey, artifact_id, version, parent_version, idempotency_key,
                request_fingerprint, aggregate_hash, blob_hash, media_type, size_bytes,
                source_type, source_relative_path, working_root_id, created_by_pubkey,
                conversation_id, source_turn_id, dispatch_receipt_id, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                       ?14, NULL, NULL, NULL, ?15)",
            params![
                context.owner_pubkey.as_str(),
                artifact_id,
                version,
                parent_version,
                idempotency_key,
                fingerprint,
                source.record.aggregate_hash,
                source.blob_hash,
                source.record.media_type,
                source.record.size_bytes,
                source.record.source_type,
                source.source_relative_path,
                source.working_root_id,
                context.author_pubkey.as_str(),
                created_at,
            ],
        )
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    Ok(())
}

fn insert_receipt(
    transaction: &rusqlite::Transaction<'_>,
    context: &ArtifactWriteContext,
    receipt_id: &str,
    artifact_id: &str,
    version: u64,
    created_at: &str,
) -> Result<(), ArtifactStoreError> {
    transaction
        .execute(
            "INSERT INTO artifact_receipts (
                owner_pubkey, receipt_id, artifact_id, version, resident_pubkey,
                conversation_id, turn_id, dispatch_receipt_id, state, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                context.owner_pubkey.as_str(),
                receipt_id,
                artifact_id,
                version,
                context.resident_pubkey.as_str(),
                context.conversation_id.as_ref().map(OpaqueId::as_str),
                context.turn_id.as_ref().map(OpaqueId::as_str),
                context.dispatch_receipt_id.as_ref().map(OpaqueId::as_str),
                receipt_state_value(context.receipt_state),
                created_at,
            ],
        )
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    Ok(())
}

fn aggregate_hash(
    kind: ArtifactKindV1,
    captured: &CapturedSource,
) -> Result<String, ArtifactStoreError> {
    canonical_sha256(&serde_json::json!({
        "protocol": "luca.artifact.manifest.v1",
        "kind": kind,
        "media_type": captured.media_type,
        "size_bytes": captured.size_bytes,
        "blob_hash": captured.blob_hash,
        "source_type": captured.source_type,
        "relative_path": captured.relative_path,
        "working_root_id": captured.working_root_id,
    }))
    .map_err(|_| ArtifactStoreError::InvalidRequest)
}

fn create_fingerprint(
    context: &ArtifactWriteContext,
    args: &ArtifactCreateArgsV1,
    captured: &CapturedSource,
) -> Result<String, ArtifactStoreError> {
    canonical_sha256(&serde_json::json!({
        "operation": "artifact_create",
        "owner": context.owner_pubkey,
        "resident": context.resident_pubkey,
        "conversation": context.conversation_id,
        "turn": context.turn_id,
        "title": args.title.trim(),
        "kind": args.kind,
        "blob_hash": captured.blob_hash,
        "source_type": captured.source_type,
        "relative_path": captured.relative_path,
        "working_root_id": captured.working_root_id,
    }))
    .map_err(|_| ArtifactStoreError::InvalidRequest)
}

fn update_fingerprint(
    context: &ArtifactWriteContext,
    args: &ArtifactUpdateArgsV1,
    captured: &CapturedSource,
) -> Result<String, ArtifactStoreError> {
    canonical_sha256(&serde_json::json!({
        "operation": "artifact_update",
        "owner": context.owner_pubkey,
        "resident": context.resident_pubkey,
        "conversation": context.conversation_id,
        "turn": context.turn_id,
        "artifact": args.artifact_id,
        "expected_current_version": args.expected_current_version,
        "title": args.title.as_ref().map(|value| value.trim()),
        "blob_hash": captured.blob_hash,
        "source_type": captured.source_type,
        "relative_path": captured.relative_path,
        "working_root_id": captured.working_root_id,
    }))
    .map_err(|_| ArtifactStoreError::InvalidRequest)
}

#[cfg(test)]
mod tests;

//! Strict contracts for the V1.2 scoped Owner Brain source loop.
//!
//! Source names, local paths, locators, and bodies are sensitive and must be
//! stored only inside the encrypted owner-brain namespace. Receipt types are
//! body-free by construction.

use crate::{
    CanonicalTimestamp, ContinuityError, ContinuityLayerStatusV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::path::{Component, Path};

/// Maximum files represented by one preview transaction.
pub const MAX_OWNER_BRAIN_PREVIEW_ROWS: usize = 512;
/// Maximum bytes accepted from one source file.
pub const MAX_OWNER_BRAIN_FILE_BYTES: u64 = 1024 * 1024;
/// Maximum aggregate accepted bytes in one import transaction.
pub const MAX_OWNER_BRAIN_IMPORT_BYTES: u64 = 16 * 1024 * 1024;
/// Maximum UTF-8 bytes in one normalized retrieval chunk.
pub const MAX_OWNER_BRAIN_CHUNK_BYTES: usize = 4 * 1024;
/// Maximum chunks returned by one owner-brain retrieval.
pub const MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS: usize = 8;
/// Maximum aggregate owner-brain context bytes in one turn.
pub const MAX_OWNER_BRAIN_RETRIEVAL_BYTES: usize = 24 * 1024;
/// Maximum UTF-8 bytes in an encrypted source display name.
pub const MAX_OWNER_BRAIN_DISPLAY_NAME_BYTES: usize = 240;
/// Maximum UTF-8 bytes in an encrypted source-relative locator.
pub const MAX_OWNER_BRAIN_LOCATOR_BYTES: usize = 1024;
/// Maximum UTF-8 bytes in an encrypted canonical local path.
pub const MAX_OWNER_BRAIN_PATH_BYTES: usize = 4096;
/// Preview tokens expire after this many seconds.
pub const OWNER_BRAIN_PREVIEW_TTL_SECS: u64 = 15 * 60;

fn require_protocol(value: &str) -> Result<(), ContinuityError> {
    (value == CONTINUITY_PROTOCOL)
        .then_some(())
        .ok_or(ContinuityError::Protocol)
}

fn bounded_text(value: &str, maximum: usize) -> Result<(), ContinuityError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() != value.len()
        || value.len() > maximum
        || value.chars().any(|character| {
            character == '\0' || (character.is_control() && character != '\n' && character != '\t')
        })
    {
        Err(ContinuityError::BodySafety)
    } else {
        Ok(())
    }
}

fn validate_relative_path(value: &str) -> Result<(), ContinuityError> {
    bounded_text(value, MAX_OWNER_BRAIN_LOCATOR_BYTES)?;
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        Err(ContinuityError::BodySafety)
    } else {
        Ok(())
    }
}

macro_rules! validated_deserialize {
    ($name:ident, $raw:ident) => {
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let raw = $raw::deserialize(deserializer)?;
                let value = Self::from(raw);
                value.validate().map_err(serde::de::Error::custom)?;
                Ok(value)
            }
        }
    };
}

/// The deliberately narrow V1.2 source family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBrainSourceKindV1 {
    /// One selected `.md` or `.markdown` file.
    MarkdownFile,
    /// One selected UTF-8 `.txt` file.
    TextFile,
    /// One selected folder containing supported text files.
    TextFolder,
}

/// Owner-visible lifecycle for one committed source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBrainSourceStatusV1 {
    /// Committed source is available for explicitly granted recall.
    Ready,
    /// The encrypted binding no longer resolves on this device.
    Unavailable,
    /// Source bodies were removed and cannot be recalled.
    Removed,
}

/// Encrypted source metadata in the separate owner-brain namespace.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainSourceV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable opaque source identifier.
    pub source_id: OpaqueId,
    /// Canonical owner public key.
    pub owner_pubkey: Hex64,
    /// Narrow source family used by the importer.
    pub source_kind: OwnerBrainSourceKindV1,
    /// Encrypted owner-visible source label.
    pub display_name: String,
    /// Hash of the exact committed source snapshot.
    pub root_hash: Sha256Ref,
    /// Import transaction that produced this source revision.
    pub import_transaction_id: OpaqueId,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Canonical last-update timestamp.
    pub updated_at: CanonicalTimestamp,
    /// Current owner-visible source lifecycle.
    pub status: OwnerBrainSourceStatusV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainSourceV1 {
    protocol: String,
    source_id: OpaqueId,
    owner_pubkey: Hex64,
    source_kind: OwnerBrainSourceKindV1,
    display_name: String,
    root_hash: Sha256Ref,
    import_transaction_id: OpaqueId,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
    status: OwnerBrainSourceStatusV1,
}

impl From<RawOwnerBrainSourceV1> for OwnerBrainSourceV1 {
    fn from(raw: RawOwnerBrainSourceV1) -> Self {
        Self {
            protocol: raw.protocol,
            source_id: raw.source_id,
            owner_pubkey: raw.owner_pubkey,
            source_kind: raw.source_kind,
            display_name: raw.display_name,
            root_hash: raw.root_hash,
            import_transaction_id: raw.import_transaction_id,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            status: raw.status,
        }
    }
}

impl OwnerBrainSourceV1 {
    /// Validate the discriminator and bounded sensitive display name.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.display_name, MAX_OWNER_BRAIN_DISPLAY_NAME_BYTES)
    }
}

impl std::fmt::Debug for OwnerBrainSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainSourceV1")
            .field("source_id", &self.source_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("source_kind", &self.source_kind)
            .field("display_name", &"[REDACTED]")
            .field("root_hash", &self.root_hash)
            .field("status", &self.status)
            .finish()
    }
}

validated_deserialize!(OwnerBrainSourceV1, RawOwnerBrainSourceV1);

/// Encrypted, device-local binding from a source ID to its canonical path.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainSourceBindingV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Exact source this device-local binding belongs to.
    pub source_id: OpaqueId,
    /// Canonical owner public key.
    pub owner_pubkey: Hex64,
    /// Encrypted canonical absolute path, never body-free metadata.
    pub canonical_path: String,
    /// Last observed selected-root snapshot.
    pub last_snapshot_hash: Sha256Ref,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainSourceBindingV1 {
    protocol: String,
    source_id: OpaqueId,
    owner_pubkey: Hex64,
    canonical_path: String,
    last_snapshot_hash: Sha256Ref,
}

impl From<RawOwnerBrainSourceBindingV1> for OwnerBrainSourceBindingV1 {
    fn from(raw: RawOwnerBrainSourceBindingV1) -> Self {
        Self {
            protocol: raw.protocol,
            source_id: raw.source_id,
            owner_pubkey: raw.owner_pubkey,
            canonical_path: raw.canonical_path,
            last_snapshot_hash: raw.last_snapshot_hash,
        }
    }
}

impl OwnerBrainSourceBindingV1 {
    /// Validate the discriminator and canonical absolute-path shape.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.canonical_path, MAX_OWNER_BRAIN_PATH_BYTES)?;
        let path = Path::new(&self.canonical_path);
        if !path.is_absolute()
            || path
                .components()
                .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        {
            Err(ContinuityError::BodySafety)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for OwnerBrainSourceBindingV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainSourceBindingV1")
            .field("source_id", &self.source_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("canonical_path", &"[REDACTED]")
            .field("last_snapshot_hash", &self.last_snapshot_hash)
            .finish()
    }
}

validated_deserialize!(OwnerBrainSourceBindingV1, RawOwnerBrainSourceBindingV1);

/// One encrypted normalized chunk belonging to one exact committed source.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainChunkV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable opaque chunk identifier.
    pub chunk_id: OpaqueId,
    /// Exact committed source that owns this chunk.
    pub source_id: OpaqueId,
    /// Deterministic zero-based order within the source.
    pub ordinal: SafeU53,
    /// Encrypted normalized UTF-8 chunk body.
    pub body: String,
    /// Hash of the normalized chunk body.
    pub content_hash: Sha256Ref,
    /// Encrypted source-relative locator.
    pub source_locator: String,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainChunkV1 {
    protocol: String,
    chunk_id: OpaqueId,
    source_id: OpaqueId,
    ordinal: SafeU53,
    body: String,
    content_hash: Sha256Ref,
    source_locator: String,
    created_at: CanonicalTimestamp,
}

impl From<RawOwnerBrainChunkV1> for OwnerBrainChunkV1 {
    fn from(raw: RawOwnerBrainChunkV1) -> Self {
        Self {
            protocol: raw.protocol,
            chunk_id: raw.chunk_id,
            source_id: raw.source_id,
            ordinal: raw.ordinal,
            body: raw.body,
            content_hash: raw.content_hash,
            source_locator: raw.source_locator,
            created_at: raw.created_at,
        }
    }
}

impl OwnerBrainChunkV1 {
    /// Validate bounded content and a non-escaping relative locator.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.body, MAX_OWNER_BRAIN_CHUNK_BYTES)?;
        validate_relative_path(&self.source_locator)
    }
}

impl std::fmt::Debug for OwnerBrainChunkV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainChunkV1")
            .field("chunk_id", &self.chunk_id)
            .field("source_id", &self.source_id)
            .field("ordinal", &self.ordinal)
            .field("body", &"[REDACTED]")
            .field("content_hash", &self.content_hash)
            .field("source_locator", &"[REDACTED]")
            .finish()
    }
}

validated_deserialize!(OwnerBrainChunkV1, RawOwnerBrainChunkV1);

/// Exhaustive preview classification for a selected row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBrainPreviewRowStatusV1 {
    /// Supported file eligible for import.
    Accepted,
    /// Supported file omitted by an explicit deterministic rule.
    Skipped,
    /// File format is outside the V1.2 source boundary.
    Unsupported,
    /// File exceeds the per-file byte bound.
    Oversized,
    /// File does not decode as supported UTF-8 text.
    Binary,
    /// File name or content matches a credential exclusion rule.
    CredentialLike,
    /// File is byte-identical to committed source content.
    Duplicate,
    /// File differs from the committed source snapshot.
    Changed,
    /// Symlink or path traversal escapes the selected root.
    UnsafePath,
}

/// One sensitive owner-visible row in a zero-write preview.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainPreviewRowV1 {
    /// Sensitive path relative to the selected root.
    pub relative_path: String,
    /// Deterministic safety/import classification.
    pub status: OwnerBrainPreviewRowStatusV1,
    /// Observed source byte count.
    pub byte_count: SafeU53,
    /// Content hash present only for accepted, duplicate, or changed rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<Sha256Ref>,
    /// Body-free reason present only for excluded rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<OpaqueId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainPreviewRowV1 {
    relative_path: String,
    status: OwnerBrainPreviewRowStatusV1,
    byte_count: SafeU53,
    content_hash: Option<Sha256Ref>,
    reason_code: Option<OpaqueId>,
}

impl From<RawOwnerBrainPreviewRowV1> for OwnerBrainPreviewRowV1 {
    fn from(raw: RawOwnerBrainPreviewRowV1) -> Self {
        Self {
            relative_path: raw.relative_path,
            status: raw.status,
            byte_count: raw.byte_count,
            content_hash: raw.content_hash,
            reason_code: raw.reason_code,
        }
    }
}

impl OwnerBrainPreviewRowV1 {
    /// Validate path safety and status-dependent hash/reason fields.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        validate_relative_path(&self.relative_path)?;
        let accepted = matches!(
            self.status,
            OwnerBrainPreviewRowStatusV1::Accepted
                | OwnerBrainPreviewRowStatusV1::Duplicate
                | OwnerBrainPreviewRowStatusV1::Changed
        );
        if accepted != self.content_hash.is_some()
            || accepted == self.reason_code.is_some()
            || (accepted && self.byte_count.get() > MAX_OWNER_BRAIN_FILE_BYTES)
        {
            Err(ContinuityError::Status)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for OwnerBrainPreviewRowV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainPreviewRowV1")
            .field("relative_path", &"[REDACTED]")
            .field("status", &self.status)
            .field("byte_count", &self.byte_count)
            .field("content_hash", &self.content_hash)
            .field("reason_code", &self.reason_code)
            .finish()
    }
}

validated_deserialize!(OwnerBrainPreviewRowV1, RawOwnerBrainPreviewRowV1);

/// Zero-write preview bound to one exact selected-root snapshot.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainImportPreviewV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable preview identifier.
    pub preview_id: OpaqueId,
    /// One-way reference to the in-memory commit token.
    pub preview_token_hash: Sha256Ref,
    /// Canonical owner public key.
    pub owner_pubkey: Hex64,
    /// Narrow selected source family.
    pub source_kind: OwnerBrainSourceKindV1,
    /// Encrypted owner-visible source label.
    pub display_name: String,
    /// Hash of the exact selected-root snapshot.
    pub root_snapshot_hash: Sha256Ref,
    /// Canonical preview creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Canonical expiration timestamp.
    pub expires_at: CanonicalTimestamp,
    /// Deterministic bounded preview rows.
    pub rows: Vec<OwnerBrainPreviewRowV1>,
    /// Aggregate bytes for accepted, duplicate, and changed rows.
    pub accepted_bytes: SafeU53,
    /// Frozen zero proving preview is a zero-write operation.
    pub write_count: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainImportPreviewV1 {
    protocol: String,
    preview_id: OpaqueId,
    preview_token_hash: Sha256Ref,
    owner_pubkey: Hex64,
    source_kind: OwnerBrainSourceKindV1,
    display_name: String,
    root_snapshot_hash: Sha256Ref,
    created_at: CanonicalTimestamp,
    expires_at: CanonicalTimestamp,
    rows: Vec<OwnerBrainPreviewRowV1>,
    accepted_bytes: SafeU53,
    write_count: SafeU53,
}

impl From<RawOwnerBrainImportPreviewV1> for OwnerBrainImportPreviewV1 {
    fn from(raw: RawOwnerBrainImportPreviewV1) -> Self {
        Self {
            protocol: raw.protocol,
            preview_id: raw.preview_id,
            preview_token_hash: raw.preview_token_hash,
            owner_pubkey: raw.owner_pubkey,
            source_kind: raw.source_kind,
            display_name: raw.display_name,
            root_snapshot_hash: raw.root_snapshot_hash,
            created_at: raw.created_at,
            expires_at: raw.expires_at,
            rows: raw.rows,
            accepted_bytes: raw.accepted_bytes,
            write_count: raw.write_count,
        }
    }
}

impl OwnerBrainImportPreviewV1 {
    /// Validate zero-write, row, aggregate, uniqueness, and expiry invariants.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.display_name, MAX_OWNER_BRAIN_DISPLAY_NAME_BYTES)?;
        if self.rows.is_empty()
            || self.rows.len() > MAX_OWNER_BRAIN_PREVIEW_ROWS
            || self.write_count.get() != 0
            || self.accepted_bytes.get() > MAX_OWNER_BRAIN_IMPORT_BYTES
            || self.created_at >= self.expires_at
        {
            return Err(ContinuityError::Status);
        }
        let mut paths = std::collections::BTreeSet::new();
        let mut accepted_bytes = 0_u64;
        for row in &self.rows {
            row.validate()?;
            if !paths.insert(&row.relative_path) {
                return Err(ContinuityError::Sequence);
            }
            if matches!(
                row.status,
                OwnerBrainPreviewRowStatusV1::Accepted
                    | OwnerBrainPreviewRowStatusV1::Duplicate
                    | OwnerBrainPreviewRowStatusV1::Changed
            ) {
                accepted_bytes = accepted_bytes.saturating_add(row.byte_count.get());
            }
        }
        (accepted_bytes == self.accepted_bytes.get())
            .then_some(())
            .ok_or(ContinuityError::Binding)
    }
}

impl std::fmt::Debug for OwnerBrainImportPreviewV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerBrainImportPreviewV1")
            .field("preview_id", &self.preview_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("source_kind", &self.source_kind)
            .field("display_name", &"[REDACTED]")
            .field("row_count", &self.rows.len())
            .field("accepted_bytes", &self.accepted_bytes)
            .field("write_count", &self.write_count)
            .finish()
    }
}

validated_deserialize!(OwnerBrainImportPreviewV1, RawOwnerBrainImportPreviewV1);

/// One terminal outcome for an atomic owner-brain import transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBrainImportStateV1 {
    /// All staged encrypted rows became visible atomically.
    Committed,
    /// Owner cancellation exposed no staged rows.
    Cancelled,
    /// Validation or persistence failure exposed no staged rows.
    Failed,
}

/// Body-free import outcome. A source ID exists only after atomic commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainImportCommitV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable import transaction identifier.
    pub import_transaction_id: OpaqueId,
    /// Exact preview consumed by this attempt.
    pub preview_id: OpaqueId,
    /// Committed source identifier, present only after success.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<OpaqueId>,
    /// Revalidated selected-root snapshot.
    pub root_snapshot_hash: Sha256Ref,
    /// One terminal atomic outcome.
    pub state: OwnerBrainImportStateV1,
    /// Visible file count, nonzero only after commit.
    pub imported_file_count: SafeU53,
    /// Visible chunk count, nonzero only after commit.
    pub imported_chunk_count: SafeU53,
    /// Canonical completion timestamp.
    pub completed_at: CanonicalTimestamp,
    /// Body-free failure reason, absent after commit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<OpaqueId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainImportCommitV1 {
    protocol: String,
    import_transaction_id: OpaqueId,
    preview_id: OpaqueId,
    source_id: Option<OpaqueId>,
    root_snapshot_hash: Sha256Ref,
    state: OwnerBrainImportStateV1,
    imported_file_count: SafeU53,
    imported_chunk_count: SafeU53,
    completed_at: CanonicalTimestamp,
    error_code: Option<OpaqueId>,
}

impl From<RawOwnerBrainImportCommitV1> for OwnerBrainImportCommitV1 {
    fn from(raw: RawOwnerBrainImportCommitV1) -> Self {
        Self {
            protocol: raw.protocol,
            import_transaction_id: raw.import_transaction_id,
            preview_id: raw.preview_id,
            source_id: raw.source_id,
            root_snapshot_hash: raw.root_snapshot_hash,
            state: raw.state,
            imported_file_count: raw.imported_file_count,
            imported_chunk_count: raw.imported_chunk_count,
            completed_at: raw.completed_at,
            error_code: raw.error_code,
        }
    }
}

impl OwnerBrainImportCommitV1 {
    /// Validate terminal-state and visible-count symmetry.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        let committed = self.state == OwnerBrainImportStateV1::Committed;
        if committed != self.source_id.is_some()
            || committed == self.error_code.is_some()
            || (!committed
                && (self.imported_file_count.get() != 0 || self.imported_chunk_count.get() != 0))
            || (committed
                && (self.imported_file_count.get() == 0 || self.imported_chunk_count.get() == 0))
        {
            Err(ContinuityError::Status)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(OwnerBrainImportCommitV1, RawOwnerBrainImportCommitV1);

/// Body-free receipt for one authorized owner-brain context decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OwnerBrainContextReceiptV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Stable body-free receipt identifier.
    pub receipt_id: OpaqueId,
    /// Exact context request correlation identifier.
    pub request_id: OpaqueId,
    /// Canonical owner public key.
    pub owner_pubkey: Hex64,
    /// Exact responding resident public key.
    pub resident_pubkey: Hex64,
    /// Exact source evaluated for the request.
    pub source_id: OpaqueId,
    /// Exact grant evaluated before retrieval.
    pub grant_id: OpaqueId,
    /// Exhaustive owner-brain layer outcome.
    pub status: ContinuityLayerStatusV1,
    /// Sorted unique hashes for selected chunks; bodies are absent.
    pub selected_chunk_hashes: Vec<Sha256Ref>,
    /// Aggregate selected UTF-8 byte count.
    pub selected_byte_count: SafeU53,
    /// Whether eligible material was omitted by a bound.
    pub truncated: bool,
    /// Body-free elapsed time in milliseconds.
    pub duration_ms: SafeU53,
    /// Canonical receipt creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Whether this source was explicitly selected for the conversation.
    /// Background sources remain eligible only through their existing grant.
    pub selected_context: bool,
    /// Number of explicitly selected conversation sources that contributed
    /// at least one chunk to this bounded request.
    pub selected_source_count: SafeU53,
    /// Number of relevant background sources that contributed at least one
    /// fallback chunk to this bounded request.
    pub background_source_count: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOwnerBrainContextReceiptV1 {
    protocol: String,
    receipt_id: OpaqueId,
    request_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    grant_id: OpaqueId,
    status: ContinuityLayerStatusV1,
    selected_chunk_hashes: Vec<Sha256Ref>,
    selected_byte_count: SafeU53,
    truncated: bool,
    duration_ms: SafeU53,
    created_at: CanonicalTimestamp,
    #[serde(default)]
    selected_context: bool,
    #[serde(default = "zero_safe_u53")]
    selected_source_count: SafeU53,
    #[serde(default = "zero_safe_u53")]
    background_source_count: SafeU53,
}

fn zero_safe_u53() -> SafeU53 {
    SafeU53::new(0).expect("zero is always a safe integer")
}

impl From<RawOwnerBrainContextReceiptV1> for OwnerBrainContextReceiptV1 {
    fn from(raw: RawOwnerBrainContextReceiptV1) -> Self {
        Self {
            protocol: raw.protocol,
            receipt_id: raw.receipt_id,
            request_id: raw.request_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            source_id: raw.source_id,
            grant_id: raw.grant_id,
            status: raw.status,
            selected_chunk_hashes: raw.selected_chunk_hashes,
            selected_byte_count: raw.selected_byte_count,
            truncated: raw.truncated,
            duration_ms: raw.duration_ms,
            created_at: raw.created_at,
            selected_context: raw.selected_context,
            selected_source_count: raw.selected_source_count,
            background_source_count: raw.background_source_count,
        }
    }
}

impl OwnerBrainContextReceiptV1 {
    /// Validate responder separation and ready/selection symmetry.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        let ready = self.status == ContinuityLayerStatusV1::Ready;
        if self.owner_pubkey == self.resident_pubkey
            || self.selected_chunk_hashes.len() > MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS
            || self
                .selected_chunk_hashes
                .windows(2)
                .any(|pair| pair[0] >= pair[1])
            || ready == self.selected_chunk_hashes.is_empty()
            || ready != (self.selected_byte_count.get() > 0)
            || self.selected_byte_count.get() > MAX_OWNER_BRAIN_RETRIEVAL_BYTES as u64
            || self.selected_source_count.get() > MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS as u64
            || self.background_source_count.get() > MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS as u64
            || self
                .selected_source_count
                .get()
                .saturating_add(self.background_source_count.get())
                > MAX_OWNER_BRAIN_RETRIEVAL_CHUNKS as u64
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(OwnerBrainContextReceiptV1, RawOwnerBrainContextReceiptV1);

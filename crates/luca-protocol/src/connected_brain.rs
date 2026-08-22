//! Strict V1.2.1 contracts for connected Brain sources and repository work.
//!
//! Source roots, locators, display names, and index material are sensitive and
//! belong only in the encrypted owner-brain namespace. Tool requests and
//! receipts are body-free; the desktop resolves source IDs to local paths.

use crate::{CanonicalTimestamp, Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Component, Path};

/// Version discriminator for connected source records.
pub const CONNECTED_BRAIN_PROTOCOL: &str = "luca.brain.connected.v1";
/// Version discriminator for scoped repository work records.
pub const REPOSITORY_WORK_PROTOCOL: &str = "luca.repository.work.v1";
/// Maximum roots the discovery surface may bind on one installation.
pub const MAX_CONNECTED_BRAIN_ROOTS: usize = 32;
/// Maximum repositories returned by one bounded discovery pass.
pub const MAX_CONNECTED_REPOSITORIES: usize = 512;
/// Maximum entries stored in one encrypted index page.
pub const MAX_CONNECTED_INDEX_PAGE_ENTRIES: usize = 512;
/// Maximum hashed lexical terms retained for one source entry.
pub const MAX_CONNECTED_ENTRY_TOKEN_HASHES: usize = 256;
/// Maximum relative paths carried by one repository tool request.
pub const MAX_REPOSITORY_TOOL_PATHS: usize = 32;

#[derive(Debug, thiserror::Error, Clone, Copy, PartialEq, Eq)]
pub enum ConnectedBrainError {
    #[error("connected Brain protocol is invalid")]
    Protocol,
    #[error("connected Brain record is invalid")]
    Invalid,
    #[error("connected Brain text is not bounded")]
    Text,
    #[error("connected Brain path is unsafe")]
    Path,
    #[error("connected Brain collection is not bounded")]
    Bounds,
}

fn bounded_text(value: &str, maximum: usize) -> Result<(), ConnectedBrainError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > maximum
        || value.chars().any(|character| {
            character == '\0' || (character.is_control() && character != '\n' && character != '\t')
        })
    {
        Err(ConnectedBrainError::Text)
    } else {
        Ok(())
    }
}

fn relative_path(value: &str) -> Result<(), ConnectedBrainError> {
    bounded_text(value, 4096)?;
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || path
            .components()
            .any(|component| component.as_os_str() == ".git")
    {
        Err(ConnectedBrainError::Path)
    } else {
        Ok(())
    }
}

fn canonical_root(value: &str) -> Result<(), ConnectedBrainError> {
    bounded_text(value, 4096)?;
    let path = Path::new(value);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        Err(ConnectedBrainError::Path)
    } else {
        Ok(())
    }
}

fn unique<T: Ord + Clone>(values: &[T]) -> bool {
    values.iter().cloned().collect::<BTreeSet<_>>().len() == values.len()
}

/// Source adapters shipped by V1.2.1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectedBrainSourceKindV1 {
    Repository,
    CodexHistory,
    ClaudeHistory,
}

/// Owner-visible connected source state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectedBrainSourceStatusV1 {
    Connecting,
    Current,
    NeedsAttention,
    Unavailable,
    Disconnected,
}

/// Explicit capabilities of one connected source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectedBrainCapabilityV1 {
    Recall,
    RepositoryRead,
    RepositoryRequestWrite,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawConnectedBrainSourceV1")]
pub struct ConnectedBrainSourceV1 {
    pub protocol: String,
    pub source_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub source_kind: ConnectedBrainSourceKindV1,
    pub display_name: String,
    pub status: ConnectedBrainSourceStatusV1,
    pub capabilities: Vec<ConnectedBrainCapabilityV1>,
    pub index_revision: Sha256Ref,
    pub created_at: CanonicalTimestamp,
    pub updated_at: CanonicalTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_refreshed_at: Option<CanonicalTimestamp>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConnectedBrainSourceV1 {
    protocol: String,
    source_id: OpaqueId,
    owner_pubkey: Hex64,
    source_kind: ConnectedBrainSourceKindV1,
    display_name: String,
    status: ConnectedBrainSourceStatusV1,
    capabilities: Vec<ConnectedBrainCapabilityV1>,
    index_revision: Sha256Ref,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
    last_refreshed_at: Option<CanonicalTimestamp>,
}

impl TryFrom<RawConnectedBrainSourceV1> for ConnectedBrainSourceV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawConnectedBrainSourceV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            source_id: raw.source_id,
            owner_pubkey: raw.owner_pubkey,
            source_kind: raw.source_kind,
            display_name: raw.display_name,
            status: raw.status,
            capabilities: raw.capabilities,
            index_revision: raw.index_revision,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            last_refreshed_at: raw.last_refreshed_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl ConnectedBrainSourceV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != CONNECTED_BRAIN_PROTOCOL {
            return Err(ConnectedBrainError::Protocol);
        }
        bounded_text(&self.display_name, 240)?;
        if self.capabilities.is_empty()
            || self.capabilities.len() > 3
            || !unique(&self.capabilities)
            || !self
                .capabilities
                .contains(&ConnectedBrainCapabilityV1::Recall)
            || (self.source_kind != ConnectedBrainSourceKindV1::Repository
                && self.capabilities.len() != 1)
        {
            return Err(ConnectedBrainError::Invalid);
        }
        Ok(())
    }
}

impl std::fmt::Debug for ConnectedBrainSourceV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectedBrainSourceV1")
            .field("source_id", &self.source_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("source_kind", &self.source_kind)
            .field("display_name", &"[REDACTED]")
            .field("status", &self.status)
            .field("index_revision", &self.index_revision)
            .finish()
    }
}

/// Encrypted device-local source root and adapter cursor.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawConnectedBrainBindingV1")]
pub struct ConnectedBrainBindingV1 {
    pub protocol: String,
    pub source_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub canonical_root: String,
    pub adapter_version: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConnectedBrainBindingV1 {
    protocol: String,
    source_id: OpaqueId,
    owner_pubkey: Hex64,
    canonical_root: String,
    adapter_version: OpaqueId,
    refresh_cursor: Option<String>,
}

impl TryFrom<RawConnectedBrainBindingV1> for ConnectedBrainBindingV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawConnectedBrainBindingV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            source_id: raw.source_id,
            owner_pubkey: raw.owner_pubkey,
            canonical_root: raw.canonical_root,
            adapter_version: raw.adapter_version,
            refresh_cursor: raw.refresh_cursor,
        };
        value.validate()?;
        Ok(value)
    }
}

impl ConnectedBrainBindingV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != CONNECTED_BRAIN_PROTOCOL {
            return Err(ConnectedBrainError::Protocol);
        }
        canonical_root(&self.canonical_root)?;
        if let Some(cursor) = &self.refresh_cursor {
            bounded_text(cursor, 1024)?;
        }
        Ok(())
    }
}

impl std::fmt::Debug for ConnectedBrainBindingV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectedBrainBindingV1")
            .field("source_id", &self.source_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("canonical_root", &"[REDACTED]")
            .field("adapter_version", &self.adapter_version)
            .field("refresh_cursor", &"[REDACTED]")
            .finish()
    }
}

/// A body-free encrypted locator used to find and verify an original excerpt.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawConnectedBrainIndexEntryV1")]
pub struct ConnectedBrainIndexEntryV1 {
    pub protocol: String,
    pub entry_id: OpaqueId,
    pub source_id: OpaqueId,
    pub relative_locator: String,
    pub ordinal: SafeU53,
    pub content_hash: Sha256Ref,
    pub token_hashes: Vec<Sha256Ref>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<CanonicalTimestamp>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConnectedBrainIndexEntryV1 {
    protocol: String,
    entry_id: OpaqueId,
    source_id: OpaqueId,
    relative_locator: String,
    ordinal: SafeU53,
    content_hash: Sha256Ref,
    token_hashes: Vec<Sha256Ref>,
    captured_at: Option<CanonicalTimestamp>,
}

impl TryFrom<RawConnectedBrainIndexEntryV1> for ConnectedBrainIndexEntryV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawConnectedBrainIndexEntryV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            entry_id: raw.entry_id,
            source_id: raw.source_id,
            relative_locator: raw.relative_locator,
            ordinal: raw.ordinal,
            content_hash: raw.content_hash,
            token_hashes: raw.token_hashes,
            captured_at: raw.captured_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl ConnectedBrainIndexEntryV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != CONNECTED_BRAIN_PROTOCOL {
            return Err(ConnectedBrainError::Protocol);
        }
        relative_path(&self.relative_locator)?;
        if self.token_hashes.is_empty()
            || self.token_hashes.len() > MAX_CONNECTED_ENTRY_TOKEN_HASHES
            || !unique(&self.token_hashes)
        {
            return Err(ConnectedBrainError::Bounds);
        }
        Ok(())
    }
}

impl std::fmt::Debug for ConnectedBrainIndexEntryV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ConnectedBrainIndexEntryV1")
            .field("entry_id", &self.entry_id)
            .field("source_id", &self.source_id)
            .field("relative_locator", &"[REDACTED]")
            .field("ordinal", &self.ordinal)
            .field("content_hash", &self.content_hash)
            .field("token_hash_count", &self.token_hashes.len())
            .finish()
    }
}

/// Owner consent applied by default to current and future residents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawConnectedBrainPolicyV1")]
pub struct ConnectedBrainPolicyV1 {
    pub protocol: String,
    pub all_current_residents: bool,
    pub all_future_residents: bool,
    pub remote_excerpt_egress: bool,
    pub repository_read: bool,
    pub repository_request_write: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConnectedBrainPolicyV1 {
    protocol: String,
    all_current_residents: bool,
    all_future_residents: bool,
    remote_excerpt_egress: bool,
    repository_read: bool,
    repository_request_write: bool,
}

impl TryFrom<RawConnectedBrainPolicyV1> for ConnectedBrainPolicyV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawConnectedBrainPolicyV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            all_current_residents: raw.all_current_residents,
            all_future_residents: raw.all_future_residents,
            remote_excerpt_egress: raw.remote_excerpt_egress,
            repository_read: raw.repository_read,
            repository_request_write: raw.repository_request_write,
        };
        value.validate()?;
        Ok(value)
    }
}

impl ConnectedBrainPolicyV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != CONNECTED_BRAIN_PROTOCOL {
            return Err(ConnectedBrainError::Protocol);
        }
        if !self.all_current_residents
            || !self.all_future_residents
            || !self.remote_excerpt_egress
            || !self.repository_read
            || !self.repository_request_write
        {
            return Err(ConnectedBrainError::Invalid);
        }
        Ok(())
    }
}

/// Current authority state for one repository work grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryWorkGrantStateV1 {
    Active,
    Revoked,
    Stale,
}

/// Encrypted per-resident repository work grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawRepositoryWorkGrantV1")]
pub struct RepositoryWorkGrantV1 {
    pub protocol: String,
    pub grant_id: OpaqueId,
    pub source_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub binding_ref: Sha256Ref,
    pub state: RepositoryWorkGrantStateV1,
    pub created_at: CanonicalTimestamp,
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRepositoryWorkGrantV1 {
    protocol: String,
    grant_id: OpaqueId,
    source_id: OpaqueId,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    state: RepositoryWorkGrantStateV1,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
}

impl TryFrom<RawRepositoryWorkGrantV1> for RepositoryWorkGrantV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawRepositoryWorkGrantV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            grant_id: raw.grant_id,
            source_id: raw.source_id,
            resident_pubkey: raw.resident_pubkey,
            binding_ref: raw.binding_ref,
            state: raw.state,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl RepositoryWorkGrantV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        (self.protocol == REPOSITORY_WORK_PROTOCOL)
            .then_some(())
            .ok_or(ConnectedBrainError::Protocol)
    }
}

/// Scoped repository operations exposed to residents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryToolOperationV1 {
    OperatorStatus,
    List,
    Tree,
    Search,
    Read,
    ApplyPatch,
    Run,
    Status,
    Diff,
    Commit,
}

impl RepositoryToolOperationV1 {
    /// Returns whether the desktop must obtain an owner decision before use.
    pub fn requires_permission(self) -> bool {
        matches!(self, Self::ApplyPatch | Self::Run | Self::Commit)
    }
}

/// Body-free request sent from the scoped MCP bridge to the desktop broker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawRepositoryToolRequestV1")]
pub struct RepositoryToolRequestV1 {
    pub protocol: String,
    pub request_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub turn_id: OpaqueId,
    pub conversation_id: OpaqueId,
    pub source_id: OpaqueId,
    pub binding_ref: Sha256Ref,
    pub operation: RepositoryToolOperationV1,
    pub operation_fingerprint: Sha256Ref,
    pub relative_paths: Vec<String>,
    pub display_summary: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRepositoryToolRequestV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    turn_id: OpaqueId,
    conversation_id: OpaqueId,
    source_id: OpaqueId,
    binding_ref: Sha256Ref,
    operation: RepositoryToolOperationV1,
    operation_fingerprint: Sha256Ref,
    relative_paths: Vec<String>,
    display_summary: String,
}

impl TryFrom<RawRepositoryToolRequestV1> for RepositoryToolRequestV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawRepositoryToolRequestV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            request_id: raw.request_id,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            turn_id: raw.turn_id,
            conversation_id: raw.conversation_id,
            source_id: raw.source_id,
            binding_ref: raw.binding_ref,
            operation: raw.operation,
            operation_fingerprint: raw.operation_fingerprint,
            relative_paths: raw.relative_paths,
            display_summary: raw.display_summary,
        };
        value.validate()?;
        Ok(value)
    }
}

impl RepositoryToolRequestV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != REPOSITORY_WORK_PROTOCOL {
            return Err(ConnectedBrainError::Protocol);
        }
        bounded_text(&self.display_summary, 1024)?;
        if self.relative_paths.len() > MAX_REPOSITORY_TOOL_PATHS || !unique(&self.relative_paths) {
            return Err(ConnectedBrainError::Bounds);
        }
        self.relative_paths
            .iter()
            .try_for_each(|path| relative_path(path))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryToolDispositionV1 {
    Denied,
    AllowOnce,
    AllowConversation,
}

/// Desktop decision bound to one exact repository tool request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawRepositoryToolDecisionV1")]
pub struct RepositoryToolDecisionV1 {
    pub protocol: String,
    pub request_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub source_id: OpaqueId,
    pub binding_ref: Sha256Ref,
    pub operation_fingerprint: Sha256Ref,
    pub disposition: RepositoryToolDispositionV1,
    pub decided_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRepositoryToolDecisionV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    source_id: OpaqueId,
    binding_ref: Sha256Ref,
    operation_fingerprint: Sha256Ref,
    disposition: RepositoryToolDispositionV1,
    decided_at: CanonicalTimestamp,
}

impl TryFrom<RawRepositoryToolDecisionV1> for RepositoryToolDecisionV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawRepositoryToolDecisionV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            request_id: raw.request_id,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            source_id: raw.source_id,
            binding_ref: raw.binding_ref,
            operation_fingerprint: raw.operation_fingerprint,
            disposition: raw.disposition,
            decided_at: raw.decided_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl RepositoryToolDecisionV1 {
    /// Validates protocol-level invariants that do not require the request.
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        (self.protocol == REPOSITORY_WORK_PROTOCOL)
            .then_some(())
            .ok_or(ConnectedBrainError::Protocol)
    }

    /// Ensures this decision is bound to every security-relevant request field.
    pub fn validate_for(
        &self,
        request: &RepositoryToolRequestV1,
    ) -> Result<(), ConnectedBrainError> {
        request.validate()?;
        if self.protocol != REPOSITORY_WORK_PROTOCOL
            || self.request_id != request.request_id
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.source_id != request.source_id
            || self.binding_ref != request.binding_ref
            || self.operation_fingerprint != request.operation_fingerprint
            || (!request.operation.requires_permission()
                && self.disposition != RepositoryToolDispositionV1::AllowOnce)
        {
            return Err(ConnectedBrainError::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositoryToolReceiptStatusV1 {
    Completed,
    Denied,
    Failed,
    Cancelled,
    Stale,
}

/// Body-free process receipt for one repository tool attempt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawRepositoryToolReceiptV1")]
pub struct RepositoryToolReceiptV1 {
    pub protocol: String,
    pub receipt_id: OpaqueId,
    pub request_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub source_id: OpaqueId,
    pub operation: RepositoryToolOperationV1,
    pub status: RepositoryToolReceiptStatusV1,
    pub changed_path_count: SafeU53,
    pub created_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRepositoryToolReceiptV1 {
    protocol: String,
    receipt_id: OpaqueId,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    source_id: OpaqueId,
    operation: RepositoryToolOperationV1,
    status: RepositoryToolReceiptStatusV1,
    changed_path_count: SafeU53,
    created_at: CanonicalTimestamp,
}

impl TryFrom<RawRepositoryToolReceiptV1> for RepositoryToolReceiptV1 {
    type Error = ConnectedBrainError;

    fn try_from(raw: RawRepositoryToolReceiptV1) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            receipt_id: raw.receipt_id,
            request_id: raw.request_id,
            resident_pubkey: raw.resident_pubkey,
            source_id: raw.source_id,
            operation: raw.operation,
            status: raw.status,
            changed_path_count: raw.changed_path_count,
            created_at: raw.created_at,
        };
        value.validate()?;
        Ok(value)
    }
}

impl RepositoryToolReceiptV1 {
    pub fn validate(&self) -> Result<(), ConnectedBrainError> {
        if self.protocol != REPOSITORY_WORK_PROTOCOL
            || self.changed_path_count.get() as usize > MAX_REPOSITORY_TOOL_PATHS
            || (!matches!(
                self.operation,
                RepositoryToolOperationV1::ApplyPatch | RepositoryToolOperationV1::Commit
            ) && self.changed_path_count.get() != 0)
        {
            return Err(ConnectedBrainError::Invalid);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex() -> Hex64 {
        Hex64::parse("11".repeat(32)).unwrap()
    }

    fn sha(value: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", value.to_string().repeat(64))).unwrap()
    }

    fn time() -> CanonicalTimestamp {
        CanonicalTimestamp::parse("2026-08-09T00:00:00Z").unwrap()
    }

    #[test]
    fn connected_source_redacts_sensitive_display_name() {
        let source = ConnectedBrainSourceV1 {
            protocol: CONNECTED_BRAIN_PROTOCOL.into(),
            source_id: OpaqueId::parse("source-one").unwrap(),
            owner_pubkey: hex(),
            source_kind: ConnectedBrainSourceKindV1::Repository,
            display_name: "secret-repository".into(),
            status: ConnectedBrainSourceStatusV1::Current,
            capabilities: vec![
                ConnectedBrainCapabilityV1::Recall,
                ConnectedBrainCapabilityV1::RepositoryRead,
                ConnectedBrainCapabilityV1::RepositoryRequestWrite,
            ],
            index_revision: sha('a'),
            created_at: time(),
            updated_at: time(),
            last_refreshed_at: Some(time()),
        };
        source.validate().unwrap();
        let debug = format!("{source:?}");
        assert!(!debug.contains("secret-repository"));
        let mut encoded = serde_json::to_value(source).unwrap();
        encoded["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ConnectedBrainSourceV1>(encoded).is_err());
    }

    #[test]
    fn index_locator_rejects_escape_and_git_metadata() {
        for locator in ["../secret", ".git/config", "/tmp/secret"] {
            let entry = ConnectedBrainIndexEntryV1 {
                protocol: CONNECTED_BRAIN_PROTOCOL.into(),
                entry_id: OpaqueId::parse("entry-one").unwrap(),
                source_id: OpaqueId::parse("source-one").unwrap(),
                relative_locator: locator.into(),
                ordinal: SafeU53::new(0).unwrap(),
                content_hash: sha('a'),
                token_hashes: vec![sha('b')],
                captured_at: None,
            };
            assert_eq!(entry.validate(), Err(ConnectedBrainError::Path));
        }
    }

    #[test]
    fn permission_decision_binds_exact_request() {
        let request = RepositoryToolRequestV1 {
            protocol: REPOSITORY_WORK_PROTOCOL.into(),
            request_id: OpaqueId::parse("request-one").unwrap(),
            resident_pubkey: hex(),
            session_epoch: SafeU53::new(7).unwrap(),
            turn_id: OpaqueId::parse("turn-one").unwrap(),
            conversation_id: OpaqueId::parse("conversation-one").unwrap(),
            source_id: OpaqueId::parse("source-one").unwrap(),
            binding_ref: sha('a'),
            operation: RepositoryToolOperationV1::Run,
            operation_fingerprint: sha('b'),
            relative_paths: Vec::new(),
            display_summary: "Run cargo test".into(),
        };
        request.validate().unwrap();
        let mut decision = RepositoryToolDecisionV1 {
            protocol: REPOSITORY_WORK_PROTOCOL.into(),
            request_id: request.request_id.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: request.session_epoch,
            source_id: request.source_id.clone(),
            binding_ref: request.binding_ref.clone(),
            operation_fingerprint: request.operation_fingerprint.clone(),
            disposition: RepositoryToolDispositionV1::AllowConversation,
            decided_at: time(),
        };
        decision.validate_for(&request).unwrap();
        decision.session_epoch = SafeU53::new(8).unwrap();
        assert_eq!(
            decision.validate_for(&request),
            Err(ConnectedBrainError::Invalid)
        );
    }
}

//! Local-only resident capability and durable grant contracts.
//!
//! These structures describe desktop authority. They are never relay events
//! and intentionally contain no signing capability or secret value.

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53, Sha256Ref};

/// Stable wire identifier for structured desktop capability prompts.
pub const MANAGED_PERMISSION_V2_PROTOCOL: &str = "luca.managed.permission.v2";
/// Stable wire identifier for body-free capability receipts.
pub const CAPABILITY_RECEIPT_PROTOCOL: &str = "luca.capability.receipt.v1";
/// Stable wire identifier for live, body-free resident session capability facts.
pub const RESIDENT_SESSION_CAPABILITY_PROTOCOL: &str = "luca.resident-session-capability.v1";
pub const MAX_RESIDENT_SESSION_COMMANDS: usize = 64;
pub const MAX_RESIDENT_SESSION_COMMAND_NAME_BYTES: usize = 160;
pub const MAX_RESIDENT_SESSION_COMMAND_DESCRIPTION_BYTES: usize = 512;

/// Evidence strength for one capability fact. Declared support never silently
/// becomes proof that the current provider session can execute it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySupportV1 {
    Declared,
    Discovered,
    LiveVerified,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityConfigurationV1 {
    Configured,
    NeedsAttention,
    Absent,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityAuthorityV1 {
    Granted,
    ApprovalRequired,
    Denied,
    RuntimeManaged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityExecutionV1 {
    Available,
    Active,
    Failed,
    Cancelled,
    Unavailable,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentCapabilityFactV1 {
    pub capability_id: String,
    pub provider: String,
    pub support: CapabilitySupportV1,
    pub configuration: CapabilityConfigurationV1,
    pub authority: CapabilityAuthorityV1,
    pub execution: CapabilityExecutionV1,
    pub evidence_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
}

/// One exact command advertised by the active ACP session. The canonical name
/// includes its provider-owned prefix (`/` or `$`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentSessionCommandV1 {
    pub canonical_name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeTaskFactsV1 {
    pub root_dispatch: CapabilitySupportV1,
    pub child_events: CapabilitySupportV1,
    pub stable_child_ids: CapabilitySupportV1,
    pub root_cancel: CapabilitySupportV1,
    pub native_visibility: CapabilitySupportV1,
    pub nonpersistent_internal_sessions: CapabilitySupportV1,
}

/// Native source of truth for one managed resident session. This frame is
/// local-only and contains no command body, prompt, tool payload, or secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResidentSessionCapabilityV1 {
    pub protocol: String,
    pub resident_pubkey: Hex64,
    pub runtime_family: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub session_epoch: SafeU53,
    pub observed_at: String,
    pub capabilities: Vec<ResidentCapabilityFactV1>,
    pub commands: Vec<ResidentSessionCommandV1>,
    pub native_task_facts: NativeTaskFactsV1,
}

/// Persistent access posture for one stable resident identity.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentAccessLevel {
    Restricted,
    #[default]
    Standard,
    Full,
}

/// Capability classes understood by the desktop authority broker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind {
    FilesystemRead,
    FilesystemWrite,
    ProcessExecute,
    NetworkAccess,
    HarnessManage,
    PackageInstall,
    ExternalCommunication,
    DestructiveAction,
    CredentialUse,
}

/// Risk classification controls whether Full Access may proceed silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityRisk {
    Routine,
    Elevated,
    HighImpact,
}

/// A canonical local resource scope. `resource_ref` is meaningful only to the
/// desktop and must never be copied into a relay event or body-free receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityResourceV1 {
    pub kind: String,
    pub resource_ref: String,
    pub display_name: String,
}

/// One durable, revocable grant for a stable resident identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DurableCapabilityGrantV1 {
    pub grant_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub capability: CapabilityKind,
    pub resource: CapabilityResourceV1,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
}

/// Structured permission request used by app-mediated operator tools.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionRequestV2 {
    pub protocol: String,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub turn_id: OpaqueId,
    pub conversation_id: OpaqueId,
    pub request_id: OpaqueId,
    pub capability: CapabilityKind,
    pub risk: CapabilityRisk,
    pub operation: String,
    pub operation_fingerprint: Sha256Ref,
    pub resource: CapabilityResourceV1,
}

/// Terminal result of one app-mediated capability operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityReceiptStatus {
    Requested,
    Approved,
    Committed,
    Cancelled,
    Failed,
    RolledBack,
}

/// Redacted receipt. It deliberately omits the local resource reference,
/// command text, file bodies, environment, credentials, and tool output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityReceiptV1 {
    pub protocol: String,
    pub receipt_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub capability: CapabilityKind,
    pub operation_fingerprint: Sha256Ref,
    pub status: CapabilityReceiptStatus,
    pub summary: String,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CapabilityContractError {
    #[error("capability protocol is invalid")]
    Protocol,
    #[error("capability text is outside its bound")]
    Bounds,
    #[error("resident session capability shape is invalid")]
    SessionCapability,
}

fn bounded(value: &str, max: usize, allow_empty: bool) -> bool {
    (allow_empty || !value.trim().is_empty())
        && value.len() <= max
        && !value.chars().any(|character| character == '\0')
}

impl CapabilityResourceV1 {
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        if !bounded(&self.kind, 64, false)
            || !bounded(&self.resource_ref, 4096, false)
            || !bounded(&self.display_name, 256, false)
        {
            return Err(CapabilityContractError::Bounds);
        }
        Ok(())
    }
}

impl ManagedPermissionRequestV2 {
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        if self.protocol != MANAGED_PERMISSION_V2_PROTOCOL || !bounded(&self.operation, 512, false)
        {
            return Err(CapabilityContractError::Protocol);
        }
        self.resource.validate()
    }
}

impl CapabilityReceiptV1 {
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        if self.protocol != CAPABILITY_RECEIPT_PROTOCOL || !bounded(&self.summary, 512, false) {
            return Err(CapabilityContractError::Protocol);
        }
        Ok(())
    }
}

impl ResidentSessionCapabilityV1 {
    pub fn validate(&self) -> Result<(), CapabilityContractError> {
        if self.protocol != RESIDENT_SESSION_CAPABILITY_PROTOCOL
            || self.runtime_family.is_empty()
            || self.runtime_family.len() > 64
            || self.commands.len() > MAX_RESIDENT_SESSION_COMMANDS
            || self.capabilities.len() > 256
        {
            return Err(CapabilityContractError::SessionCapability);
        }
        let mut command_names = std::collections::BTreeSet::new();
        for command in &self.commands {
            let name_ok = !command.canonical_name.is_empty()
                && command.canonical_name.len() <= MAX_RESIDENT_SESSION_COMMAND_NAME_BYTES
                && matches!(
                    command.canonical_name.as_bytes().first(),
                    Some(b'/') | Some(b'$')
                )
                && !command
                    .canonical_name
                    .chars()
                    .any(|character| character.is_control() || character.is_whitespace());
            let description_ok = command.description.len()
                <= MAX_RESIDENT_SESSION_COMMAND_DESCRIPTION_BYTES
                && !command
                    .description
                    .chars()
                    .any(|character| character.is_control());
            let input_hint_ok = command.input_hint.as_ref().is_none_or(|hint| {
                hint.len() <= MAX_RESIDENT_SESSION_COMMAND_DESCRIPTION_BYTES
                    && !hint.chars().any(|character| character.is_control())
            });
            if !name_ok
                || !description_ok
                || !input_hint_ok
                || !command_names.insert(command.canonical_name.as_str())
            {
                return Err(CapabilityContractError::SessionCapability);
            }
        }
        if self.capabilities.iter().any(|fact| {
            !bounded(&fact.capability_id, 128, false)
                || !bounded(&fact.provider, 64, false)
                || !bounded(&fact.evidence_kind, 128, false)
                || fact
                    .reason_code
                    .as_ref()
                    .is_some_and(|reason| !bounded(reason, 128, false))
        }) {
            return Err(CapabilityContractError::SessionCapability);
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

    #[test]
    fn standard_is_the_default_access_level() {
        assert_eq!(
            ResidentAccessLevel::default(),
            ResidentAccessLevel::Standard
        );
    }

    #[test]
    fn receipts_have_no_resource_or_secret_field() {
        let receipt = CapabilityReceiptV1 {
            protocol: CAPABILITY_RECEIPT_PROTOCOL.into(),
            receipt_id: OpaqueId::parse("receipt-1").unwrap(),
            resident_pubkey: hex(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            capability: CapabilityKind::HarnessManage,
            operation_fingerprint: Sha256Ref::parse(format!("sha256:{}", "22".repeat(32))).unwrap(),
            status: CapabilityReceiptStatus::Committed,
            summary: "Updated the selected runtime and validated it.".into(),
        };
        let encoded = serde_json::to_value(&receipt).unwrap();
        assert!(encoded.get("resource").is_none());
        assert!(encoded.get("resource_ref").is_none());
        assert!(encoded.get("credential").is_none());
        receipt.validate().unwrap();
    }
}

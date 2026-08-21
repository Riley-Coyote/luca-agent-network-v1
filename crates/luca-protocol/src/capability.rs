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

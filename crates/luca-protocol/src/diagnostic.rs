//! Safe, body-free diagnostic wire record.

use crate::{CanonicalTimestamp, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Deserializer, Serialize};

/// Frozen safe-diagnostic protocol discriminator.
pub const SAFE_DIAGNOSTIC_PROTOCOL: &str = "luca.safe-diagnostic.v1";

/// A fixed-field diagnostic that cannot carry a message body, path, or map.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SafeDiagnosticV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Canonical whole-second UTC timestamp.
    pub timestamp: CanonicalTimestamp,
    /// Stable emitting component identifier.
    pub component: OpaqueId,
    /// Stable operation identifier.
    pub operation: OpaqueId,
    /// Stable machine-readable status code.
    pub status_code: OpaqueId,
    /// Optional request correlation ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<OpaqueId>,
    /// Optional accepted turn correlation ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<OpaqueId>,
    /// Optional one-way resident reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_ref: Option<Sha256Ref>,
    /// Optional one-way conversation reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_ref: Option<Sha256Ref>,
    /// Bounded elapsed duration.
    pub duration_ms: SafeU53,
    /// Whether retry can be offered without changing authority.
    pub retryable: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSafeDiagnosticV1 {
    protocol: String,
    timestamp: CanonicalTimestamp,
    component: OpaqueId,
    operation: OpaqueId,
    status_code: OpaqueId,
    request_id: Option<OpaqueId>,
    turn_id: Option<OpaqueId>,
    resident_ref: Option<Sha256Ref>,
    conversation_ref: Option<Sha256Ref>,
    duration_ms: SafeU53,
    retryable: bool,
}

impl<'de> Deserialize<'de> for SafeDiagnosticV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawSafeDiagnosticV1::deserialize(deserializer)?;
        if raw.protocol != SAFE_DIAGNOSTIC_PROTOCOL {
            return Err(serde::de::Error::custom(
                "protocol must be luca.safe-diagnostic.v1",
            ));
        }
        Ok(Self {
            protocol: raw.protocol,
            timestamp: raw.timestamp,
            component: raw.component,
            operation: raw.operation,
            status_code: raw.status_code,
            request_id: raw.request_id,
            turn_id: raw.turn_id,
            resident_ref: raw.resident_ref,
            conversation_ref: raw.conversation_ref,
            duration_ms: raw.duration_ms,
            retryable: raw.retryable,
        })
    }
}

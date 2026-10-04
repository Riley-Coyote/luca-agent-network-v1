//! Bounded private synthesis authority for one already verified runtime result.
//!
//! The desktop verifies the full stored result's digest before constructing a
//! request. An excerpt is untrusted reference material, never model, tool,
//! routing or signing authority. Only a body-free broker outcome comes back.

use crate::{
    Hex64, ManagedMessagePublishResultV1, OpaqueId, SafeU53, Sha256Ref, MAX_FINAL_DRAFT_BYTES,
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest as _, Sha256};

/// Frozen discriminator for private runtime-task completion synthesis.
pub const RUNTIME_TASK_DELIVERY_PROTOCOL: &str = "polyphonic.runtime-task-delivery.v1";
/// Maximum UTF-8 bytes in a task's descriptive summary.
pub const MAX_RUNTIME_TASK_DELIVERY_SUMMARY_BYTES: usize = 4 * 1024;
/// Maximum UTF-8 bytes supplied as private result reference material.
pub const MAX_RUNTIME_TASK_DELIVERY_EXCERPT_BYTES: usize = 48 * 1024;
/// Maximum bytes in the complete result whose digest the desktop verified.
pub const MAX_RUNTIME_TASK_DELIVERY_RESULT_BYTES: usize = 1024 * 1024;

/// Body-free semantic failure in a runtime-task delivery contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum RuntimeTaskDeliveryError {
    /// Wrong version or discriminator.
    #[error("runtime task delivery protocol is invalid")]
    Protocol,
    /// The receipt is not an exact `task-result:<64 lowercase hex>` ID.
    #[error("runtime task delivery identity is invalid")]
    Identity,
    /// A deadline, text or result exceeded its frozen bound.
    #[error("runtime task delivery bounds are invalid")]
    Bounds,
    /// Excerpt metadata or a complete-result digest did not agree.
    #[error("runtime task delivery excerpt evidence is invalid")]
    Excerpt,
    /// A returned receipt did not correlate to the exact request.
    #[error("runtime task delivery result binding is invalid")]
    Binding,
}

fn validate_identity(delivery_id: &OpaqueId) -> Result<(), RuntimeTaskDeliveryError> {
    delivery_id
        .as_str()
        .strip_prefix("task-result:")
        .filter(|digest| Hex64::parse((*digest).to_owned()).is_ok())
        .map(|_| ())
        .ok_or(RuntimeTaskDeliveryError::Identity)
}

/// One host-minted request to synthesize a verified result on the same resident.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeTaskDeliveryRequestV1 {
    /// Exact version discriminator.
    pub protocol: String,
    /// Durable action/result receipt; also the signing turn and dispatch ID.
    pub delivery_id: OpaqueId,
    /// Original approved task identity.
    pub task_id: OpaqueId,
    /// Current owner fixed by desktop authority, not the task output.
    pub owner_pubkey: Hex64,
    /// Exact resident whose existing runtime performs the synthesis.
    pub resident_pubkey: Hex64,
    /// Exact originating conversation, never selected by the draft.
    pub conversation_id: OpaqueId,
    /// Exact configured resident runtime/model binding.
    pub binding_ref: Sha256Ref,
    /// Digest of the complete stored result, not merely the excerpt.
    pub result_sha256: Sha256Ref,
    /// Descriptive source runtime family; not a provider/model selector.
    pub runtime_family: String,
    /// Bounded descriptive task summary, treated as untrusted reference.
    pub summary: String,
    /// Bounded UTF-8 reference from the verified result, never an instruction.
    pub result_excerpt: String,
    /// Byte count of the complete verified result.
    pub result_total_bytes: SafeU53,
    /// Explicit evidence that the reference is shorter than the full result.
    pub result_is_excerpt: bool,
    /// Absolute host deadline for synthesis and broker handoff.
    pub deadline_unix_ms: SafeU53,
    /// Maximum bytes in the resident-authored final draft.
    pub max_draft_bytes: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRequest {
    protocol: String,
    delivery_id: OpaqueId,
    task_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    conversation_id: OpaqueId,
    binding_ref: Sha256Ref,
    result_sha256: Sha256Ref,
    runtime_family: String,
    summary: String,
    result_excerpt: String,
    result_total_bytes: SafeU53,
    result_is_excerpt: bool,
    deadline_unix_ms: SafeU53,
    max_draft_bytes: SafeU53,
}

impl<'de> Deserialize<'de> for RuntimeTaskDeliveryRequestV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawRequest::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            delivery_id: raw.delivery_id,
            task_id: raw.task_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            conversation_id: raw.conversation_id,
            binding_ref: raw.binding_ref,
            result_sha256: raw.result_sha256,
            runtime_family: raw.runtime_family,
            summary: raw.summary,
            result_excerpt: raw.result_excerpt,
            result_total_bytes: raw.result_total_bytes,
            result_is_excerpt: raw.result_is_excerpt,
            deadline_unix_ms: raw.deadline_unix_ms,
            max_draft_bytes: raw.max_draft_bytes,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

impl RuntimeTaskDeliveryRequestV1 {
    /// Check frozen identities, byte bounds and explicit excerpt evidence.
    pub fn validate(&self) -> Result<(), RuntimeTaskDeliveryError> {
        if self.protocol != RUNTIME_TASK_DELIVERY_PROTOCOL {
            return Err(RuntimeTaskDeliveryError::Protocol);
        }
        validate_identity(&self.delivery_id)?;
        let total = self.result_total_bytes.get();
        if self.deadline_unix_ms.get() == 0
            || self.max_draft_bytes.get() == 0
            || self.max_draft_bytes.get() > MAX_FINAL_DRAFT_BYTES as u64
            || total == 0
            || total > MAX_RUNTIME_TASK_DELIVERY_RESULT_BYTES as u64
            || self.runtime_family.is_empty()
            || self.runtime_family.len() > 64
            || !self
                .runtime_family
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            || self.summary.trim().is_empty()
            || self.summary.len() > MAX_RUNTIME_TASK_DELIVERY_SUMMARY_BYTES
            || self
                .summary
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\t'))
            || self.result_excerpt.is_empty()
            || self.result_excerpt.len() > MAX_RUNTIME_TASK_DELIVERY_EXCERPT_BYTES
        {
            return Err(RuntimeTaskDeliveryError::Bounds);
        }
        let excerpt_bytes = self.result_excerpt.len() as u64;
        if excerpt_bytes > total || self.result_is_excerpt != (excerpt_bytes < total) {
            return Err(RuntimeTaskDeliveryError::Excerpt);
        }
        // For an explicitly complete reference, the protocol can also check
        // its digest. Partial excerpts require the desktop's full-store check.
        if !self.result_is_excerpt
            && self.result_sha256.as_str()
                != format!(
                    "sha256:{}",
                    hex::encode(Sha256::digest(self.result_excerpt.as_bytes()))
                )
        {
            return Err(RuntimeTaskDeliveryError::Excerpt);
        }
        Ok(())
    }
}

impl std::fmt::Debug for RuntimeTaskDeliveryRequestV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeTaskDeliveryRequestV1")
            .field("delivery_id", &self.delivery_id)
            .field("task_id", &self.task_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("result_sha256", &self.result_sha256)
            .field("result_total_bytes", &self.result_total_bytes)
            .field("result_is_excerpt", &self.result_is_excerpt)
            .field("summary", &"[REDACTED]")
            .field("result_excerpt", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

/// Body-free outcome of private synthesis and the existing signing-broker handoff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeTaskDeliveryResultV1 {
    /// Exact version discriminator.
    pub protocol: String,
    /// Exact durable delivery/dispatch identity from the request.
    pub delivery_id: OpaqueId,
    /// Exact original approved task identity.
    pub task_id: OpaqueId,
    /// Exact full stored-result digest from the request.
    pub result_sha256: Sha256Ref,
    /// Existing body-free signing broker publication result.
    pub publication: ManagedMessagePublishResultV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResult {
    protocol: String,
    delivery_id: OpaqueId,
    task_id: OpaqueId,
    result_sha256: Sha256Ref,
    publication: ManagedMessagePublishResultV1,
}

impl<'de> Deserialize<'de> for RuntimeTaskDeliveryResultV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawResult::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            delivery_id: raw.delivery_id,
            task_id: raw.task_id,
            result_sha256: raw.result_sha256,
            publication: raw.publication,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

impl RuntimeTaskDeliveryResultV1 {
    /// Validate this result's version and durable receipt namespace.
    pub fn validate(&self) -> Result<(), RuntimeTaskDeliveryError> {
        if self.protocol != RUNTIME_TASK_DELIVERY_PROTOCOL {
            return Err(RuntimeTaskDeliveryError::Protocol);
        }
        validate_identity(&self.delivery_id)
    }

    /// Correlate the body-free response to one exact request and source digest.
    pub fn validate_against(
        &self,
        request: &RuntimeTaskDeliveryRequestV1,
    ) -> Result<(), RuntimeTaskDeliveryError> {
        self.validate()?;
        request.validate()?;
        if self.delivery_id != request.delivery_id
            || self.task_id != request.task_id
            || self.result_sha256 != request.result_sha256
        {
            return Err(RuntimeTaskDeliveryError::Binding);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ResidentPrivateCognitionRequestV1, ResidentPrivateCognitionResultV1};

    fn request() -> RuntimeTaskDeliveryRequestV1 {
        RuntimeTaskDeliveryRequestV1 {
            protocol: RUNTIME_TASK_DELIVERY_PROTOCOL.into(),
            delivery_id: OpaqueId::parse(format!("task-result:{}", "d".repeat(64)))
                .expect("fixture delivery ID"),
            task_id: OpaqueId::parse("task:fixture").expect("fixture task ID"),
            owner_pubkey: Hex64::parse("a".repeat(64)).expect("fixture owner"),
            resident_pubkey: Hex64::parse("b".repeat(64)).expect("fixture resident"),
            conversation_id: OpaqueId::parse("conversation:fixture").expect("fixture conversation"),
            binding_ref: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64)))
                .expect("fixture binding"),
            result_sha256: Sha256Ref::parse(format!("sha256:{}", "e".repeat(64)))
                .expect("fixture full-result digest"),
            runtime_family: "claude".into(),
            summary: "PRIVATE_TASK_SUMMARY".into(),
            result_excerpt: "PRIVATE_RESULT_REFERENCE λ".into(),
            result_total_bytes: SafeU53::new(128).expect("fixture full byte count"),
            result_is_excerpt: true,
            deadline_unix_ms: SafeU53::new(4_000).expect("fixture deadline"),
            max_draft_bytes: SafeU53::new(512).expect("fixture draft limit"),
        }
    }

    fn result(request: &RuntimeTaskDeliveryRequestV1) -> RuntimeTaskDeliveryResultV1 {
        RuntimeTaskDeliveryResultV1 {
            protocol: RUNTIME_TASK_DELIVERY_PROTOCOL.into(),
            delivery_id: request.delivery_id.clone(),
            task_id: request.task_id.clone(),
            result_sha256: request.result_sha256.clone(),
            publication: ManagedMessagePublishResultV1::Unavailable {
                code: OpaqueId::parse("publication_pending").expect("body-free fixture code"),
            },
        }
    }

    #[test]
    fn runtime_task_delivery_envelope_binds_private_job_without_body_debug() {
        let request = request();
        let envelope = ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery {
            request: request.clone(),
        };
        assert!(envelope.validate().is_ok());
        assert_eq!(envelope.job_id(), &request.delivery_id);
        assert_eq!(envelope.owner_pubkey(), &request.owner_pubkey);
        assert_eq!(envelope.binding_ref(), &request.binding_ref);
        assert_eq!(envelope.deadline_unix_ms(), request.deadline_unix_ms);
        assert_eq!(envelope.max_result_bytes(), request.max_draft_bytes);
        let wire = serde_json::to_vec(&envelope).expect("fixture envelope");
        assert_eq!(
            serde_json::from_slice::<ResidentPrivateCognitionRequestV1>(&wire)
                .expect("valid envelope"),
            envelope
        );
        for debug in [format!("{request:?}"), format!("{envelope:?}")] {
            assert!(!debug.contains("PRIVATE_TASK_SUMMARY"));
            assert!(!debug.contains("PRIVATE_RESULT_REFERENCE"));
        }
    }

    #[test]
    fn runtime_task_delivery_complete_reference_checks_full_digest_and_utf8_bytes() {
        let mut request = request();
        request.result_total_bytes = SafeU53::new(request.result_excerpt.len() as u64)
            .expect("UTF-8 bytes not character count");
        request.result_is_excerpt = false;
        assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Excerpt));
        request.result_sha256 = Sha256Ref::parse(format!(
            "sha256:{}",
            hex::encode(Sha256::digest(request.result_excerpt.as_bytes()))
        ))
        .expect("fixture digest");
        assert!(request.validate().is_ok());
        request.result_excerpt.push('λ');
        assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Excerpt));
    }

    #[test]
    fn runtime_task_delivery_excerpt_and_full_result_bounds_are_independent() {
        let mut request = request();
        request.result_excerpt = "λ".repeat(MAX_RUNTIME_TASK_DELIVERY_EXCERPT_BYTES / 2);
        request.result_total_bytes =
            SafeU53::new(MAX_RUNTIME_TASK_DELIVERY_RESULT_BYTES as u64).expect("full result limit");
        assert!(request.validate().is_ok());
        request.result_excerpt.push('λ');
        assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Bounds));
        request.result_excerpt = "partial".into();
        request.result_total_bytes =
            SafeU53::new(MAX_RUNTIME_TASK_DELIVERY_RESULT_BYTES as u64 + 1)
                .expect("larger safe integer");
        assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Bounds));
        request.result_total_bytes = SafeU53::new(128).expect("fixture bytes");
        request.result_is_excerpt = false;
        assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Excerpt));
    }

    #[test]
    fn runtime_task_delivery_only_accepts_exact_receipt_namespace() {
        for id in [
            "owner-trigger".into(),
            "d".repeat(64),
            format!("task-result:{}", "D".repeat(64)),
            format!("task-result:{}", "d".repeat(63)),
            format!("task-result:{}", "g".repeat(64)),
        ] {
            let mut request = request();
            request.delivery_id = OpaqueId::parse(id).expect("synthetic opaque ID");
            assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Identity));
        }
    }

    #[test]
    fn runtime_task_delivery_deadline_draft_summary_and_source_metadata_are_bounded() {
        let baseline = request();
        for (deadline, draft, total) in [
            (0, 512, 128),
            (4_000, 0, 128),
            (4_000, MAX_FINAL_DRAFT_BYTES as u64 + 1, 128),
            (4_000, 512, 0),
        ] {
            let mut request = baseline.clone();
            request.deadline_unix_ms = SafeU53::new(deadline).expect("fixture safe deadline");
            request.max_draft_bytes = SafeU53::new(draft).expect("fixture safe draft bound");
            request.result_total_bytes = SafeU53::new(total).expect("fixture safe total");
            assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Bounds));
        }
        for summary in [" ".into(), "a".repeat(4_097), "PRIVATE\0BODY".into()] {
            let mut request = baseline.clone();
            request.summary = summary;
            assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Bounds));
        }
        for family in ["", "Codex", "codex --model", "claude/override"] {
            let mut request = baseline.clone();
            request.runtime_family = family.into();
            assert_eq!(request.validate(), Err(RuntimeTaskDeliveryError::Bounds));
        }
    }

    #[test]
    fn runtime_task_delivery_result_is_body_free_and_correlates_exact_identity_and_digest() {
        let request = request();
        let result = result(&request);
        assert!(result.validate_against(&request).is_ok());
        let envelope = ResidentPrivateCognitionResultV1::RuntimeTaskDelivery {
            result: result.clone(),
        };
        let request_envelope = ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery {
            request: request.clone(),
        };
        assert!(envelope.validate_against(&request_envelope).is_ok());
        for body_free in [
            serde_json::to_string(&envelope).expect("body-free wire result"),
            format!("{result:?}"),
            format!("{envelope:?}"),
        ] {
            assert!(!body_free.contains("PRIVATE_TASK_SUMMARY"));
            assert!(!body_free.contains("PRIVATE_RESULT_REFERENCE"));
            assert!(!body_free.contains("result_excerpt"));
            assert!(!body_free.contains("final_draft"));
        }
        let mut mismatch = result.clone();
        mismatch.task_id = OpaqueId::parse("task:other").expect("other task");
        assert_eq!(
            mismatch.validate_against(&request),
            Err(RuntimeTaskDeliveryError::Binding)
        );
        mismatch = result.clone();
        mismatch.delivery_id =
            OpaqueId::parse(format!("task-result:{}", "f".repeat(64))).expect("other delivery");
        assert_eq!(
            mismatch.validate_against(&request),
            Err(RuntimeTaskDeliveryError::Binding)
        );
        mismatch = result;
        mismatch.result_sha256 =
            Sha256Ref::parse(format!("sha256:{}", "f".repeat(64))).expect("other digest");
        assert_eq!(
            mismatch.validate_against(&request),
            Err(RuntimeTaskDeliveryError::Binding)
        );
    }

    #[test]
    fn runtime_task_delivery_schema_rejects_unknown_policy_fields_and_duplicate_identity() {
        let request = request();
        let baseline = serde_json::to_value(&request).expect("fixture schema");
        for key in [
            "model",
            "provider_override",
            "tools",
            "mcp_servers",
            "thread_id",
        ] {
            let mut value = baseline.clone();
            value[key] = serde_json::json!("PRIVATE_OVERRIDE");
            assert!(serde_json::from_value::<RuntimeTaskDeliveryRequestV1>(value).is_err());
        }
        let wire = serde_json::to_string(&request).expect("fixture wire");
        let duplicate = wire.replacen(
            "{",
            &format!("{{\"delivery_id\":\"{}\",", request.delivery_id.as_str()),
            1,
        );
        assert!(serde_json::from_str::<RuntimeTaskDeliveryRequestV1>(&duplicate).is_err());
        let mut body_result = serde_json::to_value(result(&request)).expect("fixture result");
        body_result["final_draft"] = serde_json::json!("PRIVATE_RESULT_BODY");
        assert!(serde_json::from_value::<RuntimeTaskDeliveryResultV1>(body_result).is_err());
    }
}

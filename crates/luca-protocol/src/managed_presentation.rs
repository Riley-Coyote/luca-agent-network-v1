//! Ephemeral, body-bounded presentation frames for managed resident turns.
//!
//! These frames are intentionally one-way and process-local. They may carry
//! public response text, but never prompts, thoughts, tool payloads, secrets,
//! signing material, or any durable authority.

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53};

/// Stable wire identifier for the managed presentation protocol.
pub const MANAGED_PRESENTATION_PROTOCOL: &str = "luca.managed.presentation.v1";
/// Maximum public text carried by one presentation frame.
pub const MAX_MANAGED_PRESENTATION_CHUNK_BYTES: usize = 16 * 1024;
/// Maximum encoded NDJSON frame accepted by either endpoint.
pub const MAX_MANAGED_PRESENTATION_FRAME_BYTES: usize = 64 * 1024;

/// The bounded kinds accepted by the desktop presentation channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPresentationKindV1 {
    TurnStarted,
    Phase,
    PublicChunk,
    Completed,
    Cancelled,
    Failed,
}

/// Coarse, public-safe activity shown while a managed resident responds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPresentationPhaseV1 {
    Thinking,
    Working,
    Writing,
    Finalizing,
}

/// Body-free failure categories safe to show in the conversation surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPresentationFailureV1 {
    Runtime,
    Publication,
    Unavailable,
}

/// One authenticated-by-inheritance presentation frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedPresentationFrameV1 {
    /// Must equal [`MANAGED_PRESENTATION_PROTOCOL`].
    pub protocol: String,
    pub kind: ManagedPresentationKindV1,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub turn_id: OpaqueId,
    /// Durable owner event that authorized this managed turn.
    pub dispatch_receipt_id: OpaqueId,
    /// Fresh desktop-owned ACP host epoch.
    pub session_epoch: SafeU53,
    /// Strictly increasing within one turn.
    pub sequence: SafeU53,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<ManagedPresentationPhaseV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_chunk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ManagedPresentationFailureV1>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManagedPresentationError {
    #[error("managed presentation protocol is invalid")]
    Protocol,
    #[error("managed presentation frame fields do not match its kind")]
    Shape,
    #[error("managed presentation public chunk exceeds its bound")]
    Chunk,
}

impl ManagedPresentationFrameV1 {
    /// Validate the strict kind-specific shape and public text bound.
    pub fn validate(&self) -> Result<(), ManagedPresentationError> {
        if self.protocol != MANAGED_PRESENTATION_PROTOCOL || self.sequence.get() == 0 {
            return Err(ManagedPresentationError::Protocol);
        }
        if self.public_chunk.as_ref().is_some_and(|chunk| {
            chunk.is_empty() || chunk.len() > MAX_MANAGED_PRESENTATION_CHUNK_BYTES
        }) {
            return Err(ManagedPresentationError::Chunk);
        }
        let valid_shape = match self.kind {
            ManagedPresentationKindV1::TurnStarted
            | ManagedPresentationKindV1::Completed
            | ManagedPresentationKindV1::Cancelled => {
                self.phase.is_none() && self.public_chunk.is_none() && self.failure.is_none()
            }
            ManagedPresentationKindV1::Phase => {
                self.phase.is_some() && self.public_chunk.is_none() && self.failure.is_none()
            }
            ManagedPresentationKindV1::PublicChunk => {
                self.phase.is_none() && self.public_chunk.is_some() && self.failure.is_none()
            }
            ManagedPresentationKindV1::Failed => {
                self.phase.is_none() && self.public_chunk.is_none() && self.failure.is_some()
            }
        };
        valid_shape
            .then_some(())
            .ok_or(ManagedPresentationError::Shape)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(kind: ManagedPresentationKindV1) -> ManagedPresentationFrameV1 {
        ManagedPresentationFrameV1 {
            protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
            kind,
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("22".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            sequence: SafeU53::new(1).unwrap(),
            phase: None,
            public_chunk: None,
            failure: None,
        }
    }

    #[test]
    fn public_chunk_is_bounded_and_kind_specific() {
        let mut value = frame(ManagedPresentationKindV1::PublicChunk);
        value.public_chunk = Some("hello".into());
        assert_eq!(value.validate(), Ok(()));
        value.phase = Some(ManagedPresentationPhaseV1::Writing);
        assert_eq!(value.validate(), Err(ManagedPresentationError::Shape));
    }

    #[test]
    fn unknown_fields_are_rejected() {
        let mut value = serde_json::to_value(frame(ManagedPresentationKindV1::Completed)).unwrap();
        value["prompt"] = serde_json::json!("private");
        assert!(serde_json::from_value::<ManagedPresentationFrameV1>(value).is_err());
    }
}

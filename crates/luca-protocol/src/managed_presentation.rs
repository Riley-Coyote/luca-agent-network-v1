//! Ephemeral, body-bounded presentation frames for managed resident turns.
//!
//! These frames are intentionally one-way and process-local. They may carry
//! public response text and a bounded description of what the resident is
//! doing for its owner, but never prompts, thoughts, tool payload bodies,
//! secrets, signing material, or any durable authority.

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53};

/// Stable wire identifier for the managed presentation protocol.
pub const MANAGED_PRESENTATION_PROTOCOL: &str = "luca.managed.presentation.v1";
/// Maximum public text carried by one presentation frame.
pub const MAX_MANAGED_PRESENTATION_CHUNK_BYTES: usize = 16 * 1024;
/// Maximum encoded NDJSON frame accepted by either endpoint.
pub const MAX_MANAGED_PRESENTATION_FRAME_BYTES: usize = 64 * 1024;
/// Maximum bytes in one activity label — a sentence, never a payload.
pub const MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES: usize = 160;
/// Maximum bytes in one activity detail — a domain, a path, or a command.
pub const MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES: usize = 512;

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

/// What sort of work one activity step is.
///
/// Deliberately coarse: the surface groups steps by this, and a runtime that
/// reports something we do not recognise lands in [`Other`] rather than
/// inventing a category.
///
/// [`Other`]: ManagedPresentationActivityKindV1::Other
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPresentationActivityKindV1 {
    Web,
    File,
    Command,
    Search,
    Thinking,
    Other,
}

/// Where one activity step stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPresentationActivityStatusV1 {
    Active,
    Done,
    Failed,
}

/// One step of visible work, shown in place of the coarse phase word.
///
/// The owner may see anything their own resident does on their behalf: the
/// sentence, the domain, the path, the command, the count. What stays out is
/// what a payload body would carry — file contents, tool results, prompt or
/// reasoning text, and anything credential-shaped. That line is enforced at
/// the emitter (which only ever copies a title, a location, a command, or a
/// number) and bounded here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedPresentationActivityV1 {
    /// Human sentence, present tense while active: "Reading conversation-shell.css".
    pub label: String,
    pub kind: ManagedPresentationActivityKindV1,
    /// Bare domain, path, or command — never a payload body.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<ManagedPresentationActivityStatusV1>,
    /// Result count once the step settles, when the runtime reports one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<SafeU53>,
    /// 1-based ordinal within the turn. Steps order by this, then by arrival,
    /// so a settling frame lands on the line its start frame opened instead of
    /// appending a second one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<SafeU53>,
}

/// One authenticated-by-inheritance presentation frame.
///
/// # Version coupling
///
/// `deny_unknown_fields` makes this struct strict in both directions: a newer
/// harness emitting a field an older desktop does not know is rejected whole,
/// not degraded. The harness and the desktop are built and shipped from this
/// same tree, so that is currently a non-issue — but any future field must
/// arrive on both sides in the same release, and an out-of-tree harness cannot
/// extend this wire without a protocol bump.
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
    /// Optional refinement of the phase word this frame already carries.
    ///
    /// Rides on [`Phase`] frames only: the phase is the fallback the surface
    /// shows when a runtime reports nothing, and keeping the activity on the
    /// same frame means there is never an activity line without one.
    ///
    /// [`Phase`]: ManagedPresentationKindV1::Phase
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<ManagedPresentationActivityV1>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManagedPresentationError {
    #[error("managed presentation protocol is invalid")]
    Protocol,
    #[error("managed presentation frame fields do not match its kind")]
    Shape,
    #[error("managed presentation public chunk exceeds its bound")]
    Chunk,
    #[error("managed presentation activity text is unbounded or not display-safe")]
    Activity,
}

/// Reject control characters and bidirectional overrides.
///
/// An activity line renders beside the owner's own text. A runtime that echoes
/// a crafted tool title must not be able to reorder, hide, or overwrite what
/// sits next to it.
fn is_display_safe(value: &str) -> bool {
    !value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
            )
    })
}

impl ManagedPresentationActivityV1 {
    /// Validate the text bounds and display safety of one activity step.
    pub fn validate(&self) -> Result<(), ManagedPresentationError> {
        let label_ok = !self.label.is_empty()
            && self.label.len() <= MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES
            && is_display_safe(&self.label);
        let detail_ok = self.detail.as_ref().is_none_or(|detail| {
            !detail.is_empty()
                && detail.len() <= MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES
                && is_display_safe(detail)
        });
        (label_ok && detail_ok)
            .then_some(())
            .ok_or(ManagedPresentationError::Activity)
    }
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
        if let Some(activity) = self.activity.as_ref() {
            activity.validate()?;
        }
        let valid_shape = match self.kind {
            ManagedPresentationKindV1::TurnStarted
            | ManagedPresentationKindV1::Completed
            | ManagedPresentationKindV1::Cancelled => {
                self.phase.is_none()
                    && self.public_chunk.is_none()
                    && self.failure.is_none()
                    && self.activity.is_none()
            }
            ManagedPresentationKindV1::Phase => {
                self.phase.is_some() && self.public_chunk.is_none() && self.failure.is_none()
            }
            ManagedPresentationKindV1::PublicChunk => {
                self.phase.is_none()
                    && self.public_chunk.is_some()
                    && self.failure.is_none()
                    && self.activity.is_none()
            }
            ManagedPresentationKindV1::Failed => {
                self.phase.is_none()
                    && self.public_chunk.is_none()
                    && self.failure.is_some()
                    && self.activity.is_none()
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
            activity: None,
        }
    }

    fn activity() -> ManagedPresentationActivityV1 {
        ManagedPresentationActivityV1 {
            label: "Reading conversation-shell.css".into(),
            kind: ManagedPresentationActivityKindV1::File,
            detail: Some("desktop/src/styles/conversation-shell.css".into()),
            status: Some(ManagedPresentationActivityStatusV1::Active),
            count: None,
            step: Some(SafeU53::new(1).unwrap()),
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

    #[test]
    fn a_phase_frame_without_activity_still_validates_and_serializes_unchanged() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        assert_eq!(value.validate(), Ok(()));
        let encoded = serde_json::to_value(&value).unwrap();
        assert!(
            encoded.get("activity").is_none(),
            "an activity-free frame must stay byte-identical to the pre-activity wire"
        );
    }

    #[test]
    fn a_phase_frame_with_activity_validates_and_round_trips() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        value.activity = Some(activity());
        assert_eq!(value.validate(), Ok(()));
        let encoded = serde_json::to_string(&value).unwrap();
        assert_eq!(
            serde_json::from_str::<ManagedPresentationFrameV1>(&encoded).unwrap(),
            value
        );
    }

    #[test]
    fn an_over_long_label_is_rejected() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        value.activity = Some(ManagedPresentationActivityV1 {
            label: "a".repeat(MAX_MANAGED_PRESENTATION_ACTIVITY_LABEL_BYTES + 1),
            ..activity()
        });
        assert_eq!(
            value.validate(),
            Err(ManagedPresentationError::Activity),
            "a label at the bound is a sentence; past it, something is dumping a payload"
        );
    }

    #[test]
    fn an_empty_or_over_long_detail_is_rejected() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        for detail in [
            String::new(),
            "a".repeat(MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES + 1),
        ] {
            value.activity = Some(ManagedPresentationActivityV1 {
                detail: Some(detail),
                ..activity()
            });
            assert_eq!(value.validate(), Err(ManagedPresentationError::Activity));
        }
    }

    #[test]
    fn control_characters_and_bidi_overrides_never_reach_the_surface() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        for label in ["Reading\nsecond line", "Reading \u{202e}sdrawkcab"] {
            value.activity = Some(ManagedPresentationActivityV1 {
                label: label.into(),
                ..activity()
            });
            assert_eq!(value.validate(), Err(ManagedPresentationError::Activity));
        }
    }

    #[test]
    fn activity_rides_only_on_phase_frames() {
        for kind in [
            ManagedPresentationKindV1::TurnStarted,
            ManagedPresentationKindV1::Completed,
            ManagedPresentationKindV1::Cancelled,
        ] {
            let mut value = frame(kind);
            value.activity = Some(activity());
            assert_eq!(value.validate(), Err(ManagedPresentationError::Shape));
        }
        let mut chunk = frame(ManagedPresentationKindV1::PublicChunk);
        chunk.public_chunk = Some("hello".into());
        chunk.activity = Some(activity());
        assert_eq!(chunk.validate(), Err(ManagedPresentationError::Shape));

        let mut failed = frame(ManagedPresentationKindV1::Failed);
        failed.failure = Some(ManagedPresentationFailureV1::Runtime);
        failed.activity = Some(activity());
        assert_eq!(failed.validate(), Err(ManagedPresentationError::Shape));
    }

    #[test]
    fn an_unknown_activity_field_is_rejected_like_any_other_body() {
        let mut value = frame(ManagedPresentationKindV1::Phase);
        value.phase = Some(ManagedPresentationPhaseV1::Working);
        value.activity = Some(activity());
        let mut encoded = serde_json::to_value(&value).unwrap();
        encoded["activity"]["contents"] = serde_json::json!("the whole file");
        assert!(serde_json::from_value::<ManagedPresentationFrameV1>(encoded).is_err());
    }
}

//! Bounded desktop-mediated permission requests for managed residents.
//!
//! This is deliberately not a signing operation.  The ACP host may ask the
//! desktop to select an option already advertised by its runtime, but cannot
//! supply a capability, change a resident, or reuse a decision from another
//! turn.

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53, MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES};

/// Stable wire identifier for the managed local permission protocol.
pub const MANAGED_PERMISSION_PROTOCOL: &str = "luca.managed.permission.v1";
/// Hard desktop decision deadline. Expiry resolves to the ACP cancelled path.
pub const MANAGED_PERMISSION_TIMEOUT_SECS: u64 = 120;

/// The only terminal outcome categories for a desktop-managed permission request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedPermissionDispositionV1 {
    /// Select one exact option advertised by the runtime. The desktop never
    /// infers an allow/reject semantic from a display label.
    Selected,
    Cancelled,
}

/// Bounded, display-safe description of an option advertised by the active ACP runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionOptionV1 {
    /// Exact opaque option identifier returned by the runtime.
    pub option_id: String,
    /// Runtime-provided display label for the desktop approval card.
    pub name: String,
    /// Runtime-provided semantic kind, retained for display rather than policy inference.
    pub kind: String,
}

/// A permission request received from an ACP runtime. `option_ids` is the
/// exact runtime-advertised set; desktop must select one of these strings or
/// return `cancelled`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionRequestV1 {
    /// Must equal [`MANAGED_PERMISSION_PROTOCOL`].
    pub protocol: String,
    /// Desktop-managed resident that owns this host session.
    pub resident_pubkey: Hex64,
    /// Fresh desktop epoch for this ACP host.
    pub session_epoch: SafeU53,
    /// Harness-assigned turn receiving the runtime permission prompt.
    pub turn_id: OpaqueId,
    /// App-resolved conversation/channel receiving this turn; heartbeat turns
    /// are deliberately not eligible for desktop approval cards.
    pub conversation_id: OpaqueId,
    /// Canonical JSON representation of the ACP JSON-RPC request id.
    pub acp_request_id: String,
    /// Bounded runtime-provided title for the desktop approval card.
    pub title: String,
    /// Optional runtime tool-call correlation id, never treated as authority.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Optional bounded action preview for display only. It is never authority
    /// for the selected runtime option or the operation that later executes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_preview: Option<String>,
    /// Exact, bounded set of runtime-advertised choices.
    pub options: Vec<ManagedPermissionOptionV1>,
}

/// Desktop's one-shot answer to [`ManagedPermissionRequestV1`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManagedPermissionDecisionV1 {
    /// Must equal [`MANAGED_PERMISSION_PROTOCOL`].
    pub protocol: String,
    /// Resident copied from the bound request.
    pub resident_pubkey: Hex64,
    /// Session epoch copied from the bound request.
    pub session_epoch: SafeU53,
    /// Turn id copied from the bound request.
    pub turn_id: OpaqueId,
    /// Conversation id copied from the bound request.
    pub conversation_id: OpaqueId,
    /// Canonical ACP JSON-RPC request id copied from the request.
    pub acp_request_id: String,
    /// Whether desktop selected a runtime option or cancelled the request.
    pub disposition: ManagedPermissionDispositionV1,
    /// Required only for selected; it must exactly equal one advertised
    /// option id from the corresponding request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManagedPermissionError {
    #[error("managed permission protocol is invalid")]
    Protocol,
    #[error("managed permission request has no bounded option ids")]
    Options,
    #[error("managed permission decision does not bind the request")]
    Binding,
    #[error("managed permission option was not advertised by the runtime")]
    Option,
}

impl ManagedPermissionRequestV1 {
    /// Verify this request is bounded and suitable for local desktop presentation.
    pub fn validate(&self) -> Result<(), ManagedPermissionError> {
        if self.protocol != MANAGED_PERMISSION_PROTOCOL
            || self.acp_request_id.is_empty()
            || self.acp_request_id.len() > 512
            || self.title.len() > 512
            || self
                .tool_call_id
                .as_ref()
                .is_some_and(|value| value.len() > 512)
            || self.action_preview.as_ref().is_some_and(|value| {
                value.is_empty()
                    || value.len() > MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES
                    || !is_display_safe(value)
            })
            || self.options.is_empty()
            || self.options.len() > 32
            || self.options.iter().any(|option| {
                option.option_id.is_empty()
                    || option.option_id.len() > 256
                    || option.name.len() > 512
                    || option.kind.len() > 128
            })
        {
            return Err(ManagedPermissionError::Protocol);
        }
        Ok(())
    }
}

fn is_display_safe(value: &str) -> bool {
    !value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
            )
    })
}

impl ManagedPermissionDecisionV1 {
    /// Verify that a desktop decision is bound to this exact request and option set.
    pub fn validate_for(
        &self,
        request: &ManagedPermissionRequestV1,
    ) -> Result<(), ManagedPermissionError> {
        request.validate()?;
        if self.protocol != MANAGED_PERMISSION_PROTOCOL
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.turn_id != request.turn_id
            || self.conversation_id != request.conversation_id
            || self.acp_request_id != request.acp_request_id
        {
            return Err(ManagedPermissionError::Binding);
        }
        match self.disposition {
            ManagedPermissionDispositionV1::Cancelled if self.option_id.is_none() => Ok(()),
            ManagedPermissionDispositionV1::Selected => match self.option_id.as_deref() {
                Some(id)
                    if request
                        .options
                        .iter()
                        .any(|candidate| candidate.option_id == id) =>
                {
                    Ok(())
                }
                _ => Err(ManagedPermissionError::Option),
            },
            ManagedPermissionDispositionV1::Cancelled => Err(ManagedPermissionError::Option),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ManagedPermissionRequestV1 {
        ManagedPermissionRequestV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(2).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            acp_request_id: "7".into(),
            title: "Write file".into(),
            tool_call_id: Some("tool-1".into()),
            action_preview: Some("src/app.ts".into()),
            options: vec![
                ManagedPermissionOptionV1 {
                    option_id: "allow-7".into(),
                    name: "Allow".into(),
                    kind: "allow_once".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: "reject-7".into(),
                    name: "Reject".into(),
                    kind: "reject_once".into(),
                },
            ],
        }
    }

    #[test]
    fn decision_must_bind_exact_runtime_option() {
        let request = request();
        let decision = ManagedPermissionDecisionV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: request.session_epoch,
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            acp_request_id: request.acp_request_id.clone(),
            disposition: ManagedPermissionDispositionV1::Selected,
            option_id: Some("invented".into()),
        };
        assert_eq!(
            decision.validate_for(&request),
            Err(ManagedPermissionError::Option)
        );
    }

    #[test]
    fn stale_epoch_is_rejected() {
        let request = request();
        let decision = ManagedPermissionDecisionV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: SafeU53::new(3).unwrap(),
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            acp_request_id: request.acp_request_id.clone(),
            disposition: ManagedPermissionDispositionV1::Cancelled,
            option_id: None,
        };
        assert_eq!(
            decision.validate_for(&request),
            Err(ManagedPermissionError::Binding)
        );
    }

    #[test]
    fn action_preview_is_optional_and_display_safe() {
        let mut json = serde_json::to_value(request()).expect("request json");
        json.as_object_mut()
            .expect("request object")
            .remove("action_preview");
        let mut value: ManagedPermissionRequestV1 =
            serde_json::from_value(json).expect("legacy request without preview");
        assert_eq!(value.action_preview, None);
        assert_eq!(value.validate(), Ok(()));

        value.action_preview = Some("a".repeat(MAX_MANAGED_PRESENTATION_ACTIVITY_DETAIL_BYTES + 1));
        assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));

        value.action_preview = Some("safe\u{202e}spoofed".into());
        assert_eq!(value.validate(), Err(ManagedPermissionError::Protocol));
    }
}

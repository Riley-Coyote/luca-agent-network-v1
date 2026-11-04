//! Additive task lineage bound to an existing managed dispatch. Canonical
//! exchange IDs, source event IDs and signed messages remain authoritative.

use luca_protocol::{Hex64, OpaqueId};
use serde::{Deserialize, Serialize};

use super::agent_inbox::InboxScope;

/// Native-validated task/attempt and immutable return destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxTaskBinding {
    pub scope: InboxScope,
    pub logical_task_id: Hex64,
    pub attempt_exchange_id: Hex64,
    pub origin_conversation_id: OpaqueId,
    pub origin_request_event_id: Hex64,
    /// Execution attempt root differs from the immutable return origin after Continue.
    #[serde(default)]
    pub attempt_request_event_id: Option<Hex64>,
    pub initiator_pubkey: Hex64,
    pub recipient_pubkey: Hex64,
    pub parent_attempt_exchange_id: Option<Hex64>,
    #[serde(default)]
    pub parent_attempt_record_event_id: Option<Hex64>,
    pub result_event_id: Option<Hex64>,
    pub return_acknowledged: bool,
}

impl InboxTaskBinding {
    pub(crate) fn attempt_root(&self) -> &Hex64 {
        self.attempt_request_event_id
            .as_ref()
            .unwrap_or(&self.origin_request_event_id)
    }

    pub(crate) fn matches_owner_event(&self, event: &nostr::Event) -> bool {
        event.tags.iter().any(|tag| {
            let raw = tag.as_slice();
            if raw.first().map(String::as_str) == Some("luca-task-new") {
                return self.logical_task_id == self.attempt_exchange_id
                    && self.attempt_root().as_str() == event.id.to_hex()
                    && self.parent_attempt_exchange_id.is_none();
            }
            if raw.first().map(String::as_str) != Some("luca-task-reply")
                || raw.get(1).map(String::as_str) != Some(self.logical_task_id.as_str())
            {
                return false;
            }
            if raw.get(3).map(String::as_str) == Some("continue") {
                self.attempt_root().as_str() == event.id.to_hex()
                    && raw.get(2).map(String::as_str)
                        == self.parent_attempt_exchange_id.as_ref().map(Hex64::as_str)
            } else {
                raw.get(2).or_else(|| raw.get(1)).map(String::as_str)
                    == Some(self.attempt_exchange_id.as_str())
            }
        })
    }
}

/// A bounded native action slot, separate from its parent's ordinary final.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxChildActionBinding {
    pub scope: InboxScope,
    pub parent_dispatch_id: Hex64,
    pub action_key: Hex64,
    pub input_fingerprint: Hex64,
    pub recipient_pubkey: Hex64,
    pub phase: InboxChildActionPhase,
    pub anchor_event_id: Option<Hex64>,
    pub exchange_id: Option<Hex64>,
    pub root_event_id: Option<Hex64>,
    pub reply_event_id: Option<Hex64>,
    pub response_surface: Option<luca_protocol::ManagedResponseSurfaceV1>,
}

/// The anchor is owner-addressed; only the request can wake a correspondent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InboxChildActionPhase {
    Anchor,
    Request,
}

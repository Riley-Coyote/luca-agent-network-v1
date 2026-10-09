//! Body-free operational records; canonical semantic bodies stay in encrypted I1.
use luca_protocol::{
    Hex64, InitiativePlanningOutcomeV1, InitiativeThreadKindV1, InitiativeThreadV1, OpaqueId,
    SafeU53, Sha256Ref,
};
use serde::{Deserialize, Serialize};

/// Trusted current native-window/owner narrowing scope, never a reusable caller capability.
/// The parent must derive it from retained live owner/window state, not a model,
/// and recheck LiveAwarenessOwner and native binding at every actual effect.
/// Public identity fields permit keyless denial without a model or signing key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeControlScopeV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub window_id: OpaqueId,
    pub origin_scope_ref: Sha256Ref,
    pub now_unix_ms: u64,
}

/// Non-serde current host facts, not model-selectable authority or a runtime grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeRuntimeScopeV1 {
    pub control: InitiativeControlScopeV1,
    pub binding_ref: Sha256Ref,
    pub session_epoch: SafeU53,
    pub foreground_active: bool,
    pub outreach_authorized: bool,
}

/// Exact canonical refs independently read under encrypted I1 authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeCanonicalFactsV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub thread_id: OpaqueId,
    pub kind: InitiativeThreadKindV1,
    pub canonical_thread_ref: Sha256Ref,
    pub canonical_revision_ref: Sha256Ref,
}

/// Explicit wall-clock reservations for all stages; not observed token/currency usage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeTimeBudgetV1 {
    pub decision_ms: u64,
    pub work_ms: u64,
    pub return_ms: u64,
}

/// Host-issued cycle intent. It has no prompt, model, path, tools or grant selectors.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeCycleInputV1 {
    pub job_id: OpaqueId,
    pub request_id: OpaqueId,
    pub thread_id: OpaqueId,
    pub expected_thread_revision: SafeU53,
    pub canonical_revision_ref: Sha256Ref,
    pub dependency_ref: Sha256Ref,
    pub origin_conversation_id: Option<OpaqueId>,
    pub budget: InitiativeTimeBudgetV1,
    pub deadline_unix_ms: u64,
    pub continued_from: Option<OpaqueId>,
}

/// Durable lifecycle, not an inferred native-runtime status.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InitiativeJobStateV1 {
    Reserved,
    Planning,
    Ready,
    Dispatching,
    Working,
    Interrupted,
    Reconciled,
    Succeeded,
    ReturnReserved,
    Returned,
    Deferred,
    Declined,
    Retired,
    NoChange,
    Cancelled,
    Failed,
}
impl InitiativeJobStateV1 {
    pub(super) fn holds_concurrency(self) -> bool {
        matches!(
            self,
            Self::Reserved
                | Self::Planning
                | Self::Ready
                | Self::Dispatching
                | Self::Working
                | Self::Interrupted
                | Self::ReturnReserved
        )
    }
}

/// Durable body-free cycle record; never a second transcript or memory profile.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeJobV1 {
    pub input: InitiativeCycleInputV1,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub window_id: OpaqueId,
    pub origin_scope_ref: Sha256Ref,
    pub binding_ref: Sha256Ref,
    pub session_epoch: SafeU53,
    pub policy_revision: SafeU53,
    /// Current operational revision, separate from immutable admission input.
    pub current_thread_revision: SafeU53,
    /// Allocated host model stages, not observed provider-internal calls or spend.
    pub model_stages_reserved: u64,
    /// Bounded committed choice, never a prose plan or hidden reasoning.
    pub decision: Option<InitiativePlanningOutcomeV1>,
    pub state: InitiativeJobStateV1,
    pub created_unix_ms: u64,
    pub updated_unix_ms: u64,
    pub native_task_id: Option<OpaqueId>,
    pub native_receipt_ref: Option<Sha256Ref>,
    pub checkpoint_ref: Option<Sha256Ref>,
    pub result_ref: Option<Sha256Ref>,
    /// Private authorship intent/result references, never a D0 native task or body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_pursuit: Option<InitiativePrivatePursuitV1>,
    pub reconciliation_ref: Option<Sha256Ref>,
    pub return_key: Option<OpaqueId>,
    pub return_reserved_unix_ms: Option<u64>,
    pub return_receipt_ref: Option<Sha256Ref>,
}

/// Body-free private-work tracking. Framed means written to the private channel,
/// not proof the native model accepted or stopped the request.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativePrivatePursuitV1 {
    pub context_ref: Sha256Ref,
    pub reserved_unix_ms: u64,
    pub framed_unix_ms: Option<u64>,
    pub completed_unix_ms: Option<u64>,
    pub result_ref: Option<Sha256Ref>,
    pub creation_node: Option<OpaqueId>,
    pub artifact_ref: Option<Sha256Ref>,
    /// Canonical private inquiry coordinates, never its body or an artifact ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_thread_id: Option<OpaqueId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub own_revision_ref: Option<Sha256Ref>,
}

/// Exact independently verified owned-native receipt/reconciliation facts.
/// Parent authenticates the receipt, not a model's completion or checkpoint text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeNativeFactsV1 {
    pub job_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub binding_ref: Sha256Ref,
    pub session_epoch: SafeU53,
    pub native_task_id: Option<OpaqueId>,
    pub receipt_ref: Sha256Ref,
    pub checkpoint_ref: Option<Sha256Ref>,
    pub result_ref: Option<Sha256Ref>,
    pub stopped: bool,
}

/// Only owned initiative references are handed to the parent's cancellation consumer.
/// There is no D0-D6 task enumeration, PID or process control in this module.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InitiativeOwnedCancellationV1 {
    pub job_id: OpaqueId,
    pub native_task_id: Option<OpaqueId>,
    pub return_key: Option<OpaqueId>,
    pub origin_scope_ref: Sha256Ref,
    pub binding_ref: Sha256Ref,
    pub session_epoch: SafeU53,
}

/// Body-free database/control failure; never includes paths or private text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InitiativeStoreErrorV1 {
    Invalid,
    Scope,
    Stale,
    Conflict,
    Disabled,
    ForegroundBusy,
    Capacity,
    Deadline,
    ReconciliationRequired,
    Unavailable,
}

pub(super) fn scope_matches_thread(
    scope: &InitiativeControlScopeV1,
    thread: &InitiativeThreadV1,
) -> bool {
    scope.owner_pubkey == thread.owner_pubkey && scope.resident_pubkey == thread.resident_pubkey
}

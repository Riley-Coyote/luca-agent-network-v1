//! Local body-free awareness interfaces; these are not live caller authentication.
use luca_protocol::{
    AwarenessError, AwarenessGrantV1, AwarenessMaterialStateV1, AwarenessSourceV1,
    CanonicalTimestamp, Hex64, OpaqueId, SafeU53, Sha256Ref, AwarenessObservationRefV1,
};
use serde::{Deserialize, Serialize};
use std::fmt;

/// Redacted failure; never contains a database path, content, or SQL diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AwarenessStoreError {
    Unavailable,
    UnsafePath,
    Schema,
    Invalid,
    Missing,
    Conflict,
    ReplayConflict,
    Quarantined,
    Suspended,
    Capacity,
    Paused,
    Denied(AwarenessError),
}
impl fmt::Display for AwarenessStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "awareness authority: {self:?}")
    }
}
impl std::error::Error for AwarenessStoreError {}
impl From<rusqlite::Error> for AwarenessStoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Unavailable
    }
}
impl From<AwarenessError> for AwarenessStoreError {
    fn from(value: AwarenessError) -> Self {
        Self::Denied(value)
    }
}

/// An exact source scope; identifiers must be host-issued, not sensitive labels.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AwarenessSourceKeyV1 {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) source_id: OpaqueId,
    pub(crate) device_id: OpaqueId,
}
/// One companion's grant, never an all-residents or future-residents selector.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct AwarenessGrantKeyV1 {
    pub(crate) source: AwarenessSourceKeyV1,
    pub(crate) resident_pubkey: Hex64,
}
/// Current host facts; deliberately not deserializable or supplied by content.
pub(crate) struct AwarenessHostFactsV1<'a> {
    pub(crate) owner_pubkey: &'a Hex64,
    pub(crate) resident_pubkey: &'a Hex64,
    pub(crate) now: &'a CanonicalTimestamp,
    pub(crate) source_fresh: bool,
    pub(crate) material_state: AwarenessMaterialStateV1,
}
/// Facts independently established for each exact dependency root. The resolver
/// is synchronous and consumes preloaded host facts, never awaits/collects/asks.
#[derive(Clone, Copy)]
pub(crate) struct AwarenessMaterialFactsV1 {
    pub(crate) source_fresh: bool,
    pub(crate) material_state: AwarenessMaterialStateV1,
}

/// Host-derived child metadata. No native UUID, locator or source body exists here.
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct AwarenessProfileChildV1 {
    pub(crate) child_ref: OpaqueId,
    pub(crate) exclusion_token: Sha256Ref,
}
/// Full stored observation binding, never a source-wide profile freshness claim.
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct AwarenessProfileChildBindingV1 {
    pub(crate) reference: AwarenessObservationRefV1,
    pub(crate) child: AwarenessProfileChildV1,
}
/// Missing control state is revision zero and paused, never implicitly running.
#[derive(Debug, Clone)]
pub(crate) struct AwarenessResidentStateV1 {
    pub(crate) revision: SafeU53,
    pub(crate) paused: bool,
    pub(crate) changed_at: Option<CanonicalTimestamp>,
}
/// Owned body-free current state for constructing an I0 authority snapshot.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct AwarenessStoredAuthorityV1 {
    pub(crate) source: AwarenessSourceV1,
    pub(crate) source_revision: SafeU53,
    pub(crate) grant: AwarenessGrantV1,
}
/// Bounded, exact-companion inventory, never a live authorization claim.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct AwarenessGrantListV1 {
    pub(crate) entries: Vec<AwarenessStoredAuthorityV1>,
    pub(crate) truncated: bool,
}
/// A committed operation receipt, not a reusable claim of current permission.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct AwarenessMutationReceiptV1 {
    pub(crate) source_revision: Option<SafeU53>,
    pub(crate) deny_epoch: Option<SafeU53>,
    pub(crate) grant_revision: Option<SafeU53>,
    pub(crate) resident_revision: Option<SafeU53>,
    pub(crate) quarantined_nodes: usize,
    pub(crate) replayed: bool,
}
/// Withdrawal semantics. Both establish the deny/quarantine barrier; canonical
/// content purge/revision after Forget belongs to the existing memory authority.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AwarenessWithdrawalV1 {
    Withdraw,
    Forget,
}
/// Opaque references to existing host-owned context/jobs/canonical records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AwarenessDependentKindV1 {
    Context,
    Job,
    Promoted,
}
impl AwarenessDependentKindV1 {
    pub(super) fn wire(self) -> &'static str {
        match self {
            Self::Context => "context",
            Self::Job => "job",
            Self::Promoted => "promoted",
        }
    }
}

//! Opt-in paused policy and conservative reservation ceilings, never productivity targets.
use super::types::{InitiativeStoreErrorV1, InitiativeTimeBudgetV1};
use luca_protocol::SafeU53;
use serde::{Deserialize, Serialize};

/// Rolling windows avoid midnight/timezone reset and catch-up loopholes.
pub(crate) const INITIATIVE_WINDOW_MS: u64 = 24 * 60 * 60 * 1000;
/// Conservatively reserve every possible host model stage under the frozen ceiling.
/// Native provider-internal requests still require separate verified enforcement.
pub(crate) const MAX_INITIATIVE_MODEL_STAGES: u64 = 3;
/// Preserve the frozen proactive rolling-24h ceiling.
pub(crate) const MAX_INITIATIVE_OUTREACH: u64 = 1;
/// Supported wall-clock bound only; no strict token/currency capability is claimed.
pub(crate) const MAX_INITIATIVE_CYCLE_MS: u64 = 30 * 60 * 1000;

/// Body-free owner policy. Defaults disabled and paused; no minimum work or gifts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativePolicyV1 {
    pub revision: SafeU53,
    pub enabled: bool,
    pub paused: bool,
    /// Explicit permission to preserve resident-authored work in local Library.
    /// Existing policies never acquire this authority by migration.
    #[serde(default)]
    pub allow_local_creations: bool,
    pub max_model_stages_per_24h: u64,
    pub max_outreach_per_24h: u64,
    pub max_cycle_time_ms: u64,
    pub max_reserved_time_per_24h_ms: u64,
}
impl InitiativePolicyV1 {
    /// An absent owner policy is disabled and paused, without an implicit grant.
    pub(crate) fn disabled() -> Result<Self, InitiativeStoreErrorV1> {
        Ok(Self {
            revision: SafeU53::new(0).map_err(|_| InitiativeStoreErrorV1::Invalid)?,
            enabled: false,
            paused: true,
            allow_local_creations: false,
            max_model_stages_per_24h: 3,
            max_outreach_per_24h: 0,
            max_cycle_time_ms: 15 * 60 * 1000,
            max_reserved_time_per_24h_ms: 45 * 60 * 1000,
        })
    }
    pub(crate) fn validate(&self) -> Result<(), InitiativeStoreErrorV1> {
        if (!self.enabled && !self.paused)
            || self.max_model_stages_per_24h > MAX_INITIATIVE_MODEL_STAGES
            || self.max_outreach_per_24h > MAX_INITIATIVE_OUTREACH
            || self.max_cycle_time_ms == 0
            || self.max_cycle_time_ms > MAX_INITIATIVE_CYCLE_MS
            || self.max_reserved_time_per_24h_ms
                > MAX_INITIATIVE_MODEL_STAGES * MAX_INITIATIVE_CYCLE_MS
        {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
        Ok(())
    }
    pub(super) fn admits(&self) -> Result<(), InitiativeStoreErrorV1> {
        self.validate()?;
        if !self.enabled || self.paused {
            Err(InitiativeStoreErrorV1::Disabled)
        } else {
            Ok(())
        }
    }
}
impl InitiativeTimeBudgetV1 {
    /// Reserve each potentially model-assisted stage before admission, not one
    /// disguised whole-pursuit call. Zero work/return duration reserves no stage.
    pub(crate) fn model_stages(&self) -> u64 {
        u64::from(self.decision_ms > 0)
            + u64::from(self.work_ms > 0)
            + u64::from(self.return_ms > 0)
    }
    /// Whole-cycle time is reserved before any decision/work/return admission.
    pub(crate) fn total_ms(&self) -> Result<u64, InitiativeStoreErrorV1> {
        if self.decision_ms > 180_000 || self.return_ms > 180_000 {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
        self.decision_ms
            .checked_add(self.work_ms)
            .and_then(|n| n.checked_add(self.return_ms))
            .filter(|n| *n > 0 && *n <= MAX_INITIATIVE_CYCLE_MS)
            .ok_or(InitiativeStoreErrorV1::Invalid)
    }
}

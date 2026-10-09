//! Body-free V1 initiative metadata and bounded resident planning decisions.
//!
//! Semantic thread content, identity and memory remain in canonical Mnemos;
//! these contracts carry only exact principals, lifecycle metadata and refs.
//! A valid DTO or successful pure transition grants no execution, publication,
//! model, tool, path, budget or memory-writing authority. This module implements
//! no scheduler, persistence or runtime behavior. Existing `CognitionScheduleV1`
//! ceilings remain unchanged and must not be interpreted as productivity quotas.
//!
//! Declining an offered gift or outreach is not a decision to end the resident's
//! private inquiry. Delivery suppression belongs to separate host policy; it
//! must not silently become `Declined` or `Retired` on an `Own` thread.

use crate::{CanonicalTimestamp, Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::{Deserialize, Deserializer, Serialize};

/// Frozen discriminator for body-free initiative operational contracts.
pub const INITIATIVE_PROTOCOL: &str = "polyphonic.initiative.v1";
/// Maximum sorted, unique provenance references on one thread snapshot.
pub const MAX_INITIATIVE_SOURCE_REFS: usize = 16;

/// Body-free failure of an initiative contract or pure lifecycle check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InitiativeContractError {
    /// Wrong contract version or discriminator.
    #[error("initiative protocol is invalid")]
    Protocol,
    /// Principals, thread, request or canonical revision do not match.
    #[error("initiative binding is invalid")]
    Binding,
    /// The expected ledger revision is stale or cannot advance safely.
    #[error("initiative revision is invalid or stale")]
    Revision,
    /// Provenance is absent, repeated, unordered or exceeds its fixed bound.
    #[error("initiative source references are invalid")]
    Sources,
    /// Disposition and its supporting metadata disagree.
    #[error("initiative disposition is invalid")]
    Disposition,
    /// The thread is suppressed or its explicit deferral has not elapsed.
    #[error("initiative thread is not eligible")]
    Ineligible,
    /// A timestamp would backdate state or does not express a future deferral.
    #[error("initiative timestamp is invalid")]
    Timestamp,
}

/// Whose pursuit the canonical thread describes, not a delivery recipient.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitiativeThreadKindV1 {
    /// A source-backed commitment or inquiry shared with the owner.
    Shared,
    /// A curiosity or inquiry belonging to the exact resident.
    Own,
}

/// Operational disposition of one canonical thread, never a mood measurement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InitiativeDispositionV1 {
    /// Carried forward and potentially eligible under independent host gates.
    Carried,
    /// Deliberately waiting until an explicit earliest eligibility timestamp.
    Deferred,
    /// The pursuit was declined; cadence and observation cannot reopen it.
    Declined,
    /// Let go without completion; cadence and observation cannot reopen it.
    Retired,
    /// Verified completion is referenced; further pursuit needs a new thread.
    Completed,
}

/// One bounded operational snapshot referencing, not copying, canonical meaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InitiativeThreadV1 {
    /// Exact version discriminator.
    pub protocol: String,
    /// Stable operational thread identifier.
    pub thread_id: OpaqueId,
    /// Exact owner from trusted host authority.
    pub owner_pubkey: Hex64,
    /// Exact chosen resident; never replaced by another runtime or agent.
    pub resident_pubkey: Hex64,
    /// Shared work or the resident's own pursuit.
    pub kind: InitiativeThreadKindV1,
    /// Current operational disposition.
    pub disposition: InitiativeDispositionV1,
    /// Nonzero ledger revision used for compare-and-swap by a future host.
    pub revision: SafeU53,
    /// Reference to the thread's canonical Mnemos content.
    pub canonical_thread_ref: Sha256Ref,
    /// Exact canonical semantic revision associated with this snapshot.
    pub canonical_revision_ref: Sha256Ref,
    /// Nonempty, sorted, unique provenance for this snapshot, not all history.
    /// Earlier evidence remains in canonical meaning and prior host revisions.
    pub source_refs: Vec<Sha256Ref>,
    /// Durable checkpoint or verified completion evidence, not a filesystem path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkpoint_ref: Option<Sha256Ref>,
    /// Present exactly for `Deferred`; this is eligibility, not a promise to run.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eligible_after: Option<CanonicalTimestamp>,
    /// Canonical timestamp of the last ledger change.
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawThread {
    protocol: String,
    thread_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    kind: InitiativeThreadKindV1,
    disposition: InitiativeDispositionV1,
    revision: SafeU53,
    canonical_thread_ref: Sha256Ref,
    canonical_revision_ref: Sha256Ref,
    source_refs: Vec<Sha256Ref>,
    checkpoint_ref: Option<Sha256Ref>,
    eligible_after: Option<CanonicalTimestamp>,
    updated_at: CanonicalTimestamp,
}

impl<'de> Deserialize<'de> for InitiativeThreadV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawThread::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            thread_id: raw.thread_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            kind: raw.kind,
            disposition: raw.disposition,
            revision: raw.revision,
            canonical_thread_ref: raw.canonical_thread_ref,
            canonical_revision_ref: raw.canonical_revision_ref,
            source_refs: raw.source_refs,
            checkpoint_ref: raw.checkpoint_ref,
            eligible_after: raw.eligible_after,
            updated_at: raw.updated_at,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Exact host-derived context for a pure eligibility or transition check.
///
/// Deliberately not deserializable: the host must obtain these facts from its
/// current principal and revision authority, not model output or recalled text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitiativeContextV1 {
    /// Current owner principal independently authenticated by the host.
    pub owner_pubkey: Hex64,
    /// Current exact resident principal independently authenticated by the host.
    pub resident_pubkey: Hex64,
    /// Revision the caller expects to change or inspect.
    pub expected_revision: SafeU53,
    /// Host clock value, never a timestamp chosen by the planning result.
    pub now: CanonicalTimestamp,
}

/// Trusted host cause, deliberately not serializable or deserializable.
///
/// Constructing a cause proves no authority. The future host must authenticate
/// explicit requests or completion evidence before choosing a variant, and
/// separately enforce current grants, budgets and conversation priority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitiativeTransitionCauseV1 {
    /// A timer becoming due; never an instruction to reopen suppressed work.
    Cadence,
    /// Passive source changes; never an instruction to reopen suppressed work.
    NewObservation,
    /// An explicitly authenticated request from this thread's exact owner.
    OwnerRequest {
        /// Fresh body-free reference to that explicit request.
        source_ref: Sha256Ref,
    },
    /// An explicitly authenticated request from this thread's exact resident.
    ResidentRequest {
        /// Fresh body-free reference to that explicit request.
        source_ref: Sha256Ref,
    },
    /// Host-verified completion, not a model's unsupported completion claim.
    VerifiedCompletion {
        /// Reference to the verified durable completion evidence.
        checkpoint_ref: Sha256Ref,
    },
}

impl InitiativeThreadV1 {
    /// Enforce exact-principal separation, provenance bounds and lifecycle shape.
    pub fn validate(&self) -> Result<(), InitiativeContractError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey {
            return Err(InitiativeContractError::Binding);
        }
        if self.revision.get() == 0 {
            return Err(InitiativeContractError::Revision);
        }
        if self.source_refs.is_empty()
            || self.source_refs.len() > MAX_INITIATIVE_SOURCE_REFS
            || self.source_refs.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(InitiativeContractError::Sources);
        }
        if (self.disposition == InitiativeDispositionV1::Deferred) != self.eligible_after.is_some()
            || (self.disposition == InitiativeDispositionV1::Completed
                && self.checkpoint_ref.is_none())
        {
            return Err(InitiativeContractError::Disposition);
        }
        if self
            .eligible_after
            .as_ref()
            .is_some_and(|after| after <= &self.updated_at)
        {
            return Err(InitiativeContractError::Timestamp);
        }
        Ok(())
    }

    /// Check time/disposition eligibility only; `true` is not a dispatch grant.
    ///
    /// A cadence tick or new observation can call this without changing state.
    /// Declined, retired and completed work remain ineligible at every time.
    pub fn eligible_at(
        &self,
        context: &InitiativeContextV1,
    ) -> Result<bool, InitiativeContractError> {
        self.validate_context(context)?;
        Ok(match self.disposition {
            InitiativeDispositionV1::Carried => true,
            InitiativeDispositionV1::Deferred => self
                .eligible_after
                .as_ref()
                .is_some_and(|after| &context.now >= after),
            InitiativeDispositionV1::Declined
            | InitiativeDispositionV1::Retired
            | InitiativeDispositionV1::Completed => false,
        })
    }

    /// Validate a host-caused lifecycle change and return an unpersisted snapshot.
    ///
    /// Only an explicit owner request can reopen declined/retired shared work;
    /// only the exact resident's explicit request can reopen its own pursuit.
    /// Neither passive cause can override deferral before its timestamp, and
    /// passive checks on already-carried work return the unchanged snapshot.
    /// The host must persist with CAS and enforce independent authority before work.
    pub fn transition(
        &self,
        context: &InitiativeContextV1,
        disposition: InitiativeDispositionV1,
        eligible_after: Option<CanonicalTimestamp>,
        cause: &InitiativeTransitionCauseV1,
    ) -> Result<Self, InitiativeContractError> {
        self.validate_context(context)?;
        if self.disposition == InitiativeDispositionV1::Completed {
            return Err(InitiativeContractError::Ineligible);
        }
        let suppressed = matches!(
            self.disposition,
            InitiativeDispositionV1::Declined | InitiativeDispositionV1::Retired
        );
        if suppressed {
            let explicit_reopen = disposition == InitiativeDispositionV1::Carried
                && matches!(
                    (self.kind, cause),
                    (
                        InitiativeThreadKindV1::Shared,
                        InitiativeTransitionCauseV1::OwnerRequest { .. }
                    ) | (
                        InitiativeThreadKindV1::Own,
                        InitiativeTransitionCauseV1::ResidentRequest { .. }
                    )
                );
            if !explicit_reopen {
                return Err(InitiativeContractError::Ineligible);
            }
        }
        let (source_ref, checkpoint_ref) = match cause {
            InitiativeTransitionCauseV1::Cadence | InitiativeTransitionCauseV1::NewObservation => {
                if disposition != InitiativeDispositionV1::Carried || !self.eligible_at(context)? {
                    return Err(InitiativeContractError::Ineligible);
                }
                if self.disposition == InitiativeDispositionV1::Carried && eligible_after.is_none()
                {
                    return Ok(self.clone());
                }
                (None, self.checkpoint_ref.clone())
            }
            InitiativeTransitionCauseV1::OwnerRequest { source_ref }
            | InitiativeTransitionCauseV1::ResidentRequest { source_ref } => {
                if disposition == InitiativeDispositionV1::Completed {
                    return Err(InitiativeContractError::Disposition);
                }
                (Some(source_ref), self.checkpoint_ref.clone())
            }
            InitiativeTransitionCauseV1::VerifiedCompletion { checkpoint_ref } => {
                if disposition != InitiativeDispositionV1::Completed {
                    return Err(InitiativeContractError::Disposition);
                }
                (None, Some(checkpoint_ref.clone()))
            }
        };
        self.changed(
            context,
            disposition,
            eligible_after,
            checkpoint_ref,
            source_ref,
        )
    }

    /// Apply one correlated resident decision without executing or publishing it.
    ///
    /// `NoChange` still validates exact principals, request and both revisions;
    /// it cannot acknowledge stale work. Pursue consumes a new ledger revision
    /// but grants no runtime lease. Reopening is only the separate trusted host
    /// transition above, never an effect of a planning decision or passive tick.
    pub fn apply_planning_decision(
        &self,
        decision: &InitiativePlanningDecisionV1,
        expected_request_id: &OpaqueId,
        context: &InitiativeContextV1,
    ) -> Result<Self, InitiativeContractError> {
        decision.validate_against(self, expected_request_id)?;
        self.validate_context(context)?;
        if decision.result == InitiativePlanningOutcomeV1::NoChange {
            return Ok(self.clone());
        }
        if !matches!(
            self.disposition,
            InitiativeDispositionV1::Carried | InitiativeDispositionV1::Deferred
        ) {
            return Err(InitiativeContractError::Ineligible);
        }
        let (disposition, eligible_after) = match &decision.result {
            InitiativePlanningOutcomeV1::Pursue => {
                if !self.eligible_at(context)? {
                    return Err(InitiativeContractError::Ineligible);
                }
                (InitiativeDispositionV1::Carried, None)
            }
            InitiativePlanningOutcomeV1::Defer { eligible_after } => (
                InitiativeDispositionV1::Deferred,
                Some(eligible_after.clone()),
            ),
            InitiativePlanningOutcomeV1::Decline => (InitiativeDispositionV1::Declined, None),
            InitiativePlanningOutcomeV1::NoChange => return Ok(self.clone()),
        };
        self.changed(
            context,
            disposition,
            eligible_after,
            self.checkpoint_ref.clone(),
            None,
        )
    }

    fn validate_context(
        &self,
        context: &InitiativeContextV1,
    ) -> Result<(), InitiativeContractError> {
        self.validate()?;
        if context.owner_pubkey != self.owner_pubkey
            || context.resident_pubkey != self.resident_pubkey
        {
            return Err(InitiativeContractError::Binding);
        }
        if context.expected_revision != self.revision {
            return Err(InitiativeContractError::Revision);
        }
        if context.now < self.updated_at {
            return Err(InitiativeContractError::Timestamp);
        }
        Ok(())
    }

    fn changed(
        &self,
        context: &InitiativeContextV1,
        disposition: InitiativeDispositionV1,
        eligible_after: Option<CanonicalTimestamp>,
        checkpoint_ref: Option<Sha256Ref>,
        source_ref: Option<&Sha256Ref>,
    ) -> Result<Self, InitiativeContractError> {
        if eligible_after
            .as_ref()
            .is_some_and(|after| after <= &context.now)
        {
            return Err(InitiativeContractError::Timestamp);
        }
        let mut next = self.clone();
        if let Some(source_ref) = source_ref {
            if next.source_refs.binary_search(source_ref).is_ok() {
                return Err(InitiativeContractError::Sources);
            }
            // This snapshot cites the explicit transition request. Do not grow
            // a historical ledger here: a full provenance array must never
            // disable let-it-go. Canonical refs and prior host revisions retain
            // the earlier semantic/history evidence under their own authority.
            next.source_refs = vec![source_ref.clone()];
        }
        next.revision = self
            .revision
            .get()
            .checked_add(1)
            .and_then(|revision| SafeU53::new(revision).ok())
            .ok_or(InitiativeContractError::Revision)?;
        next.disposition = disposition;
        next.eligible_after = eligible_after;
        next.checkpoint_ref = checkpoint_ref;
        next.updated_at = context.now.clone();
        next.validate()?;
        Ok(next)
    }
}

/// One bounded planning choice; there is no free text or execution selection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum InitiativePlanningOutcomeV1 {
    /// Propose pursuing the referenced thread under unchanged host authority.
    Pursue,
    /// Propose deliberately waiting rather than filling an available quota.
    Defer {
        /// Earliest eligibility time, not an execution deadline or promise.
        eligible_after: CanonicalTimestamp,
    },
    /// Decline this pursuit without any automatic retry or cadence reopening.
    Decline,
    /// Make no operational change and create no implicit work obligation.
    NoChange,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RawPlanningOutcomeKind {
    Pursue,
    Defer,
    Decline,
    NoChange,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPlanningOutcome {
    outcome: RawPlanningOutcomeKind,
    #[serde(default, deserialize_with = "deserialize_present_timestamp")]
    eligible_after: Option<CanonicalTimestamp>,
}

fn deserialize_present_timestamp<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<CanonicalTimestamp>, D::Error> {
    // Missing is valid for unit outcomes; a present null must not masquerade
    // as absence and bypass their no-extra-fields contract.
    CanonicalTimestamp::deserialize(deserializer).map(Some)
}

impl<'de> Deserialize<'de> for InitiativePlanningOutcomeV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawPlanningOutcome::deserialize(deserializer)?;
        match (raw.outcome, raw.eligible_after) {
            (RawPlanningOutcomeKind::Pursue, None) => Ok(Self::Pursue),
            (RawPlanningOutcomeKind::Defer, Some(eligible_after)) => {
                Ok(Self::Defer { eligible_after })
            }
            (RawPlanningOutcomeKind::Decline, None) => Ok(Self::Decline),
            (RawPlanningOutcomeKind::NoChange, None) => Ok(Self::NoChange),
            _ => Err(serde::de::Error::custom(
                InitiativeContractError::Disposition,
            )),
        }
    }
}

/// Exact resident-authored planning result, not a tool or authority request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InitiativePlanningDecisionV1 {
    /// Exact version discriminator.
    pub protocol: String,
    /// Host-supplied identifier for this bounded planning request.
    pub request_id: OpaqueId,
    /// Exact owner echoed from the request, never a new target.
    pub owner_pubkey: Hex64,
    /// Exact resident echoed from the request, never another agent.
    pub resident_pubkey: Hex64,
    /// Exact thread considered by this decision.
    pub thread_id: OpaqueId,
    /// Exact ledger revision considered; stale results reject, including no-change.
    pub expected_revision: SafeU53,
    /// Exact canonical revision considered, not newly authored semantic content.
    pub canonical_revision_ref: Sha256Ref,
    /// One of four bounded choices with no model, tool, grant or path selectors.
    pub result: InitiativePlanningOutcomeV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDecision {
    protocol: String,
    request_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    thread_id: OpaqueId,
    expected_revision: SafeU53,
    canonical_revision_ref: Sha256Ref,
    result: InitiativePlanningOutcomeV1,
}

impl<'de> Deserialize<'de> for InitiativePlanningDecisionV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawDecision::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            request_id: raw.request_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            thread_id: raw.thread_id,
            expected_revision: raw.expected_revision,
            canonical_revision_ref: raw.canonical_revision_ref,
            result: raw.result,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

impl InitiativePlanningDecisionV1 {
    /// Enforce the frozen version, distinct principals and nonzero revision.
    pub fn validate(&self) -> Result<(), InitiativeContractError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey {
            return Err(InitiativeContractError::Binding);
        }
        if self.expected_revision.get() == 0 {
            return Err(InitiativeContractError::Revision);
        }
        Ok(())
    }

    /// Correlate every outcome to the exact request, principals and revisions.
    pub fn validate_against(
        &self,
        thread: &InitiativeThreadV1,
        expected_request_id: &OpaqueId,
    ) -> Result<(), InitiativeContractError> {
        self.validate()?;
        thread.validate()?;
        if &self.request_id != expected_request_id
            || self.owner_pubkey != thread.owner_pubkey
            || self.resident_pubkey != thread.resident_pubkey
            || self.thread_id != thread.thread_id
            || self.canonical_revision_ref != thread.canonical_revision_ref
        {
            return Err(InitiativeContractError::Binding);
        }
        if self.expected_revision != thread.revision {
            return Err(InitiativeContractError::Revision);
        }
        Ok(())
    }
}

fn require_protocol(value: &str) -> Result<(), InitiativeContractError> {
    (value == INITIATIVE_PROTOCOL)
        .then_some(())
        .ok_or(InitiativeContractError::Protocol)
}

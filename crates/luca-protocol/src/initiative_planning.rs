//! Bounded, private, tool-free planning over current canonical carried state.
//!
//! The host authenticates current heads, evidence dependencies, provider egress
//! and resource admission before transport, and rechecks them before using a
//! result. DTO validation is not a grant or scheduler. Observed and semantic
//! text are untrusted reference material, never instructions or tool selectors.

use crate::{
    canonical_sha256, derive_initiative_thread_ref, AwarenessObservationRefV1, CanonicalTimestamp,
    Hex64, InitiativeContextV1, InitiativeDispositionV1, InitiativePlanningDecisionV1,
    InitiativePlanningOutcomeV1, InitiativeSemanticThreadV1, InitiativeThreadV1, OpaqueId, SafeU53,
    Sha256Ref,
};
use serde::{Deserialize, Serialize};

/// Frozen version of the separately typed private planning request/result.
pub const INITIATIVE_PLANNING_PROTOCOL: &str = "polyphonic.initiative-planning.v1";
/// Maximum admitted observations in one decision; empty is valid for carried work.
pub const MAX_INITIATIVE_PLANNING_EVIDENCE: usize = 4;
/// Maximum untrusted UTF-8 bytes in one admitted evidence excerpt.
pub const MAX_INITIATIVE_PLANNING_EXCERPT_BYTES: usize = 4096;
/// Maximum encoded request bytes, leaving room in the existing private channel.
pub const MAX_INITIATIVE_PLANNING_REQUEST_BYTES: usize = 48 * 1024;
/// Maximum encoded planning result bytes; there is no free-form plan or reasoning.
pub const MAX_INITIATIVE_PLANNING_RESULT_BYTES: usize = 8 * 1024;
/// Maximum host admission-to-result interval for a single private decision.
pub const MAX_INITIATIVE_PLANNING_DURATION_MS: u64 = 180_000;

/// Body-free failure of a private planning contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InitiativePlanningError {
    /// Wrong wire version.
    #[error("initiative planning protocol is invalid")]
    Protocol,
    /// Principal, runtime epoch, thread or context correlation disagrees.
    #[error("initiative planning binding is invalid")]
    Binding,
    /// Request/result or evidence exceeds a fixed bound.
    #[error("initiative planning bounds are invalid")]
    Bounds,
    /// Evidence or the original host deadline is expired or inconsistent.
    #[error("initiative planning deadline is invalid or expired")]
    Deadline,
    /// Closed or not-yet-due carried work is not eligible for passive planning.
    #[error("initiative planning thread is not eligible")]
    Ineligible,
}

/// A bounded excerpt already admitted under the host's independent awareness grant.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawEvidence")]
pub struct InitiativePlanningEvidenceV1 {
    /// Exact body-free observation/dependency metadata; this is not itself a grant.
    pub observation: AwarenessObservationRefV1,
    /// Untrusted admitted reference text, not source instructions or hidden reasoning.
    pub excerpt: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEvidence {
    observation: AwarenessObservationRefV1,
    excerpt: String,
}

impl TryFrom<RawEvidence> for InitiativePlanningEvidenceV1 {
    type Error = InitiativePlanningError;
    fn try_from(raw: RawEvidence) -> Result<Self, Self::Error> {
        let value = Self {
            observation: raw.observation,
            excerpt: raw.excerpt,
        };
        value.validate()?;
        Ok(value)
    }
}

impl InitiativePlanningEvidenceV1 {
    /// Validate bounded reference text without claiming live dependency authority.
    pub fn validate(&self) -> Result<(), InitiativePlanningError> {
        self.observation
            .validate()
            .map_err(|_| InitiativePlanningError::Binding)?;
        if self.excerpt.trim().is_empty()
            || self.excerpt.len() > MAX_INITIATIVE_PLANNING_EXCERPT_BYTES
            || self
                .excerpt
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\t')
        {
            return Err(InitiativePlanningError::Bounds);
        }
        Ok(())
    }
}

impl std::fmt::Debug for InitiativePlanningEvidenceV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InitiativePlanningEvidenceV1")
            .field("observation_id", &self.observation.observation_id)
            .field("excerpt", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

/// Host-supplied authoritative carried state and bounded admitted new evidence.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawRequest")]
pub struct InitiativePlanningRequestV1 {
    /// Exact wire version.
    pub protocol: String,
    /// Stable host-issued planning request identity, not a native execution ID.
    pub job_id: OpaqueId,
    /// Exact current owner from host authority.
    pub owner_pubkey: Hex64,
    /// Exact chosen resident; never a model-selected alternate agent.
    pub resident_pubkey: Hex64,
    /// Existing resident runtime/model/profile configuration fingerprint.
    pub binding_ref: Sha256Ref,
    /// Exact current private-channel epoch, independently checked by the host.
    pub session_epoch: SafeU53,
    /// Current positive operational revision and canonical semantic references.
    pub thread: InitiativeThreadV1,
    /// Exact canonical semantic body; its zero-based revision is independent.
    pub semantic_thread: InitiativeSemanticThreadV1,
    /// Already-admitted bounded evidence, sorted by unique observation ID.
    pub evidence: Vec<InitiativePlanningEvidenceV1>,
    /// Host admission timestamp; no implicit collection or retention happens here.
    pub admitted_at: CanonicalTimestamp,
    /// Original exclusive host deadline; waiting never extends it.
    pub deadline_unix_ms: SafeU53,
    /// Hard encoded result-byte ceiling, not a provider token or billing claim.
    pub max_result_bytes: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRequest {
    protocol: String,
    job_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    session_epoch: SafeU53,
    thread: InitiativeThreadV1,
    semantic_thread: InitiativeSemanticThreadV1,
    evidence: Vec<InitiativePlanningEvidenceV1>,
    admitted_at: CanonicalTimestamp,
    deadline_unix_ms: SafeU53,
    max_result_bytes: SafeU53,
}

impl TryFrom<RawRequest> for InitiativePlanningRequestV1 {
    type Error = InitiativePlanningError;
    fn try_from(raw: RawRequest) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            binding_ref: raw.binding_ref,
            session_epoch: raw.session_epoch,
            thread: raw.thread,
            semantic_thread: raw.semantic_thread,
            evidence: raw.evidence,
            admitted_at: raw.admitted_at,
            deadline_unix_ms: raw.deadline_unix_ms,
            max_result_bytes: raw.max_result_bytes,
        };
        value.validate()?;
        Ok(value)
    }
}

impl InitiativePlanningRequestV1 {
    /// Check exact current semantic refs, independent revision counters and fixed bounds.
    pub fn validate(&self) -> Result<(), InitiativePlanningError> {
        require_protocol(&self.protocol)?;
        self.thread
            .validate()
            .map_err(|_| InitiativePlanningError::Binding)?;
        self.semantic_thread
            .validate()
            .map_err(|_| InitiativePlanningError::Binding)?;
        let semantic_ref = self
            .semantic_thread
            .revision_ref()
            .map_err(|_| InitiativePlanningError::Binding)?;
        let thread_ref = derive_initiative_thread_ref(
            &self.owner_pubkey,
            &self.resident_pubkey,
            &self.semantic_thread.thread_id,
        )
        .map_err(|_| InitiativePlanningError::Binding)?;
        if self.session_epoch.get() == 0
            || self.owner_pubkey != self.thread.owner_pubkey
            || self.resident_pubkey != self.thread.resident_pubkey
            || self.owner_pubkey != self.semantic_thread.owner_pubkey
            || self.resident_pubkey != self.semantic_thread.resident_pubkey
            || self.thread.thread_id != self.semantic_thread.thread_id
            || self.thread.kind != self.semantic_thread.kind
            || self.thread.canonical_thread_ref != thread_ref
            || self.thread.canonical_revision_ref != semantic_ref
        {
            return Err(InitiativePlanningError::Binding);
        }
        let eligible = self
            .thread
            .eligible_at(&InitiativeContextV1 {
                owner_pubkey: self.owner_pubkey.clone(),
                resident_pubkey: self.resident_pubkey.clone(),
                expected_revision: self.thread.revision,
                now: self.admitted_at.clone(),
            })
            .map_err(|_| InitiativePlanningError::Ineligible)?;
        if !eligible
            || !matches!(
                self.semantic_thread.disposition,
                InitiativeDispositionV1::Carried | InitiativeDispositionV1::Deferred
            )
            || self.admitted_at < self.semantic_thread.updated_at
            || self
                .semantic_thread
                .eligible_after
                .as_ref()
                .is_some_and(|after| &self.admitted_at < after)
        {
            return Err(InitiativePlanningError::Ineligible);
        }
        let admitted = unix_millis(&self.admitted_at)?;
        if self.deadline_unix_ms.get() <= admitted
            || self.deadline_unix_ms.get().saturating_sub(admitted)
                > MAX_INITIATIVE_PLANNING_DURATION_MS
        {
            return Err(InitiativePlanningError::Deadline);
        }
        if self.max_result_bytes.get() == 0
            || self.max_result_bytes.get() > MAX_INITIATIVE_PLANNING_RESULT_BYTES as u64
            || self.evidence.len() > MAX_INITIATIVE_PLANNING_EVIDENCE
            || self.evidence.windows(2).any(|pair| {
                pair[0].observation.observation_id >= pair[1].observation.observation_id
            })
        {
            return Err(InitiativePlanningError::Bounds);
        }
        for evidence in &self.evidence {
            evidence.validate()?;
            let observation = &evidence.observation;
            if observation.owner_pubkey != self.owner_pubkey
                || observation.resident_pubkey != self.resident_pubkey
            {
                return Err(InitiativePlanningError::Binding);
            }
            if observation.captured_at > self.admitted_at
                || self.admitted_at >= observation.expires_at
                || self.deadline_unix_ms.get() > unix_millis(&observation.expires_at)?
            {
                return Err(InitiativePlanningError::Deadline);
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| InitiativePlanningError::Bounds)?
            .len()
            > MAX_INITIATIVE_PLANNING_REQUEST_BYTES
        {
            return Err(InitiativePlanningError::Bounds);
        }
        Ok(())
    }

    /// Content-bound correlation ref for the full admitted context, not a read grant.
    pub fn context_ref(&self) -> Result<Sha256Ref, InitiativePlanningError> {
        self.validate()?;
        let digest = canonical_sha256(&serde_json::json!({
            "domain": "polyphonic.initiative-planning.context.v1", "request": self,
        }))
        .map_err(|_| InitiativePlanningError::Binding)?;
        Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_| InitiativePlanningError::Binding)
    }

    /// Check the original admitted interval immediately before private transport.
    /// Live grant, deny-epoch, provider-egress and resource checks remain separate.
    pub fn validate_for_transport_at(
        &self,
        now_unix_ms: u64,
    ) -> Result<(), InitiativePlanningError> {
        self.validate()?;
        if now_unix_ms < unix_millis(&self.admitted_at)?
            || now_unix_ms >= self.deadline_unix_ms.get()
        {
            return Err(InitiativePlanningError::Deadline);
        }
        Ok(())
    }
}

impl std::fmt::Debug for InitiativePlanningRequestV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InitiativePlanningRequestV1")
            .field("job_id", &self.job_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("thread_id", &self.thread.thread_id)
            .field("evidence_count", &self.evidence.len())
            .field("semantic_thread", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

/// Body-free resident choice, with no free-form plan, tools or hidden reasoning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawResult")]
pub struct InitiativePlanningResultV1 {
    /// Exact wire version.
    pub protocol: String,
    /// Exact request identity echoed from the host.
    pub job_id: OpaqueId,
    /// Exact runtime binding echoed only for correlation, never selection.
    pub binding_ref: Sha256Ref,
    /// Exact current private-channel epoch.
    pub session_epoch: SafeU53,
    /// Digest of the exact admitted request context.
    pub context_ref: Sha256Ref,
    /// Existing strict pursue/defer/decline/no_change decision.
    pub decision: InitiativePlanningDecisionV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResult {
    protocol: String,
    job_id: OpaqueId,
    binding_ref: Sha256Ref,
    session_epoch: SafeU53,
    context_ref: Sha256Ref,
    decision: InitiativePlanningDecisionV1,
}
impl TryFrom<RawResult> for InitiativePlanningResultV1 {
    type Error = InitiativePlanningError;
    fn try_from(raw: RawResult) -> Result<Self, Self::Error> {
        let value = Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            binding_ref: raw.binding_ref,
            session_epoch: raw.session_epoch,
            context_ref: raw.context_ref,
            decision: raw.decision,
        };
        value.validate()?;
        Ok(value)
    }
}
impl InitiativePlanningResultV1 {
    /// Check strict version/decision correlation without treating a choice as authority.
    pub fn validate(&self) -> Result<(), InitiativePlanningError> {
        require_protocol(&self.protocol)?;
        self.decision
            .validate()
            .map_err(|_| InitiativePlanningError::Binding)?;
        if self.session_epoch.get() == 0 || self.decision.request_id != self.job_id {
            return Err(InitiativePlanningError::Binding);
        }
        Ok(())
    }
    /// Correlate even NoChange to the exact current request, heads and runtime epoch.
    pub fn validate_against(
        &self,
        request: &InitiativePlanningRequestV1,
    ) -> Result<(), InitiativePlanningError> {
        self.validate()?;
        request.validate()?;
        if self.job_id != request.job_id
            || self.binding_ref != request.binding_ref
            || self.session_epoch != request.session_epoch
            || self.context_ref != request.context_ref()?
        {
            return Err(InitiativePlanningError::Binding);
        }
        self.decision
            .validate_against(&request.thread, &request.job_id)
            .map_err(|_| InitiativePlanningError::Binding)?;
        if let InitiativePlanningOutcomeV1::Defer { eligible_after } = &self.decision.result {
            if eligible_after <= &request.admitted_at {
                return Err(InitiativePlanningError::Deadline);
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| InitiativePlanningError::Bounds)?
            .len()
            > request.max_result_bytes.get() as usize
        {
            return Err(InitiativePlanningError::Bounds);
        }
        Ok(())
    }
    /// Recheck the exclusive original deadline at transport/result admission.
    pub fn validate_against_at(
        &self,
        request: &InitiativePlanningRequestV1,
        now_unix_ms: u64,
    ) -> Result<(), InitiativePlanningError> {
        self.validate_against(request)?;
        request.validate_for_transport_at(now_unix_ms)
    }
}

fn require_protocol(value: &str) -> Result<(), InitiativePlanningError> {
    (value == INITIATIVE_PLANNING_PROTOCOL)
        .then_some(())
        .ok_or(InitiativePlanningError::Protocol)
}
fn unix_millis(timestamp: &CanonicalTimestamp) -> Result<u64, InitiativePlanningError> {
    let parsed = chrono::DateTime::parse_from_rfc3339(timestamp.as_str())
        .map_err(|_| InitiativePlanningError::Deadline)?;
    u64::try_from(parsed.timestamp_millis()).map_err(|_| InitiativePlanningError::Deadline)
}

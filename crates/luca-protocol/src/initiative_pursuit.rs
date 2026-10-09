//! Bounded tool-free authorship, not web/shell research or publication authority.
//! The host admits exact carried state/evidence and independently rechecks current
//! heads, grants, egress, cancellation and resources before preserving a creation.

use crate::{
    canonical_sha256, CanonicalTimestamp, Hex64, InitiativePlanningEvidenceV1,
    InitiativePlanningRequestV1, InitiativeSemanticThreadV1, InitiativeThreadKindV1,
    InitiativeThreadV1, OpaqueId, SafeU53, Sha256Ref, INITIATIVE_PLANNING_PROTOCOL,
    MAX_INITIATIVE_THREAD_BODY_BYTES, MAX_INITIATIVE_THREAD_SOURCES,
};
use serde::{Deserialize, Deserializer, Serialize};

/// Version of separately typed, private authored-work requests and results.
pub const INITIATIVE_PURSUIT_PROTOCOL: &str = "polyphonic.initiative-pursuit.v1";
/// Hard encoded request ceiling within the existing private channel.
pub const MAX_INITIATIVE_PURSUIT_REQUEST_BYTES: usize = 48 * 1024;
/// Hard encoded result ceiling, including JSON escaping and correlation fields.
pub const MAX_INITIATIVE_PURSUIT_RESULT_BYTES: usize = 32 * 1024;
/// Maximum UTF-8 bytes of authored Markdown, not hidden reasoning.
pub const MAX_INITIATIVE_CREATION_MARKDOWN_BYTES: usize = 16 * 1024;
/// Maximum UTF-8 bytes of the creation's one-line title.
pub const MAX_INITIATIVE_CREATION_TITLE_BYTES: usize = 256;
/// Maximum exact admitted provenance references on one authored creation.
pub const MAX_INITIATIVE_CREATION_SOURCE_REFS: usize = 16;
/// Original admission-to-result interval; no wait or retry extends this deadline.
pub const MAX_INITIATIVE_PURSUIT_DURATION_MS: u64 = 180_000;

/// Body-free failure of a private authored-work contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum InitiativePursuitError {
    /// Wrong version.
    #[error("initiative pursuit protocol is invalid")]
    Protocol,
    /// Exact principal, head, runtime or admitted context disagrees.
    #[error("initiative pursuit binding is invalid")]
    Binding,
    /// Encoded data or authored content exceeds a fixed ceiling.
    #[error("initiative pursuit bounds are invalid")]
    Bounds,
    /// Original deadline or evidence validity is inconsistent/expired.
    #[error("initiative pursuit deadline is invalid or expired")]
    Deadline,
    /// Closed or not-yet-due carried state is not eligible.
    #[error("initiative pursuit thread is not eligible")]
    Ineligible,
}

/// Exact host-admitted context for one bounded synthesis or creative inquiry.
/// There is no model, provider, tool, path, publication or credential selector.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawPursuitRequest")]
pub struct InitiativePursuitRequestV1 {
    /// Exact authored-work wire version.
    pub protocol: String,
    /// Stable host-issued owned work ID, also the creation idempotency input.
    pub job_id: OpaqueId,
    /// Current authenticated host owner.
    pub owner_pubkey: Hex64,
    /// The one chosen resident, not a model-selected author.
    pub resident_pubkey: Hex64,
    /// Current native model/profile/persona binding fingerprint.
    pub binding_ref: Sha256Ref,
    /// Exact current private-channel epoch.
    pub session_epoch: SafeU53,
    /// Current operational projection, with its independent positive revision.
    pub thread: InitiativeThreadV1,
    /// Exact encrypted-canonical semantic body admitted by the host.
    pub semantic_thread: InitiativeSemanticThreadV1,
    /// Already admitted untrusted evidence; collection/retention is not implied.
    pub evidence: Vec<InitiativePlanningEvidenceV1>,
    /// Original host admission time.
    pub admitted_at: CanonicalTimestamp,
    /// Exclusive original deadline, never a new duration starting at transport.
    pub deadline_unix_ms: SafeU53,
    /// Host-selected encoded result ceiling within the fixed protocol maximum.
    pub max_result_bytes: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPursuitRequest {
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
impl TryFrom<RawPursuitRequest> for InitiativePursuitRequestV1 {
    type Error = InitiativePursuitError;
    fn try_from(raw: RawPursuitRequest) -> Result<Self, Self::Error> {
        let request = Self {
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
        request.validate()?;
        Ok(request)
    }
}
impl InitiativePursuitRequestV1 {
    /// Validate exact heads, eligibility, evidence provenance/expiry and fixed bounds.
    /// Reuse the I4 context contract, without weakening or changing its wire form.
    pub fn validate(&self) -> Result<(), InitiativePursuitError> {
        if self.protocol != INITIATIVE_PURSUIT_PROTOCOL {
            return Err(InitiativePursuitError::Protocol);
        }
        if self.max_result_bytes.get() == 0
            || self.max_result_bytes.get() > MAX_INITIATIVE_PURSUIT_RESULT_BYTES as u64
        {
            return Err(InitiativePursuitError::Bounds);
        }
        let admitted_ms = chrono::DateTime::parse_from_rfc3339(self.admitted_at.as_str())
            .ok()
            .and_then(|time| u64::try_from(time.timestamp_millis()).ok())
            .ok_or(InitiativePursuitError::Deadline)?;
        if self.deadline_unix_ms.get() <= admitted_ms
            || self.deadline_unix_ms.get().saturating_sub(admitted_ms)
                > MAX_INITIATIVE_PURSUIT_DURATION_MS
        {
            return Err(InitiativePursuitError::Deadline);
        }
        self.validation_context()?
            .validate()
            .map_err(context_error)?;
        if serde_json::to_vec(self)
            .map_err(|_| InitiativePursuitError::Bounds)?
            .len()
            > MAX_INITIATIVE_PURSUIT_REQUEST_BYTES
        {
            return Err(InitiativePursuitError::Bounds);
        }
        Ok(())
    }
    fn validation_context(&self) -> Result<InitiativePlanningRequestV1, InitiativePursuitError> {
        Ok(InitiativePlanningRequestV1 {
            protocol: INITIATIVE_PLANNING_PROTOCOL.into(),
            job_id: self.job_id.clone(),
            owner_pubkey: self.owner_pubkey.clone(),
            resident_pubkey: self.resident_pubkey.clone(),
            binding_ref: self.binding_ref.clone(),
            session_epoch: self.session_epoch,
            thread: self.thread.clone(),
            semantic_thread: self.semantic_thread.clone(),
            evidence: self.evidence.clone(),
            admitted_at: self.admitted_at.clone(),
            deadline_unix_ms: self.deadline_unix_ms,
            max_result_bytes: SafeU53::new(crate::MAX_INITIATIVE_PLANNING_RESULT_BYTES as u64)
                .map_err(|_| InitiativePursuitError::Bounds)?,
        })
    }
    /// Digest of the whole admitted authored-work context, not a reusable grant.
    pub fn context_ref(&self) -> Result<Sha256Ref, InitiativePursuitError> {
        self.validate()?;
        let hash = canonical_sha256(&serde_json::json!({
            "domain": "polyphonic.initiative-pursuit.context.v1", "request": self,
        }))
        .map_err(|_| InitiativePursuitError::Binding)?;
        Sha256Ref::parse(format!("sha256:{hash}")).map_err(|_| InitiativePursuitError::Binding)
    }
    /// Preserve the original exclusive deadline at actual private transport/use.
    pub fn validate_for_transport_at(
        &self,
        now_unix_ms: u64,
    ) -> Result<(), InitiativePursuitError> {
        self.validate()?;
        self.validation_context()?
            .validate_for_transport_at(now_unix_ms)
            .map_err(context_error)
    }
    fn contains_source_ref(&self, reference: &Sha256Ref) -> bool {
        reference == &self.thread.canonical_thread_ref
            || reference == &self.thread.canonical_revision_ref
            || self.thread.source_refs.contains(reference)
            || self.semantic_thread.source_refs.contains(reference)
            || self
                .evidence
                .iter()
                .any(|e| &e.observation.evidence_ref == reference)
    }
}
impl std::fmt::Debug for InitiativePursuitRequestV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InitiativePursuitRequestV1")
            .field("job_id", &self.job_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("thread_id", &self.thread.thread_id)
            .field("evidence_count", &self.evidence.len())
            .field("semantic_thread", &"[REDACTED]")
            .finish_non_exhaustive()
    }
}

/// An authored creation or a genuine no-deliverable outcome. No hidden reasoning.
#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum InitiativePursuitOutcomeV1 {
    /// Bounded Markdown draft; preservation/publication remains the host's choice.
    Created {
        /// One-line authored title.
        title: String,
        /// Authored Markdown, not a model execution report or reasoning trace.
        markdown: String,
        /// Sorted unique exact references drawn only from the admitted context.
        source_refs: Vec<Sha256Ref>,
    },
    /// Carry a resident-authored private inquiry, not an owner commitment,
    /// journal, artifact, notification or hidden reasoning trace. The host must
    /// authenticate completed native authorship and current canonical parents
    /// before committing it to the existing encrypted resident namespace.
    OwnInquiry {
        /// Bounded authored inquiry to carry across sessions.
        body: String,
        /// Sorted exact admitted refs. One canonical provenance slot is reserved
        /// for the host's verified native-result reference.
        source_refs: Vec<Sha256Ref>,
    },
    /// Deliberately create nothing; no implicit retry or quota.
    NoChange,
    /// Choose a strictly later eligibility time, not a promise of delivery.
    Defer {
        /// Host checks this is strictly after original admission.
        eligible_after: CanonicalTimestamp,
    },
    /// Decline this inquiry without automatic reopening.
    Decline,
    /// Explicitly retire the current resident-owned inquiry. This is forbidden
    /// for shared commitments, whose retirement requires trusted owner action.
    Retire,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RawOutcomeKind {
    Created,
    OwnInquiry,
    NoChange,
    Defer,
    Decline,
    Retire,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOutcome {
    outcome: RawOutcomeKind,
    #[serde(default, deserialize_with = "present_value")]
    title: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    markdown: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    body: Option<String>,
    #[serde(default, deserialize_with = "present_value")]
    source_refs: Option<Vec<Sha256Ref>>,
    #[serde(default, deserialize_with = "present_value")]
    eligible_after: Option<CanonicalTimestamp>,
}
fn present_value<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
impl<'de> Deserialize<'de> for InitiativePursuitOutcomeV1 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = RawOutcome::deserialize(d)?;
        let value = match (
            raw.outcome,
            raw.title,
            raw.markdown,
            raw.body,
            raw.source_refs,
            raw.eligible_after,
        ) {
            (RawOutcomeKind::Created, Some(title), Some(markdown), None, Some(source_refs), None) => {
                Self::Created {
                    title,
                    markdown,
                    source_refs,
                }
            }
            (RawOutcomeKind::OwnInquiry, None, None, Some(body), Some(source_refs), None) => {
                Self::OwnInquiry { body, source_refs }
            }
            (RawOutcomeKind::NoChange, None, None, None, None, None) => Self::NoChange,
            (RawOutcomeKind::Decline, None, None, None, None, None) => Self::Decline,
            (RawOutcomeKind::Retire, None, None, None, None, None) => Self::Retire,
            (RawOutcomeKind::Defer, None, None, None, None, Some(eligible_after)) => {
                Self::Defer { eligible_after }
            }
            _ => return Err(serde::de::Error::custom(InitiativePursuitError::Bounds)),
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}
impl InitiativePursuitOutcomeV1 {
    /// Enforce bounded authored data and a strict no-body shape for other outcomes.
    pub fn validate(&self) -> Result<(), InitiativePursuitError> {
        if let Self::Created {
            title,
            markdown,
            source_refs,
        } = self
        {
            if title.trim().is_empty()
                || title.len() > MAX_INITIATIVE_CREATION_TITLE_BYTES
                || title.chars().any(char::is_control)
                || markdown.trim().is_empty()
                || markdown.len() > MAX_INITIATIVE_CREATION_MARKDOWN_BYTES
                || markdown
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
                || source_refs.is_empty()
                || source_refs.len() > MAX_INITIATIVE_CREATION_SOURCE_REFS
                || source_refs.windows(2).any(|refs| refs[0] >= refs[1])
            {
                return Err(InitiativePursuitError::Bounds);
            }
        }
        if let Self::OwnInquiry { body, source_refs } = self {
            if body.trim().is_empty()
                || body.trim() != body
                || body.len() > MAX_INITIATIVE_THREAD_BODY_BYTES
                || body.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
                || source_refs.is_empty()
                || source_refs.len() >= MAX_INITIATIVE_THREAD_SOURCES
                || source_refs.windows(2).any(|refs| refs[0] >= refs[1])
            {
                return Err(InitiativePursuitError::Bounds);
            }
        }
        Ok(())
    }
}
impl std::fmt::Debug for InitiativePursuitOutcomeV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = match self {
            Self::Created { .. } => "created",
            Self::OwnInquiry { .. } => "own_inquiry",
            Self::NoChange => "no_change",
            Self::Defer { .. } => "defer",
            Self::Decline => "decline",
            Self::Retire => "retire",
        };
        f.debug_struct("InitiativePursuitOutcomeV1")
            .field("outcome", &kind)
            .finish_non_exhaustive()
    }
}

/// Exact-resident authored result, never a mutation, completion or publication grant.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "RawPursuitResult")]
pub struct InitiativePursuitResultV1 {
    /// Exact authored-work version.
    pub protocol: String,
    /// Exact host-owned work identity.
    pub job_id: OpaqueId,
    /// Echoed owner for correlation only.
    pub owner_pubkey: Hex64,
    /// Exact chosen resident author.
    pub resident_pubkey: Hex64,
    /// Exact canonical thread identity.
    pub thread_id: OpaqueId,
    /// Current positive operational revision.
    pub expected_revision: SafeU53,
    /// Exact canonical semantic revision digest.
    pub canonical_revision_ref: Sha256Ref,
    /// Exact native model/profile/persona binding, not selection.
    pub binding_ref: Sha256Ref,
    /// Exact private-channel epoch.
    pub session_epoch: SafeU53,
    /// Digest of the entire admitted request.
    pub context_ref: Sha256Ref,
    /// Bounded creation or valid no-deliverable choice.
    pub result: InitiativePursuitOutcomeV1,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPursuitResult {
    protocol: String,
    job_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    thread_id: OpaqueId,
    expected_revision: SafeU53,
    canonical_revision_ref: Sha256Ref,
    binding_ref: Sha256Ref,
    session_epoch: SafeU53,
    context_ref: Sha256Ref,
    result: InitiativePursuitOutcomeV1,
}
impl TryFrom<RawPursuitResult> for InitiativePursuitResultV1 {
    type Error = InitiativePursuitError;
    fn try_from(raw: RawPursuitResult) -> Result<Self, Self::Error> {
        let result = Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            thread_id: raw.thread_id,
            expected_revision: raw.expected_revision,
            canonical_revision_ref: raw.canonical_revision_ref,
            binding_ref: raw.binding_ref,
            session_epoch: raw.session_epoch,
            context_ref: raw.context_ref,
            result: raw.result,
        };
        result.validate()?;
        Ok(result)
    }
}
impl InitiativePursuitResultV1 {
    /// Validate fixed wire/content bounds without claiming host authority.
    pub fn validate(&self) -> Result<(), InitiativePursuitError> {
        if self.protocol != INITIATIVE_PURSUIT_PROTOCOL {
            return Err(InitiativePursuitError::Protocol);
        }
        if self.owner_pubkey == self.resident_pubkey
            || self.expected_revision.get() == 0
            || self.session_epoch.get() == 0
        {
            return Err(InitiativePursuitError::Binding);
        }
        self.result.validate()?;
        if serde_json::to_vec(self)
            .map_err(|_| InitiativePursuitError::Bounds)?
            .len()
            > MAX_INITIATIVE_PURSUIT_RESULT_BYTES
        {
            return Err(InitiativePursuitError::Bounds);
        }
        Ok(())
    }
    /// Correlate every outcome, including NoChange, to the exact admitted request.
    pub fn validate_against(
        &self,
        request: &InitiativePursuitRequestV1,
    ) -> Result<(), InitiativePursuitError> {
        self.validate()?;
        request.validate()?;
        if self.job_id != request.job_id
            || self.owner_pubkey != request.owner_pubkey
            || self.resident_pubkey != request.resident_pubkey
            || self.thread_id != request.thread.thread_id
            || self.expected_revision != request.thread.revision
            || self.canonical_revision_ref != request.thread.canonical_revision_ref
            || self.binding_ref != request.binding_ref
            || self.session_epoch != request.session_epoch
            || self.context_ref != request.context_ref()?
        {
            return Err(InitiativePursuitError::Binding);
        }
        match &self.result {
            InitiativePursuitOutcomeV1::Created { source_refs, .. }
            | InitiativePursuitOutcomeV1::OwnInquiry { source_refs, .. } => {
                if !source_refs.contains(&request.thread.canonical_revision_ref)
                    || source_refs.iter().any(|r| !request.contains_source_ref(r))
                {
                    return Err(InitiativePursuitError::Binding);
                }
            }
            InitiativePursuitOutcomeV1::Retire
                if request.semantic_thread.kind != InitiativeThreadKindV1::Own =>
            {
                return Err(InitiativePursuitError::Ineligible)
            }
            InitiativePursuitOutcomeV1::Defer { eligible_after }
                if eligible_after <= &request.admitted_at =>
            {
                return Err(InitiativePursuitError::Deadline)
            }
            _ => {}
        }
        if serde_json::to_vec(self)
            .map_err(|_| InitiativePursuitError::Bounds)?
            .len()
            > request.max_result_bytes.get() as usize
        {
            return Err(InitiativePursuitError::Bounds);
        }
        Ok(())
    }
    /// Recheck the original exclusive deadline before accepting authored data.
    pub fn validate_against_at(
        &self,
        request: &InitiativePursuitRequestV1,
        now_unix_ms: u64,
    ) -> Result<(), InitiativePursuitError> {
        self.validate_against(request)?;
        request.validate_for_transport_at(now_unix_ms)
    }
}
impl std::fmt::Debug for InitiativePursuitResultV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InitiativePursuitResultV1")
            .field("job_id", &self.job_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("result", &self.result)
            .finish_non_exhaustive()
    }
}
fn context_error(error: crate::InitiativePlanningError) -> InitiativePursuitError {
    match error {
        crate::InitiativePlanningError::Protocol => InitiativePursuitError::Protocol,
        crate::InitiativePlanningError::Binding => InitiativePursuitError::Binding,
        crate::InitiativePlanningError::Bounds => InitiativePursuitError::Bounds,
        crate::InitiativePlanningError::Deadline => InitiativePursuitError::Deadline,
        crate::InitiativePlanningError::Ineligible => InitiativePursuitError::Ineligible,
    }
}

/// Narrow control on the inherited private socket, never model/public-chat input.
/// A receiver must additionally match the exact currently admitted initiative
/// request; this frame alone is not authority to cancel any other work.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResidentPrivateCognitionControlV1 {
    /// Request cancellation of one owned initiative planning/authorship turn.
    CancelInitiative {
        /// Exact current initiative job, not a public conversation/dispatch ID.
        job_id: OpaqueId,
        /// Exact chosen resident bound to the inherited channel.
        resident_pubkey: Hex64,
        /// Exact current channel runtime binding.
        binding_ref: Sha256Ref,
        /// Exact current channel epoch.
        session_epoch: SafeU53,
    },
}
impl ResidentPrivateCognitionControlV1 {
    /// Correlate cancellation only to an initiative request, never legacy cognition.
    pub fn matches_initiative(&self, request: &crate::ResidentPrivateCognitionRequestV1) -> bool {
        let epoch = match request {
            crate::ResidentPrivateCognitionRequestV1::InitiativePlanning { request } => {
                request.session_epoch
            }
            crate::ResidentPrivateCognitionRequestV1::InitiativePursuit { request } => {
                request.session_epoch
            }
            _ => return false,
        };
        match self {
            Self::CancelInitiative {
                job_id,
                resident_pubkey,
                binding_ref,
                session_epoch,
            } => {
                session_epoch.get() != 0
                    && *session_epoch == epoch
                    && job_id == request.job_id()
                    && resident_pubkey == request.resident_pubkey()
                    && binding_ref == request.binding_ref()
            }
        }
    }
}

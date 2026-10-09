//! Explicit-call bounded private execution. No timer, model at init or publication.
//! The parent implements the held-head/dependency/policy barriers below; there
//! is deliberately no check-then-send fallback or model wait inside those locks.

use super::creations::{self, InitiativeCreationModeV1, InitiativeCreationReceiptV1};
use super::{driver::*, store::InitiativeStore, types::*};
use crate::luca::{artifacts::ArtifactStore, managed_cognition, resident_notebook::InitiativeThreadCommitReceiptV1};
use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, InitiativePlanningRequestV1, InitiativePlanningResultV1,
    InitiativePursuitOutcomeV1, InitiativePursuitRequestV1, InitiativePursuitResultV1, OpaqueId,
    ResidentPrivateCognitionResultV1, SafeU53, Sha256Ref, INITIATIVE_PURSUIT_PROTOCOL,
    MAX_INITIATIVE_PURSUIT_DURATION_MS,
};

/// Body-free fail-soft execution error. Unknown admission must remain charged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum InitiativeExecutorErrorV1 {
    Driver(InitiativeDriverErrorV1),
    Ledger(InitiativeStoreErrorV1),
    Unavailable,
    Invalid,
    Busy,
    Creation,
}
impl From<InitiativeDriverErrorV1> for InitiativeExecutorErrorV1 {
    fn from(e: InitiativeDriverErrorV1) -> Self {
        Self::Driver(e)
    }
}
impl From<InitiativeStoreErrorV1> for InitiativeExecutorErrorV1 {
    fn from(e: InitiativeStoreErrorV1) -> Self {
        Self::Ledger(e)
    }
}

/// A narrow injected endpoint, implemented by the existing private native channel.
pub(crate) trait InitiativePrivateEndpointV1 {
    type Claim: InitiativePrivateClaimV1;
    fn begin_planning(
        &self,
        request: &InitiativePlanningRequestV1,
        epoch: SafeU53,
    ) -> Result<Self::Claim, InitiativeExecutorErrorV1>;
    fn begin_pursuit(
        &self,
        request: &InitiativePursuitRequestV1,
        epoch: SafeU53,
    ) -> Result<Self::Claim, InitiativeExecutorErrorV1>;
}
/// The only potentially long method is wait, called after every authority lease ends.
pub(crate) trait InitiativePrivateClaimV1 {
    type Cancellation: Clone;
    fn cancellation(&self) -> Self::Cancellation;
    fn wait(self) -> Result<ResidentPrivateCognitionResultV1, InitiativeExecutorErrorV1>;
}
/// Real channel implementation: no second runtime/client, generic tools or defaults.
pub(crate) struct ManagedInitiativeEndpointV1;
impl InitiativePrivateEndpointV1 for ManagedInitiativeEndpointV1 {
    type Claim = managed_cognition::ManagedInitiativeAdmission;
    fn begin_planning(
        &self,
        r: &InitiativePlanningRequestV1,
        e: SafeU53,
    ) -> Result<Self::Claim, InitiativeExecutorErrorV1> {
        managed_cognition::begin_initiative_planning(r, e).map_err(cognition_error)
    }
    fn begin_pursuit(
        &self,
        r: &InitiativePursuitRequestV1,
        e: SafeU53,
    ) -> Result<Self::Claim, InitiativeExecutorErrorV1> {
        managed_cognition::begin_initiative_pursuit(r, e).map_err(cognition_error)
    }
}
impl InitiativePrivateClaimV1 for managed_cognition::ManagedInitiativeAdmission {
    type Cancellation = managed_cognition::ManagedInitiativeCancellation;
    fn cancellation(&self) -> Self::Cancellation {
        managed_cognition::ManagedInitiativeAdmission::cancellation(self)
    }
    fn wait(self) -> Result<ResidentPrivateCognitionResultV1, InitiativeExecutorErrorV1> {
        managed_cognition::ManagedInitiativeAdmission::wait(self).map_err(cognition_error)
    }
}
fn cognition_error(error: managed_cognition::ManagedCognitionError) -> InitiativeExecutorErrorV1 {
    match error {
        managed_cognition::ManagedCognitionError::Busy => InitiativeExecutorErrorV1::Busy,
        managed_cognition::ManagedCognitionError::Invalid => InitiativeExecutorErrorV1::Invalid,
        _ => InitiativeExecutorErrorV1::Unavailable,
    }
}

/// Parent-owned current-head/context/policy barriers and cancellation registry.
/// Each synchronous callback must run under the live identity, exact canonical
/// head and all current dependency/egress guards, not after a snapshot is released.
/// Borrow store/artifact authority in the prescribed order; never await a model.
pub(crate) trait InitiativeExecutionHostV1<C: Clone> {
    fn current_scope(&self) -> Result<InitiativeRuntimeScopeV1, InitiativeExecutorErrorV1>;
    fn with_current<T>(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        prepared: &PreparedInitiativePlanningV1,
        effect: impl FnOnce(
            &mut InitiativeStore,
            &CurrentInitiativeAdmissionV1,
        ) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1>;
    /// Validate ALL canonical dependencies even if new evidence is empty. Derived
    /// mode registers the prospective Promoted node before artifact bytes under
    /// with_promotion_lease. Canonical mode requires explicit authorship/artifact
    /// authority and proof there are no source-derived parents; no fake observation.
    fn with_creation<T>(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        prepared: &PreparedInitiativePlanningV1,
        work: &VerifiedInitiativePursuitV1,
        effect: impl FnOnce(
            &mut InitiativeStore,
            &mut ArtifactStore,
            InitiativeCreationModeV1,
        ) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1>;
    /// Commit one sealed native-authored Own inquiry through the existing
    /// encrypted canonical writer under current parent/policy/runtime guards.
    /// No generic semantic write, artifact, journal or notification authority.
    fn with_own_inquiry<T>(
        &self, scope: &InitiativeRuntimeScopeV1, prepared: &PreparedInitiativePlanningV1,
        work: &VerifiedInitiativePursuitV1,
        effect: impl FnOnce(&mut InitiativeStore, InitiativeThreadCommitReceiptV1) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1>;
    /// Install this exact owned job's cancellation handle BEFORE releasing frame authority.
    fn track_cancellation(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        job: &OpaqueId,
        cancel: C,
    ) -> Result<(), InitiativeExecutorErrorV1>;
    fn clear_cancellation(&self, scope: &InitiativeRuntimeScopeV1, job: &OpaqueId);
    /// Exact-job narrowing only, without model/continuity locks or D0 task lookups.
    fn interrupt(&self, scope: &InitiativeControlScopeV1, job: &OpaqueId);
}

/// Native-channel-correlated completed authored result. No serde/Debug or public
/// constructor: an artifact helper cannot accept a renderer's claimed authorship.
pub(crate) struct VerifiedInitiativePursuitV1 {
    request: InitiativePursuitRequestV1,
    result: InitiativePursuitResultV1,
}
impl VerifiedInitiativePursuitV1 {
    pub(crate) fn request(&self) -> &InitiativePursuitRequestV1 {
        &self.request
    }
    pub(crate) fn result(&self) -> &InitiativePursuitResultV1 {
        &self.result
    }
    pub(crate) fn result_ref(&self) -> Result<Sha256Ref, InitiativeExecutorErrorV1> {
        hash_ref(&self.result)
    }
}

/// Quiet outcomes are complete valid choices, not a request to produce a gift.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum InitiativeExecutionOutcomeV1 {
    NoChange,
    Deferred,
    Declined,
    Retired,
    Creation(InitiativeCreationReceiptV1),
    OwnInquiry(InitiativeThreadCommitReceiptV1),
}

/// Execute ONLY an explicitly policy-enabled prepared cycle. Preparation is
/// separate and reuses driver capture_admission/prepare_planning. No constructor
/// or startup path calls this function. It never publishes, opens or notifies.
pub(crate) fn execute_prepared<E: InitiativePrivateEndpointV1>(
    host: &impl InitiativeExecutionHostV1<<E::Claim as InitiativePrivateClaimV1>::Cancellation>,
    endpoint: &E,
    prepared: PreparedInitiativePlanningV1,
) -> Result<InitiativeExecutionOutcomeV1, InitiativeExecutorErrorV1> {
    let scope = host.current_scope()?;
    let claim = match host.with_current(&scope, &prepared, |store, current| {
        admit_prepared(store, &scope, &prepared, current)?;
        let claim = endpoint.begin_planning(prepared.request(), scope.session_epoch)?;
        host.track_cancellation(&scope, prepared.job_id(), claim.cancellation())?;
        Ok(claim)
    }) {
        Ok(claim) => claim,
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    // Every identity/continuity/awareness/ledger lease has ended before wait.
    let planning = claim.wait();
    host.clear_cancellation(&scope, prepared.job_id());
    let planning = match planning {
        Ok(ResidentPrivateCognitionResultV1::InitiativePlanning { result }) => result,
        Ok(_) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(InitiativeExecutorErrorV1::Invalid);
        }
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    let scope = match host.current_scope() {
        Ok(current) => current,
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    let job = match host.with_current(&scope, &prepared, |store, current| {
        Ok(commit_planning(
            store, &scope, &prepared, &planning, current,
        )?)
    }) {
        Ok(job) => job,
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    match job.state {
        InitiativeJobStateV1::NoChange => return Ok(InitiativeExecutionOutcomeV1::NoChange),
        InitiativeJobStateV1::Deferred => return Ok(InitiativeExecutionOutcomeV1::Deferred),
        InitiativeJobStateV1::Declined => return Ok(InitiativeExecutionOutcomeV1::Declined),
        InitiativeJobStateV1::Ready => {}
        _ => return Err(InitiativeExecutorErrorV1::Invalid),
    }
    execute_pursuit(host, endpoint, prepared)
}

fn execute_pursuit<E: InitiativePrivateEndpointV1>(
    host: &impl InitiativeExecutionHostV1<<E::Claim as InitiativePrivateClaimV1>::Cancellation>,
    endpoint: &E,
    prepared: PreparedInitiativePlanningV1,
) -> Result<InitiativeExecutionOutcomeV1, InitiativeExecutorErrorV1> {
    let scope = host.current_scope()?;
    let (request, claim) = match host.with_current(&scope, &prepared, |store, current| {
        let job = store
            .job(&scope.control, prepared.job_id())?
            .ok_or(InitiativeExecutorErrorV1::Invalid)?;
        let request = pursuit_request(store, &scope, &prepared, current, &job)?;
        store.claim_private_pursuit(&scope, &request)?;
        let claim = endpoint.begin_pursuit(&request, scope.session_epoch)?;
        store.mark_private_framed(&scope, &request)?;
        host.track_cancellation(&scope, prepared.job_id(), claim.cancellation())?;
        Ok((request, claim))
    }) {
        Ok(pair) => pair,
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    let response = claim.wait();
    host.clear_cancellation(&scope, prepared.job_id());
    let result = match response {
        Ok(ResidentPrivateCognitionResultV1::InitiativePursuit { result }) => result,
        Ok(_) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(InitiativeExecutorErrorV1::Invalid);
        }
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    let scope = match host.current_scope() {
        Ok(current) => current,
        Err(error) => {
            host.interrupt(&scope.control, prepared.job_id());
            return Err(error);
        }
    };
    if result
        .validate_against_at(&request, scope.control.now_unix_ms)
        .is_err()
    {
        host.interrupt(&scope.control, prepared.job_id());
        return Err(InitiativeExecutorErrorV1::Invalid);
    }
    let work = VerifiedInitiativePursuitV1 { request, result };
    let commit = if matches!(
        &work.result.result,
        InitiativePursuitOutcomeV1::Created { .. }
    ) {
        host.with_creation(&scope, &prepared, &work, |store, artifacts, mode| {
            // Promotion/current heads remain fenced through both local commits.
            let receipt = creations::persist_creation(artifacts, &scope, &work, mode)
                .map_err(|_| InitiativeExecutorErrorV1::Creation)?;
            store.commit_private_pursuit(
                &scope,
                &work.request,
                &work.result,
                Some((&receipt.dependency_node, &receipt.artifact_ref)),
            )?;
            Ok(InitiativeExecutionOutcomeV1::Creation(receipt))
        })
    } else if matches!(&work.result.result, InitiativePursuitOutcomeV1::OwnInquiry { .. }) {
        host.with_own_inquiry(&scope, &prepared, &work, |store, receipt| {
            store.commit_private_own_inquiry(&scope, &work.request, &work.result, &receipt)?;
            Ok(InitiativeExecutionOutcomeV1::OwnInquiry(receipt))
        })
    } else {
        host.with_current(&scope, &prepared, |store, _| {
            store.commit_private_pursuit(&scope, &work.request, &work.result, None)?;
            Ok(match work.result.result {
                InitiativePursuitOutcomeV1::NoChange => InitiativeExecutionOutcomeV1::NoChange,
                InitiativePursuitOutcomeV1::Defer { .. } => InitiativeExecutionOutcomeV1::Deferred,
                InitiativePursuitOutcomeV1::Decline => InitiativeExecutionOutcomeV1::Declined,
                InitiativePursuitOutcomeV1::Retire => InitiativeExecutionOutcomeV1::Retired,
                _ => return Err(InitiativeExecutorErrorV1::Invalid),
            })
        })
    };
    if commit.is_err() {
        host.interrupt(&scope.control, prepared.job_id());
    }
    // Canonical disposition CAS for a defer/decline is a separate existing I1
    // parent consumer. Never acquire its write lock inside this held-head read.
    commit
}

fn pursuit_request(
    store: &InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    prepared: &PreparedInitiativePlanningV1,
    current: &CurrentInitiativeAdmissionV1,
    job: &InitiativeJobV1,
) -> Result<InitiativePursuitRequestV1, InitiativeExecutorErrorV1> {
    let thread = store
        .thread(&scope.control, &job.input.thread_id)?
        .ok_or(InitiativeExecutorErrorV1::Invalid)?;
    let mut deadline = scope
        .control
        .now_unix_ms
        .checked_add(
            job.input
                .budget
                .work_ms
                .min(MAX_INITIATIVE_PURSUIT_DURATION_MS),
        )
        .map(|n| n.min(job.input.deadline_unix_ms)
            .min((scope.control.now_unix_ms / 1000 * 1000).saturating_add(MAX_INITIATIVE_PURSUIT_DURATION_MS)))
        .ok_or(InitiativeExecutorErrorV1::Invalid)?;
    for evidence in &prepared.request().evidence {
        let expires =
            chrono::DateTime::parse_from_rfc3339(evidence.observation.expires_at.as_str())
                .ok()
                .and_then(|n| u64::try_from(n.timestamp_millis()).ok())
                .ok_or(InitiativeExecutorErrorV1::Invalid)?;
        deadline = deadline.min(expires);
    }
    let now = i64::try_from(scope.control.now_unix_ms)
        .ok()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .ok_or(InitiativeExecutorErrorV1::Invalid)?;
    let request = InitiativePursuitRequestV1 {
        protocol: INITIATIVE_PURSUIT_PROTOCOL.into(),
        job_id: job.input.job_id.clone(),
        owner_pubkey: scope.control.owner_pubkey.clone(),
        resident_pubkey: scope.control.resident_pubkey.clone(),
        binding_ref: scope.binding_ref.clone(),
        session_epoch: scope.session_epoch,
        thread,
        semantic_thread: current.semantic().clone(),
        evidence: prepared.request().evidence.clone(),
        admitted_at: CanonicalTimestamp::parse(
            now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
        .map_err(|_| InitiativeExecutorErrorV1::Invalid)?,
        deadline_unix_ms: SafeU53::new(deadline).map_err(|_| InitiativeExecutorErrorV1::Invalid)?,
        max_result_bytes: SafeU53::new(24 * 1024)
            .map_err(|_| InitiativeExecutorErrorV1::Invalid)?,
    };
    request
        .validate_for_transport_at(scope.control.now_unix_ms)
        .map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Ok(request)
}
fn hash_ref(value: &impl serde::Serialize) -> Result<Sha256Ref, InitiativeExecutorErrorV1> {
    let digest = canonical_sha256(value).map_err(|_| InitiativeExecutorErrorV1::Invalid)?;
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_| InitiativeExecutorErrorV1::Invalid)
}

/// Synthetic completed private result only for source/sentinel tests. Production
/// sealing occurs solely after the owned private endpoint's exact matched wait.
#[cfg(test)]
pub(crate) fn verified_work_fixture(request: InitiativePursuitRequestV1, result: InitiativePursuitResultV1, now: u64) -> VerifiedInitiativePursuitV1 {
    result.validate_against_at(&request, now).expect("matched synthetic private completion");
    VerifiedInitiativePursuitV1 { request, result }
}

#[cfg(test)]
#[path = "executor_tests.rs"]
pub(crate) mod tests;

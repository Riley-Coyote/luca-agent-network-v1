//! Preparation/admission/commit only; no timer, fanout, worker or model at init.
//! There is intentionally no production planning executor until the parent
//! provides short final transport admission followed by an unlocked model wait.
use super::{store::InitiativeStore, types::*};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{LiveAwarenessLease, LiveAwarenessOwner},
        continuity_revision_authority::RevisionAuthorityTokenV1,
        managed_cognition,
        resident_notebook::{InitiativeThreadReadSnapshotV1, InitiativeThreadRevisionViewV1},
    },
};
use luca_protocol::{
    derive_initiative_thread_ref, CanonicalTimestamp, InitiativeDispositionV1,
    InitiativePlanningEvidenceV1, InitiativePlanningRequestV1, InitiativePlanningResultV1,
    InitiativeSemanticThreadV1, InitiativeThreadV1, InitiativeTransitionCauseV1, OpaqueId, SafeU53,
    Sha256Ref, INITIATIVE_PLANNING_PROTOCOL, INITIATIVE_PROTOCOL, MAX_INITIATIVE_PLANNING_DURATION_MS,
};

/// Frozen balanced default: foreground conversation and recent activity win.
pub(crate) const INITIATIVE_MIN_IDLE_MS: u64 = 15 * 60 * 1000;
/// Conservative persisted-attempt cadence; never catch up missed timer ticks.
pub(crate) const INITIATIVE_CADENCE_MS: u64 = 4 * 60 * 60 * 1000;

/// Body-free fail-soft coordinator outcome, never a claim that a native task stopped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InitiativeDriverErrorV1 {
    Unavailable,
    Scope,
    Stale,
    Evidence,
    Budget,
    Ledger(InitiativeStoreErrorV1),
}
impl From<InitiativeStoreErrorV1> for InitiativeDriverErrorV1 {
    fn from(error: InitiativeStoreErrorV1) -> Self {
        Self::Ledger(error)
    }
}

/// Quiet is normal: disabled, idle/not-due, closed or unavailable sources create no work.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InitiativeQuietReasonV1 {
    Disabled,
    RecentActivity,
    Cadence,
    Deferred,
    Closed,
    StaleCanonical,
    Unavailable,
}

/// Private current admission data. Not serde, Debug, a grant or reusable capability.
pub(crate) struct CurrentInitiativeAdmissionV1 {
    owner: luca_protocol::Hex64,
    window_id: OpaqueId,
    origin_scope_ref: Sha256Ref,
    captured_unix_ms: u64,
    binding_ref: Sha256Ref,
    session_epoch: SafeU53,
    authority: RevisionAuthorityTokenV1,
    head_record_id: OpaqueId,
    semantic: InitiativeSemanticThreadV1,
    dependency_ref: Sha256Ref,
}

impl CurrentInitiativeAdmissionV1 {
    /// Compile only inside consume_current_resident_initiative_thread's held
    /// lifecycle callback. The identity lease is real current authority; the
    /// snapshot token is correlation, never a reusable permission capability.
    pub(crate) fn from_held_thread(
        lease: &LiveAwarenessLease<'_>,
        scope: &InitiativeRuntimeScopeV1,
        token: &RevisionAuthorityTokenV1,
        view: &InitiativeThreadRevisionViewV1,
        expected_record: &OpaqueId,
        expected_semantic_ref: &Sha256Ref,
        dependency_ref: Sha256Ref,
    ) -> Result<Self, InitiativeDriverErrorV1> {
        if lease.owner() != &scope.control.owner_pubkey
            || token.owner_pubkey != scope.control.owner_pubkey
            || view.thread.owner_pubkey != scope.control.owner_pubkey
            || view.thread.resident_pubkey != scope.control.resident_pubkey
            || !view.is_current
            || view.current_head_record_id.as_ref() != Some(&view.record_id)
            || &view.record_id != expected_record
            || &view.canonical_revision_ref != expected_semantic_ref
            || view
                .thread
                .revision_ref()
                .map_err(|_| InitiativeDriverErrorV1::Stale)?
                != *expected_semantic_ref
        {
            return Err(InitiativeDriverErrorV1::Scope);
        }
        view.thread
            .validate()
            .map_err(|_| InitiativeDriverErrorV1::Stale)?;
        let binding_ref = managed_cognition::active_binding_ref(&scope.control.resident_pubkey)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        let session_epoch = managed_cognition::active_session_epoch(&scope.control.resident_pubkey)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        if binding_ref != scope.binding_ref || session_epoch != scope.session_epoch {
            return Err(InitiativeDriverErrorV1::Stale);
        }
        Ok(Self {
            owner: lease.owner().clone(),
            window_id: scope.control.window_id.clone(),
            origin_scope_ref: scope.control.origin_scope_ref.clone(),
            captured_unix_ms: scope.control.now_unix_ms,
            binding_ref,
            session_epoch,
            authority: token.clone(),
            head_record_id: view.record_id.clone(),
            semantic: view.thread.clone(),
            dependency_ref,
        })
    }
    /// Borrow the exact held/captured semantic body; never an authorization grant.
    pub(crate) fn semantic(&self) -> &InitiativeSemanticThreadV1 {
        &self.semantic
    }
    /// Current body-free dependency coordinate, never reusable admission.
    pub(crate) fn dependency_ref(&self) -> &Sha256Ref { &self.dependency_ref }

    #[cfg(test)]
    pub(super) fn synthetic(
        scope: &InitiativeRuntimeScopeV1,
        semantic: InitiativeSemanticThreadV1,
        dependency_ref: Sha256Ref,
    ) -> Self {
        Self {
            owner: scope.control.owner_pubkey.clone(),
            window_id: scope.control.window_id.clone(),
            origin_scope_ref: scope.control.origin_scope_ref.clone(),
            captured_unix_ms: scope.control.now_unix_ms,
            binding_ref: scope.binding_ref.clone(),
            session_epoch: scope.session_epoch,
            authority: RevisionAuthorityTokenV1 {
                owner_pubkey: scope.control.owner_pubkey.clone(),
                store_epoch: "synthetic-executor".into(),
                generation: SafeU53::new(1).expect("fixture generation"),
                authority_schema: 1,
                active_root_key_version: SafeU53::new(1).expect("fixture version"),
                snapshot_fingerprint: dependency_ref.clone(),
            },
            head_record_id: semantic.thread_id.clone(),
            semantic,
            dependency_ref,
        }
    }
}

/// A synchronous short read/recheck seam. Production implementations authenticate
/// live owner, read exact encrypted current heads and native epoch/binding, and
/// validate all semantic/evidence dependencies and provider egress. No model wait.
pub(crate) trait InitiativeAdmissionHostV1 {
    fn current(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        thread_id: &OpaqueId,
        evidence: &[InitiativePlanningEvidenceV1],
        dependency_node: Option<&OpaqueId>,
    ) -> Result<CurrentInitiativeAdmissionV1, InitiativeDriverErrorV1>;
}

/// Production short-check callback must recheck raw/promoted dependencies and
/// provider egress for canonical content even when new evidence is empty.
pub(crate) type InitiativeContextCheckV1<'a> = dyn Fn(
        &LiveAwarenessOwner<'_>,
        &InitiativeRuntimeScopeV1,
        &InitiativeSemanticThreadV1,
        &[InitiativePlanningEvidenceV1],
        Option<&OpaqueId>,
    ) -> Result<Sha256Ref, InitiativeDriverErrorV1>
    + 'a;

/// Existing AppState/managed channel sources, without any models or new identity.
pub(crate) struct DesktopInitiativeAdmissionHostV1<'a> {
    pub state: &'a AppState,
    pub check_context: &'a InitiativeContextCheckV1<'a>,
}
impl InitiativeAdmissionHostV1 for DesktopInitiativeAdmissionHostV1<'_> {
    fn current(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        thread_id: &OpaqueId,
        evidence: &[InitiativePlanningEvidenceV1],
        dependency_node: Option<&OpaqueId>,
    ) -> Result<CurrentInitiativeAdmissionV1, InitiativeDriverErrorV1> {
        let live = LiveAwarenessOwner::authenticate(self.state)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        if live.owner() != &scope.control.owner_pubkey {
            return Err(InitiativeDriverErrorV1::Scope);
        }
        let snapshot = self
            .state
            .read_resident_initiative_threads(
                &scope.control.owner_pubkey,
                &scope.control.resident_pubkey,
                false,
            )
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?
            .ok_or(InitiativeDriverErrorV1::Unavailable)?;
        let (authority, head, semantic) = exact_current_head(snapshot, scope, thread_id)?;
        let binding_ref = managed_cognition::active_binding_ref(&scope.control.resident_pubkey)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        let session_epoch = managed_cognition::active_session_epoch(&scope.control.resident_pubkey)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        if binding_ref != scope.binding_ref || session_epoch != scope.session_epoch {
            return Err(InitiativeDriverErrorV1::Stale);
        }
        // All continuity locks have been released by the owned snapshot read.
        // This callback may briefly hold awareness authority, but must only
        // validate/serialize and return, never invoke or wait for cognition.
        let dependency_ref =
            (self.check_context)(&live, scope, &semantic, evidence, dependency_node)?;
        let fresh = LiveAwarenessOwner::authenticate(self.state)
            .map_err(|_| InitiativeDriverErrorV1::Unavailable)?;
        if fresh.owner() != live.owner() {
            return Err(InitiativeDriverErrorV1::Scope);
        }
        Ok(CurrentInitiativeAdmissionV1 {
            owner: fresh.owner().clone(),
            window_id: scope.control.window_id.clone(),
            origin_scope_ref: scope.control.origin_scope_ref.clone(),
            captured_unix_ms: scope.control.now_unix_ms,
            binding_ref,
            session_epoch,
            authority,
            head_record_id: head,
            semantic,
            dependency_ref,
        })
    }
}

/// Caller-owned metadata for one chosen target, not a model-selected resident or path.
pub(crate) struct InitiativeTickInputV1 {
    pub cycle: InitiativeCycleInputV1,
    pub idle_for_ms: u64,
    pub evidence: Vec<InitiativePlanningEvidenceV1>,
    pub dependency_node: Option<OpaqueId>,
}

/// Private prepared data; parent must not send it without fresh final admission.
/// Native work/artifact/publication are separate parent consumers, never effects here.
pub(crate) struct PreparedInitiativePlanningV1 {
    request: InitiativePlanningRequestV1,
    authority: RevisionAuthorityTokenV1,
    head_record_id: OpaqueId,
    dependency_node: Option<OpaqueId>,
    dependency_ref: Sha256Ref,
}
impl PreparedInitiativePlanningV1 {
    pub(crate) fn request(&self) -> &InitiativePlanningRequestV1 {
        &self.request
    }
    pub(crate) fn job_id(&self) -> &OpaqueId {
        &self.request.job_id
    }
    pub(crate) fn dependency_node(&self) -> Option<&OpaqueId> {
        self.dependency_node.as_ref()
    }
    /// Exact expected canonical record for the parent's held-head callback.
    pub(crate) fn expected_record(&self) -> &OpaqueId {
        &self.head_record_id
    }
    /// Current dependency digest, rechecked before framing and result commit.
    pub(crate) fn dependency_ref(&self) -> &Sha256Ref {
        &self.dependency_ref
    }
}

/// No implicit executor: Prepared is not an indication that cognition ran.
pub(crate) enum InitiativePreparationV1 {
    Quiet(InitiativeQuietReasonV1),
    PreemptionRequested(Vec<InitiativeOwnedCancellationV1>),
    Prepared(PreparedInitiativePlanningV1),
}

/// SQLite-only due check for controller callbacks. A due result is not authority.
pub(crate) fn inspect_tick(
    store: &mut InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    idle_for_ms: u64,
) -> Result<Option<InitiativeQuietReasonV1>, InitiativeDriverErrorV1> {
    let policy = store.policy(&scope.control)?;
    if !policy.enabled || policy.paused {
        return Ok(Some(InitiativeQuietReasonV1::Disabled));
    }
    if idle_for_ms < INITIATIVE_MIN_IDLE_MS {
        return Ok(Some(InitiativeQuietReasonV1::RecentActivity));
    }
    if store
        .latest_attempt_ms(&scope.control)?
        .is_some_and(|last| scope.control.now_unix_ms.saturating_sub(last) < INITIATIVE_CADENCE_MS)
    {
        return Ok(Some(InitiativeQuietReasonV1::Cadence));
    }
    Ok(None)
}

/// Capture current canonical/runtime/dependency facts outside ALL ledger locks.
/// Captured data alone is not final transport or commit admission.
pub(crate) fn capture_admission(
    host: &impl InitiativeAdmissionHostV1,
    scope: &InitiativeRuntimeScopeV1,
    thread_id: &OpaqueId,
    evidence: &[InitiativePlanningEvidenceV1],
    dependency_node: Option<&OpaqueId>,
) -> Result<CurrentInitiativeAdmissionV1, InitiativeDriverErrorV1> {
    if !evidence.is_empty() && dependency_node.is_none() {
        return Err(InitiativeDriverErrorV1::Evidence);
    }
    host.current(scope, thread_id, evidence, dependency_node)
}

/// Disabled-by-default preparation for one exact resident and canonical thread.
/// Failure affects initiative only; callers keep ordinary sending/streaming alive.
pub(crate) fn prepare_planning(
    store: &mut InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    input: InitiativeTickInputV1,
    current: CurrentInitiativeAdmissionV1,
) -> Result<InitiativePreparationV1, InitiativeDriverErrorV1> {
    if scope.foreground_active {
        return Ok(InitiativePreparationV1::PreemptionRequested(
            store.cancel_owned(&scope.control)?,
        ));
    }
    if let Some(quiet) = inspect_tick(store, scope, input.idle_for_ms)? {
        return Ok(InitiativePreparationV1::Quiet(quiet));
    }
    if !input.evidence.is_empty() && input.dependency_node.is_none() {
        return Err(InitiativeDriverErrorV1::Evidence);
    }
    verify_current(
        &current,
        scope,
        &input.cycle.thread_id,
        &input.cycle.dependency_ref,
    )?;
    if !semantic_eligible(&current.semantic, scope)? {
        let quiet = if current.semantic.disposition == InitiativeDispositionV1::Deferred {
            InitiativeQuietReasonV1::Deferred
        } else {
            InitiativeQuietReasonV1::Closed
        };
        return Ok(InitiativePreparationV1::Quiet(quiet));
    }
    let semantic_ref = current
        .semantic
        .revision_ref()
        .map_err(|_| InitiativeDriverErrorV1::Stale)?;
    let canonical_ref = derive_initiative_thread_ref(
        &scope.control.owner_pubkey,
        &scope.control.resident_pubkey,
        &current.semantic.thread_id,
    )
    .map_err(|_| InitiativeDriverErrorV1::Scope)?;
    let thread = match store.thread(&scope.control, &current.semantic.thread_id)? {
        Some(thread) => thread,
        None => {
            let thread = InitiativeThreadV1 {
                protocol: INITIATIVE_PROTOCOL.into(),
                thread_id: current.semantic.thread_id.clone(),
                owner_pubkey: scope.control.owner_pubkey.clone(),
                resident_pubkey: scope.control.resident_pubkey.clone(),
                kind: current.semantic.kind,
                disposition: current.semantic.disposition,
                revision: SafeU53::new(1).map_err(|_| InitiativeDriverErrorV1::Stale)?,
                canonical_thread_ref: canonical_ref.clone(),
                canonical_revision_ref: semantic_ref.clone(),
                source_refs: current.semantic.source_refs.clone(),
                checkpoint_ref: None,
                eligible_after: current.semantic.eligible_after.clone(),
                updated_at: canonical_now(scope)?,
            };
            let facts = InitiativeCanonicalFactsV1 {
                owner_pubkey: thread.owner_pubkey.clone(),
                resident_pubkey: thread.resident_pubkey.clone(),
                thread_id: thread.thread_id.clone(),
                kind: thread.kind,
                canonical_thread_ref: canonical_ref.clone(),
                canonical_revision_ref: semantic_ref.clone(),
            };
            let sync = OpaqueId::parse(format!(
                "sync-{}",
                luca_protocol::canonical_sha256(&(
                    "initiative-sync",
                    &thread.thread_id,
                    &semantic_ref
                ))
                .map_err(|_| InitiativeDriverErrorV1::Stale)?
            ))
            .map_err(|_| InitiativeDriverErrorV1::Stale)?;
            store.cas_thread(
                &scope.control,
                &sync,
                None,
                thread,
                &facts,
                &InitiativeTransitionCauseV1::NewObservation,
            )?
        }
    };
    // A passive tick never silently rewrites a newer or explicitly closed
    // operational projection. Canonical sync/reopen is an explicit parent seam.
    if thread.canonical_revision_ref != semantic_ref || thread.canonical_thread_ref != canonical_ref
    {
        return Ok(InitiativePreparationV1::Quiet(
            InitiativeQuietReasonV1::StaleCanonical,
        ));
    }
    if !matches!(
        thread.disposition,
        InitiativeDispositionV1::Carried | InitiativeDispositionV1::Deferred
    ) {
        return Ok(InitiativePreparationV1::Quiet(
            InitiativeQuietReasonV1::Closed,
        ));
    }
    let now = canonical_now(scope)?;
    if thread
        .eligible_after
        .as_ref()
        .is_some_and(|after| &now < after)
    {
        return Ok(InitiativePreparationV1::Quiet(
            InitiativeQuietReasonV1::Deferred,
        ));
    }
    if input.cycle.expected_thread_revision != thread.revision
        || input.cycle.canonical_revision_ref != semantic_ref
        || input.cycle.budget.decision_ms == 0
    {
        return Err(InitiativeDriverErrorV1::Stale);
    }
    let deadline = scope
        .control
        .now_unix_ms
        .checked_add(input.cycle.budget.decision_ms)
        .map(|deadline| deadline.min(input.cycle.deadline_unix_ms)
            // Canonical timestamps have whole-second precision. Never make a
            // maximum-length request exceed its frozen interval by a fraction.
            .min((scope.control.now_unix_ms / 1000 * 1000).saturating_add(MAX_INITIATIVE_PLANNING_DURATION_MS)))
        .ok_or(InitiativeDriverErrorV1::Budget)?;
    let request = InitiativePlanningRequestV1 {
        protocol: INITIATIVE_PLANNING_PROTOCOL.into(),
        job_id: input.cycle.job_id.clone(),
        owner_pubkey: scope.control.owner_pubkey.clone(),
        resident_pubkey: scope.control.resident_pubkey.clone(),
        binding_ref: current.binding_ref.clone(),
        session_epoch: current.session_epoch,
        thread,
        semantic_thread: current.semantic,
        evidence: input.evidence,
        admitted_at: canonical_now(scope)?,
        deadline_unix_ms: SafeU53::new(deadline).map_err(|_| InitiativeDriverErrorV1::Budget)?,
        max_result_bytes: SafeU53::new(4096).map_err(|_| InitiativeDriverErrorV1::Budget)?,
    };
    request
        .validate_for_transport_at(scope.control.now_unix_ms)
        .map_err(|_| InitiativeDriverErrorV1::Evidence)?;
    store.reserve_cycle(scope, input.cycle.clone(), None)?;
    Ok(InitiativePreparationV1::Prepared(
        PreparedInitiativePlanningV1 {
            request,
            authority: current.authority,
            head_record_id: current.head_record_id,
            dependency_node: input.dependency_node,
            dependency_ref: input.cycle.dependency_ref,
        },
    ))
}

/// Fresh short checks and one durable claim only. This does NOT transport or
/// authorize an unlocked later call; parent must fence actual frame writing.
pub(crate) fn admit_prepared(
    store: &mut InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    prepared: &PreparedInitiativePlanningV1,
    current: &CurrentInitiativeAdmissionV1,
) -> Result<InitiativeJobV1, InitiativeDriverErrorV1> {
    recheck_prepared(current, scope, prepared)?;
    Ok(store.claim_planning(scope, prepared.job_id())?)
}

/// Commit only a typed, completed result after fresh current-head/dependency checks.
/// No mutation/pursuit/signing follows automatically; deferred/declined/no-change are valid.
pub(crate) fn commit_planning(
    store: &mut InitiativeStore,
    scope: &InitiativeRuntimeScopeV1,
    prepared: &PreparedInitiativePlanningV1,
    result: &InitiativePlanningResultV1,
    current: &CurrentInitiativeAdmissionV1,
) -> Result<InitiativeJobV1, InitiativeDriverErrorV1> {
    recheck_prepared(current, scope, prepared)?;
    result
        .validate_against_at(&prepared.request, scope.control.now_unix_ms)
        .map_err(|_| InitiativeDriverErrorV1::Stale)?;
    Ok(store.apply_decision(scope, prepared.job_id(), &result.decision)?)
}

/// User/foreground priority returns actual owned intent refs, never "stopped".
pub(crate) fn preempt_owned(
    store: &mut InitiativeStore,
    scope: &InitiativeControlScopeV1,
) -> Result<Vec<InitiativeOwnedCancellationV1>, InitiativeDriverErrorV1> {
    Ok(store.cancel_owned(scope)?)
}

/// Startup/restart retains uncertainty/keys only. Parent reconciles exact native
/// receipts and explicitly authorizes continuation; no catch-up or blind replay.
pub(crate) fn recover_owned(
    store: &mut InitiativeStore,
    scope: &InitiativeControlScopeV1,
) -> Result<Vec<InitiativeJobV1>, InitiativeDriverErrorV1> {
    Ok(store.recover(scope)?)
}

fn recheck_prepared(
    current: &CurrentInitiativeAdmissionV1,
    scope: &InitiativeRuntimeScopeV1,
    prepared: &PreparedInitiativePlanningV1,
) -> Result<(), InitiativeDriverErrorV1> {
    verify_current(
        current,
        scope,
        &prepared.request.thread.thread_id,
        &prepared.dependency_ref,
    )?;
    if current.authority != prepared.authority
        || current.head_record_id != prepared.head_record_id
        || current
            .semantic
            .revision_ref()
            .map_err(|_| InitiativeDriverErrorV1::Stale)?
            != prepared.request.thread.canonical_revision_ref
        || !semantic_eligible(&current.semantic, scope)?
    {
        return Err(InitiativeDriverErrorV1::Stale);
    }
    prepared
        .request
        .validate_for_transport_at(scope.control.now_unix_ms)
        .map_err(|_| InitiativeDriverErrorV1::Stale)
}
fn verify_current(
    current: &CurrentInitiativeAdmissionV1,
    scope: &InitiativeRuntimeScopeV1,
    thread: &OpaqueId,
    dependency: &Sha256Ref,
) -> Result<(), InitiativeDriverErrorV1> {
    if current.owner != scope.control.owner_pubkey
        || current.semantic.owner_pubkey != scope.control.owner_pubkey
        || current.window_id != scope.control.window_id
        || current.origin_scope_ref != scope.control.origin_scope_ref
        || current.captured_unix_ms != scope.control.now_unix_ms
        || current.semantic.resident_pubkey != scope.control.resident_pubkey
        || &current.semantic.thread_id != thread
        || current.authority.owner_pubkey != scope.control.owner_pubkey
        || current.binding_ref != scope.binding_ref
        || current.session_epoch != scope.session_epoch
        || &current.dependency_ref != dependency
    {
        Err(InitiativeDriverErrorV1::Scope)
    } else {
        Ok(())
    }
}
fn exact_current_head(
    snapshot: InitiativeThreadReadSnapshotV1,
    scope: &InitiativeRuntimeScopeV1,
    id: &OpaqueId,
) -> Result<
    (
        RevisionAuthorityTokenV1,
        OpaqueId,
        InitiativeSemanticThreadV1,
    ),
    InitiativeDriverErrorV1,
> {
    if snapshot.authority.owner_pubkey != scope.control.owner_pubkey {
        return Err(InitiativeDriverErrorV1::Scope);
    }
    let mut selected = snapshot
        .threads
        .into_iter()
        .filter(|view| &view.thread.thread_id == id);
    let view = selected
        .next()
        .ok_or(InitiativeDriverErrorV1::Unavailable)?;
    if selected.next().is_some()
        || !view.is_current
        || view.current_head_record_id.as_ref() != Some(&view.record_id)
        || view.thread.owner_pubkey != scope.control.owner_pubkey
        || view.thread.resident_pubkey != scope.control.resident_pubkey
    {
        return Err(InitiativeDriverErrorV1::Stale);
    }
    view.thread
        .validate()
        .map_err(|_| InitiativeDriverErrorV1::Stale)?;
    Ok((snapshot.authority, view.record_id, view.thread))
}
fn canonical_now(
    scope: &InitiativeRuntimeScopeV1,
) -> Result<CanonicalTimestamp, InitiativeDriverErrorV1> {
    let millis =
        i64::try_from(scope.control.now_unix_ms).map_err(|_| InitiativeDriverErrorV1::Scope)?;
    let time =
        chrono::DateTime::from_timestamp_millis(millis).ok_or(InitiativeDriverErrorV1::Scope)?;
    CanonicalTimestamp::parse(time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| InitiativeDriverErrorV1::Scope)
}
fn semantic_eligible(
    thread: &InitiativeSemanticThreadV1,
    scope: &InitiativeRuntimeScopeV1,
) -> Result<bool, InitiativeDriverErrorV1> {
    let now = canonical_now(scope)?;
    Ok(matches!(
        thread.disposition,
        InitiativeDispositionV1::Carried | InitiativeDispositionV1::Deferred
    ) && thread
        .eligible_after
        .as_ref()
        .is_none_or(|after| &now >= after)
        && thread.updated_at <= now)
}

#[cfg(test)]
#[path = "driver_tests.rs"]
mod tests;

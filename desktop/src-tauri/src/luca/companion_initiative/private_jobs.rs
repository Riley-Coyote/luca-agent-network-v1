//! Private tool-free authorship uses its own references, never fabricated D0 IDs.
use super::*;
use luca_protocol::{
    InitiativeDispositionV1, InitiativePursuitOutcomeV1, InitiativePursuitRequestV1,
    InitiativePursuitResultV1,
};
use crate::luca::resident_notebook::InitiativeThreadCommitReceiptV1;

impl InitiativeStore {
    /// Freeze an exact private work intent before bounded framing. This does
    /// not claim native acceptance and never refunds uncertain model admission.
    pub(crate) fn claim_private_pursuit(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        request: &InitiativePursuitRequestV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        request
            .validate_for_transport_at(scope.control.now_unix_ms)
            .map_err(|_| InitiativeStoreErrorV1::Stale)?;
        let context_ref = request
            .context_ref()
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        self.runtime_change(scope, &request.job_id, |_, job| {
            if job.state != InitiativeJobStateV1::Ready
                || job.decision.as_ref() != Some(&InitiativePlanningOutcomeV1::Pursue)
                || job.input.budget.work_ms == 0
                || job.native_task_id.is_some()
                || job.private_pursuit.is_some()
                || request.owner_pubkey != job.owner_pubkey
                || request.resident_pubkey != job.resident_pubkey
                || request.binding_ref != job.binding_ref
                || request.session_epoch != job.session_epoch
                || request.thread.thread_id != job.input.thread_id
                || request.thread.revision != job.current_thread_revision
                || request.thread.canonical_revision_ref != job.input.canonical_revision_ref
                || request.deadline_unix_ms.get() > job.input.deadline_unix_ms
                || scope
                    .control
                    .now_unix_ms
                    .checked_add(job.input.budget.work_ms)
                    .is_none_or(|maximum| request.deadline_unix_ms.get() > maximum)
            {
                return Err(InitiativeStoreErrorV1::Stale);
            }
            job.private_pursuit = Some(InitiativePrivatePursuitV1 {
                context_ref,
                reserved_unix_ms: scope.control.now_unix_ms,
                framed_unix_ms: None,
                completed_unix_ms: None,
                result_ref: None,
                creation_node: None,
                artifact_ref: None,
                own_thread_id: None,
                own_revision_ref: None,
            });
            job.state = InitiativeJobStateV1::Dispatching;
            Ok(())
        })
    }

    /// Record complete bounded framing only, never native acceptance or stopping.
    pub(crate) fn mark_private_framed(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        request: &InitiativePursuitRequestV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        let context = request
            .context_ref()
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        self.runtime_change(scope, &request.job_id, |_, job| {
            if job.state != InitiativeJobStateV1::Dispatching {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            let private = job
                .private_pursuit
                .as_mut()
                .ok_or(InitiativeStoreErrorV1::Scope)?;
            if private.context_ref != context || private.framed_unix_ms.is_some() {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            private.framed_unix_ms = Some(scope.control.now_unix_ms);
            Ok(())
        })
    }

    /// Commit only an authenticated completed private result after the parent's
    /// current head/dependency barrier. Persist digests/coordinates, never Markdown.
    /// Created requires a prior local artifact commit within that same barrier.
    pub(crate) fn commit_private_pursuit(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        request: &InitiativePursuitRequestV1,
        result: &InitiativePursuitResultV1,
        creation: Option<(&OpaqueId, &Sha256Ref)>,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.commit_private_pursuit_inner(scope, request, result, creation, None)
    }

    /// Preflight under the held current head/policy/ledger before a canonical
    /// Own birth. No new model admission or result/body is persisted here.
    pub(crate) fn validate_private_completion(
        &mut self, scope: &InitiativeRuntimeScopeV1, request: &InitiativePursuitRequestV1,
        result: &InitiativePursuitResultV1,
    ) -> Result<(), InitiativeStoreErrorV1> {
        result.validate_against_at(request, scope.control.now_unix_ms).map_err(|_| InitiativeStoreErrorV1::Stale)?;
        let context = request.context_ref().map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        self.runtime_change(scope, &request.job_id, |_, job| validate_private_job(job, &context))?;
        Ok(())
    }

    /// Bind a verified canonical Own commit to this exact completed native job;
    /// never place the inquiry's body or a fake Library creation in this ledger.
    pub(crate) fn commit_private_own_inquiry(
        &mut self, scope: &InitiativeRuntimeScopeV1, request: &InitiativePursuitRequestV1,
        result: &InitiativePursuitResultV1, own: &InitiativeThreadCommitReceiptV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.commit_private_pursuit_inner(scope, request, result, None, Some(own))
    }

    fn commit_private_pursuit_inner(
        &mut self, scope: &InitiativeRuntimeScopeV1, request: &InitiativePursuitRequestV1,
        result: &InitiativePursuitResultV1, creation: Option<(&OpaqueId, &Sha256Ref)>,
        own: Option<&InitiativeThreadCommitReceiptV1>,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        result
            .validate_against_at(request, scope.control.now_unix_ms)
            .map_err(|_| InitiativeStoreErrorV1::Stale)?;
        let digest =
            luca_protocol::canonical_sha256(result).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        let result_ref = Sha256Ref::parse(format!("sha256:{digest}"))
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        let context_ref = request
            .context_ref()
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        self.runtime_change(scope, &request.job_id, |connection, job| {
            validate_private_job(job, &context_ref)?;
            if own.is_some() != matches!(&result.result, InitiativePursuitOutcomeV1::OwnInquiry { .. }) {
                return Err(InitiativeStoreErrorV1::Invalid);
            }
            let disposition = match &result.result {
                InitiativePursuitOutcomeV1::Created { .. } => {
                    if creation.is_none() {
                        return Err(InitiativeStoreErrorV1::Invalid);
                    }
                    job.state = InitiativeJobStateV1::Succeeded;
                    None
                }
                InitiativePursuitOutcomeV1::NoChange => {
                    job.state = InitiativeJobStateV1::NoChange;
                    None
                }
                InitiativePursuitOutcomeV1::OwnInquiry { .. } => {
                    let receipt = own.ok_or(InitiativeStoreErrorV1::Invalid)?;
                    let expected = super::super::own_inquiries::own_thread_from_result(request, result).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
                    let identity = luca_protocol::derive_initiative_thread_ref(&expected.owner_pubkey,&expected.resident_pubkey,&expected.thread_id).map_err(|_|InitiativeStoreErrorV1::Invalid)?;
                    if receipt.resident_pubkey != request.resident_pubkey || receipt.thread_id != expected.thread_id
                        || receipt.record_id != expected.thread_id || receipt.revision.get() != 0
                        || receipt.canonical_thread_ref != identity
                        || receipt.canonical_revision_ref != expected.revision_ref().map_err(|_|InitiativeStoreErrorV1::Invalid)?
                    { return Err(InitiativeStoreErrorV1::Invalid); }
                    job.state = InitiativeJobStateV1::Succeeded;
                    None
                }
                InitiativePursuitOutcomeV1::Defer { eligible_after } => {
                    job.state = InitiativeJobStateV1::Deferred;
                    Some((
                        InitiativeDispositionV1::Deferred,
                        Some(eligible_after.clone()),
                    ))
                }
                InitiativePursuitOutcomeV1::Decline => {
                    job.state = InitiativeJobStateV1::Declined;
                    Some((InitiativeDispositionV1::Declined, None))
                }
                InitiativePursuitOutcomeV1::Retire => {
                    job.state = InitiativeJobStateV1::Retired;
                    Some((InitiativeDispositionV1::Retired, None))
                }
            };
            if !matches!(&result.result, InitiativePursuitOutcomeV1::Created { .. }) {
                if creation.is_some() {
                    return Err(InitiativeStoreErrorV1::Invalid);
                }
                // A terminal completed choice proves no return was admitted.
                if job.input.budget.return_ms > 0 {
                    job.model_stages_reserved = job.model_stages_reserved.saturating_sub(1);
                }
            }
            if let Some((disposition, eligible_after)) = disposition {
                let thread = load_thread(connection, &scope.control, &job.input.thread_id)?
                    .ok_or(InitiativeStoreErrorV1::Stale)?;
                let next = thread
                    .transition(
                        &thread_context(&scope.control, thread.revision)?,
                        disposition,
                        eligible_after,
                        &InitiativeTransitionCauseV1::ResidentRequest {
                            source_ref: result_ref.clone(),
                        },
                    )
                    .map_err(|_| InitiativeStoreErrorV1::Stale)?;
                job.current_thread_revision = next.revision;
                save_thread(connection, &next)?;
            }
            let private = job
                .private_pursuit
                .as_mut()
                .ok_or(InitiativeStoreErrorV1::Invalid)?;
            private.completed_unix_ms = Some(scope.control.now_unix_ms);
            private.result_ref = Some(result_ref.clone());
            if let Some((node, artifact)) = creation {
                private.creation_node = Some(node.clone());
                private.artifact_ref = Some(artifact.clone());
            }
            if let Some(own) = own {
                private.own_thread_id = Some(own.thread_id.clone());
                private.own_revision_ref = Some(own.canonical_revision_ref.clone());
            }
            job.result_ref = Some(result_ref);
            Ok(())
        })
    }

    /// Narrow only this exact private cycle on transport uncertainty. No native
    /// stopped/reaped claim, D0 lookup, resident-wide fanout or quota refund.
    pub(crate) fn interrupt_private_cycle(
        &mut self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.control_change(scope, id, |_, job| {
            if job.native_task_id.is_some()
                || !matches!(
                    job.state,
                    InitiativeJobStateV1::Planning
                        | InitiativeJobStateV1::Dispatching
                        | InitiativeJobStateV1::Interrupted
                )
            {
                return Err(InitiativeStoreErrorV1::Scope);
            }
            if job.state == InitiativeJobStateV1::Dispatching && job.private_pursuit.is_none() {
                return Err(InitiativeStoreErrorV1::Scope);
            }
            job.state = InitiativeJobStateV1::Interrupted;
            Ok(())
        })
    }
}

fn validate_private_job(job: &InitiativeJobV1, context_ref: &Sha256Ref) -> Result<(), InitiativeStoreErrorV1> {
    if job.state != InitiativeJobStateV1::Dispatching || job.native_task_id.is_some()
        || job.private_pursuit.as_ref().is_none_or(|private|private.context_ref != *context_ref
            || private.framed_unix_ms.is_none() || private.result_ref.is_some())
    { return Err(InitiativeStoreErrorV1::Conflict); }
    Ok(())
}

#[cfg(test)]
#[path = "private_jobs_tests.rs"]
mod tests;

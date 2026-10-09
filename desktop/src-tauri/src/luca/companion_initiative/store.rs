//! Durable body-free projections/reservations. No scheduler, model, process or signer.
//! Parent rechecks live scope/grants/egress/native ownership immediately before
//! effects. If a denial write fails, parent must still deny/cancel in memory;
//! SQLite availability is never permission to continue work.
use super::{policy::*, schema, schema::*, types::*};
use luca_protocol::{
    CanonicalTimestamp, InitiativeContextV1, InitiativePlanningDecisionV1,
    InitiativePlanningOutcomeV1, InitiativeThreadKindV1, InitiativeThreadV1,
    InitiativeTransitionCauseV1, OpaqueId, SafeU53, Sha256Ref, JSON_SAFE_INTEGER_MAX,
};
use rusqlite::{params, Connection, TransactionBehavior};
use std::path::Path;

#[path = "private_jobs.rs"]
mod private_jobs;

/// One private internal-SSD database containing no semantic bodies.
pub(crate) struct InitiativeStore {
    connection: Connection,
}
impl InitiativeStore {
    /// Open only the fixed identity in an existing canonical private internal directory.
    /// Existing targets are never chmodded, repaired or adopted as another database.
    pub(crate) fn open(path: &Path) -> Result<Self, InitiativeStoreErrorV1> {
        let connection = schema::open_database(path)?;
        Ok(Self { connection })
    }

    /// Read the owner policy; absence is disabled/paused, never implicit opt-in.
    pub(crate) fn policy(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<InitiativePolicyV1, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        load_policy(&self.connection, scope)
    }

    /// Keyless owner policy CAS. Pausing/disabling commits before returning only
    /// Bounded explicit enabled targets; this is metadata, never a fanout plan.
    pub(crate) fn enabled_residents(
        &self,
        owner: &luca_protocol::Hex64,
    ) -> Result<Vec<luca_protocol::Hex64>, InitiativeStoreErrorV1> {
        let mut statement = self.connection.prepare(
            "SELECT resident,payload FROM initiative_policy WHERE owner=?1 LIMIT 65"
        ).map_err(db_error)?;
        let rows = statement.query_map([owner.as_str()], |row| {
            Ok((row.get::<_, String>(0)?,row.get::<_, String>(1)?))
        }).map_err(db_error)?;
        let mut enabled = Vec::new();
        let mut count = 0;
        for row in rows {
            count += 1;
            if count > 64 { return Err(InitiativeStoreErrorV1::Invalid); }
            let (resident,payload) = row.map_err(db_error)?;
            if payload.len() > 4096 { return Err(InitiativeStoreErrorV1::Invalid); }
            let policy: InitiativePolicyV1 = decode(payload)?;
            policy.validate()?;
            if policy.enabled { enabled.push(luca_protocol::Hex64::parse(resident).map_err(|_| InitiativeStoreErrorV1::Scope)?); }
        }
        Ok(enabled)
    }

    /// Keyless owner policy CAS. Pausing/disabling commits before returning only
    /// this resident's owned initiative cancellation refs, across retained origins.
    pub(crate) fn set_policy(
        &mut self,
        scope: &InitiativeControlScopeV1,
        request_id: &OpaqueId,
        expected_revision: SafeU53,
        next: InitiativePolicyV1,
    ) -> Result<(InitiativePolicyV1, Vec<InitiativeOwnedCancellationV1>), InitiativeStoreErrorV1>
    {
        validate_scope(scope)?;
        next.validate()?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let fingerprint = fingerprint(&("policy", expected_revision, &next))?;
        let replay = request_replayed(&tx, scope, request_id, &fingerprint, "policy", "policy")?;
        let current = load_policy(&tx, scope)?;
        if replay {
            if current != next {
                return Err(InitiativeStoreErrorV1::Stale);
            }
        } else {
            if current.revision != expected_revision
                || expected_revision.get().checked_add(1) != Some(next.revision.get())
            {
                return Err(InitiativeStoreErrorV1::Stale);
            }
            tx.execute("INSERT INTO initiative_policy(owner,resident,payload) VALUES(?1,?2,?3) ON CONFLICT(owner,resident) DO UPDATE SET payload=excluded.payload",
                params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str(), encode(&next)?]).map_err(db_error)?;
            save_request(&tx, scope, request_id, &fingerprint, "policy", "policy")?;
        }
        let cancelled = if !next.enabled || next.paused {
            cancel_rows(&tx, scope)?
        } else {
            Vec::new()
        };
        tx.commit().map_err(db_error)?;
        Ok((next, cancelled))
    }

    /// Read one exact-principal body-free projection without admission or progress.
    pub(crate) fn thread(
        &self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
    ) -> Result<Option<InitiativeThreadV1>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        load_thread(&self.connection, scope, id)
    }

    /// Sync only the new canonical coordinate after an authenticated semantic
    /// disposition CAS. This cannot reopen work, alter provenance/checkpoints,
    /// change eligibility or fabricate a new resident request.
    pub(crate) fn sync_canonical_ref(
        &mut self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
        expected_revision: SafeU53,
        expected_old_ref: &Sha256Ref,
        facts: &InitiativeCanonicalFactsV1,
        disposition: luca_protocol::InitiativeDispositionV1,
        eligible_after: Option<CanonicalTimestamp>,
    ) -> Result<InitiativeThreadV1, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        let tx = self.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let mut current = load_thread(&tx, scope, id)?.ok_or(InitiativeStoreErrorV1::Stale)?;
        if current.revision != expected_revision || &current.canonical_revision_ref != expected_old_ref
            || current.owner_pubkey != facts.owner_pubkey || current.resident_pubkey != facts.resident_pubkey
            || current.thread_id != facts.thread_id || current.kind != facts.kind
            || current.canonical_thread_ref != facts.canonical_thread_ref
            || current.disposition != disposition || current.eligible_after != eligible_after
        { return Err(InitiativeStoreErrorV1::Stale); }
        if current.canonical_revision_ref != facts.canonical_revision_ref {
            current.canonical_revision_ref = facts.canonical_revision_ref.clone();
            current.revision = SafeU53::new(current.revision.get().checked_add(1).ok_or(InitiativeStoreErrorV1::Invalid)?)
                .map_err(|_|InitiativeStoreErrorV1::Invalid)?;
            let now = i64::try_from(scope.now_unix_ms).ok().and_then(chrono::DateTime::from_timestamp_millis)
                .ok_or(InitiativeStoreErrorV1::Invalid)?;
            current.updated_at = CanonicalTimestamp::parse(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
                .map_err(|_|InitiativeStoreErrorV1::Invalid)?;
            current.validate().map_err(|_|InitiativeStoreErrorV1::Invalid)?;
            save_thread(&tx, &current)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(current)
    }

    /// Latest conservative reservation/admission used for cadence, never an
    /// automatic retry. Unknown admission is not treated as unused capacity.
    pub(crate) fn latest_attempt_ms(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<Option<u64>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        Ok(jobs_for(&self.connection, scope)?
            .into_iter()
            .map(|job| job.created_unix_ms)
            .max())
    }

    /// Bounded exact-resident operational attempts for quiet fair selection of
    /// independent canonical roots. No D0 tasks, bodies or progress score; even
    /// uncertain admission counts. Global cadence and budgets remain separate.
    pub(crate) fn latest_attempt_for_threads(
        &self, scope: &InitiativeControlScopeV1,
    ) -> Result<std::collections::BTreeMap<OpaqueId, u64>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        let mut attempts = std::collections::BTreeMap::<OpaqueId, u64>::new();
        for job in jobs_for(&self.connection, scope)? {
            let latest = attempts.entry(job.input.thread_id).or_insert(job.created_unix_ms);
            *latest = (*latest).max(job.created_unix_ms);
        }
        Ok(attempts)
    }

    /// CAS a host-compiled body-free projection against independently verified
    /// current canonical refs. Passive refresh cannot reopen a suppressed pursuit.
    pub(crate) fn cas_thread(
        &mut self,
        scope: &InitiativeControlScopeV1,
        request_id: &OpaqueId,
        expected_revision: Option<SafeU53>,
        next: InitiativeThreadV1,
        canonical: &InitiativeCanonicalFactsV1,
        cause: &InitiativeTransitionCauseV1,
    ) -> Result<InitiativeThreadV1, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        next.validate()
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        if !scope_matches_thread(scope, &next)
            || canonical.owner_pubkey != scope.owner_pubkey
            || canonical.resident_pubkey != scope.resident_pubkey
            || canonical.thread_id != next.thread_id
            || canonical.kind != next.kind
            || canonical.canonical_thread_ref != next.canonical_thread_ref
            || canonical.canonical_revision_ref != next.canonical_revision_ref
        {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let fingerprint = fingerprint(&("thread", expected_revision, &next))?;
        let replay = request_replayed(
            &tx,
            scope,
            request_id,
            &fingerprint,
            "thread",
            next.thread_id.as_str(),
        )?;
        let current = load_thread(&tx, scope, &next.thread_id)?;
        if replay {
            if current.as_ref() != Some(&next) {
                return Err(InitiativeStoreErrorV1::Stale);
            }
        } else {
            match (&current, expected_revision) {
                (None, None) if next.revision.get() == 1 => {}
                (Some(current), Some(expected)) if expected == current.revision => {
                    if current == &next {
                        return Ok(current.clone());
                    }
                    let ctx = thread_context(scope, current.revision)?;
                    let allowed = current
                        .transition(&ctx, next.disposition, next.eligible_after.clone(), cause)
                        .map_err(|_| InitiativeStoreErrorV1::Scope)?;
                    let canonical_changed =
                        current.canonical_revision_ref != next.canonical_revision_ref;
                    let revision = if allowed.revision == current.revision && canonical_changed {
                        current
                            .revision
                            .get()
                            .checked_add(1)
                            .ok_or(InitiativeStoreErrorV1::Invalid)?
                    } else {
                        allowed.revision.get()
                    };
                    if next.revision.get() != revision
                        || next.kind != current.kind
                        || next.updated_at != ctx.now
                        || next.disposition != allowed.disposition
                        || next.eligible_after != allowed.eligible_after
                    {
                        return Err(InitiativeStoreErrorV1::Stale);
                    }
                }
                _ => return Err(InitiativeStoreErrorV1::Stale),
            }
            save_thread(&tx, &next)?;
            save_request(
                &tx,
                scope,
                request_id,
                &fingerprint,
                "thread",
                next.thread_id.as_str(),
            )?;
        }
        tx.commit().map_err(db_error)?;
        Ok(next)
    }

    /// Reserve the whole decision/work/return interval atomically. Reservations
    /// remain charged conservatively; unknown usage is not zero or a refund.
    pub(crate) fn reserve_cycle(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        input: InitiativeCycleInputV1,
        continuation_cause: Option<&InitiativeTransitionCauseV1>,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        validate_runtime(scope)?;
        let total = input.budget.total_ms()?;
        if input.budget.decision_ms == 0
            && (input.continued_from.is_none() || input.budget.work_ms == 0)
        {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, &scope.control)?;
        let fingerprint = fingerprint(&(
            "cycle",
            &input,
            &scope.control.origin_scope_ref,
            &scope.control.window_id,
            &scope.binding_ref,
            scope.session_epoch,
        ))?;
        if request_replayed(
            &tx,
            &scope.control,
            &input.request_id,
            &fingerprint,
            "cycle",
            input.job_id.as_str(),
        )? {
            let job = load_job(&tx, &scope.control, &input.job_id)?
                .ok_or(InitiativeStoreErrorV1::Invalid)?;
            tx.commit().map_err(db_error)?;
            return Ok(job);
        }
        if input.deadline_unix_ms <= scope.control.now_unix_ms
            || scope
                .control
                .now_unix_ms
                .checked_add(total)
                .is_none_or(|latest| input.deadline_unix_ms > latest)
        {
            return Err(InitiativeStoreErrorV1::Deadline);
        }
        if load_any_job(&tx, &input.job_id)?.is_some() {
            return Err(InitiativeStoreErrorV1::Conflict);
        }
        let policy = load_policy(&tx, &scope.control)?;
        policy.admits()?;
        if scope.foreground_active {
            return Err(InitiativeStoreErrorV1::ForegroundBusy);
        }
        let thread = load_thread(&tx, &scope.control, &input.thread_id)?
            .ok_or(InitiativeStoreErrorV1::Stale)?;
        if thread.revision != input.expected_thread_revision
            || thread.canonical_revision_ref != input.canonical_revision_ref
            || !thread
                .eligible_at(&thread_context(&scope.control, thread.revision)?)
                .map_err(|_| InitiativeStoreErrorV1::Stale)?
        {
            return Err(InitiativeStoreErrorV1::Stale);
        }
        let jobs = jobs_for(&tx, &scope.control)?;
        if jobs.len() >= 512 {
            return Err(InitiativeStoreErrorV1::Capacity);
        }
        validate_continuation(
            &scope.control,
            &scope.binding_ref,
            &input,
            continuation_cause,
            &thread,
            &jobs,
        )?;
        if jobs.iter().any(|j| j.state.holds_concurrency()) {
            return Err(InitiativeStoreErrorV1::Capacity);
        }
        let since = scope
            .control
            .now_unix_ms
            .saturating_sub(INITIATIVE_WINDOW_MS);
        let recent = jobs
            .iter()
            .filter(|j| j.created_unix_ms > since)
            .collect::<Vec<_>>();
        let reserved = recent.iter().try_fold(0_u64, |sum, job| {
            sum.checked_add(job.input.budget.total_ms()?)
                .ok_or(InitiativeStoreErrorV1::Capacity)
        })?;
        let model_stages = recent.iter().try_fold(0_u64, |sum, job| {
            sum.checked_add(job.model_stages_reserved)
                .ok_or(InitiativeStoreErrorV1::Capacity)
        })?;
        if model_stages
            .checked_add(input.budget.model_stages())
            .is_none_or(|stages| stages > policy.max_model_stages_per_24h)
            || total > policy.max_cycle_time_ms
            || reserved
                .checked_add(total)
                .is_none_or(|n| n > policy.max_reserved_time_per_24h_ms)
        {
            return Err(InitiativeStoreErrorV1::Capacity);
        }
        let job = InitiativeJobV1 {
            input: input.clone(),
            owner_pubkey: scope.control.owner_pubkey.clone(),
            resident_pubkey: scope.control.resident_pubkey.clone(),
            window_id: scope.control.window_id.clone(),
            origin_scope_ref: scope.control.origin_scope_ref.clone(),
            binding_ref: scope.binding_ref.clone(),
            session_epoch: scope.session_epoch,
            policy_revision: policy.revision,
            current_thread_revision: input.expected_thread_revision,
            model_stages_reserved: input.budget.model_stages(),
            decision: if input.budget.decision_ms == 0 {
                Some(InitiativePlanningOutcomeV1::Pursue)
            } else {
                None
            },
            state: if input.budget.decision_ms == 0 {
                InitiativeJobStateV1::Ready
            } else {
                InitiativeJobStateV1::Reserved
            },
            created_unix_ms: scope.control.now_unix_ms,
            updated_unix_ms: scope.control.now_unix_ms,
            native_task_id: None,
            native_receipt_ref: None,
            checkpoint_ref: None,
            result_ref: None,
            private_pursuit: None,
            reconciliation_ref: None,
            return_key: None,
            return_reserved_unix_ms: None,
            return_receipt_ref: None,
        };
        save_job(&tx, &job)?;
        save_request(
            &tx,
            &scope.control,
            &input.request_id,
            &fingerprint,
            "cycle",
            input.job_id.as_str(),
        )?;
        tx.commit().map_err(db_error)?;
        Ok(job)
    }

    /// A successful claim records admission once, but is not a model invocation grant.
    pub(crate) fn claim_planning(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        id: &OpaqueId,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, id, |_, job| {
            if job.state != InitiativeJobStateV1::Reserved || job.input.budget.decision_ms == 0 {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            job.state = InitiativeJobStateV1::Planning;
            Ok(())
        })
    }

    /// Persist one validated private choice and its operational revision together.
    pub(crate) fn apply_decision(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        id: &OpaqueId,
        decision: &InitiativePlanningDecisionV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, id, |connection, job| {
            if job.state != InitiativeJobStateV1::Planning {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            let thread = load_thread(connection, &scope.control, &job.input.thread_id)?
                .ok_or(InitiativeStoreErrorV1::Stale)?;
            let next = thread
                .apply_planning_decision(
                    decision,
                    &job.input.job_id,
                    &thread_context(&scope.control, thread.revision)?,
                )
                .map_err(|_| InitiativeStoreErrorV1::Stale)?;
            job.state = match &decision.result {
                InitiativePlanningOutcomeV1::Pursue => InitiativeJobStateV1::Ready,
                InitiativePlanningOutcomeV1::Defer { .. } => InitiativeJobStateV1::Deferred,
                InitiativePlanningOutcomeV1::Decline => InitiativeJobStateV1::Declined,
                InitiativePlanningOutcomeV1::NoChange => InitiativeJobStateV1::NoChange,
            };
            job.current_thread_revision = next.revision;
            job.decision = Some(decision.result.clone());
            if !matches!(&decision.result, InitiativePlanningOutcomeV1::Pursue) {
                // A validated terminal decision proves work/return were never
                // admitted; only those unused reservations may be released.
                job.model_stages_reserved = 1;
            }
            save_thread(connection, &next)?;
            Ok(())
        })
    }

    /// Freeze the exact owned native task ID before dispatch; a crash is uncertain,
    /// never permission to launch it again. Parent must use/verify this exact ID.
    pub(crate) fn reserve_dispatch(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        id: &OpaqueId,
        native_task_id: OpaqueId,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, id, |_, job| {
            if job.state != InitiativeJobStateV1::Ready || job.input.budget.work_ms == 0 {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            job.native_task_id = Some(native_task_id);
            job.state = InitiativeJobStateV1::Dispatching;
            Ok(())
        })
    }

    /// Record an independently verified native acceptance, not model status prose.
    pub(crate) fn record_working(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        facts: &InitiativeNativeFactsV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, &facts.job_id, |_, job| {
            verify_native(job, facts)?;
            if job.state != InitiativeJobStateV1::Dispatching {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            job.native_receipt_ref = Some(facts.receipt_ref.clone());
            job.state = InitiativeJobStateV1::Working;
            Ok(())
        })
    }

    /// Preserve only verified checkpoint/result refs; all bodies remain outside this DB.
    pub(crate) fn record_result(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        facts: &InitiativeNativeFactsV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, &facts.job_id, |_, job| {
            verify_native(job, facts)?;
            if job.state != InitiativeJobStateV1::Working || facts.result_ref.is_none() {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            job.native_receipt_ref = Some(facts.receipt_ref.clone());
            job.checkpoint_ref = facts.checkpoint_ref.clone();
            job.result_ref = facts.result_ref.clone();
            job.state = InitiativeJobStateV1::Succeeded;
            Ok(())
        })
    }

    /// Reserve exactly one meaningful, separately authorized return; an own creation
    /// may remain on the shelf without calling this or consuming outreach capacity.
    pub(crate) fn reserve_return(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        id: &OpaqueId,
        return_key: OpaqueId,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.runtime_change(scope, id, |connection, job| {
            if job.state != InitiativeJobStateV1::Succeeded
                || job.result_ref.is_none()
                || job.return_key.is_some()
                || job.input.origin_conversation_id.is_none()
                || job.input.budget.return_ms == 0
                || !scope.outreach_authorized
            {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            let policy = load_policy(connection, &scope.control)?;
            let jobs = jobs_for(connection, &scope.control)?;
            if jobs
                .iter()
                .any(|job| job.return_key.as_ref() == Some(&return_key))
            {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            let since = scope
                .control
                .now_unix_ms
                .saturating_sub(INITIATIVE_WINDOW_MS);
            if jobs
                .iter()
                .any(|j| j.input.job_id != job.input.job_id && j.state.holds_concurrency())
                || jobs
                    .iter()
                    .filter(|j| j.return_reserved_unix_ms.is_some_and(|time| time > since))
                    .count() as u64
                    >= policy.max_outreach_per_24h
            {
                return Err(InitiativeStoreErrorV1::Capacity);
            }
            job.return_key = Some(return_key);
            job.return_reserved_unix_ms = Some(scope.control.now_unix_ms);
            job.state = InitiativeJobStateV1::ReturnReserved;
            Ok(())
        })
    }

    /// Record verified publication/replay of the exact retained return key only.
    /// This can record a late already-submitted publication after Stop; it grants
    /// no new sending authority and does not pretend cancellation erased bytes.
    pub(crate) fn mark_returned(
        &mut self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
        return_key: &OpaqueId,
        receipt_ref: Sha256Ref,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.control_change(scope, id, |_, job| {
            if job.return_key.as_ref() != Some(return_key) {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            if job.state == InitiativeJobStateV1::Returned {
                return if job.return_receipt_ref.as_ref() == Some(&receipt_ref) {
                    Ok(())
                } else {
                    Err(InitiativeStoreErrorV1::Conflict)
                };
            }
            if !matches!(
                job.state,
                InitiativeJobStateV1::ReturnReserved | InitiativeJobStateV1::Cancelled
            ) {
                return Err(InitiativeStoreErrorV1::Conflict);
            }
            job.return_receipt_ref = Some(receipt_ref);
            job.state = InitiativeJobStateV1::Returned;
            Ok(())
        })
    }

    /// Keyless foreground preemption/Stop: no provider, model, signing key or D0 lookup.
    pub(crate) fn cancel_owned(
        &mut self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<Vec<InitiativeOwnedCancellationV1>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let refs = cancel_rows(&tx, scope)?;
        tx.commit().map_err(db_error)?;
        Ok(refs)
    }

    /// Restart makes uncertain admission/dispatch Interrupted. Reserved work is
    /// cancelled, returns retain their key, and nothing is dispatched or regenerated.
    pub(crate) fn recover(
        &mut self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<Vec<InitiativeJobV1>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let mut recovered = Vec::new();
        for mut job in jobs_for(&tx, scope)? {
            if job.origin_scope_ref != scope.origin_scope_ref {
                continue;
            }
            match job.state {
                InitiativeJobStateV1::Reserved => {
                    job.state = InitiativeJobStateV1::Cancelled;
                    job.model_stages_reserved = 0;
                }
                InitiativeJobStateV1::Planning
                | InitiativeJobStateV1::Ready
                | InitiativeJobStateV1::Dispatching
                | InitiativeJobStateV1::Working => job.state = InitiativeJobStateV1::Interrupted,
                _ => continue,
            }
            job.updated_unix_ms = scope.now_unix_ms;
            save_job(&tx, &job)?;
            recovered.push(job);
        }
        tx.commit().map_err(db_error)?;
        Ok(recovered)
    }

    /// Only exact independently verified native reconciliation releases uncertainty.
    /// A checkpoint permits a later explicit continuation reservation; never replay.
    pub(crate) fn reconcile(
        &mut self,
        scope: &InitiativeControlScopeV1,
        facts: &InitiativeNativeFactsV1,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        self.control_change(scope, &facts.job_id, |_, job| {
            verify_native(job, facts)?;
            if !(job.state == InitiativeJobStateV1::Interrupted
                || (job.state == InitiativeJobStateV1::Cancelled && job.native_task_id.is_none()))
                || (!facts.stopped && facts.result_ref.is_none())
            {
                return Err(InitiativeStoreErrorV1::ReconciliationRequired);
            }
            job.native_receipt_ref = Some(facts.receipt_ref.clone());
            job.reconciliation_ref = Some(facts.receipt_ref.clone());
            job.checkpoint_ref = facts.checkpoint_ref.clone();
            job.result_ref = facts.result_ref.clone();
            if job.return_key.is_none() && job.input.budget.return_ms > 0 {
                // No return was admitted. Do not charge an unused synthesis
                // after independently verified stopped/result reconciliation.
                job.model_stages_reserved = job.model_stages_reserved.saturating_sub(1);
            }
            if facts.stopped && job.native_task_id.is_none() && job.input.budget.work_ms > 0 {
                // Dispatch always freezes an owned task ID first; exact
                // reconciliation proves this work stage was never admitted.
                job.model_stages_reserved = job.model_stages_reserved.saturating_sub(1);
            }
            job.state = if facts.result_ref.is_some() {
                InitiativeJobStateV1::Succeeded
            } else {
                InitiativeJobStateV1::Reconciled
            };
            Ok(())
        })
    }

    /// Read exact owner/resident/origin job metadata, including retained recovery refs.
    pub(crate) fn job(
        &self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
    ) -> Result<Option<InitiativeJobV1>, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        load_job(&self.connection, scope, id)
    }

    fn control_change(
        &mut self,
        scope: &InitiativeControlScopeV1,
        id: &OpaqueId,
        change: impl FnOnce(&Connection, &mut InitiativeJobV1) -> Result<(), InitiativeStoreErrorV1>,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        validate_scope(scope)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        touch_clock(&tx, scope)?;
        let mut job = load_job(&tx, scope, id)?.ok_or(InitiativeStoreErrorV1::Stale)?;
        let before = job.clone();
        change(&tx, &mut job)?;
        if job != before {
            job.updated_unix_ms = scope.now_unix_ms;
            save_job(&tx, &job)?;
        }
        tx.commit().map_err(db_error)?;
        Ok(job)
    }

    fn runtime_change(
        &mut self,
        scope: &InitiativeRuntimeScopeV1,
        id: &OpaqueId,
        change: impl FnOnce(&Connection, &mut InitiativeJobV1) -> Result<(), InitiativeStoreErrorV1>,
    ) -> Result<InitiativeJobV1, InitiativeStoreErrorV1> {
        validate_runtime(scope)?;
        self.control_change(&scope.control, id, |connection, job| {
            let policy = load_policy(connection, &scope.control)?;
            policy.admits()?;
            if scope.foreground_active {
                return Err(InitiativeStoreErrorV1::ForegroundBusy);
            }
            if job.binding_ref != scope.binding_ref
                || job.session_epoch != scope.session_epoch
                || job.window_id != scope.control.window_id
                || job.policy_revision != policy.revision
            {
                return Err(InitiativeStoreErrorV1::Stale);
            }
            if scope.control.now_unix_ms >= job.input.deadline_unix_ms {
                return Err(InitiativeStoreErrorV1::Deadline);
            }
            let thread = load_thread(connection, &scope.control, &job.input.thread_id)?
                .ok_or(InitiativeStoreErrorV1::Stale)?;
            if thread.revision != job.current_thread_revision
                || thread.canonical_revision_ref != job.input.canonical_revision_ref
                || !thread
                    .eligible_at(&thread_context(&scope.control, thread.revision)?)
                    .map_err(|_| InitiativeStoreErrorV1::Stale)?
            {
                return Err(InitiativeStoreErrorV1::Stale);
            }
            change(connection, job)
        })
    }
}

fn validate_scope(scope: &InitiativeControlScopeV1) -> Result<(), InitiativeStoreErrorV1> {
    if scope.owner_pubkey == scope.resident_pubkey || scope.now_unix_ms > JSON_SAFE_INTEGER_MAX {
        Err(InitiativeStoreErrorV1::Scope)
    } else {
        Ok(())
    }
}
fn validate_runtime(scope: &InitiativeRuntimeScopeV1) -> Result<(), InitiativeStoreErrorV1> {
    validate_scope(&scope.control)?;
    if scope.session_epoch.get() == 0 {
        Err(InitiativeStoreErrorV1::Scope)
    } else {
        Ok(())
    }
}
fn thread_context(
    scope: &InitiativeControlScopeV1,
    revision: SafeU53,
) -> Result<InitiativeContextV1, InitiativeStoreErrorV1> {
    let millis = i64::try_from(scope.now_unix_ms).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    let timestamp =
        chrono::DateTime::from_timestamp_millis(millis).ok_or(InitiativeStoreErrorV1::Invalid)?;
    Ok(InitiativeContextV1 {
        owner_pubkey: scope.owner_pubkey.clone(),
        resident_pubkey: scope.resident_pubkey.clone(),
        expected_revision: revision,
        now: CanonicalTimestamp::parse(
            timestamp.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?,
    })
}
fn cancel_rows(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
) -> Result<Vec<InitiativeOwnedCancellationV1>, InitiativeStoreErrorV1> {
    let mut refs = Vec::new();
    for mut job in jobs_for(connection, scope)? {
        if !job.state.holds_concurrency() && job.state != InitiativeJobStateV1::Succeeded {
            continue;
        }
        refs.push(InitiativeOwnedCancellationV1 {
            job_id: job.input.job_id.clone(),
            native_task_id: job.native_task_id.clone(),
            return_key: job.return_key.clone(),
            origin_scope_ref: job.origin_scope_ref.clone(),
            binding_ref: job.binding_ref.clone(),
            session_epoch: job.session_epoch,
        });
        if job.state == InitiativeJobStateV1::Reserved {
            job.model_stages_reserved = 0;
        }
        let state = if (job.native_task_id.is_some() || job.private_pursuit.is_some())
            && job.result_ref.is_none()
        {
            InitiativeJobStateV1::Interrupted
        } else {
            InitiativeJobStateV1::Cancelled
        };
        if job.state != state {
            job.state = state;
            job.updated_unix_ms = scope.now_unix_ms;
            save_job(connection, &job)?;
        }
    }
    Ok(refs)
}
fn verify_native(
    job: &InitiativeJobV1,
    facts: &InitiativeNativeFactsV1,
) -> Result<(), InitiativeStoreErrorV1> {
    if job.private_pursuit.is_some()
        || facts.job_id != job.input.job_id
        || facts.owner_pubkey != job.owner_pubkey
        || facts.resident_pubkey != job.resident_pubkey
        || facts.binding_ref != job.binding_ref
        || facts.session_epoch != job.session_epoch
        || facts.native_task_id != job.native_task_id
    {
        Err(InitiativeStoreErrorV1::Scope)
    } else {
        Ok(())
    }
}
fn validate_continuation(
    scope: &InitiativeControlScopeV1,
    binding: &Sha256Ref,
    input: &InitiativeCycleInputV1,
    cause: Option<&InitiativeTransitionCauseV1>,
    thread: &InitiativeThreadV1,
    jobs: &[InitiativeJobV1],
) -> Result<(), InitiativeStoreErrorV1> {
    if let Some(parent_id) = &input.continued_from {
        let parent = jobs
            .iter()
            .find(|j| &j.input.job_id == parent_id)
            .ok_or(InitiativeStoreErrorV1::ReconciliationRequired)?;
        let authorized = matches!(
            (thread.kind, cause),
            (
                InitiativeThreadKindV1::Shared,
                Some(InitiativeTransitionCauseV1::OwnerRequest { .. })
            ) | (
                InitiativeThreadKindV1::Own,
                Some(InitiativeTransitionCauseV1::ResidentRequest { .. })
            )
        );
        if !authorized
            || parent.state != InitiativeJobStateV1::Reconciled
            || parent.reconciliation_ref.is_none()
            || parent.result_ref.is_some()
            || parent.binding_ref != *binding
            || parent.origin_scope_ref != scope.origin_scope_ref
            || parent.input.thread_id != input.thread_id
            || (parent.native_task_id.is_some() && parent.checkpoint_ref.is_none())
            || jobs
                .iter()
                .any(|job| job.input.continued_from.as_ref() == Some(parent_id))
            || (input.budget.decision_ms == 0
                && (parent.decision.as_ref() != Some(&InitiativePlanningOutcomeV1::Pursue)
                    || parent.current_thread_revision != input.expected_thread_revision
                    || parent.input.canonical_revision_ref != input.canonical_revision_ref))
        {
            return Err(InitiativeStoreErrorV1::ReconciliationRequired);
        }
    } else {
        let latest = jobs
            .iter()
            .filter(|job| job.input.thread_id == input.thread_id)
            .max_by(|a, b| {
                a.created_unix_ms
                    .cmp(&b.created_unix_ms)
                    .then_with(|| a.input.job_id.cmp(&b.input.job_id))
            });
        if latest.is_some_and(|job| {
            matches!(
                job.state,
                InitiativeJobStateV1::Interrupted
                    | InitiativeJobStateV1::Reconciled
                    | InitiativeJobStateV1::Cancelled
            )
        }) {
            return Err(InitiativeStoreErrorV1::ReconciliationRequired);
        }
    }
    Ok(())
}

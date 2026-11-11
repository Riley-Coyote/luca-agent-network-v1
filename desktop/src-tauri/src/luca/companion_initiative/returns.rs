//! One separately authorized private creation returned to the same companion DM.
//! Exact authored bytes stay in Library; this ledger stores provenance only.
use super::{
    desktop_host, host_scope::home_scope, InitiativeJobStateV1, InitiativeJobV1,
    InitiativeStoreErrorV1,
};
use crate::{
    app_state::AppState,
    data_dir::BuzzPathExt,
    luca::{
        artifacts::ArtifactStore,
        companion_awareness::{source_runtime::preload_retained_source_facts, LiveAwarenessOwner},
        managed_cognition,
        runtime_task_delivery::{
            self, RuntimeTaskDeliveryApprovalV1, RuntimeTaskDeliveryOperationV1,
            RuntimeTaskDeliveryScopeV1, RuntimeTaskDeliveryStateV1,
        },
    },
};
use chrono::Timelike;
use luca_protocol::{
    canonical_sha256, ArtifactReadModeV1, AwarenessObservationRefV1, CanonicalTimestamp, Hex64,
    OpaqueId, RuntimeTaskDeliveryRequestV1, SafeU53, Sha256Ref, RUNTIME_TASK_DELIVERY_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

/// Retained host-verified origin/result coordinates, never publication authority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeReturnContextV1 {
    pub artifact_id: OpaqueId,
    pub version: SafeU53,
    pub artifact_ref: Sha256Ref,
    pub result_ref: Sha256Ref,
    pub dependency_node: OpaqueId,
    pub record_id: OpaqueId,
    pub canonical_revision_ref: Sha256Ref,
    pub observations: Vec<AwarenessObservationRefV1>,
    pub novelty_ref: Sha256Ref,
    pub content_ref: Sha256Ref,
}

fn now() -> Result<CanonicalTimestamp, String> {
    crate::luca::continuity_jobs::current_canonical_timestamp()
}
fn digest(bytes: &[u8]) -> Result<Sha256Ref, String> {
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
        .map_err(|_| "Invalid return digest.".into())
}
fn err(_: impl std::fmt::Debug) -> String {
    "Companion return is not currently authorized or available.".into()
}

/// Current exact-job admission, repeated immediately before provider framing or
/// relay submission. A successful check is not retained as a future capability.
fn admit_job(app: &AppHandle, job: &InitiativeJobV1) -> Result<(), String> {
    with_admitted_job(app, job, false, || Ok(()))
}

/// The operation is bounded framing/transport only, never the native model wait.
fn with_admitted_job<T>(
    app: &AppHandle,
    job: &InitiativeJobV1,
    body_effect: bool,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let state = app.state::<AppState>();
    let scope = desktop_host::runtime_scope(app, &job.resident_pubkey).map_err(err)?;
    if scope.control.owner_pubkey != job.owner_pubkey
        || scope.foreground_active
        || scope.binding_ref != job.binding_ref
    {
        return Err(err(()));
    }
    let policy = state
        .companion_initiative
        .with_control(&scope.control, |store| store.policy(&scope.control))
        .map_err(err)?;
    let consent = policy.return_consent.as_ref().ok_or_else(|| err(()))?;
    consent.validate().map_err(err)?;
    if !policy.enabled
        || policy.paused
        || policy.max_outreach_per_24h == 0
        || policy.revision != job.policy_revision
        || consent.owner_pubkey != job.owner_pubkey
        || consent.resident_pubkey != job.resident_pubkey
        || consent.binding_ref != scope.binding_ref
        || job.input.origin_conversation_id.as_ref() != Some(&consent.conversation_id)
    {
        return Err(err(()));
    }
    let local = chrono::Local::now();
    if runtime_task_delivery::origin_relay_ref(
        app,
        &crate::relay::relay_ws_url_with_override(&state),
    )
    .ok()
    .as_ref()
        != Some(&consent.origin_relay_ref)
    {
        return Err(err(()));
    }
    if consent.quiet_at((local.hour() * 60 + local.minute()) as u16) {
        return Err("Companion return deferred during quiet hours.".into());
    }
    super::return_setup::verify_dm(
        app,
        &job.owner_pubkey,
        &job.resident_pubkey,
        &consent.conversation_id,
    )?;
    let context = job.return_context.as_ref().ok_or_else(|| err(()))?;
    let material =
        preload_retained_source_facts(&state, &job.owner_pubkey, &job.resident_pubkey, &now()?)
            .map_err(err)?;
    let live = LiveAwarenessOwner::authenticate(&state).map_err(err)?;
    if live.owner() != &job.owner_pubkey {
        return Err(err(()));
    }
    let lease = live.lease().map_err(err)?;
    state
        .consume_current_resident_initiative_thread(
            &lease,
            &job.resident_pubkey,
            &job.input.thread_id,
            &context.record_id,
            &context.canonical_revision_ref,
            |_, view| {
                if !view.is_current
                    || !matches!(
                        view.thread.disposition,
                        luca_protocol::InitiativeDispositionV1::Carried
                            | luca_protocol::InitiativeDispositionV1::Deferred
                    )
                {
                    return Err(err(()));
                }
                let effect = || {
                    if desktop_host::foreground_active(
                        app,
                        &job.resident_pubkey,
                        scope.control.now_unix_ms,
                    ) || managed_cognition::active_binding_ref(&job.resident_pubkey)
                        .ok()
                        .as_ref()
                        != Some(&job.binding_ref)
                    {
                        return Err(err(()));
                    }
                    state
                        .companion_initiative
                        .with_execution_ledger(&lease, &scope.control, |store| {
                            if store.policy(&scope.control)? != policy {
                                return Err(InitiativeStoreErrorV1::Stale);
                            }
                            let current = store
                                .job(&scope.control, &job.input.job_id)?
                                .ok_or(InitiativeStoreErrorV1::Stale)?;
                            if current.return_context != job.return_context
                                || current.result_ref != job.result_ref
                                || !matches!(
                                    current.state,
                                    InitiativeJobStateV1::Succeeded
                                        | InitiativeJobStateV1::ReturnReserved
                                )
                            {
                                return Err(InitiativeStoreErrorV1::Stale);
                            }
                            if body_effect {
                                store.record_return_effect(&scope.control, &job.input.job_id)?;
                            }
                            Ok(operation())
                        })
                        .map_err(err)?
                        .map_err(err)?
                };
                state
                    .companion_execution
                    .with_running(&scope, || {
                        Ok((|| {
                            if context.observations.is_empty() {
                                if !view.canonical_source_clean && !view.canonical_own_authorship {
                                    return Err(err(()));
                                }
                                effect()
                            } else {
                                state
                                    .companion_awareness
                                    .admit_initiative_return(
                                        &lease,
                                        &job.resident_pubkey,
                                        &context.dependency_node,
                                        &now()?,
                                        &scope.binding_ref,
                                        &context.observations,
                                        &consent.sources,
                                        |reference, retained| material.resolve(reference, retained),
                                        effect,
                                    )
                                    .map_err(err)?
                            }
                        })())
                    })
                    .map_err(err)?
            },
        )
        .map_err(err)?
}

/// Called by the existing publisher only for an explicit InitiativeReturn row.
/// Ordinary delegated task deliveries keep their original independent behavior.
pub(crate) fn admit_publication(app: &AppHandle, delivery: &OpaqueId) -> Result<(), String> {
    with_publication(app, delivery, || Ok(()))
}

/// Historical receipts survive Pause and source revocation; no send is granted.
pub(crate) fn record_published(app: &AppHandle, delivery: &OpaqueId) -> Result<(), String> {
    let store = runtime_task_delivery::global_runtime_task_delivery_store(app).map_err(err)?;
    let (approval, receipt) = {
        let store = store.lock().map_err(err)?;
        let approval = store
            .approval_for_delivery(delivery)
            .ok_or_else(|| err(()))?;
        let receipt = store
            .receipt_for_task(&approval.task_id)
            .ok_or_else(|| err(()))?;
        (approval, receipt)
    };
    if approval.operation != RuntimeTaskDeliveryOperationV1::InitiativeReturn {
        return Ok(());
    }
    if receipt.state != RuntimeTaskDeliveryStateV1::Published
        || receipt.delivery_id.as_ref() != Some(delivery)
    {
        return Err(err(()));
    }
    let state = app.state::<AppState>();
    let scope =
        home_scope(&state, &approval.owner_pubkey, &approval.resident_pubkey).map_err(err)?;
    let reference = Sha256Ref::parse(format!(
        "sha256:{}",
        canonical_sha256(&(delivery, &receipt.result_sha256)).map_err(err)?
    ))
    .map_err(err)?;
    state
        .companion_initiative
        .with_control(&scope, |store| {
            store.mark_returned(&scope, &approval.task_id, delivery, reference)
        })
        .map_err(err)?;
    Ok(())
}

/// Holds the exact return denial fences through the bounded body-bearing effect.
/// Non-initiative task returns preserve their existing independent authority.
pub(crate) fn with_publication<T>(
    app: &AppHandle,
    delivery: &OpaqueId,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let store = runtime_task_delivery::global_runtime_task_delivery_store(app).map_err(err)?;
    let authority = store
        .lock()
        .map_err(err)?
        .approval_for_delivery(delivery)
        .ok_or_else(|| err(()))?;
    if authority.operation != RuntimeTaskDeliveryOperationV1::InitiativeReturn {
        return operation();
    }
    let state = app.state::<AppState>();
    let scope =
        home_scope(&state, &authority.owner_pubkey, &authority.resident_pubkey).map_err(err)?;
    let job = state
        .companion_initiative
        .with_control(&scope, |store| store.job(&scope, &authority.task_id))
        .map_err(err)?
        .ok_or_else(|| err(()))?;
    if authority.conversation_id
        != job
            .input
            .origin_conversation_id
            .clone()
            .ok_or_else(|| err(()))?
        || authority.binding_ref != job.binding_ref
    {
        return Err(err(()));
    }
    with_admitted_job(app, &job, true, operation)
}

/// Bounded metadata scan; no model is called merely to catch up after restart.
/// A retained ambiguous synthesis is never regenerated automatically.
pub(crate) fn deliver_pending(
    app: &AppHandle,
    resident: &Hex64,
    mut mark_running: impl FnMut(&InitiativeJobV1),
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let owner = state
        .companion_awareness
        .control_owner()
        .ok_or_else(|| err(()))?;
    let scope = home_scope(&state, &owner, resident).map_err(err)?;
    let policy = state
        .companion_initiative
        .with_control(&scope, |store| store.policy(&scope))
        .map_err(err)?;
    if !policy.enabled
        || policy.paused
        || policy.return_consent.is_none()
        || policy.max_outreach_per_24h == 0
    {
        return Ok(());
    }
    let jobs = state
        .companion_initiative
        .with_control(&scope, |store| store.pending_returns(&scope))
        .map_err(err)?;
    drop(state);
    // A stale old head must not starve a newer authorized result. One actual
    // attempt per tick, scanning only the bounded metadata candidates.
    for job in jobs {
        if settle_known_terminal(app, &job).unwrap_or(false) {
            continue;
        }
        let published = runtime_task_delivery::global_runtime_task_delivery_store(app)
            .ok()
            .and_then(|store| {
                store
                    .lock()
                    .ok()
                    .and_then(|store| store.receipt_for_task(&job.input.job_id))
            })
            .filter(|receipt| receipt.state == RuntimeTaskDeliveryStateV1::Published)
            .and_then(|receipt| receipt.delivery_id);
        if let Some(delivery) = published {
            let _ = record_published(app, &delivery);
            continue;
        }
        if admit_job(app, &job).is_err() {
            continue;
        }
        mark_running(&job);
        let _ = deliver_one(app, &job);
        break;
    }
    Ok(())
}

fn deliver_one(app: &AppHandle, job: &InitiativeJobV1) -> Result<(), String> {
    let delivery_store =
        runtime_task_delivery::global_runtime_task_delivery_store(app).map_err(err)?;
    let existing = delivery_store
        .lock()
        .map_err(err)?
        .receipt_for_task(&job.input.job_id);
    if let Some(receipt) = &existing {
        if receipt.state == RuntimeTaskDeliveryStateV1::Published {
            let state = app.state::<AppState>();
            let scope = home_scope(&state, &job.owner_pubkey, &job.resident_pubkey).map_err(err)?;
            let key = receipt.delivery_id.as_ref().ok_or_else(|| err(()))?;
            let reference = Sha256Ref::parse(format!(
                "sha256:{}",
                canonical_sha256(&(key, &receipt.result_sha256)).map_err(err)?
            ))
            .map_err(err)?;
            state
                .companion_initiative
                .with_control(&scope, |store| {
                    store.mark_returned(&scope, &job.input.job_id, key, reference)
                })
                .map_err(err)?;
            return Ok(());
        }
        if !matches!(
            receipt.state,
            RuntimeTaskDeliveryStateV1::AwaitingResult
                | RuntimeTaskDeliveryStateV1::PendingSynthesis
                | RuntimeTaskDeliveryStateV1::Retryable
        ) {
            return Ok(());
        }
    }
    admit_job(app, job)?;
    let policy_state = app.state::<AppState>();
    let policy_scope =
        home_scope(&policy_state, &job.owner_pubkey, &job.resident_pubkey).map_err(err)?;
    let current_policy = policy_state
        .companion_initiative
        .with_control(&policy_scope, |store| store.policy(&policy_scope))
        .map_err(err)?;
    let local = chrono::Local::now();
    if !current_policy
        .return_consent
        .as_ref()
        .is_some_and(|consent| {
            consent.can_start_at((local.hour() * 60 + local.minute()) as u16, 180)
        })
    {
        return Err("Companion return deferred before quiet hours.".into());
    }
    let context = job.return_context.as_ref().ok_or_else(|| err(()))?;
    let state = app.state::<AppState>();
    let root = app.buzz_path().app_data_dir().map_err(err)?;
    let artifacts = ArtifactStore::open(&root).map_err(err)?;
    let preview = crate::luca::companion_awareness::artifact_access::ArtifactAccess::new(
        &state,
        &job.owner_pubkey,
        &artifacts,
    )
    .read(
        &context.artifact_id,
        Some(context.version),
        ArtifactReadModeV1::BoundedText,
    )
    .map_err(err)?;
    if preview.truncated
        || preview.version.aggregate_hash
            != context.artifact_ref.as_str().trim_start_matches("sha256:")
        || preview.artifact.created_by_pubkey != job.resident_pubkey.as_str()
        || preview.artifact.source_turn_id.as_deref() != Some(context.dependency_node.as_str())
    {
        return Err(err(()));
    }
    let bytes = preview.content.ok_or_else(|| err(()))?;
    let result = String::from_utf8(bytes).map_err(err)?;
    let result_hash = digest(result.as_bytes())?;
    let scope = desktop_host::runtime_scope(app, &job.resident_pubkey).map_err(err)?;
    let relay = crate::relay::relay_ws_url_with_override(&state);
    let relay_ref = runtime_task_delivery::origin_relay_ref(app, &relay).map_err(err)?;
    let community = runtime_task_delivery::community_id_for_relay_ref(&relay_ref).map_err(err)?;
    let conversation = job
        .input
        .origin_conversation_id
        .clone()
        .ok_or_else(|| err(()))?;
    let approval = RuntimeTaskDeliveryApprovalV1 {
        task_id: job.input.job_id.clone(),
        owner_pubkey: job.owner_pubkey.clone(),
        resident_pubkey: job.resident_pubkey.clone(),
        conversation_id: conversation.clone(),
        origin_relay_ref: relay_ref.clone(),
        origin_community_id: community.clone(),
        input_sha256: Sha256Ref::parse(format!(
            "sha256:{}",
            canonical_sha256(context).map_err(err)?
        ))
        .map_err(err)?,
        binding_ref: job.binding_ref.clone(),
        runtime_family: "companion_initiative".into(),
        operation: RuntimeTaskDeliveryOperationV1::InitiativeReturn,
        target_ref: None,
        permission_mode: "approved_companion_return".into(),
        approved_at: CanonicalTimestamp::parse(
            chrono::DateTime::from_timestamp_millis(
                i64::try_from(job.created_unix_ms).map_err(err)?,
            )
            .ok_or_else(|| err(()))?
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
        .map_err(err)?,
    };
    let receipt = {
        let mut store = delivery_store.lock().map_err(err)?;
        store.create_authority(approval).map_err(err)?;
        store
            .bind_succeeded_result(&job.input.job_id, result_hash.clone(), now()?)
            .map_err(err)?
    };
    let key = receipt.delivery_id.ok_or_else(|| err(()))?;
    let mut returning_scope = scope.clone();
    returning_scope.outreach_authorized = true;
    admit_job(app, job)?;
    let reserved = state
        .companion_initiative
        .with_control(&scope.control, |store| {
            store.reserve_completed_return(&returning_scope, &job.input.job_id, key.clone())
        })
        .map_err(err)?;
    let deadline = reserved
        .return_reserved_unix_ms
        .ok_or_else(|| err(()))?
        .saturating_add(job.input.budget.return_ms.min(180_000));
    if deadline <= scope.control.now_unix_ms {
        return Err("Companion return admission expired.".into());
    }
    let native_scope = RuntimeTaskDeliveryScopeV1 {
        owner_pubkey: job.owner_pubkey.clone(),
        resident_pubkey: job.resident_pubkey.clone(),
        conversation_id: conversation.clone(),
        origin_relay_ref: relay_ref,
        origin_community_id: community,
        binding_ref: job.binding_ref.clone(),
        session_epoch: scope.session_epoch.get(),
    };
    let claim = delivery_store
        .lock()
        .map_err(err)?
        .claim_synthesis(
            &key,
            &native_scope,
            scope.control.now_unix_ms,
            deadline
                .saturating_sub(scope.control.now_unix_ms)
                .saturating_add(30_000),
            now()?,
        )
        .map_err(err)?;
    let mut end = result.len().min(8 * 1024);
    while !result.is_char_boundary(end) {
        end -= 1;
    }
    let request=RuntimeTaskDeliveryRequestV1 {quote_result:false,protocol:RUNTIME_TASK_DELIVERY_PROTOCOL.into(),delivery_id:key.clone(),task_id:job.input.job_id.clone(),owner_pubkey:job.owner_pubkey.clone(),resident_pubkey:job.resident_pubkey.clone(),
        conversation_id:conversation,binding_ref:job.binding_ref.clone(),result_sha256:result_hash,runtime_family:"companion_initiative".into(),
        summary:"A private result the companion chose to create; mention it only as a useful, optional continuation, not an obligation.".into(),result_excerpt:result[..end].into(),result_total_bytes:SafeU53::new(result.len() as u64).map_err(err)?,result_is_excerpt:end<result.len(),
        deadline_unix_ms:SafeU53::new(deadline).map_err(err)?,max_draft_bytes:SafeU53::new(2048).map_err(err)?};
    let current = state
        .companion_initiative
        .with_control(&scope.control, |store| {
            store.job(&scope.control, &job.input.job_id)
        })
        .map_err(err)?
        .ok_or_else(|| err(()))?;
    let dependencies = context
        .observations
        .iter()
        .map(
            |reference| crate::luca::companion_awareness::AwarenessGrantKeyV1 {
                source: crate::luca::companion_awareness::AwarenessSourceKeyV1 {
                    owner_pubkey: job.owner_pubkey.clone(),
                    source_id: reference.source_id.clone(),
                    device_id: reference.device_id.clone(),
                },
                resident_pubkey: job.resident_pubkey.clone(),
            },
        )
        .collect();
    let mut operation_began = false;
    let admission = with_admitted_job(app, &current, false, || {
        // Once begin is entered, a transport error may be ambiguous. Only a
        // rejection before this point proves the claimed body never left.
        operation_began = true;
        let admission =
            match managed_cognition::begin_companion_return(&request, scope.session_epoch) {
                Ok(admission) => admission,
                Err(error) => return Ok(Err(error)),
            };
        // Register cancellation before releasing the same execution gate used
        // by Pause and foreground preemption. No frame/handle registration gap.
        state
            .companion_execution
            .track(
                &scope,
                &job.input.job_id,
                &job.input.thread_id,
                dependencies,
                admission.cancellation(),
            )
            .map_err(err)?;
        Ok(Ok(admission))
    });
    let admission = match admission {
        Ok(admission) => admission,
        Err(error) => {
            if !operation_began {
                delivery_store
                    .lock()
                    .map_err(err)?
                    .block_unstarted_synthesis(&claim, now()?)
                    .map_err(err)?;
                settle_known_terminal(app, &current)?;
            }
            return Err(error);
        }
    };
    let outcome = match admission {
        Ok(admission) => {
            let result = admission.wait();
            state.companion_execution.clear(&scope, &job.input.job_id);
            result
        }
        Err(error) => Err(error),
    };
    match outcome {
        Ok(luca_protocol::ResidentPrivateCognitionResultV1::RuntimeTaskDelivery { result }) => {
            if matches!(
                result.publication,
                luca_protocol::ManagedMessagePublishResultV1::Denied { .. }
                    | luca_protocol::ManagedMessagePublishResultV1::Cancelled { .. }
                    | luca_protocol::ManagedMessagePublishResultV1::Invalid { .. }
            ) {
                // A completed broker refusal cannot authorize a fresh draft.
                // A Prepared/Submitted row is left for exact-byte recovery.
                let _ = delivery_store.lock().map_err(err)?.mark_synthesis_blocked(
                    &key,
                    scope.session_epoch.get(),
                    now()?,
                );
                let _ = settle_known_terminal(app, &current);
            }
        }
        Ok(_) => {}
        Err(managed_cognition::ManagedCognitionError::Busy) => {
            // Correlated Busy is proof of non-admission. Release only this claim;
            // no new return reservation or budget is charged on the next tick.
            let _ = delivery_store
                .lock()
                .map_err(err)?
                .release_unstarted_synthesis(&claim, now()?);
        }
        Err(_) => { /* Unknown admission remains charged and is never regenerated. */ }
    }
    Ok(())
}

/// Only a proof of no synthesis admission (or a typed terminal broker refusal)
/// can free the completed return's concurrency slot. Unknown admission stays
/// charged and never becomes an automatic fresh synthesis after a deadline.
fn settle_known_terminal(app: &AppHandle, job: &InitiativeJobV1) -> Result<bool, String> {
    if job.state != InitiativeJobStateV1::ReturnReserved {
        return Ok(false);
    }
    let key = job.return_key.as_ref().ok_or_else(|| err(()))?;
    let store = runtime_task_delivery::global_runtime_task_delivery_store(app).map_err(err)?;
    let state = app.state::<AppState>();
    let control = home_scope(&state, &job.owner_pubkey, &job.resident_pubkey).map_err(err)?;
    let mut delivery = store.lock().map_err(err)?;
    let receipt = delivery
        .receipt_for_task(&job.input.job_id)
        .ok_or_else(|| err(()))?;
    if known_unstarted_expired(job, receipt.state, control.now_unix_ms) {
        delivery
            .mark_preflight_blocked(&job.input.job_id, control.now_unix_ms, now()?)
            .map_err(err)?;
    } else if !matches!(
        receipt.state,
        RuntimeTaskDeliveryStateV1::Blocked
            | RuntimeTaskDeliveryStateV1::Rejected
            | RuntimeTaskDeliveryStateV1::Cancelled
    ) {
        return Ok(false);
    }
    drop(delivery);
    state
        .companion_initiative
        .with_control(&control, |store| {
            store.close_completed_return(&control, &job.input.job_id, key)
        })
        .map_err(err)?;
    Ok(true)
}

fn known_unstarted_expired(
    job: &InitiativeJobV1,
    state: RuntimeTaskDeliveryStateV1,
    now_ms: u64,
) -> bool {
    matches!(
        state,
        RuntimeTaskDeliveryStateV1::PendingSynthesis | RuntimeTaskDeliveryStateV1::Retryable
    ) && job.return_reserved_unix_ms.is_some_and(|start| {
        start.saturating_add(job.input.budget.return_ms.min(180_000)) <= now_ms
    })
}

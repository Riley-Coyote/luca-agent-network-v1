//! One bounded return to the approving conversation, never another provider run.

use super::super::{
    managed_cognition,
    runtime_task_delivery::{
        community_id_for_relay_ref, global_runtime_task_delivery_store, origin_relay_ref,
        RuntimeTaskCompletionScopeV1, RuntimeTaskDeliveryApprovalV1,
        RuntimeTaskDeliveryOperationV1, RuntimeTaskDeliveryReceiptV1, RuntimeTaskDeliveryScopeV1,
        RuntimeTaskDeliveryStateV1, RuntimeTaskSynthesisClaimV1,
    },
};
use super::*;
use luca_protocol::{
    Hex64, OpaqueId, RuntimeTaskDeliveryRequestV1, SafeU53, Sha256Ref,
    RUNTIME_TASK_DELIVERY_PROTOCOL,
};
use sha2::{Digest as _, Sha256};

const MAX_AUTOMATIC_ATTEMPTS: u8 = 2;
const MAX_RECOVERY_TASKS: usize = MAX_RECEIPTS;
const EXCERPT_BYTES: usize = 8 * 1024;
const SYNTHESIS_MS: u64 = 180_000;
const LEASE_MS: u64 = SYNTHESIS_MS + 30_000;
const ADMISSION_RETRY_MS: u64 = 500;

/// Only a correlated pre-admission Busy reply permits polling. Every other
/// result exits immediately to the existing publication/ambiguous lease path.
fn await_admission<T>(
    mut preflight: impl FnMut() -> Result<Option<u64>, String>,
    mut dispatch: impl FnMut() -> Result<T, managed_cognition::ManagedCognitionError>,
    mut pause: impl FnMut(Duration),
) -> Result<Option<Result<T, managed_cognition::ManagedCognitionError>>, String> {
    loop {
        let Some(remaining) = preflight()? else {
            return Ok(None);
        };
        if remaining == 0 {
            return Ok(None);
        }
        match dispatch() {
            Err(managed_cognition::ManagedCognitionError::Busy) => {
                pause(Duration::from_millis(remaining.min(ADMISSION_RETRY_MS)));
            }
            response => return Ok(Some(response)),
        }
    }
}

fn admission_remaining(
    app: &AppHandle,
    claim: &RuntimeTaskSynthesisClaimV1,
    deadline_unix_ms: u64,
) -> Result<Option<u64>, String> {
    if deadline_unix_ms <= millis()? || !admission_scope_is_current(app, claim)? {
        return Ok(None);
    }
    let members = super::super::runtime_task_delivery::verified_conversation_members(
        app,
        &claim.conversation_id,
    )?;
    if !members.contains(&claim.owner_pubkey)
        || !members.contains(&claim.resident_pubkey)
        || !admission_scope_is_current(app, claim)?
    {
        return Ok(None);
    }
    let store = store(app)?;
    let guard = store
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?;
    // Membership verification may have waited on I/O; use the original
    // deadline's fresh remainder, never the value before that verification.
    let remaining = deadline_unix_ms.saturating_sub(millis()?);
    Ok((remaining > 0 && guard.has_synthesis_claim(claim)).then_some(remaining))
}

fn admission_scope_is_current(
    app: &AppHandle,
    claim: &RuntimeTaskSynthesisClaimV1,
) -> Result<bool, String> {
    if app
        .state::<crate::app_state::AppState>()
        .shutdown_started
        .load(std::sync::atomic::Ordering::Acquire)
        || !managed_cognition::active_binding_ref(&claim.resident_pubkey)
            .is_ok_and(|binding| binding == claim.binding_ref)
        || !managed_cognition::active_session_epoch(&claim.resident_pubkey)
            .is_ok_and(|epoch| epoch.get() == claim.session_epoch)
        || delegation::owner(app)? != claim.owner_pubkey
        || current_origin(app)?
            != (
                claim.origin_relay_ref.clone(),
                claim.origin_community_id.clone(),
            )
    {
        return Ok(false);
    }
    Ok(true)
}

fn now() -> Result<luca_protocol::CanonicalTimestamp, String> {
    super::super::continuity_jobs::current_canonical_timestamp()
}

fn millis() -> Result<u64, String> {
    u64::try_from(Utc::now().timestamp_millis())
        .map_err(|_| "Task return time is unavailable.".to_owned())
}

fn digest(bytes: &[u8]) -> Result<Sha256Ref, String> {
    Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(bytes))))
        .map_err(|_| "Task return evidence is invalid.".to_owned())
}

fn store(
    app: &AppHandle,
) -> Result<Arc<Mutex<super::super::runtime_task_delivery::RuntimeTaskDeliveryStore>>, String> {
    global_runtime_task_delivery_store(app).map_err(|error| error.to_string())
}

fn task_id(value: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(value.to_owned()).map_err(|_| "Task return identity is invalid.".to_owned())
}

fn receipt(app: &AppHandle, id: &str) -> Result<Option<RuntimeTaskDeliveryReceiptV1>, String> {
    let id = task_id(id)?;
    let store = store(app)?;
    let guard = store
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?;
    Ok(guard.receipt_for_task(&id))
}

pub(super) fn current_origin(app: &AppHandle) -> Result<(Sha256Ref, OpaqueId), String> {
    let relay =
        crate::relay::relay_ws_url_with_override(&app.state::<crate::app_state::AppState>());
    let relay_ref = origin_relay_ref(app, &relay).map_err(|error| error.to_string())?;
    let community = community_id_for_relay_ref(&relay_ref).map_err(|error| error.to_string())?;
    Ok((relay_ref, community))
}

pub(super) fn ensure_current_scope(
    app: &AppHandle,
    projection: &RuntimeTaskProjectionV1,
) -> Result<(), String> {
    if delegation::owner(app)?.as_str() != projection.owner_pubkey
        || projection
            .origin_relay_ref
            .as_ref()
            .is_some_and(|origin| !current_origin(app).is_ok_and(|(relay, _)| relay == *origin))
    {
        return Err("The task belongs to a different owner or community.".into());
    }
    Ok(())
}

/// The trusted owner Run action freezes this before the provider is spawned.
pub(super) fn approve(
    app: &AppHandle,
    projection: &mut RuntimeTaskProjectionV1,
    encoded_input: &[u8],
) -> Result<(), String> {
    if projection.control_owner != RuntimeTaskControlOwnerV1::Polyphonic
        || projection.operation == RuntimeTaskOperationV1::SendMessage
        || projection.state != RuntimeTaskStateV1::Queued
    {
        return Err("This task has no owner-approved result return.".into());
    }
    let owner = delegation::owner(app)?;
    if owner.as_str() != projection.owner_pubkey {
        return Err("Task authority changed before dispatch. Nothing ran.".into());
    }
    let resident = Hex64::parse(projection.resident_pubkey.clone())
        .map_err(|_| "Task resident identity is invalid.".to_owned())?;
    let binding = managed_cognition::active_binding_ref(&resident).map_err(|_| {
        "Wake the companion before starting a task so it can return the result.".to_owned()
    })?;
    let (relay_ref, community) = current_origin(app)?;
    let approval = RuntimeTaskDeliveryApprovalV1 {
        task_id: task_id(&projection.task_id)?,
        owner_pubkey: owner,
        resident_pubkey: resident,
        conversation_id: task_id(&projection.conversation_id)?,
        origin_relay_ref: relay_ref,
        origin_community_id: community,
        input_sha256: digest(encoded_input)?,
        binding_ref: binding,
        runtime_family: projection.runtime_family.clone(),
        operation: if projection.operation == RuntimeTaskOperationV1::NewTask {
            RuntimeTaskDeliveryOperationV1::NewTask
        } else {
            RuntimeTaskDeliveryOperationV1::ContinueSession
        },
        target_ref: projection
            .target_session_ref
            .as_deref()
            .map(task_id)
            .transpose()?,
        permission_mode: projection.permission_mode.clone(),
        approved_at: now()?,
    };
    store(app)?
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?
        .create_authority(approval)
        .map_err(|error| error.to_string())?;
    projection.delivery_state = Some(RuntimeTaskDeliveryStateV1::AwaitingResult);
    projection.delivery_can_retry = false;
    Ok(())
}

pub(super) fn abandon(app: &AppHandle, id: &str) {
    if let (Ok(store), Ok(id), Ok(timestamp)) = (store(app), task_id(id), now()) {
        if let Ok(mut guard) = store.lock() {
            let _ = guard.mark_awaiting_result_abandoned(&id, timestamp);
        }
    }
    super::refresh_runtime_task_delivery(app, id);
}

fn stored_success(app: &AppHandle, id: &str) -> Result<(RuntimeTaskProjectionV1, String), String> {
    validate_opaque(id, 128, "task")?;
    let bytes = storage::read_bounded(
        &receipt_directory(app)?.join(format!("{id}.json")),
        64 * 1024,
    )
    .map_err(|_| "The completed task receipt is unavailable.".to_owned())?;
    let projection: RuntimeTaskProjectionV1 = serde_json::from_slice(&bytes)
        .map_err(|_| "The completed task receipt is invalid.".to_owned())?;
    if projection.task_id != id
        || projection.state != RuntimeTaskStateV1::Succeeded
        || projection.control_owner != RuntimeTaskControlOwnerV1::Polyphonic
        || projection.operation == RuntimeTaskOperationV1::SendMessage
    {
        return Err("No durable owned task completion was verified.".into());
    }
    let result = load_result(app, id)
        .ok_or_else(|| "The completed task result is unavailable.".to_owned())?;
    Ok((projection, result))
}

/// Called only after both the complete result and Succeeded receipt are saved.
pub(super) fn completed(app: &AppHandle, id: &str) -> Result<(), String> {
    match bind_completed_result(app, id) {
        Ok(()) => {
            super::refresh_runtime_task_delivery(app, id);
            schedule(app.clone(), id.to_owned(), false);
            Ok(())
        }
        Err(CompletionFailure::Unverifiable(error)) => {
            block_unverifiable_completion(app, &task_id(id)?)?;
            Err(error)
        }
        Err(CompletionFailure::Unavailable(error)) => Err(error),
    }
}

enum CompletionFailure {
    Unverifiable(String),
    Unavailable(String),
}

fn bind_completed_result(app: &AppHandle, id: &str) -> Result<(), CompletionFailure> {
    let (projection, result) = stored_success(app, id).map_err(CompletionFailure::Unverifiable)?;
    let scope = completion_scope(&projection).map_err(CompletionFailure::Unverifiable)?;
    let result_sha256 = digest(result.as_bytes()).map_err(CompletionFailure::Unverifiable)?;
    let timestamp = now().map_err(CompletionFailure::Unavailable)?;
    {
        let store = store(app).map_err(CompletionFailure::Unavailable)?;
        let mut guard = store.lock().map_err(|_| {
            CompletionFailure::Unavailable("Task return state is unavailable.".to_owned())
        })?;
        guard
            .verify_completion_scope(&scope)
            .map_err(|error| CompletionFailure::Unverifiable(error.to_string()))?;
        guard
            .bind_succeeded_result(&scope.task_id, result_sha256, timestamp)
            .map_err(|error| CompletionFailure::Unavailable(error.to_string()))?;
    }
    Ok(())
}

fn completion_scope(
    projection: &RuntimeTaskProjectionV1,
) -> Result<RuntimeTaskCompletionScopeV1, String> {
    let origin = projection
        .origin_relay_ref
        .clone()
        .ok_or_else(|| "Task completion has no verified origin.".to_owned())?;
    Ok(RuntimeTaskCompletionScopeV1 {
        task_id: task_id(&projection.task_id)?,
        owner_pubkey: Hex64::parse(projection.owner_pubkey.clone())
            .map_err(|_| "Task owner identity is invalid.".to_owned())?,
        resident_pubkey: Hex64::parse(projection.resident_pubkey.clone())
            .map_err(|_| "Task resident identity is invalid.".to_owned())?,
        conversation_id: task_id(&projection.conversation_id)?,
        origin_community_id: community_id_for_relay_ref(&origin)
            .map_err(|error| error.to_string())?,
        origin_relay_ref: origin,
        runtime_family: projection.runtime_family.clone(),
        operation: match projection.operation {
            RuntimeTaskOperationV1::NewTask => RuntimeTaskDeliveryOperationV1::NewTask,
            RuntimeTaskOperationV1::ContinueSession => {
                RuntimeTaskDeliveryOperationV1::ContinueSession
            }
            RuntimeTaskOperationV1::SendMessage => {
                return Err("A native queue acknowledgement is not task completion.".into());
            }
        },
        target_ref: projection
            .target_session_ref
            .as_deref()
            .map(task_id)
            .transpose()?,
        permission_mode: projection.permission_mode.clone(),
    })
}

fn block_unverifiable_completion(app: &AppHandle, id: &OpaqueId) -> Result<(), String> {
    store(app)?
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?
        .mark_awaiting_result_unverifiable(id, now()?)
        .map_err(|error| error.to_string())?;
    super::refresh_runtime_task_delivery(app, id.as_str());
    Ok(())
}

pub(super) fn decorate(app: &AppHandle, projection: &mut RuntimeTaskProjectionV1) {
    if projection.control_owner != RuntimeTaskControlOwnerV1::Polyphonic {
        projection.delivery_state = None;
        projection.delivery_can_retry = false;
        return;
    }
    if let Ok(Some(receipt)) = receipt(app, &projection.task_id) {
        projection.delivery_state = Some(receipt.state);
        projection.delivery_can_retry = projection.state == RuntimeTaskStateV1::Succeeded
            && receipt.state == RuntimeTaskDeliveryStateV1::Retryable;
        // Event/cache ordering must include delivery, not just provider progress.
        if chrono::DateTime::parse_from_rfc3339(receipt.updated_at.as_str()).ok()
            > chrono::DateTime::parse_from_rfc3339(&projection.updated_at).ok()
        {
            projection.updated_at = receipt.updated_at.as_str().to_owned();
        }
    }
}

fn inflight() -> &'static Mutex<std::collections::HashSet<String>> {
    static ACTIVE: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    ACTIVE.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

#[derive(Default)]
struct RecoveryWake {
    running: bool,
    requested: bool,
}

impl RecoveryWake {
    fn request(&mut self) -> bool {
        if self.running {
            self.requested = true;
            false
        } else {
            self.running = true;
            self.requested = false;
            true
        }
    }

    fn finish_pass(&mut self, shutting_down: bool) -> bool {
        if self.requested && !shutting_down {
            self.requested = false;
            true
        } else {
            self.running = false;
            self.requested = false;
            false
        }
    }
}

/// Coalesce lifecycle wakeups; never poll sessions or reopen provider work.
pub(super) fn queue_recovery(app: &AppHandle) {
    static WAKE: OnceLock<Mutex<RecoveryWake>> = OnceLock::new();
    let wake = WAKE.get_or_init(|| Mutex::new(RecoveryWake::default()));
    if !wake.lock().is_ok_and(|mut state| state.request()) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let shutting_down = app
                .state::<crate::app_state::AppState>()
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire);
            if !shutting_down {
                let recovery_app = app.clone();
                if !matches!(
                    tauri::async_runtime::spawn_blocking(move || recover(&recovery_app)).await,
                    Ok(Ok(_))
                ) {
                    luca_log!(
                        info,
                        "luca-runtime-tasks: approved return recovery unavailable"
                    );
                }
            }
            if !wake
                .lock()
                .is_ok_and(|mut state| state.finish_pass(shutting_down))
            {
                break;
            }
        }
    });
}

fn schedule(app: AppHandle, id: String, manual: bool) {
    let Ok(mut active) = inflight().lock() else {
        return;
    };
    if !active.insert(id.clone()) {
        return;
    }
    drop(active);
    tauri::async_runtime::spawn(async move {
        static CAPACITY: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
        let capacity =
            Arc::clone(CAPACITY.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2))));
        if wait_existing_lease(&app, &id).await {
            if let Ok(_permit) = capacity.acquire_owned().await {
                let work_app = app.clone();
                let work_id = id.clone();
                let _ =
                    tauri::async_runtime::spawn_blocking(move || run(work_app, work_id, manual))
                        .await;
            }
        }
        if let Ok(mut active) = inflight().lock() {
            active.remove(&id);
        }
        super::refresh_runtime_task_delivery(&app, &id);
    });
}

async fn wait_existing_lease(app: &AppHandle, id: &str) -> bool {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(LEASE_MS);
    loop {
        if app
            .state::<crate::app_state::AppState>()
            .shutdown_started
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return false;
        }
        let Ok(Some(row)) = receipt(app, id) else {
            return false;
        };
        if row.state != RuntimeTaskDeliveryStateV1::Synthesizing {
            return true;
        }
        let Ok(now_ms) = millis() else {
            return false;
        };
        let Some(lease) = row.synthesis_lease_deadline_unix_ms else {
            return false;
        };
        if lease <= now_ms {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis((lease - now_ms).min(2_000))).await;
    }
}

fn run(app: AppHandle, id: String, manual: bool) -> Result<(), String> {
    let mut manual = manual;
    loop {
        store(&app)?
            .lock()
            .map_err(|_| "Task return state is unavailable.".to_owned())?
            .recover_expired_synthesis(&task_id(&id)?, millis()?, now()?)
            .map_err(|error| error.to_string())?;
        let Some(approved) = receipt(&app, &id)? else {
            return Ok(());
        };
        if !claimable(&approved, manual, millis()?) {
            return Ok(());
        }
        // Never turn another owner's/relay's result into a new route.
        let owner = delegation::owner(&app)?;
        let (relay_ref, community) = current_origin(&app)?;
        if owner != approved.owner_pubkey
            || relay_ref != approved.origin_relay_ref
            || community != approved.origin_community_id
        {
            return Ok(());
        }
        let binding = match managed_cognition::active_binding_ref(&approved.resident_pubkey) {
            Ok(binding) => binding,
            Err(_) => {
                preflight_retryable(&app, &id)?;
                return Ok(());
            }
        };
        let epoch = match managed_cognition::active_session_epoch(&approved.resident_pubkey) {
            Ok(epoch) => epoch,
            Err(_) => {
                preflight_retryable(&app, &id)?;
                return Ok(());
            }
        };
        let members = match super::super::runtime_task_delivery::verified_conversation_members(
            &app,
            &approved.conversation_id,
        ) {
            Ok(members) => members,
            Err(_) => {
                preflight_retryable(&app, &id)?;
                return Ok(());
            }
        };
        if !members.contains(&owner) || !members.contains(&approved.resident_pubkey) {
            store(&app)?
                .lock()
                .map_err(|_| "Task return state is unavailable.".to_owned())?
                .mark_preflight_blocked(&task_id(&id)?, millis()?, now()?)
                .map_err(|error| error.to_string())?;
            return Ok(());
        }
        let (projection, result) = stored_success(&app, &id)?;
        let result_digest = digest(result.as_bytes())?;
        if approved.result_sha256.as_ref() != Some(&result_digest) {
            return Err("Task result evidence changed; no summary was sent.".into());
        }
        let scope = RuntimeTaskDeliveryScopeV1 {
            owner_pubkey: owner,
            resident_pubkey: approved.resident_pubkey.clone(),
            conversation_id: approved.conversation_id.clone(),
            origin_relay_ref: relay_ref,
            origin_community_id: community,
            binding_ref: binding,
            session_epoch: epoch.get(),
        };
        let delivery_id = approved
            .delivery_id
            .as_ref()
            .ok_or_else(|| "Task return identity is unavailable.".to_owned())?;
        let claim = store(&app)?
            .lock()
            .map_err(|_| "Task return state is unavailable.".to_owned())?
            .claim_synthesis(delivery_id, &scope, millis()?, LEASE_MS, now()?)
            .map_err(|error| error.to_string())?;
        super::refresh_runtime_task_delivery(&app, &id);
        let excerpt = excerpt(&result);
        let request = RuntimeTaskDeliveryRequestV1 {
            protocol: RUNTIME_TASK_DELIVERY_PROTOCOL.to_owned(),
            delivery_id: claim.delivery_id.clone(),
            task_id: claim.task_id.clone(),
            owner_pubkey: claim.owner_pubkey.clone(),
            resident_pubkey: claim.resident_pubkey.clone(),
            conversation_id: claim.conversation_id.clone(),
            binding_ref: claim.binding_ref.clone(),
            result_sha256: result_digest,
            runtime_family: projection.runtime_family,
            summary: projection.summary,
            result_is_excerpt: excerpt.len() < result.len(),
            result_excerpt: excerpt,
            result_total_bytes: SafeU53::new(result.len() as u64)
                .map_err(|_| "Task result size is invalid.".to_owned())?,
            deadline_unix_ms: SafeU53::new(millis()?.saturating_add(SYNTHESIS_MS))
                .map_err(|_| "Task return deadline is invalid.".to_owned())?,
            max_draft_bytes: SafeU53::new(16 * 1024)
                .map_err(|_| "Task summary bound is invalid.".to_owned())?,
        };
        request
            .validate()
            .map_err(|_| "Task return request is invalid.".to_owned())?;
        let admission = await_admission(
            || admission_remaining(&app, &claim, request.deadline_unix_ms.get()),
            || managed_cognition::request_runtime_task(&request, epoch),
            thread::sleep,
        );
        let response = match admission {
            Ok(Some(response)) => response,
            unstarted => {
                // Every response was proof of non-admission (or no dispatch was
                // possible). Do not consume another claim/attempt automatically.
                let _ = store(&app)?
                    .lock()
                    .map_err(|_| "Task return state is unavailable.".to_owned())?
                    .release_unstarted_synthesis(&claim, now()?);
                super::refresh_runtime_task_delivery(&app, &id);
                return unstarted.map(|_| ());
            }
        };
        // A correlated broker response may already have frozen/submitted bytes.
        // Its Unavailable outcome is not permission to regenerate a message.
        match response {
            Ok(result) => {
                result
                    .validate_against(&request)
                    .map_err(|_| "Task summary response did not match.".to_owned())?;
                super::refresh_runtime_task_delivery(&app, &id);
                match result.publication {
                    luca_protocol::ManagedMessagePublishResultV1::Published { .. }
                    | luca_protocol::ManagedMessagePublishResultV1::Replayed { .. } => {
                        return Ok(())
                    }
                    luca_protocol::ManagedMessagePublishResultV1::Unavailable { .. } => {}
                    _ => {
                        let _ = store(&app)?
                            .lock()
                            .map_err(|_| "Task return state is unavailable.".to_owned())?
                            .mark_synthesis_blocked(
                                &claim.delivery_id,
                                claim.session_epoch,
                                now()?,
                            );
                        return Ok(());
                    }
                }
            }
            Err(managed_cognition::ManagedCognitionError::Invalid) => {
                let _ = store(&app)?
                    .lock()
                    .map_err(|_| "Task return state is unavailable.".to_owned())?
                    .mark_synthesis_blocked(&claim.delivery_id, claim.session_epoch, now()?);
                return Err("Task summary authority changed; no new provider task ran.".into());
            }
            Err(_) => {}
        }
        // Transport/publication unavailability is ambiguous. Reservation of
        // exact outbox bytes wins; wait through the lease before any retry.
        loop {
            let current = receipt(&app, &id)?
                .ok_or_else(|| "Task return state is unavailable.".to_owned())?;
            if current.state != RuntimeTaskDeliveryStateV1::Synthesizing {
                return Ok(());
            }
            let remaining = claim.lease_deadline_unix_ms.saturating_sub(millis()?);
            if remaining == 0 {
                break;
            }
            if app
                .state::<crate::app_state::AppState>()
                .shutdown_started
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(remaining.min(2_000)));
        }
        let _ = store(&app)?
            .lock()
            .map_err(|_| "Task return state is unavailable.".to_owned())?
            .release_synthesis_retryable(&claim.delivery_id, claim.session_epoch, now()?);
        super::refresh_runtime_task_delivery(&app, &id);
        manual = false;
    }
}

fn preflight_retryable(app: &AppHandle, id: &str) -> Result<(), String> {
    store(app)?
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?
        .mark_pending_retryable(&task_id(id)?, now()?)
        .map_err(|error| error.to_string())?;
    super::refresh_runtime_task_delivery(app, id);
    Ok(())
}

fn claimable(receipt: &RuntimeTaskDeliveryReceiptV1, manual: bool, now_ms: u64) -> bool {
    (manual || receipt.synthesis_attempts < MAX_AUTOMATIC_ATTEMPTS)
        && (matches!(
            receipt.state,
            RuntimeTaskDeliveryStateV1::PendingSynthesis | RuntimeTaskDeliveryStateV1::Retryable
        ) || (receipt.state == RuntimeTaskDeliveryStateV1::Synthesizing
            && receipt
                .synthesis_lease_deadline_unix_ms
                .is_some_and(|deadline| deadline <= now_ms)))
}

fn excerpt(result: &str) -> String {
    let mut end = result.len().min(EXCERPT_BYTES);
    while !result.is_char_boundary(end) {
        end -= 1;
    }
    result[..end].to_owned()
}

pub(super) fn retry(app: AppHandle, id: String) -> Result<RuntimeTaskProjectionV1, String> {
    load_receipts(&app)?;
    let (mut projection, _) = stored_success(&app, &id)?;
    let approved = receipt(&app, &id)?
        .ok_or_else(|| "This task has no approved automatic summary.".to_owned())?;
    let owner = delegation::owner(&app)?;
    let (relay_ref, community) = current_origin(&app)?;
    if approved.owner_pubkey != owner
        || approved.origin_relay_ref != relay_ref
        || approved.origin_community_id != community
        || approved.state != RuntimeTaskDeliveryStateV1::Retryable
    {
        return Err("This task summary cannot be retried in the current scope.".into());
    }
    store(&app)?
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?
        .requeue_owner_retry(&task_id(&id)?, now()?)
        .map_err(|error| error.to_string())?;
    schedule(app.clone(), id.clone(), true);
    decorate(&app, &mut projection);
    super::refresh_runtime_task_delivery(&app, &id);
    projection = memory()
        .lock()
        .map_err(|_| "Task state is unavailable.".to_owned())?
        .projections
        .get(&id)
        .cloned()
        .ok_or_else(|| "Task state is unavailable.".to_owned())?;
    Ok(projection)
}

pub(super) fn recover(app: &AppHandle) -> Result<usize, String> {
    load_receipts(app)?;
    let owner = delegation::owner(app)?;
    let rows = store(app)?
        .lock()
        .map_err(|_| "Task return state is unavailable.".to_owned())?
        .pending_for_recovery(&owner, MAX_RECOVERY_TASKS);
    let (scheduled, unavailable) = recover_rows(rows, |row| recover_row(app, row));
    if unavailable > 0 {
        luca_log!(info, "luca-runtime-tasks: {unavailable} retained return(s) could not be verified; unrelated returns were still recovered");
    }
    Ok(scheduled)
}

fn recover_rows(
    rows: Vec<RuntimeTaskDeliveryReceiptV1>,
    mut recover: impl FnMut(RuntimeTaskDeliveryReceiptV1) -> Result<bool, String>,
) -> (usize, usize) {
    let mut scheduled = 0;
    let mut unavailable = 0;
    for row in rows {
        match recover(row) {
            Ok(true) => scheduled += 1,
            Ok(false) => {}
            Err(_) => unavailable += 1,
        }
    }
    (scheduled, unavailable)
}

fn recover_row(app: &AppHandle, row: RuntimeTaskDeliveryReceiptV1) -> Result<bool, String> {
    if row.state == RuntimeTaskDeliveryStateV1::AwaitingResult {
        let task_state = memory()
            .lock()
            .map_err(|_| "Task state is unavailable.".to_owned())?
            .projections
            .get(row.task_id.as_str())
            .map(|task| task.state);
        if task_state == Some(RuntimeTaskStateV1::Succeeded) {
            completed(app, row.task_id.as_str())?;
            return Ok(true);
        }
        if task_state.is_some_and(|state| {
            matches!(
                state,
                RuntimeTaskStateV1::Failed
                    | RuntimeTaskStateV1::Stopped
                    | RuntimeTaskStateV1::Interrupted
            )
        }) {
            abandon(app, row.task_id.as_str());
        }
    } else if row.state == RuntimeTaskDeliveryStateV1::Synthesizing
        || claimable(&row, false, millis()?)
    {
        schedule(app.clone(), row.task_id.as_str().to_owned(), false);
        return Ok(true);
    }
    // Prepared/Submitted are exclusively the existing encrypted outbox's
    // responsibility, never a reason to run synthesis again.
    Ok(false)
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod tests;

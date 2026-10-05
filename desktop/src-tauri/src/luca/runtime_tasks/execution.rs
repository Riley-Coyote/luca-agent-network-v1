//! Desktop-owned workers: bounded input/output, correlated completion and cleanup.

use super::{host_events::HostEvent, host_io::BoundedHostLines, *};
use tokio::io::AsyncWriteExt as _;

const INPUT_TIMEOUT: Duration = Duration::from_secs(10);
const PIPE_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);
const REAP_TIMEOUT: Duration = Duration::from_secs(3);

/// The caller prepares the command before this synchronous ownership handoff.
/// No await separates spawn from registration and the independent worker.
pub(super) fn launch_owned_task(
    app: AppHandle,
    mut projection: RuntimeTaskProjectionV1,
    mut process: Command,
    encoded_input: Vec<u8>,
    retry_input: Option<StartRuntimeTaskInputV1>,
    permission_lease: Option<super::super::managed_permission::OwnedTaskPermissionLease>,
) -> Result<RuntimeTaskProjectionV1, String> {
    if app
        .state::<crate::app_state::AppState>()
        .shutdown_started
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("The app is shutting down. Nothing ran.".into());
    }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    let mut state = memory()
        .lock()
        .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
    if state.owner_pubkey.as_deref() != Some(projection.owner_pubkey.as_str())
        || delegation::owner(&app)?.as_str() != projection.owner_pubkey
    {
        return Err("Runtime task authority changed before dispatch. Nothing ran.".into());
    }
    delivery::ensure_current_scope(&app, &projection)?;
    if projection.operation == RuntimeTaskOperationV1::ContinueSession
        && state.projections.values().any(|task| {
            task.task_id != projection.task_id
                && task.owner_pubkey == projection.owner_pubkey
                && task.runtime_family == projection.runtime_family
                && task.provider_session_id == projection.provider_session_id
                && matches!(
                    task.state,
                    RuntimeTaskStateV1::Queued
                        | RuntimeTaskStateV1::Active
                        | RuntimeTaskStateV1::Stopping
                        | RuntimeTaskStateV1::Interrupted
                )
        })
    {
        return Err(
            "This exact session has active or uncertain Polyphonic work; review its receipt first."
                .into(),
        );
    }
    delivery::approve(&app, &mut projection, &encoded_input)?;
    let dispatched = storage::persist_before_dispatch(
        || persist_projection(&app, &projection),
        || {
            process
                .spawn()
                .map_err(|_| "The native runtime task host could not start.".to_owned())
        },
    );
    let mut child = match dispatched {
        Ok(child) => child,
        Err(error) => {
            // Spawn failure is not delivery uncertainty, but only a fresh
            // reviewed request may repeat it. Never save the task prompt.
            projection.state = RuntimeTaskStateV1::Failed;
            projection.current_step = None;
            projection.completed_at = Some(Utc::now().to_rfc3339());
            projection.updated_at = projection.completed_at.clone().unwrap_or_default();
            projection.error = Some(error.clone());
            projection.can_retry = false;
            drop(state);
            // This fails closed in memory as Interrupted if storage is lost.
            let _ = update_projection(&app, &projection);
            delivery::abandon(&app, &projection.task_id);
            return Err(error);
        }
    };
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(tokio::sync::Mutex::new(child));
    state
        .projections
        .insert(projection.task_id.clone(), projection.clone());
    if let Some(input) = retry_input {
        state.task_inputs.insert(projection.task_id.clone(), input);
    }
    state.running.insert(
        projection.task_id.clone(),
        RunningTask {
            cancel: cancel_tx,
            child: Arc::clone(&child),
            permission_scope: permission_lease.as_ref().map(|lease| lease.scope()),
        },
    );
    drop(state);
    emit_projection_in_scope(&app, &projection);
    let worker_projection = projection.clone();
    tauri::async_runtime::spawn(async move {
        run_owned_task(
            app,
            worker_projection,
            child,
            stdin,
            stdout,
            stderr,
            encoded_input,
            cancel_rx,
            permission_lease,
        )
        .await;
    });
    Ok(projection)
}

/// Only a still-owned, unreaped child handle supplies a PID for group shutdown.
/// Holding its mutex through signal/reap prevents PID reuse or concurrent kills.
pub(super) async fn stop_owned_child(child: &Arc<tokio::sync::Mutex<Child>>) -> bool {
    let mut child = child.lock().await;
    if let Some(pid) = child.id() {
        if !matches!(
            tauri::async_runtime::spawn_blocking(move || crate::managed_agents::terminate_process(
                pid
            ))
            .await,
            Ok(Ok(()))
        ) {
            return false;
        }
    }
    matches!(
        tokio::time::timeout(REAP_TIMEOUT, child.wait()).await,
        Ok(Ok(_))
    )
}

#[allow(clippy::too_many_arguments)]
async fn run_owned_task(
    app: AppHandle,
    mut projection: RuntimeTaskProjectionV1,
    child: Arc<tokio::sync::Mutex<Child>>,
    stdin: Option<tokio::process::ChildStdin>,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    encoded_input: Vec<u8>,
    mut cancel: watch::Receiver<bool>,
    _permission_lease: Option<super::super::managed_permission::OwnedTaskPermissionLease>,
) {
    let stderr_task = stderr.map(|mut stderr| {
        tauri::async_runtime::spawn(async move {
            // Fixed-size copy buffers; diagnostics never enter a task receipt.
            tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await
        })
    });
    let (Some(mut stdin), Some(stdout)) = (stdin, stdout) else {
        let cleaned = stop_owned_child(&child).await;
        settle_failure(
            &app,
            &mut projection,
            "The task host pipes were unavailable; no completion was verified.",
            cleaned,
            false,
        );
        finish_stderr(stderr_task).await;
        return;
    };
    let expected = (projection.operation == RuntimeTaskOperationV1::ContinueSession)
        .then_some(projection.provider_session_id.as_deref())
        .flatten();
    let mut evidence = match host_events::HostEvents::new(expected) {
        Ok(evidence) => evidence,
        Err(error) => {
            let cleaned = stop_owned_child(&child).await;
            settle_failure(&app, &mut projection, &error, cleaned, false);
            finish_stderr(stderr_task).await;
            return;
        }
    };
    let mut cancelled = *cancel.borrow();
    let input_ok = if cancelled {
        false
    } else {
        let delivery = async {
            stdin.write_all(&encoded_input).await?;
            stdin.shutdown().await
        };
        tokio::select! {
            biased;
            changed = cancel.changed() => {
                cancelled = changed.is_ok() && *cancel.borrow();
                false
            }
            delivered = tokio::time::timeout(INPUT_TIMEOUT, delivery) => {
                matches!(delivered, Ok(Ok(())))
            }
        }
    };
    // Shutdown/EOF above completes input before any provider may return a result.
    drop(stdin);
    if !input_ok {
        let cleaned = stop_owned_child(&child).await;
        settle_failure(&app, &mut projection, "Task input delivery could not be confirmed; inspect native work before another request.", cleaned, cancelled);
        finish_stderr(stderr_task).await;
        return;
    }
    projection.state = RuntimeTaskStateV1::Active;
    let runtime_name = runtime_label(&projection.runtime_family);
    advance_step(&mut projection, format!("Working in {runtime_name}"));
    if update_projection(&app, &projection).is_err() {
        let _ = stop_owned_child(&child).await;
        remove_running(&projection.task_id);
        finish_stderr(stderr_task).await;
        return;
    }
    let mut lines = BoundedHostLines::new(stdout, host_events::MAX_HOST_LINE_BYTES);
    let started = Instant::now();
    let mut end_seen_at = None;
    let mut output_closed = false;
    let mut exit_status = None;
    let mut failure = None;
    let mut cleanup_verified = true;
    let mut poll = tokio::time::interval(Duration::from_millis(100));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            biased;
            changed = cancel.changed() => {
                cancelled = changed.is_ok() && *cancel.borrow();
                failure = Some(if cancelled { "The owner stopped this task." } else { "Task control was interrupted." }.to_owned());
            }
            line = lines.next_line(), if !output_closed => {
                match line {
                    Ok(Some(line)) => {
                        match evidence.accept(&line) {
                            Ok(HostEvent::Session(id)) => {
                                if projection.provider_session_id.as_deref() != Some(id.as_str()) {
                                    projection.provider_session_id = Some(id);
                                    projection.updated_at = Utc::now().to_rfc3339();
                                    if update_projection(&app, &projection).is_err() { failure = Some(evidence.reject_stream()); }
                                }
                            }
                            Ok(HostEvent::Step(label)) => {
                                let mut changed = false;
                                if projection.provider_session_id.is_none() {
                                    projection.provider_session_id = evidence.provider_session_id().map(str::to_owned);
                                    changed = projection.provider_session_id.is_some();
                                }
                                if projection.current_step.as_deref() != Some(label.as_str()) {
                                    advance_step(&mut projection, label);
                                    changed = true;
                                }
                                if changed {
                                    projection.updated_at = Utc::now().to_rfc3339();
                                    if update_projection(&app, &projection).is_err() { failure = Some(evidence.reject_stream()); }
                                }
                            }
                            Ok(HostEvent::Result) => {}
                            Ok(HostEvent::Failed(error)) | Err(error) => failure = Some(error),
                        }
                    }
                    Ok(None) => { output_closed = true; end_seen_at.get_or_insert(Instant::now()); }
                    Err(_) => failure = Some(evidence.reject_stream()),
                }
            }
            _ = poll.tick() => {
                if started.elapsed() >= MAX_RUNTIME_TASK_DURATION {
                    failure = Some("The task reached Polyphonic's 24-hour beta limit.".into());
                }
            }
        }
        if started.elapsed() >= MAX_RUNTIME_TASK_DURATION {
            failure = Some("The task reached Polyphonic's 24-hour beta limit.".into());
        }
        if *cancel.borrow() {
            cancelled = true;
        }
        if failure.is_some() || cancelled {
            cleanup_verified = stop_owned_child(&child).await;
            break;
        }
        if exit_status.is_none() {
            match child.lock().await.try_wait() {
                Ok(Some(status)) => {
                    exit_status = Some(status);
                    end_seen_at.get_or_insert(Instant::now());
                }
                Ok(None) => {}
                Err(_) => {
                    failure = Some("The task host exit could not be verified.".into());
                    cleanup_verified = stop_owned_child(&child).await;
                    break;
                }
            }
        }
        if output_closed && exit_status.is_some() {
            break;
        }
        if end_seen_at.is_some_and(|instant| instant.elapsed() >= PIPE_CLOSE_TIMEOUT) {
            failure = Some("The task host output or exit could not be verified.".into());
            cleanup_verified = stop_owned_child(&child).await;
            break;
        }
    }
    // Drain trailing buffered stdout before finish; exit zero alone proves nothing.
    let outcome = match failure {
        Some(error) => Err(error),
        None if cancelled => Err("The owner stopped this task.".into()),
        None => {
            evidence.finish(output_closed && exit_status.is_some_and(|status| status.success()))
        }
    };
    match outcome {
        Ok(result) => {
            let result = result
                .filter(|body| !body.trim().is_empty())
                .unwrap_or_else(|| {
                    "The runtime reported completion without a textual result.".into()
                });
            if persist_result(&app, &projection.task_id, &result).is_err() {
                settle_failure(
                    &app,
                    &mut projection,
                    "The verified result could not be saved. No replacement task will be started.",
                    false,
                    false,
                );
            } else {
                projection.state = RuntimeTaskStateV1::Succeeded;
                projection.error = None;
                finish_active_step(&mut projection, "done");
                finish_projection(&mut projection);
                if update_projection(&app, &projection).is_ok() {
                    if let Ok(mut state) = memory().lock() {
                        state.results.insert(projection.task_id.clone(), result);
                    }
                    let _ = delivery::completed(&app, &projection.task_id);
                } else {
                    let stopping = memory().lock().is_ok_and(|state| {
                        state
                            .projections
                            .get(&projection.task_id)
                            .is_some_and(|current| current.state == RuntimeTaskStateV1::Stopping)
                    });
                    if stopping {
                        settle_failure(
                            &app,
                            &mut projection,
                            "The owner stopped this task.",
                            true,
                            true,
                        );
                    } else {
                        delivery::abandon(&app, &projection.task_id);
                    }
                }
                remove_running(&projection.task_id);
            }
        }
        Err(error) => settle_failure(&app, &mut projection, &error, cleanup_verified, cancelled),
    }
    finish_stderr(stderr_task).await;
}

fn finish_projection(projection: &mut RuntimeTaskProjectionV1) {
    let now = Utc::now().to_rfc3339();
    projection.updated_at = now.clone();
    projection.completed_at = Some(now);
    projection.current_step = None;
    projection.can_retry = false;
}

fn settle_failure(
    app: &AppHandle,
    projection: &mut RuntimeTaskProjectionV1,
    error: &str,
    cleanup_verified: bool,
    cancelled: bool,
) {
    projection.state = if !cleanup_verified
        || app
            .state::<crate::app_state::AppState>()
            .shutdown_started
            .load(std::sync::atomic::Ordering::Acquire)
    {
        RuntimeTaskStateV1::Interrupted
    } else if cancelled {
        RuntimeTaskStateV1::Stopped
    } else {
        RuntimeTaskStateV1::Failed
    };
    projection.error = if cancelled && cleanup_verified {
        None
    } else {
        Some(error.to_owned())
    };
    finish_active_step(projection, "failed");
    finish_projection(projection);
    let _ = update_projection(app, projection);
    delivery::abandon(app, &projection.task_id);
    remove_running(&projection.task_id);
}

fn remove_running(task_id: &str) {
    let permission_scope = if let Ok(mut state) = memory().lock() {
        let permission_scope = state
            .running
            .remove(task_id)
            .and_then(|running| running.permission_scope);
        state.task_inputs.remove(task_id);
        permission_scope
    } else {
        None
    };
    if let Some(scope) = permission_scope {
        scope.cancel();
    }
}

async fn finish_stderr(
    task: Option<tauri::async_runtime::JoinHandle<Result<u64, std::io::Error>>>,
) {
    if let Some(mut task) = task {
        if tokio::time::timeout(PIPE_CLOSE_TIMEOUT, &mut task)
            .await
            .is_err()
        {
            task.abort();
        }
    }
}

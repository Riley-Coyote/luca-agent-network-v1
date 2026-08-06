//! Durable body-free jobs for the V1 resident handoff loop.

use std::{path::Path, time::Duration};

use luca_protocol::{
    derive_continuity_job_idempotency_key, CanonicalTimestamp, ContinuityJobStateV1,
    ContinuityJobV1, ContinuityResidentRoleV1, LocalContinuityCognitionOutcomeV1,
    LocalContinuityCognitionRequestV1, OpaqueId, ResidentContinuityModeV1, SafeU53, Sha256Ref,
    CONTINUITY_PROTOCOL, MAX_CONTINUITY_PACKET_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

use super::continuity_runtime::{
    ResidentHandoffCommitKindV1, ResidentHandoffCommitOutcomeV1, ResidentHandoffCommitRequestV1,
};

const JOB_FILENAME: &str = "handoff-jobs-v1.sqlite3";
const JOB_KIND: &str = "resident_handoff";
const MAX_ATTEMPTS: u64 = 2;
const IDLE_DELAY: Duration = Duration::from_secs(2);
const RETRY_DELAY: Duration = Duration::from_secs(3);
const COGNITION_DEADLINE: Duration = Duration::from_secs(90);

pub(crate) fn current_canonical_timestamp() -> Result<CanonicalTimestamp, String> {
    CanonicalTimestamp::parse(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| "create canonical continuity timestamp".to_owned())
}

#[derive(Clone, Debug)]
pub(crate) struct FinalizedHandoffJob {
    pub(crate) job: ContinuityJobV1,
    pub(crate) conversation_id: OpaqueId,
    pub(crate) binding_ref: Sha256Ref,
    pub(crate) attempt_count: u64,
}

/// Body-free resident inspector projection. Private handoff text is never
/// stored in or returned by the job database.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResidentHandoffJobStatusV1 {
    pub(crate) job_id: OpaqueId,
    pub(crate) state: String,
    pub(crate) last_error_code: Option<String>,
    pub(crate) updated_at: String,
    pub(crate) can_retry: bool,
}

pub(crate) fn enqueue_finalized(
    app: &AppHandle,
    publish_request: &luca_protocol::ManagedMessagePublishRequestV1,
    source_event_id: &luca_protocol::Hex64,
    binding_ref: &Sha256Ref,
) -> Result<Option<OpaqueId>, String> {
    if continuity_mode(
        app,
        &publish_request.owner_pubkey,
        &publish_request.resident_pubkey,
    )? == ResidentContinuityModeV1::Disabled
    {
        return Ok(None);
    }
    let idempotency_key = derive_continuity_job_idempotency_key(
        &publish_request.owner_pubkey,
        &publish_request.resident_pubkey,
        source_event_id,
        ContinuityResidentRoleV1::Primary,
    )
    .map_err(|_| "derive handoff job identity".to_owned())?;
    let job_id = OpaqueId::parse(idempotency_key.as_str().to_owned())
        .map_err(|_| "derive handoff job identifier".to_owned())?;
    let created_at = current_canonical_timestamp()?;
    let job = ContinuityJobV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        job_id: job_id.clone(),
        idempotency_key,
        owner_pubkey: publish_request.owner_pubkey.clone(),
        resident_pubkey: publish_request.resident_pubkey.clone(),
        source_event_id: source_event_id.clone(),
        resident_role: ContinuityResidentRoleV1::Primary,
        job_kind: OpaqueId::parse(JOB_KIND.to_owned())
            .map_err(|_| "create handoff job kind".to_owned())?,
        state: ContinuityJobStateV1::Pending,
        created_at,
    };
    job.validate()
        .map_err(|_| "validate handoff job".to_owned())?;
    let path = job_store_path(app)?;
    let connection = open_store(&path)?;
    connection
        .execute(
            "INSERT INTO handoff_jobs (
                job_id, idempotency_key, owner_pubkey, resident_pubkey,
                source_event_id, conversation_id, binding_ref, state,
                attempt_count, last_error_code, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, NULL, ?8, ?8)
             ON CONFLICT(idempotency_key) DO NOTHING",
            params![
                job.job_id.as_str(),
                job.idempotency_key.as_str(),
                job.owner_pubkey.as_str(),
                job.resident_pubkey.as_str(),
                job.source_event_id.as_str(),
                publish_request.conversation_id.as_str(),
                binding_ref.as_str(),
                job.created_at.as_str(),
            ],
        )
        .map_err(|_| "persist handoff job".to_owned())?;
    spawn_job(app.clone(), job_id.clone(), IDLE_DELAY);
    Ok(Some(job_id))
}

/// Recover body-free jobs after managed residents have been restored. Any job
/// that was running when the process exited becomes pending without resetting
/// its attempt count, so the total retry ceiling remains authoritative.
pub(crate) fn recover_pending(app: &AppHandle) -> Result<usize, String> {
    let connection = open_store(&job_store_path(app)?)?;
    let ids = recover_store(&connection)?;
    for job_id in &ids {
        spawn_job(app.clone(), job_id.clone(), IDLE_DELAY);
    }
    Ok(ids.len())
}

fn recover_store(connection: &Connection) -> Result<Vec<OpaqueId>, String> {
    connection
        .execute(
            "UPDATE handoff_jobs
             SET state = 'pending', last_error_code = 'interrupted_restart', updated_at = ?1
             WHERE state = 'running' AND attempt_count < ?2",
            params![chrono::Utc::now().to_rfc3339(), MAX_ATTEMPTS],
        )
        .map_err(|_| "recover interrupted handoff jobs".to_owned())?;
    connection
        .execute(
            "UPDATE handoff_jobs
             SET state = 'failed', last_error_code = 'retry_limit', updated_at = ?1
             WHERE state = 'running' AND attempt_count >= ?2",
            params![chrono::Utc::now().to_rfc3339(), MAX_ATTEMPTS],
        )
        .map_err(|_| "terminalize exhausted handoff jobs".to_owned())?;
    let mut statement = connection
        .prepare(
            "SELECT job_id FROM handoff_jobs
             WHERE state = 'pending' AND attempt_count < ?1 ORDER BY created_at ASC",
        )
        .map_err(|_| "prepare handoff recovery query".to_owned())?;
    let ids = statement
        .query_map([MAX_ATTEMPTS], |row| row.get::<_, String>(0))
        .map_err(|_| "query pending handoff jobs".to_owned())?
        .filter_map(Result::ok)
        .filter_map(|value| OpaqueId::parse(value).ok())
        .collect::<Vec<_>>();
    Ok(ids)
}

pub(crate) fn continuity_mode(
    app: &AppHandle,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<ResidentContinuityModeV1, String> {
    let connection = open_store(&job_store_path(app)?)?;
    mode_from_store(&connection, owner_pubkey, resident_pubkey)
}

pub(crate) fn set_continuity_mode(
    app: &AppHandle,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
    mode: ResidentContinuityModeV1,
) -> Result<(), String> {
    let mut connection = open_store(&job_store_path(app)?)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "set resident continuity mode".to_owned())?;
    set_mode_in_store(&transaction, owner_pubkey, resident_pubkey, mode)?;
    transaction
        .commit()
        .map_err(|_| "commit resident continuity mode".to_owned())
}

pub(crate) fn latest_job_status(
    app: &AppHandle,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<Option<ResidentHandoffJobStatusV1>, String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .query_row(
            "SELECT job_id, state, last_error_code, updated_at, manual_retry_count
             FROM handoff_jobs
             WHERE owner_pubkey = ?1 AND resident_pubkey = ?2
             ORDER BY updated_at DESC, created_at DESC LIMIT 1",
            params![owner_pubkey.as_str(), resident_pubkey.as_str()],
            |row| {
                let job_id = row.get::<_, String>(0)?;
                let state = row.get::<_, String>(1)?;
                let last_error_code = row.get::<_, Option<String>>(2)?;
                let updated_at = row.get::<_, String>(3)?;
                let manual_retry_count = row.get::<_, u64>(4)?;
                Ok((
                    job_id,
                    state,
                    last_error_code,
                    updated_at,
                    manual_retry_count,
                ))
            },
        )
        .optional()
        .map_err(|_| "load resident handoff job status".to_owned())?
        .map(
            |(job_id, state, last_error_code, updated_at, manual_retry_count)| {
                Ok(ResidentHandoffJobStatusV1 {
                    job_id: OpaqueId::parse(job_id)
                        .map_err(|_| "invalid resident handoff job status".to_owned())?,
                    can_retry: state == "failed" && manual_retry_count == 0,
                    state,
                    last_error_code,
                    updated_at,
                })
            },
        )
        .transpose()
}

/// Allow exactly one explicit owner retry for the latest failed job. Runtime
/// retry ceilings remain independent and cannot be reset repeatedly.
pub(crate) fn retry_latest_failed(
    app: &AppHandle,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<Option<OpaqueId>, String> {
    if continuity_mode(app, owner_pubkey, resident_pubkey)? != ResidentContinuityModeV1::Enabled {
        return Err("continuity is disabled for this resident".to_owned());
    }
    let mut connection = open_store(&job_store_path(app)?)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "retry resident handoff job".to_owned())?;
    let job_id = retry_latest_failed_in_store(&transaction, owner_pubkey, resident_pubkey)?;
    transaction
        .commit()
        .map_err(|_| "commit resident handoff retry".to_owned())?;
    let Some(job_id) = job_id else {
        return Ok(None);
    };
    spawn_job(app.clone(), job_id.clone(), RETRY_DELAY);
    Ok(Some(job_id))
}

fn retry_latest_failed_in_store(
    transaction: &rusqlite::Transaction<'_>,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<Option<OpaqueId>, String> {
    let job_id = transaction
        .query_row(
            "SELECT job_id FROM handoff_jobs
             WHERE owner_pubkey = ?1 AND resident_pubkey = ?2
               AND state = 'failed' AND manual_retry_count = 0
             ORDER BY updated_at DESC, created_at DESC LIMIT 1",
            params![owner_pubkey.as_str(), resident_pubkey.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "load failed resident handoff job".to_owned())?;
    let Some(job_id) = job_id else {
        return Ok(None);
    };
    let changed = transaction
        .execute(
            "UPDATE handoff_jobs
             SET state = 'pending', attempt_count = 0, manual_retry_count = 1,
                 last_error_code = 'manual_retry_requested', updated_at = ?2
             WHERE job_id = ?1 AND state = 'failed' AND manual_retry_count = 0",
            params![job_id, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "schedule resident handoff retry".to_owned())?;
    if changed != 1 {
        return Err("resident handoff retry conflict".to_owned());
    }
    let job_id = OpaqueId::parse(job_id)
        .map_err(|_| "invalid resident handoff job identifier".to_owned())?;
    Ok(Some(job_id))
}

/// Cancel work anchored before an explicit owner forget. Future finalized
/// responses may create a new handoff because the resident mode is unchanged.
pub(crate) fn cancel_active_for_forget(
    app: &AppHandle,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<usize, String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE handoff_jobs
             SET state = 'cancelled', last_error_code = 'owner_forgot_handoff', updated_at = ?3
             WHERE owner_pubkey = ?1 AND resident_pubkey = ?2
               AND state IN ('pending','running')",
            params![
                owner_pubkey.as_str(),
                resident_pubkey.as_str(),
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|_| "cancel resident handoff jobs for forget".to_owned())
}

fn set_mode_in_store(
    transaction: &rusqlite::Transaction<'_>,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
    mode: ResidentContinuityModeV1,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO resident_continuity_modes (owner_pubkey, resident_pubkey, mode, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, resident_pubkey) DO UPDATE SET
                mode = excluded.mode, updated_at = excluded.updated_at",
            params![
                owner_pubkey.as_str(),
                resident_pubkey.as_str(),
                mode_name(mode),
                chrono::Utc::now().to_rfc3339(),
            ],
        )
        .map_err(|_| "persist resident continuity mode".to_owned())?;
    if mode == ResidentContinuityModeV1::Disabled {
        transaction
            .execute(
                "UPDATE handoff_jobs
                 SET state = 'cancelled', last_error_code = 'continuity_disabled', updated_at = ?3
                 WHERE owner_pubkey = ?1 AND resident_pubkey = ?2
                   AND state IN ('pending','running')",
                params![
                    owner_pubkey.as_str(),
                    resident_pubkey.as_str(),
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .map_err(|_| "cancel disabled continuity jobs".to_owned())?;
    }
    Ok(())
}

fn spawn_job(app: AppHandle, job_id: OpaqueId, delay: Duration) {
    let _ = std::thread::Builder::new()
        .name("luca-handoff-job".into())
        .spawn(move || {
            std::thread::sleep(delay);
            execute_job(&app, &job_id);
        });
}

fn execute_job(app: &AppHandle, job_id: &OpaqueId) {
    let job = match claim_job(app, job_id) {
        Ok(Some(job)) => job,
        Ok(None) | Err(_) => return,
    };
    if continuity_mode(app, &job.job.owner_pubkey, &job.job.resident_pubkey)
        != Ok(ResidentContinuityModeV1::Enabled)
    {
        let _ = transition_terminal(app, &job, "cancelled", "continuity_disabled");
        return;
    }
    let now = unix_time_millis();
    let deadline = now.saturating_add(COGNITION_DEADLINE.as_millis() as u64);
    let request = LocalContinuityCognitionRequestV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        job_id: job.job.job_id.clone(),
        owner_pubkey: job.job.owner_pubkey.clone(),
        resident_pubkey: job.job.resident_pubkey.clone(),
        conversation_id: job.conversation_id.clone(),
        source_event_id: job.job.source_event_id.clone(),
        binding_ref: job.binding_ref.clone(),
        deadline_unix_ms: match SafeU53::new(deadline) {
            Ok(value) => value,
            Err(_) => {
                let _ = fail_job(app, &job, "invalid_deadline", false);
                return;
            }
        },
        max_result_bytes: match SafeU53::new(MAX_CONTINUITY_PACKET_BYTES as u64) {
            Ok(value) => value,
            Err(_) => {
                let _ = fail_job(app, &job, "invalid_result_budget", false);
                return;
            }
        },
    };
    let result = match super::managed_cognition::request(&request) {
        Ok(result) => result,
        Err(super::managed_cognition::ManagedCognitionError::Invalid) => {
            let _ = fail_job(app, &job, "invalid_request_or_result", false);
            return;
        }
        Err(super::managed_cognition::ManagedCognitionError::Timeout) => {
            retry_or_fail(app, &job, "runtime_timeout");
            return;
        }
        Err(super::managed_cognition::ManagedCognitionError::Unavailable) => {
            retry_or_fail(app, &job, "runtime_unavailable");
            return;
        }
    };
    match result.result {
        LocalContinuityCognitionOutcomeV1::NoChange => {
            let _ = complete_job(app, &job, "no_change");
        }
        LocalContinuityCognitionOutcomeV1::Handoff { handoff } => {
            if continuity_mode(app, &job.job.owner_pubkey, &job.job.resident_pubkey)
                != Ok(ResidentContinuityModeV1::Enabled)
                || !job_is_running(app, &job)
            {
                let _ = transition_terminal(app, &job, "cancelled", "continuity_preempted");
                return;
            }
            let state = app.state::<AppState>();
            let commit = state.commit_resident_handoff(ResidentHandoffCommitRequestV1 {
                owner_pubkey: job.job.owner_pubkey.clone(),
                resident_pubkey: job.job.resident_pubkey.clone(),
                source_event_id: job.job.source_event_id.clone(),
                request_id: job.job.job_id.clone(),
                kind: ResidentHandoffCommitKindV1::ResidentAutomatic,
                handoff,
            });
            match commit {
                ResidentHandoffCommitOutcomeV1::Committed(_) => {
                    let _ = complete_job(app, &job, "handoff_committed");
                }
                // A pinned owner correction intentionally wins. The automatic
                // job is terminal without changing the effective handoff.
                ResidentHandoffCommitOutcomeV1::Stale => {
                    let _ = complete_job(app, &job, "owner_correction_preserved");
                }
                ResidentHandoffCommitOutcomeV1::Locked
                | ResidentHandoffCommitOutcomeV1::Unavailable => {
                    retry_or_fail(app, &job, "continuity_unavailable");
                }
                ResidentHandoffCommitOutcomeV1::Invalid => {
                    let _ = fail_job(app, &job, "invalid_handoff", false);
                }
            }
        }
    }
}

fn job_is_running(app: &AppHandle, job: &FinalizedHandoffJob) -> bool {
    let Ok(path) = job_store_path(app) else {
        return false;
    };
    let Ok(connection) = open_store(&path) else {
        return false;
    };
    connection
        .query_row(
            "SELECT 1 FROM handoff_jobs
             WHERE job_id = ?1 AND state = 'running' AND attempt_count = ?2",
            params![job.job.job_id.as_str(), job.attempt_count],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
}

fn retry_or_fail(app: &AppHandle, job: &FinalizedHandoffJob, code: &'static str) {
    let retry = job.attempt_count < MAX_ATTEMPTS;
    if fail_job(app, job, code, retry).is_ok() && retry {
        spawn_job(app.clone(), job.job.job_id.clone(), RETRY_DELAY);
    }
}

fn claim_job(app: &AppHandle, job_id: &OpaqueId) -> Result<Option<FinalizedHandoffJob>, String> {
    let path = job_store_path(app)?;
    let mut connection = open_store(&path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "claim handoff job".to_owned())?;
    let row = transaction
        .query_row(
            "SELECT idempotency_key, owner_pubkey, resident_pubkey,
                    source_event_id, conversation_id, binding_ref,
                    attempt_count, created_at
             FROM handoff_jobs WHERE job_id = ?1 AND state = 'pending'",
            [job_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, u64>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "load handoff job".to_owned())?;
    let Some((idempotency, owner, resident, source, conversation, binding, attempts, created)) =
        row
    else {
        return Ok(None);
    };
    let attempt_count = attempts.saturating_add(1);
    let updated = chrono::Utc::now().to_rfc3339();
    let changed = transaction
        .execute(
            "UPDATE handoff_jobs
             SET state = 'running', attempt_count = ?2, last_error_code = NULL, updated_at = ?3
             WHERE job_id = ?1 AND state = 'pending'",
            params![job_id.as_str(), attempt_count, updated],
        )
        .map_err(|_| "claim handoff job".to_owned())?;
    if changed != 1 {
        return Ok(None);
    }
    transaction
        .commit()
        .map_err(|_| "commit handoff job claim".to_owned())?;
    let job = ContinuityJobV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        job_id: job_id.clone(),
        idempotency_key: luca_protocol::Hex64::parse(idempotency)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        owner_pubkey: luca_protocol::Hex64::parse(owner)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        resident_pubkey: luca_protocol::Hex64::parse(resident)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        source_event_id: luca_protocol::Hex64::parse(source)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        resident_role: ContinuityResidentRoleV1::Primary,
        job_kind: OpaqueId::parse(JOB_KIND.to_owned())
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        state: ContinuityJobStateV1::Running,
        created_at: CanonicalTimestamp::parse(created)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
    };
    job.validate()
        .map_err(|_| "invalid stored handoff job".to_owned())?;
    Ok(Some(FinalizedHandoffJob {
        job,
        conversation_id: OpaqueId::parse(conversation)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        binding_ref: Sha256Ref::parse(binding)
            .map_err(|_| "invalid stored handoff job".to_owned())?,
        attempt_count,
    }))
}

fn complete_job(app: &AppHandle, job: &FinalizedHandoffJob, code: &str) -> Result<(), String> {
    transition_terminal(app, job, "completed", code)
}

fn fail_job(
    app: &AppHandle,
    job: &FinalizedHandoffJob,
    code: &str,
    retry: bool,
) -> Result<(), String> {
    transition_terminal(app, job, if retry { "pending" } else { "failed" }, code)
}

fn transition_terminal(
    app: &AppHandle,
    job: &FinalizedHandoffJob,
    state: &str,
    code: &str,
) -> Result<(), String> {
    let connection = open_store(&job_store_path(app)?)?;
    let changed = connection
        .execute(
            "UPDATE handoff_jobs SET state = ?2, last_error_code = ?3, updated_at = ?4
             WHERE job_id = ?1 AND state = 'running' AND attempt_count = ?5",
            params![
                job.job.job_id.as_str(),
                state,
                code,
                chrono::Utc::now().to_rfc3339(),
                job.attempt_count,
            ],
        )
        .map_err(|_| "update handoff job".to_owned())?;
    if changed == 1 {
        Ok(())
    } else {
        Err("handoff job transition conflict".to_owned())
    }
}

fn job_store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "resolve continuity job directory".to_owned())?
        .join("continuity");
    reject_symlink(&directory)?;
    std::fs::create_dir_all(&directory)
        .map_err(|_| "create continuity job directory".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "secure continuity job directory".to_owned())?;
    }
    let path = directory.join(JOB_FILENAME);
    reject_symlink(&path)?;
    Ok(path)
}

fn open_store(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|_| "open continuity job store".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "secure continuity job store".to_owned())?;
    }
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS handoff_jobs (
                job_id TEXT PRIMARY KEY NOT NULL,
                idempotency_key TEXT UNIQUE NOT NULL,
                owner_pubkey TEXT NOT NULL,
                resident_pubkey TEXT NOT NULL,
                source_event_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                binding_ref TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('pending','running','completed','cancelled','failed')),
                attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
                manual_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(manual_retry_count IN (0, 1)),
                last_error_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS resident_continuity_modes (
                owner_pubkey TEXT NOT NULL,
                resident_pubkey TEXT NOT NULL,
                mode TEXT NOT NULL CHECK(mode IN ('enabled','disabled')),
                updated_at TEXT NOT NULL,
                PRIMARY KEY(owner_pubkey, resident_pubkey)
             );",
        )
        .map_err(|_| "initialize continuity job store".to_owned())?;
    ensure_manual_retry_column(&connection)?;
    Ok(connection)
}

fn ensure_manual_retry_column(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("PRAGMA table_info(handoff_jobs)")
        .map_err(|_| "inspect continuity job store".to_owned())?;
    let has_column = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "inspect continuity job store".to_owned())?
        .filter_map(Result::ok)
        .any(|name| name == "manual_retry_count");
    drop(statement);
    if !has_column {
        connection
            .execute(
                "ALTER TABLE handoff_jobs ADD COLUMN manual_retry_count INTEGER NOT NULL DEFAULT 0 CHECK(manual_retry_count IN (0, 1))",
                [],
            )
            .map_err(|_| "migrate continuity job store".to_owned())?;
    }
    Ok(())
}

fn mode_from_store(
    connection: &Connection,
    owner_pubkey: &luca_protocol::Hex64,
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<ResidentContinuityModeV1, String> {
    let stored = connection
        .query_row(
            "SELECT mode FROM resident_continuity_modes
             WHERE owner_pubkey = ?1 AND resident_pubkey = ?2",
            params![owner_pubkey.as_str(), resident_pubkey.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "load resident continuity mode".to_owned())?;
    match stored.as_deref() {
        None | Some("enabled") => Ok(ResidentContinuityModeV1::Enabled),
        Some("disabled") => Ok(ResidentContinuityModeV1::Disabled),
        Some(_) => Err("invalid resident continuity mode".to_owned()),
    }
}

fn mode_name(mode: ResidentContinuityModeV1) -> &'static str {
    match mode {
        ResidentContinuityModeV1::Enabled => "enabled",
        ResidentContinuityModeV1::Disabled => "disabled",
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)] // Small filesystem helpers below are shared by production paths.
mod tests {
    use super::*;

    fn key(character: char) -> luca_protocol::Hex64 {
        luca_protocol::Hex64::parse(character.to_string().repeat(64)).unwrap()
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value.to_owned()).unwrap()
    }

    #[test]
    fn continuity_mode_defaults_enabled_and_disable_cancels_only_matching_jobs() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("jobs.sqlite3");
        let mut store = open_store(&path).unwrap();
        let owner = key('a');
        let resident = key('b');
        let other = key('c');
        assert_eq!(
            mode_from_store(&store, &owner, &resident).unwrap(),
            ResidentContinuityModeV1::Enabled
        );
        for (job_id, target) in [("job-one", &resident), ("job-two", &other)] {
            store
                .execute(
                    "INSERT INTO handoff_jobs (
                        job_id, idempotency_key, owner_pubkey, resident_pubkey,
                        source_event_id, conversation_id, binding_ref, state,
                        attempt_count, manual_retry_count, last_error_code, created_at, updated_at
                     ) VALUES
                     (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', 0, 0, NULL, ?8, ?8)",
                    params![
                        job_id,
                        key(if job_id == "job-one" { 'd' } else { 'e' }).as_str(),
                        owner.as_str(),
                        target.as_str(),
                        key('f').as_str(),
                        "conversation",
                        format!("sha256:{}", key('1').as_str()),
                        "2026-08-05T00:00:00Z",
                    ],
                )
                .unwrap();
        }
        let transaction = store
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        set_mode_in_store(
            &transaction,
            &owner,
            &resident,
            ResidentContinuityModeV1::Disabled,
        )
        .unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            mode_from_store(&store, &owner, &resident).unwrap(),
            ResidentContinuityModeV1::Disabled
        );
        let matching: String = store
            .query_row(
                "SELECT state FROM handoff_jobs WHERE job_id = 'job-one'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let unrelated: String = store
            .query_row(
                "SELECT state FROM handoff_jobs WHERE job_id = 'job-two'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(matching, "cancelled");
        assert_eq!(unrelated, "pending");
    }

    #[test]
    fn restart_recovery_preserves_retry_ceiling_and_body_free_schema() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("jobs.sqlite3");
        let store = open_store(&path).unwrap();
        for (job_id, attempts) in [("recoverable", 1_u64), ("exhausted", 2_u64)] {
            store
                .execute(
                    "INSERT INTO handoff_jobs (
                        job_id, idempotency_key, owner_pubkey, resident_pubkey,
                        source_event_id, conversation_id, binding_ref, state,
                        attempt_count, manual_retry_count, last_error_code, created_at, updated_at
                     ) VALUES
                     (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8, 0, NULL, ?9, ?9)",
                    params![
                        job_id,
                        key(if attempts == 1 { '2' } else { '3' }).as_str(),
                        key('a').as_str(),
                        key('b').as_str(),
                        key('c').as_str(),
                        "conversation",
                        format!("sha256:{}", key('4').as_str()),
                        attempts,
                        "2026-08-05T00:00:00Z",
                    ],
                )
                .unwrap();
        }
        assert_eq!(recover_store(&store).unwrap(), vec![id("recoverable")]);
        let states = store
            .prepare("SELECT job_id, state, attempt_count FROM handoff_jobs ORDER BY job_id")
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            states,
            vec![
                ("exhausted".into(), "failed".into(), 2),
                ("recoverable".into(), "pending".into(), 1),
            ]
        );
        let bytes = std::fs::read(path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("private handoff text"));
    }

    #[test]
    fn owner_can_retry_latest_failed_job_exactly_once() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("jobs.sqlite3");
        let mut store = open_store(&path).unwrap();
        let owner = key('a');
        let resident = key('b');
        store
            .execute(
                "INSERT INTO handoff_jobs (
                    job_id, idempotency_key, owner_pubkey, resident_pubkey,
                    source_event_id, conversation_id, binding_ref, state,
                    attempt_count, manual_retry_count, last_error_code, created_at, updated_at
                 ) VALUES
                 (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'failed', 2, 0, 'runtime_failed', ?8, ?8)",
                params![
                    "retry-once",
                    key('c').as_str(),
                    owner.as_str(),
                    resident.as_str(),
                    key('d').as_str(),
                    "conversation",
                    format!("sha256:{}", key('e').as_str()),
                    "2026-08-05T00:00:00Z",
                ],
            )
            .unwrap();

        let transaction = store
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert_eq!(
            retry_latest_failed_in_store(&transaction, &owner, &resident).unwrap(),
            Some(id("retry-once"))
        );
        transaction.commit().unwrap();

        let transaction = store
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert_eq!(
            retry_latest_failed_in_store(&transaction, &owner, &resident).unwrap(),
            None
        );
        transaction.commit().unwrap();

        let state: (String, u64, u64, String) = store
            .query_row(
                "SELECT state, attempt_count, manual_retry_count, last_error_code
                 FROM handoff_jobs WHERE job_id = 'retry-once'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            state,
            (
                "pending".to_owned(),
                0,
                1,
                "manual_retry_requested".to_owned(),
            )
        );
    }

    #[test]
    fn current_timestamp_matches_the_frozen_protocol_shape() {
        let timestamp = current_canonical_timestamp().expect("canonical timestamp");
        assert_eq!(timestamp.as_str().len(), 20);
        assert!(timestamp.as_str().ends_with('Z'));
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("continuity job path must not be a symlink".to_owned())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("inspect continuity job path".to_owned()),
    }
}

fn unix_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

//! Durable body-free job state for manually initiated resident journal work.
//!
//! Prompts and selected page bodies exist only in process memory. A restart
//! terminalizes unfinished work rather than persisting notebook plaintext in a
//! scheduler database.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    CreateResidentJournalPageOutcomeV1, CreateResidentJournalPageRequestV1, Hex64, OpaqueId,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

use super::{
    managed_cognition,
    resident_notebook::{
        ResidentJournalCommitRequestV1, ResidentNotebookMutationOutcomeV1,
    },
};

const JOB_FILENAME: &str = "journal-jobs-v1.sqlite3";
const MAX_ATTEMPTS: u64 = 2;
const RETRY_DELAY: Duration = Duration::from_secs(3);

#[derive(Clone)]
struct JournalJobPayload {
    request: CreateResidentJournalPageRequestV1,
    target_page_id: Option<OpaqueId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResidentJournalJobStatusV1 {
    pub(crate) job_id: OpaqueId,
    pub(crate) state: String,
    pub(crate) last_error_code: Option<String>,
    pub(crate) updated_at: String,
    pub(crate) can_cancel: bool,
    pub(crate) can_retry: bool,
}

fn payloads() -> &'static Mutex<HashMap<String, JournalJobPayload>> {
    static PAYLOADS: OnceLock<Mutex<HashMap<String, JournalJobPayload>>> = OnceLock::new();
    PAYLOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn enqueue(
    app: &AppHandle,
    request: CreateResidentJournalPageRequestV1,
    target_page_id: Option<OpaqueId>,
) -> Result<ResidentJournalJobStatusV1, String> {
    request
        .validate()
        .map_err(|_| "invalid resident journal request".to_owned())?;
    let job_id = request.job_id.clone();
    let created_at = chrono::Utc::now().to_rfc3339();
    {
        let mut values = payloads()
            .lock()
            .map_err(|_| "resident journal scheduler is unavailable".to_owned())?;
        if values.contains_key(job_id.as_str()) {
            return Err("resident journal job already exists".to_owned());
        }
        values.insert(
            job_id.as_str().to_owned(),
            JournalJobPayload {
                request: request.clone(),
                target_page_id: target_page_id.clone(),
            },
        );
    }
    let connection = open_store(&job_store_path(app)?)?;
    let persisted = connection.execute(
        "INSERT INTO journal_jobs (
            job_id, owner_pubkey, resident_pubkey, binding_ref,
            conversation_id, target_page_id, state, attempt_count,
            manual_retry_count, last_error_code, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, 0, NULL, ?7, ?7)",
        params![
            job_id.as_str(),
            request.owner_pubkey.as_str(),
            request.resident_pubkey.as_str(),
            request.binding_ref.as_str(),
            request.conversation_id.as_ref().map(OpaqueId::as_str),
            target_page_id.as_ref().map(OpaqueId::as_str),
            created_at,
        ],
    );
    if persisted.is_err() {
        if let Ok(mut values) = payloads().lock() {
            values.remove(job_id.as_str());
        }
        return Err("persist resident journal job".to_owned());
    }
    spawn_job(app.clone(), job_id.clone(), Duration::ZERO);
    status_by_id(app, &job_id)?.ok_or_else(|| "resident journal job disappeared".to_owned())
}

pub(crate) fn latest_status(
    app: &AppHandle,
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
) -> Result<Option<ResidentJournalJobStatusV1>, String> {
    let connection = open_store(&job_store_path(app)?)?;
    let job_id = connection
        .query_row(
            "SELECT job_id FROM journal_jobs
             WHERE owner_pubkey = ?1 AND resident_pubkey = ?2
             ORDER BY updated_at DESC, created_at DESC LIMIT 1",
            params![owner_pubkey.as_str(), resident_pubkey.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "load resident journal job".to_owned())?;
    job_id
        .map(|value| {
            OpaqueId::parse(value)
                .map_err(|_| "invalid resident journal job identifier".to_owned())
                .and_then(|job_id| status_by_id(app, &job_id))
        })
        .transpose()
        .map(Option::flatten)
}

pub(crate) fn cancel(app: &AppHandle, job_id: &OpaqueId) -> Result<bool, String> {
    let connection = open_store(&job_store_path(app)?)?;
    let changed = connection
        .execute(
            "UPDATE journal_jobs
             SET state = 'cancelled', last_error_code = 'owner_cancelled', updated_at = ?2
             WHERE job_id = ?1
               AND (state = 'pending' OR (state = 'running' AND commit_claimed = 0))",
            params![job_id.as_str(), chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "cancel resident journal job".to_owned())?;
    if changed == 1 {
        if let Ok(mut values) = payloads().lock() {
            values.remove(job_id.as_str());
        }
    }
    Ok(changed == 1)
}

pub(crate) fn retry(app: &AppHandle, job_id: &OpaqueId) -> Result<bool, String> {
    let has_payload = payloads()
        .lock()
        .map_err(|_| "resident journal scheduler is unavailable".to_owned())?
        .contains_key(job_id.as_str());
    if !has_payload {
        return Err("journal source selection must be submitted again after restart".to_owned());
    }
    let mut connection = open_store(&job_store_path(app)?)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "retry resident journal job".to_owned())?;
    let changed = transaction
        .execute(
            "UPDATE journal_jobs
             SET state = 'pending', attempt_count = 0, manual_retry_count = 1,
                 commit_claimed = 0, last_error_code = 'manual_retry_requested', updated_at = ?2
             WHERE job_id = ?1 AND state = 'failed' AND manual_retry_count = 0",
            params![job_id.as_str(), chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "retry resident journal job".to_owned())?;
    transaction
        .commit()
        .map_err(|_| "commit resident journal retry".to_owned())?;
    if changed == 1 {
        spawn_job(app.clone(), job_id.clone(), RETRY_DELAY);
    }
    Ok(changed == 1)
}

/// Unfinished jobs cannot be resumed without persisting their private prompt;
/// fail them honestly and require an explicit resubmission.
pub(crate) fn recover_interrupted(app: &AppHandle) -> Result<usize, String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE journal_jobs
             SET state = 'failed', last_error_code = 'interrupted_restart', updated_at = ?1
             WHERE state IN ('pending','running')",
            [chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "recover interrupted resident journal jobs".to_owned())
}

fn spawn_job(app: AppHandle, job_id: OpaqueId, delay: Duration) {
    let _ = std::thread::Builder::new()
        .name("luca-journal-job".into())
        .spawn(move || {
            if !delay.is_zero() {
                std::thread::sleep(delay);
            }
            execute_job(&app, &job_id);
        });
}

fn execute_job(app: &AppHandle, job_id: &OpaqueId) {
    let payload = match payloads().lock() {
        Ok(values) => values.get(job_id.as_str()).cloned(),
        Err(_) => None,
    };
    let Some(payload) = payload else {
        let _ = mark_failed(app, job_id, "private_request_unavailable");
        return;
    };
    let attempt = match claim_job(app, job_id) {
        Ok(Some(value)) => value,
        _ => return,
    };
    let result = managed_cognition::request_journal(&payload.request);
    let result = match result {
        Ok(value) => value,
        Err(error) if attempt < MAX_ATTEMPTS => {
            let _ = mark_pending(app, job_id, error_code(error));
            spawn_job(app.clone(), job_id.clone(), RETRY_DELAY);
            return;
        }
        Err(error) => {
            let _ = mark_failed(app, job_id, error_code(error));
            return;
        }
    };
    if !job_is_running(app, job_id).unwrap_or(false) {
        return;
    }
    match result.result {
        CreateResidentJournalPageOutcomeV1::NoChange => {
            let _ = mark_completed(app, job_id);
        }
        CreateResidentJournalPageOutcomeV1::Page { page } => {
            match begin_commit(app, job_id) {
                Ok(true) => {}
                Ok(false) => return,
                Err(_) => {
                    let _ = mark_failed(app, job_id, "commit_claim_unavailable");
                    return;
                }
            }
            let state = app.state::<AppState>();
            let outcome = state.commit_resident_journal_page(ResidentJournalCommitRequestV1 {
                owner_pubkey: payload.request.owner_pubkey,
                resident_pubkey: payload.request.resident_pubkey,
                request_id: job_id.clone(),
                target_page_id: payload.target_page_id,
                page,
            });
            match outcome {
                ResidentNotebookMutationOutcomeV1::Committed(_) => {
                    let _ = mark_completed(app, job_id);
                }
                ResidentNotebookMutationOutcomeV1::Locked => {
                    let _ = mark_failed(app, job_id, "continuity_locked");
                }
                ResidentNotebookMutationOutcomeV1::Stale => {
                    let _ = mark_failed(app, job_id, "stale_notebook_revision");
                }
                ResidentNotebookMutationOutcomeV1::Unavailable => {
                    let _ = mark_failed(app, job_id, "continuity_unavailable");
                }
                ResidentNotebookMutationOutcomeV1::Empty
                | ResidentNotebookMutationOutcomeV1::Invalid => {
                    let _ = mark_failed(app, job_id, "invalid_journal_commit");
                }
            }
        }
    }
    if let Ok(mut values) = payloads().lock() {
        values.remove(job_id.as_str());
    }
}

fn error_code(error: managed_cognition::ManagedCognitionError) -> &'static str {
    match error {
        managed_cognition::ManagedCognitionError::Unavailable => "runtime_unavailable",
        managed_cognition::ManagedCognitionError::Invalid => "invalid_private_result",
        managed_cognition::ManagedCognitionError::Timeout => "runtime_timeout",
    }
}

fn claim_job(app: &AppHandle, job_id: &OpaqueId) -> Result<Option<u64>, String> {
    let connection = open_store(&job_store_path(app)?)?;
    let changed = connection
        .execute(
            "UPDATE journal_jobs
             SET state = 'running', attempt_count = attempt_count + 1,
                 commit_claimed = 0, last_error_code = NULL, updated_at = ?2
             WHERE job_id = ?1 AND state = 'pending' AND attempt_count < ?3",
            params![job_id.as_str(), chrono::Utc::now().to_rfc3339(), MAX_ATTEMPTS],
        )
        .map_err(|_| "claim resident journal job".to_owned())?;
    if changed != 1 {
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT attempt_count FROM journal_jobs WHERE job_id = ?1",
            [job_id.as_str()],
            |row| row.get::<_, u64>(0),
        )
        .map(Some)
        .map_err(|_| "load resident journal attempt".to_owned())
}

fn mark_pending(app: &AppHandle, job_id: &OpaqueId, code: &str) -> Result<(), String> {
    update_running_state(app, job_id, "pending", code)
}

fn mark_failed(app: &AppHandle, job_id: &OpaqueId, code: &str) -> Result<(), String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE journal_jobs SET state = 'failed', last_error_code = ?2, updated_at = ?3
             WHERE job_id = ?1 AND state = 'running'",
            params![job_id.as_str(), code, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "fail resident journal job".to_owned())?;
    Ok(())
}

fn mark_completed(app: &AppHandle, job_id: &OpaqueId) -> Result<(), String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE journal_jobs SET state = 'completed', last_error_code = NULL, updated_at = ?2
             WHERE job_id = ?1 AND state = 'running'",
            params![job_id.as_str(), chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "complete resident journal job".to_owned())?;
    Ok(())
}

fn update_running_state(
    app: &AppHandle,
    job_id: &OpaqueId,
    state: &str,
    code: &str,
) -> Result<(), String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE journal_jobs SET state = ?2, last_error_code = ?3, updated_at = ?4
             WHERE job_id = ?1 AND state = 'running'",
            params![job_id.as_str(), state, code, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(|_| "update resident journal job".to_owned())?;
    Ok(())
}

/// Atomically wins the final cancellation race. Once this claim succeeds,
/// cancellation reports `false` rather than claiming a cancelled page that can
/// still commit.
fn begin_commit(app: &AppHandle, job_id: &OpaqueId) -> Result<bool, String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .execute(
            "UPDATE journal_jobs SET commit_claimed = 1, updated_at = ?2
             WHERE job_id = ?1 AND state = 'running' AND commit_claimed = 0",
            params![job_id.as_str(), chrono::Utc::now().to_rfc3339()],
        )
        .map(|changed| changed == 1)
        .map_err(|_| "claim resident journal commit".to_owned())
}

fn job_is_running(app: &AppHandle, job_id: &OpaqueId) -> Result<bool, String> {
    let connection = open_store(&job_store_path(app)?)?;
    connection
        .query_row(
            "SELECT state = 'running' FROM journal_jobs WHERE job_id = ?1",
            [job_id.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|_| "inspect resident journal job".to_owned())
}

fn status_by_id(
    app: &AppHandle,
    job_id: &OpaqueId,
) -> Result<Option<ResidentJournalJobStatusV1>, String> {
    let connection = open_store(&job_store_path(app)?)?;
    let value = connection
        .query_row(
            "SELECT state, last_error_code, updated_at, manual_retry_count, commit_claimed
             FROM journal_jobs WHERE job_id = ?1",
            [job_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u64>(3)?,
                    row.get::<_, u64>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "load resident journal job status".to_owned())?
        .map(|(state, last_error_code, updated_at, manual_retry_count, commit_claimed)| {
            ResidentJournalJobStatusV1 {
                job_id: job_id.clone(),
                can_cancel: state == "pending" || state == "running" && commit_claimed == 0,
                can_retry: state == "failed" && manual_retry_count == 0,
                state,
                last_error_code,
                updated_at,
            }
        });
    Ok(value)
}

fn job_store_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "resolve journal job directory".to_owned())?
        .join("continuity");
    reject_symlink(&directory)?;
    std::fs::create_dir_all(&directory).map_err(|_| "create journal job directory".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "secure journal job directory".to_owned())?;
    }
    let path = directory.join(JOB_FILENAME);
    reject_symlink(&path)?;
    Ok(path)
}

fn open_store(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|_| "open journal job store".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| "secure journal job store".to_owned())?;
    }
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS journal_jobs (
                job_id TEXT PRIMARY KEY NOT NULL,
                owner_pubkey TEXT NOT NULL,
                resident_pubkey TEXT NOT NULL,
                binding_ref TEXT NOT NULL,
                conversation_id TEXT,
                target_page_id TEXT,
                state TEXT NOT NULL CHECK(state IN ('pending','running','completed','cancelled','failed')),
                attempt_count INTEGER NOT NULL CHECK(attempt_count >= 0),
                manual_retry_count INTEGER NOT NULL CHECK(manual_retry_count IN (0, 1)),
                commit_claimed INTEGER NOT NULL DEFAULT 0 CHECK(commit_claimed IN (0, 1)),
                last_error_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );",
        )
        .map_err(|_| "initialize journal job store".to_owned())?;
    let has_commit_claim = connection
        .prepare("PRAGMA table_info(journal_jobs)")
        .and_then(|mut statement| {
            let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
            for row in rows {
                if row? == "commit_claimed" {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .map_err(|_| "inspect journal job schema".to_owned())?;
    if !has_commit_claim {
        connection
            .execute(
                "ALTER TABLE journal_jobs ADD COLUMN commit_claimed INTEGER NOT NULL DEFAULT 0
                 CHECK(commit_claimed IN (0, 1))",
                [],
            )
            .map_err(|_| "upgrade journal job store".to_owned())?;
    }
    Ok(connection)
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("journal job path must not be a symlink".to_owned())
        }
        Ok(_) | Err(_) => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_schema_contains_no_private_body_columns() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let path = temp.path().join("journal.sqlite3");
        let connection = open_store(&path).expect("open journal store");
        let mut statement = connection
            .prepare("PRAGMA table_info(journal_jobs)")
            .expect("inspect schema");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("read schema")
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        for forbidden in ["prompt", "body", "title", "markdown", "content"] {
            assert!(!columns.iter().any(|column| column.contains(forbidden)));
        }
        assert!(columns.iter().any(|column| column == "commit_claimed"));
    }

    #[test]
    fn existing_body_free_job_schema_is_upgraded_for_atomic_cancel_claims() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let path = temp.path().join("journal.sqlite3");
        let connection = Connection::open(&path).expect("open legacy journal store");
        connection
            .execute_batch(
                "CREATE TABLE journal_jobs (
                    job_id TEXT PRIMARY KEY NOT NULL,
                    owner_pubkey TEXT NOT NULL,
                    resident_pubkey TEXT NOT NULL,
                    binding_ref TEXT NOT NULL,
                    conversation_id TEXT,
                    target_page_id TEXT,
                    state TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL,
                    manual_retry_count INTEGER NOT NULL,
                    last_error_code TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .expect("create legacy schema");
        drop(connection);

        let connection = open_store(&path).expect("upgrade journal store");
        let has_claim = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('journal_jobs')
                 WHERE name = 'commit_claimed'",
                [],
                |row| row.get::<_, u64>(0),
            )
            .expect("inspect upgraded schema");
        assert_eq!(has_claim, 1);
    }
}

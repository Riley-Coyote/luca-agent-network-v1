//! Dedicated body-free operational schema; no encrypted I1 bodies or runtime prompts.
use super::{policy::InitiativePolicyV1, types::*};
use luca_protocol::{canonical_sha256, InitiativeThreadV1, OpaqueId};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{
    fs,
    path::{Component, Path},
};

/// Fixed filename prevents adopting a caller-selected database or foreign fixture.
pub(crate) const INITIATIVE_STORE_FILENAME: &str = "companion-initiative-v1.sqlite3";
const APPLICATION_ID: i64 = 0x50494e31;
const SCHEMA_VERSION: i64 = 1;
const SCHEMA: &str = "
CREATE TABLE initiative_policy (
 owner TEXT NOT NULL, resident TEXT NOT NULL, payload TEXT NOT NULL CHECK(length(payload)<=4096),
 PRIMARY KEY(owner,resident));
CREATE TABLE initiative_threads (
 owner TEXT NOT NULL, resident TEXT NOT NULL, thread_id TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(length(payload)<=16384), PRIMARY KEY(owner,resident,thread_id));
CREATE TABLE initiative_jobs (
 job_id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, resident TEXT NOT NULL,
 payload TEXT NOT NULL CHECK(length(payload)<=16384));
CREATE TABLE initiative_requests (
 owner TEXT NOT NULL, resident TEXT NOT NULL, request_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, object_id TEXT NOT NULL, operation TEXT NOT NULL,
 PRIMARY KEY(owner,resident,request_id));
CREATE TABLE initiative_clock (
 owner TEXT NOT NULL, resident TEXT NOT NULL, last_seen_ms INTEGER NOT NULL CHECK(last_seen_ms>=0),
 PRIMARY KEY(owner,resident));
";

/// Existing files are probed read-only before any writable connection/PRAGMA.
/// Never create/repair parent directories or chmod/adopt an unrecognized file.
pub(super) fn open_database(path: &Path) -> Result<Connection, InitiativeStoreErrorV1> {
    validate_path(path)?;
    let existed = path
        .try_exists()
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    if existed {
        let probe = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        validate_schema(&probe)?;
    } else {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options
            .open(path)
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?
            .sync_all()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(db_error)?;
    connection.execute_batch("PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL;").map_err(db_error)?;
    if !existed {
        connection.execute_batch(&format!("BEGIN IMMEDIATE; {SCHEMA} PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version={SCHEMA_VERSION}; COMMIT;")).map_err(db_error)?;
    }
    validate_schema(&connection)?;
    Ok(connection)
}

fn validate_path(path: &Path) -> Result<(), InitiativeStoreErrorV1> {
    if !path.is_absolute()
        || path.starts_with("/Volumes")
        || path.file_name().and_then(|name| name.to_str()) != Some(INITIATIVE_STORE_FILENAME)
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    let parent = path.parent().ok_or(InitiativeStoreErrorV1::Invalid)?;
    let parent_metadata =
        fs::symlink_metadata(parent).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    if !parent_metadata.is_dir()
        || fs::canonicalize(parent).map_err(|_| InitiativeStoreErrorV1::Invalid)? != parent
    {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if parent_metadata.permissions().mode() & 0o077 != 0 {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
    }
    for target in [
        path.to_path_buf(),
        path.with_extension("sqlite3-wal"),
        path.with_extension("sqlite3-shm"),
        path.with_extension("sqlite3-journal"),
    ] {
        match fs::symlink_metadata(target) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(InitiativeStoreErrorV1::Invalid);
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::{MetadataExt, PermissionsExt};
                    if metadata.nlink() != 1
                        || metadata.uid() != parent_metadata.uid()
                        || metadata.permissions().mode() & 0o077 != 0
                    {
                        return Err(InitiativeStoreErrorV1::Invalid);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(InitiativeStoreErrorV1::Invalid),
        }
    }
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<(), InitiativeStoreErrorV1> {
    let application: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(db_error)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db_error)?;
    if application != APPLICATION_ID || version != SCHEMA_VERSION {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    let exceptional: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type IN ('view','trigger')",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if exceptional != 0 {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    let mut statement = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| InitiativeStoreErrorV1::Unavailable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    drop(statement);
    let expected = [
        "initiative_clock",
        "initiative_jobs",
        "initiative_policy",
        "initiative_requests",
        "initiative_threads",
    ];
    if names.iter().map(String::as_str).ne(expected) {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    for (table, columns) in [
        ("initiative_clock", "owner,resident,last_seen_ms"),
        ("initiative_jobs", "job_id,owner,resident,payload"),
        ("initiative_policy", "owner,resident,payload"),
        (
            "initiative_requests",
            "owner,resident,request_id,fingerprint,object_id,operation",
        ),
        ("initiative_threads", "owner,resident,thread_id,payload"),
    ] {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(db_error)?;
        let actual = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        if actual.join(",") != columns {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
    }
    Ok(())
}
pub(super) fn encode(value: &impl Serialize) -> Result<String, InitiativeStoreErrorV1> {
    serde_json::to_string(value).map_err(|_| InitiativeStoreErrorV1::Invalid)
}
pub(super) fn decode<T: DeserializeOwned>(value: String) -> Result<T, InitiativeStoreErrorV1> {
    if value.len() > 16384 {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    serde_json::from_str(&value).map_err(|_| InitiativeStoreErrorV1::Invalid)
}
pub(super) fn fingerprint(value: &impl Serialize) -> Result<String, InitiativeStoreErrorV1> {
    canonical_sha256(value).map_err(|_| InitiativeStoreErrorV1::Invalid)
}
pub(super) fn db_error(_: rusqlite::Error) -> InitiativeStoreErrorV1 {
    InitiativeStoreErrorV1::Unavailable
}
pub(super) fn touch_clock(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
) -> Result<(), InitiativeStoreErrorV1> {
    let previous: Option<u64> = connection
        .query_row(
            "SELECT last_seen_ms FROM initiative_clock WHERE owner=?1 AND resident=?2",
            params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    if previous.is_some_and(|previous| previous > scope.now_unix_ms) {
        return Err(InitiativeStoreErrorV1::Stale);
    }
    connection.execute("INSERT INTO initiative_clock(owner,resident,last_seen_ms) VALUES(?1,?2,?3) ON CONFLICT(owner,resident) DO UPDATE SET last_seen_ms=excluded.last_seen_ms",
        params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str(), scope.now_unix_ms]).map_err(db_error)?;
    Ok(())
}
pub(super) fn load_policy(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
) -> Result<InitiativePolicyV1, InitiativeStoreErrorV1> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM initiative_policy WHERE owner=?1 AND resident=?2",
            params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str()],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    let policy: InitiativePolicyV1 = match payload {
        Some(payload) => decode(payload)?,
        None => InitiativePolicyV1::disabled()?,
    };
    policy.validate()?;
    Ok(policy)
}
pub(super) fn load_thread(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
    id: &OpaqueId,
) -> Result<Option<InitiativeThreadV1>, InitiativeStoreErrorV1> {
    let payload: Option<String> = connection.query_row("SELECT payload FROM initiative_threads WHERE owner=?1 AND resident=?2 AND thread_id=?3",
        params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str(), id.as_str()], |row| row.get(0)).optional().map_err(db_error)?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    let thread: InitiativeThreadV1 = decode(payload)?;
    if !scope_matches_thread(scope, &thread) || &thread.thread_id != id {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    Ok(Some(thread))
}
pub(super) fn save_thread(
    connection: &Connection,
    thread: &InitiativeThreadV1,
) -> Result<(), InitiativeStoreErrorV1> {
    thread
        .validate()
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    connection.execute("INSERT INTO initiative_threads(owner,resident,thread_id,payload) VALUES(?1,?2,?3,?4) ON CONFLICT(owner,resident,thread_id) DO UPDATE SET payload=excluded.payload",
        params![thread.owner_pubkey.as_str(), thread.resident_pubkey.as_str(), thread.thread_id.as_str(), encode(thread)?]).map_err(db_error)?;
    Ok(())
}
pub(super) fn load_any_job(
    connection: &Connection,
    id: &OpaqueId,
) -> Result<Option<InitiativeJobV1>, InitiativeStoreErrorV1> {
    let row: Option<(String, String, String)> = connection
        .query_row(
            "SELECT owner,resident,payload FROM initiative_jobs WHERE job_id=?1",
            [id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_error)?;
    let Some((owner, resident, payload)) = row else {
        return Ok(None);
    };
    let job: InitiativeJobV1 = decode(payload)?;
    if job.input.job_id != *id
        || job.owner_pubkey.as_str() != owner
        || job.resident_pubkey.as_str() != resident
        || job.owner_pubkey == job.resident_pubkey
        || job.session_epoch.get() == 0
        || job.input.deadline_unix_ms <= job.created_unix_ms
        || job.updated_unix_ms < job.created_unix_ms
        || job.model_stages_reserved > job.input.budget.model_stages()
    {
        return Err(InitiativeStoreErrorV1::Invalid);
    }
    job.input.budget.total_ms()?;
    Ok(Some(job))
}
pub(super) fn load_job(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
    id: &OpaqueId,
) -> Result<Option<InitiativeJobV1>, InitiativeStoreErrorV1> {
    let job = load_any_job(connection, id)?;
    if job.as_ref().is_some_and(|j| {
        j.owner_pubkey != scope.owner_pubkey
            || j.resident_pubkey != scope.resident_pubkey
            || j.origin_scope_ref != scope.origin_scope_ref
    }) {
        return Err(InitiativeStoreErrorV1::Scope);
    }
    Ok(job)
}
pub(super) fn jobs_for(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
) -> Result<Vec<InitiativeJobV1>, InitiativeStoreErrorV1> {
    let mut statement = connection
        .prepare(
            "SELECT job_id FROM initiative_jobs WHERE owner=?1 AND resident=?2 ORDER BY job_id",
        )
        .map_err(db_error)?;
    let ids = statement
        .query_map(
            params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str()],
            |row| row.get::<_, String>(0),
        )
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if ids.len() > 512 {
        return Err(InitiativeStoreErrorV1::Capacity);
    }
    ids.into_iter()
        .map(|id| {
            OpaqueId::parse(id)
                .map_err(|_| InitiativeStoreErrorV1::Invalid)
                .and_then(|id| {
                    load_any_job(connection, &id)?.ok_or(InitiativeStoreErrorV1::Invalid)
                })
        })
        .collect()
}
pub(super) fn save_job(
    connection: &Connection,
    job: &InitiativeJobV1,
) -> Result<(), InitiativeStoreErrorV1> {
    connection.execute("INSERT INTO initiative_jobs(job_id,owner,resident,payload) VALUES(?1,?2,?3,?4) ON CONFLICT(job_id) DO UPDATE SET payload=excluded.payload",
        params![job.input.job_id.as_str(), job.owner_pubkey.as_str(), job.resident_pubkey.as_str(), encode(job)?]).map_err(db_error)?;
    Ok(())
}
pub(super) fn request_replayed(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
    id: &OpaqueId,
    fingerprint: &str,
    operation: &str,
    object_id: &str,
) -> Result<bool, InitiativeStoreErrorV1> {
    let existing: Option<(String,String,String)> = connection.query_row("SELECT fingerprint,operation,object_id FROM initiative_requests WHERE owner=?1 AND resident=?2 AND request_id=?3",
        params![scope.owner_pubkey.as_str(), scope.resident_pubkey.as_str(), id.as_str()], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(db_error)?;
    match existing {
        None => Ok(false),
        Some(existing) if existing == (fingerprint.into(), operation.into(), object_id.into()) => {
            Ok(true)
        }
        Some(_) => Err(InitiativeStoreErrorV1::Conflict),
    }
}
pub(super) fn save_request(
    connection: &Connection,
    scope: &InitiativeControlScopeV1,
    id: &OpaqueId,
    fingerprint: &str,
    operation: &str,
    object_id: &str,
) -> Result<(), InitiativeStoreErrorV1> {
    connection.execute("INSERT INTO initiative_requests(owner,resident,request_id,fingerprint,object_id,operation) VALUES(?1,?2,?3,?4,?5,?6)",
        params![scope.owner_pubkey.as_str(),scope.resident_pubkey.as_str(),id.as_str(),fingerprint,object_id,operation]).map_err(db_error)?;
    Ok(())
}

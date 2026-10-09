//! Fixed identity/schema and explicit private internal-path opening only.
use super::store::AwarenessStoreError;
use rusqlite::{Connection, OpenFlags};
use std::{
    fs,
    path::{Component, Path},
};

pub(crate) const AWARENESS_STORE_FILENAME: &str = "companion-awareness-v1.sqlite3";
const APPLICATION_ID: i64 = 0x50415731;
const SCHEMA_VERSION: i64 = 2;
const PROFILE_SCHEMA:&str="CREATE TABLE awareness_profile_children (
 owner TEXT NOT NULL, resident TEXT NOT NULL, observation_id TEXT NOT NULL,
 child_ref TEXT NOT NULL, exclusion_token TEXT NOT NULL CHECK(length(exclusion_token)=71),
 reference_ref TEXT NOT NULL CHECK(length(reference_ref)=71),
 PRIMARY KEY(owner,resident,observation_id),
 FOREIGN KEY(owner,resident,observation_id) REFERENCES awareness_observations(owner,resident,observation_id)
) STRICT;";
const SCHEMA: &str = "
CREATE TABLE awareness_sources (
 owner TEXT NOT NULL, source TEXT NOT NULL, device TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), epoch INTEGER NOT NULL CHECK(epoch>=0),
 state TEXT NOT NULL CHECK(state IN ('current','disabled','unavailable','unknown')),
 PRIMARY KEY(owner,source,device)
) STRICT;
CREATE TABLE awareness_grants (
 owner TEXT NOT NULL, resident TEXT NOT NULL, source TEXT NOT NULL, device TEXT NOT NULL,
 grant_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 epoch INTEGER NOT NULL CHECK(epoch>=0), state TEXT NOT NULL CHECK(state IN ('active','revoked')),
 choices BLOB NOT NULL CHECK(length(choices)<=4096),
 PRIMARY KEY(owner,resident,source,device), UNIQUE(owner,grant_id),
 FOREIGN KEY(owner,source,device) REFERENCES awareness_sources(owner,source,device)
) STRICT;
CREATE TABLE awareness_observations (
 owner TEXT NOT NULL, resident TEXT NOT NULL, observation_id TEXT NOT NULL,
 source TEXT NOT NULL, device TEXT NOT NULL, grant_id TEXT NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence>0), reference BLOB NOT NULL CHECK(length(reference)<=4096),
 PRIMARY KEY(owner,resident,observation_id)
) STRICT;
CREATE TABLE awareness_nodes (
 owner TEXT NOT NULL, resident TEXT NOT NULL, node_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('observation','context','job','promoted')),
 quarantined INTEGER NOT NULL CHECK(quarantined IN (0,1,2)),
 PRIMARY KEY(owner,resident,node_id)
) STRICT;
CREATE TABLE awareness_edges (
 owner TEXT NOT NULL, resident TEXT NOT NULL, parent TEXT NOT NULL, child TEXT NOT NULL,
 PRIMARY KEY(owner,resident,parent,child),
 FOREIGN KEY(owner,resident,parent) REFERENCES awareness_nodes(owner,resident,node_id),
 FOREIGN KEY(owner,resident,child) REFERENCES awareness_nodes(owner,resident,node_id)
) STRICT;
CREATE TABLE awareness_residents (
 owner TEXT NOT NULL, resident TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 paused INTEGER NOT NULL CHECK(paused IN (0,1)), changed_at TEXT NOT NULL,
 PRIMARY KEY(owner,resident)
) STRICT;
CREATE TABLE awareness_operations (
 owner TEXT NOT NULL, operation_id TEXT NOT NULL, request_ref TEXT NOT NULL,
 receipt BLOB NOT NULL CHECK(length(receipt)<=4096), PRIMARY KEY(owner,operation_id)
) STRICT;
CREATE INDEX awareness_observation_grant ON awareness_observations(owner,resident,grant_id);
CREATE INDEX awareness_observation_source ON awareness_observations(owner,source,device);
CREATE INDEX awareness_dependency_child ON awareness_edges(owner,resident,child);
";

/// No directory creation/repair or migration of an unrecognized file is allowed.
pub(super) fn open_database(path: &Path) -> Result<Connection, AwarenessStoreError> {
    validate_path(path)?;
    let existed = path
        .try_exists()
        .map_err(|_| AwarenessStoreError::UnsafePath)?;
    let mut existing_version=0_i64;
    if existed {
        let probe = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        validate_schema(&probe)?;
        existing_version=probe.pragma_query_value(None,"user_version",|row|row.get(0))?;
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
            .map_err(|_| AwarenessStoreError::Unavailable)?
            .sync_all()
            .map_err(|_| AwarenessStoreError::Unavailable)?;
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.execute_batch("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA synchronous=FULL;")?;
    if !existed {
        connection.execute_batch(&format!("BEGIN IMMEDIATE; {SCHEMA} {PROFILE_SCHEMA} PRAGMA application_id={APPLICATION_ID}; PRAGMA user_version={SCHEMA_VERSION}; COMMIT;"))?;
    } else if existing_version==1 {
        // Only the already recognized private v1 authority is extended. Unknown
        // databases are never adopted and old observations gain no child claim.
        connection.execute_batch(&format!("BEGIN IMMEDIATE; {PROFILE_SCHEMA} PRAGMA user_version={SCHEMA_VERSION}; COMMIT;"))?;
    }
    validate_schema(&connection)?;
    Ok(connection)
}

fn validate_path(path: &Path) -> Result<(), AwarenessStoreError> {
    if !path.is_absolute()
        || path.starts_with("/Volumes")
        || path.file_name().and_then(|value| value.to_str()) != Some(AWARENESS_STORE_FILENAME)
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let parent = path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| AwarenessStoreError::UnsafePath)?;
    if !metadata.is_dir()
        || fs::canonicalize(parent).map_err(|_| AwarenessStoreError::UnsafePath)? != parent
    {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(AwarenessStoreError::UnsafePath);
        }
    }
    for candidate in [
        path.to_path_buf(),
        path.with_extension("sqlite3-wal"),
        path.with_extension("sqlite3-shm"),
        path.with_extension("sqlite3-journal"),
    ] {
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(AwarenessStoreError::UnsafePath);
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::{MetadataExt, PermissionsExt};
                    if metadata.nlink() != 1 || metadata.permissions().mode() & 0o077 != 0 {
                        return Err(AwarenessStoreError::UnsafePath);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(AwarenessStoreError::UnsafePath),
        }
    }
    Ok(())
}

fn validate_schema(connection: &Connection) -> Result<(), AwarenessStoreError> {
    let id: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(|_| AwarenessStoreError::Schema)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| AwarenessStoreError::Schema)?;
    if id != APPLICATION_ID || !matches!(version,1|2) {
        return Err(AwarenessStoreError::Schema);
    }
    let exceptional: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type IN ('view','trigger')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| AwarenessStoreError::Schema)?;
    if exceptional != 0 {
        return Err(AwarenessStoreError::Schema);
    }
    let mut statement = connection.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(|_| AwarenessStoreError::Schema)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| AwarenessStoreError::Schema)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AwarenessStoreError::Schema)?;
    let mut expected=vec![
            "awareness_edges",
            "awareness_grants",
            "awareness_nodes",
            "awareness_observations",
            "awareness_operations",
            "awareness_residents",
            "awareness_sources",
        ];
    if version==2 {expected.push("awareness_profile_children");expected.sort();}
    if names.iter().map(String::as_str).ne(expected) {
        return Err(AwarenessStoreError::Schema);
    }
    if version==2 {
        let mut statement=connection.prepare("PRAGMA table_info(awareness_profile_children)")?;
        let columns=statement.query_map([],|row|row.get::<_,String>(1))?.collect::<Result<Vec<_>,_>>()?;
        if columns.join(",")!="owner,resident,observation_id,child_ref,exclusion_token,reference_ref" {return Err(AwarenessStoreError::Schema);}
    }
    for (table, columns) in [
        (
            "awareness_sources",
            "owner,source,device,revision,epoch,state",
        ),
        (
            "awareness_grants",
            "owner,resident,source,device,grant_id,revision,epoch,state,choices",
        ),
        (
            "awareness_observations",
            "owner,resident,observation_id,source,device,grant_id,sequence,reference",
        ),
        ("awareness_nodes", "owner,resident,node_id,kind,quarantined"),
        ("awareness_edges", "owner,resident,parent,child"),
        (
            "awareness_residents",
            "owner,resident,revision,paused,changed_at",
        ),
        (
            "awareness_operations",
            "owner,operation_id,request_ref,receipt",
        ),
    ] {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|_| AwarenessStoreError::Schema)?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| AwarenessStoreError::Schema)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| AwarenessStoreError::Schema)?;
        if names.join(",") != columns {
            return Err(AwarenessStoreError::Schema);
        }
    }
    Ok(())
}

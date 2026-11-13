use super::{
    protocol::{Section, LIMIT, MAX_REPLY},
    Binding,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::PathBuf,
    process::Stdio,
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tokio::{io::AsyncReadExt, process::Command, sync::Semaphore};

// A release may provision only an engine artifact whose digest is pinned in
// this binary. No package installer, PATH lookup or arbitrary script preference.
const DIGEST: &str = include_str!("reader.sha256");
const MAX_ARCHIVE: u64 = 4 * 1024 * 1024;
static READERS: Semaphore = Semaphore::const_new(2);
fn python() -> Option<PathBuf> {
    // Explicit system installations only (no editable venv/site or shell).
    #[cfg(target_os = "macos")]
    let paths = [
        "/opt/homebrew/bin/python3.13",
        "/usr/local/bin/python3.13",
        "/opt/homebrew/bin/python3.12",
        "/usr/local/bin/python3.12",
        "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3.13",
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12",
    ];
    #[cfg(not(target_os = "macos"))]
    let paths: [&str; 0] = [];
    paths.iter().map(PathBuf::from).find(|p| p.is_file())
}
fn artifact(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .resource_dir()
            .ok()?
            .join("mnemos")
            .join("read-view.pyz"),
    )
}
fn pinned(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    File::open(path)
        .and_then(|f| f.take(MAX_ARCHIVE + 1).read_to_end(&mut bytes))
        .map_err(|_| "reader_unavailable")?;
    if bytes.len() as u64 > MAX_ARCHIVE || hex::encode(Sha256::digest(&bytes)) != DIGEST.trim() {
        return Err("reader_unavailable".into());
    }
    Ok(bytes)
}
pub(super) fn available(app: &AppHandle) -> bool {
    python().is_some() && artifact(app).is_some_and(|p| pinned(&p).is_ok())
}
pub(super) async fn read(
    app: &AppHandle,
    b: &Binding,
    section: Section,
    cursor: Option<&str>,
) -> Result<Vec<u8>, String> {
    let _slot = READERS.try_acquire().map_err(|_| "reader_busy")?;
    let python = python().ok_or("reader_unavailable")?;
    let bytes = pinned(&artifact(app).ok_or("reader_unavailable")?)?;
    // Execute exactly the verified bytes. Never resolve the resource again
    // between hashing it and handing it to the isolated interpreter.
    let dir = tempfile::tempdir().map_err(|_| "reader_unavailable")?;
    let entry = dir.path().join("reader.pyz");
    File::create_new(&entry)
        .and_then(|mut f| f.write_all(&bytes))
        .map_err(|_| "reader_unavailable")?;
    let mut cmd = Command::new(python);
    cmd.env_clear()
        .current_dir(dir.path())
        .args(["-I", "-B", "-S"])
        .arg(&entry)
        .args([
            "view",
            "--protocol",
            "1",
            "--section",
            section.label(),
            "--db-path",
        ])
        .arg(&b.file)
        .args([
            "--agent-id",
            &b.scope.agent_id,
            "--person-id",
            &b.scope.person_id,
            "--project-scope",
            &b.scope.project_scope,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    if section != Section::Summary {
        cmd.arg("--limit").arg(LIMIT.to_string());
    }
    if let Some(c) = cursor {
        cmd.arg("--cursor").arg(c);
    }
    let mut child = cmd.spawn().map_err(|_| "reader_unavailable")?;
    let pipe = child.stdout.take().ok_or("reader_unavailable")?;
    let outcome = tokio::time::timeout(Duration::from_secs(8), async {
        let mut bytes = Vec::new();
        pipe.take((MAX_REPLY + 2) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "view_unavailable")?;
        if bytes.len() > MAX_REPLY + 1 {
            return Err("invalid_reply");
        }
        let status = child.wait().await.map_err(|_| "view_unavailable")?;
        if !status.success() {
            let code = serde_json::from_slice::<serde_json::Value>(&bytes).ok();
            return Err(
                match code
                    .as_ref()
                    .and_then(|v| v.pointer("/error/code"))
                    .and_then(|v| v.as_str())
                {
                    Some("no_store" | "not_a_store" | "unreadable_store") => "store_unavailable",
                    Some("bad_cursor") => "stale_page",
                    Some("unsupported_protocol") => "reader_unavailable",
                    _ => "view_unavailable",
                },
            );
        }
        Ok(bytes)
    })
    .await;
    match outcome {
        Ok(Ok(bytes)) => Ok(bytes),
        fail => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(fail
                .ok()
                .and_then(Result::err)
                .unwrap_or("reader_timeout")
                .into())
        }
    }
}

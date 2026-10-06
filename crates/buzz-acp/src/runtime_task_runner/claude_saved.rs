//! Same-ID Claude restore guard over the supported native session catalogue.

use std::{path::Path, process::Stdio, time::Duration};

use tokio::{io::AsyncReadExt as _, process::Command};

use super::native_isolation;
use crate::acp::AcpError;

const SNAPSHOT_BYTES: usize = 256 * 1024;

pub(super) fn known_mode(value: &str) -> bool {
    matches!(
        value,
        "default" | "auto" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions"
    )
}

pub(super) fn validate_coordinates(executable: &str, folder: &str) -> Result<(), AcpError> {
    let cli = Path::new(executable);
    let cwd = Path::new(folder);
    if !cli.is_absolute()
        || !cli.is_file()
        || !cwd.is_absolute()
        || !cwd.is_dir()
        || cwd.parent().is_none()
        || cwd.canonicalize().ok().as_deref() != Some(cwd)
    {
        return Err(AcpError::Protocol("native Claude target is invalid".into()));
    }
    Ok(())
}

fn selected_rows<'a>(
    snapshot: &'a serde_json::Value,
    session: &str,
    folder: &Path,
) -> Result<Vec<&'a serde_json::Value>, AcpError> {
    let rows = snapshot
        .as_array()
        .filter(|rows| rows.len() <= 4096)
        .ok_or_else(|| AcpError::Protocol("native Claude availability is unverified".into()))?;
    if rows.iter().any(|row| {
        !row.is_object()
            || !row
                .get("sessionId")
                .and_then(|v| v.as_str())
                .is_some_and(super::codex_cli::valid_session_id)
            || !row
                .get("cwd")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.chars().any(char::is_control) && Path::new(s).is_absolute())
            || !matches!(
                row.get("kind").and_then(|v| v.as_str()),
                Some("interactive" | "background")
            )
            || row.get("pid").is_some_and(|v| {
                !v.as_u64()
                    .is_some_and(|pid| pid > 0 && u32::try_from(pid).is_ok())
            })
    }) {
        return Err(AcpError::Protocol(
            "native Claude availability contains incomplete session identities".into(),
        ));
    }
    let selected = rows
        .iter()
        .filter(|row| row.get("sessionId").and_then(|v| v.as_str()) == Some(session))
        .collect::<Vec<_>>();
    if selected.iter().any(|row| {
        row.get("cwd")
            .and_then(|v| v.as_str())
            .and_then(|s| Path::new(s).canonicalize().ok())
            .as_deref()
            != Some(folder)
    }) {
        return Err(AcpError::Protocol(
            "native Claude session working folder changed".into(),
        ));
    }
    Ok(selected)
}

async fn belongs_to_owned_adapter(pid: u32, adapter: u32) -> bool {
    if pid == 0 || adapter == 0 {
        return false;
    }
    let mut command = Command::new("/bin/ps");
    command
        .args(["-o", "pgid=", "-p"])
        .arg(pid.to_string())
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    matches!(tokio::time::timeout(Duration::from_secs(2), command.output()).await,
        Ok(Ok(output)) if output.status.success()
            && std::str::from_utf8(&output.stdout).ok().and_then(|s| s.trim().parse::<u32>().ok()) == Some(adapter))
}

/// Refuse a second controller. After load, only this still-owned adapter's
/// process group may describe the selected UUID. Unknown/blocked rows fail closed.
pub(super) async fn ensure_unclaimed(
    executable: &str,
    session: &str,
    folder: &str,
    owned_adapter: Option<u32>,
) -> Result<(), AcpError> {
    validate_coordinates(executable, folder)?;
    let mut command = Command::new(executable);
    command
        .args(["agents", "--json"])
        .current_dir(folder)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    native_isolation::scrub_environment(&mut command);
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AcpError::Protocol("native Claude availability is unavailable".into()))?;
    let operation = async {
        let mut bytes = Vec::new();
        stdout
            .take((SNAPSHOT_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > SNAPSHOT_BYTES {
            return Err(AcpError::Protocol(
                "native Claude availability exceeds bound".into(),
            ));
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(AcpError::Protocol(
                "native Claude availability is unverified".into(),
            ));
        }
        let snapshot: serde_json::Value = serde_json::from_slice(&bytes)?;
        for row in selected_rows(&snapshot, session, Path::new(folder))? {
            let owned = match (
                row.get("pid")
                    .and_then(|v| v.as_u64())
                    .and_then(|pid| u32::try_from(pid).ok()),
                owned_adapter,
            ) {
                (Some(pid), Some(adapter)) => belongs_to_owned_adapter(pid, adapter).await,
                _ => false,
            };
            if !owned {
                return Err(AcpError::Protocol("native Claude session already has an active controller; send a message there instead".into()));
            }
        }
        Ok(())
    };
    let outcome = tokio::time::timeout(Duration::from_secs(10), operation)
        .await
        .unwrap_or_else(|_| {
            Err(AcpError::Protocol(
                "native Claude availability timed out".into(),
            ))
        });
    if outcome.is_err() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_uuid_and_native_workspace_are_required_not_names_or_recency() {
        let folder = std::env::temp_dir().canonicalize().expect("fixture cwd");
        let snapshot = serde_json::json!([
            {"sessionId":"11111111-1111-4111-8111-111111111111", "name":"selected", "cwd":folder,"kind":"interactive"},
            {"sessionId":"22222222-2222-4222-8222-222222222222", "name":"other", "cwd":folder,"kind":"interactive", "status":"busy"}
        ]);
        assert_eq!(
            selected_rows(&snapshot, "22222222-2222-4222-8222-222222222222", &folder)
                .expect("exact rows")
                .len(),
            1
        );
        assert!(selected_rows(
            &snapshot,
            "22222222-2222-4222-8222-222222222222",
            Path::new("/different")
        )
        .is_err());
        assert!(selected_rows(&serde_json::json!({}), "selected", &folder).is_err());
        assert!(selected_rows(
            &serde_json::json!([{"sessionId":"selected"}]),
            "selected",
            &folder
        )
        .is_err());
    }
    #[test]
    fn unknown_permission_policy_is_never_substituted() {
        assert!(known_mode("plan"));
        assert!(!known_mode("manual")); // Host canonicalizes only known native aliases.
        assert!(!known_mode("unknown"));
    }

    #[test]
    fn malformed_or_incomplete_catalogues_never_prove_absence() {
        let folder = std::env::temp_dir().canonicalize().expect("fixture cwd");
        for snapshot in [
            serde_json::json!(["invalid"]),
            serde_json::json!([{"pid":123,"cwd":folder,"status":"busy"}]),
            serde_json::json!([{"sessionId":"not-a-uuid","cwd":folder,"kind":"interactive"}]),
        ] {
            assert!(
                selected_rows(&snapshot, "22222222-2222-4222-8222-222222222222", &folder).is_err()
            );
        }
    }
}

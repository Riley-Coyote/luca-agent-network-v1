//! Secret-free, opt-in managed Claude API binding. Native subscription/account
//! hints are not an authenticated account surface and never produce a witness.

use crate::{data_dir::BuzzPathExt, managed_agents::anthropic_auth};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, SystemTime},
};
use tauri::AppHandle;
use zeroize::Zeroizing;

const BOOTSTRAP_KEY: &str = "LUCA_RUNTIME_TASK_CLAUDE_API_KEY";
static CAPABILITY: Mutex<Option<Capability>> = Mutex::new(None);

#[derive(Clone, PartialEq, Eq)]
struct Capability {
    executable: PathBuf,
    len: u64,
    modified: SystemTime,
}
impl Capability {
    fn current(&self) -> bool {
        self.executable.symlink_metadata().is_ok_and(|m| {
            m.is_file() && m.len() == self.len && m.modified().ok() == Some(self.modified)
        })
    }
}

/// Probe only during an explicit owner Ask review, never during rendering.
/// The help probe has no auth environment, Keychain access, or prompt.
pub(super) fn prepare_review(_app: &AppHandle, family: &str) -> Result<(), String> {
    if family != "claude_code" || !cfg!(feature = "system-keyring") {
        return Ok(());
    }
    if CAPABILITY
        .lock()
        .map_err(|_| "Claude Ask capability is busy")?
        .as_ref()
        .is_some_and(Capability::current)
    {
        return Ok(());
    }
    let Some(runtime) = crate::managed_agents::known_acp_runtime_exact("claude") else {
        return Ok(());
    };
    let Some(path) = crate::managed_agents::resolve_runtime_cli(runtime).path else {
        return Ok(());
    };
    let executable = path
        .canonicalize()
        .map_err(|_| "Claude CLI is unavailable")?;
    if executable.starts_with("/Volumes") {
        return Ok(());
    }
    let metadata = executable
        .metadata()
        .map_err(|_| "Claude CLI is unavailable")?;
    let capability = Capability {
        executable,
        len: metadata.len(),
        modified: metadata
            .modified()
            .map_err(|_| "Claude CLI identity is unavailable")?,
    };
    let mut command = std::process::Command::new(&capability.executable);
    command
        .env_clear()
        .arg("--help")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    for key in ["HOME", "PATH", "TMPDIR", "LANG"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|_| "Claude CLI capability probe could not start")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Claude CLI capability output is unavailable")?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        use std::io::Read as _;
        let mut bytes = Vec::new();
        let result = stdout
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = tx.send(result);
    });
    let bytes = rx.recv_timeout(Duration::from_secs(5));
    let _ = child.kill();
    let _ = child.wait();
    let Ok(Ok(bytes)) = bytes else {
        return Ok(());
    };
    let Ok(help) = std::str::from_utf8(&bytes) else {
        return Ok(());
    };
    let required = [
        "--bare",
        "--restricted",
        "--tools",
        "--strict-mcp-config",
        "--mcp-config",
        "--setting-sources",
        "--settings",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--max-budget-usd",
        "--output-format",
        "--model",
        "--verbose",
        "--permission-prompts",
        "--no-chrome",
        "--session-id",
    ];
    if bytes.len() > 64 * 1024
        || !required.iter().all(|flag| help.contains(flag))
        || !help.contains("Use \"\" to disable all")
        || !capability.current()
    {
        return Ok(());
    }
    *CAPABILITY
        .lock()
        .map_err(|_| "Claude Ask capability is busy")? = Some(capability);
    Ok(())
}

/// A candidate API connection, not evidence that an unpinned task used it.
/// Only an owner-selected pin accepted by `spawn_prepared` binds a launch.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProviderScopeWitnessV1 {
    pub mode: String,
    pub account_revision: String,
    pub provider_target: String,
}

/// Read only the runtime-owned opaque revision, without Keychain access.
pub(super) fn witness(
    app: &AppHandle,
    family: &str,
) -> Result<Option<ProviderScopeWitnessV1>, String> {
    if family != "claude_code" || !cfg!(feature = "system-keyring") {
        return Ok(None);
    }
    let capability = CAPABILITY
        .lock()
        .map_err(|_| "Claude Ask capability is busy")?
        .clone();
    let Some(_capability) = capability.filter(Capability::current) else {
        return Ok(None);
    };
    account_pin(app)
}

fn account_pin(app: &AppHandle) -> Result<Option<ProviderScopeWitnessV1>, String> {
    let owner = anthropic_auth::owner(app)?;
    let Some(connection) = anthropic_auth::connection(app, &owner)? else {
        return Ok(None);
    };
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "App storage is unavailable")?;
    let provider_target = format!(
        "sha256:{}",
        luca_protocol::canonical_sha256(&serde_json::json!({
            "domain":"polyphonic.runtime-task.claude-api-target.v1",
            "owner":owner,
            "instance":root,
        }))
        .map_err(|_| "Claude API account scope is unavailable")?
    );
    Ok(Some(ProviderScopeWitnessV1 {
        mode: "claude_api".into(),
        account_revision: connection.generation,
        provider_target,
    }))
}

/// Recover an already-approved return against current non-secret account
/// authority. This neither discovers/probes a runtime nor opens Keychain.
pub(super) fn account_still_matches(
    app: &AppHandle,
    pin: &ProviderScopeWitnessV1,
) -> Result<bool, String> {
    if !cfg!(feature = "system-keyring") || pin.mode != "claude_api" {
        return Ok(false);
    }
    Ok(account_pin(app)?.as_ref() == Some(pin))
}

/// Produce only host-trusted, non-secret launch coordinates for a reviewed pin.
pub(super) fn ask_input(
    app: &AppHandle,
    pin: &ProviderScopeWitnessV1,
) -> Result<serde_json::Value, String> {
    if witness(app, "claude_code")?.as_ref() != Some(pin) {
        return Err("Claude API account or CLI changed. Review again; nothing ran.".into());
    }
    let capability = CAPABILITY
        .lock()
        .map_err(|_| "Claude Ask capability is busy")?
        .clone()
        .filter(Capability::current)
        .ok_or("Claude Ask capability is unavailable")?;
    Ok(serde_json::json!({"executable":capability.executable,"maxBudgetUsd":"0.25"}))
}

/// Ephemeral launch material. Deliberately not serializable, clonable, or
/// debuggable; the credential zeroizes when consumed, rejected, or dropped.
pub(super) struct PreparedSpawn {
    key: Zeroizing<String>,
    pin: ProviderScopeWitnessV1,
    capability: Capability,
}

/// Resolve interactive credential access before task-memory/admission locks.
pub(super) fn prepare_spawn(
    app: &AppHandle,
    pin: &ProviderScopeWitnessV1,
) -> Result<PreparedSpawn, String> {
    if witness(app, "claude_code")?.as_ref() != Some(pin) {
        return Err("Claude API account changed. Review the task again; nothing ran.".into());
    }
    let capability = CAPABILITY
        .lock()
        .map_err(|_| "Claude Ask capability is busy")?
        .clone()
        .filter(Capability::current)
        .ok_or("Claude Ask capability is unavailable")?;
    let owner = anthropic_auth::owner(app)?;
    let key = anthropic_auth::prepare_pinned_key(app, &owner, &pin.account_revision)?;
    if !account_still_matches(app, pin)? || !capability.current() {
        return Err("Claude API account or CLI changed. Review again; nothing ran.".into());
    }
    Ok(PreparedSpawn {
        key,
        pin: pin.clone(),
        capability,
    })
}

/// Serialize only a bounded synchronous effect with account rotation, with no
/// credential lookup or CLI discovery. Never await or call credential APIs in
/// `effect`; the guard deliberately fails busy rather than blocking on dialogs.
pub(super) fn with_current_account<T>(
    app: &AppHandle,
    pin: &ProviderScopeWitnessV1,
    effect: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if pin.mode != "claude_api" || !cfg!(feature = "system-keyring") {
        return Err("Claude API account binding is unavailable".into());
    }
    let owner = anthropic_auth::owner(app)?;
    anthropic_auth::with_current_generation(app, &owner, &pin.account_revision, || {
        if !account_still_matches(app, pin)? {
            return Err("Claude API account changed. Review again; nothing ran.".into());
        }
        effect()
    })
}

/// Revalidate the prepared identity and CLI and spawn without any Keychain
/// access, holding the mutation lock only through synchronous process creation.
pub(super) fn spawn_prepared(
    app: &AppHandle,
    process: &mut tokio::process::Command,
    pin: &ProviderScopeWitnessV1,
    prepared: PreparedSpawn,
) -> Result<tokio::process::Child, String> {
    process.env_remove(BOOTSTRAP_KEY);
    if &prepared.pin != pin || !prepared.capability.current() {
        return Err("Claude API account or CLI changed. Review again; nothing ran.".into());
    }
    let capability = CAPABILITY
        .try_lock()
        .map_err(|_| "Claude Ask capability is busy")?
        .clone();
    if capability.as_ref() != Some(&prepared.capability) {
        return Err("Claude CLI capability changed. Review again; nothing ran.".into());
    }
    let result = with_current_account(app, pin, || {
        if !prepared.capability.current() {
            return Err("Claude CLI changed. Review again; nothing ran.".into());
        }
        // This is a host-only bootstrap, not an inherited native billing route.
        // The runner delivers it only to its explicitly selected no-tool CLI.
        for name in [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
            "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
        ] {
            process.env_remove(name);
        }
        process.env(BOOTSTRAP_KEY, prepared.key.as_str());
        process
            .spawn()
            .map_err(|_| "The Claude API task host could not start.".into())
    });
    // Commands can be retained for retries/errors: never retain the secret there.
    process.env_remove(BOOTSTRAP_KEY);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_billing_mode_rotation_changes_the_exact_pin() {
        let first = ProviderScopeWitnessV1 {
            mode: "claude_api".into(),
            account_revision: "00000000-0000-4000-8000-000000000001".into(),
            provider_target: "sha256:synthetic-target".into(),
        };
        let mut rotated = first.clone();
        rotated.account_revision = "00000000-0000-4000-8000-000000000002".into();
        assert_ne!(first, rotated);
        assert_ne!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&rotated).unwrap()
        );
        let encoded = serde_json::to_value(&first).unwrap();
        assert_eq!(encoded.as_object().unwrap().len(), 3);
        assert_eq!(encoded["mode"], "claude_api");
    }
}

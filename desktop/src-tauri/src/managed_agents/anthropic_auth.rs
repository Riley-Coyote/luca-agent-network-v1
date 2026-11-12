//! Owner/instance-scoped Claude runtime credentials. Only an opaque generation
//! is stored on disk; the key lives in its own runtime-owned OS Keychain item.
use crate::{app_state::AppState, data_dir::BuzzPathExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

static WRITE_LOCK: Mutex<()> = Mutex::new(());
pub(crate) const API_MODE_ENV: &str = "LUCA_CLAUDE_API_AUTH";

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Connection {
    pub generation: String,
}

pub(crate) fn owner(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let keys = state.keys.lock().map_err(|_| "Identity is unavailable")?;
    Ok(keys.public_key().to_hex())
}

fn scope(root: &Path, owner: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(root.as_os_str().to_string_lossy().as_bytes());
    digest.update(b"\0");
    digest.update(owner.as_bytes());
    digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn location(app: &AppHandle, owner: &str) -> Result<(PathBuf, String), String> {
    if owner.len() != 64 || !owner.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid credential owner".into());
    }
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "App storage is unavailable")?;
    let account = scope(&root, owner);
    Ok((
        root.join("runtime-auth")
            .join(format!("{owner}.anthropic.json")),
        account,
    ))
}

pub(crate) fn connection(app: &AppHandle, owner: &str) -> Result<Option<Connection>, String> {
    let (path, _) = location(app, owner)?;
    match std::fs::read(path) {
        Ok(bytes) => {
            let value: Connection = serde_json::from_slice(&bytes)
                .map_err(|_| "Claude API connection is damaged. Reconnect it in Settings.")?;
            uuid::Uuid::parse_str(&value.generation)
                .map_err(|_| "Claude API connection is damaged. Reconnect it in Settings.")?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Claude API connection cannot be read. Check Settings.".into()),
    }
}

#[cfg(feature = "system-keyring")]
fn entry(account: &str, generation: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        "Claude Code · Polyphonic API",
        &format!("{account}:{generation}"),
    )
    .map_err(|_| "Claude's secure credential store is unavailable".into())
}

pub(crate) fn key(app: &AppHandle, owner: &str) -> Result<Option<Zeroizing<String>>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Credential update is busy")?;
    key_locked(app, owner)
}

fn key_locked(app: &AppHandle, owner: &str) -> Result<Option<Zeroizing<String>>, String> {
    let Some(connection) = connection(app, owner)? else {
        return Ok(None);
    };
    key_for_generation(app, owner, &connection.generation).map(Some)
}

fn key_for_generation(
    app: &AppHandle,
    owner: &str,
    generation: &str,
) -> Result<Zeroizing<String>, String> {
    #[cfg(feature = "system-keyring")]
    {
        let (_, account) = location(app, owner)?;
        entry(&account, generation)?.get_password()
            .map(Zeroizing::new)
            .map_err(|_| "Claude API key is unavailable in Keychain. Reconnect it in Settings; subscription billing was not used.".into())
    }
    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (app, owner, generation);
        Err("This build has no secure credential store".into())
    }
}

/// Resolve only a reviewed item before acquiring task/admission locks. This
/// operation may prompt through Keychain; the returned value zeroizes on drop.
pub(crate) fn prepare_pinned_key(
    app: &AppHandle,
    owner: &str,
    generation: &str,
) -> Result<Zeroizing<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Credential update is busy")?;
    require_generation(app, owner, generation)?;
    // Address the reviewed item directly. A second mutable connection read
    // must never silently resolve a newer account under the same billing mode.
    let key = key_for_generation(app, owner, generation)?;
    require_generation(app, owner, generation)?;
    Ok(key)
}

fn require_generation(app: &AppHandle, owner: &str, generation: &str) -> Result<(), String> {
    if self::owner(app)? != owner
        || connection(app, owner)?.is_none_or(|value| value.generation != generation)
    {
        return Err("Claude API account changed. Review the task again; nothing ran.".into());
    }
    Ok(())
}

/// Serialize one bounded synchronous effect with credential rotation. This
/// never reads Keychain and fails busy instead of waiting behind its dialogs.
pub(crate) fn with_current_generation<T>(
    app: &AppHandle,
    owner: &str,
    generation: &str,
    effect: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = try_rotation_guard()?;
    require_generation(app, owner, generation)?;
    effect()
}

fn try_rotation_guard() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    WRITE_LOCK
        .try_lock()
        .map_err(|_| "Credential update is busy; nothing ran".into())
}

pub(crate) fn save(app: &AppHandle, owner: &str, key: &str) -> Result<Connection, String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Credential update is busy")?;
    #[cfg(feature = "system-keyring")]
    {
        let (path, account) = location(app, owner)?;
        // Explicit reconnect also repairs a damaged routing reference. A failed
        // atomic write below still leaves the original bytes untouched.
        let previous = connection(app, owner).ok().flatten();
        let connection = Connection {
            generation: uuid::Uuid::new_v4().to_string(),
        };
        let entry = entry(&account, &connection.generation)?;
        entry
            .set_password(key)
            .map_err(|_| "Could not save Claude API key in Keychain")?;
        let verified = match entry.get_password().map(Zeroizing::new) {
            Ok(verified) => verified,
            Err(_) => {
                let _ = entry.delete_credential();
                return Err("Could not verify Claude API key in Keychain".into());
            }
        };
        if verified.as_str() != key {
            let _ = entry.delete_credential();
            return Err("Claude API key did not round-trip through Keychain".into());
        }
        let parent = path.parent().ok_or("Credential directory is unavailable")?;
        if std::fs::create_dir_all(parent).is_err() {
            let _ = entry.delete_credential();
            return Err("Could not create credential directory".into());
        }
        let bytes = serde_json::to_vec(&connection).map_err(|_| "Could not encode connection")?;
        if super::storage::atomic_write_json_restricted(&path, &bytes).is_err() {
            let _ = entry.delete_credential();
            return Err("Could not save connection. The previous connection is unchanged.".into());
        }
        if let Some(previous) = previous {
            if let Ok(previous) = self::entry(&account, &previous.generation) {
                let _ = previous.delete_credential();
            }
        }
        Ok(connection)
    }
    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (app, owner, key);
        Err("This build has no secure credential store".into())
    }
}

pub(crate) fn disconnect(app: &AppHandle, owner: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|_| "Credential update is busy")?;
    let (path, account) = location(app, owner)?;
    if let Some(previous) = connection(app, owner)? {
        // Remove the routing reference first. A Keychain deletion failure must
        // never leave API billing selected after Use Claude login was pressed.
        std::fs::remove_file(path).map_err(|_| "Could not disconnect Claude API billing")?;
        #[cfg(feature = "system-keyring")]
        entry(&account, &previous.generation)?
            .delete_credential()
            .map_err(|_| {
                "API billing disconnected, but the old key could not be removed from Keychain"
            })?;
        #[cfg(not(feature = "system-keyring"))]
        let _ = (account, previous);
    }
    Ok(())
}

pub(crate) fn validate_input(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 8192 || !key.bytes().all(|c| c.is_ascii_graphic()) {
        return Err("Enter an API key without spaces or line breaks.".into());
    }
    Ok(())
}

pub(crate) fn uses_claude(command: &str, native: bool) -> bool {
    !native && super::known_acp_runtime(command).is_some_and(|rt| rt.id == "claude")
}

/// Apply only to a managed Claude child, after all editable env layers. A
/// configured but missing key errors before spawn, never falling back to OAuth.
pub(crate) fn apply(cmd: &mut Command, key: &str) {
    for name in [
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
        "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
    ] {
        cmd.env_remove(name);
    }
    cmd.env(API_MODE_ENV, "1")
        .env("ANTHROPIC_API_KEY", key)
        .env("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        .env("CLAUDE_CODE_USE_BEDROCK", "0")
        .env("CLAUDE_CODE_USE_VERTEX", "0")
        .env("CLAUDE_CODE_USE_FOUNDRY", "0");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_effect_guard_fails_busy_instead_of_waiting_for_keychain() {
        let held = WRITE_LOCK.lock().unwrap();
        assert!(try_rotation_guard().is_err());
        drop(held);
        assert!(try_rotation_guard().is_ok());
    }
    #[test]
    fn scope_is_owner_and_instance_specific() {
        assert_ne!(
            scope(Path::new("/a"), "owner"),
            scope(Path::new("/b"), "owner")
        );
        assert_ne!(
            scope(Path::new("/a"), "owner"),
            scope(Path::new("/a"), "other")
        );
    }
    #[test]
    fn secret_is_not_serialized_and_invalid_input_is_not_echoed() {
        let value = serde_json::to_string(&Connection {
            generation: "opaque-ref".into(),
        })
        .unwrap();
        assert_eq!(value, r#"{"generation":"opaque-ref"}"#);
        for key in ["", "secret\n", "secret value", "🗝"] {
            assert_eq!(
                validate_input(key).unwrap_err(),
                "Enter an API key without spaces or line breaks."
            );
        }
    }
    #[test]
    fn native_profiles_and_other_harnesses_never_use_this_connection() {
        assert!(uses_claude("claude-agent-acp", false));
        assert!(!uses_claude("claude-agent-acp", true));
        assert!(!uses_claude("codex-acp", false));
    }
    #[test]
    fn process_env_is_scoped_and_scrubs_other_billing_routes() {
        let mut cmd = Command::new("claude-agent-acp");
        apply(&mut cmd, "test-only-key");
        let env: std::collections::BTreeMap<_, _> = cmd.get_envs().collect();
        assert_eq!(
            env[std::ffi::OsStr::new("ANTHROPIC_API_KEY")],
            Some(std::ffi::OsStr::new("test-only-key"))
        );
        assert_eq!(env[std::ffi::OsStr::new("CLAUDE_CODE_OAUTH_TOKEN")], None);
        assert_eq!(
            env[std::ffi::OsStr::new(API_MODE_ENV)],
            Some(std::ffi::OsStr::new("1"))
        );
    }
}

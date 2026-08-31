use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::Read,
    sync::{Condvar, Mutex, OnceLock},
    thread::JoinHandle,
};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::agent_env::build_buzz_agent_provider_defaults;
use super::owner_brain_authority::managed_runtime_configuration_sha256;
use super::runtime_authority::{managed_owner_attestation, next_managed_session_epoch};

use crate::{
    managed_agents::{
        append_log_marker, known_acp_runtime, login_shell_path, managed_agent_log_path,
        missing_command_message, normalize_agent_args, open_log_file, resolve_command,
        spawn_key_refusal, KnownAcpRuntime, ManagedAgentProcess, ManagedAgentRecord,
        ManagedAgentSummary,
    },
    util::now_iso,
};

mod path;
pub(in crate::managed_agents) use path::build_augmented_path;

mod openclaw_compat;

mod sweep;
pub(crate) use sweep::sweep_untracked_bundle_harnesses;

fn artifact_mcp_support_for_spawn(
    native_binding: Option<&super::RuntimeBinding>,
    effective_command: &str,
) -> super::ArtifactMcpSupport {
    match native_binding {
        Some(super::RuntimeBinding::Hermes { .. }) => super::ArtifactMcpSupport::Supported,
        // OpenClaw remains fail-closed until its model-shell and nested-process
        // containment has a dedicated acceptance test.
        Some(super::RuntimeBinding::Openclaw { .. }) => super::ArtifactMcpSupport::Unavailable,
        None => known_acp_runtime(effective_command).map_or(
            super::ArtifactMcpSupport::ProbePending,
            super::discovery::artifact_mcp_support,
        ),
    }
}

fn artifact_probe_secret_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    super::env_vars::is_reserved_env_key(key)
        || upper.contains("SECRET")
        || upper.contains("TOKEN")
        || upper.contains("PASSWORD")
        || upper.contains("CREDENTIAL")
        || upper.ends_with("_API_KEY")
        || upper.ends_with("_PRIVATE_KEY")
}

fn hash_probe_component(hasher: &mut Sha256, label: &[u8], value: &[u8]) {
    hasher.update((label.len() as u64).to_be_bytes());
    hasher.update(label);
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value);
}

fn artifact_mcp_probe_key(
    executable: &str,
    launcher_identity: &str,
    agent_args: &[String],
    behavior_env: &BTreeMap<String, String>,
    config_file_path: Option<&str>,
) -> Result<luca_protocol::Sha256Ref, String> {
    let resolved = resolve_command(executable)
        .ok_or_else(|| "failed to fingerprint ACP executable".to_owned())?;
    let canonical = resolved
        .canonicalize()
        .map_err(|_| "failed to fingerprint ACP executable".to_owned())?;
    let mut file = std::fs::File::open(canonical)
        .map_err(|_| "failed to fingerprint ACP executable".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(b"luca.artifact.acp-launcher.v2\0");
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "failed to fingerprint ACP executable".to_owned())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    hash_probe_component(
        &mut hasher,
        b"launcher-identity",
        launcher_identity.trim().as_bytes(),
    );
    for argument in normalize_agent_args(launcher_identity, agent_args.to_vec()) {
        hash_probe_component(&mut hasher, b"argument", argument.as_bytes());
    }
    if let Some(path) = config_file_path {
        hash_probe_component(&mut hasher, b"config-descriptor", path.as_bytes());
    }
    for (key, value) in behavior_env {
        hash_probe_component(&mut hasher, b"env-key", key.as_bytes());
        let projected = if artifact_probe_secret_env_key(key) {
            b"<present-secret>".as_slice()
        } else {
            value.as_bytes()
        };
        hash_probe_component(&mut hasher, b"env-value", projected);
    }
    luca_protocol::Sha256Ref::parse(format!("sha256:{}", hex::encode(hasher.finalize())))
        .map_err(|_| "failed to fingerprint ACP executable".to_owned())
}

fn artifact_mcp_support_env(support: super::ArtifactMcpSupport) -> &'static str {
    match support {
        super::ArtifactMcpSupport::Supported => "supported",
        super::ArtifactMcpSupport::ProbePending => "probe_pending",
        super::ArtifactMcpSupport::Unavailable => "unavailable",
    }
}

type RespondToEnv = (Vec<(&'static str, String)>, Vec<&'static str>);

#[derive(Debug, PartialEq, Eq)]
struct NativeRuntimeEnvPolicy {
    user_env: BTreeMap<String, String>,
    scrub_ambient: Vec<String>,
}

fn is_native_runtime_forbidden_env_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    if upper.starts_with("HERMES_") || upper.starts_with("OPENCLAW_") {
        return false;
    }
    matches!(
        upper.as_str(),
        "BUZZ_PRIVATE_KEY"
            | "NOSTR_PRIVATE_KEY"
            | "BUZZ_AUTH_TAG"
            | "BUZZ_API_TOKEN"
            | "BUZZ_ACP_PRIVATE_KEY"
            | "BUZZ_ACP_API_TOKEN"
            | "AWS_ACCESS_KEY_ID"
            | "AWS_SECRET_ACCESS_KEY"
            | "AWS_SESSION_TOKEN"
            | "DATABRICKS_TOKEN"
            | "GOOGLE_APPLICATION_CREDENTIALS"
    ) || upper.ends_with("_API_KEY")
        || upper.ends_with("_ACCESS_TOKEN")
        || upper.ends_with("_AUTH_TOKEN")
        || upper.ends_with("_CLIENT_SECRET")
        || upper.ends_with("_PASSWORD")
        || upper.ends_with("_CREDENTIALS")
}

/// Imported native identities own their provider authentication. Luca does not
/// layer global/persona/agent env onto them, and ambient owner/provider secrets
/// are explicitly removed before the harness and all descendants start.
fn native_runtime_env_policy(
    _luca_user_env: BTreeMap<String, String>,
    ambient_keys: impl IntoIterator<Item = String>,
) -> NativeRuntimeEnvPolicy {
    let mut scrub_ambient = ambient_keys
        .into_iter()
        .filter(|key| is_native_runtime_forbidden_env_key(key))
        .collect::<Vec<_>>();
    scrub_ambient.sort();
    scrub_ambient.dedup();
    NativeRuntimeEnvPolicy {
        user_env: BTreeMap::new(),
        scrub_ambient,
    }
}

#[derive(Debug)]
struct ManagedSigningBrokerOwner {
    owner_pubkey: String,
    session_epoch: luca_protocol::SafeU53,
    shutdown: crate::luca::signing_transport::DesktopBrokerShutdown,
    handle: JoinHandle<()>,
}

fn managed_signing_brokers() -> &'static Mutex<HashMap<String, ManagedSigningBrokerOwner>> {
    static BROKERS: OnceLock<Mutex<HashMap<String, ManagedSigningBrokerOwner>>> = OnceLock::new();
    BROKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn managed_capsule_brokers(
) -> &'static Mutex<HashMap<String, crate::luca::continuity_capsule::CapsuleBrokerHandle>> {
    static BROKERS: OnceLock<
        Mutex<HashMap<String, crate::luca::continuity_capsule::CapsuleBrokerHandle>>,
    > = OnceLock::new();
    BROKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_managed_capsule_broker(
    resident_pubkey: &str,
    handle: crate::luca::continuity_capsule::CapsuleBrokerHandle,
) -> Result<(), ()> {
    let mut brokers = managed_capsule_brokers().lock().map_err(|_| ())?;
    if brokers.contains_key(resident_pubkey) {
        return Err(());
    }
    brokers.insert(resident_pubkey.to_owned(), handle);
    Ok(())
}

fn register_managed_signing_broker(
    resident_pubkey: &str,
    owner: ManagedSigningBrokerOwner,
) -> Result<(), ManagedSigningBrokerOwner> {
    let Ok(mut brokers) = managed_signing_brokers().lock() else {
        return Err(owner);
    };
    if brokers.contains_key(resident_pubkey) {
        return Err(owner);
    }
    brokers.insert(resident_pubkey.to_owned(), owner);
    Ok(())
}

/// Clone one bounded, non-signing Capsule handle without retaining the broker
/// registry lock while the caller waits for resident authority.
pub(crate) fn managed_capsule_broker_handle(
    resident_pubkey: &str,
) -> Result<crate::luca::continuity_capsule::CapsuleBrokerHandle, String> {
    managed_capsule_brokers()
        .lock()
        .map_err(|_| "managed Capsule broker registry is unavailable".to_owned())?
        .get(resident_pubkey)
        .cloned()
        .ok_or_else(|| "managed resident signing broker is unavailable".to_owned())
}

pub(crate) fn join_managed_signing_broker(resident_pubkey: &str) -> Result<(), String> {
    // Process replacement, forced kill, ordinary exit, and app teardown all
    // converge here. Revoke every communication turn before any replacement
    // runtime can be exposed under a fresh session epoch.
    crate::luca::communication_turn_registry::clear_resident(resident_pubkey);
    #[cfg(unix)]
    let repository_result = crate::luca::repository_bridge::stop_repository_broker(resident_pubkey);
    #[cfg(unix)]
    let communications_result =
        crate::luca::communication_bridge::stop_communication_broker(resident_pubkey);
    #[cfg(unix)]
    let artifact_result = crate::luca::artifact_bridge::stop_artifact_broker(resident_pubkey);
    crate::luca::managed_cognition::unregister(resident_pubkey);
    managed_capsule_brokers()
        .lock()
        .map_err(|_| "managed Capsule broker registry is unavailable".to_owned())?
        .remove(resident_pubkey);
    let owner = managed_signing_brokers()
        .lock()
        .map_err(|_| "managed signing broker registry is unavailable".to_owned())?
        .remove(resident_pubkey);
    if let Some(owner) = owner {
        if let Err(error) = crate::commands::stop_preview_sessions_for_resident_epoch(
            &owner.owner_pubkey,
            resident_pubkey,
            owner.session_epoch,
        ) {
            eprintln!("luca-artifacts: failed to revoke resident previews: {error}");
        }
        #[cfg(unix)]
        let shutdown_result = owner.shutdown.shutdown();
        let join_result = owner
            .handle
            .join()
            .map_err(|_| "managed signing broker thread panicked".to_owned());
        join_result?;
        #[cfg(unix)]
        shutdown_result
            .map_err(|error| format!("failed to stop managed signing broker: {error}"))?;
    }
    #[cfg(unix)]
    repository_result?;
    #[cfg(unix)]
    communications_result?;
    #[cfg(unix)]
    artifact_result?;
    Ok(())
}

fn terminalize_restart_dispatches_if_proven(
    startup_status: crate::luca::managed_message_outbox::StartupOutboxReconciliation,
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    resident_pubkey: &str,
    replacement_session_epoch: u64,
) -> Result<Option<usize>, String> {
    match startup_status {
        crate::luca::managed_message_outbox::StartupOutboxReconciliation::FullyTerminal => {
            dispatch_store
                .lock()
                .map_err(|_| "managed dispatch store lock is unavailable".to_string())?
                .terminalize_prior_epoch_after_outbox_reconciliation(
                    resident_pubkey,
                    replacement_session_epoch,
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|elapsed| elapsed.as_secs())
                        .unwrap_or(0),
                )
                .map(Some)
        }
        crate::luca::managed_message_outbox::StartupOutboxReconciliation::Deferred => Ok(None),
    }
}

const RESTART_RECEIPT_RETRY_DELAYS_MS: [u64; 5] = [100, 250, 500, 1_000, 2_000];

fn settle_restart_receipt_batch<F>(
    receipts: &[crate::luca::managed_dispatch_store::RestartInterruptedArtifactReceiptBinding],
    settle: &mut F,
) -> usize
where
    F: FnMut(
        &crate::luca::managed_dispatch_store::RestartInterruptedArtifactReceiptBinding,
    ) -> Result<(), String>,
{
    receipts
        .iter()
        .filter(|receipt| settle(receipt).is_err())
        .count()
}

fn bounded_restart_receipt_retry<L, F, W>(
    mut load: L,
    mut settle: F,
    mut wait: W,
    max_attempts: usize,
) -> usize
where
    L: FnMut() -> Result<
        Vec<crate::luca::managed_dispatch_store::RestartInterruptedArtifactReceiptBinding>,
        String,
    >,
    F: FnMut(
        &crate::luca::managed_dispatch_store::RestartInterruptedArtifactReceiptBinding,
    ) -> Result<(), String>,
    W: FnMut(usize),
{
    let mut remaining = 1;
    for attempt in 0..max_attempts {
        remaining = match load() {
            Ok(receipts) => settle_restart_receipt_batch(&receipts, &mut settle),
            Err(_) => 1,
        };
        if remaining == 0 {
            break;
        }
        if attempt + 1 < max_attempts {
            wait(attempt);
        }
    }
    remaining
}

fn spawn_restart_interrupted_artifact_receipt_retry(
    app: &AppHandle,
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    resident_pubkey: &str,
) -> Result<(), String> {
    let app = app.clone();
    let dispatch_store = std::sync::Arc::clone(dispatch_store);
    let resident_pubkey = resident_pubkey.to_owned();
    std::thread::Builder::new()
        .name(format!(
            "luca-artifact-receipts-{}",
            &resident_pubkey[..resident_pubkey.len().min(8)]
        ))
        .spawn(move || {
            let remaining = bounded_restart_receipt_retry(
                || {
                    dispatch_store
                        .lock()
                        .map_err(|_| "managed dispatch store lock is unavailable".to_string())
                        .map(|store| {
                            store.restart_interrupted_artifact_receipts_for_resident(
                                &resident_pubkey,
                            )
                        })
                },
                |receipt| {
                    crate::mark_cancelled_dispatch_receipts(
                        &app,
                        &receipt.owner_pubkey,
                        &receipt.conversation_id,
                        &receipt.resident_pubkey,
                        &receipt.dispatch_receipt_id,
                    )
                    .map(|_| ())
                },
                |attempt| {
                    std::thread::sleep(std::time::Duration::from_millis(
                        RESTART_RECEIPT_RETRY_DELAYS_MS[attempt],
                    ));
                },
                RESTART_RECEIPT_RETRY_DELAYS_MS.len() + 1,
            );
            if remaining > 0 {
                eprintln!(
                    "luca-artifacts: restart-interrupted receipt settlement deferred after bounded retries"
                );
            }
        })
        .map(|_| ())
        .map_err(|_| "failed to start artifact receipt settlement retry".to_string())
}

/// Binary name fragments for all known agent/harness processes that Buzz
/// may spawn. Used by `process_belongs_to_us()` and the orphan sweep to
/// identify processes we should clean up. Both hyphenated and underscored
/// variants are listed because macOS `proc_name()` and Linux `/proc/comm`
/// may report either form depending on how the binary was built.
pub(crate) const KNOWN_AGENT_BINARIES: &[&str] = &[
    "buzz-acp",
    "buzz_acp",
    "buzz-agent",
    "buzz_agent",
    "claude-agent-acp",
    "claude_agent_acp",
    "claude-code-acp",
    "claude_code_acp",
    "codex-acp",
    "codex_acp",
    "kimi",
    "grok",
    "goose",
    // buzz-dev-mcp's multicall personalities (rg, tree, buzz,
    // git-credential-nostr, git-sign-nostr) are short-lived per-tool-call
    // invocations — not listed here.
    "buzz-dev-mcp",
    "buzz_dev_mcp",
];

/// Script interpreters that may host managed agent wrappers (e.g. npm shims).
/// A process whose name matches here is NOT immediately claimed — it must also
/// carry `BUZZ_MANAGED_AGENT` in its environment (checked by the caller via
/// `process_has_buzz_marker()`). This avoids sweeping unrelated node processes.
pub(crate) const KNOWN_SCRIPT_INTERPRETERS: &[&str] = &["node"];

/// Check if a process name matches any of our known agent binaries.
/// Uses exact match or prefix-with-separator to avoid false positives
/// (e.g. `"goose"` must not match `"mongoose"`).
fn name_matches_known_binary(name: &str) -> bool {
    KNOWN_AGENT_BINARIES.iter().any(|&binary| {
        name == binary || {
            name.starts_with(binary) && {
                let rest = &name[binary.len()..];
                rest.starts_with('-') || rest.starts_with('_') || rest.starts_with('.')
            }
        }
    })
}

/// Check if a process name is a known script interpreter that may be hosting
/// a managed agent wrapper (e.g. `node` running an npm shim for `codex-acp`).
/// Callers must additionally verify `BUZZ_MANAGED_AGENT` ownership.
fn name_matches_interpreter(name: &str) -> bool {
    KNOWN_SCRIPT_INTERPRETERS.contains(&name)
}

#[cfg(unix)]
pub(crate) fn process_is_running(pid: u32) -> bool {
    // Use libc::kill with signal 0 instead of forking a subprocess.
    // Returns true only if the process exists AND we can signal it.
    // Returns false for non-existent PIDs (ESRCH) and PIDs owned by
    // other users (EPERM) — callers should not interact with those.
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(unix))]
pub(crate) fn process_is_running(_pid: u32) -> bool {
    false
}

/// Check if a PID belongs to a known agent process we spawned.
/// Returns false for recycled PIDs that now belong to other processes.
#[cfg(target_os = "macos")]
pub(crate) fn process_belongs_to_us(pid: u32) -> bool {
    // Use proc_name() from libproc to get the process name without spawning
    // a subprocess.
    extern "C" {
        fn proc_name(pid: libc::c_int, buffer: *mut libc::c_void, buffersize: u32) -> libc::c_int;
    }
    let mut buf = [0u8; 1024];
    let len = unsafe {
        proc_name(
            pid as i32,
            buf.as_mut_ptr() as *mut libc::c_void,
            buf.len() as u32,
        )
    };
    if len <= 0 {
        return false;
    }
    let name = String::from_utf8_lossy(&buf[..len as usize]);
    // Fall through for script interpreters (e.g. `node` hosting an npm shim):
    // the caller's `process_has_buzz_marker()` check decides true ownership.
    name_matches_known_binary(&name) || name_matches_interpreter(&name)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn process_belongs_to_us(pid: u32) -> bool {
    // First try /proc/<pid>/comm. Note: comm is truncated to 15 bytes on Linux,
    // so binaries with names longer than 15 chars (e.g. "claude-agent-acp")
    // will never match here.
    if let Ok(name) = std::fs::read_to_string(format!("/proc/{pid}/comm")) {
        if name_matches_known_binary(name.trim()) {
            return true;
        }
        // Interpreter check: `node` is 4 bytes, never truncated.
        if name_matches_interpreter(name.trim()) {
            return true;
        }
    }

    // Fallback: read /proc/<pid>/exe which is a symlink to the full binary path.
    // This is not subject to the 15-byte truncation limit.
    if let Ok(exe_path) = std::fs::read_link(format!("/proc/{pid}/exe")) {
        if let Some(basename) = exe_path.file_name().and_then(|n| n.to_str()) {
            // Fall through for script interpreters — caller checks the marker.
            return name_matches_known_binary(basename) || name_matches_interpreter(basename);
        }
    }

    false
}

#[cfg(not(unix))]
pub(crate) fn process_belongs_to_us(_pid: u32) -> bool {
    false
}

/// The value stamped into the `BUZZ_MANAGED_AGENT` env var of every agent we
/// spawn, identifying *which* desktop instance owns it. We use the app's bundle
/// identifier (`xyz.block.buzz.app` for release, `xyz.block.buzz.app.dev`
/// for `just dev`) because it is stable across restarts — a relaunched dev
/// instance still recognizes its own previously-spawned agents as reclaimable,
/// while never matching another instance's (e.g. a dev build never reaps a DMG
/// build's agents, and vice versa). This is what lets two Buzzs coexist on
/// one machine without one's cleanup nuking the other's agents.
pub(crate) fn current_instance_id(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

/// Build the full `BUZZ_MANAGED_AGENT=<instance-id>` env entry we match
/// against when scanning processes. Kept here so the spawn stamp and the sweep
/// matcher can never drift apart.
fn buzz_marker_entry(instance_id: &str) -> Vec<u8> {
    format!("BUZZ_MANAGED_AGENT={instance_id}").into_bytes()
}

/// Check if a running process is one of *our* managed agents: it must carry
/// `BUZZ_MANAGED_AGENT=<instance_id>` in its environment, where `instance_id`
/// is this desktop instance's id. A process stamped with a *different* instance
/// id belongs to another live Buzz app and must never be reaped here.
#[cfg(target_os = "macos")]
fn process_has_buzz_marker(pid: u32, instance_id: &str) -> bool {
    let marker = buzz_marker_entry(instance_id);
    let Some(buf) = sweep::procargs2_buffer(pid) else {
        return false;
    };

    // Buffer layout: [i32 argc][exec_path\0][null padding][argv\0...][env\0...]
    if buf.len() < std::mem::size_of::<libc::c_int>() {
        return false;
    }
    let mut n_args: libc::c_int = 0;
    unsafe {
        std::ptr::copy_nonoverlapping(
            buf.as_ptr(),
            &mut n_args as *mut libc::c_int as *mut u8,
            std::mem::size_of::<libc::c_int>(),
        );
    }
    let mut pos = std::mem::size_of::<libc::c_int>();

    // Skip exec path (scan to first null).
    while pos < buf.len() && buf[pos] != 0 {
        pos += 1;
    }
    // Skip null padding between exec path and argv[0].
    while pos < buf.len() && buf[pos] == 0 {
        pos += 1;
    }
    // Skip argc argument strings.
    let mut args_remaining = n_args;
    while args_remaining > 0 && pos < buf.len() {
        while pos < buf.len() && buf[pos] != 0 {
            pos += 1;
        }
        while pos < buf.len() && buf[pos] == 0 {
            pos += 1;
        }
        args_remaining -= 1;
    }
    // Remaining bytes are null-delimited environment strings.
    buf[pos..].split(|&b| b == 0).any(|entry| entry == marker)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn process_has_buzz_marker(pid: u32, instance_id: &str) -> bool {
    let marker = buzz_marker_entry(instance_id);
    let Ok(data) = std::fs::read(format!("/proc/{pid}/environ")) else {
        return false;
    };
    data.split(|&b| b == 0).any(|entry| entry == marker)
}

#[cfg(not(unix))]
fn process_has_buzz_marker(_pid: u32, _instance_id: &str) -> bool {
    false
}

#[cfg(unix)]
fn signal_process_group_or_leader(pid: u32, signal: i32, action: &str) -> Result<(), String> {
    let pgid = -(pid as i32);

    if unsafe { libc::kill(pgid, signal) } == 0 {
        return Ok(());
    }

    let group_err = std::io::Error::last_os_error();
    if !process_is_running(pid) {
        return Ok(());
    }

    // Some local agent trees can no longer be signalled as a process group
    // (for example if the leader changed groups, or macOS returns EPERM for one
    // descendant). Fall back to the leader PID so stop/delete can still recover.
    if matches!(
        group_err.raw_os_error(),
        Some(libc::EPERM) | Some(libc::ESRCH)
    ) {
        if unsafe { libc::kill(pid as i32, signal) } == 0 {
            return Ok(());
        }

        let leader_err = std::io::Error::last_os_error();
        if leader_err.raw_os_error() == Some(libc::ESRCH) || !process_is_running(pid) {
            return Ok(());
        }

        return Err(format!("failed to {action} process {pid}: {leader_err}"));
    }

    Err(format!(
        "failed to {action} process group {pid}: {group_err}"
    ))
}

#[cfg(unix)]
pub(crate) fn terminate_process(pid: u32) -> Result<(), String> {
    // Try graceful shutdown first (SIGTERM to the group).
    signal_process_group_or_leader(pid, libc::SIGTERM, "terminate")?;

    // Wait up to 1s for graceful exit.
    for _ in 0..10 {
        if !process_is_running(pid) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Escalate to SIGKILL on the entire group.
    signal_process_group_or_leader(pid, libc::SIGKILL, "kill")?;

    Ok(())
}

#[cfg(windows)]
pub(crate) fn terminate_process(pid: u32) -> Result<(), String> {
    // No job handle is available on this path (e.g. after an app restart, when
    // we only recovered the PID from the record), so fall back to taskkill on
    // the whole tree.
    super::process_lifecycle::taskkill_tree(pid)
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn terminate_process(_pid: u32) -> Result<(), String> {
    Err("managed agent shutdown after app restart is not supported on this platform".to_string())
}

/// Send SIGTERM to all given PIDs (as process groups), wait, then SIGKILL
/// any survivors. Uses `-pid` to kill the entire process group — if an
/// orphaned agent called `setsid()`, it IS the group leader, so this
/// reaches its children too.
#[cfg(unix)]
fn sigterm_then_sigkill(pids: &[i32]) {
    // Send SIGTERM to each process group. Track whether any signal was
    // actually delivered so we can skip the sleep when everything is
    // already gone.
    let mut any_signalled = false;
    for &pid in pids {
        if unsafe { libc::kill(-pid, libc::SIGTERM) } == 0 {
            any_signalled = true;
        }
    }

    if !any_signalled {
        return;
    }

    std::thread::sleep(std::time::Duration::from_millis(200));

    for &pid in pids {
        // Check if the group has any living members, not just the leader.
        // kill(-pid, 0) returns 0 if ANY member of the group is signalable.
        if unsafe { libc::kill(-pid, 0) } == 0 {
            unsafe {
                libc::kill(-pid, libc::SIGKILL);
            }
        }
    }
}

/// Resolve orphan candidate PIDs to their actual process group IDs, dedupe,
/// and signal the groups. An orphaned grandchild (e.g. `goose` or `buzz-dev-mcp`)
/// whose harness has exited retains the harness's PGID — signaling that PGID
/// kills the entire orphaned subtree. Falls back to the candidate PID itself
/// when PGID resolution fails (process may have exited between detection and
/// kill).
#[cfg(target_os = "macos")]
fn resolve_pgids_and_kill(candidate_pids: &[i32]) {
    let candidate_set: std::collections::HashSet<i32> = candidate_pids.iter().copied().collect();
    let mut pgids = std::collections::HashSet::new();
    for &pid in candidate_pids {
        let pgid = unsafe { libc::getpgid(pid) };
        if pgid > 0 {
            pgids.insert(pgid);
        } else {
            // Process may have exited; try signaling it directly as a group.
            pgids.insert(pid);
        }
    }
    // PID-recycling guard: if a resolved PGID is alive but isn't one of our
    // orphan candidates, the old harness PID was recycled by a new process
    // that called setsid() — skip it to avoid killing an unrelated group.
    let candidate_groups = pgids.len();
    pgids.retain(|&pgid| {
        if candidate_set.contains(&pgid) {
            return true;
        }
        let alive = unsafe { libc::kill(pgid, 0) } == 0;
        !alive
    });
    if pgids.is_empty() && candidate_groups > 0 {
        eprintln!(
            "buzz-desktop: orphan sweep: skipped all {candidate_groups} candidate group(s) (live foreign group leader or candidate already exited); nothing signalled"
        );
    }
    let unique: Vec<i32> = pgids.into_iter().collect();
    sigterm_then_sigkill(&unique);
}

/// Resolve orphan candidate PIDs to their actual process group IDs, dedupe,
/// and signal the groups. Linux variant reads PGID from /proc/<pid>/stat.
#[cfg(all(unix, not(target_os = "macos")))]
fn resolve_pgids_and_kill(candidate_pids: &[i32]) {
    let candidate_set: std::collections::HashSet<i32> = candidate_pids.iter().copied().collect();
    let mut pgids = std::collections::HashSet::new();
    for &pid in candidate_pids {
        if let Some(pgid) = read_pgid_linux(pid as u32) {
            pgids.insert(pgid as i32);
        } else {
            // Process may have exited; try signaling it directly as a group.
            pgids.insert(pid);
        }
    }
    // PID-recycling guard: if a resolved PGID is alive but isn't one of our
    // orphan candidates, the old harness PID was recycled by a new process
    // that called setsid() — skip it to avoid killing an unrelated group.
    let candidate_groups = pgids.len();
    pgids.retain(|&pgid| {
        if candidate_set.contains(&pgid) {
            return true;
        }
        let alive = unsafe { libc::kill(pgid, 0) } == 0;
        !alive
    });
    if pgids.is_empty() && candidate_groups > 0 {
        eprintln!(
            "buzz-desktop: orphan sweep: skipped all {candidate_groups} candidate group(s) (live foreign group leader or candidate already exited); nothing signalled"
        );
    }
    let unique: Vec<i32> = pgids.into_iter().collect();
    sigterm_then_sigkill(&unique);
}

/// Kill orphaned agent processes using PID file receipts. Reads all files from
/// `agent-pids/`, verifies each PID still belongs to a known agent binary,
/// then resolves each candidate's actual PGID and signals the process group.
/// Deletes the PID file after killing.
///
/// `skip_pids` are PIDs already handled by the tracked-agent path.
#[cfg(unix)]
pub(crate) fn sweep_orphaned_agent_processes(app: &AppHandle, skip_pids: &[u32]) {
    let entries = super::read_all_agent_pid_files(app);
    // Collect live orphans AND dead-leader groups into a single kill batch.
    // Dead leaders: PGID may have been recycled, but the window is narrow
    // (PID files are from this session) and the cost of missing surviving
    // group members outweighs the recycling risk.
    let targets: Vec<i32> = entries
        .iter()
        .filter(|(_, pid)| {
            if skip_pids.contains(pid) {
                return false;
            }
            (process_is_running(*pid) && process_belongs_to_us(*pid)) || !process_is_running(*pid)
        })
        .map(|(_, pid)| *pid as i32)
        .collect();

    if !targets.is_empty() {
        resolve_pgids_and_kill(&targets);
    }

    // Clean up PID files for processes we just killed or that are already gone.
    for (pubkey, pid) in &entries {
        if skip_pids.contains(pid) {
            continue;
        }
        if !process_is_running(*pid) || !process_belongs_to_us(*pid) {
            super::remove_agent_pid_file(app, pubkey);
        }
    }
}

#[cfg(not(unix))]
pub(crate) fn sweep_orphaned_agent_processes(app: &AppHandle, _skip_pids: &[u32]) {
    let _ = app;
}

// ── macOS process-info FFI (shared by all sweep/reap functions) ──────────
//
// `proc_listallpids` lives in `sweep.rs` (which owns `collect_all_pids`).
// All callers in this file reach it through `sweep::collect_all_pids()`.
// `proc_pidinfo` and `BSDInfo` are declared here as `pub(super)` so that
// `sweep.rs` can call `super::proc_pidinfo` / use `super::BSDInfo` without
// redefining the struct layout in two places.

#[cfg(target_os = "macos")]
extern "C" {
    pub(super) fn proc_pidinfo(
        pid: libc::c_int,
        flavor: libc::c_int,
        arg: u64,
        buffer: *mut libc::c_void,
        buffersize: libc::c_int,
    ) -> libc::c_int;
}

/// Subset of `struct proc_bsdinfo` from `<sys/proc_info.h>`. Layout verified
/// against the macOS SDK — total size 136 bytes.
#[cfg(target_os = "macos")]
#[repr(C)]
pub(super) struct BSDInfo {
    _flags_status_xstatus: [u8; 12], // pbi_flags + pbi_status + pbi_xstatus
    pub(super) pbi_pid: u32,         // offset 12
    pub(super) pbi_ppid: u32,        // offset 16
    pub(super) pbi_uid: u32,         // offset 20
    _rest: [u8; 112],
}

#[cfg(target_os = "macos")]
const _: () = assert!(std::mem::size_of::<BSDInfo>() == 136);

#[cfg(target_os = "macos")]
pub(super) const PROC_PIDTBSDINFO: libc::c_int = 3;

/// Enumerate all processes on the system owned by the current user and kill any
/// agent binary stamped with *this* instance's `BUZZ_MANAGED_AGENT` marker
/// (`instance_id`) that isn't in `skip_pids`. This catches orphans that escaped
/// PID-file-based cleanup (e.g. agent workers spawned with their own process
/// group whose parent harness already exited and had its PID file removed),
/// while leaving another live Buzz instance's agents untouched.
#[cfg(target_os = "macos")]
pub(crate) fn sweep_system_agent_processes(instance_id: &str, skip_pids: &[u32]) {
    let my_uid = unsafe { libc::getuid() };
    let pids = sweep::collect_all_pids();
    if pids.is_empty() {
        return;
    }
    let my_pid = std::process::id() as i32;
    let mut orphans: Vec<i32> = Vec::new();

    for &pid in &pids {
        if pid <= 0 {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) || pid == my_pid {
            continue;
        }
        // Check binary name first (cheap proc_name call) before UID lookup.
        if !process_belongs_to_us(upid) {
            continue;
        }
        // Verify UID and PPID via proc_pidinfo.
        let mut info = std::mem::MaybeUninit::<BSDInfo>::zeroed();
        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr() as *mut libc::c_void,
                std::mem::size_of::<BSDInfo>() as libc::c_int,
            )
        };
        if ret <= 0 {
            continue;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_uid != my_uid {
            continue;
        }
        if !process_has_buzz_marker(upid, instance_id) {
            continue;
        }
        // Live descendants of a tracked harness are exempt — see sweep::is_live_descendant_*.
        if sweep::is_live_descendant_macos(upid, info.pbi_ppid, skip_pids) {
            continue;
        }
        orphans.push(pid);
    }

    if !orphans.is_empty() {
        eprintln!(
            "buzz-desktop: system sweep found {} orphaned agent process(es), cleaning up",
            orphans.len()
        );
        resolve_pgids_and_kill(&orphans);
    }
}

/// Read the process group ID from /proc/<pid>/stat by delegating to the shared
/// stat parser in `sweep`. Keeps a single parse site for the `/proc/<pid>/stat`
/// field layout.
#[cfg(all(unix, not(target_os = "macos")))]
fn read_pgid_linux(pid: u32) -> Option<u32> {
    sweep::proc_stat_ppid_pgid_linux(pid).map(|(_, pgid)| pgid)
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn sweep_system_agent_processes(instance_id: &str, skip_pids: &[u32]) {
    let my_uid = unsafe { libc::getuid() };
    let mut orphans: Vec<i32> = Vec::new();
    let my_pid = std::process::id() as i32;

    let Ok(entries) = std::fs::read_dir("/proc") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<i32>() else {
            continue;
        };
        if pid <= 0 || pid == my_pid {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) {
            continue;
        }
        // Check ownership via /proc/<pid> metadata.
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != my_uid {
            continue;
        }
        if !process_belongs_to_us(upid) || !process_has_buzz_marker(upid, instance_id) {
            continue;
        }
        // Live descendants of a tracked harness are exempt — see sweep::is_live_descendant_*.
        if sweep::is_live_descendant_linux(upid, skip_pids) {
            continue;
        }
        orphans.push(pid);
    }

    if !orphans.is_empty() {
        eprintln!(
            "buzz-desktop: system sweep found {} orphaned agent process(es), cleaning up",
            orphans.len()
        );
        resolve_pgids_and_kill(&orphans);
    }
}

#[cfg(not(unix))]
pub(crate) fn sweep_system_agent_processes(_instance_id: &str, _skip_pids: &[u32]) {}

/// Periodic-sweep variant with two-tick grace: only reaps same-instance orphans
/// that were also seen orphaned on the previous tick. This prevents killing a
/// legitimately-starting agent that spawned between the skip-list snapshot and
/// the process scan. Returns the current orphan set for use as `prev_orphans`
/// on the next tick.
#[cfg(unix)]
pub(crate) fn sweep_system_agent_processes_with_grace(
    instance_id: &str,
    skip_pids: &[u32],
    prev_orphans: &std::collections::HashSet<u32>,
) -> std::collections::HashSet<u32> {
    let current = collect_same_instance_orphans(instance_id, skip_pids);
    // Only reap PIDs seen orphaned on two consecutive ticks.
    let confirmed: Vec<i32> = current
        .iter()
        .filter(|pid| prev_orphans.contains(pid))
        .map(|&pid| pid as i32)
        .collect();
    if !confirmed.is_empty() {
        eprintln!(
            "buzz-desktop: periodic sweep confirmed {} orphaned agent process(es), cleaning up",
            confirmed.len()
        );
        resolve_pgids_and_kill(&confirmed);
    }
    current
}

#[cfg(not(unix))]
pub(crate) fn sweep_system_agent_processes_with_grace(
    _instance_id: &str,
    _skip_pids: &[u32],
    _prev_orphans: &std::collections::HashSet<u32>,
) -> std::collections::HashSet<u32> {
    std::collections::HashSet::new()
}

/// Collect PIDs of same-instance agent processes that appear orphaned (not in
/// `skip_pids`). Returns the set for use in two-tick grace logic — does NOT
/// kill anything.
#[cfg(target_os = "macos")]
pub(crate) fn collect_same_instance_orphans(
    instance_id: &str,
    skip_pids: &[u32],
) -> std::collections::HashSet<u32> {
    let my_uid = unsafe { libc::getuid() };
    let my_pid = std::process::id() as i32;
    let mut orphans = std::collections::HashSet::new();

    let pids = sweep::collect_all_pids();
    if pids.is_empty() {
        return orphans;
    }

    for &pid in &pids {
        if pid <= 0 || pid == my_pid {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) {
            continue;
        }
        if !process_belongs_to_us(upid) {
            continue;
        }
        let mut info = std::mem::MaybeUninit::<BSDInfo>::zeroed();
        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr() as *mut libc::c_void,
                std::mem::size_of::<BSDInfo>() as libc::c_int,
            )
        };
        if ret <= 0 {
            continue;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_uid != my_uid {
            continue;
        }
        if !process_has_buzz_marker(upid, instance_id) {
            continue;
        }
        // Live descendants of a tracked harness are exempt — see sweep::is_live_descendant_*.
        if sweep::is_live_descendant_macos(upid, info.pbi_ppid, skip_pids) {
            continue;
        }
        orphans.insert(upid);
    }
    orphans
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn collect_same_instance_orphans(
    instance_id: &str,
    skip_pids: &[u32],
) -> std::collections::HashSet<u32> {
    let my_uid = unsafe { libc::getuid() };
    let my_pid = std::process::id() as i32;
    let mut orphans = std::collections::HashSet::new();

    let Ok(entries) = std::fs::read_dir("/proc") else {
        return orphans;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<i32>() else {
            continue;
        };
        if pid <= 0 || pid == my_pid {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != my_uid {
            continue;
        }
        if !process_belongs_to_us(upid) || !process_has_buzz_marker(upid, instance_id) {
            continue;
        }
        // Live descendants of a tracked harness are exempt — see sweep::is_live_descendant_*.
        if sweep::is_live_descendant_linux(upid, skip_pids) {
            continue;
        }
        orphans.insert(upid);
    }
    orphans
}

#[cfg(not(unix))]
pub(crate) fn collect_same_instance_orphans(
    _instance_id: &str,
    _skip_pids: &[u32],
) -> std::collections::HashSet<u32> {
    std::collections::HashSet::new()
}

/// Binary names for the Buzz desktop/Tauri process. Used by dead-instance
/// detection to confirm the owning desktop is still alive.
const DESKTOP_BINARY_NAMES: &[&str] = &["Buzz", "buzz-desktop", "buzz_desktop"];

/// Check if a process name matches a known Buzz desktop binary.
fn is_desktop_binary(name: &str) -> bool {
    DESKTOP_BINARY_NAMES.contains(&name)
}

/// Check whether `buf` contains `id` as a complete identifier — not as a
/// prefix of a longer dotted name. The identifier appears in the Tauri config
/// JSON as `"identifier":"xyz.block.buzz.app.dev"` and in environment entries
/// as `KEY=...app.dev\0`, so a valid match is followed by a non-identifier byte
/// (not `[A-Za-z0-9._-]`) or sits at the end of the buffer. This prevents
/// `xyz.block.buzz.app` from matching inside `xyz.block.buzz.app.dev`.
fn buffer_contains_identifier(buf: &[u8], id: &[u8]) -> bool {
    if id.is_empty() {
        return false;
    }
    buf.windows(id.len()).enumerate().any(|(i, w)| {
        if w != id {
            return false;
        }
        // Boundary check on the byte immediately after the match: end-of-buffer
        // or any byte that can't continue a dotted reverse-DNS identifier.
        match buf.get(i + id.len()) {
            None => true,
            Some(&next) => {
                !next.is_ascii_alphanumeric() && next != b'.' && next != b'_' && next != b'-'
            }
        }
    })
}

/// Extract the `BUZZ_MANAGED_AGENT` value from a process's environment.
/// Returns `None` if the process doesn't have the marker or can't be read.
#[cfg(target_os = "macos")]
fn extract_buzz_marker_value(pid: u32) -> Option<String> {
    let prefix = b"BUZZ_MANAGED_AGENT=";
    let buf = sweep::procargs2_buffer(pid)?;

    if buf.len() < std::mem::size_of::<libc::c_int>() {
        return None;
    }
    let mut n_args: libc::c_int = 0;
    unsafe {
        std::ptr::copy_nonoverlapping(
            buf.as_ptr(),
            &mut n_args as *mut libc::c_int as *mut u8,
            std::mem::size_of::<libc::c_int>(),
        );
    }
    let mut pos = std::mem::size_of::<libc::c_int>();

    // Skip exec path.
    while pos < buf.len() && buf[pos] != 0 {
        pos += 1;
    }
    while pos < buf.len() && buf[pos] == 0 {
        pos += 1;
    }
    // Skip argc argument strings.
    let mut args_remaining = n_args;
    while args_remaining > 0 && pos < buf.len() {
        while pos < buf.len() && buf[pos] != 0 {
            pos += 1;
        }
        while pos < buf.len() && buf[pos] == 0 {
            pos += 1;
        }
        args_remaining -= 1;
    }
    // Search environment entries for our marker.
    for entry in buf[pos..].split(|&b| b == 0) {
        if entry.starts_with(prefix) {
            return String::from_utf8(entry[prefix.len()..].to_vec()).ok();
        }
    }
    None
}

#[cfg(all(unix, not(target_os = "macos")))]
fn extract_buzz_marker_value(pid: u32) -> Option<String> {
    let prefix = b"BUZZ_MANAGED_AGENT=";
    let data = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
    for entry in data.split(|&b| b == 0) {
        if entry.starts_with(prefix) {
            return String::from_utf8(entry[prefix.len()..].to_vec()).ok();
        }
    }
    None
}

#[cfg(not(unix))]
fn extract_buzz_marker_value(_pid: u32) -> Option<String> {
    None
}

/// Check if a Buzz desktop process is still alive for the given instance ID.
/// Scans all user-owned processes named "Buzz" or "buzz-desktop" and checks
/// whether any has the identifier in its command-line args (KERN_PROCARGS2 buffer
/// includes both argv and environ — the `--config` JSON from `tauri dev` contains
/// the identifier string).
#[cfg(target_os = "macos")]
fn desktop_is_alive_for_instance(instance_id: &str) -> bool {
    extern "C" {
        fn proc_name(pid: libc::c_int, buffer: *mut libc::c_void, buffersize: u32) -> libc::c_int;
    }

    let my_uid = unsafe { libc::getuid() };
    let identifier_bytes = instance_id.as_bytes();

    let pids = sweep::collect_all_pids();
    if pids.is_empty() {
        return false;
    }

    for &pid in &pids {
        if pid <= 0 {
            continue;
        }
        // Check binary name — only look at desktop binaries.
        let mut name_buf = [0u8; 1024];
        let len = unsafe {
            proc_name(
                pid,
                name_buf.as_mut_ptr() as *mut libc::c_void,
                name_buf.len() as u32,
            )
        };
        if len <= 0 {
            continue;
        }
        let name = String::from_utf8_lossy(&name_buf[..len as usize]);
        if !is_desktop_binary(&name) {
            continue;
        }
        // Verify UID.
        let mut info = std::mem::MaybeUninit::<BSDInfo>::zeroed();
        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr() as *mut libc::c_void,
                std::mem::size_of::<BSDInfo>() as libc::c_int,
            )
        };
        if ret <= 0 {
            continue;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_uid != my_uid {
            continue;
        }
        // Check if this desktop process's args/env contain the identifier.
        // The KERN_PROCARGS2 buffer holds argv + environ as null-delimited strings.
        let Some(args_buf) = sweep::procargs2_buffer(pid as u32) else {
            continue;
        };
        // Boundary-anchored search: the identifier in the config JSON is
        // followed by a non-identifier char (typically `"`). A raw substring
        // match would let `...app` match inside `...app.dev`.
        if buffer_contains_identifier(&args_buf, identifier_bytes) {
            return true;
        }
    }
    false
}

#[cfg(all(unix, not(target_os = "macos")))]
fn desktop_is_alive_for_instance(instance_id: &str) -> bool {
    let my_uid = unsafe { libc::getuid() };
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<u32>() else {
            continue;
        };
        // Check ownership.
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != my_uid {
            continue;
        }
        // Check binary name via /proc/<pid>/comm.
        let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) else {
            continue;
        };
        if !is_desktop_binary(comm.trim()) {
            continue;
        }
        // Check cmdline for the identifier with boundary anchoring.
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
            continue;
        };
        if buffer_contains_identifier(&cmdline, instance_id.as_bytes()) {
            return true;
        }
    }
    false
}

#[cfg(not(unix))]
fn desktop_is_alive_for_instance(_instance_id: &str) -> bool {
    false
}

/// Reap agent processes belonging to dead Buzz desktop instances.
///
/// Scans all user processes for `BUZZ_MANAGED_AGENT=*`, groups them by
/// instance ID, and for each foreign instance (≠ `our_instance_id`) checks
/// whether a Buzz desktop binary is still alive for that instance. If not,
/// all agents from that dead instance are reaped.
#[cfg(target_os = "macos")]
pub(crate) fn reap_dead_instance_agents(our_instance_id: &str, skip_pids: &[u32]) {
    let my_uid = unsafe { libc::getuid() };
    let my_pid = std::process::id() as i32;

    let pids = sweep::collect_all_pids();
    if pids.is_empty() {
        return;
    }

    // Collect (pid, instance_id) for all foreign agent processes.
    let mut foreign_agents: HashMap<String, Vec<i32>> = HashMap::new();

    for &pid in &pids {
        if pid <= 0 || pid == my_pid {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) {
            continue;
        }
        if !process_belongs_to_us(upid) {
            continue;
        }
        // Verify UID.
        let mut info = std::mem::MaybeUninit::<BSDInfo>::zeroed();
        let ret = unsafe {
            proc_pidinfo(
                pid,
                PROC_PIDTBSDINFO,
                0,
                info.as_mut_ptr() as *mut libc::c_void,
                std::mem::size_of::<BSDInfo>() as libc::c_int,
            )
        };
        if ret <= 0 {
            continue;
        }
        let info = unsafe { info.assume_init() };
        if info.pbi_uid != my_uid {
            continue;
        }
        // Extract the instance ID from this agent's env.
        let Some(agent_instance_id) = extract_buzz_marker_value(upid) else {
            continue;
        };
        // Skip agents belonging to our own instance (handled by sweep_system_agent_processes).
        if agent_instance_id == our_instance_id {
            continue;
        }
        foreign_agents
            .entry(agent_instance_id)
            .or_default()
            .push(pid);
    }

    // For each foreign instance, check if its desktop is still alive.
    for (instance_id, agent_pids) in &foreign_agents {
        if desktop_is_alive_for_instance(instance_id) {
            continue;
        }
        eprintln!(
            "buzz-desktop: reaping {} orphaned agent(s) from dead instance '{instance_id}'",
            agent_pids.len()
        );
        resolve_pgids_and_kill(agent_pids);
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn reap_dead_instance_agents(our_instance_id: &str, skip_pids: &[u32]) {
    let my_uid = unsafe { libc::getuid() };
    let my_pid = std::process::id() as i32;
    let mut foreign_agents: HashMap<String, Vec<i32>> = HashMap::new();

    let Ok(entries) = std::fs::read_dir("/proc") else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        let Ok(pid) = name_str.parse::<i32>() else {
            continue;
        };
        if pid <= 0 || pid == my_pid {
            continue;
        }
        let upid = pid as u32;
        if skip_pids.contains(&upid) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != my_uid {
            continue;
        }
        if !process_belongs_to_us(upid) {
            continue;
        }
        let Some(agent_instance_id) = extract_buzz_marker_value(upid) else {
            continue;
        };
        if agent_instance_id == our_instance_id {
            continue;
        }
        foreign_agents
            .entry(agent_instance_id)
            .or_default()
            .push(pid);
    }

    for (instance_id, agent_pids) in &foreign_agents {
        if desktop_is_alive_for_instance(instance_id) {
            continue;
        }
        eprintln!(
            "buzz-desktop: reaping {} orphaned agent(s) from dead instance '{instance_id}'",
            agent_pids.len()
        );
        resolve_pgids_and_kill(agent_pids);
    }
}

#[cfg(not(unix))]
pub(crate) fn reap_dead_instance_agents(_our_instance_id: &str, _skip_pids: &[u32]) {}

// Exact-path harness sweep lives in runtime/sweep.rs (re-exported above).

/// Kill stale agent processes from a previous session whose PID is still alive
/// but not tracked in the current `runtimes` map. Updates the record fields and
/// returns `true` if any records were modified.
pub fn kill_stale_tracked_processes(
    records: &mut [ManagedAgentRecord],
    runtimes: &HashMap<String, ManagedAgentProcess>,
    instance_id: &str,
) -> bool {
    use crate::managed_agents::BackendKind;

    let mut changed = false;
    for record in records.iter_mut() {
        if record.backend != BackendKind::Local {
            continue;
        }
        let Some(pid) = record.runtime_pid else {
            continue;
        };
        if !runtimes.contains_key(&record.pubkey) {
            if process_belongs_to_us(pid) && process_has_buzz_marker(pid, instance_id) {
                let _ = terminate_process(pid);
            }
            record.runtime_pid = None;
            record.last_stopped_at = Some(crate::util::now_iso());
            record.updated_at = crate::util::now_iso();
            changed = true;
        }
    }
    changed
}

fn managed_resident_starts() -> &'static (Mutex<HashSet<String>>, Condvar) {
    static STARTS: OnceLock<(Mutex<HashSet<String>>, Condvar)> = OnceLock::new();
    STARTS.get_or_init(|| (Mutex::new(HashSet::new()), Condvar::new()))
}

struct ManagedResidentStartGuard {
    resident_pubkey: String,
    activation: Option<ManagedResidentSessionActivation>,
}

struct ManagedResidentSessionActivation {
    dispatch_store:
        std::sync::Arc<std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>>,
    session_epoch: u64,
    previous_session_epoch: Option<u64>,
}

impl ManagedResidentStartGuard {
    fn begin(resident_pubkey: &str) -> Result<Self, String> {
        let resident_pubkey = resident_pubkey.to_ascii_lowercase();
        let (starts, _) = managed_resident_starts();
        let mut starts = starts
            .lock()
            .map_err(|_| "managed resident start registry is unavailable".to_string())?;
        if !starts.insert(resident_pubkey.clone()) {
            return Err("managed resident start is already in progress".into());
        }
        Ok(Self {
            resident_pubkey,
            activation: None,
        })
    }

    fn activate_session(
        &mut self,
        dispatch_store: std::sync::Arc<
            std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
        >,
        session_epoch: u64,
    ) -> Result<(), String> {
        if self.activation.is_some() {
            return Err("managed resident start session is already active".into());
        }
        let previous_session_epoch = dispatch_store
            .lock()
            .map_err(|_| "managed dispatch store lock is unavailable".to_string())?
            .replace_active_session_for_start(&self.resident_pubkey, session_epoch)?;
        self.activation = Some(ManagedResidentSessionActivation {
            dispatch_store,
            session_epoch,
            previous_session_epoch,
        });
        Ok(())
    }

    fn commit(mut self) {
        self.activation = None;
    }
}

impl Drop for ManagedResidentStartGuard {
    fn drop(&mut self) {
        let (starts, changed) = managed_resident_starts();
        if let Ok(mut starts) = starts.lock() {
            if let Some(activation) = self.activation.take() {
                match activation.dispatch_store.lock() {
                    Ok(mut store) => {
                        store.restore_active_session_after_failed_start(
                            &self.resident_pubkey,
                            activation.session_epoch,
                            activation.previous_session_epoch,
                        );
                    }
                    Err(_) => eprintln!(
                        "luca-managed-dispatch: failed to restore session after resident start failure"
                    ),
                }
            }
            starts.remove(&self.resident_pubkey);
        }
        changed.notify_all();
    }
}

fn lock_quiescent_managed_resident_starts(
    resident_pubkey: &str,
) -> Result<std::sync::MutexGuard<'static, HashSet<String>>, String> {
    let resident_pubkey = resident_pubkey.to_ascii_lowercase();
    let (starts, changed) = managed_resident_starts();
    let mut starts = starts
        .lock()
        .map_err(|_| "managed resident start registry is unavailable".to_string())?;
    while starts.contains(&resident_pubkey) {
        starts = changed
            .wait(starts)
            .map_err(|_| "managed resident start registry is unavailable".to_string())?;
    }
    Ok(starts)
}

fn terminalize_unclaimed_dispatches_for_exited_processes(
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    exited_pubkeys: &[String],
    now_unix_secs: u64,
) -> Result<crate::luca::managed_dispatch_store::ProcessExitDispatchCleanup, String> {
    let mut store = dispatch_store
        .lock()
        .map_err(|_| "managed dispatch store lock is unavailable".to_string())?;
    let mut terminalized = 0;
    let mut deferred = Vec::new();
    for pubkey in exited_pubkeys {
        let cleanup = store.terminalize_unclaimed_after_process_exit(pubkey, now_unix_secs)?;
        terminalized += cleanup.terminalized;
        deferred.extend(cleanup.deferred);
    }
    deferred.sort_by(|left, right| {
        left.cleanup_at_unix_secs
            .cmp(&right.cleanup_at_unix_secs)
            .then_with(|| left.dispatch_receipt_id.cmp(&right.dispatch_receipt_id))
            .then_with(|| left.resident_pubkey.cmp(&right.resident_pubkey))
    });
    Ok(
        crate::luca::managed_dispatch_store::ProcessExitDispatchCleanup {
            terminalized,
            deferred,
        },
    )
}

fn process_exit_now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn recheck_deferred_process_exit_after_resident_start<F>(
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    cleanup: &crate::luca::managed_dispatch_store::DeferredProcessExitDispatchCleanup,
    now_unix_secs: F,
) -> Result<bool, String>
where
    F: FnOnce() -> u64,
{
    recheck_deferred_process_exit_after_resident_start_with_observer(
        dispatch_store,
        cleanup,
        now_unix_secs,
        || {},
    )
}

fn recheck_deferred_process_exit_after_resident_start_with_observer<F, O>(
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    cleanup: &crate::luca::managed_dispatch_store::DeferredProcessExitDispatchCleanup,
    now_unix_secs: F,
    quiescent_observer: O,
) -> Result<bool, String>
where
    F: FnOnce() -> u64,
    O: FnOnce(),
{
    let starts = lock_quiescent_managed_resident_starts(&cleanup.resident_pubkey)?;
    quiescent_observer();
    let now_unix_secs = now_unix_secs();
    let result = dispatch_store
        .lock()
        .map_err(|_| "managed dispatch store lock is unavailable".to_string())?
        .recheck_deferred_process_exit_cleanup(cleanup, now_unix_secs);
    drop(starts);
    result
}

fn schedule_deferred_process_exit_dispatch_cleanup(
    dispatch_store: &std::sync::Arc<
        std::sync::Mutex<crate::luca::managed_dispatch_store::ManagedDispatchStore>,
    >,
    deferred: Vec<crate::luca::managed_dispatch_store::DeferredProcessExitDispatchCleanup>,
) {
    if deferred.is_empty() {
        return;
    }
    let dispatch_store = std::sync::Arc::clone(dispatch_store);
    if let Err(error) = std::thread::Builder::new()
        .name("luca-dispatch-exit-cleanup".into())
        .spawn(move || {
            for cleanup in deferred {
                loop {
                    let now = process_exit_now_unix_secs();
                    if now >= cleanup.cleanup_at_unix_secs {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_secs(
                        cleanup.cleanup_at_unix_secs.saturating_sub(now),
                    ));
                }
                let result = recheck_deferred_process_exit_after_resident_start(
                    &dispatch_store,
                    &cleanup,
                    process_exit_now_unix_secs,
                );
                if let Err(error) = result {
                    eprintln!(
                        "luca-managed-dispatch: deferred process-exit cleanup failed: {error}"
                    );
                }
            }
        })
    {
        eprintln!("luca-managed-dispatch: failed to schedule process-exit cleanup: {error}");
    }
}

pub fn sync_managed_agent_processes(
    records: &mut [ManagedAgentRecord],
    runtimes: &mut HashMap<String, ManagedAgentProcess>,
    instance_id: &str,
) -> (bool, Vec<String>) {
    sync_managed_agent_processes_with_exit_handler(records, runtimes, instance_id, |exited| {
        let Some(dispatch_store) =
            crate::luca::managed_dispatch_store::initialized_dispatch_store()
        else {
            return;
        };
        match terminalize_unclaimed_dispatches_for_exited_processes(
            &dispatch_store,
            exited,
            process_exit_now_unix_secs(),
        ) {
            Ok(cleanup) => {
                schedule_deferred_process_exit_dispatch_cleanup(&dispatch_store, cleanup.deferred);
            }
            Err(error) => {
                eprintln!(
                    "luca-managed-dispatch: failed to terminalize work orphaned by process exit: {error}"
                );
            }
        }
    })
}

fn sync_managed_agent_processes_with_exit_handler<F>(
    records: &mut [ManagedAgentRecord],
    runtimes: &mut HashMap<String, ManagedAgentProcess>,
    instance_id: &str,
    mut handle_exits: F,
) -> (bool, Vec<String>)
where
    F: FnMut(&[String]),
{
    let mut changed = false;
    let mut exited = Vec::new();

    for (pubkey, runtime) in runtimes.iter_mut() {
        let status = match runtime.child.try_wait() {
            Ok(status) => status,
            Err(error) => {
                if let Some(record) = records.iter_mut().find(|record| record.pubkey == *pubkey) {
                    record.updated_at = now_iso();
                    record.last_error = Some(format!("failed to inspect process state: {error}"));
                    record.last_error_code = None;
                }
                changed = true;
                exited.push(pubkey.clone());
                continue;
            }
        };

        let Some(status) = status else {
            continue;
        };

        if let Some(record) = records.iter_mut().find(|record| record.pubkey == *pubkey) {
            record.updated_at = now_iso();
            record.runtime_pid = None;
            record.last_stopped_at = Some(now_iso());
            record.last_exit_code = status.code();
            let log_err = if status.success() {
                None
            } else {
                Some(
                    super::meaningful_agent_error_from_log(&runtime.log_path).unwrap_or_else(
                        || super::storage::AgentLogError {
                            message: format!("harness exited with status {status}"),
                            code: None,
                        },
                    ),
                )
            };
            record.last_error = log_err.as_ref().map(|e| e.message.clone());
            record.last_error_code = log_err.as_ref().and_then(|e| e.code);
        }

        changed = true;
        exited.push(pubkey.clone());
    }

    let mut exited_pubkeys: Vec<String> = exited.clone();
    for pubkey in exited {
        if let Err(error) = join_managed_signing_broker(&pubkey) {
            eprintln!("luca-signing: failed to confirm broker shutdown for {pubkey}: {error}");
        }
        runtimes.remove(&pubkey);
    }

    for record in records.iter_mut() {
        if runtimes.contains_key(&record.pubkey) {
            continue;
        }

        let Some(pid) = record.runtime_pid else {
            continue;
        };

        if process_is_running(pid)
            && process_belongs_to_us(pid)
            && process_has_buzz_marker(pid, instance_id)
        {
            continue;
        }

        record.runtime_pid = None;
        record.updated_at = now_iso();
        if record.last_stopped_at.is_none() {
            record.last_stopped_at = Some(now_iso());
        }
        changed = true;
        exited_pubkeys.push(record.pubkey.clone());
    }

    if !exited_pubkeys.is_empty() {
        // The process and its broker authority are already gone. Resolve only
        // rows that never reached TurnStarted; active/frozen work keeps using
        // its existing exact-session failure and reconciliation paths.
        handle_exits(&exited_pubkeys);
    }

    (changed, exited_pubkeys)
}

/// Classify an agent's persona against the live catalog for the Agents-menu
/// drift indicator. Returns `(out_of_date, orphaned)`.
///
/// Drift basis is the RECORD's `persona_source_version`, never the engram:
/// - persona_id set + persona present: out_of_date when the snapshot hash
///   differs from the persona's current content hash.
/// - persona_id set + persona gone: orphaned (no current hash to respawn into,
///   so never out_of_date — we must not tell the user to respawn into nothing).
/// - no persona_id: neither — a hand-built agent has no persona to drift from.
fn persona_drift_state(
    record: &ManagedAgentRecord,
    personas: &[crate::managed_agents::types::AgentDefinition],
) -> (bool, bool) {
    let Some(persona_id) = record.persona_id.as_deref() else {
        return (false, false);
    };
    let Some(persona) = personas.iter().find(|p| p.id == persona_id) else {
        return (false, true);
    };
    let current = crate::managed_agents::persona_events::persona_content_hash(
        &crate::managed_agents::persona_events::persona_event_content(persona),
    );
    let out_of_date = record
        .persona_source_version
        .as_deref()
        .is_some_and(|pinned| pinned != current);
    (out_of_date, false)
}

pub fn build_managed_agent_summary(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    runtimes: &HashMap<String, ManagedAgentProcess>,
    personas: &[crate::managed_agents::types::AgentDefinition],
) -> Result<ManagedAgentSummary, String> {
    use crate::managed_agents::BackendKind;

    let (status, pid, log_path) = if record.backend != BackendKind::Local {
        // Two-axis status model for remote agents:
        //
        //   Control-plane (this field): "deployed" = provider has been invoked and
        //   returned a backend_agent_id. "not_deployed" = no deploy call yet (or it
        //   failed). This axis tracks whether infrastructure *exists*, not whether
        //   the process is currently running.
        //
        //   Live axis (relay presence, polled by frontend): online/away/offline.
        //   Shown as a PresenceDot next to the agent name. This is the real-time
        //   signal for whether the harness is connected.
        //
        // After !shutdown the agent goes offline (presence) but stays "deployed"
        // (infrastructure still exists). This is intentional — the provider may
        // have allocated a VM/container that persists across process restarts.
        // A future provider `undeploy` operation (v2) will handle teardown.
        let status = if record.backend_agent_id.is_some() {
            "deployed".to_string()
        } else {
            "not_deployed".to_string()
        };
        (status, None, String::new())
    } else {
        let persisted_pid = record.runtime_pid.filter(|pid| process_is_running(*pid));
        if let Some(runtime) = runtimes.get(&record.pubkey) {
            (
                "running".to_string(),
                Some(runtime.child.id()),
                runtime.log_path.display().to_string(),
            )
        } else if let Some(pid) = persisted_pid {
            (
                "running".to_string(),
                Some(pid),
                managed_agent_log_path(app, &record.pubkey)?
                    .display()
                    .to_string(),
            )
        } else {
            (
                "stopped".to_string(),
                None,
                managed_agent_log_path(app, &record.pubkey)?
                    .display()
                    .to_string(),
            )
        }
    };

    // Display contract: show the pinned record snapshot — what the agent
    // actually runs — not the live persona. The drift flags below signal when
    // the snapshot has fallen behind an edited persona; showing live values
    // next to an "out of date" badge would contradict it.
    let (persona_out_of_date, persona_orphaned) = persona_drift_state(record, personas);

    // Restart badge: the running process stamped its effective spawn config
    // at launch; recompute from current disk state and flag drift. Only a
    // tracked live process can drift — stopped agents spawn fresh, and
    // adopted (runtime_pid-only) processes have no stamped hash to compare.
    //
    // Additionally, for runtimes with an adapter version gate (codex only),
    // check whether the cached adapter availability has drifted from the value
    // stamped at spawn.  This catches out-of-band adapter changes (manual
    // npm install/downgrade) that Phase-1 auto-restart doesn't cover.  The
    // cache is read-only here — no subprocess is spawned.
    let needs_restart = runtimes.get(&record.pubkey).is_some_and(|runtime| {
        use tauri::Manager;
        let state = app.state::<crate::app_state::AppState>();
        let global_for_hash =
            crate::managed_agents::load_global_agent_config(app).unwrap_or_default();
        let teams_for_hash = crate::managed_agents::load_teams(app).unwrap_or_default();
        let hash_drift = runtime.spawn_config_hash
            != crate::managed_agents::spawn_hash::spawn_config_hash(
                record,
                personas,
                &teams_for_hash,
                &crate::relay::relay_ws_url_with_override(&state),
                &global_for_hash,
            );
        let availability_drift = super::availability_drift(
            runtime.adapter_availability.as_ref(),
            super::adapter_availability_cached(),
        );
        hash_drift || availability_drift
    });

    // Resolve the effective harness the same way, then derive args/mcp from it,
    // so the UI reflects the persona's current harness (or an explicit pin).
    let (effective_command, effective_args) = record
        .native_runtime_binding
        .as_ref()
        .map(super::RuntimeBinding::launch_preview)
        .unwrap_or_else(|| {
            let command = crate::managed_agents::record_agent_command(record, personas);
            let args = normalize_agent_args(&command, record.agent_args.clone());
            (command, args)
        });
    let effective_mcp_command = known_acp_runtime(&effective_command)
        .and_then(|r| r.mcp_command)
        .unwrap_or("")
        .to_string();

    Ok(ManagedAgentSummary {
        pubkey: record.pubkey.clone(),
        name: record.name.clone(),
        persona_id: record.persona_id.clone(),
        team_id: record.team_id.clone(),
        relay_url: record.relay_url.clone(),
        acp_command: record.acp_command.clone(),
        agent_command: effective_command,
        agent_command_override: record.agent_command_override.clone(),
        agent_args: effective_args,
        mcp_command: effective_mcp_command,
        turn_timeout_seconds: record.turn_timeout_seconds,
        idle_timeout_seconds: record.idle_timeout_seconds,
        max_turn_duration_seconds: record.max_turn_duration_seconds,
        parallelism: record.parallelism,
        system_prompt: record.system_prompt.clone(),
        avatar_url: record.avatar_url.clone(),
        model: record.model.clone(),
        provider: record.provider.clone(),
        persona_out_of_date,
        persona_orphaned,
        needs_restart,
        env_vars: record.env_vars.clone(),
        backend: record.backend.clone(),
        backend_agent_id: record.backend_agent_id.clone(),
        native_runtime_binding: record.native_runtime_binding.clone(),
        documents_dir: record.documents_dir.clone(),
        documents_hash: record.documents_hash.clone(),
        status,
        pid,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        last_started_at: record.last_started_at.clone(),
        last_stopped_at: record.last_stopped_at.clone(),
        last_exit_code: record.last_exit_code,
        last_error: record.last_error.clone(),
        last_error_code: record.last_error_code,
        start_on_app_launch: record.start_on_app_launch,
        auto_restart_on_config_change: record.auto_restart_on_config_change,
        log_path,
        respond_to: record.respond_to,
        respond_to_allowlist: record.respond_to_allowlist.clone(),
    })
}

pub fn find_managed_agent_mut<'a>(
    records: &'a mut [ManagedAgentRecord],
    pubkey: &str,
) -> Result<&'a mut ManagedAgentRecord, String> {
    records
        .iter_mut()
        .find(|record| record.pubkey == pubkey)
        .ok_or_else(|| format!("agent {pubkey} not found"))
}

/// Pure decision function for the inbound author gate env vars.
///
/// Returns the env vars to **set** and the env vars to **remove**. Removal is
/// belt-and-suspenders: an inherited parent env var must not leak into a
/// child agent and silently change its security posture.
///
/// The `owner_hex` argument is the current workspace owner pubkey. It's used
/// as a fallback for legacy records (`auth_tag.is_none()`) — without it, the
/// harness's owner cache stays empty and `owner-only` / `allowlist` modes
/// drop everything.
///
/// Returns `Err(...)` if the record's allowlist fails validation. The harness
/// validates too, but doing it here means we never spawn a doomed process.
pub(crate) fn build_respond_to_env(
    record: &ManagedAgentRecord,
    owner_hex: Option<&str>,
) -> Result<RespondToEnv, String> {
    // Defensive re-validation: an on-disk record could have been hand-edited.
    let normalized = super::types::validate_respond_to_allowlist(&record.respond_to_allowlist)?;
    if record.respond_to == super::types::RespondTo::Allowlist && normalized.is_empty() {
        return Err(
            "respond-to mode 'allowlist' requires at least one pubkey in the allowlist".to_string(),
        );
    }

    let mut set: Vec<(&'static str, String)> = Vec::new();
    let mut remove: Vec<&'static str> = Vec::new();

    set.push((
        "BUZZ_ACP_RESPOND_TO",
        record.respond_to.as_str().to_string(),
    ));

    if record.respond_to == super::types::RespondTo::Allowlist {
        set.push(("BUZZ_ACP_RESPOND_TO_ALLOWLIST", normalized.join(",")));
    } else {
        remove.push("BUZZ_ACP_RESPOND_TO_ALLOWLIST");
    }

    // Legacy fallback: agents created before NIP-OA lack `auth_tag`. Without
    // it the harness can't resolve the owner, and owner-dependent gate modes
    // would drop every event. Forwarding the workspace owner pubkey via
    // BUZZ_ACP_AGENT_OWNER keeps those records functional. Modern records
    // (`auth_tag = Some(...)`) use `BUZZ_AUTH_TAG` as before.
    if record.auth_tag.is_none() {
        if let Some(owner) = owner_hex {
            set.push(("BUZZ_ACP_AGENT_OWNER", owner.to_string()));
        } else {
            remove.push("BUZZ_ACP_AGENT_OWNER");
        }
    } else {
        remove.push("BUZZ_ACP_AGENT_OWNER");
    }

    Ok((set, remove))
}

pub(crate) fn configure_runtime_cli(
    command: &mut std::process::Command,
    runtime: Option<&KnownAcpRuntime>,
) {
    let Some(runtime) = runtime else {
        return;
    };
    if runtime.id != "claude" {
        return;
    }
    if let Some(cli_path) = runtime.underlying_cli.and_then(resolve_command) {
        command.env("CLAUDE_CODE_EXECUTABLE", cli_path);
    }
}

fn abort_spawned_child(child: &mut std::process::Child) {
    if terminate_process(child.id()).is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
}

/// Spawn an agent process without holding any locks on records or runtimes.
/// Returns the child process and log path on success. The caller is responsible
/// for updating `ManagedAgentRecord` fields and inserting into the runtimes map.
///
/// The system prompt a resident with an agent folder spawns on: the folder,
/// loaded from disk and assembled in slot order. A folder that cannot be read
/// (or says nothing) yields `None`, and the harness runs on its base prompt
/// alone — the resident still starts.
fn assembled_documents_prompt(app: &AppHandle, record: &ManagedAgentRecord) -> Option<String> {
    let dir = match crate::luca::resident_documents::resident_dir(app, &record.pubkey) {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!(
                "buzz-desktop: resident-documents: no folder path for {}: {error}",
                record.name
            );
            return None;
        }
    };
    match crate::luca::resident_documents::load(&dir) {
        Ok(loaded) => crate::luca::resident_documents::assemble_system_prompt(&loaded),
        Err(error) => {
            eprintln!(
                "buzz-desktop: resident-documents: could not read {}'s folder at spawn: {error}",
                record.name
            );
            None
        }
    }
}

/// `owner_hex`: the workspace owner's pubkey, used as a fallback for legacy
/// records that have no NIP-OA `auth_tag`. See `build_respond_to_env`.
pub fn spawn_agent_child(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    owner_hex: Option<&str>,
) -> Result<crate::managed_agents::ManagedAgentProcess, String> {
    #[cfg(unix)]
    {
        spawn_agent_child_unix(app, record, owner_hex)
    }

    #[cfg(not(unix))]
    {
        let _ = (app, record, owner_hex);
        Err("managed residents require the device-local Unix transport".to_owned())
    }
}

#[cfg(unix)]
fn spawn_agent_child_unix(
    app: &AppHandle,
    record: &ManagedAgentRecord,
    owner_hex: Option<&str>,
) -> Result<crate::managed_agents::ManagedAgentProcess, String> {
    // A replacement must never overlap the sole owner of this resident's
    // encrypted outbox. The handle is removed under the registry lock, then
    // joined without holding that lock.
    join_managed_signing_broker(&record.pubkey)?;
    if let Some(error) = spawn_key_refusal(record) {
        return Err(error);
    }
    let log_path = managed_agent_log_path(app, &record.pubkey)?;
    append_log_marker(
        &log_path,
        &format!(
            "\n=== starting {} ({}) at {} ===",
            record.name,
            record.pubkey,
            now_iso()
        ),
    )?;

    let stdout = open_log_file(&log_path)?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("failed to clone log handle: {error}"))?;
    // Resolve the effective harness (agent command) from the linked persona, so
    // persona harness edits propagate on the next spawn; an explicit per-agent
    // override wins. `agent_args` and `mcp_command` are pure derivations of the
    // command, so we recompute them from the effective value rather than the
    // frozen record snapshot. Mirrors the model resolution below.
    let personas = super::load_personas(app).unwrap_or_default();
    let teams = super::load_teams(app).unwrap_or_default();
    // Load global config once; used for runtime_metadata_env_vars (model/provider fallback)
    // and for the env-var merge at spawn time.
    let global = crate::managed_agents::load_global_agent_config(app).unwrap_or_default();
    let native_runtime = record
        .native_runtime_binding
        .as_ref()
        .map(super::resolve_native_runtime_binding)
        .transpose()?;
    let fallback_command = super::record_agent_command(record, &personas);
    let (effective_command, resolved_agent_command, agent_args) =
        openclaw_compat::resolve_agent_command(
            native_runtime.as_ref(),
            fallback_command,
            record.agent_args.clone(),
        )?;
    let managed_working_root = native_runtime
        .as_ref()
        .and_then(|runtime| runtime.default_workspace.clone())
        .or_else(super::default_agent_workdir)
        .unwrap_or(std::env::current_dir().map_err(|error| {
            format!("failed to resolve managed agent working directory: {error}")
        })?);
    let resolved_acp_command = resolve_command(&record.acp_command)
        .ok_or_else(|| missing_command_message(&record.acp_command, "ACP harness command"))?;
    // Every ACP-compatible resident receives Buzz's existing CLI-backed MCP.
    // Hermes and OpenClaw are native runtimes and remain ordinary-chat-only.
    let resolved_mcp_command = if native_runtime.is_none() {
        Some(
            resolve_command("buzz-dev-mcp")
                .ok_or_else(|| missing_command_message("buzz-dev-mcp", "Buzz MCP sidecar"))?,
        )
    } else {
        None
    };
    #[cfg(unix)]
    let repository_mcp_command = resolved_mcp_command.clone().unwrap_or_else(|| {
        resolve_command("buzz-dev-mcp")
            .expect("bundled repository MCP sidecar was already required for managed startup")
    });
    // The agent's effective relay drives both the child's relay connection
    // (BUZZ_RELAY_URL) and git credential-helper URL: an explicit per-agent
    // relay wins; an empty one falls back to the active workspace relay.
    let effective_relay_url = {
        use tauri::Manager;
        let state = app.state::<crate::app_state::AppState>();
        crate::relay::effective_agent_relay_url(
            &record.relay_url,
            &crate::relay::relay_ws_url_with_override(&state),
        )
    };

    // Augment PATH for DMG launches so child processes can find:
    //   - bundled CLI via ~/.local/bin symlink
    //   - nvm-managed node/npm (nvm initializes only in interactive shells)
    //   - bundled sidecars (buzz, buzz-acp, etc.) via exe parent (Contents/MacOS/)
    //   - runtimes (node, python, etc.) via login shell PATH
    let nvm_bin = dirs::home_dir()
        .as_deref()
        .and_then(super::find_nvm_default_bin);
    let augmented_path = build_augmented_path(
        dirs::home_dir(),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf)),
        login_shell_path(),
        nvm_bin,
    );

    let owner_pubkey = luca_protocol::Hex64::parse(
        owner_hex
            .ok_or_else(|| "Luca managed resident requires an owner identity".to_string())?
            .to_ascii_lowercase(),
    )
    .map_err(|error| format!("invalid managed owner pubkey: {error}"))?;
    let resident_pubkey = luca_protocol::Hex64::parse(record.pubkey.to_ascii_lowercase())
        .map_err(|error| format!("invalid managed resident pubkey: {error}"))?;
    let session_epoch = next_managed_session_epoch()?;
    let owner_attestation = managed_owner_attestation(record.auth_tag.as_deref())?;
    let (desktop_broker_endpoint, managed_acp_stdin) =
        crate::luca::signing_transport::create_exclusive_acp_socketpair()
            .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    let managed_permission_fd = crate::luca::managed_permission::create_endpoint(
        app.clone(),
        resident_pubkey.clone(),
        session_epoch,
    )?;
    #[cfg(unix)]
    let managed_presentation_fd = crate::luca::managed_presentation::create_endpoint(
        app.clone(),
        resident_pubkey.clone(),
        session_epoch,
    )?;
    let spawn_config_hash = super::spawn_hash::spawn_config_hash(
        record,
        &personas,
        &teams,
        &effective_relay_url,
        &global,
    );
    let runtime_configuration_sha256 = managed_runtime_configuration_sha256(spawn_config_hash)?;
    let runtime_binding_ref = luca_protocol::Sha256Ref::parse(format!(
        "sha256:{}",
        runtime_configuration_sha256.as_str()
    ))
    .map_err(|error| format!("invalid managed runtime binding: {error}"))?;
    #[cfg(unix)]
    let repository_broker_lease = crate::luca::repository_bridge::create_broker_lease(
        app,
        owner_pubkey.clone(),
        resident_pubkey.clone(),
        session_epoch,
        runtime_binding_ref.clone(),
    )?;
    #[cfg(unix)]
    let artifact_broker_lease = (|| {
        let working_root_id = crate::luca::artifact_bridge::working_root_id(&managed_working_root)?;
        crate::luca::artifact_bridge::create_broker_lease(
            app,
            crate::luca::artifact_bridge::ArtifactBrokerContext {
                owner_pubkey: owner_pubkey.clone(),
                resident_pubkey: resident_pubkey.clone(),
                session_epoch,
                binding_ref: runtime_binding_ref.clone(),
                working_root_id,
                working_root: managed_working_root.clone(),
            },
            std::sync::Arc::new(crate::luca::artifact_backend::DesktopArtifactBackend::new(app)?),
        )
    })()
    .map(Some)
    .unwrap_or_else(|_| {
        eprintln!(
            "luca-artifacts: broker unavailable; continuing the managed resident without artifact tools"
        );
        None
    });
    #[cfg(unix)]
    let managed_continuity_fd = crate::luca::managed_continuity::create_endpoint(
        app.clone(),
        resident_pubkey.clone(),
        session_epoch,
        runtime_binding_ref.clone(),
        // Native provider egress is classified by the later persisted-grant
        // slice. Unknown deliberately fails closed as remote in G2.
        luca_protocol::ProviderEgressV1::Unknown,
    )?;
    #[cfg(unix)]
    let (managed_cognition_fd, managed_cognition_client) =
        crate::luca::managed_cognition::create_endpoint(
            resident_pubkey.clone(),
            session_epoch,
            runtime_binding_ref.clone(),
        )?;
    #[cfg(unix)]
    let managed_mcp_fd = crate::luca::managed_mcp::create_endpoint(
        app.clone(),
        resident_pubkey.clone(),
        session_epoch,
    )
    .ok();
    let resident_keys = nostr::Keys::parse(&record.private_key_nsec)
        .map_err(|error| format!("failed to load desktop-held resident key: {error}"))?;
    if resident_keys.public_key().to_hex() != resident_pubkey.as_str() {
        return Err("desktop-held resident key does not match managed public identity".into());
    }
    let installation_session_id = luca_protocol::OpaqueId::parse(current_instance_id(app))
        .map_err(|error| format!("invalid installation session identifier: {error}"))?;
    let app_data_dir = {
        use tauri::Manager;
        app.path()
            .app_data_dir()
            .map_err(|error| format!("resolve managed agent data directory: {error}"))?
    };
    let relay_query_url = format!(
        "{}/query",
        crate::relay::relay_http_base_url(&effective_relay_url).trim_end_matches('/')
    );
    let mut command = std::process::Command::new(&resolved_acp_command);
    command.current_dir(&managed_working_root);
    #[cfg(unix)]
    command.stdin(managed_acp_stdin.into_stdio());
    #[cfg(not(unix))]
    return Err("Luca managed ACP broker is supported only on the approved Unix target".into());
    command.stdout(std::process::Stdio::from(stdout));
    command.stderr(std::process::Stdio::from(stderr));
    if let Some(ref path) = augmented_path {
        command.env("PATH", path);
    }
    command.env("RUST_LOG", child_rust_log_filter());
    command.env_remove("BUZZ_PRIVATE_KEY");
    command.env_remove("NOSTR_PRIVATE_KEY");
    command.env_remove("BUZZ_AUTH_TAG");
    command.env("LUCA_MANAGED_RESIDENT_PUBKEY", resident_pubkey.as_str());
    command.env(
        "LUCA_MANAGED_SESSION_EPOCH",
        session_epoch.get().to_string(),
    );
    #[cfg(unix)]
    command.env("LUCA_MANAGED_PERMISSION_FD", "3");
    #[cfg(unix)]
    command.env("LUCA_MANAGED_CONTINUITY_FD", "4");
    #[cfg(unix)]
    command.env("LUCA_MANAGED_COGNITION_FD", "5");
    command.env("LUCA_MANAGED_PRESENTATION_FD", "7");
    #[cfg(unix)]
    if managed_mcp_fd.is_some() {
        command.env("LUCA_MANAGED_MCP_FD", "6");
    } else {
        command.env_remove("LUCA_MANAGED_MCP_FD");
    }
    command.env("LUCA_MANAGED_BINDING_REF", runtime_binding_ref.as_str());
    if let Some((_, attestation_json)) = &owner_attestation {
        command.env("LUCA_MANAGED_OWNER_ATTESTATION", attestation_json);
    } else {
        command.env_remove("LUCA_MANAGED_OWNER_ATTESTATION");
    }
    command.env("BUZZ_RELAY_URL", &effective_relay_url);
    command.env("BUZZ_ACP_AGENT_COMMAND", &resolved_agent_command);
    command.env("BUZZ_ACP_AGENT_ARGS", agent_args.join(","));
    match &resolved_mcp_command {
        Some(mcp_cmd) => {
            command.env("BUZZ_ACP_MCP_COMMAND", mcp_cmd);
        }
        None => {
            command.env("BUZZ_ACP_MCP_COMMAND", "");
        }
    }
    let runtime_meta = known_acp_runtime(&effective_command);
    // Never inherit a stale desktop-shell bootstrap. Only this spawn's
    // successfully created lease may expose the communications broker.
    command.env_remove("BUZZ_ACP_COMMUNICATIONS_MCP_COMMAND");
    command.env_remove("BUZZ_ACP_COMMUNICATIONS_MCP_CONFIG");
    command.env_remove("BUZZ_ACP_ARTIFACT_MCP_COMMAND");
    command.env_remove("BUZZ_ACP_ARTIFACT_MCP_CONFIG");
    command.env_remove("BUZZ_ACP_ARTIFACT_MCP_SUPPORT");
    command.env_remove("BUZZ_ACP_ARTIFACT_MCP_PROBE_KEY");
    command.env_remove("BUZZ_ACP_DIRECT_PRIVATE_KEY");
    #[cfg(unix)]
    {
        command.env("BUZZ_ACP_REPOSITORY_MCP_COMMAND", &repository_mcp_command);
        command.env(
            "BUZZ_ACP_REPOSITORY_MCP_CONFIG",
            repository_broker_lease.bootstrap_json(),
        );
        if let Some(artifact_broker_lease) = artifact_broker_lease.as_ref() {
            let mut artifact_support = artifact_mcp_support_for_spawn(
                record.native_runtime_binding.as_ref(),
                &effective_command,
            );
            command.env("BUZZ_ACP_ARTIFACT_MCP_COMMAND", &repository_mcp_command);
            command.env(
                "BUZZ_ACP_ARTIFACT_MCP_CONFIG",
                artifact_broker_lease.bootstrap_json(),
            );
            if artifact_support == super::ArtifactMcpSupport::ProbePending {
                let behavior = crate::managed_agents::resolve_effective_agent_env(
                    record,
                    &personas,
                    runtime_meta,
                    &global,
                );
                match artifact_mcp_probe_key(
                    &resolved_agent_command,
                    &effective_command,
                    &agent_args,
                    &behavior.env,
                    behavior.config_file_path,
                ) {
                    Ok(probe_key) => {
                        command.env("BUZZ_ACP_ARTIFACT_MCP_PROBE_KEY", probe_key.as_str());
                    }
                    Err(_) => {
                        // Artifact capability fails closed without preventing
                        // the resident's ordinary conversation from starting.
                        artifact_support = super::ArtifactMcpSupport::Unavailable;
                    }
                }
            }
            command.env(
                "BUZZ_ACP_ARTIFACT_MCP_SUPPORT",
                artifact_mcp_support_env(artifact_support),
            );
        }
    }
    // Enable MCP hook tools (_Stop, _PostCompact) for agents that need them.
    // Uses "*" because build_mcp_servers() hard-codes the server name to "buzz-mcp".
    if runtime_meta.is_some_and(|r| r.mcp_hooks) {
        command.env("MCP_HOOK_SERVERS", "*");
    }

    // ── Readiness check: set setup-payload if agent is not ready ─────────────
    //
    // Build the effective env the agent would have at start-time, run the
    // readiness predicate, and if anything is missing, serialize the payload
    // into BUZZ_ACP_SETUP_PAYLOAD.  buzz-acp detects this env var on startup
    // and enters the minimal setup-listener mode instead of the agent pool.
    //
    // SECURITY: BUZZ_ACP_SETUP_PAYLOAD is in RESERVED_ENV_KEYS so user env
    // cannot set it, but we also explicitly remove it after writing user env
    // to guard against the parent-process environment. We then set it only
    // when desktop has computed NotReady — the desktop is the sole readiness
    // source and buzz-acp only transports the payload.
    //
    // The JSON format mirrors `setup_mode::SetupPayload` in buzz-acp:
    //   { "agent_name": "...", "agent_pubkey": "...", "requirements": [{ "surface": "...", ... }] }
    //
    // `spawned_setup_mode` is captured outside the block so it can be stamped
    // on `ManagedAgentProcess` — used by `install_acp_runtime` to target only
    // stuck agents for auto-restart.
    let spawned_setup_mode;
    {
        use crate::managed_agents::{
            agent_readiness, resolve_effective_agent_env, AgentReadiness, Requirement,
        };

        let effective = resolve_effective_agent_env(record, &personas, runtime_meta, &global);
        // Compute the optional payload before touching the command.
        let setup_payload_json =
            if let AgentReadiness::NotReady { requirements } = agent_readiness(&effective) {
                let reqs: Vec<serde_json::Value> = requirements
                    .into_iter()
                    .map(|r| match r {
                        Requirement::NormalizedField { field } => serde_json::json!({
                            "surface": "normalized_field",
                            "field": field,
                        }),
                        Requirement::EnvKey { key } => serde_json::json!({
                            "surface": "env_key",
                            "key": key,
                        }),
                        Requirement::CliLogin {
                            probe_args,
                            setup_copy,
                            availability,
                        } => serde_json::json!({
                            "surface": "cli_login",
                            "probe_args": probe_args,
                            "setup_copy": setup_copy,
                            "availability": availability,
                        }),
                        Requirement::CliConfigInvalid {
                            probe_args,
                            setup_copy,
                            diagnostic,
                        } => serde_json::json!({
                            "surface": "cli_config_invalid",
                            "probe_args": probe_args,
                            "setup_copy": setup_copy,
                            "diagnostic": diagnostic,
                        }),
                        Requirement::GitBash => serde_json::json!({
                            "surface": "git_bash",
                        }),
                    })
                    .collect();
                let payload = serde_json::json!({
                    "agent_name": record.name,
                    "agent_pubkey": record.pubkey,
                    "requirements": reqs,
                });
                match serde_json::to_string(&payload) {
                    Ok(json) => Some(json),
                    Err(e) => {
                        eprintln!(
                            "buzz-desktop: failed to serialize setup payload for {}: {e}",
                            record.name
                        );
                        None
                    }
                }
            } else {
                None
            };

        spawned_setup_mode = setup_payload_json.is_some();

        // Strip the key from the process-spawned command on every path.
        // Two independent guards protect the invariant:
        //   1. BUZZ_ACP_SETUP_PAYLOAD is in RESERVED_ENV_KEYS, so
        //      merged_user_env() can never write it via saved/persona env.
        //   2. This env_remove() clears any ambient parent-process value
        //      inherited by std::process::Command before we conditionally
        //      set the desktop-computed trusted value below.
        // Note: merged_user_env() is written further below in this function;
        // ordering relative to that call is NOT what makes this safe — the
        // reserved-key strip (guard 1) handles user env regardless of order.
        command.env_remove("BUZZ_ACP_SETUP_PAYLOAD");

        // Set the payload only when desktop computed NotReady.
        if let Some(json) = setup_payload_json {
            command.env("BUZZ_ACP_SETUP_PAYLOAD", json);
            eprintln!(
                "buzz-desktop: agent {} not ready — spawning in setup-listener mode",
                record.name
            );
        }
    }
    // Only emit BUZZ_ACP_IDLE_TIMEOUT when the user has explicitly set an
    // override. When unset, the buzz-acp harness applies its own default
    // (see `DEFAULT_IDLE_TIMEOUT_SECS` in crates/buzz-acp/src/config.rs),
    // which is the single source of truth. The previously-emitted
    // `BUZZ_ACP_TURN_TIMEOUT` is deprecated upstream and was pinning every
    // agent to the desktop's stale default (320s), bypassing harness bumps.
    if let Some(idle) = record.idle_timeout_seconds {
        command.env("BUZZ_ACP_IDLE_TIMEOUT", idle.to_string());
    }

    if let Some(max_dur) = record.max_turn_duration_seconds {
        command.env("BUZZ_ACP_MAX_TURN_DURATION", max_dur.to_string());
    }
    command.env("BUZZ_ACP_AGENTS", record.parallelism.to_string());
    // Queue, not steer: a message sent while the resident is mid-turn waits
    // and is delivered when the turn finishes. Steer silently CANCELLED the
    // in-flight turn on every mid-turn owner message — the partial reply was
    // orphaned ("Stopped · Response may be incomplete") with no warning and
    // no way to opt out. Interrupting is now an explicit owner action: the
    // desktop's held-delivery notice offers Stop-and-deliver, which cancels
    // the turn through the stop machinery and lets the queued batch dispatch.
    command.env("BUZZ_ACP_MULTIPLE_EVENT_HANDLING", "queue");
    command.env("BUZZ_ACP_DEDUP", "queue");
    if let Some(meta) = runtime_meta {
        for (key, value) in meta.default_env {
            if std::env::var(key).is_err() {
                command.env(key, value);
            }
        }
    }
    let team_instructions = super::spawn_hash::effective_team_instructions(record, &teams);
    if let Some(instructions) = &team_instructions {
        command.env("BUZZ_ACP_TEAM_INSTRUCTIONS", instructions);
    } else {
        command.env_remove("BUZZ_ACP_TEAM_INSTRUCTIONS");
    }

    // System prompt via the shared spawn-effective filter — the SAME function the
    // config hash digests, so env write and badge cannot disagree (see
    // `effective_spawn_prompt` for the Some("")/None collapse). Model and provider
    // use the shared
    // resolver: agent → persona → global → None, so a global-default-only agent
    // spawns with the correct provider/model env.
    // A resident with an agent folder spawns on the folder — soul → convictions
    // → self-model → user → instructions, assembled with caps — and the pin
    // (`system_prompt`) is only what a record without a folder receives.
    // A native resident's runtime composes its own prompt from its own files
    // (its SOUL.md is the soul); it keeps the pin, never an assembly of ours.
    let effective_prompt = match record.documents_dir.as_deref() {
        Some(_) if record.native_runtime_binding.is_none() => {
            assembled_documents_prompt(app, record)
        }
        _ => super::spawn_hash::effective_spawn_prompt(record),
    };
    let (effective_model, effective_provider) =
        crate::managed_agents::resolve_effective_model_provider(record, &personas, &global);

    if let Some(prompt) = &effective_prompt {
        command.env("BUZZ_ACP_SYSTEM_PROMPT", prompt);
    } else {
        command.env_remove("BUZZ_ACP_SYSTEM_PROMPT");
    }
    if let Some(model) = effective_model {
        command.env("BUZZ_ACP_MODEL", model);
    } else {
        command.env_remove("BUZZ_ACP_MODEL");
    }
    // Baked-in provider defaults for internal builds (buzz-releases sets
    // BUZZ_BUILD_BUZZ_AGENT_* at compile time; OSS builds bake nothing).
    // Written FIRST so that record/persona metadata env vars below override them.
    if native_runtime.is_none() {
        build_buzz_agent_provider_defaults(&mut command);
    }
    if let Some(meta) = runtime_meta {
        for (key, value) in runtime_metadata_env_vars(
            meta.model_env_var,
            meta.provider_env_var,
            meta.provider_locked,
            effective_model,
            effective_provider,
        ) {
            command.env(key, value);
        }
    }
    command.env_remove("BUZZ_ACP_PRIVATE_KEY");
    command.env_remove("BUZZ_ACP_API_TOKEN");
    command.env_remove("BUZZ_API_TOKEN");

    command.env_remove("BUZZ_AUTH_TAG");

    // Inbound author gate: who is this agent allowed to respond to?
    // Validation is strict here — a malformed allowlist on disk fails before
    // we spawn anything (the harness would also reject it, but we'd rather
    // fail with a clear error than crash-loop the child).
    let (gate_set, gate_remove) = build_respond_to_env(record, owner_hex)?;
    for (key, value) in &gate_set {
        command.env(key, value);
    }
    for key in &gate_remove {
        command.env_remove(key);
    }
    command.env("BUZZ_ACP_AGENT_OWNER", owner_pubkey.as_str());

    command.env("BUZZ_ACP_RELAY_OBSERVER", "false");

    // Git signing and relay mutation remain unavailable in managed V1 until a
    // dedicated typed broker operation exists.
    command.env_remove("NOSTR_PRIVATE_KEY");
    command.env_remove("GIT_CONFIG_COUNT");
    command.env_remove("GIT_TERMINAL_PROMPT");
    for index in 0..8 {
        command.env_remove(format!("GIT_CONFIG_KEY_{index}"));
        command.env_remove(format!("GIT_CONFIG_VALUE_{index}"));
    }

    // ── User env vars: live persona env under agent overrides ──────────
    //
    // The record's `env_vars` holds agent-level overrides only. The linked
    // persona's env is read live and merged underneath (agent wins on
    // collision), so persona credential edits reach the agent on the next
    // spawn — same refresh semantics as prompt/model/provider above and the
    // provider deploy path. Global env vars are the floor layer below persona.
    // `merged_user_env` also applies the reserved-key / malformed-key / NUL
    // filtering. Precedence: baked floor < Buzz-set env above < GLOBAL <
    // PERSONA < per-agent.
    //
    // These writes go LAST so user-provided values win over every Buzz-set env
    // above — EXCEPT reserved keys (BUZZ_PRIVATE_KEY, NOSTR_PRIVATE_KEY,
    // BUZZ_AUTH_TAG, BUZZ_API_TOKEN, BUZZ_ACP_PRIVATE_KEY, BUZZ_ACP_API_TOKEN),
    // which `merged_user_env` strips. Those carry Buzz's identity and must
    // never be GUI-overridable.
    // global < live persona < agent (last-wins on collision at each layer).
    let persona_over_global = super::env_vars::merged_user_env(
        &global.env_vars,
        &super::env_vars::live_persona_env(&personas, record.persona_id.as_deref()),
    );
    let merged_user_env = super::env_vars::merged_user_env(&persona_over_global, &record.env_vars);
    let (spawn_user_env, native_scrub) = if native_runtime.is_some() {
        let policy = native_runtime_env_policy(
            merged_user_env,
            std::env::vars_os().filter_map(|(key, _)| key.into_string().ok()),
        );
        (policy.user_env, policy.scrub_ambient)
    } else {
        (merged_user_env, Vec::new())
    };
    for (key, value) in spawn_user_env {
        command.env(key, value);
    }
    for key in native_scrub {
        command.env_remove(key);
    }
    // Native binding values are trusted backend derivations, written after
    // user env so editable fields cannot redirect a Hermes profile or an
    // OpenClaw session to a different native identity.
    if let Some(runtime) = &native_runtime {
        for (key, value) in &runtime.environment {
            command.env(key, value);
        }
        for (key, value) in &runtime.harness_environment {
            command.env(key, value);
        }
    } else {
        command.env_remove("LUCA_OPENCLAW_AGENT_ID");
        if resolved_mcp_command.is_some() {
            command.env("BUZZ_ACP_DIRECT_PRIVATE_KEY", &record.private_key_nsec);
            if let Some(auth_tag) = record.auth_tag.as_deref() {
                command.env("BUZZ_AUTH_TAG", auth_tag);
            }
        }
    }
    configure_runtime_cli(&mut command, runtime_meta);

    // Buzz shared compute is stored as a native provider; derive the OpenAI-compatible
    // transport at spawn time and scrub any unrelated ambient OpenAI key.
    #[cfg(feature = "mesh-llm")]
    if native_runtime.is_none() && effective_provider == Some(super::RELAY_MESH_PROVIDER_ID) {
        let mut mesh_env = std::collections::BTreeMap::new();
        super::apply_relay_mesh_env(&mut mesh_env, effective_provider, effective_model);
        command.env_remove("OPENAI_API_KEY");
        for (key, value) in mesh_env {
            command.env(key, value);
        }
    }

    // Mark as Buzz-managed *and* which desktop instance owns us, so the
    // system-wide orphan sweep only reaps this instance's own agents and never
    // another live Buzz's (e.g. a `just dev` build won't kill a DMG build's
    // agents). Propagates automatically through the full tree (buzz-acp →
    // goose → MCP servers) because neither buzz-acp nor goose calls
    // env_clear().
    command.env("BUZZ_MANAGED_AGENT", current_instance_id(app));

    // Spawn the harness in its own process group so we can kill the entire
    // tree (harness + MCP servers + agent subprocesses) on shutdown.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        let permission_fd = managed_permission_fd.raw_fd();
        let continuity_fd = managed_continuity_fd.raw_fd();
        let cognition_fd = managed_cognition_fd.raw_fd();
        let mcp_fd = managed_mcp_fd.as_ref().map(|fd| fd.raw_fd());
        let presentation_fd = managed_presentation_fd.raw_fd();
        unsafe {
            command.pre_exec(move || {
                super::inherited_fds::install_managed_descriptors(
                    permission_fd,
                    continuity_fd,
                    cognition_fd,
                    mcp_fd,
                    presentation_fd,
                )
            });
        }
    }
    // Windows: suppress the harness console window. Without this a bare
    // terminal pops for buzz-acp.exe and lingers (the app itself sets
    // windows_subsystem="windows", but the spawned child does not inherit it).
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut resident_start_guard = ManagedResidentStartGuard::begin(resident_pubkey.as_str())?;
    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to spawn `{}` for agent {}: {error}",
            resolved_acp_command.display(),
            record.name
        )
    })?;
    let child_pid = child.id();
    let binding = crate::luca::local_broker_session::LocalBrokerSessionBinding {
        owner_pubkey: owner_pubkey.clone(),
        resident_pubkey: resident_pubkey.clone(),
        acp_pid: child_pid,
        session_epoch,
        runtime_configuration_sha256: runtime_configuration_sha256.clone(),
        installation_session_id,
        relay_url: effective_relay_url.clone(),
        relay_query_url,
        owner_attestation: owner_attestation.map(|(typed, _)| typed),
    };
    let publisher_setup = (|| -> Result<_, String> {
        let dispatch_store = crate::luca::managed_dispatch_store::global_dispatch_store(app)?;
        let outbox_path = app_data_dir
            .join("luca")
            .join("managed-outbox")
            .join(format!("{}.age", resident_pubkey.as_str()));
        let publisher = crate::luca::managed_message_publisher::ManagedMessagePublisher::new(
            resident_keys.clone(),
            &effective_relay_url,
            record.auth_tag.clone(),
            std::sync::Arc::clone(&dispatch_store),
            app.clone(),
            runtime_binding_ref.clone(),
        )
        .map_err(|error| format!("failed to bind managed message publisher: {error}"))?;
        resident_start_guard
            .activate_session(std::sync::Arc::clone(&dispatch_store), session_epoch.get())?;
        Ok((outbox_path, publisher, dispatch_store))
    })();
    let (outbox_path, publisher, dispatch_store) = match publisher_setup {
        Ok(setup) => setup,
        Err(error) => {
            abort_spawned_child(&mut child);
            return Err(error);
        }
    };
    let mut broker =
        match crate::luca::signing_broker::ResidentSigningBroker::new_persistent_with_publication_authority(
            resident_keys,
            binding,
            outbox_path,
            Box::new(publisher),
        ) {
            Ok(broker) => broker,
            Err(error) => {
                abort_spawned_child(&mut child);
                return Err(format!("failed to bind managed signing broker: {error}"));
            }
        };
    let capsule_handle = broker.capsule_handle();
    let (mut broker_stream, broker_shutdown) = match desktop_broker_endpoint.split_for_serve() {
        Ok(split) => split,
        Err(error) => {
            abort_spawned_child(&mut child);
            return Err(format!(
                "failed to split managed signing broker endpoint: {error}"
            ));
        }
    };
    for result in [
        broker_stream.set_read_timeout(Some(std::time::Duration::from_millis(250))),
        broker_stream.set_write_timeout(Some(std::time::Duration::from_secs(5))),
    ] {
        if let Err(error) = result {
            abort_spawned_child(&mut child);
            return Err(format!(
                "failed to bound managed signing broker socket I/O: {error}"
            ));
        }
    }
    let broker_thread_name = format!("luca-signing-{}", &record.pubkey[..8]);
    let resident_for_broker = resident_pubkey.clone();
    let epoch_for_broker = session_epoch;
    let app_for_broker = app.clone();
    let broker_thread =
        match std::thread::Builder::new()
            .name(broker_thread_name)
            .spawn(move || {
                let startup_status = broker.reconcile_publication_outbox_startup_pass();
                match terminalize_restart_dispatches_if_proven(
                    startup_status,
                    &dispatch_store,
                    resident_for_broker.as_str(),
                    epoch_for_broker.get(),
                ) {
                    Ok(Some(interrupted)) => {
                        if interrupted > 0 {
                            eprintln!(
                                "luca-signing: interrupted {interrupted} prior-epoch managed dispatch(es) after complete startup outbox reconciliation"
                            );
                        }
                        if let Err(error) = spawn_restart_interrupted_artifact_receipt_retry(
                            &app_for_broker,
                            &dispatch_store,
                            resident_for_broker.as_str(),
                        ) {
                            eprintln!("luca-artifacts: failed to settle restart-interrupted receipts: {error}");
                        }
                    }
                    Ok(None) => eprintln!(
                        "luca-signing: managed publication startup reconciliation deferred; preserving prior dispatch authority"
                    ),
                    Err(error) => eprintln!(
                        "luca-signing: failed to terminalize prior dispatches after startup reconciliation: {error}"
                    ),
                }
                let caller = crate::luca::local_broker_session::LocalBrokerCaller {
                    acp_pid: child_pid,
                    runtime_configuration_sha256: &runtime_configuration_sha256,
                };
                if let Err(error) = broker.serve_relay_auth_session(&mut broker_stream, caller) {
                    eprintln!("luca-signing: managed broker session closed: {error}");
                }
                crate::luca::managed_permission::cancel_resident_session(
                    resident_for_broker.as_str(),
                    epoch_for_broker.get(),
                );
            }) {
            Ok(handle) => handle,
            Err(error) => {
                abort_spawned_child(&mut child);
                return Err(format!("failed to start managed signing broker: {error}"));
            }
        };
    if let Err(owner) = register_managed_signing_broker(
        &record.pubkey,
        ManagedSigningBrokerOwner {
            owner_pubkey: owner_pubkey.as_str().to_owned(),
            session_epoch,
            shutdown: broker_shutdown,
            handle: broker_thread,
        },
    ) {
        let _ = owner.shutdown.shutdown();
        let _ = owner.handle.join();
        abort_spawned_child(&mut child);
        return Err("managed signing broker owner already exists".into());
    }
    if register_managed_capsule_broker(&record.pubkey, capsule_handle).is_err() {
        let _ = join_managed_signing_broker(&record.pubkey);
        abort_spawned_child(&mut child);
        return Err("managed Capsule broker owner already exists".into());
    }
    if crate::luca::managed_cognition::register(managed_cognition_client).is_err() {
        let _ = join_managed_signing_broker(&record.pubkey);
        abort_spawned_child(&mut child);
        return Err("managed cognition broker owner already exists".into());
    }
    #[cfg(unix)]
    if let Err(error) = repository_broker_lease.commit() {
        let _ = join_managed_signing_broker(&record.pubkey);
        abort_spawned_child(&mut child);
        return Err(format!("failed to register repository broker: {error}"));
    }
    #[cfg(unix)]
    if let Some(artifact_broker_lease) = artifact_broker_lease {
        if artifact_broker_lease.commit().is_err() {
            eprintln!(
                "luca-artifacts: broker registration failed; conversation remains available without artifact tools"
            );
        }
    }

    // Stamp the adapter availability for runtimes with a version gate (codex
    // only). The summary builder compares this against the current cached value
    // to detect out-of-band adapter changes after spawn (Phase-2 badge fallback).
    // Non-codex runtimes get `None` — nothing changes for them.
    // When the cache is cold (e.g. Doctor just installed and cleared the cache),
    // `adapter_availability_cached()` returns `None`, so the stamp is `None` and
    // the drift check is skipped until discovery warms the cache — preventing a
    // false restart badge immediately after auto-restart.
    let spawned_adapter_availability = if runtime_meta.is_some_and(|r| r.id == "codex") {
        super::adapter_availability_cached()
    } else {
        None
    };

    let _ = super::write_agent_pid_file(app, &record.pubkey, child.id());

    // Windows: assign the harness to a Job Object so its whole tree dies with
    // the handle. The Unix process-group equivalent is set above.
    #[cfg(windows)]
    let process = super::process_lifecycle::finish_spawn(
        child,
        log_path,
        spawn_config_hash,
        spawned_setup_mode,
        spawned_adapter_availability,
        &record.name,
    );
    #[cfg(not(windows))]
    let process = crate::managed_agents::ManagedAgentProcess {
        child,
        log_path,
        spawn_config_hash,
        setup_mode: spawned_setup_mode,
        adapter_availability: spawned_adapter_availability,
    };
    resident_start_guard.commit();
    Ok(process)
}

fn child_rust_log_filter() -> String {
    match std::env::var("RUST_LOG") {
        Ok(existing) if existing.contains("buzz_acp") => existing,
        Ok(existing) if !existing.trim().is_empty() => format!("{existing},buzz_acp=info"),
        _ => "buzz_acp=info".to_string(),
    }
}

pub fn start_managed_agent_process(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    runtimes: &mut HashMap<String, ManagedAgentProcess>,
    owner_hex: Option<&str>,
) -> Result<(), String> {
    if let Some(runtime) = runtimes.get_mut(&record.pubkey) {
        if runtime
            .child
            .try_wait()
            .map_err(|error| format!("failed to inspect running process: {error}"))?
            .is_none()
        {
            return Ok(());
        }

        runtimes.remove(&record.pubkey);
        join_managed_signing_broker(&record.pubkey)?;
    }

    if let Some(pid) = record.runtime_pid {
        if process_is_running(pid)
            && process_belongs_to_us(pid)
            && process_has_buzz_marker(pid, &current_instance_id(app))
        {
            record.updated_at = now_iso();
            record.last_error = None;
            record.last_error_code = None;
            return Ok(());
        }

        record.runtime_pid = None;
    }

    // The agent folder is what this spawn will actually read, so re-derive its
    // hash from disk first: the stamped spawn hash then matches the current
    // files, and an out-of-band edit before start does not badge the moment
    // the resident comes up. Failure to read the folder is not fatal — the
    // spawn falls back to the record's pin below.
    if record.documents_dir.is_some() {
        if let Err(error) = crate::luca::resident_documents::refresh_documents_hash(app, record) {
            eprintln!(
                "buzz-desktop: resident-documents: hash refresh for {} failed before spawn: {error}",
                record.name
            );
        }
    }

    let process = spawn_agent_child(app, record, owner_hex)?;

    let now = now_iso();
    record.updated_at = now.clone();
    record.runtime_pid = Some(process.child.id());
    record.last_started_at = Some(now);
    record.last_stopped_at = None;
    record.last_exit_code = None;
    record.last_error = None;
    record.last_error_code = None;

    runtimes.insert(record.pubkey.clone(), process);
    Ok(())
}

pub fn stop_managed_agent_process(
    app: &AppHandle,
    record: &mut ManagedAgentRecord,
    runtimes: &mut HashMap<String, ManagedAgentProcess>,
) -> Result<(), String> {
    let Some(mut runtime) = runtimes.remove(&record.pubkey) else {
        // Revoke all resident-scoped broker authority before attempting a
        // fallible process termination. A failed kill must never leave the
        // process paired with live signing or communication capabilities.
        let broker_result = join_managed_signing_broker(&record.pubkey);
        if let Some(pid) = record.runtime_pid {
            if process_is_running(pid) {
                terminate_process(pid)?;
            }

            let now = now_iso();
            record.runtime_pid = None;
            record.updated_at = now.clone();
            record.last_stopped_at = Some(now);
            record.last_exit_code = None;
            record.last_error = None;
            record.last_error_code = None;
        }
        super::remove_agent_pid_file(app, &record.pubkey);
        broker_result?;
        return Ok(());
    };

    // Close broker authority first; process termination remains best-effort
    // after this point, but no live child can retain host-managed privileges.
    let broker_result = join_managed_signing_broker(&record.pubkey);

    // On Unix, kill the entire process group via terminate_process.
    // On Windows, drop the Job Object handle (KILL_ON_JOB_CLOSE) so the whole
    // harness tree dies — Child::kill() would orphan the agent workers + MCP
    // servers. If job assignment failed at spawn, fall back to Child::kill().
    #[cfg(unix)]
    terminate_process(runtime.child.id())?;
    #[cfg(windows)]
    match runtime.job.take() {
        Some(job) => drop(job),
        None => runtime
            .child
            .kill()
            .map_err(|error| format!("failed to kill agent process: {error}"))?,
    }
    #[cfg(not(any(unix, windows)))]
    runtime
        .child
        .kill()
        .map_err(|error| format!("failed to kill agent process: {error}"))?;
    let status = runtime
        .child
        .wait()
        .map_err(|error| format!("failed to wait for agent shutdown: {error}"))?;
    let now = now_iso();
    record.runtime_pid = None;
    record.updated_at = now.clone();
    record.last_stopped_at = Some(now);
    record.last_exit_code = status.code();
    record.last_error = None;
    record.last_error_code = None;

    super::remove_agent_pid_file(app, &record.pubkey);

    append_log_marker(
        &runtime.log_path,
        &format!(
            "=== stopped {} ({}) at {} ===",
            record.name,
            record.pubkey,
            now_iso()
        ),
    )?;
    broker_result?;

    Ok(())
}

/// Returns the (key, value) env var pairs that should be forwarded to the
/// agent process for model and provider selection.
///
/// Model injection is unconditional — even agents that support ACP model
/// switching need the initial bootstrap value. Provider injection is skipped
/// when `provider_locked` is true (e.g. Claude runtimes that only work with
/// Anthropic).
pub(crate) fn runtime_metadata_env_vars<'a>(
    model_env_var: Option<&'a str>,
    provider_env_var: Option<&'a str>,
    provider_locked: bool,
    effective_model: Option<&'a str>,
    effective_provider: Option<&'a str>,
) -> Vec<(&'a str, &'a str)> {
    let mut vars = Vec::new();
    if let (Some(env_key), Some(model)) = (model_env_var, effective_model) {
        vars.push((env_key, model));
    }
    if !provider_locked {
        if let (Some(env_key), Some(provider)) = (provider_env_var, effective_provider) {
            vars.push((env_key, provider));
        }
    }
    vars
}

/// Resolve the effective (prompt, model, provider) triple for a persona-linked agent.
///
/// Given a persona_id, finds the persona in the list and returns its system_prompt,
/// model, and provider as the authoritative values. When the persona leaves `model`
/// or `provider` blank (None or whitespace-only), falls back to the record's own
/// field using the same precedence rule as `persona_snapshot_with_agent_config_fallback`
/// so the display surface matches spawn behavior. Falls back to the record's own
/// prompt/model/provider when no persona is linked or found.
///
/// Used by `agent_config.rs` to inject persona defaults into the config surface
/// before running the reader, so BuzzExplicit-tagged fields can be re-tagged to
/// PersonaDefault for fields the record did not independently set.
pub(crate) fn resolve_effective_prompt_model_provider(
    persona_id: Option<&str>,
    personas: &[crate::managed_agents::types::AgentDefinition],
    record_prompt: Option<String>,
    record_model: Option<String>,
    record_provider: Option<String>,
) -> (Option<String>, Option<String>, Option<String>) {
    let fallback = crate::managed_agents::persona_events::persona_field_with_record_fallback;
    match persona_id.and_then(|pid| personas.iter().find(|p| p.id == pid)) {
        Some(p) => (
            Some(p.system_prompt.clone()),
            fallback(p.model.as_deref(), record_model.as_deref()), // fallback: record.model
            fallback(p.provider.as_deref(), record_provider.as_deref()), // fallback: record.provider
        ),
        None => (record_prompt, record_model, record_provider),
    }
}

#[cfg(test)]
mod tests;

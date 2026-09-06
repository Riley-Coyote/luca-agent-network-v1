//! Read-only discovery and exact identity bindings for native agent runtimes.
//!
//! Discovery never writes native configuration, changes an active profile, or
//! starts/restarts an external service. The returned binding is a preview; it
//! becomes authoritative only after an explicit import operation persists it.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

mod openclaw;
mod provisioning;

pub(crate) use provisioning::{openclaw_provisioning_context, with_openclaw_agent};

const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SecretRefProvider {
    Keychain,
    ProtectedFile,
    NativeStore,
}

/// A non-secret locator for protected material. Secret values never enter this
/// type, resident JSON, logs, or frontend discovery payloads.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub provider: SecretRefProvider,
    pub locator: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[allow(clippy::large_enum_variant)] // Wire-compatible persisted shape; changing it would migrate resident bindings.
pub enum RuntimeBinding {
    Hermes {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "profileName")]
        profile_name: String,
        #[serde(rename = "hermesHome")]
        hermes_home: PathBuf,
        #[serde(rename = "executablePath")]
        executable_path: PathBuf,
        #[serde(rename = "runtimeVersion")]
        runtime_version: String,
        #[serde(rename = "defaultWorkspace", skip_serializing_if = "Option::is_none")]
        default_workspace: Option<PathBuf>,
    },
    Openclaw {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "agentId")]
        agent_id: String,
        #[serde(rename = "executablePath")]
        executable_path: PathBuf,
        #[serde(rename = "runtimeVersion")]
        runtime_version: String,
        #[serde(rename = "gatewayIdentity")]
        gateway_identity: String,
        #[serde(rename = "gatewayUrlRef")]
        gateway_url_ref: SecretRef,
        #[serde(
            rename = "gatewayTokenFileRef",
            skip_serializing_if = "Option::is_none"
        )]
        gateway_token_file_ref: Option<SecretRef>,
        #[serde(
            rename = "gatewayPasswordFileRef",
            skip_serializing_if = "Option::is_none"
        )]
        gateway_password_file_ref: Option<SecretRef>,
        #[serde(rename = "openClawProfile", skip_serializing_if = "Option::is_none")]
        open_claw_profile: Option<String>,
        #[serde(rename = "stateDirectory", skip_serializing_if = "Option::is_none")]
        state_directory: Option<PathBuf>,
        #[serde(rename = "defaultWorkspace", skip_serializing_if = "Option::is_none")]
        default_workspace: Option<PathBuf>,
    },
}

impl RuntimeBinding {
    pub(crate) fn launch_preview(&self) -> (String, Vec<String>) {
        let executable = match self {
            Self::Hermes {
                executable_path, ..
            }
            | Self::Openclaw {
                executable_path, ..
            } => executable_path.display().to_string(),
        };
        (executable, vec!["acp".into()])
    }

    pub(crate) fn hermes_provisioning_context(
        &self,
    ) -> Option<(String, PathBuf, PathBuf, Option<PathBuf>)> {
        match self {
            Self::Hermes {
                profile_name,
                hermes_home,
                executable_path,
                default_workspace,
                ..
            } => Some((
                profile_name.clone(),
                hermes_home.clone(),
                executable_path.clone(),
                default_workspace.clone(),
            )),
            Self::Openclaw { .. } => None,
        }
    }
}

pub(crate) fn build_hermes_runtime_binding(
    profile_name: String,
    hermes_home: PathBuf,
    executable_path: PathBuf,
    runtime_version: String,
    default_workspace: Option<PathBuf>,
) -> RuntimeBinding {
    RuntimeBinding::Hermes {
        schema_version: 1,
        profile_name,
        hermes_home,
        executable_path,
        runtime_version,
        default_workspace,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedNativeRuntime {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
    pub harness_environment: BTreeMap<String, String>,
    pub default_workspace: Option<PathBuf>,
}

fn checked_executable(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "native runtime executable {} is unavailable: {error}",
            path.display()
        )
    })?;
    if canonical != path {
        return Err(format!(
            "native runtime executable changed since import (expected {}, found {})",
            path.display(),
            canonical.display()
        ));
    }
    if !canonical.is_file() {
        return Err(format!(
            "native runtime executable is not a file: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn checked_workspace(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|error| {
        format!(
            "native runtime workspace {} is unavailable: {error}",
            path.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "native runtime workspace is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Resolve a previously validated binding without rediscovering or mutating
/// the native system. This is the sole binding-to-process descriptor path.
pub(crate) fn resolve_native_runtime_binding(
    binding: &RuntimeBinding,
) -> Result<ResolvedNativeRuntime, String> {
    match binding {
        RuntimeBinding::Hermes {
            schema_version,
            profile_name,
            hermes_home,
            executable_path,
            default_workspace,
            ..
        } => {
            if *schema_version != 1 || profile_name.trim().is_empty() {
                return Err("unsupported or incomplete Hermes identity binding".into());
            }
            let command = checked_executable(executable_path)?;
            let canonical_home = hermes_home.canonicalize().map_err(|error| {
                format!(
                    "Hermes profile home {} is unavailable: {error}",
                    hermes_home.display()
                )
            })?;
            if canonical_home != *hermes_home || !canonical_home.is_dir() {
                return Err("Hermes profile home changed since import".into());
            }
            let default_workspace = default_workspace
                .as_deref()
                .map(checked_workspace)
                .transpose()?;
            Ok(ResolvedNativeRuntime {
                command,
                args: vec!["acp".into()],
                environment: BTreeMap::from([(
                    "HERMES_HOME".into(),
                    canonical_home.display().to_string(),
                )]),
                harness_environment: BTreeMap::new(),
                default_workspace,
            })
        }
        binding @ RuntimeBinding::Openclaw { .. } => openclaw::resolve(binding),
    }
}

/// Re-discover before the first durable write so stale or renderer-forged
/// bindings fail closed. Discovery remains read-only.
pub fn validate_native_runtime_binding(binding: &RuntimeBinding) -> Result<(), String> {
    revalidate_native_runtime_binding(binding).map(|_| ())
}

/// Return a current, verified binding for the same durable native identity.
/// Mutable discovery details (such as an upgraded executable path) are a
/// fingerprint, not the identity itself, and are refreshed before persistence.
pub fn revalidate_native_runtime_binding(
    binding: &RuntimeBinding,
) -> Result<RuntimeBinding, String> {
    let trusted_hermes = if matches!(binding, RuntimeBinding::Hermes { .. }) {
        hermes_executable()?
    } else {
        None
    };
    let child_path = trusted_hermes
        .as_ref()
        .and_then(|_| super::login_shell_path());
    revalidate_native_runtime_binding_with(
        binding,
        trusted_hermes.as_deref(),
        child_path.as_deref(),
        discover_native_resident_candidates,
    )
}

fn revalidate_native_runtime_binding_with(
    binding: &RuntimeBinding,
    trusted_hermes: Option<&Path>,
    child_path: Option<&str>,
    discover: impl FnOnce() -> Vec<DiscoveredResidentCandidate>,
) -> Result<RuntimeBinding, String> {
    if let RuntimeBinding::Hermes {
        executable_path, ..
    } = binding
    {
        if let Some(trusted) = trusted_hermes.filter(|trusted| *trusted == executable_path) {
            return revalidate_hermes_at_trusted_executable(binding, trusted, child_path);
        }
    }
    // An explicitly upgraded executable still follows catalog discovery, which
    // refreshes its fingerprint without changing the durable native identity.
    let verified = discover()
        .into_iter()
        .find(|candidate| {
            native_runtime_semantic_key(&candidate.binding_preview)
                == native_runtime_semantic_key(binding)
        })
        .map(|candidate| candidate.binding_preview);
    let verified = match verified {
        Some(verified) => verified,
        None if matches!(binding, RuntimeBinding::Hermes { .. }) => {
            // Custom roots may not be visible to ambient profile discovery. The
            // executable still comes from the app's discovery path, never IPC.
            let executable =
                trusted_hermes.ok_or("Hermes is unavailable for exact profile verification.")?;
            revalidate_hermes_at_trusted_executable(binding, executable, child_path)?
        }
        None => return Err("native identity binding no longer matches current discovery".into()),
    };
    resolve_native_runtime_binding(&verified)?;
    Ok(verified)
}

/// Recheck only the selected Hermes profile using the app's current trusted
/// executable. Unlike general revalidation, an import review cannot adopt an
/// executable change or substitute another profile from catalog discovery.
pub(crate) fn revalidate_exact_hermes_runtime_binding(
    binding: &RuntimeBinding,
) -> Result<RuntimeBinding, String> {
    let executable =
        hermes_executable()?.ok_or("Hermes is unavailable for exact profile verification.")?;
    let child_path = super::login_shell_path();
    revalidate_hermes_at_trusted_executable(binding, &executable, child_path.as_deref())
}

/// Resolve the profile-operation root using Hermes' standard/custom home layout.
pub(crate) fn hermes_profile_root(home: &Path) -> Result<PathBuf, String> {
    let home = home
        .canonicalize()
        .map_err(|_| "Hermes profile home is unavailable.")?;
    if let Some(default) = dirs::home_dir().map(|path| path.join(".hermes")) {
        if let Ok(default) = default.canonicalize() {
            if home.starts_with(&default) {
                return Ok(default);
            }
        }
    }
    if home
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        == Some("profiles")
    {
        return home
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .ok_or_else(|| "Hermes profile root is invalid.".into());
    }
    Ok(home)
}

fn revalidate_hermes_at_trusted_executable(
    binding: &RuntimeBinding,
    trusted: &Path,
    child_path: Option<&str>,
) -> Result<RuntimeBinding, String> {
    let RuntimeBinding::Hermes {
        profile_name,
        hermes_home,
        executable_path,
        default_workspace,
        ..
    } = binding
    else {
        return Err("Expected a Hermes profile binding.".into());
    };
    // Check this before any probe: a renderer-supplied executable is not a trust anchor.
    if executable_path != trusted
        || checked_executable(trusted)? != trusted
        || profile_name.is_empty()
        || profile_name.len() > 64
        || !profile_name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_".contains(&byte))
    {
        return Err("Hermes executable or profile no longer matches trusted discovery. Review the native setup.".into());
    }
    resolve_native_runtime_binding(binding)?;
    let root = hermes_profile_root(hermes_home)?;
    let environment = BTreeMap::from([("HERMES_HOME".into(), root.display().to_string())]);
    let shown = run_bounded_with_environment(
        trusted,
        &["profile", "show", profile_name],
        DISCOVERY_TIMEOUT,
        child_path,
        &environment,
    )?;
    let details = parse_hermes_profile_details(&output_text(&shown));
    if !shown.status.success() || details.path.as_deref() != Some(hermes_home.as_path()) {
        return Err(
            "Hermes did not confirm the exact selected profile. Review the native setup.".into(),
        );
    }
    let version = run_bounded_with_environment(
        trusted,
        &["--version"],
        DISCOVERY_TIMEOUT,
        child_path,
        &environment,
    )?;
    if !version.status.success() {
        return Err("Hermes version could not be verified.".into());
    }
    let version = output_text(&version);
    let verified = build_hermes_runtime_binding(
        profile_name.clone(),
        hermes_home.clone(),
        trusted.to_path_buf(),
        version,
        default_workspace.clone(),
    );
    resolve_native_runtime_binding(&verified)?;
    Ok(verified)
}

/// Stable, non-secret identity used for idempotent native imports. Full
/// bindings remain the verified launch fingerprint stored on the resident.
pub fn native_runtime_semantic_key(binding: &RuntimeBinding) -> String {
    match binding {
        RuntimeBinding::Hermes {
            profile_name,
            hermes_home,
            ..
        } => {
            format!("hermes:{}:{}", hermes_home.display(), profile_name.trim())
        }
        RuntimeBinding::Openclaw {
            gateway_identity,
            agent_id,
            ..
        } => {
            format!("openclaw:{}:{}", gateway_identity.trim(), agent_id.trim())
        }
    }
}

/// Opaque fingerprint of the full verified launch binding. This intentionally
/// changes when executable or runtime metadata changes while the semantic key
/// remains stable for idempotency.
pub fn native_runtime_binding_fingerprint(binding: &RuntimeBinding) -> String {
    let bytes = serde_json::to_vec(binding).unwrap_or_default();
    hex::encode(Sha256::digest(bytes))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeRuntimeKind {
    Hermes,
    Openclaw,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ResidentReadiness {
    /// Identity and executable are valid, but the bounded ACP probe has not run.
    Discovered {
        message: String,
    },
    Ready,
    Degraded {
        code: String,
        message: String,
    },
    Unavailable {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredResidentCandidate {
    pub native_type: NativeRuntimeKind,
    pub native_id: String,
    pub semantic_id: String,
    pub binding_fingerprint: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_location: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    pub readiness: ResidentReadiness,
    pub warnings: Vec<DiscoveryWarning>,
    pub binding_preview: RuntimeBinding,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeDiscoveryStatus {
    Available,
    Absent,
    Degraded,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeDiscoveryOutcome {
    pub native_type: NativeRuntimeKind,
    pub status: NativeDiscoveryStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub candidates: Vec<DiscoveredResidentCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeResidentDiscoveryOutcome {
    pub runtimes: Vec<NativeRuntimeDiscoveryOutcome>,
}

#[derive(Debug)]
struct CapturedOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn read_capture(file: &mut File) -> std::io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(0))?;
    let mut output = Vec::new();
    file.take(MAX_CAPTURE_BYTES as u64)
        .read_to_end(&mut output)?;
    Ok(output)
}

/// Run a read-only native CLI probe with a hard process deadline and bounded
/// output. Temporary files avoid pipe-buffer deadlocks from noisy children.
fn run_bounded(binary: &Path, args: &[&str], timeout: Duration) -> Result<CapturedOutput, String> {
    let login_shell_path = super::login_shell_path();
    run_bounded_with_path(binary, args, timeout, login_shell_path.as_deref())
}

fn run_bounded_with_path(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
    child_path: Option<&str>,
) -> Result<CapturedOutput, String> {
    run_bounded_with_environment(binary, args, timeout, child_path, &BTreeMap::new())
}

fn run_bounded_with_environment(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
    child_path: Option<&str>,
    environment: &BTreeMap<String, String>,
) -> Result<CapturedOutput, String> {
    let mut stdout_file = tempfile::tempfile().map_err(|e| format!("capture stdout: {e}"))?;
    let mut stderr_file = tempfile::tempfile().map_err(|e| format!("capture stderr: {e}"))?;
    let mut command = Command::new(binary);
    command.envs(environment);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::from(
        stdout_file
            .try_clone()
            .map_err(|e| format!("clone stdout capture: {e}"))?,
    ));
    command.stderr(Stdio::from(
        stderr_file
            .try_clone()
            .map_err(|e| format!("clone stderr capture: {e}"))?,
    ));
    if let Some(path) = child_path.filter(|path| !path.trim().is_empty()) {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("start {}: {e}", binary.display()))?;

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                cleanup_failed_probe(&mut child)?;
                return Err(format!(
                    "{} timed out after {} ms",
                    binary.display(),
                    timeout.as_millis()
                ));
            }
            Err(error) => {
                // ECHILD means another waiter already reaped the leader. Its
                // identifier is no longer ours to signal.
                #[cfg(unix)]
                if error.raw_os_error() == Some(libc::ECHILD) {
                    return Err(format!("wait for {}: {error}", binary.display()));
                }
                cleanup_failed_probe(&mut child)?;
                return Err(format!("wait for {}: {error}", binary.display()));
            }
        }
    };

    let stdout = read_capture(&mut stdout_file).map_err(|e| format!("read stdout: {e}"))?;
    let stderr = read_capture(&mut stderr_file).map_err(|e| format!("read stderr: {e}"))?;
    Ok(CapturedOutput {
        status,
        stdout,
        stderr,
    })
}

fn cleanup_failed_probe(child: &mut std::process::Child) -> Result<(), String> {
    // This child has not been reaped: its ID cannot be reused while the existing
    // group shutdown runs. Never signal after successful try_wait. Reclamation
    // of descendants left behind by successful commands is outside this path.
    #[cfg(any(unix, windows))]
    let group_result = super::terminate_process(child.id());
    #[cfg(not(any(unix, windows)))]
    let group_result: Result<(), String> = Ok(());
    let _ = child.kill();
    let reap = child
        .wait()
        .map_err(|_| "Native probe could not be reaped.".to_string());
    group_result?;
    reap.map(|_| ())
}

fn output_text(output: &CapturedOutput) -> String {
    let bytes = if output.stdout.is_empty() {
        &output.stderr
    } else {
        &output.stdout
    };
    let stripped = strip_ansi_escapes::strip(bytes);
    String::from_utf8_lossy(&stripped).trim().to_string()
}

fn command_version(binary: &Path) -> Option<String> {
    let output = run_bounded(binary, &["--version"], DISCOVERY_TIMEOUT).ok()?;
    output.status.success().then(|| output_text(&output))
}

/// Validate a picked installation with one fixed, read-only five-second probe.
/// Native output outside the recognizable public version line is not exposed.
pub(super) fn validate_hermes_version(binary: &Path) -> Result<String, String> {
    let output = run_bounded(binary, &["--version"], DISCOVERY_TIMEOUT).map_err(|_| {
        "Hermes version check did not finish. Check the executable and choose again.".to_owned()
    })?;
    let text = output_text(&output);
    let version = text.lines().next().unwrap_or_default();
    if !output.status.success()
        || version.len() > 512
        || !(version.starts_with("Hermes Agent v") || version.starts_with("Hermes v"))
        || version.chars().any(char::is_control)
    {
        return Err("The chosen executable did not report a supported Hermes version.".into());
    }
    Ok(version.to_owned())
}

fn canonical_executable(command: &str) -> Option<PathBuf> {
    super::resolve_command(command).and_then(|path| path.canonicalize().ok().or(Some(path)))
}

fn hermes_executable() -> Result<Option<PathBuf>, String> {
    match super::native_runtime_selection::selected_hermes_executable()? {
        Some(path) => Ok(Some(path)),
        None => Ok(canonical_executable("hermes")),
    }
}

fn parse_hermes_profile_names(output: &str) -> Vec<(String, Option<String>)> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("Profile")
                && !line.starts_with('─')
                && !line.starts_with('-')
        })
        .filter_map(|line| {
            let normalized = line.trim_start_matches('◆').trim();
            let mut columns = normalized.split_whitespace();
            let name = columns.next()?.to_string();
            let model = columns.next().map(str::to_string);
            Some((name, model))
        })
        .collect()
}

#[derive(Default)]
struct HermesProfileDetails {
    path: Option<PathBuf>,
    model: Option<String>,
}

fn parse_hermes_profile_details(output: &str) -> HermesProfileDetails {
    let mut details = HermesProfileDetails::default();
    for line in output.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("Path:") {
            details.path = Some(PathBuf::from(value.trim()));
        } else if let Some(value) = line.strip_prefix("Model:") {
            details.model = Some(value.trim().to_string());
        }
    }
    details
}

fn discover_hermes() -> NativeRuntimeDiscoveryOutcome {
    let executable = match hermes_executable() {
        Ok(executable) => executable,
        Err(message) => {
            return NativeRuntimeDiscoveryOutcome {
                native_type: NativeRuntimeKind::Hermes,
                status: NativeDiscoveryStatus::Failed,
                message: Some(message),
                candidates: Vec::new(),
            }
        }
    };
    let Some(executable_path) = executable else {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Hermes,
            status: NativeDiscoveryStatus::Absent,
            message: Some("Hermes is not installed or is not on this app's PATH.".into()),
            candidates: Vec::new(),
        };
    };
    let runtime_version = command_version(&executable_path).unwrap_or_else(|| "unknown".into());
    let Ok(list) = run_bounded(&executable_path, &["profile", "list"], DISCOVERY_TIMEOUT) else {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Hermes,
            status: NativeDiscoveryStatus::Failed,
            message: Some(
                "Hermes could not be queried. Check that it can run from a login shell.".into(),
            ),
            candidates: Vec::new(),
        };
    };
    if !list.status.success() {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Hermes,
            status: NativeDiscoveryStatus::Failed,
            message: Some("Hermes profile discovery failed.".into()),
            candidates: Vec::new(),
        };
    }
    let candidates = parse_hermes_profile_names(&output_text(&list))
        .into_iter()
        .filter_map(|(profile_name, listed_model)| {
            let shown = run_bounded(
                &executable_path,
                &["profile", "show", &profile_name],
                DISCOVERY_TIMEOUT,
            );
            let details = shown
                .as_ref()
                .ok()
                .filter(|output| output.status.success())
                .map(output_text)
                .map(|text| parse_hermes_profile_details(&text))
                .unwrap_or_default();
            let raw_home = details.path?;
            let canonical_home = raw_home.canonicalize().unwrap_or(raw_home);
            let home_exists = canonical_home.is_dir();
            let readiness = if home_exists {
                ResidentReadiness::Discovered {
                    message: "Exact Hermes profile found; ACP readiness not yet tested.".into(),
                }
            } else {
                ResidentReadiness::Unavailable {
                    code: "HERMES_PROFILE_MISSING".into(),
                    message: format!(
                        "Hermes profile {profile_name} no longer exists at {}.",
                        canonical_home.display()
                    ),
                }
            };
            let binding_preview = RuntimeBinding::Hermes {
                schema_version: 1,
                profile_name,
                hermes_home: canonical_home,
                executable_path: executable_path.clone(),
                runtime_version: runtime_version.clone(),
                default_workspace: None,
            };
            Some(DiscoveredResidentCandidate {
                native_type: NativeRuntimeKind::Hermes,
                native_id: match &binding_preview {
                    RuntimeBinding::Hermes { profile_name, .. } => profile_name.clone(),
                    _ => unreachable!(),
                },
                display_name: match &binding_preview {
                    RuntimeBinding::Hermes { profile_name, .. } => profile_name.clone(),
                    _ => unreachable!(),
                },
                semantic_id: native_runtime_semantic_key(&binding_preview),
                binding_fingerprint: native_runtime_binding_fingerprint(&binding_preview),
                canonical_location: match &binding_preview {
                    RuntimeBinding::Hermes { hermes_home, .. } => Some(hermes_home.clone()),
                    _ => None,
                },
                workspace: None,
                model_summary: details.model.or(listed_model),
                runtime_version: Some(runtime_version.clone()),
                readiness,
                warnings: Vec::new(),
                binding_preview,
            })
        })
        .collect::<Vec<_>>();
    let degraded = candidates
        .iter()
        .any(|candidate| matches!(candidate.readiness, ResidentReadiness::Unavailable { .. }));
    NativeRuntimeDiscoveryOutcome {
        native_type: NativeRuntimeKind::Hermes,
        status: if degraded {
            NativeDiscoveryStatus::Degraded
        } else {
            NativeDiscoveryStatus::Available
        },
        message: degraded.then(|| "One or more Hermes profiles are unavailable.".into()),
        candidates,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawAgentRow {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    identity_name: Option<String>,
    #[serde(default)]
    workspace: Option<PathBuf>,
    #[serde(default)]
    agent_dir: Option<PathBuf>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawGatewayStatus {
    #[serde(default)]
    gateway: OpenclawGatewayTarget,
    #[serde(default)]
    rpc: OpenclawRpcStatus,
    #[serde(default)]
    service: OpenclawServiceStatus,
    #[serde(default)]
    config: OpenclawGatewayConfigStatus,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawGatewayTarget {
    #[serde(default)]
    bind_host: Option<String>,
    #[serde(default)]
    port: Option<u16>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawGatewayConfigStatus {
    #[serde(default)]
    daemon: OpenclawConfigFile,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawConfigFile {
    #[serde(default)]
    path: Option<PathBuf>,
    #[serde(default)]
    exists: bool,
    #[serde(default)]
    valid: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawRpcStatus {
    #[serde(default)]
    ok: bool,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawServiceStatus {
    #[serde(default)]
    config_audit: OpenclawConfigAudit,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenclawConfigAudit {
    #[serde(default)]
    issues: Vec<OpenclawAuditIssue>,
}

#[derive(Debug, Deserialize)]
struct OpenclawAuditIssue {
    code: String,
    message: String,
}

fn nonsecret_identity(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    format!("gateway:{}", hex::encode(&digest[..12]))
}

/// A gateway locator derived from configured launch facts, never RPC health.
/// The canonical config path scopes identical local bind/port pairs belonging
/// to different OpenClaw installations.
fn configured_gateway_locator(status: &OpenclawGatewayStatus) -> Option<String> {
    let config = &status.config.daemon;
    if !config.exists || !config.valid {
        return None;
    }
    let config_path = config.path.as_ref()?.canonicalize().ok()?;
    let host = status.gateway.bind_host.as_deref()?.trim();
    let port = status.gateway.port?;
    if host.is_empty() {
        return None;
    }
    Some(format!("{}|ws://{host}:{port}", config_path.display()))
}

fn discover_openclaw() -> NativeRuntimeDiscoveryOutcome {
    let Some(executable_path) = canonical_executable("openclaw") else {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Openclaw,
            status: NativeDiscoveryStatus::Absent,
            message: Some("OpenClaw is not installed or is not on this app's PATH.".into()),
            candidates: Vec::new(),
        };
    };
    let runtime_version = command_version(&executable_path).unwrap_or_else(|| "unknown".into());
    let Ok(list) = run_bounded(
        &executable_path,
        &["agents", "list", "--json", "--bindings"],
        DISCOVERY_TIMEOUT,
    ) else {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Openclaw,
            status: NativeDiscoveryStatus::Failed,
            message: Some("OpenClaw could not list its agents.".into()),
            candidates: Vec::new(),
        };
    };
    if !list.status.success() {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Openclaw,
            status: NativeDiscoveryStatus::Failed,
            message: Some("OpenClaw returned an unreadable agent list.".into()),
            candidates: Vec::new(),
        };
    }
    let Ok(agents) = serde_json::from_slice::<Vec<OpenclawAgentRow>>(&list.stdout) else {
        return NativeRuntimeDiscoveryOutcome {
            native_type: NativeRuntimeKind::Openclaw,
            status: NativeDiscoveryStatus::Failed,
            message: Some("OpenClaw returned an unreadable agent list.".into()),
            candidates: Vec::new(),
        };
    };

    let gateway_status = run_bounded(
        &executable_path,
        &["gateway", "status", "--json", "--timeout", "1500"],
        DISCOVERY_TIMEOUT,
    )
    .ok()
    .and_then(|output| serde_json::from_slice::<OpenclawGatewayStatus>(&output.stdout).ok())
    .unwrap_or_default();
    let gateway_locator = configured_gateway_locator(&gateway_status);
    let gateway_identity = gateway_locator
        .as_deref()
        .map(nonsecret_identity)
        .unwrap_or_default();
    let state_directory = dirs::home_dir().map(|home| home.join(".openclaw"));
    let warnings: Vec<DiscoveryWarning> = gateway_status
        .service
        .config_audit
        .issues
        .iter()
        .map(|issue| DiscoveryWarning {
            code: issue.code.clone(),
            message: issue.message.clone(),
        })
        .collect();

    let candidates = agents
        .into_iter()
        .map(|agent| {
            let (default_workspace, workspace_error) = match agent.workspace.as_deref() {
                Some(path) => match checked_workspace(path) {
                    Ok(canonical) => (Some(canonical), None),
                    Err(error) => (Some(path.to_path_buf()), Some(error)),
                },
                None => (None, None),
            };
            let readiness = if gateway_locator.is_none() {
                ResidentReadiness::Unavailable {
                    code: "OPENCLAW_GATEWAY_IDENTITY_UNAVAILABLE".into(),
                    message: "OpenClaw has no stable configured Gateway locator; this agent cannot be imported safely.".into(),
                }
            } else if let Some(message) = workspace_error {
                ResidentReadiness::Degraded {
                    code: "OPENCLAW_WORKSPACE_UNAVAILABLE".into(),
                    message,
                }
            } else if gateway_status.rpc.ok {
                ResidentReadiness::Discovered {
                    message:
                        "Exact OpenClaw agent and Gateway found; ACP readiness not yet tested."
                            .into(),
                }
            } else {
                ResidentReadiness::Degraded {
                    code: "OPENCLAW_GATEWAY_UNREACHABLE".into(),
                    message: gateway_status.rpc.error.clone().unwrap_or_else(|| {
                        "OpenClaw Gateway is configured but unavailable.".into()
                    }),
                }
            };
            let display_name = agent
                .identity_name
                .or(agent.name)
                .unwrap_or_else(|| agent.id.clone());
            let binding_preview = RuntimeBinding::Openclaw {
                schema_version: 1,
                agent_id: agent.id.clone(),
                executable_path: executable_path.clone(),
                runtime_version: runtime_version.clone(),
                gateway_identity: gateway_identity.clone(),
                gateway_url_ref: SecretRef {
                    provider: SecretRefProvider::NativeStore,
                    locator: "openclaw:gateway:url".into(),
                    identity_hash: Some(gateway_identity.clone()),
                },
                gateway_token_file_ref: None,
                gateway_password_file_ref: None,
                open_claw_profile: None,
                state_directory: state_directory.clone(),
                default_workspace: default_workspace.clone(),
            };
            DiscoveredResidentCandidate {
                native_type: NativeRuntimeKind::Openclaw,
                native_id: agent.id.clone(),
                semantic_id: native_runtime_semantic_key(&binding_preview),
                binding_fingerprint: native_runtime_binding_fingerprint(&binding_preview),
                display_name,
                canonical_location: agent.agent_dir,
                workspace: default_workspace,
                model_summary: agent.model,
                runtime_version: Some(runtime_version.clone()),
                readiness,
                warnings: warnings.clone(),
                binding_preview,
            }
        })
        .collect::<Vec<_>>();
    let degraded = gateway_locator.is_none()
        || !gateway_status.rpc.ok
        || candidates.iter().any(|candidate| {
            matches!(
                candidate.readiness,
                ResidentReadiness::Degraded { .. } | ResidentReadiness::Unavailable { .. }
            )
        });
    NativeRuntimeDiscoveryOutcome {
        native_type: NativeRuntimeKind::Openclaw,
        status: if degraded {
            NativeDiscoveryStatus::Degraded
        } else {
            NativeDiscoveryStatus::Available
        },
        message: degraded.then(|| {
            if gateway_locator.is_none() {
                "OpenClaw has no stable configured Gateway locator.".into()
            } else {
                gateway_status
                    .rpc
                    .error
                    .unwrap_or_else(|| "OpenClaw Gateway is configured but unavailable.".into())
            }
        }),
        candidates,
    }
}

/// Discover linkable native identities without mutating either native system.
pub fn discover_native_resident_candidates() -> Vec<DiscoveredResidentCandidate> {
    discover_native_resident_outcome()
        .runtimes
        .into_iter()
        .flat_map(|outcome| outcome.candidates)
        .collect()
}

/// Per-runtime result preserves absent, degraded, and failed states instead of
/// conflating them with an empty successful scan.
pub fn discover_native_resident_outcome() -> NativeResidentDiscoveryOutcome {
    discover_native_resident_outcome_with(discover_hermes, discover_openclaw)
}

fn discovery_panic_outcome(
    native_type: NativeRuntimeKind,
    runtime_name: &str,
) -> NativeRuntimeDiscoveryOutcome {
    NativeRuntimeDiscoveryOutcome {
        native_type,
        status: NativeDiscoveryStatus::Failed,
        message: Some(format!(
            "{runtime_name} discovery stopped unexpectedly. Scan again to retry."
        )),
        candidates: Vec::new(),
    }
}

fn discover_native_resident_outcome_with<H, O>(
    discover_hermes_runtime: H,
    discover_openclaw_runtime: O,
) -> NativeResidentDiscoveryOutcome
where
    H: FnOnce() -> NativeRuntimeDiscoveryOutcome + Send,
    O: FnOnce() -> NativeRuntimeDiscoveryOutcome + Send,
{
    let runtimes = thread::scope(|scope| {
        let hermes = scope.spawn(discover_hermes_runtime);
        let openclaw = scope.spawn(discover_openclaw_runtime);

        // Join in the product's stable display order, not completion order.
        let hermes = match hermes.join() {
            Ok(outcome) => outcome,
            Err(_) => discovery_panic_outcome(NativeRuntimeKind::Hermes, "Hermes"),
        };
        let openclaw = match openclaw.join() {
            Ok(outcome) => outcome,
            Err(_) => discovery_panic_outcome(NativeRuntimeKind::Openclaw, "OpenClaw"),
        };

        vec![hermes, openclaw]
    });

    NativeResidentDiscoveryOutcome { runtimes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };

    #[cfg(unix)]
    #[test]
    fn bounded_native_probe_timeout_closes_owned_descendants_before_reaping() {
        let directory = tempfile::tempdir().expect("fixture");
        let probe = executable_fixture(directory.path(), "hermes");
        let pid_file = directory.path().join("child.pid");
        // Both leader and descendant ignore TERM, exercising escalation while
        // the unreaped leader still reserves the process-group identifier.
        std::fs::write(&probe, format!("#!/bin/sh\ntrap '' TERM\n/bin/sh -c 'trap \"\" TERM; exec /bin/sleep 30' &\nprintf '%s' \"$!\" > '{}'\nwait\n", pid_file.display())).expect("script");
        let started = Instant::now();
        let result = run_bounded_with_path(&probe, &[], Duration::from_millis(200), None);
        assert!(result.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(3));
        let pid: u32 = std::fs::read_to_string(pid_file)
            .expect("descendant launched")
            .parse()
            .expect("pid");
        // Adopted zombies may briefly retain a PID, so distinguish a zombie
        // from a running descendant using body-free process status only.
        let status = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .expect("status");
        let state = String::from_utf8_lossy(&status.stdout);
        assert!(
            state.trim().is_empty() || state.trim().starts_with('Z'),
            "descendant still running: {state}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn picked_hermes_version_uses_only_fixed_arguments_and_filters_failure_output() {
        let directory = tempfile::tempdir().expect("fixture");
        let probe = executable_fixture(directory.path(), "hermes");
        std::fs::write(&probe, "#!/bin/sh\n[ \"$#\" = 1 ] && [ \"$1\" = --version ] || exit 3\nprintf 'Hermes Agent v0.17.0\\n'\n").expect("script");
        assert_eq!(
            validate_hermes_version(&probe).expect("version"),
            "Hermes Agent v0.17.0"
        );
        std::fs::write(
            &probe,
            "#!/bin/sh\nprintf 'private-failure-detail' >&2\nexit 1\n",
        )
        .expect("failure");
        let error = validate_hermes_version(&probe).unwrap_err();
        assert!(!error.contains("private-failure-detail"));
        std::fs::write(&probe, "#!/bin/sh\nprintf 'Different tool v1.0\\n'\n").expect("other tool");
        assert!(validate_hermes_version(&probe).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn bounded_native_probe_caps_captured_output_without_pipe_deadlock() {
        let directory = tempfile::tempdir().expect("fixture");
        let probe = executable_fixture(directory.path(), "hermes");
        std::fs::write(&probe, "#!/bin/sh\n/usr/bin/head -c 2200000 /dev/zero\n").expect("script");
        let output = run_bounded_with_path(&probe, &[], Duration::from_secs(2), None)
            .expect("bounded capture");
        assert!(output.status.success());
        assert_eq!(output.stdout.len(), MAX_CAPTURE_BYTES);
    }

    #[cfg(unix)]
    fn executable_fixture(directory: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = directory.join(name);
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write executable fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("mark fixture executable");
        path.canonicalize().expect("canonical executable fixture")
    }

    #[cfg(unix)]
    #[test]
    fn bounded_native_probe_uses_the_resolved_login_shell_path_for_script_interpreters() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = tempfile::tempdir().expect("tempdir");
        let interpreter = fixture.path().join("fixture-node");
        std::fs::write(&interpreter, "#!/bin/sh\nprintf 'interpreter-ready'\n")
            .expect("write interpreter fixture");
        std::fs::set_permissions(&interpreter, std::fs::Permissions::from_mode(0o700))
            .expect("mark interpreter executable");

        let probe = fixture.path().join("openclaw");
        std::fs::write(&probe, "#!/usr/bin/env fixture-node\n")
            .expect("write script-backed probe fixture");
        std::fs::set_permissions(&probe, std::fs::Permissions::from_mode(0o700))
            .expect("mark probe executable");

        let child_path = format!("{}:/usr/bin:/bin", fixture.path().display());
        let output = run_bounded_with_path(&probe, &[], Duration::from_secs(1), Some(&child_path))
            .expect("probe runs");

        assert!(output.status.success());
        assert_eq!(output_text(&output), "interpreter-ready");
    }

    #[test]
    fn parses_hermes_profile_table_without_treating_headers_as_profiles() {
        let rows = parse_hermes_profile_names(
            "\n Profile Model Gateway\n ───── ───── ─────\n ◆default gpt-5.6-sol stopped\n  fable gpt-5.5 stopped\n",
        );
        assert_eq!(
            rows,
            vec![
                ("default".to_string(), Some("gpt-5.6-sol".to_string())),
                ("fable".to_string(), Some("gpt-5.5".to_string()))
            ]
        );
    }

    #[test]
    fn parses_canonical_hermes_profile_details() {
        let details = parse_hermes_profile_details(
            "Profile: fable\nPath: /tmp/hermes/profiles/fable\nModel: gpt-5.5 (openai-codex)\n",
        );
        assert_eq!(
            details.path,
            Some(PathBuf::from("/tmp/hermes/profiles/fable"))
        );
        assert_eq!(details.model.as_deref(), Some("gpt-5.5 (openai-codex)"));
    }

    #[test]
    fn binding_round_trip_contains_references_not_secret_values() {
        let binding = RuntimeBinding::Openclaw {
            schema_version: 1,
            agent_id: "luca".into(),
            executable_path: PathBuf::from("/usr/local/bin/openclaw"),
            runtime_version: "1.0.0".into(),
            gateway_identity: "gateway:abc".into(),
            gateway_url_ref: SecretRef {
                provider: SecretRefProvider::NativeStore,
                locator: "openclaw:gateway:url".into(),
                identity_hash: Some("gateway:abc".into()),
            },
            gateway_token_file_ref: Some(SecretRef {
                provider: SecretRefProvider::ProtectedFile,
                locator: "openclaw:gateway:token-file".into(),
                identity_hash: None,
            }),
            gateway_password_file_ref: None,
            open_claw_profile: None,
            state_directory: None,
            default_workspace: Some(PathBuf::from("/tmp/luca")),
        };
        let json = serde_json::to_string(&binding).expect("serialize");
        assert!(!json.contains("secret-token-value"));
        let decoded: RuntimeBinding = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, binding);
    }

    #[test]
    fn gateway_identity_is_stable_and_target_specific() {
        assert_eq!(
            nonsecret_identity("ws://127.0.0.1:18789"),
            nonsecret_identity("ws://127.0.0.1:18789")
        );
        assert_ne!(
            nonsecret_identity("ws://127.0.0.1:18789"),
            nonsecret_identity("wss://gateway.example.test")
        );
    }

    #[test]
    fn semantic_identity_survives_binding_refresh_while_fingerprint_changes() {
        let original = RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".into(),
            hermes_home: PathBuf::from("/tmp/hermes/default"),
            executable_path: PathBuf::from("/usr/local/bin/hermes"),
            runtime_version: "1.0.0".into(),
            default_workspace: None,
        };
        let refreshed = RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".into(),
            hermes_home: PathBuf::from("/tmp/hermes/default"),
            runtime_version: "1.1.0".into(),
            executable_path: PathBuf::from("/opt/homebrew/bin/hermes"),
            default_workspace: None,
        };
        assert_eq!(
            native_runtime_semantic_key(&original),
            native_runtime_semantic_key(&refreshed)
        );
        assert_ne!(
            native_runtime_binding_fingerprint(&original),
            native_runtime_binding_fingerprint(&refreshed)
        );
    }

    #[test]
    fn structured_outcomes_preserve_absent_and_failed_runtime_states() {
        let outcome = NativeResidentDiscoveryOutcome {
            runtimes: vec![
                NativeRuntimeDiscoveryOutcome {
                    native_type: NativeRuntimeKind::Hermes,
                    status: NativeDiscoveryStatus::Absent,
                    message: Some("Hermes is not installed.".into()),
                    candidates: Vec::new(),
                },
                NativeRuntimeDiscoveryOutcome {
                    native_type: NativeRuntimeKind::Openclaw,
                    status: NativeDiscoveryStatus::Failed,
                    message: Some("OpenClaw could not be queried.".into()),
                    candidates: Vec::new(),
                },
            ],
        };
        let json = serde_json::to_value(&outcome).expect("outcome serializes");
        assert_eq!(json["runtimes"][0]["status"], "absent");
        assert_eq!(json["runtimes"][1]["status"], "failed");
    }

    #[test]
    fn native_runtime_discovery_runs_in_parallel_and_keeps_product_order() {
        let started = Arc::new(AtomicUsize::new(0));
        let hermes_observed_peer = Arc::new(AtomicBool::new(false));
        let openclaw_observed_peer = Arc::new(AtomicBool::new(false));

        let probe = |native_type: NativeRuntimeKind,
                     runtime_name: &'static str,
                     observed_peer: Arc<AtomicBool>,
                     started: Arc<AtomicUsize>| {
            move || {
                started.fetch_add(1, Ordering::SeqCst);
                let deadline = Instant::now() + Duration::from_millis(500);
                while started.load(Ordering::SeqCst) < 2 && Instant::now() < deadline {
                    thread::yield_now();
                }
                observed_peer.store(started.load(Ordering::SeqCst) == 2, Ordering::SeqCst);
                NativeRuntimeDiscoveryOutcome {
                    native_type,
                    status: NativeDiscoveryStatus::Available,
                    message: Some(runtime_name.into()),
                    candidates: Vec::new(),
                }
            }
        };

        let outcome = discover_native_resident_outcome_with(
            probe(
                NativeRuntimeKind::Hermes,
                "Hermes",
                Arc::clone(&hermes_observed_peer),
                Arc::clone(&started),
            ),
            probe(
                NativeRuntimeKind::Openclaw,
                "OpenClaw",
                Arc::clone(&openclaw_observed_peer),
                Arc::clone(&started),
            ),
        );

        assert!(hermes_observed_peer.load(Ordering::SeqCst));
        assert!(openclaw_observed_peer.load(Ordering::SeqCst));
        assert_eq!(outcome.runtimes[0].native_type, NativeRuntimeKind::Hermes);
        assert_eq!(outcome.runtimes[1].native_type, NativeRuntimeKind::Openclaw);
    }

    #[test]
    fn one_runtime_discovery_panic_does_not_hide_the_other_runtime() {
        let outcome = discover_native_resident_outcome_with(
            || panic!("Hermes fixture panic"),
            || NativeRuntimeDiscoveryOutcome {
                native_type: NativeRuntimeKind::Openclaw,
                status: NativeDiscoveryStatus::Available,
                message: None,
                candidates: Vec::new(),
            },
        );

        assert_eq!(outcome.runtimes.len(), 2);
        assert_eq!(outcome.runtimes[0].native_type, NativeRuntimeKind::Hermes);
        assert_eq!(outcome.runtimes[0].status, NativeDiscoveryStatus::Failed);
        assert_eq!(outcome.runtimes[1].native_type, NativeRuntimeKind::Openclaw);
        assert_eq!(outcome.runtimes[1].status, NativeDiscoveryStatus::Available);
    }

    #[test]
    fn configured_gateway_identity_is_stable_when_rpc_goes_offline() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("openclaw.json");
        std::fs::write(&config_path, "{}").expect("config fixture");
        let status = |online| OpenclawGatewayStatus {
            gateway: OpenclawGatewayTarget {
                bind_host: Some("127.0.0.1".into()),
                port: Some(18789),
            },
            rpc: OpenclawRpcStatus {
                ok: online,
                error: (!online).then(|| "connection refused".into()),
            },
            config: OpenclawGatewayConfigStatus {
                daemon: OpenclawConfigFile {
                    path: Some(config_path.clone()),
                    exists: true,
                    valid: true,
                },
            },
            ..OpenclawGatewayStatus::default()
        };
        let online = configured_gateway_locator(&status(true)).expect("online locator");
        let offline = configured_gateway_locator(&status(false)).expect("offline locator");
        assert_eq!(nonsecret_identity(&online), nonsecret_identity(&offline));
    }

    #[test]
    fn identical_hermes_profile_names_in_different_homes_are_distinct() {
        let binding = |home: &str| RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".into(),
            hermes_home: PathBuf::from(home),
            executable_path: PathBuf::from("/usr/local/bin/hermes"),
            runtime_version: "1.0.0".into(),
            default_workspace: None,
        };
        assert_ne!(
            native_runtime_semantic_key(&binding("/tmp/hermes-a")),
            native_runtime_semantic_key(&binding("/tmp/hermes-b"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn hermes_resolution_preserves_exact_profile_home_and_workspace() {
        let fixture = tempfile::tempdir().expect("tempdir");
        let profile_home = fixture.path().join("profiles/default");
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir_all(&profile_home).expect("profile home");
        std::fs::create_dir_all(&workspace).expect("workspace");
        let executable = executable_fixture(fixture.path(), "hermes");
        let binding = RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".into(),
            hermes_home: profile_home.canonicalize().expect("canonical profile"),
            executable_path: executable.clone(),
            runtime_version: "fixture".into(),
            default_workspace: Some(workspace.clone()),
        };

        let resolved = resolve_native_runtime_binding(&binding).expect("resolved Hermes binding");
        assert_eq!(resolved.command, executable);
        assert_eq!(resolved.args, ["acp"]);
        assert_eq!(
            resolved.environment.get("HERMES_HOME"),
            Some(
                &profile_home
                    .canonicalize()
                    .expect("canonical profile")
                    .display()
                    .to_string()
            )
        );
        assert_eq!(
            resolved.default_workspace,
            Some(workspace.canonicalize().expect("canonical workspace"))
        );
        assert!(resolved.harness_environment.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn missing_native_workspace_fails_with_an_honest_error() {
        let fixture = tempfile::tempdir().expect("tempdir");
        let profile_home = fixture.path().join("profiles/default");
        std::fs::create_dir_all(&profile_home).expect("profile home");
        let executable = executable_fixture(fixture.path(), "hermes");
        let binding = RuntimeBinding::Hermes {
            schema_version: 1,
            profile_name: "default".into(),
            hermes_home: profile_home.canonicalize().expect("canonical profile"),
            executable_path: executable,
            runtime_version: "fixture".into(),
            default_workspace: Some(fixture.path().join("missing")),
        };

        let error = resolve_native_runtime_binding(&binding).expect_err("missing workspace");
        assert!(error.contains("workspace"));
        assert!(error.contains("unavailable"));
    }

    #[cfg(unix)]
    #[test]
    fn scoped_hermes_revalidation_rejects_forged_executable_before_running_it() {
        let fixture = tempfile::tempdir().unwrap();
        let home = fixture.path().canonicalize().unwrap();
        let trusted = executable_fixture(&home, "trusted-hermes");
        let forged = executable_fixture(&home, "forged-hermes");
        let marker = home.join("must-not-run");
        std::fs::write(
            &forged,
            format!("#!/bin/sh\nprintf forbidden > '{}'\n", marker.display()),
        )
        .unwrap();
        let binding = build_hermes_runtime_binding(
            "default".into(),
            home.clone(),
            forged,
            "0.17.0".into(),
            None,
        );
        let error = revalidate_hermes_at_trusted_executable(&binding, &trusted, None).unwrap_err();
        assert!(error.contains("trusted discovery"));
        assert!(!marker.exists());
    }

    #[cfg(unix)]
    #[test]
    fn scoped_hermes_revalidation_requires_native_confirmation_of_the_exact_custom_home() {
        let fixture = tempfile::tempdir().unwrap();
        let base = fixture.path().canonicalize().unwrap();
        let root = base.join("reviewed");
        let home = root.join("profiles/helper");
        std::fs::create_dir_all(&home).unwrap();
        let trusted = executable_fixture(&base, "trusted-hermes");
        std::fs::write(&trusted, "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '0.17.0\\n'; else printf 'Path: %s/profiles/%s\\n' \"$HERMES_HOME\" \"$3\"; fi\n").unwrap();
        let binding = build_hermes_runtime_binding(
            "helper".into(),
            home.clone(),
            trusted.clone(),
            "0.17.0".into(),
            None,
        );
        let verified = revalidate_hermes_at_trusted_executable(&binding, &trusted, None).unwrap();
        assert_eq!(verified, binding);
        assert_eq!(hermes_profile_root(&home).unwrap(), root);
        std::fs::write(
            &trusted,
            "#!/bin/sh\nprintf 'Path: /unrelated/profiles/helper\\n'\n",
        )
        .unwrap();
        assert!(revalidate_hermes_at_trusted_executable(&binding, &trusted, None).is_err());
    }

    #[cfg(unix)]
    fn exact_profile_fixture() -> (tempfile::TempDir, PathBuf, RuntimeBinding) {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().canonicalize().unwrap();
        let home = root.join("profiles/helper");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(root.join("version"), "0.17.0\n").unwrap();
        let executable = executable_fixture(&root, "trusted-hermes");
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HERMES_HOME/commands.log\"\ncase \"$*\" in\n  'profile show helper') printf 'Path: %s/profiles/helper\\n' \"$HERMES_HOME\" ;;\n  --version) /bin/cat \"$HERMES_HOME/version\" ;;\n  *) exit 64 ;;\nesac\n",
        ).unwrap();
        let binding = build_hermes_runtime_binding(
            "helper".into(),
            home,
            executable.clone(),
            "0.17.0".into(),
            None,
        );
        (fixture, executable, binding)
    }

    #[cfg(unix)]
    #[test]
    fn matching_hermes_binding_revalidates_only_exact_profile_commands_without_catalog_queries() {
        let (fixture, executable, binding) = exact_profile_fixture();
        for _ in 0..3 {
            let verified =
                revalidate_native_runtime_binding_with(&binding, Some(&executable), None, || {
                    panic!("exact revalidation must not query any catalog or OpenClaw")
                })
                .unwrap();
            assert_eq!(verified, binding);
        }
        let commands = std::fs::read_to_string(fixture.path().join("commands.log")).unwrap();
        assert_eq!(commands, "profile show helper\n--version\n".repeat(3));
        println!("exact Hermes command log: {commands}");
        // General validation may refresh mutable version metadata; the import
        // review separately rejects a change to its approved full fingerprint.
        std::fs::write(fixture.path().join("version"), "0.18.0\n").unwrap();
        let upgraded =
            revalidate_native_runtime_binding_with(&binding, Some(&executable), None, || {
                panic!("no catalog needed")
            })
            .unwrap();
        assert_eq!(
            native_runtime_semantic_key(&upgraded),
            native_runtime_semantic_key(&binding)
        );
        assert_ne!(
            native_runtime_binding_fingerprint(&upgraded),
            native_runtime_binding_fingerprint(&binding)
        );
    }

    #[cfg(unix)]
    #[test]
    fn changed_hermes_executable_keeps_catalog_upgrade_and_exact_identity_rules() {
        let (fixture, old_executable, binding) = exact_profile_fixture();
        let trusted = executable_fixture(fixture.path(), "upgraded-hermes");
        let mut upgraded = binding.clone();
        if let RuntimeBinding::Hermes {
            executable_path,
            runtime_version,
            ..
        } = &mut upgraded
        {
            *executable_path = trusted.clone();
            *runtime_version = "0.18.0".into();
        }
        let candidate = |binding: RuntimeBinding| DiscoveredResidentCandidate {
            native_type: NativeRuntimeKind::Hermes,
            native_id: "helper".into(),
            semantic_id: native_runtime_semantic_key(&binding),
            binding_fingerprint: native_runtime_binding_fingerprint(&binding),
            display_name: "helper".into(),
            canonical_location: None,
            workspace: None,
            model_summary: None,
            runtime_version: None,
            readiness: ResidentReadiness::Discovered {
                message: "fixture".into(),
            },
            warnings: Vec::new(),
            binding_preview: binding,
        };
        let catalog_calls = AtomicUsize::new(0);
        let verified =
            revalidate_native_runtime_binding_with(&binding, Some(&trusted), None, || {
                catalog_calls.fetch_add(1, Ordering::SeqCst);
                vec![candidate(upgraded.clone())]
            })
            .unwrap();
        assert_eq!(catalog_calls.load(Ordering::SeqCst), 1);
        assert_eq!(verified, upgraded);
        let mut wrong_root = upgraded.clone();
        if let RuntimeBinding::Hermes { hermes_home, .. } = &mut wrong_root {
            *hermes_home = fixture.path().join("another-root/profiles/helper");
        }
        assert!(
            revalidate_native_runtime_binding_with(&binding, Some(&trusted), None, || vec![
                candidate(wrong_root)
            ],)
            .is_err()
        );
        assert!(!fixture.path().join("commands.log").exists());
        assert_ne!(old_executable, trusted);
    }

    #[cfg(unix)]
    #[test]
    fn exact_hermes_failures_never_fall_back_to_other_profiles_or_runtimes() {
        for failure in ["profile", "version", "removed-home", "symlink"] {
            let (fixture, executable, binding) = exact_profile_fixture();
            let root = fixture.path().canonicalize().unwrap();
            if failure == "symlink" {
                std::fs::rename(&executable, root.join("moved-hermes")).unwrap();
                std::os::unix::fs::symlink(root.join("moved-hermes"), &executable).unwrap();
            } else {
                let body = match failure {
                    "profile" => "exit 1\n",
                    "version" => "if [ \"$1\" = --version ]; then exit 1; fi\nprintf 'Path: %s/profiles/helper\\n' \"$HERMES_HOME\"\n",
                    "removed-home" => "if [ \"$1\" = --version ]; then /bin/rmdir \"$HERMES_HOME/profiles/helper\"; printf '0.17.0\\n'; else printf 'Path: %s/profiles/helper\\n' \"$HERMES_HOME\"; fi\n",
                    _ => unreachable!(),
                };
                std::fs::write(
                    &executable,
                    format!(
                        "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HERMES_HOME/commands.log\"\n{body}"
                    ),
                )
                .unwrap();
            }
            assert!(
                revalidate_native_runtime_binding_with(
                    &binding,
                    Some(&executable),
                    None,
                    || panic!("a failed exact check must fail closed"),
                )
                .is_err(),
                "{failure}"
            );
            let commands = std::fs::read_to_string(root.join("commands.log")).unwrap_or_default();
            assert_eq!(
                commands,
                match failure {
                    "symlink" => "",
                    "profile" => "profile show helper\n",
                    _ => "profile show helper\n--version\n",
                }
            );
        }
    }
}

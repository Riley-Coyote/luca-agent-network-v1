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
    time::{Duration, Instant},
};

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
        RuntimeBinding::Openclaw {
            schema_version,
            agent_id,
            executable_path,
            gateway_identity,
            gateway_url_ref,
            default_workspace,
            ..
        } => {
            if *schema_version != 1 || agent_id.trim().is_empty() {
                return Err("unsupported or incomplete OpenClaw identity binding".into());
            }
            if gateway_identity.trim().is_empty()
                || gateway_url_ref.locator != "openclaw:gateway:url"
                || gateway_url_ref.identity_hash.as_deref() != Some(gateway_identity.as_str())
            {
                return Err("OpenClaw Gateway identity reference is invalid".into());
            }
            let command = checked_executable(executable_path)?;
            let default_workspace = default_workspace
                .as_deref()
                .map(checked_workspace)
                .transpose()?;
            Ok(ResolvedNativeRuntime {
                command,
                args: vec!["acp".into()],
                environment: BTreeMap::new(),
                harness_environment: BTreeMap::from([(
                    "LUCA_OPENCLAW_AGENT_ID".into(),
                    agent_id.clone(),
                )]),
                default_workspace,
            })
        }
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
    let verified = discover_native_resident_candidates()
        .into_iter()
        .find(|candidate| {
            native_runtime_semantic_key(&candidate.binding_preview)
                == native_runtime_semantic_key(binding)
        })
        .map(|candidate| candidate.binding_preview)
        .ok_or_else(|| "native identity binding no longer matches current discovery".to_string())?;
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
    let mut stdout_file = tempfile::tempfile().map_err(|e| format!("capture stdout: {e}"))?;
    let mut stderr_file = tempfile::tempfile().map_err(|e| format!("capture stderr: {e}"))?;
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            stdout_file
                .try_clone()
                .map_err(|e| format!("clone stdout capture: {e}"))?,
        ))
        .stderr(Stdio::from(
            stderr_file
                .try_clone()
                .map_err(|e| format!("clone stderr capture: {e}"))?,
        ))
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
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{} timed out after {} ms",
                    binary.display(),
                    timeout.as_millis()
                ));
            }
            Err(error) => return Err(format!("wait for {}: {error}", binary.display())),
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

fn canonical_executable(command: &str) -> Option<PathBuf> {
    super::resolve_command(command).and_then(|path| path.canonicalize().ok().or(Some(path)))
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
    let Some(executable_path) = canonical_executable("hermes") else {
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
    NativeResidentDiscoveryOutcome {
        runtimes: vec![discover_hermes(), discover_openclaw()],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn executable_fixture(directory: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = directory.join(name);
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write executable fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("mark fixture executable");
        path.canonicalize().expect("canonical executable fixture")
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
    fn openclaw_resolution_preserves_exact_agent_and_workspace_without_secrets() {
        let fixture = tempfile::tempdir().expect("tempdir");
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir_all(&workspace).expect("workspace");
        let executable = executable_fixture(fixture.path(), "openclaw");
        let gateway_identity = "gateway:fixture".to_string();
        let binding = RuntimeBinding::Openclaw {
            schema_version: 1,
            agent_id: "main".into(),
            executable_path: executable.clone(),
            runtime_version: "fixture".into(),
            gateway_identity: gateway_identity.clone(),
            gateway_url_ref: SecretRef {
                provider: SecretRefProvider::NativeStore,
                locator: "openclaw:gateway:url".into(),
                identity_hash: Some(gateway_identity),
            },
            gateway_token_file_ref: None,
            gateway_password_file_ref: None,
            open_claw_profile: None,
            state_directory: None,
            default_workspace: Some(workspace.clone()),
        };

        let resolved = resolve_native_runtime_binding(&binding).expect("resolved OpenClaw binding");
        assert_eq!(resolved.command, executable);
        assert_eq!(resolved.args, ["acp"]);
        assert!(resolved.environment.is_empty());
        assert_eq!(
            resolved.harness_environment.get("LUCA_OPENCLAW_AGENT_ID"),
            Some(&"main".to_string())
        );
        assert_eq!(
            resolved.default_workspace,
            Some(workspace.canonicalize().expect("canonical workspace"))
        );
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
}

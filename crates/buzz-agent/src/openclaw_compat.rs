//! ACP compatibility adapter for an imported OpenClaw resident.
//!
//! OpenClaw's Gateway-backed ACP bridge deliberately rejects per-session MCP
//! servers. Luca still needs to project its conversation capability without
//! editing OpenClaw's native configuration, so this adapter runs the native
//! embedded agent against a mode-0600, turn-scoped config overlay. The overlay
//! is removed when the turn ends and the repository capability is never placed
//! in the OpenClaw process environment or command line.

use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    time::Duration,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncBufRead, AsyncRead, AsyncReadExt, BufReader},
    sync::{mpsc, watch, Mutex},
    task::JoinSet,
};

use crate::{
    types::{ContentBlock, McpServerStdio},
    wire::{self, Inbound, SessionCancelParams, SessionNewParams, SessionPromptParams, WireMsg},
};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 256 * 1024;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_ISOLATED_CONFIG_BYTES: u64 = 2 * 1024 * 1024;
const CONTROL_DISPATCH_TIMEOUT: Duration = Duration::from_millis(500);
const PROCESS_STOP_TIMEOUT: Duration = Duration::from_secs(1);
const ADAPTER_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const REPOSITORY_SERVER_NAME: &str = "luca-repositories";
const COMMUNICATIONS_SERVER_NAME: &str = "luca-communications";
const OPENCLAW_BOOTSTRAP_ENV_KEYS: [&str; 6] = [
    "LUCA_OPENCLAW_AGENT_ID",
    "LUCA_OPENCLAW_COMMAND",
    "LUCA_OPENCLAW_CONFIG_PATH",
    "LUCA_OPENCLAW_STATE_DIR",
    "LUCA_NATIVE_STATE_ISOLATION_ROOT",
    "LUCA_OPENCLAW_ISOLATED_CONFIG_PATH",
];
const REPOSITORY_ENV_KEYS: [&str; 4] = [
    "LUCA_REPOSITORY_MODE",
    "LUCA_REPOSITORY_ENDPOINT",
    "LUCA_REPOSITORY_CAPABILITY",
    "LUCA_REPOSITORY_CONVERSATION_ID",
];
const COMMUNICATIONS_ENV_KEYS: [&str; 8] = [
    "LUCA_COMMUNICATIONS_MODE",
    "LUCA_COMMUNICATIONS_ENDPOINT",
    "LUCA_COMMUNICATIONS_CAPABILITY",
    "LUCA_COMMUNICATIONS_CAPABILITY_GENERATION",
    "LUCA_COMMUNICATIONS_CONVERSATION_ID",
    "LUCA_COMMUNICATIONS_TURN_ID",
    "LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID",
    "LUCA_COMMUNICATIONS_CANCELLATION_EPOCH",
];
const ARTIFACT_ENV_KEYS: [&str; 8] = [
    "LUCA_ARTIFACT_MODE",
    "LUCA_ARTIFACT_ENDPOINT",
    "LUCA_ARTIFACT_CAPABILITY",
    "LUCA_ARTIFACT_CAPABILITY_GENERATION",
    "LUCA_ARTIFACT_CONVERSATION_ID",
    "LUCA_ARTIFACT_TURN_ID",
    "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID",
    "LUCA_ARTIFACT_CANCELLATION_EPOCH",
];

#[derive(Clone)]
struct CompatConfig {
    openclaw_command: PathBuf,
    native_config_path: PathBuf,
    native_state_dir: PathBuf,
    isolation: Option<NativeStateIsolation>,
    agent_id: String,
    temporary_root: PathBuf,
}

#[derive(Clone)]
struct NativeStateIsolation {
    root_dir: PathBuf,
    config_path: PathBuf,
    home_dir: PathBuf,
    state_dir: PathBuf,
    agent_dir: PathBuf,
    session_store: PathBuf,
}

struct CompatSession {
    cwd: PathBuf,
    mcp_servers: Vec<McpServerStdio>,
    system_prompt: Option<String>,
    cancel_tx: watch::Sender<bool>,
    busy: bool,
}

struct CompatApp {
    config: CompatConfig,
    sessions: Mutex<HashMap<String, CompatSession>>,
}

struct CompatTurn {
    session_id: String,
    cwd: PathBuf,
    mcp_servers: Vec<McpServerStdio>,
    prompt: String,
    cancel_rx: watch::Receiver<bool>,
}

struct TurnProcess {
    child: tokio::process::Child,
}

impl TurnProcess {
    fn kill(&mut self) {
        // Use only the still-owned, unreaped leader. Never retain a PGID and
        // signal it after wait() has released the PID for reuse.
        if let Some(pid) = self.child.id() {
            #[cfg(unix)]
            {
                use nix::{sys::signal, unistd::Pid};
                let _ = signal::killpg(Pid::from_raw(pid as i32), signal::Signal::SIGKILL);
            }
            #[cfg(not(unix))]
            let _ = pid;
            let _ = self.child.start_kill();
        }
    }

    async fn stop(&mut self) {
        self.kill();
        let _ = tokio::time::timeout(PROCESS_STOP_TIMEOUT, self.child.wait()).await;
    }
}

impl Drop for TurnProcess {
    fn drop(&mut self) {
        // Also covers aborted prompt tasks and adapter/runtime teardown.
        self.kill();
        let _ = self.child.try_wait();
    }
}

struct TurnWorkspace {
    directory: PathBuf,
    overlay_path: PathBuf,
}

impl TurnWorkspace {
    fn create(config: &CompatConfig, servers: &[McpServerStdio]) -> Result<Self, String> {
        if let Some(isolation) = &config.isolation {
            validate_isolation_directory(&isolation.home_dir, &isolation.root_dir)?;
            validate_isolation_directory(&isolation.state_dir, &isolation.root_dir)?;
            validate_isolation_directory(&isolation.agent_dir, &isolation.state_dir)?;
            validate_isolation_file_target(&isolation.session_store, &isolation.state_dir)?;
            validate_isolated_fixture_config(
                &isolation.config_path,
                &config.agent_id,
                &isolation.agent_dir,
            )?;
        }
        let directory = config.temporary_root.join(random_token()?);
        fs::create_dir(&directory).map_err(|_| "turn workspace unavailable".to_owned())?;
        secure_directory(&directory)?;
        let overlay_path = directory.join("openclaw.json");
        let workspace = Self {
            directory,
            overlay_path,
        };
        let source_config_path = config
            .isolation
            .as_ref()
            .map(|isolation| isolation.config_path.as_path())
            .unwrap_or(&config.native_config_path);
        write_overlay(
            &workspace.overlay_path,
            source_config_path,
            config.isolation.as_ref(),
            servers,
        )?;
        Ok(workspace)
    }
}

impl Drop for TurnWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

impl Drop for CompatApp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.config.temporary_root);
    }
}

pub(crate) fn run(agent_id: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(async_main(agent_id));
    runtime.shutdown_timeout(PROCESS_STOP_TIMEOUT);
    result
}

async fn async_main(agent_id: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let config = load_config(agent_id)?;
    let app = Arc::new(CompatApp {
        config,
        sessions: Mutex::new(HashMap::new()),
    });
    let (wire_tx, wire_rx) = mpsc::channel::<WireMsg>(64);
    let mut writer = tokio::spawn(wire::writer_task(wire_rx));
    let result = serve(app, BufReader::new(tokio::io::stdin()), &wire_tx).await;
    drop(wire_tx);
    if tokio::time::timeout(ADAPTER_SHUTDOWN_TIMEOUT, &mut writer)
        .await
        .is_err()
    {
        writer.abort();
    }
    result.map_err(Into::into)
}

async fn serve<R: AsyncBufRead + Unpin>(
    app: Arc<CompatApp>,
    mut input: R,
    wire_tx: &wire::WireSender,
) -> std::io::Result<()> {
    let mut turns = JoinSet::new();
    let result = loop {
        let read = tokio::select! {
            biased;
            _ = wire_tx.closed() => break Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "OpenClaw adapter output closed",
            )),
            read = wire::read_bounded_line(&mut input, MAX_FRAME_BYTES) => read,
        };
        let line = match read {
            Ok(Some(line)) => line,
            Ok(None) => break Ok(()),
            Err(error) => break Err(error),
        };
        while turns.try_join_next().is_some() {}
        if line.trim().is_empty() {
            continue;
        }
        // Control replies must not strand the input loop behind output
        // backpressure. Fail the transport and cancel its turns if a reply
        // cannot be admitted, rather than dropping it and continuing healthy.
        let handled = async {
            match serde_json::from_str::<Value>(&line) {
                Ok(message) => dispatch(Arc::clone(&app), message, wire_tx, &mut turns).await,
                Err(_) => {
                    wire::send(
                        wire_tx,
                        wire::err(Value::Null, wire::PARSE_ERROR, "jsonrpc: parse failed"),
                    )
                    .await;
                }
            }
        };
        tokio::select! {
            biased;
            _ = wire_tx.closed() => break Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "OpenClaw adapter output closed",
            )),
            result = tokio::time::timeout(CONTROL_DISPATCH_TIMEOUT, handled) => {
                if result.is_err() {
                    break Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "OpenClaw adapter control output stalled",
                    ));
                }
            }
        }
    };
    // Every admitted prompt registers its cancellation receiver before it is
    // spawned, including prompts that have not been polled when stdin closes.
    for session in app.sessions.lock().await.values() {
        let _ = session.cancel_tx.send(true);
    }
    if tokio::time::timeout(ADAPTER_SHUTDOWN_TIMEOUT, async {
        while turns.join_next().await.is_some() {}
    })
    .await
    .is_err()
    {
        turns.abort_all();
        let _ = tokio::time::timeout(PROCESS_STOP_TIMEOUT, async {
            while turns.join_next().await.is_some() {}
        })
        .await;
    }
    result
}

fn load_config(agent_id: Option<&str>) -> Result<CompatConfig, String> {
    let openclaw_command = canonical_file_env("LUCA_OPENCLAW_COMMAND")?;
    let native_config_path = canonical_file_env("LUCA_OPENCLAW_CONFIG_PATH")?;
    let native_state_dir = canonical_directory_env("LUCA_OPENCLAW_STATE_DIR")?;
    if native_config_path.parent() != Some(native_state_dir.as_path()) {
        return Err("OpenClaw compatibility binding is invalid".into());
    }
    let agent_id = agent_id
        .filter(|value| valid_agent_id(value))
        .map(str::to_owned)
        .ok_or_else(|| "OpenClaw compatibility binding is invalid".to_owned())?;
    let isolation = resolve_native_state_isolation(
        &native_state_dir,
        &agent_id,
        std::env::var_os("LUCA_NATIVE_STATE_ISOLATION_ROOT").as_deref(),
        std::env::var_os("LUCA_OPENCLAW_ISOLATED_CONFIG_PATH").as_deref(),
    )?;
    let temporary_root = PathBuf::from("/tmp").join(format!("luca-oc-{}", random_token()?));
    fs::create_dir(&temporary_root)
        .map_err(|_| "OpenClaw compatibility workspace could not be created".to_owned())?;
    secure_directory(&temporary_root)?;
    Ok(CompatConfig {
        openclaw_command,
        native_config_path,
        native_state_dir,
        isolation,
        agent_id,
        temporary_root,
    })
}

fn resolve_native_state_isolation(
    native_state_dir: &Path,
    agent_id: &str,
    isolation_root: Option<&std::ffi::OsStr>,
    isolated_config_path: Option<&std::ffi::OsStr>,
) -> Result<Option<NativeStateIsolation>, String> {
    let (Some(isolation_root), Some(isolated_config_path)) = (isolation_root, isolated_config_path)
    else {
        return if isolation_root.is_none() && isolated_config_path.is_none() {
            Ok(None)
        } else {
            Err("OpenClaw compatibility isolation fixture is unavailable".into())
        };
    };
    if isolation_root.is_empty() {
        return Err("OpenClaw compatibility isolation is invalid".into());
    }
    let isolation_root = PathBuf::from(isolation_root);
    if !isolation_root.is_absolute()
        || isolation_root
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err("OpenClaw compatibility isolation is invalid".into());
    }
    let canonical_root = isolation_root
        .canonicalize()
        .map_err(|_| "OpenClaw compatibility isolation is unavailable".to_owned())?;
    if canonical_root != isolation_root
        || !canonical_root.is_dir()
        || broad_isolation_root(&canonical_root)
        || canonical_root.starts_with(native_state_dir)
        || native_state_dir.starts_with(&canonical_root)
    {
        return Err("OpenClaw compatibility isolation is invalid".into());
    }
    let isolated_config_path = PathBuf::from(isolated_config_path);
    if !isolated_config_path.is_absolute()
        || isolated_config_path
            .components()
            .any(|component| matches!(component, Component::CurDir | Component::ParentDir))
    {
        return Err("OpenClaw compatibility isolation fixture is invalid".into());
    }
    let canonical_config_path = isolated_config_path
        .canonicalize()
        .map_err(|_| "OpenClaw compatibility isolation fixture is unavailable".to_owned())?;
    if canonical_config_path != isolated_config_path
        || !canonical_config_path.is_file()
        || canonical_config_path == canonical_root
        || !canonical_config_path.starts_with(&canonical_root)
    {
        return Err("OpenClaw compatibility isolation fixture is invalid".into());
    }
    let runtime_root = canonical_root.join("openclaw");
    let agent_root = runtime_root.join(agent_id);
    let home_dir = agent_root.join("home");
    let state_dir = agent_root.join("state");
    let agents_dir = state_dir.join("agents");
    let selected_agent_root = agents_dir.join(agent_id);
    let agent_dir = selected_agent_root.join("agent");
    let sessions_dir = selected_agent_root.join("sessions");
    let session_store = sessions_dir.join("sessions.json");
    validate_isolated_fixture_config(&canonical_config_path, agent_id, &agent_dir)?;
    ensure_isolation_directory(&runtime_root)?;
    ensure_isolation_directory(&agent_root)?;
    ensure_isolation_directory(&home_dir)?;
    ensure_isolation_directory(&state_dir)?;
    ensure_isolation_directory(&agents_dir)?;
    ensure_isolation_directory(&selected_agent_root)?;
    ensure_isolation_directory(&agent_dir)?;
    ensure_isolation_directory(&sessions_dir)?;
    validate_isolation_file_target(&session_store, &state_dir)?;
    Ok(Some(NativeStateIsolation {
        root_dir: canonical_root,
        config_path: canonical_config_path,
        home_dir,
        state_dir,
        agent_dir,
        session_store,
    }))
}

fn broad_isolation_root(path: &Path) -> bool {
    if path.parent().is_none() {
        return true;
    }
    [std::env::temp_dir(), PathBuf::from("/tmp")]
        .into_iter()
        .filter_map(|candidate| candidate.canonicalize().ok())
        .any(|candidate| candidate == path)
}

fn validate_isolated_fixture_config(
    config_path: &Path,
    agent_id: &str,
    required_agent_dir: &Path,
) -> Result<(), String> {
    if config_path.canonicalize().ok().as_deref() != Some(config_path) {
        return Err("OpenClaw compatibility isolation fixture is invalid".into());
    }
    let metadata = fs::metadata(config_path)
        .map_err(|_| "OpenClaw compatibility isolation fixture is unavailable".to_owned())?;
    if metadata.len() > MAX_ISOLATED_CONFIG_BYTES {
        return Err("OpenClaw compatibility isolation fixture is invalid".into());
    }
    let bytes = fs::read(config_path)
        .map_err(|_| "OpenClaw compatibility isolation fixture is unavailable".to_owned())?;
    let config: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "OpenClaw compatibility isolation fixture is invalid".to_owned())?;
    if contains_include_directive(&config) {
        return Err("OpenClaw compatibility isolation fixture is invalid".into());
    }
    if let Some(entries) = config.pointer("/agents/list").and_then(Value::as_array) {
        for entry in entries {
            let selected = entry
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id.eq_ignore_ascii_case(agent_id));
            if !selected {
                continue;
            }
            let Some(configured_agent_dir) = entry.get("agentDir") else {
                continue;
            };
            if configured_agent_dir.as_str().map(Path::new) != Some(required_agent_dir) {
                return Err("OpenClaw compatibility isolation fixture is invalid".into());
            }
        }
    }
    Ok(())
}

fn contains_include_directive(value: &Value) -> bool {
    match value {
        Value::Object(object) => {
            object.contains_key("$include") || object.values().any(contains_include_directive)
        }
        Value::Array(values) => values.iter().any(contains_include_directive),
        _ => false,
    }
}

fn ensure_isolation_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("OpenClaw compatibility isolation is invalid".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|_| "OpenClaw compatibility isolation is unavailable".to_owned())?,
        Err(_) => return Err("OpenClaw compatibility isolation is unavailable".into()),
    }
    secure_directory(path)
}

fn validate_isolation_directory(path: &Path, allowed_root: &Path) -> Result<(), String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "OpenClaw compatibility isolation is unavailable".to_owned())?;
    if canonical != path || !canonical.is_dir() || !canonical.starts_with(allowed_root) {
        return Err("OpenClaw compatibility isolation is invalid".into());
    }
    Ok(())
}

fn validate_isolation_file_target(path: &Path, allowed_root: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "OpenClaw compatibility isolation is invalid".to_owned())?;
    validate_isolation_directory(parent, allowed_root)?;
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.file_type().is_file()
                && !metadata.file_type().is_symlink()
                && path.canonicalize().ok().as_deref() == Some(path) =>
        {
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("OpenClaw compatibility isolation is invalid".into()),
    }
}

fn canonical_file_env(key: &str) -> Result<PathBuf, String> {
    let path =
        PathBuf::from(std::env::var(key).map_err(|_| "OpenClaw compatibility binding is invalid")?);
    let canonical = path
        .canonicalize()
        .map_err(|_| "OpenClaw compatibility binding is invalid")?;
    if canonical != path || !canonical.is_file() {
        return Err("OpenClaw compatibility binding is invalid".into());
    }
    Ok(canonical)
}

fn canonical_directory_env(key: &str) -> Result<PathBuf, String> {
    let path =
        PathBuf::from(std::env::var(key).map_err(|_| "OpenClaw compatibility binding is invalid")?);
    let canonical = path
        .canonicalize()
        .map_err(|_| "OpenClaw compatibility binding is invalid")?;
    if canonical != path || !canonical.is_dir() {
        return Err("OpenClaw compatibility binding is invalid".into());
    }
    Ok(canonical)
}

fn valid_agent_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

async fn dispatch(
    app: Arc<CompatApp>,
    message: Value,
    wire_tx: &wire::WireSender,
    turns: &mut JoinSet<()>,
) {
    match wire::classify(&message) {
        Inbound::Request { id, method, params } => match method.as_str() {
            "initialize" => initialize(id, wire_tx).await,
            "session/new" => session_new(&app, id, params, wire_tx).await,
            "session/prompt" => match acquire_turn(&app, params).await {
                Ok(turn) => {
                    turns.spawn(session_prompt(app, id, turn, wire_tx.clone()));
                }
                Err(message) => reject(wire_tx, id, message).await,
            },
            "session/cancel" => {
                cancel_session(&app, params).await;
                wire::send(wire_tx, wire::ok(id, Value::Null)).await;
            }
            _ => {
                wire::send(
                    wire_tx,
                    wire::err(id, wire::METHOD_NOT_FOUND, "jsonrpc: method not found"),
                )
                .await;
            }
        },
        Inbound::Notification { method, params } if method == "session/cancel" => {
            cancel_session(&app, params).await;
        }
        Inbound::Invalid { id, code, message } => {
            wire::send(wire_tx, wire::err(id, code, &message)).await;
        }
        Inbound::Notification { .. } | Inbound::Ignored => {}
    }
}

async fn initialize(id: Value, wire_tx: &wire::WireSender) {
    wire::send(
        wire_tx,
        wire::ok(
            id,
            json!({
                "protocolVersion": 1,
                "agentCapabilities": {
                    "loadSession": false,
                    "promptCapabilities": {
                        "audio": false,
                        "embeddedContext": false,
                        "image": false
                    },
                    "mcpCapabilities": { "http": false, "sse": false }
                },
                "agentInfo": {
                    "name": "luca-openclaw-compat",
                    "title": "OpenClaw via Luca",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "authMethods": []
            }),
        ),
    )
    .await;
}

async fn session_new(app: &Arc<CompatApp>, id: Value, params: Value, wire_tx: &wire::WireSender) {
    let parsed = serde_json::from_value::<SessionNewParams>(params);
    let Ok(params) = parsed else {
        return reject(wire_tx, id, "session/new parameters are invalid").await;
    };
    let cwd = PathBuf::from(&params.cwd);
    if !cwd.is_absolute() || !cwd.is_dir() || validate_mcp_servers(&params.mcp_servers).is_err() {
        return reject(wire_tx, id, "session/new parameters are invalid").await;
    }
    let Ok(token) = random_token() else {
        return reject(wire_tx, id, "session/new could not allocate a session").await;
    };
    let session_id = format!("luca-openclaw-{token}");
    let (cancel_tx, _) = watch::channel(false);
    app.sessions.lock().await.insert(
        session_id.clone(),
        CompatSession {
            cwd,
            mcp_servers: params.mcp_servers,
            system_prompt: params.system_prompt,
            cancel_tx,
            busy: false,
        },
    );
    wire::send(wire_tx, wire::ok(id, json!({ "sessionId": session_id }))).await;
}

fn validate_mcp_servers(servers: &[McpServerStdio]) -> Result<(), String> {
    if servers.is_empty() {
        return Ok(());
    }
    if servers.len() > 3 {
        return Err("unsupported MCP projection".into());
    }
    let mut names = std::collections::BTreeSet::new();
    for server in servers {
        if !names.insert(server.name.as_str())
            || !server.args.is_empty()
            || !Path::new(&server.command).is_absolute()
        {
            return Err("unsupported MCP projection".into());
        }
        let env = server
            .env
            .iter()
            .map(|entry| (entry.name.as_str(), entry.value.as_str()))
            .collect::<BTreeMap<_, _>>();
        let valid = match server.name.as_str() {
            REPOSITORY_SERVER_NAME => {
                server.env.len() == REPOSITORY_ENV_KEYS.len()
                    && env.get("LUCA_REPOSITORY_MODE") == Some(&"1")
                    && env
                        .get("LUCA_REPOSITORY_ENDPOINT")
                        .is_some_and(|value| valid_broker_endpoint(value, "luca-rb-"))
                    && env
                        .get("LUCA_REPOSITORY_CAPABILITY")
                        .is_some_and(|value| is_sha256_ref(value))
                    && env
                        .get("LUCA_REPOSITORY_CONVERSATION_ID")
                        .is_some_and(|value| is_uuid(value))
            }
            name if valid_communications_server_name(name) => {
                server.env.len() == COMMUNICATIONS_ENV_KEYS.len()
                    && env.get("LUCA_COMMUNICATIONS_MODE") == Some(&"1")
                    && env
                        .get("LUCA_COMMUNICATIONS_ENDPOINT")
                        .is_some_and(|value| valid_broker_endpoint(value, "luca-cb-"))
                    && env
                        .get("LUCA_COMMUNICATIONS_CAPABILITY")
                        .is_some_and(|value| is_sha256_ref(value))
                    && env
                        .get("LUCA_COMMUNICATIONS_CAPABILITY_GENERATION")
                        .is_some_and(|value| is_safe_positive_u53(value))
                    && env
                        .get("LUCA_COMMUNICATIONS_CONVERSATION_ID")
                        .is_some_and(|value| is_uuid(value))
                    && env
                        .get("LUCA_COMMUNICATIONS_TURN_ID")
                        .is_some_and(|value| is_opaque_id(value))
                    && env
                        .get("LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID")
                        .is_some_and(|value| is_opaque_id(value))
                    && env
                        .get("LUCA_COMMUNICATIONS_CANCELLATION_EPOCH")
                        .is_some_and(|value| is_safe_positive_u53(value))
            }
            name if valid_artifact_server_name(name) => {
                server.env.len() == ARTIFACT_ENV_KEYS.len()
                    && env.get("LUCA_ARTIFACT_MODE") == Some(&"1")
                    && env
                        .get("LUCA_ARTIFACT_ENDPOINT")
                        .is_some_and(|value| valid_broker_endpoint(value, "luca-ab-"))
                    && env
                        .get("LUCA_ARTIFACT_CAPABILITY")
                        .is_some_and(|value| is_sha256_ref(value))
                    && env
                        .get("LUCA_ARTIFACT_CAPABILITY_GENERATION")
                        .is_some_and(|value| is_safe_positive_u53(value))
                    && env
                        .get("LUCA_ARTIFACT_CONVERSATION_ID")
                        .is_some_and(|value| is_opaque_id(value))
                    && env
                        .get("LUCA_ARTIFACT_TURN_ID")
                        .is_some_and(|value| is_opaque_id(value))
                    && env
                        .get("LUCA_ARTIFACT_DISPATCH_RECEIPT_ID")
                        .is_some_and(|value| is_opaque_id(value))
                    && env
                        .get("LUCA_ARTIFACT_CANCELLATION_EPOCH")
                        .is_some_and(|value| is_safe_positive_u53(value))
            }
            _ => false,
        };
        if !valid {
            return Err("unsupported MCP projection".into());
        }
    }
    Ok(())
}

fn valid_communications_server_name(name: &str) -> bool {
    if name == COMMUNICATIONS_SERVER_NAME {
        return true;
    }
    let Some(suffix) = name.strip_prefix("luca-communications-") else {
        return false;
    };
    suffix.len() == 12
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_artifact_server_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("luca-artifacts-") else {
        return false;
    };
    suffix.len() == 12
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_broker_endpoint(value: &str, directory_prefix: &str) -> bool {
    let path = Path::new(value);
    let Some(directory_name) = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(directory_nonce) = directory_name.strip_prefix(directory_prefix) else {
        return false;
    };
    let Some(endpoint) = file_name
        .strip_prefix('e')
        .and_then(|name| name.strip_suffix(".sock"))
    else {
        return false;
    };
    let Some((session_epoch, endpoint_nonce)) = endpoint.split_once('-') else {
        return false;
    };
    path.is_absolute()
        && value.len() <= 103
        && path.parent().and_then(Path::parent) == Some(Path::new("/tmp"))
        && directory_nonce.len() == 32
        && directory_nonce.bytes().all(is_lower_hex)
        && !session_epoch.is_empty()
        && session_epoch.len() <= 16
        && session_epoch.bytes().all(|byte| byte.is_ascii_digit())
        && endpoint_nonce.len() == 16
        && endpoint_nonce.bytes().all(is_lower_hex)
}

fn is_safe_positive_u53(value: &str) -> bool {
    value
        .parse::<u64>()
        .is_ok_and(|number| (1..=9_007_199_254_740_991).contains(&number))
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn is_lower_hex(byte: u8) -> bool {
    byte.is_ascii_digit() || matches!(byte, b'a'..=b'f')
}

fn is_sha256_ref(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

async fn acquire_turn(app: &CompatApp, params: Value) -> Result<CompatTurn, &'static str> {
    let params = serde_json::from_value::<SessionPromptParams>(params)
        .map_err(|_| "session/prompt parameters are invalid")?;
    let mut sessions = app.sessions.lock().await;
    let session = sessions
        .get_mut(&params.session_id)
        .ok_or("session/prompt session is unavailable")?;
    // An aborted task drops its receiver, so it cannot leave the session busy.
    if session.busy && !session.cancel_tx.is_closed() {
        return Err("session/prompt is already active");
    }
    let (cancel_tx, cancel_rx) = watch::channel(false);
    session.cancel_tx = cancel_tx;
    session.busy = true;
    let mut prompt = prompt_text(&params.prompt);
    if let Some(system_prompt) = session
        .system_prompt
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        prompt = format!("[Base]\n{system_prompt}\n\n{prompt}");
    }
    Ok(CompatTurn {
        session_id: params.session_id,
        cwd: session.cwd.clone(),
        mcp_servers: session.mcp_servers.clone(),
        prompt,
        cancel_rx,
    })
}

async fn session_prompt(
    app: Arc<CompatApp>,
    id: Value,
    turn: CompatTurn,
    wire_tx: wire::WireSender,
) {
    let CompatTurn {
        session_id,
        cwd,
        mcp_servers,
        prompt,
        mut cancel_rx,
    } = turn;
    let result = if prompt.len() > MAX_PROMPT_BYTES {
        Err("OpenClaw prompt exceeds the local bound".to_owned())
    } else {
        run_openclaw_turn(
            &app.config,
            &session_id,
            &cwd,
            &mcp_servers,
            &prompt,
            &mut cancel_rx,
        )
        .await
    };
    let message_count = match &result {
        Ok(Some(text)) if !text.is_empty() => 2,
        _ => 1,
    };
    // Reserve before taking the session lock. Cancellation stays responsive
    // under output backpressure, and its final check plus publication below
    // are synchronous with respect to cancel_session's same lock.
    let permits = wire_tx.reserve_many(message_count).await;
    let mut sessions = app.sessions.lock().await;
    let result = if *cancel_rx.borrow() {
        Ok(None)
    } else {
        result
    };
    if let Ok(mut permits) = permits {
        let completion = match result {
            Ok(Some(text)) => {
                if !text.is_empty() {
                    if let Some(permit) = permits.next() {
                        permit.send(WireMsg::Notify(wire::session_update(
                            &session_id,
                            json!({
                                "sessionUpdate": "agent_message_chunk",
                                "content": { "type": "text", "text": text }
                            }),
                        )));
                    }
                }
                wire::ok(id, json!({ "stopReason": "end_turn" }))
            }
            Ok(None) => wire::ok(id, json!({ "stopReason": "cancelled" })),
            Err(_) => wire::err(id, -32000, "OpenClaw local turn failed"),
        };
        if let Some(permit) = permits.next() {
            permit.send(WireMsg::Notify(completion));
        }
    }
    if let Some(session) = sessions.get_mut(&session_id) {
        session.busy = false;
    }
}

fn prompt_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text } => Some(text.as_str()),
            ContentBlock::ResourceLink { uri } => Some(uri.as_str()),
            ContentBlock::Unsupported => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn run_openclaw_turn(
    config: &CompatConfig,
    session_id: &str,
    cwd: &Path,
    mcp_servers: &[McpServerStdio],
    prompt: &str,
    cancel_rx: &mut watch::Receiver<bool>,
) -> Result<Option<String>, String> {
    if *cancel_rx.borrow() || cancel_rx.has_changed().is_err() {
        return Ok(None);
    }
    let turn_workspace = TurnWorkspace::create(config, mcp_servers)?;
    let session_key = openclaw_session_key(&config.agent_id, session_id);
    let command = build_command(
        config,
        &turn_workspace.overlay_path,
        cwd,
        &session_key,
        prompt,
    );
    let child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "OpenClaw local turn failed".to_owned())?;
    let mut process = TurnProcess { child };
    let stdout = process
        .child
        .stdout
        .take()
        .ok_or_else(|| "OpenClaw local turn failed".to_owned())?;
    let stderr = process
        .child
        .stderr
        .take()
        .ok_or_else(|| "OpenClaw local turn failed".to_owned())?;
    let completed = tokio::select! {
        biased;
        _ = cancel_rx.changed() => None,
        output = async {
            // Drain both pipes without detached reader tasks. Keep the leader
            // unreaped until EOF: a descendant holding a pipe must not prevent
            // Stop/Drop from safely signaling the original process group.
            let (stdout, _) = tokio::join!(
                read_capped(stdout, MAX_STDOUT_BYTES),
                read_capped(stderr, MAX_STDERR_BYTES),
            );
            let status = process.child.wait().await
                .map_err(|_| "OpenClaw local turn failed".to_owned())?;
            Ok::<_, String>((status, stdout?))
        } => Some(output),
    };
    let Some(completed) = completed else {
        // Selecting cancellation dropped the pipe readers before this bounded
        // group shutdown. No inherited pipe can hold the turn open afterwards.
        process.stop().await;
        return Ok(None);
    };
    let (status, stdout) = completed?;
    if *cancel_rx.borrow() {
        return Ok(None);
    }
    if !status.success() {
        return Err("OpenClaw local turn failed".into());
    }
    extract_visible_text(&stdout).map(Some)
}

fn build_command(
    config: &CompatConfig,
    overlay_path: &Path,
    cwd: &Path,
    session_key: &str,
    prompt: &str,
) -> Command {
    let mut command = Command::new(&config.openclaw_command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let include_root = config
        .isolation
        .as_ref()
        .map(|isolation| isolation.root_dir.as_path())
        .unwrap_or(&config.native_state_dir);
    command
        .args([
            "agent",
            "--local",
            "--agent",
            &config.agent_id,
            "--session-key",
            session_key,
            "--message",
            prompt,
            "--json",
        ])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("OPENCLAW_CONFIG_PATH", overlay_path)
        .env("OPENCLAW_STATE_DIR", &config.native_state_dir)
        .env("OPENCLAW_INCLUDE_ROOTS", include_root)
        .env("OPENCLAW_HIDE_BANNER", "1")
        .env("OPENCLAW_SUPPRESS_NOTES", "1");
    if let Some(isolation) = &config.isolation {
        // OPENCLAW_STATE_DIR alone is not enough: OpenClaw also discovers and
        // migrates legacy state from its effective home. Acceptance bundles
        // give the subprocess a private OpenClaw home so those migrations never
        // inspect or archive files in the imported native home.
        command
            .env("OPENCLAW_HOME", &isolation.home_dir)
            // OpenClaw keeps transcripts, device auth, workspace attestations,
            // queues, and other runtime-owned mutable files below its state
            // root. The acceptance runtime receives a persistent, disposable
            // state root instead of the imported native store.
            .env("OPENCLAW_STATE_DIR", &isolation.state_dir)
            .env("OPENCLAW_AGENT_DIR", &isolation.agent_dir)
            // These are OpenClaw's existing immutable-config and read-only auth
            // guards. Missing fixture credentials fail closed; native
            // credentials are never copied into the disposable instance.
            .env("OPENCLAW_AUTH_STORE_READONLY", "1")
            .env("OPENCLAW_NIX_MODE", "1");
    }
    for key in OPENCLAW_BOOTSTRAP_ENV_KEYS {
        command.env_remove(key);
    }
    for key in REPOSITORY_ENV_KEYS {
        command.env_remove(key);
    }
    for key in COMMUNICATIONS_ENV_KEYS {
        command.env_remove(key);
    }
    for key in ARTIFACT_ENV_KEYS {
        command.env_remove(key);
    }
    command
}

fn write_overlay(
    path: &Path,
    source_config_path: &Path,
    isolation: Option<&NativeStateIsolation>,
    servers: &[McpServerStdio],
) -> Result<(), String> {
    let mut projected = serde_json::Map::new();
    for server in servers {
        let env = server
            .env
            .iter()
            .map(|entry| (entry.name.clone(), Value::String(entry.value.clone())))
            .collect::<serde_json::Map<_, _>>();
        projected.insert(
            server.name.clone(),
            json!({
                "command": server.command,
                "args": server.args,
                "env": env,
            }),
        );
    }
    let also_allow = projected
        .keys()
        .map(|name| format!("{name}__*"))
        .collect::<Vec<_>>();
    if isolation.is_none() {
        // Keep the ordinary imported-runtime overlay exactly as it was before
        // disposable-state support existed.
        let overlay = if projected.is_empty() {
            json!({ "$include": source_config_path })
        } else {
            json!({
                "$include": source_config_path,
                "mcp": { "servers": projected },
                "tools": { "alsoAllow": also_allow }
            })
        };
        let bytes = serde_json::to_vec(&overlay).map_err(|_| "turn overlay invalid".to_owned())?;
        fs::write(path, bytes).map_err(|_| "turn overlay unavailable".to_owned())?;
        return secure_file(path);
    }
    let isolation = isolation.ok_or_else(|| "turn overlay invalid".to_owned())?;
    // OpenClaw's agent command otherwise seeds missing bootstrap files into a
    // configured native workspace. The disposable instance uses only its
    // separately provisioned fixture config and keeps every writable store
    // below its isolated state root.
    let mut overlay = json!({
        "$include": source_config_path,
        "agents": { "defaults": { "skipBootstrap": true } },
        "session": { "store": isolation.session_store }
    });
    if !projected.is_empty() {
        overlay["mcp"] = json!({ "servers": projected });
        overlay["tools"] = json!({ "alsoAllow": also_allow });
    }
    let bytes = serde_json::to_vec(&overlay).map_err(|_| "turn overlay invalid".to_owned())?;
    fs::write(path, bytes).map_err(|_| "turn overlay unavailable".to_owned())?;
    secure_file(path)
}

fn openclaw_session_key(agent_id: &str, session_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"luca.openclaw.compat.session.v1\0");
    digest.update(session_id.as_bytes());
    let suffix = hex::encode(digest.finalize());
    format!("agent:{agent_id}:luca-{}", &suffix[..24])
}

fn extract_visible_text(stdout: &[u8]) -> Result<String, String> {
    let value: Value =
        serde_json::from_slice(stdout).map_err(|_| "OpenClaw response invalid".to_owned())?;
    let payloads = value
        .get("payloads")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|payload| payload.get("text").and_then(Value::as_str))
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();
    if !payloads.is_empty() {
        return Ok(payloads.join("\n"));
    }
    value
        .pointer("/meta/finalAssistantVisibleText")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "OpenClaw response invalid".to_owned())
}

async fn read_capped<R: AsyncRead + Unpin>(mut reader: R, limit: usize) -> Result<Vec<u8>, String> {
    let mut retained = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|_| "OpenClaw stream failed".to_owned())?;
        if read == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        retained.extend_from_slice(&buffer[..read.min(remaining)]);
    }
    Ok(retained)
}

async fn cancel_session(app: &Arc<CompatApp>, params: Value) {
    if let Ok(params) = serde_json::from_value::<SessionCancelParams>(params) {
        if let Some(session) = app.sessions.lock().await.get(&params.session_id) {
            let _ = session.cancel_tx.send(true);
        }
    }
}

async fn reject(wire_tx: &wire::WireSender, id: Value, message: &str) {
    wire::send(wire_tx, wire::err(id, wire::INVALID_PARAMS, message)).await;
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "secure randomness unavailable".to_owned())?;
    Ok(hex::encode(bytes))
}

#[cfg(unix)]
fn secure_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "OpenClaw compatibility workspace could not be secured".to_owned())
}

#[cfg(not(unix))]
fn secure_directory(_path: &Path) -> Result<(), String> {
    Err("OpenClaw compatibility is unavailable on this platform".into())
}

#[cfg(unix)]
fn secure_file(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "OpenClaw compatibility overlay could not be secured".to_owned())
}

#[cfg(not(unix))]
fn secure_file(_path: &Path) -> Result<(), String> {
    Err("OpenClaw compatibility is unavailable on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::EnvVar;

    #[cfg(unix)]
    fn write_executable(path: &Path, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(path, body).expect("write executable fixture");
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .expect("secure executable fixture");
    }

    #[cfg(unix)]
    struct ProcessTreeFixture {
        root: tempfile::TempDir,
        config: CompatConfig,
    }

    #[cfg(unix)]
    impl ProcessTreeFixture {
        fn new(leader_exits: bool) -> Self {
            let root = tempfile::tempdir().expect("process tree fixture");
            let root_path = root.path().canonicalize().expect("canonical fixture");
            let native_config_path = root_path.join("native.json");
            fs::write(&native_config_path, "{}\n").expect("native fixture config");
            let temporary_root = root_path.join("turns");
            fs::create_dir(&temporary_root).expect("turn root");
            let command = root_path.join("fake-openclaw");
            write_executable(
                &command,
                r#"#!/bin/sh
set -eu
if test -f complete-next; then
  printf '%s\n' complete > completion-ready
  printf '%s\n' '{"payloads":[{"text":"next-turn-ok"}]}'
  exit 0
fi
printf '%s\n' "$$" > leader.pid
/bin/sh -c '
  trap "" TERM
  printf "%s\n" "$$" > descendant.pid
  while ! test -f release; do sleep 0.02; done
  printf "%s\n" "descendant finished" > descendant-finished
  printf "%s\n" "late descendant output" >&2
' &
if test -f leader-exits; then
  printf '%s\n' '{"payloads":[{"text":"late-final"}]}'
  exit 0
fi
wait
printf '%s\n' '{"payloads":[{"text":"late-final"}]}'
"#,
            );
            if leader_exits {
                fs::write(root_path.join("leader-exits"), "").expect("exit fixture");
            }
            Self {
                root,
                config: CompatConfig {
                    openclaw_command: command,
                    native_config_path,
                    native_state_dir: root_path,
                    isolation: None,
                    agent_id: "main".into(),
                    temporary_root,
                },
            }
        }

        async fn pid(&self, name: &str) -> nix::unistd::Pid {
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    if let Ok(value) = fs::read_to_string(self.root.path().join(name)) {
                        if let Ok(pid) = value.trim().parse() {
                            return nix::unistd::Pid::from_raw(pid);
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("fixture process started")
        }

        async fn assert_stopped(&self) {
            let leader = self.pid("leader.pid").await;
            let descendant = self.pid("descendant.pid").await;
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                while nix::sys::signal::kill(leader, None).is_ok()
                    || nix::sys::signal::kill(descendant, None).is_ok()
                {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("native leader and descendant stopped");
            assert_eq!(
                fs::read_dir(&self.config.temporary_root).unwrap().count(),
                0
            );
        }

        fn app(&self) -> Arc<CompatApp> {
            let (cancel_tx, _) = watch::channel(false);
            Arc::new(CompatApp {
                config: self.config.clone(),
                sessions: Mutex::new(HashMap::from([(
                    "session".into(),
                    CompatSession {
                        cwd: self.config.native_state_dir.clone(),
                        mcp_servers: vec![],
                        system_prompt: None,
                        cancel_tx,
                        busy: false,
                    },
                )])),
            })
        }
    }

    #[cfg(unix)]
    fn fixture_prompt() -> Value {
        json!({"sessionId": "session", "prompt": [{"type": "text", "text": "hello"}]})
    }

    #[cfg(unix)]
    async fn assert_cancelled_only(wire_rx: &mut mpsc::Receiver<WireMsg>) {
        let WireMsg::Notify(message) = wire_rx.recv().await.expect("cancelled response");
        assert_eq!(
            message.pointer("/result/stopReason"),
            Some(&json!("cancelled"))
        );
        assert!(wire_rx.try_recv().is_err(), "no late final message");
    }

    #[cfg(unix)]
    impl Drop for ProcessTreeFixture {
        fn drop(&mut self) {
            // Even the failing baseline test releases its synthetic orphan.
            // Never send a cleanup signal to a PID read from an old fixture.
            let _ = fs::write(self.root.path().join("release"), "");
            if let Ok(value) = fs::read_to_string(self.root.path().join("descendant.pid")) {
                if let Ok(pid) = value.trim().parse() {
                    for _ in 0..100 {
                        if nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_err() {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                }
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_stops_descendants_holding_pipes_and_allows_the_next_turn() {
        let fixture = ProcessTreeFixture::new(false);
        let config = fixture.config.clone();
        let cwd = fixture.config.native_state_dir.clone();
        let (cancel_tx, mut cancel_rx) = watch::channel(false);
        let mut turn = tokio::spawn(async move {
            run_openclaw_turn(&config, "session", &cwd, &[], "hello", &mut cancel_rx).await
        });
        fixture.pid("descendant.pid").await;
        cancel_tx.send(true).expect("cancel turn");
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(2), &mut turn)
                .await
                .expect("Stop must not wait on descendant pipes")
                .expect("turn task")
                .expect("cancelled turn"),
            None
        );
        fixture.assert_stopped().await;

        fs::write(fixture.root.path().join("complete-next"), "").expect("next turn");
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            run_openclaw_turn(
                &fixture.config,
                "session",
                &fixture.config.native_state_dir,
                &[],
                "next",
                &mut cancel_rx,
            ),
        )
        .await
        .expect("next turn bounded")
        .expect("next turn");
        assert_eq!(response.as_deref(), Some("next-turn-ok"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_after_leader_exit_stops_inherited_pipes_without_a_late_final() {
        let fixture = ProcessTreeFixture::new(true);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(64);
        let turn = acquire_turn(&app, fixture_prompt())
            .await
            .expect("acquire turn");
        let prompt_task = tokio::spawn(session_prompt(Arc::clone(&app), json!(1), turn, wire_tx));
        let descendant = fixture.pid("descendant.pid").await;
        let leader = fixture.pid("leader.pid").await;
        assert_eq!(nix::unistd::getpgid(Some(descendant)).unwrap(), leader);
        tokio::time::sleep(Duration::from_millis(30)).await;
        cancel_session(&app, json!({"sessionId": "session"})).await;
        tokio::time::timeout(Duration::from_secs(2), prompt_task)
            .await
            .expect("Stop after leader exit is bounded")
            .expect("prompt task");
        fixture.assert_stopped().await;
        assert_cancelled_only(&mut wire_rx).await;
        assert!(!app.sessions.lock().await["session"].busy);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_a_prompt_task_stops_the_process_group_and_releases_the_session() {
        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(64);
        let turn = acquire_turn(&app, fixture_prompt())
            .await
            .expect("acquire turn");
        let task = tokio::spawn(session_prompt(Arc::clone(&app), json!(1), turn, wire_tx));
        fixture.pid("descendant.pid").await;
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        fixture.assert_stopped().await;
        assert!(wire_rx.try_recv().is_err());
        assert!(acquire_turn(&app, fixture_prompt()).await.is_ok());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_eof_cancels_active_turns_and_reaps_their_process_groups() {
        use tokio::io::AsyncWriteExt;

        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(64);
        let (mut input, reader) = tokio::io::duplex(4096);
        let task_app = Arc::clone(&app);
        let adapter =
            tokio::spawn(async move { serve(task_app, BufReader::new(reader), &wire_tx).await });
        let request = json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": fixture_prompt()
        });
        input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();
        fixture.pid("descendant.pid").await;
        drop(input);
        tokio::time::timeout(Duration::from_secs(3), adapter)
            .await
            .expect("adapter EOF is bounded")
            .expect("adapter task")
            .expect("adapter input");
        fixture.assert_stopped().await;
        assert_cancelled_only(&mut wire_rx).await;
    }

    #[cfg(unix)]
    async fn assert_backpressured_control_shutdown(control: &str) {
        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(1);
        wire_tx
            .send(WireMsg::Notify(json!("occupied")))
            .await
            .unwrap();
        let prompt = json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": fixture_prompt()
        });
        let cancel = json!({
            "jsonrpc": "2.0", "method": "session/cancel", "params": {"sessionId": "session"}
        });
        let input = format!("{prompt}\n{control}\n{cancel}\n");
        let task_app = Arc::clone(&app);
        let mut adapter =
            tokio::spawn(async move { serve(task_app, input.as_bytes(), &wire_tx).await });
        fixture.pid("descendant.pid").await;
        let result = tokio::time::timeout(Duration::from_secs(3), &mut adapter).await;
        if result.is_err() {
            // A failing regression must still stop its synthetic process tree.
            adapter.abort();
            let _ = adapter.await;
        }
        fixture.assert_stopped().await;
        let error = result
            .expect("control output backpressure must not strand the adapter or native turn")
            .expect("adapter task")
            .expect_err("unavailable control output must fail the transport");
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        let WireMsg::Notify(message) = wire_rx.recv().await.unwrap();
        assert_eq!(message, json!("occupied"));
        assert!(wire_rx.try_recv().is_err(), "no late native final");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_backpressured_rejection_cannot_block_cancel_and_eof() {
        let duplicate = json!({
            "jsonrpc": "2.0", "id": 2, "method": "session/prompt", "params": fixture_prompt()
        });
        assert_backpressured_control_shutdown(&duplicate.to_string()).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_backpressured_parse_error_cannot_block_cancel_and_eof() {
        assert_backpressured_control_shutdown("{invalid json").await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_closed_output_cancels_native_turn_without_waiting_for_input() {
        use tokio::io::AsyncWriteExt;

        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, wire_rx) = mpsc::channel(1);
        let (mut input, reader) = tokio::io::duplex(4096);
        let task_app = Arc::clone(&app);
        let mut adapter =
            tokio::spawn(async move { serve(task_app, BufReader::new(reader), &wire_tx).await });
        let prompt = json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": fixture_prompt()
        });
        input
            .write_all(format!("{prompt}\n").as_bytes())
            .await
            .unwrap();
        fixture.pid("descendant.pid").await;
        drop(wire_rx);
        let result = tokio::time::timeout(Duration::from_secs(3), &mut adapter).await;
        if result.is_err() {
            adapter.abort();
            let _ = adapter.await;
        }
        fixture.assert_stopped().await;
        let error = result
            .expect("disconnected output must stop the adapter while input remains open")
            .expect("adapter task")
            .expect_err("closed output must fail the transport");
        assert_eq!(error.kind(), std::io::ErrorKind::BrokenPipe);
        drop(input);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn adapter_eof_before_prompt_poll_never_launches_a_native_process() {
        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(64);
        let request = json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": fixture_prompt()
        });
        let input = format!("{request}\n");
        serve(Arc::clone(&app), input.as_bytes(), &wire_tx)
            .await
            .unwrap();
        assert!(!fixture.root.path().join("leader.pid").exists());
        assert_cancelled_only(&mut wire_rx).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_the_adapter_aborts_its_turn_tasks_and_the_native_process_group() {
        use tokio::io::AsyncWriteExt;

        let fixture = ProcessTreeFixture::new(false);
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(64);
        let (mut input, reader) = tokio::io::duplex(4096);
        let task_app = Arc::clone(&app);
        let adapter =
            tokio::spawn(async move { serve(task_app, BufReader::new(reader), &wire_tx).await });
        let request = json!({
            "jsonrpc": "2.0", "id": 1, "method": "session/prompt", "params": fixture_prompt()
        });
        input
            .write_all(format!("{request}\n").as_bytes())
            .await
            .unwrap();
        fixture.pid("descendant.pid").await;
        adapter.abort();
        assert!(adapter.await.unwrap_err().is_cancelled());
        fixture.assert_stopped().await;
        assert!(wire_rx.try_recv().is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_while_final_publication_is_backpressured_suppresses_the_final() {
        let fixture = ProcessTreeFixture::new(false);
        fs::write(fixture.root.path().join("complete-next"), "").expect("normal final");
        let app = fixture.app();
        let (wire_tx, mut wire_rx) = mpsc::channel(2);
        wire_tx
            .send(WireMsg::Notify(json!("occupied")))
            .await
            .unwrap();
        let turn = acquire_turn(&app, fixture_prompt())
            .await
            .expect("acquire turn");
        let task = tokio::spawn(session_prompt(Arc::clone(&app), json!(1), turn, wire_tx));
        tokio::time::timeout(Duration::from_secs(2), async {
            while !fixture.root.path().join("completion-ready").exists()
                || fs::read_dir(&fixture.config.temporary_root)
                    .unwrap()
                    .count()
                    != 0
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("native final ready");
        cancel_session(&app, json!({"sessionId": "session"})).await;
        let _ = wire_rx.recv().await;
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("publication unblocked")
            .expect("prompt task");
        assert_cancelled_only(&mut wire_rx).await;
    }

    fn snapshot_tree(root: &Path) -> BTreeMap<PathBuf, Option<Vec<u8>>> {
        fn visit(root: &Path, current: &Path, snapshot: &mut BTreeMap<PathBuf, Option<Vec<u8>>>) {
            let relative = current
                .strip_prefix(root)
                .expect("snapshot path")
                .to_owned();
            let metadata = std::fs::symlink_metadata(current).expect("snapshot metadata");
            if metadata.is_dir() {
                snapshot.insert(relative, None);
                let mut children = std::fs::read_dir(current)
                    .expect("snapshot directory")
                    .map(|entry| entry.expect("snapshot entry").path())
                    .collect::<Vec<_>>();
                children.sort();
                for child in children {
                    visit(root, &child, snapshot);
                }
            } else {
                snapshot.insert(
                    relative,
                    Some(std::fs::read(current).expect("snapshot file")),
                );
            }
        }

        let mut snapshot = BTreeMap::new();
        visit(root, root, &mut snapshot);
        snapshot
    }

    fn repository_server(capability: &str) -> McpServerStdio {
        McpServerStdio {
            name: REPOSITORY_SERVER_NAME.into(),
            command: "/opt/luca/buzz-dev-mcp".into(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_REPOSITORY_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_ENDPOINT".into(),
                    value: "/tmp/luca-rb-11111111111111111111111111111111/e7-2222222222222222.sock"
                        .into(),
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_CAPABILITY".into(),
                    value: capability.into(),
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_CONVERSATION_ID".into(),
                    value: "c590e1d2-f77a-4da3-aa91-679dcf381b03".into(),
                },
            ],
        }
    }

    fn communications_server(capability: &str) -> McpServerStdio {
        McpServerStdio {
            name: COMMUNICATIONS_SERVER_NAME.into(),
            command: "/opt/luca/buzz-dev-mcp".into(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_ENDPOINT".into(),
                    value: "/tmp/luca-cb-11111111111111111111111111111111/e7-2222222222222222.sock"
                        .into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CAPABILITY".into(),
                    value: capability.into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CAPABILITY_GENERATION".into(),
                    value: "9".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CONVERSATION_ID".into(),
                    value: "c590e1d2-f77a-4da3-aa91-679dcf381b03".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_TURN_ID".into(),
                    value: "turn-1".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID".into(),
                    value: "dispatch-1".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CANCELLATION_EPOCH".into(),
                    value: "7".into(),
                },
            ],
        }
    }

    fn artifact_server(capability: &str) -> McpServerStdio {
        McpServerStdio {
            name: "luca-artifacts-0123abcdef45".into(),
            command: "/opt/luca/buzz-dev-mcp".into(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_ARTIFACT_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_ENDPOINT".into(),
                    value: "/tmp/luca-ab-11111111111111111111111111111111/e7-2222222222222222.sock"
                        .into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CAPABILITY".into(),
                    value: capability.into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CAPABILITY_GENERATION".into(),
                    value: "9".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CONVERSATION_ID".into(),
                    value: "conversation-1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_TURN_ID".into(),
                    value: "turn-1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID".into(),
                    value: "dispatch-1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CANCELLATION_EPOCH".into(),
                    value: "7".into(),
                },
            ],
        }
    }

    #[test]
    fn repository_projection_is_exact_and_scoped() {
        assert!(validate_mcp_servers(&[]).is_ok());
        assert!(
            validate_mcp_servers(&[repository_server(&format!("sha256:{}", "a".repeat(64)))])
                .is_ok()
        );
        let mut invalid = repository_server(&format!("sha256:{}", "a".repeat(64)));
        invalid.env.push(EnvVar {
            name: "UNSCOPED".into(),
            value: "1".into(),
        });
        assert!(validate_mcp_servers(&[invalid]).is_err());
        assert!(validate_mcp_servers(&[repository_server("sha256:abc")]).is_err());
    }

    #[test]
    fn repository_and_communications_projections_are_exact_and_scoped() {
        let repository = repository_server(&format!("sha256:{}", "a".repeat(64)));
        let communications = communications_server(&format!("sha256:{}", "b".repeat(64)));
        assert!(validate_mcp_servers(&[repository.clone(), communications.clone()]).is_ok());
        assert!(validate_mcp_servers(std::slice::from_ref(&communications)).is_ok());
        assert!(validate_mcp_servers(&[communications.clone(), communications]).is_err());

        let mut invalid = communications_server(&format!("sha256:{}", "b".repeat(64)));
        invalid
            .env
            .iter_mut()
            .find(|entry| entry.name == "LUCA_COMMUNICATIONS_ENDPOINT")
            .unwrap()
            .value =
            "/tmp/luca-rb-11111111111111111111111111111111/e7-2222222222222222.sock".into();
        assert!(validate_mcp_servers(&[invalid]).is_err());
    }

    #[test]
    fn third_restricted_artifact_projection_is_exact_and_scoped() {
        let repository = repository_server(&format!("sha256:{}", "a".repeat(64)));
        let communications = communications_server(&format!("sha256:{}", "b".repeat(64)));
        let artifact = artifact_server(&format!("sha256:{}", "c".repeat(64)));
        assert!(validate_mcp_servers(&[repository, communications, artifact.clone()]).is_ok());
        let mut invalid = artifact;
        invalid.env.push(EnvVar {
            name: "WORKING_ROOT".into(),
            value: "/private".into(),
        });
        assert!(validate_mcp_servers(&[invalid]).is_err());
    }

    #[test]
    fn communications_server_name_accepts_bounded_turn_names_only() {
        let capability = format!("sha256:{}", "b".repeat(64));
        let exact = communications_server(&capability);
        assert!(validate_mcp_servers(&[exact]).is_ok());

        let mut per_turn = communications_server(&capability);
        per_turn.name = "luca-communications-0123abcdef45".into();
        assert!(validate_mcp_servers(&[per_turn]).is_ok());

        for lookalike in [
            "luca-communications-0123abcdef4",
            "luca-communications-0123abcdef456",
            "luca-communications-0123abcdeg45",
            "luca-communications-0123ABCDEF45",
            "luca-communications--0123abcdef45",
            "other-communications-0123abcdef45",
        ] {
            let mut invalid = communications_server(&capability);
            invalid.name = lookalike.into();
            assert!(
                validate_mcp_servers(&[invalid]).is_err(),
                "accepted unsafe lookalike: {lookalike}"
            );
        }
    }

    #[test]
    fn repository_endpoint_matches_only_the_desktop_broker_shape() {
        assert!(valid_broker_endpoint(
            "/tmp/luca-rb-11111111111111111111111111111111/e9007199254740991-abcdef0123456789.sock",
            "luca-rb-"
        ));
        assert!(!valid_broker_endpoint(
            "/tmp/luca-rb-11111111111111111111111111111111/repository.sock",
            "luca-rb-"
        ));
        assert!(!valid_broker_endpoint(
            "/tmp/luca-rb-11111111111111111111111111111111/e7-../../escape.sock",
            "luca-rb-"
        ));
        assert!(!valid_broker_endpoint(
            "/private/tmp/luca-rb-11111111111111111111111111111111/e7-2222222222222222.sock",
            "luca-rb-"
        ));
    }

    #[test]
    fn child_environment_does_not_inherit_any_luca_broker_capability() {
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path: PathBuf::from("/native/openclaw.json"),
            native_state_dir: PathBuf::from("/native"),
            isolation: Some(NativeStateIsolation {
                root_dir: PathBuf::from("/tmp/luca-test"),
                config_path: PathBuf::from("/tmp/luca-test/fixture.json"),
                home_dir: PathBuf::from("/tmp/luca-test/home"),
                state_dir: PathBuf::from("/tmp/luca-test/state"),
                agent_dir: PathBuf::from("/tmp/luca-test/state/agents/main/agent"),
                session_store: PathBuf::from(
                    "/tmp/luca-test/state/agents/main/sessions/sessions.json",
                ),
            }),
            agent_id: "main".into(),
            temporary_root: PathBuf::from("/tmp/luca-test"),
        };
        let command = build_command(
            &config,
            Path::new("/tmp/overlay.json"),
            Path::new("/tmp"),
            "agent:main:luca-test",
            "prompt",
        );
        for key in OPENCLAW_BOOTSTRAP_ENV_KEYS {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == key && value.is_none()));
        }
        for key in REPOSITORY_ENV_KEYS {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == key && value.is_none()));
        }
        for key in COMMUNICATIONS_ENV_KEYS {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == key && value.is_none()));
        }
        for key in ARTIFACT_ENV_KEYS {
            assert!(command
                .get_envs()
                .any(|(name, value)| name == key && value.is_none()));
        }
        let arguments = command
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!arguments.contains("sha256:"));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_HOME" && value == Some(std::ffi::OsStr::new("/tmp/luca-test/home"))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_STATE_DIR"
                && value == Some(std::ffi::OsStr::new("/tmp/luca-test/state"))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_AGENT_DIR"
                && value
                    == Some(std::ffi::OsStr::new(
                        "/tmp/luca-test/state/agents/main/agent",
                    ))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_INCLUDE_ROOTS"
                && value == Some(std::ffi::OsStr::new("/tmp/luca-test"))
        }));
        assert!(!command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_STATE_DIR" && value == Some(std::ffi::OsStr::new("/native"))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_AUTH_STORE_READONLY" && value == Some(std::ffi::OsStr::new("1"))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_NIX_MODE" && value == Some(std::ffi::OsStr::new("1"))
        }));
        assert!(command.get_envs().any(|(name, value)| {
            name == "LUCA_NATIVE_STATE_ISOLATION_ROOT" && value.is_none()
        }));
    }

    #[test]
    fn ordinary_runtime_preserves_the_native_openclaw_state_contract() {
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path: PathBuf::from("/native/openclaw.json"),
            native_state_dir: PathBuf::from("/native"),
            isolation: None,
            agent_id: "main".into(),
            temporary_root: PathBuf::from("/tmp/luca-test"),
        };
        let command = build_command(
            &config,
            Path::new("/tmp/overlay.json"),
            Path::new("/tmp"),
            "agent:main:luca-test",
            "prompt",
        );
        assert!(command.get_envs().any(|(name, value)| {
            name == "OPENCLAW_STATE_DIR" && value == Some(std::ffi::OsStr::new("/native"))
        }));
        for key in [
            "OPENCLAW_HOME",
            "OPENCLAW_AUTH_STORE_READONLY",
            "OPENCLAW_NIX_MODE",
        ] {
            assert!(!command.get_envs().any(|(name, _)| name == key));
        }
    }

    #[cfg(unix)]
    #[test]
    fn explicit_isolation_root_resolves_agent_local_home_and_state() {
        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let isolation_root = fixture_root.join("acceptance");
        std::fs::create_dir(&native_state).expect("native state");
        std::fs::create_dir(&isolation_root).expect("isolation root");
        let isolated_config = isolation_root.join("fixture.json");
        std::fs::write(&isolated_config, "{}\n").expect("isolated config");
        let isolation = resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .expect("isolation")
        .expect("isolation enabled");
        assert_eq!(isolation.root_dir, isolation_root);
        assert_eq!(isolation.config_path, isolated_config);
        assert_eq!(
            isolation.home_dir,
            isolation_root.join("openclaw/main/home")
        );
        assert_eq!(
            isolation.state_dir,
            isolation_root.join("openclaw/main/state")
        );
        assert_eq!(
            isolation.agent_dir,
            isolation_root.join("openclaw/main/state/agents/main/agent")
        );
        assert_eq!(
            isolation.session_store,
            isolation_root.join("openclaw/main/state/agents/main/sessions/sessions.json")
        );
        assert!(isolation.home_dir.is_dir());
        assert!(isolation.state_dir.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn isolation_root_cannot_overlap_the_imported_native_store() {
        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let nested = native_state.join("acceptance");
        std::fs::create_dir(&native_state).expect("native state");
        std::fs::create_dir(&nested).expect("nested root");
        let isolated_config = nested.join("fixture.json");
        std::fs::write(&isolated_config, "{}\n").expect("isolated config");
        for invalid in [
            fixture_root.as_path(),
            native_state.as_path(),
            nested.as_path(),
        ] {
            assert!(resolve_native_state_isolation(
                &native_state,
                "main",
                Some(invalid.as_os_str()),
                Some(isolated_config.as_os_str()),
            )
            .is_err());
        }
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(std::ffi::OsStr::new("relative/acceptance")),
            Some(isolated_config.as_os_str()),
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn isolated_fixture_must_be_canonical_below_root_and_path_safe() {
        use std::os::unix::fs::symlink;

        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let isolation_root = fixture_root.join("acceptance");
        std::fs::create_dir(&native_state).expect("native state");
        std::fs::create_dir(&isolation_root).expect("isolation root");
        assert_eq!(
            resolve_native_state_isolation(
                &native_state,
                "main",
                Some(isolation_root.as_os_str()),
                None,
            )
            .err()
            .as_deref(),
            Some("OpenClaw compatibility isolation fixture is unavailable")
        );
        let missing_config = isolation_root.join("missing.json");
        assert_eq!(
            resolve_native_state_isolation(
                &native_state,
                "main",
                Some(isolation_root.as_os_str()),
                Some(missing_config.as_os_str()),
            )
            .err()
            .as_deref(),
            Some("OpenClaw compatibility isolation fixture is unavailable")
        );
        let outside_config = fixture_root.join("outside.json");
        std::fs::write(&outside_config, "{}\n").expect("outside config");
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(outside_config.as_os_str()),
        )
        .is_err());

        let linked_config = isolation_root.join("linked.json");
        symlink(&outside_config, &linked_config).expect("config symlink");
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(linked_config.as_os_str()),
        )
        .is_err());

        let isolated_config = isolation_root.join("fixture.json");
        std::fs::write(&isolated_config, r#"{"$include":"outside.json"}"#)
            .expect("included config");
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .is_err());

        let unsafe_agent_dir = native_state.join("agents/main/agent");
        std::fs::write(
            &isolated_config,
            serde_json::to_vec(&json!({
                "agents": { "list": [{ "id": "main", "agentDir": unsafe_agent_dir }] }
            }))
            .expect("unsafe fixture json"),
        )
        .expect("unsafe config");
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .is_err());

        let required_agent_dir = isolation_root.join("openclaw/main/state/agents/main/agent");
        std::fs::write(
            &isolated_config,
            serde_json::to_vec(&json!({
                "agents": { "list": [{ "id": "MAIN", "agentDir": required_agent_dir }] }
            }))
            .expect("safe fixture json"),
        )
        .expect("safe config");
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .expect("safe isolation")
        .is_some());
    }

    #[cfg(unix)]
    #[test]
    fn isolated_session_store_rejects_a_symlink_escape() {
        use std::os::unix::fs::symlink;

        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let native_sessions = native_state.join("sessions");
        let isolation_root = fixture_root.join("acceptance");
        let selected_agent_root = isolation_root.join("openclaw/main/state/agents/main");
        std::fs::create_dir_all(&native_sessions).expect("native sessions");
        std::fs::create_dir(&isolation_root).expect("isolation root");
        std::fs::create_dir_all(&selected_agent_root).expect("isolated agent root");
        symlink(&native_sessions, selected_agent_root.join("sessions")).expect("sessions symlink");
        let isolated_config = isolation_root.join("fixture.json");
        std::fs::write(&isolated_config, "{}\n").expect("isolated config");
        let native_before = snapshot_tree(&native_state);
        assert!(resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .is_err());
        assert_eq!(snapshot_tree(&native_state), native_before);
    }

    #[cfg(unix)]
    #[test]
    fn isolation_never_repermissions_the_caller_root_and_rejects_temp_root() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let isolation_root = fixture_root.join("acceptance");
        std::fs::create_dir(&native_state).expect("native state");
        std::fs::create_dir(&isolation_root).expect("isolation root");
        std::fs::set_permissions(&isolation_root, std::fs::Permissions::from_mode(0o751))
            .expect("caller root mode");
        let isolated_config = isolation_root.join("fixture.json");
        std::fs::write(&isolated_config, "{}\n").expect("isolated config");
        resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .expect("isolated state");
        let root_mode = std::fs::metadata(&isolation_root)
            .expect("caller root metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(root_mode, 0o751);

        let broad_root = std::env::temp_dir()
            .canonicalize()
            .expect("canonical temp root");
        assert!(resolve_native_state_isolation(
            Path::new("/Users/fixture/.openclaw"),
            "main",
            Some(broad_root.as_os_str()),
            Some(isolated_config.as_os_str()),
        )
        .is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn isolated_fake_runtime_leaves_the_imported_native_tree_unchanged() {
        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_state = fixture_root.join("native");
        let native_agent_dir = native_state.join("agents/main/agent");
        let native_sessions = native_state.join("agents/main/sessions");
        std::fs::create_dir_all(&native_agent_dir).expect("native agent dir");
        std::fs::create_dir_all(&native_sessions).expect("native sessions");
        let native_config_path = native_state.join("openclaw.json");
        std::fs::write(
            &native_config_path,
            serde_json::to_vec(&json!({
                "agents": { "list": [{ "id": "main", "agentDir": native_agent_dir }] },
                "session": { "store": native_sessions.join("sessions.json") }
            }))
            .expect("native config json"),
        )
        .expect("native config");
        std::fs::write(native_agent_dir.join("auth-profiles.json"), "native-auth\n")
            .expect("native auth");
        std::fs::write(
            native_agent_dir.join("workspace-attestation.json"),
            "native-workspace\n",
        )
        .expect("native workspace attestation");
        std::fs::write(native_sessions.join("sessions.json"), "native-sessions\n")
            .expect("native sessions store");

        let isolation_root = fixture_root.join("acceptance");
        std::fs::create_dir(&isolation_root).expect("isolation root");
        let isolated_config_path = isolation_root.join("fixture.json");
        std::fs::write(
            &isolated_config_path,
            serde_json::to_vec(&json!({
                "agents": { "list": [{ "id": "main" }] },
                "session": { "store": native_sessions.join("sessions.json") }
            }))
            .expect("isolated config json"),
        )
        .expect("isolated config");
        let isolation = resolve_native_state_isolation(
            &native_state,
            "main",
            Some(isolation_root.as_os_str()),
            Some(isolated_config_path.as_os_str()),
        )
        .expect("isolation")
        .expect("isolation enabled");
        let fake_runtime = fixture_root.join("fake-openclaw");
        write_executable(
            &fake_runtime,
            r#"#!/bin/sh
set -eu
cp "$OPENCLAW_CONFIG_PATH" "$OPENCLAW_STATE_DIR/overlay-seen.json"
printf 'isolated-state\n' > "$OPENCLAW_STATE_DIR/fake-session"
printf 'isolated-home\n' > "$OPENCLAW_HOME/fake-home"
printf 'isolated-agent\n' > "$OPENCLAW_AGENT_DIR/fake-auth"
printf '%s\n' '{"payloads":[{"text":"fixture-ok"}]}'
"#,
        );
        let temporary_root = fixture_root.join("turns");
        std::fs::create_dir(&temporary_root).expect("turn root");
        let config = CompatConfig {
            openclaw_command: fake_runtime,
            native_config_path,
            native_state_dir: native_state.clone(),
            isolation: Some(isolation.clone()),
            agent_id: "main".into(),
            temporary_root,
        };
        let native_before = snapshot_tree(&native_state);
        let (_cancel_tx, mut cancel_rx) = watch::channel(false);
        let response = run_openclaw_turn(
            &config,
            "session-fixture",
            &fixture_root,
            &[],
            "hello",
            &mut cancel_rx,
        )
        .await
        .expect("fake runtime turn");
        assert_eq!(response.as_deref(), Some("fixture-ok"));
        assert_eq!(snapshot_tree(&native_state), native_before);
        assert!(isolation.state_dir.join("fake-session").is_file());
        assert!(isolation.home_dir.join("fake-home").is_file());
        assert!(isolation.agent_dir.join("fake-auth").is_file());
        let seen_overlay =
            std::fs::read(isolation.state_dir.join("overlay-seen.json")).expect("captured overlay");
        let seen_overlay: Value =
            serde_json::from_slice(&seen_overlay).expect("captured overlay json");
        assert_eq!(
            seen_overlay.get("$include").and_then(Value::as_str),
            isolated_config_path.to_str()
        );
        assert_eq!(
            seen_overlay
                .pointer("/session/store")
                .and_then(Value::as_str),
            isolation.session_store.to_str()
        );
        assert!(!serde_json::to_string(&seen_overlay)
            .expect("serialized overlay")
            .contains(native_state.to_str().expect("native state path")));
    }

    #[test]
    fn response_exposes_only_visible_payload_text() {
        let response = json!({
            "payloads": [{ "text": "visible", "mediaUrl": null }],
            "meta": {
                "finalAssistantVisibleText": "fallback",
                "systemPromptReport": { "workspaceDir": "/private/workspace" }
            }
        });
        assert_eq!(
            extract_visible_text(&serde_json::to_vec(&response).expect("json")).expect("text"),
            "visible"
        );
    }

    #[test]
    fn session_keys_do_not_expose_luca_session_identifiers() {
        let key = openclaw_session_key("main", "luca-openclaw-visible-session");
        assert!(key.starts_with("agent:main:luca-"));
        assert!(!key.contains("visible-session"));
    }

    #[cfg(unix)]
    #[test]
    fn turn_workspace_removes_its_overlay_on_drop() {
        let fixture = tempfile::tempdir().expect("fixture");
        let fixture_root = fixture.path().canonicalize().expect("canonical fixture");
        let native_config_path = fixture_root.join("native.json");
        std::fs::write(&native_config_path, "{}\n").expect("native config");
        let isolated_config_path = fixture_root.join("isolated.json");
        std::fs::write(&isolated_config_path, "{}\n").expect("isolated config");
        let temporary_root = fixture_root.join("turns");
        std::fs::create_dir(&temporary_root).expect("turn root");
        let isolated_home = fixture_root.join("isolated-home");
        let isolated_state = fixture_root.join("isolated-state");
        let isolated_agent = isolated_state.join("agents/main/agent");
        let isolated_sessions = isolated_state.join("agents/main/sessions");
        std::fs::create_dir(&isolated_home).expect("isolated home");
        std::fs::create_dir_all(&isolated_agent).expect("isolated agent dir");
        std::fs::create_dir(&isolated_sessions).expect("isolated sessions dir");
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path,
            native_state_dir: fixture_root.clone(),
            isolation: Some(NativeStateIsolation {
                root_dir: fixture_root.clone(),
                config_path: isolated_config_path.clone(),
                home_dir: isolated_home,
                state_dir: isolated_state,
                agent_dir: isolated_agent,
                session_store: isolated_sessions.join("sessions.json"),
            }),
            agent_id: "main".into(),
            temporary_root,
        };
        let workspace = TurnWorkspace::create(&config, &[]).expect("turn workspace");
        let directory = workspace.directory.clone();
        assert!(workspace.overlay_path.is_file());
        let overlay: Value = serde_json::from_slice(
            &std::fs::read(&workspace.overlay_path).expect("read turn overlay"),
        )
        .expect("parse turn overlay");
        assert_eq!(
            overlay.pointer("/agents/defaults/skipBootstrap"),
            Some(&Value::Bool(true))
        );
        assert_eq!(
            overlay.get("$include").and_then(Value::as_str),
            isolated_config_path.to_str()
        );
        assert_eq!(
            overlay.pointer("/session/store").and_then(Value::as_str),
            fixture_root
                .join("isolated-state/agents/main/sessions/sessions.json")
                .to_str()
        );
        drop(workspace);
        assert!(!directory.exists());
    }

    #[cfg(unix)]
    #[test]
    fn ordinary_turn_overlay_does_not_change_native_bootstrap_behavior() {
        let fixture = tempfile::tempdir().expect("fixture");
        let native_config_path = fixture.path().join("native.json");
        std::fs::write(&native_config_path, "{}\n").expect("native config");
        let expected_overlay = serde_json::to_vec(&json!({ "$include": &native_config_path }))
            .expect("expected ordinary overlay");
        let temporary_root = fixture.path().join("turns");
        std::fs::create_dir(&temporary_root).expect("turn root");
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path,
            native_state_dir: fixture.path().to_owned(),
            isolation: None,
            agent_id: "main".into(),
            temporary_root,
        };
        let workspace = TurnWorkspace::create(&config, &[]).expect("turn workspace");
        assert_eq!(
            std::fs::read(&workspace.overlay_path).expect("read turn overlay"),
            expected_overlay
        );
    }
}

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
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncRead, AsyncReadExt, BufReader},
    sync::{mpsc, watch, Mutex},
};

use crate::{
    types::{ContentBlock, McpServerStdio},
    wire::{self, Inbound, SessionCancelParams, SessionNewParams, SessionPromptParams, WireMsg},
};

const MAX_FRAME_BYTES: usize = 1024 * 1024;
const MAX_PROMPT_BYTES: usize = 256 * 1024;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const REPOSITORY_SERVER_NAME: &str = "luca-repositories";
const COMMUNICATIONS_SERVER_NAME: &str = "luca-communications";
const OPENCLAW_BOOTSTRAP_ENV_KEYS: [&str; 4] = [
    "LUCA_OPENCLAW_AGENT_ID",
    "LUCA_OPENCLAW_COMMAND",
    "LUCA_OPENCLAW_CONFIG_PATH",
    "LUCA_OPENCLAW_STATE_DIR",
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

#[derive(Clone)]
struct CompatConfig {
    openclaw_command: PathBuf,
    native_config_path: PathBuf,
    native_state_dir: PathBuf,
    agent_id: String,
    temporary_root: PathBuf,
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

struct TurnWorkspace {
    directory: PathBuf,
    overlay_path: PathBuf,
}

impl TurnWorkspace {
    fn create(config: &CompatConfig, servers: &[McpServerStdio]) -> Result<Self, String> {
        let directory = config.temporary_root.join(random_token()?);
        fs::create_dir(&directory).map_err(|_| "turn workspace unavailable".to_owned())?;
        secure_directory(&directory)?;
        let overlay_path = directory.join("openclaw.json");
        let workspace = Self {
            directory,
            overlay_path,
        };
        write_overlay(&workspace.overlay_path, &config.native_config_path, servers)?;
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
    runtime.block_on(async_main(agent_id))
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
    let writer = tokio::spawn(wire::writer_task(wire_rx));
    let mut stdin = BufReader::new(tokio::io::stdin());
    while let Some(line) = wire::read_bounded_line(&mut stdin, MAX_FRAME_BYTES).await? {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(message) => dispatch(Arc::clone(&app), message, &wire_tx).await,
            Err(_) => {
                wire::send(
                    &wire_tx,
                    wire::err(Value::Null, wire::PARSE_ERROR, "jsonrpc: parse failed"),
                )
                .await;
            }
        }
    }
    for session in app.sessions.lock().await.values() {
        let _ = session.cancel_tx.send(true);
    }
    drop(wire_tx);
    let _ = writer.await;
    Ok(())
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
    let temporary_root = PathBuf::from("/tmp").join(format!("luca-oc-{}", random_token()?));
    fs::create_dir(&temporary_root)
        .map_err(|_| "OpenClaw compatibility workspace could not be created".to_owned())?;
    secure_directory(&temporary_root)?;
    Ok(CompatConfig {
        openclaw_command,
        native_config_path,
        native_state_dir,
        agent_id,
        temporary_root,
    })
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

async fn dispatch(app: Arc<CompatApp>, message: Value, wire_tx: &wire::WireSender) {
    match wire::classify(&message) {
        Inbound::Request { id, method, params } => match method.as_str() {
            "initialize" => initialize(id, wire_tx).await,
            "session/new" => session_new(&app, id, params, wire_tx).await,
            "session/prompt" => {
                let tx = wire_tx.clone();
                tokio::spawn(async move { session_prompt(app, id, params, tx).await });
            }
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
    if servers.len() > 2 {
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
            COMMUNICATIONS_SERVER_NAME => {
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
            _ => false,
        };
        if !valid {
            return Err("unsupported MCP projection".into());
        }
    }
    Ok(())
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

async fn session_prompt(app: Arc<CompatApp>, id: Value, params: Value, wire_tx: wire::WireSender) {
    let parsed = serde_json::from_value::<SessionPromptParams>(params);
    let Ok(params) = parsed else {
        return reject(&wire_tx, id, "session/prompt parameters are invalid").await;
    };
    let acquired = {
        let mut sessions = app.sessions.lock().await;
        let Some(session) = sessions.get_mut(&params.session_id) else {
            return reject(&wire_tx, id, "session/prompt session is unavailable").await;
        };
        if session.busy {
            return reject(&wire_tx, id, "session/prompt is already active").await;
        }
        let (cancel_tx, cancel_rx) = watch::channel(false);
        session.cancel_tx = cancel_tx;
        session.busy = true;
        (
            session.cwd.clone(),
            session.mcp_servers.clone(),
            session.system_prompt.clone(),
            cancel_rx,
        )
    };
    let (cwd, mcp_servers, system_prompt, mut cancel_rx) = acquired;
    let mut prompt = prompt_text(&params.prompt);
    if let Some(system_prompt) = system_prompt.filter(|value| !value.is_empty()) {
        prompt = format!("[Base]\n{system_prompt}\n\n{prompt}");
    }
    let result = if prompt.len() > MAX_PROMPT_BYTES {
        Err("OpenClaw prompt exceeds the local bound".to_owned())
    } else {
        run_openclaw_turn(
            &app.config,
            &params.session_id,
            &cwd,
            &mcp_servers,
            &prompt,
            &mut cancel_rx,
        )
        .await
    };
    if let Some(session) = app.sessions.lock().await.get_mut(&params.session_id) {
        session.busy = false;
    }
    match result {
        Ok(Some(text)) => {
            if !text.is_empty() {
                wire::send(
                    &wire_tx,
                    wire::session_update(
                        &params.session_id,
                        json!({
                            "sessionUpdate": "agent_message_chunk",
                            "content": { "type": "text", "text": text }
                        }),
                    ),
                )
                .await;
            }
            wire::send(&wire_tx, wire::ok(id, json!({ "stopReason": "end_turn" }))).await;
        }
        Ok(None) => {
            wire::send(&wire_tx, wire::ok(id, json!({ "stopReason": "cancelled" }))).await;
        }
        Err(_) => {
            wire::send(
                &wire_tx,
                wire::err(id, -32000, "OpenClaw local turn failed"),
            )
            .await;
        }
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
    let turn_workspace = TurnWorkspace::create(config, mcp_servers)?;
    let session_key = openclaw_session_key(&config.agent_id, session_id);
    let command = build_command(
        config,
        &turn_workspace.overlay_path,
        cwd,
        &session_key,
        prompt,
    );
    let mut child = tokio::process::Command::from(command)
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "OpenClaw local turn failed".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "OpenClaw local turn failed".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "OpenClaw local turn failed".to_owned())?;
    let stdout_task = tokio::spawn(read_capped(stdout, MAX_STDOUT_BYTES));
    let stderr_task = tokio::spawn(read_capped(stderr, MAX_STDERR_BYTES));
    let status = tokio::select! {
        status = child.wait() => Some(status.map_err(|_| "OpenClaw local turn failed".to_owned())?),
        changed = cancel_rx.changed() => {
            let _ = changed;
            let _ = child.kill().await;
            let _ = child.wait().await;
            None
        }
    };
    let stdout = stdout_task
        .await
        .map_err(|_| "OpenClaw local turn failed".to_owned())??;
    let _ = stderr_task.await;
    let Some(status) = status else {
        return Ok(None);
    };
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
        .env("OPENCLAW_INCLUDE_ROOTS", &config.native_state_dir)
        .env("OPENCLAW_HIDE_BANNER", "1")
        .env("OPENCLAW_SUPPRESS_NOTES", "1");
    for key in OPENCLAW_BOOTSTRAP_ENV_KEYS {
        command.env_remove(key);
    }
    for key in REPOSITORY_ENV_KEYS {
        command.env_remove(key);
    }
    for key in COMMUNICATIONS_ENV_KEYS {
        command.env_remove(key);
    }
    command
}

fn write_overlay(
    path: &Path,
    native_config_path: &Path,
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
    let overlay = if projected.is_empty() {
        json!({ "$include": native_config_path })
    } else {
        json!({
            "$include": native_config_path,
            "mcp": { "servers": projected },
            "tools": { "alsoAllow": also_allow }
        })
    };
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
    fn child_environment_does_not_inherit_bootstrap_or_repository_capability() {
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path: PathBuf::from("/native/openclaw.json"),
            native_state_dir: PathBuf::from("/native"),
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
        let arguments = command
            .get_args()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!arguments.contains("sha256:"));
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
        let native_config_path = fixture.path().join("native.json");
        std::fs::write(&native_config_path, "{}\n").expect("native config");
        let temporary_root = fixture.path().join("turns");
        std::fs::create_dir(&temporary_root).expect("turn root");
        let config = CompatConfig {
            openclaw_command: PathBuf::from("/opt/openclaw"),
            native_config_path,
            native_state_dir: fixture.path().to_owned(),
            agent_id: "main".into(),
            temporary_root,
        };
        let workspace = TurnWorkspace::create(&config, &[]).expect("turn workspace");
        let directory = workspace.directory.clone();
        assert!(workspace.overlay_path.is_file());
        drop(workspace);
        assert!(!directory.exists());
    }
}

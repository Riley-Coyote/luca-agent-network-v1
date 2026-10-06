//! One guarded native peer send. Native acknowledgement is delivery, not work completion.
//! Hooks are invocation-local native command hooks; no profile or history is edited.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{io::AsyncReadExt as _, process::Command};

use super::{
    codex_cli, native_isolation, RuntimeTaskArgs, RuntimeTaskInputV1, PROTOCOL, SHUTDOWN_BOUND,
};
use crate::{acp::AcpClient, config::RuntimeMessageHookArgs};

const MAX_HOOK_BYTES: usize = 256 * 1024;
const MAX_STATE_BYTES: usize = 32 * 1024;
const COURIER_BOUND: Duration = Duration::from_secs(180);
const CONTROL_BOUND: Duration = Duration::from_secs(8);
const FAILURE: &str =
    "Native Claude delivery was not confirmed. Review the exact target before resending.";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    version: u8,
    generation: String,
    owner_uid: u32,
    expires_at_ms: u64,
    sender_session_id: Option<String>,
    target_session_id: String,
    target_pid: u32,
    target_name: String,
    canonical_cwd: String,
    native_cli: String,
    native_permission_mode: String,
    body_sha256: String,
    list_call_id: Option<String>,
    qualified_address: Option<String>,
    send_call_id: Option<String>,
    acknowledgement_id: Option<String>,
    acknowledgement_ambiguous: bool,
}

fn now_ms() -> Result<u64> {
    u64::try_from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis())
        .map_err(|_| anyhow!("Native peer clock is unavailable"))
}

fn bounded_id(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

fn sha256(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn canonical_mode(mode: &str) -> Option<&str> {
    match mode {
        "manual" => Some("default"),
        mode if super::claude_saved::known_mode(mode) => Some(mode),
        _ => None,
    }
}

fn valid_qualified(address: &str, name: &str) -> bool {
    address
        .strip_prefix(name)
        .and_then(|s| s.strip_prefix(" ["))
        .and_then(|s| s.strip_suffix(']'))
        .is_some_and(|code| {
            code.len() == 6
                && code
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
}

impl Metadata {
    fn validate(&self, generation: &str, uid: u32) -> Result<()> {
        if self.version != 1
            || self.generation != generation
            || !codex_cli::valid_session_id(generation)
            || self.owner_uid != uid
            || now_ms()? >= self.expires_at_ms
            || self.expires_at_ms.saturating_sub(now_ms()?) > 240_000
            || !codex_cli::valid_session_id(&self.target_session_id)
            || self.target_pid == 0
            || !bounded_id(&self.target_name, 256)
            || self.target_name.contains(['[', ']'])
            || !bounded_id(&self.canonical_cwd, 4096)
            || !bounded_id(&self.native_cli, 4096)
            || !Path::new(&self.native_cli).is_absolute()
            || !Path::new(&self.native_cli).is_file()
            || !super::claude_saved::known_mode(&self.native_permission_mode)
            || !Path::new(&self.canonical_cwd).is_absolute()
            || Path::new(&self.canonical_cwd)
                .canonicalize()
                .ok()
                .as_deref()
                != Some(Path::new(&self.canonical_cwd))
            || !Path::new(&self.canonical_cwd).is_dir()
            || Path::new(&self.canonical_cwd).parent().is_none()
            || self.body_sha256.len() != 64
            || !self
                .body_sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || self
                .sender_session_id
                .as_deref()
                .is_some_and(|id| !codex_cli::valid_session_id(id) || id == self.target_session_id)
            || self
                .acknowledgement_id
                .as_deref()
                .is_some_and(|id| !codex_cli::valid_session_id(id))
            || self.qualified_address.as_deref().is_some_and(|address| {
                !valid_qualified(address, &self.target_name) || self.list_call_id.is_none()
            })
            || (self.send_call_id.is_some()
                && (self.qualified_address.is_none() || self.sender_session_id.is_none()))
            || (self.acknowledgement_id.is_some() && self.send_call_id.is_none())
            || [self.list_call_id.as_deref(), self.send_call_id.as_deref()]
                .into_iter()
                .flatten()
                .any(|id| !bounded_id(id, 256))
        {
            bail!("Native peer metadata is invalid or expired");
        }
        Ok(())
    }
}

#[cfg(unix)]
fn secure_file(path: &Path, uid: u32) -> Result<File> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    let before = fs::symlink_metadata(path)?;
    if !before.is_file()
        || before.file_type().is_symlink()
        || before.uid() != uid
        || before.nlink() != 1
        || before.permissions().mode() & 0o777 != 0o600
        || before.len() > MAX_STATE_BYTES as u64
    {
        bail!("Native peer metadata file is not private");
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(nix::fcntl::OFlag::O_NOFOLLOW.bits())
        .open(path)?;
    let after = file.metadata()?;
    if before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.uid() != after.uid()
        || before.len() != after.len()
        || before.modified()? != after.modified()?
    {
        bail!("Native peer metadata changed while opening");
    }
    Ok(file)
}

#[cfg(not(unix))]
fn secure_file(_: &Path, _: u32) -> Result<File> {
    bail!("Native peer hooks require Unix ownership checks")
}

fn validate_parent(path: &Path, generation: &str, uid: u32) -> Result<PathBuf> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("Native peer metadata parent is missing"))?;
    if !path.is_absolute()
        || path.file_name().and_then(|s| s.to_str()) != Some("request.json")
        || parent.file_name().and_then(|s| s.to_str())
            != Some(format!("polyphonic-peer-{generation}").as_str())
        || parent.canonicalize()?.as_path() != parent
    {
        bail!("Native peer hook path is not an exact generation");
    }
    let metadata = fs::symlink_metadata(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || metadata.uid() != uid
            || metadata.permissions().mode() & 0o777 != 0o700
        {
            bail!("Native peer metadata directory is not private");
        }
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        bail!("Native peer hooks require Unix ownership checks");
    }
    Ok(parent.to_owned())
}

struct StateLock(PathBuf);
impl Drop for StateLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn acquire(path: &Path, generation: &str, uid: u32) -> Result<(StateLock, File, Metadata)> {
    let parent = validate_parent(path, generation, uid)?;
    let lock = parent.join("request.lock");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let _lock_file = options.open(&lock)?;
    let guard = StateLock(lock);
    let mut file = secure_file(path, uid)?;
    let mut bytes = Vec::new();
    (&mut file)
        .take((MAX_STATE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_STATE_BYTES {
        bail!("Native peer metadata exceeds its bound");
    }
    let metadata: Metadata = serde_json::from_slice(&bytes)?;
    metadata.validate(generation, uid)?;
    Ok((guard, file, metadata))
}

fn save(file: &mut File, metadata: &Metadata) -> Result<()> {
    let bytes = serde_json::to_vec(metadata)?;
    if bytes.len() > MAX_STATE_BYTES {
        bail!("Native peer metadata exceeds its bound");
    }
    file.seek(SeekFrom::Start(0))?;
    file.set_len(0)?;
    file.write_all(&bytes)?;
    file.sync_data()?;
    Ok(())
}

struct PrivateState {
    path: PathBuf,
    generation: String,
    uid: u32,
}

impl PrivateState {
    fn create(mut metadata: Metadata) -> Result<Self> {
        let generation = uuid::Uuid::new_v4().to_string();
        metadata.generation = generation.clone();
        let directory = std::env::temp_dir()
            .canonicalize()?
            .join(format!("polyphonic-peer-{generation}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&directory)?;
        let path = directory.join("request.json");
        let state = Self {
            path,
            generation,
            uid: metadata.owner_uid,
        };
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&state.path)?;
        save(&mut file, &metadata)?;
        // Validate the exact mode/owner/locator before exposing a hook command.
        let (_lock, _file, _metadata) = acquire(&state.path, &state.generation, state.uid)?;
        Ok(state)
    }

    fn bind_sender(&self, session: &str) -> Result<()> {
        let (_guard, mut file, mut metadata) = acquire(&self.path, &self.generation, self.uid)?;
        if metadata.sender_session_id.is_some()
            || !codex_cli::valid_session_id(session)
            || session == metadata.target_session_id
        {
            bail!("Native courier did not create an exact fresh sender");
        }
        metadata.sender_session_id = Some(session.into());
        save(&mut file, &metadata)
    }

    fn acknowledgement(&self) -> Result<String> {
        let (_guard, _file, metadata) = acquire(&self.path, &self.generation, self.uid)?;
        if metadata.acknowledgement_ambiguous {
            bail!("Native peer acknowledgement is ambiguous");
        }
        metadata
            .acknowledgement_id
            .ok_or_else(|| anyhow!("Native peer acknowledgement is missing"))
    }
}

impl Drop for PrivateState {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        if let Some(parent) = self.path.parent() {
            let _ = fs::remove_file(parent.join("request.lock"));
            // Never remove unknown files recursively, even from our owned temp directory.
            let _ = fs::remove_dir(parent);
        }
    }
}

async fn bounded_stdout(mut command: Command, limit: usize) -> Result<Vec<u8>> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    native_isolation::scrub_environment(&mut command);
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Native control output is unavailable"))?;
    let operation = async {
        let mut bytes = Vec::new();
        stdout
            .take((limit + 1) as u64)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > limit || !child.wait().await?.success() {
            bail!("Native control output is unverified");
        }
        Ok(bytes)
    };
    let outcome = match tokio::time::timeout(CONTROL_BOUND, operation).await {
        Ok(result) => result,
        Err(_) => Err(anyhow!("Native control timed out")),
    };
    if outcome.is_err() {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    }
    outcome
}

async fn current_uid() -> Result<u32> {
    let mut command = Command::new("/usr/bin/id");
    command.arg("-u");
    let bytes = bounded_stdout(command, 32).await?;
    Ok(std::str::from_utf8(&bytes)?.trim().parse()?)
}

fn exact_live_target(snapshot: &Value, metadata: &Metadata) -> Result<()> {
    let rows = snapshot
        .as_array()
        .filter(|rows| rows.len() <= 4096)
        .ok_or_else(|| anyhow!("Native catalogue is unsupported"))?;
    for row in rows {
        if !row
            .get("sessionId")
            .and_then(Value::as_str)
            .is_some_and(codex_cli::valid_session_id)
            || !row
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| bounded_id(name, 256))
            || !row
                .get("cwd")
                .and_then(Value::as_str)
                .is_some_and(|cwd| bounded_id(cwd, 4096) && Path::new(cwd).is_absolute())
            || row.get("pid").is_some_and(|value| {
                !value.is_null()
                    && !value
                        .as_u64()
                        .is_some_and(|pid| pid > 0 && u32::try_from(pid).is_ok())
            })
            || !matches!(
                row.get("kind").and_then(Value::as_str),
                Some("interactive" | "background")
            )
            || !matches!(
                row.get("status").and_then(Value::as_str),
                Some("idle" | "busy" | "waiting" | "working" | "blocked")
            )
        {
            bail!("Native catalogue contains unsupported identities");
        }
    }
    let selected = rows
        .iter()
        .filter(|row| row["sessionId"] == metadata.target_session_id)
        .collect::<Vec<_>>();
    if selected.len() != 1 {
        bail!("Native receiver is missing or ambiguous");
    }
    let row = selected[0];
    if row["pid"].as_u64() != Some(u64::from(metadata.target_pid))
        || row["name"] != metadata.target_name
        || row["kind"] != "interactive"
        || !matches!(row["status"].as_str(), Some("idle" | "busy"))
        || row["cwd"]
            .as_str()
            .and_then(|cwd| Path::new(cwd).canonicalize().ok())
            .as_deref()
            != Some(Path::new(&metadata.canonical_cwd))
        || rows
            .iter()
            .filter(|row| row["name"] == metadata.target_name)
            .count()
            != 1
    {
        bail!("Native receiver was replaced, renamed, unavailable or ambiguous");
    }
    Ok(())
}

async fn recheck_target(metadata: &Metadata) -> Result<()> {
    let mut command = Command::new(&metadata.native_cli);
    command
        .args(["agents", "--json"])
        .current_dir(&metadata.canonical_cwd);
    let snapshot = bounded_stdout(command, MAX_HOOK_BYTES).await?;
    exact_live_target(&serde_json::from_slice(&snapshot)?, metadata)
}

fn deny() -> Value {
    json!({"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"PreToolUse",
        "permissionDecision":"deny","permissionDecisionReason":"This courier permits one exact owner-approved native peer message only."}})
}

fn response_text(response: &Value) -> Result<String> {
    if let Some(listing) = response
        .as_object()
        .filter(|object| object.len() == 1)
        .and_then(|object| object.get("listing"))
        .and_then(Value::as_str)
    {
        if listing.len() <= MAX_HOOK_BYTES {
            return Ok(listing.to_owned());
        }
    }
    if let Some(text) = response.as_str() {
        if text.len() <= MAX_HOOK_BYTES {
            return Ok(text.to_owned());
        }
    }
    let blocks = response
        .as_array()
        .or_else(|| response.get("content").and_then(Value::as_array));
    if let Some(blocks) = blocks.filter(|blocks| blocks.len() <= 64) {
        let mut text = String::new();
        for block in blocks {
            if block.get("type").and_then(Value::as_str) != Some("text") {
                bail!("Native peer result contains unsupported content");
            }
            let part = block
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("Native peer result is not text"))?;
            if text.len().saturating_add(part.len()).saturating_add(1) > MAX_HOOK_BYTES {
                bail!("Native peer result exceeds its bound");
            }
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(part);
        }
        return Ok(text);
    }
    bail!("Native peer result shape is unsupported")
}

fn qualified_address(response: &Value, name: &str) -> Result<String> {
    let text = response_text(response)?;
    let mut matches = Vec::new();
    for line in text.lines() {
        let parts = line.trim().split('·').map(str::trim).collect::<Vec<_>>();
        let Some(address) = parts.first() else {
            continue;
        };
        let Some(suffix) = address
            .strip_prefix(name)
            .and_then(|s| s.strip_prefix(" ["))
            .and_then(|s| s.strip_suffix(']'))
        else {
            continue;
        };
        if suffix.len() != 6
            || !suffix
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || parts.get(1) != Some(&"interactive")
            || !matches!(parts.get(2).copied(), Some("idle" | "busy"))
        {
            bail!("Native peer listing has an unsupported target address or state");
        }
        matches.push((*address).to_owned());
    }
    if matches.len() != 1 {
        bail!("Native peer listing is missing or ambiguous");
    }
    Ok(matches.remove(0))
}

fn success_ack(response: &Value) -> Result<String> {
    let parsed;
    let response = if response.is_object() && response.get("success").is_some() {
        response
    } else {
        parsed = serde_json::from_str::<Value>(&response_text(response)?)?;
        &parsed
    };
    if response.get("success") != Some(&Value::Bool(true)) {
        bail!("Native message was not acknowledged");
    }
    response
        .get("msg_id")
        .and_then(Value::as_str)
        .filter(|id| codex_cli::valid_session_id(id))
        .map(str::to_owned)
        .ok_or_else(|| anyhow!("Native acknowledgement has no exact message UUID"))
}

fn validate_hook_scope<'a>(
    metadata: &Metadata,
    input: &'a Value,
) -> Result<(&'a str, &'a str, &'a str)> {
    let sender = metadata
        .sender_session_id
        .as_deref()
        .ok_or_else(|| anyhow!("Native courier sender is not bound"))?;
    if input.get("session_id").and_then(Value::as_str) != Some(sender)
        || input.get("cwd").and_then(Value::as_str) != Some(metadata.canonical_cwd.as_str())
        || input
            .get("permission_mode")
            .and_then(Value::as_str)
            .and_then(canonical_mode)
            != Some(metadata.native_permission_mode.as_str())
    {
        bail!("Native peer hook changed sender, working folder or policy");
    }
    let event = input
        .get("hook_event_name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Native peer event is missing"))?;
    let tool = input
        .get("tool_name")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Native peer tool is missing"))?;
    let id = input
        .get("tool_use_id")
        .and_then(Value::as_str)
        .filter(|id| bounded_id(id, 256))
        .ok_or_else(|| anyhow!("Native tool correlation is missing"))?;
    if !matches!(event, "PreToolUse" | "PostToolUse")
        || !matches!(tool, "ListAgents" | "SendMessage")
    {
        bail!("This tool is not in the native courier projection");
    }
    Ok((event, tool, id))
}

fn exact_message(metadata: &Metadata, input: &Value) -> Result<Value> {
    let address = metadata
        .qualified_address
        .as_deref()
        .ok_or_else(|| anyhow!("Native receiver address was not listed"))?;
    let parameters = input
        .get("tool_input")
        .and_then(Value::as_object)
        .ok_or_else(|| anyhow!("Native send input is missing"))?;
    let message = parameters
        .get("message")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Native send has no exact message"))?;
    if parameters.get("to").and_then(Value::as_str) != Some(address)
        || message.len() > 64 * 1024
        || sha256(message) != metadata.body_sha256
    {
        bail!("Native recipient or message differs from owner consent");
    }
    // updatedInput replaces the entire object, stripping legacy recipient,
    // content, type, notification subscriptions and every other extra field.
    Ok(json!({"to":address,"message":message}))
}

fn apply_hook(metadata: &mut Metadata, input: &Value) -> Result<Value> {
    let (event, tool, id) = validate_hook_scope(metadata, input)?;
    if metadata.acknowledgement_ambiguous {
        bail!("Native acknowledgement is already ambiguous");
    }
    match (event, tool) {
        ("PreToolUse", "ListAgents") => {
            if metadata.list_call_id.is_some()
                || metadata.send_call_id.is_some()
                || !input.get("tool_input").is_some_and(Value::is_object)
            {
                bail!("Native receiver listing may run only once");
            }
            metadata.list_call_id = Some(id.into());
            Ok(
                json!({"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{}}}),
            )
        }
        ("PostToolUse", "ListAgents") => {
            if metadata.list_call_id.as_deref() != Some(id)
                || metadata.qualified_address.is_some()
                || metadata.send_call_id.is_some()
            {
                bail!("Native listing response is stale or duplicated");
            }
            if input.get("tool_input") != Some(&json!({})) {
                bail!("Native listing input changed after validation");
            }
            metadata.qualified_address = Some(qualified_address(
                &input["tool_response"],
                &metadata.target_name,
            )?);
            Ok(json!({"suppressOutput":true}))
        }
        ("PreToolUse", "SendMessage") => {
            if metadata.send_call_id.is_some()
                || metadata.acknowledgement_id.is_some()
                || metadata.list_call_id.as_deref() == Some(id)
            {
                bail!("Native peer send may run only once with a distinct tool identity");
            }
            let updated = exact_message(metadata, input)?;
            metadata.send_call_id = Some(id.into());
            Ok(
                json!({"suppressOutput":true,"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":updated}}),
            )
        }
        ("PostToolUse", "SendMessage") => {
            if metadata.acknowledgement_id.is_some() {
                metadata.acknowledgement_ambiguous = true;
                bail!("Native acknowledgement was duplicated");
            }
            if metadata.send_call_id.as_deref() != Some(id) {
                bail!("Native acknowledgement has the wrong tool identity");
            }
            if !input
                .get("tool_input")
                .and_then(Value::as_object)
                .is_some_and(|object| {
                    object.len() == 2 && object.contains_key("to") && object.contains_key("message")
                })
            {
                bail!("Native send retained unsupported fields after input replacement");
            }
            let _ = exact_message(metadata, input)?;
            metadata.acknowledgement_id = Some(success_ack(&input["tool_response"])?);
            Ok(json!({"suppressOutput":true}))
        }
        _ => bail!("Native peer event is unsupported"),
    }
}

async fn hook_operation(args: &RuntimeMessageHookArgs, input: &Value) -> Result<Value> {
    let uid = current_uid().await?;
    let (_guard, mut file, mut metadata) = acquire(&args.metadata, &args.generation, uid)?;
    let (event, tool, _) = validate_hook_scope(&metadata, input)?;
    // Only native public discovery may authorize the name-to-UUID mapping;
    // model prose and an old filesystem transcript are never live authority.
    if event == "PreToolUse" || tool == "ListAgents" {
        recheck_target(&metadata).await?;
    }
    let output = apply_hook(&mut metadata, input);
    // Persist an ambiguous native acknowledgement as a failure, not a prior pass.
    save(&mut file, &metadata)?;
    output
}

/// Entry point for the native command hook. Every PreToolUse failure is a deny.
pub(crate) async fn run_hook(args: RuntimeMessageHookArgs) -> Result<()> {
    let mut bytes = Vec::new();
    let input = std::io::stdin()
        .take((MAX_HOOK_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(anyhow::Error::from)
        .and_then(|_| {
            if bytes.is_empty() || bytes.len() > MAX_HOOK_BYTES {
                bail!("Native hook input exceeds its bound");
            }
            Ok(serde_json::from_slice::<Value>(&bytes)?)
        });
    let output = match input {
        Ok(input) => match hook_operation(&args, &input).await {
            Ok(output) => output,
            Err(_)
                if input.get("hook_event_name").and_then(Value::as_str) == Some("PostToolUse") =>
            {
                json!({"continue":false,"suppressOutput":true,"systemMessage":"Native delivery guard did not verify this result."})
            }
            Err(_) => deny(),
        },
        Err(_) => deny(),
    };
    println!("{}", serde_json::to_string(&output)?);
    Ok(())
}

fn shell_quote(value: &str) -> Result<String> {
    if !bounded_id(value, 8192) {
        bail!("Native hook command path is invalid");
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

fn session_metadata(state: &PrivateState, executable: &Path, mode: &str) -> Result<Value> {
    let executable = executable
        .to_str()
        .ok_or_else(|| anyhow!("Native hook executable is invalid"))?;
    let path = state
        .path
        .to_str()
        .ok_or_else(|| anyhow!("Native hook path is invalid"))?;
    let command = format!("{} runtime-message-hook --metadata {} --generation {} || {{ printf '%s\\n' 'Native delivery guard unavailable.' >&2; exit 2; }}",
        shell_quote(executable)?, shell_quote(path)?, shell_quote(&state.generation)?);
    let hook = json!({"type":"command","command":command,"timeout":40});
    Ok(json!({"claudeCode":{"options":{
        "tools":["ListAgents","SendMessage"],"persistSession":false,"permissionMode":mode,
        "extraArgs":{"strict-mcp-config":null},
        "settings":{"hooks":{
            "PreToolUse":[{"matcher":"*","hooks":[hook.clone()]}],
            "PostToolUse":[{"matcher":"ListAgents|SendMessage","hooks":[hook]}]
        }}
    }}}))
}

fn prepare_metadata(input: &RuntimeTaskInputV1, uid: u32) -> Result<Metadata> {
    let native_cli = input
        .native_cli
        .clone()
        .ok_or_else(|| anyhow!("Native CLI is missing"))?;
    super::claude_saved::validate_coordinates(&native_cli, &input.working_folder)?;
    let metadata = Metadata {
        version: 1,
        generation: uuid::Uuid::new_v4().to_string(),
        owner_uid: uid,
        expires_at_ms: now_ms()?.saturating_add(COURIER_BOUND.as_millis() as u64),
        sender_session_id: None,
        target_session_id: input
            .provider_session_id
            .clone()
            .ok_or_else(|| anyhow!("Native target UUID is missing"))?,
        target_pid: input
            .native_target_pid
            .ok_or_else(|| anyhow!("Native target PID is missing"))?,
        target_name: input
            .native_target_name
            .clone()
            .ok_or_else(|| anyhow!("Native target name is missing"))?,
        canonical_cwd: input.working_folder.clone(),
        native_cli,
        native_permission_mode: input
            .native_permission_mode
            .clone()
            .ok_or_else(|| anyhow!("Native receiver policy is unknown"))?,
        body_sha256: sha256(&input.prompt),
        list_call_id: None,
        qualified_address: None,
        send_call_id: None,
        acknowledgement_id: None,
        acknowledgement_ambiguous: false,
    };
    if input.operation != super::RuntimeTaskOperation::SendMessage
        || input.permission_mode != "normal"
        || input.runtime_family.as_deref() != Some("claude_code")
        || !super::valid_opaque(&input.task_id)
        || !super::valid_opaque(&input.conversation_id)
        || input.prompt.trim().is_empty()
        || input.prompt.len() > 64 * 1024
    {
        bail!("Native message input is not a normal-policy Claude send");
    }
    metadata.validate(&metadata.generation, uid)?;
    Ok(metadata)
}

fn mode_acknowledged(response: &Value, requested: &str) -> bool {
    let Some(options) = response.get("configOptions").and_then(Value::as_array) else {
        return false;
    };
    let modes = options
        .iter()
        .filter(|option| {
            option
                .get("id")
                .or_else(|| option.get("configId"))
                .and_then(Value::as_str)
                == Some("mode")
        })
        .collect::<Vec<_>>();
    modes.len() == 1 && modes[0].get("currentValue").and_then(Value::as_str) == Some(requested)
}

async fn set_sender_mode(client: &mut AcpClient, session: &str, requested: &str) -> Result<()> {
    if !super::claude_saved::known_mode(requested) {
        bail!("Native courier policy is unknown");
    }
    // The installed adapter overrides creation-time permissionMode options.
    // Set only our fresh sender, then require the adapter's exact config ack.
    let response = client
        .session_set_config_option(session, "mode", requested)
        .await?;
    if !mode_acknowledged(&response, requested) {
        bail!("Native courier policy did not acknowledge the verified receiver mode");
    }
    Ok(())
}

async fn courier(args: RuntimeTaskArgs, input: &RuntimeTaskInputV1) -> Result<String> {
    if args.agent.agent_args.iter().any(|arg| !arg.is_empty())
        || !Path::new(&args.agent.agent_command).is_absolute()
        || !Path::new(&args.agent.agent_command).is_file()
    {
        bail!("Native courier adapter is not exact");
    }
    let mut signals = codex_cli::StopSignals::new()
        .map_err(|_| anyhow!("Native courier stop handler is unavailable"))?;
    let metadata = prepare_metadata(input, current_uid().await?)?;
    recheck_target(&metadata).await?;
    let mode = metadata.native_permission_mode.clone();
    let state = PrivateState::create(metadata)?;
    let meta = session_metadata(&state, &std::env::current_exe()?, &mode)?;
    native_isolation::discard_inherited_descriptors()
        .map_err(|_| anyhow!("Native courier isolation is unverified"))?;
    let mut client = AcpClient::spawn_managed(&args.agent.agent_command, &[], &[], false).await?;
    client.deny_unmanaged_permissions();
    // No observer, resident prompt, managed MCP projection or final capture is installed.
    let operation = async {
        client.initialize().await?;
        let session = client
            .session_new_full_with_meta(&input.working_folder, Vec::new(), None, Some(meta))
            .await?;
        state.bind_sender(&session.session_id)?;
        set_sender_mode(&mut client, &session.session_id, &mode).await?;
        let prompt = format!("Deliver one owner-approved message, then stop. First call ListAgents once. Find the unique idle or busy interactive native session named {}. SendMessage once to its exact full qualified name [6-character code] copied from that result, never a bare name, UUID, @code, teammate or fallback. Use only to and message. The exact message is the decoded JSON string {}. Do not change its bytes. Do not ask the receiver to reply to you. Inbox acceptance is not steering or completion of the receiver's work.",
            serde_json::to_string(input.native_target_name.as_deref().unwrap_or_default())?, serde_json::to_string(&input.prompt)?);
        let _ = client
            .session_prompt_with_idle_timeout(
                &session.session_id,
                &prompt,
                Duration::from_secs(60),
                COURIER_BOUND,
            )
            .await?;
        Ok::<(), anyhow::Error>(())
    };
    let _provider_outcome = tokio::select! {
        result = tokio::time::timeout(COURIER_BOUND, operation) => result.map_err(|_| anyhow!("Native courier timed out")).and_then(|r|r),
        () = signals.wait() => Err(anyhow!("Native courier was stopped")),
    };
    let shutdown = tokio::time::timeout(SHUTDOWN_BOUND, client.shutdown()).await;
    if shutdown.is_err() || client.owned_process_id().is_some() {
        bail!("Native courier shutdown was not verified");
    }
    // Native PostToolUse evidence, not assistant prose or end_turn, is the only ack.
    state.acknowledgement()
}

/// Send through the user's native cross-session tools; never emit task completion.
pub(super) async fn run(args: RuntimeTaskArgs, input: &RuntimeTaskInputV1) -> Result<()> {
    let outcome = courier(args, input).await;
    let frame = match outcome {
        Ok(id) => json!({"protocol":PROTOCOL,"kind":"native_ack",
            "providerSessionId":input.provider_session_id,"nativeAcknowledgementId":id}),
        Err(_) => json!({"protocol":PROTOCOL,"kind":"failed","error":FAILURE}),
    };
    println!("{}", serde_json::to_string(&frame)?);
    Ok(())
}

#[cfg(test)]
#[path = "claude_peer_tests.rs"]
mod tests;

//! Opt-in, cost-bounded API writing through the native CLI's supported no-tool
//! mode. No credentials, provider SDK, sessions, or configuration are stored.

use futures_util::StreamExt as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt as _, AsyncWriteExt as _},
    process::Command,
};
use tokio_util::codec::{FramedRead, LinesCodec};
use zeroize::Zeroizing;

use super::{
    codex_cli::{OwnedWorker, StopSignals},
    codex_events::NativeFailure,
    emit, RuntimeTaskArgs, RuntimeTaskInputV1, RuntimeTaskOperation, RuntimeTaskOutputV1, PROTOCOL,
};

pub(super) const BOOTSTRAP_KEY: &str = "LUCA_RUNTIME_TASK_CLAUDE_API_KEY";
const MAX_LINE: usize = 1024 * 1024;
const MAX_TOTAL: usize = 4 * 1024 * 1024;
const MAX_RESULT: usize = 256 * 1024;
const FLAGS: &[&str] = &[
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Input {
    executable: String,
    max_budget_usd: String,
}

fn invalid() -> NativeFailure {
    NativeFailure::Protocol
}

fn prepare<'a>(input: &'a RuntimeTaskInputV1) -> Result<(&'a Input, &'a str), NativeFailure> {
    let route = input.claude_api_ask.as_ref().ok_or_else(invalid)?;
    let model = input.options.model.as_deref().ok_or_else(invalid)?;
    // Aliases can migrate to a different model without an owner review.
    if input.operation != RuntimeTaskOperation::NewTask
        || input.options.purpose != luca_protocol::RuntimeTaskPurposeV1::Ask
        || input.permission_mode != "normal"
        || route.max_budget_usd != "0.25"
        || !model.starts_with("claude-")
        || model.ends_with("-latest")
        || model.len() > 128
        || !model
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.'))
        || input
            .options
            .effort
            .as_deref()
            .is_some_and(|v| !matches!(v, "low" | "medium" | "high" | "xhigh" | "max"))
    {
        return Err(invalid());
    }
    let executable = Path::new(&route.executable);
    let folder = Path::new(&input.working_folder);
    if !executable.is_absolute()
        || !executable.is_file()
        || executable.canonicalize().ok().as_deref() != Some(executable)
        || !folder.is_absolute()
        || !folder.is_dir()
        || folder.canonicalize().ok().as_deref() != Some(folder)
    {
        return Err(NativeFailure::InvalidTarget);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        if folder
            .metadata()
            .map_err(|_| NativeFailure::Isolation)?
            .permissions()
            .mode()
            & 0o077
            != 0
        {
            return Err(NativeFailure::Isolation);
        }
    }
    Ok((route, model))
}

fn base_command(executable: &str, folder: &str) -> Command {
    let mut command = Command::new(executable);
    command.env_clear();
    // No native account/profile, provider overrides, debug options, Node
    // injection, resident identity, or bootstrap key reaches the CLI/probe.
    for key in [
        "HOME",
        "PATH",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "SYSTEMROOT",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .current_dir(folder)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    command
}

fn capabilities(help: &str, effort: bool) -> bool {
    FLAGS.iter().all(|flag| {
        help.lines()
            .any(|line| line.split_whitespace().any(|word| word == *flag))
    }) && (!effort || help.contains("--effort"))
        && help.contains("Use \"\" to disable all")
}

async fn probe(route: &Input, folder: &str, effort: bool) -> Result<(), NativeFailure> {
    let mut command = base_command(&route.executable, folder);
    command.arg("--help").stdin(Stdio::null());
    let mut worker = OwnedWorker::spawn(command)?;
    let result = tokio::time::timeout(Duration::from_secs(5), async {
        let stdout = worker.child.stdout.take().ok_or_else(invalid)?;
        let mut bytes = Vec::new();
        stdout
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| invalid())?;
        if bytes.len() > 64 * 1024 {
            return Err(NativeFailure::OutputBound);
        }
        let status = worker.child.wait().await.map_err(|_| invalid())?;
        let help = std::str::from_utf8(&bytes).map_err(|_| invalid())?;
        if !status.success() || !capabilities(help, effort) {
            return Err(invalid());
        }
        Ok(())
    })
    .await
    .map_err(|_| NativeFailure::Timeout)?;
    if result.is_err() {
        worker.stop().await;
    }
    result
}

fn ask_command(
    route: &Input,
    input: &RuntimeTaskInputV1,
    model: &str,
    session: &str,
    key: &str,
) -> Command {
    let mut command = base_command(&route.executable, &input.working_folder);
    command.args([
        "--print",
        "--bare",
        "--restricted",
        "--tools",
        "",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        "--setting-sources",
        "",
        "--settings",
        "{}",
        "--no-session-persistence",
        "--no-chrome",
        "--permission-prompts",
        "none",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--session-id",
        session,
        "--max-budget-usd",
        &route.max_budget_usd,
    ]);
    if let Some(effort) = input.options.effort.as_deref() {
        command.args(["--effort", effort]);
    }
    command
        .env("ANTHROPIC_API_KEY", key)
        .env("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        .env("CLAUDE_CODE_USE_BEDROCK", "0")
        .env("CLAUDE_CODE_USE_VERTEX", "0")
        .env("CLAUDE_CODE_USE_FOUNDRY", "0");
    command
}

pub(super) async fn run(args: &RuntimeTaskArgs, input: &RuntimeTaskInputV1) -> anyhow::Result<()> {
    let session = uuid::Uuid::new_v4().to_string();
    let result = async {
        let (route,model) = prepare(input)?;
        let key = Zeroizing::new(std::env::var(BOOTSTRAP_KEY).map_err(|_| NativeFailure::Isolation)?);
        if key.is_empty() || key.len() > 8192 || !key.bytes().all(|c|c.is_ascii_graphic()) { return Err(NativeFailure::Isolation); }
        super::native_isolation::discard_inherited_descriptors()?;
        let mut signals = StopSignals::new()?;
        tokio::select! {
            value = probe(route,&input.working_folder,input.options.effort.is_some()) => value?,
            () = signals.wait() => return Err(NativeFailure::Interrupted),
        }
        let mut worker = OwnedWorker::spawn(ask_command(route,input,model,&session,&key))?;
        let idle = Duration::from_secs(args.idle_timeout_secs.clamp(30,3_600));
        let outcome = tokio::select! {
            result = tokio::time::timeout(Duration::from_secs(args.max_duration_secs.clamp(60,3_600)), consume(&mut worker.child,input,&session,model,idle)) => result.unwrap_or(Err(NativeFailure::Timeout)),
            () = signals.wait() => Err(NativeFailure::Interrupted),
        };
        if outcome.is_err() { worker.stop().await; }
        outcome
    }.await;
    match result {
        Ok(result) => emit_ask_result(&session, &result),
        Err(_) => emit(RuntimeTaskOutputV1 { protocol:PROTOCOL,kind:"failed",provider_session_id:None,label:None,result:None,stop_reason:None,error:Some("The pinned Claude API Ask could not verify its no-tool policy, exact model, budget, or completion. No fallback was used."),plan:None }),
    }
    Ok(())
}

struct Outcome {
    text: String,
    cost: f64,
}

fn emit_ask_result(session: &str, result: &Outcome) {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Output<'a> {
        #[serde(flatten)]
        base: RuntimeTaskOutputV1<'a>,
        actual_cost_usd: f64,
        budget_exceeded: bool,
    }
    // Return already-completed authorized writing honestly even if the native
    // CLI reports an overrun of its budget threshold. Never retry it.
    let output = Output {
        base: RuntimeTaskOutputV1 {
            protocol: PROTOCOL,
            kind: "result",
            provider_session_id: Some(session),
            label: None,
            result: Some(&result.text),
            stop_reason: Some("end_turn"),
            error: None,
            plan: None,
        },
        actual_cost_usd: result.cost,
        budget_exceeded: result.cost > 0.25,
    };
    if let Ok(frame) = serde_json::to_string(&output) {
        println!("{frame}");
    }
}

async fn consume(
    child: &mut tokio::process::Child,
    input: &RuntimeTaskInputV1,
    session: &str,
    model: &str,
    idle: Duration,
) -> Result<Outcome, NativeFailure> {
    let mut stdin = child.stdin.take().ok_or_else(invalid)?;
    let stdout = child.stdout.take().ok_or_else(invalid)?;
    tokio::time::timeout(idle, async {
        stdin
            .write_all(input.prompt.as_bytes())
            .await
            .map_err(|_| invalid())?;
        stdin.shutdown().await.map_err(|_| invalid())
    })
    .await
    .map_err(|_| NativeFailure::Timeout)??;
    drop(stdin);
    let mut lines = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_LINE));
    let mut events = Events::new(session, model);
    while let Some(line) = tokio::time::timeout(idle, lines.next())
        .await
        .map_err(|_| NativeFailure::Timeout)?
    {
        let line = line.map_err(|_| NativeFailure::OutputBound)?;
        if events.accept(&line)? {
            emit(RuntimeTaskOutputV1 {
                protocol: PROTOCOL,
                kind: "session",
                provider_session_id: Some(session),
                label: None,
                result: None,
                stop_reason: None,
                error: None,
                plan: None,
            });
        }
    }
    let status = tokio::time::timeout(idle, child.wait())
        .await
        .map_err(|_| NativeFailure::Timeout)?
        .map_err(|_| NativeFailure::Exit)?;
    events.finish(status.success())
}

// Typed coordinates reject duplicate security-significant fields. Opaque
// provider envelopes are ignored, never forwarded into receipts or logs.
#[derive(Deserialize)]
struct Frame {
    #[serde(rename = "type")]
    kind: String,
    session_id: String,
    subtype: Option<String>,
    model: Option<String>,
    tools: Option<Vec<String>>,
    mcp_servers: Option<Vec<Value>>,
    #[serde(rename = "apiKeySource")]
    api_key_source: Option<String>,
    message: Option<Message>,
    is_error: Option<bool>,
    result: Option<String>,
    total_cost_usd: Option<f64>,
    usage: Option<Usage>,
    #[serde(rename = "modelUsage")]
    model_usage: Option<std::collections::BTreeMap<String, ModelUsage>>,
}
#[derive(Deserialize)]
struct Message {
    model: String,
    content: Vec<Block>,
}
#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Deserialize)]
struct Usage {
    input_tokens: u64,
    output_tokens: u64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelUsage {
    input_tokens: u64,
    output_tokens: u64,
}

struct Events<'a> {
    session: &'a str,
    model: &'a str,
    initialized: bool,
    result: Option<Outcome>,
    bytes: usize,
}
impl<'a> Events<'a> {
    fn new(session: &'a str, model: &'a str) -> Self {
        Self {
            session,
            model,
            initialized: false,
            result: None,
            bytes: 0,
        }
    }
    fn accept(&mut self, line: &str) -> Result<bool, NativeFailure> {
        self.bytes = self
            .bytes
            .checked_add(line.len())
            .ok_or(NativeFailure::OutputBound)?;
        if self.bytes > MAX_TOTAL || self.result.is_some() {
            return Err(invalid());
        }
        let value: Frame = serde_json::from_str(line).map_err(|_| invalid())?;
        if value.session_id != self.session {
            return Err(NativeFailure::SessionMismatch);
        }
        match value.kind.as_str() {
            "system" if value.subtype.as_deref() == Some("init") && !self.initialized => {
                if value.model.as_deref() != Some(self.model)
                    || !value.tools.as_ref().is_some_and(Vec::is_empty)
                    || !value.mcp_servers.as_ref().is_some_and(Vec::is_empty)
                    || value.api_key_source.as_deref() != Some("ANTHROPIC_API_KEY")
                {
                    return Err(invalid());
                }
                self.initialized = true;
                Ok(true)
            }
            "assistant" if self.initialized => {
                let message = value.message.ok_or_else(invalid)?;
                if message.model != self.model
                    || !message.content.iter().all(|b| {
                        matches!(b.kind.as_str(), "text" | "thinking" | "redacted_thinking")
                    })
                {
                    return Err(invalid());
                }
                Ok(false)
            }
            "result" if self.initialized => {
                let cost = value.total_cost_usd.ok_or_else(invalid)?;
                let usage = value.usage.ok_or_else(invalid)?;
                let models = value.model_usage.ok_or_else(invalid)?;
                let result = value.result.ok_or_else(invalid)?;
                if value.subtype.as_deref() != Some("success")
                    || value.is_error != Some(false)
                    || !cost.is_finite()
                    || cost < 0.0
                    || usage.output_tokens == 0
                    || usage
                        .input_tokens
                        .checked_add(usage.output_tokens)
                        .is_none()
                    || models.len() != 1
                    || !models.get(self.model).is_some_and(|m| {
                        m.output_tokens > 0 && m.input_tokens.checked_add(m.output_tokens).is_some()
                    })
                    || result.trim().is_empty()
                    || result.len() > MAX_RESULT
                {
                    return Err(invalid());
                }
                self.result = Some(Outcome { text: result, cost });
                Ok(false)
            }
            _ => Err(invalid()),
        }
    }
    fn finish(self, success: bool) -> Result<Outcome, NativeFailure> {
        if !success || !self.initialized {
            return Err(NativeFailure::Exit);
        }
        self.result.ok_or(NativeFailure::MissingCompletion)
    }
}

#[cfg(test)]
#[path = "claude_api_ask_tests.rs"]
mod tests;

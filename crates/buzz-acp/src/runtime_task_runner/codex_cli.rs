//! Saved-session continuation through the public, owned Codex CLI transport.
//!
//! This is not an attachment to a running app-owned controller. The desktop
//! must independently resolve a saved CLI target and exclude app-owned work.

use std::{path::PathBuf, process::Stdio, time::Duration};

use anyhow::Result;
use futures_util::StreamExt as _;
use luca_protocol::{NativeCodexPolicyV1, NativeCodexSandboxV1};
use tokio::{io::AsyncWriteExt as _, process::Command};
use tokio_util::codec::{FramedRead, LinesCodec, LinesCodecError};

use super::{
    codex_events::{CodexEvents, NativeFailure, Progress, MAX_LINE_BYTES},
    emit, native_isolation, RuntimeTaskArgs, RuntimeTaskInputV1, RuntimeTaskOutputV1, PROTOCOL,
};

pub(super) fn valid_session_id(value: &str) -> bool {
    uuid::Uuid::parse_str(value)
        .is_ok_and(|id| !id.is_nil() && value.len() == 36 && id.hyphenated().to_string() == value)
}

struct Continuation<'a> {
    executable: &'a str,
    folder: PathBuf,
    session_id: &'a str,
    prompt: &'a str,
    policy: &'a NativeCodexPolicyV1,
}

impl<'a> Continuation<'a> {
    fn prepare(
        args: &'a RuntimeTaskArgs,
        input: &'a RuntimeTaskInputV1,
    ) -> Result<Self, NativeFailure> {
        if input.permission_mode != "normal"
            || args.agent.agent_args.iter().any(|arg| !arg.is_empty())
        {
            return Err(NativeFailure::UnsupportedArguments);
        }
        let session_id = input
            .provider_session_id
            .as_deref()
            .filter(|id| valid_session_id(id))
            .ok_or(NativeFailure::InvalidTarget)?;
        let policy = input
            .native_codex_policy
            .as_ref()
            .filter(|policy| policy.is_bounded())
            .ok_or(NativeFailure::InvalidTarget)?;
        let folder = PathBuf::from(&input.working_folder);
        let canonical = folder
            .canonicalize()
            .map_err(|_| NativeFailure::InvalidTarget)?;
        if !folder.is_absolute()
            || !canonical.is_dir()
            || canonical.parent().is_none()
            || canonical.as_os_str() != folder.as_os_str()
        {
            return Err(NativeFailure::InvalidTarget);
        }
        let executable = &args.agent.agent_command;
        if !std::path::Path::new(executable).is_absolute()
            || !std::path::Path::new(executable).is_file()
        {
            return Err(NativeFailure::InvalidTarget);
        }
        Ok(Self {
            executable,
            folder,
            session_id,
            prompt: &input.prompt,
            policy,
        })
    }

    fn command(&self) -> Command {
        let mut command = Command::new(self.executable);
        command
            // The owner explicitly reviewed this exact saved session/folder.
            // Non-repository work is valid too; this skips only the Git-root
            // prerequisite, never the native sandbox or approval policy.
            .args(["exec", "--json", "--skip-git-repo-check"]);
        // Native resume otherwise reapplies today's global permissions, which
        // may be broader than this session. Replay only host-verified policy.
        let mode = match &self.policy.sandbox_policy {
            NativeCodexSandboxV1::ReadOnly {} => "read-only",
            NativeCodexSandboxV1::WorkspaceWrite {
                writable_roots,
                network_access,
                exclude_tmpdir_env_var,
                exclude_slash_tmp,
            } => {
                command.args([
                    "-c",
                    &format!(
                        "sandbox_workspace_write.writable_roots={}",
                        serde_json::json!(writable_roots)
                    ),
                ]);
                for (key, value) in [
                    ("network_access", network_access),
                    ("exclude_tmpdir_env_var", exclude_tmpdir_env_var),
                    ("exclude_slash_tmp", exclude_slash_tmp),
                ] {
                    command.args(["-c", &format!("sandbox_workspace_write.{key}={value}")]);
                }
                "workspace-write"
            }
            NativeCodexSandboxV1::DangerFullAccess {} => "danger-full-access",
        };
        command
            .args([
                "--sandbox",
                mode,
                "-c",
                &format!(
                    "approval_policy={}",
                    serde_json::json!(self.policy.approval_policy)
                ),
                "-c",
                "approvals_reviewer=\"user\"",
                "--cd",
            ])
            .arg(&self.folder)
            .args(["resume", self.session_id, "-"])
            .current_dir(&self.folder)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // Native diagnostics may contain prompts, paths or provider
            // envelopes. Only the typed JSONL protocol reaches receipts.
            .stderr(Stdio::null())
            .kill_on_drop(true);
        native_isolation::scrub_environment(&mut command);
        command
    }
}

pub(super) async fn run(args: &RuntimeTaskArgs, input: &RuntimeTaskInputV1) -> Result<()> {
    let outcome = async {
        let continuation = Continuation::prepare(args, input)?;
        native_isolation::discard_inherited_descriptors()?;
        execute(
            continuation.command(),
            continuation.session_id,
            continuation.prompt,
            Duration::from_secs(args.idle_timeout_secs.clamp(30, 3_600)),
            Duration::from_secs(args.max_duration_secs.clamp(60, 604_800)),
            |progress| emit_progress(progress, continuation.session_id),
        )
        .await
    }
    .await;
    match outcome {
        Ok(result) => emit(RuntimeTaskOutputV1 {
            plan: None,
            protocol: PROTOCOL,
            kind: "result",
            // execute() verified this exact ID and consumed the full terminal
            // stream. Never replace it with an unsolicited provider identity.
            provider_session_id: input.provider_session_id.as_deref(),
            label: None,
            result: Some(&result),
            stop_reason: Some("end_turn"),
            error: None,
        }),
        Err(failure) => emit(RuntimeTaskOutputV1 {
            plan: None,
            protocol: PROTOCOL,
            kind: "failed",
            provider_session_id: None,
            label: None,
            result: None,
            stop_reason: None,
            error: Some(failure.message()),
        }),
    }
    Ok(())
}

fn emit_progress(progress: Progress, session_id: &str) {
    let (kind, label, plan) = match progress {
        Progress::Session => ("session", None, None),
        Progress::Step(label) => ("step", Some(label), None),
        Progress::Plan(plan) => ("plan", None, Some(plan)),
    };
    emit(RuntimeTaskOutputV1 {
        protocol: PROTOCOL,
        kind,
        provider_session_id: Some(session_id),
        label,
        result: None,
        stop_reason: None,
        error: None,
        plan,
    });
}

async fn execute(
    mut command: Command,
    session_id: &str,
    prompt: &str,
    idle_timeout: Duration,
    max_duration: Duration,
    mut progress: impl FnMut(Progress),
) -> Result<String, NativeFailure> {
    let mut signals = StopSignals::new()?;
    // The only process group ever signalled is the worker created here. A
    // native application/session controller is never discovered or killed.
    #[cfg(unix)]
    command.process_group(0);
    let mut worker = OwnedWorker::spawn(command)?;
    let outcome = tokio::select! {
        outcome = tokio::time::timeout(
            max_duration,
            consume(&mut worker.child, session_id, prompt, idle_timeout, &mut progress),
        ) => outcome.unwrap_or(Err(NativeFailure::Timeout)),
        () = signals.wait() => Err(NativeFailure::Interrupted),
    };
    if outcome.is_err() {
        worker.stop().await;
    }
    outcome
}

async fn consume(
    child: &mut tokio::process::Child,
    session_id: &str,
    prompt: &str,
    idle_timeout: Duration,
    progress: &mut impl FnMut(Progress),
) -> Result<String, NativeFailure> {
    let mut stdin = child.stdin.take().ok_or(NativeFailure::Protocol)?;
    let stdout = child.stdout.take().ok_or(NativeFailure::Protocol)?;
    tokio::time::timeout(idle_timeout, async {
        // Byte-exact prompt only: no resident identity, transcript replay or
        // extra instruction preamble, and no prompt in argv/process listings.
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|_| NativeFailure::Protocol)?;
        stdin.shutdown().await.map_err(|_| NativeFailure::Protocol)
    })
    .await
    .map_err(|_| NativeFailure::Timeout)??;
    drop(stdin);
    let mut lines = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_LINE_BYTES));
    let mut events = CodexEvents::new(session_id);
    let mut last_step = None;
    loop {
        let line = tokio::time::timeout(idle_timeout, lines.next())
            .await
            .map_err(|_| NativeFailure::Timeout)?;
        let Some(line) = line else { break };
        let line = line.map_err(|error| match error {
            LinesCodecError::MaxLineLengthExceeded => NativeFailure::OutputBound,
            _ => NativeFailure::Protocol,
        })?;
        if let Some(update) = events.accept(&line)? {
            if let Progress::Step(label) = update {
                if last_step == Some(label) {
                    continue;
                }
                last_step = Some(label);
            }
            progress(update);
        }
    }
    let status = tokio::time::timeout(idle_timeout, child.wait())
        .await
        .map_err(|_| NativeFailure::Timeout)?
        .map_err(|_| NativeFailure::Exit)?;
    events.finish(status.success())
}

pub(super) struct OwnedWorker {
    pub(super) child: tokio::process::Child,
    // wait() clears child.id(), but same-group helpers may still be alive.
    // Retain only the exact group created by this worker until cleanup.
    #[cfg(unix)]
    group: Option<u32>,
}

impl OwnedWorker {
    pub(super) fn spawn(mut command: Command) -> Result<Self, NativeFailure> {
        let child = command.spawn().map_err(|_| NativeFailure::Spawn)?;
        #[cfg(unix)]
        let group = child.id();
        Ok(Self {
            child,
            #[cfg(unix)]
            group,
        })
    }

    fn kill(&mut self) {
        #[cfg(unix)]
        if let Some(group) = self.group.take() {
            let _ = crate::acp::kill_process_group(group);
        }
        let _ = self.child.start_kill();
    }

    pub(super) async fn stop(&mut self) {
        self.kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), self.child.wait()).await;
    }
}

impl Drop for OwnedWorker {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg(unix)]
pub(super) struct StopSignals {
    terminate: tokio::signal::unix::Signal,
    interrupt: tokio::signal::unix::Signal,
}

#[cfg(unix)]
impl StopSignals {
    pub(super) fn new() -> Result<Self, NativeFailure> {
        use tokio::signal::unix::{signal, SignalKind};
        Ok(Self {
            terminate: signal(SignalKind::terminate()).map_err(|_| NativeFailure::Spawn)?,
            interrupt: signal(SignalKind::interrupt()).map_err(|_| NativeFailure::Spawn)?,
        })
    }

    pub(super) async fn wait(&mut self) {
        tokio::select! {
            _ = self.terminate.recv() => {},
            _ = self.interrupt.recv() => {},
        }
    }
}

#[cfg(not(unix))]
pub(super) struct StopSignals;

#[cfg(not(unix))]
impl StopSignals {
    pub(super) fn new() -> Result<Self, NativeFailure> {
        Ok(Self)
    }

    pub(super) async fn wait(&mut self) {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
#[path = "codex_cli_tests.rs"]
mod tests;

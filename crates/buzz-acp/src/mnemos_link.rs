//! The Mnemos mind a linked resident remembers with.
//!
//! The owner can link a resident to one of their own Mnemos minds. The
//! resident then gets that mind's tools (an ordinary MCP server in the managed
//! bootstrap) and, here, what the person's other apps get from Mnemos's hooks:
//! a wake at the start of each session and, on each owner message, the
//! memories that may bear on it. Both come from the person's own installed
//! `mnemos` (`hook session-start`, `hook prompt`), the commands Claude Code's
//! hooks run, with the same store and agent. Nothing here interprets memory.
//!
//! A memory hiccup never costs a turn: every failure, timeout or empty answer
//! contributes nothing, and nothing from the hook process is logged.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Mutex,
    time::Duration,
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

/// Claude Code gives the wake hook 15 s on a Mac where Mnemos is set up.
const WAKE_LIMIT: Duration = Duration::from_secs(15);
/// The cue stops itself well inside a second; this only bounds a stuck process.
const CUE_LIMIT: Duration = Duration::from_secs(2);
const MAX_OUTPUT: usize = 256 * 1024;
const MAX_PROMPT: usize = 16 * 1024;

/// How a linked resident's memory is framed in its turn: its own, from Mnemos.
const WAKE_OPEN: &str = "<your_memory source=\"mnemos\">\nThis is your own memory, from Mnemos. The owner linked you to it, so it is the same memory you have wherever else you're reached through Mnemos (Claude Code, for one). Use your mnemos tools to capture, correct, recall and hand off. While you're linked, Polyphonic's own notebook is off: keep what matters here.\n\n";
const WAKE_CLOSE: &str = "\n</your_memory>";
const CUE_OPEN: &str = "<your_memory source=\"mnemos\" kind=\"cue\">\n";
const CUE_CLOSE: &str = "\n</your_memory>";

pub(crate) struct MnemosLink {
    command: PathBuf,
    db_path: PathBuf,
    agent_id: String,
    /// Sessions that already had their wake in this process.
    woken: Mutex<HashSet<String>>,
}

impl MnemosLink {
    pub(crate) fn new(command: PathBuf, db_path: PathBuf, agent_id: String) -> Self {
        Self {
            command,
            db_path,
            agent_id,
            woken: Mutex::new(HashSet::new()),
        }
    }

    /// Whether a session still needs its wake in this process, the way a new
    /// or resumed Claude Code session gets its SessionStart hook.
    pub(crate) fn needs_wake(&self, session_id: &str) -> bool {
        self.woken
            .lock()
            .is_ok_and(|woken| !woken.contains(session_id))
    }

    /// A session's wake was tried to the end (given, empty or failed): it is
    /// not tried again in this process. A turn abandoned first tries again.
    pub(crate) fn mark_woken(&self, session_id: &str) {
        if let Ok(mut woken) = self.woken.lock() {
            woken.insert(session_id.to_owned());
        }
    }

    /// The wake for a session, framed for the turn, or nothing.
    pub(crate) async fn wake(
        &self,
        session_id: &str,
        cwd: &str,
        model: Option<&str>,
        person_name: Option<&str>,
    ) -> Option<String> {
        let mut payload = serde_json::json!({
            "hook_event_name": "SessionStart",
            "session_id": session_id,
            "cwd": cwd,
        });
        if let Some(model) = model.filter(|model| !model.is_empty()) {
            payload["model"] = model.into();
        }
        let mut args = vec!["hook".to_owned(), "session-start".to_owned()];
        if let Some(name) = person_name.map(str::trim).filter(|name| !name.is_empty()) {
            args.push("--person-name".to_owned());
            args.push(name.chars().take(80).collect());
        }
        let text = self.run(&args, &payload, WAKE_LIMIT).await?;
        Some(format!("{WAKE_OPEN}{text}{WAKE_CLOSE}"))
    }

    /// The memories that may bear on an owner's message, framed, or nothing.
    pub(crate) async fn cue(&self, prompt: &str, session_id: &str) -> Option<String> {
        let mut end = prompt.len().min(MAX_PROMPT);
        while !prompt.is_char_boundary(end) {
            end -= 1;
        }
        let payload = serde_json::json!({
            "hook_event_name": "UserPromptSubmit",
            "session_id": session_id,
            "prompt": &prompt[..end],
        });
        let args = ["hook".to_owned(), "prompt".to_owned()];
        let text = self.run(&args, &payload, CUE_LIMIT).await?;
        Some(format!("{CUE_OPEN}{text}{CUE_CLOSE}"))
    }

    async fn run(
        &self,
        hook: &[String],
        payload: &serde_json::Value,
        limit: Duration,
    ) -> Option<String> {
        let body = serde_json::to_vec(payload).ok()?;
        let mut child = Command::new(&self.command)
            .args(hook)
            .arg("--agent-id")
            .arg(&self.agent_id)
            .arg("--db-path")
            .arg(&self.db_path)
            .env_clear()
            .envs(hook_environment(&self.command))
            .current_dir(home().unwrap_or_else(|| PathBuf::from("/")))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .ok()?;
        let mut stdin = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        let outcome = tokio::time::timeout(limit, async {
            stdin.write_all(&body).await.ok()?;
            stdin.write_all(b"\n").await.ok()?;
            drop(stdin);
            let mut out = Vec::new();
            stdout
                .take((MAX_OUTPUT + 1) as u64)
                .read_to_end(&mut out)
                .await
                .ok()?;
            child.wait().await.ok()?;
            (out.len() <= MAX_OUTPUT).then_some(out)
        })
        .await;
        match outcome {
            Ok(Some(out)) => additional_context(&out),
            _ => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                None
            }
        }
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|home| home.is_absolute())
}

/// What a hook process may see: who and where the person is, their locale,
/// and their own `MNEMOS_*` settings. Nothing else from the resident's
/// environment (keys, relay credentials, harness markers) reaches it.
fn hook_environment(command: &Path) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(name, _)| {
            matches!(
                name.as_str(),
                "HOME" | "USER" | "LOGNAME" | "TMPDIR" | "LANG" | "LC_ALL" | "LC_CTYPE"
            ) || name.starts_with("MNEMOS_")
        })
        .collect();
    let mut path = String::new();
    if let Some(dir) = command.parent().and_then(Path::to_str) {
        path.push_str(dir);
        path.push(':');
    }
    path.push_str("/usr/bin:/bin:/usr/sbin:/sbin");
    env.push(("PATH".to_owned(), path));
    env
}

/// The text a hook gave its harness (`hookSpecificOutput.additionalContext`).
fn additional_context(out: &[u8]) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(out).ok()?;
    let text = value
        .get("hookSpecificOutput")?
        .get("additionalContext")?
        .as_str()?
        .trim();
    (!text.is_empty()).then(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A scratch folder for one test, removed when it ends.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("buzz-acp-mnemos-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A stand-in for the person's `mnemos`: echoes what it was asked, the way
    /// the real hooks answer, so the test can see the exact arguments and input.
    fn fake_mnemos(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("mnemos");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn link(command: PathBuf) -> MnemosLink {
        MnemosLink::new(command, "/stores/wren.db".into(), "wren".into())
    }

    #[test]
    fn reads_the_hook_answer_only() {
        let answer = br###"{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"## waking up\nhello"}}"###;
        assert_eq!(
            additional_context(answer).as_deref(),
            Some("## waking up\nhello")
        );
        assert_eq!(additional_context(b""), None);
        assert_eq!(additional_context(b"not json"), None);
        assert_eq!(
            additional_context(br#"{"hookSpecificOutput":{"additionalContext":"   "}}"#),
            None
        );
    }

    #[test]
    fn each_session_wakes_once() {
        let link = link(PathBuf::from("/nowhere/mnemos"));
        assert!(link.needs_wake("s1"));
        assert!(link.needs_wake("s1"), "asking does not use it up");
        link.mark_woken("s1");
        assert!(!link.needs_wake("s1"));
        assert!(link.needs_wake("s2"));
    }

    #[test]
    fn the_hook_sees_only_the_persons_settings() {
        let env = hook_environment(Path::new("/opt/homebrew/bin/mnemos"));
        let path = env.iter().find(|(name, _)| name == "PATH").unwrap();
        assert_eq!(path.1, "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
        assert!(env.iter().all(|(name, _)| matches!(
            name.as_str(),
            "PATH" | "HOME" | "USER" | "LOGNAME" | "TMPDIR" | "LANG" | "LC_ALL" | "LC_CTYPE"
        ) || name.starts_with("MNEMOS_")));
    }

    #[tokio::test]
    async fn wake_runs_the_persons_hook_and_frames_it_as_their_memory() {
        let dir = Scratch::new();
        let script = r###"input=$(cat)
args="$*"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"## waking up\\nargs: %s\\ninput: %s"}}' "$args" "$(printf %s "$input" | tr -d '"')""###;
        let link = link(fake_mnemos(dir.path(), script));
        let wake = link
            .wake("sess-1", "/work", Some("claude-opus-5-5"), Some("Pat"))
            .await
            .unwrap();
        assert!(wake.starts_with("<your_memory source=\"mnemos\">\n"));
        assert!(wake.ends_with("\n</your_memory>"));
        assert!(wake.contains(
            "args: hook session-start --person-name Pat --agent-id wren --db-path /stores/wren.db"
        ));
        assert!(wake.contains("session_id:sess-1"));
        assert!(wake.contains("cwd:/work"));
        assert!(wake.contains("model:claude-opus-5-5"));
    }

    #[tokio::test]
    async fn cue_runs_the_prompt_hook() {
        let dir = Scratch::new();
        let script = r###"input=$(cat)
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s | %s"}}' "$*" "$(printf %s "$input" | tr -d '"')""###;
        let link = link(fake_mnemos(dir.path(), script));
        let cue = link.cue("what did we decide?", "sess-1").await.unwrap();
        assert!(cue.starts_with("<your_memory source=\"mnemos\" kind=\"cue\">\n"));
        assert!(cue.contains("hook prompt --agent-id wren --db-path /stores/wren.db"));
        assert!(cue.contains("prompt:what did we decide?"));
        assert!(cue.contains("session_id:sess-1"));
    }

    #[tokio::test]
    async fn silence_failure_and_slowness_contribute_nothing() {
        let dir = Scratch::new();
        let quiet = link(fake_mnemos(dir.path(), "cat >/dev/null; exit 0"));
        assert_eq!(quiet.cue("hello there friend", "s").await, None);
        let broken = link(fake_mnemos(dir.path(), "cat >/dev/null; echo oops; exit 3"));
        assert_eq!(broken.cue("hello there friend", "s").await, None);
        let missing = link(dir.path().join("not-installed"));
        assert_eq!(missing.cue("hello there friend", "s").await, None);
        let slow = link(fake_mnemos(dir.path(), "sleep 5"));
        let started = std::time::Instant::now();
        assert_eq!(slow.cue("hello there friend", "s").await, None);
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn a_long_message_is_cut_on_a_character_boundary() {
        let dir = Scratch::new();
        let script = r###"input=$(cat)
printf '{"hookSpecificOutput":{"additionalContext":"%s"}}' "$(printf %s "$input" | wc -c | tr -d ' ')""###;
        let link = link(fake_mnemos(dir.path(), script));
        let long = "é".repeat(MAX_PROMPT);
        let cue = link.cue(&long, "s").await.unwrap();
        let bytes: usize = cue
            .trim_start_matches(CUE_OPEN)
            .trim_end_matches(CUE_CLOSE)
            .parse()
            .unwrap();
        assert!(bytes < MAX_PROMPT + 200);
    }
}

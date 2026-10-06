use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use super::*;

fn progress(observer: &ObserverHandle, kind: &str) {
    observer.emit(
        "acp_read",
        None,
        &ObserverContext::default(),
        serde_json::json!({ "params": { "update": { "sessionUpdate": kind } } }),
    );
}

#[tokio::test]
async fn queued_progress_and_shutdown_progress_are_drained_before_terminal_output() {
    let observer = ObserverHandle::in_process();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let task = spawn_safe_observer_with(observer.clone(), move |label| {
        captured.lock().expect("synthetic event ledger").push(label);
    });
    // No yield before emit: subscribing inside the spawned task would lose
    // these first updates. This reproduces the old scheduling race.
    progress(&observer, "plan");
    progress(&observer, "plan");
    let provider_outcome = Ok((
        "acknowledged-session".into(),
        StopReason::EndTurn,
        "SYNTHETIC_FINAL".into(),
    ));
    // Synthetic final update arriving during cleanup is still progress, not
    // a new event allowed after the terminal result.
    progress(&observer, "agent_message_chunk");
    drop(observer);
    let cleanup = finish_safe_observer(task).await;
    let outcome = terminal_outcome(provider_outcome, cleanup);
    assert!(outcome.is_ok());
    events
        .lock()
        .expect("synthetic event ledger")
        .push("result");
    tokio::task::yield_now().await;
    assert_eq!(
        *events.lock().expect("synthetic event ledger"),
        ["Planning the work", "Writing the result", "result"]
    );
}

#[tokio::test]
async fn lagged_observer_drains_safe_progress_instead_of_treating_lag_as_closed() {
    let observer = ObserverHandle::in_process();
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&events);
    let task = spawn_safe_observer_with(observer.clone(), move |label| {
        captured.lock().expect("synthetic event ledger").push(label);
    });
    for index in 0..3_000 {
        progress(
            &observer,
            if index % 2 == 0 {
                "plan"
            } else {
                "agent_message_chunk"
            },
        );
    }
    drop(observer);
    finish_safe_observer(task).await.expect("bounded drain");
    let events = events.lock().expect("synthetic event ledger");
    assert!(!events.is_empty());
    assert_eq!(events.last(), Some(&"Writing the result"));
}

#[tokio::test]
async fn observer_join_failure_discards_candidate_completion() {
    let task = tokio::spawn(async { panic!("SYNTHETIC_OBSERVER_FAILURE") });
    let cleanup = finish_safe_observer(task).await;
    let outcome = terminal_outcome(
        Ok((
            "acknowledged-session".into(),
            StopReason::EndTurn,
            "PRIVATE_CANDIDATE_NOT_RETURNED".into(),
        )),
        cleanup,
    );
    let error = outcome.expect_err("join failure must reject completion");
    assert_eq!(
        safe_error(&error.to_string()),
        "The runtime task could not complete."
    );
}

#[tokio::test(start_paused = true)]
async fn drain_timeout_aborts_and_joins_observer_before_failed_terminal_output() {
    struct Joined(Arc<AtomicBool>);
    impl Drop for Joined {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    let joined = Arc::new(AtomicBool::new(false));
    let state = Arc::clone(&joined);
    let task = tokio::spawn(async move {
        let _joined = Joined(state);
        std::future::pending::<()>().await;
    });
    let cleanup = finish_safe_observer(task).await;
    assert!(cleanup.is_err());
    assert!(joined.load(Ordering::SeqCst));
    assert!(terminal_outcome(
        Ok((
            "acknowledged-session".into(),
            StopReason::EndTurn,
            "PRIVATE_CANDIDATE_NOT_RETURNED".into()
        )),
        cleanup,
    )
    .is_err());
}

#[test]
fn shutdown_failure_never_masquerades_as_provider_completion() {
    let outcome = terminal_outcome(
        Ok((
            "acknowledged-session".into(),
            StopReason::EndTurn,
            "PRIVATE_CANDIDATE_NOT_RETURNED".into(),
        )),
        Err(crate::acp::AcpError::Io(std::io::Error::other(
            "PRIVATE_SHUTDOWN_FAILURE",
        ))),
    );
    let error = outcome.expect_err("shutdown failure must reject completion");
    assert_eq!(
        safe_error(&error.to_string()),
        "The runtime task could not complete."
    );
}

#[cfg(unix)]
#[test]
fn legacy_graceful_term_reaps_owned_adapter_before_failed_terminal_event() {
    use std::{
        io::{BufRead as _, Write as _},
        os::unix::{fs::PermissionsExt as _, process::CommandExt as _},
        path::PathBuf,
        process::Stdio,
    };

    use nix::{
        errno::Errno,
        sys::signal::{kill, Signal},
        unistd::Pid,
    };

    const CHILD_FOLDER: &str = "POLYPHONIC_LEGACY_TERM_FIXTURE_FOLDER";
    const TEST_NAME: &str = "runtime_task_runner::legacy_cleanup_tests::legacy_graceful_term_reaps_owned_adapter_before_failed_terminal_event";
    if let Some(folder) = std::env::var_os(CHILD_FOLDER) {
        let folder = PathBuf::from(folder);
        let runtime = tokio::runtime::Runtime::new().expect("isolated legacy fixture runtime");
        runtime
            .block_on(run(RuntimeTaskArgs {
                agent: crate::config::AuthAgentArgs {
                    agent_command: folder.join("adapter.sh").to_string_lossy().into_owned(),
                    agent_args: Vec::new(),
                },
                idle_timeout_secs: 30,
                max_duration_secs: 60,
            }))
            .expect("owned host emits a failed terminal event after TERM");
        return;
    }

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(pid) = std::fs::read_to_string(self.0.join("adapter.pid")) {
                if let Ok(pid) = pid.parse::<u32>() {
                    // This file is written only by this fixture's spawned
                    // adapter, not a discovered or external process.
                    let _ = crate::acp::kill_process_group(pid);
                }
            }
            for file in ["adapter.sh", "adapter.pid", "ready", "purpose.jsonl"] {
                let _ = std::fs::remove_file(self.0.join(file));
            }
            let _ = std::fs::remove_dir(&self.0);
        }
    }
    let folder = std::env::temp_dir().join(format!(
        "polyphonic-legacy-term-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&folder).expect("create owned fixture");
    let fixture = Fixture(folder.canonicalize().expect("canonical owned fixture"));
    let adapter = fixture.0.join("adapter.sh");
    let script = r##"#!/bin/sh
IFS= read -r initialize || exit 2
printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":2,"agentCapabilities":{}}}'
IFS= read -r new_session || exit 3
printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"sessionId":"synthetic-legacy-session"}}'
IFS= read -r prompt || exit 4
printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"synthetic-legacy-session","update":{"sessionUpdate":"plan"}}}'
printf '%s' "$$" > "$POLYPHONIC_LEGACY_TERM_FIXTURE_FOLDER/adapter.pid"
printf ready > "$POLYPHONIC_LEGACY_TERM_FIXTURE_FOLDER/ready"
sleep 60
"##;
    std::fs::write(&adapter, script).expect("synthetic ACP adapter");
    std::fs::set_permissions(&adapter, std::fs::Permissions::from_mode(0o700))
        .expect("executable synthetic adapter");
    let store = fixture.0.join("purpose.jsonl");
    std::fs::write(&store, []).expect("owned synthetic purpose store");
    let mut driver = std::process::Command::new(std::env::current_exe().expect("test binary"));
    for (key, _) in std::env::vars_os() {
        if key
            .to_str()
            .is_some_and(native_isolation::resident_environment_key)
        {
            driver.env_remove(key);
        }
    }
    driver
        .args(["--exact", TEST_NAME, "--nocapture", "--quiet"])
        .env(CHILD_FOLDER, &fixture.0)
        .env(crate::runtime_session_purpose::STORE_ENV, store)
        .env("LUCA_MANAGED_RESIDENT_PUBKEY", "a".repeat(64))
        .env("LUCA_MANAGED_BINDING_REF", "synthetic-binding-only")
        .env(crate::runtime_session_purpose::RUNTIME_FAMILY_ENV, "codex")
        .env("LUCA_MANAGED_SESSION_EPOCH", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    let mut child = driver.spawn().expect("isolated owned legacy host");
    let mut stdin = child.stdin.take().expect("synthetic input pipe");
    stdin
        .write_all(
            &serde_json::to_vec(&serde_json::json!({
                "taskId": "task:legacy-fixture",
                "conversationId": "conversation:legacy-fixture",
                "prompt": "SYNTHETIC_PROMPT_ONLY",
                "workingFolder": fixture.0,
                "permissionMode": "normal",
            }))
            .expect("synthetic input encoding"),
        )
        .expect("send synthetic input");
    drop(stdin);
    let ready = fixture.0.join("ready");
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while !ready.is_file() && std::time::Instant::now() < deadline {
        if child.try_wait().expect("owned host status").is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if !ready.is_file() {
        let _ = kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM);
        let _ = child.wait();
        panic!("synthetic ACP handshake did not reach its prompt");
    }
    let adapter_pid = std::fs::read_to_string(fixture.0.join("adapter.pid"))
        .expect("owned adapter pid")
        .parse::<i32>()
        .expect("synthetic adapter pid shape");
    kill(Pid::from_raw(child.id() as i32), Signal::SIGTERM).expect("TERM exact owned host");
    let mut reader = std::io::BufReader::new(child.stdout.take().expect("host event pipe"));
    let mut events = Vec::new();
    let mut adapter_reaped_before_failure = false;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).expect("synthetic host line") == 0 {
            break;
        }
        let Some(start) = line.find("{\"protocol\":") else {
            continue;
        };
        let event: serde_json::Value =
            serde_json::from_str(&line[start..]).expect("synthetic host JSON");
        if event["kind"] == "failed" {
            adapter_reaped_before_failure =
                kill(Pid::from_raw(adapter_pid), None) == Err(Errno::ESRCH);
        }
        events.push(event);
    }
    assert!(child.wait().expect("owned host exit").success());
    assert!(adapter_reaped_before_failure);
    assert!(events.iter().any(|event| event["kind"] == "session"));
    assert_eq!(
        events.last().expect("failed terminal evidence")["kind"],
        "failed"
    );
    assert!(events.iter().all(|event| event["kind"] != "result"));
    assert_eq!(
        events.last().expect("failed terminal evidence")["error"],
        "The runtime task could not complete."
    );
}

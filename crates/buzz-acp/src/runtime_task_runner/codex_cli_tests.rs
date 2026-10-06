use super::*;
use crate::config::AuthAgentArgs;

const SESSION: &str = "01a1083a-f0f0-76a3-b1d9-c0268a062636";

fn input(folder: &str) -> RuntimeTaskInputV1 {
    RuntimeTaskInputV1 {
        runtime_family: None,
        native_cli: None,
        native_permission_mode: None,
        native_target_pid: None,
        native_target_name: None,
        task_id: "task:fixture".into(),
        conversation_id: "conversation:fixture".into(),
        prompt: "SYNTHETIC_PROMPT_ONLY\nUnicode: \u{2605}\n".into(),
        working_folder: folder.into(),
        permission_mode: "normal".into(),
        operation: super::super::RuntimeTaskOperation::ContinueSession,
        provider_session_id: Some(SESSION.into()),
    }
}

fn args(executable: &str) -> RuntimeTaskArgs {
    RuntimeTaskArgs {
        agent: AuthAgentArgs {
            agent_command: executable.into(),
            agent_args: vec![],
        },
        idle_timeout_secs: 30,
        max_duration_secs: 60,
    }
}

#[test]
fn only_exact_native_uuid_not_names_last_urn_simple_or_nil_is_allowed() {
    assert!(valid_session_id(SESSION));
    for invalid in [
        "--last",
        "latest",
        "my thread",
        "01a1083af0f076a3b1d9c0268a062636",
        "urn:uuid:01a1083a-f0f0-76a3-b1d9-c0268a062636",
        "01A1083A-F0F0-76A3-B1D9-C0268A062636",
        "00000000-0000-0000-0000-000000000000",
        "01a1083a-f0f0-76a3-b1d9-c0268a062636\n",
    ] {
        assert!(!valid_session_id(invalid), "{invalid}");
    }
}

#[test]
fn adapter_permission_and_model_overrides_never_fall_back() {
    let folder = std::env::temp_dir()
        .canonicalize()
        .expect("temporary directory");
    let input = input(folder.to_str().expect("UTF-8 fixture"));
    let mut args = args("/bin/sh");
    for forbidden in ["acp", "--model", "-c", "--last", "fork", "--sandbox", " "] {
        args.agent.agent_args = vec![forbidden.into()];
        assert!(matches!(
            Continuation::prepare(&args, &input),
            Err(NativeFailure::UnsupportedArguments)
        ));
    }
    args.agent.agent_args = vec![String::new()]; // Desktop's explicit empty env.
    assert!(Continuation::prepare(&args, &input).is_ok());
    let mut elevated = input;
    elevated.permission_mode = "full_access".into();
    assert!(matches!(
        Continuation::prepare(&args, &elevated),
        Err(NativeFailure::UnsupportedArguments)
    ));
}

#[cfg(unix)]
mod transport {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    struct Fixture {
        folder: PathBuf,
        executable: PathBuf,
    }

    impl Fixture {
        fn new(script: &str) -> Self {
            let folder = std::env::temp_dir().join(format!(
                "polyphonic-native-resume-test-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir(&folder).expect("create owned fixture");
            let folder = folder.canonicalize().expect("canonical owned fixture");
            let executable = folder.join("codex-fixture");
            std::fs::write(&executable, format!("#!/bin/sh\n{script}\n"))
                .expect("write synthetic provider");
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
                .expect("executable fixture");
            Self { folder, executable }
        }

        fn input(&self) -> RuntimeTaskInputV1 {
            input(self.folder.to_str().expect("UTF-8 fixture"))
        }

        fn args(&self) -> RuntimeTaskArgs {
            args(self.executable.to_str().expect("UTF-8 executable"))
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            // Exact files owned by this synthetic fixture; never recurse into
            // a broad temporary, project, user or native runtime directory.
            for file in [
                "codex-fixture",
                "stdin.bin",
                "fixture-link",
                "helper.ready",
                "helper.finished",
            ] {
                let _ = std::fs::remove_file(self.folder.join(file));
            }
            let _ = std::fs::remove_dir(&self.folder);
        }
    }

    fn stream(result: &str) -> String {
        format!(
            "printf '%s\\n' '{{\"type\":\"thread.started\",\"thread_id\":\"{SESSION}\"}}' \
             '{{\"type\":\"turn.started\"}}' \
             '{{\"type\":\"item.completed\",\"item\":{{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"{result}\"}}}}' \
             '{{\"type\":\"turn.completed\",\"usage\":{{\"input_tokens\":1,\"cached_input_tokens\":0,\"output_tokens\":1}}}}'"
        )
    }

    #[tokio::test]
    async fn argv_stdin_native_config_and_id_are_preserved_exactly() {
        let script = format!(
            "[ \"$#\" -eq 7 ] || exit 2\n\
             [ \"$1\" = exec ] && [ \"$2\" = --json ] && [ \"$3\" = --cd ] || exit 3\n\
             [ \"$4\" = \"$PWD\" ] && [ \"$5\" = resume ] && [ \"$6\" = '{SESSION}' ] && [ \"$7\" = - ] || exit 4\n\
             [ -z \"${{LUCA_MANAGED_RESIDENT_PUBKEY+x}}\" ] && [ -z \"${{LUCA_MANAGED_PERMISSION_FD+x}}\" ] || exit 5\n\
             [ -z \"${{BUZZ_ACP_SYSTEM_PROMPT+x}}\" ] && [ -z \"${{CODEX_CONFIG+x}}\" ] && [ -z \"${{INITIAL_AGENT_MODE+x}}\" ] || exit 6\n\
             [ \"$CODEX_HOME\" = 'SYNTHETIC_NATIVE_HOME_UNCHANGED' ] || exit 7\n\
             cat > stdin.bin\n{}",
            stream("NATIVE_FINAL")
        );
        let fixture = Fixture::new(&script);
        let input = fixture.input();
        let args = fixture.args();
        let continuation = Continuation::prepare(&args, &input).expect("verified fixture");
        let mut command = continuation.command();
        for (key, value) in [
            ("LUCA_MANAGED_RESIDENT_PUBKEY", "PRIVATE_RESIDENT"),
            ("LUCA_MANAGED_PERMISSION_FD", "3"),
            ("BUZZ_ACP_SYSTEM_PROMPT", "You are Luca PRIVATE_IDENTITY"),
            ("CODEX_CONFIG", "PRIVATE_RESIDENT_POLICY"),
            ("INITIAL_AGENT_MODE", "agent-full-access"),
            ("CODEX_HOME", "SYNTHETIC_NATIVE_HOME_UNCHANGED"),
        ] {
            command.env(key, value);
        }
        native_isolation::scrub_environment(&mut command);
        let mut progress = Vec::new();
        let result = execute(
            command,
            continuation.session_id,
            continuation.prompt,
            Duration::from_secs(2),
            Duration::from_secs(3),
            |event| progress.push(event),
        )
        .await;
        assert_eq!(result, Ok("NATIVE_FINAL".into()));
        assert_eq!(progress.first(), Some(&Progress::Session));
        assert_eq!(
            std::fs::read(fixture.folder.join("stdin.bin")).expect("captured stdin"),
            input.prompt.as_bytes()
        );
    }

    #[test]
    fn command_shape_has_no_new_fork_last_profile_model_or_policy_override() {
        let fixture = Fixture::new("exit 0");
        let input = fixture.input();
        let args = fixture.args();
        let continuation = Continuation::prepare(&args, &input).expect("verified fixture");
        let command = continuation.command();
        let arguments: Vec<_> = command.as_std().get_args().collect();
        assert_eq!(
            arguments,
            [
                std::ffi::OsStr::new("exec"),
                std::ffi::OsStr::new("--json"),
                std::ffi::OsStr::new("--cd"),
                fixture.folder.as_os_str(),
                std::ffi::OsStr::new("resume"),
                std::ffi::OsStr::new(SESSION),
                std::ffi::OsStr::new("-"),
            ]
        );
        assert_eq!(
            command.as_std().get_current_dir(),
            Some(fixture.folder.as_path())
        );
    }

    #[test]
    fn changed_noncanonical_symlink_missing_or_relative_folder_cannot_dispatch() {
        let fixture = Fixture::new("exit 0");
        let args = fixture.args();
        let mut input = fixture.input();
        for folder in [
            "relative/folder".to_string(),
            fixture
                .folder
                .join("missing")
                .to_string_lossy()
                .into_owned(),
            format!("{}/.", fixture.folder.display()),
            "/".into(),
        ] {
            input.working_folder = folder;
            assert!(matches!(
                Continuation::prepare(&args, &input),
                Err(NativeFailure::InvalidTarget)
            ));
        }
        let link = fixture.folder.join("fixture-link");
        std::os::unix::fs::symlink(&fixture.folder, &link).expect("owned symlink fixture");
        input.working_folder = link.to_string_lossy().into_owned();
        assert!(matches!(
            Continuation::prepare(&args, &input),
            Err(NativeFailure::InvalidTarget)
        ));
    }

    #[tokio::test]
    async fn native_trailing_failure_bad_exit_and_zero_exit_without_completion_fail() {
        for (script, expected) in [
            (format!("cat > stdin.bin\n{}\nexit 9", stream("NOT_RETURNED")), NativeFailure::Exit),
            (format!("cat > stdin.bin\n{}\nprintf '%s\\n' 'PRIVATE_MALFORMED'", stream("NOT_RETURNED")), NativeFailure::Protocol),
            (format!("cat > stdin.bin\n{}\nprintf '%s\\n' '{{\"type\":\"turn.failed\",\"error\":{{\"message\":\"PRIVATE_QUOTA\"}}}}'", stream("NOT_RETURNED")), NativeFailure::Provider),
            ("cat > stdin.bin\nexit 0".into(), NativeFailure::MissingCompletion),
            (format!("cat > stdin.bin\nprintf '%s\\n' '{{\"type\":\"thread.started\",\"thread_id\":\"01a1083a-f0f0-76a3-b1d9-c0268a062637\"}}'"), NativeFailure::SessionMismatch),
        ] {
            let fixture = Fixture::new(&script);
            let input = fixture.input();
            let args = fixture.args();
            let continuation = Continuation::prepare(&args, &input).expect("verified fixture");
            let result = execute(
                continuation.command(),
                continuation.session_id,
                continuation.prompt,
                Duration::from_secs(2),
                Duration::from_secs(3),
                |_| {},
            )
            .await;
            assert_eq!(result, Err(expected));
        }
    }

    #[tokio::test]
    async fn owned_worker_is_timed_out_without_native_completion_or_retry() {
        let fixture = Fixture::new("cat > stdin.bin\nsleep 60");
        let input = fixture.input();
        let args = fixture.args();
        let continuation = Continuation::prepare(&args, &input).expect("verified fixture");
        let result = execute(
            continuation.command(),
            continuation.session_id,
            continuation.prompt,
            Duration::from_millis(30),
            Duration::from_millis(100),
            |_| {},
        )
        .await;
        assert_eq!(result, Err(NativeFailure::Timeout));
    }

    #[tokio::test]
    async fn native_success_cleans_owned_helpers_even_after_child_wait_clears_pid() {
        let script = format!(
            "cat > stdin.bin\n\
             (printf ready > helper.ready; sleep 1; printf ORPHAN > helper.finished) </dev/null >/dev/null 2>&1 &\n\
             while [ ! -f helper.ready ]; do sleep 0.01; done\n{}",
            stream("NATIVE_FINAL")
        );
        let fixture = Fixture::new(&script);
        let input = fixture.input();
        let args = fixture.args();
        let continuation = Continuation::prepare(&args, &input).expect("verified fixture");
        let result = execute(
            continuation.command(),
            continuation.session_id,
            continuation.prompt,
            Duration::from_secs(2),
            Duration::from_secs(3),
            |_| {},
        )
        .await;
        assert_eq!(result, Ok("NATIVE_FINAL".into()));
        assert!(fixture.folder.join("helper.ready").is_file());
        // The helper explicitly closes stdio, so native EOF/wait can finish
        // while it is alive. Retained exact-PGID cleanup must prevent its
        // delayed action, without touching any external runtime controller.
        tokio::time::sleep(Duration::from_millis(1_200)).await;
        assert!(!fixture.folder.join("helper.finished").exists());
    }
}

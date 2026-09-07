use super::*;

fn request(mode: AgentProvisioningModeV1) -> NativeProvisioningRequestV1 {
    NativeProvisioningRequestV1 {
        display_name: "Research Helper".into(),
        system_prompt: "Find reliable sources.".into(),
        runtime: NativeRuntimeFamilyV1::Hermes,
        mode,
        source_semantic_id: None,
        selected_skills: Vec::new(),
        include_memory: false,
        workspace_documents: Vec::new(),
    }
}

#[test]
fn slug_is_bounded_and_rejects_reserved_names() {
    assert_eq!(slug_for_name("Research Helper").unwrap(), "research-helper");
    assert!(slug_for_name("main").is_err());
    assert!(slug_for_name("💫").is_err());
}

#[test]
fn fresh_request_rejects_clone_material() {
    let mut input = request(AgentProvisioningModeV1::Fresh);
    input.selected_skills.push("coding".into());
    assert!(normalize_request(input).is_err());
}

#[test]
fn clone_request_requires_a_locally_selected_source() {
    assert!(normalize_request(request(AgentProvisioningModeV1::Template)).is_err());
}

#[test]
fn request_rejects_absolute_paths_and_traversal() {
    let mut input = request(AgentProvisioningModeV1::Advanced);
    input.source_semantic_id = Some("source".into());
    input.workspace_documents = vec!["../.env".into()];
    assert!(normalize_request(input).is_err());
}

#[test]
fn strict_request_rejects_credentials_and_commands_as_fields() {
    for field in ["apiKey", "command", "environment", "nativePath"] {
        let mut value = serde_json::to_value(request(AgentProvisioningModeV1::Fresh)).unwrap();
        value[field] = serde_json::json!("forbidden");
        assert!(serde_json::from_value::<NativeProvisioningRequestV1>(value).is_err());
    }
}

#[test]
fn instructions_preserve_paragraphs_but_reject_control_sequences() {
    let mut input = request(AgentProvisioningModeV1::Fresh);
    input.system_prompt = "Read the project.\n\nReport evidence.\n\tKeep sources.".into();
    assert_eq!(
        normalize_request(input.clone())
            .expect("paragraphs")
            .system_prompt,
        input.system_prompt
    );
    for control in ['\0', '\u{1b}', '\u{7}'] {
        input.system_prompt = format!("Instructions{control}");
        assert!(normalize_request(input.clone()).is_err());
    }
}

#[test]
fn simultaneous_native_mutations_for_one_transaction_are_rejected_and_release_on_exit() {
    let owner = "guard-test-owner";
    let transaction = "guard-test-transaction";
    let held = NativeTransactionGuard::acquire(owner, transaction).expect("first action");
    let concurrent =
        std::thread::spawn(move || NativeTransactionGuard::acquire(owner, transaction).is_err());
    assert!(concurrent.join().expect("concurrent invocation"));
    assert!(NativeTransactionGuard::acquire(owner, "another-transaction").is_ok());
    assert!(NativeTransactionGuard::acquire("another-owner", transaction).is_ok());
    drop(held);
    assert!(NativeTransactionGuard::acquire(owner, transaction).is_ok());
}

#[cfg(unix)]
mod hermes_root_provenance {
    use super::super::hermes_journal::{HermesJournal, ProfileGuard};
    use super::*;
    use std::{
        fs,
        os::unix::fs::{symlink, PermissionsExt},
        path::PathBuf,
    };

    struct Fixture {
        _directory: tempfile::TempDir,
        base: PathBuf,
        root: PathBuf,
        other: PathBuf,
        home: PathBuf,
        executable: PathBuf,
        path: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let base = directory.path().canonicalize().unwrap();
            let root = base.join("reviewed");
            let other = base.join("ambient");
            let home = base.join("synthetic-owner-home");
            for path in [&root, &other, &home] {
                fs::create_dir(path).unwrap();
            }
            fs::write(root.join("config.yaml"), "model:\n  default: gpt-5.5\n  provider: openai-codex\n  max_tokens: 4096\nagent:\n  reasoning_effort: high\n").unwrap();
            let executable = base.join("hermes-fixture");
            fs::write(
                &executable,
                format!(
                    r#"#!/bin/sh
root="${{HERMES_HOME:-{other}}}"
case "$root" in "{base}"/*) ;; *) root="{other}" ;; esac
[ "$1" = '--version' ] && {{ printf 'version %s\n' "$root" >> '{base}/calls'; printf '0.17.0\n'; exit 0; }}
case "$3" in ''|*[!a-z0-9_-]*) exit 80 ;; esac
printf '%s %s\n' "$2" "$root" >> '{base}/calls'
case "$1:$2" in
  profile:create)
    [ ! -e "$root/profiles/$3" ] || exit 81
    /bin/mkdir -p "$root/profiles/$3"
    : ;;
  profile:delete) /bin/rm -rf "$root/profiles/$3" ;;
  profile:show) printf 'Path: %s/profiles/%s\n' "$root" "$3" ;;
  *) exit 82 ;;
esac
"#,
                    base = base.display(),
                    other = other.display()
                ),
            )
            .unwrap();
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
            let path = base.join("journal.json");
            Self {
                _directory: directory,
                base,
                root,
                other,
                home,
                executable,
                path,
            }
        }

        fn journal(&self) -> HermesJournal {
            let binding = crate::managed_agents::build_hermes_runtime_binding(
                "default".into(),
                self.root.clone(),
                self.executable.clone(),
                "0.17.0".into(),
                None,
            );
            HermesJournal::prepare("owner", "transaction", "request", binding, "helper").unwrap()
        }

        fn load(&self) -> Result<HermesJournal, String> {
            HermesJournal::load(&self.path, "owner", "transaction", "request")
        }

        fn approve(&self, journal: &mut HermesJournal) {
            hermes::fresh_preferences(&journal.source)
                .unwrap()
                .bind_review(journal);
        }

        fn create(&self) -> HermesJournal {
            let mut journal = self.journal();
            self.approve(&mut journal);
            journal.save(&self.path).unwrap();
            hermes::execute(
                &request(AgentProvisioningModeV1::Fresh),
                &mut journal,
                &self.path,
            )
            .unwrap();
            journal
        }
    }

    #[test]
    fn two_fresh_profiles_remain_isolated_when_the_second_is_rolled_back() {
        let fixture = Fixture::new();
        // Match fresh native bootstrap scaffolding without copying source material.
        let fresh_env = "# Fresh profile environment overrides\n";
        let native = fs::read_to_string(&fixture.executable).unwrap().replace(
            "    /bin/mkdir -p \"$root/profiles/$3\"",
            "    /bin/mkdir -p \"$root/profiles/$3/memories\" \"$root/profiles/$3/sessions\" \"$root/profiles/$3/skills\"\n    printf '# Fresh profile environment overrides\\n' > \"$root/profiles/$3/.env\"",
        );
        fs::write(&fixture.executable, native).unwrap();
        let template = fixture.root.join("profiles/template");
        let mut sentinels = Vec::new();
        for directory in [&fixture.root, &template] {
            fs::create_dir_all(directory.join("memories")).unwrap();
            fs::create_dir_all(directory.join("sessions")).unwrap();
            for relative in [
                "auth.json",
                ".env",
                "SOUL.md",
                "memories/MEMORY.md",
                "sessions/session.json",
            ] {
                let path = directory.join(relative);
                let bytes = format!("synthetic source-only {} {relative}", directory.display())
                    .into_bytes();
                fs::write(&path, &bytes).unwrap();
                sentinels.push((path, bytes));
            }
        }
        fs::write(template.join("config.yaml"), "model: template-only-model\n").unwrap();
        for directory in [&fixture.root, &template] {
            let path = directory.join("config.yaml");
            sentinels.push((path.clone(), fs::read(path).unwrap()));
        }
        let source = crate::managed_agents::build_hermes_runtime_binding(
            "template".into(),
            template,
            fixture.executable.clone(),
            "0.17.0".into(),
            None,
        );
        let mode = AgentProvisioningModeV1::Fresh;
        let mut first = HermesJournal::prepare(
            "owner",
            "transaction-a",
            "request-a",
            source.clone(),
            "scout-a",
        )
        .unwrap();
        let first_path = fixture.base.join("journal-a.json");
        let second_path = fixture.base.join("journal-b.json");
        let mut first_request = request(mode.clone());
        first_request.display_name = "Scout A".into();
        first_request.system_prompt = "Find reliable sources for A.".into();
        fixture.approve(&mut first);
        first.save(&first_path).unwrap();
        hermes::execute(&first_request, &mut first, &first_path).unwrap();
        let first_candidate = hermes::candidate(&first, &mode).unwrap();
        // A later native memory write belongs only to the first profile.
        fs::create_dir_all(first.destination.join("memories")).unwrap();
        fs::write(
            first.destination.join("memories/MEMORY.md"),
            "synthetic memory owned by A",
        )
        .unwrap();
        let first_bytes: Vec<_> = ["config.yaml", "SOUL.md", "memories/MEMORY.md"]
            .into_iter()
            .map(|relative| {
                (
                    relative,
                    fs::read(first.destination.join(relative)).unwrap(),
                )
            })
            .collect();
        let mut second =
            HermesJournal::prepare("owner", "transaction-b", "request-b", source, "scout-b")
                .unwrap();
        let mut second_request = request(mode.clone());
        second_request.display_name = "Scout B".into();
        second_request.system_prompt = "Check independent evidence for B.".into();
        fixture.approve(&mut second);
        second.save(&second_path).unwrap();
        hermes::execute(&second_request, &mut second, &second_path).unwrap();
        let second_candidate = hermes::candidate(&second, &mode).unwrap();
        assert_ne!(
            first.destination.canonicalize().unwrap(),
            second.destination.canonicalize().unwrap()
        );
        assert_ne!(first.slug, second.slug);
        assert_ne!(first_candidate.native_id, second_candidate.native_id);
        assert_ne!(first_candidate.semantic_id, second_candidate.semantic_id);
        assert_ne!(
            first_candidate.canonical_location,
            second_candidate.canonical_location
        );
        for (journal, instructions) in [
            (&first, &first_request.system_prompt),
            (&second, &second_request.system_prompt),
        ] {
            let config: serde_yaml::Value =
                serde_yaml::from_slice(&fs::read(journal.destination.join("config.yaml")).unwrap())
                    .unwrap();
            assert_eq!(config["model"]["provider"], "openai-codex");
            assert_eq!(config["model"]["default"], "gpt-5.5");
            assert_eq!(
                fs::read_to_string(journal.destination.join("SOUL.md")).unwrap(),
                *instructions
            );
            assert!(!journal.destination.join("auth.json").exists());
            let env = fs::read(journal.destination.join(".env")).unwrap();
            assert_eq!(env, fresh_env.as_bytes());
            for (path, bytes) in &sentinels {
                if path.file_name().unwrap() == ".env" {
                    assert_ne!(&env, bytes);
                }
            }
            assert_eq!(
                fs::read_dir(journal.destination.join("sessions"))
                    .unwrap()
                    .count(),
                0
            );
            assert_eq!(
                fs::read_dir(journal.destination.join("skills"))
                    .unwrap()
                    .count(),
                0
            );
        }
        assert_eq!(
            fs::read_dir(second.destination.join("memories"))
                .unwrap()
                .count(),
            0
        );
        assert_eq!(
            fs::read_dir(first.destination.join("memories"))
                .unwrap()
                .count(),
            1
        );
        for (relative, bytes) in &first_bytes {
            assert_eq!(fs::read(first.destination.join(relative)).unwrap(), *bytes);
        }
        for (path, bytes) in &sentinels {
            assert_eq!(fs::read(path).unwrap(), *bytes);
        }
        hermes::rollback_at_home(&mut second, &second_path, &fixture.home).unwrap();
        assert!(!second.destination.exists());
        assert!(second.removed);
        let first =
            HermesJournal::load(&first_path, "owner", "transaction-a", "request-a").unwrap();
        first.verify_created().unwrap();
        assert_eq!(
            hermes::candidate(&first, &mode).unwrap().semantic_id,
            first_candidate.semantic_id
        );
        for (relative, bytes) in &first_bytes {
            assert_eq!(fs::read(first.destination.join(relative)).unwrap(), *bytes);
        }
        for (path, bytes) in &sentinels {
            assert_eq!(fs::read(path).unwrap(), *bytes);
        }
    }

    #[test]
    fn fresh_profile_inherits_reviewed_root_model_without_copying_native_credentials() {
        let fixture = Fixture::new();
        let config = "model:\n  default: gpt-5.5\n  provider: openai-codex\n";
        fs::write(fixture.root.join("config.yaml"), config).unwrap();
        let journal = fixture.create();
        let contents =
            fs::read_to_string(journal.destination.join("config.yaml")).unwrap_or_default();
        let inherited: serde_yaml::Value = serde_yaml::from_str(&contents).unwrap();
        assert_eq!(inherited["model"]["provider"], "openai-codex");
        assert_eq!(inherited["model"]["default"], "gpt-5.5");
        assert_eq!(
            fs::read_to_string(fixture.root.join("config.yaml")).unwrap(),
            config
        );
        assert!(!journal.destination.join("auth.json").exists());
    }

    #[test]
    fn fresh_uses_root_preferences_and_exact_native_command_without_cloning_a_named_source() {
        let fixture = Fixture::new();
        let source = fixture.root.join("profiles/template");
        fs::create_dir_all(source.join("memories")).unwrap();
        fs::write(
            source.join("config.yaml"),
            "model: different-profile-model\n",
        )
        .unwrap();
        for path in ["auth.json", ".env", "SOUL.md", "memories/MEMORY.md"] {
            fs::write(source.join(path), "source-only-material").unwrap();
        }
        fs::write(fixture.root.join("auth.json"), "synthetic-native-only-auth").unwrap();
        let root_before = fs::read(fixture.root.join("config.yaml")).unwrap();
        let source_before = fs::read(source.join("config.yaml")).unwrap();
        let native = fs::read_to_string(&fixture.executable).unwrap().replace(
            "  profile:create)\n", "  profile:create)\n    [ \"$#\" = 6 ] && [ \"$4\" = --no-alias ] && [ \"$5\" = --description ] && [ \"$6\" = 'Find reliable sources.' ] || exit 88\n",
        );
        fs::write(&fixture.executable, native).unwrap();
        let binding = crate::managed_agents::build_hermes_runtime_binding(
            "template".into(),
            source.clone(),
            fixture.executable.clone(),
            "0.17.0".into(),
            None,
        );
        let mut journal =
            HermesJournal::prepare("owner", "transaction", "request", binding, "helper").unwrap();
        let reviewed = hermes::fresh_preferences(&journal.source).unwrap();
        reviewed.bind_review(&mut journal);
        journal.save(&fixture.path).unwrap();
        hermes::execute(
            &request(AgentProvisioningModeV1::Fresh),
            &mut journal,
            &fixture.path,
        )
        .unwrap();
        let config: serde_yaml::Value =
            serde_yaml::from_slice(&fs::read(journal.destination.join("config.yaml")).unwrap())
                .unwrap();
        assert_eq!(config["model"]["default"], "gpt-5.5");
        assert_eq!(config["model"]["provider"], "openai-codex");
        assert_eq!(config["model"]["max_tokens"], 4096);
        assert_eq!(config["agent"]["reasoning_effort"], "high");
        assert_eq!(
            fs::read_to_string(journal.destination.join("SOUL.md")).unwrap(),
            "Find reliable sources."
        );
        for path in [
            "auth.json",
            ".env",
            "memories/MEMORY.md",
            "sessions",
            "skills",
        ] {
            assert!(
                !journal.destination.join(path).exists(),
                "unexpected copy: {path}"
            );
        }
        assert_eq!(
            fs::read(fixture.root.join("config.yaml")).unwrap(),
            root_before
        );
        assert_eq!(fs::read(source.join("config.yaml")).unwrap(), source_before);
        assert_eq!(
            fs::read_to_string(fixture.root.join("auth.json")).unwrap(),
            "synthetic-native-only-auth"
        );
        let public = hermes::candidate(&journal, &AgentProvisioningModeV1::Fresh).unwrap();
        let preview = hermes::preview(
            &request(AgentProvisioningModeV1::Fresh),
            &public,
            "preview".into(),
            "helper".into(),
            Some(&reviewed),
        );
        assert!(preview
            .changes
            .iter()
            .any(|change| change.action == "Inherit"
                && change.detail.contains("gpt-5.5")
                && change.detail.contains("openai-codex")));
        let serialized = serde_json::to_string(&preview).unwrap();
        assert!(!serialized.contains("synthetic-native-only-auth"));
        assert!(!serialized.contains("fresh_model_preferences_hash"));
    }

    #[test]
    fn fresh_legacy_normalization_preserves_native_precedence_and_explicit_route() {
        for (config, provider, model, url, context) in [
            ("model: gpt-5.5\nprovider: openai-codex\napi_base: https://chatgpt.com/backend-api/codex\ncontext_length: 128000\n", "openai-codex", "gpt-5.5", "https://chatgpt.com/backend-api/codex", 128000),
            ("model:\n  default: gpt-5.5\n  provider: []\n  base_url: {}\n  context_length: 0.0\nprovider: openai-codex\napi_base: https://root.invalid/v1\ncontext_length: 64000\n", "openai-codex", "gpt-5.5", "https://root.invalid/v1", 64000),
            ("model:\n  model: gpt-5.5\n  provider: false\n  base_url: ''\n  api_base: https://nested.invalid/v1\n  context_length: 0\nprovider: openai-codex\nbase_url: https://root.invalid/v1\ncontext_length: 64000\n", "openai-codex", "gpt-5.5", "https://root.invalid/v1", 64000),
            ("model:\n  default: gpt-5.5\n  provider: openai-codex\n  base_url: https://nested.invalid/v1\n  context_length: 64000\n  api_mode: codex_responses\n  transport: codex_responses\n  openai_runtime: codex_app_server\nprovider: custom-ignored\nbase_url: https://ignored.invalid\ncontext_length: 1\n", "openai-codex", "gpt-5.5", "https://nested.invalid/v1", 64000),
        ] {
            let fixture = Fixture::new();
            fs::write(fixture.root.join("config.yaml"), config).unwrap();
            let journal = fixture.create();
            let value: serde_yaml::Value = serde_yaml::from_slice(&fs::read(journal.destination.join("config.yaml")).unwrap()).unwrap();
            assert_eq!(value["model"]["provider"], provider);
            assert_eq!(value["model"]["default"], model);
            assert_eq!(value["model"]["base_url"], url);
            assert_eq!(value["model"]["context_length"], context);
            assert!(value.get("provider").is_none());
            assert!(value["model"].get("api_base").is_none());
            if config.contains("codex_app_server") {
                assert_eq!(value["model"]["openai_runtime"], "codex_app_server");
                assert_eq!(value["model"]["api_mode"], "codex_responses");
                assert_eq!(value["model"]["transport"], "codex_responses");
            }
        }
    }

    #[test]
    fn unconfigured_and_unrepresentable_fresh_defaults_are_rejected_without_side_effects() {
        for config in [
            "", "[]", "model: {}", "model: gpt-5.5", "model: [gpt-5.5]", "model: {default: gpt-5.5, provider: auto}",
            "model: {default: '${MODEL}', provider: openai-codex}",
            "model: {default: sk-synthetic-secret, provider: openai-codex}",
            "model: {default: gpt-5.5, provider: openai-codex, api_key: synthetic-secret}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://user:secret@api.invalid/v1'}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://api.invalid/v1?key=secret'}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://api.invalid/sk-synthetic-secret/v1'}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://api.invalid/%73%6b-synthetic-secret/v1'}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://api.invalid/v1%2fsk-synthetic-secret'}",
            "model: {default: gpt-5.5, provider: openai-codex, base_url: 'https://api.invalid/%2573k-synthetic-secret/v1'}",
            "model: {default: gpt-5.5, provider: 'custom:missing'}",
            "model: {default: gpt-5.5, provider: openai-codex, extra_headers: {Authorization: secret}}",
            "model: {default: gpt-5.5, provider: custom:local}\nproviders: {local: {url: 'http://localhost:8000'}}",
            "model: {default: gpt-5.5, provider: openai-codex, max_tokens: '${LIMIT}'}",
            "model: {default: gpt-5.5, provider: openai-codex}\nagent: {reasoning_effort: '${EFFORT}'}",
        ] {
            let fixture = Fixture::new();
            fs::write(fixture.root.join("config.yaml"), config).unwrap();
            let journal = fixture.journal();
            let error = hermes::fresh_preferences(&journal.source).err().expect("setup required");
            assert!(error.contains("hermes -p default model"), "{error}");
            assert!(!error.contains("synthetic-secret"));
            assert!(!fixture.path.exists());
            assert!(!journal.destination.exists());
            assert!(!fixture.base.join("calls").exists());
        }
    }

    #[test]
    fn unsafe_root_config_is_never_read_through_or_accepted() {
        for kind in ["missing", "directory", "symlink", "hardlink", "large"] {
            let fixture = Fixture::new();
            let config = fixture.root.join("config.yaml");
            fs::remove_file(&config).unwrap();
            match kind {
                "missing" => {}
                "directory" => fs::create_dir(&config).unwrap(),
                "symlink" => {
                    fs::write(fixture.other.join("config.yaml"), "model: outside").unwrap();
                    symlink(fixture.other.join("config.yaml"), &config).unwrap();
                }
                "hardlink" => {
                    fs::write(fixture.other.join("config.yaml"), "model: outside").unwrap();
                    fs::hard_link(fixture.other.join("config.yaml"), &config).unwrap();
                }
                "large" => fs::write(&config, vec![b' '; 256 * 1024 + 1]).unwrap(),
                _ => unreachable!(),
            }
            let journal = fixture.journal();
            assert!(
                hermes::fresh_preferences(&journal.source).is_err(),
                "{kind}"
            );
            assert!(!journal.destination.exists());
            assert!(!fixture.base.join("calls").exists());
        }
    }

    #[test]
    fn changed_review_or_legacy_fresh_journal_cannot_create_or_reconcile_but_can_roll_back() {
        let fixture = Fixture::new();
        let mut journal = fixture.journal();
        fixture.approve(&mut journal);
        journal.save(&fixture.path).unwrap();
        fs::write(
            fixture.root.join("config.yaml"),
            "model: {default: changed, provider: openai-codex}",
        )
        .unwrap();
        assert!(hermes::execute(
            &request(AgentProvisioningModeV1::Fresh),
            &mut journal,
            &fixture.path
        )
        .err()
        .expect("changed preferences rejected")
        .contains("review"));
        assert!(!journal.destination.exists());
        assert!(!fs::read_to_string(fixture.base.join("calls"))
            .unwrap()
            .contains("create "));

        let fixture = Fixture::new();
        let mut legacy = fixture.journal();
        legacy.save(&fixture.path).unwrap();
        assert!(hermes::execute(
            &request(AgentProvisioningModeV1::Fresh),
            &mut legacy,
            &fixture.path
        )
        .is_err());
        assert!(!fixture.base.join("calls").exists());
        let mut created = fixture.create();
        created.fresh_model_preferences_hash = None;
        created.save(&fixture.path).unwrap();
        let mut old = fixture.load().unwrap();
        assert!(hermes::candidate(&old, &AgentProvisioningModeV1::Fresh).is_err());
        assert!(hermes::candidate(&old, &AgentProvisioningModeV1::Template).is_ok());
        hermes::rollback_at_home(&mut old, &fixture.path, &fixture.home).unwrap();
        assert!(!old.destination.exists());
    }

    #[test]
    fn fresh_rechecks_after_version_and_writes_only_the_captured_approved_projection() {
        for change_during_version in [true, false] {
            let fixture = Fixture::new();
            let mut script = fs::read_to_string(&fixture.executable).unwrap();
            let change = "printf 'model: {default: later-model, provider: openai-codex}\\n' > \"$root/config.yaml\"; ";
            if change_during_version {
                script = script.replace(
                    "[ \"$1\" = '--version' ] && { ",
                    &format!("[ \"$1\" = '--version' ] && {{ {change}"),
                );
            } else {
                script = script.replace(
                    "  profile:create)\n",
                    &format!("  profile:create)\n    {change}\n"),
                );
            }
            fs::write(&fixture.executable, script).unwrap();
            let mut journal = fixture.journal();
            fixture.approve(&mut journal);
            journal.save(&fixture.path).unwrap();
            let result = hermes::execute(
                &request(AgentProvisioningModeV1::Fresh),
                &mut journal,
                &fixture.path,
            );
            assert!(fs::read_to_string(fixture.root.join("config.yaml"))
                .unwrap()
                .contains("later-model"));
            if change_during_version {
                assert!(result
                    .err()
                    .expect("changed after version")
                    .contains("review"));
                assert!(!journal.destination.exists());
                assert!(!fs::read_to_string(fixture.base.join("calls"))
                    .unwrap()
                    .contains("create "));
            } else {
                assert!(result.is_ok());
                let config: serde_yaml::Value = serde_yaml::from_slice(
                    &fs::read(journal.destination.join("config.yaml")).unwrap(),
                )
                .unwrap();
                assert_eq!(config["model"]["default"], "gpt-5.5");
                assert_eq!(
                    fs::metadata(journal.destination.join("config.yaml"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
                assert!(hermes::candidate(&journal, &AgentProvisioningModeV1::Fresh).is_ok());
                fs::write(
                    journal.destination.join("config.yaml"),
                    "model: {default: later-model, provider: openai-codex}",
                )
                .unwrap();
                assert!(hermes::candidate(&journal, &AgentProvisioningModeV1::Fresh).is_err());
            }
        }
    }

    #[test]
    fn unexpected_native_config_is_not_overwritten_and_saved_profile_remains_recoverable() {
        for linked in [false, true] {
            let fixture = Fixture::new();
            let outside = fixture.other.join("keep");
            fs::write(&outside, "unrelated-file").unwrap();
            let extra = if linked {
                format!(
                    "/bin/ln -s '{}' \"$root/profiles/$3/config.yaml\"",
                    outside.display()
                )
            } else {
                "printf 'native-owned-config' > \"$root/profiles/$3/config.yaml\"".into()
            };
            let script = fs::read_to_string(&fixture.executable)
                .unwrap()
                .replace("    : ;;", &format!("    {extra} ;;"));
            fs::write(&fixture.executable, script).unwrap();
            let mut journal = fixture.journal();
            fixture.approve(&mut journal);
            journal.save(&fixture.path).unwrap();
            assert!(hermes::execute(
                &request(AgentProvisioningModeV1::Fresh),
                &mut journal,
                &fixture.path
            )
            .is_err());
            assert_eq!(fs::read_to_string(&outside).unwrap(), "unrelated-file");
            let saved = fixture.load().unwrap();
            saved.verify_created().unwrap();
            assert!(!saved.configured);
            assert!(hermes::candidate(&saved, &AgentProvisioningModeV1::Fresh).is_err());
            if !linked {
                assert_eq!(
                    fs::read_to_string(saved.destination.join("config.yaml")).unwrap(),
                    "native-owned-config"
                );
            }
        }
    }

    #[test]
    fn hermes_create_uses_reviewed_custom_root_and_recovers_without_ambient_slug_discovery() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.other.join("profiles/helper")).unwrap();
        fs::write(fixture.other.join("profiles/helper/keep"), "other-root").unwrap();
        let journal = fixture.create();
        let binding = journal.binding().unwrap();
        let mut recovered = fixture.load().unwrap();
        assert_eq!(
            hermes::candidate(&recovered, &AgentProvisioningModeV1::Fresh)
                .unwrap()
                .binding_preview,
            binding
        );
        assert!(recovered.destination.join("SOUL.md").is_file());
        assert!(hermes::execute(
            &request(AgentProvisioningModeV1::Fresh),
            &mut recovered,
            &fixture.path
        )
        .is_err());
        hermes::rollback_at_home(&mut recovered, &fixture.path, &fixture.home).unwrap();
        assert!(!journal.destination.exists());
        assert_eq!(
            fs::read_to_string(fixture.other.join("profiles/helper/keep")).unwrap(),
            "other-root"
        );
        let mut closed = fixture.load().unwrap();
        hermes::rollback_at_home(&mut closed, &fixture.path, &fixture.home).unwrap();
        let calls = fs::read_to_string(fixture.base.join("calls")).unwrap();
        assert_eq!(
            calls
                .lines()
                .filter(|line| line.starts_with("create "))
                .count(),
            1
        );
        assert_eq!(
            calls
                .lines()
                .filter(|line| line.starts_with("delete "))
                .count(),
            1
        );
        assert!(calls
            .lines()
            .all(|line| line.ends_with(fixture.root.to_str().unwrap())));
        assert_eq!(
            fs::metadata(&fixture.path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn collision_and_dangling_symlink_refuse_creation_before_any_command() {
        for dangling in [false, true] {
            let fixture = Fixture::new();
            let mut journal = fixture.journal();
            fixture.approve(&mut journal);
            fs::create_dir_all(fixture.root.join("profiles")).unwrap();
            if dangling {
                symlink(fixture.base.join("missing"), &journal.destination).unwrap();
            } else {
                fs::create_dir(&journal.destination).unwrap();
            }
            assert!(hermes::execute(
                &request(AgentProvisioningModeV1::Fresh),
                &mut journal,
                &fixture.path
            )
            .is_err());
            assert!(!fixture.base.join("calls").exists());
        }
    }

    #[test]
    fn changed_executable_and_replaced_directory_never_substitute_or_delete() {
        let fixture = Fixture::new();
        let mut journal = fixture.create();
        let old = fixture.base.join("original-profile");
        fs::rename(&journal.destination, &old).unwrap();
        fs::create_dir(&journal.destination).unwrap();
        fs::write(journal.destination.join("keep"), "replacement").unwrap();
        assert!(hermes::candidate(&journal, &AgentProvisioningModeV1::Fresh).is_err());
        assert!(hermes::rollback_at_home(&mut journal, &fixture.path, &fixture.home).is_err());
        assert_eq!(
            fs::read_to_string(journal.destination.join("keep")).unwrap(),
            "replacement"
        );
        fs::write(&fixture.executable, "#!/bin/sh\nexit 99\n").unwrap();
        assert!(fixture.load().is_err());
        assert!(!fs::read_to_string(fixture.base.join("calls"))
            .unwrap()
            .contains("delete "));
    }

    #[test]
    fn replacing_a_reviewed_template_profile_refuses_every_native_command_and_copy() {
        let fixture = Fixture::new();
        let source = fixture.root.join("profiles/template");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("config.yaml"), "model: reviewed-template\n").unwrap();
        let binding = crate::managed_agents::build_hermes_runtime_binding(
            "template".into(),
            source.clone(),
            fixture.executable.clone(),
            "0.17.0".into(),
            None,
        );
        let mut journal =
            HermesJournal::prepare("owner", "transaction", "request", binding, "helper").unwrap();
        journal.save(&fixture.path).unwrap();
        let original = fixture.base.join("original-template");
        fs::rename(&source, &original).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("config.yaml"), "model: replacement-template\n").unwrap();
        let mut input = request(AgentProvisioningModeV1::Template);
        input.source_semantic_id = Some("reviewed-template".into());
        assert!(hermes::execute(&input, &mut journal, &fixture.path).is_err());
        assert!(!journal.destination.exists());
        assert!(!fixture.base.join("calls").exists());
        assert!(fixture.load().is_err());
        assert_eq!(
            fs::read_to_string(original.join("config.yaml")).unwrap(),
            "model: reviewed-template\n"
        );
    }

    #[test]
    fn missing_corrupt_mismatched_and_symlinked_journals_fail_closed() {
        let fixture = Fixture::new();
        assert!(fixture.load().is_err());
        let journal = fixture.create();
        assert!(
            HermesJournal::load(&fixture.path, "other-owner", "transaction", "request").is_err()
        );
        assert!(
            HermesJournal::load(&fixture.path, "owner", "other-transaction", "request").is_err()
        );
        assert!(
            HermesJournal::load(&fixture.path, "owner", "transaction", "changed-request").is_err()
        );
        fs::write(&fixture.path, "{}").unwrap();
        assert!(fixture.load().is_err());
        fs::remove_file(&fixture.path).unwrap();
        let other = fixture.base.join("other-journal.json");
        journal.save(&other).unwrap();
        symlink(&other, &fixture.path).unwrap();
        assert!(fixture.load().is_err());
        assert!(journal.save(&fixture.path).is_err());
        assert!(journal.destination.is_dir());
    }

    #[test]
    fn ambiguous_creation_has_no_cleanup_authority_and_witness_precedes_clone_writes() {
        let fixture = Fixture::new();
        let mut journal = fixture.journal();
        journal.save(&fixture.path).unwrap();
        fs::create_dir_all(&journal.destination).unwrap();
        assert!(hermes::rollback_at_home(&mut journal, &fixture.path, &fixture.home).is_err());
        assert!(journal.destination.exists());

        let fixture = Fixture::new();
        fs::write(
            fixture.root.join("config.yaml"),
            "model:\n  api_key: synthetic-secret\n",
        )
        .unwrap();
        let mut journal = fixture.journal();
        journal.save(&fixture.path).unwrap();
        let mut input = request(AgentProvisioningModeV1::Template);
        input.source_semantic_id = Some("reviewed".into());
        assert!(hermes::execute(&input, &mut journal, &fixture.path).is_err());
        let mut recovered = fixture.load().unwrap();
        recovered.verify_created().unwrap();
        assert!(!recovered.configured);
        assert!(hermes::candidate(&recovered, &AgentProvisioningModeV1::Template).is_err());
        assert!(
            !fs::read_to_string(recovered.destination.join("config.yaml"))
                .unwrap_or_default()
                .contains("synthetic-secret")
        );
        hermes::rollback_at_home(&mut recovered, &fixture.path, &fixture.home).unwrap();
    }

    #[test]
    fn alias_and_service_conflicts_are_rechecked_before_cleanup() {
        for relative in [
            ".local/bin/helper",
            "Library/LaunchAgents/ai.hermes.gateway-helper.plist",
            ".config/systemd/user/hermes-gateway-helper.service",
        ] {
            let fixture = Fixture::new();
            let mut journal = fixture.create();
            let conflict = fixture.home.join(relative);
            fs::create_dir_all(conflict.parent().unwrap()).unwrap();
            fs::write(&conflict, "unrelated-native-object").unwrap();
            assert!(
                hermes::rollback_at_home(&mut journal, &fixture.path, &fixture.home)
                    .unwrap_err()
                    .contains("alias, service")
            );
            assert_eq!(
                fs::read_to_string(conflict).unwrap(),
                "unrelated-native-object"
            );
            assert!(journal.destination.is_dir());
            assert!(!fs::read_to_string(fixture.base.join("calls"))
                .unwrap()
                .contains("delete "));
        }
    }

    #[test]
    fn failed_native_cleanup_never_becomes_presumed_success_or_replayed_deletion() {
        let fixture = Fixture::new();
        let script = fs::read_to_string(&fixture.executable).unwrap().replace(
            "profile:delete) /bin/rm -rf \"$root/profiles/$3\" ;;",
            "profile:delete) /bin/rm -rf \"$root/profiles/$3\"; exit 17 ;;",
        );
        fs::write(&fixture.executable, script).unwrap();
        let mut journal = fixture.create();
        let error =
            hermes::rollback_at_home(&mut journal, &fixture.path, &fixture.home).unwrap_err();
        assert!(error.contains("could not be confirmed"));
        assert!(!journal.destination.exists());
        let mut recovered = fixture.load().unwrap();
        assert!(!recovered.removed);
        let error =
            hermes::rollback_at_home(&mut recovered, &fixture.path, &fixture.home).unwrap_err();
        assert!(!error.contains("nothing was removed"));
        assert_eq!(
            fs::read_to_string(fixture.base.join("calls"))
                .unwrap()
                .lines()
                .filter(|line| line.starts_with("delete "))
                .count(),
            1
        );
    }

    #[test]
    fn profile_guard_serializes_different_transactions_for_the_same_root_only() {
        let fixture = Fixture::new();
        let journal = fixture.journal();
        let held = ProfileGuard::acquire(&journal).unwrap();
        assert!(ProfileGuard::acquire(&journal).is_err());
        let other = Fixture::new();
        assert!(ProfileGuard::acquire(&other.journal()).is_ok());
        drop(held);
        assert!(ProfileGuard::acquire(&journal).is_ok());
    }
}

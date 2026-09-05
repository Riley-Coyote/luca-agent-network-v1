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
    printf 'model: fixture\n' > "$root/profiles/$3/config.yaml" ;;
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

        fn create(&self) -> HermesJournal {
            let mut journal = self.journal();
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
    fn hermes_create_uses_reviewed_custom_root_and_recovers_without_ambient_slug_discovery() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.other.join("profiles/helper")).unwrap();
        fs::write(fixture.other.join("profiles/helper/keep"), "other-root").unwrap();
        let journal = fixture.create();
        let binding = journal.binding().unwrap();
        let mut recovered = fixture.load().unwrap();
        assert_eq!(
            hermes::candidate(&recovered).unwrap().binding_preview,
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
        assert!(hermes::candidate(&journal).is_err());
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
        assert!(hermes::candidate(&recovered).is_err());
        assert!(
            !fs::read_to_string(recovered.destination.join("config.yaml"))
                .unwrap()
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

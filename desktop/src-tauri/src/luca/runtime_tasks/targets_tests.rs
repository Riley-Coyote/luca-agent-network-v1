use std::io::{Cursor, Write};

use tempfile::{tempdir, TempDir};

use super::*;

const SESSION_ID: &str = "9ab62e3b-f826-4f2f-8e04-b06975506abc";
const OTHER_ID: &str = "8ed9b580-60ea-40d7-b1f0-67c2730bdff3";

struct Fixture {
    _source_directory: TempDir,
    _working_directory: TempDir,
    source: RuntimeTaskTargetSourceV1,
    working_folder: PathBuf,
    locator: String,
    session_ref: OpaqueId,
}

impl Fixture {
    fn new(kind: ConnectedBrainSourceKindV1) -> Self {
        let source_directory = tempdir().unwrap();
        let working_directory = tempdir().unwrap();
        let source = RuntimeTaskTargetSourceV1 {
            source_id: OpaqueId::parse("connected-synthetic-target-proof").unwrap(),
            source_kind: kind,
            canonical_root: source_directory.path().canonicalize().unwrap(),
            status: ConnectedBrainSourceStatusV1::Current,
        };
        let locator = match kind {
            ConnectedBrainSourceKindV1::CodexHistory => {
                format!("2026/10/04/rollout-2026-10-04T00-00-00-{SESSION_ID}.jsonl")
            }
            _ => format!("synthetic-native-project/{SESSION_ID}.jsonl"),
        };
        let working_folder = working_directory.path().canonicalize().unwrap();
        let fixture = Self {
            session_ref: native_session_opaque_id(&source.source_id, &locator).unwrap(),
            _source_directory: source_directory,
            _working_directory: working_directory,
            source,
            working_folder,
            locator,
        };
        let content = match kind {
            ConnectedBrainSourceKindV1::CodexHistory => fixture.codex_header(
                SESSION_ID,
                &fixture.working_folder,
                "vscode",
                "Codex Desktop",
            ),
            _ => fixture.claude_row("user", SESSION_ID, Some(&fixture.working_folder)),
        };
        fixture.write(&content);
        fixture
    }

    fn path(&self) -> PathBuf {
        self.source.canonical_root.join(&self.locator)
    }

    fn write(&self, content: &str) {
        fs::create_dir_all(self.path().parent().unwrap()).unwrap();
        fs::write(self.path(), content).unwrap();
    }

    fn codex_header(&self, id: &str, cwd: &Path, source: &str, originator: &str) -> String {
        format!(
            "{}\n",
            serde_json::json!({
                "type": "session_meta",
                "payload": {"id": id, "cwd": cwd, "source": source, "originator": originator,
                            "base_instructions": {"text": "SYNTHETIC_NOT_A_TARGET_LABEL"}}
            })
        )
    }

    fn claude_row(&self, kind: &str, id: &str, cwd: Option<&Path>) -> String {
        format!(
            "{}\n",
            serde_json::json!({"type": kind, "sessionId": id, "cwd": cwd,
                              "isSidechain": false,
                              "message": {"content": "SYNTHETIC_NOT_A_TARGET_LABEL"}})
        )
    }

    fn resolve(&self) -> Result<RuntimeTaskExistingTargetV1, String> {
        resolve_connected_session_target(
            &self.source,
            &self.session_ref,
            runtime_for_kind(self.source.source_kind)?,
            None,
            &HashSet::new(),
        )
    }
}

fn fails<T>(result: Result<T, String>, expected: &str) {
    match result {
        Ok(_) => panic!("unexpected target resolution success"),
        Err(error) => assert!(error.contains(expected), "unexpected safe error: {error}"),
    }
}

#[test]
fn exact_codex_target_uses_original_uuid_cwd_and_safe_snapshot() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    // Invalid later records are not parsed or replayed as session authority.
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(fixture.path())
        .unwrap();
    file.write_all(b"not a transcript record\n").unwrap();
    let target = fixture.resolve().unwrap();
    assert_eq!(target.runtime_family, "codex");
    assert_eq!(target.provider_session_id.to_string(), SESSION_ID);
    assert_eq!(target.canonical_working_folder, fixture.working_folder);
    assert_eq!(target.source_id, fixture.source.source_id);
    assert_eq!(target.session_ref, fixture.session_ref);
    assert!(target.updated_at.is_some());
    assert_eq!(target.codex_origin, Some(CodexSessionOriginV1::NativeApp));
    assert_eq!(target.label, "Codex session 9ab62e3b");
    assert!(!target.label.contains("SYNTHETIC_NOT_A_TARGET_LABEL"));
    assert!(!target
        .label
        .contains(fixture.working_folder.to_str().unwrap()));
    target.require_codex_app_queue().unwrap();
    fails(target.require_saved_codex_cli(), "saved Codex CLI");
}

#[test]
fn saved_cli_and_native_app_control_are_not_substitutable() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    fixture.write(&fixture.codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec"));
    let target = fixture.resolve().unwrap();
    target.require_saved_codex_cli().unwrap();
    fails(target.require_codex_app_queue(), "verified Codex app");
    fixture.write(&fixture.codex_header(
        SESSION_ID,
        &fixture.working_folder,
        "vscode",
        "some-other-controller",
    ));
    let unknown = fixture.resolve().unwrap();
    assert_eq!(unknown.codex_origin, Some(CodexSessionOriginV1::Unknown));
    fails(unknown.require_saved_codex_cli(), "saved Codex CLI");
    fails(unknown.require_codex_app_queue(), "verified Codex app");
}

#[test]
fn wrong_provider_and_repository_sources_fail_before_lookup() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &fixture.session_ref,
            "claude_code",
            None,
            &HashSet::new(),
        ),
        "different runtime",
    );
    let mut source = fixture.source.clone();
    source.source_kind = ConnectedBrainSourceKindV1::Repository;
    fails(
        resolve_connected_session_target(
            &source,
            &fixture.session_ref,
            "codex",
            None,
            &HashSet::new(),
        ),
        "not a repository",
    );
}

#[test]
fn non_current_and_disconnected_sources_are_not_target_authority() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    for status in [
        ConnectedBrainSourceStatusV1::Connecting,
        ConnectedBrainSourceStatusV1::NeedsAttention,
        ConnectedBrainSourceStatusV1::Unavailable,
        ConnectedBrainSourceStatusV1::Disconnected,
    ] {
        let mut source = fixture.source.clone();
        source.status = status;
        fails(
            resolve_connected_session_target(
                &source,
                &fixture.session_ref,
                "codex",
                None,
                &HashSet::new(),
            ),
            "stale",
        );
    }
}

#[test]
fn source_and_session_opaque_ids_are_both_required_no_title_or_latest_guess() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let other_ref = OpaqueId::parse("session-never-in-this-source").unwrap();
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &other_ref,
            "codex",
            None,
            &HashSet::new(),
        ),
        "exact selected session",
    );
    let mut other_source = fixture.source.clone();
    other_source.source_id = OpaqueId::parse("connected-another-source").unwrap();
    fails(
        resolve_connected_session_target(
            &other_source,
            &fixture.session_ref,
            "codex",
            None,
            &HashSet::new(),
        ),
        "exact selected session",
    );
}

#[test]
fn path_uuid_and_header_uuid_must_match_exactly() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    fixture.write(&fixture.codex_header(OTHER_ID, &fixture.working_folder, "exec", "codex_exec"));
    fails(fixture.resolve(), "UUID do not match");
    fixture.write(&fixture.codex_header(
        &SESSION_ID.to_uppercase(),
        &fixture.working_folder,
        "exec",
        "codex_exec",
    ));
    fails(fixture.resolve(), "noncanonical");
    fixture.write(&fixture.codex_header(
        "not-a-uuid",
        &fixture.working_folder,
        "exec",
        "codex_exec",
    ));
    fails(fixture.resolve(), "malformed");
}

#[test]
fn missing_relative_unavailable_or_root_cwd_is_rejected() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    for cwd in [
        "",
        "relative/project",
        "/",
        "/does-not-exist-synthetic-target-proof",
    ] {
        fixture.write(&fixture.codex_header(SESSION_ID, Path::new(cwd), "exec", "codex_exec"));
        assert!(fixture.resolve().is_err());
    }
    fixture.write(&format!(
        "{}\n",
        serde_json::json!({"type":"session_meta","payload":{"id":SESSION_ID}})
    ));
    fails(fixture.resolve(), "malformed");
}

#[test]
fn requested_folder_cannot_redirect_existing_native_work() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let other = tempdir().unwrap();
    let other = other.path().canonicalize().unwrap();
    resolve_connected_session_target(
        &fixture.source,
        &fixture.session_ref,
        "codex",
        Some(&fixture.working_folder),
        &HashSet::new(),
    )
    .unwrap();
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &fixture.session_ref,
            "codex",
            Some(&other),
            &HashSet::new(),
        ),
        "differs from the native session",
    );
}

#[test]
fn truncated_duplicate_and_oversized_identity_metadata_fail_closed() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    fixture.write(
        fixture
            .codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec")
            .trim_end(),
    );
    fails(fixture.resolve(), "truncated");
    fixture.write("{broken-json}\n");
    fails(fixture.resolve(), "malformed");
    fixture.write(&format!("{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{SESSION_ID}\",\"id\":\"{OTHER_ID}\",\"cwd\":\"/synthetic\"}}}}\n"));
    fails(fixture.resolve(), "malformed");
    let oversized = format!(
        "{}\n",
        serde_json::json!({"type":"session_meta","payload":{"id":SESSION_ID,"cwd":fixture.working_folder,"ignored": "X".repeat(MAX_METADATA_BYTES)}})
    );
    fixture.write(&oversized);
    fails(fixture.resolve(), "bounded read limit");
}

#[test]
fn unrelated_files_are_never_opened_or_parsed_for_target_lookup() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let unrelated = fixture
        .source
        .canonical_root
        .join(format!("rollout-unrelated-{OTHER_ID}.jsonl"));
    fs::write(
        &unrelated,
        "# Luca managed resident\ninvalid unrelated transcript",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&unrelated, fs::Permissions::from_mode(0o000)).unwrap();
    }
    assert!(fixture.resolve().is_ok());
}

#[test]
fn excluded_native_ids_and_internal_session_policy_are_reused() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let excluded = HashSet::from([SESSION_ID.to_owned()]);
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &fixture.session_ref,
            "codex",
            None,
            &excluded,
        ),
        "excluded",
    );
    fixture.write(
        &(fixture.codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec")
            + "# Luca managed resident\n"),
    );
    fails(fixture.resolve(), "excluded");
}

#[test]
fn lookup_deadline_entry_count_and_depth_are_hard_bounds() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    fails(
        find_selected_locator(&fixture.source, &fixture.session_ref, Instant::now(), 40, 8),
        "timed out",
    );
    fails(
        find_selected_locator(
            &fixture.source,
            &fixture.session_ref,
            Instant::now() + LOOKUP_TIMEOUT,
            0,
            8,
        ),
        "metadata budget",
    );
    fails(
        find_selected_locator(
            &fixture.source,
            &fixture.session_ref,
            Instant::now() + LOOKUP_TIMEOUT,
            40,
            0,
        ),
        "depth bound",
    );
}

#[test]
fn unsafe_locators_cannot_bypass_the_connected_source() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    for locator in [
        "../outside.jsonl",
        "/outside.jsonl",
        "./outside.jsonl",
        "outside\\file.jsonl",
        "outside\nfile.jsonl",
    ] {
        assert!(checked_session_path(&fixture.source, locator).is_err());
    }
}

#[cfg(unix)]
#[test]
fn symlink_file_directory_and_source_replacement_fail_closed() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let outside = tempdir().unwrap();
    let outside_file = outside
        .path()
        .join(format!("rollout-outside-{OTHER_ID}.jsonl"));
    fs::write(
        &outside_file,
        fixture.codex_header(OTHER_ID, &fixture.working_folder, "exec", "codex_exec"),
    )
    .unwrap();
    let link = fixture
        .source
        .canonical_root
        .join(format!("rollout-link-{OTHER_ID}.jsonl"));
    symlink(&outside_file, &link).unwrap();
    let selection = native_session_opaque_id(
        &fixture.source.source_id,
        link.file_name().unwrap().to_str().unwrap(),
    )
    .unwrap();
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &selection,
            "codex",
            None,
            &HashSet::new(),
        ),
        "exact selected session",
    );
    assert!(
        checked_session_path(&fixture.source, link.file_name().unwrap().to_str().unwrap()).is_err()
    );
    symlink(
        outside.path(),
        fixture.source.canonical_root.join("linked-directory"),
    )
    .unwrap();
    assert!(checked_session_path(
        &fixture.source,
        &format!("linked-directory/rollout-outside-{OTHER_ID}.jsonl")
    )
    .is_err());
    let source_link = outside.path().join("source-link");
    symlink(&fixture.source.canonical_root, &source_link).unwrap();
    let mut bad_source = fixture.source.clone();
    bad_source.canonical_root = source_link;
    fails(
        resolve_connected_session_target(
            &bad_source,
            &fixture.session_ref,
            "codex",
            None,
            &HashSet::new(),
        ),
        "moved",
    );
}

#[test]
fn claude_uses_native_cwd_and_uuid_not_encoded_project_names_or_messages() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    fixture.write(
        &(fixture.claude_row("custom-title", SESSION_ID, None)
            + &fixture.claude_row("attachment", SESSION_ID, Some(&fixture.working_folder))
            + &fixture.claude_row("user", SESSION_ID, Some(&fixture.working_folder))
            + "not parsed after original metadata\n"),
    );
    let target = fixture.resolve().unwrap();
    assert_eq!(target.provider_session_id.to_string(), SESSION_ID);
    assert_eq!(target.canonical_working_folder, fixture.working_folder);
    assert_eq!(target.runtime_family, "claude_code");
    assert_eq!(target.codex_origin, None);
    assert_eq!(target.label, "Claude Code session 9ab62e3b");
    assert!(!target.label.contains("SYNTHETIC_NOT_A_TARGET_LABEL"));
    fails(target.require_saved_codex_cli(), "saved Codex CLI");
    fails(target.require_codex_app_queue(), "verified Codex app");
    resolve_connected_session_target(
        &fixture.source,
        &fixture.session_ref,
        "claude",
        None,
        &HashSet::new(),
    )
    .unwrap();
}

#[test]
fn claude_uuid_conflicting_cwd_missing_identity_and_sidechains_are_rejected() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    fixture.write(&fixture.claude_row("user", OTHER_ID, Some(&fixture.working_folder)));
    fails(fixture.resolve(), "UUID do not match");
    let other = tempdir().unwrap();
    fixture.write(
        &(fixture.claude_row("attachment", SESSION_ID, Some(&fixture.working_folder))
            + &fixture.claude_row("user", SESSION_ID, Some(other.path()))),
    );
    fails(fixture.resolve(), "ambiguous working-folder");
    fixture.write(&fixture.claude_row("custom-title", SESSION_ID, None));
    fails(fixture.resolve(), "no unambiguous native working folder");
    fixture.write(&format!(
        "{}\n",
        serde_json::json!({"type":"attachment","cwd":fixture.working_folder})
    ));
    fails(fixture.resolve(), "no exact native session identity");
    fixture.write(&format!("{}\n", serde_json::json!({"type":"user","sessionId":SESSION_ID,"cwd":fixture.working_folder,"isSidechain":true})));
    fails(fixture.resolve(), "not an eligible root Claude");
}

#[test]
fn claude_metadata_prefix_never_exceeds_line_or_byte_bounds() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    fixture.write(
        &fixture
            .claude_row("custom-title", SESSION_ID, None)
            .repeat(MAX_METADATA_LINES + 1),
    );
    fails(fixture.resolve(), "bounded read limit");
    fixture.write(
        fixture
            .claude_row("user", SESSION_ID, Some(&fixture.working_folder))
            .trim_end(),
    );
    fails(fixture.resolve(), "truncated");
    fixture.write(&format!("{{\"type\":\"user\",\"sessionId\":\"{SESSION_ID}\",\"sessionId\":\"{OTHER_ID}\",\"cwd\":\"/synthetic\"}}\n"));
    fails(fixture.resolve(), "malformed");
}

#[test]
fn confirmation_revalidation_preserves_exact_locator_and_allows_later_appends() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let target = fixture.resolve().unwrap();
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(fixture.path())
        .unwrap();
    file.write_all(b"later synthetic body is not target authority\n")
        .unwrap();
    let rechecked =
        revalidate_connected_session_target(&fixture.source, &target, None, &HashSet::new())
            .unwrap();
    assert_eq!(rechecked.provider_session_id, target.provider_session_id);
    assert_eq!(rechecked.relative_locator, target.relative_locator);
    assert_eq!(
        rechecked.canonical_working_folder,
        target.canonical_working_folder
    );
}

#[test]
fn confirmation_revalidation_rejects_folder_origin_source_and_exclusion_changes() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let target = fixture.resolve().unwrap();
    let other = tempdir().unwrap();
    fixture.write(&fixture.codex_header(SESSION_ID, other.path(), "vscode", "Codex Desktop"));
    fails(
        revalidate_connected_session_target(&fixture.source, &target, None, &HashSet::new()),
        "working folder changed",
    );
    fixture.write(&fixture.codex_header(SESSION_ID, &fixture.working_folder, "exec", "codex_exec"));
    fails(
        revalidate_connected_session_target(&fixture.source, &target, None, &HashSet::new()),
        "identity or working folder changed",
    );
    fixture.write(&fixture.codex_header(
        SESSION_ID,
        &fixture.working_folder,
        "vscode",
        "Codex Desktop",
    ));
    let mut changed_source = fixture.source.clone();
    changed_source.canonical_root = other.path().canonicalize().unwrap();
    fails(
        revalidate_connected_session_target(&changed_source, &target, None, &HashSet::new()),
        "connected source changed",
    );
    fails(
        revalidate_connected_session_target(
            &fixture.source,
            &target,
            None,
            &HashSet::from([SESSION_ID.to_owned()]),
        ),
        "excluded",
    );
}

#[test]
fn metadata_only_reader_does_not_need_native_reference_or_any_provider_process() {
    let working_directory = tempdir().unwrap();
    let working_folder = working_directory.path().canonicalize().unwrap();
    let bytes = format!(
        "{}\n",
        serde_json::json!({"type":"session_meta","payload":{"id":SESSION_ID,"cwd":working_folder,"source":"exec","originator":"codex_exec"}})
    );
    let metadata = read_codex_metadata(
        &mut Cursor::new(bytes),
        Uuid::parse_str(SESSION_ID).unwrap(),
    )
    .unwrap();
    assert_eq!(metadata.cwd, working_folder);
    assert_eq!(metadata.codex_origin, Some(CodexSessionOriginV1::SavedCli));
}

#[test]
fn provider_metadata_shape_cannot_be_swapped_between_connected_sources() {
    let codex = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    codex.write(&codex.claude_row("user", SESSION_ID, Some(&codex.working_folder)));
    fails(codex.resolve(), "malformed");
    let claude = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    claude.write(&claude.codex_header(SESSION_ID, &claude.working_folder, "exec", "codex_exec"));
    fails(claude.resolve(), "not an eligible root Claude");
}

#[test]
fn claude_subagent_location_is_not_an_existing_root_target() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    let locator = format!("synthetic-native-project/subagents/{OTHER_ID}.jsonl");
    let path = fixture.source.canonical_root.join(&locator);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(
        path,
        fixture.claude_row("user", OTHER_ID, Some(&fixture.working_folder)),
    )
    .unwrap();
    let session_ref = native_session_opaque_id(&fixture.source.source_id, &locator).unwrap();
    fails(
        resolve_connected_session_target(
            &fixture.source,
            &session_ref,
            "claude_code",
            None,
            &HashSet::new(),
        ),
        "exact selected session",
    );
    fails(checked_session_path(&fixture.source, &locator), "subagent");
}

#[cfg(unix)]
#[test]
fn working_folder_symlink_change_invalidates_confirmation() {
    use std::os::unix::fs::symlink;

    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let folder_alias = fixture.source.canonical_root.join("synthetic-cwd-alias");
    symlink(&fixture.working_folder, &folder_alias).unwrap();
    fixture.write(&fixture.codex_header(SESSION_ID, &folder_alias, "exec", "codex_exec"));
    let target = fixture.resolve().unwrap();
    let other = tempdir().unwrap();
    // Test-owned symlink only; neither synthetic working directory is removed.
    fs::remove_file(&folder_alias).unwrap();
    symlink(other.path(), &folder_alias).unwrap();
    fails(
        revalidate_connected_session_target(&fixture.source, &target, None, &HashSet::new()),
        "working folder changed",
    );
}

#[test]
fn file_snapshot_validation_detects_replacement_and_content_changes() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let before = fs::metadata(fixture.path()).unwrap();
    assert!(same_file_snapshot(&before, &before));
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(fixture.path())
        .unwrap();
    file.write_all(b"a changed native file snapshot\n").unwrap();
    let after = fs::metadata(fixture.path()).unwrap();
    assert!(!same_file_snapshot(&before, &after));
    assert!(!same_file_snapshot(
        &before,
        &fs::metadata(&fixture.source.canonical_root).unwrap()
    ));
}

fn set_modified(path: &Path, seconds: u64) {
    File::open(path)
        .unwrap()
        .set_times(
            std::fs::FileTimes::new()
                .set_modified(SystemTime::UNIX_EPOCH + Duration::from_secs(seconds)),
        )
        .unwrap();
}

fn add_listing_codex_file(fixture: &Fixture, id: &str, seconds: u64) -> (PathBuf, OpaqueId) {
    let locator = format!("rollout-synthetic-listing-{id}.jsonl");
    let path = fixture.source.canonical_root.join(&locator);
    fs::write(
        &path,
        fixture.codex_header(id, &fixture.working_folder, "vscode", "Codex Desktop"),
    )
    .unwrap();
    set_modified(&path, seconds);
    (
        path,
        native_session_opaque_id(&fixture.source.source_id, &locator).unwrap(),
    )
}

#[test]
fn listing_sorts_metadata_before_limiting_and_filters_known_exclusions_first() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    set_modified(&fixture.path(), 100);
    let (_, middle_ref) = add_listing_codex_file(&fixture, OTHER_ID, 200);
    let newest_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    let (_, newest_ref) = add_listing_codex_file(&fixture, newest_id, 300);
    let newest =
        list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), 1).unwrap();
    assert!(newest.truncated);
    assert_eq!(newest.candidates.len(), 1);
    assert_eq!(newest.candidates[0].session_ref, newest_ref);
    assert_eq!(newest.candidates[0].label, "Codex session aaaaaaaa");
    assert_eq!(
        newest.candidates[0].codex_origin,
        Some(CodexSessionOriginV1::NativeApp)
    );
    assert_eq!(
        newest.candidates[0].workspace_basename,
        fixture
            .working_folder
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
    );
    assert_eq!(
        newest.candidates[0].updated_at.as_deref(),
        Some("1970-01-01T00:05:00+00:00")
    );
    assert!(!newest.candidates[0].label.contains(newest_id));
    assert!(!newest.candidates[0].workspace_basename.contains('/'));
    let excluded_newest = list_connected_session_targets(
        &fixture.source,
        "codex",
        &HashSet::from([newest_id.to_owned()]),
        1,
    )
    .unwrap();
    assert!(excluded_newest.truncated);
    assert_eq!(excluded_newest.candidates[0].session_ref, middle_ref);
    let full =
        list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), 50).unwrap();
    assert!(!full.truncated);
    assert_eq!(full.candidates.len(), 3);
    assert_eq!(full.candidates[0].session_ref, newest_ref);
    assert_eq!(full.candidates[1].session_ref, middle_ref);
    assert_eq!(full.candidates[2].session_ref, fixture.session_ref);
}

#[test]
fn listing_never_fills_past_chosen_prefix_limit_after_a_bad_candidate() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    set_modified(&fixture.path(), 100);
    let (malformed, _) = add_listing_codex_file(&fixture, OTHER_ID, 300);
    fs::write(&malformed, "malformed native metadata\n").unwrap();
    set_modified(&malformed, 300);
    let limited =
        list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), 1).unwrap();
    assert!(limited.truncated);
    assert!(limited.candidates.is_empty());
    let full =
        list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), 50).unwrap();
    assert!(!full.truncated);
    assert_eq!(full.candidates.len(), 1);
    assert_eq!(full.candidates[0].session_ref, fixture.session_ref);
}

#[test]
fn listing_omits_internal_metadata_targets_and_keeps_claude_execution_unenabled() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    let internal_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    let (internal, _) = add_listing_codex_file(&fixture, internal_id, 300);
    fs::write(
        &internal,
        fixture.codex_header(internal_id, &fixture.working_folder, "exec", "codex_exec")
            + "# Luca managed resident\n",
    )
    .unwrap();
    let result =
        list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), 50).unwrap();
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.candidates[0].session_ref, fixture.session_ref);
    let claude = Fixture::new(ConnectedBrainSourceKindV1::ClaudeHistory);
    let result =
        list_connected_session_targets(&claude.source, "claude_code", &HashSet::new(), 1).unwrap();
    assert!(!result.truncated);
    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.candidates[0].codex_origin, None);
}

#[test]
fn listing_requires_current_matching_source_and_limit_at_most_fifty() {
    let fixture = Fixture::new(ConnectedBrainSourceKindV1::CodexHistory);
    for limit in [0, 51] {
        fails(
            list_connected_session_targets(&fixture.source, "codex", &HashSet::new(), limit),
            "1 to 50",
        );
    }
    fails(
        list_connected_session_targets(&fixture.source, "claude_code", &HashSet::new(), 1),
        "different runtime",
    );
    let mut disconnected = fixture.source.clone();
    disconnected.status = ConnectedBrainSourceStatusV1::Disconnected;
    fails(
        list_connected_session_targets(&disconnected, "codex", &HashSet::new(), 1),
        "disconnected",
    );
}

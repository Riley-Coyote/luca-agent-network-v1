use std::{collections::HashSet, fs};

use tempfile::TempDir;

use super::*;

const NATIVE_ID: &str = "9ab62e3b-f826-4f2f-8e04-b06975506abc";

struct Fixture {
    _root: TempDir,
    _work: TempDir,
    root: PathBuf,
    work: PathBuf,
    scope: OwnerScope,
    locator: String,
    runtime: &'static str,
}

impl Fixture {
    fn new(runtime: &'static str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let work_path = work.path().canonicalize().unwrap();
        let locator = if runtime == "codex" {
            format!("rollout-synthetic-{NATIVE_ID}.jsonl")
        } else {
            format!("synthetic-project/{NATIVE_ID}.jsonl")
        };
        let scope = OwnerScope {
            owner: Hex64::parse("11".repeat(32)).unwrap(),
            relay: Sha256Ref::parse(format!("sha256:{}", "22".repeat(32))).unwrap(),
            app_profile: root_path.clone(),
            resident: Hex64::parse("33".repeat(32)).unwrap(),
            conversation: OpaqueId::parse("synthetic-owner-dashboard-conversation").unwrap(),
            binding: Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap(),
        };
        let fixture = Self {
            _root: root,
            _work: work,
            root: root_path,
            work: work_path,
            scope,
            locator,
            runtime,
        };
        fixture.write_rows(&[]);
        fixture
    }

    fn write_rows(&self, rows: &[serde_json::Value]) {
        let header = if self.runtime == "codex" {
            serde_json::json!({"type":"session_meta","payload":{
                "id":NATIVE_ID,"cwd":self.work,"source":"vscode","originator":"Codex Desktop",
                "base_instructions":{"text":"PRIVATE_HEADER_MUST_NOT_BE_EXPOSED"}
            }})
        } else {
            serde_json::json!({"type":"user","sessionId":NATIVE_ID,"cwd":self.work,
                "permissionMode":"default","message":{"role":"user","content":"Visible native question"}})
        };
        let content = std::iter::once(&header)
            .chain(rows.iter())
            .map(|row| format!("{row}\n"))
            .collect::<String>();
        let path = self.root.join(&self.locator);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn issue(
        &self,
        registry: &mut OwnerLookupRegistry,
        now: Instant,
    ) -> (
        targets::RuntimeTaskTargetSourceV1,
        targets::RuntimeTaskTargetListV1,
    ) {
        let (source, issued_at) = registry
            .source_for(&self.scope, self.runtime, self.root.clone(), now)
            .unwrap();
        let list = targets::list_connected_session_targets(
            &source,
            self.runtime,
            &HashSet::new(),
            MAX_SESSIONS,
        )
        .unwrap();
        assert_eq!(list.candidates.len(), 1);
        registry
            .remember(
                OwnerLookupLease {
                    scope: self.scope.clone(),
                    source: source.clone(),
                    runtime: self.runtime.into(),
                    issued_at,
                    targets: list
                        .candidates
                        .iter()
                        .map(|candidate| {
                            (
                                candidate.session_ref.as_str().to_owned(),
                                candidate.target.clone(),
                            )
                        })
                        .collect(),
                },
                now,
            )
            .unwrap();
        (source, list)
    }
}

#[test]
fn owner_catalogue_is_metadata_only_without_brain_or_a_permission_grant() {
    let fixture = Fixture::new("codex");
    let before = fs::read(fixture.root.join(&fixture.locator)).unwrap();
    let mut registry = OwnerLookupRegistry::default();
    let (source, list) = fixture.issue(&mut registry, Instant::now());
    let candidate = &list.candidates[0];
    let view = session_view(
        candidate,
        selection_key(&fixture.scope, &source, &candidate.target).unwrap(),
        None,
        None,
    );
    let encoded = serde_json::to_string(&view).unwrap();
    assert!(!encoded.contains("PRIVATE_HEADER_MUST_NOT_BE_EXPOSED"));
    assert!(!encoded.contains(NATIVE_ID));
    assert!(!encoded.contains(fixture.root.to_str().unwrap()));
    assert_eq!(view.working_folder, fixture.work.to_str().unwrap());
    assert_eq!(view.live_state, "unknown");
    assert_eq!(view.routing, "codex_app");
    assert!(view.can_send);
    assert!(!view.can_continue);
    assert_eq!(
        fs::read(fixture.root.join(&fixture.locator)).unwrap(),
        before
    );
}

#[test]
fn owner_leases_isolate_owner_relay_app_profile_resident_conversation_binding_and_native_profile() {
    let fixture = Fixture::new("codex");
    let mut registry = OwnerLookupRegistry::default();
    let now = Instant::now();
    let (source, _) = fixture.issue(&mut registry, now);
    let lease = registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now,
        )
        .unwrap();
    for field in 0..6 {
        let mut changed = fixture.scope.clone();
        match field {
            0 => changed.owner = Hex64::parse("55".repeat(32)).unwrap(),
            1 => changed.relay = Sha256Ref::parse(format!("sha256:{}", "55".repeat(32))).unwrap(),
            2 => changed.app_profile = fixture.work.clone(),
            3 => changed.resident = Hex64::parse("55".repeat(32)).unwrap(),
            4 => changed.conversation = OpaqueId::parse("another-conversation").unwrap(),
            _ => changed.binding = Sha256Ref::parse(format!("sha256:{}", "55".repeat(32))).unwrap(),
        }
        assert!(lease
            .require_current(&changed, fixture.runtime, &fixture.root, now)
            .is_err());
    }
    assert!(lease
        .require_current(&fixture.scope, "claude_code", &fixture.root, now)
        .is_err());
    assert!(lease
        .require_current(&fixture.scope, fixture.runtime, &fixture.work, now)
        .is_err());
    assert!(registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.work,
            now
        )
        .is_err());
    // A failed profile switch destroys this lease; switching back cannot revive it.
    assert!(registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now
        )
        .is_err());
}

#[test]
fn owner_handles_expire_at_the_boundary_and_are_not_restored_after_restart() {
    let fixture = Fixture::new("codex");
    let mut registry = OwnerLookupRegistry::default();
    let now = Instant::now();
    let (source, _) = fixture.issue(&mut registry, now);
    assert!(registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now + LOOKUP_TTL - Duration::from_millis(1)
        )
        .is_ok());
    assert!(OwnerLookupRegistry::default()
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now
        )
        .is_err());
    assert!(registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now + LOOKUP_TTL
        )
        .is_err());
    assert!(registry.leases.is_empty());
}

#[test]
fn unlisted_native_ids_identity_keys_and_unknown_sources_are_not_authority() {
    let fixture = Fixture::new("codex");
    let mut registry = OwnerLookupRegistry::default();
    let now = Instant::now();
    let (source, list) = fixture.issue(&mut registry, now);
    let lease = registry
        .get(
            &source.source_id,
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now,
        )
        .unwrap();
    let key = selection_key(&fixture.scope, &source, &list.candidates[0].target).unwrap();
    for value in [NATIVE_ID, key.as_str(), "session-unlisted"] {
        assert!(lease.selected(&OpaqueId::parse(value).unwrap()).is_err());
    }
    assert!(registry
        .get(
            &OpaqueId::parse("owner-harness-source-unknown").unwrap(),
            &fixture.scope,
            fixture.runtime,
            &fixture.root,
            now
        )
        .is_err());
}

#[test]
fn resident_paths_explicitly_reject_owner_dashboard_handles() {
    let fixture = Fixture::new("codex");
    let (source, _) = fixture.issue(&mut OwnerLookupRegistry::default(), Instant::now());
    assert!(is_dashboard_source(&source.source_id));
    assert!(!native_sources::is_native_source(&source.source_id));
    assert_eq!(
        reject_resident_source(source.source_id.as_str()).unwrap_err(),
        OWNER_ONLY
    );
    assert!(reject_resident_source("native-session-source-permissioned").is_ok());
    assert!(reject_resident_source("connected-source-existing-grant").is_ok());
    // The resident list/proposal and connected-source resolver all call the
    // same rejection before a grant lookup, permission card or target read.
    let runtime_source = include_str!("../runtime_tasks.rs");
    assert_eq!(
        runtime_source
            .matches("dashboard::reject_resident_source")
            .count(),
        2
    );
    assert!(include_str!("delegation.rs")
        .contains("dashboard::reject_resident_source(source_id.as_str())?"));
}

#[test]
fn refresh_preserves_active_handles_but_stable_identity_is_not_a_lease() {
    let fixture = Fixture::new("codex");
    let mut registry = OwnerLookupRegistry::default();
    let now = Instant::now();
    let (source, first) = fixture.issue(&mut registry, now);
    let (same_source, second) = fixture.issue(&mut registry, now + Duration::from_secs(1));
    assert_eq!(source.source_id, same_source.source_id);
    assert_eq!(
        first.candidates[0].session_ref,
        second.candidates[0].session_ref
    );
    let first_key = selection_key(&fixture.scope, &source, &first.candidates[0].target).unwrap();
    let (fresh_source, fresh) = fixture.issue(&mut registry, now + LOOKUP_TTL);
    assert_ne!(source.source_id, fresh_source.source_id);
    assert_ne!(
        first.candidates[0].session_ref,
        fresh.candidates[0].session_ref
    );
    assert_eq!(
        first_key,
        selection_key(&fixture.scope, &fresh_source, &fresh.candidates[0].target).unwrap()
    );
    let mut changed = fixture.scope.clone();
    changed.owner = Hex64::parse("55".repeat(32)).unwrap();
    assert_ne!(
        first_key,
        selection_key(&changed, &source, &first.candidates[0].target).unwrap()
    );
    let mut changed_source = source.clone();
    changed_source.canonical_root = fixture.work.clone();
    assert_ne!(
        first_key,
        selection_key(&fixture.scope, &changed_source, &first.candidates[0].target).unwrap()
    );
}

#[test]
fn owner_lease_registry_and_exact_selection_allowlist_are_bounded() {
    let mut fixture = Fixture::new("codex");
    let mut registry = OwnerLookupRegistry::default();
    let now = Instant::now();
    let (oldest, _) = fixture.issue(&mut registry, now);
    for index in 1..=MAX_LOOKUPS {
        fixture.scope.conversation =
            OpaqueId::parse(format!("synthetic-conversation-{index}")).unwrap();
        fixture.issue(&mut registry, now + Duration::from_millis(index as u64));
    }
    assert_eq!(registry.leases.len(), MAX_LOOKUPS);
    assert!(!registry.leases.contains_key(oldest.source_id.as_str()));
    let (_, list) = fixture.issue(&mut registry, now + Duration::from_secs(1));
    let mut lease = registry.leases.values().next().unwrap().clone();
    lease.targets.clear();
    for index in 0..=MAX_SESSIONS {
        let mut target = list.candidates[0].target.clone();
        target.source_id = lease.source.source_id.clone();
        target.session_ref = OpaqueId::parse(format!("session-synthetic-{index}")).unwrap();
        lease
            .targets
            .insert(target.session_ref.as_str().to_owned(), target);
    }
    assert!(registry
        .remember(lease, now + Duration::from_secs(1))
        .is_err());
}

fn user_message(text: &str) -> serde_json::Value {
    serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":text}})
}

#[test]
fn selected_transcript_preserves_roles_and_shared_hidden_record_filters() {
    let fixture = Fixture::new("codex");
    fixture.write_rows(&[
        user_message("Visible question"),
        serde_json::json!({"type":"response_item","payload":{"type":"reasoning","summary":"HIDDEN_REASONING"}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"HIDDEN_DEVELOPER"}]}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"HIDDEN_COMMENTARY"}]}}),
        serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Visible answer"}]}}),
    ]);
    let (source, list) = fixture.issue(&mut OwnerLookupRegistry::default(), Instant::now());
    let (messages, truncated) = bounded_tail(
        list.candidates[0]
            .target
            .visible_messages(&source, &HashSet::new())
            .unwrap(),
    );
    assert!(!truncated);
    assert_eq!(messages.len(), 2);
    assert_eq!(
        (messages[0].role, messages[0].text.as_str()),
        ("user", "Visible question")
    );
    assert_eq!(
        (messages[1].role, messages[1].text.as_str()),
        ("assistant", "Visible answer")
    );
    assert!(!serde_json::to_string(&messages)
        .unwrap()
        .contains("HIDDEN_"));
    assert!(list.candidates[0]
        .target
        .visible_messages(&source, &HashSet::from([NATIVE_ID.into()]))
        .is_err());
}

#[test]
fn selected_transcript_has_byte_message_and_utf8_bounds_with_honest_truncation() {
    let fixture = Fixture::new("codex");
    let mut rows = vec![serde_json::json!({"type":"unused","padding":"x".repeat(300 * 1024)})];
    rows.extend((0..40).map(|_| user_message(&"visible é".repeat(3000))));
    fixture.write_rows(&rows);
    let (source, list) = fixture.issue(&mut OwnerLookupRegistry::default(), Instant::now());
    let (messages, truncated) = bounded_tail(
        list.candidates[0]
            .target
            .visible_messages(&source, &HashSet::new())
            .unwrap(),
    );
    assert!(truncated);
    assert!(messages.len() <= 32);
    assert!(!messages.is_empty());
    assert!(messages
        .iter()
        .all(|message| message.text.len() <= MAX_MESSAGE_BYTES));
    assert!(
        messages
            .iter()
            .map(|message| message.text.len())
            .sum::<usize>()
            <= MAX_TRANSCRIPT_BYTES
    );
    assert!(messages
        .iter()
        .all(|message| !message.text.contains("PRIVATE_HEADER")));
}

#[test]
fn claude_live_state_requires_the_exact_verified_controller_and_known_policy() {
    let fixture = Fixture::new("claude_code");
    let (source, list) = fixture.issue(&mut OwnerLookupRegistry::default(), Instant::now());
    let candidate = &list.candidates[0];
    let key = selection_key(&fixture.scope, &source, &candidate.target).unwrap();
    let unknown = session_view(candidate, key.clone(), None, None);
    assert_eq!(unknown.live_state, "unknown");
    assert!(!unknown.can_send);
    let saved = session_view(candidate, key.clone(), None, Some("[]"));
    assert_eq!(saved.live_state, "saved");
    assert!(saved.can_continue);
    let live = serde_json::json!([{"kind":"interactive","sessionId":NATIVE_ID,"pid":1234,
        "name":"synthetic receiver","status":"idle","cwd":fixture.work}])
    .to_string();
    let view = session_view(candidate, key.clone(), None, Some(&live));
    assert_eq!(view.live_state, "live");
    assert_eq!(view.routing, "claude_live");
    assert!(view.can_send);
    assert!(!view.can_continue);
    let ambiguous = format!(
        "[{},{}]",
        &live[1..live.len() - 1],
        &live[1..live.len() - 1]
    );
    assert_eq!(
        session_view(candidate, key, None, Some(&ambiguous)).live_state,
        "unknown"
    );
}

fn task(scope: &OwnerScope, native_id: &str, id: &str, started: &str) -> RuntimeTaskProjectionV1 {
    serde_json::from_value(serde_json::json!({
        "taskId":id,"ownerPubkey":scope.owner,"originRelayRef":scope.relay,
        "conversationId":scope.conversation,"residentPubkey":scope.resident,
        "runtimeFamily":"codex","summary":"Synthetic task","workingFolder":"synthetic",
        "permissionMode":"normal","state":"awaiting_native","providerSessionId":native_id,
        "completedSteps":0,"startedAt":started,"updatedAt":started,
    }))
    .unwrap()
}

#[test]
fn receipt_links_require_exact_native_identity_owner_and_origin_not_title_or_folder() {
    let fixture = Fixture::new("codex");
    let (_, list) = fixture.issue(&mut OwnerLookupRegistry::default(), Instant::now());
    let target = &list.candidates[0].target;
    let first = task(
        &fixture.scope,
        NATIVE_ID,
        "synthetic-first-task",
        "2026-11-01T00:00:00Z",
    );
    let latest = task(
        &fixture.scope,
        NATIVE_ID,
        "synthetic-latest-task",
        "2026-11-02T00:00:00Z",
    );
    let mut wrong_owner = latest.clone();
    wrong_owner.owner_pubkey = "55".repeat(32);
    wrong_owner.started_at = "2026-11-03T00:00:00Z".into();
    let mut wrong_origin = wrong_owner.clone();
    wrong_origin.owner_pubkey = fixture.scope.owner.as_str().to_owned();
    wrong_origin.origin_relay_ref =
        Some(Sha256Ref::parse(format!("sha256:{}", "55".repeat(32))).unwrap());
    let wrong_native = task(
        &fixture.scope,
        "8ed9b580-60ea-40d7-b1f0-67c2730bdff3",
        "synthetic-other-task",
        "2026-11-04T00:00:00Z",
    );
    let tasks = [first, latest, wrong_owner, wrong_origin, wrong_native];
    assert_eq!(
        latest_task_id(&fixture.scope, target, tasks.iter()).as_deref(),
        Some("synthetic-latest-task")
    );
}

#[test]
fn transcript_contract_reports_unknown_usage_instead_of_estimated_tokens_or_billing() {
    let detail = HarnessSessionDetailV1 {
        session_id: "session-synthetic".into(),
        title: "Synthetic".into(),
        messages: Vec::new(),
        truncated: false,
        usage: None,
    };
    let value = serde_json::to_value(detail).unwrap();
    assert!(value["usage"].is_null());
    assert!(value.get("billing").is_none());
    assert!(
        serde_json::from_value::<GetHarnessSessionInputV1>(serde_json::json!({
            "runtimeFamily":"codex","sourceId":"source-synthetic","sessionId":"session-synthetic",
            "conversationId":"synthetic","residentPubkey":"11".repeat(32),"path":"arbitrary"
        }))
        .is_err()
    );
}

//! Only disposable sentinels, an isolated generated owner, and the real consent
//! controller. These tests do not inspect a native profile or invoke a runtime.
use super::super::selected_files::{
    tests::{id, now, number, Fixture},
    SamplingOutcomeV1,
};
use super::*;
use luca_protocol::AwarenessSourceStateV1;
use crate::luca::companion_awareness::AwarenessWithdrawalV1;
use std::fs;

const FIRST_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_ID: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PRIVATE_ID: &str = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

fn codex_locator(native_id: &str) -> String {
    format!("2026/10/08/rollout-2026-10-08T10-00-00-{native_id}.jsonl")
}
fn claude_locator(native_id: &str) -> String {
    format!("-Users-synthetic-work/{native_id}.jsonl")
}
fn selection(
    fixture: &Fixture,
    kind: NativeProfileKindV1,
    class: NativeProfileObservationClassV1,
    observe: bool,
) -> NativeProfileSelectionV1 {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let device = fixture.runtime.device(live.owner()).unwrap();
    let source = NativeProfileSelectionV1::source_id_for_selection(
        live.owner(),
        &fixture.resident,
        &device,
        &fixture.root,
        kind,
        class,
    )
    .unwrap();
    NativeProfileSelectionV1::new(
        fixture.grant(source, observe),
        fixture.root.clone(),
        kind,
        class,
    )
    .unwrap()
}
fn purpose(adapter: &NativeProfileAdapter) -> NativeProfilePurposeFactsV1 {
    NativeProfilePurposeFactsV1::new(adapter.selection(), now(), HashSet::new()).unwrap()
}
fn write_codex(fixture: &Fixture, native_id: &str, source: serde_json::Value, originator: &str) {
    let path = fixture.root.join(codex_locator(native_id));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut rows = vec![serde_json::json!({
        "type":"session_meta", "payload":{
            "id":native_id, "cwd":"/synthetic/work", "source":source, "originator":originator
        }
    })
    .to_string()];
    rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"OLD_HISTORIC_SENTINEL"}}).to_string());
    for index in 0..12 {
        rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":format!("VISIBLE_CHILD_{native_id}_{index}")}}).to_string());
    }
    rows.push(serde_json::json!({"type":"response_item","payload":{"type":"function_call","name":"private_tool","arguments":"HIDDEN_TOOL_SENTINEL"}}).to_string());
    rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"password=NOT_A_REAL_CREDENTIAL_SENTINEL"}}).to_string());
    fs::write(path, rows.join("\n")).unwrap();
}
fn sampled_reference(
    outcome: NativeProfileSamplingOutcomeV1,
) -> luca_protocol::AwarenessObservationRefV1 {
    match outcome {
        NativeProfileSamplingOutcomeV1::Sampled {
            outcome: SamplingOutcomeV1::Admitted(reference),
            ..
        } => reference,
        other => panic!("expected synthetic profile admission, got {other:?}"),
    }
}

#[test]
fn one_profile_metadata_grant_follows_two_changed_children_with_one_durable_sequence() {
    let fixture = Fixture::new();
    let selection = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::Metadata,
        true,
    );
    let key = selection.grant_key().clone();
    let mut adapter = NativeProfileAdapter::new(selection);
    // No fixture transcript exists yet: default-off sampling is not collection.
    assert_eq!(
        adapter
            .sample_one(&fixture.state, &fixture.runtime, &now(), None, None)
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Disabled
    );
    adapter.set_enabled(true);
    assert_eq!(
        adapter
            .sample_one(&fixture.state, &fixture.runtime, &now(), None, None)
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Quiet
    );
    write_codex(&fixture, FIRST_ID, serde_json::json!("cli"), "codex_cli_rs");
    write_codex(
        &fixture,
        SECOND_ID,
        serde_json::json!("vscode"),
        "Codex Desktop",
    );
    for _ in 0..4 {
        adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    }
    adapter.mark_changed(&codex_locator(SECOND_ID)).unwrap();
    let purpose = purpose(&adapter);
    let first = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None,
            )
            .unwrap(),
    );
    let second = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None,
            )
            .unwrap(),
    );
    assert_eq!(first.grant_id, second.grant_id);
    assert_eq!(first.sequence, number(1));
    assert_eq!(second.sequence, number(2));
    assert_eq!(first.grant_revision, second.grant_revision);
    assert_ne!(first.evidence_ref, second.evidence_ref);
    for reference in [&first, &second] {
        let payload = fixture.payload(reference);
        assert_eq!(payload["work_status"], "unknown");
        assert_eq!(payload["excerpts"], serde_json::json!([]));
        assert_eq!(payload["observation_class"], "metadata");
        let encoded = payload.to_string();
        assert!(!encoded.contains("VISIBLE_CHILD"));
        assert!(!encoded.contains(FIRST_ID));
        assert!(!encoded.contains(SECOND_ID));
        assert!(!encoded.contains(fixture.root.to_str().unwrap()));
    }
    assert_eq!(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None
            )
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Quiet
    );
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert!(matches!(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None
            )
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Sampled {
            outcome: SamplingOutcomeV1::Unchanged,
            ..
        }
    ));
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    assert_eq!(
        fixture.runtime.next_sequence(&live, &key).unwrap(),
        number(3)
    );
    assert_eq!(
        fixture
            .runtime
            .snapshot(live.owner(), &key)
            .unwrap()
            .source
            .state,
        AwarenessSourceStateV1::Current
    );
    assert!(!format!("{adapter:?}").contains(FIRST_ID));
    assert!(!format!("{adapter:?}").contains(fixture.root.to_str().unwrap()));
}

#[test]
fn profile_identity_class_and_native_layout_cannot_be_widened_by_an_event() {
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::Metadata,
        true,
    );
    let key = selected.grant_key().clone();
    assert!(NativeProfileSelectionV1::new(
        key.clone(),
        fixture.root.join("another-profile"),
        selected.kind,
        selected.class
    )
    .is_err());
    assert!(NativeProfileSelectionV1::new(
        key.clone(),
        fixture.root.clone(),
        selected.kind,
        NativeProfileObservationClassV1::VisibleExcerpts
    )
    .is_err());
    let mut wrong_resident = key.clone();
    wrong_resident.resident_pubkey = Hex64::parse("cc".repeat(32)).unwrap();
    assert!(NativeProfileSelectionV1::new(
        wrong_resident,
        fixture.root.clone(),
        selected.kind,
        selected.class
    )
    .is_err());
    let mut wrong_device = key;
    wrong_device.source.device_id = id("another-device");
    assert!(NativeProfileSelectionV1::new(
        wrong_device,
        fixture.root.clone(),
        selected.kind,
        selected.class
    )
    .is_err());
    let exact_source = super::super::native_work::NativeWorkHandleV1::source_id_for_selection(
        &fixture.root,
        &codex_locator(FIRST_ID),
        ConnectedBrainSourceKindV1::CodexHistory,
        super::super::native_work::NativeObservationClassV1::Metadata,
    )
    .unwrap();
    assert!(NativeProfileSelectionV1::new(
        fixture.grant(exact_source, true),
        fixture.root.clone(),
        selected.kind,
        selected.class
    )
    .is_err());
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    for locator in [
        format!("/another-profile/{}", codex_locator(FIRST_ID)),
        format!("../another-profile/{}", codex_locator(FIRST_ID)),
        format!("subagents/{FIRST_ID}.jsonl"),
        format!("auth-{FIRST_ID}.jsonl"),
        format!("2026/10/08/credentials-{FIRST_ID}.jsonl"),
        format!("2026/10/07/rollout-2026-10-08T10-00-00-{FIRST_ID}.jsonl"),
        ".env".into(),
    ] {
        assert_eq!(
            adapter.mark_changed(&locator),
            Err(AwarenessStoreError::Invalid)
        );
    }
    assert_eq!(
        adapter
            .sample_one(&fixture.state, &fixture.runtime, &now(), None, None)
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Quiet
    );
}

#[test]
fn visible_tail_exclusions_and_revoke_gate_each_child_not_just_initial_profile_setup() {
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::VisibleExcerpts,
        true,
    );
    let key = selected.grant_key().clone();
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    write_codex(&fixture, FIRST_ID, serde_json::json!("cli"), "codex_cli_rs");
    let purpose = purpose(&adapter);
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    let first = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None,
            )
            .unwrap(),
    );
    let payload = fixture.payload(&first).to_string();
    assert!(payload.contains(&format!("VISIBLE_CHILD_{FIRST_ID}_11")));
    assert!(!payload.contains("OLD_HISTORIC_SENTINEL"));
    assert!(!payload.contains("HIDDEN_TOOL_SENTINEL"));
    assert!(!payload.contains("NOT_A_REAL_CREDENTIAL_SENTINEL"));
    assert!(payload.contains("Untrusted source evidence"));
    // This excluded child does not exist: exclusion must happen before a read.
    let excluded = NativeProfilePurposeFactsV1::new(
        adapter.selection(),
        now(),
        HashSet::from([PRIVATE_ID.into()]),
    )
    .unwrap();
    adapter.mark_changed(&codex_locator(PRIVATE_ID)).unwrap();
    assert!(matches!(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&excluded),
                None
            )
            .unwrap(),
        NativeProfileSamplingOutcomeV1::Excluded { .. }
    ));
    write_codex(
        &fixture,
        PRIVATE_ID,
        serde_json::json!({"subagent":{"parent_thread_id":FIRST_ID}}),
        "codex_cli_rs",
    );
    adapter.mark_changed(&codex_locator(PRIVATE_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(
            &fixture.state,
            &fixture.runtime,
            &now(),
            Some(&purpose),
            None
        ),
        Err(AwarenessStoreError::Invalid)
    );
    write_codex(
        &fixture,
        PRIVATE_ID,
        serde_json::json!("cli"),
        "codex_cli_rs",
    );
    let path = fixture.root.join(codex_locator(PRIVATE_ID));
    let mut content = fs::read_to_string(&path).unwrap();
    content.push_str("\n# Luca managed resident\nMANAGED_PRIVATE_SENTINEL");
    fs::write(&path, content).unwrap();
    adapter.mark_changed(&codex_locator(PRIVATE_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(
            &fixture.state,
            &fixture.runtime,
            &now(),
            Some(&purpose),
            None
        ),
        Err(AwarenessStoreError::Invalid)
    );
    adapter.mark_changed(&codex_locator(SECOND_ID)).unwrap();
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    fixture
        .runtime
        .withdraw_grant(
            live.owner(),
            &key,
            number(1),
            AwarenessWithdrawalV1::Withdraw,
            &id("revoke-profile-following"),
        )
        .unwrap();
    // The next queued child does not exist; current consent denies before IO.
    assert_eq!(
        adapter.sample_one(
            &fixture.state,
            &fixture.runtime,
            &now(),
            Some(&purpose),
            None
        ),
        Err(AwarenessStoreError::Invalid)
    );
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert!(adapter
        .sample_one(
            &fixture.state,
            &fixture.runtime,
            &now(),
            Some(&purpose),
            None
        )
        .is_err());
}

#[test]
fn unknown_stale_or_wrong_profile_purpose_and_missing_observe_consent_fail_closed() {
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::Metadata,
        true,
    );
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(&fixture.state, &fixture.runtime, &now(), None, None),
        Err(AwarenessStoreError::Unavailable)
    );
    let stale = NativeProfilePurposeFactsV1::new(
        adapter.selection(),
        CanonicalTimestamp::parse("2026-10-08T09:59:00Z").unwrap(),
        HashSet::new(),
    )
    .unwrap();
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(&fixture.state, &fixture.runtime, &now(), Some(&stale), None),
        Err(AwarenessStoreError::Unavailable)
    );
    let another = selection(
        &fixture,
        NativeProfileKindV1::ClaudeProjects,
        NativeProfileObservationClassV1::Metadata,
        true,
    );
    let wrong = NativeProfilePurposeFactsV1::new(&another, now(), HashSet::new()).unwrap();
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(&fixture.state, &fixture.runtime, &now(), Some(&wrong), None),
        Err(AwarenessStoreError::Invalid)
    );
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::Metadata,
        false,
    );
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    let purpose = purpose(&adapter);
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    assert_eq!(
        adapter.sample_one(
            &fixture.state,
            &fixture.runtime,
            &now(),
            Some(&purpose),
            None
        ),
        Err(AwarenessStoreError::Invalid)
    );
}

#[test]
fn claude_root_sessions_work_but_sidechain_sdk_and_unsupported_children_do_not() {
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::ClaudeProjects,
        NativeProfileObservationClassV1::VisibleExcerpts,
        true,
    );
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    let purpose = purpose(&adapter);
    let path = fixture.root.join(claude_locator(FIRST_ID));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let visible = serde_json::json!({"type":"user","sessionId":FIRST_ID,"cwd":"/synthetic/work","message":{"role":"user","content":"CLAUDE_ROOT_VISIBLE_SENTINEL"}});
    fs::write(&path, visible.to_string()).unwrap();
    adapter.mark_changed(&claude_locator(FIRST_ID)).unwrap();
    let first = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None,
            )
            .unwrap(),
    );
    assert!(fixture
        .payload(&first)
        .to_string()
        .contains("CLAUDE_ROOT_VISIBLE_SENTINEL"));
    for flag in [
        serde_json::json!({"isSidechain":true}),
        serde_json::json!({"promptSource":"sdk"}),
    ] {
        let mut private = visible.clone();
        private
            .as_object_mut()
            .unwrap()
            .extend(flag.as_object().unwrap().clone());
        fs::write(&path, private.to_string()).unwrap();
        adapter.mark_changed(&claude_locator(FIRST_ID)).unwrap();
        assert_eq!(
            adapter.sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                None
            ),
            Err(AwarenessStoreError::Invalid)
        );
    }
    assert_eq!(
        adapter.mark_changed(&format!(
            "-Users-synthetic-work/subagents/{SECOND_ID}.jsonl"
        )),
        Err(AwarenessStoreError::Invalid)
    );
}

#[test]
fn profile_event_queue_is_bounded_and_only_exact_fresh_host_activity_can_claim_active() {
    let fixture = Fixture::new();
    let selected = selection(
        &fixture,
        NativeProfileKindV1::CodexSessions,
        NativeProfileObservationClassV1::Metadata,
        true,
    );
    let mut adapter = NativeProfileAdapter::new(selected);
    adapter.set_enabled(true);
    for index in 1..=MAX_TRACKED_CHILDREN {
        let native_id = format!("00000000-0000-4000-8000-{index:012}");
        adapter.mark_changed(&codex_locator(&native_id)).unwrap();
    }
    // Repeated events do not consume new slots. A genuinely new child cannot
    // force an unbounded queue or silently evict another pending change.
    adapter
        .mark_changed(&codex_locator("00000000-0000-4000-8000-000000000001"))
        .unwrap();
    assert_eq!(
        adapter.mark_changed(&codex_locator(FIRST_ID)),
        Err(AwarenessStoreError::Capacity)
    );
    adapter.set_enabled(false);
    assert!(adapter.children.is_empty());
    adapter.set_enabled(true);
    write_codex(&fixture, FIRST_ID, serde_json::json!("cli"), "codex_cli_rs");
    let purpose = purpose(&adapter);
    let expected = adapter
        .selection()
        .session_ref(&codex_locator(FIRST_ID))
        .unwrap();
    let activity = NativeWorkActivityFactV1 {
        session_ref: expected,
        status: NativeWorkStatusV1::Active,
        observed_at: now(),
    };
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    let active = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                Some(&activity),
            )
            .unwrap(),
    );
    assert_eq!(fixture.payload(&active)["work_status"], "active");
    let wrong = NativeWorkActivityFactV1 {
        session_ref: id("wrong-child"),
        status: NativeWorkStatusV1::Active,
        observed_at: now(),
    };
    adapter.mark_changed(&codex_locator(FIRST_ID)).unwrap();
    let unknown = sampled_reference(
        adapter
            .sample_one(
                &fixture.state,
                &fixture.runtime,
                &now(),
                Some(&purpose),
                Some(&wrong),
            )
            .unwrap(),
    );
    assert_eq!(fixture.payload(&unknown)["work_status"], "unknown");
}

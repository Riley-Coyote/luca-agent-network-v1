use super::super::selected_files::{
    tests::{admitted, now, number, Fixture},
    SamplingOutcomeV1,
};
use super::*;
use std::fs;

const UUID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
fn locator() -> String {
    format!("{UUID}.jsonl")
}
fn write_session(fixture: &Fixture) {
    let mut rows = Vec::new();
    rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"OLD_EARLY_SENTINEL"}}).to_string());
    for index in 0..12 {
        rows.push(serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":format!("RECENT_VISIBLE_SENTINEL_{index}")}}).to_string());
    }
    rows.push(serde_json::json!({"type":"response_item","payload":{"type":"function_call","name":"private_tool","arguments":"HIDDEN_TOOL_SENTINEL"}}).to_string());
    rows.push(serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"FINAL_VISIBLE_SENTINEL"}]}}).to_string());
    fs::write(fixture.root.join(locator()), rows.join("\n")).unwrap();
    fs::write(
        fixture.root.join("unselected-neighbor.jsonl"),
        "NEIGHBOR_PRIVATE_SENTINEL",
    )
    .unwrap();
}
fn handle(fixture: &Fixture, class: NativeObservationClassV1) -> NativeWorkHandleV1 {
    let source = NativeWorkHandleV1::source_id_for_selection(
        &fixture.root,
        &locator(),
        ConnectedBrainSourceKindV1::CodexHistory,
        class,
    )
    .unwrap();
    NativeWorkHandleV1::new(
        fixture.grant(source, true),
        fixture.root.clone(),
        locator(),
        ConnectedBrainSourceKindV1::CodexHistory,
        class,
        HashSet::new(),
    )
    .unwrap()
}

#[test]
fn metadata_does_not_claim_activity_or_silently_widen_to_visible_content() {
    let fixture = Fixture::new();
    write_session(&fixture);
    let handle = handle(&fixture, NativeObservationClassV1::Metadata);
    let key = handle.key.clone();
    assert!(!format!("{handle:?}").contains(UUID));
    assert!(NativeWorkHandleV1::new(
        key,
        fixture.root.clone(),
        locator(),
        ConnectedBrainSourceKindV1::CodexHistory,
        NativeObservationClassV1::VisibleExcerpts,
        HashSet::new()
    )
    .is_err());
    let mut adapter = NativeWorkAdapter::new(handle);
    assert_eq!(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1), None)
            .unwrap(),
        SamplingOutcomeV1::Disabled
    );
    adapter.set_enabled(true);
    let reference = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1), None)
            .unwrap(),
    );
    let payload = fixture.payload(&reference);
    assert_eq!(payload["work_status"], "unknown");
    assert_eq!(payload["excerpts"], serde_json::json!([]));
    assert!(!payload.to_string().contains(UUID));
    assert!(!payload.to_string().contains("VISIBLE_SENTINEL"));
    assert!(!payload.to_string().contains(fixture.root.to_str().unwrap()));
}

#[test]
fn exact_recent_visible_tail_is_untrusted_and_status_needs_an_exact_fresh_host_fact() {
    let fixture = Fixture::new();
    write_session(&fixture);
    let handle = handle(&fixture, NativeObservationClassV1::VisibleExcerpts);
    let session_ref = handle.session_ref().clone();
    let mut adapter = NativeWorkAdapter::new(handle);
    adapter.set_enabled(true);
    let reference = admitted(
        adapter
            .sample(&fixture.state, &fixture.runtime, &now(), number(1), None)
            .unwrap(),
    );
    let payload = fixture.payload(&reference);
    let text = payload.to_string();
    assert!(text.contains("RECENT_VISIBLE_SENTINEL_11"));
    assert!(text.contains("FINAL_VISIBLE_SENTINEL"));
    assert!(!text.contains("OLD_EARLY_SENTINEL"));
    assert!(!text.contains("HIDDEN_TOOL_SENTINEL"));
    assert!(!text.contains("NEIGHBOR_PRIVATE_SENTINEL"));
    assert!(text.contains("Untrusted source evidence"));
    let fact = NativeWorkActivityFactV1 {
        session_ref: session_ref.clone(),
        status: NativeWorkStatusV1::Active,
        observed_at: now(),
    };
    adapter.mark_changed();
    let active = admitted(
        adapter
            .sample(
                &fixture.state,
                &fixture.runtime,
                &now(),
                number(2),
                Some(&fact),
            )
            .unwrap(),
    );
    assert_eq!(fixture.payload(&active)["work_status"], "active");
    let wrong = NativeWorkActivityFactV1 {
        session_ref: OpaqueId::parse("different-selected-session").unwrap(),
        ..fact
    };
    adapter.mark_changed();
    let unknown = admitted(
        adapter
            .sample(
                &fixture.state,
                &fixture.runtime,
                &now(),
                number(3),
                Some(&wrong),
            )
            .unwrap(),
    );
    assert_eq!(fixture.payload(&unknown)["work_status"], "unknown");
    let stale = NativeWorkActivityFactV1 {
        session_ref,
        status: NativeWorkStatusV1::Idle,
        observed_at: CanonicalTimestamp::parse("2026-10-08T09:59:00Z").unwrap(),
    };
    adapter.mark_changed();
    assert_eq!(
        adapter
            .sample(
                &fixture.state,
                &fixture.runtime,
                &now(),
                number(4),
                Some(&stale)
            )
            .unwrap(),
        SamplingOutcomeV1::Unchanged
    );
}

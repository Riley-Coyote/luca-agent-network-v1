//! Fake helper JSON only: these tests never run the Swift helper or observe apps.
use super::super::selected_files::tests::{admitted, now, number, Fixture};
use super::super::selected_files::SamplingOutcomeV1;
use super::*;
use serde_json::json;

fn request(class: MachineObservationClassV1) -> MachineCaptureRequestV1 {
    MachineCaptureRequestV1::new(
        class,
        vec!["com.apple.TextEdit".into()],
        vec![],
        vec!["private project".into()],
        4096,
    )
    .unwrap()
}
fn metadata() -> serde_json::Value {
    json!({"protocol":MACHINE_REPLY_PROTOCOL,"observation_class":"app_metadata","status":"available","reason":"window_scope_unavailable","bundle_id":"com.apple.TextEdit","display_name":"TextEdit","window_scope":"unavailable","truncated":false})
}
fn text() -> serde_json::Value {
    json!({"protocol":MACHINE_REPLY_PROTOCOL,"observation_class":"screen_text","status":"available","bundle_id":"com.apple.TextEdit","display_name":"TextEdit","window_ref":format!("sha256:{}","11".repeat(32)),"window_scope":"verified_document_window","text":"SYNTHETIC_VISIBLE_DOCUMENT","truncated":false})
}

#[test]
fn source_classes_bind_policy_and_metadata_never_implies_window_or_page_scope() {
    let metadata_request = request(MachineObservationClassV1::AppMetadata);
    let text_request = request(MachineObservationClassV1::ScreenText);
    assert_ne!(
        metadata_request.source_id().unwrap(),
        text_request.source_id().unwrap()
    );
    assert!(matches!(
        validate_reply(&metadata_request, &serde_json::to_vec(&metadata()).unwrap()).unwrap(),
        VerifiedReply::Available(_)
    ));
    let mut injected = metadata();
    injected["text"] = json!("PRIVATE_PAGE_CONTENT");
    assert!(validate_reply(&metadata_request, &serde_json::to_vec(&injected).unwrap()).is_err());
    let mut unknown = metadata();
    unknown["all_apps"] = json!(true);
    assert!(validate_reply(&metadata_request, &serde_json::to_vec(&unknown).unwrap()).is_err());
    assert!(MachineCaptureRequestV1::new(
        MachineObservationClassV1::ScreenText,
        vec!["com.apple.Safari".into()],
        vec![],
        vec![],
        1024
    )
    .is_err());
    assert!(MachineCaptureRequestV1::new(
        MachineObservationClassV1::AccessibilityText,
        vec!["unverified.desktop.app".into()],
        vec![],
        vec![],
        1024
    )
    .is_err());
}

#[test]
fn bounded_screen_text_requires_exact_allowed_nonbrowser_window_without_credentials() {
    let policy = request(MachineObservationClassV1::ScreenText);
    assert!(matches!(
        validate_reply(&policy, &serde_json::to_vec(&text()).unwrap()).unwrap(),
        VerifiedReply::Available(_)
    ));
    for (field, value) in [
        ("bundle_id", json!("com.apple.Safari")),
        ("window_scope", json!("unavailable")),
        ("text", json!("OPENAI_API_KEY=synthetic-secret")),
        ("text", json!("x".repeat(4097))),
    ] {
        let mut reply = text();
        reply[field] = value;
        assert!(validate_reply(&policy, &serde_json::to_vec(&reply).unwrap()).is_err());
    }
    assert!(validate_reply(&policy, &vec![b'x'; MAX_MACHINE_REPLY_BYTES + 1]).is_err());
    let mut unavailable = text();
    unavailable["status"] = json!("unavailable");
    assert!(validate_reply(&policy, &serde_json::to_vec(&unavailable).unwrap()).is_err());
}

#[test]
fn fake_runner_is_default_off_grant_fenced_and_admits_only_verified_schema() {
    let fixture = Fixture::new();
    let policy = request(MachineObservationClassV1::AppMetadata);
    let key = fixture.grant(policy.source_id().unwrap(), true);
    let handle = MachineActivityHandleV1::new(key, policy).unwrap();
    let mut adapter = MachineActivityAdapter::new(handle);
    assert_eq!(
        adapter
            .sample(
                &fixture.state,
                &fixture.runtime,
                &now(),
                number(1),
                |_| panic!("disabled helper must not run")
            )
            .unwrap(),
        SamplingOutcomeV1::Disabled
    );
    adapter.set_enabled(true);
    let reference = admitted(
        adapter
            .sample(
                &fixture.state,
                &fixture.runtime,
                &now(),
                number(1),
                |request| {
                    assert!(request.encode().unwrap().len() <= MAX_MACHINE_REQUEST_BYTES);
                    Ok(serde_json::to_vec(&metadata()).unwrap())
                },
            )
            .unwrap(),
    );
    assert_eq!(
        fixture.payload(&reference)["bundle_id"],
        "com.apple.TextEdit"
    );
    assert!(fixture.payload(&reference)["text"].is_null());
    let denied = Fixture::new();
    let policy = request(MachineObservationClassV1::AppMetadata);
    let key = denied.grant(policy.source_id().unwrap(), false);
    let mut adapter =
        MachineActivityAdapter::new(MachineActivityHandleV1::new(key, policy).unwrap());
    adapter.set_enabled(true);
    assert!(adapter
        .sample(
            &denied.state,
            &denied.runtime,
            &now(),
            number(1),
            |_| panic!("ungranted helper must not run")
        )
        .is_err());
}

#[test]
fn activation_stream_cannot_start_from_default_off_or_upgrade_text_capture() {
    let fixture=Fixture::new();let policy=request(MachineObservationClassV1::AppMetadata);
    let key=fixture.grant(policy.source_id().unwrap(),true);
    let adapter=MachineActivityAdapter::new(MachineActivityHandleV1::new(key,policy).unwrap());
    let (wake,_)=std::sync::mpsc::sync_channel(1);
    assert!(matches!(adapter.start_activation_watcher(&fixture.state,&fixture.runtime,wake.clone()),Err(AwarenessStoreError::Invalid)));
    for class in [MachineObservationClassV1::AccessibilityText,MachineObservationClassV1::ScreenText] {
        let policy=request(class);let key=fixture.grant(policy.source_id().unwrap(),true);
        let mut adapter=MachineActivityAdapter::new(MachineActivityHandleV1::new(key,policy).unwrap());adapter.set_enabled(true);
        assert!(matches!(adapter.start_activation_watcher(&fixture.state,&fixture.runtime,wake.clone()),Err(AwarenessStoreError::Invalid)));
    }
}

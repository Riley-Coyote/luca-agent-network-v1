use super::*;
use luca_protocol::{
    Hex64, ManagedPresentationActivityV1, ManagedPresentationPhaseV1, OpaqueId, SafeU53,
    MANAGED_PRESENTATION_PROTOCOL,
};

fn scope() -> Scope {
    Scope {
        owner: "11".repeat(32),
        relay: "sha256:community-a".into(),
    }
}
fn frame(sequence: u64, kind: ManagedPresentationKindV1) -> ManagedPresentationFrameV1 {
    ManagedPresentationFrameV1 {
        protocol: MANAGED_PRESENTATION_PROTOCOL.into(),
        kind,
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        conversation_id: OpaqueId::parse("conversation-a").unwrap(),
        turn_id: OpaqueId::parse("turn-a").unwrap(),
        dispatch_receipt_id: OpaqueId::parse("dispatch-a").unwrap(),
        session_epoch: SafeU53::new(4).unwrap(),
        sequence: SafeU53::new(sequence).unwrap(),
        phase: None,
        public_chunk: None,
        failure: None,
        activity: None,
    }
}
fn step(sequence: u64, ordinal: u64, status: StepStatus) -> ManagedPresentationFrameV1 {
    let mut frame = frame(sequence, ManagedPresentationKindV1::Phase);
    frame.phase = Some(ManagedPresentationPhaseV1::Working);
    frame.activity = Some(ManagedPresentationActivityV1 {
        label: "Reading private/file.rs".into(),
        detail: Some("private/file.rs".into()),
        kind: Kind::File,
        status: Some(status),
        count: None,
        step: Some(SafeU53::new(ordinal).unwrap()),
    });
    frame
}
fn chunk(sequence: u64, text: &str) -> ManagedPresentationFrameV1 {
    let mut frame = frame(sequence, ManagedPresentationKindV1::PublicChunk);
    frame.public_chunk = Some(text.into());
    frame
}
fn fixture() -> (tempfile::TempDir, TraceStore) {
    let directory = tempfile::tempdir().unwrap();
    let store = TraceStore::load(directory.path().join("traces.json"), 100).unwrap();
    (directory, store)
}
fn begin(store: &mut TraceStore) {
    assert!(store.observe(
        &scope(),
        &frame(1, ManagedPresentationKindV1::TurnStarted),
        100
    ));
}

#[test]
fn tool_updates_keep_order_and_promote_only_interim_public_text() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    assert!(!store.observe(&scope(), &chunk(2, "I will inspect "), 101));
    assert!(!store.observe(&scope(), &chunk(3, "the source."), 102));
    store.observe(&scope(), &step(4, 1, StepStatus::Active), 103);
    store.observe(&scope(), &step(5, 1, StepStatus::Done), 104);
    store.observe(&scope(), &chunk(6, "FINAL ANSWER ONLY"), 105);
    store.observe(
        &scope(),
        &frame(7, ManagedPresentationKindV1::Completed),
        106,
    );
    let trace = &store.list(&scope())[0];
    assert_eq!(trace.entries.len(), 2);
    assert_eq!(trace.entries[0].text, "I will inspect the source.");
    assert_eq!(trace.entries[1].status, "done");
    assert!(!serde_json::to_string(trace)
        .unwrap()
        .contains("FINAL ANSWER ONLY"));
    assert_eq!(trace.entries[1].room_text, "Reading files");
    assert!(!trace.entries[1].room_text.contains("private"));
}

#[test]
fn public_final_without_tools_is_never_narration() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    store.observe(&scope(), &chunk(2, "This is the whole reply."), 101);
    store.observe(
        &scope(),
        &frame(3, ManagedPresentationKindV1::Completed),
        102,
    );
    assert!(store.list(&scope())[0].entries.is_empty());
}

#[test]
fn replay_wrong_epoch_wrong_turn_and_other_scopes_do_not_merge() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    let update = step(2, 1, StepStatus::Active);
    store.observe(&scope(), &update, 101);
    assert!(!store.observe(&scope(), &update, 102));
    let mut wrong = step(3, 2, StepStatus::Active);
    wrong.session_epoch = SafeU53::new(5).unwrap();
    assert!(!store.observe(&scope(), &wrong, 103));
    wrong.session_epoch = SafeU53::new(4).unwrap();
    wrong.turn_id = OpaqueId::parse("another-turn").unwrap();
    assert!(!store.observe(&scope(), &wrong, 103));
    let mut other = scope();
    other.owner = "33".repeat(32);
    assert!(store.list(&other).is_empty());
    other = scope();
    other.relay = "sha256:other-community".into();
    assert!(store.list(&other).is_empty());
    let mut resident = frame(1, ManagedPresentationKindV1::TurnStarted);
    resident.resident_pubkey = Hex64::parse("44".repeat(32)).unwrap();
    store.observe(&scope(), &resident, 104);
    assert_eq!(store.list(&scope()).len(), 2);
}

#[test]
fn restart_interrupts_once_and_exact_signed_publication_overrides() {
    let (dir, mut store) = fixture();
    begin(&mut store);
    store.observe(&scope(), &step(2, 1, StepStatus::Active), 101);
    store.save().unwrap();
    let mut restored = TraceStore::load(dir.path().join("traces.json"), 200).unwrap();
    assert_eq!(restored.list(&scope())[0].status, TraceStatus::Interrupted);
    let unchanged = restored.list(&scope());
    assert_eq!(
        restored.list(&scope()),
        unchanged,
        "ordinary hydration does not mutate live state"
    );
    let final_id = "aa".repeat(32);
    let outcomes = HashMap::from([(
        (
            "22".repeat(32),
            "conversation-a".into(),
            "dispatch-a".into(),
        ),
        (
            ManagedDispatchState::Published,
            Some(final_id.clone()),
            Some(4),
        ),
    )]);
    assert!(restored.reconcile(&scope(), &outcomes, 201));
    let trace = &restored.list(&scope())[0];
    assert_eq!(trace.status, TraceStatus::Completed);
    assert_eq!(trace.final_message_id, Some(final_id));
    assert!(!restored.reconcile(&scope(), &outcomes, 202));
}

#[test]
fn completion_before_publication_stays_completed_without_fabricated_final() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    store.observe(
        &scope(),
        &frame(2, ManagedPresentationKindV1::Completed),
        110,
    );
    assert!(!store.interrupt_session(&scope(), &"22".repeat(32), 4, 120));
    assert_eq!(store.list(&scope())[0].status, TraceStatus::Completed);
    assert_eq!(store.list(&scope())[0].final_message_id, None);
}

#[test]
fn terminal_outcomes_survive_reload_and_stale_process_cannot_interrupt() {
    for (kind, status) in [
        (ManagedPresentationKindV1::Cancelled, TraceStatus::Cancelled),
        (ManagedPresentationKindV1::Failed, TraceStatus::Failed),
    ] {
        let (dir, mut store) = fixture();
        begin(&mut store);
        assert!(!store.interrupt_session(&scope(), &"22".repeat(32), 3, 110));
        store.observe(&scope(), &frame(2, kind), 120);
        store.save().unwrap();
        let restored = TraceStore::load(dir.path().join("traces.json"), 200).unwrap();
        assert_eq!(restored.list(&scope())[0].status, status);
    }
}

#[test]
fn credential_fragments_are_redacted_after_joining_and_pending_text_is_not_saved() {
    let (dir, mut store) = fixture();
    begin(&mut store);
    store.observe(&scope(), &chunk(2, "Authorization: Bea"), 101);
    store.observe(&scope(), &chunk(3, "rer protected-value"), 102);
    store.save().unwrap();
    let disk = std::fs::read_to_string(dir.path().join("traces.json")).unwrap();
    assert!(!disk.contains("protected-value"));
    store.observe(&scope(), &step(4, 1, StepStatus::Active), 103);
    assert_eq!(
        store.list(&scope())[0].entries[0].text,
        "Work update withheld"
    );
    let mut secret_command = step(5, 2, StepStatus::Active);
    let activity = secret_command.activity.as_mut().unwrap();
    activity.kind = Kind::Command;
    activity.label = "Running curl --header 'Authorization: Bearer protected-value'".into();
    store.observe(&scope(), &secret_command, 104);
    store.save().unwrap();
    let disk = std::fs::read_to_string(dir.path().join("traces.json")).unwrap();
    assert!(!disk.contains("protected-value"));
    assert!(!disk.contains("rawInput"));
    assert!(!disk.contains("agent_thought_chunk"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.path().join("traces.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[test]
fn entry_and_text_bounds_are_explicit_and_tool_settlement_survives_cap() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    store.observe(&scope(), &chunk(2, &"語".repeat(2000)), 101);
    for i in 0..300 {
        store.observe(&scope(), &step(i + 3, i + 1, StepStatus::Active), 102 + i);
    }
    store.observe(&scope(), &step(304, 1, StepStatus::Done), 500);
    let trace = &store.list(&scope())[0];
    assert_eq!(trace.entries.len(), MAX_ENTRIES);
    assert!(trace.truncated);
    assert!(trace.entries[0].text.len() <= MAX_TEXT_BYTES);
    assert_eq!(trace.entries[1].status, "done");
}

#[test]
fn publication_notice_requires_every_frozen_coordinate_and_persists_without_a_view() {
    let (dir, mut store) = fixture();
    begin(&mut store);
    store.observe(
        &scope(),
        &frame(2, ManagedPresentationKindV1::Completed),
        110,
    );
    let request = luca_protocol::ManagedMessagePublishRequestV1 {
        protocol: luca_protocol::MESSAGE_PUBLISH_PROTOCOL.into(),
        turn_id: OpaqueId::parse("turn-a").unwrap(),
        idempotency_key: Hex64::parse("66".repeat(32)).unwrap(),
        owner_pubkey: Hex64::parse(scope().owner).unwrap(),
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        conversation_id: OpaqueId::parse("conversation-a").unwrap(),
        thread_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: Some(luca_protocol::ManagedResponseSurfaceV1::Timeline),
        resolved_p_tags: vec![],
        final_draft: "FINAL_DRAFT_MUST_NOT_BE_SAVED".into(),
        dispatch_receipt_id: OpaqueId::parse("dispatch-a").unwrap(),
        cancellation_epoch: SafeU53::new(0).unwrap(),
        exchange: None,
        bucket_hint: None,
    };
    let final_id = "aa".repeat(32);
    assert!(!store.record_published(&scope(), &request, 5, &final_id, 120));
    let mut wrong_scope = scope();
    wrong_scope.relay = "sha256:other-community".into();
    assert!(!store.record_published(&wrong_scope, &request, 4, &final_id, 120));
    for field in ["owner", "resident", "conversation", "receipt", "turn"] {
        let mut wrong = request.clone();
        match field {
            "owner" => wrong.owner_pubkey = Hex64::parse("77".repeat(32)).unwrap(),
            "resident" => wrong.resident_pubkey = Hex64::parse("77".repeat(32)).unwrap(),
            "conversation" => wrong.conversation_id = OpaqueId::parse("wrong").unwrap(),
            "receipt" => wrong.dispatch_receipt_id = OpaqueId::parse("wrong").unwrap(),
            _ => wrong.turn_id = OpaqueId::parse("wrong").unwrap(),
        }
        assert!(!store.record_published(&scope(), &wrong, 4, &final_id, 120));
    }
    assert!(store.record_published(&scope(), &request, 4, &final_id, 120));
    assert!(!store.record_published(&scope(), &request, 4, &final_id, 120));
    assert!(!store.record_published(&scope(), &request, 4, &"bb".repeat(32), 120));
    store.save().unwrap();
    let bytes = std::fs::read_to_string(dir.path().join("traces.json")).unwrap();
    assert!(!bytes.contains("FINAL_DRAFT_MUST_NOT_BE_SAVED"));
    let restored = TraceStore::load(dir.path().join("traces.json"), 130).unwrap();
    assert_eq!(
        restored.list(&scope())[0].final_message_id.as_deref(),
        Some(final_id.as_str())
    );
}

#[test]
fn bounded_details_supply_missing_objects_and_whole_command_is_redacted() {
    let (_dir, mut store) = fixture();
    begin(&mut store);
    let mut file = step(2, 1, StepStatus::Active);
    let activity = file.activity.as_mut().unwrap();
    activity.label = "Reading a file".into();
    activity.detail = Some("src/exact-source.rs".into());
    store.observe(&scope(), &file, 101);
    let mut command = step(3, 2, StepStatus::Active);
    let activity = command.activity.as_mut().unwrap();
    activity.kind = Kind::Command;
    activity.label = "Run command".into();
    activity.detail = Some("cargo test managed_presentation".into());
    store.observe(&scope(), &command, 102);
    command.sequence = SafeU53::new(4).unwrap();
    let activity = command.activity.as_mut().unwrap();
    activity.step = Some(SafeU53::new(3).unwrap());
    activity.detail = Some("curl --token 'protected-value'".into());
    store.observe(&scope(), &command, 103);
    let trace = &store.list(&scope())[0];
    assert_eq!(trace.entries[0].text, "Reading exact-source.rs");
    assert_eq!(
        trace.entries[1].text,
        "Running cargo test managed_presentation"
    );
    assert_eq!(trace.entries[1].room_text, "Running a command");
    assert_eq!(trace.entries[2].text, "Running a command");
    assert!(!serde_json::to_string(trace)
        .unwrap()
        .contains("protected-value"));
}

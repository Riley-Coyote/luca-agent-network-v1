use super::*;

fn empty_record() -> StoredPlace {
    StoredPlace {
        schema: STORE_SCHEMA.into(),
        owner_pubkey: "1".repeat(64),
        relay_scope: "sha256:22".repeat(32),
        resident_pubkey: "3".repeat(64),
        revision: 0,
        resident_editing_enabled: false,
        visibility: "private".into(),
        content: ResidentPlaceContent {
            introduction: String::new(),
            exploration: String::new(),
            selected_work: None,
        },
        author: None,
        updated_at: None,
    }
}

fn content(value: &str) -> ResidentPlaceContent {
    ResidentPlaceContent {
        introduction: value.into(),
        exploration: String::new(),
        selected_work: None,
    }
}

#[test]
fn content_update_is_cas_and_retry_safe() {
    let mut record = empty_record();
    let author = StoredAuthor {
        kind: AuthorKind::Owner,
        pubkey: "1".repeat(64),
    };
    apply_content_update(&mut record, 0, content("first"), author.clone(), false).unwrap();
    assert_eq!(record.revision, 1);
    let date = record.updated_at;

    // A transport retry with the old revision returns the committed result
    // rather than turning the same request into a conflict or a second edit.
    apply_content_update(&mut record, 0, content("first"), author, false).unwrap();
    assert_eq!(record.revision, 1);
    assert_eq!(record.updated_at, date);
    assert_eq!(
        apply_content_update(
            &mut record,
            0,
            content("different"),
            StoredAuthor {
                kind: AuthorKind::Owner,
                pubkey: "1".repeat(64),
            },
            false,
        ),
        Err(conflict(1))
    );
}

#[test]
fn resident_authoring_requires_owner_enabled_policy_and_derives_author() {
    let mut record = empty_record();
    let resident = StoredAuthor {
        kind: AuthorKind::Resident,
        pubkey: "3".repeat(64),
    };
    assert_eq!(
        apply_content_update(&mut record, 0, content("resident"), resident.clone(), true),
        Err("resident-place-authoring-disabled".into())
    );
    apply_editing_update(&mut record, 0, true).unwrap();
    apply_content_update(&mut record, 1, content("resident"), resident.clone(), true).unwrap();
    assert_eq!(record.author, Some(resident));
}

#[test]
fn policy_revision_preserves_existing_content_authorship_and_date() {
    let mut record = empty_record();
    let owner = StoredAuthor {
        kind: AuthorKind::Owner,
        pubkey: "1".repeat(64),
    };
    apply_content_update(&mut record, 0, content("owner copy"), owner, false).unwrap();
    let author = record.author.clone();
    let updated_at = record.updated_at;
    apply_editing_update(&mut record, 1, true).unwrap();
    assert_eq!(record.revision, 2);
    assert_eq!(record.author, author);
    assert_eq!(record.updated_at, updated_at);
}

#[test]
fn invalid_pinned_work_is_rejected_before_storage() {
    assert_eq!(
        validate_content(&ResidentPlaceContent {
            introduction: String::new(),
            exploration: String::new(),
            selected_work: Some(ResidentPlaceWork {
                artifact_id: "artifact".into(),
                version: 0,
            }),
        }),
        Err(invalid())
    );
}

#[test]
fn record_scope_binds_owner_relay_and_resident_and_rejects_corruption() {
    let record = empty_record();
    assert!(record_matches_scope(
        &record,
        &"1".repeat(64),
        &"sha256:22".repeat(32),
        &"3".repeat(64),
    ));
    assert!(!record_matches_scope(
        &record,
        &"4".repeat(64),
        &"sha256:22".repeat(32),
        &"3".repeat(64),
    ));
    assert!(!record_matches_scope(
        &record,
        &"1".repeat(64),
        &"sha256:55".repeat(32),
        &"3".repeat(64),
    ));
    assert!(!record_matches_scope(
        &record,
        &"1".repeat(64),
        &"sha256:22".repeat(32),
        &"6".repeat(64),
    ));
    let mut corrupt_record = record;
    corrupt_record.schema = "not-a-place-store".into();
    assert!(!record_matches_scope(
        &corrupt_record,
        &"1".repeat(64),
        &"sha256:22".repeat(32),
        &"3".repeat(64),
    ));
}

#[test]
fn agent_wire_payload_is_flat_snake_case_and_disabled_reads_fail_closed() {
    let parsed: AgentResidentPlaceUpdateInput = serde_json::from_value(serde_json::json!({
        "expected_revision": 7,
        "introduction": "hello",
        "exploration": "testing",
        "selected_work": { "artifact_id": "selected-work-1", "version": 3 }
    }))
    .unwrap();
    let owner_input: ResidentPlaceUpdateInput = parsed.into();
    assert_eq!(owner_input.expected_revision, 7);
    assert_eq!(owner_input.content.introduction, "hello");
    assert_eq!(
        owner_input.content.selected_work,
        Some(ResidentPlaceWork {
            artifact_id: "selected-work-1".into(),
            version: 3,
        })
    );
    assert!(
        serde_json::from_value::<AgentResidentPlaceUpdateInput>(serde_json::json!({
            "expected_revision": 7,
            "content": { "introduction": "smuggled" }
        }))
        .is_err()
    );
    assert_eq!(
        require_resident_authoring_enabled(&empty_record()),
        Err("resident-place-authoring-disabled".into())
    );
}

#[test]
fn only_explicit_private_visibility_satisfies_agent_conversation_gate() {
    assert!(is_private_channel_visibility("private"));
    assert!(is_private_channel_visibility("PRIVATE"));
    assert!(!is_private_channel_visibility("open"));
    assert!(!is_private_channel_visibility(""));
}

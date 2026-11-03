use super::*;

#[test]
fn fixture_bundle_covers_owner_facing_terminal_states() {
    let fixtures = get_resident_notebook_fixtures();
    assert_eq!(fixtures.ready.availability, "ready");
    assert_eq!(fixtures.empty.availability, "empty");
    assert_eq!(fixtures.locked.availability, "locked");
    assert_eq!(fixtures.unavailable.availability, "unavailable");
    assert_eq!(fixtures.jobs.len(), 5);
    assert!(fixtures.jobs.iter().any(|job| job.state == "failed"));
    assert_eq!(fixtures.detail.revisions.len(), 2);
    assert_eq!(fixtures.detail.annotations.len(), 1);
}

#[test]
fn detail_target_accepts_head_record_or_stable_lineage_id() {
    let views = vec![fixture_journal(1, "page-v1"), fixture_journal(2, "page-v2")];
    assert_eq!(
        notebook_target_root(&views, "page-v2").as_deref(),
        Some("fixture-journal")
    );
    assert_eq!(
        notebook_target_root(&views, "fixture-journal").as_deref(),
        Some("fixture-journal")
    );
}

#[test]
fn exact_source_root_bypasses_only_forget_disclosure_preflight() {
    let root = format!("companion-note-{}", "a".repeat(64));
    assert_eq!(direct_source_note_forget_target(&root, true).unwrap().as_str(), root);
    assert!(direct_source_note_forget_target(&root, false).is_none());
    for invalid in ["fixture-note".to_owned(), "companion-note-short".into(),
        format!("companion-note-{}", "A".repeat(64)),
        format!("companion-note-{}", "g".repeat(64)),
        format!("companion-note-{}-revision", "a".repeat(64)),
    ] {
        assert!(direct_source_note_forget_target(&invalid, true).is_none());
    }
}

#[test]
fn withheld_source_note_dto_is_explicit_management_metadata_only() {
    let item = notebook_item_view(ResidentNotebookRevisionViewV1 {
        lineage_root_id: OpaqueId::parse(format!("companion-note-{}", "a".repeat(64))).unwrap(),
        record_id: OpaqueId::parse("source-note-head").unwrap(),
        record_type: OpaqueId::parse("memory-note").unwrap(),
        revision: luca_protocol::SafeU53::new(1).unwrap(),
        status: luca_protocol::ResidentNotebookStatusV1::Active,
        pinned_owner_correction: false,
        author_kind: OpaqueId::parse("resident").unwrap(),
        // Even accidental upstream provenance must never leave a placeholder.
        provenance_refs: vec![luca_protocol::Sha256Ref::parse(format!("sha256:{}", "b".repeat(64))).unwrap()],
        body: ResidentNotebookBodyV1::WithheldSourceNote {
            updated_at: luca_protocol::CanonicalTimestamp::parse("2026-11-03T10:00:00Z").unwrap(),
        },
    });
    assert_eq!(item.kind, "memory_note");
    assert_eq!(item.content_withheld, Some(true));
    assert_eq!(item.category, None);
    assert!(item.source_event_ids.is_empty());
    assert!(item.source_page_ids.is_empty());
    assert!(item.title.is_none());
    let encoded = serde_json::to_value(&item).unwrap();
    assert_eq!(encoded["contentWithheld"], true);
    assert_eq!(encoded["body"], "Source-linked note content is unavailable. You can still forget this note.");
    assert!(!encoded.to_string().contains(&"b".repeat(64)));
    let ordinary = serde_json::to_value(fixture_note()).unwrap();
    assert!(ordinary.get("contentWithheld").is_none());
}

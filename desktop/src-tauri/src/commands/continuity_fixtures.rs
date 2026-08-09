use super::*;

#[tauri::command]
/// Returns deterministic backend-owned fixtures for deferred frontend work.
pub fn get_resident_notebook_fixtures() -> ResidentNotebookFixturesV1 {
    let note = fixture_note();
    let journal = fixture_journal(1, "fixture-journal-v1");
    let journal_revision = fixture_journal(2, "fixture-journal-v2");
    let annotation = fixture_annotation();
    ResidentNotebookFixturesV1 {
        ready: ResidentNotebookListV1 {
            availability: "ready",
            items: vec![
                clone_notebook_item_view(&journal_revision),
                clone_notebook_item_view(&note),
            ],
            next_cursor: None,
        },
        empty: ResidentNotebookListV1 {
            availability: "empty",
            items: Vec::new(),
            next_cursor: None,
        },
        locked: ResidentNotebookListV1 {
            availability: "locked",
            items: Vec::new(),
            next_cursor: None,
        },
        unavailable: ResidentNotebookListV1 {
            availability: "unavailable",
            items: Vec::new(),
            next_cursor: None,
        },
        detail: ResidentNotebookDetailV1 {
            availability: "ready",
            item: Some(clone_notebook_item_view(&journal_revision)),
            revisions: vec![journal, journal_revision],
            annotations: vec![annotation],
        },
        jobs: ["pending", "running", "completed", "cancelled", "failed"]
            .into_iter()
            .map(|state| ResidentJournalJobViewV1 {
                job_id: format!("fixture-journal-{state}"),
                state: state.to_owned(),
                last_error_code: (state == "failed").then(|| "runtime_unavailable".to_owned()),
                updated_at: "2026-08-06T12:10:00Z".into(),
                can_cancel: matches!(state, "pending" | "running"),
                can_retry: state == "failed",
            })
            .collect(),
    }
}

pub(super) fn fixture_note() -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: "fixture-note".into(),
        lineage_root_id: "fixture-note".into(),
        kind: "memory_note",
        status: "active",
        authorship: "resident",
        revision: 1,
        pinned_owner_correction: false,
        title: None,
        body: "Keep the identity key stable while the runtime changes.".into(),
        category: Some("decision"),
        source_event_ids: vec!["a".repeat(64)],
        source_page_ids: Vec::new(),
        created_at: "2026-08-06T12:00:00Z".into(),
        updated_at: "2026-08-06T12:00:00Z".into(),
    }
}

pub(super) fn fixture_journal(revision: u64, item_id: &str) -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: item_id.into(),
        lineage_root_id: "fixture-journal".into(),
        kind: "journal_page",
        status: "active",
        authorship: "resident",
        revision,
        pinned_owner_correction: false,
        title: Some("What I want to carry".into()),
        body: format!("# What I want to carry\n\nResident-authored notebook revision {revision}."),
        category: None,
        source_event_ids: vec!["b".repeat(64)],
        source_page_ids: Vec::new(),
        created_at: "2026-08-06T12:05:00Z".into(),
        updated_at: format!("2026-08-06T12:0{}:00Z", 4 + revision),
    }
}

pub(super) fn fixture_annotation() -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: "fixture-annotation".into(),
        lineage_root_id: "fixture-annotation".into(),
        kind: "journal_annotation",
        status: "active",
        authorship: "owner",
        revision: 1,
        pinned_owner_correction: false,
        title: None,
        body: "Owner annotation: preserve the unresolved question.".into(),
        category: None,
        source_event_ids: Vec::new(),
        source_page_ids: vec!["fixture-journal".into()],
        created_at: "2026-08-06T12:09:00Z".into(),
        updated_at: "2026-08-06T12:09:00Z".into(),
    }
}

pub(super) fn clone_notebook_item_view(
    value: &ResidentNotebookItemViewV1,
) -> ResidentNotebookItemViewV1 {
    ResidentNotebookItemViewV1 {
        item_id: value.item_id.clone(),
        lineage_root_id: value.lineage_root_id.clone(),
        kind: value.kind,
        status: value.status,
        authorship: value.authorship,
        revision: value.revision,
        pinned_owner_correction: value.pinned_owner_correction,
        title: value.title.clone(),
        body: value.body.clone(),
        category: value.category,
        source_event_ids: value.source_event_ids.clone(),
        source_page_ids: value.source_page_ids.clone(),
        created_at: value.created_at.clone(),
        updated_at: value.updated_at.clone(),
    }
}

pub(super) fn notebook_target_root(
    views: &[ResidentNotebookItemViewV1],
    target: &str,
) -> Option<String> {
    views
        .iter()
        .find(|view| {
            view.kind != "journal_annotation"
                && (view.lineage_root_id == target || view.item_id == target)
        })
        .map(|view| view.lineage_root_id.clone())
}

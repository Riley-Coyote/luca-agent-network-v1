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

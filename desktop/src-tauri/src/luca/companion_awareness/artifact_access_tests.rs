//! Disposable Library sentinels and pure metadata facts only. No native profile,
//! worker, model, keychain, browser, dialog, or user artifact is inspected.
use super::super::{
    selected_files::{
        digest,
        tests::{id, now, number, Fixture},
    },
    AwarenessDependentKindV1, AwarenessGrantKeyV1, AwarenessHostFactsV1,
};
use super::*;
use crate::luca::companion_awareness::AwarenessWithdrawalV1;
use crate::luca::artifacts::{ArtifactDeletedFilter, ArtifactWriteContext};
use luca_protocol::{
    ArtifactCreateArgsV1, ArtifactKindV1, ArtifactReceiptStateV1, ArtifactSourceV1,
    AwarenessMaterialStateV1, AwarenessSourceStateV1, AWARENESS_PROTOCOL,
};
use std::cell::Cell;

fn record(owner: &Hex64, resident: &Hex64, turn: Option<String>, name: &str) -> ArtifactRecord {
    ArtifactRecord {
        artifact_id: name.into(),
        title: name.into(),
        kind: ArtifactKindV1::Markdown,
        current_version: 1,
        receipt_state: ArtifactReceiptStateV1::Linked,
        lifecycle_state: "ready".into(),
        pinned: false,
        created_by_pubkey: if turn.is_some() {
            resident.as_str().into()
        } else {
            owner.as_str().into()
        },
        conversation_id: None,
        source_turn_id: turn,
        created_at: "2026-10-08T10:00:02Z".into(),
        updated_at: "2026-10-08T10:00:02Z".into(),
        deleted_at: None,
    }
}
fn node() -> OpaqueId {
    id(&format!("{DERIVED_CREATION_PREFIX}{}", "a".repeat(64)))
}
fn material(_: &AwarenessObservationRefV1, retained: bool) -> AwarenessMaterialFactsV1 {
    assert!(
        retained,
        "Library consumption must not re-admit raw context"
    );
    AwarenessMaterialFactsV1 {
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Available,
    }
}
fn promoted(fixture: &Fixture) -> (AwarenessGrantKeyV1, OpaqueId) {
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let key = fixture.grant(id("source-artifact-sentinel"), true);
    let current = fixture.runtime.snapshot(live.owner(), &key).unwrap();
    let mut grant = current.grant;
    grant.grant_revision = number(2);
    grant.choices.promote = true;
    fixture
        .runtime
        .put_grant(
            &live,
            &grant,
            Some(number(1)),
            &id("allow-sentinel-promotion"),
        )
        .unwrap();
    fixture
        .runtime
        .set_source_health(
            &live,
            &key.source,
            current.source_revision,
            AwarenessSourceStateV1::Current,
            &id("sentinel-current"),
        )
        .unwrap();
    let reference = AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        observation_id: id("observation-artifact-sentinel"),
        owner_pubkey: live.owner().clone(),
        resident_pubkey: fixture.resident.clone(),
        source_id: key.source.source_id.clone(),
        device_id: key.source.device_id.clone(),
        grant_id: grant.grant_id,
        grant_revision: number(2),
        deny_epoch: number(0),
        sequence: number(1),
        evidence_ref: digest(b"SOURCE_SENTINEL").unwrap(),
        captured_at: now(),
        expires_at: CanonicalTimestamp::parse("2026-10-08T10:05:02Z").unwrap(),
    };
    let time = now();
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: live.owner(),
        resident_pubkey: &fixture.resident,
        now: &time,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    };
    fixture
        .runtime
        .admit(
            &live,
            &facts,
            reference.clone(),
            b"SOURCE_SENTINEL".to_vec(),
        )
        .unwrap();
    let node = node();
    fixture
        .runtime
        .register_dependent(
            &live,
            &node,
            AwarenessDependentKindV1::Promoted,
            &[reference.observation_id],
            &facts,
            |_, _| AwarenessMaterialFactsV1 {
                source_fresh: true,
                material_state: AwarenessMaterialStateV1::Available,
            },
        )
        .unwrap();
    (key, node)
}

#[test]
fn ordinary_artifacts_stay_independent_and_reserved_unknown_scope_fails_closed() {
    let fixture = Fixture::new();
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let ordinary = record(live.owner(), &fixture.resident, None, "ordinary-artifact");
    assert_eq!(
        with_artifact_access(&fixture.state, live.owner(), &ordinary, || {
            "ORDINARY_SENTINEL"
        })
        .unwrap(),
        "ORDINARY_SENTINEL"
    );
    let canonical = record(
        live.owner(),
        &fixture.resident,
        Some(format!("{CANONICAL_CREATION_PREFIX}{}", "b".repeat(64))),
        "canonical-artifact",
    );
    assert_eq!(
        with_artifact_access(&fixture.state, live.owner(), &canonical, || {
            "CANONICAL_SENTINEL"
        })
        .unwrap(),
        "CANONICAL_SENTINEL"
    );
    let wrong_owner = Hex64::parse("dd".repeat(32)).unwrap();
    assert_eq!(
        with_artifact_access(&fixture.state, &wrong_owner, &canonical, || panic!(
            "wrong owner ran effect"
        )),
        Err(ArtifactStoreError::NotFound)
    );
    let mut malformed = canonical.clone();
    malformed.source_turn_id = Some("initiative-creation-unsupported:a".into());
    assert_eq!(
        with_artifact_access(&fixture.state, live.owner(), &malformed, || panic!(
            "unknown prefix ran effect"
        )),
        Err(ArtifactStoreError::NotFound)
    );
    malformed.source_turn_id = Some(format!("{DERIVED_CREATION_PREFIX}short"));
    assert_eq!(
        creation_scope(live.owner(), &malformed),
        Err(ArtifactStoreError::NotFound)
    );
    // No current source snapshot is installed: missing retained facts are not
    // treated as a blanket Available permission even for a plausible node ID.
    let derivative = record(
        live.owner(),
        &fixture.resident,
        Some(node().as_str().into()),
        "derived-artifact",
    );
    assert_eq!(
        with_artifact_access(&fixture.state, live.owner(), &derivative, || panic!(
            "unknown source facts ran effect"
        )),
        Err(ArtifactStoreError::NotFound)
    );
}

#[test]
fn retained_read_survives_raw_expiry_closed_source_and_pause_but_revoke_blocks_queued_effect() {
    let fixture = Fixture::new();
    let (key, node) = promoted(&fixture);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let after_raw = CanonicalTimestamp::parse("2026-10-09T10:00:00Z").unwrap();
    let current = fixture.runtime.snapshot(live.owner(), &key).unwrap();
    fixture
        .runtime
        .set_source_health(
            &live,
            &key.source,
            current.source_revision,
            AwarenessSourceStateV1::Unavailable,
            &id("closed-sentinel-source"),
        )
        .unwrap();
    let resident = fixture
        .runtime
        .resident_state(live.owner(), &fixture.resident)
        .unwrap();
    fixture
        .runtime
        .set_paused(
            live.owner(),
            &fixture.resident,
            None,
            Some(resident.revision),
            true,
            &after_raw,
            &id("pause-sentinel-library"),
        )
        .unwrap();
    assert_eq!(
        with_derived_access(
            &live,
            &fixture.runtime,
            &fixture.resident,
            &node,
            &after_raw,
            material,
            || "RETAINED_LIBRARY_SENTINEL"
        )
        .unwrap(),
        "RETAINED_LIBRARY_SENTINEL"
    );
    let emitted = Cell::new(false);
    // Host denial is committed without asking a model or decrypting material.
    fixture
        .runtime
        .withdraw_grant(
            live.owner(),
            &key,
            number(2),
            AwarenessWithdrawalV1::Forget,
            &id("forget-sentinel-source"),
        )
        .unwrap();
    assert_eq!(
        with_derived_access(
            &live,
            &fixture.runtime,
            &fixture.resident,
            &node,
            &after_raw,
            material,
            || emitted.set(true)
        ),
        Err(ArtifactStoreError::NotFound)
    );
    assert!(
        !emitted.get(),
        "queued read/export effect escaped the durable deny"
    );
}

#[test]
fn exact_promoted_type_and_resident_are_required_for_a_creation_node() {
    let fixture = Fixture::new();
    let (_, promoted) = promoted(&fixture);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let wrong_resident = Hex64::parse("cc".repeat(32)).unwrap();
    assert_eq!(
        with_derived_access(
            &live,
            &fixture.runtime,
            &wrong_resident,
            &promoted,
            &now(),
            material,
            || panic!("wrong resident read")
        ),
        Err(ArtifactStoreError::NotFound)
    );
    let raw = id("observation-artifact-sentinel");
    assert_eq!(
        with_derived_access(
            &live,
            &fixture.runtime,
            &fixture.resident,
            &raw,
            &now(),
            material,
            || panic!("raw observation masqueraded as a saved creation")
        ),
        Err(ArtifactStoreError::NotFound)
    );
    assert_eq!(
        with_derived_access(
            &live,
            &fixture.runtime,
            &fixture.resident,
            &promoted,
            &now(),
            |_, _| AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: AwarenessMaterialStateV1::Excluded
            },
            || panic!("excluded material was served")
        ),
        Err(ArtifactStoreError::NotFound)
    );
}

#[test]
fn visible_pages_hide_unknown_creation_totals_and_cursor_coordinates_without_full_scan() {
    let owner = Hex64::parse("11".repeat(32)).unwrap();
    let resident = Hex64::parse("22".repeat(32)).unwrap();
    let query = ArtifactListQuery {
        query: None,
        kinds: Vec::new(),
        deleted: ArtifactDeletedFilter::Active,
        cursor: None,
        limit: 2,
    };
    let ordinary = record(&owner, &resident, None, "visible-ordinary");
    let second = record(&owner, &resident, None, "second-visible-ordinary");
    let hidden = record(
        &owner,
        &resident,
        Some(node().as_str().into()),
        "HIDDEN_PRIVATE_ID",
    );
    let calls = Cell::new(0);
    let page = visible_page(
        &query,
        true,
        |_| {
            calls.set(calls.get() + 1);
            Ok(ArtifactListPage {
                artifacts: vec![
                    if calls.get() == 1 {
                        ordinary.clone()
                    } else {
                        second.clone()
                    },
                    hidden.clone(),
                ],
                next_cursor: Some("RAW_HIDDEN_CURSOR".into()),
                total: 987,
            })
        },
        |record| record.artifact_id != hidden.artifact_id,
    )
    .unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(calls.get(), 2);
    assert!(!format!("{:?}", page.artifacts).contains("HIDDEN_PRIVATE_ID"));
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(page.next_cursor.unwrap())
        .unwrap();
    assert!(String::from_utf8(decoded)
        .unwrap()
        .contains("second-visible-ordinary"));
    let empty = visible_page(
        &query,
        true,
        |_| {
            calls.set(calls.get() + 1);
            Ok(ArtifactListPage {
                artifacts: vec![hidden.clone()],
                next_cursor: Some("RAW_HIDDEN_CURSOR".into()),
                total: 987,
            })
        },
        |_| false,
    )
    .unwrap();
    assert!(empty.artifacts.is_empty());
    assert_eq!(empty.total, 0);
    assert!(empty.next_cursor.is_none());
    assert_eq!(calls.get(), 2 + MAX_VISIBLE_PAGE_PROBES);
    let ordinary_page = visible_page(
        &query,
        false,
        |_| {
            Ok(ArtifactListPage {
                artifacts: vec![ordinary.clone()],
                next_cursor: Some("original-ordinary-cursor".into()),
                total: 123,
            })
        },
        |_| true,
    )
    .unwrap();
    assert_eq!(ordinary_page.total, 123);
    assert_eq!(
        ordinary_page.next_cursor.as_deref(),
        Some("original-ordinary-cursor")
    );
}

#[test]
fn cached_html_token_rechecks_derived_authority_after_preparation() {
    let fixture = Fixture::new();
    let (key, node) = promoted(&fixture);
    let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
    let mut store = ArtifactStore::open(&fixture.root).unwrap();
    let context = ArtifactWriteContext {
        owner_pubkey: live.owner().clone(),
        author_pubkey: fixture.resident.clone(),
        resident_pubkey: fixture.resident.clone(),
        conversation_id: None,
        turn_id: Some(node.clone()),
        dispatch_receipt_id: None,
        working_root_id: None,
        receipt_state: ArtifactReceiptStateV1::Linked,
    };
    let commit = store
        .create(
            &context,
            &ArtifactCreateArgsV1 {
                title: "HTML derived sentinel".into(),
                kind: ArtifactKindV1::Html,
                source: ArtifactSourceV1::InlineText {
                    content_utf8: "<p>CACHED_DERIVED_SENTINEL</p>".into(),
                    declared_media_type: Some("text/html".into()),
                },
                idempotency_key: id("html-sentinel-create"),
                attach_to_reply: false,
            },
            None,
        )
        .unwrap();
    assert!(store.has_reserved_creation_scope(live.owner()).unwrap());
    let artifact_id = id(&commit.artifact.artifact_id);
    let prepared = presentation::prepare(&store, live.owner(), &artifact_id, None).unwrap();
    let request = tauri::http::Request::builder()
        .uri(&prepared.uri)
        .body(Vec::new())
        .unwrap();
    let serve = || {
        presentation::handle_guarded(
            Some(live.owner().as_str()),
            &request,
            |owner, _, turn, author, bytes| {
                assert_eq!(owner, live.owner().as_str());
                assert_eq!(turn, Some(node.as_str()));
                assert_eq!(author, fixture.resident.as_str());
                with_derived_access(
                    &live,
                    &fixture.runtime,
                    &fixture.resident,
                    &node,
                    &now(),
                    material,
                    bytes,
                )
                .ok()
            },
        )
    };
    assert_eq!(serve().status(), tauri::http::StatusCode::OK);
    fixture
        .runtime
        .withdraw_grant(
            live.owner(),
            &key,
            number(2),
            AwarenessWithdrawalV1::Withdraw,
            &id("withdraw-cached-html"),
        )
        .unwrap();
    let denied = serve();
    assert_eq!(denied.status(), tauri::http::StatusCode::NOT_FOUND);
    assert!(denied.body().is_empty());
    presentation::revoke(live.owner().as_str(), &prepared.presentation_id).unwrap();
}

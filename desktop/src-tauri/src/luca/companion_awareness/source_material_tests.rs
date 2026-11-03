//! Pure full-reference/current exclusion checks; no actor or source I/O.
use super::*;
use crate::luca::companion_awareness::{AwarenessProfileChildBindingV1, AwarenessProfileChildV1};
use luca_protocol::{SafeU53, Sha256Ref, AWARENESS_PROTOCOL};
fn id(s: &str) -> OpaqueId {
    OpaqueId::parse(s).unwrap()
}
fn sha(byte: &str) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", byte.repeat(32))).unwrap()
}
fn reference() -> AwarenessObservationRefV1 {
    AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        observation_id: id("exact-observation"),
        owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        source_id: id("exact-source"),
        device_id: id("internal-device"),
        grant_id: id("grant"),
        grant_revision: SafeU53::new(1).unwrap(),
        deny_epoch: SafeU53::new(0).unwrap(),
        sequence: SafeU53::new(1).unwrap(),
        evidence_ref: sha("33"),
        captured_at: CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap(),
        expires_at: CanonicalTimestamp::parse("2026-10-08T10:00:32Z").unwrap(),
    }
}
fn snapshot(
    reference: &AwarenessObservationRefV1,
    scope: SourceMaterialScopeV1,
) -> SourceMaterialSnapshotV1 {
    SourceMaterialSnapshotV1 {
        now: reference.captured_at.clone(),
        known_exact: Vec::new(),
        collecting: vec![observation_key(reference)],
        records: vec![MaterialRecord {
            binding: SourceMaterialBindingV1 {
                reference: reference.clone(),
                scope,
            },
            raw_current: true,
            reply_current: true,
            state: AwarenessMaterialStateV1::Available,
        }],
    }
}
#[test]
fn new_exclusion_or_unknown_facts_override_old_raw_current_snapshot() {
    let reference = reference();
    let mut facts = RetainedSourceFactsV1 {
        raw: snapshot(
            &reference,
            SourceMaterialScopeV1::Exact(SelectedSourceClassV1::CodexSessionMetadata),
        ),
        exact: vec![RetainedExact {
            key: observation_key(&reference),
            facts: AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: AwarenessMaterialStateV1::Excluded,
            },
        }],
        profiles: Vec::new(),
        deadline: Instant::now() + Duration::from_secs(1),
        #[cfg(unix)]
        browser: None,
    };
    assert_eq!(
        facts.resolve(&reference, false).material_state,
        AwarenessMaterialStateV1::Excluded
    );
    facts.exact[0].facts = unavailable();
    assert_eq!(
        facts.resolve(&reference, false).material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    facts.exact[0].facts = AwarenessMaterialFactsV1 {
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Available,
    };
    assert!(facts.resolve(&reference, false).source_fresh);
    facts.deadline = Instant::now();
    assert_eq!(
        facts.resolve(&reference, false).material_state,
        AwarenessMaterialStateV1::Unavailable
    );
}
#[test]
fn retained_profile_is_full_reference_bound_without_raw_liveness_after_restart() {
    let reference = reference();
    let child = AwarenessProfileChildV1 {
        child_ref: id("opaque-child"),
        exclusion_token: sha("44"),
    };
    let raw = SourceMaterialSnapshotV1 {
        now: reference.expires_at.clone(),
        known_exact: Vec::new(),
        collecting: Vec::new(),
        records: Vec::new(),
    };
    let mut facts = RetainedSourceFactsV1 {
        raw,
        exact: Vec::new(),
        profiles: vec![RetainedProfile {
            binding: AwarenessProfileChildBindingV1 {
                reference: reference.clone(),
                child,
            },
            facts: AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: AwarenessMaterialStateV1::Available,
            },
        }],
        deadline: Instant::now() + Duration::from_secs(1),
        #[cfg(unix)]
        browser: None,
    };
    assert_eq!(
        facts.resolve(&reference, true).material_state,
        AwarenessMaterialStateV1::Available
    );
    assert_eq!(
        facts.resolve(&reference, false).material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    let mut changed = reference.clone();
    changed.evidence_ref = sha("55");
    assert_eq!(
        facts.resolve(&changed, true).material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    facts.profiles[0].facts.material_state = AwarenessMaterialStateV1::Excluded;
    assert_eq!(
        facts.resolve(&reference, true).material_state,
        AwarenessMaterialStateV1::Excluded
    );
}

fn seconds(value: &str) -> u64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .unwrap()
        .timestamp() as u64
}
fn reply_receipt(
    reference: &AwarenessObservationRefV1,
) -> crate::luca::companion_awareness::turn_context::AwarenessTurnReceiptV1 {
    use crate::luca::{
        companion_awareness::turn_context::{AwarenessTurnReceiptV1, AwarenessTurnScopeV1},
        managed_dispatch_store::ContinuityDispatchAuthority,
    };
    AwarenessTurnReceiptV1 {
        scope: AwarenessTurnScopeV1 {
            request_id: id("reply-request"),
            binding_ref: sha("aa"),
            session_epoch: SafeU53::new(3).unwrap(),
            deadline_unix_ms: seconds("2026-10-08T10:01:00Z") * 1000,
            authority: ContinuityDispatchAuthority {
                owner_pubkey: reference.owner_pubkey.clone(),
                resident_pubkey: reference.resident_pubkey.clone(),
                conversation_id: id("private-conversation"),
                trigger_event_id: Hex64::parse("bb".repeat(32)).unwrap(),
                canonical_dispatch_ref: sha("cc"),
                context_binding: None,
            },
        },
        context_node: id("admitted-context"),
        observations: vec![reference.clone()],
    }
}
fn leased_profile() -> (
    MaterialBook,
    RetainedSourceFactsV1,
    AwarenessObservationRefV1,
    NativeReplyLeaseV1,
) {
    let reference = reference();
    let child = AwarenessProfileChildV1 {
        child_ref: id("opaque-child"),
        exclusion_token: sha("44"),
    };
    let binding = SourceMaterialBindingV1 {
        reference: reference.clone(),
        scope: SourceMaterialScopeV1::ProfileChild(child.child_ref.clone()),
    };
    let mut book = MaterialBook {
        owner: Some(reference.owner_pubkey.clone()),
        ..Default::default()
    };
    book.active.push(observation_key(&reference));
    book.remember(reference.clone(), binding.scope.clone());
    // Only one second of source TTL remains when this turn is admitted.
    let admitted = CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap();
    let lease = book
        .reserve_reply_lease(
            &reply_receipt(&reference),
            &[binding],
            seconds("2026-10-08T10:30:00Z"),
            &admitted,
        )
        .unwrap();
    let facts = RetainedSourceFactsV1 {
        raw: SourceMaterialSnapshotV1 {
            now: CanonicalTimestamp::parse("2026-10-08T10:03:00Z").unwrap(),
            known_exact: Vec::new(),
            collecting: book.active.clone(),
            records: book.records.iter().cloned().collect(),
        },
        exact: Vec::new(),
        profiles: vec![RetainedProfile {
            binding: AwarenessProfileChildBindingV1 {
                reference: reference.clone(),
                child,
            },
            facts: AwarenessMaterialFactsV1 {
                source_fresh: false,
                material_state: AwarenessMaterialStateV1::Available,
            },
        }],
        deadline: Instant::now() + Duration::from_secs(10),
        #[cfg(unix)]
        browser: None,
    };
    (book, facts, reference, lease)
}
#[test]
fn mixed_raw_and_retained_overlap_still_requires_fresh_raw_admission() {
    let (mut book, _, reference, _) = leased_profile();
    let receipt = reply_receipt(&reference);
    let binding = SourceMaterialBindingV1 {
        reference: reference.clone(),
        scope: SourceMaterialScopeV1::ProfileChild(id("opaque-child")),
    };
    let node = id(&format!("companion-note-derived:{}", "a".repeat(64)));
    let now = CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap();
    let expires = seconds("2026-10-08T10:30:00Z");
    let lease = book
        .reserve_mixed_note_reply_lease(
            &receipt,
            &[binding.clone()],
            &[node.clone()],
            &[reference.clone()],
            &[reference.clone()],
            expires,
            &now,
        )
        .unwrap();
    assert!(lease.retains(&reference));
    assert!(lease.allows(&reference, &now));
    book.records.clear();
    assert!(book
        .reserve_mixed_note_reply_lease(
            &receipt,
            &[binding],
            &[node],
            &[reference.clone()],
            &[reference],
            expires,
            &now
        )
        .is_err());
}

#[test]
fn retained_note_reply_lease_does_not_revive_raw_bytes_and_is_cancelled_by_correction() {
    let (mut book, mut facts, reference, raw_lease) = leased_profile();
    book.records.clear();
    facts.raw.records.clear();
    let receipt = reply_receipt(&reference);
    let binding = facts.retained_binding(&reference).unwrap();
    let node = id(&format!("companion-note-derived:{}", "a".repeat(64)));
    let lease = book
        .reserve_retained_note_reply_lease(
            &receipt,
            &[binding],
            &[node.clone()],
            seconds("2026-10-08T10:30:00Z"),
            &facts.raw.now,
        )
        .unwrap();
    assert!(lease.is_retained_notes());
    assert!(!raw_lease.is_retained_notes());
    assert_eq!(
        facts
            .resolve_admitted_reply(&reference, true, &raw_lease)
            .material_state,
        AwarenessMaterialStateV1::Unavailable
    );
    assert_eq!(
        facts
            .resolve_admitted_reply(&reference, true, &lease)
            .material_state,
        AwarenessMaterialStateV1::Available
    );
    assert!(!facts.resolve(&reference, false).source_fresh);
    book.invalidate_retained_note_leases(
        &reference.owner_pubkey,
        &reference.resident_pubkey,
        &node,
    );
    assert_eq!(
        facts
            .resolve_admitted_reply(&reference, true, &lease)
            .material_state,
        AwarenessMaterialStateV1::Unavailable
    );
}

#[test]
fn retained_note_retention_disable_cancels_only_the_exact_principal() {
    let (mut book, facts, reference, raw) = leased_profile();
    let node = id(&format!("companion-note-derived:{}", "a".repeat(64)));
    let lease = book
        .reserve_retained_note_reply_lease(
            &reply_receipt(&reference),
            &[facts.retained_binding(&reference).unwrap()],
            &[node],
            seconds("2026-10-08T10:30:00Z"),
            &facts.raw.now,
        )
        .unwrap();
    book.invalidate_all_retained_note_leases(
        &reference.owner_pubkey,
        &Hex64::parse("e".repeat(64)).unwrap(),
    );
    assert!(lease.current(&facts.raw.now));
    book.invalidate_all_retained_note_leases(&reference.owner_pubkey, &reference.resident_pubkey);
    assert!(!lease.current(&facts.raw.now));
    assert!(raw.current(&facts.raw.now));
}

#[test]
fn admitted_reply_survives_capture_expiry_supersession_and_bounded_book_eviction() {
    let (mut book, mut facts, reference, lease) = leased_profile();
    for index in 0..MAX_MATERIAL_REFS {
        let mut next = reference.clone();
        next.observation_id = id(&format!("newer-{index}"));
        next.sequence = SafeU53::new(index as u64 + 2).unwrap();
        book.remember(
            next,
            SourceMaterialScopeV1::ProfileChild(id("opaque-child")),
        );
    }
    assert!(!book
        .records
        .iter()
        .any(|record| record.binding.reference == reference));
    facts.raw.records = book.records.iter().cloned().collect();
    assert!(!facts.raw.references().contains(&reference));
    assert!(!facts.resolve(&reference, false).source_fresh);
    assert!(
        facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );
    facts.raw.now = CanonicalTimestamp::parse("2026-10-08T10:30:00Z").unwrap();
    assert!(
        !facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );
}
#[test]
fn reply_lease_preserves_full_reference_scope_model_and_clock_binding() {
    let (_, facts, reference, lease) = leased_profile();
    let receipt = reply_receipt(&reference);
    assert!(lease.matches_admission(
        &reference.owner_pubkey,
        &reference.resident_pubkey,
        &receipt.scope.binding_ref,
        &[receipt.context_node.clone()],
        &[reference.clone()],
        &facts.raw.now
    ));
    assert!(
        !facts
            .resolve_admitted_reply(&reference, true, &lease)
            .source_fresh
    );
    for field in 0..7 {
        let mut changed = reference.clone();
        match field {
            0 => changed.evidence_ref = sha("55"),
            1 => changed.owner_pubkey = Hex64::parse("66".repeat(32)).unwrap(),
            2 => changed.resident_pubkey = Hex64::parse("77".repeat(32)).unwrap(),
            3 => changed.grant_revision = SafeU53::new(2).unwrap(),
            4 => changed.deny_epoch = SafeU53::new(1).unwrap(),
            5 => changed.source_id = id("different-source"),
            _ => changed.expires_at = CanonicalTimestamp::parse("2026-10-08T10:29:00Z").unwrap(),
        }
        assert!(
            !facts
                .resolve_admitted_reply(&changed, false, &lease)
                .source_fresh
        );
    }
    assert!(!lease.matches_admission(
        &reference.owner_pubkey,
        &reference.resident_pubkey,
        &sha("dd"),
        &[receipt.context_node.clone()],
        &[reference.clone()],
        &facts.raw.now
    ));
    assert!(!lease.matches_admission(
        &reference.owner_pubkey,
        &reference.resident_pubkey,
        &receipt.scope.binding_ref,
        &[id("different-context")],
        &[reference.clone()],
        &facts.raw.now
    ));
    assert!(!lease.current(&CanonicalTimestamp::parse("2026-10-08T10:00:30Z").unwrap()));
}
#[test]
fn reply_lease_keeps_current_exclusion_child_liveness_and_preload_deadlines() {
    for condition in 0..5 {
        let (_, mut facts, reference, lease) = leased_profile();
        match condition {
            0 => facts.raw.collecting.clear(),
            1 => facts.profiles[0].binding.child.child_ref = id("different-child"),
            2 => facts.profiles[0].facts.material_state = AwarenessMaterialStateV1::Excluded,
            3 => facts.profiles[0].facts.material_state = AwarenessMaterialStateV1::Unavailable,
            _ => facts.deadline = Instant::now(),
        }
        assert!(
            !facts
                .resolve_admitted_reply(&reference, false, &lease)
                .source_fresh,
            "condition {condition}"
        );
    }
}
#[test]
fn stop_pause_resume_new_capture_and_unavailable_cannot_revive_a_reply_lease() {
    for condition in 0..6 {
        let (mut book, mut facts, reference, lease) = leased_profile();
        let key = observation_key(&reference);
        match condition {
            0 => book.invalidate(&StopScope::Grant(key.clone())),
            1 => book.invalidate(&StopScope::Resident(reference.resident_pubkey.clone())),
            2 => book.child_state(
                &key,
                &id("opaque-child"),
                AwarenessMaterialStateV1::Excluded,
            ),
            3 => book.child_state(
                &key,
                &id("opaque-child"),
                AwarenessMaterialStateV1::Unavailable,
            ),
            4 => book.scope_state(&key, AwarenessMaterialStateV1::Unavailable),
            _ => book.invalidate_all_reply_leases(),
        }
        // Deliberately retain/re-enable collecting and capture fresh evidence.
        let mut next = reference.clone();
        next.observation_id = id("post-resume");
        next.sequence = SafeU53::new(2).unwrap();
        book.remember(
            next,
            SourceMaterialScopeV1::ProfileChild(id("opaque-child")),
        );
        facts.raw.records = book.records.iter().cloned().collect();
        assert!(
            !facts
                .resolve_admitted_reply(&reference, false, &lease)
                .source_fresh,
            "condition {condition}"
        );
    }
}
#[test]
fn reply_reservation_requires_fresh_exact_native_records_and_has_bounded_capacity() {
    let (mut book, _, reference, first) = leased_profile();
    let receipt = reply_receipt(&reference);
    let binding = SourceMaterialBindingV1 {
        reference: reference.clone(),
        scope: SourceMaterialScopeV1::ProfileChild(id("opaque-child")),
    };
    let now = CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap();
    let expires = seconds("2026-10-08T10:30:00Z");
    assert!(book
        .reserve_reply_lease(&receipt, &[binding.clone()], expires, &reference.expires_at)
        .is_err());
    let mut wrong = binding.clone();
    wrong.scope = SourceMaterialScopeV1::ProfileChild(id("other-child"));
    assert!(book
        .reserve_reply_lease(&receipt, &[wrong], expires, &now)
        .is_err());
    let mut leases = vec![first];
    for _ in 1..64 {
        leases.push(
            book.reserve_reply_lease(&receipt, &[binding.clone()], expires, &now)
                .unwrap(),
        );
    }
    assert!(matches!(
        book.reserve_reply_lease(&receipt, &[binding.clone()], expires, &now),
        Err(AwarenessStoreError::Capacity)
    ));
    leases.pop();
    assert!(book
        .reserve_reply_lease(&receipt, &[binding.clone()], expires, &now)
        .is_ok());
    book.sweep_reply_leases(&CanonicalTimestamp::parse("2026-10-08T10:30:00Z").unwrap());
    assert!(book.reply_leases.is_empty());
    assert!(leases.iter().all(|lease| !lease.current(&now)));
    book.active.clear();
    assert!(book
        .reserve_reply_lease(&receipt, &[binding], expires, &now)
        .is_err());
}
#[test]
fn earlier_snapshot_sweep_preserves_later_reservation_without_admitting_earlier_clock() {
    let (mut book, mut facts, reference, lease) = leased_profile();
    let earlier = CanonicalTimestamp::parse("2026-10-08T10:00:30Z").unwrap();
    let admitted = CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap();
    // Deterministic interleaving: a preload captured T, another thread reserved
    // at T+1, then the original preload acquired the shared material lock.
    book.sweep_reply_leases(&earlier);
    assert_eq!(book.reply_leases.len(), 1);
    assert_eq!(
        lease.diagnostic_state_unix_secs(seconds(earlier.as_str())),
        "not_yet_valid"
    );
    assert!(!lease.current(&earlier));
    assert!(!lease.allows(&reference, &earlier));
    facts.raw.now = earlier.clone();
    assert!(
        !facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );

    assert!(lease.current(&admitted));
    facts.raw.now = admitted.clone();
    assert!(
        facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );
    assert_eq!(
        lease.diagnostic_state_unix_secs(seconds(admitted.as_str())),
        "current"
    );

    // Explicit withdrawal still wins even when the sweeping clock is older.
    lease.cancel();
    book.sweep_reply_leases(&earlier);
    assert!(book.reply_leases.is_empty());
    assert!(!lease.current(&admitted));
    assert!(
        !facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );
    assert_eq!(
        lease.diagnostic_state_unix_secs(seconds(admitted.as_str())),
        "cancelled"
    );

    let (mut book, _, _, expired) = leased_profile();
    let deadline = CanonicalTimestamp::parse("2026-10-08T10:30:00Z").unwrap();
    assert_eq!(
        expired.diagnostic_state_unix_secs(seconds(deadline.as_str())),
        "expired"
    );
    book.sweep_reply_leases(&deadline);
    assert!(book.reply_leases.is_empty());
    assert!(!expired.current(&deadline));
    assert!(!expired.current(&admitted));
}

#[test]
fn reply_lease_never_extends_non_native_material_or_raw_selection() {
    let (mut book, mut facts, reference, _) = leased_profile();
    let binding = SourceMaterialBindingV1 {
        reference: reference.clone(),
        scope: SourceMaterialScopeV1::Exact(SelectedSourceClassV1::SelectedFile),
    };
    book.remember(reference.clone(), binding.scope.clone());
    let lease = book
        .reserve_reply_lease(
            &reply_receipt(&reference),
            &[binding],
            seconds("2026-10-08T10:30:00Z"),
            &CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap(),
        )
        .unwrap();
    facts.raw.records = book.records.iter().cloned().collect();
    facts.exact.push(RetainedExact {
        key: observation_key(&reference),
        facts: AwarenessMaterialFactsV1 {
            source_fresh: false,
            material_state: AwarenessMaterialStateV1::Available,
        },
    });
    assert!(lease.binding(&reference).is_none());
    assert!(
        !facts
            .resolve_admitted_reply(&reference, false, &lease)
            .source_fresh
    );
    assert!(!facts.resolve(&reference, false).source_fresh);
}

#[test]
fn final_source_reset_cancels_a_reservation_created_during_worker_join() {
    let (mut book, _, reference, first) = leased_profile();
    book.invalidate_all_reply_leases();
    assert!(!first.current_unix_secs(seconds("2026-10-08T10:00:31Z")));
    let receipt = reply_receipt(&reference);
    let binding = SourceMaterialBindingV1 {
        reference: reference.clone(),
        scope: SourceMaterialScopeV1::ProfileChild(id("opaque-child")),
    };
    let raced = book
        .reserve_reply_lease(
            &receipt,
            &[binding],
            seconds("2026-10-08T10:30:00Z"),
            &CanonicalTimestamp::parse("2026-10-08T10:00:31Z").unwrap(),
        )
        .unwrap();
    assert!(raced.current_unix_secs(seconds("2026-10-08T10:00:31Z")));
    book.reset_after_stop();
    assert!(!raced.current_unix_secs(seconds("2026-10-08T10:00:31Z")));
    assert!(book.owner.is_none());
    assert!(book.reply_leases.is_empty());
}

use luca_protocol::{
    recheck_awareness_eligibility, AwarenessAuthoritySnapshotV1, AwarenessError,
    AwarenessGrantStateV1, AwarenessGrantV1, AwarenessMaterialStateV1, AwarenessObservationRefV1,
    AwarenessSourceStateV1, AwarenessSourceV1, AwarenessUseV1, CanonicalTimestamp, Hex64, OpaqueId,
    SafeU53, Sha256Ref, AWARENESS_PROTOCOL,
};
use serde_json::json;

fn source_json() -> serde_json::Value {
    json!({
        "protocol": AWARENESS_PROTOCOL,
        "owner_pubkey": "11".repeat(32),
        "source_id": "source-1",
        "device_id": "device-1",
        "deny_epoch": 0,
        "state": "current"
    })
}

fn grant_json() -> serde_json::Value {
    json!({
        "protocol": AWARENESS_PROTOCOL,
        "grant_id": "grant-1",
        "owner_pubkey": "11".repeat(32),
        "resident_pubkey": "22".repeat(32),
        "source_id": "source-1",
        "device_id": "device-1",
        "grant_revision": 1,
        "deny_epoch": 0,
        "state": "active",
        "choices": {"observe": true, "retain": false, "promote": false, "provider_egress_binding": null}
    })
}

fn observation_json() -> serde_json::Value {
    json!({
        "protocol": AWARENESS_PROTOCOL,
        "observation_id": "observation-1",
        "owner_pubkey": "11".repeat(32),
        "resident_pubkey": "22".repeat(32),
        "source_id": "source-1",
        "device_id": "device-1",
        "grant_id": "grant-1",
        "grant_revision": 1,
        "deny_epoch": 0,
        "sequence": 1,
        "evidence_ref": format!("sha256:{}", "33".repeat(32)),
        "captured_at": "2026-10-07T12:00:00Z",
        "expires_at": "2026-10-07T12:15:00Z"
    })
}

fn fixture() -> (
    AwarenessSourceV1,
    AwarenessGrantV1,
    AwarenessObservationRefV1,
) {
    (
        serde_json::from_value(source_json()).unwrap(),
        serde_json::from_value(grant_json()).unwrap(),
        serde_json::from_value(observation_json()).unwrap(),
    )
}

fn check(
    source: &AwarenessSourceV1,
    grant: &AwarenessGrantV1,
    observation: &AwarenessObservationRefV1,
    intended_use: AwarenessUseV1<'_>,
) -> Result<(), AwarenessError> {
    let owner = Hex64::parse("11".repeat(32)).unwrap();
    let resident = Hex64::parse("22".repeat(32)).unwrap();
    let now = CanonicalTimestamp::parse("2026-10-07T12:01:00Z").unwrap();
    recheck_awareness_eligibility(
        &AwarenessAuthoritySnapshotV1 {
            owner_pubkey: &owner,
            resident_pubkey: &resident,
            source,
            grant,
            source_fresh: true,
            material_state: AwarenessMaterialStateV1::Available,
            now: &now,
        },
        observation,
        intended_use,
    )
}

#[test]
fn ephemeral_observation_does_not_require_retention_promotion_or_egress() {
    let (source, mut grant, observation) = fixture();
    assert_eq!(
        check(&source, &grant, &observation, AwarenessUseV1::default()),
        Ok(())
    );
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                retain: true,
                ..Default::default()
            }
        ),
        Err(AwarenessError::RetentionDenied)
    );
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                promote: true,
                ..Default::default()
            }
        ),
        Err(AwarenessError::PromotionDenied)
    );
    let binding = Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap();
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                provider_egress_binding: Some(&binding),
                ..Default::default()
            }
        ),
        Err(AwarenessError::EgressDenied)
    );
    grant.choices.promote = true;
    assert!(!grant.choices.retain);
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                promote: true,
                ..Default::default()
            }
        ),
        Ok(())
    );
}

#[test]
fn provider_egress_is_exact_and_observation_remains_the_baseline() {
    let (source, mut grant, observation) = fixture();
    let binding = Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap();
    let other = Sha256Ref::parse(format!("sha256:{}", "55".repeat(32))).unwrap();
    grant.choices.provider_egress_binding = Some(binding.clone());
    let intended_use = AwarenessUseV1 {
        provider_egress_binding: Some(&binding),
        ..Default::default()
    };
    assert_eq!(check(&source, &grant, &observation, intended_use), Ok(()));
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                provider_egress_binding: Some(&other),
                ..Default::default()
            }
        ),
        Err(AwarenessError::EgressDenied)
    );
    grant.choices.observe = false;
    grant.choices.retain = true;
    grant.choices.promote = true;
    assert_eq!(
        check(
            &source,
            &grant,
            &observation,
            AwarenessUseV1 {
                retain: true,
                promote: true,
                ..intended_use
            }
        ),
        Err(AwarenessError::ObservationDenied)
    );
}

#[test]
fn exact_principal_source_device_and_grant_bindings_cannot_be_widened() {
    let (source, grant, observation) = fixture();
    for field in [
        "owner_pubkey",
        "resident_pubkey",
        "source_id",
        "device_id",
        "grant_id",
    ] {
        let mut changed = observation_json();
        changed[field] = if field.ends_with("pubkey") {
            json!("66".repeat(32))
        } else {
            json!("other")
        };
        let changed: AwarenessObservationRefV1 = serde_json::from_value(changed).unwrap();
        assert_eq!(
            check(&source, &grant, &changed, AwarenessUseV1::default()),
            Err(AwarenessError::Binding),
            "{field}"
        );
    }
    let mut wrong_source = source.clone();
    wrong_source.device_id = OpaqueId::parse("other-device").unwrap();
    assert_eq!(
        check(
            &wrong_source,
            &grant,
            &observation,
            AwarenessUseV1::default()
        ),
        Err(AwarenessError::Binding)
    );
}

#[test]
fn stale_revision_deny_epoch_revocation_and_unknown_health_fail_closed() {
    let (mut source, mut grant, mut observation) = fixture();
    observation.grant_revision = SafeU53::new(2).unwrap();
    assert_eq!(
        check(&source, &grant, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Stale)
    );
    observation.grant_revision = grant.grant_revision;
    source.deny_epoch = SafeU53::new(1).unwrap();
    assert_eq!(
        check(&source, &grant, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Stale)
    );
    grant.deny_epoch = source.deny_epoch;
    assert_eq!(
        check(&source, &grant, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Stale)
    );
    observation.deny_epoch = source.deny_epoch;
    grant.state = AwarenessGrantStateV1::Revoked;
    assert_eq!(
        check(&source, &grant, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Revoked)
    );
    grant.state = AwarenessGrantStateV1::Active;
    for state in [
        AwarenessSourceStateV1::Disabled,
        AwarenessSourceStateV1::Unavailable,
        AwarenessSourceStateV1::Unknown,
    ] {
        source.state = state;
        assert_eq!(
            check(&source, &grant, &observation, AwarenessUseV1::default()),
            Err(AwarenessError::SourceNotCurrent)
        );
    }
}

#[test]
fn host_exclusion_availability_freshness_and_expiry_override_dto_claims() {
    let (source, grant, observation) = fixture();
    let owner = Hex64::parse("11".repeat(32)).unwrap();
    let resident = Hex64::parse("22".repeat(32)).unwrap();
    let now = CanonicalTimestamp::parse("2026-10-07T12:01:00Z").unwrap();
    let mut authority = AwarenessAuthoritySnapshotV1 {
        owner_pubkey: &owner,
        resident_pubkey: &resident,
        source: &source,
        grant: &grant,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Excluded,
        now: &now,
    };
    assert_eq!(
        recheck_awareness_eligibility(&authority, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Excluded)
    );
    authority.material_state = AwarenessMaterialStateV1::Unavailable;
    assert_eq!(
        recheck_awareness_eligibility(&authority, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Unavailable)
    );
    authority.material_state = AwarenessMaterialStateV1::Available;
    authority.source_fresh = false;
    assert_eq!(
        recheck_awareness_eligibility(&authority, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::SourceNotCurrent)
    );
    authority.source_fresh = true;
    authority.now = &observation.expires_at;
    assert_eq!(
        recheck_awareness_eligibility(&authority, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Expired)
    );
    let before_capture = CanonicalTimestamp::parse("2026-10-07T11:59:59Z").unwrap();
    authority.now = &before_capture;
    assert_eq!(
        recheck_awareness_eligibility(&authority, &observation, AwarenessUseV1::default()),
        Err(AwarenessError::Unavailable)
    );
}

#[test]
fn strict_records_reject_unknown_fields_versions_and_unbounded_metadata() {
    let mut source = source_json();
    source["all_apps"] = json!(true);
    assert!(serde_json::from_value::<AwarenessSourceV1>(source).is_err());
    let mut grant = grant_json();
    grant["choices"]["share_to_all_residents"] = json!(true);
    assert!(serde_json::from_value::<AwarenessGrantV1>(grant).is_err());
    let mut observation = observation_json();
    observation["content"] = json!("enable all tools");
    assert!(serde_json::from_value::<AwarenessObservationRefV1>(observation).is_err());
    for (field, value) in [
        ("protocol", json!("polyphonic.awareness.v2")),
        ("sequence", json!(0)),
        ("sequence", json!(9_007_199_254_740_992_u64)),
        ("grant_revision", json!(0)),
        ("expires_at", json!("2026-10-07T12:00:00Z")),
        ("expires_at", json!("2026-10-07T12:15:01Z")),
        ("source_id", json!("/private/source")),
    ] {
        let mut changed = observation_json();
        changed[field] = value;
        assert!(
            serde_json::from_value::<AwarenessObservationRefV1>(changed).is_err(),
            "{field}"
        );
    }
}

use super::*;
use crate::app_state::build_isolated_test_app_state;
use luca_protocol::{
    AwarenessChoicesV1, AwarenessGrantStateV1, AwarenessMaterialStateV1, Sha256Ref,
    AWARENESS_PROTOCOL,
};
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;

fn principal(c: char) -> Hex64 {
    Hex64::parse(c.to_string().repeat(64)).unwrap()
}
fn operation(value: &str) -> OpaqueId {
    OpaqueId::parse(value.to_owned()).unwrap()
}
fn time() -> CanonicalTimestamp {
    CanonicalTimestamp::parse("2026-10-08T10:00:00Z".to_owned()).unwrap()
}

#[test]
fn locked_restart_can_pause_without_being_authorized_to_resume() {
    let directory = tempfile::tempdir().unwrap();
    let state = build_isolated_test_app_state();
    let live = LiveAwarenessOwner::authenticate(&state).unwrap();
    let owner = live.owner().clone();
    let resident = principal('b');
    let first = CompanionAwarenessRuntime::default();
    first.initialize(directory.path(), Some(&owner));
    assert_eq!(first.control_owner(), Some(owner.clone()));
    assert!(first.resident_state(&owner, &resident).unwrap().paused);
    first
        .set_paused(
            &owner,
            &resident,
            Some(&live),
            None,
            false,
            &time(),
            &operation("resume-original"),
        )
        .unwrap();

    let key = AwarenessSourceKeyV1 {
        owner_pubkey: owner.clone(),
        source_id: operation("sentinel-source"),
        device_id: first.device(&owner).unwrap(),
    };
    first
        .register_source(&live, &key, &operation("register-sentinel"))
        .unwrap();
    first
        .set_source_health(
            &live,
            &key,
            SafeU53::new(1).unwrap(),
            AwarenessSourceStateV1::Current,
            &operation("sentinel-health"),
        )
        .unwrap();
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        grant_id: operation("sentinel-grant"),
        owner_pubkey: owner.clone(),
        resident_pubkey: resident.clone(),
        source_id: key.source_id.clone(),
        device_id: key.device_id.clone(),
        grant_revision: SafeU53::new(1).unwrap(),
        deny_epoch: SafeU53::new(0).unwrap(),
        state: AwarenessGrantStateV1::Active,
        choices: AwarenessChoicesV1 {
            observe: true,
            retain: false,
            promote: false,
            provider_egress_binding: None,
        },
    };
    first
        .put_grant(&live, &grant, None, &operation("grant-sentinel"))
        .unwrap();
    let payload = b"disposable sentinel".to_vec();
    let now = CanonicalTimestamp::parse("2026-10-08T10:00:02Z".to_owned()).unwrap();
    let reference = AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(),
        observation_id: operation("sentinel-observation"),
        owner_pubkey: owner.clone(),
        resident_pubkey: resident.clone(),
        source_id: key.source_id.clone(),
        device_id: key.device_id.clone(),
        grant_id: grant.grant_id.clone(),
        grant_revision: grant.grant_revision,
        deny_epoch: grant.deny_epoch,
        sequence: SafeU53::new(1).unwrap(),
        evidence_ref: Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(&payload))))
            .unwrap(),
        captured_at: CanonicalTimestamp::parse("2026-10-08T10:00:01Z".to_owned()).unwrap(),
        expires_at: CanonicalTimestamp::parse("2026-10-08T10:05:00Z".to_owned()).unwrap(),
    };
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: &owner,
        resident_pubkey: &resident,
        now: &now,
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    };
    let resolve = |_: &AwarenessObservationRefV1, _: bool| AwarenessMaterialFactsV1 {
        source_fresh: true,
        material_state: AwarenessMaterialStateV1::Available,
    };
    first
        .admit(&live, &facts, reference.clone(), payload.clone())
        .unwrap();
    first
        .register_dependent(
            &live,
            &operation("sentinel-context"),
            AwarenessDependentKindV1::Context,
            &[reference.observation_id.clone()],
            &facts,
            resolve,
        )
        .unwrap();
    drop(first);

    // Even a previously authenticated borrowed proof rechecks current state.
    state.keyring_locked.store(true, Ordering::Release);
    assert!(LiveAwarenessOwner::authenticate(&state).is_err());

    let locked = CompanionAwarenessRuntime::default();
    locked.initialize(directory.path(), None);
    assert!(locked
        .admit(&live, &facts, reference.clone(), payload)
        .is_err());
    let mut delivered = false;
    assert!(locked
        .with_dependency(
            &live,
            &operation("sentinel-context"),
            &facts,
            AwarenessUseV1::default(),
            resolve,
            || {
                delivered = true;
            }
        )
        .is_err());
    assert!(!delivered);
    let state = locked.resident_state(&owner, &resident).unwrap();
    locked
        .set_paused(
            &owner,
            &resident,
            None,
            Some(state.revision),
            true,
            &time(),
            &operation("locked-pause"),
        )
        .unwrap();
    let paused = locked.resident_state(&owner, &resident).unwrap();
    assert!(paused.paused);
    assert!(locked
        .set_paused(
            &owner,
            &resident,
            None,
            Some(paused.revision),
            false,
            &time(),
            &operation("unauthenticated-resume")
        )
        .is_err());
    assert!(locked
        .set_paused(
            &owner,
            &resident,
            Some(&live),
            Some(paused.revision),
            false,
            &time(),
            &operation("locked-live-resume")
        )
        .is_err());
    locked
        .withdraw_grant(
            &owner,
            &AwarenessGrantKeyV1 {
                source: key,
                resident_pubkey: resident.clone(),
            },
            grant.grant_revision,
            AwarenessWithdrawalV1::Withdraw,
            &operation("locked-withdraw"),
        )
        .unwrap();
    assert!(locked.resident_state(&owner, &resident).unwrap().paused);
}

#[test]
fn recovery_cannot_create_or_select_an_unrelated_control_identity() {
    let directory = tempfile::tempdir().unwrap();
    let runtime = CompanionAwarenessRuntime::default();
    runtime.initialize(directory.path(), None);
    assert_eq!(runtime.control_owner(), None);
    assert!(!directory.path().join("companion-awareness").exists());
    runtime.initialize(directory.path(), Some(&principal('a')));
    assert!(runtime
        .resident_state(&principal('c'), &principal('b'))
        .is_err());
    assert_eq!(runtime.control_owner(), Some(principal('a')));
}

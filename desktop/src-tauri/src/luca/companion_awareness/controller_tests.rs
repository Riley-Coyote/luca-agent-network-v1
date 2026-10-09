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

#[test]
fn conversation_sink_requires_separate_consent_and_does_not_enable_raw_archives() {
    let directory = tempfile::tempdir().unwrap();
    let state = build_isolated_test_app_state();
    let live = LiveAwarenessOwner::authenticate(&state).unwrap();
    let owner = live.owner().clone();
    let resident = principal('b');
    let runtime = CompanionAwarenessRuntime::default();
    runtime.initialize(directory.path(), Some(&owner));
    runtime.set_paused(&owner, &resident, Some(&live), None, false, &time(), &operation("resume-chat-test")).unwrap();
    let source = AwarenessSourceKeyV1 {
        owner_pubkey: owner.clone(), source_id: operation("chat-source"),
        device_id: runtime.device(&owner).unwrap(),
    };
    runtime.register_source(&live, &source, &operation("register-chat-source")).unwrap();
    runtime.set_source_health(&live, &source, SafeU53::new(1).unwrap(), AwarenessSourceStateV1::Current, &operation("chat-source-current")).unwrap();
    let binding = Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap();
    let grant = AwarenessGrantV1 {
        protocol: AWARENESS_PROTOCOL.into(), grant_id: operation("chat-grant"),
        owner_pubkey: owner.clone(), resident_pubkey: resident.clone(),
        source_id: source.source_id.clone(), device_id: source.device_id.clone(),
        grant_revision: SafeU53::new(1).unwrap(), deny_epoch: SafeU53::new(0).unwrap(),
        state: AwarenessGrantStateV1::Active,
        choices: AwarenessChoicesV1 { observe: true, retain: false, promote: false, provider_egress_binding: Some(binding.clone()) },
    };
    runtime.put_grant(&live, &grant, None, &operation("grant-chat-source")).unwrap();
    let key = AwarenessGrantKeyV1 { source, resident_pubkey: resident.clone() };
    let payload = b"DISPOSABLE_CONVERSATION_SENTINEL".to_vec();
    let now = CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap();
    let reference = AwarenessObservationRefV1 {
        protocol: AWARENESS_PROTOCOL.into(), observation_id: operation("chat-observation"),
        owner_pubkey: owner.clone(), resident_pubkey: resident.clone(),
        source_id: key.source.source_id.clone(), device_id: key.source.device_id.clone(),
        grant_id: grant.grant_id.clone(), grant_revision: grant.grant_revision, deny_epoch: grant.deny_epoch,
        sequence: SafeU53::new(1).unwrap(),
        evidence_ref: Sha256Ref::parse(format!("sha256:{}", hex::encode(Sha256::digest(&payload)))).unwrap(),
        captured_at: CanonicalTimestamp::parse("2026-10-08T10:00:01Z").unwrap(),
        expires_at: CanonicalTimestamp::parse("2026-10-08T10:05:00Z").unwrap(),
    };
    let facts = AwarenessHostFactsV1 { owner_pubkey: &owner, resident_pubkey: &resident, now: &now,
        source_fresh: true, material_state: AwarenessMaterialStateV1::Available };
    let resolve = |_: &AwarenessObservationRefV1, _: bool| AwarenessMaterialFactsV1 {
        source_fresh: true, material_state: AwarenessMaterialStateV1::Available,
    };
    runtime.admit(&live, &facts, reference.clone(), payload.clone()).unwrap();
    let deliver = || {
        let lease = live.lease().unwrap();
        runtime.with_native_history_payloads_lease(&lease, &facts, &[reference.clone()], &binding,
            resolve, &operation("chat-context"), |bytes| bytes[0].to_vec())
    };
    // Observe + model-sharing alone cannot cross a persistent native sink.
    assert!(deliver().is_err());
    runtime.set_native_history_choice(&owner, &key, Some(&live), SafeU53::new(0).unwrap(), true,
        Some(&binding), &now, &operation("allow-chat-history")).unwrap();
    assert_eq!(deliver().unwrap(), payload);
    assert!(!runtime.snapshot(&owner, &key).unwrap().grant.choices.retain);
    let reply = || {
        let lease = live.lease().unwrap();
        runtime.admit_native_history_reply(&lease, &facts, &binding,
            &[operation("chat-context")], &[reference.clone()], resolve)
    };
    assert!(reply().is_ok());
    // The sink rechecks consent after preparation, immediately before delivery.
    runtime.set_native_history_choice(&owner, &key, None, SafeU53::new(1).unwrap(), false,
        None, &now, &operation("disable-chat-history")).unwrap();
    assert!(deliver().is_err());
    assert!(reply().is_err());
    // A new explicit confirmation still cannot resurrect expired source bytes.
    runtime.set_native_history_choice(&owner, &key, Some(&live), SafeU53::new(2).unwrap(), true,
        Some(&binding), &now, &operation("reconfirm-chat-history")).unwrap();
    let expired = CanonicalTimestamp::parse("2026-10-08T10:05:01Z").unwrap();
    let lease = live.lease().unwrap();
    assert!(runtime.with_native_history_payloads_lease(&lease, &AwarenessHostFactsV1 { now: &expired, ..facts },
        &[reference], &binding, resolve, &operation("expired-chat-context"), |_| ()).is_err());
}

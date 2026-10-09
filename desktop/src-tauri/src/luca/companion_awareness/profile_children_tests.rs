//! SQLite metadata sentinel only; no payload/native profile/model is read.
use super::*;
fn id(s:&str)->OpaqueId {OpaqueId::parse(s).unwrap()}
fn number(n:u64)->SafeU53 {SafeU53::new(n).unwrap()}
fn sha(byte:&str)->Sha256Ref {Sha256Ref::parse(format!("sha256:{}",byte.repeat(32))).unwrap()}
#[test]
fn atomic_full_reference_child_binding_replays_and_survives_restart_without_uuid() {
    let dir=tempfile::tempdir_in("/tmp").unwrap();let root=dir.path().canonicalize().unwrap();
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700)).unwrap();}
    let path=root.join(AWARENESS_STORE_FILENAME);let mut store=AwarenessStore::open(&path).unwrap();
    let owner=Hex64::parse("11".repeat(32)).unwrap();let resident=Hex64::parse("22".repeat(32)).unwrap();
    let source=AwarenessSourceKeyV1 {owner_pubkey:owner.clone(),source_id:id("profile-source"),device_id:id("internal-device")};
    store.register_source(&source,&id("register")).unwrap();store.set_source_health(&source,number(1),AwarenessSourceStateV1::Current,&id("health")).unwrap();
    let grant=AwarenessGrantV1 {protocol:AWARENESS_PROTOCOL.into(),grant_id:id("grant"),owner_pubkey:owner.clone(),resident_pubkey:resident.clone(),source_id:source.source_id.clone(),device_id:source.device_id.clone(),grant_revision:number(1),deny_epoch:number(0),state:AwarenessGrantStateV1::Active,
        choices:AwarenessChoicesV1 {observe:true,retain:false,promote:true,provider_egress_binding:None}};
    store.put_grant(&grant,None,&id("grant-operation")).unwrap();let resumed=CanonicalTimestamp::parse("2026-10-08T10:00:00Z").unwrap();
    store.set_resident_paused(&owner,&resident,None,false,&resumed,&id("resume")).unwrap();
    let now=CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap();
    let reference=AwarenessObservationRefV1 {protocol:AWARENESS_PROTOCOL.into(),observation_id:id("profile-observation"),owner_pubkey:owner.clone(),resident_pubkey:resident.clone(),source_id:source.source_id,device_id:source.device_id,grant_id:grant.grant_id.clone(),grant_revision:number(1),deny_epoch:number(0),sequence:number(1),evidence_ref:sha("33"),captured_at:now.clone(),expires_at:CanonicalTimestamp::parse("2026-10-08T10:00:32Z").unwrap()};
    let facts=AwarenessHostFactsV1 {owner_pubkey:&owner,resident_pubkey:&resident,now:&now,source_fresh:true,material_state:AwarenessMaterialStateV1::Available};
    let child=AwarenessProfileChildV1 {child_ref:id("opaque-child"),exclusion_token:sha("44")};
    assert!(!store.admit_profile_observation(&reference,&facts,&child).unwrap());
    assert!(store.admit_profile_observation(&reference,&facts,&child).unwrap());
    assert!(store.admit_observation(&reference,&facts).is_err());
    let mut wrong=child.clone();wrong.exclusion_token=sha("55");assert!(store.admit_profile_observation(&reference,&facts,&wrong).is_err());
    drop(store);let mut reopened=AwarenessStore::open(&path).unwrap();
    assert_eq!(reopened.profile_child(&reference).unwrap(),Some(child.clone()));
    assert_eq!(reopened.profile_children(&owner,&resident).unwrap(),vec![AwarenessProfileChildBindingV1 {reference:reference.clone(),child}]);
    let mut changed=reference.clone();changed.evidence_ref=sha("66");assert!(reopened.profile_child(&changed).is_err());
    let key=AwarenessGrantKeyV1 {source:AwarenessSourceKeyV1 {owner_pubkey:owner.clone(),source_id:reference.source_id.clone(),device_id:reference.device_id.clone()},resident_pubkey:resident.clone()};
    reopened.withdraw_grant(&key,number(1),AwarenessWithdrawalV1::Withdraw,&id("revoke")).unwrap();
    assert!(reopened.admit_profile_observation(&reference,&facts,&wrong).is_err());
    drop(reopened);let bytes=std::fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    assert!(!String::from_utf8_lossy(&bytes).contains("NATIVE_BODY_SENTINEL"));
}

#[test]
fn only_recognized_private_v1_authority_gets_additive_empty_child_table() {
    let dir=tempfile::tempdir_in("/tmp").unwrap();let root=dir.path().canonicalize().unwrap();
    #[cfg(unix)] {use std::os::unix::fs::PermissionsExt;std::fs::set_permissions(&root,std::fs::Permissions::from_mode(0o700)).unwrap();}
    let path=root.join(AWARENESS_STORE_FILENAME);let mut store=AwarenessStore::open(&path).unwrap();
    let source=AwarenessSourceKeyV1 {owner_pubkey:Hex64::parse("11".repeat(32)).unwrap(),source_id:id("existing-source"),device_id:id("internal-device")};
    store.register_source(&source,&id("existing-register")).unwrap();
    store.connection.execute_batch("DROP TABLE awareness_profile_children; PRAGMA user_version=1;").unwrap();
    drop(store);let reopened=AwarenessStore::open(&path).unwrap();
    assert_eq!(reopened.source_snapshot(&source).unwrap().1,number(1));
    assert!(reopened.profile_children(&source.owner_pubkey,&Hex64::parse("22".repeat(32)).unwrap()).unwrap().is_empty());
    assert_eq!(reopened.connection.pragma_query_value(None,"user_version",|row|row.get::<_,i64>(0)).unwrap(),2);
}

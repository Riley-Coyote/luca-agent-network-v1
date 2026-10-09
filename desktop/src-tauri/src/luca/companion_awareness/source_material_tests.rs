//! Pure full-reference/current exclusion checks; no actor or source I/O.
use super::*;
use crate::luca::companion_awareness::{AwarenessProfileChildBindingV1,AwarenessProfileChildV1};
use luca_protocol::{SafeU53,Sha256Ref,AWARENESS_PROTOCOL};
fn id(s:&str)->OpaqueId {OpaqueId::parse(s).unwrap()}
fn sha(byte:&str)->Sha256Ref {Sha256Ref::parse(format!("sha256:{}",byte.repeat(32))).unwrap()}
fn reference()->AwarenessObservationRefV1 {AwarenessObservationRefV1 {
    protocol:AWARENESS_PROTOCOL.into(),observation_id:id("exact-observation"),owner_pubkey:Hex64::parse("11".repeat(32)).unwrap(),resident_pubkey:Hex64::parse("22".repeat(32)).unwrap(),source_id:id("exact-source"),device_id:id("internal-device"),grant_id:id("grant"),grant_revision:SafeU53::new(1).unwrap(),deny_epoch:SafeU53::new(0).unwrap(),sequence:SafeU53::new(1).unwrap(),evidence_ref:sha("33"),captured_at:CanonicalTimestamp::parse("2026-10-08T10:00:02Z").unwrap(),expires_at:CanonicalTimestamp::parse("2026-10-08T10:00:32Z").unwrap()}}
fn snapshot(reference:&AwarenessObservationRefV1,scope:SourceMaterialScopeV1)->SourceMaterialSnapshotV1 {SourceMaterialSnapshotV1 {
    now:reference.captured_at.clone(),known_exact:Vec::new(),collecting:vec![observation_key(reference)],records:vec![MaterialRecord {
        binding:SourceMaterialBindingV1 {reference:reference.clone(),scope},raw_current:true,state:AwarenessMaterialStateV1::Available}]}}
#[test]
fn new_exclusion_or_unknown_facts_override_old_raw_current_snapshot() {
    let reference=reference();let mut facts=RetainedSourceFactsV1 {raw:snapshot(&reference,SourceMaterialScopeV1::Exact(SelectedSourceClassV1::CodexSessionMetadata)),
        exact:vec![RetainedExact {key:observation_key(&reference),facts:AwarenessMaterialFactsV1 {source_fresh:false,material_state:AwarenessMaterialStateV1::Excluded}}],profiles:Vec::new(),deadline:Instant::now()+Duration::from_secs(1),#[cfg(unix)] browser:None};
    assert_eq!(facts.resolve(&reference,false).material_state,AwarenessMaterialStateV1::Excluded);
    facts.exact[0].facts=unavailable();assert_eq!(facts.resolve(&reference,false).material_state,AwarenessMaterialStateV1::Unavailable);
    facts.exact[0].facts=AwarenessMaterialFactsV1 {source_fresh:false,material_state:AwarenessMaterialStateV1::Available};
    assert!(facts.resolve(&reference,false).source_fresh);
    facts.deadline=Instant::now();assert_eq!(facts.resolve(&reference,false).material_state,AwarenessMaterialStateV1::Unavailable);
}
#[test]
fn retained_profile_is_full_reference_bound_without_raw_liveness_after_restart() {
    let reference=reference();let child=AwarenessProfileChildV1 {child_ref:id("opaque-child"),exclusion_token:sha("44")};
    let raw=SourceMaterialSnapshotV1 {now:reference.expires_at.clone(),known_exact:Vec::new(),collecting:Vec::new(),records:Vec::new()};
    let mut facts=RetainedSourceFactsV1 {raw,exact:Vec::new(),profiles:vec![RetainedProfile {
        binding:AwarenessProfileChildBindingV1 {reference:reference.clone(),child},facts:AwarenessMaterialFactsV1 {source_fresh:false,material_state:AwarenessMaterialStateV1::Available}}],deadline:Instant::now()+Duration::from_secs(1),#[cfg(unix)] browser:None};
    assert_eq!(facts.resolve(&reference,true).material_state,AwarenessMaterialStateV1::Available);
    assert_eq!(facts.resolve(&reference,false).material_state,AwarenessMaterialStateV1::Unavailable);
    let mut changed=reference.clone();changed.evidence_ref=sha("55");assert_eq!(facts.resolve(&changed,true).material_state,AwarenessMaterialStateV1::Unavailable);
    facts.profiles[0].facts.material_state=AwarenessMaterialStateV1::Excluded;assert_eq!(facts.resolve(&reference,true).material_state,AwarenessMaterialStateV1::Excluded);
}

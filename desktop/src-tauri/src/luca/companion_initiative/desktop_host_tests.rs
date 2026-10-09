//! Pure source-clean seed/provenance tests. No keys, profiles, source reads,
//! native model, artifact bytes or installed app are used.
use super::*;
use luca_protocol::{INITIATIVE_SEMANTIC_THREAD_PROTOCOL, InitiativeSemanticThreadV1, InitiativeThreadKindV1};

fn id(value:&str)->OpaqueId {OpaqueId::parse(value).unwrap()}
fn hash(value:&str)->Sha256Ref {Sha256Ref::parse(format!("sha256:{}",value.repeat(64))).unwrap()}
fn fixture()->(InitiativeRuntimeScopeV1,RevisionAuthorityTokenV1,InitiativeThreadRevisionViewV1) {
    let owner=Hex64::parse("a".repeat(64)).unwrap();let resident=Hex64::parse("b".repeat(64)).unwrap();
    let body="Finish the older unresolved working slice";
    let digest=canonical_sha256(&serde_json::json!({"domain":"polyphonic.carried-handoff-thread.v1","owner":owner,"resident":resident,"body":body})).unwrap();
    let thread=InitiativeSemanticThreadV1 {protocol:INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),thread_id:id(&format!("carried-{digest}")),owner_pubkey:owner.clone(),resident_pubkey:resident.clone(),
        kind:InitiativeThreadKindV1::Shared,disposition:InitiativeDispositionV1::Carried,revision:SafeU53::new(0).unwrap(),body:body.into(),source_event_ids:vec![Hex64::parse("c".repeat(64)).unwrap()],source_refs:vec![hash("c")],eligible_after:None,
        created_at:CanonicalTimestamp::parse("2026-10-01T09:00:00Z").unwrap(),updated_at:CanonicalTimestamp::parse("2026-10-01T09:00:00Z").unwrap()};
    let view=InitiativeThreadRevisionViewV1 {record_id:id("canonical-thread-head"),current_head_record_id:Some(id("canonical-thread-head")),is_current:true,pinned_owner_correction:false,canonical_source_clean:true,canonical_own_authorship:false,author_kind:id("resident"),canonical_revision_ref:thread.revision_ref().unwrap(),thread};
    let token=RevisionAuthorityTokenV1 {owner_pubkey:owner.clone(),store_epoch:"owned-store-epoch".into(),generation:SafeU53::new(10).unwrap(),authority_schema:1,active_root_key_version:SafeU53::new(1).unwrap(),snapshot_fingerprint:hash("d")};
    let scope=InitiativeRuntimeScopeV1 {control:InitiativeControlScopeV1 {owner_pubkey:owner,resident_pubkey:resident,window_id:id("companion-home"),origin_scope_ref:hash("e"),now_unix_ms:1_000_000},binding_ref:hash("f"),session_epoch:SafeU53::new(1).unwrap(),foreground_active:false,outreach_authorized:false};
    (scope,token,view)
}
#[test]
fn older_authenticated_carried_seed_does_not_require_latest_chat_or_handoff() {
    let (scope,token,view)=fixture();
    let proof=canonical_seed(&scope,&token,&view).unwrap();
    let dependency=dependency_ref(&proof,&[],None).unwrap();
    let mut advanced=token.clone();advanced.generation=SafeU53::new(11).unwrap();
    let next=canonical_seed(&scope,&advanced,&view).unwrap();
    assert_ne!(dependency,dependency_ref(&next,&[],None).unwrap());
    assert!(view.thread.updated_at.as_str().starts_with("2026-10-01"));
}
#[test]
fn own_unmarked_richer_foreign_or_wrong_body_seeds_fail_unavailable() {
    let (scope,token,mut view)=fixture();
    view.canonical_source_clean=false;assert!(canonical_seed(&scope,&token,&view).is_err());
    view.canonical_source_clean=true;view.thread.kind=InitiativeThreadKindV1::Own;assert!(canonical_seed(&scope,&token,&view).is_err());
    view.thread.kind=InitiativeThreadKindV1::Shared;view.thread.source_refs.push(hash("f"));assert!(canonical_seed(&scope,&token,&view).is_err());
    view.thread.source_refs.pop();view.thread.body="A different body's claim".into();view.canonical_revision_ref=view.thread.revision_ref().unwrap();assert!(canonical_seed(&scope,&token,&view).is_err());
    let (_,_,view)=fixture();let mut foreign=scope;foreign.control.resident_pubkey=Hex64::parse("9".repeat(64)).unwrap();assert!(canonical_seed(&foreign,&token,&view).is_err());
}
#[test]
fn current_head_and_authority_are_not_model_or_context_claims() {
    let (scope,token,mut view)=fixture();
    view.current_head_record_id=Some(id("newer-owner-head"));assert!(canonical_seed(&scope,&token,&view).is_err());
    view.current_head_record_id=Some(view.record_id.clone());view.author_kind=id("owner");assert!(canonical_seed(&scope,&token,&view).is_err());
    view.author_kind=id("resident");view.canonical_revision_ref=hash("e");assert!(canonical_seed(&scope,&token,&view).is_err());
}
#[test]
fn evidence_must_be_actual_admitted_text_not_a_claimed_plan() {
    let payload=serde_json::to_vec(&serde_json::json!({"text":"UNTRUSTED source evidence", "work_status":"unknown"})).unwrap();
    assert!(evidence_matches(&payload,"UNTRUSTED source"));
    assert!(!evidence_matches(&payload,"I ran a new research task"));
    assert!(!evidence_matches(&payload,""));
}

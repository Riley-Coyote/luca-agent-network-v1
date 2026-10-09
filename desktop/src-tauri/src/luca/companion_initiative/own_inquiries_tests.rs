//! Pure/sentinel native-authorship boundaries; no native model or personal data.
use super::*;
use crate::luca::companion_initiative::{executor::verified_work_fixture, InitiativeControlScopeV1};
use luca_protocol::{CanonicalTimestamp, InitiativePursuitRequestV1, InitiativePursuitResultV1,
    InitiativeThreadV1, derive_initiative_thread_ref, INITIATIVE_PROTOCOL, INITIATIVE_PURSUIT_PROTOCOL};

fn hex(c: char) -> Hex64 { Hex64::parse(c.to_string().repeat(64)).unwrap() }
fn id(value: &str) -> OpaqueId { OpaqueId::parse(value).unwrap() }
fn hash(c: char) -> Sha256Ref { Sha256Ref::parse(format!("sha256:{}",c.to_string().repeat(64))).unwrap() }
fn number(value:u64) -> SafeU53 { SafeU53::new(value).unwrap() }
fn time(value:&str) -> CanonicalTimestamp { CanonicalTimestamp::parse(value).unwrap() }

pub(crate) fn fixture() -> (InitiativeRuntimeScopeV1, RevisionAuthorityTokenV1, InitiativeThreadRevisionViewV1, VerifiedInitiativePursuitV1) {
    let body = "A carried source-clean question, older than recent chat";
    let digest = canonical_sha256(&serde_json::json!({"domain":"polyphonic.carried-handoff-thread.v1","owner":hex('a'),"resident":hex('b'),"body":body})).unwrap();
    let semantic = InitiativeSemanticThreadV1 { protocol:INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),thread_id:id(&format!("carried-{digest}")),owner_pubkey:hex('a'),resident_pubkey:hex('b'),
        kind:InitiativeThreadKindV1::Shared,disposition:InitiativeDispositionV1::Carried,revision:number(0),body:body.into(),source_event_ids:vec![hex('c')],source_refs:vec![hash('c')],eligible_after:None,
        created_at:time("2026-01-01T12:00:00Z"),updated_at:time("2026-01-01T12:00:00Z") };
    let thread = InitiativeThreadV1 { protocol:INITIATIVE_PROTOCOL.into(),thread_id:semantic.thread_id.clone(),owner_pubkey:hex('a'),resident_pubkey:hex('b'),kind:semantic.kind,disposition:semantic.disposition,revision:number(2),
        canonical_thread_ref:derive_initiative_thread_ref(&hex('a'),&hex('b'),&semantic.thread_id).unwrap(),canonical_revision_ref:semantic.revision_ref().unwrap(),source_refs:semantic.source_refs.clone(),checkpoint_ref:None,eligible_after:None,updated_at:time("2026-10-08T12:00:00Z") };
    let request = InitiativePursuitRequestV1 { protocol:INITIATIVE_PURSUIT_PROTOCOL.into(),job_id:id("job:actual-native-authorship-fixture"),owner_pubkey:hex('a'),resident_pubkey:hex('b'),binding_ref:hash('d'),session_epoch:number(3),
        thread,semantic_thread:semantic.clone(),evidence:Vec::new(),admitted_at:time("2026-10-08T12:00:00Z"),deadline_unix_ms:number(1791460980000),max_result_bytes:number(24*1024) };
    let result = InitiativePursuitResultV1 { protocol:INITIATIVE_PURSUIT_PROTOCOL.into(),job_id:request.job_id.clone(),owner_pubkey:hex('a'),resident_pubkey:hex('b'),thread_id:request.thread.thread_id.clone(),expected_revision:request.thread.revision,
        canonical_revision_ref:request.thread.canonical_revision_ref.clone(),binding_ref:request.binding_ref.clone(),session_epoch:request.session_epoch,context_ref:request.context_ref().unwrap(),
        result:InitiativePursuitOutcomeV1::OwnInquiry {body:"PRIVATE_OWN_SENTINEL: I want to examine a related distinction over time.".into(),source_refs:vec![request.thread.canonical_revision_ref.clone()] } };
    let token = RevisionAuthorityTokenV1 {owner_pubkey:hex('a'),store_epoch:"owned-fixture".into(),generation:number(2),authority_schema:1,active_root_key_version:number(1),snapshot_fingerprint:hash('e')};
    let parent = InitiativeThreadRevisionViewV1 {record_id:semantic.thread_id.clone(),current_head_record_id:Some(semantic.thread_id.clone()),is_current:true,pinned_owner_correction:false,author_kind:id("resident"),canonical_source_clean:true,canonical_own_authorship:false,
        canonical_revision_ref:semantic.revision_ref().unwrap(),thread:semantic };
    let scope = InitiativeRuntimeScopeV1 {control:InitiativeControlScopeV1 {owner_pubkey:hex('a'),resident_pubkey:hex('b'),window_id:id("home:fixture"),origin_scope_ref:hash('f'),now_unix_ms:1791460801000},binding_ref:hash('d'),session_epoch:number(3),foreground_active:false,outreach_authorized:false};
    let work = verified_work_fixture(request,result,scope.control.now_unix_ms);
    (scope,token,parent,work)
}

#[test]
fn sealed_native_own_birth_has_stable_private_lineage_exact_provenance_and_no_owner_commitment() {
    let (scope,token,parent,work) = fixture();
    let first = native_own_request(&scope,&token,&parent,&work).unwrap();
    let repeat = native_own_request(&scope,&token,&parent,&work).unwrap();
    assert_eq!(first.actor,RevisionActor::Resident);
    assert_eq!(first.thread.kind,InitiativeThreadKindV1::Own);
    assert_eq!(first.thread.thread_id,repeat.thread.thread_id);
    assert!(first.thread == repeat.thread);
    assert!(first.thread.source_event_ids.is_empty());
    assert_eq!(first.thread.source_refs.len(),2);
    assert!(first.thread.source_refs.contains(&work.result_ref().unwrap()));
    assert!(first.thread.source_refs.contains(&parent.canonical_revision_ref));
    assert!(!first.canonical_source_clean && first.completion_cause.is_none());
    let proof = first.own_authorship_proof.as_ref().unwrap();
    assert!(proof.matches_thread(&first.thread) && proof.matches_parent(&token,&parent));
    let mut changed = first.thread.clone(); changed.body.push_str(" different inquiry");
    assert!(!proof.matches_thread(&changed));
    let mut stale = token.clone(); stale.generation=number(3);
    assert!(!proof.matches_parent(&stale,&parent));
}

#[test]
fn native_own_authorship_needs_current_clean_parent_principal_binding_epoch_and_original_deadline() {
    let (scope,token,mut parent,work) = fixture();
    parent.canonical_source_clean=false;
    assert!(native_own_request(&scope,&token,&parent,&work).is_err());
    parent.canonical_source_clean=true; parent.pinned_owner_correction=true;
    assert!(native_own_request(&scope,&token,&parent,&work).is_err());
    parent.pinned_owner_correction=false; parent.is_current=false;
    assert!(native_own_request(&scope,&token,&parent,&work).is_err());
    parent.is_current=true;
    let mut wrong=scope.clone();wrong.control.resident_pubkey=hex('9');
    assert!(native_own_request(&wrong,&token,&parent,&work).is_err());
    wrong=scope.clone();wrong.binding_ref=hash('9');
    assert!(native_own_request(&wrong,&token,&parent,&work).is_err());
    wrong=scope.clone();wrong.session_epoch=number(4);
    assert!(native_own_request(&wrong,&token,&parent,&work).is_err());
    wrong=scope;wrong.control.now_unix_ms=work.request().deadline_unix_ms.get();
    assert!(native_own_request(&wrong,&token,&parent,&work).is_err());
}

#[test]
fn authenticated_older_own_head_is_independent_but_unmarked_body_edit_is_unavailable() {
    let (scope,token,parent,work)=fixture();
    let born=native_own_request(&scope,&token,&parent,&work).unwrap();
    let own=born.thread;
    let mut view=InitiativeThreadRevisionViewV1 {record_id:own.thread_id.clone(),current_head_record_id:Some(own.thread_id.clone()),is_current:true,pinned_owner_correction:false,author_kind:id("resident"),canonical_source_clean:false,canonical_own_authorship:true,
        canonical_revision_ref:own.revision_ref().unwrap(),thread:own};
    assert!(authenticated_native_parent(&view).unwrap());
    view.thread.revision=number(1);view.thread.disposition=InitiativeDispositionV1::Deferred;
    view.thread.updated_at=time("2026-10-09T12:00:00Z");view.thread.eligible_after=Some(time("2026-10-10T12:00:00Z"));
    view.canonical_revision_ref=view.thread.revision_ref().unwrap();
    assert!(authenticated_native_parent(&view).unwrap());
    view.canonical_own_authorship=false;
    assert!(!authenticated_native_parent(&view).unwrap());
}

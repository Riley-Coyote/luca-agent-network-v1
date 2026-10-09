use super::*;

fn result(request:&InitiativePursuitRequestV1, outcome:InitiativePursuitOutcomeV1)->InitiativePursuitResultV1 {
    InitiativePursuitResultV1 {protocol:luca_protocol::INITIATIVE_PURSUIT_PROTOCOL.into(),job_id:request.job_id.clone(),owner_pubkey:request.owner_pubkey.clone(),resident_pubkey:request.resident_pubkey.clone(),thread_id:request.thread.thread_id.clone(),expected_revision:request.thread.revision,
        canonical_revision_ref:request.thread.canonical_revision_ref.clone(),binding_ref:request.binding_ref.clone(),session_epoch:request.session_epoch,context_ref:request.context_ref().unwrap(),result:outcome}
}

#[test]
fn private_own_result_binds_once_to_exact_canonical_receipt_without_artifact_or_body_storage() {
    let (_temp,mut store,scope,request)=crate::luca::companion_initiative::executor::tests::ready_store_fixture();
    store.claim_private_pursuit(&scope,&request).unwrap();store.mark_private_framed(&scope,&request).unwrap();
    let result=result(&request,InitiativePursuitOutcomeV1::OwnInquiry {body:"PRIVATE_OWN_SENTINEL: revisit this distinction independently.".into(),source_refs:vec![request.thread.canonical_revision_ref.clone()]});
    let own=crate::luca::companion_initiative::own_inquiries::own_thread_from_result(&request,&result).unwrap();
    let receipt=InitiativeThreadCommitReceiptV1 {resident_pubkey:own.resident_pubkey.clone(),thread_id:own.thread_id.clone(),record_id:own.thread_id.clone(),revision:own.revision,
        canonical_thread_ref:luca_protocol::derive_initiative_thread_ref(&own.owner_pubkey,&own.resident_pubkey,&own.thread_id).unwrap(),canonical_revision_ref:own.revision_ref().unwrap(),replayed:false};
    assert!(store.commit_private_pursuit(&scope,&request,&result,None).is_err());
    let mut wrong=receipt.clone();wrong.canonical_revision_ref=request.thread.canonical_revision_ref.clone();
    assert!(store.commit_private_own_inquiry(&scope,&request,&result,&wrong).is_err());
    let job=store.commit_private_own_inquiry(&scope,&request,&result,&receipt).unwrap();
    assert_eq!(job.state,InitiativeJobStateV1::Succeeded);
    let metadata=job.private_pursuit.as_ref().unwrap();
    assert_eq!(metadata.own_thread_id,Some(receipt.thread_id));
    assert_eq!(metadata.own_revision_ref,Some(receipt.canonical_revision_ref));
    assert!(metadata.creation_node.is_none() && metadata.artifact_ref.is_none() && job.return_key.is_none());
    assert!(!serde_json::to_string(&job).unwrap().contains("PRIVATE_OWN_SENTINEL"));
    assert!(store.commit_private_own_inquiry(&scope,&request,&result,&wrong).is_err());
}

#[test]
fn exact_native_own_retire_stays_closed_and_is_not_an_artifact_completion() {
    let (_temp,mut store,scope,request)=crate::luca::companion_initiative::executor::tests::ready_store_fixture();
    store.claim_private_pursuit(&scope,&request).unwrap();store.mark_private_framed(&scope,&request).unwrap();
    let result=result(&request,InitiativePursuitOutcomeV1::Retire);
    let job=store.commit_private_pursuit(&scope,&request,&result,None).unwrap();
    assert_eq!(job.state,InitiativeJobStateV1::Retired);
    let thread=store.thread(&scope.control,&request.thread.thread_id).unwrap().unwrap();
    assert_eq!(thread.disposition,InitiativeDispositionV1::Retired);
    assert!(!thread.eligible_at(&thread_context(&scope.control,thread.revision).unwrap()).unwrap());
    assert!(job.private_pursuit.as_ref().unwrap().artifact_ref.is_none());
}

#[test]
fn private_unknown_admission_has_no_d0_identity_survives_restart_and_is_not_refunded() {
    let (temp, mut store, scope, request) =
        crate::luca::companion_initiative::executor::tests::ready_store_fixture();
    let claimed = store
        .claim_private_pursuit(&scope, &request)
        .expect("private intent before framing");
    assert_eq!(claimed.state, InitiativeJobStateV1::Dispatching);
    assert!(claimed.native_task_id.is_none());
    assert!(claimed
        .private_pursuit
        .as_ref()
        .expect("private metadata")
        .completed_unix_ms
        .is_none());
    store
        .interrupt_private_cycle(&scope.control, &request.job_id)
        .expect("unknown private admission");
    drop(store);
    let path = std::fs::canonicalize(temp.path())
        .expect("private path")
        .join(crate::luca::companion_initiative::schema::INITIATIVE_STORE_FILENAME);
    let mut store = InitiativeStore::open(&path).expect("restart no model");
    assert!(store
        .recover(&scope.control)
        .expect("metadata-only recovery")
        .is_empty());
    let job = store
        .job(&scope.control, &request.job_id)
        .expect("job")
        .expect("retained job");
    assert_eq!(job.state, InitiativeJobStateV1::Interrupted);
    assert_eq!(job.model_stages_reserved, claimed.model_stages_reserved);
    assert!(job.native_task_id.is_none());
    assert!(store.claim_private_pursuit(&scope, &request).is_err());
}

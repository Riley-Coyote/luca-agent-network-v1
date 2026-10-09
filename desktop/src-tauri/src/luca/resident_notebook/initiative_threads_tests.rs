use super::*;
use crate::luca::continuity_store::{ContinuityStoreCustody, ContinuityStoreOpen};
use luca_protocol::{CanonicalTimestamp, INITIATIVE_SEMANTIC_THREAD_PROTOCOL};
use tempfile::TempDir;

pub(super) const KEY: [u8; 32] = [7; 32];

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixture ID")
}
fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("fixture principal")
}
fn reference(value: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", value.to_string().repeat(64))).expect("fixture ref")
}
fn time(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture timestamp")
}
pub(super) fn open(temp: &TempDir) -> ContinuityStore {
    match ContinuityStore::open(temp.path(), ContinuityStoreCustody::Ready)
        .expect("synthetic store")
    {
        ContinuityStoreOpen::Ready(store) => store,
        ContinuityStoreOpen::Degraded(_) => panic!("synthetic store should be ready"),
    }
}
pub(super) fn address() -> luca_continuity::NamespaceScope {
    resident_notebook_address(&hex('a'), &hex('b'), SafeU53::new(1).expect("key version"))
        .expect("exact notebook namespace")
}
pub(super) fn thread(name: &str) -> InitiativeSemanticThreadV1 {
    InitiativeSemanticThreadV1 {
        protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),
        thread_id: id(name),
        owner_pubkey: hex('a'),
        resident_pubkey: hex('b'),
        kind: InitiativeThreadKindV1::Shared,
        disposition: InitiativeDispositionV1::Carried,
        revision: SafeU53::new(0).expect("initial revision"),
        body: format!("Older source-backed material for {name} stays carried."),
        source_event_ids: vec![hex('c')],
        source_refs: vec![reference('c'), reference('d')],
        eligible_after: None,
        created_at: time("2026-01-01T10:00:00Z"),
        updated_at: time("2026-01-01T10:00:00Z"),
    }
}
pub(super) fn request(
    thread: InitiativeSemanticThreadV1,
    request_id: &str,
    actor: RevisionActor,
    expected: Option<&InitiativeThreadCommitReceiptV1>,
) -> InitiativeThreadCommitRequestV1 {
    InitiativeThreadCommitRequestV1 {
        owner_pubkey: hex('a'),
        resident_pubkey: hex('b'),
        request_id: id(request_id),
        actor,
        canonical_source_clean: false,
        own_authorship_proof: None,
        completion_cause: None,
        expected_head: expected.map(|r| InitiativeThreadHeadV1 {
            record_id: r.record_id.clone(),
            revision: r.revision,
        }),
        thread,
    }
}
pub(super) fn successor(
    mut current: InitiativeSemanticThreadV1,
    disposition: InitiativeDispositionV1,
) -> InitiativeSemanticThreadV1 {
    current.revision = SafeU53::new(current.revision.get() + 1).expect("successor revision");
    current.disposition = disposition;
    current.updated_at = time("2026-10-08T10:00:00Z");
    current
}

#[test]
fn native_own_birth_restarts_idempotently_and_keeps_older_inquiry_without_latest_handoff() {
    use crate::luca::companion_initiative::own_inquiries::{native_own_request, tests::fixture};
    let temp=tempfile::tempdir().unwrap();let mut store=open(&temp);let address=address();
    let (scope,_,parent,work)=fixture();
    let mut carry=request(parent.thread.clone(),"trusted-shared-parent",RevisionActor::Resident,None);
    carry.canonical_source_clean=true;
    commit_in_store(&mut store,&address,&KEY,carry).unwrap();
    let snapshot=read_in_store(&store,&address,&KEY,false).unwrap().unwrap();
    let parent=snapshot.threads.iter().find(|view|view.thread.thread_id==work.request().thread.thread_id).unwrap();
    let born=native_own_request(&scope,&snapshot.authority,parent,&work).unwrap();
    let own=born.thread.clone();
    let first=commit_in_store(&mut store,&address,&KEY,born).unwrap();
    let snapshot=read_in_store(&store,&address,&KEY,false).unwrap().unwrap();
    let parent=snapshot.threads.iter().find(|view|view.thread.thread_id==work.request().thread.thread_id).unwrap();
    let replay=native_own_request(&scope,&snapshot.authority,parent,&work).unwrap();
    let generation=store.load_revision_generation(&hex('a')).unwrap();
    assert!(commit_in_store(&mut store,&address,&KEY,replay).unwrap().replayed);
    assert_eq!(store.load_revision_generation(&hex('a')).unwrap(),generation);
    commit_in_store(&mut store,&address,&KEY,request(thread("newer:unrelated-shared"),"newer",RevisionActor::Resident,None)).unwrap();
    let mut deferred=successor(own.clone(),InitiativeDispositionV1::Deferred);
    deferred.updated_at=time("2026-10-08T12:01:00Z");deferred.eligible_after=Some(time("2026-10-09T12:00:00Z"));
    let deferred_receipt=commit_in_store(&mut store,&address,&KEY,request(deferred.clone(),"own-defer",RevisionActor::Resident,Some(&first))).unwrap();
    drop(store);
    let mut restarted=open(&temp);
    let snapshot=read_in_store(&restarted,&address,&KEY,false).unwrap().unwrap();
    let current=snapshot.threads.iter().find(|view|view.thread.thread_id==own.thread_id).unwrap();
    assert!(current.canonical_own_authorship && !current.canonical_source_clean && current.is_current);
    assert_eq!(current.author_kind.as_str(),"resident");
    assert_eq!(current.thread.kind,InitiativeThreadKindV1::Own);
    assert!(current.thread==deferred);
    let mut retired=successor(deferred,InitiativeDispositionV1::Retired);
    retired.updated_at=time("2026-10-08T12:02:00Z");retired.eligible_after=None;
    commit_in_store(&mut restarted,&address,&KEY,request(retired.clone(),"own-retire",RevisionActor::Resident,Some(&deferred_receipt))).unwrap();
    let snapshot=read_in_store(&restarted,&address,&KEY,false).unwrap().unwrap();
    let closed=snapshot.threads.iter().find(|view|view.thread.thread_id==own.thread_id).unwrap();
    assert!(closed.canonical_own_authorship && closed.thread==retired);
    assert_eq!(closed.thread.disposition,InitiativeDispositionV1::Retired);
}

#[test]
fn stale_or_owner_selected_native_own_birth_cannot_bypass_parent_retirement() {
    use crate::luca::companion_initiative::own_inquiries::{native_own_request, tests::fixture};
    let temp=tempfile::tempdir().unwrap();let mut store=open(&temp);let address=address();
    let (scope,_,parent,work)=fixture();
    let mut carry=request(parent.thread.clone(),"clean-parent",RevisionActor::Resident,None);carry.canonical_source_clean=true;
    let parent_receipt=commit_in_store(&mut store,&address,&KEY,carry).unwrap();
    let snapshot=read_in_store(&store,&address,&KEY,false).unwrap().unwrap();
    let parent=snapshot.threads.iter().find(|view|view.thread.thread_id==work.request().thread.thread_id).unwrap();
    let mut wrong=native_own_request(&scope,&snapshot.authority,parent,&work).unwrap();
    wrong.actor=RevisionActor::Owner;
    assert_eq!(commit_in_store(&mut store,&address,&KEY,wrong),Err(InitiativeThreadStoreErrorV1::Denied));
    let mut wrong=native_own_request(&scope,&snapshot.authority,parent,&work).unwrap();
    wrong.thread.body.push_str(" forged body");
    assert_eq!(commit_in_store(&mut store,&address,&KEY,wrong),Err(InitiativeThreadStoreErrorV1::Denied));
    let pending=native_own_request(&scope,&snapshot.authority,parent,&work).unwrap();
    let retired=successor(parent.thread.clone(),InitiativeDispositionV1::Retired);
    commit_in_store(&mut store,&address,&KEY,request(retired,"owner-let-go-parent",RevisionActor::Owner,Some(&parent_receipt))).unwrap();
    assert_eq!(commit_in_store(&mut store,&address,&KEY,pending),Err(InitiativeThreadStoreErrorV1::Stale));
    assert!(read_in_store(&store,&address,&KEY,false).unwrap().unwrap().threads.iter().all(|view|view.thread.kind==InitiativeThreadKindV1::Shared));
}

#[test]
fn authenticated_clean_birthmark_survives_newer_thread_and_disposition_only_revision() {
    let temp = tempfile::tempdir().expect("disposable fixture");
    let mut store = open(&temp);
    let address = address();
    let mut older = thread("carried:clean-older");
    older.source_refs = vec![reference('c')];
    let mut create = request(older.clone(), "clean-birth", RevisionActor::Resident, None);
    create.canonical_source_clean = true;
    let first = commit_in_store(&mut store, &address, &KEY, create).expect("verified clean create");
    commit_in_store(&mut store, &address, &KEY,
        request(thread("carried:newer-unmarked"), "newer", RevisionActor::Resident, None)).unwrap();
    let deferred = successor(older.clone(), InitiativeDispositionV1::Deferred);
    let mut deferred = deferred;
    deferred.eligible_after = Some(time("2026-10-09T10:00:00Z"));
    commit_in_store(&mut store, &address, &KEY,
        request(deferred, "resident-defer", RevisionActor::Resident, Some(&first))).unwrap();
    let snapshot = read_in_store(&store, &address, &KEY, false).unwrap().unwrap();
    let current = snapshot.threads.iter().find(|view|view.thread.thread_id==older.thread_id).unwrap();
    assert!(current.canonical_source_clean);
    assert_eq!(current.thread.disposition, InitiativeDispositionV1::Deferred);
    assert!(!snapshot.threads.iter().find(|view|view.thread.thread_id==id("carried:newer-unmarked")).unwrap().canonical_source_clean);
    let mut bad = request(thread("carried:unproven-extra-reference"), "bad-birth", RevisionActor::Resident, None);
    bad.canonical_source_clean = true;
    assert!(commit_in_store(&mut store,&address,&KEY,bad).is_err());
}

#[test]
fn restart_keeps_independent_old_thread_and_exact_retired_current_head() {
    let temp = tempfile::tempdir().expect("disposable internal fixture");
    let mut store = open(&temp);
    let address = address();
    let older = thread("carried:older");
    commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(older.clone(), "create-old", RevisionActor::Resident, None),
    )
    .expect("older commit");
    let newer = thread("carried:newer");
    let created = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(newer.clone(), "create-new", RevisionActor::Resident, None),
    )
    .expect("newer commit");
    let retired = successor(newer.clone(), InitiativeDispositionV1::Retired);
    let retired_receipt = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(
            retired.clone(),
            "owner-let-go",
            RevisionActor::Owner,
            Some(&created),
        ),
    )
    .expect("explicit owner retirement");
    drop(store);
    let restarted = open(&temp);
    let snapshot = read_in_store(&restarted, &address, &KEY, false)
        .expect("current heads")
        .expect("threads");
    assert_eq!(snapshot.threads.len(), 2);
    let old = snapshot
        .threads
        .iter()
        .find(|v| v.thread.thread_id == older.thread_id)
        .expect("older independent thread");
    assert!(old.thread == older && old.is_current);
    let closed = snapshot
        .threads
        .iter()
        .find(|v| v.thread.thread_id == newer.thread_id)
        .expect("retired current thread");
    assert!(closed.thread == retired && closed.is_current);
    assert_eq!(
        closed.current_head_record_id,
        Some(retired_receipt.record_id.clone())
    );
    assert!(closed.pinned_owner_correction);
    assert_eq!(closed.author_kind.as_str(), "owner");
    let history = read_in_store(&restarted, &address, &KEY, true)
        .expect("explicit history")
        .expect("threads");
    let historical = history
        .threads
        .iter()
        .find(|v| v.record_id == created.record_id)
        .expect("prior immutable head retained");
    assert!(!historical.is_current);
    assert_eq!(historical.thread.body, newer.body);
    assert_eq!(
        historical.current_head_record_id,
        Some(retired_receipt.record_id)
    );
    assert!(restarted
        .revalidate_immutable_capture(&snapshot.authority)
        .expect("unchanged authority"));
}

#[test]
fn create_and_current_edit_are_idempotent_without_reencrypting_or_regressing() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = open(&temp);
    let address = address();
    let original = thread("carried:idem");
    let first = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(original.clone(), "create", RevisionActor::Resident, None),
    )
    .expect("create");
    let generation = store
        .load_revision_generation(&hex('a'))
        .expect("generation");
    let replay = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(original.clone(), "create", RevisionActor::Resident, None),
    )
    .expect("create replay");
    assert!(replay.replayed);
    assert_eq!(
        store
            .load_revision_generation(&hex('a'))
            .expect("generation"),
        generation
    );
    let next = successor(original.clone(), InitiativeDispositionV1::Declined);
    let edited = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(
            next.clone(),
            "decline",
            RevisionActor::Resident,
            Some(&first),
        ),
    )
    .expect("decline");
    let generation = store
        .load_revision_generation(&hex('a'))
        .expect("generation");
    assert!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                next.clone(),
                "decline",
                RevisionActor::Resident,
                Some(&first)
            )
        )
        .expect("edit replay")
        .replayed
    );
    assert_eq!(
        store
            .load_revision_generation(&hex('a'))
            .expect("generation"),
        generation
    );
    let mut conflicting = next;
    conflicting.body = "Changed bytes under the same admitted request.".into();
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                conflicting,
                "decline",
                RevisionActor::Resident,
                Some(&first)
            )
        ),
        Err(InitiativeThreadStoreErrorV1::Invalid)
    );
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(original, "create", RevisionActor::Resident, None)
        ),
        Err(InitiativeThreadStoreErrorV1::Stale)
    );
    assert_eq!(edited.revision.get(), 1);
}

#[test]
fn owner_retirement_preempts_stale_resident_edit_and_wrong_principal() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = open(&temp);
    let address = address();
    let original = thread("carried:authority");
    let created = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(original.clone(), "create", RevisionActor::Resident, None),
    )
    .expect("create");
    let retired = successor(original.clone(), InitiativeDispositionV1::Retired);
    let retired_receipt = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(
            retired.clone(),
            "retire",
            RevisionActor::Owner,
            Some(&created),
        ),
    )
    .expect("owner retire");
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                successor(original, InitiativeDispositionV1::Carried),
                "stale-result",
                RevisionActor::Resident,
                Some(&created)
            )
        ),
        Err(InitiativeThreadStoreErrorV1::Stale)
    );
    let mut reopens = successor(retired, InitiativeDispositionV1::Carried);
    reopens.source_refs.push(reference('e'));
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                reopens.clone(),
                "resident-reopen",
                RevisionActor::Resident,
                Some(&retired_receipt)
            )
        ),
        Err(InitiativeThreadStoreErrorV1::Stale)
    );
    let mut wrong = request(
        reopens,
        "wrong-principal",
        RevisionActor::Owner,
        Some(&retired_receipt),
    );
    wrong.resident_pubkey = hex('f');
    assert_eq!(
        commit_in_store(&mut store, &address, &KEY, wrong),
        Err(InitiativeThreadStoreErrorV1::Denied)
    );
    let current = read_in_store(&store, &address, &KEY, false)
        .expect("read")
        .expect("thread");
    assert_eq!(
        current.threads[0].thread.disposition,
        InitiativeDispositionV1::Retired
    );
    assert_eq!(current.threads[0].record_id, retired_receipt.record_id);
}

#[test]
fn general_evidence_is_not_claimed_as_signed_events_and_owner_cannot_retire_own_inquiry() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = open(&temp);
    let address = address();
    let mut own = thread("carried:own");
    own.kind = InitiativeThreadKindV1::Own;
    let created = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(own.clone(), "own-create", RevisionActor::Resident, None),
    )
    .expect("resident curiosity");
    let generation = store
        .load_revision_generation(&hex('a'))
        .expect("generation")
        .expect("stored generation");
    assert_eq!(
        generation.snapshot.revision_idempotency[0]
            .replay_binding
            .signed_source_event_refs,
        vec![reference('c')]
    );
    assert_eq!(
        generation.snapshot.records[0].provenance_refs,
        vec![reference('c'), reference('d')]
    );
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                successor(own.clone(), InitiativeDispositionV1::Retired),
                "gift-declined",
                RevisionActor::Owner,
                Some(&created)
            )
        ),
        Err(InitiativeThreadStoreErrorV1::Denied)
    );
    let current = read_in_store(&store, &address, &KEY, false)
        .expect("read")
        .expect("own thread");
    assert!(current.threads[0].thread == own);
}

#[test]
fn a_semantic_completion_claim_requires_independent_host_verified_evidence() {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = open(&temp);
    let address = address();
    let original = thread("carried:completion");
    let created = commit_in_store(
        &mut store,
        &address,
        &KEY,
        request(original.clone(), "create", RevisionActor::Resident, None),
    )
    .expect("create");
    let completed = successor(original, InitiativeDispositionV1::Completed);
    assert_eq!(
        commit_in_store(
            &mut store,
            &address,
            &KEY,
            request(
                completed.clone(),
                "unsupported-completion",
                RevisionActor::Resident,
                Some(&created)
            )
        ),
        Err(InitiativeThreadStoreErrorV1::Denied)
    );
    let mut verified = request(
        completed,
        "verified-completion",
        RevisionActor::Resident,
        Some(&created),
    );
    verified.thread.source_refs.push(reference('e'));
    verified.completion_cause = Some(InitiativeTransitionCauseV1::VerifiedCompletion {
        checkpoint_ref: reference('e'),
    });
    commit_in_store(&mut store, &address, &KEY, verified)
        .expect("independently verified host completion");
    let current = read_in_store(&store, &address, &KEY, false)
        .expect("read")
        .expect("completed thread");
    assert_eq!(
        current.threads[0].thread.disposition,
        InitiativeDispositionV1::Completed
    );
}

#[test]
fn marked_unknown_semantic_bodies_never_fall_back_to_legacy_open_threads() {
    let address = address();
    let mut body = serde_json::to_value(thread("carried:marked")).expect("fixture JSON");
    body["protocol"] = serde_json::json!("polyphonic.initiative-thread.v99");
    let prepared = prepare_revision(
        &address,
        SafeU53::new(1).expect("key version"),
        &KEY,
        RevisionMaterial {
            record_type: "open-thread",
            lineage_root_id: id("carried:marked"),
            record_id: id("carried:marked"),
            expected_head_record_id: None,
            revision: SafeU53::new(0).expect("initial revision"),
            operation: RevisionOperation::Create,
            actor: RevisionActor::Resident,
            created_at: time("2026-01-01T10:00:00Z"),
            body: serde_json::to_string(&body).expect("fixture JSON"),
            tags: vec![INITIATIVE_THREAD_TAG.into(), "open-thread".into()],
            provenance_refs: vec![reference('c'), reference('d')],
            request_domain: "polyphonic.initiative-thread.test.v1",
            request_id: &id("marked-request"),
        },
    )
    .expect("encrypted marked fixture");
    let record = prepared
        .request
        .successor
        .expect("encrypted fixture record");
    assert!(matches!(
        decode_record(&record, &id("carried:marked"), &KEY),
        Err(InitiativeThreadStoreErrorV1::Invalid)
    ));
}

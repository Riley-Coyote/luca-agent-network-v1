use super::*;
use luca_protocol::{derive_message_publish_idempotency_key, SafeU53, MESSAGE_PUBLISH_PROTOCOL};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};

fn hex(byte: &str) -> Hex64 {
    Hex64::parse(byte.repeat(32)).unwrap()
}

fn digest(byte: &str) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", byte.repeat(32))).unwrap()
}

fn timestamp(second: u8) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(format!("2026-10-04T00:00:{second:02}Z")).unwrap()
}

fn approval() -> RuntimeTaskDeliveryApprovalV1 {
    let relay = digest("44");
    RuntimeTaskDeliveryApprovalV1 {
        task_id: OpaqueId::parse("11111111-1111-4111-8111-111111111111").unwrap(),
        owner_pubkey: hex("11"),
        resident_pubkey: hex("22"),
        conversation_id: OpaqueId::parse("22222222-2222-4222-8222-222222222222").unwrap(),
        origin_community_id: community_id_for_relay_ref(&relay).unwrap(),
        origin_relay_ref: relay,
        input_sha256: digest("33"),
        binding_ref: digest("55"),
        runtime_family: "codex".into(),
        operation: RuntimeTaskDeliveryOperationV1::NewTask,
        target_ref: None,
        permission_mode: "normal".into(),
        approved_at: timestamp(1),
    }
}

fn store() -> (tempfile::TempDir, RuntimeTaskDeliveryStore) {
    let directory = tempfile::tempdir().unwrap();
    let store = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json")).unwrap();
    (directory, store)
}

#[test]
fn local_relay_scope_is_stable_only_for_the_exact_supervised_coordinate() {
    let local =
        relay_ref_with_supervised_url("ws://127.0.0.1:4317", Some("ws://127.0.0.1:4317")).unwrap();
    for active in ["ws://127.0.0.1:4317", "ws://127.0.0.1:49152"] {
        assert_eq!(
            relay_ref_with_supervised_url(active, Some(active)).unwrap(),
            local
        );
        assert_ne!(relay_ref_with_supervised_url(active, None).unwrap(), local);
    }
    assert_ne!(
        relay_ref_with_supervised_url("ws://127.0.0.1:4317", Some("ws://127.0.0.1:49152")).unwrap(),
        local
    );
    assert!(community_id_for_relay_ref(&local).is_ok());
    for supervised in [
        None,
        Some("ws://127.0.0.1:4317"),
        Some(crate::local_relay::LOCAL_RELAY_SENTINEL),
    ] {
        assert_eq!(
            relay_ref_with_supervised_url(crate::local_relay::LOCAL_RELAY_SENTINEL, supervised),
            Err(RuntimeTaskDeliveryError::Invalid)
        );
    }
}

#[test]
fn relay_scope_rejects_sentinel_variants_and_preserves_remote_validation() {
    for invalid in [
        crate::local_relay::LOCAL_RELAY_SENTINEL,
        "buzz-local://another-device",
        "buzz-local://on-this-device/",
        "buzz-local://on-this-device?auth=fixture",
        "buzz-local://on-this-device#fragment",
        "buzz-local://user@on-this-device",
        "file:///tmp/relay",
        "wss://user:fixture@relay.example",
        "wss://user@relay.example",
        "not a relay URL",
    ] {
        assert_eq!(
            relay_ref_from_network_url(invalid),
            Err(RuntimeTaskDeliveryError::Invalid),
            "{invalid}"
        );
    }
    let remote = relay_ref_from_network_url("wss://relay.example/").unwrap();
    assert_eq!(
        relay_ref_from_network_url("wss://relay.example/?auth=fixture#fragment").unwrap(),
        remote
    );
    assert_ne!(
        relay_ref_from_network_url("wss://another.example/").unwrap(),
        remote
    );
    assert_ne!(
        relay_ref_with_supervised_url("ws://127.0.0.1:4317", Some("ws://127.0.0.1:4317")).unwrap(),
        remote
    );
}

#[test]
fn delivery_store_reader_bounds_growth_and_accepts_the_exact_byte_limit() {
    use std::io::Cursor;

    let exact = vec![b' '; MAX_STORE_BYTES as usize];
    assert_eq!(
        read_delivery_store_bounded(Cursor::new(&exact)).unwrap(),
        exact
    );

    // More bytes arriving after metadata inspection must not all be consumed.
    let mut growing = std::io::repeat(b'x').take(MAX_STORE_BYTES + 4096);
    assert_eq!(
        read_delivery_store_bounded(&mut growing),
        Err(RuntimeTaskDeliveryError::Invalid)
    );
    assert_eq!(growing.limit(), 4095);
}

#[test]
fn delivery_store_reader_reports_io_failure_without_accepting_partial_bytes() {
    let mut reader = std::io::Cursor::new(b"partial").chain(FailingReader);
    assert_eq!(
        read_delivery_store_bounded(&mut reader),
        Err(RuntimeTaskDeliveryError::Persistence)
    );
}

struct FailingReader;

impl Read for FailingReader {
    fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
        Err(std::io::Error::other("injected read failure"))
    }
}

#[test]
fn delivery_store_load_rejects_oversized_nonregular_and_symlink_inputs() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("deliveries.json");
    let file = std::fs::File::create(&path).unwrap();
    file.set_len(MAX_STORE_BYTES + 1).unwrap();
    assert!(matches!(
        RuntimeTaskDeliveryStore::load(path.clone()),
        Err(RuntimeTaskDeliveryError::Invalid)
    ));
    assert!(matches!(
        RuntimeTaskDeliveryStore::load(directory.path().to_owned()),
        Err(RuntimeTaskDeliveryError::Invalid)
    ));
    #[cfg(unix)]
    {
        let link = directory.path().join("linked.json");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(matches!(
            RuntimeTaskDeliveryStore::load(link),
            Err(RuntimeTaskDeliveryError::Invalid)
        ));
    }
}

fn completion_scope(approval: &RuntimeTaskDeliveryApprovalV1) -> RuntimeTaskCompletionScopeV1 {
    RuntimeTaskCompletionScopeV1 {
        task_id: approval.task_id.clone(),
        owner_pubkey: approval.owner_pubkey.clone(),
        resident_pubkey: approval.resident_pubkey.clone(),
        conversation_id: approval.conversation_id.clone(),
        origin_relay_ref: approval.origin_relay_ref.clone(),
        origin_community_id: approval.origin_community_id.clone(),
        runtime_family: approval.runtime_family.clone(),
        operation: approval.operation,
        target_ref: approval.target_ref.clone(),
        permission_mode: approval.permission_mode.clone(),
    }
}

fn signed_coordinate(keys: &Keys, kind: u16, conversation: &str, tags: Vec<Tag>) -> Event {
    let mut all_tags = vec![Tag::parse(["d", conversation]).unwrap()];
    all_tags.extend(tags);
    EventBuilder::new(Kind::Custom(kind), "")
        .tags(all_tags)
        .sign_with_keys(keys)
        .unwrap()
}

fn bind_and_claim(
    store: &mut RuntimeTaskDeliveryStore,
) -> (RuntimeTaskSynthesisClaimV1, RuntimeTaskDeliveryScopeV1) {
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    let receipt = store
        .bind_succeeded_result(&approval.task_id, digest("66"), timestamp(2))
        .unwrap();
    let scope = RuntimeTaskDeliveryScopeV1 {
        owner_pubkey: approval.owner_pubkey,
        resident_pubkey: approval.resident_pubkey,
        conversation_id: approval.conversation_id,
        origin_relay_ref: approval.origin_relay_ref,
        origin_community_id: approval.origin_community_id,
        binding_ref: approval.binding_ref,
        session_epoch: 7,
    };
    let claim = store
        .claim_synthesis(
            receipt.delivery_id.as_ref().unwrap(),
            &scope,
            1_000,
            5_000,
            timestamp(3),
        )
        .unwrap();
    (claim, scope)
}

fn request(claim: &RuntimeTaskSynthesisClaimV1) -> ManagedMessagePublishRequestV1 {
    let receipt = claim.delivery_id.clone();
    ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.into(),
        turn_id: receipt.clone(),
        idempotency_key: derive_message_publish_idempotency_key(&receipt, &claim.resident_pubkey)
            .unwrap(),
        owner_pubkey: claim.owner_pubkey.clone(),
        resident_pubkey: claim.resident_pubkey.clone(),
        conversation_id: claim.conversation_id.clone(),
        thread_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: Some(ManagedResponseSurfaceV1::Timeline),
        resolved_p_tags: vec![claim.owner_pubkey.clone()],
        final_draft: "Bounded result synthesis".into(),
        dispatch_receipt_id: receipt,
        cancellation_epoch: SafeU53::new(claim.session_epoch).unwrap(),
        exchange: None,
        bucket_hint: None,
        attachments: Vec::new(),
    }
}

#[test]
fn approval_is_idempotent_but_task_id_collision_is_denied() {
    let (_directory, mut store) = store();
    let approval = approval();
    let first = store.create_authority(approval.clone()).unwrap();
    let replay = store.create_authority(approval.clone()).unwrap();
    assert_eq!(first, replay);

    let mut collision = approval;
    collision.input_sha256 = digest("77");
    assert_eq!(
        store.create_authority(collision),
        Err(RuntimeTaskDeliveryError::Denied)
    );
}

#[test]
fn one_result_digest_is_bound_and_a_different_digest_is_denied() {
    let (directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    let first = store
        .bind_succeeded_result(&approval.task_id, digest("66"), timestamp(2))
        .unwrap();
    let replay = store
        .bind_succeeded_result(&approval.task_id, digest("66"), timestamp(3))
        .unwrap();
    assert_eq!(first.delivery_id, replay.delivery_id);
    assert_eq!(
        store.bind_succeeded_result(&approval.task_id, digest("77"), timestamp(4)),
        Err(RuntimeTaskDeliveryError::Denied)
    );

    let restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    assert_eq!(
        restarted
            .receipt_for_task(&approval.task_id)
            .unwrap()
            .result_sha256,
        Some(digest("66"))
    );
}

#[test]
fn completion_scope_must_match_every_frozen_projection_coordinate() {
    let (_directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    store
        .verify_completion_scope(&completion_scope(&approval))
        .unwrap();

    let mut mismatches = Vec::new();
    let mut changed = completion_scope(&approval);
    changed.task_id = OpaqueId::parse("33333333-3333-4333-8333-333333333333").unwrap();
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.owner_pubkey = hex("99");
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.resident_pubkey = hex("99");
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.conversation_id = OpaqueId::parse("33333333-3333-4333-8333-333333333333").unwrap();
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.origin_relay_ref = digest("99");
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.origin_community_id =
        OpaqueId::parse(format!("community:{}", "99".repeat(32))).unwrap();
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.runtime_family = "claude-code".into();
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.operation = RuntimeTaskDeliveryOperationV1::ContinueSession;
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.target_ref = Some(OpaqueId::parse("session:other").unwrap());
    mismatches.push(changed);
    let mut changed = completion_scope(&approval);
    changed.permission_mode = "elevated".into();
    mismatches.push(changed);

    for mismatch in mismatches {
        assert_eq!(
            store.verify_completion_scope(&mismatch),
            Err(RuntimeTaskDeliveryError::Denied)
        );
    }
    assert_eq!(
        store
            .receipt_for_task(&approval.task_id)
            .expect("authority")
            .state,
        RuntimeTaskDeliveryStateV1::AwaitingResult
    );
}

#[test]
fn failed_provider_abandons_pre_result_authority_without_creating_delivery() {
    let (directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    store
        .mark_awaiting_result_abandoned(&approval.task_id, timestamp(2))
        .unwrap();
    store
        .mark_awaiting_result_abandoned(&approval.task_id, timestamp(3))
        .unwrap();
    assert_eq!(
        store.bind_succeeded_result(&approval.task_id, digest("66"), timestamp(4)),
        Err(RuntimeTaskDeliveryError::Terminal)
    );
    let restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    let receipt = restarted.receipt_for_task(&approval.task_id).unwrap();
    assert_eq!(receipt.state, RuntimeTaskDeliveryStateV1::Cancelled);
    assert_eq!(receipt.delivery_id, None);
    assert_eq!(receipt.result_sha256, None);
    assert_eq!(receipt.synthesis_attempts, 0);
}

#[test]
fn unverifiable_success_blocks_only_an_unbound_awaiting_authority() {
    let (directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    store
        .mark_awaiting_result_unverifiable(&approval.task_id, timestamp(2))
        .unwrap();
    store
        .mark_awaiting_result_unverifiable(&approval.task_id, timestamp(3))
        .unwrap();
    assert_eq!(
        store.bind_succeeded_result(&approval.task_id, digest("66"), timestamp(4)),
        Err(RuntimeTaskDeliveryError::Terminal)
    );

    drop(store);
    let mut restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    let receipt = restarted.receipt_for_task(&approval.task_id).unwrap();
    assert_eq!(receipt.state, RuntimeTaskDeliveryStateV1::Blocked);
    assert_eq!(receipt.delivery_id, None);
    assert_eq!(receipt.result_sha256, None);

    assert_eq!(
        restarted.mark_awaiting_result_abandoned(&approval.task_id, timestamp(5)),
        Err(RuntimeTaskDeliveryError::Terminal)
    );
}

#[test]
fn origin_or_binding_change_blocks_before_synthesis() {
    let (_directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    let receipt = store
        .bind_succeeded_result(&approval.task_id, digest("66"), timestamp(2))
        .unwrap();
    let different_relay = digest("88");
    let mismatched = RuntimeTaskDeliveryScopeV1 {
        owner_pubkey: approval.owner_pubkey,
        resident_pubkey: approval.resident_pubkey,
        conversation_id: approval.conversation_id,
        origin_community_id: community_id_for_relay_ref(&different_relay).unwrap(),
        origin_relay_ref: different_relay,
        binding_ref: approval.binding_ref,
        session_epoch: 7,
    };
    assert_eq!(
        store.claim_synthesis(
            receipt.delivery_id.as_ref().unwrap(),
            &mismatched,
            1_000,
            5_000,
            timestamp(3),
        ),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    assert_eq!(
        store.receipt_for_task(&approval.task_id).unwrap().state,
        RuntimeTaskDeliveryStateV1::Blocked
    );
}

#[test]
fn verified_membership_rejects_a_valid_event_from_the_wrong_author() {
    let relay = Keys::generate();
    let attacker = Keys::generate();
    let conversation = approval().conversation_id;
    let metadata = signed_coordinate(
        &relay,
        39000,
        conversation.as_str(),
        vec![Tag::parse(["t", "stream"]).unwrap()],
    );
    let forged_members = signed_coordinate(
        &attacker,
        39002,
        conversation.as_str(),
        vec![Tag::parse(["p", hex("11").as_str()]).unwrap()],
    );
    assert!(verified_conversation_members_from_events(
        &relay.public_key().to_hex(),
        &conversation,
        &[metadata, forged_members],
    )
    .is_err());
}

#[test]
fn verified_channel_membership_does_not_restore_a_removed_metadata_participant() {
    let relay = Keys::generate();
    let conversation = approval().conversation_id;
    let retained = hex("11");
    let removed = hex("22");
    let metadata = signed_coordinate(
        &relay,
        39000,
        conversation.as_str(),
        vec![
            Tag::parse(["t", "stream"]).unwrap(),
            Tag::parse(["p", removed.as_str()]).unwrap(),
        ],
    );
    let current_members = signed_coordinate(
        &relay,
        39002,
        conversation.as_str(),
        vec![Tag::parse(["p", retained.as_str()]).unwrap()],
    );
    let members = verified_conversation_members_from_events(
        &relay.public_key().to_hex(),
        &conversation,
        &[metadata, current_members],
    )
    .unwrap();
    assert_eq!(members, BTreeSet::from([retained]));
    assert!(!members.contains(&removed));
}

#[test]
fn verified_dm_membership_uses_only_current_relay_signed_metadata() {
    let relay = Keys::generate();
    let conversation = approval().conversation_id;
    let owner = hex("11");
    let resident = hex("22");
    let stale = hex("99");
    let metadata = signed_coordinate(
        &relay,
        39000,
        conversation.as_str(),
        vec![
            Tag::parse(["t", "dm"]).unwrap(),
            Tag::parse(["p", owner.as_str()]).unwrap(),
            Tag::parse(["p", resident.as_str()]).unwrap(),
        ],
    );
    let ignored_member_coordinate = signed_coordinate(
        &relay,
        39002,
        conversation.as_str(),
        vec![Tag::parse(["p", stale.as_str()]).unwrap()],
    );
    assert_eq!(
        verified_conversation_members_from_events(
            &relay.public_key().to_hex(),
            &conversation,
            &[metadata, ignored_member_coordinate],
        )
        .unwrap(),
        BTreeSet::from([owner, resident])
    );
}

#[test]
fn publication_route_is_exactly_owner_only_timeline() {
    let (_directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let accepted = request(&claim);
    store.authorize_publication(&accepted, &scope).unwrap();

    let mut threaded = accepted.clone();
    threaded.thread_id = Some(OpaqueId::parse("thread:unexpected").unwrap());
    assert_eq!(
        store.authorize_publication(&threaded, &scope),
        Err(RuntimeTaskDeliveryError::Denied)
    );

    let mut widened = accepted;
    widened.resolved_p_tags.push(hex("99"));
    widened.resolved_p_tags.sort();
    assert_eq!(
        store.authorize_publication(&widened, &scope),
        Err(RuntimeTaskDeliveryError::Denied)
    );
}

#[test]
fn synthesis_attempts_and_lease_are_durable_and_bounded_by_coordinator_policy() {
    let (directory, mut store) = store();
    let (first, scope) = bind_and_claim(&mut store);
    let first_receipt = store.receipt_for_task(&first.task_id).unwrap();
    assert_eq!(first_receipt.synthesis_attempts, 1);
    assert_eq!(first_receipt.synthesis_lease_deadline_unix_ms, Some(6_000));
    store
        .release_synthesis_retryable(&first.delivery_id, first.session_epoch, timestamp(4))
        .unwrap();
    let second = store
        .claim_synthesis(&first.delivery_id, &scope, 7_000, 5_000, timestamp(5))
        .unwrap();
    assert_eq!(second.lease_deadline_unix_ms, 12_000);
    drop(store);
    let restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    let receipt = restarted.receipt_for_task(&first.task_id).unwrap();
    assert_eq!(receipt.synthesis_attempts, 2);
    assert_eq!(receipt.synthesis_lease_deadline_unix_ms, Some(12_000));
}

#[test]
fn unstarted_admission_polling_does_not_mutate_or_grow_the_durable_attempt_budget() {
    let (directory, mut store) = store();
    let (claim, _) = bind_and_claim(&mut store);
    for _ in 0..10 {
        assert!(store.has_synthesis_claim(&claim));
    }
    store
        .release_unstarted_synthesis(&claim, timestamp(4))
        .unwrap();
    assert!(!store.has_synthesis_claim(&claim));
    let receipt = store.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(receipt.state, RuntimeTaskDeliveryStateV1::Retryable);
    assert_eq!(receipt.synthesis_attempts, 1);
    assert_eq!(receipt.synthesis_lease_deadline_unix_ms, None);
    drop(store);
    let restarted =
        RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json")).unwrap();
    assert_eq!(restarted.receipt_for_task(&claim.task_id).unwrap(), receipt);
}

#[test]
fn stale_unstarted_claim_cannot_release_a_later_lease_even_in_the_same_epoch() {
    let (_directory, mut store) = store();
    let (first, scope) = bind_and_claim(&mut store);
    store
        .release_unstarted_synthesis(&first, timestamp(4))
        .unwrap();
    let later = store
        .claim_synthesis(&first.delivery_id, &scope, 7_000, 5_000, timestamp(5))
        .unwrap();
    assert!(!store.has_synthesis_claim(&first));
    assert!(store.has_synthesis_claim(&later));
    assert_eq!(
        store.release_unstarted_synthesis(&first, timestamp(6)),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    let mut wrong_epoch = later.clone();
    wrong_epoch.session_epoch += 1;
    assert!(!store.has_synthesis_claim(&wrong_epoch));
    assert_eq!(
        store.release_unstarted_synthesis(&wrong_epoch, timestamp(7)),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    assert!(store.has_synthesis_claim(&later));
    assert_eq!(
        store
            .receipt_for_task(&first.task_id)
            .unwrap()
            .synthesis_attempts,
        2
    );
}

#[test]
fn same_millisecond_reclaim_has_a_distinct_durable_generation() {
    let (_directory, mut store) = store();
    let (first, scope) = bind_and_claim(&mut store);
    store
        .release_unstarted_synthesis(&first, timestamp(4))
        .unwrap();
    let later = store
        .claim_synthesis(&first.delivery_id, &scope, 1_000, 5_000, timestamp(5))
        .unwrap();
    assert_eq!(first.session_epoch, later.session_epoch);
    assert_eq!(first.lease_deadline_unix_ms, later.lease_deadline_unix_ms);
    assert_eq!(first.synthesis_attempt, 1);
    assert_eq!(later.synthesis_attempt, 2);
    assert!(!store.has_synthesis_claim(&first));
    assert!(store.has_synthesis_claim(&later));
    assert_eq!(
        store.release_unstarted_synthesis(&first, timestamp(6)),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    assert!(store.has_synthesis_claim(&later));
}

#[test]
fn unstarted_release_never_reopens_a_prepared_outbox() {
    let (_directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    store
        .reserve_publication(&request(&claim), &scope, timestamp(4))
        .unwrap();
    assert!(!store.has_synthesis_claim(&claim));
    assert_eq!(
        store.release_unstarted_synthesis(&claim, timestamp(5)),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    let receipt = store.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(receipt.state, RuntimeTaskDeliveryStateV1::Prepared);
    assert_eq!(receipt.synthesis_attempts, 1);
}

#[test]
fn expired_synthesis_recovery_preserves_attempts_and_never_reopens_prepared_work() {
    let (_directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    assert!(!store
        .recover_expired_synthesis(&claim.task_id, 5_999, timestamp(4))
        .unwrap());
    assert!(store
        .recover_expired_synthesis(&claim.task_id, 6_000, timestamp(5))
        .unwrap());
    let recovered = store.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(recovered.state, RuntimeTaskDeliveryStateV1::Retryable);
    assert_eq!(recovered.synthesis_attempts, 1);
    assert_eq!(recovered.synthesis_lease_deadline_unix_ms, None);

    let second = store
        .claim_synthesis(&claim.delivery_id, &scope, 7_000, 5_000, timestamp(6))
        .unwrap();
    let request = request(&second);
    store
        .reserve_publication(&request, &scope, timestamp(7))
        .unwrap();
    assert!(!store
        .recover_expired_synthesis(&claim.task_id, 100_000, timestamp(8))
        .unwrap());
    let prepared = store.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(prepared.state, RuntimeTaskDeliveryStateV1::Prepared);
    assert_eq!(prepared.synthesis_attempts, 2);
}

#[test]
fn reserved_draft_cannot_be_resynthesized_even_before_event_is_frozen() {
    let (directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let request = request(&claim);
    store
        .reserve_publication(&request, &scope, timestamp(4))
        .unwrap();
    drop(store);

    let mut restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    let receipt = restarted.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(receipt.state, RuntimeTaskDeliveryStateV1::Prepared);
    assert_eq!(receipt.synthesis_lease_deadline_unix_ms, None);
    assert_eq!(
        restarted.claim_synthesis(&claim.delivery_id, &scope, 100_000, 5_000, timestamp(5),),
        Err(RuntimeTaskDeliveryError::Terminal)
    );
}

#[test]
fn orphaned_prepared_recovery_requires_old_epoch_exact_scope_and_outbox_absence() {
    let (directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let request = request(&claim);
    store
        .reserve_publication(&request, &scope, timestamp(4))
        .unwrap();
    let path = directory.path().join("deliveries.json");
    let unchanged_bytes = std::fs::read(&path).unwrap();
    let mut recovery = RuntimeTaskDeliveryBrokerRecoveryScopeV1 {
        owner_pubkey: scope.owner_pubkey.clone(),
        resident_pubkey: scope.resident_pubkey.clone(),
        origin_relay_ref: scope.origin_relay_ref.clone(),
        origin_community_id: scope.origin_community_id.clone(),
        binding_ref: scope.binding_ref.clone(),
        current_session_epoch: scope.session_epoch,
    };

    // The current broker may still be between authority reservation and
    // outbox preparation, so its own epoch can never be terminalized.
    assert!(store
        .block_orphaned_prepared_after_broker_invalidation(
            &recovery,
            &BTreeSet::new(),
            timestamp(5),
        )
        .unwrap()
        .is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), unchanged_bytes);

    recovery.current_session_epoch = scope.session_epoch + 1;
    assert!(store
        .block_orphaned_prepared_after_broker_invalidation(
            &recovery,
            &BTreeSet::from([claim.delivery_id.clone()]),
            timestamp(5),
        )
        .unwrap()
        .is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), unchanged_bytes);

    let mut wrong_binding = recovery.clone();
    wrong_binding.binding_ref = digest("99");
    assert!(store
        .block_orphaned_prepared_after_broker_invalidation(
            &wrong_binding,
            &BTreeSet::new(),
            timestamp(5),
        )
        .unwrap()
        .is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), unchanged_bytes);

    assert_eq!(
        store
            .block_orphaned_prepared_after_broker_invalidation(
                &recovery,
                &BTreeSet::new(),
                timestamp(5),
            )
            .unwrap(),
        vec![claim.task_id.clone()]
    );
    let blocked = store.receipt_for_task(&claim.task_id).unwrap();
    assert_eq!(blocked.state, RuntimeTaskDeliveryStateV1::Blocked);
    assert_eq!(blocked.synthesis_lease_deadline_unix_ms, None);

    drop(store);
    let restarted = RuntimeTaskDeliveryStore::load(path).expect("restart store");
    assert_eq!(
        restarted.receipt_for_task(&claim.task_id).unwrap().state,
        RuntimeTaskDeliveryStateV1::Blocked
    );
}

#[test]
fn orphaned_prepared_recovery_never_changes_a_row_with_an_event_id() {
    let (_directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let request = request(&claim);
    let event_id = hex("aa");
    store
        .reserve_publication(&request, &scope, timestamp(4))
        .unwrap();
    store
        .begin_submission(&request, &event_id, &scope, timestamp(5))
        .unwrap();
    store
        .authorize_reconciliation(&request, &event_id, true, &scope, timestamp(6))
        .unwrap();
    let recovery = RuntimeTaskDeliveryBrokerRecoveryScopeV1 {
        owner_pubkey: scope.owner_pubkey,
        resident_pubkey: scope.resident_pubkey,
        origin_relay_ref: scope.origin_relay_ref,
        origin_community_id: scope.origin_community_id,
        binding_ref: scope.binding_ref,
        current_session_epoch: scope.session_epoch + 1,
    };
    assert!(store
        .block_orphaned_prepared_after_broker_invalidation(
            &recovery,
            &BTreeSet::new(),
            timestamp(7),
        )
        .unwrap()
        .is_empty());
    assert_eq!(
        store.receipt_for_task(&claim.task_id).unwrap().state,
        RuntimeTaskDeliveryStateV1::Submitted
    );
}

#[test]
fn preflight_retry_and_owner_requeue_do_not_increment_attempts_or_duplicate_clicks() {
    let (_directory, mut store) = store();
    let approval = approval();
    store.create_authority(approval.clone()).unwrap();
    store
        .bind_succeeded_result(&approval.task_id, digest("66"), timestamp(2))
        .unwrap();
    store
        .mark_pending_retryable(&approval.task_id, timestamp(3))
        .unwrap();
    assert_eq!(
        store
            .receipt_for_task(&approval.task_id)
            .unwrap()
            .synthesis_attempts,
        0
    );
    store
        .requeue_owner_retry(&approval.task_id, timestamp(4))
        .unwrap();
    assert_eq!(
        store.requeue_owner_retry(&approval.task_id, timestamp(5)),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    assert_eq!(
        store.receipt_for_task(&approval.task_id).unwrap().state,
        RuntimeTaskDeliveryStateV1::PendingSynthesis
    );
}

#[test]
fn prepared_restart_reconciles_only_frozen_request_and_event() {
    let (directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let request = request(&claim);
    let event_id = hex("aa");
    store
        .reserve_publication(&request, &scope, timestamp(4))
        .unwrap();
    store
        .begin_submission(&request, &event_id, &scope, timestamp(5))
        .unwrap();
    drop(store);

    let mut restarted = RuntimeTaskDeliveryStore::load(directory.path().join("deliveries.json"))
        .expect("restart store");
    assert_eq!(
        restarted
            .authorize_reconciliation(&request, &event_id, true, &scope, timestamp(6),)
            .unwrap(),
        RuntimeTaskDeliveryReconciliationV1::Ready
    );

    let mut changed = request.clone();
    changed.final_draft.push_str(" changed");
    assert_eq!(
        restarted.authorize_reconciliation(&changed, &event_id, true, &scope, timestamp(7),),
        Err(RuntimeTaskDeliveryError::Denied)
    );
    assert_eq!(
        restarted.authorize_reconciliation(&request, &hex("bb"), true, &scope, timestamp(7),),
        Err(RuntimeTaskDeliveryError::Denied)
    );
}

#[test]
fn publication_and_finalization_are_idempotent_without_second_result() {
    let (_directory, mut store) = store();
    let (claim, scope) = bind_and_claim(&mut store);
    let request = request(&claim);
    let event_id = hex("aa");
    store
        .reserve_publication(&request, &scope, timestamp(4))
        .unwrap();
    store
        .begin_submission(&request, &event_id, &scope, timestamp(5))
        .unwrap();
    store
        .authorize_reconciliation(&request, &event_id, true, &scope, timestamp(6))
        .unwrap();
    store
        .mark_published(&claim.delivery_id, &event_id, timestamp(7))
        .unwrap();
    store
        .mark_published(&claim.delivery_id, &event_id, timestamp(8))
        .unwrap();
    store
        .finalize_published_outbox(&claim.delivery_id, &event_id)
        .unwrap();
    store
        .finalize_published_outbox(&claim.delivery_id, &event_id)
        .unwrap();
    assert_eq!(
        store
            .receipt_for_task(&claim.task_id)
            .expect("receipt")
            .state,
        RuntimeTaskDeliveryStateV1::Published
    );
}

#[test]
fn failed_persistence_does_not_mutate_in_memory_authority() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("destination-is-directory");
    std::fs::create_dir(&destination).unwrap();
    let mut store = RuntimeTaskDeliveryStore {
        path: destination,
        rows: HashMap::new(),
    };
    let approval = approval();
    assert_eq!(
        store.create_authority(approval.clone()),
        Err(RuntimeTaskDeliveryError::Persistence)
    );
    assert!(store.receipt_for_task(&approval.task_id).is_none());
}

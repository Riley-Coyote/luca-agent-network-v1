use super::*;
use luca_protocol::{
    derive_message_publish_idempotency_key, ManagedResponseSurfaceV1, SafeU53,
    MESSAGE_PUBLISH_PROTOCOL,
};
use nostr::{EventBuilder, Keys, Kind, Tag};

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
}

fn request(keys: &Keys) -> ManagedMessagePublishRequestV1 {
    let resident_pubkey = Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey");
    let dispatch_receipt_id = OpaqueId::parse("dispatch-1").expect("valid dispatch receipt ID");
    ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
        turn_id: OpaqueId::parse("turn-1").expect("valid turn ID"),
        idempotency_key: derive_message_publish_idempotency_key(
            &dispatch_receipt_id,
            &resident_pubkey,
        )
        .expect("valid idempotency key"),
        owner_pubkey: hex('a'),
        resident_pubkey,
        conversation_id: OpaqueId::parse("conversation-1").expect("valid conversation ID"),
        thread_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: None,
        resolved_p_tags: Vec::new(),
        final_draft: "A bounded final answer.".to_owned(),
        dispatch_receipt_id,
        cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
    }
}

fn frozen_event(
    keys: &Keys,
    request: &ManagedMessagePublishRequestV1,
) -> FrozenManagedMessageEvent {
    let tags =
        vec![Tag::parse(["h", request.conversation_id.as_str()]).expect("valid conversation tag")];
    let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign fixture event");
    let canonical =
        String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
    FrozenManagedMessageEvent::parse(canonical, request).expect("valid frozen event")
}

#[test]
fn luca_signing_outbox_has_one_way_exact_event_lifecycle() {
    let keys = Keys::parse(&"02".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-1").expect("valid installation ID");
    let mut outbox = ManagedMessageOutbox::new(session.clone());

    let prepared = outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");
    assert_eq!(prepared.state, ManagedOutboxState::Prepared);
    let exact_event = outbox
        .event_for_submission(&request.idempotency_key)
        .expect("exact event")
        .to_owned();
    let submitted = outbox
        .mark_submitted(&request.idempotency_key, &session, false)
        .expect("submit");
    assert_eq!(submitted.state, ManagedOutboxState::Submitted);
    assert_eq!(
        exact_event,
        outbox
            .entries
            .get(request.idempotency_key.as_str())
            .expect("retained entry")
            .event
            .signed_event_json,
        "submission must retain the same exact signed event"
    );

    let accepted = outbox
        .mark_accepted(
            &request.idempotency_key,
            OpaqueId::parse("publication-1").expect("valid receipt"),
        )
        .expect("accept");
    assert_eq!(accepted.state, ManagedOutboxState::Accepted);
    assert!(matches!(
        outbox
            .accepted_result(&request.idempotency_key)
            .expect("first result"),
        ManagedMessagePublishResultV1::Published { .. }
    ));
    assert!(matches!(
        outbox
            .accepted_result(&request.idempotency_key)
            .expect("replay result"),
        ManagedMessagePublishResultV1::Replayed { .. }
    ));
}

#[test]
fn luca_signing_outbox_cancellation_wins_before_submit_only() {
    let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-1").expect("valid installation ID");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");
    let cancelled = outbox
        .cancel_before_submission(&request.idempotency_key)
        .expect("cancel");
    assert_eq!(cancelled.state, ManagedOutboxState::Cancelled);
    assert!(matches!(
        outbox.mark_submitted(&request.idempotency_key, &session, false),
        Err(ManagedMessageOutboxError::InvalidTransition)
    ));
}

#[test]
fn luca_signing_outbox_rejects_any_tag_not_derived_from_typed_request() {
    let keys = Keys::parse(&"03".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
        .tags([
            Tag::parse(["h", request.conversation_id.as_str()]).expect("valid conversation tag"),
            Tag::parse(["p", hex('f').as_str()]).expect("valid unauthorized mention"),
        ])
        .sign_with_keys(&keys)
        .expect("sign fixture event");
    let canonical =
        String::from_utf8(canonicalize(&event).expect("canonical event")).expect("UTF-8 event");
    assert!(matches!(
        FrozenManagedMessageEvent::parse(canonical, &request),
        Err(ManagedMessageOutboxError::InvalidEvent)
    ));
}

#[test]
fn luca_signing_outbox_encrypts_and_reloads_exact_prepared_event() {
    let keys = Keys::parse(&"04".repeat(32)).expect("valid fixture key");
    let mut request = request(&keys);
    request.final_draft = "PLAINTEXT-FINAL-MUST-NOT-APPEAR".to_owned();
    let event = frozen_event(&keys, &request);
    let exact_event = event.signed_event_json().to_owned();
    let exact_event_id = event.event_id.clone();
    let session = OpaqueId::parse("installation-encrypted").expect("valid installation ID");
    let passphrase = SecretString::from("RESIDENT-SECRET-SENTINEL".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("new encrypted outbox");

    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("durable prepare");
    let ciphertext = std::fs::read(&path).expect("ciphertext");
    assert!(!ciphertext
        .windows(request.final_draft.len())
        .any(|window| window == request.final_draft.as_bytes()));
    assert!(!ciphertext
        .windows("RESIDENT-SECRET-SENTINEL".len())
        .any(|window| window == b"RESIDENT-SECRET-SENTINEL"));

    let reloaded = ManagedMessageOutbox::load_encrypted(session, path, passphrase).expect("reload");
    let entries = reloaded.reconciliation_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].event_id, exact_event_id);
    assert_eq!(entries[0].signed_event_json, exact_event);
    assert_eq!(entries[0].request, request);
    assert_eq!(entries[0].state, ManagedOutboxState::Prepared);
}

#[test]
fn luca_signing_outbox_reloads_pre_receipt_surface_events() {
    let keys = Keys::parse(&"0e".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let mut surfaced_request = request.clone();
    surfaced_request.response_surface = Some(ManagedResponseSurfaceV1::Timeline);
    let legacy_signed_event = EventBuilder::new(Kind::Custom(9), request.final_draft.clone())
        .tags([
            Tag::parse(["h", request.conversation_id.as_str()]).expect("conversation tag"),
            Tag::parse(["broadcast", "1"]).expect("broadcast tag"),
        ])
        .sign_with_keys(&keys)
        .expect("sign pre-receipt event");
    let exact_legacy_event =
        String::from_utf8(canonicalize(&legacy_signed_event).expect("canonical pre-receipt event"))
            .expect("UTF-8 pre-receipt event");
    assert!(matches!(
        FrozenManagedMessageEvent::parse(exact_legacy_event.clone(), &surfaced_request),
        Err(ManagedMessageOutboxError::InvalidEvent)
    ));
    let legacy_frozen = FrozenManagedMessageEvent::parse_with_tag_policy(
        exact_legacy_event,
        &surfaced_request,
        true,
    )
    .expect("persisted compatibility accepts exact pre-receipt event");
    let session = OpaqueId::parse("installation-pre-receipt").expect("valid installation ID");
    let passphrase = SecretString::from("pre-receipt-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("new encrypted outbox");
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare legacy event");

    // Surface routing predates receipt-address tags. Model a canonical row
    // written by that release: the typed request has a surface, while its
    // already-frozen signed event remains exact and tagless.
    let entry = outbox
        .entries
        .get_mut(request.idempotency_key.as_str())
        .expect("prepared entry");
    entry.request = surfaced_request;
    entry.event = legacy_frozen;
    entry.request_sha256 = Hex64::parse(canonical_sha256(&entry.request).expect("request hash"))
        .expect("canonical request hash");
    outbox.persist().expect("persist legacy surface row");

    let reloaded = ManagedMessageOutbox::load_encrypted(session, path, passphrase)
        .expect("pre-receipt outbox remains recoverable");
    let restored_entries = reloaded.reconciliation_entries();
    let [restored] = restored_entries.as_slice() else {
        panic!("expected one restored entry");
    };
    assert_eq!(
        restored.request.response_surface,
        Some(ManagedResponseSurfaceV1::Timeline)
    );
    let restored_event =
        nostr::Event::from_json(&restored.signed_event_json).expect("restored signed event");
    assert!(!restored_event.tags.iter().any(|tag| tag
        .as_slice()
        .first()
        .is_some_and(|value| value == luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG)));
}

#[test]
fn luca_signing_outbox_loads_canonical_legacy_state_before_defaulted_fields() {
    let keys = Keys::parse(&"0d".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-legacy-default").expect("valid installation ID");
    let passphrase = SecretString::from("legacy-default-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("new encrypted outbox");
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");

    let mut legacy = serde_json::to_value(PersistedManagedOutbox {
        schema: OUTBOX_SCHEMA.to_owned(),
        installation_session_id: session.clone(),
        next_order: outbox.next_order,
        reconcile_cursor: outbox.reconcile_cursor,
        entries: outbox.entries.clone(),
    })
    .expect("serialize fixture");
    for entry in legacy["entries"]
        .as_object_mut()
        .expect("entries object")
        .values_mut()
    {
        entry
            .as_object_mut()
            .expect("entry object")
            .remove("handoff_recorded");
    }
    let legacy_plaintext = canonicalize(&legacy).expect("canonical legacy fixture");
    let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());
    let mut ciphertext = Vec::new();
    {
        let mut writer = encryptor
            .wrap_output(&mut ciphertext)
            .expect("encrypt fixture");
        writer
            .write_all(&legacy_plaintext)
            .expect("write legacy fixture");
        writer.finish().expect("finish legacy fixture");
    }
    atomic_write_ciphertext(&path, &ciphertext).expect("write encrypted legacy fixture");

    let reloaded = ManagedMessageOutbox::load_encrypted(session, path, passphrase)
        .expect("load canonical legacy outbox");
    assert_eq!(reloaded.reconciliation_entries().len(), 1);
    assert!(reloaded
        .entries
        .values()
        .all(|entry| entry.handoff_recorded));
}

#[test]
fn luca_signing_outbox_persists_every_transition_and_replay_bit() {
    let keys = Keys::parse(&"05".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-transitions").expect("valid installation ID");
    let passphrase = SecretString::from("transition-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("new encrypted outbox");
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");

    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("reload prepared");
    assert_eq!(
        outbox
            .mark_submitted(&request.idempotency_key, &session, false)
            .expect("submitted")
            .state,
        ManagedOutboxState::Submitted
    );
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("reload submitted");
    assert_eq!(
        outbox.reconciliation_entries()[0].state,
        ManagedOutboxState::Submitted
    );
    outbox
        .mark_accepted(
            &request.idempotency_key,
            OpaqueId::parse("relay-receipt").expect("receipt"),
        )
        .expect("accepted");

    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("reload accepted");
    assert!(matches!(
        outbox
            .accepted_result(&request.idempotency_key)
            .expect("published"),
        ManagedMessagePublishResultV1::Published { .. }
    ));
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session, path, passphrase).expect("reload replay bit");
    assert!(matches!(
        outbox
            .accepted_result(&request.idempotency_key)
            .expect("replayed"),
        ManagedMessagePublishResultV1::Replayed { .. }
    ));
}

#[test]
fn accepted_outbox_remains_recoverable_until_handoff_is_durable() {
    let keys = Keys::parse(&"0c".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-handoff-transfer").expect("valid installation ID");
    let passphrase = SecretString::from("handoff-transfer-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("new encrypted outbox");
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");
    outbox
        .mark_submitted(&request.idempotency_key, &session, false)
        .expect("submitted");
    outbox
        .mark_accepted(
            &request.idempotency_key,
            OpaqueId::parse("handoff-transfer-receipt").expect("receipt"),
        )
        .expect("accepted");
    outbox
        .mark_authority_finalized(&request.idempotency_key)
        .expect("authority finalized");

    // Simulate an application crash after publication authority commits but
    // before the continuity scheduler records its idempotent job.
    let mut reloaded =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("reload crash window");
    let pending = reloaded.reconciliation_entries();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].state, ManagedOutboxState::Accepted);
    assert_eq!(pending[0].idempotency_key, request.idempotency_key);

    reloaded
        .mark_handoff_recorded(&request.idempotency_key)
        .expect("handoff recorded");
    let completed = ManagedMessageOutbox::load_encrypted(session, path, passphrase)
        .expect("reload completed transfer");
    assert!(completed.reconciliation_entries().is_empty());
}

#[test]
fn luca_signing_outbox_persistence_failure_rolls_back_for_retry() {
    let keys = Keys::parse(&"06".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-failure").expect("valid installation ID");
    let passphrase = SecretString::from("failure-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let directory_target = temp.path().join("directory-target");
    std::fs::create_dir(&directory_target).expect("directory target");
    let mut outbox = ManagedMessageOutbox::load_encrypted(
        session.clone(),
        temp.path().join("initial-valid-target.age"),
        passphrase.clone(),
    )
    .expect("outbox");
    outbox.persistence_path = Some(directory_target);
    assert!(matches!(
        outbox.prepare(&request, event.clone(), &session, 3, false),
        Err(ManagedMessageOutboxError::Persistence)
    ));
    assert!(outbox.entries.is_empty());

    let valid_path = temp.path().join("managed-outbox.age");
    outbox.persistence_path = Some(valid_path.clone());
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("retry prepare");
    assert!(ManagedMessageOutbox::load_encrypted(session, valid_path, passphrase).is_ok());
}

#[test]
fn luca_signing_outbox_rejects_corrupt_accepted_invariant_on_load() {
    let keys = Keys::parse(&"07".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-corrupt").expect("valid installation ID");
    let passphrase = SecretString::from("corrupt-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox =
        ManagedMessageOutbox::load_encrypted(session.clone(), path.clone(), passphrase.clone())
            .expect("outbox");
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");
    let entry = outbox
        .entries
        .get_mut(request.idempotency_key.as_str())
        .expect("entry");
    entry.state = ManagedOutboxState::Accepted;
    entry.publication_receipt_id = None;
    outbox
        .persist()
        .expect("persist deliberately corrupt fixture");

    assert!(matches!(
        ManagedMessageOutbox::load_encrypted(session, path, passphrase),
        Err(ManagedMessageOutboxError::Persistence)
    ));
}

#[test]
fn luca_signing_outbox_capacity_evicts_only_oldest_finalized_terminal() {
    let keys = Keys::parse(&"08".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-capacity").expect("valid installation ID");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    outbox
        .prepare(&request, event.clone(), &session, 3, false)
        .expect("seed");
    let template = outbox
        .entries
        .remove(request.idempotency_key.as_str())
        .expect("template");
    let mut unresolved_keys = Vec::new();
    for index in 0..MAX_OUTBOX_ENTRIES {
        let key = hex::encode(Sha256::digest(index.to_be_bytes()));
        let mut entry = template.clone();
        entry.created_order = index as u64 + 1;
        if index == 0 {
            entry.state = ManagedOutboxState::Accepted;
            entry.publication_receipt_id =
                Some(OpaqueId::parse("accepted-receipt").expect("receipt"));
            entry.authority_finalized = true;
            entry.handoff_recorded = true;
        } else {
            unresolved_keys.push(key.clone());
        }
        outbox.entries.insert(key, entry);
    }
    outbox.next_order = MAX_OUTBOX_ENTRIES as u64 + 1;
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("terminal compaction");
    assert_eq!(outbox.entries.len(), MAX_OUTBOX_ENTRIES);
    let oldest = hex::encode(Sha256::digest(0_usize.to_be_bytes()));
    assert!(!outbox.entries.contains_key(&oldest));
    assert!(unresolved_keys
        .iter()
        .all(|key| outbox.entries.contains_key(key)));

    for entry in outbox.entries.values_mut() {
        entry.state = ManagedOutboxState::Prepared;
        entry.publication_receipt_id = None;
        entry.authority_finalized = false;
    }
    let mut different = request.clone();
    different.dispatch_receipt_id = OpaqueId::parse("different-dispatch").expect("dispatch");
    different.idempotency_key = derive_message_publish_idempotency_key(
        &different.dispatch_receipt_id,
        &different.resident_pubkey,
    )
    .expect("idempotency");
    let different_event = frozen_event(&keys, &different);
    assert!(matches!(
        outbox.prepare(&different, different_event, &session, 3, false),
        Err(ManagedMessageOutboxError::Persistence)
    ));
    assert_eq!(outbox.entries.len(), MAX_OUTBOX_ENTRIES);
}

#[test]
fn luca_signing_outbox_capacity_retains_unfinalized_cancelled_and_rejected_rows() {
    let keys = Keys::parse(&"0b".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-terminal-capacity").expect("valid installation ID");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    outbox
        .prepare(&request, event.clone(), &session, 3, false)
        .expect("seed");
    let template = outbox
        .entries
        .remove(request.idempotency_key.as_str())
        .expect("template");

    for index in 0..MAX_OUTBOX_ENTRIES {
        let key = hex::encode(Sha256::digest(index.to_be_bytes()));
        let mut entry = template.clone();
        entry.created_order = index as u64 + 1;
        entry.state = if index == 0 {
            ManagedOutboxState::Cancelled
        } else if index == 1 {
            ManagedOutboxState::Rejected
        } else {
            ManagedOutboxState::Prepared
        };
        entry.authority_finalized = false;
        outbox.entries.insert(key, entry);
    }
    outbox.next_order = MAX_OUTBOX_ENTRIES as u64 + 1;

    assert!(matches!(
        outbox.prepare(&request, event.clone(), &session, 3, false),
        Err(ManagedMessageOutboxError::Persistence)
    ));
    let cancelled_key = hex::encode(Sha256::digest(0_usize.to_be_bytes()));
    let rejected_key = hex::encode(Sha256::digest(1_usize.to_be_bytes()));
    assert!(outbox.entries.contains_key(&cancelled_key));
    assert!(outbox.entries.contains_key(&rejected_key));

    outbox
        .entries
        .get_mut(&cancelled_key)
        .expect("cancelled")
        .authority_finalized = true;
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("finalized terminal can compact");
    assert!(!outbox.entries.contains_key(&cancelled_key));
    assert!(outbox.entries.contains_key(&rejected_key));
}

#[test]
fn luca_signing_outbox_rejects_noncanonical_encrypted_envelope() {
    let keys = Keys::parse(&"09".repeat(32)).expect("valid fixture key");
    let request = request(&keys);
    let event = frozen_event(&keys, &request);
    let session = OpaqueId::parse("installation-canonical").expect("valid installation ID");
    let passphrase = SecretString::from("canonical-passphrase".to_owned());
    let temp = tempfile::tempdir().expect("temp");
    let path = temp.path().join("managed-outbox.age");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    outbox
        .prepare(&request, event, &session, 3, false)
        .expect("prepare");
    let noncanonical = serde_json::to_vec_pretty(&PersistedManagedOutbox {
        schema: OUTBOX_SCHEMA.to_owned(),
        installation_session_id: session.clone(),
        next_order: outbox.next_order,
        reconcile_cursor: outbox.reconcile_cursor,
        entries: outbox.entries.clone(),
    })
    .expect("pretty JSON");
    let encryptor = age::Encryptor::with_user_passphrase(passphrase.clone());
    let mut ciphertext = Vec::new();
    {
        let mut writer = encryptor.wrap_output(&mut ciphertext).expect("encrypt");
        writer.write_all(&noncanonical).expect("write");
        writer.finish().expect("finish");
    }
    std::fs::write(&path, ciphertext).expect("write ciphertext");
    assert!(matches!(
        ManagedMessageOutbox::load_encrypted(session, path, passphrase),
        Err(ManagedMessageOutboxError::Persistence)
    ));
}

#[test]
fn luca_signing_outbox_reconciliation_cursor_rotates_after_failed_early_row() {
    let keys = Keys::parse(&"0a".repeat(32)).expect("valid fixture key");
    let session = OpaqueId::parse("installation-cursor").expect("valid installation ID");
    let mut outbox = ManagedMessageOutbox::new(session.clone());
    for index in 0..4 {
        let mut request = request(&keys);
        request.dispatch_receipt_id =
            OpaqueId::parse(format!("dispatch-{index}")).expect("dispatch");
        request.idempotency_key = derive_message_publish_idempotency_key(
            &request.dispatch_receipt_id,
            &request.resident_pubkey,
        )
        .expect("idempotency");
        let event = frozen_event(&keys, &request);
        outbox
            .prepare(&request, event, &session, 3, false)
            .expect("prepare");
    }
    let initial: Vec<_> = outbox
        .reconciliation_entries()
        .iter()
        .map(|entry| entry.created_order)
        .collect();
    assert_eq!(initial, vec![1, 2, 3, 4]);
    // The publisher advances this cursor even when an early relay attempt
    // fails, so the next bounded pass starts after that unavailable row.
    outbox.advance_reconcile_cursor(2).expect("advance");
    let rotated: Vec<_> = outbox
        .reconciliation_entries()
        .iter()
        .map(|entry| entry.created_order)
        .collect();
    assert_eq!(rotated, vec![3, 4, 1, 2]);
}

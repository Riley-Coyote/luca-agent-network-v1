use super::*;
use luca_protocol::{
    decode_length_prefixed_result_frame, derive_message_publish_idempotency_key,
    encode_length_prefixed_frame, ManagedMessagePublishRequestV1, ManagedMessagePublishResultV1,
    ManagedResponseSurfaceV1, OpaqueId, OperationV1, RelayAuthPurposeV1, RelayHttpMethodV1,
    SafeU53, SigningFrameV1, MESSAGE_PUBLISH_PROTOCOL, RELAY_AUTH_SIGN_PROTOCOL,
};
use nostr::JsonUtil;
use std::sync::{Arc, Mutex};

fn hex(value: char) -> Hex64 {
    Hex64::parse(value.to_string().repeat(64)).expect("valid fixture hex")
}

#[test]
fn luca_signing_broker_preserves_causal_tags_and_addresses_managed_finals() {
    let (broker, _) = fixture();
    let mut timeline = publish_request(&broker);
    timeline.response_surface = Some(ManagedResponseSurfaceV1::Timeline);
    let timeline_json = broker
        .build_managed_message_event(&timeline, 1_700_000_000)
        .expect("timeline event");
    let timeline_event = nostr::Event::from_json(timeline_json).expect("timeline JSON");
    assert!(timeline_event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.len() == 2 && parts[0] == "broadcast" && parts[1] == "1"
    }));
    assert!(timeline_event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.len() == 2
            && parts[0] == luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG
            && parts[1] == timeline.dispatch_receipt_id.as_str()
    }));
    assert!(timeline_event.tags.iter().any(|tag| {
        tag.as_slice()
            == [
                "e",
                timeline.root_event_id.as_ref().expect("root").as_str(),
                "",
                "root",
            ]
    }));
    assert!(timeline_event.tags.iter().any(|tag| {
        tag.as_slice()
            == [
                "e",
                timeline.reply_event_id.as_ref().expect("reply").as_str(),
                "",
                "reply",
            ]
    }));
    assert_ne!(
        timeline.dispatch_receipt_id.as_str(),
        timeline.reply_event_id.as_ref().expect("reply").as_str(),
        "receipt addressing must remain separate from causal NIP-10 routing"
    );

    let mut thread = publish_request(&broker);
    thread.response_surface = Some(ManagedResponseSurfaceV1::Thread);
    let thread_json = broker
        .build_managed_message_event(&thread, 1_700_000_000)
        .expect("thread event");
    let thread_event = nostr::Event::from_json(thread_json).expect("thread JSON");
    assert!(!thread_event.tags.iter().any(|tag| tag
        .as_slice()
        .first()
        .is_some_and(|value| value == "broadcast")));
    assert!(thread_event.tags.iter().any(|tag| {
        let parts = tag.as_slice();
        parts.len() == 2
            && parts[0] == luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG
            && parts[1] == thread.dispatch_receipt_id.as_str()
    }));
    assert!(thread_event.tags.iter().any(|tag| {
        tag.as_slice()
            == [
                "e",
                thread.root_event_id.as_ref().expect("root").as_str(),
                "",
                "root",
            ]
    }));
    assert!(thread_event.tags.iter().any(|tag| {
        tag.as_slice()
            == [
                "e",
                thread.reply_event_id.as_ref().expect("reply").as_str(),
                "",
                "reply",
            ]
    }));

    let legacy = publish_request(&broker);
    let legacy_json = broker
        .build_managed_message_event(&legacy, 1_700_000_000)
        .expect("legacy event");
    let legacy_event = nostr::Event::from_json(legacy_json).expect("legacy JSON");
    assert!(!legacy_event.tags.iter().any(|tag| tag
        .as_slice()
        .first()
        .is_some_and(|value| value == luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG)));
}

fn fixture() -> (ResidentSigningBroker, Hex64) {
    let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let broker = ResidentSigningBroker::new(
        keys.clone(),
        LocalBrokerSessionBinding {
            owner_pubkey: hex('a'),
            resident_pubkey: Hex64::parse(keys.public_key().to_hex())
                .expect("valid resident pubkey"),
            acp_pid: 8123,
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            runtime_configuration_sha256: runtime.clone(),
            installation_session_id: OpaqueId::parse("installation-1")
                .expect("valid installation ID"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        },
    )
    .expect("matching broker");
    (broker, runtime)
}

fn publish_request(broker: &ResidentSigningBroker) -> ManagedMessagePublishRequestV1 {
    let resident_pubkey = broker.session.binding().resident_pubkey.clone();
    let dispatch_receipt_id = OpaqueId::parse("dispatch-1").expect("valid dispatch receipt ID");
    ManagedMessagePublishRequestV1 {
        protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
        turn_id: OpaqueId::parse("turn-1").expect("valid turn ID"),
        idempotency_key: derive_message_publish_idempotency_key(
            &dispatch_receipt_id,
            &resident_pubkey,
        )
        .expect("valid idempotency key"),
        owner_pubkey: broker.session.binding().owner_pubkey.clone(),
        resident_pubkey,
        conversation_id: OpaqueId::parse("conversation-1").expect("valid conversation ID"),
        thread_id: Some(OpaqueId::parse("thread-1").expect("valid thread ID")),
        root_event_id: Some(hex('d')),
        reply_event_id: Some(hex('e')),
        response_surface: None,
        resolved_p_tags: vec![hex('a'), hex('f')],
        final_draft: "A managed final answer.".to_owned(),
        dispatch_receipt_id,
        cancellation_epoch: SafeU53::new(3).expect("valid cancellation epoch"),
        exchange: None,
        bucket_hint: None,
    }
}

fn encoded_publish_frame(
    broker: &ResidentSigningBroker,
    request: &ManagedMessagePublishRequestV1,
    sequence: u64,
    request_id: &str,
) -> Vec<u8> {
    encode_length_prefixed_frame(
        &SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: broker.session.binding().session_epoch,
            sequence: SafeU53::new(sequence).expect("valid sequence"),
            request_id: OpaqueId::parse(request_id).expect("valid request ID"),
            operation: OperationV1::MessagePublish,
            payload: request.clone(),
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
        },
        1_700_000_000_000,
    )
    .expect("valid publish frame")
}

#[test]
fn luca_signing_broker_returns_exact_public_nip42_event() {
    let (mut broker, runtime) = fixture();
    let request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: broker.session.binding().resident_pubkey.clone(),
        purpose: RelayAuthPurposeV1::Nip42 {
            relay_url: "wss://relay.example.test".to_owned(),
            challenge: "relay-challenge".to_owned(),
            owner_attestation: None,
        },
    };
    let frame = SigningFrameV1 {
        protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        sequence: SafeU53::new(1).expect("valid sequence"),
        request_id: OpaqueId::parse("request-1").expect("valid request ID"),
        operation: OperationV1::RelayAuthSign,
        payload: request.clone(),
        deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
    };
    let encoded =
        encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
    let result = broker
        .handle_relay_auth_frame(
            &encoded,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: &runtime,
            },
            1_700_000_000_000,
        )
        .expect("authorized signing");
    let decoded = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&result)
        .expect("valid result frame");
    decoded
        .result
        .validate_against(&request, 1_700_000_000)
        .expect("result is bound to exact request");
    let RelayAuthSignResultV1::Signed {
        signed_event_json, ..
    } = decoded.result
    else {
        panic!("expected signed result");
    };
    let event = nostr::Event::from_json(signed_event_json).expect("valid public event");
    assert!(event.verify_signature());
    assert_eq!(event.kind, Kind::Authentication);
}

#[test]
fn luca_signing_broker_invalidates_session_on_transport_error_exit() {
    let (mut broker, runtime) = fixture();
    let caller = LocalBrokerCaller {
        acp_pid: 8123,
        runtime_configuration_sha256: &runtime,
    };
    let mut partial = std::io::Cursor::new(vec![0_u8]);
    assert!(matches!(
        broker.serve_relay_auth_session(&mut partial, caller),
        Err(SigningBrokerError::Transport(SigningTransportError::Io(_)))
    ));

    let request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: broker.session.binding().resident_pubkey.clone(),
        purpose: RelayAuthPurposeV1::Nip42 {
            relay_url: "wss://relay.example.test".to_owned(),
            challenge: "relay-challenge".to_owned(),
            owner_attestation: None,
        },
    };
    let frame = SigningFrameV1 {
        protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
        session_epoch: SafeU53::new(4).expect("epoch"),
        sequence: SafeU53::new(1).expect("sequence"),
        request_id: OpaqueId::parse("after-error").expect("request"),
        operation: OperationV1::RelayAuthSign,
        payload: request,
        deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("deadline"),
    };
    let encoded = encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid frame");
    assert!(matches!(
        broker.handle_relay_auth_frame(
            &encoded,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: &runtime,
            },
            1_700_000_000_000,
        ),
        Err(SigningBrokerError::Session(
            LocalBrokerSessionError::Closed(
                super::super::local_broker_session::SessionCloseReason::Invalidated
            )
        ))
    ));
}

#[test]
fn luca_signing_broker_never_accepts_a_different_resident() {
    let (mut broker, runtime) = fixture();
    let request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: hex('d'),
        purpose: RelayAuthPurposeV1::Nip42 {
            relay_url: "wss://relay.example.test".to_owned(),
            challenge: "relay-challenge".to_owned(),
            owner_attestation: None,
        },
    };
    let frame = SigningFrameV1 {
        protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        sequence: SafeU53::new(1).expect("valid sequence"),
        request_id: OpaqueId::parse("request-1").expect("valid request ID"),
        operation: OperationV1::RelayAuthSign,
        payload: request,
        deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
    };
    let encoded =
        encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
    assert!(matches!(
        broker.handle_relay_auth_frame(
            &encoded,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: &runtime,
            },
            1_700_000_000_000,
        ),
        Err(SigningBrokerError::Session(
            LocalBrokerSessionError::PolicyMismatch
        ))
    ));
}

#[test]
fn luca_signing_broker_nip98_is_bound_to_exact_query_body_nonce_and_expiry() {
    let (mut broker, runtime) = fixture();
    let request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: broker.session.binding().resident_pubkey.clone(),
        purpose: RelayAuthPurposeV1::Nip98 {
            method: RelayHttpMethodV1::Post,
            url: "https://relay.example.test/query".to_owned(),
            payload_sha256: Some(hex('e')),
            nonce: OpaqueId::parse("nonce-1").expect("valid nonce"),
            expires_at_unix_secs: SafeU53::new(1_700_000_030).expect("valid expiry"),
        },
    };
    let frame = SigningFrameV1 {
        protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        sequence: SafeU53::new(1).expect("valid sequence"),
        request_id: OpaqueId::parse("request-nip98").expect("valid request ID"),
        operation: OperationV1::RelayAuthSign,
        payload: request.clone(),
        deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
    };
    let encoded =
        encode_length_prefixed_frame(&frame, 1_700_000_000_000).expect("valid request frame");
    let result = broker
        .handle_relay_auth_frame(
            &encoded,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: &runtime,
            },
            1_700_000_000_000,
        )
        .expect("authorized signing");
    let decoded = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&result)
        .expect("valid result frame");
    decoded
        .result
        .validate_against(&request, 1_700_000_000)
        .expect("result is bound to exact NIP-98 request");
}

#[test]
fn luca_signing_broker_replays_the_same_public_signature_for_same_request_id() {
    let (mut broker, runtime) = fixture();
    let request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: broker.session.binding().resident_pubkey.clone(),
        purpose: RelayAuthPurposeV1::Nip42 {
            relay_url: "wss://relay.example.test".to_owned(),
            challenge: "relay-challenge".to_owned(),
            owner_attestation: None,
        },
    };
    let encode = |sequence| {
        encode_length_prefixed_frame(
            &SigningFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: SafeU53::new(4).expect("valid epoch"),
                sequence: SafeU53::new(sequence).expect("valid sequence"),
                request_id: OpaqueId::parse("stable-request").expect("valid request ID"),
                operation: OperationV1::RelayAuthSign,
                payload: request.clone(),
                deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
            },
            1_700_000_000_000,
        )
        .expect("valid request frame")
    };
    let caller = LocalBrokerCaller {
        acp_pid: 8123,
        runtime_configuration_sha256: &runtime,
    };
    let first = broker
        .handle_relay_auth_frame(&encode(1), caller, 1_700_000_000_000)
        .expect("first signing");
    let replay = broker
        .handle_relay_auth_frame(&encode(2), caller, 1_700_000_000_000)
        .expect("idempotent replay");
    let first =
        decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&first).expect("first result");
    let replay = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&replay)
        .expect("replay result");
    assert_eq!(first.result, replay.result);
}

#[test]
fn luca_signing_broker_message_unavailable_is_typed_and_session_remains_usable() {
    let (mut broker, runtime) = fixture();
    let request = publish_request(&broker);
    let publish = encoded_publish_frame(&broker, &request, 1, "publish-1");
    let caller = LocalBrokerCaller {
        acp_pid: 8123,
        runtime_configuration_sha256: &runtime,
    };
    let response = broker
        .handle_frame(&publish, caller, 1_700_000_000_000)
        .expect("typed unavailable response");
    let response = decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&response)
        .expect("valid publish result frame");
    assert!(matches!(
        response.result,
        ManagedMessagePublishResultV1::Unavailable { .. }
    ));

    let relay_request = RelayAuthSignRequestV1 {
        protocol: RELAY_AUTH_SIGN_PROTOCOL.to_owned(),
        resident_pubkey: broker.session.binding().resident_pubkey.clone(),
        purpose: RelayAuthPurposeV1::Nip42 {
            relay_url: "wss://relay.example.test".to_owned(),
            challenge: "challenge-after-publication".to_owned(),
            owner_attestation: None,
        },
    };
    let relay_frame = encode_length_prefixed_frame(
        &SigningFrameV1 {
            protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
            session_epoch: SafeU53::new(4).expect("valid epoch"),
            sequence: SafeU53::new(2).expect("valid sequence"),
            request_id: OpaqueId::parse("relay-after-publish").expect("valid request ID"),
            operation: OperationV1::RelayAuthSign,
            payload: relay_request.clone(),
            deadline_unix_ms: SafeU53::new(1_700_000_000_020).expect("valid deadline"),
        },
        1_700_000_000_000,
    )
    .expect("valid relay frame");
    let response = broker
        .handle_frame(&relay_frame, caller, 1_700_000_000_000)
        .expect("shared session remains usable");
    let response = decode_length_prefixed_result_frame::<RelayAuthSignResultV1>(&response)
        .expect("valid relay result frame");
    response
        .result
        .validate_against(&relay_request, 1_700_000_000)
        .expect("relay auth remains exact");
}

struct AcceptingPublicationAuthority {
    captured_event: Arc<Mutex<Option<String>>>,
}

impl ManagedMessagePublicationAuthority for AcceptingPublicationAuthority {
    fn authorize_request(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Ok(())
    }

    fn publish_prepared(
        &mut self,
        request: &ManagedMessagePublishRequestV1,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let event = outbox
            .event_for_submission(&request.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?
            .to_owned();
        *self.captured_event.lock().expect("capture lock") = Some(event);
        outbox
            .mark_submitted(&request.idempotency_key, installation_session_id, false)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        outbox
            .mark_accepted(
                &request.idempotency_key,
                OpaqueId::parse("publication-1").expect("valid publication receipt"),
            )
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        Ok(())
    }
}

#[test]
fn luca_signing_broker_constructs_exact_buzz_kind9_before_publication_adapter() {
    let keys = Keys::parse(&"01".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let binding = LocalBrokerSessionBinding {
        owner_pubkey: hex('a'),
        resident_pubkey: Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey"),
        acp_pid: 8123,
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        runtime_configuration_sha256: runtime.clone(),
        installation_session_id: OpaqueId::parse("installation-1").expect("valid installation ID"),
        relay_url: "wss://relay.example.test".to_owned(),
        relay_query_url: "https://relay.example.test/query".to_owned(),
        owner_attestation: None,
    };
    let captured_event = Arc::new(Mutex::new(None));
    let authority = AcceptingPublicationAuthority {
        captured_event: Arc::clone(&captured_event),
    };
    let mut broker =
        ResidentSigningBroker::new_with_publication_authority(keys, binding, Box::new(authority))
            .expect("matching broker");
    let request = publish_request(&broker);
    let frame = encoded_publish_frame(&broker, &request, 1, "publish-1");
    let response = broker
        .handle_frame(
            &frame,
            LocalBrokerCaller {
                acp_pid: 8123,
                runtime_configuration_sha256: &runtime,
            },
            1_700_000_000_000,
        )
        .expect("published response");
    let response = decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&response)
        .expect("valid response");
    assert!(matches!(
        response.result,
        ManagedMessagePublishResultV1::Published { .. }
    ));

    let event_json = captured_event
        .lock()
        .expect("capture lock")
        .clone()
        .expect("captured exact event");
    let event = nostr::Event::from_json(event_json).expect("valid event");
    assert_eq!(event.kind, Kind::Custom(9));
    assert_eq!(event.content, request.final_draft);
    assert_eq!(event.pubkey.to_hex(), request.resident_pubkey.as_str());
    let tags: Vec<Vec<String>> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice().to_vec())
        .collect();
    assert_eq!(
        tags,
        vec![
            vec!["h".to_owned(), "conversation-1".to_owned()],
            vec![
                "e".to_owned(),
                hex('d').as_str().to_owned(),
                String::new(),
                "root".to_owned(),
            ],
            vec![
                "e".to_owned(),
                hex('e').as_str().to_owned(),
                String::new(),
                "reply".to_owned(),
            ],
            vec!["p".to_owned(), hex('a').as_str().to_owned()],
            vec!["p".to_owned(), hex('f').as_str().to_owned()],
        ]
    );
}

struct DenyingCountingAuthority {
    authorize_calls: Arc<Mutex<usize>>,
}

impl ManagedMessagePublicationAuthority for DenyingCountingAuthority {
    fn authorize_request(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        *self.authorize_calls.lock().expect("counter") += 1;
        Err(ManagedPublicationAuthorityError::Denied)
    }

    fn publish_prepared(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _outbox: &mut ManagedMessageOutbox,
        _installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Err(ManagedPublicationAuthorityError::Denied)
    }
}

struct StartupPassAuthority {
    calls: Arc<Mutex<usize>>,
    defer_call: Option<usize>,
}

impl ManagedMessagePublicationAuthority for StartupPassAuthority {
    fn authorize_request(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _now_unix_secs: u64,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Ok(())
    }

    fn publish_prepared(
        &mut self,
        _request: &ManagedMessagePublishRequestV1,
        _outbox: &mut ManagedMessageOutbox,
        _installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        Err(ManagedPublicationAuthorityError::Unavailable)
    }

    fn reconcile_on_start(
        &mut self,
        outbox: &mut ManagedMessageOutbox,
        installation_session_id: &OpaqueId,
    ) -> Result<(), ManagedPublicationAuthorityError> {
        let call = {
            let mut calls = self.calls.lock().expect("calls");
            *calls += 1;
            *calls
        };
        if self.defer_call == Some(call) {
            return Err(ManagedPublicationAuthorityError::Unavailable);
        }
        let entry = outbox
            .reconciliation_entries()
            .into_iter()
            .next()
            .ok_or(ManagedPublicationAuthorityError::Invalid)?;
        outbox
            .mark_submitted(&entry.idempotency_key, installation_session_id, false)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        outbox
            .mark_accepted(
                &entry.idempotency_key,
                OpaqueId::parse(format!("startup-publication-{call}"))
                    .expect("publication receipt"),
            )
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        outbox
            .mark_authority_finalized(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
        // A terminal accepted row also requires the post-publication
        // continuity handoff to be durably accounted for. Production
        // reconciliation performs this step; keep the startup-pass test
        // authority faithful to that complete lifecycle.
        outbox
            .mark_handoff_recorded(&entry.idempotency_key)
            .map_err(|_| ManagedPublicationAuthorityError::Invalid)
    }
}

fn startup_pass_broker(
    defer_call: Option<usize>,
    calls: Arc<Mutex<usize>>,
) -> ResidentSigningBroker {
    let keys = Keys::parse(&"0c".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let binding = LocalBrokerSessionBinding {
        owner_pubkey: hex('a'),
        resident_pubkey: Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey"),
        acp_pid: 8123,
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        runtime_configuration_sha256: runtime,
        installation_session_id: OpaqueId::parse("installation-startup-pass")
            .expect("installation ID"),
        relay_url: "wss://relay.example.test".to_owned(),
        relay_query_url: "https://relay.example.test/query".to_owned(),
        owner_attestation: None,
    };
    let mut broker = ResidentSigningBroker::new_with_publication_authority(
        keys,
        binding,
        Box::new(StartupPassAuthority { calls, defer_call }),
    )
    .expect("matching broker");
    let installation_session_id = broker.session.binding().installation_session_id.clone();
    for index in 0..2 {
        let mut request = publish_request(&broker);
        request.dispatch_receipt_id =
            OpaqueId::parse(format!("startup-dispatch-{index}")).expect("dispatch receipt");
        request.turn_id = OpaqueId::parse(format!("startup-turn-{index}")).expect("turn ID");
        request.idempotency_key = derive_message_publish_idempotency_key(
            &request.dispatch_receipt_id,
            &request.resident_pubkey,
        )
        .expect("idempotency key");
        request.final_draft = format!("Frozen startup final {index}");
        let event_json = broker
            .build_managed_message_event(&request, 1_700_000_000 + index)
            .expect("event");
        let event = FrozenManagedMessageEvent::parse(event_json, &request).expect("frozen");
        broker
            .message_outbox
            .prepare(
                &request,
                event,
                &installation_session_id,
                request.cancellation_epoch.get(),
                false,
            )
            .expect("prepare startup entry");
    }
    broker
}

#[test]
fn startup_pass_reports_fully_terminal_after_attempting_two_frozen_entries_once() {
    let calls = Arc::new(Mutex::new(0));
    let mut broker = startup_pass_broker(None, Arc::clone(&calls));

    assert_eq!(
        broker.reconcile_publication_outbox_startup_pass(),
        StartupOutboxReconciliation::FullyTerminal
    );
    assert_eq!(*calls.lock().expect("calls"), 2);
    assert!(broker.message_outbox.reconciliation_entries().is_empty());
}

#[test]
fn startup_pass_reports_deferred_and_preserves_one_of_two_frozen_entries() {
    let calls = Arc::new(Mutex::new(0));
    let mut broker = startup_pass_broker(Some(2), Arc::clone(&calls));

    assert_eq!(
        broker.reconcile_publication_outbox_startup_pass(),
        StartupOutboxReconciliation::Deferred
    );
    assert_eq!(*calls.lock().expect("calls"), 2);
    assert_eq!(broker.message_outbox.reconciliation_entries().len(), 1);
}

#[test]
fn luca_signing_broker_desktop_restart_replays_exact_accepted_request_before_fresh_authority() {
    let keys = Keys::parse(&"0b".repeat(32)).expect("valid fixture key");
    let runtime = hex('c');
    let binding = LocalBrokerSessionBinding {
        owner_pubkey: hex('a'),
        resident_pubkey: Hex64::parse(keys.public_key().to_hex()).expect("valid resident pubkey"),
        acp_pid: 8123,
        session_epoch: SafeU53::new(4).expect("valid epoch"),
        runtime_configuration_sha256: runtime,
        installation_session_id: OpaqueId::parse("installation-restart")
            .expect("valid installation ID"),
        relay_url: "wss://relay.example.test".to_owned(),
        relay_query_url: "https://relay.example.test/query".to_owned(),
        owner_attestation: None,
    };
    let outbox_path = tempfile::tempdir()
        .expect("temp")
        .keep()
        .join("managed-outbox.age");
    let captured_event = Arc::new(Mutex::new(None));
    let mut first = ResidentSigningBroker::new_persistent_with_publication_authority(
        keys.clone(),
        binding.clone(),
        outbox_path.clone(),
        Box::new(AcceptingPublicationAuthority {
            captured_event: Arc::clone(&captured_event),
        }),
    )
    .expect("first broker");
    let request = publish_request(&first);
    assert!(matches!(
        first.prepare_and_publish_message(&request, 1_700_000_000),
        ManagedMessagePublishResultV1::Published { .. }
    ));
    drop(first);

    let authorize_calls = Arc::new(Mutex::new(0));
    let mut restarted = ResidentSigningBroker::new_persistent_with_publication_authority(
        keys,
        binding,
        outbox_path,
        Box::new(DenyingCountingAuthority {
            authorize_calls: Arc::clone(&authorize_calls),
        }),
    )
    .expect("restarted broker");
    assert!(matches!(
        restarted.prepare_and_publish_message(&request, 1_700_000_001),
        ManagedMessagePublishResultV1::Replayed { .. }
    ));
    assert_eq!(*authorize_calls.lock().expect("counter"), 0);
}

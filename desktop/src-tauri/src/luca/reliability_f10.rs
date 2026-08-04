//! F10's generated continuity-absent conversation fault harness.
//!
//! The harness is test-only, but it drives the production desktop dispatch,
//! signing-broker and exact-event outbox state machines. It deliberately has no
//! Continuity Capsule, Continuity Service, or Mnemos handle to substitute.

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use luca_protocol::{
        decode_length_prefixed_result_frame, derive_message_publish_idempotency_key,
        encode_length_prefixed_frame, Hex64, ManagedMessagePublishRequestV1,
        ManagedMessagePublishResultV1, OpaqueId, OperationV1, SafeU53, SigningFrameV1,
        MESSAGE_PUBLISH_PROTOCOL, SIGNING_FRAME_PROTOCOL,
    };
    use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag, Timestamp};
    use serde::{Deserialize, Serialize};

    use super::super::{
        local_broker_session::{LocalBrokerCaller, LocalBrokerSessionBinding},
        managed_dispatch_store::{DispatchAuthorizationError, ManagedDispatchStore},
        managed_message_outbox::{
            ManagedMessageOutbox, ManagedMessagePublicationAuthority,
            ManagedPublicationAuthorityError,
        },
        signing_broker::ResidentSigningBroker,
    };

    const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";
    const NOW_SECS: u64 = 1_700_000_000;
    const NOW_MS: u64 = NOW_SECS * 1_000;
    const SESSION_EPOCH: u64 = 7;

    #[derive(Debug, Deserialize)]
    struct ContinuityAbsentFixture {
        schema: String,
        scenario_id: String,
        fixture_class: String,
        components: ContinuityComponents,
        expected: ExpectedOutcomes,
    }

    #[derive(Debug, Deserialize)]
    struct ContinuityComponents {
        continuity_capsule: String,
        continuity_service: String,
        mnemos_profile: String,
    }

    #[derive(Debug, Deserialize)]
    struct ExpectedOutcomes {
        context_status: String,
        normal_final_publication: String,
        cancelled_turn: String,
        published_final_count: usize,
        cancelled_final_count: usize,
    }

    #[derive(Debug, Serialize)]
    struct ConversationSurvivalTrace {
        schema: &'static str,
        scenario_id: String,
        context_status: String,
        normal_final_publication: &'static str,
        cancelled_turn: &'static str,
        published_final_count: usize,
        cancelled_final_count: usize,
        protected_artifacts_emitted: bool,
    }

    fn absent_fixture() -> ContinuityAbsentFixture {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/luca-conformance/f10/continuity_absent.json"
        )))
        .expect("F10 fixture must be valid JSON")
    }

    fn assert_all_continuity_absent(fixture: &ContinuityAbsentFixture) {
        assert_eq!(fixture.schema, "luca.f10.continuity-absent.v1");
        assert_eq!(fixture.fixture_class, "generated_synthetic");
        assert_eq!(fixture.components.continuity_capsule, "absent");
        assert_eq!(fixture.components.continuity_service, "absent");
        assert_eq!(fixture.components.mnemos_profile, "absent");
        assert_eq!(fixture.expected.context_status, "unavailable");
    }

    fn opaque(value: impl Into<String>) -> OpaqueId {
        OpaqueId::parse(value.into()).expect("valid synthetic opaque ID")
    }

    fn map_dispatch_error(error: DispatchAuthorizationError) -> ManagedPublicationAuthorityError {
        match error {
            DispatchAuthorizationError::Cancelled => ManagedPublicationAuthorityError::Cancelled,
            DispatchAuthorizationError::Persistence => {
                ManagedPublicationAuthorityError::Unavailable
            }
            DispatchAuthorizationError::Unknown
            | DispatchAuthorizationError::Ambiguous
            | DispatchAuthorizationError::Expired
            | DispatchAuthorizationError::Terminal
            | DispatchAuthorizationError::WrongOwner
            | DispatchAuthorizationError::WrongResident
            | DispatchAuthorizationError::WrongConversation
            | DispatchAuthorizationError::WrongThread
            | DispatchAuthorizationError::WrongRecipients
            | DispatchAuthorizationError::WrongSession => ManagedPublicationAuthorityError::Denied,
        }
    }

    struct StoreBackedAcceptingAuthority {
        store: Arc<Mutex<ManagedDispatchStore>>,
        published_final_count: Arc<Mutex<usize>>,
    }

    impl ManagedMessagePublicationAuthority for StoreBackedAcceptingAuthority {
        fn authorize_request(
            &mut self,
            request: &ManagedMessagePublishRequestV1,
            now_unix_secs: u64,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            self.store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .authorize_publication(request, now_unix_secs)
                .map(|_| ())
                .map_err(map_dispatch_error)
        }

        fn publish_prepared(
            &mut self,
            request: &ManagedMessagePublishRequestV1,
            outbox: &mut ManagedMessageOutbox,
            installation_session_id: &OpaqueId,
        ) -> Result<(), ManagedPublicationAuthorityError> {
            let event_json = outbox
                .event_for_submission(&request.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?
                .to_owned();
            let event = nostr::Event::from_json(event_json)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            let event_id = event.id.to_hex();

            {
                let mut store = self
                    .store
                    .lock()
                    .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
                store
                    .recheck_before_submit(
                        request.dispatch_receipt_id.as_str(),
                        request.resident_pubkey.as_str(),
                        request.cancellation_epoch.get(),
                    )
                    .map_err(map_dispatch_error)?;
                store
                    .begin_submission(
                        request.dispatch_receipt_id.as_str(),
                        request.resident_pubkey.as_str(),
                        request.cancellation_epoch.get(),
                        &event_id,
                    )
                    .map_err(map_dispatch_error)?;
            }
            outbox
                .mark_submitted(&request.idempotency_key, installation_session_id, false)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            self.store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .mark_published(
                    request.dispatch_receipt_id.as_str(),
                    request.resident_pubkey.as_str(),
                    &event_id,
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            outbox
                .mark_accepted(&request.idempotency_key, opaque(event_id.clone()))
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            self.store
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?
                .finalize_published_outbox(
                    request.dispatch_receipt_id.as_str(),
                    request.resident_pubkey.as_str(),
                    &event_id,
                )
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)?;
            outbox
                .mark_authority_finalized(&request.idempotency_key)
                .map_err(|_| ManagedPublicationAuthorityError::Invalid)?;
            *self
                .published_final_count
                .lock()
                .map_err(|_| ManagedPublicationAuthorityError::Unavailable)? += 1;
            Ok(())
        }
    }

    fn owner_trigger(owner: &Keys, resident: &Keys, content: &str) -> nostr::Event {
        EventBuilder::new(Kind::Custom(9), content)
            .tags([
                Tag::parse(["h", CHANNEL]).expect("synthetic h tag"),
                Tag::public_key(owner.public_key()),
                Tag::public_key(resident.public_key()),
            ])
            .custom_created_at(Timestamp::from(NOW_SECS))
            .sign_with_keys(owner)
            .expect("sign generated owner fixture")
    }

    fn publish_request(
        owner: &Keys,
        resident: &Keys,
        trigger: &nostr::Event,
        final_draft: &str,
    ) -> ManagedMessagePublishRequestV1 {
        let owner_pubkey = Hex64::parse(owner.public_key().to_hex()).expect("generated owner");
        let resident_pubkey =
            Hex64::parse(resident.public_key().to_hex()).expect("generated resident");
        let trigger_id = Hex64::parse(trigger.id.to_hex()).expect("generated trigger ID");
        let dispatch_receipt_id = opaque(trigger.id.to_hex());
        ManagedMessagePublishRequestV1 {
            protocol: MESSAGE_PUBLISH_PROTOCOL.to_owned(),
            turn_id: opaque(trigger.id.to_hex()),
            idempotency_key: derive_message_publish_idempotency_key(
                &dispatch_receipt_id,
                &resident_pubkey,
            )
            .expect("synthetic idempotency key"),
            owner_pubkey: owner_pubkey.clone(),
            resident_pubkey,
            conversation_id: opaque(CHANNEL),
            thread_id: Some(opaque(format!("thread:{}", trigger.id.to_hex()))),
            root_event_id: Some(trigger_id.clone()),
            reply_event_id: Some(trigger_id),
            resolved_p_tags: vec![owner_pubkey],
            final_draft: final_draft.to_owned(),
            dispatch_receipt_id,
            cancellation_epoch: SafeU53::new(SESSION_EPOCH).expect("synthetic epoch"),
        }
    }

    fn encoded_frame(
        epoch: SafeU53,
        request: ManagedMessagePublishRequestV1,
        sequence: u64,
    ) -> Vec<u8> {
        encode_length_prefixed_frame(
            &SigningFrameV1 {
                protocol: SIGNING_FRAME_PROTOCOL.to_owned(),
                session_epoch: epoch,
                sequence: SafeU53::new(sequence).expect("synthetic sequence"),
                request_id: opaque(format!("f10-request-{sequence}")),
                operation: OperationV1::MessagePublish,
                payload: request,
                deadline_unix_ms: SafeU53::new(NOW_MS + 30_000).expect("synthetic deadline"),
            },
            NOW_MS,
        )
        .expect("encode synthetic publication frame")
    }

    #[test]
    fn luca_f10_real_publication_and_dispatch_cancellation_survive_total_continuity_absence() {
        let fixture = absent_fixture();
        assert_all_continuity_absent(&fixture);

        let owner = Keys::generate();
        let resident = Keys::generate();
        let normal_trigger = owner_trigger(&owner, &resident, "synthetic normal trigger");
        let cancelled_trigger = owner_trigger(&owner, &resident, "synthetic cancelled trigger");
        let temp = tempfile::tempdir().expect("synthetic dispatch directory");
        let mut dispatch_store = ManagedDispatchStore::load(temp.path().join("dispatches.json"))
            .expect("synthetic dispatch store");
        for trigger in [&normal_trigger, &cancelled_trigger] {
            dispatch_store
                .stage_owner_event(trigger, &[resident.public_key().to_hex()], NOW_SECS)
                .expect("stage generated owner dispatch");
        }
        dispatch_store
            .activate_session(&resident.public_key().to_hex(), SESSION_EPOCH)
            .expect("activate generated resident session");
        let dispatch_store = Arc::new(Mutex::new(dispatch_store));
        let published_final_count = Arc::new(Mutex::new(0_usize));
        let runtime_configuration_sha256 =
            Hex64::parse("c".repeat(64)).expect("synthetic runtime digest");
        let session_epoch = SafeU53::new(SESSION_EPOCH).expect("synthetic epoch");
        let binding = LocalBrokerSessionBinding {
            owner_pubkey: Hex64::parse(owner.public_key().to_hex()).expect("generated owner"),
            resident_pubkey: Hex64::parse(resident.public_key().to_hex())
                .expect("generated resident"),
            acp_pid: 8123,
            session_epoch,
            runtime_configuration_sha256: runtime_configuration_sha256.clone(),
            installation_session_id: opaque("f10-synthetic-installation"),
            relay_url: "wss://relay.example.test".to_owned(),
            relay_query_url: "https://relay.example.test/query".to_owned(),
            owner_attestation: None,
        };
        let mut broker = ResidentSigningBroker::new_with_publication_authority(
            resident.clone(),
            binding,
            Box::new(StoreBackedAcceptingAuthority {
                store: Arc::clone(&dispatch_store),
                published_final_count: Arc::clone(&published_final_count),
            }),
        )
        .expect("generated resident broker");
        let caller = LocalBrokerCaller {
            acp_pid: 8123,
            runtime_configuration_sha256: &runtime_configuration_sha256,
        };

        let normal_request = publish_request(
            &owner,
            &resident,
            &normal_trigger,
            "synthetic final response",
        );
        let normal_response = broker
            .handle_message_publish_frame(
                &encoded_frame(session_epoch, normal_request, 1),
                caller,
                NOW_MS,
            )
            .expect("normal publication survives absent continuity");
        let normal_response =
            decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(&normal_response)
                .expect("decode normal body-free receipt");
        assert!(matches!(
            normal_response.result,
            ManagedMessagePublishResultV1::Published { .. }
        ));

        assert_eq!(
            dispatch_store
                .lock()
                .expect("dispatch store")
                .cancel_matching(
                    &owner.public_key().to_hex(),
                    CHANNEL,
                    Some(&format!("thread:{}", cancelled_trigger.id.to_hex())),
                    &[resident.public_key().to_hex()],
                )
                .expect("real desktop dispatch cancellation"),
            1
        );
        let cancelled_request = publish_request(
            &owner,
            &resident,
            &cancelled_trigger,
            "synthetic final that must not publish",
        );
        let cancelled_response = broker
            .handle_message_publish_frame(
                &encoded_frame(session_epoch, cancelled_request, 2),
                caller,
                NOW_MS,
            )
            .expect("cancellation survives absent continuity");
        let cancelled_response =
            decode_length_prefixed_result_frame::<ManagedMessagePublishResultV1>(
                &cancelled_response,
            )
            .expect("decode cancelled body-free receipt");
        assert!(matches!(
            cancelled_response.result,
            ManagedMessagePublishResultV1::Cancelled { .. }
        ));

        let published = *published_final_count.lock().expect("publication count");
        assert_eq!(published, fixture.expected.published_final_count);
        assert_eq!(fixture.expected.cancelled_final_count, 0);
        assert_eq!(fixture.expected.normal_final_publication, "published");
        assert_eq!(fixture.expected.cancelled_turn, "cancelled");

        let trace = ConversationSurvivalTrace {
            schema: "luca.f10.conversation-survival-trace.v1",
            scenario_id: fixture.scenario_id,
            context_status: fixture.expected.context_status,
            normal_final_publication: "published",
            cancelled_turn: "cancelled",
            published_final_count: published,
            cancelled_final_count: 0,
            protected_artifacts_emitted: false,
        };
        println!(
            "LUCA_F10_TRACE={}",
            serde_json::to_string(&trace).expect("serialize body-free trace")
        );
    }
}

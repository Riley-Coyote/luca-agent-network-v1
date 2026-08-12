use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;

use super::*;

const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const RESIDENT: &str = "2222222222222222222222222222222222222222222222222222222222222222";
const OTHER_RESIDENT: &str = "3333333333333333333333333333333333333333333333333333333333333333";
const EXTERNAL: &str = "4444444444444444444444444444444444444444444444444444444444444444";
const EVENT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

struct TestAuthority {
    context: CommunicationBrokerContext,
    calls: AtomicUsize,
    fail_on_call: Mutex<Option<usize>>,
    active: AtomicBool,
}

impl TestAuthority {
    fn new(context: CommunicationBrokerContext) -> Self {
        Self {
            context,
            calls: AtomicUsize::new(0),
            fail_on_call: Mutex::new(None),
            active: AtomicBool::new(true),
        }
    }

    fn fail_on_call(&self, call: usize) {
        *self.fail_on_call.lock().expect("test authority") = Some(call);
    }
}

impl CommunicationTurnAuthority for TestAuthority {
    fn recheck(
        &self,
        context: &CommunicationBrokerContext,
        coordinates: &CommunicationTurnCoordinates,
    ) -> Result<CommunicationTurnAuthoritySnapshot, BrokerFailure> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        if !self.active.load(Ordering::SeqCst)
            || self
                .fail_on_call
                .lock()
                .expect("test authority")
                .is_some_and(|failure_call| failure_call == call)
        {
            return Err(BrokerFailure::turn_not_active());
        }
        if context.owner_pubkey != self.context.owner_pubkey
            || context.resident_pubkey != self.context.resident_pubkey
            || context.session_epoch != self.context.session_epoch
            || context.binding_ref != self.context.binding_ref
            || coordinates.cancellation_epoch != context.session_epoch
        {
            return Err(BrokerFailure::stale_turn());
        }
        Ok(CommunicationTurnAuthoritySnapshot {
            owner_pubkey: context.owner_pubkey.clone(),
            resident_pubkey: context.resident_pubkey.clone(),
            session_epoch: context.session_epoch,
            runtime_binding_ref: context.binding_ref.clone(),
            coordinates: coordinates.clone(),
            causal_root_id: coordinates.dispatch_receipt_id.clone(),
            owned_resident_pubkeys: [context.resident_pubkey.clone(), hex64(OTHER_RESIDENT)]
                .into_iter()
                .collect(),
            expires_at: CanonicalTimestamp::parse("2099-01-01T00:00:00Z").expect("expiry"),
        })
    }
}

#[derive(Default)]
struct TestBackend {
    conversations: Mutex<HashMap<String, CommunicationConversationAuthority>>,
    staged: Mutex<
        Vec<(
            CommunicationActionRequestV1,
            CommunicationTurnAuthoritySnapshot,
        )>,
    >,
    inbox_scopes: Mutex<Vec<CommunicationReadScope>>,
    conversation_scopes: Mutex<Vec<CommunicationReadScope>>,
}

impl TestBackend {
    fn owner_visible_conversation() -> CommunicationConversationAuthority {
        CommunicationConversationAuthority {
            conversation_id: opaque("conversation-1"),
            participant_pubkeys: [hex64(OWNER), hex64(RESIDENT), hex64(OTHER_RESIDENT)]
                .into_iter()
                .collect(),
            participant_set_version: safe(3),
            agent_may_invite_same_owner: true,
            read_only: false,
        }
    }

    fn insert_conversation(&self, conversation: CommunicationConversationAuthority) {
        self.conversations
            .lock()
            .expect("test conversations")
            .insert(
                conversation.conversation_id.as_str().to_owned(),
                conversation,
            );
    }
}

impl CommunicationBrokerBackend for TestBackend {
    fn read_inbox(
        &self,
        scope: &CommunicationReadScope,
        _query: &CommunicationInboxQuery,
    ) -> Result<Value, BrokerFailure> {
        self.inbox_scopes
            .lock()
            .expect("test inbox scopes")
            .push(scope.clone());
        Ok(json!({"items": [], "resident": scope.resident_pubkey.as_str()}))
    }

    fn read_conversation(
        &self,
        scope: &CommunicationReadScope,
        query: &CommunicationConversationQuery,
    ) -> Result<Value, BrokerFailure> {
        self.conversation_scopes
            .lock()
            .expect("test conversation scopes")
            .push(scope.clone());
        Ok(json!({"messages": [], "conversation": query.conversation_id.as_str()}))
    }

    fn conversation_authority(
        &self,
        _scope: &CommunicationReadScope,
        conversation_id: &OpaqueId,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        self.conversations
            .lock()
            .expect("test conversations")
            .get(conversation_id.as_str())
            .cloned()
            .ok_or_else(BrokerFailure::membership_denied)
    }

    fn resolve_artifact_handles(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: Option<&OpaqueId>,
        handle_ids: &[OpaqueId],
    ) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure> {
        if handle_ids.is_empty() {
            Ok(Vec::new())
        } else {
            Err(BrokerFailure::artifact_denied())
        }
    }

    fn require_event_in_conversation(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: &OpaqueId,
        event_id: &Hex64,
    ) -> Result<(), BrokerFailure> {
        if event_id == &hex64(EVENT) {
            Ok(())
        } else {
            Err(BrokerFailure::membership_denied())
        }
    }

    fn reaction_author(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: &OpaqueId,
        reaction_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        if reaction_event_id == &hex64(EVENT) {
            Ok(authority.resident_pubkey.clone())
        } else {
            Ok(hex64(OTHER_RESIDENT))
        }
    }

    fn stage_action(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        self.staged
            .lock()
            .expect("test staged actions")
            .push((request.clone(), expected_authority.clone()));
        Ok(StagedCommunicationAction {
            action_id: request.action_id,
            idempotency_key: request.idempotency_key,
            state: "prepared",
        })
    }
}

struct Fixture {
    core: CommunicationBridgeCore,
    authority: Arc<TestAuthority>,
    backend: Arc<TestBackend>,
}

impl Fixture {
    fn new() -> Self {
        let context = CommunicationBrokerContext {
            owner_pubkey: hex64(OWNER),
            resident_pubkey: hex64(RESIDENT),
            session_epoch: safe(7),
            binding_ref: sha256_ref('b'),
        };
        let authority = Arc::new(TestAuthority::new(context.clone()));
        let backend = Arc::new(TestBackend::default());
        backend.insert_conversation(TestBackend::owner_visible_conversation());
        Self {
            core: CommunicationBridgeCore {
                active: Arc::new(AtomicBool::new(true)),
                context,
                master_capability: Zeroizing::new(sha256_ref('c').as_str().to_owned()),
                capability_generation: safe(11),
                authority: authority.clone(),
                backend: backend.clone(),
            },
            authority,
            backend,
        }
    }

    fn frame(&self, operation: &str, arguments: Value) -> CommunicationBrokerFrameV1 {
        let coordinates = CommunicationTurnCoordinates {
            source_conversation_id: opaque("conversation-1"),
            turn_id: opaque("turn-1"),
            dispatch_receipt_id: opaque("dispatch-1"),
            cancellation_epoch: safe(7),
        };
        CommunicationBrokerFrameV1 {
            protocol: BROKER_PROTOCOL.into(),
            capability: derive_turn_capability(
                self.core.master_capability.as_str(),
                self.core.capability_generation,
                &self.core.context.resident_pubkey,
                self.core.context.session_epoch,
                &self.core.context.binding_ref,
                &coordinates,
            ),
            capability_generation: self.core.capability_generation.get(),
            source_conversation_id: coordinates.source_conversation_id.as_str().to_owned(),
            turn_id: coordinates.turn_id.as_str().to_owned(),
            dispatch_receipt_id: coordinates.dispatch_receipt_id.as_str().to_owned(),
            cancellation_epoch: coordinates.cancellation_epoch.get(),
            operation_request_id: "operation-1".into(),
            operation: operation.into(),
            arguments,
        }
    }

    fn response(&self, operation: &str, arguments: Value) -> CommunicationBrokerResponseV1 {
        self.core.handle_frame(self.frame(operation, arguments))
    }
}

#[test]
fn stale_generation_turn_and_epoch_fail_closed() {
    let fixture = Fixture::new();
    let mut stale_generation = fixture.frame("inbox", json!({}));
    stale_generation.capability_generation += 1;
    let response = fixture.core.handle_frame(stale_generation);
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("stale_capability"));
    assert_eq!(fixture.authority.calls.load(Ordering::SeqCst), 0);

    let mut stale_epoch = fixture.frame("inbox", json!({}));
    stale_epoch.cancellation_epoch = 8;
    let stale_coordinates = parse_coordinates(&stale_epoch).expect("coordinates");
    stale_epoch.capability = derive_turn_capability(
        fixture.core.master_capability.as_str(),
        fixture.core.capability_generation,
        &fixture.core.context.resident_pubkey,
        fixture.core.context.session_epoch,
        &fixture.core.context.binding_ref,
        &stale_coordinates,
    );
    let response = fixture.core.handle_frame(stale_epoch);
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("stale_turn"));

    fixture.authority.active.store(false, Ordering::SeqCst);
    let response = fixture.response("inbox", json!({}));
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("turn_not_active"));
}

#[test]
fn cancellation_between_parse_and_staging_prevents_the_action() {
    let fixture = Fixture::new();
    fixture.authority.fail_on_call(2);
    let response = fixture.response(
        "send",
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "hello",
        }),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("turn_not_active"));
    assert!(fixture.backend.staged.lock().expect("staged").is_empty());
}

#[test]
fn raw_paths_and_raw_events_are_not_representable() {
    let fixture = Fixture::new();
    for arguments in [
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "hello",
            "file_path": "/Users/example/secret.txt",
        }),
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "hello",
            "raw_event": {"kind": 1, "tags": [], "content": "forged"},
        }),
    ] {
        let response = fixture.response("send", arguments);
        assert!(!response.ok);
        assert_eq!(response.receipt.diagnostic_code, Some("invalid_arguments"));
    }
    assert!(fixture.backend.staged.lock().expect("staged").is_empty());
}

#[test]
fn reads_are_owner_visible_and_resident_isolated() {
    let fixture = Fixture::new();
    let response = fixture.response("inbox", json!({"category": "all"}));
    assert!(response.ok);
    let scopes = fixture.backend.inbox_scopes.lock().expect("inbox scopes");
    assert_eq!(scopes.len(), 1);
    assert_eq!(scopes[0].resident_pubkey, hex64(RESIDENT));
    drop(scopes);

    let response = fixture.response("inbox", json!({"resident_pubkey": OTHER_RESIDENT}));
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("invalid_arguments"));

    fixture
        .backend
        .insert_conversation(CommunicationConversationAuthority {
            conversation_id: opaque("resident-excluded"),
            participant_pubkeys: [hex64(OWNER), hex64(OTHER_RESIDENT)].into_iter().collect(),
            participant_set_version: safe(1),
            agent_may_invite_same_owner: true,
            read_only: false,
        });
    let response = fixture.response(
        "conversation",
        json!({"conversation_id": "resident-excluded"}),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("membership_denied"));
}

#[test]
fn direct_agent_message_is_forced_owner_visible_and_external_delivery_is_denied() {
    let fixture = Fixture::new();
    let response = fixture.response(
        "send",
        json!({
            "destination": {
                "destination_type": "direct_participants",
                "participant_pubkeys": [OTHER_RESIDENT],
            },
            "body": "owner-visible A2A",
            "mention_pubkeys": [OTHER_RESIDENT],
            "activation_pubkeys": [OTHER_RESIDENT],
        }),
    );
    assert!(response.ok);
    let staged = fixture.backend.staged.lock().expect("staged");
    let (request, authority) = staged.last().expect("staged request");
    assert_eq!(authority.resident_pubkey, hex64(RESIDENT));
    let CommunicationDestinationV1::DirectParticipants {
        participant_pubkeys,
        ..
    } = &request.destination
    else {
        panic!("direct destination");
    };
    assert_eq!(
        participant_pubkeys,
        &vec![hex64(OWNER), hex64(RESIDENT), hex64(OTHER_RESIDENT)]
    );
    drop(staged);

    let response = fixture.response(
        "send",
        json!({
            "destination": {
                "destination_type": "direct_participants",
                "participant_pubkeys": [EXTERNAL],
            },
            "body": "must not leave owner network",
        }),
    );
    assert!(!response.ok);
    assert_eq!(
        response.receipt.diagnostic_code,
        Some("same_owner_required")
    );
}

#[test]
fn existing_external_membership_requires_approval_and_invites_require_custody() {
    let fixture = Fixture::new();
    fixture
        .backend
        .insert_conversation(CommunicationConversationAuthority {
            conversation_id: opaque("external-room"),
            participant_pubkeys: [hex64(OWNER), hex64(RESIDENT), hex64(EXTERNAL)]
                .into_iter()
                .collect(),
            participant_set_version: safe(2),
            agent_may_invite_same_owner: true,
            read_only: false,
        });
    let response = fixture.response(
        "send",
        json!({
            "destination": {
                "destination_type": "existing_conversation",
                "conversation_id": "external-room",
            },
            "body": "requires approval",
        }),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("approval_required"));

    let response = fixture.response("invite", json!({"participant_pubkey": EXTERNAL}));
    assert!(!response.ok);
    assert_eq!(
        response.receipt.diagnostic_code,
        Some("same_owner_required")
    );
}

#[test]
fn action_identity_and_expiry_are_retry_stable() {
    let fixture = Fixture::new();
    let coordinates = CommunicationTurnCoordinates {
        source_conversation_id: opaque("conversation-1"),
        turn_id: opaque("turn-1"),
        dispatch_receipt_id: opaque("dispatch-1"),
        cancellation_epoch: safe(7),
    };
    let authority = fixture
        .authority
        .recheck(&fixture.core.context, &coordinates)
        .expect("authority");
    let destination = TestBackend::owner_visible_conversation()
        .destination()
        .expect("destination");
    let operation = CommunicationOperationV1::AddReaction {
        target_event_id: hex64(EVENT),
        reaction: "+1".into(),
    };
    let first = build_action_request(
        &authority,
        &opaque("operation-stable"),
        destination.clone(),
        operation.clone(),
    )
    .expect("first request");
    let second = build_action_request(
        &authority,
        &opaque("operation-stable"),
        destination.clone(),
        operation.clone(),
    )
    .expect("second request");
    assert_eq!(first.action_id, second.action_id);
    assert_eq!(first.idempotency_key, second.idempotency_key);
    assert_eq!(first.expires_at, second.expires_at);
    let third = build_action_request(
        &authority,
        &opaque("operation-distinct"),
        destination,
        operation,
    )
    .expect("third request");
    assert_ne!(first.action_id, third.action_id);
    assert_ne!(first.idempotency_key, third.idempotency_key);
}

#[test]
fn capability_uses_hmac_sha256_and_connection_count_is_bounded() {
    let key = [0x0bu8; 20];
    let digest = hmac_sha256(&key, b"Hi There");
    assert_eq!(
        hex::encode(digest),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );

    let active = Arc::new(AtomicUsize::new(0));
    let permits = (0..MAX_CONCURRENT_CONNECTIONS)
        .map(|_| try_acquire_connection(&active).expect("permit"))
        .collect::<Vec<_>>();
    assert!(try_acquire_connection(&active).is_none());
    drop(permits);
    assert!(try_acquire_connection(&active).is_some());
}

fn hex64(value: &str) -> Hex64 {
    Hex64::parse(value.to_owned()).expect("hex64")
}

fn opaque(value: &str) -> OpaqueId {
    OpaqueId::parse(value.to_owned()).expect("opaque id")
}

fn safe(value: u64) -> SafeU53 {
    SafeU53::new(value).expect("safe u53")
}

fn sha256_ref(fill: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", fill.to_string().repeat(64))).expect("sha256 ref")
}

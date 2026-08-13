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
    descendant: AtomicBool,
}

impl TestAuthority {
    fn new(context: CommunicationBrokerContext) -> Self {
        Self {
            context,
            calls: AtomicUsize::new(0),
            fail_on_call: Mutex::new(None),
            active: AtomicBool::new(true),
            descendant: AtomicBool::new(false),
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
            causal_root_id: if self.descendant.load(Ordering::SeqCst) {
                opaque("owner-root-dispatch")
            } else {
                coordinates.dispatch_receipt_id.clone()
            },
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
    direct_resolutions: Mutex<Vec<BTreeSet<Hex64>>>,
    created_rooms: Mutex<Vec<(OpaqueId, String, Option<String>, BTreeSet<Hex64>)>>,
    invitations: Mutex<Vec<(OpaqueId, Hex64)>>,
    staged: Mutex<
        Vec<(
            CommunicationActionRequestV1,
            CommunicationTurnAuthoritySnapshot,
        )>,
    >,
    approved: Mutex<
        Vec<(
            CommunicationActionRequestV1,
            CommunicationTurnAuthoritySnapshot,
        )>,
    >,
    approval_allowed: AtomicBool,
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

    fn resolve_direct_conversation(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        self.direct_resolutions
            .lock()
            .expect("direct resolutions")
            .push(participant_pubkeys.clone());
        Ok(CommunicationConversationAuthority {
            conversation_id: opaque("resolved-direct"),
            participant_pubkeys: participant_pubkeys.clone(),
            participant_set_version: safe(4),
            agent_may_invite_same_owner: true,
            read_only: false,
        })
    }

    fn create_private_room(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        label: &str,
        purpose: Option<&str>,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<ManagedConversationMutation, BrokerFailure> {
        self.created_rooms.lock().expect("created rooms").push((
            operation_request_id.clone(),
            label.to_owned(),
            purpose.map(str::to_owned),
            participant_pubkeys.clone(),
        ));
        Ok(ManagedConversationMutation {
            conversation_id: opaque("managed-room"),
            state: "created_or_existing",
        })
    }

    fn invite_same_owner_resident(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        participant_pubkey: &Hex64,
    ) -> Result<ManagedConversationMutation, BrokerFailure> {
        self.invitations
            .lock()
            .expect("invitations")
            .push((conversation_id.clone(), participant_pubkey.clone()));
        Ok(ManagedConversationMutation {
            conversation_id: conversation_id.clone(),
            state: "member_added_or_present",
        })
    }

    fn resolve_artifact_handles(
        &self,
        _authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: Option<&OpaqueId>,
        handle_ids: &[OpaqueId],
    ) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure> {
        if handle_ids.is_empty() {
            Ok(Vec::new())
        } else if handle_ids == [opaque("artifact-upload-1")] {
            Ok(vec![OpaqueArtifactHandleV1 {
                handle_id: opaque("artifact-upload-1"),
                content_sha256: hex64(&"a".repeat(64)),
                byte_length: safe(42),
                media_type: "text/plain".to_owned(),
                display_name: Some("notes.txt".to_owned()),
            }])
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
        target_event_id: &Hex64,
        reaction_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        if target_event_id != &hex64(EVENT) {
            return Err(BrokerFailure::membership_denied());
        }
        if reaction_event_id == &hex64(EVENT) {
            Ok(authority.resident_pubkey.clone())
        } else {
            Ok(hex64(OTHER_RESIDENT))
        }
    }

    fn message_author(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: &OpaqueId,
        message_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        if message_event_id == &hex64(EVENT) {
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

    fn approve_and_stage_action(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        if !self.approval_allowed.load(Ordering::SeqCst) {
            return Err(BrokerFailure::approval_denied());
        }
        self.approved
            .lock()
            .expect("test approved actions")
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
        backend.approval_allowed.store(true, Ordering::SeqCst);
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
fn cancellation_prevents_direct_resolution_and_room_creation() {
    let direct = Fixture::new();
    direct.authority.fail_on_call(2);
    let response = direct.response(
        "send",
        json!({
            "destination": {
                "destination_type": "direct_participants",
                "participant_pubkeys": [OTHER_RESIDENT],
            },
            "body": "must not open a DM",
        }),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("turn_not_active"));
    assert!(direct
        .backend
        .direct_resolutions
        .lock()
        .expect("direct resolutions")
        .is_empty());

    let room = Fixture::new();
    room.authority.fail_on_call(2);
    let response = room.response("create_private_room", json!({"label": "Must not exist"}));
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("turn_not_active"));
    assert!(room
        .backend
        .created_rooms
        .lock()
        .expect("created rooms")
        .is_empty());
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
fn desktop_issued_artifact_handle_becomes_exact_semantic_attachment() {
    let fixture = Fixture::new();
    let response = fixture.response(
        "send",
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "attached",
            "artifact_handle_ids": ["artifact-upload-1"],
        }),
    );
    assert!(response.ok);
    let staged = fixture.backend.staged.lock().expect("staged");
    let CommunicationOperationV1::SendMessage {
        artifact_handles, ..
    } = &staged[0].0.operation
    else {
        panic!("send operation");
    };
    assert_eq!(artifact_handles.len(), 1);
    assert_eq!(artifact_handles[0].handle_id, opaque("artifact-upload-1"));
    assert_eq!(artifact_handles[0].content_sha256, hex64(&"a".repeat(64)));
    assert_eq!(artifact_handles[0].byte_length, safe(42));
    assert_eq!(
        artifact_handles[0].display_name.as_deref(),
        Some("notes.txt")
    );

    drop(staged);
    let denied = fixture.response(
        "send",
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "denied",
            "artifact_handle_ids": ["artifact-unknown"],
        }),
    );
    assert!(!denied.ok);
    assert_eq!(denied.receipt.diagnostic_code, Some("artifact_denied"));
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
        }),
    );
    assert!(response.ok);
    let staged = fixture.backend.staged.lock().expect("staged");
    let (request, authority) = staged.last().expect("staged request");
    assert_eq!(authority.resident_pubkey, hex64(RESIDENT));
    let CommunicationDestinationV1::ExistingConversation {
        conversation_id, ..
    } = &request.destination
    else {
        panic!("resolved direct destination");
    };
    assert_eq!(conversation_id, &opaque("resolved-direct"));
    let resolutions = fixture
        .backend
        .direct_resolutions
        .lock()
        .expect("direct resolutions");
    let expected_participants = [hex64(OWNER), hex64(RESIDENT), hex64(OTHER_RESIDENT)]
        .into_iter()
        .collect::<BTreeSet<_>>();
    assert_eq!(resolutions.last(), Some(&expected_participants));
    drop(resolutions);
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
fn private_room_and_same_owner_membership_use_bounded_host_operations() {
    let fixture = Fixture::new();
    let response = fixture.response(
        "create_private_room",
        json!({
            "label": "Release room",
            "purpose": "Coordinate the preview.",
            "participant_pubkeys": [OTHER_RESIDENT],
        }),
    );
    assert!(response.ok);
    let created = fixture.backend.created_rooms.lock().expect("created rooms");
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].0, opaque("operation-1"));
    assert_eq!(created[0].1, "Release room");
    assert_eq!(created[0].2.as_deref(), Some("Coordinate the preview."));
    assert_eq!(
        created[0].3,
        [hex64(OWNER), hex64(RESIDENT), hex64(OTHER_RESIDENT)]
            .into_iter()
            .collect()
    );
    drop(created);

    let response = fixture.response(
        "invite",
        json!({
            "participant_pubkey": OTHER_RESIDENT,
            "request_activation": false,
        }),
    );
    assert!(response.ok);
    assert!(fixture
        .backend
        .invitations
        .lock()
        .expect("invitations")
        .is_empty());

    fixture
        .backend
        .insert_conversation(CommunicationConversationAuthority {
            conversation_id: opaque("owner-and-resident"),
            participant_pubkeys: [hex64(OWNER), hex64(RESIDENT)].into_iter().collect(),
            participant_set_version: safe(5),
            agent_may_invite_same_owner: true,
            read_only: false,
        });
    let response = fixture.response(
        "invite",
        json!({
            "conversation_id": "owner-and-resident",
            "participant_pubkey": OTHER_RESIDENT,
            "request_activation": false,
        }),
    );
    assert!(response.ok);
    assert_eq!(
        fixture
            .backend
            .invitations
            .lock()
            .expect("invitations")
            .as_slice(),
        &[(opaque("owner-and-resident"), hex64(OTHER_RESIDENT))]
    );
}

#[test]
fn invitation_activation_and_external_room_participants_fail_before_host_mutation() {
    let fixture = Fixture::new();
    let activation = fixture.response(
        "invite",
        json!({
            "participant_pubkey": OTHER_RESIDENT,
            "request_activation": true,
        }),
    );
    assert!(!activation.ok);
    assert_eq!(
        activation.receipt.diagnostic_code,
        Some("operation_not_implemented")
    );
    assert!(fixture
        .backend
        .invitations
        .lock()
        .expect("invitations")
        .is_empty());

    let direct_activation = fixture.response(
        "send",
        json!({
            "destination": {
                "destination_type": "direct_participants",
                "participant_pubkeys": [OTHER_RESIDENT],
            },
            "body": "Please respond here.",
            "mention_pubkeys": [OTHER_RESIDENT],
            "activation_pubkeys": [OTHER_RESIDENT],
        }),
    );
    assert!(direct_activation.ok);
    assert!(direct_activation.content.contains("activation"));
    let staged = fixture.backend.staged.lock().expect("staged");
    let (request, _) = staged.last().expect("activation request");
    assert_eq!(
        request.operation.activation_pubkeys(),
        &[hex64(OTHER_RESIDENT)]
    );
    drop(staged);

    fixture.authority.descendant.store(true, Ordering::SeqCst);
    let chained = fixture.response(
        "send",
        json!({
            "destination": {"destination_type": "current_conversation"},
            "body": "A descendant cannot activate another resident.",
            "mention_pubkeys": [OTHER_RESIDENT],
            "activation_pubkeys": [OTHER_RESIDENT],
        }),
    );
    assert!(!chained.ok);
    assert_eq!(chained.receipt.diagnostic_code, Some("approval_required"));

    let external = fixture.response(
        "create_private_room",
        json!({
            "label": "External room",
            "participant_pubkeys": [EXTERNAL],
        }),
    );
    assert!(!external.ok);
    assert_eq!(
        external.receipt.diagnostic_code,
        Some("same_owner_required")
    );
    assert!(fixture
        .backend
        .created_rooms
        .lock()
        .expect("created rooms")
        .is_empty());
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
fn reactions_are_scoped_to_exact_events_and_only_own_reactions_are_removed() {
    let fixture = Fixture::new();
    let added = fixture.response(
        "react",
        json!({
            "mutation": {
                "action": "add",
                "target_event_id": EVENT,
                "reaction": "+1",
            },
        }),
    );
    assert!(added.ok);

    let removed = fixture.response(
        "react",
        json!({
            "mutation": {
                "action": "remove",
                "target_event_id": EVENT,
                "reaction_event_id": EVENT,
            },
        }),
    );
    assert!(removed.ok);

    let foreign = fixture.response(
        "react",
        json!({
            "mutation": {
                "action": "remove",
                "target_event_id": EVENT,
                "reaction_event_id": OTHER_RESIDENT,
            },
        }),
    );
    assert!(!foreign.ok);
    assert_eq!(foreign.receipt.diagnostic_code, Some("authorship_denied"));

    let staged = fixture.backend.staged.lock().expect("staged reactions");
    assert_eq!(staged.len(), 2);
    assert!(matches!(
        staged[0].0.operation,
        CommunicationOperationV1::AddReaction { .. }
    ));
    assert!(matches!(
        staged[1].0.operation,
        CommunicationOperationV1::RemoveOwnReaction { .. }
    ));
}

#[test]
fn own_message_deletion_requires_one_exact_approval_before_staging() {
    let fixture = Fixture::new();
    let response = fixture.response("delete_own_message", json!({"target_event_id": EVENT}));
    assert!(response.ok);
    assert!(fixture
        .backend
        .staged
        .lock()
        .expect("ordinary staging")
        .is_empty());
    let approved = fixture.backend.approved.lock().expect("approved staging");
    assert_eq!(approved.len(), 1);
    let request = &approved[0].0;
    assert!(request.approval_id.is_some());
    assert!(matches!(
        &request.operation,
        CommunicationOperationV1::DeleteOwnMessage { target_event_id }
            if target_event_id == &hex64(EVENT)
    ));
}

#[test]
fn own_message_edit_uses_exact_authorship_and_ordinary_durable_staging() {
    let fixture = Fixture::new();
    let response = fixture.response(
        "edit_own_message",
        json!({
            "conversation_id": "conversation-1",
            "target_event_id": EVENT,
            "replacement_body": "Corrected resident message",
        }),
    );
    assert!(response.ok);
    assert!(fixture
        .backend
        .approved
        .lock()
        .expect("approved edits")
        .is_empty());
    let staged = fixture.backend.staged.lock().expect("staged edit");
    assert_eq!(staged.len(), 1);
    assert!(matches!(
        &staged[0].0.operation,
        CommunicationOperationV1::EditOwnMessage {
            target_event_id,
            replacement_body,
            artifact_handles,
        } if target_event_id == &hex64(EVENT)
            && replacement_body == "Corrected resident message"
            && artifact_handles.is_empty()
    ));
}

#[test]
fn foreign_empty_and_artifact_shaped_edits_never_stage() {
    let foreign = Fixture::new();
    let response = foreign.response(
        "edit_own_message",
        json!({
            "target_event_id": OTHER_RESIDENT,
            "replacement_body": "must fail",
        }),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("authorship_denied"));
    assert!(foreign.backend.staged.lock().expect("staged").is_empty());

    for arguments in [
        json!({"target_event_id": EVENT, "replacement_body": ""}),
        json!({
            "target_event_id": EVENT,
            "replacement_body": "must fail",
            "artifact_handle_ids": ["artifact-1"],
        }),
    ] {
        let invalid = Fixture::new();
        let response = invalid.response("edit_own_message", arguments);
        assert!(!response.ok);
        assert_eq!(response.receipt.diagnostic_code, Some("invalid_arguments"));
        assert!(invalid.backend.staged.lock().expect("staged").is_empty());
    }
}

#[test]
fn foreign_reject_and_cancellation_never_stage_a_deletion() {
    let foreign = Fixture::new();
    let response = foreign.response(
        "delete_own_message",
        json!({"target_event_id": OTHER_RESIDENT}),
    );
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("authorship_denied"));
    assert!(foreign
        .backend
        .approved
        .lock()
        .expect("approved")
        .is_empty());

    let rejected = Fixture::new();
    rejected
        .backend
        .approval_allowed
        .store(false, Ordering::SeqCst);
    let response = rejected.response("delete_own_message", json!({"target_event_id": EVENT}));
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("approval_denied"));
    assert!(rejected
        .backend
        .approved
        .lock()
        .expect("approved")
        .is_empty());

    let cancelled = Fixture::new();
    cancelled.authority.fail_on_call(2);
    let response = cancelled.response("delete_own_message", json!({"target_event_id": EVENT}));
    assert!(!response.ok);
    assert_eq!(response.receipt.diagnostic_code, Some("turn_not_active"));
    assert!(cancelled
        .backend
        .approved
        .lock()
        .expect("approved")
        .is_empty());
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

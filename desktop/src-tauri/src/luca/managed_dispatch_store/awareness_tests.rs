//! Synthetic signed owner events and disposable body-free stores only.
use super::*;
use nostr::{Event, EventBuilder, Keys, Kind, Tag, Timestamp};
use std::fs;

const CHANNEL: &str = "11111111-1111-4111-8111-111111111111";
fn id(value: &str) -> OpaqueId { OpaqueId::parse(value).unwrap() }
fn number(value: u64) -> SafeU53 { SafeU53::new(value).unwrap() }
fn hash(value: char) -> Sha256Ref { Sha256Ref::parse(format!("sha256:{}", value.to_string().repeat(64))).unwrap() }
fn event(owner: &Keys, resident: &Keys, label: &str) -> Event {
    EventBuilder::new(Kind::Custom(9), label).tags([
        Tag::parse(["h", CHANNEL]).unwrap(), Tag::public_key(owner.public_key()), Tag::public_key(resident.public_key()),
    ]).custom_created_at(Timestamp::from(100)).sign_with_keys(owner).unwrap()
}
struct Fixture {
    _directory: tempfile::TempDir,
    path: std::path::PathBuf,
    store: ManagedDispatchStore,
    owner: Keys,
    resident: Keys,
    trigger: Event,
    authority: ContinuityDispatchAuthority,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("managed-dispatches.json");
        let mut store = ManagedDispatchStore::load(path.clone()).unwrap();
        let owner = Keys::generate(); let resident = Keys::generate();
        let trigger = event(&owner, &resident, "OWNER_BODY_NOT_PERSISTED_SENTINEL");
        store.stage_owner_event(&trigger, &[resident.public_key().to_hex()], 100).unwrap();
        store.activate_session(&resident.public_key().to_hex(), 7).unwrap();
        let authority = store.authorize_continuity_turn(&trigger.id.to_hex(), &resident.public_key().to_hex(), CHANNEL, 7, 100).unwrap();
        Self { _directory: directory, path, store, owner, resident, trigger, authority }
    }
    fn observation(&self, index: u64) -> AwarenessObservationRefV1 {
        AwarenessObservationRefV1 {
            protocol: luca_protocol::AWARENESS_PROTOCOL.into(), observation_id: id(&format!("observation-{index}")),
            owner_pubkey: self.authority.owner_pubkey.clone(), resident_pubkey: self.authority.resident_pubkey.clone(),
            source_id: id("source-sentinel"), device_id: id("device-sentinel"), grant_id: id("grant-sentinel"),
            grant_revision: number(1), deny_epoch: number(0), sequence: number(index), evidence_ref: hash('c'),
            captured_at: luca_protocol::CanonicalTimestamp::parse("1970-01-01T00:01:40Z").unwrap(),
            expires_at: luca_protocol::CanonicalTimestamp::parse("1970-01-01T00:06:40Z").unwrap(),
        }
    }
    fn bind(&mut self) -> ManagedTurnAwarenessBindingV1 {
        let observation = self.observation(1);
        self.store.bind_turn_awareness_context(&self.authority, number(7), &hash('a'), &id("context-node-one"), &[observation], 100).unwrap()
    }
}

#[test]
fn exact_frame_binding_is_body_free_immutable_replay_and_not_injection_authority() {
    let mut fixture = Fixture::new();
    assert!(ordinary_turn_awareness_consumers_ready());
    let first = fixture.bind();
    assert_eq!(fixture.bind(), first);
    let observation = fixture.observation(1);
    assert_eq!(fixture.store.bind_turn_awareness_context(&fixture.authority, number(7), &hash('a'), &id("different-context"), &[observation.clone()], 100), Err(DispatchAuthorizationError::Ambiguous));
    assert_eq!(fixture.store.bind_turn_without_awareness_context(&fixture.authority, number(7), &hash('a'), 100), Err(DispatchAuthorizationError::Ambiguous));
    let mut wrong = fixture.authority.clone(); wrong.canonical_dispatch_ref = hash('f');
    assert_eq!(fixture.store.bind_turn_awareness_context(&wrong, number(7), &hash('a'), &id("context-node-one"), &[observation], 100), Err(DispatchAuthorizationError::Ambiguous));
    let encoded = fs::read_to_string(&fixture.path).unwrap();
    assert!(!encoded.contains("OWNER_BODY_NOT_PERSISTED_SENTINEL"));
    assert!(!encoded.contains("content_utf8"));
    let reloaded = ManagedDispatchStore::load(fixture.path.clone()).unwrap();
    assert!(matches!(reloaded.turn_awareness_context(&fixture.authority.owner_pubkey, &fixture.authority.resident_pubkey, &fixture.authority.conversation_id, &fixture.authority.trigger_event_id), ManagedTurnAwarenessLookupV1::Bound(_)));
}

#[test]
fn warm_taint_survives_row_removal_restart_and_epoch_binding_changes() {
    let mut fixture = Fixture::new(); fixture.bind();
    fixture.store.dispatches.clear();
    fixture.store.persist().unwrap();
    let mut store = ManagedDispatchStore::load(fixture.path.clone()).unwrap();
    let followup = event(&fixture.owner, &fixture.resident, "FOLLOWUP_WITHOUT_NEW_SOURCES");
    store.stage_owner_event(&followup, &[fixture.resident.public_key().to_hex()], 100).unwrap();
    store.activate_session(&fixture.resident.public_key().to_hex(), 8).unwrap();
    let authority = store.authorize_continuity_turn(&followup.id.to_hex(), &fixture.resident.public_key().to_hex(), CHANNEL, 8, 100).unwrap();
    let inherited = store.bind_turn_without_awareness_context(&authority, number(8), &hash('b'), 100).unwrap();
    assert_eq!(inherited.mode, BindingMode::Inherited);
    assert_eq!(inherited.context_nodes, vec![id("context-node-one")]);
    assert!(!store.broker_artifacts_allowed_for_dispatch(&authority.owner_pubkey, &authority.resident_pubkey, &authority.conversation_id, &authority.trigger_event_id));
    let mut unknown = authority.clone(); unknown.owner_pubkey = Hex64::parse("dd".repeat(32)).unwrap();
    assert_eq!(store.turn_awareness_context(&unknown.owner_pubkey, &unknown.resident_pubkey, &unknown.conversation_id, &unknown.trigger_event_id), ManagedTurnAwarenessLookupV1::Unknown);
}

#[test]
fn schema_v5_absence_is_legacy_clean_but_v6_absence_is_unknown() {
    let fixture = Fixture::new();
    let owner = &fixture.authority.owner_pubkey; let resident = &fixture.authority.resident_pubkey;
    let conversation = &fixture.authority.conversation_id; let dispatch = &fixture.authority.trigger_event_id;
    assert_eq!(fixture.store.turn_awareness_context(owner, resident, conversation, dispatch), ManagedTurnAwarenessLookupV1::Unknown);
    let mut persisted: serde_json::Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
    persisted["schema"] = serde_json::json!(super::super::STORE_SCHEMA_V5);
    persisted.as_object_mut().unwrap().remove("awareness_tainted_scopes");
    persisted["dispatches"][0].as_object_mut().unwrap().remove("awareness_context_binding");
    fs::write(&fixture.path, serde_json::to_vec(&persisted).unwrap()).unwrap();
    let legacy = ManagedDispatchStore::load(fixture.path.clone()).unwrap();
    assert_eq!(legacy.turn_awareness_context(owner, resident, conversation, dispatch), ManagedTurnAwarenessLookupV1::Untainted);
    legacy.persist().unwrap();
    let upgraded = ManagedDispatchStore::load(fixture.path.clone()).unwrap();
    assert_eq!(upgraded.turn_awareness_context(owner, resident, conversation, dispatch), ManagedTurnAwarenessLookupV1::Untainted);
    let mut injection: serde_json::Value = serde_json::from_slice(&fs::read(&fixture.path).unwrap()).unwrap();
    injection["dispatches"][0]["awareness_context_binding"]["model_instructions"] = serde_json::json!("WIDEN_SCOPE_SENTINEL");
    fs::write(&fixture.path, serde_json::to_vec(&injection).unwrap()).unwrap();
    assert!(ManagedDispatchStore::load(fixture.path.clone()).is_err());
}

#[test]
fn persistence_failure_rolls_back_taint_and_clean_can_only_bind_before_submission() {
    let mut fixture = Fixture::new();
    let directory = tempfile::tempdir().unwrap();
    fixture.store.path = directory.path().to_path_buf();
    let observation = fixture.observation(1);
    assert_eq!(fixture.store.bind_turn_awareness_context(&fixture.authority, number(7), &hash('a'), &id("context-node-one"), &[observation], 100), Err(DispatchAuthorizationError::Persistence));
    assert!(fixture.store.awareness_tainted_scopes.is_empty());
    assert_eq!(fixture.store.turn_awareness_context(&fixture.authority.owner_pubkey, &fixture.authority.resident_pubkey, &fixture.authority.conversation_id, &fixture.authority.trigger_event_id), ManagedTurnAwarenessLookupV1::Unknown);
    fixture.store.path = fixture.path.clone();
    let clean = fixture.store.bind_turn_without_awareness_context(&fixture.authority, number(7), &hash('a'), 100).unwrap();
    assert_eq!(clean.mode, BindingMode::Clean);
    assert!(fixture.store.broker_artifacts_allowed_for_dispatch(&fixture.authority.owner_pubkey, &fixture.authority.resident_pubkey, &fixture.authority.conversation_id, &fixture.authority.trigger_event_id));
    fixture.store.bind_communication_turn_start(&fixture.trigger.id.to_hex(), &fixture.resident.public_key().to_hex(), CHANNEL, 7, 100).unwrap();
    let final_id = "ee".repeat(32);
    fixture.store.begin_submission(&fixture.trigger.id.to_hex(), &fixture.resident.public_key().to_hex(), 7, &final_id).unwrap();
    assert_eq!(fixture.store.bind_turn_without_awareness_context(&fixture.authority, number(7), &hash('a'), 100), Err(DispatchAuthorizationError::Terminal));
    fixture.store.mark_published(&fixture.trigger.id.to_hex(), &fixture.resident.public_key().to_hex(), &final_id).unwrap();
    assert!(fixture.store.automatic_derivatives_allowed_for_final(&fixture.authority.owner_pubkey, &fixture.authority.resident_pubkey, &Hex64::parse(final_id).unwrap()));
}

#[test]
fn bounded_sticky_metadata_never_evicts_prior_contexts_or_accepts_duplicate_refs() {
    let mut fixture = Fixture::new();
    let observation = fixture.observation(1);
    assert_eq!(fixture.store.bind_turn_awareness_context(&fixture.authority, number(7), &hash('a'), &id("context-node-one"), &[observation.clone(), observation], 100), Err(DispatchAuthorizationError::Ambiguous));
    fixture.store.awareness_tainted_scopes.push(ManagedAwarenessTaintedScopeV1 {
        owner: fixture.authority.owner_pubkey.clone(), resident: fixture.authority.resident_pubkey.clone(), conversation: fixture.authority.conversation_id.clone(),
        nodes: (0..MAX_CONTEXT_NODES).map(|index| id(&format!("existing-{index:02}"))).collect(),
    });
    let observation = fixture.observation(1);
    assert_eq!(fixture.store.bind_turn_awareness_context(&fixture.authority, number(7), &hash('a'), &id("one-too-many"), &[observation], 100), Err(DispatchAuthorizationError::Persistence));
    assert_eq!(fixture.store.awareness_tainted_scopes[0].nodes.len(), MAX_CONTEXT_NODES);
    assert!(fixture.store.dispatches.values().all(|row| row.awareness_context_binding.is_none()));
}

#[test]
fn isolated_turns_keep_only_current_dependencies_and_clean_chat_survives_withdrawal() {
    let mut fixture = Fixture::new();
    let observation = fixture.observation(1);
    fixture.store.bind_isolated_awareness_turn(&fixture.authority, number(7), &hash('a'),
        Some(&id("first-isolated-context")), &[observation], 100).unwrap();
    for index in 2..40 {
        let trigger = event(&fixture.owner, &fixture.resident, &format!("isolated-{index}"));
        fixture.store.stage_owner_event(&trigger, &[fixture.resident.public_key().to_hex()], 100).unwrap();
        let authority = fixture.store.authorize_continuity_turn(&trigger.id.to_hex(), &fixture.resident.public_key().to_hex(), CHANNEL, 7, 100).unwrap();
        let node = id(&format!("isolated-context-{index}"));
        let observation = fixture.observation(index);
        let observed = fixture.store.bind_isolated_awareness_turn(&authority, number(7), &hash('a'),
            Some(&node), &[observation], 100).unwrap();
        assert_eq!(observed.context_nodes, vec![node]);
        assert!(matches!(fixture.store.turn_awareness_context(&authority.owner_pubkey, &authority.resident_pubkey,
            &authority.conversation_id, &authority.trigger_event_id), ManagedTurnAwarenessLookupV1::Bound(binding) if binding.context_nodes.len() == 1));
    }
    fixture.store.dispatches.clear(); fixture.store.persist().unwrap();
    fixture.store = ManagedDispatchStore::load(fixture.path.clone()).unwrap();
    fixture.store.activate_session(&fixture.resident.public_key().to_hex(), 7).unwrap();
    let trigger = event(&fixture.owner, &fixture.resident, "clean-after-pause");
    fixture.store.stage_owner_event(&trigger, &[fixture.resident.public_key().to_hex()], 100).unwrap();
    let authority = fixture.store.authorize_continuity_turn(&trigger.id.to_hex(), &fixture.resident.public_key().to_hex(), CHANNEL, 7, 100).unwrap();
    assert!(fixture.store.awareness_history_requires_isolation(&authority));
    fixture.store.bind_isolated_awareness_turn(&authority, number(7), &hash('a'), None, &[], 100).unwrap();
    assert_eq!(fixture.store.turn_awareness_context(&authority.owner_pubkey, &authority.resident_pubkey,
        &authority.conversation_id, &authority.trigger_event_id), ManagedTurnAwarenessLookupV1::Untainted);
    assert!(fixture.store.awareness_history_requires_isolation(&authority));
}

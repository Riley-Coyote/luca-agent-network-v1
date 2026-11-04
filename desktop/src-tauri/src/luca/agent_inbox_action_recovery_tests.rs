use super::*;
use crate::luca::exchange_relay::ExchangeRelayError;
use std::collections::{BTreeMap, BTreeSet};

struct CanonicalRelay(BTreeMap<String, nostr::Event>);
impl ExchangeRelay for CanonicalRelay {
    fn fetch_trigger(&self, id: &Hex64) -> Result<Option<nostr::Event>, ExchangeRelayError> {
        Ok(self.0.get(id.as_str()).cloned())
    }
    fn fetch_head(
        &self,
        _: &Hex64,
        _: &Hex64,
    ) -> Result<Option<crate::luca::exchange_store::ExchangeHead>, ExchangeRelayError> {
        Ok(None)
    }
    fn spent_turns(
        &self,
        _: &luca_protocol::ExchangeRecordV1,
    ) -> Result<BTreeSet<u8>, ExchangeRelayError> {
        Ok(BTreeSet::new())
    }
    fn owner(&self) -> Result<Hex64, ExchangeRelayError> {
        Hex64::parse("a".repeat(64))
            .map_err(|error| ExchangeRelayError::Unavailable(error.to_string()))
    }
    fn publish_record(
        &self,
        _: &luca_protocol::ExchangeRecordV1,
        _: u64,
    ) -> Result<Hex64, ExchangeRelayError> {
        panic!("receipt recovery must never publish")
    }
    fn publish_note(&self, _: &OpaqueId, _: &str) -> Result<(), ExchangeRelayError> {
        panic!("receipt recovery must never write a note")
    }
    fn conversation_members(&self, _: &OpaqueId) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(BTreeSet::new())
    }
    fn owned_residents(&self) -> Result<BTreeSet<Hex64>, ExchangeRelayError> {
        Ok(BTreeSet::new())
    }
    fn resolve_resident_name(
        &self,
        _: &BTreeSet<Hex64>,
        _: &str,
    ) -> Result<Option<Hex64>, ExchangeRelayError> {
        Ok(None)
    }
    fn display_name(&self, _: &Hex64) -> String {
        "synthetic".into()
    }
}

fn fixture() -> (TaskAnchor, nostr::Event) {
    let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
    let sender = nostr::Keys::parse(&"22".repeat(32)).unwrap();
    let recipient = nostr::Keys::parse(&"33".repeat(32)).unwrap();
    let exchange = Hex64::parse("c".repeat(64)).unwrap();
    let dispatch = Hex64::parse("d".repeat(64)).unwrap();
    let source = OpaqueId::parse("11111111-1111-4111-8111-111111111111").unwrap();
    let event = nostr::EventBuilder::new(nostr::Kind::Custom(9), "synthetic task request")
        .tags([
            nostr::Tag::parse(["h", source.as_str()]).unwrap(),
            nostr::Tag::public_key(recipient.public_key()),
            nostr::Tag::parse(["exchange", exchange.as_str(), "1"]).unwrap(),
            nostr::Tag::parse([
                luca_protocol::MANAGED_DISPATCH_RECEIPT_TAG,
                dispatch.as_str(),
            ])
            .unwrap(),
        ])
        .custom_created_at(nostr::Timestamp::from(100))
        .sign_with_keys(&sender)
        .unwrap();
    let row = TaskAnchor {
        scope: InboxScope {
            community_id: "22222222-2222-4222-8222-222222222222".into(),
            owner_pubkey: Hex64::parse(owner.public_key().to_hex()).unwrap(),
        },
        anchor_event_id: Hex64::parse(event.id.to_hex()).unwrap(),
        owner_trigger_event_id: Hex64::parse("7".repeat(64)).unwrap(),
        source,
        initiator: Hex64::parse(sender.public_key().to_hex()).unwrap(),
        recipient: Hex64::parse(recipient.public_key().to_hex()).unwrap(),
        action_key: Hex64::parse("a".repeat(64)).unwrap(),
        input_fingerprint: Hex64::parse("b".repeat(64)).unwrap(),
        parent_dispatch_id: Hex64::parse("9".repeat(64)).unwrap(),
        anchor_dispatch_id: dispatch,
        exchange_id: Some(exchange),
    };
    (row, event)
}

#[test]
fn agent_inbox_receipt_survives_dispatch_eviction_and_source_reload() {
    let directory = tempfile::tempdir().unwrap();
    let (row, event) = fixture();
    let path = directory.path().join("body-free-action-index.json");
    crate::luca::managed_dispatch_store::atomic_write_restricted(
        &path,
        &serde_json::to_vec(&vec![row.clone()]).unwrap(),
    )
    .unwrap();
    let cache = crate::luca::managed_dispatch_store::ManagedDispatchStore::load(
        directory.path().join("empty-cache.json"),
    )
    .unwrap();
    assert!(cache
        .owner_trigger_state(row.anchor_dispatch_id.as_str(), row.initiator.as_str())
        .is_none());
    let restored: Vec<TaskAnchor> = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let relay = CanonicalRelay(BTreeMap::from([(event.id.to_hex(), event)]));
    match recover_records(&restored, &relay).unwrap() {
        RecoveredAction::Accepted(accepted) => {
            assert_eq!(accepted.anchor_event_id, row.anchor_event_id);
            assert_eq!(accepted.parent_dispatch_id, row.parent_dispatch_id);
        }
        _ => panic!("must return the original accepted receipt, never allocate new work"),
    }
}

#[test]
fn missing_canonical_request_retains_original_pending_parent_not_new_work() {
    let (row, _) = fixture();
    match recover_records(&[row.clone()], &CanonicalRelay(BTreeMap::new())).unwrap() {
        RecoveredAction::Pending { parent, .. } => assert_eq!(parent, row.parent_dispatch_id),
        _ => panic!("an uncertain old request cannot become a new action"),
    }
}

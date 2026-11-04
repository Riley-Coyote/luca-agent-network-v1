use super::*;
use crate::luca::agent_inbox_binding::{InboxChildActionBinding, InboxChildActionPhase};

fn fixture() -> (
    tempfile::TempDir,
    ManagedDispatchStore,
    nostr::Event,
    Hex64,
    Hex64,
) {
    let directory = tempfile::tempdir().unwrap();
    let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
    let actor = nostr::Keys::parse(&"22".repeat(32)).unwrap();
    let actor = Hex64::parse(actor.public_key().to_hex()).unwrap();
    let owner_key = Hex64::parse(owner.public_key().to_hex()).unwrap();
    let event = crate::events::build_message(
        uuid::Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap(),
        "synthetic owner request",
        None,
        &[actor.as_str()],
        &[],
        &[],
        &[],
    )
    .unwrap()
    .custom_created_at(nostr::Timestamp::from(100))
    .sign_with_keys(&owner)
    .unwrap();
    let mut store = ManagedDispatchStore::load(directory.path().join("dispatches.json")).unwrap();
    store
        .stage_owner_event(&event, &[actor.as_str().to_owned()], 100)
        .unwrap();
    store.activate_session(actor.as_str(), 1).unwrap();
    store
        .bind_communication_turn_start(
            &event.id.to_hex(),
            actor.as_str(),
            "11111111-1111-4111-8111-111111111111",
            1,
            100,
        )
        .unwrap();
    (directory, store, event, owner_key, actor)
}

fn action(
    owner: &Hex64,
    event: &nostr::Event,
    phase: InboxChildActionPhase,
) -> InboxChildActionBinding {
    InboxChildActionBinding {
        scope: crate::luca::agent_inbox::InboxScope {
            community_id: "22222222-2222-4222-8222-222222222222".into(),
            owner_pubkey: owner.clone(),
        },
        parent_dispatch_id: Hex64::parse(event.id.to_hex()).unwrap(),
        action_key: Hex64::parse("a".repeat(64)).unwrap(),
        input_fingerprint: Hex64::parse("b".repeat(64)).unwrap(),
        recipient_pubkey: Hex64::parse("c".repeat(64)).unwrap(),
        phase,
        anchor_event_id: (phase == InboxChildActionPhase::Request)
            .then(|| Hex64::parse("d".repeat(64)).unwrap()),
        exchange_id: None,
        root_event_id: None,
        reply_event_id: None,
        response_surface: None,
    }
}

#[test]
fn child_slots_keep_parent_final_and_deadline_then_cancel_atomically() {
    let (directory, mut store, event, owner, actor) = fixture();
    let parent = store.dispatches[&(event.id.to_hex(), actor.as_str().to_owned())].clone();
    let mut children = Vec::new();
    for (slot, phase) in [
        ('e', InboxChildActionPhase::Anchor),
        ('f', InboxChildActionPhase::Request),
    ] {
        let child = Hex64::parse(slot.to_string().repeat(64)).unwrap();
        let row = store
            .stage_inbox_child_action(
                &event.id.to_hex(),
                &child,
                actor.as_str(),
                &parent.conversation_id,
                1,
                action(&owner, &event, phase),
                vec![owner.as_str().to_owned()],
                110,
            )
            .unwrap();
        assert_eq!(row.expires_at, parent.expires_at);
        assert_eq!(row.created_at, parent.created_at);
        children.push(child);
    }
    assert_eq!(
        store.dispatches[&(event.id.to_hex(), actor.as_str().to_owned())],
        parent
    );
    assert!(matches!(
        store
            .cancel_exact(
                owner.as_str(),
                &parent.conversation_id,
                actor.as_str(),
                &event.id.to_hex(),
                1
            )
            .unwrap(),
        ExactDispatchCancellationResult::Cancelled(_)
    ));
    drop(store);
    let store = ManagedDispatchStore::load(directory.path().join("dispatches.json")).unwrap();
    for child in children {
        assert_eq!(
            store.owner_trigger_state(child.as_str(), actor.as_str()),
            Some(ManagedDispatchState::Cancelled)
        );
    }
}

#[test]
fn accepted_action_replay_returns_original_receipt_after_parent_stop() {
    let (_directory, mut store, event, owner, actor) = fixture();
    let child = Hex64::parse("e".repeat(64)).unwrap();
    let binding = action(&owner, &event, InboxChildActionPhase::Request);
    let source = "11111111-1111-4111-8111-111111111111";
    store
        .stage_inbox_child_action(
            &event.id.to_hex(),
            &child,
            actor.as_str(),
            source,
            1,
            binding.clone(),
            vec![owner.as_str().to_owned()],
            110,
        )
        .unwrap();
    let exchange = Hex64::parse("f".repeat(64)).unwrap();
    store
        .bind_inbox_child_exchange(child.as_str(), actor.as_str(), &exchange)
        .unwrap();
    let published = Hex64::parse("7".repeat(64)).unwrap();
    store
        .begin_submission(child.as_str(), actor.as_str(), 1, published.as_str())
        .unwrap();
    store
        .mark_published(child.as_str(), actor.as_str(), published.as_str())
        .unwrap();
    store
        .cancel_exact(
            owner.as_str(),
            source,
            actor.as_str(),
            &event.id.to_hex(),
            1,
        )
        .unwrap();
    let receipt = store
        .accepted_inbox_action(
            &binding.action_key,
            &binding.input_fingerprint,
            &binding.scope,
            actor.as_str(),
            source,
        )
        .unwrap()
        .unwrap();
    assert_eq!(receipt.0, published);
    assert_eq!(receipt.2, Some(exchange));
    assert_eq!(receipt.3.as_str(), event.id.to_hex());
}

#[test]
fn staged_owner_inbox_without_lineage_is_not_claimable_after_restart() {
    let (directory, mut store, _, owner_key, actor) = fixture();
    let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
    assert_eq!(owner_key.as_str(), owner.public_key().to_hex());
    let source = "11111111-1111-4111-8111-111111111111";
    let event = crate::events::build_message(
        uuid::Uuid::parse_str(source).unwrap(),
        "synthetic task reply",
        None,
        &[actor.as_str()],
        &[],
        &[],
        &[],
    )
    .unwrap()
    .tag(nostr::Tag::parse(["luca-task-reply", &"a".repeat(64)]).unwrap())
    .custom_created_at(nostr::Timestamp::from(101))
    .sign_with_keys(&owner)
    .unwrap();
    store
        .stage_owner_event(&event, &[actor.as_str().to_owned()], 101)
        .unwrap();
    drop(store);
    let mut store = ManagedDispatchStore::load(directory.path().join("dispatches.json")).unwrap();
    store.activate_session(actor.as_str(), 2).unwrap();
    assert!(store
        .owner_trigger_may_submit(&event.id.to_hex(), actor.as_str())
        .is_err());
    assert!(store
        .authorize_continuity_turn(&event.id.to_hex(), actor.as_str(), source, 2, 102)
        .is_err());
    assert!(store
        .bind_communication_turn_start(&event.id.to_hex(), actor.as_str(), source, 2, 102)
        .is_err());
}

#[test]
fn agent_inbox_active_parent_pins_child_suppression_across_pressure_and_restart() {
    let (directory, mut store, event, owner, actor) = fixture();
    let parent_key = (event.id.to_hex(), actor.as_str().to_owned());
    let parent = store.dispatches[&parent_key].clone();
    let child = Hex64::parse("e".repeat(64)).unwrap();
    let binding = action(&owner, &event, InboxChildActionPhase::Request);
    let recipient = binding.recipient_pubkey.clone();
    store
        .stage_inbox_child_action(
            &event.id.to_hex(),
            &child,
            actor.as_str(),
            &parent.conversation_id,
            1,
            binding,
            vec![recipient.as_str().to_owned()],
            110,
        )
        .unwrap();
    let child_key = (child.as_str().to_owned(), actor.as_str().to_owned());
    {
        let row = store.dispatches.get_mut(&child_key).unwrap();
        row.state = ManagedDispatchState::Published;
        row.outbox_finalized = true;
        row.created_at = parent.created_at.saturating_sub(1);
        row.expires_at = row.created_at + DISPATCH_TTL_SECONDS;
        row.submitted_event_id = Some("7".repeat(64));
        row.published_event_id = row.submitted_event_id.clone();
    }
    // The accepted child is oldest and would otherwise be the first terminal
    // row evicted. Distinct unrelated terminal rows supply real cache pressure.
    for index in 0..MAX_DISPATCHES {
        let key = format!("{:064x}", index + 1);
        let mut row = parent.clone();
        row.trigger_event_id = key.clone();
        row.created_at = 200 + index as u64;
        row.expires_at = row.created_at + DISPATCH_TTL_SECONDS;
        row.state = ManagedDispatchState::Published;
        row.outbox_finalized = true;
        row.submitted_event_id = Some(key.clone());
        row.published_event_id = Some(key.clone());
        store
            .dispatches
            .insert((key, actor.as_str().to_owned()), row);
    }
    store.prune(120);
    assert_eq!(store.dispatches.len(), MAX_DISPATCHES);
    assert!(store.dispatches.contains_key(&parent_key));
    assert!(store.dispatches.contains_key(&child_key));
    store.persist().unwrap();
    drop(store);
    let mut restored =
        ManagedDispatchStore::load(directory.path().join("dispatches.json")).unwrap();
    assert!(restored
        .inbox_child_recipients(&event.id.to_hex(), actor.as_str())
        .contains(&recipient));
    // The retention is bounded by parent authority, not permanent cache pinning.
    restored.dispatches.get_mut(&parent_key).unwrap().state = ManagedDispatchState::Published;
    let mut extra = parent;
    extra.trigger_event_id = "f".repeat(64);
    extra.state = ManagedDispatchState::Published;
    extra.outbox_finalized = true;
    extra.created_at = 999;
    restored
        .dispatches
        .insert(("f".repeat(64), actor.as_str().to_owned()), extra);
    restored.prune(120);
    assert!(!restored.dispatches.contains_key(&child_key));
}

#[test]
fn agent_inbox_child_stop_does_not_cancel_another_actor_on_shared_owner_trigger() {
    let (_directory, mut store, event, owner, actor) = fixture();
    let parent = (event.id.to_hex(), actor.as_str().to_owned());
    let other_actor = "8".repeat(64);
    let mut unrelated = store.dispatches[&parent].clone();
    unrelated.resident_pubkey = other_actor.clone();
    store
        .dispatches
        .insert((event.id.to_hex(), other_actor.clone()), unrelated);
    let child = Hex64::parse("e".repeat(64)).unwrap();
    let exchange = Hex64::parse("f".repeat(64)).unwrap();
    let mut binding = action(&owner, &event, InboxChildActionPhase::Request);
    binding.exchange_id = Some(exchange.clone());
    store
        .stage_inbox_child_action(
            &event.id.to_hex(),
            &child,
            actor.as_str(),
            "11111111-1111-4111-8111-111111111111",
            1,
            binding,
            vec![owner.as_str().to_owned()],
            110,
        )
        .unwrap();
    store
        .cancel_inbox_exchange_actions(
            owner.as_str(),
            "11111111-1111-4111-8111-111111111111",
            &exchange,
        )
        .unwrap();
    assert_eq!(
        store.dispatches[&parent].state,
        ManagedDispatchState::Cancelled
    );
    assert_eq!(
        store.dispatches[&(event.id.to_hex(), other_actor)].state,
        ManagedDispatchState::Active
    );
}

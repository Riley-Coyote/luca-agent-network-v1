use super::*;

#[test]
fn task_lineage_survives_restart_and_stop_is_exact() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("synthetic-dispatches.json");
    let owner = nostr::Keys::parse(&"11".repeat(32)).unwrap();
    let resident = nostr::Keys::parse(&"22".repeat(32)).unwrap();
    let owner_key = Hex64::parse(owner.public_key().to_hex()).unwrap();
    let resident_key = Hex64::parse(resident.public_key().to_hex()).unwrap();
    let conversation = "11111111-1111-4111-8111-111111111111";
    let scope = super::super::agent_inbox::InboxScope {
        community_id: "22222222-2222-4222-8222-222222222222".into(),
        owner_pubkey: owner_key.clone(),
    };
    let mut store = ManagedDispatchStore::load(path.clone()).unwrap();
    let mut events = Vec::new();
    let tasks = [
        Hex64::parse("a".repeat(64)).unwrap(),
        Hex64::parse("b".repeat(64)).unwrap(),
    ];
    for (index, task) in tasks.iter().enumerate() {
        let event = crate::events::build_message(
            uuid::Uuid::parse_str(conversation).unwrap(),
            &format!("synthetic clarification {index}"),
            None,
            &[resident_key.as_str()],
            &[],
            &[],
            &[],
        )
        .unwrap()
        .tag(nostr::Tag::parse(["luca-task-reply", task.as_str()]).unwrap())
        .custom_created_at(nostr::Timestamp::from(100))
        .sign_with_keys(&owner)
        .unwrap();
        store
            .stage_owner_event(&event, &[resident_key.as_str().to_owned()], 100)
            .unwrap();
        let binding = super::super::agent_inbox_binding::InboxTaskBinding {
            scope: scope.clone(),
            logical_task_id: task.clone(),
            attempt_exchange_id: task.clone(),
            origin_conversation_id: OpaqueId::parse(conversation).unwrap(),
            origin_request_event_id: task.clone(),
            attempt_request_event_id: None,
            initiator_pubkey: Hex64::parse("c".repeat(64)).unwrap(),
            recipient_pubkey: resident_key.clone(),
            parent_attempt_exchange_id: None,
            parent_attempt_record_event_id: None,
            result_event_id: None,
            return_acknowledged: false,
        };
        store
            .bind_inbox_task(&event, resident_key.as_str(), binding)
            .unwrap();
        events.push(event);
    }
    assert_eq!(
        store
            .cancel_inbox_task(owner_key.as_str(), conversation, &tasks[0])
            .unwrap(),
        1
    );
    let store = ManagedDispatchStore::load(path).unwrap();
    assert!(store
        .owner_trigger_may_submit(&events[0].id.to_hex(), resident_key.as_str())
        .is_err());
    assert!(store
        .owner_trigger_may_submit(&events[1].id.to_hex(), resident_key.as_str())
        .is_ok());
    let binding = store
        .inbox_task_binding(&events[1].id.to_hex(), resident_key.as_str())
        .unwrap();
    assert_eq!(binding.origin_request_event_id, tasks[1]);
    assert!(!binding.return_acknowledged);
}

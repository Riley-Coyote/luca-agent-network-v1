use super::*;

#[test]
fn inaccessible_source_scan_counts_never_cross_the_inbox_boundary() {
    let page = InboxPage {
        scope: scope(),
        tasks: Vec::new(),
        next_cursor: None,
        scanned: 100,
        history_source: "canonical_relay",
        partial: true,
        unavailable_source_count: 3,
    };
    let value = serde_json::to_value(page).unwrap();
    assert!(value.get("scanned").is_none());
    assert!(value.get("unavailableSourceCount").is_none());
    assert_eq!(value["partial"], true);
}

fn key(byte: char) -> Hex64 {
    Hex64::parse(byte.to_string().repeat(64)).unwrap()
}
fn scope() -> InboxScope {
    InboxScope {
        community_id: "11111111-1111-4111-8111-111111111111".into(),
        owner_pubkey: key('a'),
    }
}
fn record() -> ExchangeRecordV1 {
    ExchangeRecordV1::open(
        key('a'),
        vec![key('b'), key('c')],
        luca_protocol::OpaqueId::parse("source-room").unwrap(),
        key('d'),
        key('b'),
        None,
        100,
    )
    .unwrap()
}

#[test]
fn symmetric_identity_excludes_runtime_names_and_source_rooms() {
    let scope = scope();
    let id = correspondence_id(&scope, &[key('b'), key('c')]).unwrap();
    assert_eq!(
        Some(id.clone()),
        correspondence_id(&scope, &[key('c'), key('b')])
    );
    let mut other = scope.clone();
    other.owner_pubkey = key('d');
    assert_ne!(
        Some(id.clone()),
        correspondence_id(&other, &[key('b'), key('c')])
    );
    other = scope;
    other.community_id = "22222222-2222-4222-8222-222222222222".into();
    assert_ne!(Some(id), correspondence_id(&other, &[key('b'), key('c')]));
}

#[test]
fn groups_and_duplicate_pairs_are_not_private_correspondence() {
    assert!(correspondence_id(&scope(), &[key('b'), key('c'), key('d')]).is_none());
    assert!(correspondence_id(&scope(), &[key('b'), key('b')]).is_none());
}

#[test]
fn task_projection_never_accepts_foreign_owner_or_resident() {
    let record = record();
    assert!(authorized(&record, &scope(), &key('a')));
    assert!(authorized(&record, &scope(), &key('b')));
    assert!(!authorized(&record, &scope(), &key('e')));
    let mut other = scope();
    other.owner_pubkey = key('e');
    assert!(!authorized(&record, &other, &key('b')));
}

#[test]
fn one_thousand_durable_task_refs_do_not_depend_on_head_cache() {
    // Deterministic tuple keys remain one pair over many distinct source
    // tasks. Production pages query the relay, never ExchangeStore.heads.
    let identity = correspondence_id(&scope(), &record().members);
    let mut tasks = BTreeSet::new();
    for index in 0..1000 {
        let mut task = record();
        task.root_event_id = Hex64::parse(format!("{index:064x}")).unwrap();
        task.exchange_id =
            luca_protocol::derive_exchange_id(&task.root_event_id, &task.members, None).unwrap();
        assert_eq!(correspondence_id(&scope(), &task.members), identity);
        tasks.insert(task.exchange_id);
    }
    assert_eq!(tasks.len(), 1000);
}

#[test]
fn resident_reads_do_not_present_owner_controls_as_tool_authority() {
    let controls = serde_json::json!({"reply": false, "continuation": false, "newMessage": false});
    let mut value = serde_json::json!({
        "scope": {"ownerPubkey":"owner"},
        "writeCapabilities": controls,
        "task": {"writeCapabilities": controls, "historyAccess":"task_history"},
        "tasks": [{"writeCapabilities":controls}],
        "events": [{"content":"untouched"}]
    });
    let original = value.clone();
    label_owner_controls_for_resident(&mut value);
    assert!(value.get("writeCapabilities").is_none());
    assert!(value["task"].get("writeCapabilities").is_none());
    assert!(value["tasks"][0].get("writeCapabilities").is_none());
    assert_eq!(value["ownerWriteCapabilities"], controls);
    assert_eq!(value["task"]["ownerWriteCapabilities"], controls);
    assert_eq!(value["tasks"][0]["ownerWriteCapabilities"], controls);
    assert_eq!(value["scope"], original["scope"]);
    assert_eq!(value["events"], original["events"]);
    assert_eq!(value["task"]["historyAccess"], "task_history");
    assert!(value["residentReplyAuthority"]
        .as_str()
        .unwrap()
        .contains("host revalidates"));
}

#[test]
fn inbox_subject_requires_exact_signed_root_and_source() {
    let keys = nostr::Keys::generate();
    let event = nostr::EventBuilder::new(nostr::Kind::from(9), "C: Summer\nUnrelated detail")
        .tags([nostr::Tag::parse(["h", "source-room"]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    let mut record = record();
    record.owner = Hex64::parse(keys.public_key().to_hex()).unwrap();
    let mut task = InboxTask {
        subject: None,
        logical_task_id: record.exchange_id.clone(),
        current_attempt_id: record.exchange_id.clone(),
        logical_root_event_id: Hex64::parse(event.id.to_hex()).unwrap(),
        write_capabilities: InboxWriteCapabilities {
            reply: false,
            continuation: false,
            new_message: false,
        },
        history_access: "current_source",
        correspondence_id: None,
        record,
        record_event_id: key('f'),
        record_updated_at: 100,
        outcome: "unknown",
    };
    assert_eq!(
        inbox_root_subject(&task, &event).as_deref(),
        Some("C: Summer")
    );
    task.record.conversation_id = luca_protocol::OpaqueId::parse("another-room").unwrap();
    assert_eq!(inbox_root_subject(&task, &event), None);
    task.record.conversation_id = luca_protocol::OpaqueId::parse("source-room").unwrap();
    task.logical_root_event_id = key('f');
    assert_eq!(inbox_root_subject(&task, &event), None);
}

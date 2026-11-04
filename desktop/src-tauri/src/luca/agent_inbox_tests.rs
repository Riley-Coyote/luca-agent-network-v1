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

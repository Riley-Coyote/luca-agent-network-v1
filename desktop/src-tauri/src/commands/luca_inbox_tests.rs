use super::*;
use nostr::{EventBuilder, Keys, Kind, Tag};
use serde_json::json;

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).expect("fixture pubkey")
}

fn id(value: &str) -> OpaqueId {
    OpaqueId::parse(value).expect("fixture ID")
}

fn time(value: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(value).expect("fixture timestamp")
}

fn scope(resident: bool) -> NativeInboxScopeV1 {
    NativeInboxScopeV1 {
        owner_pubkey: hex('1'),
        viewer_pubkey: if resident { hex('2') } else { hex('1') },
        resident_pubkey: resident.then(|| hex('2')),
    }
}

fn event_item(event_digit: char, resident_viewer: bool) -> AuthorizedNativeInboxFeedItemV1 {
    let scope = scope(resident_viewer);
    AuthorizedNativeInboxFeedItemV1 {
        source_kind: NativeInboxSourceKindV1::Message,
        conversation_kind: NativeInboxConversationKindV1::Direct,
        conversation_id: id("conversation-1"),
        author_pubkey: hex('3'),
        author_resident_pubkey: Some(hex('3')),
        recipient_pubkeys: if resident_viewer {
            vec![hex('1'), hex('2')]
        } else {
            vec![hex('1'), hex('3')]
        },
        mention_pubkeys: vec![scope.viewer_pubkey],
        source_event_id: Some(hex(event_digit)),
        local_state_id: None,
        thread_root_event_id: None,
        target_event_id: Some(hex(event_digit)),
        preview: Some("private preview".to_owned()),
        occurred_at: time("2026-08-11T12:00:00Z"),
        unread: true,
        acknowledged: false,
        handled: false,
        muted: false,
        requires_action: false,
    }
}

fn request(
    resident_viewer: bool,
    category: InboxCategoryV1,
    feed: Vec<AuthorizedNativeInboxFeedItemV1>,
) -> NativeInboxProjectionRequestV1 {
    NativeInboxProjectionRequestV1 {
        scope: scope(resident_viewer),
        category,
        generated_at: time("2026-08-11T12:01:00Z"),
        cursor: None,
        limit: 50,
        feed,
    }
}

fn signed_event(kind: u16, content: &str, tags: Vec<Vec<&str>>) -> nostr::Event {
    EventBuilder::new(Kind::from_u16(kind), content)
        .tags(
            tags.into_iter()
                .map(|values| Tag::parse(values).expect("fixture tag"))
                .collect::<Vec<_>>(),
        )
        .sign_with_keys(&Keys::generate())
        .expect("signed fixture event")
}

fn conversation(kind: NativeInboxConversationKindV1) -> AuthorizedConversationV1 {
    AuthorizedConversationV1 {
        channel_id: "conversation-1".to_owned(),
        channel_name: "Native conversation".to_owned(),
        conversation_kind: kind,
        recipient_pubkeys: vec![hex('1'), hex('2')],
    }
}

#[test]
fn overlapping_categories_produce_one_all_item() {
    let projection = project_native_inbox(request(
        false,
        InboxCategoryV1::All,
        vec![event_item('a', false)],
    ))
    .expect("projection");
    assert_eq!(projection.items.len(), 1);
    assert_eq!(
        projection.items[0].categories,
        vec![
            InboxCategoryV1::All,
            InboxCategoryV1::Direct,
            InboxCategoryV1::Mentions,
            InboxCategoryV1::Agents,
        ]
    );
}

#[test]
fn exact_duplicate_dedupes_but_conflicting_duplicate_fails() {
    let first = event_item('a', false);
    let exact = first.clone();
    let projection = project_native_inbox(request(
        false,
        InboxCategoryV1::All,
        vec![first.clone(), exact],
    ))
    .expect("deduped projection");
    assert_eq!(projection.items.len(), 1);

    let mut conflict = first.clone();
    conflict.preview = Some("different private preview".to_owned());
    assert!(matches!(
        project_native_inbox(request(false, InboxCategoryV1::All, vec![first, conflict])),
        Err(NativeInboxProjectionError::ConflictingDuplicate)
    ));
}

#[test]
fn resident_scope_cannot_receive_another_viewers_item() {
    let mut item = event_item('a', true);
    item.recipient_pubkeys = vec![hex('1'), hex('3')];
    assert!(matches!(
        project_native_inbox(request(true, InboxCategoryV1::All, vec![item])),
        Err(NativeInboxProjectionError::InvalidFeedItem)
    ));

    let mut invalid_scope = request(true, InboxCategoryV1::All, Vec::new());
    invalid_scope.scope.viewer_pubkey = hex('3');
    assert!(matches!(
        project_native_inbox(invalid_scope),
        Err(NativeInboxProjectionError::InvalidScope)
    ));
}

#[test]
fn category_filter_and_structural_deep_link_are_preserved() {
    let mut thread = event_item('a', false);
    thread.conversation_kind = NativeInboxConversationKindV1::Room;
    thread.mention_pubkeys.clear();
    thread.thread_root_event_id = Some(hex('b'));
    let projection = project_native_inbox(request(false, InboxCategoryV1::Threads, vec![thread]))
        .expect("thread projection");
    assert_eq!(projection.items.len(), 1);
    assert_eq!(projection.items[0].conversation_id, id("conversation-1"));
    assert_eq!(projection.items[0].thread_root_event_id, Some(hex('b')));
    assert_eq!(projection.items[0].target_event_id, Some(hex('a')));
}

#[test]
fn local_and_action_sources_map_to_exact_passive_categories() {
    let mut permission = event_item('a', false);
    permission.source_kind = NativeInboxSourceKindV1::PermissionRequest;
    permission.mention_pubkeys.clear();

    let mut reminder = event_item('b', false);
    reminder.source_kind = NativeInboxSourceKindV1::Reminder;
    reminder.mention_pubkeys.clear();

    let mut draft = event_item('c', false);
    draft.source_kind = NativeInboxSourceKindV1::Draft;
    draft.source_event_id = None;
    draft.local_state_id = Some(id("draft-1"));
    draft.target_event_id = None;
    draft.mention_pubkeys.clear();

    for (category, expected_kind, source) in [
        (
            InboxCategoryV1::NeedsAction,
            InboxItemKindV1::PermissionRequest,
            permission,
        ),
        (
            InboxCategoryV1::Reminders,
            InboxItemKindV1::Reminder,
            reminder,
        ),
        (InboxCategoryV1::Drafts, InboxItemKindV1::Draft, draft),
    ] {
        let projection =
            project_native_inbox(request(false, category, vec![source])).expect("projection");
        assert_eq!(projection.items.len(), 1);
        assert_eq!(projection.items[0].kind, expected_kind);
        assert!(projection.items[0].categories.contains(&category));
    }
}

#[test]
fn pagination_cursor_is_deterministic_and_body_free() {
    let mut first_page_request = request(
        false,
        InboxCategoryV1::All,
        vec![
            event_item('a', false),
            event_item('b', false),
            event_item('c', false),
        ],
    );
    first_page_request.limit = 2;
    let first = project_native_inbox(first_page_request.clone()).expect("first page");
    assert!(first.has_more);
    let cursor = first.next_cursor.clone().expect("next cursor");

    first_page_request.cursor = Some(cursor);
    let second = project_native_inbox(first_page_request).expect("second page");
    assert_eq!(second.items.len(), 1);
    assert!(!second.has_more);
    assert!(second.next_cursor.is_none());
    let debug = format!("{second:?}");
    assert!(!debug.contains("private preview"));
}

#[test]
fn passive_projection_ignores_unaddressed_room_chatter() {
    let mut chatter = event_item('a', false);
    chatter.conversation_kind = NativeInboxConversationKindV1::Room;
    chatter.mention_pubkeys.clear();
    chatter.author_resident_pubkey = None;
    let projection = project_native_inbox(request(false, InboxCategoryV1::All, vec![chatter]))
        .expect("empty passive projection");
    assert!(projection.items.is_empty());
}

#[test]
fn strict_input_rejects_paths_raw_events_and_unbounded_fields() {
    let item = event_item('a', false);
    for forbidden in ["path", "raw_event", "activation_request", "diagnostic_body"] {
        let mut value = serde_json::to_value(&item).expect("serialize source");
        value[forbidden] = json!("forbidden");
        assert!(serde_json::from_value::<AuthorizedNativeInboxFeedItemV1>(value).is_err());
    }
}

#[test]
fn invalid_limit_cursor_and_feed_bound_fail_closed() {
    let mut zero = request(false, InboxCategoryV1::All, Vec::new());
    zero.limit = 0;
    assert!(matches!(
        project_native_inbox(zero),
        Err(NativeInboxProjectionError::InvalidLimit)
    ));

    let mut cursor = request(false, InboxCategoryV1::All, vec![event_item('a', false)]);
    cursor.cursor = Some(id("not-present"));
    assert!(matches!(
        project_native_inbox(cursor),
        Err(NativeInboxProjectionError::CursorNotFound)
    ));

    let too_many = vec![event_item('a', false); MAX_NATIVE_INBOX_FEED_ITEMS + 1];
    assert!(matches!(
        project_native_inbox(request(false, InboxCategoryV1::All, too_many)),
        Err(NativeInboxProjectionError::FeedTooLarge)
    ));
}

#[test]
fn native_direct_projection_accepts_only_membership_restricted_kind_nine() {
    let managed = BTreeSet::new();
    let dm = conversation(NativeInboxConversationKindV1::Direct);
    let kind_nine = signed_event(9, "private direct body", vec![vec!["h", "conversation-1"]]);
    let accepted = authorized_message_candidate(&kind_nine, &hex('1'), &dm, &managed)
        .expect("candidate validation")
        .expect("kind-9 DM accepted");
    assert_eq!(accepted.1.categories, vec![InboxCategoryV1::Direct]);
    let event_author = Hex64::parse(kind_nine.pubkey.to_hex()).expect("event author");
    assert!(
        authorized_message_candidate(&kind_nine, &event_author, &dm, &managed)
            .expect("self-authored candidate validation")
            .is_none()
    );

    let broader_kind = signed_event(
        40_002,
        "must not enter Direct",
        vec![vec!["h", "conversation-1"]],
    );
    assert!(
        authorized_message_candidate(&broader_kind, &hex('1'), &dm, &managed)
            .expect("candidate validation")
            .is_none()
    );
}

#[test]
fn room_projection_requires_exact_local_managed_agent_authorship() {
    let room = conversation(NativeInboxConversationKindV1::Room);
    let event = signed_event(
        40_002,
        "managed room update",
        vec![vec!["h", "conversation-1"]],
    );
    let event_author = Hex64::parse(event.pubkey.to_hex()).expect("event author");

    assert!(
        authorized_message_candidate(&event, &hex('1'), &room, &BTreeSet::new())
            .expect("candidate validation")
            .is_none()
    );
    let managed = BTreeSet::from([event_author]);
    let accepted = authorized_message_candidate(&event, &hex('1'), &room, &managed)
        .expect("candidate validation")
        .expect("managed author accepted");
    assert_eq!(accepted.1.categories, vec![InboxCategoryV1::Agents]);
}

#[test]
fn current_membership_and_hidden_snapshot_helpers_fail_closed() {
    let owner_one = "1".repeat(64);
    let owner_two = "2".repeat(64);
    let old = signed_event(
        39_002,
        "",
        vec![vec!["d", "conversation-1"], vec!["p", owner_one.as_str()]],
    );
    let latest = signed_event(
        39_002,
        "",
        vec![vec!["d", "conversation-1"], vec!["p", owner_two.as_str()]],
    );
    let expected = [&old, &latest]
        .into_iter()
        .max_by_key(|event| (event.created_at.as_secs(), event.id.to_hex()))
        .expect("membership fixture");
    let expected_id = expected.id;
    let expected_members = valid_pubkey_tags(expected, "p");
    let newest = newest_event_by_d(vec![old, latest]);
    assert_eq!(newest["conversation-1"].id, expected_id);
    assert_eq!(
        valid_pubkey_tags(&newest["conversation-1"], "p"),
        expected_members
    );

    let hidden = signed_event(
        buzz_core_pkg::kind::KIND_DM_VISIBILITY as u16,
        "",
        vec![vec!["h", "conversation-1"]],
    );
    assert_eq!(
        hidden_channel_ids(&[hidden]),
        BTreeSet::from(["conversation-1".to_owned()])
    );
}

#[test]
fn presentation_debug_redacts_private_message_body_and_identifiers() {
    let item = OwnerNativeInboxPresentationItemV1 {
        source_event_id: hex('a'),
        kind: 9,
        author_pubkey: hex('2'),
        content: "private Inbox message".to_owned(),
        created_at: 1,
        channel_id: id("conversation-1"),
        channel_name: "Private DM".to_owned(),
        channel_type: NativeInboxConversationKindV1::Direct,
        structural_tags: vec![vec!["h".to_owned(), "conversation-1".to_owned()]],
        categories: vec![InboxCategoryV1::Direct],
    };
    let debug = format!("{item:?}");
    assert!(!debug.contains("private Inbox message"));
    assert!(!debug.contains("conversation-1"));
    assert!(!debug.contains(hex('a').as_str()));
    assert!(debug.contains("[REDACTED]"));
}

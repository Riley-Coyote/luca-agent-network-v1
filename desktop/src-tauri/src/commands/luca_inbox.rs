//! Deterministic native Inbox projection boundary.
//!
//! This module deliberately accepts only already-authorized semantic native
//! feed inputs. It does not query the relay, decrypt direct messages, infer
//! resident custody, mutate read state, activate an agent, or publish an event.
//! Those authority-bearing steps remain with their existing native owners.
//! Registration must therefore pair this helper with a command that constructs
//! `NativeInboxProjectionRequestV1` exclusively from trusted desktop state.

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, CommunicationContractError, Hex64, InboxCategoryV1,
    InboxItemKindV1, InboxItemV1, InboxProjectionV1, OpaqueId, ProtocolValueError,
    INBOX_PROJECTION_PROTOCOL, MAX_COMMUNICATION_PARTICIPANTS, MAX_INBOX_ITEMS,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Largest authorized native candidate set accepted by one projection pass.
pub(crate) const MAX_NATIVE_INBOX_FEED_ITEMS: usize = 4_096;

/// Whether an authorized event belongs to a direct conversation or a room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeInboxConversationKindV1 {
    Direct,
    Room,
}

/// Native source class before deterministic Inbox relevance is derived.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeInboxSourceKindV1 {
    Message,
    PermissionRequest,
    Reminder,
    Draft,
}

/// Exact owner or resident scope for one native Inbox projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeInboxScopeV1 {
    pub owner_pubkey: Hex64,
    pub viewer_pubkey: Hex64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_pubkey: Option<Hex64>,
}

impl NativeInboxScopeV1 {
    fn validate(&self) -> Result<(), NativeInboxProjectionError> {
        match &self.resident_pubkey {
            Some(resident) if resident == &self.owner_pubkey || resident != &self.viewer_pubkey => {
                Err(NativeInboxProjectionError::InvalidScope)
            }
            None if self.viewer_pubkey != self.owner_pubkey => {
                Err(NativeInboxProjectionError::InvalidScope)
            }
            _ => Ok(()),
        }
    }
}

/// One trusted, semantic feed candidate supplied by a native source adapter.
///
/// Exactly one of `source_event_id` and `local_state_id` must be present. The
/// struct contains structural deep-link IDs rather than URLs or filesystem
/// paths. `author_resident_pubkey` is populated only after local custody proof.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AuthorizedNativeInboxFeedItemV1 {
    pub source_kind: NativeInboxSourceKindV1,
    pub conversation_kind: NativeInboxConversationKindV1,
    pub conversation_id: OpaqueId,
    pub author_pubkey: Hex64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_resident_pubkey: Option<Hex64>,
    pub recipient_pubkeys: Vec<Hex64>,
    pub mention_pubkeys: Vec<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_state_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_root_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub occurred_at: CanonicalTimestamp,
    pub unread: bool,
    pub acknowledged: bool,
    pub handled: bool,
    pub muted: bool,
    pub requires_action: bool,
}

impl std::fmt::Debug for AuthorizedNativeInboxFeedItemV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AuthorizedNativeInboxFeedItemV1")
            .field("source_kind", &self.source_kind)
            .field("conversation_kind", &self.conversation_kind)
            .field("conversation_id", &self.conversation_id)
            .field("author_pubkey", &self.author_pubkey)
            .field("author_resident_pubkey", &self.author_resident_pubkey)
            .field("recipient_count", &self.recipient_pubkeys.len())
            .field("mention_count", &self.mention_pubkeys.len())
            .field("source_event_id", &self.source_event_id)
            .field("local_state_id", &self.local_state_id)
            .field("thread_root_event_id", &self.thread_root_event_id)
            .field("target_event_id", &self.target_event_id)
            .field("preview", &self.preview.as_ref().map(|_| "[REDACTED]"))
            .field("occurred_at", &self.occurred_at)
            .field("unread", &self.unread)
            .field("acknowledged", &self.acknowledged)
            .field("handled", &self.handled)
            .field("muted", &self.muted)
            .field("requires_action", &self.requires_action)
            .finish()
    }
}

/// Trusted request assembled by the future native Inbox command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct NativeInboxProjectionRequestV1 {
    pub scope: NativeInboxScopeV1,
    pub category: InboxCategoryV1,
    pub generated_at: CanonicalTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<OpaqueId>,
    pub limit: u16,
    pub feed: Vec<AuthorizedNativeInboxFeedItemV1>,
}

/// Deterministic native projection failure. It contains no message body,
/// preview, local path, relay event, or secret value.
#[derive(Debug, thiserror::Error)]
pub(crate) enum NativeInboxProjectionError {
    #[error("native Inbox scope is invalid")]
    InvalidScope,
    #[error("native Inbox projection limit is invalid")]
    InvalidLimit,
    #[error("native Inbox feed exceeds its bounded candidate limit")]
    FeedTooLarge,
    #[error("native Inbox feed item is not canonical or authorized for this viewer")]
    InvalidFeedItem,
    #[error("native Inbox feed contains a conflicting duplicate source")]
    ConflictingDuplicate,
    #[error("native Inbox cursor does not identify an item in this projection")]
    CursorNotFound,
    #[error("native Inbox canonical identity could not be derived")]
    CanonicalIdentity,
    #[error(transparent)]
    Protocol(#[from] CommunicationContractError),
    #[error(transparent)]
    ProtocolValue(#[from] ProtocolValueError),
}

#[derive(Serialize)]
struct InboxItemIdentityMaterial<'a> {
    source_event_id: &'a Option<Hex64>,
    local_state_id: &'a Option<OpaqueId>,
}

#[derive(Serialize)]
struct InboxProjectionIdentityMaterial<'a> {
    owner_pubkey: &'a Hex64,
    viewer_pubkey: &'a Hex64,
    resident_pubkey: &'a Option<Hex64>,
    category: InboxCategoryV1,
    generated_at: &'a CanonicalTimestamp,
    cursor: &'a Option<OpaqueId>,
    item_ids: Vec<&'a OpaqueId>,
    has_more: bool,
}

fn canonical_id(
    prefix: &str,
    value: &impl Serialize,
) -> Result<OpaqueId, NativeInboxProjectionError> {
    let digest =
        canonical_sha256(value).map_err(|_| NativeInboxProjectionError::CanonicalIdentity)?;
    OpaqueId::parse(format!("{prefix}:{digest}")).map_err(NativeInboxProjectionError::ProtocolValue)
}

fn sorted_unique<T: Ord>(values: &[T]) -> bool {
    !values.is_empty() && values.windows(2).all(|pair| pair[0] < pair[1])
}

fn project_item(
    scope: &NativeInboxScopeV1,
    source: &AuthorizedNativeInboxFeedItemV1,
) -> Result<Option<InboxItemV1>, NativeInboxProjectionError> {
    if !sorted_unique(&source.recipient_pubkeys)
        || source
            .mention_pubkeys
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || source.mention_pubkeys.len() > MAX_COMMUNICATION_PARTICIPANTS
        || source
            .mention_pubkeys
            .iter()
            .any(|mention| !source.recipient_pubkeys.contains(mention))
        || !source.recipient_pubkeys.contains(&scope.viewer_pubkey)
        || (source.source_event_id.is_none() == source.local_state_id.is_none())
        || source
            .author_resident_pubkey
            .as_ref()
            .is_some_and(|resident| resident != &source.author_pubkey)
        || ((source.source_kind == NativeInboxSourceKindV1::Draft)
            != source.local_state_id.is_some())
        || source.acknowledged && source.unread
        || source.handled && source.requires_action
    {
        return Err(NativeInboxProjectionError::InvalidFeedItem);
    }

    let mentioned = source
        .mention_pubkeys
        .binary_search(&scope.viewer_pubkey)
        .is_ok();
    let is_thread = source.thread_root_event_id.is_some();
    let is_direct = source.conversation_kind == NativeInboxConversationKindV1::Direct;
    let is_agent = source.author_resident_pubkey.is_some();
    let needs_action =
        source.requires_action || source.source_kind == NativeInboxSourceKindV1::PermissionRequest;

    let kind = match source.source_kind {
        NativeInboxSourceKindV1::PermissionRequest => InboxItemKindV1::PermissionRequest,
        NativeInboxSourceKindV1::Reminder => InboxItemKindV1::Reminder,
        NativeInboxSourceKindV1::Draft => InboxItemKindV1::Draft,
        NativeInboxSourceKindV1::Message if is_thread => InboxItemKindV1::ThreadReply,
        NativeInboxSourceKindV1::Message if mentioned => InboxItemKindV1::Mention,
        NativeInboxSourceKindV1::Message if is_direct => InboxItemKindV1::DirectMessage,
        NativeInboxSourceKindV1::Message if is_agent => InboxItemKindV1::AgentMessage,
        NativeInboxSourceKindV1::Message => return Ok(None),
    };

    let primary_category = match kind {
        InboxItemKindV1::PermissionRequest => InboxCategoryV1::NeedsAction,
        InboxItemKindV1::DirectMessage => InboxCategoryV1::Direct,
        InboxItemKindV1::Mention => InboxCategoryV1::Mentions,
        InboxItemKindV1::ThreadReply => InboxCategoryV1::Threads,
        InboxItemKindV1::AgentMessage => InboxCategoryV1::Agents,
        InboxItemKindV1::Reminder => InboxCategoryV1::Reminders,
        InboxItemKindV1::Draft => InboxCategoryV1::Drafts,
    };
    let mut categories = BTreeSet::from([InboxCategoryV1::All, primary_category]);
    if is_direct {
        categories.insert(InboxCategoryV1::Direct);
    }
    if mentioned {
        categories.insert(InboxCategoryV1::Mentions);
    }
    if is_thread {
        categories.insert(InboxCategoryV1::Threads);
    }
    if needs_action {
        categories.insert(InboxCategoryV1::NeedsAction);
    }
    if is_agent {
        categories.insert(InboxCategoryV1::Agents);
    }
    if source.source_kind == NativeInboxSourceKindV1::Reminder {
        categories.insert(InboxCategoryV1::Reminders);
    }
    if source.source_kind == NativeInboxSourceKindV1::Draft {
        categories.insert(InboxCategoryV1::Drafts);
    }

    let item_id = canonical_id(
        "inbox-item",
        &InboxItemIdentityMaterial {
            source_event_id: &source.source_event_id,
            local_state_id: &source.local_state_id,
        },
    )?;
    let item = InboxItemV1 {
        protocol: INBOX_PROJECTION_PROTOCOL.to_owned(),
        item_id,
        owner_pubkey: scope.owner_pubkey.clone(),
        viewer_pubkey: scope.viewer_pubkey.clone(),
        resident_pubkey: scope.resident_pubkey.clone(),
        recipient_pubkeys: source.recipient_pubkeys.clone(),
        kind,
        primary_category,
        categories: categories.into_iter().collect(),
        conversation_id: source.conversation_id.clone(),
        source_event_id: source.source_event_id.clone(),
        local_state_id: source.local_state_id.clone(),
        thread_root_event_id: source.thread_root_event_id.clone(),
        target_event_id: source.target_event_id.clone(),
        preview: source.preview.clone(),
        occurred_at: source.occurred_at.clone(),
        unread: source.unread,
        acknowledged: source.acknowledged,
        handled: source.handled,
        muted: source.muted,
        requires_action: needs_action,
    };
    item.validate()?;
    Ok(Some(item))
}

/// Project already-authorized native feed inputs into one deterministic,
/// passive Inbox page.
///
/// This function performs no I/O and has no side effects. In particular, it
/// cannot acknowledge an item, activate a resident, request permission, send a
/// message, or mutate relay/native state.
pub(crate) fn project_native_inbox(
    request: NativeInboxProjectionRequestV1,
) -> Result<InboxProjectionV1, NativeInboxProjectionError> {
    request.scope.validate()?;
    let limit = usize::from(request.limit);
    if limit == 0 || limit > MAX_INBOX_ITEMS {
        return Err(NativeInboxProjectionError::InvalidLimit);
    }
    if request.feed.len() > MAX_NATIVE_INBOX_FEED_ITEMS {
        return Err(NativeInboxProjectionError::FeedTooLarge);
    }

    let mut unique = BTreeMap::<OpaqueId, InboxItemV1>::new();
    for source in &request.feed {
        let Some(item) = project_item(&request.scope, source)? else {
            continue;
        };
        match unique.get(&item.item_id) {
            Some(existing) if existing == &item => {}
            Some(_) => return Err(NativeInboxProjectionError::ConflictingDuplicate),
            None => {
                unique.insert(item.item_id.clone(), item);
            }
        }
    }

    let ordered: Vec<InboxItemV1> = unique
        .into_values()
        .filter(|item| item.categories.contains(&request.category))
        .collect();
    let start = if let Some(cursor) = &request.cursor {
        ordered
            .iter()
            .position(|item| &item.item_id == cursor)
            .map(|index| index + 1)
            .ok_or(NativeInboxProjectionError::CursorNotFound)?
    } else {
        0
    };
    let has_more = ordered.len().saturating_sub(start) > limit;
    let items: Vec<InboxItemV1> = ordered.into_iter().skip(start).take(limit).collect();
    let next_cursor = if has_more {
        items.last().map(|item| item.item_id.clone())
    } else {
        None
    };
    let projection_id = canonical_id(
        "inbox-projection",
        &InboxProjectionIdentityMaterial {
            owner_pubkey: &request.scope.owner_pubkey,
            viewer_pubkey: &request.scope.viewer_pubkey,
            resident_pubkey: &request.scope.resident_pubkey,
            category: request.category,
            generated_at: &request.generated_at,
            cursor: &request.cursor,
            item_ids: items.iter().map(|item| &item.item_id).collect(),
            has_more,
        },
    )?;
    let projection = InboxProjectionV1 {
        protocol: INBOX_PROJECTION_PROTOCOL.to_owned(),
        projection_id,
        owner_pubkey: request.scope.owner_pubkey,
        viewer_pubkey: request.scope.viewer_pubkey,
        resident_pubkey: request.scope.resident_pubkey,
        category: request.category,
        generated_at: request.generated_at,
        items,
        next_cursor,
        has_more,
    };
    projection.validate()?;
    Ok(projection)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let projection =
            project_native_inbox(request(false, InboxCategoryV1::Threads, vec![thread]))
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
}

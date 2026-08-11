//! Deterministic native Inbox projection boundary.
//! The pure projection below accepts only already-authorized semantic native
//! feed inputs. The command adapter at the bottom of this file constructs those
//! inputs from exact owner membership snapshots, channel metadata, the private
//! hidden-DM snapshot, and Luca's local managed-agent registry. It never mutates
//! read state, activates an agent, or publishes an event.

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, CommunicationContractError, Hex64, InboxCategoryV1,
    InboxItemKindV1, InboxItemV1, InboxProjectionV1, OpaqueId, ProtocolValueError,
    INBOX_PROJECTION_PROTOCOL, MAX_COMMUNICATION_PARTICIPANTS, MAX_INBOX_ITEMS,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, State};

use crate::{
    app_state::AppState, managed_agents::load_managed_agents, nostr_convert, relay::query_relay,
};

/// Largest authorized native candidate set accepted by one projection pass.
pub(crate) const MAX_NATIVE_INBOX_FEED_ITEMS: usize = 4_096;
const MAX_NATIVE_INBOX_CHANNELS: usize = 256;
const DEFAULT_NATIVE_INBOX_LIMIT: usize = 100;

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

#[path = "luca_inbox_types.rs"]
mod types;
use types::*;

#[derive(Clone)]
struct AuthorizedConversationV1 {
    channel_id: String,
    channel_name: String,
    conversation_kind: NativeInboxConversationKindV1,
    recipient_pubkeys: Vec<Hex64>,
}

fn first_tag_value<'a>(event: &'a nostr::Event, name: &str) -> Option<&'a str> {
    event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.len() >= 2 && values[0] == name).then(|| values[1].as_str())
    })
}

fn valid_pubkey_tags(event: &nostr::Event, name: &str) -> Vec<Hex64> {
    let mut values: Vec<Hex64> = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.len() >= 2 && values[0] == name)
                .then(|| Hex64::parse(values[1].to_ascii_lowercase()).ok())
                .flatten()
        })
        .collect();
    values.sort();
    values.dedup();
    values
}

fn newest_event_by_d(events: Vec<nostr::Event>) -> BTreeMap<String, nostr::Event> {
    let mut current = BTreeMap::<String, nostr::Event>::new();
    for event in events {
        let Some(d_tag) = first_tag_value(&event, "d").map(str::to_owned) else {
            continue;
        };
        let replace = current.get(&d_tag).is_none_or(|existing| {
            (event.created_at.as_secs(), event.id.to_hex())
                > (existing.created_at.as_secs(), existing.id.to_hex())
        });
        if replace {
            current.insert(d_tag, event);
        }
    }
    current
}

fn hidden_channel_ids(events: &[nostr::Event]) -> BTreeSet<String> {
    events
        .iter()
        .max_by_key(|event| (event.created_at.as_secs(), event.id.to_hex()))
        .into_iter()
        .flat_map(|event| event.tags.iter())
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.len() >= 2 && values[0] == "h").then(|| values[1].clone())
        })
        .collect()
}

fn structural_tags(event: &nostr::Event) -> Vec<Vec<String>> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            matches!(
                values.first().map(String::as_str),
                Some("h" | "e" | "p" | "broadcast")
            )
            .then(|| values.to_vec())
        })
        .collect()
}

fn thread_reference(event: &nostr::Event) -> (Option<Hex64>, Option<Hex64>) {
    let mut root = None;
    let mut reply = None;
    for tag in &event.tags {
        let values = tag.as_slice();
        if values.len() < 2 || values[0] != "e" {
            continue;
        }
        let Ok(event_id) = Hex64::parse(values[1].to_ascii_lowercase()) else {
            continue;
        };
        match values.get(3).map(String::as_str) {
            Some("root") => root = Some(event_id),
            Some("reply") => reply = Some(event_id),
            _ => {}
        }
    }
    let target = reply.clone();
    (root.or(reply), target)
}

fn authorized_message_candidate(
    event: &nostr::Event,
    owner: &Hex64,
    conversation: &AuthorizedConversationV1,
    managed_agent_pubkeys: &BTreeSet<Hex64>,
) -> Result<
    Option<(
        AuthorizedNativeInboxFeedItemV1,
        OwnerNativeInboxPresentationItemV1,
    )>,
    NativeInboxProjectionError,
> {
    let kind = u32::from(event.kind.as_u16());
    if kind != 9 && kind != 40_002 {
        return Ok(None);
    }
    // DMs are membership-restricted kind-9 events. A broader timeline kind
    // must never enter Direct even when it carries the same channel tag.
    if conversation.conversation_kind == NativeInboxConversationKindV1::Direct && kind != 9 {
        return Ok(None);
    }
    if first_tag_value(event, "h") != Some(conversation.channel_id.as_str()) {
        return Ok(None);
    }

    let author_pubkey = Hex64::parse(event.pubkey.to_hex())?;
    // Inbox is an inbound projection. Owner-authored messages remain in the
    // canonical conversation, but must not be presented as new mail to self.
    if &author_pubkey == owner {
        return Ok(None);
    }
    let author_is_managed = managed_agent_pubkeys.contains(&author_pubkey);
    if conversation.conversation_kind == NativeInboxConversationKindV1::Room && !author_is_managed {
        return Ok(None);
    }

    let mention_pubkeys: Vec<Hex64> = valid_pubkey_tags(event, "p")
        .into_iter()
        .filter(|pubkey| conversation.recipient_pubkeys.binary_search(pubkey).is_ok())
        .collect();
    let source_event_id = Hex64::parse(event.id.to_hex())?;
    let channel_id = OpaqueId::parse(conversation.channel_id.clone())?;
    let (thread_root_event_id, target_event_id) = thread_reference(event);
    let source = AuthorizedNativeInboxFeedItemV1 {
        source_kind: NativeInboxSourceKindV1::Message,
        conversation_kind: conversation.conversation_kind,
        conversation_id: channel_id.clone(),
        author_pubkey: author_pubkey.clone(),
        author_resident_pubkey: author_is_managed.then(|| author_pubkey.clone()),
        recipient_pubkeys: conversation.recipient_pubkeys.clone(),
        mention_pubkeys,
        source_event_id: Some(source_event_id.clone()),
        local_state_id: None,
        thread_root_event_id,
        target_event_id: target_event_id.or_else(|| Some(source_event_id.clone())),
        preview: Some(event.content.clone()),
        occurred_at: CanonicalTimestamp::parse(nostr_convert::timestamp_to_iso(
            event.created_at.as_secs(),
        ))?,
        // Read authority remains in the existing frontend NIP-RS/local-state
        // resolver. The adapter makes no unread or acknowledgement claim.
        unread: false,
        acknowledged: false,
        handled: false,
        muted: false,
        requires_action: false,
    };

    let mut categories = Vec::new();
    if conversation.conversation_kind == NativeInboxConversationKindV1::Direct {
        categories.push(InboxCategoryV1::Direct);
    }
    if author_is_managed {
        categories.push(InboxCategoryV1::Agents);
    }
    let presentation = OwnerNativeInboxPresentationItemV1 {
        source_event_id,
        kind,
        author_pubkey,
        content: event.content.clone(),
        created_at: event.created_at.as_secs(),
        channel_id,
        channel_name: conversation.channel_name.clone(),
        channel_type: conversation.conversation_kind,
        structural_tags: structural_tags(event),
        categories,
    };
    debug_assert!(conversation.recipient_pubkeys.binary_search(owner).is_ok());
    Ok(Some((source, presentation)))
}

fn empty_owner_projection(
    owner_pubkey: Hex64,
    generated_at: CanonicalTimestamp,
) -> Result<InboxProjectionV1, NativeInboxProjectionError> {
    project_native_inbox(NativeInboxProjectionRequestV1 {
        scope: NativeInboxScopeV1 {
            owner_pubkey: owner_pubkey.clone(),
            viewer_pubkey: owner_pubkey,
            resident_pubkey: None,
        },
        category: InboxCategoryV1::All,
        generated_at,
        cursor: None,
        limit: 1,
        feed: Vec::new(),
    })
}

fn source_report(
    source: OwnerInboxSourceV1,
    availability: OwnerInboxSourceAvailabilityV1,
    diagnostic_code: Option<&str>,
) -> OwnerInboxSourceReportV1 {
    OwnerInboxSourceReportV1 {
        source,
        availability,
        diagnostic_code: diagnostic_code.map(str::to_owned),
    }
}

/// Return a passive owner Inbox projection from authoritative native data.
///
/// Failure in one optional source is represented in `sources`; it does not
/// fabricate items or make the remaining authorized source unavailable.
#[tauri::command]
pub async fn get_luca_owner_inbox(
    since: Option<i64>,
    limit: Option<u16>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OwnerNativeInboxResponseV1, String> {
    let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "owner Inbox identity is invalid".to_string())?;
    let generated_at = CanonicalTimestamp::parse(nostr_convert::timestamp_to_iso(
        chrono::Utc::now().timestamp().max(0) as u64,
    ))
    .map_err(|_| "owner Inbox timestamp is invalid".to_string())?;
    let requested_limit =
        usize::from(limit.unwrap_or(DEFAULT_NATIVE_INBOX_LIMIT as u16)).clamp(1, MAX_INBOX_ITEMS);

    let mut sources = vec![source_report(
        OwnerInboxSourceV1::ReadState,
        OwnerInboxSourceAvailabilityV1::Ready,
        Some("frontend_read_state_authority"),
    )];

    let membership_seed = match query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [39002],
            "#p": [owner_pubkey.as_str()],
            "limit": MAX_NATIVE_INBOX_CHANNELS + 1,
        })],
    )
    .await
    {
        Ok(events) => events,
        Err(_) => {
            sources.extend([
                source_report(
                    OwnerInboxSourceV1::ConversationMembership,
                    OwnerInboxSourceAvailabilityV1::Unavailable,
                    Some("membership_query_failed"),
                ),
                source_report(
                    OwnerInboxSourceV1::DirectMessages,
                    OwnerInboxSourceAvailabilityV1::Unavailable,
                    Some("membership_unavailable"),
                ),
                source_report(
                    OwnerInboxSourceV1::ManagedAgentMessages,
                    OwnerInboxSourceAvailabilityV1::Unavailable,
                    Some("membership_unavailable"),
                ),
            ]);
            return Ok(OwnerNativeInboxResponseV1 {
                projection: empty_owner_projection(owner_pubkey, generated_at)
                    .map_err(|error| error.to_string())?,
                presentation_items: Vec::new(),
                sources,
            });
        }
    };

    let membership_truncated = membership_seed.len() > MAX_NATIVE_INBOX_CHANNELS;
    let mut candidate_channel_ids: Vec<String> = membership_seed
        .iter()
        .filter_map(|event| first_tag_value(event, "d").map(str::to_owned))
        .collect();
    candidate_channel_ids.sort();
    candidate_channel_ids.dedup();
    candidate_channel_ids.truncate(MAX_NATIVE_INBOX_CHANNELS);

    let current_membership = if candidate_channel_ids.is_empty() {
        Vec::new()
    } else {
        match query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [39002],
                "#d": candidate_channel_ids,
                "limit": MAX_NATIVE_INBOX_CHANNELS,
            })],
        )
        .await
        {
            Ok(events) => events,
            Err(_) => {
                sources.extend([
                    source_report(
                        OwnerInboxSourceV1::ConversationMembership,
                        OwnerInboxSourceAvailabilityV1::Unavailable,
                        Some("current_membership_query_failed"),
                    ),
                    source_report(
                        OwnerInboxSourceV1::DirectMessages,
                        OwnerInboxSourceAvailabilityV1::Unavailable,
                        Some("membership_unavailable"),
                    ),
                    source_report(
                        OwnerInboxSourceV1::ManagedAgentMessages,
                        OwnerInboxSourceAvailabilityV1::Unavailable,
                        Some("membership_unavailable"),
                    ),
                ]);
                return Ok(OwnerNativeInboxResponseV1 {
                    projection: empty_owner_projection(owner_pubkey, generated_at)
                        .map_err(|error| error.to_string())?,
                    presentation_items: Vec::new(),
                    sources,
                });
            }
        }
    };
    let current_membership = newest_event_by_d(current_membership);
    let authorized_memberships: BTreeMap<String, Vec<Hex64>> = current_membership
        .into_iter()
        .filter_map(|(channel_id, event)| {
            let members = valid_pubkey_tags(&event, "p");
            members
                .binary_search(&owner_pubkey)
                .is_ok()
                .then_some((channel_id, members))
        })
        .collect();
    sources.push(source_report(
        OwnerInboxSourceV1::ConversationMembership,
        if authorized_memberships.is_empty() {
            OwnerInboxSourceAvailabilityV1::Empty
        } else if membership_truncated {
            OwnerInboxSourceAvailabilityV1::Degraded
        } else {
            OwnerInboxSourceAvailabilityV1::Ready
        },
        membership_truncated.then_some("membership_channel_limit_reached"),
    ));

    let channel_ids: Vec<String> = authorized_memberships.keys().cloned().collect();
    let metadata = if channel_ids.is_empty() {
        Vec::new()
    } else {
        match query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [39000],
                "#d": channel_ids,
                "limit": MAX_NATIVE_INBOX_CHANNELS,
            })],
        )
        .await
        {
            Ok(events) => events,
            Err(_) => {
                sources.extend([
                    source_report(
                        OwnerInboxSourceV1::DirectMessages,
                        OwnerInboxSourceAvailabilityV1::Unavailable,
                        Some("channel_metadata_query_failed"),
                    ),
                    source_report(
                        OwnerInboxSourceV1::ManagedAgentMessages,
                        OwnerInboxSourceAvailabilityV1::Unavailable,
                        Some("channel_metadata_query_failed"),
                    ),
                ]);
                return Ok(OwnerNativeInboxResponseV1 {
                    projection: empty_owner_projection(owner_pubkey, generated_at)
                        .map_err(|error| error.to_string())?,
                    presentation_items: Vec::new(),
                    sources,
                });
            }
        }
    };
    let metadata = newest_event_by_d(metadata);

    let hidden_dm_result = query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_DM_VISIBILITY],
            "#p": [owner_pubkey.as_str()],
            "limit": 1,
        })],
    )
    .await;
    let hidden_dm_query_failed = hidden_dm_result.is_err();
    let hidden_dms = hidden_dm_result
        .as_deref()
        .map(hidden_channel_ids)
        .unwrap_or_default();

    let mut conversations = Vec::new();
    for (channel_id, event) in metadata {
        let Some(members) = authorized_memberships.get(&channel_id).cloned() else {
            continue;
        };
        let Ok(info) = nostr_convert::channel_info_from_event(&event, None, Some(true)) else {
            continue;
        };
        let conversation_kind = if info.channel_type == "dm" {
            NativeInboxConversationKindV1::Direct
        } else {
            NativeInboxConversationKindV1::Room
        };
        if conversation_kind == NativeInboxConversationKindV1::Direct
            && (hidden_dm_query_failed || hidden_dms.contains(&channel_id))
        {
            continue;
        }
        conversations.push(AuthorizedConversationV1 {
            channel_id,
            channel_name: info.name,
            conversation_kind,
            recipient_pubkeys: members,
        });
    }

    let mut managed_agent_pubkeys = BTreeSet::new();
    let managed_registry_failed = match load_managed_agents(&app) {
        Ok(records) => {
            for record in records {
                if let Ok(pubkey) = Hex64::parse(record.pubkey.to_ascii_lowercase()) {
                    managed_agent_pubkeys.insert(pubkey);
                }
            }
            false
        }
        Err(_) => true,
    };

    let dm_ids: Vec<&str> = conversations
        .iter()
        .filter(|conversation| {
            conversation.conversation_kind == NativeInboxConversationKindV1::Direct
        })
        .map(|conversation| conversation.channel_id.as_str())
        .collect();
    let room_ids: Vec<&str> = conversations
        .iter()
        .filter(|conversation| {
            conversation.conversation_kind == NativeInboxConversationKindV1::Room
        })
        .map(|conversation| conversation.channel_id.as_str())
        .collect();
    let mut message_filters = Vec::new();
    if !dm_ids.is_empty() {
        let mut filter = serde_json::json!({
            "kinds": [9],
            "#h": dm_ids,
            "limit": MAX_NATIVE_INBOX_FEED_ITEMS,
        });
        if let Some(since) = since.filter(|value| *value >= 0) {
            filter["since"] = serde_json::json!(since);
        }
        message_filters.push(filter);
    }
    if !room_ids.is_empty() && !managed_agent_pubkeys.is_empty() {
        let mut filter = serde_json::json!({
            "kinds": [9, 40002],
            "#h": room_ids,
            "authors": managed_agent_pubkeys
                .iter()
                .map(Hex64::as_str)
                .collect::<Vec<_>>(),
            "limit": MAX_NATIVE_INBOX_FEED_ITEMS,
        });
        if let Some(since) = since.filter(|value| *value >= 0) {
            filter["since"] = serde_json::json!(since);
        }
        message_filters.push(filter);
    }

    let message_query = if message_filters.is_empty() {
        Ok(Vec::new())
    } else {
        query_relay(&state, &message_filters).await
    };
    let message_query_failed = message_query.is_err();
    let conversation_by_id: BTreeMap<&str, &AuthorizedConversationV1> = conversations
        .iter()
        .map(|conversation| (conversation.channel_id.as_str(), conversation))
        .collect();
    let mut admitted = Vec::new();
    if let Ok(events) = message_query {
        for event in events {
            let Some(channel_id) = first_tag_value(&event, "h") else {
                continue;
            };
            let Some(conversation) = conversation_by_id.get(channel_id) else {
                continue;
            };
            if let Ok(Some(candidate)) = authorized_message_candidate(
                &event,
                &owner_pubkey,
                conversation,
                &managed_agent_pubkeys,
            ) {
                admitted.push(candidate);
            }
        }
    }
    admitted.sort_by(|left, right| {
        (right.1.created_at, right.1.source_event_id.as_str())
            .cmp(&(left.1.created_at, left.1.source_event_id.as_str()))
    });
    admitted.truncate(requested_limit);

    let direct_count = admitted
        .iter()
        .filter(|(_, item)| item.categories.contains(&InboxCategoryV1::Direct))
        .count();
    let agent_count = admitted
        .iter()
        .filter(|(_, item)| item.categories.contains(&InboxCategoryV1::Agents))
        .count();
    sources.extend([
        source_report(
            OwnerInboxSourceV1::DirectMessages,
            if hidden_dm_query_failed {
                OwnerInboxSourceAvailabilityV1::Unavailable
            } else if message_query_failed && !dm_ids.is_empty() {
                OwnerInboxSourceAvailabilityV1::Degraded
            } else if direct_count == 0 {
                OwnerInboxSourceAvailabilityV1::Empty
            } else {
                OwnerInboxSourceAvailabilityV1::Ready
            },
            if hidden_dm_query_failed {
                Some("hidden_dm_snapshot_unavailable")
            } else if message_query_failed && !dm_ids.is_empty() {
                Some("message_query_failed")
            } else {
                None
            },
        ),
        source_report(
            OwnerInboxSourceV1::ManagedAgentMessages,
            if managed_registry_failed {
                OwnerInboxSourceAvailabilityV1::Unavailable
            } else if message_query_failed && !managed_agent_pubkeys.is_empty() {
                OwnerInboxSourceAvailabilityV1::Degraded
            } else if agent_count == 0 {
                OwnerInboxSourceAvailabilityV1::Empty
            } else {
                OwnerInboxSourceAvailabilityV1::Ready
            },
            if managed_registry_failed {
                Some("managed_agent_registry_unavailable")
            } else if message_query_failed && !managed_agent_pubkeys.is_empty() {
                Some("message_query_failed")
            } else {
                None
            },
        ),
    ]);

    let feed: Vec<AuthorizedNativeInboxFeedItemV1> =
        admitted.iter().map(|(source, _)| source.clone()).collect();
    let presentation_items = admitted
        .into_iter()
        .map(|(_, presentation)| presentation)
        .collect();
    let projection = project_native_inbox(NativeInboxProjectionRequestV1 {
        scope: NativeInboxScopeV1 {
            owner_pubkey: owner_pubkey.clone(),
            viewer_pubkey: owner_pubkey,
            resident_pubkey: None,
        },
        category: InboxCategoryV1::All,
        generated_at,
        cursor: None,
        limit: feed.len().max(1).min(MAX_INBOX_ITEMS) as u16,
        feed,
    })
    .map_err(|error| error.to_string())?;

    Ok(OwnerNativeInboxResponseV1 {
        projection,
        presentation_items,
        sources,
    })
}

#[cfg(test)]
#[path = "luca_inbox_tests.rs"]
mod tests;

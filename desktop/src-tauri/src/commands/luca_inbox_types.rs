use super::*;

/// Native source families consulted for the owner Inbox projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OwnerInboxSourceV1 {
    ConversationMembership,
    DirectMessages,
    ManagedAgentMessages,
    ReadState,
}

/// Truthful availability of one source. `Empty` is a successful read with no
/// qualifying records; it is never used to hide a failed query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OwnerInboxSourceAvailabilityV1 {
    Ready,
    Empty,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OwnerInboxSourceReportV1 {
    pub source: OwnerInboxSourceV1,
    pub availability: OwnerInboxSourceAvailabilityV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
}

/// Presentation-only fields for one relay event already admitted by the
/// protocol projection. Arbitrary event tags are not exposed: only the exact
/// structural `h`, `e`, `p`, and `broadcast` tags needed for channel/thread
/// navigation survive this boundary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OwnerNativeInboxPresentationItemV1 {
    pub source_event_id: Hex64,
    pub kind: u32,
    pub author_pubkey: Hex64,
    pub content: String,
    pub created_at: u64,
    pub channel_id: OpaqueId,
    pub channel_name: String,
    pub channel_type: NativeInboxConversationKindV1,
    pub structural_tags: Vec<Vec<String>>,
    pub categories: Vec<InboxCategoryV1>,
}

impl std::fmt::Debug for OwnerNativeInboxPresentationItemV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerNativeInboxPresentationItemV1")
            .field("kind", &self.kind)
            .field("content", &"[REDACTED]")
            .field("created_at", &self.created_at)
            .field("channel_type", &self.channel_type)
            .field("structural_tag_count", &self.structural_tags.len())
            .field("categories", &self.categories)
            .finish()
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OwnerNativeInboxResponseV1 {
    pub projection: InboxProjectionV1,
    pub presentation_items: Vec<OwnerNativeInboxPresentationItemV1>,
    pub sources: Vec<OwnerInboxSourceReportV1>,
}

impl std::fmt::Debug for OwnerNativeInboxResponseV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OwnerNativeInboxResponseV1")
            .field("projection_item_count", &self.projection.items.len())
            .field("presentation_item_count", &self.presentation_items.len())
            .field("sources", &self.sources)
            .finish()
    }
}

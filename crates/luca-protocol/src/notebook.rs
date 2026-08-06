//! Strict V1.1 resident notebook and private cognition contracts.
//!
//! Memory notes and journal pages are deliberately different protocol types:
//! only active memory notes are eligible for ordinary recall. Journal bodies
//! can cross the private cognition boundary only after explicit owner selection.

use crate::{
    CanonicalTimestamp, ContinuityError, Hex64, LocalContinuityCognitionRequestV1,
    LocalContinuityCognitionResultV1, OpaqueId, SafeU53, Sha256Ref, CONTINUITY_PROTOCOL,
    MAX_CONTINUITY_PACKET_BYTES, MAX_JOURNAL_ANNOTATION_BYTES, MAX_JOURNAL_BODY_BYTES,
    MAX_JOURNAL_PROMPT_BYTES, MAX_JOURNAL_SOURCE_EVENTS, MAX_JOURNAL_TITLE_BYTES,
    MAX_MEMORY_NOTE_BYTES, MAX_MEMORY_NOTE_SOURCE_EVENTS, MAX_SELECTED_JOURNAL_PAGES,
};
use serde::{Deserialize, Deserializer, Serialize};

fn require_protocol(value: &str) -> Result<(), ContinuityError> {
    (value == CONTINUITY_PROTOCOL)
        .then_some(())
        .ok_or(ContinuityError::Protocol)
}

fn bounded_text(value: &str, maximum: usize) -> Result<(), ContinuityError> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() != value.len()
        || value.len() > maximum
        || value.chars().any(|character| {
            character == '\0' || (character.is_control() && character != '\n' && character != '\t')
        })
    {
        Err(ContinuityError::BodySafety)
    } else {
        Ok(())
    }
}

fn bounded_sorted<T: Ord>(values: &[T], maximum: usize) -> Result<(), ContinuityError> {
    if values.len() > maximum || values.windows(2).any(|pair| pair[0] >= pair[1]) {
        Err(ContinuityError::Sequence)
    } else {
        Ok(())
    }
}

macro_rules! validated_deserialize {
    ($name:ident, $raw:ident) => {
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let raw = $raw::deserialize(deserializer)?;
                let value = Self::from(raw);
                value.validate().map_err(serde::de::Error::custom)?;
                Ok(value)
            }
        }
    };
}

/// Lifecycle of one immutable notebook revision lineage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentNotebookStatusV1 {
    /// Effective and available to its explicitly permitted consumers.
    Active,
    /// Replaced by a later immutable revision.
    Superseded,
    /// Retained but excluded from recall and ordinary notebook lists.
    Archived,
    /// Content was purged; only minimum body-free lifecycle evidence remains.
    Forgotten,
}

/// Authorship authority for one notebook revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentNotebookAuthorshipV1 {
    /// Authored by the exact resident runtime/model binding.
    Resident,
    /// Owner correction to recall-affecting memory, visibly pinned.
    OwnerCorrection,
}

/// Bounded semantic category for an automatically recalled memory note.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentMemoryNoteCategoryV1 {
    Decision,
    DurableContext,
    Lesson,
    ExplicitPreference,
    Commitment,
    OpenQuestion,
}

/// One compact, source-backed resident memory note eligible for bounded recall.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentMemoryNoteV1 {
    pub protocol: String,
    pub note_id: OpaqueId,
    pub category: ResidentMemoryNoteCategoryV1,
    pub body: String,
    pub source_event_ids: Vec<Hex64>,
    pub created_at: CanonicalTimestamp,
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentMemoryNoteV1 {
    protocol: String,
    note_id: OpaqueId,
    category: ResidentMemoryNoteCategoryV1,
    body: String,
    source_event_ids: Vec<Hex64>,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
}

impl From<RawResidentMemoryNoteV1> for ResidentMemoryNoteV1 {
    fn from(raw: RawResidentMemoryNoteV1) -> Self {
        Self {
            protocol: raw.protocol,
            note_id: raw.note_id,
            category: raw.category,
            body: raw.body,
            source_event_ids: raw.source_event_ids,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
        }
    }
}

impl ResidentMemoryNoteV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.body, MAX_MEMORY_NOTE_BYTES)?;
        bounded_sorted(&self.source_event_ids, MAX_MEMORY_NOTE_SOURCE_EVENTS)?;
        if self.source_event_ids.is_empty() {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for ResidentMemoryNoteV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentMemoryNoteV1")
            .field("protocol", &self.protocol)
            .field("note_id", &self.note_id)
            .field("category", &self.category)
            .field("body", &"[REDACTED]")
            .field("source_event_ids", &self.source_event_ids)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

validated_deserialize!(ResidentMemoryNoteV1, RawResidentMemoryNoteV1);

/// One expressive resident-authored Markdown page. It is never ordinary recall.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentJournalPageV1 {
    pub protocol: String,
    pub page_id: OpaqueId,
    pub title: String,
    pub markdown_body: String,
    pub source_event_ids: Vec<Hex64>,
    pub source_page_ids: Vec<OpaqueId>,
    pub created_at: CanonicalTimestamp,
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentJournalPageV1 {
    protocol: String,
    page_id: OpaqueId,
    title: String,
    markdown_body: String,
    source_event_ids: Vec<Hex64>,
    source_page_ids: Vec<OpaqueId>,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
}

impl From<RawResidentJournalPageV1> for ResidentJournalPageV1 {
    fn from(raw: RawResidentJournalPageV1) -> Self {
        Self {
            protocol: raw.protocol,
            page_id: raw.page_id,
            title: raw.title,
            markdown_body: raw.markdown_body,
            source_event_ids: raw.source_event_ids,
            source_page_ids: raw.source_page_ids,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
        }
    }
}

impl ResidentJournalPageV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.title, MAX_JOURNAL_TITLE_BYTES)?;
        bounded_text(&self.markdown_body, MAX_JOURNAL_BODY_BYTES)?;
        bounded_sorted(&self.source_event_ids, MAX_JOURNAL_SOURCE_EVENTS)?;
        bounded_sorted(&self.source_page_ids, MAX_SELECTED_JOURNAL_PAGES)
    }
}

impl std::fmt::Debug for ResidentJournalPageV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentJournalPageV1")
            .field("protocol", &self.protocol)
            .field("page_id", &self.page_id)
            .field("title", &"[REDACTED]")
            .field("markdown_body", &"[REDACTED]")
            .field("source_event_ids", &self.source_event_ids)
            .field("source_page_ids", &self.source_page_ids)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

validated_deserialize!(ResidentJournalPageV1, RawResidentJournalPageV1);

/// Versioned notebook payload. The variant determines recall eligibility.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "item_type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResidentNotebookContentV1 {
    MemoryNote { note: ResidentMemoryNoteV1 },
    JournalPage { page: ResidentJournalPageV1 },
}

impl std::fmt::Debug for ResidentNotebookContentV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MemoryNote { note } => formatter.debug_tuple("MemoryNote").field(note).finish(),
            Self::JournalPage { page } => formatter.debug_tuple("JournalPage").field(page).finish(),
        }
    }
}

/// One immutable, owner/resident-bound notebook revision.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentNotebookItemV1 {
    pub protocol: String,
    pub item_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub status: ResidentNotebookStatusV1,
    pub authorship: ResidentNotebookAuthorshipV1,
    pub revision: SafeU53,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_item_id: Option<OpaqueId>,
    pub created_at: CanonicalTimestamp,
    pub updated_at: CanonicalTimestamp,
    pub content: ResidentNotebookContentV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentNotebookItemV1 {
    protocol: String,
    item_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    status: ResidentNotebookStatusV1,
    authorship: ResidentNotebookAuthorshipV1,
    revision: SafeU53,
    predecessor_item_id: Option<OpaqueId>,
    created_at: CanonicalTimestamp,
    updated_at: CanonicalTimestamp,
    content: ResidentNotebookContentV1,
}

impl From<RawResidentNotebookItemV1> for ResidentNotebookItemV1 {
    fn from(raw: RawResidentNotebookItemV1) -> Self {
        Self {
            protocol: raw.protocol,
            item_id: raw.item_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            status: raw.status,
            authorship: raw.authorship,
            revision: raw.revision,
            predecessor_item_id: raw.predecessor_item_id,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            content: raw.content,
        }
    }
}

impl ResidentNotebookItemV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.predecessor_item_id.as_ref() == Some(&self.item_id)
        {
            return Err(ContinuityError::Binding);
        }
        match &self.content {
            ResidentNotebookContentV1::MemoryNote { note } => {
                note.validate()?;
                if note.note_id != self.item_id {
                    return Err(ContinuityError::Binding);
                }
            }
            ResidentNotebookContentV1::JournalPage { page } => {
                page.validate()?;
                if page.page_id != self.item_id
                    || self.authorship != ResidentNotebookAuthorshipV1::Resident
                {
                    return Err(ContinuityError::Binding);
                }
            }
        }
        Ok(())
    }
}

impl std::fmt::Debug for ResidentNotebookItemV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentNotebookItemV1")
            .field("item_id", &self.item_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("status", &self.status)
            .field("authorship", &self.authorship)
            .field("revision", &self.revision)
            .field("content", &self.content)
            .finish_non_exhaustive()
    }
}

validated_deserialize!(ResidentNotebookItemV1, RawResidentNotebookItemV1);

/// Resident-authored automatic note change proposed after one finalized response.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mutation", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResidentMemoryNoteMutationV1 {
    Create {
        note: ResidentMemoryNoteV1,
    },
    Supersede {
        target_note_id: OpaqueId,
        note: ResidentMemoryNoteV1,
    },
}

impl ResidentMemoryNoteMutationV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        let (target, note) = match self {
            Self::Create { note } => (None, note),
            Self::Supersede {
                target_note_id,
                note,
            } => (Some(target_note_id), note),
        };
        note.validate()?;
        if target == Some(&note.note_id) {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for ResidentMemoryNoteMutationV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Create { note } => formatter.debug_tuple("Create").field(note).finish(),
            Self::Supersede {
                target_note_id,
                note,
            } => formatter
                .debug_struct("Supersede")
                .field("target_note_id", target_note_id)
                .field("note", note)
                .finish(),
        }
    }
}

/// Explicitly selected, same-resident prior page supplied to private cognition.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentJournalPageContextV1 {
    pub page_id: OpaqueId,
    pub revision: SafeU53,
    pub title: String,
    pub markdown_body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentJournalPageContextV1 {
    page_id: OpaqueId,
    revision: SafeU53,
    title: String,
    markdown_body: String,
}

impl From<RawResidentJournalPageContextV1> for ResidentJournalPageContextV1 {
    fn from(raw: RawResidentJournalPageContextV1) -> Self {
        Self {
            page_id: raw.page_id,
            revision: raw.revision,
            title: raw.title,
            markdown_body: raw.markdown_body,
        }
    }
}

impl ResidentJournalPageContextV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        bounded_text(&self.title, MAX_JOURNAL_TITLE_BYTES)?;
        bounded_text(&self.markdown_body, MAX_JOURNAL_BODY_BYTES)
    }
}

impl std::fmt::Debug for ResidentJournalPageContextV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentJournalPageContextV1")
            .field("page_id", &self.page_id)
            .field("revision", &self.revision)
            .field("title", &"[REDACTED]")
            .field("markdown_body", &"[REDACTED]")
            .finish()
    }
}

validated_deserialize!(
    ResidentJournalPageContextV1,
    RawResidentJournalPageContextV1
);

/// Owner-authorized request for one private resident-authored journal page.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct CreateResidentJournalPageRequestV1 {
    pub protocol: String,
    pub job_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub binding_ref: Sha256Ref,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<OpaqueId>,
    pub deadline_unix_ms: SafeU53,
    pub max_result_bytes: SafeU53,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_prompt: Option<String>,
    pub selected_event_ids: Vec<Hex64>,
    pub selected_pages: Vec<ResidentJournalPageContextV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCreateResidentJournalPageRequestV1 {
    protocol: String,
    job_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    conversation_id: Option<OpaqueId>,
    deadline_unix_ms: SafeU53,
    max_result_bytes: SafeU53,
    owner_prompt: Option<String>,
    selected_event_ids: Vec<Hex64>,
    selected_pages: Vec<ResidentJournalPageContextV1>,
}

impl From<RawCreateResidentJournalPageRequestV1> for CreateResidentJournalPageRequestV1 {
    fn from(raw: RawCreateResidentJournalPageRequestV1) -> Self {
        Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            binding_ref: raw.binding_ref,
            conversation_id: raw.conversation_id,
            deadline_unix_ms: raw.deadline_unix_ms,
            max_result_bytes: raw.max_result_bytes,
            owner_prompt: raw.owner_prompt,
            selected_event_ids: raw.selected_event_ids,
            selected_pages: raw.selected_pages,
        }
    }
}

impl CreateResidentJournalPageRequestV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.deadline_unix_ms.get() == 0
            || self.max_result_bytes.get() == 0
            || self.max_result_bytes.get() as usize > MAX_CONTINUITY_PACKET_BYTES
        {
            return Err(ContinuityError::Binding);
        }
        if let Some(prompt) = &self.owner_prompt {
            bounded_text(prompt, MAX_JOURNAL_PROMPT_BYTES)?;
        }
        if !self.selected_event_ids.is_empty() && self.conversation_id.is_none() {
            return Err(ContinuityError::Binding);
        }
        bounded_sorted(&self.selected_event_ids, MAX_JOURNAL_SOURCE_EVENTS)?;
        if self.selected_pages.len() > MAX_SELECTED_JOURNAL_PAGES
            || self
                .selected_pages
                .windows(2)
                .any(|pair| pair[0].page_id >= pair[1].page_id)
        {
            return Err(ContinuityError::Sequence);
        }
        self.selected_pages
            .iter()
            .try_for_each(|page| page.validate())
    }
}

impl std::fmt::Debug for CreateResidentJournalPageRequestV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CreateResidentJournalPageRequestV1")
            .field("job_id", &self.job_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("binding_ref", &self.binding_ref)
            .field("conversation_id", &self.conversation_id)
            .field(
                "owner_prompt",
                &self.owner_prompt.as_ref().map(|_| "[REDACTED]"),
            )
            .field("selected_event_ids", &self.selected_event_ids)
            .field("selected_page_count", &self.selected_pages.len())
            .finish_non_exhaustive()
    }
}

validated_deserialize!(
    CreateResidentJournalPageRequestV1,
    RawCreateResidentJournalPageRequestV1
);

/// Private journal cognition terminal outcome.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub enum CreateResidentJournalPageOutcomeV1 {
    NoChange,
    Page { page: ResidentJournalPageV1 },
}

/// Same-resident result for one manually initiated journal request.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct CreateResidentJournalPageResultV1 {
    pub protocol: String,
    pub job_id: OpaqueId,
    pub resident_pubkey: Hex64,
    pub result: CreateResidentJournalPageOutcomeV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCreateResidentJournalPageResultV1 {
    protocol: String,
    job_id: OpaqueId,
    resident_pubkey: Hex64,
    result: CreateResidentJournalPageOutcomeV1,
}

impl From<RawCreateResidentJournalPageResultV1> for CreateResidentJournalPageResultV1 {
    fn from(raw: RawCreateResidentJournalPageResultV1) -> Self {
        Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            resident_pubkey: raw.resident_pubkey,
            result: raw.result,
        }
    }
}

impl CreateResidentJournalPageResultV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if let CreateResidentJournalPageOutcomeV1::Page { page } = &self.result {
            page.validate()?;
        }
        Ok(())
    }

    pub fn validate_against(
        &self,
        request: &CreateResidentJournalPageRequestV1,
    ) -> Result<(), ContinuityError> {
        self.validate()?;
        request.validate()?;
        if self.job_id != request.job_id || self.resident_pubkey != request.resident_pubkey {
            return Err(ContinuityError::Binding);
        }
        if let CreateResidentJournalPageOutcomeV1::Page { page } = &self.result {
            if page
                .source_event_ids
                .iter()
                .any(|source| request.selected_event_ids.binary_search(source).is_err())
                || page.source_page_ids.iter().any(|source| {
                    request
                        .selected_pages
                        .binary_search_by(|candidate| candidate.page_id.cmp(source))
                        .is_err()
                })
            {
                return Err(ContinuityError::Binding);
            }
        }
        Ok(())
    }
}

impl std::fmt::Debug for CreateResidentJournalPageResultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CreateResidentJournalPageResultV1")
            .field("job_id", &self.job_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("result", &"[REDACTED]")
            .finish()
    }
}

validated_deserialize!(
    CreateResidentJournalPageResultV1,
    RawCreateResidentJournalPageResultV1
);

/// One request carried over the dedicated private resident cognition channel.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResidentPrivateCognitionRequestV1 {
    /// Automatic post-publication handoff and memory-note metabolism.
    Metabolism {
        request: LocalContinuityCognitionRequestV1,
    },
    /// Explicit owner-requested resident journal authorship.
    Journal {
        request: CreateResidentJournalPageRequestV1,
    },
}

impl ResidentPrivateCognitionRequestV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        match self {
            Self::Metabolism { request } => request.validate(),
            Self::Journal { request } => request.validate(),
        }
    }

    pub fn job_id(&self) -> &OpaqueId {
        match self {
            Self::Metabolism { request } => &request.job_id,
            Self::Journal { request } => &request.job_id,
        }
    }

    pub fn owner_pubkey(&self) -> &Hex64 {
        match self {
            Self::Metabolism { request } => &request.owner_pubkey,
            Self::Journal { request } => &request.owner_pubkey,
        }
    }

    pub fn resident_pubkey(&self) -> &Hex64 {
        match self {
            Self::Metabolism { request } => &request.resident_pubkey,
            Self::Journal { request } => &request.resident_pubkey,
        }
    }

    pub fn binding_ref(&self) -> &Sha256Ref {
        match self {
            Self::Metabolism { request } => &request.binding_ref,
            Self::Journal { request } => &request.binding_ref,
        }
    }

    pub fn deadline_unix_ms(&self) -> SafeU53 {
        match self {
            Self::Metabolism { request } => request.deadline_unix_ms,
            Self::Journal { request } => request.deadline_unix_ms,
        }
    }

    pub fn max_result_bytes(&self) -> SafeU53 {
        match self {
            Self::Metabolism { request } => request.max_result_bytes,
            Self::Journal { request } => request.max_result_bytes,
        }
    }
}

impl std::fmt::Debug for ResidentPrivateCognitionRequestV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentPrivateCognitionRequestV1")
            .field("job_id", self.job_id())
            .field("resident_pubkey", self.resident_pubkey())
            .field(
                "kind",
                &match self {
                    Self::Metabolism { .. } => "metabolism",
                    Self::Journal { .. } => "journal",
                },
            )
            .finish_non_exhaustive()
    }
}

/// One validated result returned over the private cognition channel.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ResidentPrivateCognitionResultV1 {
    Metabolism {
        result: LocalContinuityCognitionResultV1,
    },
    Journal {
        result: CreateResidentJournalPageResultV1,
    },
}

impl ResidentPrivateCognitionResultV1 {
    pub fn validate_against(
        &self,
        request: &ResidentPrivateCognitionRequestV1,
    ) -> Result<(), ContinuityError> {
        match (self, request) {
            (
                Self::Metabolism { result },
                ResidentPrivateCognitionRequestV1::Metabolism { request },
            ) => result.validate_against(request),
            (Self::Journal { result }, ResidentPrivateCognitionRequestV1::Journal { request }) => {
                result.validate_against(request)
            }
            _ => Err(ContinuityError::Binding),
        }
    }
}

impl std::fmt::Debug for ResidentPrivateCognitionResultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentPrivateCognitionResultV1")
            .field(
                "kind",
                &match self {
                    Self::Metabolism { .. } => "metabolism",
                    Self::Journal { .. } => "journal",
                },
            )
            .finish_non_exhaustive()
    }
}

/// Request for the resident to author a successor to an existing page.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResidentJournalPageRevisionRequestV1 {
    pub protocol: String,
    pub target_page_id: OpaqueId,
    pub request: CreateResidentJournalPageRequestV1,
}

impl ResidentJournalPageRevisionRequestV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        self.request.validate()?;
        if self
            .request
            .selected_pages
            .binary_search_by(|candidate| candidate.page_id.cmp(&self.target_page_id))
            .is_err()
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

/// Visibly owner-authored annotation stored separately from a journal body.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentJournalAnnotationV1 {
    pub protocol: String,
    pub annotation_id: OpaqueId,
    pub page_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub body: String,
    pub created_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentJournalAnnotationV1 {
    protocol: String,
    annotation_id: OpaqueId,
    page_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    body: String,
    created_at: CanonicalTimestamp,
}

impl From<RawResidentJournalAnnotationV1> for ResidentJournalAnnotationV1 {
    fn from(raw: RawResidentJournalAnnotationV1) -> Self {
        Self {
            protocol: raw.protocol,
            annotation_id: raw.annotation_id,
            page_id: raw.page_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            body: raw.body,
            created_at: raw.created_at,
        }
    }
}

impl ResidentJournalAnnotationV1 {
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_text(&self.body, MAX_JOURNAL_ANNOTATION_BYTES)?;
        if self.owner_pubkey == self.resident_pubkey {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for ResidentJournalAnnotationV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentJournalAnnotationV1")
            .field("annotation_id", &self.annotation_id)
            .field("page_id", &self.page_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("body", &"[REDACTED]")
            .field("created_at", &self.created_at)
            .finish()
    }
}

validated_deserialize!(ResidentJournalAnnotationV1, RawResidentJournalAnnotationV1);

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: char) -> Hex64 {
        Hex64::parse(value.to_string().repeat(64)).expect("fixture key")
    }

    fn timestamp() -> CanonicalTimestamp {
        CanonicalTimestamp::parse("2026-08-06T12:00:00Z").expect("fixture timestamp")
    }

    fn note(id: &str, source: Hex64) -> ResidentMemoryNoteV1 {
        ResidentMemoryNoteV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            note_id: OpaqueId::parse(id).expect("note id"),
            category: ResidentMemoryNoteCategoryV1::OpenQuestion,
            body: "Decide whether the notebook should open beside the room.".to_owned(),
            source_event_ids: vec![source],
            created_at: timestamp(),
            updated_at: timestamp(),
        }
    }

    #[test]
    fn memory_note_requires_exact_bounded_provenance() {
        let note = ResidentMemoryNoteV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            note_id: OpaqueId::parse("note-1").expect("note id"),
            category: ResidentMemoryNoteCategoryV1::OpenQuestion,
            body: "Decide whether the notebook should open beside the room.".to_owned(),
            source_event_ids: vec![hex('a')],
            created_at: timestamp(),
            updated_at: timestamp(),
        };
        assert!(note.validate().is_ok());
        let mut invalid = note;
        invalid.source_event_ids.clear();
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn journal_result_can_only_cite_explicit_selection() {
        let request = CreateResidentJournalPageRequestV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            job_id: OpaqueId::parse("journal-job").expect("job id"),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            binding_ref: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("binding"),
            conversation_id: Some(OpaqueId::parse("conversation-1").expect("conversation")),
            deadline_unix_ms: SafeU53::new(10).expect("deadline"),
            max_result_bytes: SafeU53::new(16_384).expect("maximum"),
            owner_prompt: Some("Write about the design decision.".to_owned()),
            selected_event_ids: vec![hex('d')],
            selected_pages: Vec::new(),
        };
        let result = CreateResidentJournalPageResultV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            job_id: request.job_id.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            result: CreateResidentJournalPageOutcomeV1::Page {
                page: ResidentJournalPageV1 {
                    protocol: CONTINUITY_PROTOCOL.to_owned(),
                    page_id: OpaqueId::parse("page-1").expect("page id"),
                    title: "A decision".to_owned(),
                    markdown_body: "I want the notebook to remain quiet.".to_owned(),
                    source_event_ids: vec![hex('e')],
                    source_page_ids: Vec::new(),
                    created_at: timestamp(),
                    updated_at: timestamp(),
                },
            },
        };
        assert!(result.validate_against(&request).is_err());
    }

    #[test]
    fn journal_item_rejects_owner_body_authorship() {
        let page_id = OpaqueId::parse("page-1").expect("page id");
        let item = ResidentNotebookItemV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            item_id: page_id.clone(),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            status: ResidentNotebookStatusV1::Active,
            authorship: ResidentNotebookAuthorshipV1::OwnerCorrection,
            revision: SafeU53::new(0).expect("revision"),
            predecessor_item_id: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            content: ResidentNotebookContentV1::JournalPage {
                page: ResidentJournalPageV1 {
                    protocol: CONTINUITY_PROTOCOL.to_owned(),
                    page_id,
                    title: "Private page".to_owned(),
                    markdown_body: "Resident words remain resident-authored.".to_owned(),
                    source_event_ids: Vec::new(),
                    source_page_ids: Vec::new(),
                    created_at: timestamp(),
                    updated_at: timestamp(),
                },
            },
        };
        assert!(item.validate().is_err());
    }

    #[test]
    fn notebook_bounds_versions_and_unknown_fields_fail_closed() {
        let mut oversized = note("note-large", hex('a'));
        oversized.body = "x".repeat(MAX_MEMORY_NOTE_BYTES + 1);
        assert!(oversized.validate().is_err());

        let mut wrong_version = note("note-version", hex('a'));
        wrong_version.protocol = "luca.continuity.v999".to_owned();
        assert!(wrong_version.validate().is_err());

        let encoded = serde_json::json!({
            "protocol": CONTINUITY_PROTOCOL,
            "note_id": "note-extra",
            "category": "decision",
            "body": "Keep the source-backed decision.",
            "source_event_ids": [hex('a')],
            "created_at": "2026-08-06T12:00:00Z",
            "updated_at": "2026-08-06T12:00:00Z",
            "unexpected": true,
        });
        assert!(serde_json::from_value::<ResidentMemoryNoteV1>(encoded).is_err());

        let page = ResidentJournalPageV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            page_id: OpaqueId::parse("page-large").expect("page id"),
            title: "x".repeat(MAX_JOURNAL_TITLE_BYTES + 1),
            markdown_body: "body".to_owned(),
            source_event_ids: Vec::new(),
            source_page_ids: Vec::new(),
            created_at: timestamp(),
            updated_at: timestamp(),
        };
        assert!(page.validate().is_err());
    }

    #[test]
    fn metabolism_rejects_excessive_mutations_and_wrong_resident() {
        let source = hex('d');
        let request = LocalContinuityCognitionRequestV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            job_id: OpaqueId::parse("metabolism-job").expect("job id"),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            conversation_id: OpaqueId::parse("conversation-1").expect("conversation"),
            source_event_id: source.clone(),
            binding_ref: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("binding"),
            deadline_unix_ms: SafeU53::new(10).expect("deadline"),
            max_result_bytes: SafeU53::new(16_384).expect("maximum"),
        };
        let mutations = (0..=crate::MAX_MEMORY_NOTE_MUTATIONS)
            .map(|index| ResidentMemoryNoteMutationV1::Create {
                note: note(&format!("note-{index}"), source.clone()),
            })
            .collect();
        let excessive = LocalContinuityCognitionResultV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            job_id: request.job_id.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            source_event_id: source.clone(),
            result: crate::LocalContinuityCognitionOutcomeV1::Changes {
                handoff: None,
                memory_note_mutations: mutations,
            },
        };
        assert!(excessive.validate_against(&request).is_err());

        let wrong_resident = LocalContinuityCognitionResultV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            job_id: request.job_id.clone(),
            resident_pubkey: hex('e'),
            source_event_id: source,
            result: crate::LocalContinuityCognitionOutcomeV1::NoChange,
        };
        assert!(wrong_resident.validate_against(&request).is_err());
    }

    #[test]
    fn notebook_revision_cannot_point_to_itself() {
        let item_id = OpaqueId::parse("note-self").expect("note id");
        let item = ResidentNotebookItemV1 {
            protocol: CONTINUITY_PROTOCOL.to_owned(),
            item_id: item_id.clone(),
            owner_pubkey: hex('a'),
            resident_pubkey: hex('b'),
            status: ResidentNotebookStatusV1::Active,
            authorship: ResidentNotebookAuthorshipV1::Resident,
            revision: SafeU53::new(1).expect("revision"),
            predecessor_item_id: Some(item_id.clone()),
            created_at: timestamp(),
            updated_at: timestamp(),
            content: ResidentNotebookContentV1::MemoryNote {
                note: ResidentMemoryNoteV1 {
                    note_id: item_id,
                    ..note("ignored", hex('a'))
                },
            },
        };
        assert!(item.validate().is_err());
    }
}

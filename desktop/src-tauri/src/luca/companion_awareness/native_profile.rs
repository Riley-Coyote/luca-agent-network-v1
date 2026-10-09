//! Explicit, default-off following of changed sessions in one selected native
//! transcript container. A profile grant is a new scope, never an exact-session
//! grant reused for another file. No discovery, indexing, watcher, native process,
//! profile write, or Brain permission is installed by this module.

use super::native_work::{NativeWorkActivityFactV1, NativeWorkStatusV1};
use super::selected_files::{
    encode_bounded, selected_snapshot, validate_locator, ChangedStateSamplerV1, SamplingOutcomeV1,
    REFERENCE_NOTICE,
};
use super::{
    AwarenessGrantKeyV1, AwarenessProfileChildV1, AwarenessStoreError, CompanionAwarenessRuntime, LiveAwarenessOwner,
};
use crate::{app_state::AppState, luca::connected_brain};
use luca_protocol::{CanonicalTimestamp, ConnectedBrainSourceKindV1, Hex64, OpaqueId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    fmt,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const MAX_TRACKED_CHILDREN: usize = 32;
const MAX_EXCLUDED_IDS: usize = 4096;
const MAX_METADATA_BYTES: usize = 256 * 1024;
const MAX_METADATA_LINES: usize = 64;
const MAX_TRANSCRIPT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXCERPT_BYTES: usize = 2048;
const MAX_FACT_AGE_SECONDS: i64 = 30;

/// The selected root is exactly Codex's `sessions` or Claude Code's `projects`
/// transcript container, not its credential/configuration home. The host obtains
/// and verifies that canonical root through explicit source selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeProfileKindV1 {
    CodexSessions,
    ClaudeProjects,
}
impl NativeProfileKindV1 {
    fn source_kind(self) -> ConnectedBrainSourceKindV1 {
        match self {
            Self::CodexSessions => ConnectedBrainSourceKindV1::CodexHistory,
            Self::ClaudeProjects => ConnectedBrainSourceKindV1::ClaudeHistory,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::CodexSessions => "codex_sessions",
            Self::ClaudeProjects => "claude_projects",
        }
    }
}

/// Metadata and visible excerpts require distinct explicit profile source
/// grants. This is deliberately separate from exact-session observation classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeProfileObservationClassV1 {
    Metadata,
    VisibleExcerpts,
}
impl NativeProfileObservationClassV1 {
    fn label(self) -> &'static str {
        match self {
            Self::Metadata => "metadata",
            Self::VisibleExcerpts => "visible_excerpts",
        }
    }
}

/// Host-only, process-local profile selection. Neither paths nor scope can be
/// deserialized from an observation, model decision, or renderer grant claim.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct NativeProfileSelectionV1 {
    key: AwarenessGrantKeyV1,
    canonical_transcript_root: PathBuf,
    kind: NativeProfileKindV1,
    class: NativeProfileObservationClassV1,
}
impl fmt::Debug for NativeProfileSelectionV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeProfileSelectionV1")
            .field("key", &self.key)
            .field("kind", &self.kind)
            .field("class", &self.class)
            .field("transcript_root", &"[REDACTED]")
            .finish()
    }
}
impl NativeProfileSelectionV1 {
    /// Pure identity derivation for the host's consent UI. This neither resolves
    /// a home/profile nor stats the supplied path. Canonicality is rechecked only
    /// inside the live granted-source-read fence, before any source read.
    pub(crate) fn source_id_for_selection(
        owner: &Hex64,
        resident: &Hex64,
        device: &OpaqueId,
        canonical_transcript_root: &Path,
        kind: NativeProfileKindV1,
        class: NativeProfileObservationClassV1,
    ) -> Result<OpaqueId, AwarenessStoreError> {
        validate_locator(canonical_transcript_root, "selection.jsonl")?;
        if owner == resident
            || canonical_transcript_root.to_str().is_none()
            || canonical_transcript_root.parent().is_none()
            || canonical_transcript_root
                .as_os_str()
                .as_encoded_bytes()
                .len()
                > 4096
            || canonical_transcript_root
                .to_string_lossy()
                .chars()
                .any(char::is_control)
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let mut hash = Sha256::new();
        for field in [
            b"polyphonic.awareness.native-profile-selection.v1".as_slice(),
            owner.as_str().as_bytes(),
            resident.as_str().as_bytes(),
            device.as_str().as_bytes(),
            canonical_transcript_root.as_os_str().as_encoded_bytes(),
            kind.label().as_bytes(),
            class.label().as_bytes(),
        ] {
            hash.update((field.len() as u64).to_be_bytes());
            hash.update(field);
        }
        OpaqueId::parse(format!("source-{}", hex::encode(hash.finalize())))
            .map_err(|_| AwarenessStoreError::Invalid)
    }

    /// Pure validation; the key must already identify this explicit profile
    /// class/principal/device selection. An exact-session grant cannot qualify.
    pub(crate) fn new(
        key: AwarenessGrantKeyV1,
        canonical_transcript_root: PathBuf,
        kind: NativeProfileKindV1,
        class: NativeProfileObservationClassV1,
    ) -> Result<Self, AwarenessStoreError> {
        let source = Self::source_id_for_selection(
            &key.source.owner_pubkey,
            &key.resident_pubkey,
            &key.source.device_id,
            &canonical_transcript_root,
            kind,
            class,
        )?;
        if source != key.source.source_id {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(Self {
            key,
            canonical_transcript_root,
            kind,
            class,
        })
    }

    /// Body-free exact scope for host registration and per-grant sequence use.
    pub(crate) fn grant_key(&self) -> &AwarenessGrantKeyV1 {
        &self.key
    }
    /// Sensitive host configuration only, never renderer/prompt metadata.
    pub(super) fn transcript_root(&self) -> &Path { &self.canonical_transcript_root }
    /// Immutable provider container kind from explicit selection.
    pub(crate) fn kind(&self) -> NativeProfileKindV1 { self.kind }
    /// Independently granted observation class, never inferred from connectivity.
    pub(crate) fn class(&self) -> NativeProfileObservationClassV1 { self.class }
    /// Opaque exclusion identity; no native UUID/path is persisted or logged.
    pub(crate) fn exclusion_token(&self, native_id: &str) -> Result<luca_protocol::Sha256Ref, AwarenessStoreError> {
        let parsed=uuid::Uuid::parse_str(native_id).map_err(|_|AwarenessStoreError::Invalid)?;
        if parsed.is_nil() || parsed.hyphenated().to_string()!=native_id {return Err(AwarenessStoreError::Invalid);}
        let mut digest=Sha256::new();
        for part in [b"polyphonic.awareness.profile-child.v1".as_slice(),self.key.source.owner_pubkey.as_str().as_bytes(),
            self.key.resident_pubkey.as_str().as_bytes(),self.key.source.device_id.as_str().as_bytes(),
            self.key.source.source_id.as_str().as_bytes(),native_id.as_bytes()] {
            digest.update((part.len() as u64).to_be_bytes());digest.update(part);
        }
        luca_protocol::Sha256Ref::parse(format!("sha256:{}",hex::encode(digest.finalize()))).map_err(|_|AwarenessStoreError::Invalid)
    }

    fn session_ref(&self, locator: &str) -> Result<OpaqueId, AwarenessStoreError> {
        connected_brain::native_session_opaque_id(&self.key.source.source_id, locator)
            .map_err(|_| AwarenessStoreError::Invalid)
    }

    /// Pure notification filtering; does not enumerate or open the child.
    pub(super) fn changed_child_ref(&self, locator: &str) -> Result<OpaqueId, AwarenessStoreError> {
        validate_child(self, locator)?;
        self.session_ref(locator)
    }

    fn read(
        &self,
        locator: &str,
        native_id: &str,
        session_ref: &OpaqueId,
        purpose: &NativeProfilePurposeFactsV1,
        now: &CanonicalTimestamp,
        activity: Option<&NativeWorkActivityFactV1>,
    ) -> Result<Vec<u8>, AwarenessStoreError> {
        let root = &self.canonical_transcript_root;
        purpose.recheck(self, now)?;
        let excluded = &purpose.excluded_provider_ids;
        let before = selected_snapshot(root, locator, MAX_TRANSCRIPT_BYTES)?;
        purpose.recheck(self, now)?;
        validate_native_header(&root.join(locator), self.kind, native_id)?;
        // These source-confined helpers do not enumerate the profile. Their
        // bounded private-purpose/visible-message checks remain authoritative.
        purpose.recheck(self, now)?;
        let metadata = connected_brain::native_session_reference(
            root,
            self.kind.source_kind(),
            &self.key.source.source_id,
            session_ref,
            locator,
            excluded,
        )
        .map_err(|_| AwarenessStoreError::Invalid)?;
        let excerpts = if self.class == NativeProfileObservationClassV1::VisibleExcerpts {
            purpose.recheck(self, now)?;
            connected_brain::visible_native_session_excerpts(
                root,
                self.kind.source_kind(),
                &self.key.source.source_id,
                session_ref,
                locator,
                excluded,
            )
            .map_err(|_| AwarenessStoreError::Unavailable)?
        } else {
            Vec::new()
        };
        let excerpt_truncated = excerpts.iter().any(|text| text.len() > MAX_EXCERPT_BYTES);
        let excerpts = excerpts
            .into_iter()
            .map(|text| bounded_excerpt(&text))
            .collect::<Vec<_>>();
        purpose.recheck(self, now)?;
        if before != selected_snapshot(root, locator, MAX_TRANSCRIPT_BYTES)? {
            return Err(AwarenessStoreError::Unavailable);
        }
        let work_status = activity
            .filter(|fact| &fact.session_ref == session_ref)
            .filter(|fact| fresh_fact(&fact.observed_at, now).is_ok())
            .map(|fact| fact.status)
            .unwrap_or(NativeWorkStatusV1::Unknown);
        encode_bounded(&ProfilePayload {
            protocol: "polyphonic.awareness.native-profile.v1",
            profile_ref: &self.key.source.source_id,
            provider: self.kind.label(),
            observation_class: self.class.label(),
            session_ref,
            availability: "changed_session_available",
            work_status,
            source_updated_at: metadata
                .get("source_updated_at")
                .and_then(serde_json::Value::as_str),
            reference_notice: REFERENCE_NOTICE,
            excerpts,
            excerpt_truncated,
        })
    }
}

/// A freshly established, complete private-purpose exclusion set for one exact
/// profile selection. The host obtains it through its bounded purpose ledger;
/// unavailable/incomplete ledgers must supply `None`, not an empty set. This
/// non-serde value is not proof merely because a caller constructs it.
pub(crate) struct NativeProfilePurposeFactsV1 {
    profile_ref: OpaqueId,
    checked_at: CanonicalTimestamp,
    excluded_provider_ids: HashSet<String>,
    checked_monotonic: Instant,
}
impl fmt::Debug for NativeProfilePurposeFactsV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeProfilePurposeFactsV1")
            .field("profile_ref", &self.profile_ref)
            .field("exclusion_count", &self.excluded_provider_ids.len())
            .finish_non_exhaustive()
    }
}
impl NativeProfilePurposeFactsV1 {
    /// Pure bounded construction from host-authoritative, complete exclusions.
    /// Empty means verified empty, never unknown or a content permission claim.
    pub(crate) fn new(
        selection: &NativeProfileSelectionV1,
        checked_at: CanonicalTimestamp,
        excluded_provider_ids: HashSet<String>,
    ) -> Result<Self, AwarenessStoreError> {
        if excluded_provider_ids.len() > MAX_EXCLUDED_IDS
            || excluded_provider_ids
                .iter()
                .any(|id| id.is_empty() || id.len() > 128 || id.chars().any(char::is_control))
        {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(Self {
            profile_ref: selection.key.source.source_id.clone(),
            checked_at,
            excluded_provider_ids,
            checked_monotonic: Instant::now(),
        })
    }

    fn recheck(
        &self,
        selection: &NativeProfileSelectionV1,
        now: &CanonicalTimestamp,
    ) -> Result<(), AwarenessStoreError> {
        if self.profile_ref != selection.key.source.source_id {
            return Err(AwarenessStoreError::Invalid);
        }
        if self.checked_monotonic.elapsed()>Duration::from_secs(1) {return Err(AwarenessStoreError::Unavailable);}
        let at = chrono::DateTime::parse_from_rfc3339(self.checked_at.as_str()).map_err(|_|AwarenessStoreError::Invalid)?;
        let now = chrono::DateTime::parse_from_rfc3339(now.as_str()).map_err(|_|AwarenessStoreError::Invalid)?;
        if !(0..=1).contains(&(now.timestamp()-at.timestamp())) {return Err(AwarenessStoreError::Unavailable);}
        Ok(())
    }
}

#[derive(Serialize)]
struct ProfilePayload<'a> {
    protocol: &'static str,
    profile_ref: &'a OpaqueId,
    provider: &'static str,
    observation_class: &'static str,
    session_ref: &'a OpaqueId,
    availability: &'static str,
    work_status: NativeWorkStatusV1,
    source_updated_at: Option<&'a str>,
    reference_notice: &'static str,
    excerpts: Vec<String>,
    excerpt_truncated: bool,
}

/// Body-free event result. The parent uses `session_ref` to keep per-observation
/// exclusion/availability facts exact at later context, dispatch, and promotion
/// checks; a profile-wide fresh flag must not stand in for each child's facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum NativeProfileSamplingOutcomeV1 {
    Disabled,
    Quiet,
    Excluded {
        session_ref: OpaqueId,
    },
    Sampled {
        session_ref: OpaqueId,
        outcome: SamplingOutcomeV1,
    },
}

struct ChangedChild {
    locator: String,
    sampling: ChangedStateSamplerV1,
}

/// Bounded LRU of host-notified children, not a catalogue or profile scanner.
/// Bursts for one child coalesce. A full pending queue returns Capacity so the
/// watcher can report/back off rather than silently enumerate or drop evidence.
pub(crate) struct NativeProfileAdapter {
    selection: NativeProfileSelectionV1,
    enabled: bool,
    children: VecDeque<ChangedChild>,
}
impl fmt::Debug for NativeProfileAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeProfileAdapter")
            .field("selection", &self.selection)
            .field("enabled", &self.enabled)
            .field("tracked_children", &self.children.len())
            .field("locators", &"[REDACTED]")
            .finish()
    }
}
impl NativeProfileAdapter {
    /// No reads, discovery, or watcher startup occurs at construction.
    pub(crate) fn new(selection: NativeProfileSelectionV1) -> Self {
        Self {
            selection,
            enabled: false,
            children: VecDeque::new(),
        }
    }

    pub(crate) fn selection(&self) -> &NativeProfileSelectionV1 {
        &self.selection
    }

    /// Enablement alone is not consent. Disabling forgets pending events and
    /// coalescing coordinates; it does not revoke retained canonical knowledge.
    pub(crate) fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.children.clear();
        }
    }

    /// Pure event marking for one host-known child beneath the exact selected
    /// transcript root. Arbitrary model/renderer paths are not watcher events.
    pub(crate) fn mark_changed(&mut self, locator: &str) -> Result<(), AwarenessStoreError> {
        validate_child(&self.selection, locator)?;
        if !self.enabled {
            return Ok(());
        }
        if let Some(index) = self
            .children
            .iter()
            .position(|child| child.locator == locator)
        {
            let mut child = self
                .children
                .remove(index)
                .ok_or(AwarenessStoreError::Invalid)?;
            child.sampling.mark_changed();
            self.children.push_back(child);
            return Ok(());
        }
        if self.children.len() == MAX_TRACKED_CHILDREN {
            let clean = self
                .children
                .iter()
                .position(|child| child.sampling.skip() == Some(SamplingOutcomeV1::Quiet))
                .ok_or(AwarenessStoreError::Capacity)?;
            self.children.remove(clean);
        }
        let mut sampling = ChangedStateSamplerV1::default();
        sampling.set_enabled(true);
        self.children.push_back(ChangedChild {
            locator: locator.to_owned(),
            sampling,
        });
        Ok(())
    }

    /// Read at most one notified child, only under current live owner/observe
    /// authority and fresh complete purpose facts. The parent serializes this
    /// source driver; durable sequence is per grant, never reset per child.
    /// Final admission rejects an intervening withdrawal. No async/model work
    /// runs inside the source-read fence. A child error does not withdraw the
    /// entire profile; the host updates that child's material facts separately.
    pub(crate) fn sample_one(
        &mut self,
        state: &AppState,
        runtime: &CompanionAwarenessRuntime,
        now: &CanonicalTimestamp,
        purpose: Option<&NativeProfilePurposeFactsV1>,
        activity: Option<&NativeWorkActivityFactV1>,
    ) -> Result<NativeProfileSamplingOutcomeV1, AwarenessStoreError> {
        if !self.enabled {
            return Ok(NativeProfileSamplingOutcomeV1::Disabled);
        }
        let Some(index) = self
            .children
            .iter()
            .position(|child| child.sampling.skip().is_none())
        else {
            return Ok(NativeProfileSamplingOutcomeV1::Quiet);
        };
        let locator = self.children[index].locator.clone();
        let native_id = validate_child(&self.selection, &locator)?;
        let session_ref = self.selection.session_ref(&locator)?;
        self.children[index].sampling.consume_event();
        let live = LiveAwarenessOwner::authenticate(state)?;
        let key = &self.selection.key;
        let (authority, payload) = runtime.with_granted_source_read(&live, key, |authority| {
            let purpose = purpose.ok_or(AwarenessStoreError::Unavailable)?;
            purpose.recheck(&self.selection, now)?;
            if purpose.excluded_provider_ids.contains(&native_id) {
                return Ok((authority.clone(), None));
            }
            self.selection
                .read(
                    &locator,
                    &native_id,
                    &session_ref,
                    purpose,
                    now,
                    activity,
                )
                .map(|payload| (authority.clone(), Some(payload)))
        })?;
        let Some(payload) = payload else {
            return Ok(NativeProfileSamplingOutcomeV1::Excluded { session_ref });
        };
        let sequence = runtime.next_sequence(&live, key)?;
        let child = AwarenessProfileChildV1 { child_ref: session_ref.clone(), exclusion_token: self.selection.exclusion_token(&native_id)? };
        let outcome = self.children[index].sampling.finish_with_admission(
            runtime,
            &live,
            key,
            (authority, payload),
            now,
            sequence,
            |facts, reference, payload| runtime.admit_profile(&live, facts, reference, payload, &child),
        )?;
        Ok(NativeProfileSamplingOutcomeV1::Sampled {
            session_ref,
            outcome,
        })
    }
}

fn validate_child(
    selection: &NativeProfileSelectionV1,
    locator: &str,
) -> Result<String, AwarenessStoreError> {
    validate_locator(&selection.canonical_transcript_root, locator)?;
    if locator.chars().any(char::is_control) {
        return Err(AwarenessStoreError::Invalid);
    }
    let parts = locator.split('/').collect::<Vec<_>>();
    let filename = parts.last().copied().ok_or(AwarenessStoreError::Invalid)?;
    let stem = filename
        .strip_suffix(".jsonl")
        .ok_or(AwarenessStoreError::Invalid)?;
    let native_id = stem
        .get(stem.len().saturating_sub(36)..)
        .ok_or(AwarenessStoreError::Invalid)?;
    let id = uuid::Uuid::parse_str(native_id).map_err(|_| AwarenessStoreError::Invalid)?;
    if id.is_nil() || id.hyphenated().to_string() != native_id {
        return Err(AwarenessStoreError::Invalid);
    }
    match selection.kind {
        NativeProfileKindV1::CodexSessions => {
            if parts.len() != 4 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2
            {
                return Err(AwarenessStoreError::Invalid);
            }
            let prefix = stem
                .strip_suffix(native_id)
                .and_then(|prefix| prefix.strip_suffix('-'))
                .and_then(|prefix| prefix.strip_prefix("rollout-"))
                .ok_or(AwarenessStoreError::Invalid)?;
            let timestamp = chrono::NaiveDateTime::parse_from_str(prefix, "%Y-%m-%dT%H-%M-%S")
                .map_err(|_| AwarenessStoreError::Invalid)?;
            let date = format!("{}-{}-{}", parts[0], parts[1], parts[2]);
            if timestamp.date().to_string() != date {
                return Err(AwarenessStoreError::Invalid);
            }
        }
        NativeProfileKindV1::ClaudeProjects => {
            if parts.len() != 2
                || !parts[0].starts_with('-')
                || parts[0].len() > 1024
                || stem != native_id
            {
                return Err(AwarenessStoreError::Invalid);
            }
        }
    }
    Ok(native_id.to_owned())
}

#[derive(Deserialize)]
struct CodexHeader {
    #[serde(rename = "type")]
    kind: String,
    payload: CodexHeaderPayload,
}
#[derive(Deserialize)]
struct CodexHeaderPayload {
    id: String,
    source: String,
    originator: String,
}
#[derive(Default, Deserialize)]
struct HiddenNativeFlags {
    #[serde(rename = "isSidechain")]
    sidechain: Option<bool>,
    #[serde(rename = "isMeta")]
    meta: Option<bool>,
    #[serde(rename = "isCompactSummary")]
    compact_summary: Option<bool>,
    #[serde(rename = "isSummary")]
    summary: Option<bool>,
    #[serde(rename = "promptSource", alias = "prompt_source")]
    prompt_source: Option<String>,
    entrypoint: Option<String>,
}
impl HiddenNativeFlags {
    fn private(&self) -> bool {
        [
            self.sidechain,
            self.meta,
            self.compact_summary,
            self.summary,
        ]
        .contains(&Some(true))
            || self
                .prompt_source
                .iter()
                .chain(self.entrypoint.iter())
                .any(|label| {
                    let label = label.trim().to_ascii_lowercase();
                    label == "sdk" || label.starts_with("sdk-") || label.starts_with("sdk_")
                })
    }
}
#[derive(Deserialize)]
struct ClaudeHeader {
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    cwd: Option<String>,
    #[serde(flatten)]
    flags: HiddenNativeFlags,
    message: Option<HiddenNativeFlags>,
}

/// This small eligibility projection reads only a bounded native metadata
/// prefix, not a second transcript parser. Message content is ignored; the
/// existing recent-tail helper owns visible-text extraction and redaction.
fn validate_native_header(
    path: &Path,
    kind: NativeProfileKindV1,
    native_id: &str,
) -> Result<(), AwarenessStoreError> {
    let file = File::open(path).map_err(|_| AwarenessStoreError::Unavailable)?;
    let mut reader = BufReader::with_capacity(8 * 1024, file);
    let mut remaining = MAX_METADATA_BYTES;
    for _ in 0..MAX_METADATA_LINES {
        let mut line = Zeroizing::new(Vec::new());
        let read = reader
            .by_ref()
            .take(remaining as u64 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| AwarenessStoreError::Unavailable)?;
        if read == 0 || read > remaining {
            return Err(AwarenessStoreError::Invalid);
        }
        remaining -= read;
        match kind {
            NativeProfileKindV1::CodexSessions => {
                let row: CodexHeader =
                    serde_json::from_slice(&line).map_err(|_| AwarenessStoreError::Invalid)?;
                let known_origin = matches!(
                    (row.payload.source.as_str(), row.payload.originator.as_str()),
                    ("cli", "codex_cli_rs")
                        | ("exec", "codex_exec")
                        | ("vscode", "Codex Desktop")
                        | ("vscode", "codex_vscode")
                );
                return if row.kind == "session_meta" && row.payload.id == native_id && known_origin
                {
                    Ok(())
                } else {
                    Err(AwarenessStoreError::Invalid)
                };
            }
            NativeProfileKindV1::ClaudeProjects => {
                let row: ClaudeHeader =
                    serde_json::from_slice(&line).map_err(|_| AwarenessStoreError::Invalid)?;
                if row.flags.private()
                    || row.message.as_ref().is_some_and(HiddenNativeFlags::private)
                    || row.kind.is_empty()
                    || row.kind == "session_meta"
                    || row.session_id.as_deref().is_some_and(|id| id != native_id)
                {
                    return Err(AwarenessStoreError::Invalid);
                }
                if matches!(row.kind.as_str(), "user" | "assistant") {
                    let cwd = row.cwd.as_deref().ok_or(AwarenessStoreError::Invalid)?;
                    if row.session_id.as_deref() != Some(native_id)
                        || cwd.len() > 4096
                        || cwd.chars().any(char::is_control)
                        || !Path::new(cwd).is_absolute()
                    {
                        return Err(AwarenessStoreError::Invalid);
                    }
                    return Ok(());
                }
            }
        }
    }
    Err(AwarenessStoreError::Invalid)
}

fn fresh_fact(
    at: &CanonicalTimestamp,
    now: &CanonicalTimestamp,
) -> Result<(), AwarenessStoreError> {
    let at = chrono::DateTime::parse_from_rfc3339(at.as_str())
        .map_err(|_| AwarenessStoreError::Invalid)?;
    let now = chrono::DateTime::parse_from_rfc3339(now.as_str())
        .map_err(|_| AwarenessStoreError::Invalid)?;
    if !(0..=MAX_FACT_AGE_SECONDS).contains(&(now.timestamp() - at.timestamp())) {
        return Err(AwarenessStoreError::Unavailable);
    }
    Ok(())
}
fn bounded_excerpt(text: &str) -> String {
    let mut end = text.len().min(MAX_EXCERPT_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
#[path = "native_profile_tests.rs"]
mod tests;

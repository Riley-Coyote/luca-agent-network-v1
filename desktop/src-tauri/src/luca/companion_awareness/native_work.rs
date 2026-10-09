//! Default-off, exact selected Codex/Claude work awareness. No profile discovery
//! or transcript catalog scan occurs. Metadata is not evidence of live activity.

use super::selected_files::{
    encode_bounded, finish_probe, selected_snapshot, selection_source_id, validate_locator,
    ChangedStateSamplerV1, SamplingOutcomeV1, REFERENCE_NOTICE,
};
use super::{
    AwarenessGrantKeyV1, AwarenessStoreError, CompanionAwarenessRuntime, LiveAwarenessOwner,
};
use crate::{app_state::AppState, luca::connected_brain};
use luca_protocol::{CanonicalTimestamp, ConnectedBrainSourceKindV1, OpaqueId, SafeU53};
use serde::Serialize;
use std::{collections::HashSet, fmt, path::PathBuf};

const MAX_NATIVE_TRANSCRIPT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXCERPT_BYTES: usize = 2048;
const MAX_ACTIVITY_FACT_AGE_SECONDS: i64 = 30;

/// Metadata and visible-excerpt selection must have distinct host source scopes;
/// changing class is a new explicit selection, not a runtime widening toggle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeObservationClassV1 {
    Metadata,
    VisibleExcerpts,
}
/// Truthful host state: a file/mtime never establishes Open, Active, or Idle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NativeWorkStatusV1 {
    Open,
    Active,
    Idle,
    Unknown,
}
/// Non-deserializable exact-session fact from a verified host/native controller.
/// Construction by host code is not proof by itself; content cannot supply it.
pub(crate) struct NativeWorkActivityFactV1 {
    pub(crate) session_ref: OpaqueId,
    pub(crate) status: NativeWorkStatusV1,
    pub(crate) observed_at: CanonicalTimestamp,
}
/// Process-only sensitive locator, bound by host selection to one exact profile
/// root + relative session path and independent awareness source/device grant.
pub(crate) struct NativeWorkHandleV1 {
    key: AwarenessGrantKeyV1,
    root: PathBuf,
    relative_locator: String,
    session_ref: OpaqueId,
    kind: ConnectedBrainSourceKindV1,
    class: NativeObservationClassV1,
    excluded: HashSet<String>,
}
impl fmt::Debug for NativeWorkHandleV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeWorkHandleV1")
            .field("key", &self.key)
            .field("class", &self.class)
            .field("locator", &"[REDACTED]")
            .finish()
    }
}
impl NativeWorkHandleV1 {
    /// Different native provider/content classes have different exact grants.
    pub(crate) fn source_id_for_selection(
        root: &std::path::Path,
        relative_locator: &str,
        kind: ConnectedBrainSourceKindV1,
        class: NativeObservationClassV1,
    ) -> Result<OpaqueId, AwarenessStoreError> {
        validate_locator(root, relative_locator)?;
        let domain = match (kind, class) {
            (ConnectedBrainSourceKindV1::CodexHistory, NativeObservationClassV1::Metadata) => {
                "codex-metadata"
            }
            (
                ConnectedBrainSourceKindV1::CodexHistory,
                NativeObservationClassV1::VisibleExcerpts,
            ) => "codex-visible-excerpts",
            (ConnectedBrainSourceKindV1::ClaudeHistory, NativeObservationClassV1::Metadata) => {
                "claude-metadata"
            }
            (
                ConnectedBrainSourceKindV1::ClaudeHistory,
                NativeObservationClassV1::VisibleExcerpts,
            ) => "claude-visible-excerpts",
            _ => return Err(AwarenessStoreError::Invalid),
        };
        if !relative_locator.ends_with(".jsonl") {
            return Err(AwarenessStoreError::Invalid);
        }
        selection_source_id(domain, root, relative_locator)
    }
    /// Pure validation; no current-home lookup, native config read, or fs access.
    pub(crate) fn new(
        key: AwarenessGrantKeyV1,
        root: PathBuf,
        relative_locator: String,
        kind: ConnectedBrainSourceKindV1,
        class: NativeObservationClassV1,
        excluded: HashSet<String>,
    ) -> Result<Self, AwarenessStoreError> {
        validate_locator(&root, &relative_locator)?;
        if kind == ConnectedBrainSourceKindV1::Repository
            || !relative_locator.ends_with(".jsonl")
            || excluded.len() > 256
        {
            return Err(AwarenessStoreError::Invalid);
        }
        if key.source.source_id
            != Self::source_id_for_selection(&root, &relative_locator, kind, class)?
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let session_ref =
            connected_brain::native_session_opaque_id(&key.source.source_id, &relative_locator)
                .map_err(|_| AwarenessStoreError::Invalid)?;
        Ok(Self {
            key,
            root,
            relative_locator,
            session_ref,
            kind,
            class,
            excluded,
        })
    }
    pub(crate) fn session_ref(&self) -> &OpaqueId {
        &self.session_ref
    }
    fn read(
        &self,
        now: &CanonicalTimestamp,
        activity: Option<&NativeWorkActivityFactV1>,
    ) -> Result<Vec<u8>, AwarenessStoreError> {
        let before = selected_snapshot(
            &self.root,
            &self.relative_locator,
            MAX_NATIVE_TRANSCRIPT_BYTES,
        )?;
        // The resolver verifies this exact locator and internal-session exclusion;
        // its sensitive native UUID/path are deliberately not emitted below.
        let metadata = connected_brain::native_session_reference(
            &self.root,
            self.kind,
            &self.key.source.source_id,
            &self.session_ref,
            &self.relative_locator,
            &self.excluded,
        )
        .map_err(|_| AwarenessStoreError::Unavailable)?;
        let excerpts = if self.class == NativeObservationClassV1::VisibleExcerpts {
            connected_brain::visible_native_session_excerpts(
                &self.root,
                self.kind,
                &self.key.source.source_id,
                &self.session_ref,
                &self.relative_locator,
                &self.excluded,
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
        let after = selected_snapshot(
            &self.root,
            &self.relative_locator,
            MAX_NATIVE_TRANSCRIPT_BYTES,
        )?;
        if before != after {
            return Err(AwarenessStoreError::Unavailable);
        }
        let status = activity
            .filter(|fact| fact.session_ref == self.session_ref)
            .filter(|fact| {
                let elapsed = chrono::DateTime::parse_from_rfc3339(now.as_str()).and_then(|now| {
                    chrono::DateTime::parse_from_rfc3339(fact.observed_at.as_str())
                        .map(|at| now.timestamp() - at.timestamp())
                });
                elapsed.is_ok_and(|seconds| (0..=MAX_ACTIVITY_FACT_AGE_SECONDS).contains(&seconds))
            })
            .map(|fact| fact.status)
            .unwrap_or(NativeWorkStatusV1::Unknown);
        encode_bounded(&NativePayload {
            protocol: "polyphonic.awareness.native-work.v1",
            provider: match self.kind {
                ConnectedBrainSourceKindV1::CodexHistory => "codex",
                ConnectedBrainSourceKindV1::ClaudeHistory => "claude_code",
                _ => return Err(AwarenessStoreError::Invalid),
            },
            session_ref: &self.session_ref,
            availability: "selected_file_available",
            work_status: status,
            source_updated_at: metadata
                .get("source_updated_at")
                .and_then(serde_json::Value::as_str),
            reference_notice: REFERENCE_NOTICE,
            excerpts,
            excerpt_truncated,
        })
    }
}
#[derive(Serialize)]
struct NativePayload<'a> {
    protocol: &'static str,
    provider: &'static str,
    session_ref: &'a OpaqueId,
    availability: &'static str,
    work_status: NativeWorkStatusV1,
    source_updated_at: Option<&'a str>,
    reference_notice: &'static str,
    excerpts: Vec<String>,
    excerpt_truncated: bool,
}

/// One exact handle + coalesced dirty flag; no automatic collector is installed.
pub(crate) struct NativeWorkAdapter {
    handle: NativeWorkHandleV1,
    sampling: ChangedStateSamplerV1,
}
impl fmt::Debug for NativeWorkAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeWorkAdapter")
            .field("handle", &self.handle)
            .field("sampling", &self.sampling)
            .finish()
    }
}
impl NativeWorkAdapter {
    pub(crate) fn new(handle: NativeWorkHandleV1) -> Self {
        Self {
            handle,
            sampling: ChangedStateSamplerV1::default(),
        }
    }
    /// Enabling is not a grant; current live ownership/observe consent still gate
    /// the exact selected read and final admission at every changed-state event.
    pub(crate) fn set_enabled(&mut self, enabled: bool) {
        self.sampling.set_enabled(enabled);
    }
    pub(crate) fn mark_changed(&mut self) {
        self.sampling.mark_changed();
    }
    /// Fresh complete host purpose exclusions; never changes the selected
    /// identity/class/path, coalescing sampler or durable grant sequence.
    pub(crate) fn set_exclusions(
        &mut self,
        excluded: HashSet<String>,
    ) -> Result<(), AwarenessStoreError> {
        if excluded.len() > 256
            || excluded
                .iter()
                .any(|id| id.is_empty() || id.len() > 512 || id.chars().any(char::is_control))
        {
            return Err(AwarenessStoreError::Invalid);
        }
        self.handle.excluded = excluded;
        Ok(())
    }
    pub(crate) fn sample(
        &mut self,
        state: &AppState,
        runtime: &CompanionAwarenessRuntime,
        now: &CanonicalTimestamp,
        sequence: SafeU53,
        activity: Option<&NativeWorkActivityFactV1>,
    ) -> Result<SamplingOutcomeV1, AwarenessStoreError> {
        if let Some(outcome) = self.sampling.skip() {
            return Ok(outcome);
        }
        self.sampling.consume_event();
        let live = LiveAwarenessOwner::authenticate(state)?;
        let (authority, payload) =
            runtime.with_granted_source_read(&live, &self.handle.key, |authority| {
                Ok((authority.clone(), self.handle.read(now, activity)))
            })?;
        let payload = finish_probe(runtime, &live, &self.handle.key, &authority, payload)?;
        self.sampling.finish(
            runtime,
            &live,
            &self.handle.key,
            (authority, payload),
            now,
            sequence,
        )
    }
}
fn bounded_excerpt(text: &str) -> String {
    if text.len() <= MAX_EXCERPT_BYTES {
        return text.to_owned();
    }
    let mut end = MAX_EXCERPT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
#[path = "native_work_tests.rs"]
mod tests;

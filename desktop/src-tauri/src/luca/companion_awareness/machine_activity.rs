//! Default-off machine sampling via one exact embedded bounded helper run.
//! Parent owns explicit OS permission UI, source scheduling and activation.
//! Collection must never ask for permissions or equate perception with attention.

use super::selected_files::{new_id, ChangedStateSamplerV1, SamplingOutcomeV1};
use super::{
    AwarenessGrantKeyV1, AwarenessStoreError, CompanionAwarenessRuntime, LiveAwarenessOwner,
};
use crate::app_state::AppState;
use luca_protocol::{
    canonical_sha256, AwarenessSourceStateV1, CanonicalTimestamp, OpaqueId, SafeU53, Sha256Ref,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::{path::Path,time::{Duration,Instant}};
use super::machine_runner::{MachineHelperRunnerV1,MachineActivationWatcherV1};

pub(crate) const MACHINE_REQUEST_PROTOCOL: &str = "polyphonic.awareness.machine-request.v1";
const MACHINE_REPLY_PROTOCOL: &str = "polyphonic.awareness.machine-reply.v1";
pub(crate) const MAX_MACHINE_REQUEST_BYTES: usize = 8 * 1024;
pub(crate) const MAX_MACHINE_REPLY_BYTES: usize = 32 * 1024;
const MAX_MACHINE_TEXT_BYTES: usize = 16 * 1024;
const SUPPORTED_TEXT_APPS: &[&str] = &["com.apple.TextEdit", "com.apple.Preview"];
const BROWSER_TERMS: &[&str] = &[
    "safari",
    "chrome",
    "chromium",
    "firefox",
    "brave",
    "vivaldi",
    "opera",
    "microsoft.edgemac",
    "comet",
    "atlas",
    "arc",
    "orion",
    "duckduckgo",
    "browser",
];
const SENSITIVE_TERMS: &[&str] = &[
    "password",
    "passphrase",
    "credential",
    "private browsing",
    "incognito",
    "sign in",
    "signin",
    "authentication",
    "oauth",
    "seed phrase",
    "recovery phrase",
    "secret",
    "keychain",
    "authenticator",
    "wallet",
];

/// Metadata, AX visible text and single-window OCR require distinct source IDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MachineObservationClassV1 {
    AppMetadata,
    AccessibilityText,
    ScreenText,
}
/// Immutable host-issued selection policy, never another broad all-app grant.
#[derive(Clone, Serialize)]
pub(crate) struct MachineCaptureRequestV1 {
    protocol: &'static str,
    observation_class: MachineObservationClassV1,
    allowed_bundle_ids: Vec<String>,
    excluded_bundle_ids: Vec<String>,
    excluded_title_terms: Vec<String>,
    max_text_bytes: usize,
}
impl fmt::Debug for MachineCaptureRequestV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MachineCaptureRequestV1")
            .field("class", &self.observation_class)
            .field("policy", &"[REDACTED]")
            .finish()
    }
}
impl MachineCaptureRequestV1 {
    /// Pure policy validation; no permission, process, app or screen is observed.
    pub(crate) fn new(
        class: MachineObservationClassV1,
        mut allowed: Vec<String>,
        mut excluded: Vec<String>,
        mut title_terms: Vec<String>,
        max_text_bytes: usize,
    ) -> Result<Self, AwarenessStoreError> {
        allowed.sort();
        allowed.dedup();
        excluded.sort();
        excluded.dedup();
        title_terms.sort();
        title_terms.dedup();
        if allowed.is_empty()
            || allowed.len() > 16
            || excluded.len() > 32
            || title_terms.len() > 32
            || !(1..=MAX_MACHINE_TEXT_BYTES).contains(&max_text_bytes)
            || !allowed
                .iter()
                .chain(&excluded)
                .all(|value| valid_bundle(value))
            || title_terms.iter().any(|value| {
                value.is_empty() || value.len() > 128 || value.chars().any(char::is_control)
            })
        {
            return Err(AwarenessStoreError::Invalid);
        }
        if class != MachineObservationClassV1::AppMetadata
            && allowed
                .iter()
                .any(|bundle| browser(bundle) || !SUPPORTED_TEXT_APPS.contains(&bundle.as_str()))
        {
            return Err(AwarenessStoreError::Invalid);
        }
        let request = Self {
            protocol: MACHINE_REQUEST_PROTOCOL,
            observation_class: class,
            allowed_bundle_ids: allowed,
            excluded_bundle_ids: excluded,
            excluded_title_terms: title_terms,
            max_text_bytes,
        };
        request.encode()?;
        Ok(request)
    }
    /// Parent writes these bounded non-secret policy bytes to the helper's stdin.
    pub(crate) fn encode(&self) -> Result<Vec<u8>, AwarenessStoreError> {
        let bytes = serde_json::to_vec(self).map_err(|_| AwarenessStoreError::Invalid)?;
        if bytes.len() > MAX_MACHINE_REQUEST_BYTES {
            return Err(AwarenessStoreError::Capacity);
        }
        Ok(bytes)
    }
    /// Immutable source class, never a permission or text-capture upgrade.
    pub(crate) fn class(&self)->MachineObservationClassV1 {self.observation_class}
    /// Exact class/allowlist/exclusions are bound into the opaque source scope.
    pub(crate) fn source_id(&self) -> Result<OpaqueId, AwarenessStoreError> {
        let digest = canonical_sha256(&serde_json::json!([
            "polyphonic.awareness.machine-selection.v1",
            self
        ]))
        .map_err(|_| AwarenessStoreError::Invalid)?;
        OpaqueId::parse(format!("source-{digest}")).map_err(|_| AwarenessStoreError::Invalid)
    }
}

/// Process-memory policy only. Constructor cannot pair existing metadata consent
/// with a different allowlist, exclusion set, or text-capture class.
pub(crate) struct MachineActivityHandleV1 {
    key: AwarenessGrantKeyV1,
    request: MachineCaptureRequestV1,
}
impl fmt::Debug for MachineActivityHandleV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MachineActivityHandleV1")
            .field("key", &self.key)
            .field("request", &self.request)
            .finish()
    }
}
impl MachineActivityHandleV1 {
    /// Exact immutable machine-source scope; body policy grants nothing itself.
    pub(crate) fn new(
        key: AwarenessGrantKeyV1,
        request: MachineCaptureRequestV1,
    ) -> Result<Self, AwarenessStoreError> {
        if key.source.source_id != request.source_id()? {
            return Err(AwarenessStoreError::Invalid);
        }
        Ok(Self { key, request })
    }
}

/// Sealed borrowed permit created only INSIDE the current exact-grant read
/// callback below. Neither IPC/content nor a public-key argument can mint it.
pub(super) struct MachineHelperReadPermitV1<'a> {
    key:&'a AwarenessGrantKeyV1,request:&'a MachineCaptureRequestV1,directory:&'a Path,
}
impl MachineHelperReadPermitV1<'_> {
    /// Exact host source scope already fenced by current observation consent.
    pub(super) fn key(&self)->&AwarenessGrantKeyV1 {self.key}
    /// Closed host-issued class/allowlist policy; not model or page instructions.
    pub(super) fn request(&self)->&MachineCaptureRequestV1 {self.request}
    /// Existing private internal cache parent, preloaded before the source lock.
    pub(super) fn directory(&self)->&Path {self.directory}
}

/// Strict helper response. It is not a grant or a general local IPC capability.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct MachineReplyV1 {
    protocol: String,
    observation_class: MachineObservationClassV1,
    status: MachineReplyStatusV1,
    reason: Option<String>,
    bundle_id: Option<String>,
    display_name: Option<String>,
    window_ref: Option<Sha256Ref>,
    window_scope: MachineWindowScopeV1,
    text: Option<String>,
    truncated: bool,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MachineReplyStatusV1 {
    Available,
    Unavailable,
    Excluded,
    Unknown,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MachineWindowScopeV1 {
    Unavailable,
    VerifiedDocumentWindow,
}
enum VerifiedReply {
    Available(Vec<u8>),
    Unavailable,
    Excluded,
    Unknown,
}

fn validate_reply(
    request: &MachineCaptureRequestV1,
    bytes: &[u8],
) -> Result<VerifiedReply, AwarenessStoreError> {
    if bytes.is_empty() || bytes.len() > MAX_MACHINE_REPLY_BYTES {
        return Err(AwarenessStoreError::Capacity);
    }
    let reply: MachineReplyV1 =
        serde_json::from_slice(bytes).map_err(|_| AwarenessStoreError::Invalid)?;
    if reply.protocol != MACHINE_REPLY_PROTOCOL
        || reply.observation_class != request.observation_class
        || reply.reason.as_ref().is_some_and(|reason| {
            reason.len() > 80
                || !reason
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        })
    {
        return Err(AwarenessStoreError::Invalid);
    }
    if reply.status != MachineReplyStatusV1::Available {
        // No excluded/unknown scope can leak a title, identifier or text through
        // an error/status response, and none becomes an admitted observation.
        if reply.bundle_id.is_some()
            || reply.display_name.is_some()
            || reply.window_ref.is_some()
            || reply.text.is_some()
            || reply.window_scope != MachineWindowScopeV1::Unavailable
            || reply.truncated
        {
            return Err(AwarenessStoreError::Invalid);
        }
        return Ok(match reply.status {
            MachineReplyStatusV1::Excluded => VerifiedReply::Excluded,
            MachineReplyStatusV1::Unknown => VerifiedReply::Unknown,
            _ => VerifiedReply::Unavailable,
        });
    }
    let bundle = reply
        .bundle_id
        .as_deref()
        .ok_or(AwarenessStoreError::Invalid)?;
    if !valid_bundle(bundle)
        || !request
            .allowed_bundle_ids
            .iter()
            .any(|allowed| allowed == bundle)
        || request
            .excluded_bundle_ids
            .iter()
            .any(|excluded| excluded == bundle)
        || SENSITIVE_TERMS
            .iter()
            .any(|term| bundle.to_lowercase().contains(term))
    {
        return Err(AwarenessStoreError::Invalid);
    }
    if reply
        .display_name
        .as_ref()
        .is_some_and(|name| name.len() > 128 || name.chars().any(char::is_control))
    {
        return Err(AwarenessStoreError::Invalid);
    }
    match request.observation_class {
        MachineObservationClassV1::AppMetadata => {
            if reply.text.is_some()
                || reply.window_ref.is_some()
                || reply.window_scope != MachineWindowScopeV1::Unavailable
                || reply.truncated
            {
                return Err(AwarenessStoreError::Invalid);
            }
        }
        MachineObservationClassV1::AccessibilityText | MachineObservationClassV1::ScreenText => {
            if browser(bundle)
                || !SUPPORTED_TEXT_APPS.contains(&bundle)
                || reply.window_ref.is_none()
                || reply.window_scope != MachineWindowScopeV1::VerifiedDocumentWindow
            {
                return Err(AwarenessStoreError::Invalid);
            }
            let text = reply.text.as_deref().ok_or(AwarenessStoreError::Invalid)?;
            if text.is_empty() || text.len() > request.max_text_bytes || credential_text(text) {
                return Err(AwarenessStoreError::Invalid);
            }
        }
    }
    // Parse/re-encode only the closed response schema. No helper-supplied field
    // can select identity, routing, provider, retention, or publication.
    let payload = serde_json::to_vec(&reply).map_err(|_| AwarenessStoreError::Invalid)?;
    if payload.len() > MAX_MACHINE_REPLY_BYTES {
        return Err(AwarenessStoreError::Capacity);
    }
    Ok(VerifiedReply::Available(payload))
}
fn valid_bundle(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".-_".contains(&byte))
}
fn browser(bundle: &str) -> bool {
    let lower = bundle.to_lowercase();
    BROWSER_TERMS.iter().any(|term| lower.contains(term))
}
fn credential_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "-----begin private key",
        "-----begin rsa private key",
        "openai_api_key",
        "anthropic_api_key",
        "aws_secret_access_key",
        "github_token",
        "bearer ",
        "nsec1",
        "sk-live-",
        "sk-proj-",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

/// One permitted changed-state sample. Parent runner executes the exact signed
/// helper with bounded stdin/stdout/deadline; no process spawning occurs here.
pub(crate) struct MachineActivityAdapter {
    handle: MachineActivityHandleV1,
    sampling: ChangedStateSamplerV1,
}
impl MachineActivityAdapter {
    pub(crate) fn new(handle: MachineActivityHandleV1) -> Self {
        Self {
            handle,
            sampling: Default::default(),
        }
    }
    pub(crate) fn set_enabled(&mut self, enabled: bool) {
        self.sampling.set_enabled(enabled);
    }
    pub(crate) fn mark_changed(&mut self) {
        self.sampling.mark_changed();
    }
    /// Exact immutable scope for owned event scheduling and narrow Stop hooks.
    pub(crate) fn grant_key(&self)->&AwarenessGrantKeyV1 {&self.handle.key}
    /// One explicit/changed-state native sample; default/off launches nothing.
    /// Parent calls outside authority locks. The existing source fence covers
    /// the bounded <=2s capture; final admission independently rechecks denial.
    pub(crate) fn sample_embedded(&mut self,state:&AppState,runtime:&CompanionAwarenessRuntime,
        now:&CanonicalTimestamp,runner:&MachineHelperRunnerV1)->Result<SamplingOutcomeV1,AwarenessStoreError> {
        if let Some(outcome)=self.sampling.skip() {return Ok(outcome);}
        let live=LiveAwarenessOwner::authenticate(state)?;
        let key=self.handle.key.clone();
        let directory=runtime.private_directory(live.owner())?;
        let sequence=runtime.next_sequence(&live,&key)?;
        let deadline=Instant::now()+Duration::from_secs(2);
        self.sample(state,runtime,now,sequence,|request|runner.run(MachineHelperReadPermitV1 {key:&key,request,directory:&directory},deadline))
    }
    /// Event-only metadata wake stream, after explicit enabled+observe+unpaused
    /// consent. It emits no app IDs/text and never drives AX/OCR automatically.
    /// Parent owns the returned scope, consumes its dirty bit and drops/stops it
    /// after durable Pause/revoke; default/off construction launches nothing.
    pub(crate) fn start_activation_watcher(&self,state:&AppState,runtime:&CompanionAwarenessRuntime,
        wake:std::sync::mpsc::SyncSender<()>)->Result<MachineActivationWatcherV1,AwarenessStoreError> {
        if self.handle.request.class()!=MachineObservationClassV1::AppMetadata
            || self.sampling.skip()==Some(SamplingOutcomeV1::Disabled) {return Err(AwarenessStoreError::Invalid);}
        let live=LiveAwarenessOwner::authenticate(state)?;let directory=runtime.private_directory(live.owner())?;
        runtime.with_granted_source_read(&live,&self.handle.key, |_|MachineActivationWatcherV1::start(
            MachineHelperReadPermitV1 {key:&self.handle.key,request:&self.handle.request,directory:&directory},wake,Instant::now()+Duration::from_secs(2)))
    }
    pub(crate) fn sample(
        &mut self,
        state: &AppState,
        runtime: &CompanionAwarenessRuntime,
        now: &CanonicalTimestamp,
        sequence: SafeU53,
        run: impl FnOnce(&MachineCaptureRequestV1) -> Result<Vec<u8>, AwarenessStoreError>,
    ) -> Result<SamplingOutcomeV1, AwarenessStoreError> {
        if let Some(outcome) = self.sampling.skip() {
            return Ok(outcome);
        }
        self.sampling.consume_event();
        let live = LiveAwarenessOwner::authenticate(state)?;
        let (authority, reply) =
            runtime.with_granted_source_read(&live, &self.handle.key, |authority| {
                Ok((
                    authority.clone(),
                    run(&self.handle.request)
                        .and_then(|bytes| validate_reply(&self.handle.request, &bytes)),
                ))
            })?;
        match reply {
            Ok(VerifiedReply::Available(payload)) => self.sampling.finish(
                runtime,
                &live,
                &self.handle.key,
                (authority, payload),
                now,
                sequence,
            ),
            other => {
                let health = if matches!(&other, Ok(VerifiedReply::Unknown)) {
                    AwarenessSourceStateV1::Unknown
                } else {
                    AwarenessSourceStateV1::Unavailable
                };
                if authority.source.state != health {
                    runtime.set_source_health(
                        &live,
                        &self.handle.key.source,
                        authority.source_revision,
                        health,
                        &new_id("machine-health")?,
                    )?;
                }
                match other {
                    Err(error) => Err(error),
                    _ => Ok(SamplingOutcomeV1::Quiet),
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "machine_activity_tests.rs"]
mod tests;

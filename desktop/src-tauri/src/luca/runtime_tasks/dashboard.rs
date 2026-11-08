//! Owner-only native work catalogue. This is not a resident or Brain grant.
//!
//! Only exact listed selections receive process-local, short-lived read/action
//! handles. Nothing is observed, indexed, persisted, or sent by opening a view.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use luca_protocol::{
    ConnectedBrainSourceKindV1, ConnectedBrainSourceStatusV1, Hex64, OpaqueId, Sha256Ref,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::{
    delegation, delivery, memory, native_sources, targets, validate_identity, validate_opaque,
    RuntimeTaskProjectionV1,
};
use crate::data_dir::BuzzPathExt;

const SOURCE_PREFIX: &str = "owner-harness-source-";
const LOOKUP_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_LOOKUPS: usize = 16;
const MAX_SESSIONS: usize = 50;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_TRANSCRIPT_BYTES: usize = 64 * 1024;
const REFRESH: &str = "This dashboard selection expired or its owner, profile, or conversation changed. Refresh and select the exact session again; nothing was dispatched.";
const OWNER_ONLY: &str = "Owner dashboard handles are not resident lookup or read authority. Use the resident's permissioned native-session lookup instead.";

/// A metadata-only native session, with action eligibility rechecked at dispatch.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessSessionV1 {
    session_id: String,
    selection_key: String,
    latest_task_id: Option<String>,
    title: String,
    workspace: String,
    working_folder: String,
    updated_at: Option<String>,
    routing: &'static str,
    live_state: &'static str,
    can_send: bool,
    can_continue: bool,
    reason: Option<String>,
}

/// Bounded current-profile metadata; no permission or observation is enabled.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessSessionListV1 {
    source_id: Option<String>,
    runtime_family: String,
    sessions: Vec<HarnessSessionV1>,
    truncated: bool,
    notice: Option<String>,
}

/// An exact owner selection; arbitrary provider UUIDs and paths are not accepted.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetHarnessSessionInputV1 {
    runtime_family: String,
    source_id: String,
    session_id: String,
    conversation_id: String,
    resident_pubkey: String,
}

/// A filtered recent transcript tail. Usage is unknown, never estimated billing.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessSessionDetailV1 {
    session_id: String,
    title: String,
    messages: Vec<crate::luca::connected_brain::VisibleNativeSessionMessageV1>,
    truncated: bool,
    usage: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct OwnerScope {
    owner: Hex64,
    relay: Sha256Ref,
    app_profile: PathBuf,
    resident: Hex64,
    conversation: OpaqueId,
    binding: Sha256Ref,
}

#[derive(Clone)]
struct OwnerLookupLease {
    scope: OwnerScope,
    source: targets::RuntimeTaskTargetSourceV1,
    runtime: String,
    issued_at: Instant,
    targets: HashMap<String, targets::RuntimeTaskExistingTargetV1>,
}

impl OwnerLookupLease {
    fn require_current(
        &self,
        scope: &OwnerScope,
        runtime: &str,
        profile: &Path,
        now: Instant,
    ) -> Result<(), String> {
        if self.scope != *scope
            || self.runtime != runtime
            || self.source.canonical_root != profile
            || now.saturating_duration_since(self.issued_at) >= LOOKUP_TTL
        {
            return Err(REFRESH.into());
        }
        Ok(())
    }

    fn selected(&self, session: &OpaqueId) -> Result<targets::RuntimeTaskExistingTargetV1, String> {
        self.targets.get(session.as_str()).cloned().ok_or_else(|| {
            "Choose the exact session returned by this owner dashboard; unlisted targets cannot be read or dispatched.".into()
        })
    }
}

#[derive(Default)]
struct OwnerLookupRegistry {
    leases: HashMap<String, OwnerLookupLease>,
}

impl OwnerLookupRegistry {
    fn source_for(
        &mut self,
        scope: &OwnerScope,
        runtime: &str,
        root: PathBuf,
        now: Instant,
    ) -> Result<(targets::RuntimeTaskTargetSourceV1, Instant), String> {
        self.leases.retain(|_, lease| {
            lease.scope.owner == scope.owner
                && lease.scope.relay == scope.relay
                && lease.scope.app_profile == scope.app_profile
                && now.saturating_duration_since(lease.issued_at) < LOOKUP_TTL
        });
        if let Some(lease) = self
            .leases
            .values()
            .find(|lease| lease.require_current(scope, runtime, &root, now).is_ok())
        {
            return Ok((lease.source.clone(), lease.issued_at));
        }
        Ok((
            targets::RuntimeTaskTargetSourceV1 {
                source_id: OpaqueId::parse(format!("{SOURCE_PREFIX}{}", Uuid::new_v4()))
                    .map_err(|_| REFRESH.to_owned())?,
                source_kind: match runtime {
                    "claude_code" => ConnectedBrainSourceKindV1::ClaudeHistory,
                    "codex" => ConnectedBrainSourceKindV1::CodexHistory,
                    _ => return Err("Choose Claude Code or Codex.".into()),
                },
                canonical_root: root,
                status: ConnectedBrainSourceStatusV1::Current,
            },
            now,
        ))
    }

    fn remember(&mut self, lease: OwnerLookupLease, now: Instant) -> Result<(), String> {
        if lease.targets.len() > MAX_SESSIONS
            || !is_dashboard_source(&lease.source.source_id)
            || now.saturating_duration_since(lease.issued_at) >= LOOKUP_TTL
            || lease.targets.iter().any(|(key, target)| {
                target.source_id != lease.source.source_id
                    || target.runtime_family != lease.runtime
                    || target.session_ref.as_str() != key
            })
        {
            return Err(REFRESH.into());
        }
        self.leases
            .retain(|_, old| now.saturating_duration_since(old.issued_at) < LOOKUP_TTL);
        if !self.leases.contains_key(lease.source.source_id.as_str())
            && self.leases.len() >= MAX_LOOKUPS
        {
            if let Some(oldest) = self
                .leases
                .iter()
                .min_by_key(|(_, old)| old.issued_at)
                .map(|(id, _)| id.clone())
            {
                self.leases.remove(&oldest);
            }
        }
        self.leases
            .insert(lease.source.source_id.as_str().to_owned(), lease);
        Ok(())
    }

    fn get(
        &mut self,
        source: &OpaqueId,
        scope: &OwnerScope,
        runtime: &str,
        profile: &Path,
        now: Instant,
    ) -> Result<OwnerLookupLease, String> {
        let lease = self.leases.get(source.as_str()).cloned().ok_or(REFRESH)?;
        if let Err(error) = lease.require_current(scope, runtime, profile, now) {
            self.leases.remove(source.as_str());
            return Err(error);
        }
        Ok(lease)
    }
}

fn registry() -> &'static Mutex<OwnerLookupRegistry> {
    static REGISTRY: OnceLock<Mutex<OwnerLookupRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(OwnerLookupRegistry::default()))
}

pub(super) fn is_dashboard_source(source: &OpaqueId) -> bool {
    source.as_str().starts_with(SOURCE_PREFIX)
}

pub(super) fn reject_resident_source(source: &str) -> Result<(), String> {
    if source.starts_with(SOURCE_PREFIX) {
        return Err(OWNER_ONLY.into());
    }
    Ok(())
}

fn runtime_family(value: &str) -> Result<&'static str, String> {
    match value {
        "claude_code" => Ok("claude_code"),
        "codex" => Ok("codex"),
        _ => Err("Choose Claude Code or Codex for this dashboard.".into()),
    }
}

fn current_scope(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
) -> Result<OwnerScope, String> {
    if app
        .state::<crate::app_state::AppState>()
        .shutdown_started
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err(REFRESH.into());
    }
    validate_identity(resident)?;
    validate_opaque(conversation, 128, "conversation")?;
    let resident = Hex64::parse(resident.to_ascii_lowercase()).map_err(|_| REFRESH.to_owned())?;
    // This legacy-named helper checks trusted managed configuration only. It
    // neither reads Brain nor requires a running resident or a recall grant.
    let binding = crate::managed_agents::current_owner_brain_runtime_authority(app, &resident)?.0;
    Ok(OwnerScope {
        owner: delegation::owner(app)?,
        relay: delivery::current_origin(app)?.0,
        app_profile: app
            .buzz_path()
            .app_data_dir()
            .map_err(|_| REFRESH.to_owned())?
            .canonicalize()
            .map_err(|_| REFRESH.to_owned())?,
        resident,
        conversation: OpaqueId::parse(conversation.to_owned()).map_err(|_| REFRESH.to_owned())?,
        binding,
    })
}

fn require_scope(app: &AppHandle, expected: &OwnerScope) -> Result<(), String> {
    if current_scope(
        app,
        expected.resident.as_str(),
        expected.conversation.as_str(),
    )? != *expected
    {
        return Err(REFRESH.into());
    }
    Ok(())
}

fn selection_key(
    scope: &OwnerScope,
    source: &targets::RuntimeTaskTargetSourceV1,
    target: &targets::RuntimeTaskExistingTargetV1,
) -> Result<String, String> {
    let digest = luca_protocol::canonical_sha256(&serde_json::json!({
        "domain": "polyphonic.owner-harness-selection.v1", "owner": scope.owner,
        "relay": scope.relay, "appProfile": scope.app_profile, "nativeProfile": source.canonical_root,
        "runtime": target.runtime_family, "nativeSession": target.provider_session_id.to_string(),
    })).map_err(|_| "Dashboard selection identity is unavailable.".to_owned())?;
    Ok(format!("harness-identity-{digest}"))
}

fn latest_task_id<'a>(
    scope: &OwnerScope,
    target: &targets::RuntimeTaskExistingTargetV1,
    tasks: impl Iterator<Item = &'a RuntimeTaskProjectionV1>,
) -> Option<String> {
    let native_id = target.provider_session_id.to_string();
    tasks
        .filter(|task| {
            task.owner_pubkey == scope.owner.as_str()
                && task.origin_relay_ref.as_ref() == Some(&scope.relay)
                && task.runtime_family == target.runtime_family
                && task.provider_session_id.as_deref() == Some(native_id.as_str())
        })
        .max_by(|left, right| left.started_at.cmp(&right.started_at))
        .map(|task| task.task_id.clone())
}

fn session_view(
    candidate: &targets::RuntimeTaskTargetCandidateV1,
    selection_key: String,
    latest_task_id: Option<String>,
    live_snapshot: Option<&str>,
) -> HarnessSessionV1 {
    let target = &candidate.target;
    let mut view = HarnessSessionV1 {
        session_id: target.session_ref.as_str().to_owned(),
        selection_key,
        latest_task_id,
        title: candidate.label.clone(),
        workspace: candidate.workspace_basename.clone(),
        working_folder: target
            .canonical_working_folder
            .to_string_lossy()
            .into_owned(),
        updated_at: candidate.updated_at.clone(),
        routing: "unavailable",
        live_state: "unknown",
        can_send: false,
        can_continue: false,
        reason: None,
    };
    match target.codex_origin {
        Some(targets::CodexSessionOriginV1::NativeApp) => {
            view.routing = "codex_app";
            view.can_send = true;
            view.reason = Some(
                "Native queue availability is rechecked on Send. Delivery is not task completion."
                    .into(),
            );
        }
        Some(targets::CodexSessionOriginV1::SavedCli) => {
            view.routing = "saved_codex_cli";
            view.can_continue = true;
            view.reason =
                Some("Saved CLI work; live availability is not established by this file.".into());
        }
        _ if target.runtime_family == "claude_code" => {
            let live = live_snapshot
                .and_then(|output| delegation::dashboard_claude_is_live(output, target).ok());
            view.live_state = match live {
                Some(true) => "live",
                Some(false) => "saved",
                None => "unknown",
            };
            if !candidate.claude_can_continue {
                view.reason = Some("The saved native permission policy is unknown. Review this session in Claude Code.".into());
            } else if live == Some(true) {
                view.routing = "claude_live";
                view.can_send = true;
            } else {
                view.routing = "saved_claude";
                view.can_continue = true;
                if live.is_none() {
                    view.reason = Some("Live availability is unverified. Continuation rechecks and refuses a live controller.".into());
                }
            }
        }
        _ => {
            view.reason = Some("Native origin is unverified. Review this session in Codex.".into())
        }
    }
    view
}

struct PreparedCatalogue {
    scope: OwnerScope,
    source: targets::RuntimeTaskTargetSourceV1,
    issued_at: Instant,
    list: targets::RuntimeTaskTargetListV1,
}

/// Read only the current native profile as the local owner. No resident grants.
pub async fn list_harness_sessions(
    app: AppHandle,
    runtime: String,
    conversation: String,
    resident: String,
) -> Result<HarnessSessionListV1, String> {
    let runtime = runtime_family(&runtime)?.to_owned();
    let task_app = app.clone();
    let task_runtime = runtime.clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || -> Result<_, String> {
        let scope = current_scope(&task_app, &resident, &conversation)?;
        let root = match native_sources::current_profile_root(&task_runtime) {
            Ok(root) => root,
            Err(notice) => return Ok(Err(notice)),
        };
        let (source, issued_at) = registry()
            .lock()
            .map_err(|_| REFRESH.to_owned())?
            .source_for(&scope, &task_runtime, root, Instant::now())?;
        let excluded = delegation::exclusions(&task_app, &task_runtime)?;
        let list = targets::list_connected_session_targets(
            &source,
            &task_runtime,
            &excluded,
            MAX_SESSIONS,
        )?;
        require_scope(&task_app, &scope)?;
        Ok(Ok(PreparedCatalogue {
            scope,
            source,
            issued_at,
            list,
        }))
    })
    .await
    .map_err(|_| "Native dashboard lookup was interrupted.".to_owned())??;
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(notice) => {
            return Ok(HarnessSessionListV1 {
                source_id: None,
                runtime_family: runtime,
                sessions: Vec::new(),
                truncated: false,
                notice: Some(notice),
            })
        }
    };
    let live = if runtime == "claude_code" && !prepared.list.candidates.is_empty() {
        delegation::dashboard_claude_snapshot(prepared.source.canonical_root.clone()).await
    } else {
        None
    };
    require_scope(&app, &prepared.scope)?;
    if native_sources::current_profile_root(&runtime)? != prepared.source.canonical_root {
        return Err(REFRESH.into());
    }
    let task_links = {
        let state = memory()
            .lock()
            .map_err(|_| "Runtime task state is unavailable.".to_owned())?;
        prepared
            .list
            .candidates
            .iter()
            .map(|candidate| {
                latest_task_id(
                    &prepared.scope,
                    &candidate.target,
                    state.projections.values(),
                )
            })
            .collect::<Vec<_>>()
    };
    let mut sessions = Vec::with_capacity(prepared.list.candidates.len());
    let mut listed = HashMap::with_capacity(prepared.list.candidates.len());
    for (candidate, task_link) in prepared.list.candidates.iter().zip(task_links) {
        sessions.push(session_view(
            candidate,
            selection_key(&prepared.scope, &prepared.source, &candidate.target)?,
            task_link,
            live.as_deref(),
        ));
        listed.insert(
            candidate.session_ref.as_str().to_owned(),
            candidate.target.clone(),
        );
    }
    require_scope(&app, &prepared.scope)?;
    if native_sources::current_profile_root(&runtime)? != prepared.source.canonical_root {
        return Err(REFRESH.into());
    }
    let source_id = prepared.source.source_id.as_str().to_owned();
    registry()
        .lock()
        .map_err(|_| REFRESH.to_owned())?
        .remember(
            OwnerLookupLease {
                scope: prepared.scope,
                source: prepared.source,
                runtime: runtime.clone(),
                issued_at: prepared.issued_at,
                targets: listed,
            },
            Instant::now(),
        )?;
    Ok(HarnessSessionListV1 {
        source_id: Some(source_id), runtime_family: runtime, sessions, truncated: prepared.list.truncated,
        notice: Some("Current-profile metadata only; recent saved files do not prove live work. Selections expire after five minutes. Reads stay local; Send and Continue require your explicit action and preserve native permissions.".into()),
    })
}

fn selected_lease(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
    runtime: &str,
    source: &OpaqueId,
    session: &OpaqueId,
) -> Result<(OwnerLookupLease, targets::RuntimeTaskExistingTargetV1), String> {
    if !is_dashboard_source(source) {
        return Err(REFRESH.into());
    }
    let scope = current_scope(app, resident, conversation)?;
    let lease = registry().lock().map_err(|_| REFRESH.to_owned())?.get(
        source,
        &scope,
        runtime,
        &native_sources::current_profile_root(runtime)?,
        Instant::now(),
    )?;
    let target = lease.selected(session)?;
    Ok((lease, target))
}

/// Dispatch alone may resolve owner-dashboard authority; resident tools reject it.
pub(super) fn resolve_source(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
    runtime: &str,
    source: &OpaqueId,
    session: &OpaqueId,
) -> Result<targets::RuntimeTaskTargetSourceV1, String> {
    let (lease, target) = selected_lease(app, resident, conversation, runtime, source, session)?;
    targets::revalidate_connected_session_target(
        &lease.source,
        &target,
        None,
        &delegation::exclusions(app, runtime)?,
    )?;
    Ok(lease.source)
}

fn bounded_tail(
    mut tail: crate::luca::connected_brain::VisibleNativeSessionTailV1,
) -> (
    Vec<crate::luca::connected_brain::VisibleNativeSessionMessageV1>,
    bool,
) {
    let mut remaining = MAX_TRANSCRIPT_BYTES;
    for message in tail.messages.iter_mut().rev() {
        let max = MAX_MESSAGE_BYTES.min(remaining);
        if message.text.len() > max {
            let mut end = max;
            while !message.text.is_char_boundary(end) {
                end -= 1;
            }
            message.text.truncate(end);
            tail.truncated = true;
        }
        remaining = remaining.saturating_sub(message.text.len());
    }
    tail.messages.retain(|message| !message.text.is_empty());
    (tail.messages, tail.truncated)
}

/// Read just one listed session through the existing filtered, bounded parser.
pub async fn get_harness_session(
    app: AppHandle,
    input: GetHarnessSessionInputV1,
) -> Result<HarnessSessionDetailV1, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = runtime_family(&input.runtime_family)?;
        let source = OpaqueId::parse(input.source_id).map_err(|_| REFRESH.to_owned())?;
        let session = OpaqueId::parse(input.session_id).map_err(|_| REFRESH.to_owned())?;
        let (lease, target) = selected_lease(
            &app,
            &input.resident_pubkey,
            &input.conversation_id,
            runtime,
            &source,
            &session,
        )?;
        let excluded = delegation::exclusions(&app, runtime)?;
        let tail = target.visible_messages(&lease.source, &excluded)?;
        // Recheck exact native identity, then authority last, before IPC.
        targets::revalidate_connected_session_target(
            &lease.source,
            &target,
            None,
            &delegation::exclusions(&app, runtime)?,
        )?;
        let (messages, truncated) = bounded_tail(tail);
        selected_lease(
            &app,
            &input.resident_pubkey,
            &input.conversation_id,
            runtime,
            &source,
            &session,
        )?;
        Ok(HarnessSessionDetailV1 {
            session_id: session.as_str().to_owned(),
            title: target.label,
            messages,
            truncated,
            usage: None,
        })
    })
    .await
    .map_err(|_| "Native transcript read was interrupted.".to_owned())?
}

#[cfg(test)]
#[path = "dashboard_tests.rs"]
mod tests;

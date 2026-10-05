//! Short-lived, explicitly permissioned native-session metadata access.
//!
//! This does not connect, index, watch, attach, or retain anything in Brain.
//! Only the requested runtime's current profile is eligible. Opaque lookup
//! handles are local process memory, not authority supplied by the model.

use std::{collections::HashSet, sync::atomic::Ordering};

use luca_protocol::{
    CapabilityKind, CapabilityResourceV1, CapabilityRisk, ConnectedBrainSourceKindV1,
    ConnectedBrainSourceStatusV1, Hex64, ManagedPermissionRequestV2, OpaqueId, Sha256Ref,
    MANAGED_PERMISSION_V2_PROTOCOL,
};

use super::{
    targets::{RuntimeTaskTargetListV1, RuntimeTaskTargetSourceV1},
    *,
};
use crate::luca::managed_permission::CapabilityPermissionDecision;

const SOURCE_PREFIX: &str = "native-session-source-";
const LOOKUP_TTL: Duration = Duration::from_secs(20 * 60);
const MAX_LOOKUPS: usize = 128;
const REFRESH: &str = "Native session lookup is expired, unavailable, or changed. Refresh native session lookup and select the exact session again; nothing was dispatched.";

#[derive(Clone)]
struct NativeLookupLease {
    scope: RuntimeTaskAccessScopeV1,
    source: RuntimeTaskTargetSourceV1,
    runtime: String,
    issued_at: Instant,
    resource: CapabilityResourceV1,
    durable_authority: bool,
    listed_sessions: HashSet<String>,
}

impl NativeLookupLease {
    fn active_at(&self, now: Instant) -> bool {
        self.scope.active.load(Ordering::Acquire)
            && now.saturating_duration_since(self.issued_at) < LOOKUP_TTL
    }

    fn require_scope(&self, scope: &RuntimeTaskAccessScopeV1) -> Result<(), String> {
        self.require_scope_at(scope, Instant::now())
    }

    fn require_scope_at(
        &self,
        scope: &RuntimeTaskAccessScopeV1,
        now: Instant,
    ) -> Result<(), String> {
        if self.scope.owner_pubkey != scope.owner_pubkey
            || self.scope.resident_pubkey != scope.resident_pubkey
            || self.scope.session_epoch != scope.session_epoch
            || self.scope.binding_ref != scope.binding_ref
            || self.scope.conversation_id != scope.conversation_id
            || !Arc::ptr_eq(&self.scope.active, &scope.active)
            || !self.active_at(now)
        {
            return Err(REFRESH.into());
        }
        Ok(())
    }

    fn require_listed_session(&self, session: &OpaqueId) -> Result<(), String> {
        if !self.listed_sessions.contains(session.as_str()) {
            return Err("Choose the exact session returned by native session lookup. Refresh and reselect if needed; no work was dispatched.".into());
        }
        Ok(())
    }

    fn revalidate(
        &self,
        scope: &RuntimeTaskAccessScopeV1,
        current_profile: &Path,
        durable_grant_active: bool,
        now: Instant,
    ) -> Result<(), String> {
        self.require_scope_at(scope, now)?;
        if self.source.canonical_root != current_profile
            || (self.durable_authority && !durable_grant_active)
        {
            return Err(REFRESH.into());
        }
        Ok(())
    }
}

#[derive(Default)]
struct NativeLookupRegistry {
    leases: HashMap<String, NativeLookupLease>,
}

impl NativeLookupRegistry {
    fn issue(
        &mut self,
        scope: RuntimeTaskAccessScopeV1,
        runtime: &str,
        canonical_root: PathBuf,
        resource: CapabilityResourceV1,
        decision: CapabilityPermissionDecision,
        now: Instant,
    ) -> Result<RuntimeTaskTargetSourceV1, String> {
        if decision == CapabilityPermissionDecision::Deny {
            return Err("Native session metadata access was not approved. Nothing was read or connected to Brain.".into());
        }
        if !scope.active.load(Ordering::Acquire) {
            return Err(REFRESH.into());
        }
        self.leases.retain(|_, lease| lease.active_at(now));
        if self.leases.len() >= MAX_LOOKUPS {
            return Err("Native session lookup capacity is temporarily full. Let earlier lookup handles expire, then refresh; no work was dispatched.".into());
        }
        let source = RuntimeTaskTargetSourceV1 {
            source_id: OpaqueId::parse(format!("{SOURCE_PREFIX}{}", Uuid::new_v4()))
                .map_err(|_| "Native session lookup handle could not be created.".to_owned())?,
            source_kind: profile_kind(runtime)?,
            canonical_root,
            // A fresh native profile is current filesystem metadata, not a
            // connected-Brain manifest. Dispatch rechecks the real profile.
            status: ConnectedBrainSourceStatusV1::Current,
        };
        self.leases.insert(
            source.source_id.as_str().to_owned(),
            NativeLookupLease {
                scope,
                source: source.clone(),
                runtime: runtime.to_owned(),
                issued_at: now,
                resource,
                durable_authority: decision == CapabilityPermissionDecision::AlwaysAllow,
                listed_sessions: HashSet::new(),
            },
        );
        Ok(source)
    }

    fn get(&mut self, source: &OpaqueId, now: Instant) -> Result<NativeLookupLease, String> {
        self.leases.retain(|_, lease| lease.active_at(now));
        self.leases
            .get(source.as_str())
            .cloned()
            .ok_or_else(|| REFRESH.into())
    }

    fn remember(
        &mut self,
        scope: &RuntimeTaskAccessScopeV1,
        source: &OpaqueId,
        list: &RuntimeTaskTargetListV1,
        now: Instant,
    ) -> Result<(), String> {
        if list.candidates.len() > 50 {
            return Err(REFRESH.into());
        }
        self.get(source, now)?.require_scope_at(scope, now)?;
        let entry = self.leases.get_mut(source.as_str()).ok_or(REFRESH)?;
        entry.listed_sessions = list
            .candidates
            .iter()
            .map(|candidate| candidate.session_ref.as_str().to_owned())
            .collect();
        Ok(())
    }
}

fn registry() -> &'static Mutex<NativeLookupRegistry> {
    static REGISTRY: OnceLock<Mutex<NativeLookupRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(NativeLookupRegistry::default()))
}

pub(super) fn is_native_source(source: &OpaqueId) -> bool {
    source.as_str().starts_with(SOURCE_PREFIX)
}

fn profile_kind(runtime: &str) -> Result<ConnectedBrainSourceKindV1, String> {
    match runtime {
        "codex" => Ok(ConnectedBrainSourceKindV1::CodexHistory),
        "claude_code" => Ok(ConnectedBrainSourceKindV1::ClaudeHistory),
        _ => Err("Choose Codex or Claude Code for native session lookup.".into()),
    }
}

fn resolve_profile_root(
    runtime: &str,
    home: Option<&Path>,
    override_home: Option<&Path>,
) -> Result<PathBuf, String> {
    let (default_home, history_directory) = match runtime {
        "codex" => (".codex", "sessions"),
        "claude_code" => (".claude", "projects"),
        _ => return Err("Choose Codex or Claude Code for native session lookup.".into()),
    };
    let profile = match override_home {
        Some(path) if path.is_absolute() => path.to_path_buf(),
        Some(_) => return Err("The current native profile must use an absolute folder. Refresh native session lookup after correcting the native runtime setting.".into()),
        None => home.ok_or("The current native profile is unavailable.")?.join(default_home),
    };
    let root = profile.join(history_directory).canonicalize().map_err(|_| {
        "The current native session profile is unavailable. Open the native runtime, then refresh native session lookup.".to_owned()
    })?;
    if !root.is_absolute() || !root.is_dir() || root.parent().is_none() {
        return Err("The current native session profile is unavailable. Refresh native session lookup; no work was dispatched.".into());
    }
    Ok(root)
}

pub(super) fn current_profile_root(runtime: &str) -> Result<PathBuf, String> {
    let override_home = match runtime {
        "codex" => std::env::var_os("CODEX_HOME"),
        "claude_code" => std::env::var_os("CLAUDE_CONFIG_DIR"),
        _ => return Err("Choose Codex or Claude Code for native session lookup.".into()),
    }
    .map(PathBuf::from);
    resolve_profile_root(
        runtime,
        dirs::home_dir().as_deref(),
        override_home.as_deref(),
    )
}

pub(super) fn validate_current_scope(
    app: &AppHandle,
    scope: &RuntimeTaskAccessScopeV1,
) -> Result<(), String> {
    if !scope.active.load(Ordering::Acquire) || delegation::owner(app)? != scope.owner_pubkey {
        return Err(REFRESH.into());
    }
    // This function resolves only the trusted current managed configuration;
    // despite its legacy name it never reads Brain sources or recall grants.
    let (binding, _) =
        crate::managed_agents::current_owner_brain_runtime_authority(app, &scope.resident_pubkey)
            .map_err(|_| REFRESH.to_owned())?;
    if binding != scope.binding_ref {
        return Err(REFRESH.into());
    }
    Ok(())
}

fn permission_request(
    scope: &RuntimeTaskAccessScopeV1,
    runtime: &str,
    root: &Path,
) -> Result<ManagedPermissionRequestV2, String> {
    let fingerprint = luca_protocol::canonical_sha256(&serde_json::json!({
        "domain": "polyphonic.native-session-metadata.v1",
        "runtime": runtime,
        "profile": root,
    }))
    .map_err(|_| "Native session permission could not be scoped.".to_owned())?;
    Ok(ManagedPermissionRequestV2 {
        protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
        resident_pubkey: scope.resident_pubkey.clone(),
        session_epoch: scope.session_epoch,
        turn_id: OpaqueId::parse(format!("native-session-turn-{}", Uuid::new_v4()))
            .map_err(|_| "Native session permission could not be scoped.".to_owned())?,
        conversation_id: scope.conversation_id.clone(),
        request_id: OpaqueId::parse(format!("native-session-request-{}", Uuid::new_v4()))
            .map_err(|_| "Native session permission could not be scoped.".to_owned())?,
        capability: CapabilityKind::FilesystemRead,
        risk: CapabilityRisk::Routine,
        operation: format!(
            "List bounded {} native session metadata",
            runtime_label(runtime)
        ),
        operation_fingerprint: Sha256Ref::parse(format!("sha256:{fingerprint}"))
            .map_err(|_| "Native session permission could not be scoped.".to_owned())?,
        resource: CapabilityResourceV1 {
            kind: "native_session_metadata".into(),
            resource_ref: format!("native-session-profile-{fingerprint}"),
            display_name: format!("{} native session metadata", runtime_label(runtime)),
        },
    })
}

fn validate_lease(
    app: &AppHandle,
    lease: &NativeLookupLease,
    resident: &Hex64,
    conversation: &OpaqueId,
) -> Result<(), String> {
    validate_current_scope(app, &lease.scope)?;
    let grant_active = !lease.durable_authority
        || crate::luca::resident_capability_authority::is_granted(
            app,
            lease.scope.owner_pubkey.as_str(),
            resident.as_str(),
            CapabilityKind::FilesystemRead,
            &lease.resource.kind,
            &lease.resource.resource_ref,
        )
        .unwrap_or(false);
    let current_scope = RuntimeTaskAccessScopeV1 {
        owner_pubkey: delegation::owner(app)?,
        resident_pubkey: resident.clone(),
        conversation_id: conversation.clone(),
        ..lease.scope.clone()
    };
    lease.revalidate(
        &current_scope,
        &current_profile_root(&lease.runtime)?,
        grant_active,
        Instant::now(),
    )
}

pub(super) fn for_listing<C: FnMut() -> bool>(
    app: &AppHandle,
    scope: &RuntimeTaskAccessScopeV1,
    runtime: &str,
    selected: Option<&OpaqueId>,
    mut cancelled: C,
) -> Result<RuntimeTaskTargetSourceV1, String> {
    if cancelled() {
        return Err("Native session lookup was cancelled. Nothing was read or dispatched.".into());
    }
    if let Some(selected) = selected {
        let lease = registry()
            .lock()
            .map_err(|_| REFRESH.to_owned())?
            .get(selected, Instant::now())?;
        lease.require_scope(scope)?;
        if lease.runtime != runtime {
            return Err(REFRESH.into());
        }
        validate_lease(app, &lease, &scope.resident_pubkey, &scope.conversation_id)?;
        return Ok(lease.source);
    }
    validate_current_scope(app, scope)?;
    let root = current_profile_root(runtime)?;
    let request = permission_request(scope, runtime, &root)?;
    let resource = request.resource.clone();
    let decision = crate::luca::managed_permission::await_capability_decision_cancellable(
        app,
        scope.owner_pubkey.as_str(),
        request,
        || cancelled() || validate_current_scope(app, scope).is_err(),
    );
    if cancelled() {
        return Err("Native session lookup was cancelled. Nothing was read or dispatched.".into());
    }
    validate_current_scope(app, scope)?;
    if current_profile_root(runtime)? != root {
        return Err(REFRESH.into());
    }
    registry().lock().map_err(|_| REFRESH.to_owned())?.issue(
        scope.clone(),
        runtime,
        root,
        resource,
        decision,
        Instant::now(),
    )
}

pub(super) fn remember_listed_sessions(
    app: &AppHandle,
    scope: &RuntimeTaskAccessScopeV1,
    source: &OpaqueId,
    list: &RuntimeTaskTargetListV1,
) -> Result<(), String> {
    let lease = registry()
        .lock()
        .map_err(|_| REFRESH.to_owned())?
        .get(source, Instant::now())?;
    lease.require_scope(scope)?;
    validate_lease(app, &lease, &scope.resident_pubkey, &scope.conversation_id)?;
    registry()
        .lock()
        .map_err(|_| REFRESH.to_owned())?
        .remember(scope, source, list, Instant::now())
}

pub(super) fn validate_proposal_scope(
    scope: &RuntimeTaskAccessScopeV1,
    source: &str,
) -> Result<(), String> {
    let source = OpaqueId::parse(source.to_owned()).map_err(|_| REFRESH.to_owned())?;
    if !is_native_source(&source) {
        return Ok(());
    }
    registry()
        .lock()
        .map_err(|_| REFRESH.to_owned())?
        .get(&source, Instant::now())?
        .require_scope(scope)
}

pub(super) fn resolve_source(
    app: &AppHandle,
    resident: &str,
    conversation: &str,
    source: &OpaqueId,
    session: &OpaqueId,
) -> Result<RuntimeTaskTargetSourceV1, String> {
    let resident = Hex64::parse(resident.to_ascii_lowercase()).map_err(|_| REFRESH.to_owned())?;
    let conversation = OpaqueId::parse(conversation.to_owned()).map_err(|_| REFRESH.to_owned())?;
    let lease = registry()
        .lock()
        .map_err(|_| REFRESH.to_owned())?
        .get(source, Instant::now())?;
    lease.require_listed_session(session)?;
    validate_lease(app, &lease, &resident, &conversation)?;
    Ok(lease.source)
}

#[cfg(test)]
#[path = "native_sources_tests.rs"]
mod tests;

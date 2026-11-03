//! Chat-led setup. The model names a harness/action, never a path or grant.
//! One host-owned approval discloses the exact combined observation/destination
//! choice. Advanced per-source controls remain authoritative and independent.

use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{
            native_profile::{
                NativeProfileKindV1, NativeProfileObservationClassV1, NativeProfileSelectionV1,
            },
            profile_catalog::NativeProfileRegistrationV1,
            AwarenessGrantKeyV1, AwarenessSourceKeyV1, AwarenessStoreError, LiveAwarenessOwner,
        },
        continuity_jobs::current_canonical_timestamp,
        managed_permission::{await_capability_decision_cancellable, CapabilityPermissionDecision},
        resident_proposals::{verify_origin, ResidentProposalScope},
    },
};
use luca_protocol::{
    canonical_sha256, CapabilityKind, CapabilityResourceV1, CapabilityRisk, Hex64,
    ManagedPermissionRequestV2, OpaqueId, SafeU53, Sha256Ref, MANAGED_PERMISSION_V2_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Harness {
    ClaudeCode,
    Codex,
}
impl Harness {
    pub(super) fn kind(self) -> NativeProfileKindV1 {
        match self {
            Self::ClaudeCode => NativeProfileKindV1::ClaudeProjects,
            Self::Codex => NativeProfileKindV1::CodexSessions,
        }
    }
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
        }
    }
}

/// Shared follow target, not conversation authority. Each caller must obtain
/// its own host-owned approval; settings never invents a conversation scope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FollowTarget {
    pub owner: Hex64,
    pub resident: Hex64,
    pub binding: Sha256Ref,
    pub session_epoch: SafeU53,
}
impl From<&ResidentProposalScope> for FollowTarget {
    fn from(scope: &ResidentProposalScope) -> Self {
        Self {
            owner: scope.owner.clone(),
            resident: scope.resident.clone(),
            binding: scope.binding.clone(),
            session_epoch: scope.session_epoch,
        }
    }
}

pub(super) fn follow_disclosure(harness: Harness) -> String {
    Request {
        action: Action::Follow,
        harnesses: vec![harness],
    }
    .disclosure()
}

pub(super) fn discovered_root(app: &AppHandle, harness: Harness) -> Result<PathBuf, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Home folder unavailable.")?;
    transcript_root(
        &home,
        harness,
        std::env::var(match harness {
            Harness::ClaudeCode => "CLAUDE_CONFIG_DIR",
            Harness::Codex => "CODEX_HOME",
        })
        .ok()
        .as_deref(),
    )
}

pub(super) fn follow_approval_state(
    state: &AppState,
    target: &FollowTarget,
) -> Result<String, String> {
    approval_state(state, target, Action::Follow)
}

/// Exact CAS bases captured before owner review. A later Pause, withdrawal, or
/// sharing change must never become a fresh base that Follow silently replaces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FollowExpected {
    key: AwarenessGrantKeyV1,
    grant_revision: Option<SafeU53>,
    deny_epoch: Option<SafeU53>,
    history_revision: SafeU53,
    resident_revision: SafeU53,
    paused: bool,
    promote: bool,
}
impl FollowExpected {
    pub(super) fn selection(
        &self,
        root: PathBuf,
        harness: Harness,
    ) -> Result<NativeProfileSelectionV1, String> {
        NativeProfileSelectionV1::new(
            self.key.clone(),
            root,
            harness.kind(),
            NativeProfileObservationClassV1::VisibleExcerpts,
        )
        .map_err(err)
    }
    pub(super) fn after_owned_resume(&mut self, resumed: Option<(SafeU53, SafeU53)>) {
        if let Some((previous, current)) = resumed {
            if self.paused && self.resident_revision == previous {
                self.paused = false;
                self.resident_revision = current;
            }
        }
    }
}

pub(super) fn follow_expected(
    state: &AppState,
    target: &FollowTarget,
    harness: Harness,
    root: &Path,
) -> Result<FollowExpected, String> {
    let device = state
        .companion_awareness
        .device(&target.owner)
        .map_err(err)?;
    let source = NativeProfileSelectionV1::source_id_for_selection(
        &target.owner,
        &target.resident,
        &device,
        root,
        harness.kind(),
        NativeProfileObservationClassV1::VisibleExcerpts,
    )
    .map_err(err)?;
    let key = AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: target.owner.clone(),
            source_id: source,
            device_id: device,
        },
        resident_pubkey: target.resident.clone(),
    };
    let deny_epoch = match state
        .companion_awareness
        .source_snapshot(&target.owner, &key.source)
    {
        Ok((source, _)) => Some(source.deny_epoch),
        Err(AwarenessStoreError::Missing) => None,
        Err(e) => return Err(err(e)),
    };
    let prior = match state.companion_awareness.snapshot(&target.owner, &key) {
        Ok(snapshot) => Some(snapshot.grant),
        Err(AwarenessStoreError::Missing) => None,
        Err(e) => return Err(err(e)),
    };
    let history_revision = state
        .companion_awareness
        .native_history_choice(&target.owner, &key)
        .map_err(err)?
        .map_or(
            SafeU53::new(0).map_err(|_| "Invalid history revision.")?,
            |choice| choice.revision,
        );
    let resident = state
        .companion_awareness
        .resident_state(&target.owner, &target.resident)
        .map_err(err)?;
    Ok(FollowExpected {
        key,
        deny_epoch,
        history_revision,
        resident_revision: resident.revision,
        paused: resident.paused,
        grant_revision: prior.as_ref().map(|grant| grant.grant_revision),
        promote: prior.is_some_and(|grant| {
            grant.state == luca_protocol::AwarenessGrantStateV1::Active && grant.choices.promote
        }),
    })
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Action {
    Follow,
    PauseAwareness,
    ResumeAwareness,
    EnableBackground,
    PauseBackground,
    ResumeBackground,
    DisableBackground,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: Action,
    #[serde(default)]
    harnesses: Vec<Harness>,
}
impl Request {
    fn validate(&self) -> Result<(), String> {
        if self.action == Action::Follow {
            if self.harnesses.is_empty()
                || self.harnesses.len() > 2
                || (self.harnesses.len() == 2 && self.harnesses[0] == self.harnesses[1])
            {
                return Err("Choose Claude Code, Codex, or both.".into());
            }
        } else if !self.harnesses.is_empty() {
            return Err("Harness selection is only used for follow.".into());
        }
        Ok(())
    }
    fn disclosure(&self) -> String {
        match self.action {
            Action::Follow=>format!("Follow {} for this companion? Read recent visible messages from new or changed sessions across the selected profiles, and use them in chat with this companion's current model. Shared excerpts may remain in provider/harness chat history. Following resumes when Polyphonic opens until you pause or change it. No old-history import, Brain connection, raw archive, note retention, browser access, or background work is enabled.",self.harnesses.iter().map(|h|h.label()).collect::<Vec<_>>().join(" and ")),
            Action::ResumeAwareness=>"Resume this companion's previously approved awareness sources and their saved sharing choices? No new sources or permissions will be added. Background work stays paused.".into(),
            Action::EnableBackground=>"Allow bounded background work and local creations for this companion while this Mac is available? This uses the current harness subscription. It does not add observation sources, external posting, or broader tool access.".into(),
            Action::ResumeBackground=>"Resume this companion's previously approved background work and its saved limits? No additional sources or capabilities will be enabled.".into(),
            _=>"Pause or disable the requested companion feature.".into(),
        }
    }
}

fn transcript_root(
    home: &Path,
    harness: Harness,
    configured: Option<&str>,
) -> Result<PathBuf, String> {
    let base = match configured {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => home.join(match harness {
            Harness::ClaudeCode => ".claude",
            Harness::Codex => ".codex",
        }),
    };
    if !base.is_absolute() {
        return Err(
            "The configured harness location is unusual. Choose its profile in advanced controls."
                .into(),
        );
    }
    let root = base.join(match harness {
        Harness::ClaudeCode => "projects",
        Harness::Codex => "sessions",
    });
    let metadata=std::fs::symlink_metadata(&root).map_err(|_|format!("{} history was not found. Start a session in that harness, or choose its profile in advanced controls.",harness.label()))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("This profile needs an explicit selection in advanced controls.".into());
    }
    root.canonicalize()
        .map_err(|_| "The harness profile is unavailable.".into())
}
fn err(error: AwarenessStoreError) -> String {
    error.to_string()
}

// Discovery is metadata-only and reports each requested harness separately.
// One unavailable installation must not prevent another from being reviewed.
fn discover_profiles(
    home: &Path,
    harnesses: &[Harness],
    mut configured: impl FnMut(Harness) -> Option<String>,
) -> (Vec<(Harness, PathBuf)>, Vec<Value>) {
    let mut roots = Vec::new();
    let mut unavailable = Vec::new();
    for harness in harnesses {
        match transcript_root(home, *harness, configured(*harness).as_deref()) {
            Ok(root) => roots.push((*harness, root)),
            Err(message) => {
                unavailable.push(json!({"harness":harness,"status":"incomplete","message":message}))
            }
        }
    }
    (roots, unavailable)
}

fn expected_revision(revision: SafeU53) -> Option<SafeU53> {
    // Revision zero describes an absent resident row, not a stored revision.
    (revision.get() > 0).then_some(revision)
}

/// Called only by the conversation capability broker. Opening a settings page
/// is never required. The returned receipt is actual state, not model optimism.
pub(crate) fn configure(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    if arguments.get("action").and_then(Value::as_str) == Some("pause_notes") {
        return super::companion_note_controls::pause(app, scope, arguments, cancelled);
    }
    if arguments.get("action").and_then(Value::as_str) == Some("remember_note") {
        return super::companion_notes::configure(app, scope, arguments, cancelled);
    }
    if arguments.get("action").and_then(Value::as_str) == Some("meeting_progress") {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct ProgressRequest {
            action: String,
            #[serde(default)]
            harnesses: Vec<Harness>,
            guidance: crate::luca::first_meeting::GuidanceUpdate,
        }
        let request: ProgressRequest = serde_json::from_value(arguments)
            .map_err(|_| "Invalid first-meeting progress request.")?;
        if request.action != "meeting_progress" || !request.harnesses.is_empty() || cancelled() {
            return Err("First-meeting bookkeeping cannot configure harnesses.".into());
        }
        return crate::luca::first_meeting::update_guidance(app, &scope, request.guidance)
            .map(|receipt| receipt.to_string());
    }
    if arguments.get("action").and_then(Value::as_str) == Some("setup") {
        return super::companion_setup::configure(app, scope, arguments, cancelled);
    }
    let mut request: Request = serde_json::from_value(arguments)
        .map_err(|_| "Invalid companion configuration request.")?;
    request.validate()?;
    verify_origin(app, &scope)?;
    let target = FollowTarget::from(&scope);
    let state = app.state::<AppState>();
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Home folder unavailable.")?;
    let execution_scope = crate::luca::companion_initiative::host_scope::home_scope(
        &state,
        &scope.owner,
        &scope.resident,
    )
    .map_err(|e| format!("companion control: {e:?}"))?;
    let denial_generation = state
        .companion_execution
        .denial_generation(&execution_scope)
        .map_err(|e| format!("companion control: {e:?}"))?;
    // Metadata only. No transcript enumeration or reads occur before approval.
    let (roots, unavailable) = discover_profiles(&home, &request.harnesses, |h| {
        std::env::var(match h {
            Harness::ClaudeCode => "CLAUDE_CONFIG_DIR",
            Harness::Codex => "CODEX_HOME",
        })
        .ok()
    });
    if request.action == Action::Follow {
        if roots.is_empty() {
            return Ok(json!({"status":"incomplete","results":unavailable,
                "message":"No available profiles were found. Nothing changed. Start a session in the requested harness or use advanced controls for a custom installation."}).to_string());
        }
        // Name only detected profiles in the approval. Missing profiles are
        // returned as incomplete, never silently granted or called connected.
        request.harnesses = roots.iter().map(|(harness, _)| *harness).collect();
    }
    if request.action == Action::Follow
        && roots
            .iter()
            .all(|(h, root)| already_following(&state, &target, *h, root))
    {
        return Ok(json!({"status":if unavailable.is_empty() {"already_following"} else {"incomplete"},"harnesses":request.harnesses,"results":unavailable,
            "message":"These profiles are already being followed with the approved sharing choices. Nothing was changed."}).to_string());
    }
    let follow_states = roots
        .iter()
        .map(|(harness, root)| follow_expected(&state, &target, *harness, root))
        .collect::<Result<Vec<_>, _>>()?;
    let widening = matches!(
        request.action,
        Action::Follow
            | Action::ResumeAwareness
            | Action::EnableBackground
            | Action::ResumeBackground
    );
    if widening {
        let before_review = approval_state(&state, &target, request.action)?;
        let fingerprint = Sha256Ref::parse(format!(
            "sha256:{}",
            canonical_sha256(&json!([
                "companion-setup-v1",
                scope.resident,
                scope.binding,
                request,
                roots.iter().map(|(_, p)| p).collect::<Vec<_>>()
            ]))
            .map_err(|_| "Invalid setup request.")?
        ))
        .map_err(|_| "Invalid setup fingerprint.")?;
        let permission = ManagedPermissionRequestV2 {
            protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
            resident_pubkey: scope.resident.clone(),
            session_epoch: scope.session_epoch,
            turn_id: id("companion-turn")?,
            conversation_id: scope.conversation.clone(),
            request_id: id("companion-review")?,
            capability: CapabilityKind::HarnessManage,
            risk: CapabilityRisk::HighImpact,
            operation: request.disclosure(),
            operation_fingerprint: fingerprint,
            resource: CapabilityResourceV1 {
                kind: "companion_setup".into(),
                resource_ref: scope.resident.as_str().into(),
                display_name: "Companion permissions".into(),
            },
        };
        permission
            .validate()
            .map_err(|_| "Invalid companion permission disclosure.")?;
        let decision =
            await_capability_decision_cancellable(app, scope.owner.as_str(), permission, || {
                !scope.active.load(Ordering::SeqCst) || cancelled()
            });
        if decision == CapabilityPermissionDecision::Deny {
            return Ok(json!({"status":"not_changed","message":"The request was declined, cancelled, or expired. No setup was applied."}).to_string());
        }
        // A settings change made while the review was open wins over this
        // request. Never silently undo a user's intervening Pause or withdrawal.
        if approval_state(&state, &target, request.action)? != before_review {
            return Ok(json!({"status":"not_changed","message":"Companion settings changed while approval was open. No setup was applied; ask again if you still want this change."}).to_string());
        }
    }
    if cancelled() {
        return Err("Configuration cancelled before application.".into());
    }
    verify_origin(app, &scope)?;
    let mut results = unavailable;
    match request.action {
        Action::Follow => {
            let mut owned_resume = None;
            for ((harness, root), mut expected) in roots.into_iter().zip(follow_states) {
                if cancelled() {
                    return Ok(json!({"status":"interrupted","results":results,"message":"Setup stopped. Only the completed entries were applied."}).to_string());
                }
                verify_origin(app, &scope)?;
                // Only our first successful follow may advance the shared
                // paused-state CAS base for a second approved harness.
                expected.after_owned_resume(owned_resume);
                match follow_approved(app, &target, harness, root, &expected) {
                    Ok(resumed) => {
                        if resumed.is_some() {
                            owned_resume = resumed;
                        }
                        results.push(json!({"harness":harness,"status":"following","message":"Following new and changed sessions; recent visible excerpts can inform our conversation."}));
                    }
                    Err(error) => results
                        .push(json!({"harness":harness,"status":"incomplete","message":error})),
                }
            }
        }
        Action::PauseAwareness | Action::ResumeAwareness => {
            let current = state
                .companion_awareness
                .resident_state(&scope.owner, &scope.resident)
                .map_err(err)?;
            let receipt = super::companion::set_awareness_paused(
                app,
                scope.resident.as_str(),
                request.action == Action::PauseAwareness,
                current.revision.get(),
                id("companion-control")?.as_str(),
            )?;
            results.push(
                serde_json::to_value(receipt).map_err(|_| "Could not encode saved settings.")?,
            );
        }
        _ => {
            let home = crate::luca::companion_initiative::host_scope::home_scope(
                &state,
                &scope.owner,
                &scope.resident,
            )
            .map_err(|e| format!("companion initiative: {e:?}"))?;
            let current = state
                .companion_initiative
                .with_control(&home, |store| store.policy(&home))
                .map_err(|e| format!("companion initiative: {e:?}"))?;
            if request.action == Action::ResumeBackground && !current.enabled {
                return Err(
                    "Background work has not been enabled. Ask whether to enable it first.".into(),
                );
            }
            let input=serde_json::from_value(json!({"enabled":request.action!=Action::DisableBackground && (current.enabled||request.action==Action::EnableBackground),
                "paused":matches!(request.action,Action::PauseBackground|Action::DisableBackground),
                "allowOutreach":false,"allowLocalCreations":current.allow_local_creations||request.action==Action::EnableBackground,
                "expectedRevision":current.revision.get(),"requestId":id("companion-work")?})).map_err(|_|"Invalid background policy.")?;
            let receipt = super::companion_initiative::set_reviewed_companion_initiative_policy(
                scope.resident.as_str().into(),
                input,
                app.clone(),
                Some(denial_generation),
            )?;
            results.push(
                serde_json::to_value(receipt).map_err(|_| "Could not encode saved settings.")?,
            );
        }
    }
    Ok(json!({"status":if results.iter().any(|r|r["status"]=="incomplete") {"incomplete"} else {"applied"},"action":request.action,"results":results,
        "message":"Report only the applied changes briefly in chat. Do not open a settings page. Advanced controls remain available on request."}).to_string())
}

pub(super) fn follow_approved(
    app: &AppHandle,
    scope: &FollowTarget,
    harness: Harness,
    root: PathBuf,
    expected: &FollowExpected,
) -> Result<Option<(SafeU53, SafeU53)>, String> {
    follow_with_notes_approved(app, scope, harness, root, expected, false)
}

/// Only a reviewed setup may add note retention; ordinary Follow preserves it.
pub(super) fn follow_with_notes_approved(
    app: &AppHandle,
    scope: &FollowTarget,
    harness: Harness,
    root: PathBuf,
    expected: &FollowExpected,
    keep_notes: bool,
) -> Result<Option<(SafeU53, SafeU53)>, String> {
    let state = app.state::<AppState>();
    if &follow_expected(&state, scope, harness, &root)? != expected {
        return Err("Companion permissions changed. Review this choice again.".into());
    }
    // Preserve only a still-current explicit note choice. Legacy promotion
    // alone is not semantic memory consent, even when Follow is already on.
    let notes_were_allowed = state.companion_awareness.recheck_semantic_note_choice(
        &scope.owner, &expected.key, &scope.binding,
    ).is_ok();
    if already_following(&state, scope, harness, &root) && (!keep_notes || notes_were_allowed) {
        return Ok(None);
    }
    let live = LiveAwarenessOwner::authenticate(&state).map_err(err)?;
    if live.owner() != &scope.owner {
        return Err("The active owner changed.".into());
    }
    if crate::luca::managed_cognition::active_binding_ref(&scope.resident)
        .ok()
        .as_ref()
        != Some(&scope.binding)
        || crate::luca::managed_cognition::active_session_epoch(&scope.resident).ok()
            != Some(scope.session_epoch)
    {
        return Err("The companion runtime changed. Review this choice again.".into());
    }
    let class = NativeProfileObservationClassV1::VisibleExcerpts;
    let key = expected.key.clone();
    let selection =
        NativeProfileSelectionV1::new(key.clone(), root, harness.kind(), class).map_err(err)?;
    // Reuse an advanced selection's private metadata instead of overwriting it.
    if !state
        .companion_sources
        .list_profiles(&scope.owner, &scope.resident)
        .map_err(err)?
        .iter()
        .any(|p| p.selection == selection)
    {
        state
            .companion_sources
            .select_profile(
                &live,
                NativeProfileRegistrationV1 {
                    selection: selection.clone(),
                    profile_config: None,
                    follow_on_launch: false,
                },
            )
            .map_err(err)?;
    }
    match state
        .companion_awareness
        .source_snapshot(&scope.owner, &key.source)
    {
        Ok(_) => {}
        Err(AwarenessStoreError::Missing) => {
            state
                .companion_awareness
                .register_source(&live, &key.source, &id("follow-register")?)
                .map_err(err)?;
        }
        Err(e) => return Err(err(e)),
    }
    let result = (|| {
        super::companion_sources::put_choices_bound(
            &state,
            &live,
            &key,
            expected.grant_revision,
            &super::companion_sources::CompanionSourceChoicesInputV1 {
                observe: true,
                promote: expected.promote || keep_notes,
                provider_egress: true,
                retain_raw: false,
            },
            &id("follow-grant")?,
            &scope.binding,
            expected
                .deny_epoch
                .unwrap_or(SafeU53::new(0).map_err(|_| "Invalid source epoch.")?),
        )?;
        let (history, _) = state
            .companion_awareness
            .set_native_history_choice(
                &scope.owner,
                &key,
                Some(&live),
                expected.history_revision,
                true,
                Some(&scope.binding),
                &current_canonical_timestamp()?,
                &id("follow-history")?,
            )
            .map_err(err)?;
        if keep_notes || notes_were_allowed {
            state.companion_awareness.set_semantic_note_choice(
                &scope.owner, &key, Some(&live), history.revision, true,
                Some(&scope.binding), &current_canonical_timestamp()?, &id("follow-notes")?,
            ).map_err(err)?;
        }
        let resident = state
            .companion_awareness
            .resident_state(&scope.owner, &scope.resident)
            .map_err(err)?;
        if resident.revision != expected.resident_revision || resident.paused != expected.paused {
            return Err(
                "Companion awareness changed during setup. Review this choice again.".into(),
            );
        }
        let resumed = if expected.paused {
            // Resume only the requested feed, not every previously paused source.
            let receipt = state
                .companion_awareness
                .set_paused(
                    &scope.owner,
                    &scope.resident,
                    Some(&live),
                    expected_revision(expected.resident_revision),
                    false,
                    &current_canonical_timestamp()?,
                    &id("follow-resume")?,
                )
                .map_err(err)?;
            Some((
                expected.resident_revision,
                receipt
                    .resident_revision
                    .ok_or("Missing awareness revision.")?,
            ))
        } else {
            None
        };
        state
            .companion_sources
            .resume_profile(&live, selection.clone())
            .map_err(err)?;
        let snapshot = state
            .companion_sources
            .snapshot(
                &scope.owner,
                &scope.resident,
                &current_canonical_timestamp()?,
            )
            .map_err(err)?;
        if !snapshot.collecting.contains(&key) {
            return Err(
                "Permissions saved, but the activity watcher did not start. Ask me to retry."
                    .into(),
            );
        }
        let mut registration = state
            .companion_sources
            .list_profiles(&scope.owner, &scope.resident)
            .map_err(err)?
            .into_iter()
            .find(|p| p.selection == selection)
            .ok_or("The selected profile is no longer available.")?;
        registration.follow_on_launch = true;
        state
            .companion_sources
            .select_profile(&live, registration)
            .map_err(err)?;
        let _ = state.companion_coordinator.foreground_activity(app);
        Ok(resumed)
    })();
    if result.is_err() {
        let _ = state
            .companion_sources
            .after_grant_withdrawal(&scope.owner, &key);
    }
    result
}
pub(super) fn already_following(
    state: &AppState,
    scope: &FollowTarget,
    harness: Harness,
    root: &Path,
) -> bool {
    (|| -> Result<bool, AwarenessStoreError> {
        if state
            .companion_awareness
            .resident_state(&scope.owner, &scope.resident)?
            .paused
        {
            return Ok(false);
        }
        let device = state.companion_awareness.device(&scope.owner)?;
        let source = NativeProfileSelectionV1::source_id_for_selection(
            &scope.owner,
            &scope.resident,
            &device,
            root,
            harness.kind(),
            NativeProfileObservationClassV1::VisibleExcerpts,
        )?;
        let key = AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 {
                owner_pubkey: scope.owner.clone(),
                source_id: source,
                device_id: device,
            },
            resident_pubkey: scope.resident.clone(),
        };
        state.companion_awareness.recheck_native_history_choice(
            &scope.owner,
            &key,
            &scope.binding,
        )?;
        if !state
            .companion_sources
            .list_profiles(&scope.owner, &scope.resident)?
            .iter()
            .any(|p| p.selection.grant_key() == &key && p.follow_on_launch)
        {
            return Ok(false);
        }
        let now = current_canonical_timestamp().map_err(|_| AwarenessStoreError::Unavailable)?;
        Ok(state
            .companion_sources
            .snapshot(&scope.owner, &scope.resident, &now)?
            .collecting
            .contains(&key))
    })()
    .unwrap_or(false)
}
pub(super) fn id(prefix: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(format!("{prefix}-{}", uuid::Uuid::new_v4()))
        .map_err(|_| "Invalid operation identifier.".into())
}

/// Body-free comparison across a permission wait; source health changes do not
/// invalidate consent, but owner control/grant/history revisions do.
fn approval_state(
    state: &AppState,
    scope: &FollowTarget,
    action: Action,
) -> Result<String, String> {
    let value = if matches!(action, Action::Follow | Action::ResumeAwareness) {
        let resident = state
            .companion_awareness
            .resident_state(&scope.owner, &scope.resident)
            .map_err(err)?;
        let grants = state
            .companion_awareness
            .list_grants(&scope.owner, &scope.resident, 64)
            .map_err(err)?;
        if grants.truncated {
            return Err(
                "Use advanced controls to review this unusually large source collection.".into(),
            );
        }
        let mut choices = Vec::new();
        for entry in grants.entries {
            let key = AwarenessGrantKeyV1 {
                source: AwarenessSourceKeyV1 {
                    owner_pubkey: scope.owner.clone(),
                    source_id: entry.grant.source_id.clone(),
                    device_id: entry.grant.device_id.clone(),
                },
                resident_pubkey: scope.resident.clone(),
            };
            let history = state
                .companion_awareness
                .native_history_choice(&scope.owner, &key)
                .map_err(err)?;
            choices.push(json!([
                entry.grant.source_id,
                entry.grant.grant_revision,
                entry.grant.deny_epoch,
                history.map(|c| c.revision)
            ]));
        }
        choices.sort_by_cached_key(Value::to_string);
        json!([resident.revision, resident.paused, choices])
    } else {
        let home = crate::luca::companion_initiative::host_scope::home_scope(
            state,
            &scope.owner,
            &scope.resident,
        )
        .map_err(|e| format!("companion initiative: {e:?}"))?;
        let policy = state
            .companion_initiative
            .with_control(&home, |store| store.policy(&home))
            .map_err(|e| format!("companion initiative: {e:?}"))?;
        json!(policy.revision)
    };
    canonical_sha256(&value).map_err(|_| "Companion settings could not be checked.".into())
}

/// Freeze both awareness and initiative controls across the combined review.
pub(super) fn setup_approval_state(
    state: &AppState,
    scope: &FollowTarget,
) -> Result<String, String> {
    canonical_sha256(&json!([
        approval_state(state, scope, Action::Follow)?,
        approval_state(state, scope, Action::EnableBackground)?
    ]))
    .map_err(|_| "Companion settings could not be checked.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_is_small_and_cannot_supply_paths_or_grants() {
        for value in [
            json!({"action":"follow","harnesses":["claude_code","codex"]}),
            json!({"action":"pause_awareness"}),
        ] {
            serde_json::from_value::<Request>(value)
                .unwrap()
                .validate()
                .unwrap();
        }
        for value in [
            json!({"action":"follow","harnesses":[]}),
            json!({"action":"follow","harnesses":["codex","codex"]}),
            json!({"action":"pause_awareness","harnesses":["codex"]}),
        ] {
            assert!(serde_json::from_value::<Request>(value)
                .unwrap()
                .validate()
                .is_err());
        }
        assert!(serde_json::from_value::<Request>(
            json!({"action":"follow","harnesses":["codex"],"path":"/private"})
        )
        .is_err());
    }
    #[test]
    fn detects_only_selected_default_container_without_reading_history() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".claude/projects")).unwrap();
        assert!(transcript_root(dir.path(), Harness::ClaudeCode, None)
            .unwrap()
            .ends_with(".claude/projects"));
        assert!(transcript_root(dir.path(), Harness::Codex, None).is_err());
        assert!(transcript_root(dir.path(), Harness::ClaudeCode, Some("relative")).is_err());
    }
    #[test]
    fn discovery_keeps_available_profiles_and_reports_missing_harnesses() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(".claude/projects")).unwrap();
        let (roots, missing) =
            discover_profiles(dir.path(), &[Harness::ClaudeCode, Harness::Codex], |_| None);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].0, Harness::ClaudeCode);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0]["harness"], "codex");
        assert_eq!(missing[0]["status"], "incomplete");
        let (roots, missing) = discover_profiles(dir.path(), &[Harness::Codex], |_| None);
        assert!(roots.is_empty());
        assert_eq!(missing.len(), 1);
    }
    #[test]
    fn first_follow_uses_absent_row_revision_without_weakening_later_cas() {
        assert_eq!(expected_revision(SafeU53::new(0).unwrap()), None);
        assert_eq!(
            expected_revision(SafeU53::new(1).unwrap()).map(SafeU53::get),
            Some(1),
        );
        assert_eq!(
            expected_revision(SafeU53::new(9).unwrap()).map(SafeU53::get),
            Some(9),
        );
    }
    #[test]
    fn approval_snapshot_changes_after_pause_grant_or_history_changes() {
        use crate::luca::companion_awareness::selected_files::tests::{
            id as fixture_id, now, Fixture,
        };
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        let runtime = &fixture.state.companion_awareness;
        runtime.initialize(&fixture.root, Some(live.owner()));
        let target = FollowTarget {
            owner: live.owner().clone(),
            resident: fixture.resident.clone(),
            binding: Sha256Ref::parse(format!("sha256:{}", "ab".repeat(32))).unwrap(),
            session_epoch: SafeU53::new(1).unwrap(),
        };
        let before = follow_approval_state(&fixture.state, &target).unwrap();
        let key = fixture.grant(fixture_id("review-source"), true);
        let after_grant = follow_approval_state(&fixture.state, &target).unwrap();
        assert_ne!(before, after_grant);
        runtime
            .set_native_history_choice(
                live.owner(),
                &key,
                None,
                SafeU53::new(0).unwrap(),
                false,
                None,
                &now(),
                &fixture_id("review-history-off"),
            )
            .unwrap();
        let after_history = follow_approval_state(&fixture.state, &target).unwrap();
        assert_ne!(after_grant, after_history);
        let resident = runtime
            .resident_state(live.owner(), &fixture.resident)
            .unwrap();
        runtime
            .set_paused(
                live.owner(),
                &fixture.resident,
                None,
                expected_revision(resident.revision),
                true,
                &now(),
                &fixture_id("review-pause"),
            )
            .unwrap();
        assert_ne!(
            after_history,
            follow_approval_state(&fixture.state, &target).unwrap()
        );
    }
    #[test]
    fn dual_follow_carries_only_its_own_exact_resume_revision() {
        use crate::luca::companion_awareness::selected_files::tests::Fixture;
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        fixture
            .state
            .companion_awareness
            .initialize(&fixture.root, Some(live.owner()));
        let target = FollowTarget {
            owner: live.owner().clone(),
            resident: fixture.resident.clone(),
            binding: Sha256Ref::parse(format!("sha256:{}", "ab".repeat(32))).unwrap(),
            session_epoch: SafeU53::new(1).unwrap(),
        };
        let mut second =
            follow_expected(&fixture.state, &target, Harness::Codex, &fixture.root).unwrap();
        second.paused = true;
        second.resident_revision = SafeU53::new(3).unwrap();
        let original = second.clone();
        second.after_owned_resume(Some((SafeU53::new(2).unwrap(), SafeU53::new(3).unwrap())));
        assert_eq!(second, original, "a different revision must not be adopted");
        second.after_owned_resume(Some((SafeU53::new(3).unwrap(), SafeU53::new(4).unwrap())));
        assert!(!second.paused);
        assert_eq!(second.resident_revision.get(), 4);
        assert_eq!(second.grant_revision, original.grant_revision);
        assert_eq!(second.history_revision, original.history_revision);
        assert_eq!(second.deny_epoch, original.deny_epoch);
        // A subsequent owner Pause would have a newer revision; only 4 is the
        // approved base, so both the entry comparison and resume CAS reject it.
        let after_first = second.clone();
        second.after_owned_resume(Some((SafeU53::new(4).unwrap(), SafeU53::new(5).unwrap())));
        assert_eq!(
            second, after_first,
            "already-resumed state is never rebased"
        );
    }
    #[test]
    fn consent_discloses_destination_and_does_not_bundle_unrelated_access() {
        let request = Request {
            action: Action::Follow,
            harnesses: vec![Harness::ClaudeCode, Harness::Codex],
        };
        let copy = request.disclosure();
        assert!(copy.contains("Claude Code and Codex"));
        assert!(copy.contains("provider/harness chat history"));
        assert!(copy.contains("No old-history import"));
        assert!(copy.len() <= 512);
        for action in [
            Action::Follow,
            Action::ResumeAwareness,
            Action::EnableBackground,
            Action::ResumeBackground,
        ] {
            let request = Request {
                action,
                harnesses: vec![Harness::ClaudeCode, Harness::Codex],
            };
            ManagedPermissionRequestV2 {
                protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
                resident_pubkey: luca_protocol::Hex64::parse("ab".repeat(32)).unwrap(),
                session_epoch: SafeU53::new(1).unwrap(),
                turn_id: id("test-turn").unwrap(),
                conversation_id: id("test-conversation").unwrap(),
                request_id: id("test-request").unwrap(),
                capability: CapabilityKind::HarnessManage,
                risk: CapabilityRisk::HighImpact,
                operation: request.disclosure(),
                operation_fingerprint: Sha256Ref::parse(format!("sha256:{}", "ab".repeat(32)))
                    .unwrap(),
                resource: CapabilityResourceV1 {
                    kind: "companion_setup".into(),
                    resource_ref: "companion".into(),
                    display_name: "Companion permissions".into(),
                },
            }
            .validate()
            .unwrap();
        }
    }
}

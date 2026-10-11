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
    canonical_sha256, CapabilityKind, CapabilityResourceV1, CapabilityRisk,
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
enum Harness {
    ClaudeCode,
    Codex,
}
impl Harness {
    fn kind(self) -> NativeProfileKindV1 {
        match self {
            Self::ClaudeCode => NativeProfileKindV1::ClaudeProjects,
            Self::Codex => NativeProfileKindV1::CodexSessions,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::ClaudeCode => "Claude Code",
            Self::Codex => "Codex",
        }
    }
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

/// Called only by the conversation capability broker. Opening a settings page
/// is never required. The returned receipt is actual state, not model optimism.
pub(crate) fn configure(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let request: Request = serde_json::from_value(arguments)
        .map_err(|_| "Invalid companion configuration request.")?;
    request.validate()?;
    verify_origin(app, &scope)?;
    let state = app.state::<AppState>();
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Home folder unavailable.")?;
    // Metadata only. No transcript enumeration or reads occur before approval.
    let roots = request
        .harnesses
        .iter()
        .map(|h| {
            let configured = std::env::var(match h {
                Harness::ClaudeCode => "CLAUDE_CONFIG_DIR",
                Harness::Codex => "CODEX_HOME",
            })
            .ok();
            transcript_root(&home, *h, configured.as_deref()).map(|p| (*h, p))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if request.action == Action::Follow
        && roots
            .iter()
            .all(|(h, root)| already_following(&state, &scope, *h, root))
    {
        return Ok(json!({"status":"already_following","harnesses":request.harnesses,
            "message":"These profiles are already being followed with the approved sharing choices. Nothing was changed."}).to_string());
    }
    let widening = matches!(
        request.action,
        Action::Follow
            | Action::ResumeAwareness
            | Action::EnableBackground
            | Action::ResumeBackground
    );
    if widening {
        let before_review = approval_state(&state, &scope, request.action)?;
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
        if approval_state(&state, &scope, request.action)? != before_review {
            return Ok(json!({"status":"not_changed","message":"Companion settings changed while approval was open. No setup was applied; ask again if you still want this change."}).to_string());
        }
    }
    if cancelled() {
        return Err("Configuration cancelled before application.".into());
    }
    verify_origin(app, &scope)?;
    let mut results = Vec::new();
    match request.action {
        Action::Follow => {
            for (harness, root) in roots {
                if cancelled() {
                    return Ok(json!({"status":"interrupted","results":results,"message":"Setup stopped. Only the completed entries were applied."}).to_string());
                }
                verify_origin(app, &scope)?;
                match follow(app,&scope,harness,root) {
                    Ok(())=>results.push(json!({"harness":harness,"status":"following","message":"Following new and changed sessions; recent visible excerpts can inform our conversation."})),
                    Err(error)=>results.push(json!({"harness":harness,"status":"incomplete","message":error})),
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
            let receipt = super::companion_initiative::set_companion_initiative_policy(
                scope.resident.as_str().into(),
                input,
                app.clone(),
            )?;
            results.push(
                serde_json::to_value(receipt).map_err(|_| "Could not encode saved settings.")?,
            );
        }
    }
    Ok(json!({"status":if results.iter().any(|r|r["status"]=="incomplete") {"incomplete"} else {"applied"},"action":request.action,"results":results,
        "message":"Report only the applied changes briefly in chat. Do not open a settings page. Advanced controls remain available on request."}).to_string())
}

fn follow(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    harness: Harness,
    root: PathBuf,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    if already_following(&state, scope, harness, &root) {
        return Ok(());
    }
    let live = LiveAwarenessOwner::authenticate(&state).map_err(err)?;
    if live.owner() != &scope.owner {
        return Err("The active owner changed.".into());
    }
    let device = state
        .companion_awareness
        .device(&scope.owner)
        .map_err(err)?;
    let class = NativeProfileObservationClassV1::VisibleExcerpts;
    let source = NativeProfileSelectionV1::source_id_for_selection(
        &scope.owner,
        &scope.resident,
        &device,
        &root,
        harness.kind(),
        class,
    )
    .map_err(err)?;
    let key = AwarenessGrantKeyV1 {
        source: AwarenessSourceKeyV1 {
            owner_pubkey: scope.owner.clone(),
            source_id: source,
            device_id: device,
        },
        resident_pubkey: scope.resident.clone(),
    };
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
        let prior = match state.companion_awareness.snapshot(&scope.owner, &key) {
            Ok(s) => Some(s.grant),
            Err(AwarenessStoreError::Missing) => None,
            Err(e) => return Err(err(e)),
        };
        super::companion_sources::put_choices(
            &state,
            &live,
            &key,
            prior.as_ref().map(|grant| grant.grant_revision),
            &super::companion_sources::CompanionSourceChoicesInputV1 {
                observe: true,
                promote: prior.as_ref().is_some_and(|grant| {
                    grant.state == luca_protocol::AwarenessGrantStateV1::Active
                        && grant.choices.promote
                }),
                provider_egress: true,
                retain_raw: false,
            },
            &id("follow-grant")?,
        )?;
        let old = state
            .companion_awareness
            .native_history_choice(&scope.owner, &key)
            .map_err(err)?;
        state
            .companion_awareness
            .set_native_history_choice(
                &scope.owner,
                &key,
                Some(&live),
                old.map_or(
                    SafeU53::new(0).map_err(|_| "Invalid history revision.")?,
                    |c| c.revision,
                ),
                true,
                Some(&scope.binding),
                &current_canonical_timestamp()?,
                &id("follow-history")?,
            )
            .map_err(err)?;
        let resident = state
            .companion_awareness
            .resident_state(&scope.owner, &scope.resident)
            .map_err(err)?;
        if resident.paused {
            // Resume only the requested feed, not every previously paused source.
            state
                .companion_awareness
                .set_paused(
                    &scope.owner,
                    &scope.resident,
                    Some(&live),
                    Some(resident.revision),
                    false,
                    &current_canonical_timestamp()?,
                    &id("follow-resume")?,
                )
                .map_err(err)?;
        }
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
        Ok(())
    })();
    if result.is_err() {
        let _ = state
            .companion_sources
            .after_grant_withdrawal(&scope.owner, &key);
    }
    result
}
fn already_following(
    state: &AppState,
    scope: &ResidentProposalScope,
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
fn id(prefix: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(format!("{prefix}-{}", uuid::Uuid::new_v4()))
        .map_err(|_| "Invalid operation identifier.".into())
}

/// Body-free comparison across a permission wait; source health changes do not
/// invalidate consent, but owner control/grant/history revisions do.
fn approval_state(
    state: &AppState,
    scope: &ResidentProposalScope,
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

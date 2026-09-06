//! Owner-selected existing Hermes imports shared by ordinary and conversational reviews.

use super::*;

mod direct;
pub use direct::*;

/// Exact discovery and effects selected in the owner review.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeImportSelectionV1 {
    pub(super) semantic_id: String,
    pub(super) binding_fingerprint: String,
    pub(super) start_now: bool,
    pub(super) start_on_app_launch: bool,
    pub(super) continuity_enabled: bool,
}

#[derive(Clone)]
pub(super) struct NativeImportAttempt {
    pub(super) selection: NativeImportSelectionV1,
    pub(super) profile_name: String,
    pub(super) resident_pubkey: Option<String>,
    pub(super) reused: Option<bool>,
    pub(super) busy: bool,
    pub(super) startup_error: Option<String>,
    pub(super) warning: Option<String>,
    pub(super) preferences_applied: bool,
    pub(super) preferences_error: Option<String>,
}

/// Public facts about the host-correlated imported resident.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImportResultV1 {
    pub(super) resident_pubkey: String,
    pub(super) display_name: String,
    pub(super) native_profile_name: String,
    pub(super) reused: bool,
    pub(super) process_running: bool,
    pub(super) authenticated_ready: bool,
    pub(super) startup_error: Option<String>,
    pub(super) warning: Option<String>,
    pub(super) preferences_error: Option<String>,
}

pub(super) fn select_import_candidate(
    profile_name: &str,
    selection: &NativeImportSelectionV1,
    candidates: Vec<crate::managed_agents::DiscoveredResidentCandidate>,
) -> Result<crate::managed_agents::DiscoveredResidentCandidate, String> {
    let mut matching = candidates.into_iter().filter(|candidate| {
        candidate.native_type == crate::managed_agents::NativeRuntimeKind::Hermes
            && candidate.semantic_id == selection.semantic_id
    });
    let candidate = matching
        .next()
        .ok_or("That Hermes profile is no longer discoverable. Scan again before a new review.")?;
    if matching.next().is_some()
        || candidate.native_id != profile_name.trim().to_ascii_lowercase()
        || candidate.binding_fingerprint != selection.binding_fingerprint
        || matches!(
            candidate.readiness,
            crate::managed_agents::ResidentReadiness::Unavailable { .. }
        )
    {
        return Err(
            "The selected Hermes profile changed or is ambiguous. Review its exact location again."
                .into(),
        );
    }
    Ok(candidate)
}

fn current_import_candidate(
    attempt: &NativeImportAttempt,
) -> Result<crate::managed_agents::DiscoveredResidentCandidate, String> {
    select_import_candidate(
        &attempt.profile_name,
        &attempt.selection,
        crate::managed_agents::discover_native_resident_candidates(),
    )
}

pub(super) fn select_imported_pubkey(
    bindings: impl IntoIterator<Item = (String, String)>,
    attempt: &NativeImportAttempt,
) -> Result<String, String> {
    let matches: Vec<_> = bindings
        .into_iter()
        .filter(|(_, identity)| identity == &attempt.selection.semantic_id)
        .collect();
    if matches.len() != 1 {
        return Err("The exact Hermes profile must resolve to one saved resident. Inspect Agents before another import.".into());
    }
    let pubkey = matches[0].0.clone();
    if attempt
        .resident_pubkey
        .as_ref()
        .is_some_and(|expected| expected != &pubkey)
    {
        return Err("The saved resident identity no longer matches this import request.".into());
    }
    Ok(pubkey)
}

pub(super) fn import_result(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    attempt: &NativeImportAttempt,
) -> Result<NativeImportResultV1, String> {
    import_result_for_owner(app, &scope.owner, attempt)
}

fn import_result_for_owner(
    app: &AppHandle,
    owner: &Hex64,
    attempt: &NativeImportAttempt,
) -> Result<NativeImportResultV1, String> {
    current_import_candidate(attempt)?;
    let state = app.state::<crate::app_state::AppState>();
    let pubkey = {
        let _guard = state
            .managed_agents_store_lock
            .lock()
            .map_err(|_| "Resident storage is unavailable.")?;
        let records = crate::managed_agents::load_managed_agents(app)?;
        if records
            .iter()
            .filter_map(|record| record.native_runtime_binding.as_ref())
            .any(|binding| {
                crate::managed_agents::native_runtime_semantic_key(binding)
                    == attempt.selection.semantic_id
                    && crate::managed_agents::native_runtime_binding_fingerprint(binding)
                        != attempt.selection.binding_fingerprint
            })
        {
            return Err("The saved Hermes binding changed after this review.".into());
        }
        select_imported_pubkey(
            records.iter().filter_map(|record| {
                record.native_runtime_binding.as_ref().map(|binding| {
                    (
                        record.pubkey.clone(),
                        crate::managed_agents::native_runtime_semantic_key(binding),
                    )
                })
            }),
            attempt,
        )?
    };
    let key =
        Hex64::parse(pubkey.clone()).map_err(|_| "The imported resident identity is invalid.")?;
    let relay = AppExchangeRelay::new(app.clone());
    if relay
        .owner()
        .map_err(|_| "The current owner is unavailable.")?
        != *owner
        || !relay
            .owned_residents()
            .map_err(|_| "Resident ownership is unavailable.")?
            .contains(&key)
    {
        return Err("The imported resident is not owned by this desktop.".into());
    }
    // Synchronize exited children before reading runtime status. `active` in
    // the registry controls definition visibility and never proves liveness.
    tauri::async_runtime::block_on(crate::commands::list_managed_agents(app.clone()))?;
    let registry = super::super::resident_registry::load_resident_registry(app, &state)?;
    let resident = registry
        .residents
        .iter()
        .find(|record| record.resident_pubkey == key)
        .ok_or("The imported resident is unavailable.")?;
    Ok(project_import_result(resident, attempt))
}

pub(super) fn project_import_result(
    resident: &super::super::resident_registry::ResidentRegistryEntry,
    attempt: &NativeImportAttempt,
) -> NativeImportResultV1 {
    let process_running = resident.status == "running";
    NativeImportResultV1 {
        resident_pubkey: resident.resident_pubkey.as_str().to_owned(),
        display_name: resident.display_name.clone(),
        native_profile_name: attempt.profile_name.clone(),
        reused: attempt.reused.unwrap_or(true),
        process_running,
        authenticated_ready: false,
        startup_error: if process_running {
            None
        } else {
            attempt.startup_error.clone()
        },
        warning: attempt.warning.clone(),
        preferences_error: if attempt.preferences_applied {
            None
        } else {
            Some(attempt.preferences_error.clone().unwrap_or_else(|| "The reviewed settings have not been saved. Retry reviewed settings before starting.".into()))
        },
    }
}

pub(super) fn should_start_import(
    first: bool,
    retry_start: bool,
    attempt: &NativeImportAttempt,
    saved: &NativeImportResultV1,
) -> bool {
    attempt.preferences_applied
        && (first && attempt.selection.start_now || retry_start)
        && !saved.process_running
}

pub(super) fn persist_import_preferences(
    attempt: &mut NativeImportAttempt,
    save_continuity: impl FnOnce(bool) -> Result<(), String>,
    save_launch: impl FnOnce(bool) -> Result<(), String>,
) -> Result<(), String> {
    if attempt.reused == Some(true) || attempt.preferences_applied {
        attempt.preferences_applied = true;
        attempt.preferences_error = None;
        return Ok(());
    }
    let result = if attempt.reused != Some(false) {
        Err("The import save is uncertain. Inspect the saved resident in Agents before another review.".into())
    } else {
        // Creation starts with autostart disabled. The launch preference is
        // written only after the exact continuity consent has persisted.
        save_continuity(attempt.selection.continuity_enabled)
            .and_then(|()| save_launch(attempt.selection.start_on_app_launch))
    };
    attempt.preferences_applied = result.is_ok();
    attempt.preferences_error = result.as_ref().err().cloned();
    result
}

fn authorize_import(app: &AppHandle, request_id: &str) -> Result<ResidentProposalScope, String> {
    let scope = pending_scope(request_id)?;
    verify_origin(app, &scope)?;
    pending_scope(request_id)?;
    Ok(scope)
}

pub(super) fn admit_import(
    proposal: &mut PendingProposal,
    selection: Option<NativeImportSelectionV1>,
    retry_start: bool,
) -> Result<(NativeImportAttempt, bool), String> {
    if proposal.projection.provisioning_intent.as_deref() != Some("import")
        || proposal.projection.runtime_family.as_deref() != Some("hermes")
        || proposal.result.is_some()
        || Instant::now() >= proposal.deadline
        || !proposal.scope.active.load(Ordering::SeqCst)
    {
        return Err("This request cannot import a Hermes profile.".into());
    }
    if let Some(attempt) = &mut proposal.native_import {
        if attempt.busy {
            return Err(
                "The import is still underway. Verify its saved result after it finishes.".into(),
            );
        }
        if selection
            .as_ref()
            .is_some_and(|selected| selected != &attempt.selection)
        {
            return Err(
                "This request is already bound to its reviewed profile and choices.".into(),
            );
        }
        if retry_start && !attempt.selection.start_now {
            return Err("Startup was not approved for this import.".into());
        }
        attempt.busy = true;
        return Ok((attempt.clone(), false));
    }
    if retry_start {
        return Err("No imported resident is available to start.".into());
    }
    let selection = selection.ok_or("Select the exact discovered Hermes profile first.")?;
    let profile_name = proposal
        .projection
        .native_profile_name
        .clone()
        .ok_or("The requested Hermes profile name is missing.")?;
    let attempt = NativeImportAttempt {
        selection,
        profile_name,
        resident_pubkey: None,
        reused: None,
        busy: true,
        startup_error: None,
        warning: None,
        preferences_applied: false,
        preferences_error: None,
    };
    proposal.native_import = Some(attempt.clone());
    Ok((attempt, true))
}

/// Import one reviewed Hermes profile; explicit retries use only its saved identity and choices.
#[tauri::command]
pub async fn import_resident_proposal(
    app: AppHandle,
    request_id: String,
    selection: Option<NativeImportSelectionV1>,
    retry_start: bool,
    retry_settings: Option<bool>,
) -> Result<NativeImportResultV1, String> {
    // Origin checks query the relay synchronously; keep them on the blocking
    // worker, including rechecks around the existing async create/start calls.
    tokio::task::spawn_blocking(move || {
        let retry_settings = retry_settings.unwrap_or(false);
        let scope = authorize_import(&app, &request_id)?;
        if let Some(selected) = selection.as_ref() {
            let profile = lock_proposals()?
                .get(&request_id)
                .and_then(|p| p.projection.native_profile_name.clone())
                .ok_or("The requested profile is unavailable.")?;
            select_import_candidate(
                &profile,
                selected,
                crate::managed_agents::discover_native_resident_candidates(),
            )?;
        }
        authorize_import(&app, &request_id)?;
        let (mut attempt, first) = {
            let mut pending = lock_proposals()?;
            let proposal = pending
                .get_mut(&request_id)
                .ok_or("The import request has ended.")?;
            if retry_settings && proposal.native_import.is_none() {
                return Err("No saved import has reviewed settings to retry.".into());
            }
            admit_import(proposal, selection, retry_start)?
        };
        let host = AppImportHost {
            app: &app,
            owner: &scope.owner,
            authorize: || authorize_import(&app, &request_id).map(|_| ()),
            checkpoint: |attempt: &NativeImportAttempt| {
                if let Some(proposal) = lock_proposals()?.get_mut(&request_id) {
                    proposal.native_import = Some(attempt.clone());
                }
                Ok(())
            },
        };
        let work = run_reviewed_import(&host, &mut attempt, first, retry_start, retry_settings);
        attempt.busy = false;
        if let Some(proposal) = lock_proposals()?.get_mut(&request_id) {
            proposal.native_import = Some(attempt);
        }
        work
    })
    .await
    .map_err(|_| "Hermes import worker failed.".to_owned())?
}

struct SavedImport {
    pubkey: String,
    reused: bool,
    warning: Option<String>,
}

// One effect coordinator for both reviews. Tests replace only the host boundary;
// consent order, same-key recovery and result-only verification remain real code.
trait ImportHost {
    fn authorize(&self) -> Result<(), String>;
    fn candidate(
        &self,
        attempt: &NativeImportAttempt,
    ) -> Result<crate::managed_agents::DiscoveredResidentCandidate, String>;
    fn create_stopped(
        &self,
        candidate: crate::managed_agents::DiscoveredResidentCandidate,
    ) -> Result<SavedImport, String>;
    fn checkpoint(&self, attempt: &NativeImportAttempt) -> Result<(), String>;
    fn result(&self, attempt: &NativeImportAttempt) -> Result<NativeImportResultV1, String>;
    fn save_continuity(&self, key: &str, enabled: bool) -> Result<(), String>;
    fn save_launch(&self, key: &str, enabled: bool) -> Result<(), String>;
    fn start(&self, key: &str) -> Result<(), String>;
}

fn run_reviewed_import(
    host: &impl ImportHost,
    attempt: &mut NativeImportAttempt,
    first: bool,
    retry_start: bool,
    retry_settings: bool,
) -> Result<NativeImportResultV1, String> {
    host.authorize()?;
    if first {
        let candidate = host.candidate(attempt)?;
        host.authorize()?;
        match host.create_stopped(candidate) {
            Ok(created) => {
                attempt.resident_pubkey = Some(created.pubkey);
                attempt.reused = Some(created.reused);
                attempt.warning = created.warning;
                attempt.preferences_applied = created.reused;
                host.checkpoint(attempt)?;
            }
            Err(error) => {
                attempt.warning = Some(format!("Import returned an error. Verify the saved resident and its preferences in Agents: {error}"));
                return Err(error);
            }
        }
    }
    host.authorize()?;
    let saved = host.result(attempt)?;
    attempt.resident_pubkey = Some(saved.resident_pubkey.clone());
    if first || retry_settings {
        host.candidate(attempt)?;
        host.authorize()?;
        let key = saved.resident_pubkey;
        let _ = persist_import_preferences(
            attempt,
            |enabled| {
                host.authorize()?;
                host.save_continuity(&key, enabled)
            },
            |enabled| {
                host.authorize()?;
                host.save_launch(&key, enabled)
            },
        );
        host.checkpoint(attempt)?;
    }
    let saved = host.result(attempt)?;
    if should_start_import(first, retry_start, attempt, &saved) {
        host.candidate(attempt)?;
        host.authorize()?;
        attempt.startup_error = host.start(&saved.resident_pubkey).err();
        host.checkpoint(attempt)?;
    }
    host.authorize()?;
    host.result(attempt)
}

struct AppImportHost<'a, A, C> {
    app: &'a AppHandle,
    owner: &'a Hex64,
    authorize: A,
    checkpoint: C,
}

impl<A, C> ImportHost for AppImportHost<'_, A, C>
where
    A: Fn() -> Result<(), String>,
    C: Fn(&NativeImportAttempt) -> Result<(), String>,
{
    fn authorize(&self) -> Result<(), String> {
        (self.authorize)()
    }
    fn candidate(
        &self,
        attempt: &NativeImportAttempt,
    ) -> Result<crate::managed_agents::DiscoveredResidentCandidate, String> {
        current_import_candidate(attempt)
    }
    fn create_stopped(
        &self,
        candidate: crate::managed_agents::DiscoveredResidentCandidate,
    ) -> Result<SavedImport, String> {
        let input = serde_json::from_value(json!({
            "name": candidate.display_name,
            "agentCommand": match &candidate.binding_preview { crate::managed_agents::RuntimeBinding::Hermes { executable_path, .. } => executable_path.to_string_lossy().into_owned(), _ => return Err("The selected profile is not Hermes.".into()) },
            "agentArgs": ["acp"], "harnessOverride": true, "parallelism": 1,
            "nativeRuntimeBinding": candidate.binding_preview,
            "spawnAfterCreate": false, "startOnAppLaunch": false
        })).map_err(|_| "The selected import could not be prepared.")?;
        let created =
            tauri::async_runtime::block_on(super::super::resident_registry::create_luca_resident(
                input,
                self.app.clone(),
                self.app.state::<crate::app_state::AppState>(),
            ))
            .map_err(|error| error.message)?;
        Ok(SavedImport {
            pubkey: created.resident.resident_pubkey.as_str().to_owned(),
            reused: created.reused,
            warning: created
                .profile_sync_error
                .or(created.brain_access_error)
                .or(created.recovery_notice),
        })
    }
    fn checkpoint(&self, attempt: &NativeImportAttempt) -> Result<(), String> {
        (self.checkpoint)(attempt)
    }
    fn result(&self, attempt: &NativeImportAttempt) -> Result<NativeImportResultV1, String> {
        import_result_for_owner(self.app, self.owner, attempt)
    }
    fn save_continuity(&self, key: &str, enabled: bool) -> Result<(), String> {
        crate::commands::set_resident_continuity_enabled(
            key.to_owned(),
            enabled,
            self.app.clone(),
            self.app.state::<crate::app_state::AppState>(),
        )
        .map(|_| ())
    }
    fn save_launch(&self, key: &str, enabled: bool) -> Result<(), String> {
        tauri::async_runtime::block_on(crate::commands::set_managed_agent_start_on_app_launch(
            key.to_owned(),
            enabled,
            self.app.clone(),
        ))
        .map(|_| ())
    }
    fn start(&self, key: &str) -> Result<(), String> {
        tauri::async_runtime::block_on(crate::commands::start_managed_agent(
            key.to_owned(),
            self.app.clone(),
            self.app.state::<crate::app_state::AppState>(),
        ))
        .map(|_| ())
    }
}

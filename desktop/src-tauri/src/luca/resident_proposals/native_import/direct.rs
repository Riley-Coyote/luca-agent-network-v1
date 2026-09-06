//! Ordinary owner reviews reuse the conversation import's effect coordinator.

use super::*;

const MAX_DIRECT_IMPORTS: usize = 32;

#[derive(Clone, PartialEq, Eq)]
struct OwnerWorkspace {
    owner: Hex64,
    relay_url: String,
}

impl OwnerWorkspace {
    fn current(app: &AppHandle) -> Result<Self, String> {
        let state = app.state::<crate::app_state::AppState>();
        let owner = AppExchangeRelay::new(app.clone())
            .owner()
            .map_err(|_| "The current owner is unavailable.")?;
        let relay_url = crate::relay::relay_ws_url_with_override(&state);
        Ok(Self { owner, relay_url })
    }
}

struct DirectImport {
    scope: OwnerWorkspace,
    deadline: Instant,
    revoked: bool,
    admitted: bool,
    attempt: NativeImportAttempt,
}

/// Host-issued review identity and original consent, including an unresolved review reopened later.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedNativeImportV1 {
    attempt_id: String,
    selection: NativeImportSelectionV1,
    admitted: bool,
}

fn direct_imports() -> &'static Mutex<HashMap<String, DirectImport>> {
    static IMPORTS: OnceLock<Mutex<HashMap<String, DirectImport>>> = OnceLock::new();
    IMPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_imports() -> Result<std::sync::MutexGuard<'static, HashMap<String, DirectImport>>, String> {
    direct_imports()
        .lock()
        .map_err(|_| "Import review state is unavailable.".into())
}

fn validate_scope(
    review: &mut DirectImport,
    current: &OwnerWorkspace,
    now: Instant,
) -> Result<(), String> {
    if review.revoked || now >= review.deadline || review.scope != *current {
        review.revoked = true;
        return Err("This import review has expired or its owner/workspace changed. Inspect the saved resident in Agents before another review.".into());
    }
    Ok(())
}

fn authorize_direct(app: &AppHandle, id: &str) -> Result<(), String> {
    let current = OwnerWorkspace::current(app)?;
    let mut imports = lock_imports()?;
    let review = imports
        .get_mut(id)
        .ok_or("This import review has ended. Inspect Agents before another import.")?;
    validate_scope(review, &current, Instant::now())
}

fn make_review(
    scope: OwnerWorkspace,
    selection: NativeImportSelectionV1,
    profile_name: String,
    now: Instant,
) -> DirectImport {
    DirectImport {
        scope,
        deadline: now + PROPOSAL_LIFETIME,
        revoked: false,
        admitted: false,
        attempt: NativeImportAttempt {
            selection,
            profile_name,
            resident_pubkey: None,
            reused: None,
            busy: false,
            startup_error: None,
            warning: None,
            preferences_applied: false,
            preferences_error: None,
        },
    }
}

fn reserve_review(
    imports: &mut HashMap<String, DirectImport>,
    review: DirectImport,
    now: Instant,
) -> Result<PreparedNativeImportV1, String> {
    imports.retain(|_, entry| entry.attempt.busy || now < entry.deadline);
    // Closing the renderer does not turn a failed new import into permission
    // to reuse/start it under different choices. Reopen its exact host review.
    if let Some((id, existing)) = imports.iter().find(|(_, entry)| {
        entry.scope == review.scope
            && entry.attempt.selection.semantic_id == review.attempt.selection.semantic_id
            && (!entry.admitted
                || entry.attempt.busy
                || !entry.attempt.preferences_applied
                || entry.attempt.startup_error.is_some())
    }) {
        if existing.revoked
            || now >= existing.deadline
            || existing.attempt.selection.binding_fingerprint
                != review.attempt.selection.binding_fingerprint
        {
            return Err("An earlier import review is unresolved and its binding or authority changed. Inspect the saved resident in Agents.".into());
        }
        if !existing.admitted && existing.attempt.selection != review.attempt.selection {
            return Err("This profile already has a prepared review with different choices. Finish that review before another import.".into());
        }
        return Ok(PreparedNativeImportV1 {
            attempt_id: id.clone(),
            selection: existing.attempt.selection.clone(),
            admitted: existing.admitted,
        });
    }
    if imports.len() >= MAX_DIRECT_IMPORTS {
        return Err(
            "Too many import reviews are pending. Wait for the existing reviews to expire.".into(),
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    let prepared = PreparedNativeImportV1 {
        attempt_id: id.clone(),
        selection: review.attempt.selection.clone(),
        admitted: false,
    };
    imports.insert(id.clone(), review);
    Ok(prepared)
}

/// Prepare an exact, expiring owner/workspace review without creating or starting a resident.
#[tauri::command]
pub async fn prepare_native_resident_import(
    app: AppHandle,
    selection: NativeImportSelectionV1,
) -> Result<PreparedNativeImportV1, String> {
    tokio::task::spawn_blocking(move || {
        let scope = OwnerWorkspace::current(&app)?;
        let candidates = crate::managed_agents::discover_native_resident_candidates();
        let profile = candidates
            .iter()
            .find(|candidate| candidate.semantic_id == selection.semantic_id)
            .map(|candidate| candidate.native_id.clone())
            .ok_or("The selected Hermes profile is unavailable.")?;
        select_import_candidate(&profile, &selection, candidates)?;
        if OwnerWorkspace::current(&app)? != scope {
            return Err(
                "The active workspace changed during discovery. Review the profile again.".into(),
            );
        }
        let now = Instant::now();
        reserve_review(
            &mut *lock_imports()?,
            make_review(scope, selection, profile, now),
            now,
        )
    })
    .await
    .map_err(|_| "Import preparation worker failed.".to_owned())?
}

/// Only explicit owner actions may retry the already reviewed settings or startup.
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeImportActionV1 {
    Import,
    Verify,
    RetrySettings,
    RetryStart,
}

fn admit_direct(
    review: &mut DirectImport,
    current: &OwnerWorkspace,
    action: NativeImportActionV1,
    now: Instant,
) -> Result<(NativeImportAttempt, bool), String> {
    validate_scope(review, current, now)?;
    if review.attempt.busy {
        return Err("This import is still underway. Verify its result after it finishes.".into());
    }
    if !review.admitted && action != NativeImportActionV1::Import {
        return Err("This review has not imported a resident yet.".into());
    }
    if action == NativeImportActionV1::RetryStart && !review.attempt.selection.start_now {
        return Err("Startup was not approved in this review.".into());
    }
    let first = !review.admitted;
    review.admitted = true;
    review.attempt.busy = true;
    Ok((review.attempt.clone(), first))
}

/// Execute once, verify read-only, or explicitly recover the same host-bound resident.
#[tauri::command]
pub async fn import_native_resident(
    app: AppHandle,
    attempt_id: String,
    action: NativeImportActionV1,
) -> Result<NativeImportResultV1, String> {
    tokio::task::spawn_blocking(move || {
        let current = OwnerWorkspace::current(&app)?;
        let (mut attempt, first) = {
            let mut imports = lock_imports()?;
            let review = imports
                .get_mut(&attempt_id)
                .ok_or("This import review has ended. Inspect Agents before another import.")?;
            admit_direct(review, &current, action, Instant::now())?
        };
        let host = AppImportHost {
            app: &app,
            owner: &current.owner,
            authorize: || authorize_direct(&app, &attempt_id),
            checkpoint: |attempt: &NativeImportAttempt| {
                if let Some(review) = lock_imports()?.get_mut(&attempt_id) {
                    review.attempt = attempt.clone();
                }
                Ok(())
            },
        };
        let retry_settings = action == NativeImportActionV1::RetrySettings;
        let retry_start = action == NativeImportActionV1::RetryStart
            || retry_settings && attempt.selection.start_now;
        let result = run_reviewed_import(&host, &mut attempt, first, retry_start, retry_settings);
        attempt.busy = false;
        if let Some(review) = lock_imports()?.get_mut(&attempt_id) {
            review.attempt = attempt;
        }
        result
    })
    .await
    .map_err(|_| "Hermes import worker failed.".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn scope() -> OwnerWorkspace {
        OwnerWorkspace {
            owner: Hex64::parse("a".repeat(64)).unwrap(),
            relay_url: "ws://fixture-a".into(),
        }
    }
    fn selection() -> NativeImportSelectionV1 {
        NativeImportSelectionV1 {
            semantic_id: "hermes:/fixture/hermes:research".into(),
            binding_fingerprint: "reviewed-binding".into(),
            start_now: true,
            start_on_app_launch: true,
            continuity_enabled: false,
        }
    }
    fn candidate() -> crate::managed_agents::DiscoveredResidentCandidate {
        serde_json::from_value(json!({"nativeType":"hermes", "nativeId":"research", "semanticId":"hermes:/fixture/hermes:research", "bindingFingerprint":"reviewed-binding", "displayName":"Research", "readiness":{"status":"discovered","message":"Not probed"}, "warnings":[], "bindingPreview":{"kind":"hermes","schemaVersion":1,"profileName":"research","hermesHome":"/fixture/hermes","executablePath":"/fixture/hermes-cli","runtimeVersion":"fixture"}})).unwrap()
    }
    fn review() -> DirectImport {
        make_review(scope(), selection(), "research".into(), Instant::now())
    }

    #[test]
    fn ordinary_import_ids_are_host_generated_bounded_and_expired_ids_never_readmit() {
        let now = Instant::now();
        let mut imports = HashMap::new();
        let id = reserve_review(&mut imports, review(), now)
            .unwrap()
            .attempt_id;
        assert!(uuid::Uuid::parse_str(&id).is_ok());
        for index in 1..MAX_DIRECT_IMPORTS {
            let mut other = review();
            other.attempt.selection.semantic_id = format!("hermes:/fixture/{index}:research");
            reserve_review(&mut imports, other, now).unwrap();
        }
        let mut other = review();
        other.attempt.selection.semantic_id = "hermes:/fixture/overflow:research".into();
        assert!(reserve_review(&mut imports, other, now).is_err());
        let later = now + PROPOSAL_LIFETIME + Duration::from_secs(1);
        reserve_review(
            &mut imports,
            make_review(scope(), selection(), "research".into(), later),
            later,
        )
        .unwrap();
        assert!(!imports.contains_key(&id));
        assert_eq!(imports.len(), 1);
    }

    #[test]
    fn simultaneous_preparations_share_one_id_and_cannot_change_unadmitted_consent() {
        let now = Instant::now();
        let mut imports = HashMap::new();
        let first = reserve_review(&mut imports, review(), now).unwrap();
        let duplicate = reserve_review(&mut imports, review(), now).unwrap();
        assert_eq!(first.attempt_id, duplicate.attempt_id);
        assert!(!duplicate.admitted);
        let mut changed = review();
        changed.attempt.selection.continuity_enabled = true;
        assert!(reserve_review(&mut imports, changed, now).is_err());
        assert_eq!(imports.len(), 1);
    }

    #[test]
    fn reopening_an_unresolved_import_retains_its_key_and_original_consent() {
        let now = Instant::now();
        let mut imports = HashMap::new();
        let prepared = reserve_review(&mut imports, review(), now).unwrap();
        let original = imports.get_mut(&prepared.attempt_id).unwrap();
        original.admitted = true;
        original.attempt.resident_pubkey = Some("d".repeat(64));
        original.attempt.reused = Some(false);
        let mut new_review = review();
        new_review.attempt.selection.continuity_enabled = true;
        new_review.attempt.selection.start_now = false;
        let reopened = reserve_review(&mut imports, new_review, now).unwrap();
        assert_eq!(reopened.attempt_id, prepared.attempt_id);
        assert!(reopened.admitted);
        assert!(!reopened.selection.continuity_enabled);
        assert!(reopened.selection.start_now);
        assert_eq!(imports.len(), 1);
        assert_eq!(
            imports[&reopened.attempt_id]
                .attempt
                .resident_pubkey
                .as_deref(),
            Some("d".repeat(64).as_str())
        );
    }

    #[test]
    fn ordinary_import_fences_busy_replay_verify_and_unapproved_start() {
        let mut review = review();
        assert!(admit_direct(
            &mut review,
            &scope(),
            NativeImportActionV1::Verify,
            Instant::now()
        )
        .is_err());
        assert!(
            admit_direct(
                &mut review,
                &scope(),
                NativeImportActionV1::Import,
                Instant::now()
            )
            .unwrap()
            .1
        );
        assert!(admit_direct(
            &mut review,
            &scope(),
            NativeImportActionV1::Import,
            Instant::now()
        )
        .is_err());
        review.attempt.busy = false;
        assert!(
            !admit_direct(
                &mut review,
                &scope(),
                NativeImportActionV1::Import,
                Instant::now()
            )
            .unwrap()
            .1
        );
        review.attempt.busy = false;
        review.attempt.selection.start_now = false;
        assert!(admit_direct(
            &mut review,
            &scope(),
            NativeImportActionV1::RetryStart,
            Instant::now()
        )
        .is_err());
    }

    #[test]
    fn ordinary_import_owner_community_and_expiry_revocation_is_permanent() {
        for reason in 0..3 {
            let mut review = review();
            let mut current = scope();
            let mut now = Instant::now();
            match reason {
                0 => current.owner = Hex64::parse("b".repeat(64)).unwrap(),
                1 => current.relay_url = "ws://fixture-b".into(),
                _ => now = review.deadline,
            }
            assert!(
                admit_direct(&mut review, &current, NativeImportActionV1::Import, now).is_err()
            );
            assert!(admit_direct(
                &mut review,
                &scope(),
                NativeImportActionV1::Import,
                Instant::now()
            )
            .is_err());
        }
    }

    #[derive(Default)]
    struct FakeHost {
        calls: RefCell<Vec<String>>,
        fail: Cell<Option<&'static str>>,
        running: Cell<bool>,
        revoked: Cell<bool>,
        stale: Cell<bool>,
        reused: Cell<bool>,
        checkpoints: RefCell<Vec<NativeImportAttempt>>,
    }
    impl FakeHost {
        fn effect(&self, name: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(name.to_owned());
            if self.fail.get() == Some(name) {
                Err(format!("{name} unavailable"))
            } else {
                Ok(())
            }
        }
    }
    impl ImportHost for FakeHost {
        fn authorize(&self) -> Result<(), String> {
            if self.revoked.get() {
                Err("revoked".into())
            } else {
                Ok(())
            }
        }
        fn candidate(
            &self,
            attempt: &NativeImportAttempt,
        ) -> Result<crate::managed_agents::DiscoveredResidentCandidate, String> {
            let mut current = candidate();
            if self.stale.get() {
                current.binding_fingerprint = "changed".into();
            }
            select_import_candidate(&attempt.profile_name, &attempt.selection, vec![current])
        }
        fn create_stopped(
            &self,
            _: crate::managed_agents::DiscoveredResidentCandidate,
        ) -> Result<SavedImport, String> {
            self.effect("create-stopped-autostart-false")?;
            Ok(SavedImport {
                pubkey: "d".repeat(64),
                reused: self.reused.get(),
                warning: None,
            })
        }
        fn checkpoint(&self, attempt: &NativeImportAttempt) -> Result<(), String> {
            self.checkpoints.borrow_mut().push(attempt.clone());
            Ok(())
        }
        fn result(&self, attempt: &NativeImportAttempt) -> Result<NativeImportResultV1, String> {
            self.candidate(attempt)?;
            Ok(NativeImportResultV1 {
                resident_pubkey: attempt.resident_pubkey.clone().ok_or("missing saved key")?,
                display_name: "Research".into(),
                native_profile_name: "research".into(),
                reused: self.reused.get(),
                process_running: self.running.get(),
                authenticated_ready: false,
                startup_error: attempt.startup_error.clone(),
                warning: None,
                preferences_error: if attempt.preferences_applied {
                    None
                } else {
                    Some("Settings not saved".into())
                },
            })
        }
        fn save_continuity(&self, key: &str, enabled: bool) -> Result<(), String> {
            assert_eq!(key, "d".repeat(64));
            assert!(!enabled);
            self.effect("continuity")
        }
        fn save_launch(&self, key: &str, enabled: bool) -> Result<(), String> {
            assert_eq!(key, "d".repeat(64));
            assert!(enabled);
            self.effect("launch")
        }
        fn start(&self, key: &str) -> Result<(), String> {
            assert_eq!(key, "d".repeat(64));
            self.effect("start")?;
            self.running.set(true);
            Ok(())
        }
    }

    #[test]
    fn shared_import_coordinator_consent_failure_keeps_identity_stopped_and_retry_is_same_key() {
        for failure in ["continuity", "launch"] {
            let host = FakeHost::default();
            host.fail.set(Some(failure));
            let mut attempt = review().attempt;
            let saved = run_reviewed_import(&host, &mut attempt, true, false, false).unwrap();
            assert!(!saved.process_running);
            assert!(saved.preferences_error.is_some());
            assert_eq!(
                host.checkpoints.borrow()[0].resident_pubkey.as_deref(),
                Some("d".repeat(64).as_str())
            );
            assert!(!host.calls.borrow().iter().any(|call| call == "start"));
            if failure == "continuity" {
                assert!(!host.calls.borrow().iter().any(|call| call == "launch"));
            }
            let before = host.calls.borrow().clone();
            run_reviewed_import(&host, &mut attempt, false, false, false).unwrap();
            assert_eq!(*host.calls.borrow(), before, "Verify must be read-only");
            run_reviewed_import(&host, &mut attempt, false, true, true).unwrap();
            assert!(!host.running.get());
            host.fail.set(None);
            assert!(
                run_reviewed_import(&host, &mut attempt, false, true, true)
                    .unwrap()
                    .process_running
            );
            assert_eq!(
                host.calls
                    .borrow()
                    .iter()
                    .filter(|call| *call == "create-stopped-autostart-false")
                    .count(),
                1
            );
            assert_eq!(
                &host.calls.borrow()[host.calls.borrow().len() - 3..],
                ["continuity", "launch", "start"]
            );
        }
    }

    #[test]
    fn shared_import_start_failure_and_lost_ack_verification_never_repeat_creation_or_settings() {
        let host = FakeHost::default();
        host.fail.set(Some("start"));
        let mut attempt = review().attempt;
        assert!(run_reviewed_import(&host, &mut attempt, true, false, false)
            .unwrap()
            .startup_error
            .is_some());
        let before = host.calls.borrow().clone();
        run_reviewed_import(&host, &mut attempt, false, false, false).unwrap();
        assert_eq!(*host.calls.borrow(), before);
        host.fail.set(None);
        assert!(
            run_reviewed_import(&host, &mut attempt, false, true, false)
                .unwrap()
                .process_running
        );
        assert_eq!(
            *host.calls.borrow(),
            [
                "create-stopped-autostart-false",
                "continuity",
                "launch",
                "start",
                "start"
            ]
        );
        let before = host.calls.borrow().clone();
        run_reviewed_import(&host, &mut attempt, false, false, false).unwrap();
        assert_eq!(*host.calls.borrow(), before);
    }

    #[test]
    fn shared_import_reuse_preserves_preferences_and_stale_authority_blocks_effects() {
        let host = FakeHost::default();
        host.reused.set(true);
        let mut attempt = review().attempt;
        assert!(
            run_reviewed_import(&host, &mut attempt, true, false, false)
                .unwrap()
                .reused
        );
        assert_eq!(
            *host.calls.borrow(),
            ["create-stopped-autostart-false", "start"]
        );
        for stale in [false, true] {
            let host = FakeHost::default();
            host.stale.set(stale);
            host.revoked.set(!stale);
            assert!(run_reviewed_import(&host, &mut review().attempt, true, false, false).is_err());
            assert!(host.calls.borrow().is_empty());
        }
    }
}

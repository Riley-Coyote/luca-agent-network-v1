//! Reviewed relay-egress scope for private initiative results. Neither note
//! promotion nor permission to send observations to a provider implies this.
use super::{host_scope::home_scope, InitiativePolicyV1, InitiativeStoreErrorV1};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{AwarenessGrantKeyV1, LiveAwarenessOwner},
        managed_cognition,
    },
};
use luca_protocol::{
    AwarenessGrantStateV1, AwarenessSourceStateV1, CanonicalTimestamp, Hex64, OpaqueId, SafeU53,
    Sha256Ref,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const DISCLOSURE_REVISION: u32 = 1;
const MAX_RETURN_SOURCES: usize = 8;

/// Exact source revisions separately approved for returns to the owner's DM.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeReturnSourceV1 {
    pub source_id: OpaqueId,
    pub device_id: OpaqueId,
    pub grant_revision: SafeU53,
    pub deny_epoch: SafeU53,
}

/// Body-free owner-reviewed destination policy, never a reusable effect token.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitiativeReturnConsentV1 {
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub conversation_id: OpaqueId,
    pub binding_ref: Sha256Ref,
    pub origin_relay_ref: Sha256Ref,
    pub approved_at: CanonicalTimestamp,
    pub disclosure_revision: u32,
    pub sources: Vec<InitiativeReturnSourceV1>,
    pub quiet_start_minute: u16,
    pub quiet_end_minute: u16,
}
impl InitiativeReturnConsentV1 {
    pub(crate) fn validate(&self) -> Result<(), InitiativeStoreErrorV1> {
        if self.owner_pubkey == self.resident_pubkey
            || self.disclosure_revision != DISCLOSURE_REVISION
            || uuid::Uuid::parse_str(self.conversation_id.as_str()).is_err()
            || self.sources.len() > MAX_RETURN_SOURCES
            || self.quiet_start_minute >= 1440
            || self.quiet_end_minute >= 1440
            || self.quiet_start_minute == self.quiet_end_minute
            || self
                .sources
                .iter()
                .any(|source| source.grant_revision.get() == 0)
            || self.sources.windows(2).any(|pair| {
                (&pair[0].source_id, &pair[0].device_id) >= (&pair[1].source_id, &pair[1].device_id)
            })
        {
            return Err(InitiativeStoreErrorV1::Invalid);
        }
        Ok(())
    }
    /// Trusted host-local wall time, not a time suggested by a model or source.
    pub(crate) fn quiet_at(&self, minute: u16) -> bool {
        if minute >= 1440 || self.validate().is_err() {
            return true;
        }
        if self.quiet_start_minute < self.quiet_end_minute {
            (self.quiet_start_minute..self.quiet_end_minute).contains(&minute)
        } else {
            minute >= self.quiet_start_minute || minute < self.quiet_end_minute
        }
    }

    /// Do not start a bounded synthesis that would ordinarily run into quiet
    /// hours. It stays pending, rather than burning a model call at 21:59.
    pub(crate) fn can_start_at(&self, minute: u16, seconds: u64) -> bool {
        if self.quiet_at(minute) || seconds >= 24 * 60 * 60 {
            return false;
        }
        let minutes = seconds.saturating_add(59) / 60;
        (0..=minutes).all(|offset| !self.quiet_at(((u64::from(minute) + offset) % 1440) as u16))
    }
}

/// Captured before host review. Do not reconstruct this from model JSON after
/// approval. The caller retains the exact disclosure/selection and review ID.
#[derive(Clone)]
pub(crate) struct ReturnSetupSnapshotV1 {
    owner: Hex64,
    resident: Hex64,
    binding: Sha256Ref,
    epoch: SafeU53,
    conversation: OpaqueId,
    policy: InitiativePolicyV1,
    relay: Sha256Ref,
    quiet_hours_override: Option<(u16, u16)>,
    denial_generation: u64,
}
impl ReturnSetupSnapshotV1 {
    pub(crate) fn capture(
        app: &AppHandle,
        owner: Hex64,
        resident: Hex64,
        binding: Sha256Ref,
        epoch: SafeU53,
        conversation: OpaqueId,
        policy: InitiativePolicyV1,
    ) -> Result<Self, String> {
        let state = app.state::<AppState>();
        let control =
            home_scope(&state, &owner, &resident).map_err(|_| "Companion control unavailable.")?;
        let denial_generation = state
            .companion_execution
            .denial_generation(&control)
            .map_err(|_| "Companion control unavailable.")?;
        let relay = crate::luca::runtime_task_delivery::origin_relay_ref(
            app,
            &crate::relay::relay_ws_url_with_override(&state),
        )
        .map_err(|_| "Companion relay unavailable.")?;
        Ok(Self {
            owner,
            resident,
            binding,
            epoch,
            conversation,
            policy,
            relay,
            quiet_hours_override: None,
            denial_generation,
        })
    }

    /// Explicit owner-selected clock times, captured before the host review.
    pub(crate) fn with_quiet_hours(
        mut self,
        start_minute: u16,
        end_minute: u16,
    ) -> Result<Self, String> {
        if start_minute >= 1440 || end_minute >= 1440 || start_minute == end_minute {
            return Err("Quiet hours need two different times within the local day.".into());
        }
        self.quiet_hours_override = Some((start_minute, end_minute));
        Ok(self)
    }

    pub(crate) fn effective_quiet_hours(&self) -> (u16, u16) {
        self.quiet_hours_override.unwrap_or_else(|| {
            self.previous_consent()
                .map_or((22 * 60, 8 * 60), |previous| {
                    (previous.quiet_start_minute, previous.quiet_end_minute)
                })
        })
    }

    fn previous_consent(&self) -> Option<&InitiativeReturnConsentV1> {
        self.policy.return_consent.as_ref().filter(|previous| {
            previous.owner_pubkey == self.owner
                && previous.resident_pubkey == self.resident
                && previous.binding_ref == self.binding
                && previous.conversation_id == self.conversation
                && previous.origin_relay_ref == self.relay
        })
    }

    /// A repeated setup may reuse consent only for the same destination,
    /// model, quiet hours and still-current source revisions. No writes here.
    pub(crate) fn already_approved(&self, state: &AppState, sources: &[AwarenessGrantKeyV1]) -> bool {
        let Some(consent) = self.previous_consent() else { return false; };
        if consent.validate().is_err() || self.policy.max_outreach_per_24h == 0
            || (consent.quiet_start_minute, consent.quiet_end_minute) != self.effective_quiet_hours()
            || sources.len() != consent.sources.len() { return false; }
        sources.iter().all(|key| {
            key.source.owner_pubkey == self.owner && key.resident_pubkey == self.resident
                && state.companion_awareness.recheck_semantic_note_choice(&self.owner, key, &self.binding).is_ok()
                && state.companion_awareness.snapshot(&self.owner, key).is_ok_and(|snapshot| {
                    consent.sources.iter().any(|approved|
                        approved.source_id == key.source.source_id && approved.device_id == key.source.device_id
                            && approved.grant_revision == snapshot.grant.grant_revision
                            && approved.deny_epoch == snapshot.source.deny_epoch)
                })
        })
    }
}

/// Apply only following the caller's exact host-owned combined approval. Source
/// keys must be the successful selections in that same review, not an inventory
/// of all grants. CAS prevents a newer pause/policy from being overwritten.
pub(crate) fn apply_approved(
    app: &AppHandle,
    expected: &ReturnSetupSnapshotV1,
    sources: &[AwarenessGrantKeyV1],
    enable_background: bool,
    request: &OpaqueId,
) -> Result<InitiativePolicyV1, String> {
    let state = app.state::<AppState>();
    let live =
        LiveAwarenessOwner::authenticate(&state).map_err(|_| "Companion owner is unavailable.")?;
    if crate::luca::runtime_task_delivery::origin_relay_ref(
        app,
        &crate::relay::relay_ws_url_with_override(&state),
    )
    .ok()
    .as_ref()
        != Some(&expected.relay)
        || (enable_background
            && !managed_cognition::initiative_adapter_supported(&expected.resident))
    {
        return Err("Companion return runtime or relay is unavailable.".into());
    }
    if live.owner() != &expected.owner
        || !managed_cognition::active_binding_ref(&expected.resident)
            .is_ok_and(|binding| binding == expected.binding)
        || managed_cognition::active_session_epoch(&expected.resident).ok() != Some(expected.epoch)
    {
        return Err("The companion changed during review. Review again.".into());
    }
    verify_dm(
        app,
        &expected.owner,
        &expected.resident,
        &expected.conversation,
    )?;
    let mut approved_sources = Vec::new();
    for key in sources {
        if key.source.owner_pubkey != expected.owner || key.resident_pubkey != expected.resident {
            return Err("Invalid companion return source.".into());
        }
        let source = state
            .companion_awareness
            .snapshot(&expected.owner, key)
            .map_err(|_| "Companion source changed during setup.")?;
        if source.source.state == AwarenessSourceStateV1::Disabled
            || source.grant.state != AwarenessGrantStateV1::Active
            || !source.grant.choices.observe
            || !source.grant.choices.promote
            || source.grant.choices.provider_egress_binding.as_ref() != Some(&expected.binding)
            || source.grant.deny_epoch != source.source.deny_epoch
        {
            return Err(
                "The selected source is not approved for useful notes and this model.".into(),
            );
        }
        state
            .companion_awareness
            .recheck_native_history_choice(&expected.owner, key, &expected.binding)
            .map_err(|_| "The selected source is not approved for this conversation.")?;
        approved_sources.push(InitiativeReturnSourceV1 {
            source_id: key.source.source_id.clone(),
            device_id: key.source.device_id.clone(),
            grant_revision: source.grant.grant_revision,
            deny_epoch: source.source.deny_epoch,
        });
    }
    // Adding one harness does not silently erase an existing independent
    // return choice. Keep only the old exact epochs, never refresh them from
    // discovery or transfer an old choice to another model/relay/DM.
    if let Some(previous) = expected.previous_consent() {
        for source in &previous.sources {
            if !approved_sources.iter().any(|next| {
                next.source_id == source.source_id && next.device_id == source.device_id
            }) {
                approved_sources.push(source.clone());
            }
        }
    }
    approved_sources
        .sort_by(|a, b| (&a.source_id, &a.device_id).cmp(&(&b.source_id, &b.device_id)));
    approved_sources.dedup();
    let consent = InitiativeReturnConsentV1 {
        owner_pubkey: expected.owner.clone(),
        resident_pubkey: expected.resident.clone(),
        conversation_id: expected.conversation.clone(),
        binding_ref: expected.binding.clone(),
        origin_relay_ref: expected.relay.clone(),
        approved_at: crate::luca::continuity_jobs::current_canonical_timestamp()?,
        disclosure_revision: DISCLOSURE_REVISION,
        sources: approved_sources,
        quiet_start_minute: expected.effective_quiet_hours().0,
        quiet_end_minute: expected.effective_quiet_hours().1,
    };
    consent
        .validate()
        .map_err(|_| "Invalid companion return settings.")?;
    let scope = home_scope(&state, &expected.owner, &expected.resident)
        .map_err(|_| "Companion policy unavailable.")?;
    let mut next = expected.policy.clone();
    next.revision = SafeU53::new(
        next.revision
            .get()
            .checked_add(1)
            .ok_or("Companion revision exhausted.")?,
    )
    .map_err(|_| "Invalid companion revision.")?;
    next.return_consent = Some(consent);
    next.max_outreach_per_24h = 1;
    if enable_background {
        next.enabled = true;
        next.paused = false;
        next.allow_local_creations = true;
    }
    let _lease = live
        .lease()
        .map_err(|_| "Companion identity changed during review.")?;
    // A return-only review cannot lift a process-only Pause when its earlier
    // disk write failed. Resuming background work must itself be selected.
    let resume = enable_background && next.enabled && !next.paused;
    let policy = state
        .companion_execution
        .commit_reviewed_resume(&scope, expected.denial_generation, resume, || {
            state.companion_initiative.with_control(&scope, |store| {
                if store.policy(&scope)? != expected.policy {
                    return Err(InitiativeStoreErrorV1::Stale);
                }
                store
                    .set_policy(&scope, request, expected.policy.revision, next)
                    .map(|(policy, _)| policy)
            })
        })
        .map_err(|_| "Companion settings changed during review. Review again.")?;
    drop(_lease);
    if policy.enabled && !policy.paused {
        // Saved policy and actual execution are separate receipt facts.
        let _ = state.companion_coordinator.foreground_activity(app);
        let _ = state.companion_coordinator.wake(&expected.resident);
    }
    Ok(policy)
}

/// Verify the current two-member DM, not merely a model-selected destination.
pub(crate) fn verify_dm(
    app: &AppHandle,
    owner: &Hex64,
    resident: &Hex64,
    conversation: &OpaqueId,
) -> Result<(), String> {
    crate::luca::runtime_task_delivery::verify_private_return_dm(app, conversation, owner, resident)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn consent() -> InitiativeReturnConsentV1 {
        InitiativeReturnConsentV1 {
            owner_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
            resident_pubkey: Hex64::parse("b".repeat(64)).unwrap(),
            conversation_id: OpaqueId::parse("c71e4a35-8b02-4d69-9f18-3a6c0e5b2d47").unwrap(),
            binding_ref: Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap(),
            origin_relay_ref: Sha256Ref::parse(format!("sha256:{}", "d".repeat(64))).unwrap(),
            approved_at: CanonicalTimestamp::parse("2026-11-02T12:00:00Z").unwrap(),
            disclosure_revision: 1,
            sources: vec![],
            quiet_start_minute: 1320,
            quiet_end_minute: 480,
        }
    }
    fn snapshot() -> ReturnSetupSnapshotV1 {
        let c = consent();
        ReturnSetupSnapshotV1 {
            owner: c.owner_pubkey,
            resident: c.resident_pubkey,
            binding: c.binding_ref,
            epoch: SafeU53::new(1).unwrap(),
            conversation: c.conversation_id,
            policy: InitiativePolicyV1::disabled().unwrap(),
            relay: c.origin_relay_ref,
            quiet_hours_override: None,
            denial_generation: 0,
        }
    }
    #[test]
    fn repeated_return_setup_rechecks_the_existing_source_and_note_grant() {
        use crate::luca::companion_awareness::selected_files::tests::{id, now, number, Fixture};
        let fixture = Fixture::new();
        let live = LiveAwarenessOwner::authenticate(&fixture.state).unwrap();
        fixture.state.companion_awareness.initialize(&fixture.root, Some(live.owner()));
        let key = fixture.grant(id("return-approved-source"), true);
        let binding = Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap();
        let mut grant = fixture.runtime.snapshot(live.owner(), &key).unwrap().grant;
        grant.grant_revision = number(2);
        grant.choices.promote = true;
        grant.choices.provider_egress_binding = Some(binding.clone());
        fixture.runtime.put_grant(&live, &grant, Some(number(1)), &id("return-provider")).unwrap();
        let (history, _) = fixture.runtime.set_native_history_choice(live.owner(), &key,
            Some(&live), number(0), true, Some(&binding), &now(), &id("return-history")).unwrap();
        fixture.runtime.set_semantic_note_choice(live.owner(), &key, Some(&live), history.revision,
            true, Some(&binding), &now(), &id("return-notes")).unwrap();
        let mut approved = snapshot();
        approved.owner = live.owner().clone();
        approved.resident = fixture.resident.clone();
        let mut previous = consent();
        previous.owner_pubkey = approved.owner.clone();
        previous.resident_pubkey = approved.resident.clone();
        previous.sources = vec![InitiativeReturnSourceV1 {
            source_id: key.source.source_id.clone(), device_id: key.source.device_id.clone(),
            grant_revision: grant.grant_revision, deny_epoch: grant.deny_epoch,
        }];
        approved.policy.return_consent = Some(previous);
        approved.policy.max_outreach_per_24h = 1;
        assert!(approved.already_approved(&fixture.state, std::slice::from_ref(&key)));
        grant.grant_revision = number(3);
        fixture.runtime.put_grant(&live, &grant, Some(number(2)), &id("return-new-revision")).unwrap();
        assert!(!approved.already_approved(&fixture.state, &[key]));
    }
    #[test]
    fn repeated_return_setup_reuses_only_exact_existing_consent() {
        let fixture = crate::luca::companion_awareness::selected_files::tests::Fixture::new();
        let mut approved = snapshot();
        assert!(!approved.already_approved(&fixture.state, &[]));
        approved.policy.return_consent = Some(consent());
        approved.policy.max_outreach_per_24h = 1;
        assert!(approved.already_approved(&fixture.state, &[]));
        for changed in [
            { let mut value = approved.clone(); value.binding = Sha256Ref::parse(format!("sha256:{}", "e".repeat(64))).unwrap(); value },
            { let mut value = approved.clone(); value.resident = Hex64::parse("f".repeat(64)).unwrap(); value },
            { let mut value = approved.clone(); value.owner = Hex64::parse("f".repeat(64)).unwrap(); value },
            { let mut value = approved.clone(); value.relay = Sha256Ref::parse(format!("sha256:{}", "e".repeat(64))).unwrap(); value },
            { let mut value = approved.clone(); value.conversation = OpaqueId::parse("different-dm").unwrap(); value },
            approved.clone().with_quiet_hours(1200, 420).unwrap(),
            { let mut value = approved.clone(); value.policy.max_outreach_per_24h = 0; value },
        ] {
            assert!(!changed.already_approved(&fixture.state, &[]));
        }
        let key = AwarenessGrantKeyV1 {
            source: crate::luca::companion_awareness::AwarenessSourceKeyV1 {
                owner_pubkey: approved.owner.clone(), source_id: OpaqueId::parse("unapproved-source").unwrap(), device_id: OpaqueId::parse("this-device").unwrap(),
            }, resident_pubkey: approved.resident.clone(),
        };
        assert!(!approved.already_approved(&fixture.state, &[key]));
    }
    #[test]
    fn quiet_review_defaults_preserves_only_same_scope_and_accepts_explicit_override() {
        let mut snapshot = snapshot();
        assert_eq!(snapshot.effective_quiet_hours(), (1320, 480));
        let mut previous = consent();
        previous.quiet_start_minute = 1200;
        previous.quiet_end_minute = 420;
        snapshot.policy.return_consent = Some(previous);
        assert_eq!(snapshot.effective_quiet_hours(), (1200, 420));
        let explicit = snapshot.clone().with_quiet_hours(1380, 540).unwrap();
        assert_eq!(explicit.effective_quiet_hours(), (1380, 540));
        assert_eq!(snapshot.effective_quiet_hours(), (1200, 420));
        snapshot.binding = Sha256Ref::parse(format!("sha256:{}", "e".repeat(64))).unwrap();
        assert_eq!(snapshot.effective_quiet_hours(), (1320, 480));
    }
    #[test]
    fn quiet_review_rejects_out_of_day_or_equal_clock_times() {
        for (start, end) in [(1440, 480), (1320, 1440), (500, 500)] {
            assert!(snapshot().with_quiet_hours(start, end).is_err());
        }
        assert_eq!(
            snapshot()
                .with_quiet_hours(0, 1439)
                .unwrap()
                .effective_quiet_hours(),
            (0, 1439)
        );
    }
    #[test]
    fn quiet_hours_wrap_midnight_and_use_exact_boundaries() {
        let c = consent();
        assert!(c.quiet_at(1320));
        assert!(c.quiet_at(0));
        assert!(c.quiet_at(479));
        assert!(!c.quiet_at(480));
        assert!(!c.quiet_at(1319));
        assert!(c.quiet_at(1440));
    }
    #[test]
    fn return_waits_if_its_full_stage_would_cross_into_quiet_hours() {
        let consent = consent();
        assert!(!consent.can_start_at(21 * 60 + 58, 180));
        assert!(!consent.can_start_at(21 * 60 + 57, 180));
        assert!(consent.can_start_at(21 * 60 + 56, 180));
        assert!(consent.can_start_at(8 * 60, 180));
        assert!(!consent.can_start_at(8 * 60, 24 * 60 * 60));
    }
    #[test]
    fn invalid_or_ambiguous_schedule_fails_closed() {
        let mut c = consent();
        c.quiet_end_minute = c.quiet_start_minute;
        assert!(c.validate().is_err());
        assert!(c.quiet_at(600));
        c.quiet_start_minute = 600;
        c.quiet_end_minute = 700;
        assert!(!c.quiet_at(599));
        assert!(c.quiet_at(600));
        assert!(!c.quiet_at(700));
    }
    #[test]
    fn old_policy_acquires_no_return_consent() {
        let policy = InitiativePolicyV1::disabled().unwrap();
        let mut value = serde_json::to_value(policy).unwrap();
        value.as_object_mut().unwrap().remove("return_consent");
        let restored: InitiativePolicyV1 = serde_json::from_value(value).unwrap();
        assert!(restored.return_consent.is_none());
        assert_eq!(restored.max_outreach_per_24h, 0);
    }
}

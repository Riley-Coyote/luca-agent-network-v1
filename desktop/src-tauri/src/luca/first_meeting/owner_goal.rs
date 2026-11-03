//! Explicit current-owner goals, never automatic derivatives of observed work.
//! The only retained body is the exact signed owner message. A model supplies
//! its current event reference, not a summary, source text, or a new permission.

use super::{has_tag, kickoff, FIRST_MEETING_MARKER};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::LiveAwarenessOwner,
        companion_initiative::{host_scope::home_scope, InitiativePolicyV1},
        continuity_jobs::{
            continuity_mode, current_canonical_timestamp, with_enabled_goal_retention,
        },
        managed_dispatch_store::global_dispatch_store,
        resident_notebook::InitiativeThreadCommitRequestV1,
        resident_proposals::{verify_origin, ResidentProposalScope},
    },
    relay,
};
use luca_continuity::RevisionActor;
use luca_protocol::{
    canonical_sha256, Hex64, InitiativeDispositionV1, InitiativeSemanticThreadV1,
    InitiativeThreadKindV1, OpaqueId, ResidentContinuityModeV1, SafeU53, Sha256Ref,
    INITIATIVE_SEMANTIC_THREAD_PROTOCOL, MAX_INITIATIVE_THREAD_BODY_BYTES,
};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager};

fn not_carried(reason: &'static str) -> Value {
    json!({"status":"not_carried","reason":reason,"goalSaved":false,"workStarted":false})
}

fn ready(
    policy: &InitiativePolicyV1,
    continuity: ResidentContinuityModeV1,
    execution_paused: bool,
) -> bool {
    policy.enabled
        && !policy.paused
        && policy.allow_local_creations
        && continuity == ResidentContinuityModeV1::Enabled
        && !execution_paused
}

fn current_turn(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    event: &Hex64,
) -> Result<(), String> {
    verify_origin(app, scope)?;
    let dispatches = global_dispatch_store(app)?;
    let store = dispatches.lock().map_err(|_| "Dispatch unavailable.")?;
    let current = store
        .resolve_unique_cancellable(
            scope.owner.as_str(),
            scope.conversation.as_str(),
            scope.resident.as_str(),
        )
        .map_err(|_| "Current owner turn unavailable.")?;
    if current.dispatch_receipt_id != event.as_str()
        || current.session_epoch != scope.session_epoch.get()
    {
        return Err("The goal must be the current owner's message.".into());
    }
    let dispatch = store
        .recheck_communication_turn(
            event.as_str(),
            scope.resident.as_str(),
            scope.conversation.as_str(),
            scope.session_epoch.get(),
            chrono::Utc::now().timestamp().max(0) as u64,
        )
        .map_err(|_| "Current owner turn changed.")?;
    if dispatch.owner_pubkey != scope.owner.as_str() || dispatch.descendant_depth != 0 {
        return Err("Only an explicit owner turn can supply a goal.".into());
    }
    Ok(())
}

fn verified_goal_body<'a>(
    event: &'a nostr::Event,
    expected: &Hex64,
    owner: &Hex64,
    resident: &Hex64,
    conversation: &str,
) -> Option<&'a str> {
    if event.id.to_hex() != expected.as_str()
        || !event.verify_id()
        || !event.verify_signature()
        || event.pubkey.to_hex() != owner.as_str()
        || event.kind != nostr::Kind::Custom(9)
        || !has_tag(event, "h", conversation)
        || !has_tag(event, "p", resident.as_str())
        || event
            .tags
            .iter()
            .filter(|tag| tag.as_slice().first().is_some_and(|s| s == "h"))
            .count()
            != 1
        || has_tag(event, "client", FIRST_MEETING_MARKER)
        || event.content.trim().is_empty()
        || event.content.trim() == "Meet Luca"
        || event.content.trim_start().starts_with('!')
        || event.content.len() > MAX_INITIATIVE_THREAD_BODY_BYTES
    {
        return None;
    }
    let lower = event.content.to_ascii_lowercase();
    if [
        "password=",
        "openai_api_key=",
        "anthropic_api_key=",
        "github_token=",
        "aws_secret_access_key",
        "-----begin private key-----",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return None;
    }
    let (_, secrets) = luca_diagnostics::redact_classes(
        &event.content,
        &[luca_diagnostics::SensitiveClass::Secret],
    );
    (secrets.secret_count == 0).then_some(event.content.as_str())
}

fn goal_id(
    owner: &Hex64,
    resident: &Hex64,
    conversation: &str,
    body: &str,
) -> Result<OpaqueId, String> {
    // Same goal re-stated in another turn cannot bypass a declined/closed root.
    // Normalization affects identity only; stored content remains byte-exact.
    let normalized = body.split_whitespace().collect::<Vec<_>>().join(" ");
    let digest = canonical_sha256(&json!({"domain":"polyphonic.explicit-owner-goal.v1",
        "owner":owner,"resident":resident,"conversation":conversation,"body":normalized}))
    .map_err(|_| "Goal identity unavailable.")?;
    OpaqueId::parse(format!("owner-goal-{digest}")).map_err(|_| "Goal identity unavailable.".into())
}

fn existing_goal(disposition: InitiativeDispositionV1, id: &OpaqueId) -> Value {
    let carried = matches!(
        disposition,
        InitiativeDispositionV1::Carried | InitiativeDispositionV1::Deferred
    );
    json!({"status":if carried {"already_carried"} else {"closed"},"threadRef":id,
        "goalSaved":false,"workStarted":false,"message":"The existing goal was left unchanged; closed or declined work is never reopened here."})
}

/// Copy an explicitly selected current owner message into one encrypted Shared
/// goal. This creates no execution, observation, tool, return, or signing grant.
pub(super) fn carry_current_owner_goal(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    event_id: &Hex64,
) -> Value {
    carry(app, scope, event_id).unwrap_or_else(|_| not_carried("Goal could not be retained under the current turn, continuity, or background permissions."))
}

fn carry(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    event_id: &Hex64,
) -> Result<Value, String> {
    current_turn(app, scope, event_id)?;
    if kickoff::canonical_resident(app)? != scope.resident.as_str() {
        return Ok(not_carried(
            "Only Luca's current private conversation can carry a first-meeting goal.",
        ));
    }
    let state = app.state::<AppState>();
    let home = home_scope(&state, &scope.owner, &scope.resident)
        .map_err(|_| "Background scope unavailable.")?;
    let policy = state
        .companion_initiative
        .with_control(&home, |store| store.policy(&home))
        .map_err(|_| "Background policy unavailable.")?;
    if !ready(
        &policy,
        continuity_mode(app, &scope.owner, &scope.resident)?,
        state
            .companion_execution
            .is_paused(&home)
            .map_err(|_| "Execution pause unavailable.")?,
    ) {
        return Ok(not_carried(
            "Retained continuity and unpaused background work must already be enabled.",
        ));
    }
    let events = tauri::async_runtime::block_on(async {
        tokio::time::timeout(Duration::from_secs(3), async {
            kickoff::verify_dm(
                &state,
                scope.owner.as_str(),
                scope.resident.as_str(),
                scope.conversation.as_str(),
            )
            .await?;
            relay::query_relay(
                &state,
                &[json!({"ids":[event_id.as_str()],"kinds":[9],
                "authors":[scope.owner.as_str()],"#h":[scope.conversation.as_str()],"limit":1})],
            )
            .await
        })
        .await
        .map_err(|_| "Goal check timed out.")?
    })?;
    let [event] = events.as_slice() else {
        return Ok(not_carried(
            "The current owner message could not be verified.",
        ));
    };
    let Some(body) = verified_goal_body(
        event,
        event_id,
        &scope.owner,
        &scope.resident,
        scope.conversation.as_str(),
    ) else {
        return Ok(not_carried(
            "Only a bounded non-sensitive signed owner goal may be retained.",
        ));
    };
    let id = goal_id(
        &scope.owner,
        &scope.resident,
        scope.conversation.as_str(),
        body,
    )?;
    let existing = state
        .read_resident_initiative_threads(&scope.owner, &scope.resident, true)
        .map_err(|_| "Goal notebook unavailable.")?;
    if let Some(view) = existing.and_then(|snapshot| {
        snapshot
            .threads
            .into_iter()
            .find(|view| view.thread.thread_id == id)
    }) {
        return Ok(existing_goal(view.thread.disposition, &id));
    }
    let timestamp = current_canonical_timestamp()?;
    let thread = InitiativeSemanticThreadV1 {
        protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),
        thread_id: id.clone(),
        owner_pubkey: scope.owner.clone(),
        resident_pubkey: scope.resident.clone(),
        kind: InitiativeThreadKindV1::Shared,
        disposition: InitiativeDispositionV1::Carried,
        revision: SafeU53::new(0).map_err(|_| "Goal revision unavailable.")?,
        body: body.to_owned(),
        source_event_ids: vec![event_id.clone()],
        source_refs: vec![Sha256Ref::parse(format!("sha256:{}", event_id.as_str()))
            .map_err(|_| "Goal source unavailable.")?],
        eligible_after: None,
        created_at: timestamp.clone(),
        updated_at: timestamp,
    };
    thread.validate().map_err(|_| "Goal cannot be retained.")?;
    current_turn(app, scope, event_id)?;
    let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| "Owner unavailable.")?;
    if live.owner() != &scope.owner {
        return Ok(not_carried("The current owner changed."));
    }
    let lease = live.lease().map_err(|_| "Owner changed.")?;
    let current = state
        .companion_initiative
        .with_control(&home, |store| store.policy(&home))
        .map_err(|_| "Background unavailable.")?;
    if current.revision != policy.revision
        || !ready(
            &current,
            continuity_mode(app, &scope.owner, &scope.resident)?,
            state
                .companion_execution
                .is_paused(&home)
                .map_err(|_| "Execution pause unavailable.")?,
        )
    {
        return Ok(not_carried(
            "Companion choices changed; no goal was retained.",
        ));
    }
    // This is exact signed owner text, not a derivative of the aware reply.
    // The global automatic-derivative prohibition is deliberately untouched.
    let request = InitiativeThreadCommitRequestV1 {
        owner_pubkey: scope.owner.clone(),
        resident_pubkey: scope.resident.clone(),
        request_id: OpaqueId::parse(format!("seed-{}", id.as_str()))
            .map_err(|_| "Goal request unavailable.")?,
        actor: RevisionActor::Resident,
        canonical_source_clean: true,
        own_authorship_proof: None,
        completion_cause: None,
        expected_head: None,
        thread,
    };
    // Mode control precedes notebook locks and spans the actual write. No
    // initiative ledger or work gate is held while the notebook is acquired.
    // A later keyless execution Pause can leave this explicit goal retained,
    // but the independent execution admission still prevents any work starting.
    let committed = with_enabled_goal_retention(app, &scope.owner, &scope.resident, || {
        if state
            .companion_execution
            .is_paused(&home)
            .map_err(|_| "Execution pause unavailable.")?
        {
            return Err("Background execution is paused.".into());
        }
        state
            .commit_resident_initiative_thread(request)
            .map_err(|_| "Goal notebook changed or is unavailable.".into())
    });
    drop(lease);
    match committed {
        Ok(Some(receipt)) => Ok(json!({"status":if receipt.replayed {"already_carried"} else {"carried"},
            "threadRef":receipt.thread_id,"goalSaved":!receipt.replayed,"workStarted":false,
            "message":"The exact current owner goal was retained for bounded private consideration; no work has started and nothing is completed."})),
        Ok(None) => Ok(not_carried("Continuity was disabled before the goal could be retained.")),
        Err(_) => Ok(not_carried("The goal changed, was closed or forgotten, or its notebook is unavailable. Nothing was overwritten.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn fixture(body: &str) -> (nostr::Event, Hex64, Hex64) {
        let owner = Keys::generate();
        let resident = Hex64::parse("b".repeat(64)).unwrap();
        let event = EventBuilder::new(Kind::Custom(9), body)
            .tags([
                Tag::parse(["h", "room"]).unwrap(),
                Tag::parse(["p", resident.as_str()]).unwrap(),
            ])
            .sign_with_keys(&owner)
            .unwrap();
        (
            event,
            Hex64::parse(owner.public_key().to_hex()).unwrap(),
            resident,
        )
    }

    #[test]
    fn only_exact_current_signed_owner_text_is_eligible() {
        let (event, owner, resident) = fixture("Help me finish the first offline prototype.");
        let id = Hex64::parse(event.id.to_hex()).unwrap();
        assert_eq!(
            verified_goal_body(&event, &id, &owner, &resident, "room"),
            Some(event.content.as_str())
        );
        assert!(verified_goal_body(&event, &id, &owner, &resident, "wrong-room").is_none());
        assert!(verified_goal_body(&event, &id, &resident, &owner, "room").is_none());
        assert!(verified_goal_body(
            &event,
            &Hex64::parse("c".repeat(64)).unwrap(),
            &owner,
            &resident,
            "room"
        )
        .is_none());
        let mut forged = event;
        forged.content = "Different invented task".into();
        assert!(verified_goal_body(&forged, &id, &owner, &resident, "room").is_none());
    }

    #[test]
    fn sensitive_control_and_oversize_messages_never_become_goals() {
        for body in [
            "password=do-not-retain",
            "openai_api_key=do-not-retain",
            "!cancel",
            "Meet Luca",
            "",
            &"x".repeat(4097),
        ] {
            let (event, owner, resident) = fixture(body);
            let id = Hex64::parse(event.id.to_hex()).unwrap();
            assert!(verified_goal_body(&event, &id, &owner, &resident, "room").is_none());
        }
    }

    #[test]
    fn duplicate_goal_identity_is_stable_but_principals_are_isolated() {
        let (_, owner, resident) = fixture("Goal");
        assert_eq!(
            goal_id(&owner, &resident, "room", "Finish this prototype").unwrap(),
            goal_id(&owner, &resident, "room", "Finish  this\nprototype").unwrap()
        );
        assert_ne!(
            goal_id(&owner, &resident, "room", "Goal").unwrap(),
            goal_id(&owner, &resident, "other", "Goal").unwrap()
        );
        for disposition in [
            InitiativeDispositionV1::Declined,
            InitiativeDispositionV1::Retired,
            InitiativeDispositionV1::Completed,
        ] {
            let value = existing_goal(
                disposition,
                &goal_id(&owner, &resident, "room", "Goal").unwrap(),
            );
            assert_eq!(value["status"], "closed");
            assert_eq!(value["goalSaved"], false);
            assert_eq!(value["workStarted"], false);
            assert!(!value.to_string().contains("prototype"));
        }
    }

    #[test]
    fn background_pause_or_disabled_continuity_blocks_seeding() {
        let mut policy = InitiativePolicyV1::disabled().unwrap();
        assert!(!ready(&policy, ResidentContinuityModeV1::Enabled, false));
        policy.enabled = true;
        policy.paused = false;
        policy.allow_local_creations = true;
        assert!(ready(&policy, ResidentContinuityModeV1::Enabled, false));
        assert!(!ready(&policy, ResidentContinuityModeV1::Enabled, true));
        assert!(!ready(&policy, ResidentContinuityModeV1::Disabled, false));
        policy.paused = true;
        assert!(!ready(&policy, ResidentContinuityModeV1::Enabled, false));
    }
}

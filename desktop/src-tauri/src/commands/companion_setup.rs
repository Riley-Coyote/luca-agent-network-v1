//! A combined, explicitly reviewed companion setup. No default permission grant.

use super::companion_configuration::{self as follow, FollowTarget, Harness};
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::initial_context::InitialSampleApprovalV1,
        companion_initiative::return_setup::{self, ReturnSetupSnapshotV1},
        managed_permission::{
            await_companion_setup_review_cancellable, CapabilityPermissionDecision,
        },
        resident_proposals::{verify_origin, ResidentProposalScope},
    },
};
use luca_protocol::{
    canonical_sha256, CapabilityKind, CapabilityResourceV1, CapabilityRisk,
    ManagedPermissionRequestV2, Sha256Ref, MANAGED_PERMISSION_V2_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager};

/// Every extra scope must be proposed explicitly; omitted fields remain off.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SetupOptions {
    #[serde(default)]
    initial_context: bool,
    #[serde(default)]
    keep_notes: bool,
    #[serde(default)]
    background_work: bool,
    #[serde(default)]
    proactive_returns: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quiet_hours: Option<QuietHours>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct QuietHours {
    start_minute: u16,
    end_minute: u16,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SetupRequest {
    action: String,
    harnesses: Vec<Harness>,
    #[serde(default)]
    options: SetupOptions,
}

impl SetupRequest {
    fn validate(&self) -> Result<(), String> {
        if self.action != "setup"
            || self.harnesses.is_empty()
            || self.harnesses.len() > 2
            || (self.harnesses.len() == 2 && self.harnesses[0] == self.harnesses[1])
        {
            return Err("Choose Claude Code, Codex, or both for companion setup.".into());
        }
        if self.options.quiet_hours.is_some_and(|hours| {
            !self.options.proactive_returns
                || hours.start_minute >= 1440
                || hours.end_minute >= 1440
                || hours.start_minute == hours.end_minute
        }) {
            return Err("Quiet hours require a reviewed proactive-return choice and distinct local times within one day.".into());
        }
        Ok(())
    }

    fn disclosure(&self, quiet_hours: (u16, u16)) -> String {
        let choice = |on| if on { "yes" } else { "no" };
        format!(
            "Follow {} until paused (also on launch). Add recent sample: {}; notes: {}; background work: {}; proactive returns: {}. Unselected options preserve current settings. Excerpts go to your model and may stay in provider/harness history. Notes stay with this companion. Returns enter your Polyphonic chat, readable by its relay (max 1/day; quiet {:02}:{:02}–{:02}:{:02} local). Background uses your subscription. No raw archive, Brain, browser or screen access. Decline or ask Luca to customize.",
            self.harnesses.iter().map(|h| h.label()).collect::<Vec<_>>().join(" and "),
            choice(self.options.initial_context), choice(self.options.keep_notes),
            choice(self.options.background_work), choice(self.options.proactive_returns),
            quiet_hours.0 / 60, quiet_hours.0 % 60, quiet_hours.1 / 60, quiet_hours.1 % 60,
        )
    }
}

pub(super) fn configure(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let mut request: SetupRequest =
        serde_json::from_value(arguments).map_err(|_| "Invalid companion setup request.")?;
    request.validate()?;
    verify_origin(app, &scope)?;
    let target = FollowTarget::from(&scope);
    let state = app.state::<AppState>();
    let mut roots = Vec::new();
    let mut results = Vec::new();
    for harness in &request.harnesses {
        match follow::discovered_root(app, *harness) {
            Ok(root) => roots.push((*harness, root)),
            Err(message) => {
                results.push(json!({"harness":harness,"status":"incomplete","message":message}))
            }
        }
    }
    if roots.is_empty() {
        return Ok(json!({"status":"incomplete","results":results,"message":"No supported profiles were found. Nothing changed; advanced controls are only needed for an unusual installation."}).to_string());
    }
    request.harnesses = roots.iter().map(|(h, _)| *h).collect();
    let expected = roots
        .iter()
        .map(|(h, root)| follow::follow_expected(&state, &target, *h, root))
        .collect::<Result<Vec<_>, _>>()?;
    let before = follow::setup_approval_state(&state, &target)?;
    let initiative_scope = crate::luca::companion_initiative::host_scope::home_scope(
        &state,
        &scope.owner,
        &scope.resident,
    )
    .map_err(|e| format!("companion initiative: {e:?}"))?;
    let initiative_before = state
        .companion_initiative
        .with_control(&initiative_scope, |store| store.policy(&initiative_scope))
        .map_err(|e| format!("companion initiative: {e:?}"))?;
    let denial_generation = state
        .companion_execution
        .denial_generation(&initiative_scope)
        .map_err(|e| format!("companion control: {e:?}"))?;
    let return_snapshot = request
        .options
        .proactive_returns
        .then(|| {
            let snapshot = ReturnSetupSnapshotV1::capture(
                app,
                scope.owner.clone(),
                scope.resident.clone(),
                scope.binding.clone(),
                scope.session_epoch,
                scope.conversation.clone(),
                initiative_before.clone(),
            )?;
            if let Some(hours) = request.options.quiet_hours {
                snapshot.with_quiet_hours(hours.start_minute, hours.end_minute)
            } else {
                Ok(snapshot)
            }
        })
        .transpose()?;
    let quiet_hours = return_snapshot
        .as_ref()
        .map(ReturnSetupSnapshotV1::effective_quiet_hours)
        .unwrap_or((1320, 480));
    let fingerprint = Sha256Ref::parse(format!(
        "sha256:{}",
        canonical_sha256(&json!([
            "companion-combined-setup-v1",
            scope.owner,
            scope.resident,
            scope.binding,
            request,
            roots,
            before,
            quiet_hours,
            denial_generation
        ]))
        .map_err(|_| "Invalid setup fingerprint.")?
    ))
    .map_err(|_| "Invalid setup fingerprint.")?;
    let review = ManagedPermissionRequestV2 {
        protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
        resident_pubkey: scope.resident.clone(),
        session_epoch: scope.session_epoch,
        turn_id: follow::id("setup-turn")?,
        conversation_id: scope.conversation.clone(),
        request_id: follow::id("setup-review")?,
        capability: CapabilityKind::HarnessManage,
        risk: CapabilityRisk::HighImpact,
        operation: request.disclosure(quiet_hours),
        operation_fingerprint: fingerprint,
        resource: CapabilityResourceV1 {
            kind: "companion_setup_combined".into(),
            resource_ref: scope.resident.as_str().into(),
            display_name: "Companion setup".into(),
        },
    };
    review
        .validate()
        .map_err(|_| "Invalid companion setup disclosure.")?;
    let review_decision =
        await_companion_setup_review_cancellable(app, scope.owner.as_str(), review, || {
            !scope.active.load(Ordering::SeqCst) || cancelled()
        });
    if review_decision.customization_requested {
        return Ok(json!({"status":"customization_requested","permissionsChanged":false,"message":"The owner chose Customize. Nothing changed. Ask which proposed scopes they want changed, then submit a new review with those choices; do not reopen the same recommendation automatically."}).to_string());
    }
    if review_decision.decision == CapabilityPermissionDecision::Deny {
        return Ok(json!({"status":"not_changed","message":"Setup was declined, cancelled or expired. Nothing changed."}).to_string());
    }
    if cancelled() || before != follow::setup_approval_state(&state, &target)? {
        return Ok(json!({"status":"not_changed","message":"Setup stopped or settings changed during review. Nothing changed."}).to_string());
    }
    verify_origin(app, &scope)?;
    let mut owned_resume = None;
    let mut followed = Vec::new();
    for ((harness, root), mut expected) in roots.into_iter().zip(expected) {
        if cancelled() {
            break;
        }
        verify_origin(app, &scope)?;
        expected.after_owned_resume(owned_resume);
        let selection = expected.selection(root.clone(), harness)?;
        match follow::follow_with_notes_approved(
            app,
            &target,
            harness,
            root,
            &expected,
            request.options.keep_notes,
        ) {
            Ok(resumed) => {
                if resumed.is_some() {
                    owned_resume = resumed;
                }
                followed.push(selection);
                results.push(json!({"harness":harness,"status":"following","noteRetentionRequested":request.options.keep_notes}));
            }
            Err(message) => {
                results.push(json!({"harness":harness,"status":"incomplete","message":message}))
            }
        }
    }
    // Each additional capability is reported independently. A reviewed choice
    // is not a claim that an unimplemented or unavailable capability ran.
    if request.options.keep_notes && !followed.is_empty() && !cancelled() {
        let mode =
            crate::luca::continuity_jobs::continuity_mode(app, &scope.owner, &scope.resident);
        let ready = mode == Ok(luca_protocol::ResidentContinuityModeV1::Enabled);
        results.push(json!({"capability":"useful_notes","status":if ready {"ready"} else {"incomplete"},"noteSaved":false,
            "message":if ready {"Useful note retention is allowed. Notes are saved only when meaningful evidence or an explicit preference is actually retained."} else {"The companion's existing continuity is disabled or unavailable and was left unchanged. Source note permissions were saved, but automatic memory is not ready."}}));
    }
    if request.options.proactive_returns && !cancelled() {
        verify_origin(app, &scope)?;
        let keys = followed
            .iter()
            .map(|selection| selection.grant_key().clone())
            .collect::<Vec<_>>();
        let snapshot = return_snapshot
            .as_ref()
            .ok_or("Missing reviewed return settings.")?;
        match return_setup::apply_approved(
            app,
            snapshot,
            &keys,
            request.options.background_work,
            &follow::id("setup-returns")?,
        ) {
            Ok(policy) => {
                results.push(
                    json!({"capability":"proactive_returns","status":"applied","policy":policy}),
                );
                if request.options.background_work {
                    results.push(json!({"capability":"background_work","status":"applied"}));
                }
            }
            Err(message) => {
                results.push(json!({"capability":"proactive_returns","status":"incomplete","message":message}));
                if request.options.background_work {
                    results.push(json!({"capability":"background_work","status":"incomplete","message":"The combined background/return configuration did not complete. Inspect current settings before retrying; completed following choices remain saved."}));
                }
            }
        }
    } else if request.options.background_work && !cancelled() {
        verify_origin(app, &scope)?;
        let input = serde_json::from_value(json!({
            "enabled":true,"paused":false,"allowOutreach":false,"allowLocalCreations":true,
            "expectedRevision":initiative_before.revision.get(),"requestId":follow::id("setup-background")?,
        })).map_err(|_| "Invalid background setup.")?;
        match super::companion_initiative::set_reviewed_companion_initiative_policy(
            scope.resident.as_str().into(),
            input,
            app.clone(),
            Some(denial_generation),
        ) {
            Ok(receipt) => results
                .push(json!({"capability":"background_work","status":"applied","receipt":receipt})),
            Err(message) => results.push(
                json!({"capability":"background_work","status":"incomplete","message":message}),
            ),
        }
    }
    if request.options.initial_context && !cancelled() {
        verify_origin(app, &scope)?;
        let sample = InitialSampleApprovalV1::after_owner_review(
            &state,
            &scope.owner,
            &scope.resident,
            &scope.binding,
            followed,
        )
        .and_then(|approval| approval.sample(&state, &mut cancelled));
        // A completed read is still not permission to return its contents after
        // this exact turn is cancelled, replaced, or loses its native binding.
        verify_origin(app, &scope)?;
        if !cancelled() {
            // Queue through the ordinary context lane. The tool returns only
            // counts; source leases and derivative tracking apply when the
            // next ordinary native turn actually consumes these observations.
            match sample.and_then(|result| result.queue_current(&state)) {
                Ok(receipt) => results.push(json!({"capability":"initial_context","status":receipt["status"],"receipt":receipt})),
                Err(_) => results.push(json!({"capability":"initial_context","status":"incomplete","message":"Recent context was unavailable, timed out, or its permission changed. Continue chatting without it."})),
            }
        }
    }
    verify_origin(app, &scope)?;
    Ok(finish_receipt(results, None, cancelled()))
}

fn finish_receipt(
    results: Vec<Value>,
    initial_context: Option<Value>,
    interrupted: bool,
) -> String {
    json!({"status":if interrupted {"interrupted"} else if results.iter().any(|r|r["status"]=="incomplete") {"incomplete"} else {"applied"},"results":results,"initialContext":initial_context,
        "message":"Report only these completed changes briefly in chat. Enabled note retention is not proof a note was saved. Do not open settings."}).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omitted_scopes_are_off_and_paths_cannot_be_injected() {
        let request: SetupRequest =
            serde_json::from_value(json!({"action":"setup","harnesses":["codex"]})).unwrap();
        request.validate().unwrap();
        assert!(
            !request.options.keep_notes
                && !request.options.background_work
                && !request.options.initial_context
                && !request.options.proactive_returns
        );
        assert!(serde_json::from_value::<SetupRequest>(
            json!({"action":"setup","harnesses":["codex"],"path":"/private"})
        )
        .is_err());
        assert!(serde_json::from_value::<SetupRequest>(
            json!({"action":"setup","harnesses":["codex"],"options":{"grant":true}})
        )
        .is_err());
    }

    #[test]
    fn selected_scopes_and_destination_are_disclosed_within_permission_bound() {
        let request = SetupRequest {
            action: "setup".into(),
            harnesses: vec![Harness::ClaudeCode, Harness::Codex],
            options: SetupOptions {
                initial_context: true,
                keep_notes: true,
                background_work: true,
                proactive_returns: true,
                quiet_hours: None,
            },
        };
        let disclosure = request.disclosure((1320, 480));
        assert!(disclosure.len() <= 512, "{}", disclosure.len());
        for required in [
            "Claude Code and Codex",
            "recent sample: yes",
            "notes: yes",
            "background work: yes",
            "proactive returns: yes",
            "provider/harness history",
            "subscription",
            "customize",
        ] {
            assert!(disclosure.contains(required), "{required}");
        }
    }

    #[test]
    fn rejects_empty_duplicate_or_wrong_action() {
        for value in [
            json!({"action":"setup","harnesses":[]}),
            json!({"action":"setup","harnesses":["codex","codex"]}),
            json!({"action":"follow","harnesses":["codex"]}),
        ] {
            assert!(serde_json::from_value::<SetupRequest>(value)
                .unwrap()
                .validate()
                .is_err());
        }
    }

    #[test]
    fn custom_quiet_times_require_explicit_review_and_are_shown_exactly() {
        let request: SetupRequest = serde_json::from_value(json!({"action":"setup","harnesses":["codex"],
            "options":{"proactive_returns":true,"quiet_hours":{"start_minute":1395,"end_minute":570}}})).unwrap();
        request.validate().unwrap();
        assert!(request
            .disclosure((1395, 570))
            .contains("quiet 23:15–09:30 local"));
        for options in [
            json!({"proactive_returns":false,"quiet_hours":{"start_minute":1320,"end_minute":480}}),
            json!({"proactive_returns":true,"quiet_hours":{"start_minute":60,"end_minute":60}}),
            json!({"proactive_returns":true,"quiet_hours":{"start_minute":1440,"end_minute":480}}),
        ] {
            let request: SetupRequest = serde_json::from_value(
                json!({"action":"setup","harnesses":["codex"],"options":options}),
            )
            .unwrap();
            assert!(request.validate().is_err());
        }
    }

    #[test]
    fn partial_setup_never_hides_success_or_claims_everything_applied() {
        let results = vec![
            json!({"harness":"codex","status":"following","notesAllowed":true}),
            json!({"harness":"claude_code","status":"incomplete","message":"Profile unavailable"}),
            json!({"capability":"initial_context","status":"incomplete","message":"Timed out"}),
        ];
        let receipt: Value =
            serde_json::from_str(&finish_receipt(results.clone(), None, false)).unwrap();
        assert_eq!(receipt["status"], "incomplete");
        assert_eq!(receipt["results"], json!(results));
        assert!(receipt["initialContext"].is_null());
        assert!(receipt["message"]
            .as_str()
            .unwrap()
            .contains("not proof a note was saved"));
    }

    #[test]
    fn interruption_preserves_completed_receipts_without_false_rollback() {
        let results = vec![json!({"harness":"codex","status":"following"})];
        let receipt: Value =
            serde_json::from_str(&finish_receipt(results.clone(), None, true)).unwrap();
        assert_eq!(receipt["status"], "interrupted");
        assert_eq!(receipt["results"], json!(results));
        assert!(!receipt["message"]
            .as_str()
            .unwrap()
            .contains("Nothing changed"));
    }
}

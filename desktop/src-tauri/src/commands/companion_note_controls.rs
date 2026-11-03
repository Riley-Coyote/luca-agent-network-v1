//! Narrow chat-led memory denial. Reuse the existing resident continuity mode;
//! do not create a parallel permission ledger or silently resume memory later.
use crate::luca::{
    continuity_jobs::{continuity_mode, set_continuity_mode},
    resident_proposals::{verify_origin, ResidentProposalScope},
};
use luca_protocol::ResidentContinuityModeV1;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: String,
    #[serde(default)]
    harnesses: Vec<String>,
}

pub(super) fn pause(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let request: Request =
        serde_json::from_value(arguments).map_err(|_| "Invalid memory-pause request.")?;
    if request.action != "pause_notes" || !request.harnesses.is_empty() || cancelled() {
        return Err("Memory pause cannot configure harnesses or widen access.".into());
    }
    verify_origin(app, &scope)?;
    let receipt_scope = crate::luca::activity_trace::host_scope(app)
        .ok()
        .filter(|host| host.owner == scope.owner.as_str());
    let request_id =
        luca_protocol::OpaqueId::parse(format!("companion-control:{}", uuid::Uuid::new_v4()))
            .map_err(|_| "Invalid memory-pause receipt.")?;
    // Cancel drafts even if durable mode persistence subsequently fails.
    super::companion_notes::cancel_pending_notes(&scope.owner, &scope.resident);
    set_continuity_mode(
        app,
        &scope.owner,
        &scope.resident,
        ResidentContinuityModeV1::Disabled,
    )?;
    let mode = continuity_mode(app, &scope.owner, &scope.resident)?;
    if mode != ResidentContinuityModeV1::Disabled {
        return Err("The memory setting changed again; inspect current status.".into());
    }
    if let Some(host) = receipt_scope.as_ref() {
        crate::luca::activity_trace::record_companion_control(
            app,
            host,
            scope.resident.as_str(),
            scope.conversation.as_str(),
            &request_id,
            crate::luca::activity_trace::CompanionControlReceipt::MemoryPaused,
        );
    }
    Ok(json!({
        "status":"paused", "capability":"resident_memory", "deleted":false,
        "message":"Resident memory and continuity are paused: no new notes, memory recall or handoff updates. Existing notes were not deleted. Source-following and background-work permissions were left unchanged. Recommended setup will not silently resume this disabled memory setting."
    }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn memory_pause_accepts_no_scope_or_permission_selectors() {
        assert!(serde_json::from_value::<Request>(json!({"action":"pause_notes"})).is_ok());
        for field in ["owner", "resident", "note", "options", "grants", "enabled"] {
            let mut request = json!({"action":"pause_notes"});
            request[field] = json!(true);
            assert!(serde_json::from_value::<Request>(request).is_err());
        }
    }
}

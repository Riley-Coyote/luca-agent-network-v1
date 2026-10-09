//! Stable host-owned companion-home origin, not a model-selected project/session.
use super::{InitiativeControlScopeV1, InitiativeStoreErrorV1};
use crate::app_state::AppState;
use luca_protocol::{canonical_sha256, Hex64, OpaqueId, Sha256Ref};

/// Quiet local pursuits originate in the resident's home. Publishing elsewhere
/// requires its own actual conversation/dispatch authority; this scope grants none.
pub(crate) fn home_scope(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
) -> Result<InitiativeControlScopeV1, InitiativeStoreErrorV1> {
    if owner == resident {
        return Err(InitiativeStoreErrorV1::Scope);
    }
    let device = state
        .companion_awareness
        .device(owner)
        .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
    let digest = canonical_sha256(&serde_json::json!({
        "domain":"polyphonic.companion-home-origin.v1", "owner":owner, "resident":resident, "device":device,
    })).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    let now_unix_ms = u64::try_from(chrono::Utc::now().timestamp_millis())
        .map_err(|_| InitiativeStoreErrorV1::Invalid)?;
    Ok(InitiativeControlScopeV1 {
        owner_pubkey: owner.clone(),
        resident_pubkey: resident.clone(),
        window_id: OpaqueId::parse("companion-home")
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?,
        origin_scope_ref: Sha256Ref::parse(format!("sha256:{digest}"))
            .map_err(|_| InitiativeStoreErrorV1::Invalid)?,
        now_unix_ms,
    })
}

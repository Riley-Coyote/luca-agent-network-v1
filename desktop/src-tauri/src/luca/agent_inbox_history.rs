//! Narrow relay-authorized replay of previously shared tagged task turns.
//! This capability never authorizes root briefs or general source-room reads.

use luca_protocol::{ExchangeRecordV1, Hex64};
use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantReplayEnvelope {
    protocol: String,
    events: Vec<nostr::Event>,
}

pub(crate) async fn read_granted_turns(
    app: &AppHandle,
    actor: &Hex64,
    record: &ExchangeRecordV1,
    limit: usize,
) -> Result<Vec<nostr::Event>, String> {
    if actor == &record.owner || !record.members.contains(actor) {
        return Err("task history capability is only for its fixed resident audience".into());
    }
    let state = app.state::<crate::app_state::AppState>();
    let scope = super::agent_inbox::active_scope(app).await?;
    if scope.owner_pubkey != record.owner {
        return Err("task history owner changed".into());
    }
    let endpoint = require_capability(app, &scope).await?;
    let filters = [serde_json::json!({
        "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
        "#h": [record.conversation_id.as_str()], "#exchange": [record.exchange_id.as_str()],
        "task_history_grant": record.owner.as_str(), "task_history_reader": actor.as_str(), "limit": limit,
    })];
    let url = format!("{}/query", crate::relay::relay_http_base_url(&endpoint));
    let body = serde_json::to_vec(&filters).map_err(|_| "task history query is invalid")?;
    let auth = crate::relay::build_nip98_auth_header(&reqwest::Method::POST, &url, &body, &state)?;
    let response = state
        .http_client
        .post(&url)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "task history relay is unavailable")?;
    if !response.status().is_success() {
        return Err("task history entitlement is unavailable or revoked".into());
    }
    // An old relay that silently ignores extension filters returns an array,
    // never this proof envelope. Do not accept owner-proxy fallback bodies.
    let envelope: GrantReplayEnvelope = response
        .json()
        .await
        .map_err(|_| "relay did not prove task history authorization")?;
    if envelope.protocol != luca_protocol::TASK_HISTORY_PROTOCOL
        || require_capability(app, &scope).await? != endpoint
        || super::agent_inbox::active_scope(app).await? != scope
    {
        return Err("task history capability or workspace changed during read".into());
    }
    Ok(envelope.events)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bare_owner_query_arrays_are_never_historical_permission_proof() {
        assert!(serde_json::from_value::<GrantReplayEnvelope>(serde_json::json!([])).is_err());
        assert!(
            serde_json::from_value::<GrantReplayEnvelope>(serde_json::json!({"events":[]}))
                .is_err()
        );
        let exact: GrantReplayEnvelope = serde_json::from_value(serde_json::json!({
            "protocol":luca_protocol::TASK_HISTORY_PROTOCOL,"events":[]
        }))
        .unwrap();
        assert_eq!(exact.protocol, luca_protocol::TASK_HISTORY_PROTOCOL);
        assert!(exact.events.is_empty());
    }
}

async fn require_capability(
    app: &AppHandle,
    scope: &super::agent_inbox::InboxScope,
) -> Result<String, String> {
    let state = app.state::<crate::app_state::AppState>();
    let endpoint = crate::relay::relay_ws_url_with_override(&state);
    if state.signing_keys()?.public_key().to_hex() != scope.owner_pubkey.as_str() {
        return Err("task history owner changed".into());
    }
    let response = state
        .http_client
        .get(crate::relay::relay_http_base_url(&endpoint))
        .header("Accept", "application/nostr+json")
        .send()
        .await
        .map_err(|_| "task history capability is unavailable")?;
    if !response.status().is_success() {
        return Err("task history capability is unavailable".into());
    }
    let document: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "task history capability is invalid")?;
    if document["task_history"].as_str() != Some(luca_protocol::TASK_HISTORY_PROTOCOL)
        || document["community_id"].as_str() != Some(scope.community_id.as_str())
        || crate::relay::relay_ws_url_with_override(&state) != endpoint
        || state.signing_keys()?.public_key().to_hex() != scope.owner_pubkey.as_str()
    {
        return Err("relay does not advertise this exact task history scope".into());
    }
    Ok(endpoint)
}

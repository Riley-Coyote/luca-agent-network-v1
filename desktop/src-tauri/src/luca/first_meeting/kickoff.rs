//! Recover only the fixed first-meeting action, never arbitrary owner messages.
use super::{has_tag, record, FIRST_MEETING_MARKER};
use crate::luca::{
    conversation_context::active_scope,
    managed_dispatch_store::{atomic_write_restricted, global_dispatch_store},
};
use crate::{
    app_state::AppState, data_dir::BuzzPathExt, managed_agents::load_managed_agents, relay,
};
use luca_protocol::Hex64;
use nostr::Event;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::LazyLock,
    time::Duration,
};
use tauri::{AppHandle, Manager};
static START_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartResult {
    pub status: &'static str,
    pub trigger_event_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedKickoff {
    owner: Hex64,
    relay: String,
    conversation: String,
    resident: String,
    event: Event,
}
pub(super) fn record_path(root: &Path, owner: &str, relay: &str, conversation: &str) -> PathBuf {
    let scope = serde_json::json!([owner, relay, conversation]).to_string();
    root.join("first-meetings")
        .join(format!("{}.json", hex::encode(Sha256::digest(scope))))
}
pub(super) fn canonical_resident(app: &AppHandle) -> Result<String, String> {
    let records = load_managed_agents(app)?;
    let matches: Vec<_> = records
        .iter()
        .filter(|r| r.persona_id.as_deref() == Some("builtin:fizz"))
        .collect();
    let [resident] = matches.as_slice() else {
        return Err("Luca is not ready yet".into());
    };
    Ok(resident.pubkey.clone())
}
pub(super) async fn verify_dm(
    state: &AppState,
    owner: &str,
    resident: &str,
    conversation: &str,
) -> Result<(), String> {
    uuid::Uuid::parse_str(conversation).map_err(|_| "Invalid conversation")?;
    let events = relay::query_relay(
        state,
        &[serde_json::json!({"kinds":[39000], "#d":[conversation], "limit":1})],
    )
    .await?;
    let [event] = events.as_slice() else {
        return Err("Luca's conversation is unavailable".into());
    };
    if !event.verify_id()
        || !event.verify_signature()
        || event.kind != nostr::Kind::Custom(39000)
        || !has_tag(event, "d", conversation)
    {
        return Err("Invalid conversation metadata".into());
    }
    let channel = crate::nostr_convert::channel_info_from_event(event, None, None)?;
    let members: HashSet<_> = channel
        .participant_pubkeys
        .iter()
        .map(String::as_str)
        .collect();
    if channel.channel_type != "dm"
        || members.len() != 2
        || !members.contains(owner)
        || !members.contains(resident)
    {
        return Err("Meet Luca requires your private conversation with Luca".into());
    }
    Ok(())
}
fn valid_saved(
    item: &SavedKickoff,
    owner: &Hex64,
    relay: &str,
    conversation: &str,
    resident: &str,
) -> bool {
    let event = &item.event;
    item.owner == *owner
        && item.relay == relay
        && item.conversation == conversation
        && item.resident == resident
        && event.verify_id()
        && event.verify_signature()
        && event.pubkey.to_hex() == owner.as_str()
        && event.kind == nostr::Kind::Custom(9)
        && event.content == "Meet Luca"
        && event.tags.len() == 3
        && has_tag(event, "h", conversation)
        && has_tag(event, "p", resident)
        && has_tag(event, "client", FIRST_MEETING_MARKER)
}
pub(crate) async fn begin(app: &AppHandle, conversation: &str) -> Result<StartResult, String> {
    let _lock = START_LOCK.lock().await;
    let state = app.state::<AppState>();
    let (owner, scope) = active_scope(&state)?;
    let resident = canonical_resident(app)?;
    tokio::time::timeout(
        Duration::from_secs(10),
        verify_dm(&state, owner.as_str(), &resident, conversation),
    )
    .await
    .map_err(|_| "Conversation check timed out; please retry")??;
    let history = tokio::time::timeout(
        Duration::from_secs(10),
        relay::query_relay(
            &state,
            &[serde_json::json!({"kinds":[9], "#h":[conversation], "limit":100})],
        ),
    )
    .await
    .map_err(|_| "Conversation check timed out; please retry")??;
    if history.iter().any(|e| {
        !e.verify_id()
            || !e.verify_signature()
            || e.kind != nostr::Kind::Custom(9)
            || !has_tag(e, "h", conversation)
    }) {
        return Err("Conversation history could not be verified".into());
    }
    if let Some(event) = history
        .iter()
        .find(|e| e.pubkey.to_hex() == owner.as_str() && has_tag(e, "client", FIRST_MEETING_MARKER))
    {
        return Ok(StartResult {
            status: "already_started",
            trigger_event_id: Some(event.id.to_hex()),
        });
    }
    if !history.is_empty() {
        return Ok(StartResult {
            status: "existing_conversation",
            trigger_event_id: None,
        });
    }
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "Local storage is unavailable")?;
    let path = record_path(&root, owner.as_str(), &scope, conversation);
    let saved = match std::fs::read(&path) {
        Ok(bytes) if bytes.len() <= 4096 => {
            let saved: SavedKickoff =
                serde_json::from_slice(&bytes).map_err(|_| "Saved meeting action is invalid")?;
            if !valid_saved(&saved, &owner, &scope, conversation, &resident) {
                return Err("Saved meeting action does not match this conversation".into());
            }
            saved
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let builder = crate::events::build_message_with_client_tags(
                uuid::Uuid::parse_str(conversation).map_err(|_| "Invalid conversation")?,
                "Meet Luca",
                None,
                &[&resident],
                &[],
                &[],
                &[],
                &[vec!["client".into(), FIRST_MEETING_MARKER.into()]],
            )?;
            let event = builder
                .sign_with_keys(&state.signing_keys()?)
                .map_err(|_| "Could not sign meeting action")?;
            let saved = SavedKickoff {
                owner: owner.clone(),
                relay: scope.clone(),
                conversation: conversation.into(),
                resident: resident.clone(),
                event,
            };
            std::fs::create_dir_all(root.join("first-meetings"))
                .map_err(|_| "Cannot save meeting action")?;
            atomic_write_restricted(
                &path,
                &serde_json::to_vec(&saved).map_err(|_| "Cannot encode meeting action")?,
            )?;
            saved
        }
        _ => return Err("Saved meeting action is unavailable".into()),
    };
    let current = active_scope(&state)?;
    if current.0 != owner || current.1 != scope {
        return Err("Active workspace changed; please retry".into());
    }
    // Write the meeting down before it is published, so every later turn reads
    // what this one knew instead of re-deriving it from relay history under a
    // two-second budget. A record that cannot be written is not fatal: the
    // relay-derived path in `context.rs` remains as the fallback.
    write_meeting_record(
        app,
        &state,
        &owner,
        &scope,
        conversation,
        &resident,
        &saved.event.id.to_hex(),
        &root,
    )
    .await;
    // The opener deliberately has no selected history context. Keep its staged
    // authority identical when replaying the saved action after a crash.
    let context = None;
    let store = global_dispatch_store(app)?;
    let staged = store
        .lock()
        .map_err(|_| "Dispatch is unavailable")?
        .stage_owner_event_with_artifacts_and_context(
            &saved.event,
            &[resident],
            &[],
            context,
            chrono::Utc::now().timestamp().max(0) as u64,
        )?;
    if let Err(error) = relay::submit_signed_event(&saved.event, &state).await {
        if error.starts_with("relay rejected event:") {
            store
                .lock()
                .map_err(|_| "Dispatch is unavailable")?
                .mark_rejected(&staged)?;
        }
        return Err(error);
    }
    Ok(StartResult {
        status: "started",
        trigger_event_id: Some(saved.event.id.to_hex()),
    })
}

/// Capture the meeting once: the owner's setup name, whatever recent session
/// references are eligible right now, and a body-free note of their connected
/// sources. Grants are deliberately not applied here — a grant depends on the
/// live runtime binding, so it is checked per turn when the brief is composed.
#[allow(clippy::too_many_arguments)]
async fn write_meeting_record(
    app: &AppHandle,
    state: &AppState,
    owner: &Hex64,
    relay_scope: &str,
    conversation: &str,
    resident: &str,
    trigger_event_id: &str,
    root: &Path,
) {
    if record::load(root, owner, relay_scope, conversation).is_some() {
        return;
    }
    let profile = tokio::time::timeout(
        Duration::from_secs(2),
        relay::query_relay(
            state,
            &[serde_json::json!({"kinds":[0], "authors":[owner.as_str()], "limit":1})],
        ),
    )
    .await
    .ok()
    .and_then(Result::ok)
    .unwrap_or_default();
    let meeting = record::FirstMeetingStateV1 {
        schema: record::FIRST_MEETING_STATE_SCHEMA.to_owned(),
        owner: owner.clone(),
        relay: relay_scope.to_owned(),
        conversation: conversation.to_owned(),
        resident: resident.to_owned(),
        trigger_event_id: trigger_event_id.to_owned(),
        started_at: chrono::Utc::now().to_rfc3339(),
        setup_name: record::setup_name(&profile, owner.as_str()),
        references: record::discover_candidates(
            app,
            state,
            owner,
            std::time::Instant::now() + Duration::from_secs(2),
        ),
        brain_sources: state
            .try_read_connected_brain_catalog(owner)
            .ok()
            .flatten()
            .map(|catalog| record::brain_summaries(&catalog))
            .unwrap_or_default(),
        reply_trigger_ids: Vec::new(),
        completed_at: None,
        handoff_trigger_ids: Vec::new(),
    };
    let Ok(_guard) = record::STATE_LOCK.lock() else {
        eprintln!("buzz-desktop: first meeting record lock is unavailable");
        return;
    };
    if record::load(root, owner, relay_scope, conversation).is_some() {
        return;
    }
    if let Err(error) = record::save(root, owner, relay_scope, conversation, &meeting) {
        eprintln!("buzz-desktop: first meeting record was not saved: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_action_is_exact_and_scope_bound() {
        let keys = nostr::Keys::generate();
        let owner = Hex64::parse(keys.public_key().to_hex()).unwrap();
        let resident = nostr::Keys::generate().public_key().to_hex();
        let room = uuid::Uuid::new_v4();
        let event = crate::events::build_message_with_client_tags(
            room,
            "Meet Luca",
            None,
            &[&resident],
            &[],
            &[],
            &[],
            &[vec!["client".into(), FIRST_MEETING_MARKER.into()]],
        )
        .unwrap()
        .sign_with_keys(&keys)
        .unwrap();
        let mut saved = SavedKickoff {
            owner: owner.clone(),
            relay: "scope".into(),
            conversation: room.to_string(),
            resident: resident.clone(),
            event,
        };
        assert!(valid_saved(
            &saved,
            &owner,
            "scope",
            &room.to_string(),
            &resident
        ));
        assert!(!valid_saved(
            &saved,
            &owner,
            "other",
            &room.to_string(),
            &resident
        ));
        let roundtrip: SavedKickoff =
            serde_json::from_slice(&serde_json::to_vec(&saved).unwrap()).unwrap();
        assert_eq!(roundtrip.event, saved.event);
        saved.event.content = "different".into();
        assert!(!valid_saved(
            &saved,
            &owner,
            "scope",
            &room.to_string(),
            &resident
        ));
    }
}

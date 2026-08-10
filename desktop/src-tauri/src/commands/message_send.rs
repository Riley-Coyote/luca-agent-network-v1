use std::collections::HashSet;

#[cfg(test)]
use luca_protocol::Hex64;
use luca_protocol::{
    ManagedAudienceIntentV1, ManagedResponseSurfaceV1, MAX_MANAGED_AUDIENCE_RESIDENTS,
};
use nostr::Tag;
use tauri::State;

use super::messages::resolve_thread_ref;
use crate::{
    app_state::AppState,
    events,
    managed_agents::load_managed_agents,
    models::SendChannelMessageResponse,
    nostr_convert,
    relay::{query_relay, submit_signed_event},
};

fn normalized_managed_audience(
    intent: Option<ManagedAudienceIntentV1>,
    mentions: &[String],
    registered: &[String],
    conversation_members: Option<&HashSet<String>>,
) -> Result<Vec<String>, String> {
    let mentioned: HashSet<String> = mentions
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .collect();
    let registered: HashSet<String> = registered
        .iter()
        .map(|value| value.trim().to_ascii_lowercase())
        .collect();

    let Some(intent) = intent else {
        // Compatibility path for Buzz callers not yet migrated to the trusted
        // audience contract.
        let mut legacy: Vec<String> = registered.intersection(&mentioned).cloned().collect();
        legacy.sort();
        return Ok(legacy);
    };

    let requested = intent.into_resident_pubkeys();
    debug_assert!(requested.len() <= MAX_MANAGED_AUDIENCE_RESIDENTS);
    let mut normalized = Vec::with_capacity(requested.len());
    for pubkey in requested {
        let pubkey = pubkey.as_str().to_owned();
        if !mentioned.contains(&pubkey) {
            return Err("managed audience resident is not a message delivery recipient".into());
        }
        if !registered.contains(&pubkey) {
            return Err("managed audience contains an unknown or stale resident".into());
        }
        if !conversation_members.is_some_and(|members| members.contains(&pubkey)) {
            return Err("managed audience resident is not a conversation member".into());
        }
        normalized.push(pubkey);
    }
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

async fn conversation_member_pubkeys(
    channel_id: &str,
    state: &AppState,
) -> Result<HashSet<String>, String> {
    let events = query_relay(
        state,
        &[
            serde_json::json!({
                "kinds": [39002],
                "#d": [channel_id],
                "limit": 1
            }),
            serde_json::json!({
                "kinds": [39000],
                "#d": [channel_id],
                "limit": 1
            }),
        ],
    )
    .await?;
    let mut members = HashSet::new();
    for event in events {
        if event.kind == nostr::Kind::Custom(39002) {
            if let Ok(response) = nostr_convert::channel_members_from_event(&event) {
                members.extend(
                    response
                        .members
                        .into_iter()
                        .map(|member| member.pubkey.to_ascii_lowercase()),
                );
            }
        } else if event.kind == nostr::Kind::Custom(39000) {
            if let Ok(channel) = nostr_convert::channel_info_from_event(&event, None, None) {
                members.extend(
                    channel
                        .participant_pubkeys
                        .into_iter()
                        .map(|pubkey| pubkey.to_ascii_lowercase()),
                );
            }
        }
    }
    Ok(members)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn send_channel_message(
    channel_id: String,
    content: String,
    parent_event_id: Option<String>,
    media_tags: Option<Vec<Vec<String>>>,
    emoji_tags: Option<Vec<Vec<String>>>,
    mention_tags: Option<Vec<Vec<String>>>,
    mention_pubkeys: Option<Vec<String>>,
    kind: Option<u32>,
    managed_audience: Option<ManagedAudienceIntentV1>,
    response_surface: Option<ManagedResponseSurfaceV1>,
    state: State<'_, AppState>,
) -> Result<SendChannelMessageResponse, String> {
    let channel_uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let mentions = mention_pubkeys.unwrap_or_default();
    let mention_refs: Vec<&str> = mentions.iter().map(String::as_str).collect();
    let media = media_tags.unwrap_or_default();
    let emoji = emoji_tags.unwrap_or_default();
    let mention_refs_only = mention_tags.unwrap_or_default();
    let kind_num = kind.unwrap_or(buzz_core_pkg::kind::KIND_STREAM_MESSAGE);
    let mut resolved_root = None;

    if kind_num != buzz_core_pkg::kind::KIND_STREAM_MESSAGE
        && (managed_audience.is_some() || response_surface.is_some())
    {
        return Err("managed conversation routing applies only to ordinary messages".into());
    }

    let builder = match kind_num {
        buzz_core_pkg::kind::KIND_FORUM_POST => events::build_forum_post(
            channel_uuid,
            content.trim(),
            &mention_refs,
            &media,
            &mention_refs_only,
        )?,
        buzz_core_pkg::kind::KIND_FORUM_COMMENT => {
            let parent_id = parent_event_id
                .as_deref()
                .ok_or("forum comment requires parent_event_id")?;
            let thread_ref = resolve_thread_ref(parent_id, &state).await?;
            resolved_root = Some(thread_ref.root_event_id.to_hex());
            events::build_forum_comment(
                channel_uuid,
                content.trim(),
                &thread_ref,
                &mention_refs,
                &media,
                &mention_refs_only,
            )?
        }
        _ => {
            let thread_ref = match parent_event_id.as_deref() {
                Some(parent_id) => {
                    let reference = resolve_thread_ref(parent_id, &state).await?;
                    resolved_root = Some(reference.root_event_id.to_hex());
                    Some(reference)
                }
                None => None,
            };
            let builder = events::build_message(
                channel_uuid,
                content.trim(),
                thread_ref.as_ref(),
                &mention_refs,
                &media,
                &emoji,
                &mention_refs_only,
            )?;
            if thread_ref.is_some() && response_surface == Some(ManagedResponseSurfaceV1::Timeline)
            {
                builder.tag(
                    Tag::parse(["broadcast", "1"])
                        .map_err(|_| "failed to construct timeline response marker")?,
                )
            } else {
                builder
            }
        }
    };

    let app = state
        .app_handle
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "application handle is unavailable".to_string())?;
    let registered: Vec<String> = load_managed_agents(&app)?
        .into_iter()
        .map(|record| record.pubkey)
        .collect();
    let requires_membership_check = managed_audience
        .as_ref()
        .is_some_and(|intent| !matches!(intent, ManagedAudienceIntentV1::None));
    let conversation_members = if requires_membership_check {
        Some(conversation_member_pubkeys(&channel_id, &state).await?)
    } else {
        None
    };
    let managed_residents = normalized_managed_audience(
        managed_audience,
        &mentions,
        &registered,
        conversation_members.as_ref(),
    )?;

    // The owner event is signed before exact activation authority is staged.
    // Neither model output nor a relay replay can alter this snapshot.
    let event = state.signing_keys().and_then(|keys| {
        builder
            .sign_with_keys(&keys)
            .map_err(|error| format!("failed to sign event: {error}"))
    })?;
    let dispatch_store = if managed_residents.is_empty() {
        None
    } else {
        Some(crate::luca::managed_dispatch_store::global_dispatch_store(
            &app,
        )?)
    };
    let staged = if let Some(dispatch_store) = &dispatch_store {
        let mut store = dispatch_store.lock().map_err(|error| error.to_string())?;
        if content.trim() == "!cancel" {
            store.cancel_matching(
                &event.pubkey.to_hex(),
                &channel_id,
                None,
                &managed_residents,
            )?;
            Vec::new()
        } else {
            store.stage_owner_event(
                &event,
                &managed_residents,
                chrono::Utc::now().timestamp().max(0) as u64,
            )?
        }
    } else {
        Vec::new()
    };

    let result = match submit_signed_event(&event, &state).await {
        Ok(result) => result,
        Err(error) => {
            if error.starts_with("relay rejected event:") && !staged.is_empty() {
                if let Some(dispatch_store) = &dispatch_store {
                    dispatch_store
                        .lock()
                        .map_err(|lock| lock.to_string())?
                        .mark_rejected(&staged)?;
                }
            }
            return Err(error);
        }
    };
    let depth = match (&parent_event_id, &resolved_root) {
        (None, _) => 0,
        (Some(parent), Some(root)) if parent == root => 1,
        (Some(_), Some(_)) => 2,
        (Some(_), None) => 1,
    };

    Ok(SendChannelMessageResponse {
        event_id: result.event_id,
        root_event_id: resolved_root,
        parent_event_id,
        depth,
        created_at: chrono::Utc::now().timestamp(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(value: char) -> String {
        value.to_string().repeat(64)
    }

    #[test]
    fn explicit_audience_is_canonical_and_cannot_expand_delivery() {
        let first = key('a');
        let second = key('b');
        let result = normalized_managed_audience(
            Some(ManagedAudienceIntentV1::Directed {
                resident_pubkeys: vec![
                    Hex64::parse(second.clone()).unwrap(),
                    Hex64::parse(first.clone()).unwrap(),
                    Hex64::parse(second.clone()).unwrap(),
                ],
            }),
            &[first.clone(), second.clone()],
            &[first.clone(), second.clone()],
            Some(&HashSet::from([first.clone(), second.clone()])),
        )
        .expect("valid audience");
        assert_eq!(result, vec![first, second]);
    }

    #[test]
    fn explicit_audience_rejects_unknown_and_non_recipient_residents() {
        let resident = key('a');
        let unrelated = key('b');
        assert!(normalized_managed_audience(
            Some(ManagedAudienceIntentV1::Conversation {
                resident_pubkeys: vec![Hex64::parse(unrelated.clone()).unwrap()],
            }),
            std::slice::from_ref(&unrelated),
            std::slice::from_ref(&resident),
            Some(&HashSet::from([unrelated.clone()])),
        )
        .is_err());
        assert!(normalized_managed_audience(
            Some(ManagedAudienceIntentV1::Directed {
                resident_pubkeys: vec![Hex64::parse(resident.clone()).unwrap()],
            }),
            &[],
            &[resident],
            Some(&HashSet::from([key('a')])),
        )
        .is_err());

        let resident = key('a');
        assert!(normalized_managed_audience(
            Some(ManagedAudienceIntentV1::Directed {
                resident_pubkeys: vec![Hex64::parse(resident.clone()).unwrap()],
            }),
            std::slice::from_ref(&resident),
            std::slice::from_ref(&resident),
            Some(&HashSet::new()),
        )
        .is_err());
    }
}

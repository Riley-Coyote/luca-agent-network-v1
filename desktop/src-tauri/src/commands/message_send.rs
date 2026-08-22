use std::collections::HashSet;

use luca_protocol::{
    Hex64, ManagedAudienceIntentV1, ManagedResponseSurfaceV1, OpaqueId,
    MAX_MANAGED_AUDIENCE_RESIDENTS,
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

fn exact_imeta_field<'a>(tag: &'a [String], field: &str) -> Result<Option<&'a str>, String> {
    let mut found = None;
    for value in tag.iter().skip(1) {
        let Some((name, contents)) = value.split_once(' ') else {
            continue;
        };
        if name == field && (contents.is_empty() || found.replace(contents).is_some()) {
            return Err(format!("managed attachment has invalid {field} metadata"));
        }
    }
    Ok(found)
}

/// Remove desktop-only attachment authorization handles before constructing
/// the public Nostr event. The original tags remain available to the trusted
/// command for exact managed-dispatch binding below, while the relay receives
/// only standard NIP-92 metadata.
fn relay_media_tags(media: &[Vec<String>]) -> Vec<Vec<String>> {
    media
        .iter()
        .map(|tag| {
            tag.iter()
                .filter(|value| {
                    value
                        .split_once(' ')
                        .is_none_or(|(name, _)| name != "luca_handle")
                })
                .cloned()
                .collect()
        })
        .collect()
}

fn resolve_managed_artifact_bindings(
    media: &[Vec<String>],
    now: u64,
) -> Result<Vec<crate::luca::managed_dispatch_store::ManagedArtifactBinding>, String> {
    let mut handle_ids = Vec::with_capacity(media.len());
    for tag in media {
        if tag.first().map(String::as_str) != Some("imeta") {
            return Err("managed attachment metadata is not imeta".into());
        }
        handle_ids.push(
            exact_imeta_field(tag, "luca_handle")?
                .ok_or_else(|| "managed attachment is missing its desktop handle".to_string())?
                .to_owned(),
        );
    }
    let issued = super::media::resolve_issued_managed_artifacts(&handle_ids, now)?;
    let mut bindings = Vec::with_capacity(issued.len());
    for (tag, artifact) in media.iter().zip(issued) {
        let descriptor = artifact.descriptor;
        let expected_size = descriptor.size.to_string();
        let exact = exact_imeta_field(tag, "url")? == Some(descriptor.url.as_str())
            && exact_imeta_field(tag, "m")? == Some(descriptor.mime_type.as_str())
            && exact_imeta_field(tag, "x")? == Some(descriptor.sha256.as_str())
            && exact_imeta_field(tag, "size")? == Some(expected_size.as_str())
            && exact_imeta_field(tag, "filename")? == descriptor.filename.as_deref()
            && exact_imeta_field(tag, "luca_handle")? == descriptor.artifact_handle_id.as_deref();
        if !exact {
            return Err("managed attachment metadata changed after upload".into());
        }
        bindings.push(
            crate::luca::managed_dispatch_store::ManagedArtifactBinding {
                handle_id: descriptor
                    .artifact_handle_id
                    .ok_or_else(|| "managed attachment handle is unavailable".to_string())?,
                url: descriptor.url,
                content_sha256: descriptor.sha256,
                byte_length: descriptor.size,
                media_type: descriptor.mime_type,
                display_name: descriptor.filename,
                expires_at: artifact.expires_at,
            },
        );
    }
    Ok(bindings)
}

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

fn remove_faded_residents_from_routing(
    mentions: &mut Vec<String>,
    managed_audience: &mut Option<ManagedAudienceIntentV1>,
    faded: &[Hex64],
) {
    if faded.is_empty() {
        return;
    }
    let faded: HashSet<&str> = faded.iter().map(Hex64::as_str).collect();
    mentions.retain(|pubkey| !faded.contains(pubkey.trim().to_ascii_lowercase().as_str()));
    match managed_audience {
        Some(ManagedAudienceIntentV1::Conversation { resident_pubkeys })
        | Some(ManagedAudienceIntentV1::Directed { resident_pubkeys }) => {
            resident_pubkeys.retain(|pubkey| !faded.contains(pubkey.as_str()));
        }
        Some(ManagedAudienceIntentV1::None) | None => {}
    }
}

/// Temporary visit membership makes a resident able to see a DM, but it does
/// not make that guest part of the room's default speaking audience. Directed
/// mentions and replies remain exact and are deliberately left untouched.
fn remove_visitors_from_conversation_activation(
    managed_audience: &mut Option<ManagedAudienceIntentV1>,
    visitor_pubkeys: &[Hex64],
) {
    let Some(ManagedAudienceIntentV1::Conversation { resident_pubkeys }) = managed_audience else {
        return;
    };
    let visitors: HashSet<&str> = visitor_pubkeys.iter().map(Hex64::as_str).collect();
    resident_pubkeys.retain(|pubkey| !visitors.contains(pubkey.as_str()));
}

/// Keep managed-resident `p` tags aligned with the trusted activation choice.
///
/// Room membership is enough for a resident to observe conversation traffic.
/// A managed resident's `p` tag is therefore reserved for an actual wake. This
/// also prevents the cross-device recovery path from interpreting a
/// delivery-only tag as fresh activation authority.
fn align_managed_recipients_with_activation(
    mentions: &mut Vec<String>,
    managed_audience: &Option<ManagedAudienceIntentV1>,
    registered: &[String],
) {
    let Some(intent) = managed_audience else {
        return;
    };
    let allowed: HashSet<&str> = match intent {
        ManagedAudienceIntentV1::Conversation { resident_pubkeys }
        | ManagedAudienceIntentV1::Directed { resident_pubkeys } => {
            resident_pubkeys.iter().map(Hex64::as_str).collect()
        }
        ManagedAudienceIntentV1::None => HashSet::new(),
    };
    let managed: HashSet<String> = registered
        .iter()
        .map(|pubkey| pubkey.trim().to_ascii_lowercase())
        .collect();
    mentions.retain(|pubkey| {
        let normalized = pubkey.trim().to_ascii_lowercase();
        !managed.contains(&normalized) || allowed.contains(normalized.as_str())
    });
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
    visit_mention_pubkeys: Option<Vec<String>>,
    kind: Option<u32>,
    mut managed_audience: Option<ManagedAudienceIntentV1>,
    response_surface: Option<ManagedResponseSurfaceV1>,
    state: State<'_, AppState>,
) -> Result<SendChannelMessageResponse, String> {
    let channel_uuid = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| format!("invalid channel UUID: {channel_id}"))?;
    let mut mentions = mention_pubkeys.unwrap_or_default();
    let visit_mentions = visit_mention_pubkeys.unwrap_or_else(|| mentions.clone());
    let media = media_tags.unwrap_or_default();
    let relay_media = relay_media_tags(&media);
    let emoji = emoji_tags.unwrap_or_default();
    let mention_refs_only = mention_tags.unwrap_or_default();
    let kind_num = kind.unwrap_or(buzz_core_pkg::kind::KIND_STREAM_MESSAGE);
    let mut resolved_root = None;

    if kind_num != buzz_core_pkg::kind::KIND_STREAM_MESSAGE
        && (managed_audience.is_some() || response_surface.is_some())
    {
        return Err("managed conversation routing applies only to ordinary messages".into());
    }

    let app = state
        .app_handle
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "application handle is unavailable".to_string())?;

    if kind_num == buzz_core_pkg::kind::KIND_STREAM_MESSAGE {
        let visit_store = crate::luca::exchange_store::global_exchange_store(&app)?;
        let fade_store = std::sync::Arc::clone(&visit_store);
        let visit_app = app.clone();
        let visit_channel = OpaqueId::parse(channel_id.clone())
            .map_err(|error| format!("invalid visit conversation id: {error}"))?;
        let fade_channel = visit_channel.clone();
        let fade_mentions = visit_mentions.clone();
        let visit_now = chrono::Utc::now().timestamp().max(0) as u64;
        let faded = tauri::async_runtime::spawn_blocking(move || {
            let relay = crate::luca::exchange_relay::AppExchangeRelay::new(visit_app);
            crate::luca::visits::fade_owner_message_visits(
                &relay,
                &fade_store,
                &fade_channel,
                &fade_mentions,
                visit_now,
            )
        })
        .await
        .map_err(|error| format!("visit fade task failed: {error}"))?
        .map_err(|error| error.to_string())?;
        remove_faded_residents_from_routing(&mut mentions, &mut managed_audience, &faded);
        let active_visitors: Vec<Hex64> = visit_store
            .lock()
            .map_err(|_| "visit store is locked".to_owned())?
            .visits_in(&visit_channel)
            .into_iter()
            .map(|visit| visit.grant.resident)
            .collect();
        remove_visitors_from_conversation_activation(&mut managed_audience, &active_visitors);
    }

    let registered: Vec<String> = load_managed_agents(&app)?
        .into_iter()
        .map(|record| record.pubkey)
        .collect();
    align_managed_recipients_with_activation(&mut mentions, &managed_audience, &registered);

    let mention_refs: Vec<&str> = mentions.iter().map(String::as_str).collect();

    let builder = match kind_num {
        buzz_core_pkg::kind::KIND_FORUM_POST => events::build_forum_post(
            channel_uuid,
            content.trim(),
            &mention_refs,
            &relay_media,
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
                &relay_media,
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
                &relay_media,
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

    // The owner event is signed before either visit authority or exact
    // activation authority is staged. Neither model output nor a relay replay
    // can alter this snapshot.
    let event = state.signing_keys().and_then(|keys| {
        builder
            .sign_with_keys(&keys)
            .map_err(|error| format!("failed to sign event: {error}"))
    })?;
    if kind_num == buzz_core_pkg::kind::KIND_STREAM_MESSAGE {
        let visit_store = crate::luca::exchange_store::global_exchange_store(&app)?;
        let visit_app = app.clone();
        let visit_channel = OpaqueId::parse(channel_id.clone())
            .map_err(|error| format!("invalid visit conversation id: {error}"))?;
        let visit_event_id = Hex64::parse(event.id.to_hex())
            .map_err(|error| format!("invalid owner message id: {error}"))?;
        let visit_now = event.created_at.as_secs();
        tauri::async_runtime::spawn_blocking(move || {
            let relay = crate::luca::exchange_relay::AppExchangeRelay::new(visit_app);
            crate::luca::visits::handle_owner_mentions(
                &relay,
                &visit_store,
                &visit_channel,
                &visit_mentions,
                &visit_event_id,
                visit_now,
            )
        })
        .await
        .map_err(|error| format!("visit task failed: {error}"))?
        .map_err(|error| error.to_string())?;
    }
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
            let now = chrono::Utc::now().timestamp().max(0) as u64;
            let artifact_bindings = resolve_managed_artifact_bindings(&media, now)?;
            store.stage_owner_event_with_artifacts(
                &event,
                &managed_residents,
                &artifact_bindings,
                now,
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

    #[test]
    fn faded_residents_are_removed_from_delivery_and_activation() {
        let faded = Hex64::parse(key('a')).unwrap();
        let retained = Hex64::parse(key('b')).unwrap();
        let mut mentions = vec![faded.as_str().to_owned(), retained.as_str().to_owned()];
        let mut audience = Some(ManagedAudienceIntentV1::Conversation {
            resident_pubkeys: vec![faded.clone(), retained.clone()],
        });

        remove_faded_residents_from_routing(
            &mut mentions,
            &mut audience,
            std::slice::from_ref(&faded),
        );

        assert_eq!(mentions, [retained.as_str()]);
        assert_eq!(
            audience,
            Some(ManagedAudienceIntentV1::Conversation {
                resident_pubkeys: vec![retained],
            })
        );
    }

    #[test]
    fn conversation_activation_excludes_visitors_but_directed_activation_keeps_them() {
        let host = Hex64::parse(key('a')).unwrap();
        let visitor = Hex64::parse(key('b')).unwrap();
        let mut conversation = Some(ManagedAudienceIntentV1::Conversation {
            resident_pubkeys: vec![host.clone(), visitor.clone()],
        });

        remove_visitors_from_conversation_activation(
            &mut conversation,
            std::slice::from_ref(&visitor),
        );

        assert_eq!(
            conversation,
            Some(ManagedAudienceIntentV1::Conversation {
                resident_pubkeys: vec![host],
            })
        );

        let mut directed = Some(ManagedAudienceIntentV1::Directed {
            resident_pubkeys: vec![visitor.clone()],
        });
        remove_visitors_from_conversation_activation(&mut directed, std::slice::from_ref(&visitor));
        assert_eq!(
            directed,
            Some(ManagedAudienceIntentV1::Directed {
                resident_pubkeys: vec![visitor],
            })
        );
    }

    #[test]
    fn managed_recipient_tags_match_exact_activation_without_hiding_humans() {
        let host = key('a');
        let visitor = key('b');
        let human = key('c');
        let registered = vec![host.clone(), visitor.clone()];

        let mut conversation_mentions = vec![human.clone(), visitor.clone(), host.clone()];
        align_managed_recipients_with_activation(
            &mut conversation_mentions,
            &Some(ManagedAudienceIntentV1::Conversation {
                resident_pubkeys: vec![Hex64::parse(host.clone()).unwrap()],
            }),
            &registered,
        );
        assert_eq!(conversation_mentions, vec![human.clone(), host.clone()]);

        let mut directed_mentions = vec![human.clone(), visitor.clone(), host];
        align_managed_recipients_with_activation(
            &mut directed_mentions,
            &Some(ManagedAudienceIntentV1::Directed {
                resident_pubkeys: vec![Hex64::parse(visitor.clone()).unwrap()],
            }),
            &registered,
        );
        assert_eq!(directed_mentions, vec![human.clone(), visitor]);

        let mut none_mentions = vec![human.clone(), registered[0].clone()];
        align_managed_recipients_with_activation(
            &mut none_mentions,
            &Some(ManagedAudienceIntentV1::None),
            &registered,
        );
        assert_eq!(none_mentions, vec![human]);
    }

    #[test]
    fn relay_media_omits_private_handle_and_preserves_standard_imeta() {
        let media = vec![vec![
            "imeta".to_owned(),
            "url http://localhost:3000/media/file.bin".to_owned(),
            "m application/octet-stream".to_owned(),
            "x aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            "size 6".to_owned(),
            "filename file.bin".to_owned(),
            "luca_handle artifact-upload-1".to_owned(),
        ]];

        assert_eq!(
            relay_media_tags(&media),
            vec![vec![
                "imeta".to_owned(),
                "url http://localhost:3000/media/file.bin".to_owned(),
                "m application/octet-stream".to_owned(),
                "x aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
                "size 6".to_owned(),
                "filename file.bin".to_owned(),
            ]]
        );
        assert_eq!(
            exact_imeta_field(&media[0], "luca_handle").unwrap(),
            Some("artifact-upload-1")
        );
    }
}

//! Current private audience and reply admission for optional observed activity.
//! Relay/material reads happen before authority locks. No observer is started.
use super::{
    source_runtime::preload_source_facts_before, AwarenessHostFactsV1, LiveAwarenessOwner,
};
use crate::{app_state::AppState, luca::managed_dispatch_store::ManagedTurnAwarenessBindingV1};
use luca_protocol::{AwarenessMaterialStateV1, CanonicalTimestamp, Hex64, OpaqueId, Sha256Ref};
use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReplyAdmissionError {
    Denied,
    Unavailable,
}
fn source_failure(error: super::AwarenessStoreError) -> ReplyAdmissionError {
    match error {
        super::AwarenessStoreError::Unavailable => ReplyAdmissionError::Unavailable,
        _ => ReplyAdmissionError::Denied,
    }
}

fn private_metadata(
    event: &nostr::Event,
    owner: &Hex64,
    resident: &Hex64,
    conversation: &OpaqueId,
) -> bool {
    if event.kind != nostr::Kind::Custom(39000)
        || event.verify().is_err()
        || !event
            .tags
            .iter()
            .any(|tag| tag.as_slice() == ["d", conversation.as_str()])
    {
        return false;
    }
    let Ok(channel) = crate::nostr_convert::channel_info_from_event(event, None, None) else {
        return false;
    };
    let participants: BTreeSet<_> = channel.participant_pubkeys.into_iter().collect();
    channel.channel_type == "dm"
        && channel.visibility == "private"
        && participants == BTreeSet::from([owner.as_str().to_owned(), resident.as_str().to_owned()])
}

/// Fail-soft optional-context admission, never a group or public-room grant.
/// The exact current metadata and membership both have to name only this pair.
pub(crate) fn verified_private_conversation(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
    conversation: &OpaqueId,
    deadline: Instant,
) -> bool {
    current_private_conversation(state, owner, resident, conversation, deadline).unwrap_or(false)
}

fn current_private_conversation(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
    conversation: &OpaqueId,
    deadline: Instant,
) -> Result<bool, ReplyAdmissionError> {
    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        return Err(ReplyAdmissionError::Unavailable);
    };
    let events = tauri::async_runtime::block_on(async {
        tokio::time::timeout(
            remaining.min(Duration::from_millis(500)),
            crate::relay::query_relay(
                state,
                &[
                    serde_json::json!({"kinds":[39000], "#d":[conversation.as_str()], "limit":1}),
                    serde_json::json!({"kinds":[39002], "#d":[conversation.as_str()], "limit":1}),
                ],
            ),
        )
        .await
    });
    let Ok(Ok(events)) = events else {
        return Err(ReplyAdmissionError::Unavailable);
    };
    let metadata = events
        .iter()
        .filter(|event| event.kind == nostr::Kind::Custom(39000))
        .collect::<Vec<_>>();
    let members = events
        .iter()
        .filter(|event| event.kind == nostr::Kind::Custom(39002))
        .collect::<Vec<_>>();
    let ([metadata], [members]) = (metadata.as_slice(), members.as_slice()) else {
        return Ok(false);
    };
    if !private_metadata(metadata, owner, resident, conversation)
        || members.verify().is_err()
        || !members
            .tags
            .iter()
            .any(|tag| tag.as_slice() == ["d", conversation.as_str()])
    {
        return Ok(false);
    }
    let Ok(members) = crate::nostr_convert::channel_members_from_event(members) else {
        return Ok(false);
    };
    Ok(members
        .members
        .into_iter()
        .map(|member| member.pubkey)
        .collect::<BTreeSet<_>>()
        == BTreeSet::from([owner.as_str().to_owned(), resident.as_str().to_owned()]))
}

/// Linearize admission immediately before issuing a final reply. Old accepted
/// outbox entries do not pass here again; retryable new submissions do.
pub(crate) fn admit_reply(
    state: &AppState,
    receipt: &ManagedTurnAwarenessBindingV1,
    binding: &Sha256Ref,
) -> Result<(), ReplyAdmissionError> {
    if !receipt.fresh_native_history
        || receipt.binding_ref.as_ref() != Some(binding)
        || crate::luca::managed_cognition::active_binding_ref(&receipt.resident_pubkey)
            .ok()
            .as_ref()
            != Some(binding)
        || crate::luca::managed_cognition::active_session_epoch(&receipt.resident_pubkey).ok()
            != receipt.session_epoch
    {
        return Err(ReplyAdmissionError::Denied);
    }
    let deadline = Instant::now() + Duration::from_millis(750);
    if !current_private_conversation(
        state,
        &receipt.owner_pubkey,
        &receipt.resident_pubkey,
        &receipt.conversation_id,
        deadline,
    )? {
        return Err(ReplyAdmissionError::Denied);
    }
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .map_err(|_| ReplyAdmissionError::Unavailable)?;
    let material = preload_source_facts_before(
        state,
        &receipt.owner_pubkey,
        &receipt.resident_pubkey,
        &now,
        deadline,
    )
    .map_err(source_failure)?;
    let live = LiveAwarenessOwner::authenticate(state).map_err(source_failure)?;
    if live.owner() != &receipt.owner_pubkey {
        return Err(ReplyAdmissionError::Denied);
    }
    let lease = live.lease().map_err(source_failure)?;
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .map_err(|_| ReplyAdmissionError::Unavailable)?;
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: &receipt.owner_pubkey,
        resident_pubkey: &receipt.resident_pubkey,
        now: &now,
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Unavailable,
    };
    state
        .companion_awareness
        .admit_native_history_reply(
            &lease,
            &facts,
            binding,
            &receipt.context_nodes,
            &receipt.observations,
            |reference, retained| material.resolve(reference, retained),
        )
        .map_err(source_failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    #[test]
    fn observed_activity_requires_an_exact_signed_private_pair() {
        let owner = Keys::generate();
        let resident = Keys::generate();
        let other = Keys::generate();
        let conversation = OpaqueId::parse("11111111-1111-4111-8111-111111111111").unwrap();
        let owner_id = Hex64::parse(owner.public_key().to_hex()).unwrap();
        let resident_id = Hex64::parse(resident.public_key().to_hex()).unwrap();
        let event = |kind: &str, members: Vec<String>, signer: &Keys| {
            let mut tags = vec![
                Tag::parse(["d", conversation.as_str()]).unwrap(),
                Tag::parse(["t", kind]).unwrap(),
                Tag::parse(["private"]).unwrap(),
            ];
            tags.extend(
                members
                    .iter()
                    .map(|member| Tag::parse(["p", member.as_str()]).unwrap()),
            );
            EventBuilder::new(
                Kind::Custom(39000),
                serde_json::json!({"name":"Private", "channel_type":kind}).to_string(),
            )
            .tags(tags)
            .allow_self_tagging()
            .sign_with_keys(signer)
            .unwrap()
        };
        let pair = vec![owner.public_key().to_hex(), resident.public_key().to_hex()];
        assert!(private_metadata(
            &event("dm", pair.clone(), &owner),
            &owner_id,
            &resident_id,
            &conversation
        ));
        assert!(!private_metadata(
            &event("stream", pair.clone(), &owner),
            &owner_id,
            &resident_id,
            &conversation
        ));
        let mut group = pair.clone();
        group.push(other.public_key().to_hex());
        assert!(!private_metadata(
            &event("dm", group, &owner),
            &owner_id,
            &resident_id,
            &conversation
        ));
        let foreign = OpaqueId::parse("22222222-2222-4222-8222-222222222222").unwrap();
        assert!(!private_metadata(
            &event("dm", pair, &owner),
            &owner_id,
            &resident_id,
            &foreign
        ));
    }
}

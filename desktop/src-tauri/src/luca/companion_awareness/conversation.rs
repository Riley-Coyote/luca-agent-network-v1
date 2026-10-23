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

// Fixed stages and redacted enums only: never format a receipt, source body,
// native locator, relay response or underlying database/credential error.
fn rejected(
    receipt: &ManagedTurnAwarenessBindingV1,
    stage: &'static str,
    error: ReplyAdmissionError,
    source: Option<super::AwarenessStoreError>,
) -> ReplyAdmissionError {
    luca_log!(
        warn,
        "luca-awareness-reply: dispatch={} epoch={} stage={} error={:?} source={:?}",
        receipt.trigger_event_id.as_str(),
        receipt.session_epoch.map_or(0, |epoch| epoch.get()),
        stage,
        error,
        source
    );
    error
}

fn rejected_source(
    receipt: &ManagedTurnAwarenessBindingV1,
    stage: &'static str,
    error: super::AwarenessStoreError,
) -> ReplyAdmissionError {
    rejected(receipt, stage, source_failure(error), Some(error))
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
    reply_lease: &super::source_runtime::NativeReplyLeaseV1,
) -> Result<(), ReplyAdmissionError> {
    if !receipt.fresh_native_history
        || !reply_lease.matches_receipt(receipt)
        || receipt.binding_ref.as_ref() != Some(binding)
    {
        return Err(rejected(
            receipt,
            "receipt_scope",
            ReplyAdmissionError::Denied,
            None,
        ));
    }
    if crate::luca::managed_cognition::active_binding_ref(&receipt.resident_pubkey)
        .ok()
        .as_ref()
        != Some(binding)
    {
        return Err(rejected(
            receipt,
            "runtime_binding",
            ReplyAdmissionError::Denied,
            None,
        ));
    }
    if crate::luca::managed_cognition::active_session_epoch(&receipt.resident_pubkey).ok()
        != receipt.session_epoch
    {
        return Err(rejected(
            receipt,
            "runtime_epoch",
            ReplyAdmissionError::Denied,
            None,
        ));
    }
    let deadline = Instant::now() + Duration::from_millis(750);
    if !current_private_conversation(
        state,
        &receipt.owner_pubkey,
        &receipt.resident_pubkey,
        &receipt.conversation_id,
        deadline,
    )
    .map_err(|error| rejected(receipt, "private_audience", error, None))?
    {
        return Err(rejected(
            receipt,
            "private_audience",
            ReplyAdmissionError::Denied,
            None,
        ));
    }
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .map_err(|_| {
        rejected(
            receipt,
            "preload_clock",
            ReplyAdmissionError::Unavailable,
            None,
        )
    })?;
    let material = preload_source_facts_before(
        state,
        &receipt.owner_pubkey,
        &receipt.resident_pubkey,
        &now,
        deadline,
    )
    .map_err(|error| rejected_source(receipt, "material_preload", error))?;
    let live = LiveAwarenessOwner::authenticate(state)
        .map_err(|error| rejected_source(receipt, "live_owner", error))?;
    if live.owner() != &receipt.owner_pubkey {
        return Err(rejected(
            receipt,
            "live_owner_scope",
            ReplyAdmissionError::Denied,
            None,
        ));
    }
    let lease = live
        .lease()
        .map_err(|error| rejected_source(receipt, "live_owner_lease", error))?;
    let now = CanonicalTimestamp::parse(
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .map_err(|_| {
        rejected(
            receipt,
            "admission_clock",
            ReplyAdmissionError::Unavailable,
            None,
        )
    })?;
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
            Some(reply_lease),
            |reference, retained| {
                let facts = material.resolve_admitted_reply(reference, retained, reply_lease);
                if !facts.source_fresh || facts.material_state != AwarenessMaterialStateV1::Available {
                    luca_log!(warn,
                        "luca-awareness-reply: dispatch={} stage=material_resolution observation={} retained={} fresh={} state={:?}",
                        receipt.trigger_event_id.as_str(), reference.observation_id.as_str(),
                        retained, facts.source_fresh, facts.material_state);
                }
                facts
            },
        )
        .map_err(|error| rejected_source(receipt, "authority", error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    #[test]
    fn redacted_admission_errors_keep_the_original_fail_closed_mapping() {
        use super::super::AwarenessStoreError;
        assert_eq!(
            source_failure(AwarenessStoreError::Unavailable),
            ReplyAdmissionError::Unavailable
        );
        for error in [
            AwarenessStoreError::Invalid,
            AwarenessStoreError::Missing,
            AwarenessStoreError::Capacity,
            AwarenessStoreError::Paused,
            AwarenessStoreError::Quarantined,
            AwarenessStoreError::Suspended,
            AwarenessStoreError::Denied(luca_protocol::AwarenessError::Expired),
        ] {
            assert_eq!(source_failure(error), ReplyAdmissionError::Denied);
        }
    }
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

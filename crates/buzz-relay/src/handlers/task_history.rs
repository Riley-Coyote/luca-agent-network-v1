//! Exact task-turn replay. All other query/count/search/live surfaces retain
//! ordinary membership checks; the extension is rejected where unsupported.
use super::ingest::IngestError;

/// A removal's permission denial must not depend on best-effort side effects.
/// Called only after ordinary admin authorization. Failure refuses acceptance.
pub async fn checkpoint_source_removal(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
) -> Result<(), IngestError> {
    let cleanup: Vec<_> = event
        .tags
        .iter()
        .map(|t| t.as_slice())
        .filter(|t| t.first().map(String::as_str) == Some("luca-visit-end"))
        .collect();
    if !cleanup.is_empty() {
        if cleanup.len() != 1 || cleanup[0].len() != 2 || Hex64::parse(&cleanup[0][1]).is_err() {
            return Err(IngestError::Rejected(
                "invalid automatic visit departure".into(),
            ));
        }
        // DB removal verifies active owner-issued authority before preserving grants.
        return Ok(());
    }
    let source = super::ingest::extract_channel_id(event)
        .ok_or_else(|| IngestError::Rejected("missing task source".into()))?;
    let targets: Vec<_> = event
        .tags
        .iter()
        .map(|t| t.as_slice())
        .filter(|t| t.first().map(String::as_str) == Some("p"))
        .collect();
    if targets.len() != 1 {
        return Err(IngestError::Rejected(
            "source removal requires one target".into(),
        ));
    }
    let target = targets[0]
        .get(1)
        .and_then(|s| Hex64::parse(s).ok())
        .ok_or_else(|| IngestError::Rejected("invalid source removal target".into()))?;
    let bytes = target
        .decode()
        .map_err(|_| IngestError::Rejected("invalid source removal target".into()))?;
    state
        .db
        .revoke_task_history_source(tenant.community(), source, &bytes)
        .await
        .map_err(|_| IngestError::Internal("source history revocation unavailable".into()))
}
use crate::state::AppState;
use buzz_core::{
    kind::{KIND_LUCA_EXCHANGE, KIND_LUCA_TASK_HISTORY},
    tenant::TenantContext,
};
use luca_protocol::{
    ExchangeRecordV1, ExchangeTurnTag, Hex64, TaskHistoryGrantV1, TaskHistoryState,
};
use nostr::Event;
use serde_json::Value;
use std::sync::Arc;

/// Sidecar is HTTP historical-only; accepting it elsewhere could silently widen reads.
pub fn reject_unsupported(filters: &[Value]) -> Result<(), &'static str> {
    if filters
        .iter()
        .any(|v| v.get("task_history_grant").is_some() || v.get("task_history_reader").is_some())
    {
        Err("task history replay is supported only by exact HTTP query")
    } else {
        Ok(())
    }
}

fn envelope(event: &Event) -> Result<TaskHistoryGrantV1, String> {
    if event.kind.as_u16() as u32 != KIND_LUCA_TASK_HISTORY
        || !event.verify_id()
        || !event.verify_signature()
    {
        return Err("invalid task history signature".into());
    }
    let grant: TaskHistoryGrantV1 =
        serde_json::from_str(&event.content).map_err(|_| "invalid task history content")?;
    if event.pubkey.to_hex() != grant.owner.as_str() {
        return Err("task history issuer is not owner".into());
    }
    let mut actual: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
    let mut expected = grant.event_tags();
    actual.sort();
    expected.sort();
    if actual != expected {
        return Err("task history tags do not match audience".into());
    }
    Ok(grant)
}

fn reader_in_original_audience(event: &Event, reader: &Hex64) -> bool {
    event.pubkey.to_hex() == reader.as_str()
        || event.tags.iter().any(|tag| {
            let tag = tag.as_slice();
            tag.first().map(String::as_str) == Some("p")
                && tag.get(1).map(String::as_str) == Some(reader.as_str())
        })
}

async fn record(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    owner: &Hex64,
    exchange: &Hex64,
) -> Result<ExchangeRecordV1, String> {
    let events = state
        .db
        .query_events(&buzz_db::EventQuery {
            kinds: Some(vec![KIND_LUCA_EXCHANGE as i32]),
            pubkey: Some(owner.decode().map_err(|_| "invalid owner")?.to_vec()),
            d_tag: Some(exchange.as_str().into()),
            global_only: true,
            limit: Some(1),
            ..buzz_db::EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|_| "task exchange unavailable")?;
    let event = &events.first().ok_or("task exchange unavailable")?.event;
    let record = super::exchange::validate_exchange_record_envelope(event)?;
    if !event.verify_id()
        || !event.verify_signature()
        || &record.owner != owner
        || &record.exchange_id != exchange
    {
        return Err("invalid canonical task exchange".into());
    }
    Ok(record)
}

/// Validate and checkpoint permission before generic event storage. Failed storage
/// cannot grant reads: reads additionally require this exact signed canonical event.
pub async fn validate_write(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    event: &Event,
) -> Result<(), IngestError> {
    let grant = envelope(event).map_err(IngestError::Rejected)?;
    let head = record(state, tenant, &grant.owner, &grant.exchange_id)
        .await
        .map_err(IngestError::Rejected)?;
    grant
        .validate(&tenant.community().as_uuid().to_string(), &head)
        .map_err(|e| IngestError::Rejected(e.into()))?;
    let owner = grant
        .owner
        .decode()
        .map_err(|_| IngestError::Rejected("invalid owner".into()))?;
    let readers = grant
        .members
        .iter()
        .map(|key| key.decode().map(|bytes| bytes.to_vec()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| IngestError::Rejected("invalid audience".into()))?;
    for reader in &readers {
        if !state
            .db
            .is_agent_owner(tenant.community(), reader, &owner)
            .await
            .map_err(|_| IngestError::Internal("task owner lookup unavailable".into()))?
        {
            return Err(IngestError::Rejected(
                "task history audience is not owned".into(),
            ));
        }
    }
    let source = uuid::Uuid::parse_str(grant.conversation_id.as_str())
        .map_err(|_| IngestError::Rejected("invalid source".into()))?;
    state
        .db
        .write_task_history_grant(&buzz_db::task_history::Grant {
            community: tenant.community(),
            owner: &owner,
            exchange: grant.exchange_id.as_str(),
            source,
            readers: &readers,
            event: event.id.as_bytes(),
            revoke: grant.state == TaskHistoryState::Revoked,
        })
        .await
        .map_err(|_| {
            IngestError::Rejected("task history grant unavailable, immutable or revoked".into())
        })
}

/// Validate a closed, exact historical query shape. No unrecognized filter option
/// can be silently discarded by the Nostr filter deserializer.
fn query_shape(raw: &Value) -> Result<(Hex64, Hex64, String, Option<Hex64>), String> {
    let obj = raw.as_object().ok_or("invalid task history filter")?;
    if obj.keys().any(|key| {
        ![
            "kinds",
            "#h",
            "#exchange",
            "task_history_grant",
            "task_history_reader",
            "limit",
        ]
        .contains(&key.as_str())
    }) || raw.get("kinds") != Some(&serde_json::json!([9]))
        || raw
            .get("limit")
            .and_then(Value::as_u64)
            .is_some_and(|n| n == 0 || n > 100)
    {
        return Err("task history requires exact kind9 source/exchange filter without search or broad options".into());
    }
    fn one(raw: &Value, key: &str) -> Result<String, String> {
        let values = raw
            .get(key)
            .and_then(Value::as_array)
            .ok_or("missing task coordinate")?;
        if values.len() != 1 {
            return Err("task history requires exactly one source and exchange".into());
        }
        values[0]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "invalid task coordinate".into())
    }
    let owner = Hex64::parse(
        raw.get("task_history_grant")
            .and_then(Value::as_str)
            .ok_or("missing grant owner")?,
    )
    .map_err(|e| e.to_string())?;
    let exchange = Hex64::parse(one(raw, "#exchange")?).map_err(|e| e.to_string())?;
    let source = one(raw, "#h")?;
    uuid::Uuid::parse_str(&source).map_err(|_| "invalid task source")?;
    let reader = raw
        .get("task_history_reader")
        .map(|v| Hex64::parse(v.as_str().ok_or("invalid reader")?).map_err(|e| e.to_string()))
        .transpose()?;
    Ok((owner, exchange, source, reader))
}

/// The only exceptional read path. Bounded to the exchange's ten canonical turns;
/// no root brief, thread expansion, owner clarification or deleted body is returned.
pub async fn query(
    state: &Arc<AppState>,
    tenant: &TenantContext,
    actor: &nostr::PublicKey,
    raw: &Value,
) -> Result<Vec<Event>, String> {
    let (owner, exchange, source, requested_reader) = query_shape(raw)?;
    let actor_hex = Hex64::parse(actor.to_hex()).map_err(|e| e.to_string())?;
    let reader = requested_reader.unwrap_or_else(|| actor_hex.clone());
    if actor_hex != reader && actor_hex != owner {
        return Err("task reader substitution denied".into());
    }
    let rows = state
        .db
        .query_events(&buzz_db::EventQuery {
            kinds: Some(vec![KIND_LUCA_TASK_HISTORY as i32]),
            pubkey: Some(owner.decode().map_err(|_| "invalid owner")?.to_vec()),
            d_tag: Some(exchange.as_str().into()),
            global_only: true,
            limit: Some(1),
            ..buzz_db::EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|_| "task history grant unavailable")?;
    let grant_event = &rows.first().ok_or("task history grant unavailable")?.event;
    let grant = envelope(grant_event)?;
    let head = record(state, tenant, &owner, &exchange).await?;
    grant.validate(&tenant.community().as_uuid().to_string(), &head)?;
    if grant.state != TaskHistoryState::Active
        || grant.conversation_id.as_str() != source
        || !grant.members.contains(&reader)
    {
        return Err("task history audience or state denied".into());
    }
    let owner_bytes = owner.decode().map_err(|_| "invalid owner")?;
    let reader_bytes = reader.decode().map_err(|_| "invalid reader")?;
    if !state
        .db
        .is_agent_owner(tenant.community(), &reader_bytes, &owner_bytes)
        .await
        .map_err(|_| "task reader ownership unavailable")?
    {
        return Err("task reader is no longer owned by grant issuer".into());
    }
    let source = uuid::Uuid::parse_str(&source).map_err(|_| "invalid source")?;
    let authority = buzz_db::task_history::Grant {
        community: tenant.community(),
        owner: &owner_bytes,
        exchange: exchange.as_str(),
        source,
        readers: &[],
        event: grant_event.id.as_bytes(),
        revoke: false,
    };
    if !state
        .db
        .permits_task_history(&authority, &reader_bytes)
        .await
        .map_err(|_| "task history authority unavailable")?
    {
        return Err("task history revoked".into());
    }
    let turns = state
        .db
        .query_events(&buzz_db::EventQuery {
            kinds: Some(vec![9]),
            channel_id: Some(source),
            exchange_ids: Some(vec![exchange.as_str().into()]),
            limit: Some(100),
            ..buzz_db::EventQuery::for_community(tenant.community())
        })
        .await
        .map_err(|_| "task history unavailable")?;
    if turns.len() == 100 {
        return Err("task history exceeds canonical turn bound".into());
    }
    let mut events = Vec::new();
    for row in turns {
        let event = row.event;
        let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
        let valid = ExchangeTurnTag::find(&tags)
            .ok()
            .flatten()
            .is_some_and(|t| t.exchange_id == exchange);
        // Deleted turn tombstones deliberately have no valid signature/body.
        if !valid || !event.verify_id() || !event.verify_signature() {
            continue;
        }
        let h: Vec<_> = tags
            .iter()
            .filter(|t| t.first().map(String::as_str) == Some("h"))
            .collect();
        if h.len() != 1
            || h[0].get(1).map(String::as_str) != Some(grant.conversation_id.as_str())
            || !grant
                .members
                .iter()
                .any(|key| key.as_str() == event.pubkey.to_hex())
        {
            return Err("task history event scope invalid".into());
        }
        // Exchange membership is not evidence of private delivery to every
        // group member. Replay only the reader's own speech or explicit p audience.
        if !reader_in_original_audience(&event, &reader) {
            continue;
        }
        events.push(event);
    }
    if !state
        .db
        .permits_task_history(&authority, &reader_bytes)
        .await
        .map_err(|_| "task history authority unavailable")?
    {
        return Err("task history revoked during read".into());
    }
    if !state
        .db
        .is_agent_owner(tenant.community(), &reader_bytes, &owner_bytes)
        .await
        .map_err(|_| "task reader ownership unavailable")?
    {
        return Err("task reader ownership changed during read".into());
    }
    events.truncate(raw.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize);
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Uses the existing relay conformance harness (BUZZ_TEST_BACKEND=sqlite
    /// locally, or its configured PostgreSQL database). No mocked authorization.
    #[tokio::test]
    async fn canonical_replay_survives_visit_but_not_explicit_revocation() {
        use buzz_db::channel::{ChannelType, ChannelVisibility, MemberRole};
        use nostr::{EventBuilder, Keys, Kind, Tag};
        let state = crate::test_support::test_state().await;
        let tenant = crate::tenant::bind_community(&state.db, "relay.example")
            .await
            .unwrap();
        let community = tenant.community();
        let owner = Keys::generate();
        let sender = Keys::generate();
        let reader = Keys::generate();
        let stranger = Keys::generate();
        let owner_bytes = owner.public_key().to_bytes();
        for keys in [&owner, &sender, &reader] {
            state
                .db
                .ensure_user(community, &keys.public_key().to_bytes())
                .await
                .unwrap();
        }
        for keys in [&sender, &reader] {
            state
                .db
                .set_agent_owner(community, &keys.public_key().to_bytes(), &owner_bytes)
                .await
                .unwrap();
        }
        let source = state
            .db
            .create_channel(
                community,
                &format!("task-history-{}", uuid::Uuid::new_v4()),
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &owner_bytes,
                None,
            )
            .await
            .unwrap();
        for keys in [&sender, &reader] {
            state
                .db
                .add_member(
                    community,
                    source.id,
                    &keys.public_key().to_bytes(),
                    MemberRole::Member,
                    Some(&owner_bytes),
                )
                .await
                .unwrap();
        }
        let root = EventBuilder::new(Kind::Custom(9), "synthetic private owner brief")
            .tags([
                Tag::parse(["h", &source.id.to_string()]).unwrap(),
                Tag::parse(["p", &sender.public_key().to_hex()]).unwrap(),
            ])
            .sign_with_keys(&owner)
            .unwrap();
        state
            .db
            .insert_event(community, &root, Some(source.id))
            .await
            .unwrap();
        let record = ExchangeRecordV1::open(
            Hex64::parse(owner.public_key().to_hex()).unwrap(),
            vec![
                Hex64::parse(sender.public_key().to_hex()).unwrap(),
                Hex64::parse(reader.public_key().to_hex()).unwrap(),
            ],
            luca_protocol::OpaqueId::parse(source.id.to_string()).unwrap(),
            Hex64::parse(root.id.to_hex()).unwrap(),
            Hex64::parse(sender.public_key().to_hex()).unwrap(),
            None,
            nostr::Timestamp::now().as_secs(),
        )
        .unwrap();
        let head = EventBuilder::new(
            Kind::Custom(KIND_LUCA_EXCHANGE as u16),
            record.to_content().unwrap(),
        )
        .tags(
            record
                .event_tags()
                .into_iter()
                .map(|tag| Tag::parse(tag).unwrap()),
        )
        .sign_with_keys(&owner)
        .unwrap();
        super::super::exchange::validate_exchange_record(&state, &tenant, &head)
            .await
            .unwrap();
        state.db.insert_event(community, &head, None).await.unwrap();
        let grant = TaskHistoryGrantV1 {
            protocol: luca_protocol::TASK_HISTORY_PROTOCOL.into(),
            community_id: community.to_string(),
            owner: record.owner.clone(),
            exchange_id: record.exchange_id.clone(),
            conversation_id: record.conversation_id.clone(),
            members: record.members.clone(),
            state: TaskHistoryState::Active,
        };
        let grant_event = EventBuilder::new(
            Kind::Custom(KIND_LUCA_TASK_HISTORY as u16),
            serde_json::to_string(&grant).unwrap(),
        )
        .tags(
            grant
                .event_tags()
                .into_iter()
                .map(|tag| Tag::parse(tag).unwrap()),
        )
        .sign_with_keys(&owner)
        .unwrap();
        validate_write(&state, &tenant, &grant_event).await.unwrap();
        state
            .db
            .insert_event(community, &grant_event, None)
            .await
            .unwrap();
        let make_turn = |number: &str, target: String| {
            EventBuilder::new(Kind::Custom(9), format!("synthetic task turn {number}"))
                .tags([
                    Tag::parse(["h", record.conversation_id.as_str()]).unwrap(),
                    Tag::parse(["exchange", record.exchange_id.as_str(), number]).unwrap(),
                    Tag::parse(["p", target.as_str()]).unwrap(),
                ])
                .sign_with_keys(&sender)
                .unwrap()
        };
        let shared = make_turn("1", reader.public_key().to_hex());
        let owner_only = make_turn("2", owner.public_key().to_hex());
        for turn in [&shared, &owner_only] {
            assert!(super::super::exchange::authorize_exchange_message(
                &state,
                &tenant,
                turn,
                9,
                Some(source.id)
            )
            .await
            .unwrap()
            .is_some());
            state
                .db
                .insert_event(community, turn, Some(source.id))
                .await
                .unwrap();
        }
        state
            .db
            .remove_member_with_task_history(
                community,
                source.id,
                &reader.public_key().to_bytes(),
                &owner_bytes,
                Some(record.exchange_id.as_str()),
            )
            .await
            .unwrap();
        assert!(!state
            .db
            .is_member(community, source.id, &reader.public_key().to_bytes())
            .await
            .unwrap());
        let filter = serde_json::json!({"kinds":[9],"#h":[record.conversation_id.as_str()],"#exchange":[record.exchange_id.as_str()],"task_history_grant":record.owner.as_str(),"task_history_reader":reader.public_key().to_hex(),"limit":100});
        let events = query(&state, &tenant, &reader.public_key(), &filter)
            .await
            .unwrap();
        assert_eq!(
            events.iter().map(|event| event.id).collect::<Vec<_>>(),
            vec![shared.id]
        );
        assert!(!events
            .iter()
            .any(|event| event.id == root.id || event.id == owner_only.id));
        assert!(query(&state, &tenant, &stranger.public_key(), &filter)
            .await
            .is_err());
        // Explicit removal is meaningful even though automatic membership ended.
        state
            .db
            .remove_member(
                community,
                source.id,
                &reader.public_key().to_bytes(),
                &owner_bytes,
            )
            .await
            .unwrap();
        assert!(query(&state, &tenant, &reader.public_key(), &filter)
            .await
            .is_err());
        state
            .db
            .soft_delete_event(community, grant_event.id.as_bytes())
            .await
            .unwrap();
        state
            .db
            .add_member(
                community,
                source.id,
                &reader.public_key().to_bytes(),
                MemberRole::Member,
                Some(&owner_bytes),
            )
            .await
            .unwrap();
        assert!(validate_write(&state, &tenant, &grant_event).await.is_err());
        assert!(query(&state, &tenant, &reader.public_key(), &filter)
            .await
            .is_err());
    }
    #[test]
    fn group_membership_never_substitutes_for_original_recipient() {
        let author = nostr::Keys::generate();
        let reader = Hex64::parse("a".repeat(64)).unwrap();
        let event = nostr::EventBuilder::new(nostr::Kind::Custom(9), "synthetic body")
            .tag(nostr::Tag::parse(["p", reader.as_str()]).unwrap())
            .sign_with_keys(&author)
            .unwrap();
        assert!(reader_in_original_audience(&event, &reader));
        assert!(reader_in_original_audience(
            &event,
            &Hex64::parse(author.public_key().to_hex()).unwrap()
        ));
        assert!(!reader_in_original_audience(
            &event,
            &Hex64::parse("b".repeat(64)).unwrap()
        ));
    }
    #[test]
    fn signed_grant_cannot_change_owner_or_add_room_scope() {
        let keys = nostr::Keys::generate();
        let grant = TaskHistoryGrantV1 {
            protocol: luca_protocol::TASK_HISTORY_PROTOCOL.into(),
            community_id: uuid::Uuid::new_v4().to_string(),
            owner: Hex64::parse(keys.public_key().to_hex()).unwrap(),
            exchange_id: Hex64::parse("a".repeat(64)).unwrap(),
            conversation_id: luca_protocol::OpaqueId::parse(uuid::Uuid::new_v4().to_string())
                .unwrap(),
            members: vec![
                Hex64::parse("b".repeat(64)).unwrap(),
                Hex64::parse("c".repeat(64)).unwrap(),
            ],
            state: TaskHistoryState::Active,
        };
        let tags = grant
            .event_tags()
            .into_iter()
            .map(|tag| nostr::Tag::parse(tag).unwrap())
            .collect::<Vec<_>>();
        let builder = nostr::EventBuilder::new(
            nostr::Kind::Custom(KIND_LUCA_TASK_HISTORY as u16),
            serde_json::to_string(&grant).unwrap(),
        )
        .tags(tags);
        let valid = builder.clone().sign_with_keys(&keys).unwrap();
        assert!(envelope(&valid).is_ok());
        let wrong_owner = builder
            .clone()
            .sign_with_keys(&nostr::Keys::generate())
            .unwrap();
        assert!(envelope(&wrong_owner).is_err());
        let expanded = builder
            .tag(nostr::Tag::parse(["h", grant.conversation_id.as_str()]).unwrap())
            .sign_with_keys(&keys)
            .unwrap();
        assert!(envelope(&expanded).is_err());
    }
    #[test]
    fn broad_or_search_shapes_fail_closed() {
        let good = serde_json::json!({"kinds":[9],"#h":["00000000-0000-0000-0000-000000000001"],"#exchange":["a".repeat(64)],"task_history_grant":"b".repeat(64),"limit":100});
        assert!(query_shape(&good).is_ok());
        for (key, value) in [
            ("search", serde_json::json!("anything")),
            ("#h", serde_json::json!([])),
            ("kinds", serde_json::json!([9, 1])),
            ("limit", serde_json::json!(101)),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(query_shape(&bad).is_err());
        }
        assert!(reject_unsupported(&[good]).is_err());
        assert!(reject_unsupported(&[serde_json::json!({"kinds":[9]})]).is_ok());
    }
}

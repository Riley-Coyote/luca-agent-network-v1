//! Passive, actor-filtered projections over durable canonical exchange events.
//! No read here creates membership, dispatches work, or consumes agent turns.

use std::collections::{BTreeMap, BTreeSet};

use luca_protocol::{ExchangeRecordV1, ExchangeTurnTag, Hex64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::exchange_relay::{verified_exchange_head, AppExchangeRelay, ExchangeRelay};

const MAX_PAGE: usize = 100;

/// Stable scope resolved by the relay from the request host, not a URL hash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxScope {
    pub community_id: String,
    pub owner_pubkey: Hex64,
}

/// Composite durable cursor. Same-second records are not skipped.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxCursor {
    pub scope: InboxScope,
    pub until: u64,
    pub before_id: Hex64,
}

/// Query filters narrow the host-derived actor; they never select authority.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InboxQuery {
    pub resident_pubkey: Option<Hex64>,
    pub correspondent_pubkey: Option<Hex64>,
    pub exchange_id: Option<Hex64>,
    pub cursor: Option<InboxCursor>,
    pub limit: Option<usize>,
}

/// One task reference, retaining the original source and lifecycle semantics.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxTask {
    pub logical_task_id: Hex64,
    pub current_attempt_id: Hex64,
    pub logical_root_event_id: Hex64,
    pub write_capabilities: InboxWriteCapabilities,
    /// Task-history entitlement never permits broad source transcript reads.
    pub history_access: &'static str,
    pub correspondence_id: Option<String>,
    pub record: ExchangeRecordV1,
    pub record_event_id: Hex64,
    pub record_updated_at: u64,
    /// Closed or expired exchange transport is not a successful task outcome.
    pub outcome: &'static str,
}

/// UI affordances only: every mutation independently revalidates authority.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxWriteCapabilities {
    pub reply: bool,
    pub continuation: bool,
    pub new_message: bool,
}

/// A bounded scan page; an empty filtered page may still have a next cursor.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InboxPage {
    pub scope: InboxScope,
    pub tasks: Vec<InboxTask>,
    pub next_cursor: Option<InboxCursor>,
    #[serde(skip_serializing)]
    pub scanned: usize,
    pub history_source: &'static str,
    /// Some source scopes could not be currently authorized; no preview leaks.
    pub partial: bool,
    #[serde(skip_serializing)]
    pub unavailable_source_count: usize,
}

/// Versioned symmetric identity, independent of names, source rooms and runtime.
pub(crate) fn correspondence_id(scope: &InboxScope, members: &[Hex64]) -> Option<String> {
    if members.len() != 2 || members[0] == members[1] {
        return None;
    }
    let mut pair = [members[0].as_str(), members[1].as_str()];
    pair.sort_unstable();
    let tuple = serde_json::json!([
        "luca.correspondence.v1",
        scope.community_id,
        scope.owner_pubkey,
        pair[0],
        pair[1]
    ]);
    Some(format!(
        "correspondence-v1-{}",
        hex::encode(Sha256::digest(tuple.to_string().as_bytes()))
    ))
}

/// Resolve the active scope without persisting mutable endpoint coordinates.
pub(crate) async fn active_scope(app: &AppHandle) -> Result<InboxScope, String> {
    let state = app.state::<crate::app_state::AppState>();
    let owner_pubkey = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|error| error.to_string())?;
    let relay = crate::relay::relay_ws_url_with_override(&state);
    let response = state
        .http_client
        .get(crate::relay::relay_http_base_url(&relay))
        .header("Accept", "application/nostr+json")
        .send()
        .await
        .map_err(|_| "inbox community identity is unavailable")?;
    if !response.status().is_success() {
        return Err("inbox community identity is unavailable".into());
    }
    let doc: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "inbox community identity is malformed")?;
    let community_id = doc
        .get("community_id")
        .and_then(serde_json::Value::as_str)
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .ok_or("relay does not advertise a stable inbox community identity")?
        .to_string();
    if crate::relay::relay_ws_url_with_override(&state) != relay
        || state.signing_keys()?.public_key().to_hex() != owner_pubkey.as_str()
    {
        return Err("inbox workspace changed during read".into());
    }
    Ok(InboxScope {
        community_id,
        owner_pubkey,
    })
}

fn authorized(record: &ExchangeRecordV1, scope: &InboxScope, actor: &Hex64) -> bool {
    record.owner == scope.owner_pubkey
        && (actor == &scope.owner_pubkey || record.members.contains(actor))
}

pub(super) fn source_matches(event: &nostr::Event, conversation: &str) -> bool {
    let sources: Vec<_> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("h"))
        .collect();
    sources.len() == 1 && sources[0].get(1).map(String::as_str) == Some(conversation)
}

async fn actor_check(app: &AppHandle, actor: &Hex64, scope: &InboxScope) -> Result<(), String> {
    if actor == &scope.owner_pubkey {
        return Ok(());
    }
    let app = app.clone();
    let actor = actor.clone();
    tokio::task::spawn_blocking(move || {
        AppExchangeRelay::new(app)
            .owned_residents()
            .map_err(|error| error.to_string())?
            .contains(&actor)
            .then_some(())
            .ok_or_else(|| "inbox actor is not an owned resident".to_owned())
    })
    .await
    .map_err(|_| "inbox actor check failed")?
}

/// Read canonical heads with owner/resident ACL before any projection.
pub(crate) async fn query_for_actor(
    app: &AppHandle,
    actor: Hex64,
    query: InboxQuery,
) -> Result<InboxPage, String> {
    let scope = active_scope(app).await?;
    actor_check(app, &actor, &scope).await?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=MAX_PAGE).contains(&limit) {
        return Err("inbox limit must be 1 through 100".into());
    }
    if query
        .cursor
        .as_ref()
        .is_some_and(|cursor| cursor.scope != scope)
    {
        return Err("inbox cursor belongs to another owner or community".into());
    }
    // A resident cannot substitute a different viewer through a model argument.
    if actor != scope.owner_pubkey
        && query
            .resident_pubkey
            .as_ref()
            .is_some_and(|resident| resident != &actor)
    {
        return Err("residents may read only their own inbox".into());
    }
    let mut filter = serde_json::json!({
        "kinds": [buzz_core_pkg::kind::KIND_LUCA_EXCHANGE],
        "authors": [scope.owner_pubkey.as_str()], "limit": limit,
    });
    if let Some(resident) = query
        .resident_pubkey
        .as_ref()
        .or_else(|| (actor != scope.owner_pubkey).then_some(&actor))
    {
        filter["#p"] = serde_json::json!([resident.as_str()]);
    }
    if let Some(exchange) = &query.exchange_id {
        filter["#d"] = serde_json::json!([exchange.as_str()]);
    }
    if let Some(cursor) = &query.cursor {
        filter["until"] = serde_json::json!(cursor.until);
        filter["before_id"] = serde_json::json!(cursor.before_id.as_str());
    }
    let state = app.state::<crate::app_state::AppState>();
    let mut events = crate::relay::query_relay(&state, &[filter]).await?;
    events.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    let scanned = events.len();
    let next_cursor = if scanned == limit {
        events
            .last()
            .map(|event| {
                Ok::<InboxCursor, String>(InboxCursor {
                    scope: scope.clone(),
                    until: event.created_at.as_secs(),
                    before_id: Hex64::parse(event.id.to_hex())
                        .map_err(|error| error.to_string())?,
                })
            })
            .transpose()?
    } else {
        None
    };
    let mut tasks = Vec::new();
    let mut seen = BTreeSet::new();
    let mut source_access = BTreeMap::new();
    let mut unavailable_source_count = 0;
    for event in events {
        let record =
            ExchangeRecordV1::from_content(&event.content).map_err(|error| error.to_string())?;
        let head = verified_exchange_head(&event, &record.exchange_id, &scope.owner_pubkey)
            .map_err(|error| error.to_string())?;
        if !authorized(&record, &scope, &actor)
            || query
                .resident_pubkey
                .as_ref()
                .is_some_and(|key| !record.members.contains(key))
            || query
                .correspondent_pubkey
                .as_ref()
                .is_some_and(|key| !record.members.contains(key))
            || !seen.insert(record.exchange_id.clone())
        {
            continue;
        }
        let source = record.conversation_id.as_str().to_owned();
        let may_read = if let Some(allowed) = source_access.get(&source) {
            *allowed
        } else {
            let app = app.clone();
            let conversation = record.conversation_id.clone();
            let actor = actor.clone();
            let allowed = tokio::task::spawn_blocking(move || {
                // Current source authority, not historical exchange membership.
                // Never proxy an owner-authenticated room read to a faded guest.
                super::runtime_task_delivery::verified_conversation_members(&app, &conversation)
                    .is_ok_and(|members| members.contains(&actor))
            })
            .await
            .map_err(|_| "inbox source authorization failed")?;
            source_access.insert(source, allowed);
            if !allowed {
                unavailable_source_count += 1;
            }
            allowed
        };
        let history_access = if may_read {
            "current_source"
        } else if super::agent_inbox_history::read_granted_turns(app, &actor, &record, 1)
            .await
            .is_ok()
        {
            "task_history"
        } else {
            continue;
        };
        tasks.push(InboxTask {
            logical_task_id: record.exchange_id.clone(),
            current_attempt_id: record.exchange_id.clone(),
            logical_root_event_id: record.root_event_id.clone(),
            write_capabilities: InboxWriteCapabilities {
                reply: false,
                continuation: false,
                new_message: false,
            },
            history_access,
            correspondence_id: correspondence_id(&scope, &record.members),
            record,
            record_event_id: head.event_id,
            record_updated_at: head.created_at,
            outcome: "unknown",
        });
    }
    // Recheck at release, after potentially many source lookups. Revocation
    // during a page scan must not leak the already-projected task metadata.
    for (source, allowed) in &mut source_access {
        if !*allowed {
            continue;
        }
        let app_copy = app.clone();
        let source_id =
            luca_protocol::OpaqueId::parse(source).map_err(|error| error.to_string())?;
        let actor_copy = actor.clone();
        *allowed = tokio::task::spawn_blocking(move || {
            super::runtime_task_delivery::verified_conversation_members(&app_copy, &source_id)
                .is_ok_and(|members| members.contains(&actor_copy))
        })
        .await
        .map_err(|_| "inbox source authorization failed")?;
        if !*allowed {
            unavailable_source_count += 1;
        }
    }
    let mut retained = Vec::new();
    for mut task in tasks {
        if source_access.get(task.record.conversation_id.as_str()) == Some(&true) {
            task.history_access = "current_source";
            let writable = actor == scope.owner_pubkey && task.correspondence_id.is_some();
            task.write_capabilities = InboxWriteCapabilities {
                reply: writable,
                continuation: writable,
                new_message: writable,
            };
            retained.push(task);
        } else if super::agent_inbox_history::read_granted_turns(app, &actor, &task.record, 1)
            .await
            .is_ok()
        {
            task.history_access = "task_history";
            retained.push(task);
        }
    }
    let mut tasks = retained;
    super::agent_inbox_lineage::project_tasks(app, &scope, &mut tasks).await?;
    actor_check(app, &actor, &scope).await?;
    if active_scope(app).await? != scope {
        return Err("inbox workspace changed during read".into());
    }
    Ok(InboxPage {
        scope,
        tasks,
        next_cursor,
        scanned,
        history_source: "canonical_relay",
        partial: unavailable_source_count != 0,
        unavailable_source_count,
    })
}

/// Owner-facing passive query. The actor comes from native signing identity.
#[tauri::command]
pub(crate) async fn query_agent_inbox(
    app: AppHandle,
    query: InboxQuery,
) -> Result<InboxPage, String> {
    let actor = active_scope(&app).await?.owner_pubkey;
    query_for_actor(&app, actor, query).await
}

#[path = "agent_inbox_task.rs"]
mod task;
pub(crate) use task::read_task_for_actor;
pub(crate) use task::read_task_page_for_actor;

/// Owner inspection of an exact task; never marks a resident's work handled.
#[tauri::command]
pub(crate) async fn read_agent_inbox_task(
    app: AppHandle,
    exchange_id: String,
    cursor: Option<InboxCursor>,
) -> Result<serde_json::Value, String> {
    let actor = active_scope(&app).await?.owner_pubkey;
    read_task_page_for_actor(
        &app,
        actor,
        Hex64::parse(exchange_id).map_err(|error| error.to_string())?,
        cursor,
    )
    .await
}

#[cfg(test)]
#[path = "agent_inbox_pagination_tests.rs"]
mod pagination_tests;
#[cfg(test)]
#[path = "agent_inbox_tests.rs"]
mod tests;

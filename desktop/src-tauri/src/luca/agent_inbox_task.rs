use super::*;

/// Read only signed turns tagged for this exact task and original source.
/// Returns canonical events, not copied or reauthored transcript rows.
pub(crate) async fn read_task_for_actor(
    app: &AppHandle,
    actor: Hex64,
    exchange_id: Hex64,
) -> Result<serde_json::Value, String> {
    read_task_page_for_actor(app, actor, exchange_id, None).await
}

/// Read one owner-reply page while retaining the bounded original task turns.
pub(crate) async fn read_task_page_for_actor(
    app: &AppHandle,
    actor: Hex64,
    exchange_id: Hex64,
    cursor: Option<InboxCursor>,
) -> Result<serde_json::Value, String> {
    // Authorize the selected attempt before resolving any related history.
    let mut result = read_attempt_page(app, actor.clone(), exchange_id.clone(), cursor).await?;
    let scope: InboxScope = serde_json::from_value(result["scope"].clone())
        .map_err(|_| "inbox task scope is malformed")?;
    let resolved =
        super::super::agent_inbox_lineage::resolve_current(app, &scope, &exchange_id).await?;
    let mut events: Vec<nostr::Event> = serde_json::from_value(result["events"].clone())
        .map_err(|_| "inbox task events are malformed")?;
    let mut partial = result["partial"].as_bool().unwrap_or(true);
    let mut unavailable = Vec::new();
    let mut released_attempts = vec![(
        exchange_id.clone(),
        result["task"]["historyAccess"].as_str() == Some("current_source"),
    )];
    let mut root_available = result["rootAvailable"].as_bool().unwrap_or(false)
        && exchange_id == resolved.logical_record.exchange_id;
    for attempt in &resolved.attempts {
        if attempt.exchange_id == exchange_id {
            continue;
        }
        match read_attempt_page(app, actor.clone(), attempt.exchange_id.clone(), None).await {
            Ok(page) => {
                released_attempts.push((
                    attempt.exchange_id.clone(),
                    page["task"]["historyAccess"].as_str() == Some("current_source"),
                ));
                partial |= page["partial"].as_bool().unwrap_or(true);
                if attempt.exchange_id == resolved.logical_record.exchange_id {
                    root_available = page["rootAvailable"].as_bool().unwrap_or(false);
                }
                let rows: Vec<nostr::Event> = serde_json::from_value(page["events"].clone())
                    .map_err(|_| "inbox attempt events are malformed")?;
                events.extend(rows);
                if attempt.exchange_id == resolved.current_record.exchange_id {
                    result["task"] = page["task"].clone();
                }
            }
            Err(_) => {
                partial = true;
                unavailable.push(attempt.exchange_id.clone());
            }
        }
    }
    let mut ids = BTreeSet::new();
    events.retain(|event| ids.insert(event.id));
    events.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    // Recheck every authority that admitted events to the merged response.
    // A later successful attempt must not conceal revocation of an earlier one.
    for (attempt_id, current_source) in &released_attempts {
        if !current_source {
            let record = resolved
                .attempts
                .iter()
                .find(|attempt| &attempt.exchange_id == attempt_id)
                .ok_or("inbox released attempt is outside verified lineage")?;
            super::super::agent_inbox_history::read_granted_turns(app, &actor, record, 1).await?;
        }
    }
    if released_attempts
        .iter()
        .any(|(_, current_source)| *current_source)
    {
        let app_copy = app.clone();
        let actor_copy = actor.clone();
        let source = resolved.logical_record.conversation_id.clone();
        tokio::task::spawn_blocking(move || {
            super::super::runtime_task_delivery::verified_conversation_members(&app_copy, &source)?
                .contains(&actor_copy)
                .then_some(())
                .ok_or_else(|| {
                    "inbox source authorization was revoked during task merge".to_owned()
                })
        })
        .await
        .map_err(|_| "inbox source authorization recheck failed")??;
    }
    actor_check(app, &actor, &scope).await?;
    if active_scope(app).await? != scope {
        return Err("inbox workspace changed during read".into());
    }
    result["events"] =
        serde_json::to_value(events).map_err(|_| "inbox history serialization failed")?;
    result["logicalTaskId"] = serde_json::json!(resolved.logical_record.exchange_id);
    result["currentAttemptId"] = serde_json::json!(resolved.current_record.exchange_id);
    result["logicalRootEventId"] = serde_json::json!(resolved.logical_record.root_event_id);
    result["task"]["logicalTaskId"] = result["logicalTaskId"].clone();
    result["task"]["currentAttemptId"] = result["currentAttemptId"].clone();
    result["task"]["logicalRootEventId"] = result["logicalRootEventId"].clone();
    if unavailable.contains(&resolved.current_record.exchange_id) {
        result["task"]["writeCapabilities"] =
            serde_json::json!({"reply":false,"continuation":false,"newMessage":false});
    }
    result["writeCapabilities"] = result["task"]["writeCapabilities"].clone();
    result["historyAccess"] = result["task"]["historyAccess"].clone();
    result["currentAttemptAvailable"] =
        serde_json::json!(!unavailable.contains(&resolved.current_record.exchange_id));
    result["readAttemptId"] = result["task"]["record"]["exchange_id"].clone();
    result["attemptIds"] = serde_json::json!(resolved
        .attempts
        .iter()
        .map(|attempt| &attempt.exchange_id)
        .collect::<Vec<_>>());
    result["unavailableAttemptIds"] = serde_json::json!(unavailable);
    result["rootAvailable"] = serde_json::json!(root_available);
    result["partial"] = serde_json::json!(partial || !root_available);
    Ok(result)
}

async fn read_attempt_page(
    app: &AppHandle,
    actor: Hex64,
    exchange_id: Hex64,
    cursor: Option<InboxCursor>,
) -> Result<serde_json::Value, String> {
    let page = query_for_actor(
        app,
        actor.clone(),
        InboxQuery {
            exchange_id: Some(exchange_id.clone()),
            limit: Some(1),
            ..InboxQuery::default()
        },
    )
    .await?;
    let task = page
        .tasks
        .first()
        .ok_or("inbox task is unavailable or unauthorized")?;
    if cursor
        .as_ref()
        .is_some_and(|cursor| cursor.scope != page.scope)
    {
        return Err("inbox task cursor belongs to another owner or community".into());
    }
    let state = app.state::<crate::app_state::AppState>();
    if task.history_access == "task_history" {
        let mut events =
            super::super::agent_inbox_history::read_granted_turns(app, &actor, &task.record, 100)
                .await?;
        for event in &events {
            let tags: Vec<_> = event
                .tags
                .iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect();
            if !event.verify_id()
                || !event.verify_signature()
                || !source_matches(event, task.record.conversation_id.as_str())
                || !ExchangeTurnTag::find(&tags)
                    .map_err(|error| error.to_string())?
                    .is_some_and(|tag| tag.exchange_id == exchange_id)
                || !task
                    .record
                    .members
                    .iter()
                    .any(|key| key.as_str() == event.pubkey.to_hex())
            {
                return Err("task history returned an invalid canonical turn".into());
            }
        }
        events.sort_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        actor_check(app, &actor, &page.scope).await?;
        super::super::agent_inbox_history::read_granted_turns(app, &actor, &task.record, 1).await?;
        if active_scope(app).await? != page.scope {
            return Err("inbox workspace changed during read".into());
        }
        return Ok(
            serde_json::json!({"scope":page.scope,"task":task,"events":events,
            "historySource":"canonical_relay","historyAccess":"task_history","partial":true,
            "rootAvailable":false,"nextOwnerReplyCursor":null,
            "unavailableSections":["original_source_brief","owner_clarifications","clarification_results"]}),
        );
    }
    let events = crate::relay::query_relay(
        &state,
        &[serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
            "#h": [task.record.conversation_id.as_str()],
            "#exchange": [exchange_id.as_str()], "limit": 100,
        })],
    )
    .await?;
    let mut verified = Vec::new();
    for event in events {
        let tags: Vec<Vec<String>> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let tag = ExchangeTurnTag::find(&tags).map_err(|error| error.to_string())?;
        if !event.verify_id()
            || !event.verify_signature()
            || !source_matches(&event, task.record.conversation_id.as_str())
            || !tag.is_some_and(|tag| tag.exchange_id == exchange_id)
            || !task
                .record
                .members
                .iter()
                .any(|key| key.as_str() == event.pubkey.to_hex())
        {
            return Err("inbox task contains an invalid signed turn".into());
        }
        verified.push(event);
    }
    let turn_ids: BTreeSet<String> = verified.iter().map(|event| event.id.to_hex()).collect();
    let root_events = crate::relay::query_relay(
        &state,
        &[serde_json::json!({
            "ids": [task.record.root_event_id.as_str()],
            "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
            "#h": [task.record.conversation_id.as_str()], "limit": 1,
        })],
    )
    .await?;
    let mut root_available = false;
    for root in root_events {
        if root.id.to_hex() != task.record.root_event_id.as_str()
            || !root.verify_id()
            || !root.verify_signature()
            || !source_matches(&root, task.record.conversation_id.as_str())
            || !(root.pubkey.to_hex() == page.scope.owner_pubkey.as_str()
                || task
                    .record
                    .members
                    .iter()
                    .any(|key| key.as_str() == root.pubkey.to_hex()))
        {
            return Err("inbox task root is invalid".into());
        }
        root_available = true;
        verified.push(root);
    }
    let mut next_owner_reply_cursor = None;
    let mut owner_reply_targets = BTreeMap::new();
    if !turn_ids.is_empty() {
        let mut filter = serde_json::json!({
            "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
            "authors": [page.scope.owner_pubkey.as_str()],
            "#h": [task.record.conversation_id.as_str()],
            "#e": turn_ids.iter().collect::<Vec<_>>(), "limit": 100,
        });
        if let Some(cursor) = cursor {
            filter["until"] = serde_json::json!(cursor.until);
            filter["before_id"] = serde_json::json!(cursor.before_id.as_str());
        }
        let replies = crate::relay::query_relay(&state, &[filter]).await?;
        if replies.len() == 100 {
            if let Some(last) = replies.iter().min_by(|a, b| {
                a.created_at
                    .cmp(&b.created_at)
                    .then_with(|| b.id.cmp(&a.id))
            }) {
                next_owner_reply_cursor = Some(InboxCursor {
                    scope: page.scope.clone(),
                    until: last.created_at.as_secs(),
                    before_id: Hex64::parse(last.id.to_hex()).map_err(|error| error.to_string())?,
                });
            }
        }
        for reply in replies {
            // A shared owner request root can mint several exchanges. Only
            // an exact reply to this task's signed turn disambiguates a send.
            let target: Vec<_> = reply
                .tags
                .iter()
                .map(|tag| tag.as_slice())
                .filter(|tag| {
                    tag.first().map(String::as_str) == Some("e")
                        && tag.get(3).map(String::as_str) == Some("reply")
                })
                .collect();
            if target.len() != 1 || !target[0].get(1).is_some_and(|id| turn_ids.contains(id)) {
                continue;
            }
            let parent = verified
                .iter()
                .find(|event| target[0].get(1) == Some(&event.id.to_hex()))
                .ok_or("inbox owner reply parent is unavailable")?;
            let parent_routing =
                super::super::managed_dispatch_routing::routing_from_event(parent)?;
            let routing = super::super::managed_dispatch_routing::routing_from_event(&reply)?;
            let expected_root = parent_routing
                .root_event_id
                .or(parent_routing.reply_event_id)
                .unwrap_or_else(|| parent.id.to_hex());
            if routing
                .root_event_id
                .as_deref()
                .or(routing.reply_event_id.as_deref())
                != Some(expected_root.as_str())
                || routing.trigger_p_tags != [parent.pubkey.to_hex()]
            {
                continue;
            }
            if reply.pubkey.to_hex() != page.scope.owner_pubkey.as_str()
                || !reply.verify_id()
                || !reply.verify_signature()
                || !source_matches(&reply, task.record.conversation_id.as_str())
            {
                return Err("inbox owner reply is invalid".into());
            }
            owner_reply_targets.insert(reply.id.to_hex(), parent.pubkey.to_hex());
            verified.push(reply);
        }
    }
    let mut clarification_results_partial = false;
    if !owner_reply_targets.is_empty() {
        let results = crate::relay::query_relay(
            &state,
            &[serde_json::json!({
                "kinds": [buzz_core_pkg::kind::KIND_STREAM_MESSAGE],
                "#h": [task.record.conversation_id.as_str()],
                "#e": owner_reply_targets.keys().collect::<Vec<_>>(),
                "authors": task.record.members.iter().map(Hex64::as_str).collect::<Vec<_>>(),
                "limit": 100,
            })],
        )
        .await?;
        clarification_results_partial = results.len() == 100;
        for result in results {
            let routing = super::super::managed_dispatch_routing::routing_from_event(&result)?;
            let Some(parent) = routing.reply_event_id.as_ref() else {
                continue;
            };
            let Some(expected_author) = owner_reply_targets.get(parent) else {
                continue;
            };
            if &result.pubkey.to_hex() != expected_author
                || routing.trigger_p_tags != [page.scope.owner_pubkey.as_str().to_owned()]
            {
                continue;
            }
            if !result.verify_id()
                || !result.verify_signature()
                || !source_matches(&result, task.record.conversation_id.as_str())
            {
                return Err("inbox clarification result is invalid".into());
            }
            verified.push(result);
        }
    }
    let mut ids = BTreeSet::new();
    verified.retain(|event| ids.insert(event.id));
    verified.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    if active_scope(app).await? != page.scope {
        return Err("inbox workspace changed during read".into());
    }
    actor_check(app, &actor, &page.scope).await?;
    let app_copy = app.clone();
    let conversation = task.record.conversation_id.clone();
    tokio::task::spawn_blocking(move || {
        super::super::runtime_task_delivery::verified_conversation_members(
            &app_copy,
            &conversation,
        )?
        .contains(&actor)
        .then_some(())
        .ok_or_else(|| "inbox source authorization was revoked".to_owned())
    })
    .await
    .map_err(|_| "inbox source authorization failed")??;
    Ok(
        serde_json::json!({ "scope": page.scope, "task": task, "events": verified,
        "historySource": "canonical_relay", "partial": !root_available || next_owner_reply_cursor.is_some() || clarification_results_partial,
        "rootAvailable": root_available, "nextOwnerReplyCursor": next_owner_reply_cursor }),
    )
}

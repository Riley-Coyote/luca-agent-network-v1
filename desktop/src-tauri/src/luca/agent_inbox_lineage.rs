//! Bounded, passive logical-task lineage reconstructed from signed relay events.

use std::collections::{BTreeMap, BTreeSet};

use luca_protocol::{ExchangeRecordV1, Hex64};
use tauri::{AppHandle, Manager};

use super::agent_inbox::{source_matches, InboxScope};
use super::exchange_relay::verified_exchange_head;

const MAX_ATTEMPTS: usize = 100;

pub(super) fn continuation_index(logical: &Hex64) -> String {
    format!("inbox-continuation:{}", logical.as_str())
}

/// Verified original task and its current bounded execution attempt.
pub(crate) struct ResolvedTask {
    pub logical_record: ExchangeRecordV1,
    pub current_record: ExchangeRecordV1,
    pub attempts: Vec<ExchangeRecordV1>,
}

fn continuation(event: &nostr::Event) -> Result<Option<(Hex64, Hex64)>, String> {
    let tags: Vec<_> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("luca-task-reply"))
        .collect();
    if tags.len() > 1 {
        return Err("inbox lineage has ambiguous task correlation".into());
    }
    let Some(tag) = tags.first() else {
        return Ok(None);
    };
    if tag.len() != 4 || tag[3] != "continue" {
        return Ok(None);
    }
    let logical = Hex64::parse(&tag[1]).map_err(|e| e.to_string())?;
    let indexes: Vec<_> = event
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("d"))
        .collect();
    if indexes.len() != 1 || indexes[0].len() != 2 || indexes[0][1] != continuation_index(&logical)
    {
        return Err("inbox continuation is missing its exact signed lineage index".into());
    }
    Ok(Some((
        logical,
        Hex64::parse(&tag[2]).map_err(|e| e.to_string())?,
    )))
}

/// The relay supports single-letter tag filters, not arbitrary task tags.
/// Ignore unrelated correspondence, but retain strict ambiguity checks when
/// any correlation tag claims this logical task.
fn continuation_for(
    event: &nostr::Event,
    logical: &Hex64,
) -> Result<Option<(Hex64, Hex64)>, String> {
    if !event.tags.iter().any(|tag| {
        let raw = tag.as_slice();
        raw.first().map(String::as_str) == Some("luca-task-reply")
            && raw.get(1).map(String::as_str) == Some(logical.as_str())
    }) {
        return Ok(None);
    }
    continuation(event)
}

fn source_scan_filter(owner: &Hex64, sources: &[&str], logical_ids: &[Hex64]) -> serde_json::Value {
    serde_json::json!({ "kinds":[9], "authors":[owner.as_str()], "#h":sources,
        "#d":logical_ids.iter().map(continuation_index).collect::<Vec<_>>(), "limit":MAX_ATTEMPTS })
}

fn matches_task(record: &ExchangeRecordV1, original: &ExchangeRecordV1) -> bool {
    record.owner == original.owner
        && record.members == original.members
        && record.conversation_id == original.conversation_id
        && record.opened_by == original.opened_by
}

fn validate_link(
    root: &nostr::Event,
    record: &ExchangeRecordV1,
    original: &ExchangeRecordV1,
    parent: &ExchangeRecordV1,
) -> Result<(), String> {
    let expected = Some((original.exchange_id.clone(), parent.exchange_id.clone()));
    let recipients: Vec<_> = root
        .tags
        .iter()
        .map(|tag| tag.as_slice())
        .filter(|tag| tag.first().map(String::as_str) == Some("p"))
        .collect();
    if !root.verify_id()
        || !root.verify_signature()
        || root.kind != nostr::Kind::Custom(9)
        || root.pubkey.to_hex() != original.owner.as_str()
        || root.id.to_hex() != record.root_event_id.as_str()
        || !source_matches(root, original.conversation_id.as_str())
        || continuation(root)? != expected
        || !matches_task(record, original)
        || !matches_task(parent, original)
        || record.parent_exchange_id.is_some()
        || record.depth != 1
        || record.exchange_id == parent.exchange_id
        || recipients.len() != 1
        || !recipients[0]
            .get(1)
            .is_some_and(|key| original.members.iter().any(|member| member.as_str() == key))
    {
        return Err("inbox lineage canonical continuation does not match its task".into());
    }
    // Parsing a canonical record verifies the ID derivation, not merely its tags.
    ExchangeRecordV1::from_content(&record.to_content().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn records(
    app: &AppHandle,
    scope: &InboxScope,
    ids: &[Hex64],
) -> Result<BTreeMap<Hex64, ExchangeRecordV1>, String> {
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let state = app.state::<crate::app_state::AppState>();
    let events = crate::relay::query_relay(&state, &[serde_json::json!({
        "kinds":[buzz_core_pkg::kind::KIND_LUCA_EXCHANGE], "authors":[scope.owner_pubkey.as_str()],
        "#d":ids.iter().map(Hex64::as_str).collect::<Vec<_>>(), "limit": MAX_ATTEMPTS + 1
    })]).await?;
    let mut result = BTreeMap::new();
    for event in events {
        let record = ExchangeRecordV1::from_content(&event.content).map_err(|e| e.to_string())?;
        if !ids.contains(&record.exchange_id) {
            return Err("inbox lineage record filter mismatch".into());
        }
        let head = verified_exchange_head(&event, &record.exchange_id, &scope.owner_pubkey)
            .map_err(|e| e.to_string())?;
        if result
            .insert(record.exchange_id.clone(), head.record)
            .is_some()
        {
            return Err("inbox lineage returned duplicate canonical heads".into());
        }
    }
    Ok(result)
}

/// Resolve exact current authority without mutation. Saturated or branched
/// lineage fails closed; callers must not authorize a send from a partial scan.
pub(crate) async fn resolve_current(
    app: &AppHandle,
    scope: &InboxScope,
    exchange_id: &Hex64,
) -> Result<ResolvedTask, String> {
    let selected = records(app, scope, std::slice::from_ref(exchange_id))
        .await?
        .remove(exchange_id)
        .ok_or("inbox lineage task is unavailable")?;
    let state = app.state::<crate::app_state::AppState>();
    let roots = crate::relay::query_relay(
        &state,
        &[serde_json::json!({
            "ids":[selected.root_event_id.as_str()], "kinds":[9], "limit":1
        })],
    )
    .await?;
    let logical_id = if let Some(root) = roots.first() {
        if !root.verify_id()
            || !root.verify_signature()
            || root.id.to_hex() != selected.root_event_id.as_str()
            || !source_matches(root, selected.conversation_id.as_str())
            || !(root.pubkey.to_hex() == scope.owner_pubkey.as_str()
                || selected
                    .members
                    .iter()
                    .any(|key| key.as_str() == root.pubkey.to_hex()))
        {
            return Err("inbox lineage root is invalid".into());
        }
        continuation(root)?
            .map(|(logical, _)| logical)
            .unwrap_or_else(|| exchange_id.clone())
    } else {
        exchange_id.clone()
    };
    let original = if &logical_id == exchange_id {
        selected.clone()
    } else {
        records(app, scope, std::slice::from_ref(&logical_id))
            .await?
            .remove(&logical_id)
            .ok_or("inbox lineage original task is unavailable")?
    };
    if !matches_task(&selected, &original) {
        return Err("inbox lineage task scope mismatch".into());
    }
    if logical_id != *exchange_id {
        let roots = crate::relay::query_relay(
            &state,
            &[serde_json::json!({
                "ids":[original.root_event_id.as_str()], "kinds":[9], "limit":1
            })],
        )
        .await?;
        if let Some(root) = roots.first() {
            if !root.verify_id()
                || !root.verify_signature()
                || root.id.to_hex() != original.root_event_id.as_str()
                || !source_matches(root, original.conversation_id.as_str())
                || continuation(root)?.is_some()
                || !(root.pubkey.to_hex() == scope.owner_pubkey.as_str()
                    || original
                        .members
                        .iter()
                        .any(|key| key.as_str() == root.pubkey.to_hex()))
            {
                return Err("inbox lineage logical root is not an original task".into());
            }
        }
    }
    let mut filter = source_scan_filter(
        &scope.owner_pubkey,
        &[original.conversation_id.as_str()],
        std::slice::from_ref(&logical_id),
    );
    let mut roots = Vec::new();
    let mut complete = false;
    let mut seen_roots = BTreeSet::new();
    for _ in 0..10 {
        let mut page = crate::relay::query_relay(&state, &[filter.clone()]).await?;
        page.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        let saturated = page.len() >= MAX_ATTEMPTS;
        if let Some(last) = page.last() {
            filter["until"] = serde_json::json!(last.created_at.as_secs());
            filter["before_id"] = serde_json::json!(last.id.to_hex());
        }
        for root in page {
            if !seen_roots.insert(root.id) {
                return Err("inbox lineage cursor did not advance".into());
            }
            roots.push(root);
        }
        if !saturated {
            complete = true;
            break;
        }
    }
    if !complete {
        return Err(
            "inbox_lineage_partial: bounded lineage scan is incomplete; sending is disabled".into(),
        );
    }
    let mut candidates = Vec::new();
    for root in roots {
        if let Some((_, parent)) = continuation_for(&root, &logical_id)? {
            let root_id = Hex64::parse(root.id.to_hex()).map_err(|e| e.to_string())?;
            let id = luca_protocol::derive_exchange_id(&root_id, &original.members, None)
                .map_err(|e| e.to_string())?;
            candidates.push((root, parent, id));
        }
    }
    let ids: Vec<_> = candidates.iter().map(|(_, _, id)| id.clone()).collect();
    if ids.len() >= MAX_ATTEMPTS {
        return Err("inbox_lineage_partial: task exceeds the bounded attempt history".into());
    }
    let heads = records(app, scope, &ids).await?;
    let mut attempts = vec![original.clone()];
    let mut consumed = BTreeSet::new();
    loop {
        let parent = attempts.last().ok_or("inbox lineage original is missing")?;
        let next: Vec<_> = candidates
            .iter()
            .filter(|(_, prior, id)| prior == &parent.exchange_id && !consumed.contains(id))
            .filter_map(|(root, _, id)| heads.get(id).map(|record| (root, record)))
            .collect();
        if next.len() > 1 {
            return Err("inbox lineage has conflicting continuation branches".into());
        }
        let Some((root, record)) = next.first() else {
            break;
        };
        validate_link(root, record, &original, parent)?;
        consumed.insert(record.exchange_id.clone());
        attempts.push((**record).clone());
    }
    if heads.keys().any(|id| !consumed.contains(id)) {
        return Err("inbox lineage contains an unconnected canonical continuation".into());
    }
    if !attempts
        .iter()
        .any(|record| &record.exchange_id == exchange_id)
    {
        return Err("inbox lineage selected attempt is not connected to its original task".into());
    }
    let current_record = attempts
        .last()
        .cloned()
        .ok_or("inbox lineage original is missing")?;
    if super::agent_inbox::active_scope(app).await? != *scope {
        return Err("inbox scope changed during lineage read".into());
    }
    Ok(ResolvedTask {
        logical_record: original,
        current_record,
        attempts,
    })
}

/// Batch root lookup keeps ordinary inbox pages free of per-row record reads.
/// Only actual continuation roots need the bounded lineage verification.
pub(crate) async fn project_tasks(
    app: &AppHandle,
    scope: &InboxScope,
    tasks: &mut [super::agent_inbox::InboxTask],
) -> Result<(), String> {
    if tasks.is_empty() {
        return Ok(());
    }
    let state = app.state::<crate::app_state::AppState>();
    let roots = crate::relay::query_relay(
        &state,
        &[serde_json::json!({
            "ids":tasks.iter().map(|task| task.record.root_event_id.as_str()).collect::<Vec<_>>(),
            "kinds":[9], "limit":MAX_ATTEMPTS
        })],
    )
    .await?;
    let sources: BTreeSet<_> = tasks
        .iter()
        .map(|task| task.record.conversation_id.as_str())
        .collect();
    let logical_ids: Vec<_> = tasks
        .iter()
        .map(|task| task.record.exchange_id.clone())
        .collect();
    let continuation_roots = crate::relay::query_relay(
        &state,
        &[source_scan_filter(
            &scope.owner_pubkey,
            &sources.into_iter().collect::<Vec<_>>(),
            &logical_ids,
        )],
    )
    .await?;
    for task in tasks {
        let selected_continuation = roots
            .iter()
            .find(|root| root.id.to_hex() == task.record.root_event_id.as_str())
            .map(continuation)
            .transpose()?
            .flatten()
            .is_some();
        let mut has_continuation = false;
        for root in &continuation_roots {
            has_continuation |= continuation_for(root, &task.record.exchange_id)?.is_some();
        }
        if !selected_continuation && !has_continuation && continuation_roots.len() < MAX_ATTEMPTS {
            continue;
        }
        let resolved = resolve_current(app, scope, &task.record.exchange_id).await?;
        task.logical_task_id = resolved.logical_record.exchange_id;
        task.logical_root_event_id = resolved.logical_record.root_event_id;
        task.current_attempt_id = resolved.current_record.exchange_id;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn fixture() -> (Keys, ExchangeRecordV1) {
        let owner = Keys::parse(&"71".repeat(32)).unwrap();
        let key = |byte: &str| {
            Hex64::parse(Keys::parse(&byte.repeat(32)).unwrap().public_key().to_hex()).unwrap()
        };
        let opener = key("72");
        let record = ExchangeRecordV1::open(
            Hex64::parse(owner.public_key().to_hex()).unwrap(),
            vec![opener.clone(), key("73")],
            luca_protocol::OpaqueId::parse("synthetic-source").unwrap(),
            Hex64::parse("ab".repeat(32)).unwrap(),
            opener,
            None,
            100,
        )
        .unwrap();
        (owner, record)
    }

    fn next(
        owner: &Keys,
        original: &ExchangeRecordV1,
        marker: &str,
    ) -> (nostr::Event, ExchangeRecordV1) {
        let root = EventBuilder::new(Kind::Custom(9), "synthetic continuation")
            .tags([
                Tag::parse(["d", continuation_index(&original.exchange_id).as_str()]).unwrap(),
                Tag::parse(["h", original.conversation_id.as_str()]).unwrap(),
                Tag::parse(["p", original.members[1].as_str()]).unwrap(),
                Tag::parse([
                    "luca-task-reply",
                    original.exchange_id.as_str(),
                    original.exchange_id.as_str(),
                    marker,
                ])
                .unwrap(),
            ])
            .sign_with_keys(owner)
            .unwrap();
        let record = ExchangeRecordV1::open(
            original.owner.clone(),
            original.members.clone(),
            original.conversation_id.clone(),
            Hex64::parse(root.id.to_hex()).unwrap(),
            original.opened_by.clone(),
            None,
            200,
        )
        .unwrap();
        (root, record)
    }

    #[test]
    fn canonical_fresh_owner_root_links_same_task_without_v1_parent() {
        let (owner, original) = fixture();
        let (root, record) = next(&owner, &original, "continue");
        assert!(validate_link(&root, &record, &original, &original).is_ok());
        assert!(record.parent_exchange_id.is_none());
        assert_ne!(record.exchange_id, original.exchange_id);
    }

    #[test]
    fn tags_alone_wrong_source_pair_opener_or_author_cannot_link() {
        let (owner, original) = fixture();
        let (root, record) = next(&owner, &original, "continue");
        for field in ["source", "pair", "opener", "root", "parent"] {
            let mut bad = record.clone();
            match field {
                "source" => {
                    bad.conversation_id = luca_protocol::OpaqueId::parse("other-source").unwrap()
                }
                "pair" => bad.members.reverse(),
                "opener" => {
                    bad.opened_by = bad
                        .members
                        .iter()
                        .find(|key| **key != bad.opened_by)
                        .unwrap()
                        .clone()
                }
                "root" => bad.root_event_id = original.root_event_id.clone(),
                _ => bad.parent_exchange_id = Some(original.exchange_id.clone()),
            }
            assert!(
                validate_link(&root, &bad, &original, &original).is_err(),
                "{field}"
            );
        }
        let stranger = Keys::parse(&"74".repeat(32)).unwrap();
        let (root, record) = next(&stranger, &original, "continue");
        assert!(validate_link(&root, &record, &original, &original).is_err());
    }

    #[test]
    fn ordinary_reply_is_not_a_continuation() {
        let (owner, original) = fixture();
        let (root, _) = next(&owner, &original, "reply");
        assert!(continuation(&root).unwrap().is_none());
    }

    #[test]
    fn continuation_requires_matching_signed_index() {
        let (owner, original) = fixture();
        let (root, _) = next(&owner, &original, "continue");
        for value in [None, Some("inbox-continuation:wrong")] {
            let tags = root
                .tags
                .iter()
                .filter(|tag| tag.as_slice().first().map(String::as_str) != Some("d"))
                .cloned();
            let mut builder = EventBuilder::new(Kind::Custom(9), "continuation").tags(tags);
            if let Some(value) = value {
                builder = builder.tag(Tag::parse(["d", value]).unwrap());
            }
            assert!(continuation(&builder.sign_with_keys(&owner).unwrap()).is_err());
        }
    }

    #[test]
    fn source_scan_uses_supported_filters_and_ignores_unrelated_tasks() {
        let (owner, original) = fixture();
        let filter = source_scan_filter(
            &original.owner,
            &[original.conversation_id.as_str()],
            std::slice::from_ref(&original.exchange_id),
        );
        assert!(filter.get("#luca-task-reply").is_none());
        assert_eq!(filter["#h"][0], original.conversation_id.as_str());
        assert_eq!(filter["authors"][0], original.owner.as_str());
        assert_eq!(filter["#d"][0], continuation_index(&original.exchange_id));
        let (root, _) = next(&owner, &original, "continue");
        assert!(continuation_for(&root, &original.exchange_id)
            .unwrap()
            .is_some());
        assert!(
            continuation_for(&root, &Hex64::parse("ef".repeat(32)).unwrap())
                .unwrap()
                .is_none()
        );
        // Distinct payload avoids exact-tag deduplication by the builder.
        let ambiguous = EventBuilder::new(Kind::Custom(9), "ambiguous")
            .tags(
                root.tags.iter().cloned().chain([Tag::parse([
                    "luca-task-reply",
                    original.exchange_id.as_str(),
                    "bad-parent",
                    "continue",
                ])
                .unwrap()]),
            )
            .sign_with_keys(&owner)
            .unwrap();
        assert!(continuation_for(&ambiguous, &original.exchange_id).is_err());
    }
}

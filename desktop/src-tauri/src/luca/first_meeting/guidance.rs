//! Conversation guidance only. These receipts never grant access or prove work.

use super::{kickoff, record};
use crate::{
    app_state::AppState,
    data_dir::BuzzPathExt,
    luca::{
        conversation_context::active_scope,
        resident_proposals::{verify_origin, ResidentProposalScope},
    },
};
use luca_protocol::{Hex64, SafeU53};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum GuidanceTopic {
    CompanionSetup,
    CollaborationPreferences,
    HarnessDelegation,
    OtherAgents,
    GroupChats,
    BrainKnowledge,
    CompanionControls,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TopicStatus {
    Introduced,
    Deferred,
    Declined,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct TopicProgress {
    topic: GuidanceTopic,
    status: TopicStatus,
}

/// Fixed-size conversational metadata; never a user model or permission ledger.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct MeetingGuidance {
    revision: u64,
    topics: Vec<TopicProgress>,
    first_useful_outcome: bool,
}

/// Model-reported conversational progress. The host derives the conversation
/// and resident from the live broker scope; neither is selectable in this input.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GuidanceUpdate {
    expected_revision: u64,
    #[serde(default)]
    topics: Vec<TopicProgress>,
    #[serde(default)]
    first_useful_outcome: bool,
    #[serde(default)]
    complete: bool,
    #[serde(default)]
    owner_goal_event_id: Option<Hex64>,
}

impl GuidanceUpdate {
    fn validate(&self) -> Result<(), String> {
        SafeU53::new(self.expected_revision).map_err(|_| "Invalid guidance revision.")?;
        let unique: HashSet<_> = self.topics.iter().map(|entry| entry.topic).collect();
        if self.topics.len() > 7 || unique.len() != self.topics.len() {
            return Err("Give each guidance topic at most once.".into());
        }
        Ok(())
    }
}

fn apply_update(
    meeting: &mut record::FirstMeetingStateV1,
    input: GuidanceUpdate,
    now: &str,
) -> Result<(), String> {
    input.validate()?;
    let progress = meeting.guidance.clone().unwrap_or_default();
    if progress.revision != input.expected_revision {
        return Err("First-meeting guidance changed; use the current revision.".into());
    }
    let revision = progress
        .revision
        .checked_add(1)
        .ok_or("Guidance revision exhausted.")?;
    SafeU53::new(revision).map_err(|_| "Guidance revision exhausted.")?;
    let mut next = progress;
    next.revision = revision;
    for topic in input.topics {
        if let Some(entry) = next
            .topics
            .iter_mut()
            .find(|entry| entry.topic == topic.topic)
        {
            *entry = topic;
        } else {
            next.topics.push(topic);
        }
    }
    next.first_useful_outcome |= input.first_useful_outcome;
    meeting.guidance = Some(next);
    if input.complete && meeting.completed_at.is_none() {
        meeting.completed_at = Some(now.to_owned());
    }
    Ok(())
}

/// Save bounded guidance for the canonical Luca DM after exact live-origin and
/// membership checks. This operation never enables features, reads a source,
/// changes a grant, or saves a personal preference as memory.
pub(crate) fn update_guidance(
    app: &AppHandle,
    scope: &ResidentProposalScope,
    input: GuidanceUpdate,
) -> Result<serde_json::Value, String> {
    input.validate()?;
    verify_origin(app, scope)?;
    if kickoff::canonical_resident(app)? != scope.resident.as_str() {
        return Err("First-meeting guidance belongs to Luca's private conversation.".into());
    }
    let state = app.state::<AppState>();
    let (owner, relay) = active_scope(&state)?;
    if owner != scope.owner {
        return Err("The active owner changed.".into());
    }
    tauri::async_runtime::block_on(kickoff::verify_dm(
        &state,
        owner.as_str(),
        scope.resident.as_str(),
        scope.conversation.as_str(),
    ))?;
    let root = app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| "Local storage is unavailable.")?;
    let _guard = record::STATE_LOCK
        .lock()
        .map_err(|_| "First-meeting guidance is busy.")?;
    let mut meeting = record::load(&root, &owner, &relay, scope.conversation.as_str())
        .ok_or("No first meeting is recorded for this conversation.")?;
    if meeting.resident != scope.resident.as_str() {
        return Err("The first meeting belongs to another resident.".into());
    }
    let owner_goal_event_id = input.owner_goal_event_id.clone();
    apply_update(&mut meeting, input, &chrono::Utc::now().to_rfc3339())?;
    verify_origin(app, scope)?;
    if active_scope(&state)? != (owner.clone(), relay.clone()) {
        return Err("The active workspace changed.".into());
    }
    record::save(&root, &owner, &relay, scope.conversation.as_str(), &meeting)?;
    drop(_guard);
    let owner_goal = owner_goal_event_id
        .map(|event| super::owner_goal::carry_current_owner_goal(app, scope, &event));
    Ok(serde_json::json!({
        "status":"recorded",
        "guidance":meeting.guidance,
        "completed":meeting.completed_at.is_some(),
        "permissionsChanged":false,
        "memorySaved":false,
        "ownerGoal":owner_goal,
        "message":"Guidance does not enable features or prove completed work. Only the optional ownerGoal receipt establishes whether an exact owner goal was retained; no personal memory note was saved."
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_is_fixed_scope_and_rejects_duplicate_topics_or_grant_fields() {
        let duplicate: GuidanceUpdate = serde_json::from_value(serde_json::json!({
            "expectedRevision":0,"topics":[
                {"topic":"brain_knowledge","status":"declined"},
                {"topic":"brain_knowledge","status":"introduced"}
            ]
        }))
        .unwrap();
        assert!(duplicate.validate().is_err());
        for field in ["resident", "conversation", "grants", "notes", "sourcePath"] {
            let mut value = serde_json::json!({"expectedRevision":0});
            value[field] = serde_json::json!("not allowed");
            assert!(serde_json::from_value::<GuidanceUpdate>(value).is_err());
        }
    }

    #[test]
    fn guidance_merges_without_losing_declines_and_rejects_stale_retries() {
        let mut meeting: record::FirstMeetingStateV1 = serde_json::from_value(serde_json::json!({
            "schema":record::FIRST_MEETING_STATE_SCHEMA,"owner":"a".repeat(64),
            "relay":"scope","conversation":"conversation","resident":"b".repeat(64),
            "trigger_event_id":"opening","started_at":"2026-11-02T00:00:00Z"
        }))
        .unwrap();
        let first = serde_json::json!({"expectedRevision":0,"topics":[
            {"topic":"brain_knowledge","status":"declined"}
        ]});
        apply_update(
            &mut meeting,
            serde_json::from_value(first.clone()).unwrap(),
            "now",
        )
        .unwrap();
        assert!(apply_update(
            &mut meeting,
            serde_json::from_value(first).unwrap(),
            "later"
        )
        .is_err());
        apply_update(
            &mut meeting,
            serde_json::from_value(serde_json::json!({
                "expectedRevision":1,"firstUsefulOutcome":true,"topics":[
                    {"topic":"companion_setup","status":"introduced"}
                ]
            }))
            .unwrap(),
            "later",
        )
        .unwrap();
        let progress = meeting.guidance.as_ref().unwrap();
        assert_eq!(progress.topics.len(), 2);
        assert_eq!(progress.topics[0].status, TopicStatus::Declined);
        assert!(progress.first_useful_outcome);
        assert!(meeting.completed_at.is_none());
        let root = tempfile::tempdir().unwrap();
        record::save(
            root.path(),
            &meeting.owner,
            &meeting.relay,
            &meeting.conversation,
            &meeting,
        )
        .unwrap();
        meeting = record::load(
            root.path(),
            &meeting.owner,
            &meeting.relay,
            &meeting.conversation,
        )
        .unwrap();
        let restored = meeting.guidance.as_ref().unwrap();
        assert_eq!(restored.revision, 2);
        assert_eq!(restored.topics[0].status, TopicStatus::Declined);
        apply_update(
            &mut meeting,
            serde_json::from_value(serde_json::json!({
                "expectedRevision":2,"complete":true
            }))
            .unwrap(),
            "done",
        )
        .unwrap();
        assert_eq!(meeting.completed_at.as_deref(), Some("done"));
    }
}

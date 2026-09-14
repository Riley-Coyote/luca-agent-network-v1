//! Bounded first-meeting presentation context. None of this grants dispatch,
//! filesystem access, or permission to publish on behalf of a resident.

mod context;
mod kickoff;
pub(crate) use context::for_dispatch;
pub(crate) use kickoff::{begin, StartResult};

use std::collections::HashSet;

use nostr::Event;

pub(crate) const FIRST_MEETING_MARKER: &str = "polyphonic-onboarding.first-meeting.v1";
const FIRST_MEETING_PROMPT: &str = include_str!("first_meeting_prompt.md");
const MAX_OWNER_REPLIES: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MeetingPhase {
    Opening,
    Reply(usize),
}

fn includes_recent_references(phase: MeetingPhase) -> bool {
    phase == MeetingPhase::Opening
}

pub(crate) fn has_tag(event: &Event, name: &str, value: &str) -> bool {
    event.tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().map(String::as_str) == Some(name)
            && values.get(1).map(String::as_str) == Some(value)
    })
}

/// Interpret a bounded verified owner history only after exact dispatch and
/// canonical-DM authority have been checked by the caller. Missing or partial
/// history never creates a fresh meeting. `trigger` must be in this history.
pub(crate) fn phase_from_history(
    events: &[Event],
    owner: &str,
    resident: &str,
    conversation: &str,
    trigger: &str,
) -> Option<MeetingPhase> {
    let mut seen = HashSet::new();
    let mut ordinary = Vec::new();
    for event in events {
        if !event.verify_id()
            || !event.verify_signature()
            || event.kind != nostr::Kind::Custom(9)
            || event.pubkey.to_hex() != owner
            || !has_tag(event, "h", conversation)
        {
            return None;
        }
        if !seen.insert(event.id) {
            continue;
        }
        if event
            .tags
            .iter()
            .any(|tag| tag.as_slice().first().map(String::as_str) == Some("e"))
            || event.content.trim() == "!cancel"
        {
            continue;
        }
        ordinary.push(event);
    }
    let starts: Vec<_> = ordinary
        .iter()
        .filter(|event| has_tag(event, "client", FIRST_MEETING_MARKER))
        .collect();
    let [start] = starts.as_slice() else {
        return None;
    };
    if start.content != "Meet Luca" || !has_tag(start, "p", resident) {
        return None;
    }
    let current = ordinary.iter().find(|event| event.id.to_hex() == trigger)?;
    if !has_tag(current, "p", resident) {
        return None;
    }
    // Any earlier ordinary owner history identifies an established room, not
    // a new first meeting. Equal timestamps are possible for quick replies.
    if ordinary
        .iter()
        .any(|event| event.created_at < start.created_at)
    {
        return None;
    }
    let reply_count = ordinary.len().saturating_sub(1);
    if reply_count > MAX_OWNER_REPLIES {
        return None;
    }
    if current.id == start.id {
        (reply_count == 0).then_some(MeetingPhase::Opening)
    } else {
        Some(MeetingPhase::Reply(reply_count))
    }
}

pub(crate) fn brief(phase: MeetingPhase) -> String {
    let position = match phase {
        MeetingPhase::Opening => "This is the opening turn. If permission-checked recent-session references are attached, read the bounded visible content before composing your greeting. Otherwise use the no-source greeting; do not imply a read happened.".to_owned(),
        MeetingPhase::Reply(index) => format!("This is owner reply {index} of the bounded first-meeting window. Follow the conversation, including any request to skip or start work; do not repeat answered questions or declined offers."),
    };
    format!("{FIRST_MEETING_PROMPT}\n{position}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    fn message(keys: &Keys, resident: &str, second: u64, content: &str, start: bool) -> Event {
        let mut tags = vec![
            Tag::parse(["h", "room"]).unwrap(),
            Tag::parse(["p", resident]).unwrap(),
        ];
        if start {
            tags.push(Tag::parse(["client", FIRST_MEETING_MARKER]).unwrap());
        }
        EventBuilder::new(Kind::Custom(9), content)
            .tags(tags)
            .custom_created_at(Timestamp::from(second))
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn first_meeting_is_bounded_and_deduplicates_signed_history() {
        let owner = Keys::generate();
        let pubkey = owner.public_key().to_hex();
        let resident = Keys::generate().public_key().to_hex();
        let start = message(&owner, &resident, 100, "Meet Luca", true);
        let mut events = vec![start.clone(), start.clone()];
        assert_eq!(
            phase_from_history(&events, &pubkey, &resident, "room", &start.id.to_hex()),
            Some(MeetingPhase::Opening)
        );
        for n in 1..=6 {
            let reply = message(
                &owner,
                &resident,
                100 + n as u64,
                &format!("Goal {n}"),
                false,
            );
            let trigger = reply.id.to_hex();
            events.push(reply);
            assert_eq!(
                phase_from_history(&events, &pubkey, &resident, "room", &trigger),
                (n <= 5).then_some(MeetingPhase::Reply(n))
            );
        }
    }

    #[test]
    fn incomplete_foreign_or_established_history_never_restarts_a_meeting() {
        let owner = Keys::generate();
        let pubkey = owner.public_key().to_hex();
        let resident = Keys::generate().public_key().to_hex();
        let start = message(&owner, &resident, 100, "Meet Luca", true);
        let reply = message(&owner, &resident, 101, "Help me", false);
        let trigger = reply.id.to_hex();
        assert_eq!(
            phase_from_history(&[reply.clone()], &pubkey, &resident, "room", &trigger),
            None
        );
        assert_eq!(
            phase_from_history(
                &[start.clone(), reply.clone()],
                &pubkey,
                &resident,
                "other",
                &trigger
            ),
            None
        );
        assert_eq!(
            phase_from_history(
                &[start.clone(), reply.clone()],
                &resident,
                &pubkey,
                "room",
                &trigger
            ),
            None
        );
        assert_eq!(
            phase_from_history(
                &[
                    message(&owner, &resident, 90, "Earlier work", false),
                    start.clone(),
                    reply.clone()
                ],
                &pubkey,
                &resident,
                "room",
                &trigger
            ),
            None
        );
        let mut corrupted = start;
        corrupted.content = "changed after signing".into();
        assert_eq!(
            phase_from_history(&[corrupted, reply], &pubkey, &resident, "room", &trigger),
            None
        );
    }

    #[test]
    fn prompt_describes_objectives_and_preserves_ordinary_authority() {
        let opening = brief(MeetingPhase::Opening);
        assert!(opening.len() < 8 * 1024);
        assert!(opening.contains("before composing your greeting"));
        assert!(opening.contains("no-source greeting"));
        assert!(!opening.contains("Do not inspect their history before"));
        assert!(opening.contains("never grants permissions"));
        assert!(opening.contains("existing continuity"));
        assert!(!opening.contains("Hi Riley"));
    }

    #[test]
    fn recent_discovery_runs_on_opening_not_after_the_owner_answers() {
        assert!(includes_recent_references(MeetingPhase::Opening));
        for index in 1..=MAX_OWNER_REPLIES {
            assert!(!includes_recent_references(MeetingPhase::Reply(index)));
        }
        assert!(FIRST_MEETING_PROMPT.contains("at most 64 KiB"));
        assert!(FIRST_MEETING_PROMPT.contains("at most three transcript tails"));
        assert!(FIRST_MEETING_PROMPT.contains("never imply you read"));
    }
}

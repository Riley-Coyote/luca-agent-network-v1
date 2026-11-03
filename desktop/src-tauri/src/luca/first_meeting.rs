//! Bounded first-meeting presentation context. None of this grants dispatch,
//! filesystem access, or permission to publish on behalf of a resident.

mod context;
mod guidance;
mod kickoff;
mod owner_goal;
mod record;
pub(crate) use context::for_dispatch;
pub(crate) use guidance::{update_guidance, GuidanceUpdate};
pub(crate) use kickoff::{begin, StartResult};

use std::collections::HashSet;

use nostr::Event;

pub(crate) const FIRST_MEETING_MARKER: &str = "polyphonic-onboarding.first-meeting.v1";
const FIRST_MEETING_PROMPT: &str = include_str!("first_meeting_prompt.md");

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
    if current.id == start.id {
        (reply_count == 0).then_some(MeetingPhase::Opening)
    } else {
        Some(MeetingPhase::Reply(reply_count))
    }
}

pub(crate) fn brief(phase: MeetingPhase) -> String {
    let position = match phase {
        MeetingPhase::Opening => "This is the opening turn. If permission-checked recent-session references are attached, read the bounded visible content before composing your greeting. Otherwise welcome the owner naturally and offer useful collaboration; do not imply a read happened or recite a disclaimer about not knowing them.".to_owned(),
        MeetingPhase::Reply(index) => format!("This is owner reply {index} in this ongoing first meeting, not a deadline or questionnaire. Opening session references are listed as identifiers only; do not re-read them or repeat discovery. Newly approved context, if supplied by the host, is separate. Follow the conversation, including any request to skip or start work; do not repeat answered questions or declined offers. Never restart the greeting."),
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
    fn first_meeting_deduplicates_signed_history_without_a_five_reply_deadline() {
        let owner = Keys::generate();
        let pubkey = owner.public_key().to_hex();
        let resident = Keys::generate().public_key().to_hex();
        let start = message(&owner, &resident, 100, "Meet Luca", true);
        let mut events = vec![start.clone(), start.clone()];
        assert_eq!(
            phase_from_history(&events, &pubkey, &resident, "room", &start.id.to_hex()),
            Some(MeetingPhase::Opening)
        );
        for n in 1..=12 {
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
                Some(MeetingPhase::Reply(n))
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
            phase_from_history(
                std::slice::from_ref(&reply),
                &pubkey,
                &resident,
                "room",
                &trigger
            ),
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
        // Comfortably inside the 16 KiB ceiling `record::compose_brief`
        // enforces once the setup name, sources and references are appended.
        assert!(opening.len() < 10 * 1024, "{}", opening.len());
        assert!(opening.contains("before composing your greeting"));
        assert!(opening.contains("welcome the owner naturally"));
        assert!(!opening.contains("Do not inspect their history before"));
        assert!(opening.contains("never grants permissions"));
        assert!(opening.contains("existing continuity"));
        assert!(!opening.contains("Hi Riley"));
    }

    #[test]
    fn recognition_guidance_requires_evidence_and_owner_correction() {
        assert!(
            FIRST_MEETING_PROMPT.contains("corrections, rejected approaches, repeated requests")
        );
        assert!(FIRST_MEETING_PROMPT.contains("duplicated or forked transcript content"));
        assert!(
            FIRST_MEETING_PROMPT.contains("With one example, describe that example, not a habit")
        );
        assert!(FIRST_MEETING_PROMPT.contains("distinguish what you saw from what you suspect"));
        assert!(
            FIRST_MEETING_PROMPT.contains("If they correct your reading, revise it immediately")
        );
        assert!(FIRST_MEETING_PROMPT.contains("Do not surface unrelated intimate details"));
    }

    #[test]
    fn recent_discovery_runs_on_opening_not_after_the_owner_answers() {
        assert!(includes_recent_references(MeetingPhase::Opening));
        for index in 1..=12 {
            assert!(!includes_recent_references(MeetingPhase::Reply(index)));
            // Every reply turn says so in the brief itself, not only by the
            // absence of references, so a reply never re-runs discovery.
            let reply = brief(MeetingPhase::Reply(index));
            assert!(reply.contains("Opening session references"));
            assert!(reply.contains("do not re-read them or repeat discovery"));
        }
        assert!(FIRST_MEETING_PROMPT.contains("at most 64 KiB"));
        assert!(FIRST_MEETING_PROMPT.contains("at most three transcript tails"));
        assert!(FIRST_MEETING_PROMPT.contains("never imply you read"));
    }

    /// Nothing is connected during setup any more, so the opening turn has to
    /// carry the offer instead of a read that never happened.
    #[test]
    fn the_no_source_opening_offers_to_look_rather_than_waiting_to_be_asked() {
        assert!(FIRST_MEETING_PROMPT.contains("If no references are attached"));
        assert!(FIRST_MEETING_PROMPT.contains("Greet them by the name they entered"));
        assert!(
            FIRST_MEETING_PROMPT.contains("ask what they hope this collaboration makes possible")
        );
        assert!(FIRST_MEETING_PROMPT.contains("offer once"));
        assert!(
            FIRST_MEETING_PROMPT.contains("existing Brain review or repository proposal surface")
        );
        assert!(FIRST_MEETING_PROMPT.contains(
            "If they decline the look, or bring you a task instead, start that work immediately"
        ));
        assert!(FIRST_MEETING_PROMPT.contains("open from something real you found"));
        assert!(FIRST_MEETING_PROMPT.contains("Catalog counts are not proof of reading"));
        assert!(FIRST_MEETING_PROMPT.contains("use the available runtime tools"));
        assert!(FIRST_MEETING_PROMPT.contains("Brain is optional retained knowledge"));
        assert!(FIRST_MEETING_PROMPT.contains("Do not require a Brain connection or import"));
        assert!(FIRST_MEETING_PROMPT.contains("do not silently index or retain"));
        assert!(FIRST_MEETING_PROMPT.contains(
            "Declining a Brain connection alone does not decline a separately requested read"
        ));
        // No Brain opt-in is needed for requested work, but a refusal to read
        // and native runtime permissions are still real boundaries.
        assert!(FIRST_MEETING_PROMPT.contains("Respect a refusal to read a source"));
        assert!(FIRST_MEETING_PROMPT.contains("keep native permissions and approvals in force"));
        assert!(FIRST_MEETING_PROMPT.contains("unsolicited background researcher"));
        // The quick-answer block stays exactly as it was.
        assert!(FIRST_MEETING_PROMPT.contains("polyphonic-choices"));
        // Nothing is selected during setup now; the prompt must not claim it.
        assert!(!FIRST_MEETING_PROMPT.contains("owner selected these sources during setup"));
    }

    #[test]
    fn guidance_teaches_through_work_and_recommends_review_not_silent_setup() {
        for expected in [
            "There is no five-reply deadline",
            "Teach by doing",
            "start or continue",
            "group chats",
            "host-owned review",
            "Basic follow is not approval",
            "Preserve customized, declined, or paused choices",
            "meeting_progress",
            "never grants permissions",
        ] {
            assert!(
                FIRST_MEETING_PROMPT.contains(expected),
                "missing: {expected}"
            );
        }
    }
}

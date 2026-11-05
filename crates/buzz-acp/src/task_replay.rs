//! Narrow catch-up for signed, currently open same-owner exchanges.
//! Delivery hints only: normal author, exchange, consent and dispatch gates still run.

use std::collections::HashMap;

use luca_protocol::{ExchangeRecordV1, ExchangeStateV1, ExchangeTurnTag};
use nostr::Event;
use uuid::Uuid;

const MAX_TASKS: usize = 128;

pub(crate) struct TaskReplay {
    tasks: HashMap<String, (ExchangeRecordV1, u64)>,
    ordinary_since: HashMap<Uuid, u64>,
}

impl TaskReplay {
    pub(crate) fn new(channels: impl Iterator<Item = Uuid>, startup: u64) -> Self {
        Self {
            tasks: HashMap::new(),
            ordinary_since: channels.map(|channel| (channel, startup)).collect(),
        }
    }

    /// Call only after ExchangeCache accepted this exact signed owner head.
    pub(crate) fn observe_verified_head(&mut self, event: &Event, now: u64) -> Option<(Uuid, u64)> {
        self.tasks
            .retain(|_, (record, _)| record.deadline.get() >= now);
        let record = ExchangeRecordV1::from_content(&event.content).ok()?;
        let channel = Uuid::parse_str(record.conversation_id.as_str()).ok()?;
        let id = record.exchange_id.as_str().to_owned();
        if record.state != ExchangeStateV1::Open || record.deadline.get() < now {
            self.tasks.remove(&id);
            return None;
        }
        if event.created_at.as_secs() > now {
            return None;
        }
        if self.tasks.len() >= MAX_TASKS && !self.tasks.contains_key(&id) {
            tracing::warn!("active task replay capacity reached; no history boundary widened");
            return None;
        }
        let since = self
            .tasks
            .get(&id)
            .map_or(event.created_at.as_secs(), |(_, since)| {
                (*since).min(event.created_at.as_secs())
            })
            .max(now.saturating_sub(luca_protocol::EXCHANGE_DEFAULT_TTL_SECS));
        self.tasks.insert(id, (record, since));
        self.ordinary_since.entry(channel).or_insert(now);
        Some((channel, self.since(channel, since)))
    }

    pub(crate) fn joined(&mut self, channel: Uuid, timestamp: u64) -> u64 {
        self.ordinary_since
            .entry(channel)
            .and_modify(|since| *since = (*since).min(timestamp))
            .or_insert(timestamp);
        self.since(channel, timestamp)
    }

    fn since(&self, channel: Uuid, default: u64) -> u64 {
        self.tasks
            .values()
            .filter(|(record, _)| record.conversation_id.as_str() == channel.to_string())
            .fold(default, |floor, (_, since)| floor.min(*since))
    }

    pub(crate) fn left(&mut self, channel: Uuid) {
        self.ordinary_since.remove(&channel);
        // Keep only the signed hint until its deadline. A later legitimate
        // re-join can recover it; the main loop never re-subscribes while removed.
    }

    pub(crate) fn is_task(&self, event: &Event, channel: Uuid, now: u64) -> bool {
        let tags: Vec<_> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        let id = ExchangeTurnTag::find(&tags)
            .ok()
            .flatten()
            .map(|turn| turn.exchange_id.as_str().to_owned())
            .or_else(|| {
                tags.iter()
                    .find(|tag| tag.first().map(String::as_str) == Some("luca-task-reply"))
                    .and_then(|tag| tag.get(2).cloned())
            });
        let Some((record, _)) = id.as_ref().and_then(|id| self.tasks.get(id)) else {
            return false;
        };
        event.kind.as_u16() == 9
            && record.deadline.get() >= now
            && record.conversation_id.as_str() == channel.to_string()
            && (event.pubkey.to_hex() == record.owner.as_str()
                || record
                    .members
                    .iter()
                    .any(|member| member.as_str() == event.pubkey.to_hex()))
            && tags
                .iter()
                .filter(|tag| tag.first().map(String::as_str) == Some("h"))
                .count()
                == 1
            && tags.iter().any(|tag| {
                tag.first().map(String::as_str) == Some("h")
                    && tag.get(1).map(String::as_str) == Some(record.conversation_id.as_str())
            })
            && event.verify_id()
            && event.verify_signature()
    }

    pub(crate) fn admits(&self, event: &Event, channel: Uuid, now: u64) -> bool {
        self.ordinary_since.get(&channel).is_none_or(|since| {
            event
                .created_at
                .as_secs()
                .saturating_add(super::relay::SINCE_SKEW_SECS)
                >= *since
        }) || self.is_task(event, channel, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::{Hex64, OpaqueId};
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    fn fixture() -> (Keys, Keys, Keys, Uuid, ExchangeRecordV1) {
        let owner = Keys::generate();
        let sender = Keys::generate();
        let recipient = Keys::generate();
        let channel = Uuid::new_v4();
        let key = |keys: &Keys| Hex64::parse(keys.public_key().to_hex()).unwrap();
        let record = ExchangeRecordV1::open(
            key(&owner),
            vec![key(&sender), key(&recipient)],
            OpaqueId::parse(channel.to_string()).unwrap(),
            Hex64::parse("12".repeat(32)).unwrap(),
            key(&sender),
            None,
            1000,
        )
        .unwrap();
        (owner, sender, recipient, channel, record)
    }

    fn head(record: &ExchangeRecordV1, owner: &Keys) -> Event {
        EventBuilder::new(Kind::Custom(30178), record.to_content().unwrap())
            .tags(
                record
                    .event_tags()
                    .into_iter()
                    .map(|tag| Tag::parse(tag).unwrap()),
            )
            .custom_created_at(Timestamp::from(1000))
            .sign_with_keys(owner)
            .unwrap()
    }

    fn message(record: &ExchangeRecordV1, sender: &Keys, timestamp: u64, task: bool) -> Event {
        let mut tags = vec![Tag::parse(["h", record.conversation_id.as_str()]).unwrap()];
        if task {
            tags.push(Tag::parse(["exchange", record.exchange_id.as_str(), "1"]).unwrap());
        }
        EventBuilder::new(Kind::Custom(9), "a task")
            .tags(tags)
            .custom_created_at(Timestamp::from(timestamp))
            .sign_with_keys(sender)
            .unwrap()
    }

    #[test]
    fn eleven_second_late_join_replays_only_the_authorized_task() {
        let (owner, sender, _, channel, record) = fixture();
        let mut replay = TaskReplay::new(std::iter::empty(), 100);
        assert_eq!(replay.joined(channel, 1011), 1011);
        assert_eq!(
            replay.observe_verified_head(&head(&record, &owner), 1011),
            Some((channel, 1000))
        );
        assert!(replay.admits(&message(&record, &sender, 1000, true), channel, 1014));
        assert!(!replay.admits(&message(&record, &owner, 1000, false), channel, 1014));
        assert!(!replay.admits(&message(&record, &sender, 1000, false), channel, 1014));
        assert!(replay.admits(&message(&record, &owner, 1011, false), channel, 1014));
    }

    #[test]
    fn head_before_membership_and_restart_keep_the_task_floor() {
        let (owner, sender, _, channel, record) = fixture();
        for startup in [100, 1020] {
            let mut replay = TaskReplay::new(std::iter::empty(), startup);
            replay
                .observe_verified_head(&head(&record, &owner), 1020)
                .unwrap();
            assert_eq!(replay.joined(channel, 1020), 1000);
            assert!(replay.is_task(&message(&record, &sender, 1000, true), channel, 1021));
            assert!(!replay.admits(&message(&record, &owner, 1001, false), channel, 1021));
        }
    }

    #[test]
    fn stopped_expired_wrong_channel_and_foreign_author_do_not_replay() {
        let (owner, sender, _, channel, record) = fixture();
        let mut replay = TaskReplay::new(std::iter::empty(), 1011);
        replay
            .observe_verified_head(&head(&record, &owner), 1011)
            .unwrap();
        let task = message(&record, &sender, 1000, true);
        assert!(!replay.is_task(&task, Uuid::new_v4(), 1012));
        assert!(!replay.is_task(
            &message(&record, &Keys::generate(), 1000, true),
            channel,
            1012
        ));
        assert!(!replay.is_task(&task, channel, record.deadline.get() + 1));
        replay.observe_verified_head(&head(&record.stopped(), &owner), 1012);
        assert!(!replay.admits(&task, channel, 1012));
        assert!(replay
            .observe_verified_head(&head(&record, &owner), record.deadline.get() + 1)
            .is_none());
    }

    #[test]
    fn forged_or_foreign_owner_heads_never_reach_delivery_hints() {
        let (owner, _, recipient, channel, record) = fixture();
        let cache = crate::exchange_cache::ExchangeCache::new(
            Hex64::parse(recipient.public_key().to_hex()).unwrap(),
            Some(Hex64::parse(owner.public_key().to_hex()).unwrap()),
        );
        let mut replay = TaskReplay::new(std::iter::empty(), 1011);
        let foreign = head(&record, &Keys::generate());
        assert!(!cache.ingest_head(&foreign));
        assert_eq!(replay.joined(channel, 1011), 1011);
        assert!(cache.ingest_head(&head(&record, &owner)));
        assert_eq!(
            replay.observe_verified_head(&head(&record, &owner), 1011),
            Some((channel, 1000))
        );
    }
}

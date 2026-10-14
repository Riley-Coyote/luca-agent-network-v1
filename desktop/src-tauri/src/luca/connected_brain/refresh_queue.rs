//! Coalesced filesystem changes with bounded debounce and failure backoff.
//!
//! A failed refresh never schedules work on its own: another filesystem change
//! is required. This avoids polling broken sources while preserving fresh edits.

use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

const DEBOUNCE: Duration = Duration::from_millis(750);
const MAX_DEBOUNCE: Duration = Duration::from_secs(5);
const INITIAL_BACKOFF: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(300);

struct Change {
    first: Instant,
    latest: Instant,
}

struct Failure {
    delay: Duration,
    until: Instant,
}

pub(super) struct RefreshQueue<K> {
    pending: BTreeMap<K, Change>,
    failures: BTreeMap<K, Failure>,
}

impl<K> Default for RefreshQueue<K> {
    fn default() -> Self {
        Self {
            pending: BTreeMap::new(),
            failures: BTreeMap::new(),
        }
    }
}

impl<K: Ord + Clone> RefreshQueue<K> {
    pub(super) fn record_change(&mut self, key: K, now: Instant) {
        self.pending
            .entry(key)
            .and_modify(|change| change.latest = now)
            .or_insert(Change {
                first: now,
                latest: now,
            });
    }

    fn deadline(&self, key: &K, change: &Change) -> Instant {
        let deadline = (change.latest + DEBOUNCE).min(change.first + MAX_DEBOUNCE);
        self.failures
            .get(key)
            .map_or(deadline, |failure| deadline.max(failure.until))
    }

    pub(super) fn next_deadline(&self) -> Option<Instant> {
        self.pending
            .iter()
            .map(|(key, change)| self.deadline(key, change))
            .min()
    }

    pub(super) fn take_ready(&mut self, now: Instant) -> Vec<K> {
        let ready: Vec<_> = self
            .pending
            .iter()
            .filter(|(key, change)| self.deadline(key, change) <= now)
            .map(|(key, _)| key.clone())
            .collect();
        for key in &ready {
            self.pending.remove(key);
        }
        ready
    }

    pub(super) fn record_result(&mut self, key: K, now: Instant, succeeded: bool) {
        if succeeded {
            self.failures.remove(&key);
        } else {
            let delay = self.failures.get(&key).map_or(INITIAL_BACKOFF, |failure| {
                (failure.delay * 2).min(MAX_BACKOFF)
            });
            self.failures.insert(
                key,
                Failure {
                    delay,
                    until: now + delay,
                },
            );
        }
    }

    pub(super) fn forget(&mut self, key: &K) {
        self.pending.remove(key);
        self.failures.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn many_events_coalesce_into_one_refresh() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        for _ in 0..10_000 {
            queue.record_change("source", now);
        }
        assert_eq!(queue.pending.len(), 1);
        assert!(queue.take_ready(now).is_empty());
        assert_eq!(queue.take_ready(now + DEBOUNCE), vec!["source"]);
        assert_eq!(queue.next_deadline(), None);
    }

    #[test]
    fn continuous_writes_cannot_starve_a_refresh() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        for seconds in 1..=5 {
            queue.record_change("source", now + Duration::from_secs(seconds));
        }
        assert_eq!(queue.next_deadline(), Some(now + MAX_DEBOUNCE));
        assert_eq!(queue.take_ready(now + MAX_DEBOUNCE), vec!["source"]);
    }

    #[test]
    fn quiet_bursts_wait_for_the_last_change() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        queue.record_change("source", now + Duration::from_millis(500));
        assert!(queue.take_ready(now + DEBOUNCE).is_empty());
        assert_eq!(
            queue.take_ready(now + Duration::from_millis(1250)),
            vec!["source"]
        );
    }

    #[test]
    fn failure_without_a_new_change_never_retries() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_result("source", now, false);
        assert_eq!(queue.next_deadline(), None);
        assert!(queue.take_ready(now + MAX_BACKOFF).is_empty());
    }

    #[test]
    fn failed_sources_back_off_without_delaying_healthy_sources() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_result("broken", now, false);
        queue.record_change("broken", now);
        queue.record_change("healthy", now);
        assert_eq!(queue.take_ready(now + DEBOUNCE), vec!["healthy"]);
        assert_eq!(queue.next_deadline(), Some(now + INITIAL_BACKOFF));
        assert_eq!(queue.take_ready(now + INITIAL_BACKOFF), vec!["broken"]);
    }

    #[test]
    fn repeated_failures_have_a_capped_backoff_and_success_resets_it() {
        let mut now = Instant::now();
        let mut queue = RefreshQueue::default();
        for seconds in [30, 60, 120, 240, 300, 300] {
            queue.record_result("source", now, false);
            queue.record_change("source", now);
            now += Duration::from_secs(seconds);
            assert_eq!(queue.next_deadline(), Some(now));
            assert_eq!(queue.take_ready(now), vec!["source"]);
        }
        queue.record_result("source", now, true);
        queue.record_change("source", now);
        assert_eq!(queue.next_deadline(), Some(now + DEBOUNCE));
        queue.record_result("source", now, false);
        assert_eq!(queue.next_deadline(), Some(now + INITIAL_BACKOFF));
    }

    #[test]
    fn changes_during_a_refresh_are_not_lost() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        assert_eq!(queue.take_ready(now + DEBOUNCE), vec!["source"]);
        queue.record_change("source", now + DEBOUNCE);
        queue.record_result("source", now + DEBOUNCE, true);
        assert_eq!(queue.take_ready(now + DEBOUNCE * 2), vec!["source"]);
    }

    #[test]
    fn changes_during_a_failed_refresh_wait_for_backoff() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        assert_eq!(queue.take_ready(now + DEBOUNCE), vec!["source"]);
        queue.record_change("source", now + DEBOUNCE);
        queue.record_result("source", now + DEBOUNCE, false);
        assert!(queue.take_ready(now + DEBOUNCE * 2).is_empty());
        assert_eq!(
            queue.take_ready(now + DEBOUNCE + INITIAL_BACKOFF),
            vec!["source"]
        );
    }

    #[test]
    fn disconnect_forgets_pending_changes_and_backoff() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        queue.record_result("source", now, false);
        queue.forget(&"source");
        assert_eq!(queue.next_deadline(), None);
        queue.record_change("source", now);
        assert_eq!(queue.next_deadline(), Some(now + DEBOUNCE));
    }
}

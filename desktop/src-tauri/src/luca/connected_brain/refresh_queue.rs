//! Coalesced filesystem changes with bounded debounce and failure backoff.
//!
//! A retryable failure never schedules work on its own: another filesystem
//! change is required. Capacity failures stay paused until an explicit owner
//! refresh/reconnect creates headroom or confirms recovery.

use std::{
    collections::{BTreeMap, BTreeSet},
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RefreshOutcome {
    Succeeded,
    RetryableFailure,
    CapacityBlocked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct RefreshAttempt<K> {
    pub(super) key: K,
    token: u64,
}

pub(super) struct RefreshQueue<K> {
    pending: BTreeMap<K, Change>,
    failures: BTreeMap<K, Failure>,
    capacity_blocked: BTreeSet<K>,
    active_attempts: BTreeMap<K, u64>,
    next_attempt_token: u64,
}

impl<K> Default for RefreshQueue<K> {
    fn default() -> Self {
        Self {
            pending: BTreeMap::new(),
            failures: BTreeMap::new(),
            capacity_blocked: BTreeSet::new(),
            active_attempts: BTreeMap::new(),
            next_attempt_token: 0,
        }
    }
}

impl<K: Ord + Clone> RefreshQueue<K> {
    pub(super) fn record_change(&mut self, key: K, now: Instant) -> bool {
        if self.capacity_blocked.contains(&key) {
            return false;
        }
        self.pending
            .entry(key)
            .and_modify(|change| change.latest = now)
            .or_insert(Change {
                first: now,
                latest: now,
            });
        true
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

    pub(super) fn take_ready(&mut self, now: Instant) -> Vec<RefreshAttempt<K>> {
        let ready: Vec<_> = self
            .pending
            .iter()
            .filter(|(key, change)| self.deadline(key, change) <= now)
            .map(|(key, _)| key.clone())
            .collect();
        ready
            .into_iter()
            .map(|key| {
                self.pending.remove(&key);
                self.next_attempt_token = self.next_attempt_token.wrapping_add(1);
                if self.next_attempt_token == 0 {
                    self.next_attempt_token = 1;
                }
                let token = self.next_attempt_token;
                self.active_attempts.insert(key.clone(), token);
                RefreshAttempt { key, token }
            })
            .collect()
    }

    pub(super) fn record_result(
        &mut self,
        attempt: RefreshAttempt<K>,
        now: Instant,
        outcome: RefreshOutcome,
    ) -> bool {
        if self.active_attempts.get(&attempt.key) != Some(&attempt.token) {
            return false;
        }
        self.active_attempts.remove(&attempt.key);
        let key = attempt.key;
        match outcome {
            RefreshOutcome::Succeeded => {
                self.reset_failure(&key);
            }
            RefreshOutcome::RetryableFailure => {
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
            RefreshOutcome::CapacityBlocked => {
                // More filesystem churn cannot create continuity headroom. Drop
                // any event that arrived during this refresh and wait for an
                // explicit owner refresh/reconnect to reset the source.
                self.pending.remove(&key);
                self.failures.remove(&key);
                self.capacity_blocked.insert(key);
            }
        }
        true
    }

    pub(super) fn forget(&mut self, key: &K) {
        self.pending.remove(key);
        self.reset_failure(key);
    }

    pub(super) fn reset_failure(&mut self, key: &K) {
        self.failures.remove(key);
        self.capacity_blocked.remove(key);
        self.active_attempts.remove(key);
    }

    pub(super) fn invalidate_attempt(&mut self, key: &K) {
        self.active_attempts.remove(key);
    }

    pub(super) fn is_capacity_blocked(&self, key: &K) -> bool {
        self.capacity_blocked.contains(key)
    }

    pub(super) fn capacity_blocked_keys(&self) -> BTreeSet<K> {
        self.capacity_blocked.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_keys<K>(attempts: Vec<RefreshAttempt<K>>) -> Vec<K> {
        attempts.into_iter().map(|attempt| attempt.key).collect()
    }

    fn take_one<K: Ord + Clone + std::fmt::Debug>(
        queue: &mut RefreshQueue<K>,
        now: Instant,
    ) -> RefreshAttempt<K> {
        let mut attempts = queue.take_ready(now);
        assert_eq!(attempts.len(), 1);
        attempts.pop().unwrap()
    }

    #[test]
    fn many_events_coalesce_into_one_refresh() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        for _ in 0..10_000 {
            queue.record_change("source", now);
        }
        assert_eq!(queue.pending.len(), 1);
        assert!(queue.take_ready(now).is_empty());
        assert_eq!(ready_keys(queue.take_ready(now + DEBOUNCE)), vec!["source"]);
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
        assert_eq!(
            ready_keys(queue.take_ready(now + MAX_DEBOUNCE)),
            vec!["source"]
        );
    }

    #[test]
    fn quiet_bursts_wait_for_the_last_change() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        queue.record_change("source", now + Duration::from_millis(500));
        assert!(queue.take_ready(now + DEBOUNCE).is_empty());
        assert_eq!(
            ready_keys(queue.take_ready(now + Duration::from_millis(1250))),
            vec!["source"]
        );
    }

    #[test]
    fn failure_without_a_new_change_never_retries() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::RetryableFailure);
        assert_eq!(queue.next_deadline(), None);
        assert!(queue.take_ready(now + MAX_BACKOFF).is_empty());
    }

    #[test]
    fn failed_sources_back_off_without_delaying_healthy_sources() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("broken", now);
        let broken = take_one(&mut queue, now + DEBOUNCE);
        queue.record_result(broken, now + DEBOUNCE, RefreshOutcome::RetryableFailure);
        queue.record_change("broken", now + DEBOUNCE);
        queue.record_change("healthy", now + DEBOUNCE);
        assert_eq!(
            ready_keys(queue.take_ready(now + DEBOUNCE * 2)),
            vec!["healthy"]
        );
        assert_eq!(
            queue.next_deadline(),
            Some(now + DEBOUNCE + INITIAL_BACKOFF)
        );
        assert_eq!(
            ready_keys(queue.take_ready(now + DEBOUNCE + INITIAL_BACKOFF)),
            vec!["broken"]
        );
    }

    #[test]
    fn repeated_failures_have_a_capped_backoff_and_success_resets_it() {
        let mut now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let mut attempt = take_one(&mut queue, now + DEBOUNCE);
        for seconds in [30, 60, 120, 240, 300, 300] {
            queue.record_result(attempt, now, RefreshOutcome::RetryableFailure);
            queue.record_change("source", now);
            now += Duration::from_secs(seconds);
            assert_eq!(queue.next_deadline(), Some(now));
            attempt = take_one(&mut queue, now);
        }
        queue.record_result(attempt, now, RefreshOutcome::Succeeded);
        queue.record_change("source", now);
        assert_eq!(queue.next_deadline(), Some(now + DEBOUNCE));
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::RetryableFailure);
        queue.record_change("source", now + DEBOUNCE);
        assert_eq!(
            queue.next_deadline(),
            Some(now + DEBOUNCE + INITIAL_BACKOFF)
        );
    }

    #[test]
    fn changes_during_a_refresh_are_not_lost() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        queue.record_change("source", now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::Succeeded);
        assert_eq!(
            ready_keys(queue.take_ready(now + DEBOUNCE * 2)),
            vec!["source"]
        );
    }

    #[test]
    fn changes_during_a_failed_refresh_wait_for_backoff() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        queue.record_change("source", now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::RetryableFailure);
        assert!(queue.take_ready(now + DEBOUNCE * 2).is_empty());
        assert_eq!(
            ready_keys(queue.take_ready(now + DEBOUNCE + INITIAL_BACKOFF)),
            vec!["source"]
        );
    }

    #[test]
    fn disconnect_forgets_pending_changes_and_backoff() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::RetryableFailure);
        queue.forget(&"source");
        assert_eq!(queue.next_deadline(), None);
        queue.record_change("source", now);
        assert_eq!(queue.next_deadline(), Some(now + DEBOUNCE));
    }

    #[test]
    fn capacity_failure_ignores_churn_until_explicit_reset() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let attempt = take_one(&mut queue, now + DEBOUNCE);
        // Model another filesystem event arriving while the expensive refresh
        // is still running. The terminal result must discard it too.
        queue.record_change("source", now + DEBOUNCE);
        queue.record_result(attempt, now + DEBOUNCE, RefreshOutcome::CapacityBlocked);
        assert_eq!(queue.next_deadline(), None);
        assert!(!queue.record_change("source", now + MAX_BACKOFF));
        assert_eq!(queue.next_deadline(), None);

        queue.reset_failure(&"source");
        assert!(queue.record_change("source", now + MAX_BACKOFF));
        assert_eq!(queue.next_deadline(), Some(now + MAX_BACKOFF + DEBOUNCE));
    }

    #[test]
    fn explicit_owner_refresh_invalidates_an_older_worker_result() {
        let now = Instant::now();
        let mut queue = RefreshQueue::default();
        queue.record_change("source", now);
        let stale_attempt = take_one(&mut queue, now + DEBOUNCE);

        queue.invalidate_attempt(&"source");
        assert!(!queue.record_result(
            stale_attempt,
            now + DEBOUNCE,
            RefreshOutcome::CapacityBlocked
        ));
        assert!(!queue.is_capacity_blocked(&"source"));
        assert!(queue.record_change("source", now + DEBOUNCE));
    }
}

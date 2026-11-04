//! Narrow startup replay for the single signed event that woke this resident.
//! This is a delivery hint, not exchange admission or permission authority.

pub(crate) struct ExchangeWake {
    event_id: String,
    pub(crate) since: u64,
    started_at: u64,
}

impl ExchangeWake {
    pub(crate) fn parse(value: &str, now: u64) -> Option<Self> {
        let mut fields = value.split(':');
        let id = fields.next()?;
        let timestamp = fields.next()?;
        let started_at = fields.next()?.parse::<u64>().ok()?;
        if fields.next().is_some() {
            return None;
        }
        if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let since = timestamp.parse::<u64>().ok()?;
        // Exchanges are short-lived. Never turn a malformed hint into a
        // historical import, even if a caller supplies it in the environment.
        if since > started_at || started_at > now || now.saturating_sub(since) > 900 {
            return None;
        }
        Some(Self {
            event_id: id.to_ascii_lowercase(),
            since,
            started_at,
        })
    }

    pub(crate) fn admits(&self, id: &str, created_at: u64) -> bool {
        created_at >= self.started_at || id == self.event_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_replay_is_exact_not_a_history_import() {
        let id = "a".repeat(64);
        let wake = ExchangeWake::parse(&format!("{id}:100:110"), 120).unwrap();
        assert!(wake.admits(&id, 100));
        assert!(!wake.admits(&"b".repeat(64), 109));
        // A second message arriving while the child initializes must survive.
        assert!(wake.admits(&"b".repeat(64), 110));
        assert!(ExchangeWake::parse(&format!("{id}:111:110"), 120).is_none());
        assert!(ExchangeWake::parse(&format!("{id}:100:121"), 120).is_none());
        assert!(ExchangeWake::parse(&format!("{id}:1:1000"), 1000).is_none());
        assert!(ExchangeWake::parse("not-an-id:100:110", 120).is_none());
    }
}

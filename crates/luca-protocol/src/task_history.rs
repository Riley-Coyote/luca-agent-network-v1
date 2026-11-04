//! Explicit replay authority for already-shared exchange turns, not source-room access.
use crate::{ExchangeRecordV1, Hex64, OpaqueId};
use serde::{Deserialize, Serialize};

/// Additive protocol; exchange v1 remains unchanged.
pub const TASK_HISTORY_PROTOCOL: &str = "luca.task-history-grant.v1";

/// Replay authority is independently revocable; Stop only stops execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskHistoryState {
    /// Permit exact canonical exchange turns, subject to durable source revocation.
    Active,
    /// Revoke replay without deleting canonical messages.
    Revoked,
}

/// Owner-authored replay grant. No root brief or ordinary source message is included.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskHistoryGrantV1 {
    /// Protocol discriminator.
    pub protocol: String,
    /// Canonical server community UUID, never a URL.
    pub community_id: String,
    /// Sole signing owner.
    pub owner: Hex64,
    /// Exact canonical exchange, also the d coordinate.
    pub exchange_id: Hex64,
    /// Immutable source conversation.
    pub conversation_id: OpaqueId,
    /// Sorted original exchange audience, excluding owner.
    pub members: Vec<Hex64>,
    /// Current independent replay permission.
    pub state: TaskHistoryState,
}

impl TaskHistoryGrantV1 {
    /// Validate the fixed grant scope against canonical exchange authority.
    pub fn validate(&self, community: &str, record: &ExchangeRecordV1) -> Result<(), &'static str> {
        if self.protocol != TASK_HISTORY_PROTOCOL
            || uuid::Uuid::parse_str(&self.community_id).is_err()
            || self.community_id != community
            || self.owner != record.owner
            || self.exchange_id != record.exchange_id
            || self.conversation_id != record.conversation_id
            || self.members != record.members
        {
            return Err("task history scope does not match its canonical exchange");
        }
        Ok(())
    }

    /// Exact envelope coordinates; no h tag because this is a global permission record.
    pub fn event_tags(&self) -> Vec<Vec<String>> {
        let mut tags = vec![vec!["d".into(), self.exchange_id.as_str().into()]];
        tags.extend(
            self.members
                .iter()
                .map(|key| vec!["p".into(), key.as_str().into()]),
        );
        tags
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_wire_shape_rejects_scope_extensions() {
        let value = serde_json::json!({"protocol":TASK_HISTORY_PROTOCOL,"community_id":"00000000-0000-0000-0000-000000000001","owner":"a".repeat(64),"exchange_id":"b".repeat(64),"conversation_id":"00000000-0000-0000-0000-000000000002","members":["c".repeat(64),"d".repeat(64)],"state":"active"});
        let parsed: TaskHistoryGrantV1 = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(parsed.event_tags().len(), 3);
        let mut expanded = value;
        expanded["include_source_history"] = serde_json::json!(true);
        assert!(serde_json::from_value::<TaskHistoryGrantV1>(expanded).is_err());
    }

    #[test]
    fn fixed_audience_source_and_community_cannot_expand() {
        let key = |c: char| Hex64::parse(c.to_string().repeat(64)).unwrap();
        let community = "00000000-0000-0000-0000-000000000001";
        let record = ExchangeRecordV1::open(
            key('a'),
            vec![key('b'), key('c')],
            OpaqueId::parse("source").unwrap(),
            key('d'),
            key('b'),
            None,
            100,
        )
        .unwrap();
        let grant = TaskHistoryGrantV1 {
            protocol: TASK_HISTORY_PROTOCOL.into(),
            community_id: community.into(),
            owner: record.owner.clone(),
            exchange_id: record.exchange_id.clone(),
            conversation_id: record.conversation_id.clone(),
            members: record.members.clone(),
            state: TaskHistoryState::Active,
        };
        assert!(grant.validate(community, &record).is_ok());
        assert!(grant
            .validate("00000000-0000-0000-0000-000000000002", &record)
            .is_err());
        let mut wrong = grant.clone();
        wrong.members.push(key('e'));
        assert!(wrong.validate(community, &record).is_err());
        let mut wrong = grant;
        wrong.conversation_id = OpaqueId::parse("another-source").unwrap();
        assert!(wrong.validate(community, &record).is_err());
    }
}

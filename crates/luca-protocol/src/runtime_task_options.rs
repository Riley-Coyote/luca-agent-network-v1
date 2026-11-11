//! Per-request execution choices. Never edits the user's native defaults.
use serde::{Deserialize, Serialize};

/// Small conversational request or substantial project work.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTaskPurposeV1 {
    Ask,
    #[default]
    Task,
}

/// Explicit pins are verified against this session's advertised ACP options.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeTaskOptionsV1 {
    #[serde(default)]
    pub purpose: RuntimeTaskPurposeV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
}
impl RuntimeTaskOptionsV1 {
    /// Reject malformed choices before approval or dispatch.
    pub fn is_valid(&self) -> bool {
        self.model.as_ref().is_none_or(|s| {
            !s.trim().is_empty() && s.len() <= 160 && !s.chars().any(char::is_control)
        }) && self
            .effort
            .as_ref()
            .is_none_or(|s| matches!(s.as_str(), "low" | "medium" | "high" | "xhigh" | "max"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_task_defaults_and_exact_pins_are_bounded() {
        assert_eq!(serde_json::from_str::<RuntimeTaskOptionsV1>("{}").unwrap(), RuntimeTaskOptionsV1::default());
        let requested: RuntimeTaskOptionsV1 = serde_json::from_str(r#"{"purpose":"ask","model":"claude-opus-5-5","effort":"low"}"#).unwrap();
        assert!(requested.is_valid());
        for value in [r#"{"effort":"unlimited"}"#, r#"{"model":"  "}"#, r#"{"model":"bad\nvalue"}"#] {
            assert!(!serde_json::from_str::<RuntimeTaskOptionsV1>(value).unwrap().is_valid());
        }
        assert!(serde_json::from_str::<RuntimeTaskOptionsV1>(r#"{"purpose":"ask","permissions":"full"}"#).is_err());
    }
}

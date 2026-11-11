//! Public execution plans, never reasoning, tool arguments or authority.
use serde::{Deserialize, Serialize};

/// Maximum explicit steps in a replacement plan snapshot.
pub const MAX_WORK_PLAN_STEPS: usize = 64;
/// Maximum UTF-8 bytes in one public step.
pub const MAX_WORK_PLAN_CONTENT_BYTES: usize = 240;

/// Runtime-reported state, never inferred from later activity or turn completion.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkPlanStatusV1 {
    Pending,
    InProgress,
    Completed,
}

/// One public goal in the runtime's plan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkPlanStepV1 {
    pub content: String,
    pub status: WorkPlanStatusV1,
}

/// Full replacement snapshot. An empty list clears the previous plan.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkPlanV1 {
    pub steps: Vec<WorkPlanStepV1>,
}

impl WorkPlanV1 {
    /// Check bounds for local presentation and durable snapshots.
    pub fn is_valid(&self) -> bool {
        self.steps.len() <= MAX_WORK_PLAN_STEPS
            && self.steps.iter().all(|step| {
                !step.content.trim().is_empty()
                    && step.content.len() <= MAX_WORK_PLAN_CONTENT_BYTES
                    && !step.content.chars().any(|c| {
                        c.is_control()
                            || matches!(c,
                    '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
                    })
            })
    }
    /// Copy only explicit ACP entries; never stringify unrecognized payloads.
    pub fn from_acp(update: &serde_json::Value) -> Option<Self> {
        let entries = update.get("entries")?.as_array()?;
        if entries.len() > MAX_WORK_PLAN_STEPS {
            return None;
        }
        let steps = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let raw = entry.get("content")?.as_str()?.trim();
                let status = serde_json::from_value(entry.get("status")?.clone()).ok()?;
                let lower = raw.to_ascii_lowercase();
                let sensitive = [
                    "nsec1",
                "sprt_tok_",
                    "sk-",
                    "ghp_",
                    "github_pat_",
                "xoxb-",
                "xoxp-",
                    "bearer ",
                "authorization",
                    "api_key",
                "apikey",
                "api-key",
                    "password",
                "passwd",
                "secret",
                "credential",
                "--auth",
                "eyj",
                "akia",
                "asia",
                    "private key",
                    "-----begin",
                ]
                .iter()
                .any(|pattern| lower.contains(pattern));
                let mut end = raw.len().min(MAX_WORK_PLAN_CONTENT_BYTES);
                while !raw.is_char_boundary(end) {
                    end -= 1;
                }
                Some(WorkPlanStepV1 {
                    content: if sensitive {
                        format!("Step {}", index + 1)
                    } else {
                        raw[..end].to_owned()
                    },
                    status,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let plan = Self { steps };
        plan.is_valid().then_some(plan)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserve_states_and_clear_without_inventing_progress() {
        let p = WorkPlanV1::from_acp(&serde_json::json!({"entries":[
            {"content":"Read","status":"completed","priority":"high"},
            {"content":"Write","status":"in_progress"}, {"content":"Check","status":"pending"}
        ]}))
        .expect("plan");
        assert_eq!(p.steps[2].status, WorkPlanStatusV1::Pending);
        assert!(WorkPlanV1::from_acp(&serde_json::json!({"entries":[]}))
            .expect("clear")
            .steps
            .is_empty());
        assert!(WorkPlanV1::from_acp(
            &serde_json::json!({"entries":[{"content":"x","status":"unknown"}]})
        )
        .is_none());
        assert!(WorkPlanV1::from_acp(&serde_json::json!({"content":"not a plan"})).is_none());
    }
    #[test]
    fn bound_and_redact_public_text() {
        let v = |s: &str| serde_json::json!({"entries":[{"content":s,"status":"pending"}]});
        assert_eq!(
            WorkPlanV1::from_acp(&v("Read sk-private-canary"))
                .expect("redacted")
                .steps[0]
                .content,
            "Step 1"
        );
        assert!(WorkPlanV1::from_acp(&v("Hide\u{202e} text")).is_none());
        assert!(WorkPlanV1::from_acp(&v(&"λ".repeat(240)))
            .expect("bounded")
            .is_valid());
    }
}

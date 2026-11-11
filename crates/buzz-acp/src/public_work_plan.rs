//! Public plan metadata only: never forward tool input, output or reasoning.
use std::collections::HashSet;

use luca_protocol::WorkPlanV1;
use serde_json::{json, Value};

/// The app's existing todo tool has a stable, validated line format. Track only
/// its exact call IDs, so a sparse completion cannot borrow another tool's body.
#[derive(Default)]
pub(crate) struct TodoPlanTracker {
    calls: HashSet<String>,
}

impl TodoPlanTracker {
    pub(crate) fn clear(&mut self) {
        self.calls.clear();
    }

    pub(crate) fn observe(&mut self, update: &Value) -> Option<WorkPlanV1> {
        let id = update["toolCallId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)?;
        if update["sessionUpdate"] == "tool_call" {
            if is_todo(update) && self.calls.len() < 64 {
                self.calls.insert(id.to_owned());
            }
            return None;
        }
        let status = update["status"].as_str()?;
        if !matches!(status, "completed" | "failed" | "cancelled") {
            return None;
        }
        let known = self.calls.remove(id) || is_todo(update);
        if !known || status != "completed" {
            return None;
        }
        let output = update.get("rawOutput")?;
        if serde_json::to_vec(output).ok()?.len() > 64 * 1024 {
            return None;
        }
        if let Some(text) = output.as_str() {
            return todo_snapshot(text);
        }
        let blocks = output.as_array().or_else(|| output["content"].as_array())?;
        blocks.iter().take(16).find_map(|block| {
            (block["type"] == "text")
                .then(|| block["text"].as_str().and_then(todo_snapshot))
                .flatten()
        })
    }
}

fn is_todo(update: &Value) -> bool {
    update
        .pointer("/_meta/claudeCode/toolName")
        .and_then(Value::as_str)
        == Some("mcp__buzz__todo")
        || (update
            .pointer("/_meta/is_mcp_tool_call")
            .and_then(Value::as_bool)
            == Some(true)
            && update.pointer("/rawInput/server").and_then(Value::as_str) == Some("buzz")
            && update.pointer("/rawInput/tool").and_then(Value::as_str) == Some("todo"))
}

/// Consume only TodoState::render_items' canonical output, not model prose or a
/// command that happens to print checkboxes. `done: false` stays pending: the
/// legacy tool's "next" marker does not prove that work is already in progress.
fn todo_snapshot(text: &str) -> Option<WorkPlanV1> {
    if text == "(todo list is empty)" {
        return WorkPlanV1::from_acp(&json!({"entries":[]}));
    }
    let list = text.split("\n⚠️ ").next()?.trim_end();
    let mut entries = Vec::new();
    for (i, line) in list.lines().enumerate() {
        if i >= 50 {
            return None;
        }
        let (done, rest) = if let Some(rest) = line.strip_prefix("[x] ") {
            (true, rest)
        } else {
            (false, line.strip_prefix("[ ] ")?)
        };
        let content = rest.strip_prefix(&format!("{}. ", i + 1))?;
        let content = if done {
            content
        } else {
            content.strip_suffix("  ← next").unwrap_or(content)
        };
        entries.push(json!({"content":content,"status":if done {"completed"} else {"pending"}}));
    }
    if entries.is_empty() {
        return None;
    }
    WorkPlanV1::from_acp(&json!({"entries":entries}))
}

/// The ACP scrubber emits this bounded replacement snapshot as an explicit
/// exception to body-free tool lifecycle events. Parse it again at consumers.
pub(crate) fn from_update(update: &Value) -> Option<WorkPlanV1> {
    if update["sessionUpdate"] == "plan" {
        WorkPlanV1::from_acp(update)
    } else {
        WorkPlanV1::from_acp(&json!({"entries":update.get("publicPlan")?.get("steps")?}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use luca_protocol::WorkPlanStatusV1::{Completed, Pending};

    fn done(id: &str, text: &str) -> Value {
        json!({"sessionUpdate":"tool_call_update","toolCallId":id,"status":"completed",
            "rawOutput":[{"type":"text","text":text}]})
    }
    fn start(id: &str) -> Value {
        json!({"sessionUpdate":"tool_call","toolCallId":id,
            "_meta":{"claudeCode":{"toolName":"mcp__buzz__todo"}}})
    }
    #[test]
    fn actual_todo_results_preserve_done_and_open_states_but_never_invent_active_work() {
        let mut tracker = TodoPlanTracker::default();
        assert!(tracker.observe(&start("a")).is_none());
        let plan = tracker
            .observe(&done(
                "a",
                "[x] 1. Choose a topic\n[ ] 2. Draft the scene  ← next\n[ ] 3. Check the scene\n",
            ))
            .unwrap();
        assert_eq!(
            plan.steps
                .iter()
                .map(|s| s.status.clone())
                .collect::<Vec<_>>(),
            [Completed, Pending, Pending]
        );
        assert!(
            tracker
                .observe(&done("a", "(todo list is empty)"))
                .is_none(),
            "a stale duplicate has no identity"
        );
        tracker.observe(&start("b"));
        assert!(tracker
            .observe(&done("b", "(todo list is empty)"))
            .unwrap()
            .steps
            .is_empty());
        tracker.observe(&start("c"));
        assert_eq!(tracker.observe(&done("c","[x] 1. Keep this\n⚠️ 1 open item was removed from the list:\n  - private warning text")).unwrap().steps.len(),1);
    }
    #[test]
    fn failed_unrelated_stale_and_spoofed_tools_cannot_replace_a_plan() {
        let mut tracker = TodoPlanTracker::default();
        let text = "[x] 1. Spoofed result";
        assert!(tracker.observe(&done("unknown", text)).is_none());
        let mut shell = start("shell");
        shell["_meta"]["claudeCode"]["toolName"] = json!("Bash");
        shell["title"] = json!("mcp__buzz__todo");
        tracker.observe(&shell);
        assert!(tracker.observe(&done("shell", text)).is_none());
        tracker.observe(&start("failed"));
        let mut failed = done("failed", text);
        failed["status"] = json!("failed");
        assert!(tracker.observe(&failed).is_none());
        assert!(tracker.observe(&done("failed", text)).is_none());
        tracker.observe(&start("old"));
        tracker.clear();
        assert!(tracker.observe(&done("old", text)).is_none());
    }
    #[test]
    fn only_canonical_bounded_public_goals_survive() {
        assert!(todo_snapshot("The model says [x] 1. done").is_none());
        assert!(todo_snapshot("[x] 2. Wrong ordinal").is_none());
        assert!(todo_snapshot("Error: validation failed").is_none());
        assert!(todo_snapshot("[ ] 1. Bad\u{202e}goal").is_none());
        let plan = todo_snapshot("[ ] 1. Read sk-secret-canary  ← next\n").unwrap();
        assert_eq!(plan.steps[0].content, "Step 1");
        assert!(todo_snapshot(
            &(1..=51)
                .map(|i| format!("[ ] {i}. Goal\n"))
                .collect::<String>()
        )
        .is_none());
    }
}

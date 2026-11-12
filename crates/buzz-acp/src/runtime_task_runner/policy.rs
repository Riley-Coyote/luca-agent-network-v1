//! Process-local policy for explicit tasks, never a resident/native preference edit.

use crate::{
    acp::{AcpClient, AcpError},
    config::{normalize_agent_command_identity, CODEX_POLICY_ENV},
    pool::agent_supports_mode,
};
use serde_json::{json, Value};
use std::time::Duration;

pub(super) struct TaskPolicy {
    mode: &'static str,
    codex: bool,
    full_access: bool,
}

fn unavailable() -> AcpError {
    AcpError::Protocol("runtime task permission policy could not be verified".into())
}

impl TaskPolicy {
    pub(super) fn new(command: &str, permission: &str) -> Result<Self, AcpError> {
        let full_access = match permission {
            "normal" => false,
            "full_access" => true,
            _ => return Err(unavailable()),
        };
        let (codex, mode) = match normalize_agent_command_identity(command).as_str() {
            "codex" | "codex-acp" => (
                true,
                if full_access {
                    "agent-full-access"
                } else {
                    "read-only"
                },
            ),
            "claude-agent-acp" => (
                false,
                if full_access {
                    "bypassPermissions"
                } else {
                    "default"
                },
            ),
            _ => return Err(unavailable()),
        };
        Ok(Self {
            mode,
            codex,
            full_access,
        })
    }

    pub(super) fn environment(&self) -> Vec<(String, String)> {
        if !self.codex {
            return Vec::new();
        }
        // The spawn helper forces INITIAL_AGENT_MODE from this closed policy,
        // overriding an inherited resident tier before the adapter initializes.
        vec![(CODEX_POLICY_ENV.into(), json!({
            "approval_policy": if self.full_access { "never" } else { "on-request" },
            "sandbox_mode": if self.full_access { "danger-full-access" } else { "workspace-write" },
        }).to_string())]
    }

    pub(super) async fn bind(
        &self,
        client: &mut AcpClient,
        session: &str,
        raw: &Value,
    ) -> Result<(), AcpError> {
        if !agent_supports_mode(raw, self.mode) {
            return Err(unavailable());
        }
        let response = tokio::time::timeout(
            Duration::from_secs(10),
            client.session_set_config_option(session, "mode", self.mode),
        )
        .await
        .map_err(|_| unavailable())??;
        if !acknowledged(&response, self.mode) {
            return Err(unavailable());
        }
        Ok(())
    }
}

fn acknowledged(response: &Value, mode: &str) -> bool {
    response
        .get("configOptions")
        .and_then(Value::as_array)
        .is_some_and(|options| {
            options.iter().any(|option| {
                option
                    .get("id")
                    .or_else(|| option.get("configId"))
                    .and_then(Value::as_str)
                    == Some("mode")
                    && option.get("currentValue").and_then(Value::as_str) == Some(mode)
            })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_tier_does_not_inherit_resident_or_native_full_access() {
        for (command, normal, full) in [
            ("codex-acp", "read-only", "agent-full-access"),
            ("claude-agent-acp", "default", "bypassPermissions"),
        ] {
            assert_eq!(TaskPolicy::new(command, "normal").unwrap().mode, normal);
            assert_eq!(TaskPolicy::new(command, "full_access").unwrap().mode, full);
        }
        assert!(TaskPolicy::new("unknown-adapter", "normal").is_err());
        assert!(TaskPolicy::new("codex-acp", "agent").is_err());
    }

    #[test]
    fn success_without_exact_mode_acknowledgement_is_not_authority() {
        for value in [
            json!({}),
            json!({"configOptions":[]}),
            json!({"configOptions":[{"id":"mode","currentValue":"bypassPermissions"}]}),
        ] {
            assert!(!acknowledged(&value, "default"));
        }
        assert!(acknowledged(
            &json!({"configOptions":[{"id":"mode","currentValue":"default"}]}),
            "default"
        ));
    }

    #[test]
    fn codex_spawn_policy_is_bound_from_task_tier_not_parent_tier() {
        for (permission, initial) in [
            ("normal", "read-only"),
            ("full_access", "agent-full-access"),
        ] {
            let env = TaskPolicy::new("codex-acp", permission)
                .unwrap()
                .environment();
            let policy = crate::config::parse_codex_policy_overlay(&env[0].1).unwrap();
            assert_eq!(crate::config::codex_initial_agent_mode(&policy), initial);
            assert_eq!(env[0].0, CODEX_POLICY_ENV);
        }
        assert!(TaskPolicy::new("claude-agent-acp", "normal")
            .unwrap()
            .environment()
            .is_empty());
    }

    #[tokio::test]
    async fn unacknowledged_or_refused_mode_never_returns_a_permissive_fallback() {
        for (result, success) in [
            (
                json!({"configOptions":[{"id":"mode","currentValue":"default"}]}),
                true,
            ),
            (json!({}), false),
            (
                json!({"configOptions":[{"id":"mode","currentValue":"bypassPermissions"}]}),
                false,
            ),
        ] {
            let response = json!({"jsonrpc":"2.0","id":0,"result":result}).to_string();
            let script=format!("IFS= read -r REQUEST || exit 2\ncase \"$REQUEST\" in *'\"method\":\"session/set_config_option\"'*'\"value\":\"default\"'*) ;; *) exit 3 ;; esac\nprintf '%s\\n' '{response}'\n");
            let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script], &[], false)
                .await
                .unwrap();
            let policy = TaskPolicy::new("claude-agent-acp", "normal").unwrap();
            let raw =
                json!({"modes":{"availableModes":[{"id":"default"},{"id":"bypassPermissions"}]}});
            assert_eq!(
                policy
                    .bind(&mut client, "synthetic-session", &raw)
                    .await
                    .is_ok(),
                success
            );
            client.shutdown().await;
        }
    }
}

//! Apply only live advertised session choices, without changing native settings.
use crate::acp::{AcpClient, AcpError};
use luca_protocol::{RuntimeTaskOptionsV1, RuntimeTaskPurposeV1};

fn option<'a>(raw: &'a serde_json::Value, category: &str) -> Option<&'a serde_json::Value> {
    raw.get("configOptions")?
        .as_array()?
        .iter()
        .find(|o| o["category"] == category && o["type"] == "select")
}
fn offers(options: &serde_json::Value, value: &str) -> bool {
    options.as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["value"] == value || offers(&item["options"], value))
    })
}
fn selection(raw: &serde_json::Value, category: &str, value: &str) -> Option<String> {
    let entry = option(raw, category)?;
    offers(&entry["options"], value)
        .then(|| entry["id"].as_str().map(str::to_owned))
        .flatten()
}
fn acknowledged(raw: &serde_json::Value, category: &str, id: &str, value: &str) -> bool {
    option(raw, category).is_some_and(|entry| entry["id"] == id && entry["currentValue"] == value)
}
fn unavailable() -> AcpError {
    AcpError::Protocol(
        "The requested task model or effort could not be verified; nothing was sent.".into(),
    )
}

pub(super) async fn apply(
    client: &mut AcpClient,
    session: &str,
    raw: &serde_json::Value,
    requested: &RuntimeTaskOptionsV1,
) -> Result<(), AcpError> {
    let mut current = raw.clone();
    if let Some(model) = requested.model.as_deref() {
        let id = selection(&current, "model", model).ok_or_else(unavailable)?;
        if !acknowledged(&current, "model", &id, model) {
            current = client
                .session_set_config_option(session, &id, model)
                .await?;
            if !acknowledged(&current, "model", &id, model) {
                return Err(unavailable());
            }
        }
    }
    // A short answer should not inherit a maximal reasoning preference. Only
    // select low when this exact model advertises it; explicit pins fail closed.
    let effort = requested.effort.as_deref().or_else(|| {
        (requested.purpose == RuntimeTaskPurposeV1::Ask
            && selection(&current, "thought_level", "low").is_some())
        .then_some("low")
    });
    if let Some(effort) = effort {
        let id = selection(&current, "thought_level", effort).ok_or_else(unavailable)?;
        if !acknowledged(&current, "thought_level", &id, effort) {
            current = client
                .session_set_config_option(session, &id, effort)
                .await?;
            if !acknowledged(&current, "thought_level", &id, effort) {
                return Err(unavailable());
            }
        }
    }
    if let Some(model) = requested.model.as_deref() {
        let id = selection(&current, "model", model).ok_or_else(unavailable)?;
        if !acknowledged(&current, "model", &id, model) {
            return Err(unavailable());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_advertised_choices_and_acknowledgements_not_display_names() {
        let raw = serde_json::json!({"configOptions":[{"id":"runtime-model","category":"model","type":"select","currentValue":"a","options":[{"name":"Group","options":[{"value":"a","name":"Model A"}]}]}]});
        assert_eq!(
            selection(&raw, "model", "a").as_deref(),
            Some("runtime-model")
        );
        assert!(selection(&raw, "model", "Model A").is_none());
        assert!(selection(&raw, "thought_level", "low").is_none());
        assert!(!acknowledged(
            &serde_json::json!({}),
            "model",
            "runtime-model",
            "a"
        ));
        assert!(!acknowledged(&raw, "model", "runtime-model", "b"));
    }

    fn config(model: &str, effort: &str) -> serde_json::Value {
        serde_json::json!({"configOptions":[
            {"id":"runtime-model","category":"model","type":"select","currentValue":model,"options":[{"value":"a"},{"value":"b"}]},
            {"id":"runtime-effort","category":"thought_level","type":"select","currentValue":effort,"options":[{"value":"low"},{"value":"high"},{"value":"max"}]}
        ]})
    }

    #[tokio::test]
    async fn verified_model_then_supported_effort_are_applied_before_prompt() {
        for explicit in [None, Some("high")] {
            let effort = explicit.unwrap_or("low");
            let script = format!(
                r#"
IFS= read -r INIT || exit 2
printf '%s\n' '{{"jsonrpc":"2.0","id":0,"result":{{}}}}'
IFS= read -r MODEL || exit 3
case "$MODEL" in *'"method":"session/set_config_option"'*'"configId":"runtime-model"'*'"value":"b"'*) ;; *) exit 4 ;; esac
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{model_ack}}}'
IFS= read -r EFFORT || exit 5
case "$EFFORT" in *'"method":"session/set_config_option"'*'"configId":"runtime-effort"'*'"value":"{effort}"'*) ;; *) exit 6 ;; esac
printf '%s\n' '{{"jsonrpc":"2.0","id":2,"result":{effort_ack}}}'
IFS= read -r PROMPT || exit 7
case "$PROMPT" in *'"method":"session/prompt"'*) ;; *) exit 8 ;; esac
printf '%s\n' '{{"jsonrpc":"2.0","id":3,"result":{{"stopReason":"end_turn"}}}}'
"#,
                model_ack = config("b", "max"),
                effort_ack = config("b", effort)
            );
            let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script], &[], false)
                .await
                .unwrap();
            client.initialize().await.unwrap();
            let requested = RuntimeTaskOptionsV1 {
                purpose: RuntimeTaskPurposeV1::Ask,
                model: Some("b".into()),
                effort: explicit.map(str::to_owned),
            };
            tokio::time::timeout(
                std::time::Duration::from_secs(3),
                apply(&mut client, "s", &config("a", "max"), &requested),
            )
            .await
            .unwrap()
            .unwrap();
            assert_eq!(
                client
                    .session_prompt_with_idle_timeout(
                        "s",
                        "write a short answer",
                        std::time::Duration::from_secs(2),
                        std::time::Duration::from_secs(3)
                    )
                    .await
                    .unwrap(),
                crate::acp::StopReason::EndTurn
            );
            client.shutdown().await;
        }
    }

    #[tokio::test]
    async fn missing_capability_does_not_guess_and_unacknowledged_pin_fails_closed() {
        let script = format!(
            r#"
IFS= read -r INIT || exit 2
printf '%s\n' '{{"jsonrpc":"2.0","id":0,"result":{{}}}}'
IFS= read -r REQUEST || exit 3
printf '%s\n' '{{"jsonrpc":"2.0","id":1,"result":{ack}}}'
"#,
            ack = config("a", "max")
        );
        let mut client = AcpClient::spawn("/bin/sh", &["-c".into(), script], &[], false)
            .await
            .unwrap();
        client.initialize().await.unwrap();
        let mut requested = RuntimeTaskOptionsV1 {
            purpose: RuntimeTaskPurposeV1::Ask,
            model: None,
            effort: None,
        };
        // No advertised low effort: leave the native default unchanged, no RPC.
        assert!(apply(&mut client, "s", &serde_json::json!({}), &requested)
            .await
            .is_ok());
        requested.model = Some("missing".into());
        assert!(apply(&mut client, "s", &config("a", "max"), &requested)
            .await
            .is_err());
        requested.model = Some("b".into());
        assert!(apply(&mut client, "s", &config("a", "max"), &requested)
            .await
            .is_err());
        client.shutdown().await;
    }
}

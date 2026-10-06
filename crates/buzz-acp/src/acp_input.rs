//! Native AskUserQuestion forms over the private, non-signing host channel.
use super::*;
use luca_protocol::{
    ManagedInputActionV1, ManagedInputDecisionV1, ManagedInputFieldV1, ManagedInputKindV1,
    ManagedInputOptionV1, ManagedInputRequestV1, MANAGED_INPUT_PROTOCOL,
};

fn field(
    key: &str,
    value: &serde_json::Value,
    required: bool,
) -> Result<ManagedInputFieldV1, &'static str> {
    let properties = value
        .as_object()
        .ok_or("native question field is not an object")?;
    if properties.keys().any(|key| {
        !matches!(
            key.as_str(),
            "type" | "title" | "description" | "oneOf" | "items" | "_meta"
        )
    }) {
        return Err("unsupported native question constraint");
    }
    let kind = match value.get("type").and_then(|v| v.as_str()) {
        Some("array") => ManagedInputKindV1::Multiple,
        Some("string") if value.get("oneOf").is_some() => ManagedInputKindV1::Single,
        Some("string") => ManagedInputKindV1::Text,
        _ => return Err("unsupported native question field"),
    };
    if value.get("format").is_some()
        || value.get("default").is_some()
        || value.get("pattern").is_some()
    {
        return Err("unsupported native question constraint");
    }
    let options = if kind == ManagedInputKindV1::Text {
        if value.get("items").is_some() {
            return Err("invalid native text field");
        }
        Vec::new()
    } else {
        if kind == ManagedInputKindV1::Multiple {
            if value.get("oneOf").is_some()
                || !value
                    .get("items")
                    .and_then(|v| v.as_object())
                    .is_some_and(|items| items.len() == 1 && items.contains_key("anyOf"))
            {
                return Err("unsupported native multiple choice constraint");
            }
        } else if value.get("items").is_some() {
            return Err("invalid native single choice field");
        }
        let choices = (if kind == ManagedInputKindV1::Multiple {
            value.pointer("/items/anyOf")
        } else {
            value.get("oneOf")
        })
        .and_then(|v| v.as_array())
        .ok_or("native question choices missing")?;
        if choices.len() > 16 {
            return Err("native question choices exceed bound");
        }
        choices
            .iter()
            .map(|option| {
                if !option.as_object().is_some_and(|o| {
                    o.keys()
                        .all(|k| matches!(k.as_str(), "const" | "title" | "description" | "_meta"))
                }) {
                    return Err("unsupported native choice constraint");
                }
                let value = option
                    .get("const")
                    .and_then(|v| v.as_str())
                    .ok_or("native choice is not text")?
                    .to_owned();
                Ok(ManagedInputOptionV1 {
                    label: option
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&value)
                        .to_owned(),
                    value,
                    description: option
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(str::to_owned),
                })
            })
            .collect::<Result<Vec<_>, &'static str>>()?
    };
    Ok(ManagedInputFieldV1 {
        key: key.into(),
        label: value
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(key)
            .into(),
        description: value
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::to_owned),
        kind,
        options,
        required,
    })
}

fn fields(params: &serde_json::Value) -> Result<Vec<ManagedInputFieldV1>, &'static str> {
    if params.get("mode").and_then(|v| v.as_str()) != Some("form")
        || params
            .pointer("/requestedSchema/type")
            .and_then(|v| v.as_str())
            != Some("object")
    {
        return Err("only native question forms are supported");
    }
    let properties = params
        .pointer("/requestedSchema/properties")
        .and_then(|v| v.as_object())
        .ok_or("native form fields missing")?;
    if properties.is_empty() || properties.len() > 8 {
        return Err("native form exceeds bound");
    }
    if !params
        .get("requestedSchema")
        .and_then(|v| v.as_object())
        .is_some_and(|schema| {
            schema.keys().all(|key| {
                matches!(
                    key.as_str(),
                    "type" | "properties" | "required" | "title" | "description" | "_meta"
                )
            })
        })
    {
        return Err("unsupported native form constraint");
    }
    let required = params
        .pointer("/requestedSchema/required")
        .and_then(|v| v.as_array());
    if params.pointer("/requestedSchema/required").is_some()
        && !required.is_some_and(|keys| {
            keys.iter()
                .all(|key| key.as_str().is_some_and(|key| properties.contains_key(key)))
        })
    {
        return Err("invalid native required fields");
    }
    properties
        .iter()
        .map(|(key, value)| {
            let suffix = key
                .strip_prefix("question_")
                .ok_or("unsupported native question key")?;
            let index = suffix.strip_suffix("_custom").unwrap_or(suffix);
            if !matches!(index, "0" | "1" | "2" | "3") {
                return Err("unsupported native question index");
            }
            field(
                key,
                value,
                required.is_some_and(|keys| keys.iter().any(|v| v.as_str() == Some(key))),
            )
        })
        .collect()
}

impl AcpClient {
    pub(super) async fn handle_input_request(
        &mut self,
        msg: &serde_json::Value,
        expected_session: Option<&str>,
    ) -> Result<(), AcpError> {
        let Some(id) = msg.get("id") else {
            return Ok(());
        };
        let params = &msg["params"];
        let session = params.get("sessionId").and_then(|v| v.as_str());
        let tool = params.get("toolCallId").and_then(|v| v.as_str());
        let actual_ask = self.permission_display_cache.session_id.as_deref() == session
            && tool
                .and_then(|tool| self.permission_display_cache.entries.get(tool))
                .and_then(|entry| entry.display.match_fields.tool_name.as_deref())
                == Some("AskUserQuestion");
        let eligible = expected_session.is_some()
            && expected_session == session
            && actual_ask
            && !self.deny_unmanaged_permissions
            && self.restoring_session.is_none();
        let mut result = serde_json::json!({"action":"decline"});
        #[cfg(unix)]
        if eligible {
            if let (
                Some(client),
                Some(turn),
                Some(conversation),
                Some(session),
                Some(tool),
                Ok(fields),
            ) = (
                self.managed_permission.as_ref(),
                self.managed_turn_id.as_deref(),
                self.managed_conversation_id.as_deref(),
                session,
                tool,
                fields(params),
            ) {
                if let (Ok(turn_id), Ok(conversation_id), Some(message)) = (
                    luca_protocol::OpaqueId::parse(turn),
                    luca_protocol::OpaqueId::parse(conversation),
                    params.get("message").and_then(|v| v.as_str()),
                ) {
                    let request = ManagedInputRequestV1 {
                        protocol: MANAGED_INPUT_PROTOCOL.into(),
                        resident_pubkey: client.resident_pubkey.clone(),
                        session_epoch: client.session_epoch,
                        turn_id,
                        conversation_id,
                        provider_session_id: session.into(),
                        acp_request_id: serde_json::to_string(id).map_err(AcpError::Json)?,
                        tool_call_id: tool.into(),
                        message: message.into(),
                        fields,
                    };
                    result = match client.answer_input(request).await {
                        Ok(answer) => match answer.action {
                            ManagedInputActionV1::Answered => {
                                serde_json::json!({"action":"accept","content":answer.answers})
                            }
                            ManagedInputActionV1::Declined => {
                                serde_json::json!({"action":"decline"})
                            }
                            ManagedInputActionV1::Cancelled => {
                                serde_json::json!({"action":"cancel"})
                            }
                        },
                        Err(_) => serde_json::json!({"action":"cancel"}),
                    };
                }
            }
        }
        #[cfg(not(unix))]
        let _ = eligible;
        self.write_private_input_response(
            &serde_json::json!({"jsonrpc":"2.0","id":id,"result":result}),
        )
        .await
    }
}

#[cfg(unix)]
impl ManagedPermissionClient {
    async fn answer_input(
        &self,
        request: ManagedInputRequestV1,
    ) -> Result<ManagedInputDecisionV1, AcpError> {
        use futures_util::StreamExt as _;
        use tokio::io::AsyncWriteExt;
        use tokio_util::codec::{FramedRead, LinesCodec};
        request
            .validate()
            .map_err(|e| AcpError::Protocol(e.into()))?;
        let mut stream = self.stream.lock().await;
        let bytes = serde_json::to_vec(&request).map_err(AcpError::Json)?;
        if bytes.len() > MANAGED_PERMISSION_MAX_FRAME_BYTES {
            return Err(AcpError::Protocol("native question exceeds bound".into()));
        }
        stream.write_all(&bytes).await?;
        stream.write_all(b"\n").await?;
        stream.flush().await?;
        let mut reader = FramedRead::new(
            &mut *stream,
            LinesCodec::new_with_max_length(MANAGED_PERMISSION_MAX_FRAME_BYTES),
        );
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_secs(MANAGED_PERMISSION_CLIENT_DEADLINE_SECS);
        loop {
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .ok_or_else(|| AcpError::Protocol("native question expired".into()))?;
            let line = tokio::time::timeout(remaining, reader.next())
                .await
                .map_err(|_| AcpError::Protocol("native question expired".into()))?
                .ok_or_else(|| AcpError::Protocol("native question channel closed".into()))?
                .map_err(|_| AcpError::Protocol("native question frame exceeds bound".into()))?;
            if let Ok(answer) = serde_json::from_str::<ManagedInputDecisionV1>(&line) {
                if answer.validate_for(&request).is_ok() {
                    return Ok(answer);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_choices_and_custom_answer_are_preserved() {
        let p = serde_json::json!({"mode":"form","requestedSchema":{"type":"object","properties":{
            "question_0":{"type":"string","title":"Approach","oneOf":[{"const":"Small","title":"Small","description":"Small scope"},{"const":"Full","title":"Full"}]},
            "question_0_custom":{"type":"string","title":"Other"}
        }}});
        let f = fields(&p).expect("native form");
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].options[0].value, "Small");
        assert_eq!(f[1].kind, ManagedInputKindV1::Text);
    }
    #[test]
    fn unknown_forms_urls_and_field_types_fail_closed() {
        for p in [
            serde_json::json!({"mode":"url"}),
            serde_json::json!({"mode":"form","requestedSchema":{"type":"object","properties":{"credential":{"type":"string"}}}}),
            serde_json::json!({"mode":"form","requestedSchema":{"type":"object","properties":{"question_0":{"type":"number"}}}}),
        ] {
            assert!(fields(&p).is_err());
        }
    }
}

#[cfg(all(test, unix))]
#[path = "acp_input_tests.rs"]
mod wire_tests;

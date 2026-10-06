//! Private, one-shot answers to native runtime questions. Answers never grant
//! tool permissions, change configuration, or carry signing authority.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{Hex64, OpaqueId, SafeU53};

/// Wire discriminator for the host-only question channel.
pub const MANAGED_INPUT_PROTOCOL: &str = "luca.managed.input.v1";

/// One display-safe option advertised in the runtime's form.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedInputOptionV1 {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

/// The small form subset supported by the existing conversation surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedInputKindV1 {
    Text,
    Single,
    Multiple,
}

/// A provider field, with an exact opaque key and bounded text/choices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedInputFieldV1 {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
    pub kind: ManagedInputKindV1,
    pub options: Vec<ManagedInputOptionV1>,
    pub required: bool,
}

/// One question scoped to the actual host session, turn and conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedInputRequestV1 {
    pub protocol: String,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub turn_id: OpaqueId,
    pub conversation_id: OpaqueId,
    pub provider_session_id: String,
    pub acp_request_id: String,
    pub tool_call_id: String,
    pub message: String,
    pub fields: Vec<ManagedInputFieldV1>,
}

/// Only strings and advertised string selections can be returned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ManagedInputValueV1 {
    Text(String),
    Multiple(Vec<String>),
}

/// Answering or skipping a question is distinct from approving a tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedInputActionV1 {
    Answered,
    Declined,
    Cancelled,
}

/// A correlated, one-shot owner response. No answer is persisted by the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedInputDecisionV1 {
    pub protocol: String,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub turn_id: OpaqueId,
    pub conversation_id: OpaqueId,
    pub provider_session_id: String,
    pub acp_request_id: String,
    /// Exact provider tool call that asked this question, never a sibling call.
    pub tool_call_id: String,
    pub action: ManagedInputActionV1,
    pub answers: BTreeMap<String, ManagedInputValueV1>,
}

fn text(value: &str, bound: usize, empty: bool) -> bool {
    (empty || !value.trim().is_empty())
        && value.len() <= bound
        && !value
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\t'))
}

fn identifier(value: &str, bound: usize) -> bool {
    !value.trim().is_empty() && value.len() <= bound && !value.chars().any(char::is_control)
}

fn rpc_identifier(value: &str) -> bool {
    identifier(value, 256)
        && serde_json::from_str::<serde_json::Value>(value).is_ok_and(|id| match id {
            serde_json::Value::String(id) => identifier(&id, 256),
            serde_json::Value::Number(id) => id.is_u64(),
            _ => false,
        })
}

impl ManagedInputRequestV1 {
    /// Validate the whole form, rejecting partial or misleading choices.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.protocol != MANAGED_INPUT_PROTOCOL
            || !identifier(&self.provider_session_id, 512)
            || !identifier(&self.tool_call_id, 512)
            || !text(&self.message, 4096, false)
            || !rpc_identifier(&self.acp_request_id)
            || self.fields.is_empty()
            || self.fields.len() > 8
        {
            return Err("invalid native question scope or form");
        }
        let mut keys = HashSet::new();
        for field in &self.fields {
            if !text(&field.key, 64, false)
                || !field
                    .key
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
                || !keys.insert(&field.key)
                || !text(&field.label, 256, false)
                || field
                    .description
                    .as_ref()
                    .is_some_and(|s| !text(s, 4096, true))
                || field.options.len() > 16
                || (field.kind == ManagedInputKindV1::Text && !field.options.is_empty())
                || (field.kind != ManagedInputKindV1::Text && field.options.is_empty())
            {
                return Err("invalid native question field");
            }
            let mut values = HashSet::new();
            for option in &field.options {
                if !identifier(&option.value, 512)
                    || !text(&option.label, 512, false)
                    || !values.insert(&option.value)
                    || option
                        .description
                        .as_ref()
                        .is_some_and(|s| !text(s, 4096, true))
                {
                    return Err("invalid native question choice");
                }
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| "invalid question encoding")?
            .len()
            > 32 * 1024
        {
            return Err("native question exceeds its bound");
        }
        Ok(())
    }
}

impl ManagedInputDecisionV1 {
    /// Bind an answer to one current question and its advertised field values.
    pub fn validate_for(&self, request: &ManagedInputRequestV1) -> Result<(), &'static str> {
        request.validate()?;
        if self.protocol != request.protocol
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.turn_id != request.turn_id
            || self.conversation_id != request.conversation_id
            || self.provider_session_id != request.provider_session_id
            || self.acp_request_id != request.acp_request_id
            || self.tool_call_id != request.tool_call_id
            || (self.action != ManagedInputActionV1::Answered && !self.answers.is_empty())
        {
            return Err("stale or mismatched native question response");
        }
        for (key, value) in &self.answers {
            let field = request
                .fields
                .iter()
                .find(|field| field.key == *key)
                .ok_or("unadvertised native question field")?;
            match (field.kind, value) {
                (ManagedInputKindV1::Text, ManagedInputValueV1::Text(value))
                    if text(value, 4096, true) => {}
                (ManagedInputKindV1::Single, ManagedInputValueV1::Text(value))
                    if field.options.iter().any(|option| option.value == *value) => {}
                (ManagedInputKindV1::Multiple, ManagedInputValueV1::Multiple(values))
                    if values.len() <= field.options.len()
                        && values.iter().collect::<HashSet<_>>().len() == values.len()
                        && values.iter().all(|value| {
                            field.options.iter().any(|option| option.value == *value)
                        }) => {}
                _ => return Err("invalid native question answer"),
            }
        }
        if self.action == ManagedInputActionV1::Answered
            && request.fields.iter().any(|field| {
                field.required
                    && match self.answers.get(&field.key) {
                        None => true,
                        Some(ManagedInputValueV1::Text(value)) => value.trim().is_empty(),
                        Some(ManagedInputValueV1::Multiple(values)) => values.is_empty(),
                    }
            })
        {
            return Err("required native question answer is missing");
        }
        if serde_json::to_vec(self)
            .map_err(|_| "invalid answer encoding")?
            .len()
            > 32 * 1024
        {
            return Err("native question response exceeds its bound");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> ManagedInputRequestV1 {
        ManagedInputRequestV1 {
            protocol: MANAGED_INPUT_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            provider_session_id: "native-1".into(),
            acp_request_id: "4".into(),
            tool_call_id: "ask-1".into(),
            message: "Which approach?".into(),
            fields: vec![ManagedInputFieldV1 {
                key: "question_0".into(),
                label: "Approach".into(),
                description: None,
                kind: ManagedInputKindV1::Single,
                required: false,
                options: vec![
                    ManagedInputOptionV1 {
                        value: "Small".into(),
                        label: "Small".into(),
                        description: None,
                    },
                    ManagedInputOptionV1 {
                        value: "Full".into(),
                        label: "Full".into(),
                        description: None,
                    },
                ],
            }],
        }
    }
    fn answer(r: &ManagedInputRequestV1) -> ManagedInputDecisionV1 {
        ManagedInputDecisionV1 {
            protocol: r.protocol.clone(),
            resident_pubkey: r.resident_pubkey.clone(),
            session_epoch: r.session_epoch,
            turn_id: r.turn_id.clone(),
            conversation_id: r.conversation_id.clone(),
            provider_session_id: r.provider_session_id.clone(),
            acp_request_id: r.acp_request_id.clone(),
            tool_call_id: r.tool_call_id.clone(),
            action: ManagedInputActionV1::Answered,
            answers: BTreeMap::from([(
                "question_0".into(),
                ManagedInputValueV1::Text("Small".into()),
            )]),
        }
    }
    #[test]
    fn exact_answer_round_trips_without_permission_fields() {
        let r = request();
        let a = answer(&r);
        assert!(a.validate_for(&r).is_ok());
        let value = serde_json::to_value(&a).unwrap();
        assert!(value.get("option_id").is_none());
        assert!(value.get("grant").is_none());
        assert_eq!(
            serde_json::from_value::<ManagedInputDecisionV1>(value).unwrap(),
            a
        );
    }
    #[test]
    fn stale_epoch_turn_conversation_provider_and_rpc_ids_are_rejected() {
        let r = request();
        for i in 0..8 {
            let mut a = answer(&r);
            match i {
                0 => a.session_epoch = SafeU53::new(8).unwrap(),
                1 => a.turn_id = OpaqueId::parse("turn-2").unwrap(),
                2 => a.conversation_id = OpaqueId::parse("conversation-2").unwrap(),
                3 => a.provider_session_id = "other-native".into(),
                4 => a.acp_request_id = "5".into(),
                5 => a.tool_call_id = "ask-2".into(),
                6 => a.resident_pubkey = Hex64::parse("b".repeat(64)).unwrap(),
                _ => a.protocol = "luca.managed.permission.v1".into(),
            };
            assert!(a.validate_for(&r).is_err());
        }
    }
    #[test]
    fn unadvertised_field_value_and_wrong_value_type_are_rejected() {
        let r = request();
        for value in [
            ManagedInputValueV1::Text("Other".into()),
            ManagedInputValueV1::Multiple(vec!["Small".into()]),
        ] {
            let mut a = answer(&r);
            a.answers.insert("question_0".into(), value);
            assert!(a.validate_for(&r).is_err());
        }
        let mut a = answer(&r);
        a.answers.insert(
            "unadvertised".into(),
            ManagedInputValueV1::Text("Small".into()),
        );
        assert!(a.validate_for(&r).is_err());
    }
    #[test]
    fn skip_cancel_and_required_values_are_not_approvals() {
        let mut r = request();
        let mut a = answer(&r);
        a.action = ManagedInputActionV1::Declined;
        assert!(a.validate_for(&r).is_err());
        a.answers.clear();
        assert!(a.validate_for(&r).is_ok());
        r.fields[0].required = true;
        a.action = ManagedInputActionV1::Answered;
        assert!(a.validate_for(&r).is_err());
        a.action = ManagedInputActionV1::Cancelled;
        assert!(a.validate_for(&r).is_ok());
    }
    #[test]
    fn multi_choice_requires_unique_advertised_labels() {
        let mut r = request();
        r.fields[0].kind = ManagedInputKindV1::Multiple;
        let mut a = answer(&r);
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Multiple(vec!["Small".into(), "Full".into()]),
        );
        assert!(a.validate_for(&r).is_ok());
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Multiple(vec!["Small".into(), "Small".into()]),
        );
        assert!(a.validate_for(&r).is_err());
    }
    #[test]
    fn forms_reject_duplicate_keys_values_invalid_ids_and_bounds() {
        let mut r = request();
        r.fields.push(r.fields[0].clone());
        assert!(r.validate().is_err());
        let mut r = request();
        let duplicate = r.fields[0].options[0].clone();
        r.fields[0].options.push(duplicate);
        assert!(r.validate().is_err());
        let mut r = request();
        r.acp_request_id = "null".into();
        assert!(r.validate().is_err());
        let mut r = request();
        r.message = "x".repeat(4097);
        assert!(r.validate().is_err());
    }

    #[test]
    fn identifiers_reject_controls_including_escaped_rpc_string_controls() {
        for control in ['\n', '\t', '\r', '\0', '\u{7f}', '\u{85}'] {
            let mut r = request();
            r.provider_session_id.push(control);
            assert!(r.validate().is_err());
            let mut r = request();
            r.tool_call_id.push(control);
            assert!(r.validate().is_err());
            let mut r = request();
            r.acp_request_id = serde_json::to_string(&format!("rpc{control}")).unwrap();
            assert!(r.validate().is_err());
            let mut r = request();
            r.fields[0].options[0].value.push(control);
            assert!(r.validate().is_err());
        }
        for invalid in [
            "", "null", "true", "[]", "{}", "-1", "1.5", "\"\"", "\"  \"", "\n4", "4\t",
        ] {
            let mut r = request();
            r.acp_request_id = invalid.into();
            assert!(r.validate().is_err(), "accepted {invalid:?}");
        }
        for valid in ["0", "4", "18446744073709551615", "\"native-rpc:4\""] {
            let mut r = request();
            r.acp_request_id = valid.into();
            assert!(r.validate().is_ok(), "rejected {valid:?}");
        }
    }

    #[test]
    fn bounded_ids_are_exact_and_never_trimmed_or_coerced() {
        for i in 0..3 {
            let mut r = request();
            match i {
                0 => r.provider_session_id = "x".repeat(512),
                1 => r.tool_call_id = "x".repeat(512),
                _ => r.acp_request_id = serde_json::to_string(&"x".repeat(254)).unwrap(),
            }
            assert!(r.validate().is_ok());
            match i {
                0 => r.provider_session_id.push('x'),
                1 => r.tool_call_id.push('x'),
                _ => r.acp_request_id = serde_json::to_string(&"x".repeat(255)).unwrap(),
            }
            assert!(r.validate().is_err());
        }
        let r = request();
        let mut a = answer(&r);
        a.acp_request_id = "\"4\"".into();
        assert!(a.validate_for(&r).is_err());
        a = answer(&r);
        a.provider_session_id.push(' ');
        assert!(a.validate_for(&r).is_err());
        for key in [
            "",
            "question-0",
            "question.0",
            " question_0",
            "é",
            "question\n0",
        ] {
            let mut r = request();
            r.fields[0].key = key.into();
            assert!(r.validate().is_err());
        }
    }

    #[test]
    fn display_and_free_text_allow_newline_tab_but_not_other_controls() {
        let mut r = request();
        r.message = "Choose an approach\n\tcarefully".into();
        r.fields[0].label = "Approach\n\tlabel".into();
        r.fields[0].description = Some("Notes\n\tmore notes".into());
        r.fields[0].kind = ManagedInputKindV1::Text;
        r.fields[0].options.clear();
        let mut a = answer(&r);
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Text("line one\n\tline two".into()),
        );
        assert!(r.validate().is_ok());
        assert!(a.validate_for(&r).is_ok());
        for control in ['\r', '\0', '\u{7f}', '\u{85}'] {
            let mut invalid = r.clone();
            invalid.message.push(control);
            assert!(invalid.validate().is_err());
            let mut invalid = a.clone();
            invalid.answers.insert(
                "question_0".into(),
                ManagedInputValueV1::Text(format!("text{control}")),
            );
            assert!(invalid.validate_for(&r).is_err());
        }
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Text("é".repeat(2048)),
        );
        assert!(a.validate_for(&r).is_ok());
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Text("é".repeat(2049)),
        );
        assert!(a.validate_for(&r).is_err());
    }

    #[test]
    fn forms_reject_empty_excessive_fields_and_inconsistent_options() {
        let mut r = request();
        r.fields.clear();
        assert!(r.validate().is_err());
        let field = request().fields.remove(0);
        for count in [8, 9] {
            let mut r = request();
            r.fields = (0..count)
                .map(|i| {
                    let mut field = field.clone();
                    field.key = format!("question_{i}");
                    field
                })
                .collect();
            assert_eq!(r.validate().is_ok(), count == 8);
        }
        let mut r = request();
        r.fields[0].options.clear();
        assert!(r.validate().is_err());
        r.fields[0].kind = ManagedInputKindV1::Multiple;
        assert!(r.validate().is_err());
        let mut r = request();
        r.fields[0].kind = ManagedInputKindV1::Text;
        assert!(r.validate().is_err());
        for count in [16, 17] {
            let mut r = request();
            r.fields[0].options = (0..count)
                .map(|i| ManagedInputOptionV1 {
                    value: format!("choice-{i}"),
                    label: format!("Choice {i}"),
                    description: None,
                })
                .collect();
            assert_eq!(r.validate().is_ok(), count == 16);
        }
    }

    #[test]
    fn optional_text_and_multiple_answers_still_require_advertised_types() {
        let mut r = request();
        r.fields[0].kind = ManagedInputKindV1::Text;
        r.fields[0].options.clear();
        let mut a = answer(&r);
        a.answers.clear();
        assert!(a.validate_for(&r).is_ok());
        a.answers.insert(
            "question_0".into(),
            ManagedInputValueV1::Text(" \n\t".into()),
        );
        assert!(a.validate_for(&r).is_ok());
        r.fields[0].required = true;
        assert!(a.validate_for(&r).is_err());
        let mut r = request();
        r.fields[0].kind = ManagedInputKindV1::Multiple;
        r.fields[0].required = true;
        for values in [
            vec![],
            vec!["Other".into()],
            vec!["Small".into(), "Small".into()],
            vec!["Small".into(), "Full".into(), "Other".into()],
        ] {
            let mut a = answer(&r);
            a.answers
                .insert("question_0".into(), ManagedInputValueV1::Multiple(values));
            assert!(a.validate_for(&r).is_err());
        }
    }

    #[test]
    fn aggregate_request_and_answer_wire_bounds_are_enforced() {
        let mut r = request();
        let mut field = r.fields[0].clone();
        field.kind = ManagedInputKindV1::Text;
        field.options.clear();
        r.fields = (0..8)
            .map(|i| {
                let mut field = field.clone();
                field.key = format!("question_{i}");
                field
            })
            .collect();
        assert!(r.validate().is_ok());
        let mut a = answer(&r);
        a.answers = r
            .fields
            .iter()
            .map(|field| {
                (
                    field.key.clone(),
                    ManagedInputValueV1::Text("x".repeat(4096)),
                )
            })
            .collect();
        assert!(a.validate_for(&r).is_err());
        for field in &mut r.fields {
            field.description = Some("x".repeat(4096));
        }
        assert!(r.validate().is_err());
    }

    #[test]
    fn question_wire_rejects_authority_fields_invalid_scalars_and_missing_call_scope() {
        let r = request();
        for (key, value) in [
            ("grant", serde_json::json!(true)),
            ("session_epoch", serde_json::json!(9007199254740992_u64)),
            ("resident_pubkey", serde_json::json!("invalid")),
            ("turn_id", serde_json::json!("bad\nturn")),
        ] {
            let mut wire = serde_json::to_value(&r).unwrap();
            wire[key] = value;
            assert!(serde_json::from_value::<ManagedInputRequestV1>(wire).is_err());
        }
        let mut wire = serde_json::to_value(answer(&r)).unwrap();
        wire["grant"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ManagedInputDecisionV1>(wire).is_err());
        let mut wire = serde_json::to_value(answer(&r)).unwrap();
        wire.as_object_mut().unwrap().remove("tool_call_id");
        assert!(serde_json::from_value::<ManagedInputDecisionV1>(wire).is_err());
    }
}

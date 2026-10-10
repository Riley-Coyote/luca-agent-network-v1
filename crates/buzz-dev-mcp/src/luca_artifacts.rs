//! Restricted, exact-turn Artifact Canvas MCP personality.
//!
//! This process is only an authenticated adapter to the trusted desktop
//! broker. It cannot execute commands, edit files, publish messages, sign,
//! inspect the working root, or widen the managed turn's authority.

use std::{path::PathBuf, sync::Arc, time::Duration};

use nostr::prelude::rand::{rngs::OsRng, RngCore};
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router, ErrorData, ServerHandler,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::UnixStream,
};
use zeroize::Zeroizing;

const BROKER_PROTOCOL: &str = "luca.artifact.broker.v1";
const TOOL_PROTOCOL: &str = "luca.artifact.tool.v1";
// A valid 5 MiB UTF-8 inline artifact can expand substantially under JSON
// escaping. Keep the transport bounded while admitting the protocol maximum.
const MAX_BROKER_FRAME_BYTES: usize = 32 * 1024 * 1024;
const BROKER_DEADLINE: Duration = Duration::from_secs(130);
const TURN_REGISTRATION_RETRY_DELAY: Duration = Duration::from_millis(75);
const TURN_REGISTRATION_RETRIES: usize = 40;

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "snake_case")]
enum ArtifactKind {
    Html,
    Markdown,
    Text,
    Code,
    Image,
    Svg,
    Pdf,
    File,
    App,
}

#[derive(Debug, Clone, Deserialize, JsonSchema, Serialize)]
#[serde(tag = "source_type", rename_all = "snake_case", deny_unknown_fields)]
enum ArtifactSource {
    InlineText {
        content_utf8: String,
        #[serde(default)]
        declared_media_type: Option<String>,
    },
    WorkspaceFile {
        relative_path: String,
        #[serde(default)]
        declared_media_type: Option<String>,
    },
    WorkspaceDirectory {
        relative_path: String,
    },
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactCreateParams {
    title: String,
    kind: ArtifactKind,
    source: ArtifactSource,
    idempotency_key: String,
    /// An `image` artifact is shown in this turn's reply unless this is false.
    /// Ignored for every other kind.
    #[serde(default = "default_attach_to_reply")]
    attach_to_reply: bool,
}

fn default_attach_to_reply() -> bool {
    true
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactUpdateParams {
    artifact_id: String,
    expected_current_version: u64,
    #[serde(default)]
    title: Option<String>,
    source: ArtifactSource,
    idempotency_key: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema, Serialize)]
#[serde(rename_all = "snake_case")]
enum ArtifactReadMode {
    Metadata,
    BoundedText,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactReadParams {
    artifact_id: String,
    #[serde(default)]
    version: Option<u64>,
    mode: ArtifactReadMode,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ArtifactListParams {
    limit: u16,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct CanvasPresentParams {
    artifact_id: String,
    #[serde(default)]
    version: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct PreviewAttachParams {
    artifact_id: String,
    url: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct PreviewDetachParams {
    preview_session_id: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct QuickChatHighlightParams {
    /// Exact target ID supplied in the current Quick Chat screen context.
    target_id: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ResidentPlaceGetParams {}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ResidentPlaceWorkParams {
    artifact_id: String,
    version: u64,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
struct ResidentPlaceUpdateParams {
    /// Revision returned by resident_place_get; stale updates are rejected.
    expected_revision: u64,
    /// Plain-text introduction, at most 1200 characters.
    introduction: String,
    /// Authored exploration statement, at most 1600 characters; not live status.
    exploration: String,
    /// Exact own artifact version, or null to show no selected work.
    selected_work: Option<ResidentPlaceWorkParams>,
}

impl QuickChatHighlightParams {
    fn validate(&self) -> Result<(), ErrorData> {
        if self.target_id.is_empty()
            || self.target_id.len() > 160
            || !self
                .target_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b))
        {
            return Err(ErrorData::invalid_params(
                "Use a target ID from the current Quick Chat context.",
                None,
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
struct ArtifactBrokerClient {
    endpoint: PathBuf,
    capability: Arc<Zeroizing<String>>,
    capability_generation: u64,
    conversation_id: String,
    binding: ArtifactBrokerBinding,
}

#[derive(Clone)]
enum ArtifactBrokerBinding {
    // The trusted ACP gate resolves and freezes the active owner turn per call.
    TurnGate,
    ExactTurn {
        turn_id: String,
        dispatch_receipt_id: String,
        cancellation_epoch: u64,
    },
}

impl ArtifactBrokerClient {
    fn from_environment() -> Result<Self, String> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let artifact_mode = lookup("LUCA_ARTIFACT_MODE");
        let repository_mode = lookup("LUCA_REPOSITORY_MODE");
        let communications_mode = lookup("LUCA_COMMUNICATIONS_MODE");
        let enabled = [
            artifact_mode.as_deref() == Some("1"),
            repository_mode.as_deref() == Some("1"),
            communications_mode.as_deref() == Some("1"),
        ];
        if !enabled[0] || enabled.into_iter().filter(|value| *value).count() != 1 {
            return Err("Luca MCP personalities are mutually exclusive".into());
        }

        let endpoint = PathBuf::from(required_bounded_env(
            &lookup,
            "LUCA_ARTIFACT_ENDPOINT",
            4096,
        )?);
        let capability = Zeroizing::new(required_bounded_env(
            &lookup,
            "LUCA_ARTIFACT_CAPABILITY",
            71,
        )?);
        let capability_generation =
            positive_safe_u53(&lookup, "LUCA_ARTIFACT_CAPABILITY_GENERATION")?;
        let conversation_id = required_bounded_env(&lookup, "LUCA_ARTIFACT_CONVERSATION_ID", 1024)?;
        let binding = match lookup("LUCA_ARTIFACT_TURN_GATE").as_deref() {
            Some("1") => {
                if capability.len() != 64
                    || !capability.bytes().all(|byte| byte.is_ascii_hexdigit())
                    || [
                        "LUCA_ARTIFACT_TURN_ID",
                        "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID",
                        "LUCA_ARTIFACT_CANCELLATION_EPOCH",
                    ]
                    .iter()
                    .any(|name| lookup(name).is_some())
                {
                    return Err("artifact turn-gate bootstrap is invalid".into());
                }
                ArtifactBrokerBinding::TurnGate
            }
            None => {
                if capability.len() != 71
                    || !capability.starts_with("sha256:")
                    || !capability[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
                {
                    return Err("artifact broker bootstrap is invalid".into());
                }
                ArtifactBrokerBinding::ExactTurn {
                    turn_id: required_bounded_env(&lookup, "LUCA_ARTIFACT_TURN_ID", 1024)?,
                    dispatch_receipt_id: required_bounded_env(
                        &lookup,
                        "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID",
                        1024,
                    )?,
                    cancellation_epoch: positive_safe_u53(
                        &lookup,
                        "LUCA_ARTIFACT_CANCELLATION_EPOCH",
                    )?,
                }
            }
            _ => return Err("artifact turn-gate bootstrap is invalid".into()),
        };
        if !endpoint.is_absolute() {
            return Err("artifact broker bootstrap is invalid".into());
        }
        Ok(Self {
            endpoint,
            capability: Arc::new(capability),
            capability_generation,
            conversation_id,
            binding,
        })
    }

    async fn call<T: Serialize>(
        &self,
        operation: &'static str,
        arguments: T,
    ) -> Result<CallToolResult, ErrorData> {
        let operation_request_id = mint_operation_request_id();
        let (turn_id, dispatch_receipt_id, cancellation_epoch) = match &self.binding {
            ArtifactBrokerBinding::TurnGate => (None, None, None),
            ArtifactBrokerBinding::ExactTurn {
                turn_id,
                dispatch_receipt_id,
                cancellation_epoch,
            } => (
                Some(turn_id.as_str()),
                Some(dispatch_receipt_id.as_str()),
                Some(*cancellation_epoch),
            ),
        };
        let frame = BrokerFrameV1 {
            protocol: BROKER_PROTOCOL,
            capability: self.capability.as_str(),
            capability_generation: self.capability_generation,
            conversation_id: &self.conversation_id,
            turn_id,
            dispatch_receipt_id,
            cancellation_epoch,
            operation_request_id: &operation_request_id,
            operation,
            arguments,
        };
        let mut bytes = serde_json::to_vec(&frame)
            .map_err(|_| internal_error("artifact request could not be encoded"))?;
        if bytes.len() >= MAX_BROKER_FRAME_BYTES {
            return Err(ErrorData::invalid_params(
                "artifact request exceeds its bound",
                None,
            ));
        }
        bytes.push(b'\n');

        let mut retries = 0;
        let response = loop {
            let response = self.exchange(&bytes).await?;
            response.validate(operation, &operation_request_id, self)?;
            if response.diagnostic_code.as_deref() == Some("turn_not_active")
                && matches!(self.binding, ArtifactBrokerBinding::ExactTurn { .. })
                && retries < TURN_REGISTRATION_RETRIES
            {
                retries += 1;
                tokio::time::sleep(TURN_REGISTRATION_RETRY_DELAY).await;
                continue;
            }
            break response;
        };
        let result = if !response.ok && response.result.is_null() {
            serde_json::json!({"diagnostic_code": response.diagnostic_code})
        } else {
            response.result
        };
        let result = serde_json::to_string(&result)
            .map_err(|_| internal_error("artifact result could not be encoded"))?;
        let content = vec![Content::text(result)];
        if response.ok {
            Ok(CallToolResult::success(content))
        } else {
            Ok(CallToolResult::error(content))
        }
    }

    async fn exchange(&self, bytes: &[u8]) -> Result<BrokerResponseV1, ErrorData> {
        tokio::time::timeout(BROKER_DEADLINE, async {
            let mut stream = UnixStream::connect(&self.endpoint)
                .await
                .map_err(|_| internal_error("artifact broker is unavailable"))?;
            stream
                .write_all(bytes)
                .await
                .map_err(|_| internal_error("artifact broker request failed"))?;
            stream
                .flush()
                .await
                .map_err(|_| internal_error("artifact broker request failed"))?;
            let mut response = Vec::new();
            BufReader::new(stream.take((MAX_BROKER_FRAME_BYTES + 1) as u64))
                .read_until(b'\n', &mut response)
                .await
                .map_err(|_| internal_error("artifact broker response failed"))?;
            if response.len() > MAX_BROKER_FRAME_BYTES || !response.ends_with(b"\n") {
                return Err(internal_error("artifact broker response is invalid"));
            }
            serde_json::from_slice(&response)
                .map_err(|_| internal_error("artifact broker response is invalid"))
        })
        .await
        .map_err(|_| internal_error("artifact broker request timed out"))?
    }
}

#[derive(Serialize)]
struct BrokerFrameV1<'a, T> {
    protocol: &'static str,
    capability: &'a str,
    capability_generation: u64,
    conversation_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dispatch_receipt_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancellation_epoch: Option<u64>,
    operation_request_id: &'a str,
    operation: &'static str,
    arguments: T,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerResponseV1 {
    protocol: String,
    ok: bool,
    request_id: String,
    operation: String,
    capability_generation: Option<u64>,
    conversation_id: Option<String>,
    turn_id: Option<String>,
    dispatch_receipt_id: Option<String>,
    cancellation_epoch: Option<u64>,
    #[serde(default)]
    diagnostic_code: Option<String>,
    result: Value,
}

impl BrokerResponseV1 {
    fn validate(
        &self,
        operation: &str,
        request_id: &str,
        client: &ArtifactBrokerClient,
    ) -> Result<(), ErrorData> {
        let binding_valid = match &client.binding {
            ArtifactBrokerBinding::ExactTurn {
                turn_id,
                dispatch_receipt_id,
                cancellation_epoch,
            } => {
                self.capability_generation == Some(client.capability_generation)
                    && self.conversation_id.as_deref() == Some(client.conversation_id.as_str())
                    && self.turn_id.as_deref() == Some(turn_id.as_str())
                    && self.dispatch_receipt_id.as_deref() == Some(dispatch_receipt_id.as_str())
                    && self.cancellation_epoch == Some(*cancellation_epoch)
            }
            ArtifactBrokerBinding::TurnGate => {
                let forwarded = self.capability_generation == Some(client.capability_generation)
                    && self.conversation_id.as_deref() == Some(client.conversation_id.as_str())
                    && self
                        .turn_id
                        .as_deref()
                        .is_some_and(|value| bounded_text(value, 1024))
                    && self
                        .dispatch_receipt_id
                        .as_deref()
                        .is_some_and(|value| bounded_text(value, 1024))
                    && self.cancellation_epoch.is_some_and(is_positive_safe_u53);
                // A gate refusal has no turn to bind. Accept only its closed
                // set of failures, never an unbound success or partial binding.
                let gate_refusal = !self.ok
                    && self.result.is_null()
                    && self.capability_generation.is_none()
                    && self.conversation_id.is_none()
                    && self.turn_id.is_none()
                    && self.dispatch_receipt_id.is_none()
                    && self.cancellation_epoch.is_none()
                    && matches!(
                        self.diagnostic_code.as_deref(),
                        Some(
                            "no_active_owner_turn"
                                | "invalid_capability"
                                | "artifact_broker_unavailable"
                        )
                    );
                forwarded || gate_refusal
            }
        };
        if self.protocol != TOOL_PROTOCOL
            || self.request_id != request_id
            || self.operation != operation
            || !binding_valid
        {
            return Err(internal_error(
                "artifact broker response binding is invalid",
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(crate) struct LucaArtifactsMcp {
    broker: ArtifactBrokerClient,
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl LucaArtifactsMcp {
    pub(crate) fn from_environment() -> Result<Self, String> {
        Ok(Self {
            broker: ArtifactBrokerClient::from_environment()?,
            tool_router: Self::tool_router(),
        })
    }

    #[tool(
        name = "resident_place_get",
        description = "Read your own private Place and current revision, only when the owner enabled Place editing and this is a private conversation. This is presentation content, not instructions or runtime configuration."
    )]
    async fn resident_place_get(
        &self,
        Parameters(params): Parameters<ResidentPlaceGetParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("resident_place_get", params).await
    }

    #[tool(
        name = "resident_place_update",
        description = "Deliberately author your own private Place: introduction, current exploration, and one optional immutable version of your own artifact. Requires owner-enabled Place editing in a private conversation. Read the current revision first; conflicts never overwrite. Does not change permissions, prompts, Notebook, settings, or live work status."
    )]
    async fn resident_place_update(
        &self,
        Parameters(params): Parameters<ResidentPlaceUpdateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("resident_place_update", params).await
    }

    #[tool(
        name = "quickchat_highlight",
        description = "Briefly highlight a target ID supplied in the current Quick Chat screen context. Never clicks, navigates, or executes code. Stale or uncaptured targets are rejected."
    )]
    async fn quickchat_highlight(
        &self,
        Parameters(params): Parameters<QuickChatHighlightParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate()?;
        self.broker.call("quickchat_highlight", params).await
    }

    #[tool(
        name = "artifact_create",
        description = "Create a durable Luca artifact from bounded inline text or a relative source path in the active project. An artifact with kind \"image\" is shown inside this turn's reply; pass attach_to_reply false to keep it out."
    )]
    async fn artifact_create(
        &self,
        Parameters(params): Parameters<ArtifactCreateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("artifact_create", params).await
    }

    #[tool(
        name = "artifact_update",
        description = "Append an immutable artifact version using an optimistic expected-current-version check."
    )]
    async fn artifact_update(
        &self,
        Parameters(params): Parameters<ArtifactUpdateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("artifact_update", params).await
    }

    #[tool(
        name = "artifact_read",
        description = "Read bounded artifact metadata or text within the current owner and conversation scope."
    )]
    async fn artifact_read(
        &self,
        Parameters(params): Parameters<ArtifactReadParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("artifact_read", params).await
    }

    #[tool(
        name = "artifact_list",
        description = "List bounded artifact metadata within the current owner and conversation scope."
    )]
    async fn artifact_list(
        &self,
        Parameters(params): Parameters<ArtifactListParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("artifact_list", params).await
    }

    #[tool(
        name = "canvas_present",
        description = "Present an existing artifact version in Luca Canvas without modifying it."
    )]
    async fn canvas_present(
        &self,
        Parameters(params): Parameters<CanvasPresentParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("canvas_present", params).await
    }

    #[tool(
        name = "preview_attach",
        description = "Attach an agent-started loopback application URL to an app artifact in Luca Canvas."
    )]
    async fn preview_attach(
        &self,
        Parameters(params): Parameters<PreviewAttachParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("preview_attach", params).await
    }

    #[tool(
        name = "preview_detach",
        description = "Detach a live preview from Luca Canvas without stopping the agent-owned server process."
    )]
    async fn preview_detach(
        &self,
        Parameters(params): Parameters<PreviewDetachParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.broker.call("preview_detach", params).await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LucaArtifactsMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new(
                "luca-artifacts",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(
                "Create durable artifacts and present them in Luca Canvas. Start application servers with your existing harness tools, then attach only their loopback URL.",
            )
    }
}

fn positive_safe_u53(lookup: &impl Fn(&str) -> Option<String>, name: &str) -> Result<u64, String> {
    let value = required_bounded_env(lookup, name, 32)?
        .parse::<u64>()
        .map_err(|_| "artifact broker bootstrap is invalid".to_owned())?;
    if !is_positive_safe_u53(value) {
        return Err("artifact broker bootstrap is invalid".into());
    }
    Ok(value)
}

fn is_positive_safe_u53(value: u64) -> bool {
    value > 0 && value <= 9_007_199_254_740_991
}

fn bounded_text(value: &str, max_len: usize) -> bool {
    !value.is_empty() && value.len() <= max_len && !value.contains(['\0', '\n', '\r'])
}

fn required_bounded_env(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &str,
    max_len: usize,
) -> Result<String, String> {
    let value =
        lookup(name).ok_or_else(|| "artifact broker bootstrap is unavailable".to_owned())?;
    if !bounded_text(&value, max_len) {
        return Err("artifact broker bootstrap is invalid".into());
    }
    Ok(value)
}

fn mint_operation_request_id() -> String {
    let mut bytes = [0_u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

fn internal_error(message: &'static str) -> ErrorData {
    ErrorData::internal_error(message, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resident_place_schema_cannot_accept_identity_or_permission_overrides() {
        assert!(serde_json::from_value::<ResidentPlaceGetParams>(
            serde_json::json!({"resident_pubkey":"other"})
        )
        .is_err());
        let valid = serde_json::json!({
            "expected_revision": 3, "introduction": "Hello", "exploration": "A study", "selected_work": null
        });
        assert!(serde_json::from_value::<ResidentPlaceUpdateParams>(valid.clone()).is_ok());
        for field in [
            "owner",
            "resident_pubkey",
            "author",
            "enabled",
            "visibility",
        ] {
            let mut invalid = valid.clone();
            invalid[field] = serde_json::json!("override");
            assert!(serde_json::from_value::<ResidentPlaceUpdateParams>(invalid).is_err());
        }
    }

    #[test]
    fn artifact_create_shows_an_image_in_the_reply_unless_told_otherwise() {
        let without = serde_json::json!({
            "title": "A plot",
            "kind": "image",
            "source": {"source_type": "workspace_file", "relative_path": "plot.png"},
            "idempotency_key": "idem-1",
        });
        let params: ArtifactCreateParams =
            serde_json::from_value(without.clone()).expect("the field is optional");
        assert!(params.attach_to_reply, "a picture is shown by default");

        let mut opted_out = without;
        opted_out["attach_to_reply"] = serde_json::json!(false);
        let params: ArtifactCreateParams =
            serde_json::from_value(opted_out).expect("an explicit opt-out parses");
        assert!(!params.attach_to_reply);
        // The desktop reads the same field off the same JSON.
        let forwarded = serde_json::to_value(&params).expect("serialize");
        assert_eq!(forwarded["attach_to_reply"], serde_json::json!(false));
    }

    #[test]
    fn artifact_personality_exposes_only_artifact_highlight_and_place_tools() {
        let mut names = LucaArtifactsMcp::tool_router()
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "artifact_create",
                "artifact_list",
                "artifact_read",
                "artifact_update",
                "canvas_present",
                "preview_attach",
                "preview_detach",
                "quickchat_highlight",
                "resident_place_get",
                "resident_place_update",
            ]
        );
    }

    #[test]
    fn highlight_accepts_ids_but_rejects_selectors_and_unknown_fields() {
        assert!(QuickChatHighlightParams {
            target_id: "sidebar:projects".into()
        }
        .validate()
        .is_ok());
        for target in [
            "",
            "#settings",
            "button[data-secret]",
            "foo bar",
            "javascript:alert(1)",
        ] {
            assert!(QuickChatHighlightParams {
                target_id: target.into()
            }
            .validate()
            .is_err());
        }
        assert!(serde_json::from_value::<QuickChatHighlightParams>(
            serde_json::json!({"target_id":"settings", "script":"alert(1)"})
        )
        .is_err());
    }

    fn broker_client(endpoint: PathBuf, generation: u64) -> ArtifactBrokerClient {
        ArtifactBrokerClient {
            endpoint,
            capability: Arc::new(Zeroizing::new(format!("sha256:{}", "a".repeat(64)))),
            capability_generation: generation,
            conversation_id: "conversation-1".into(),
            binding: ArtifactBrokerBinding::ExactTurn {
                turn_id: "turn-1".into(),
                dispatch_receipt_id: "dispatch-1".into(),
                cancellation_epoch: 7,
            },
        }
    }

    fn gate_environment(endpoint: &str) -> std::collections::HashMap<String, String> {
        [
            ("LUCA_ARTIFACT_MODE", "1".to_owned()),
            ("LUCA_ARTIFACT_TURN_GATE", "1".to_owned()),
            ("LUCA_ARTIFACT_ENDPOINT", endpoint.to_owned()),
            ("LUCA_ARTIFACT_CAPABILITY", "b".repeat(64)),
            ("LUCA_ARTIFACT_CAPABILITY_GENERATION", "9".to_owned()),
            ("LUCA_ARTIFACT_CONVERSATION_ID", "conversation-1".to_owned()),
        ]
        .into_iter()
        .map(|(name, value)| (name.to_owned(), value))
        .collect()
    }

    #[test]
    fn conversation_projection_bootstraps_without_turn_authority() {
        let environment = gate_environment("/tmp/artifact-gate.sock");
        let client =
            ArtifactBrokerClient::from_lookup(|name| environment.get(name).cloned()).unwrap();
        assert!(matches!(client.binding, ArtifactBrokerBinding::TurnGate));
        assert_eq!(client.capability_generation, 9);
        assert_eq!(client.conversation_id, "conversation-1");

        for (name, value) in [
            ("LUCA_ARTIFACT_TURN_GATE", "unknown"),
            ("LUCA_ARTIFACT_TURN_ID", "turn-1"),
            ("LUCA_ARTIFACT_DISPATCH_RECEIPT_ID", "dispatch-1"),
            ("LUCA_ARTIFACT_CANCELLATION_EPOCH", "7"),
            ("LUCA_ARTIFACT_CAPABILITY", "invalid"),
            ("LUCA_ARTIFACT_CAPABILITY_GENERATION", "0"),
            ("LUCA_ARTIFACT_ENDPOINT", "relative.sock"),
            ("LUCA_REPOSITORY_MODE", "1"),
        ] {
            let mut invalid = environment.clone();
            invalid.insert(name.to_owned(), value.to_owned());
            assert!(
                ArtifactBrokerClient::from_lookup(|name| invalid.get(name).cloned()).is_err(),
                "{name}"
            );
        }
        let mut legacy = environment;
        legacy.remove("LUCA_ARTIFACT_TURN_GATE");
        assert!(ArtifactBrokerClient::from_lookup(|name| legacy.get(name).cloned()).is_err());
        legacy.insert(
            "LUCA_ARTIFACT_CAPABILITY".into(),
            format!("sha256:{}", "a".repeat(64)),
        );
        legacy.insert("LUCA_ARTIFACT_TURN_ID".into(), "turn-1".into());
        legacy.insert(
            "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID".into(),
            "dispatch-1".into(),
        );
        legacy.insert("LUCA_ARTIFACT_CANCELLATION_EPOCH".into(), "7".into());
        let client = ArtifactBrokerClient::from_lookup(|name| legacy.get(name).cloned()).unwrap();
        assert!(matches!(
            client.binding,
            ArtifactBrokerBinding::ExactTurn { .. }
        ));
    }

    #[tokio::test]
    async fn conversation_gate_roundtrip_reads_one_frame_without_waiting_for_eof() {
        let directory = tempfile::tempdir().unwrap();
        let endpoint = directory.path().join("gate.sock");
        let environment = gate_environment(endpoint.to_str().unwrap());
        let client =
            ArtifactBrokerClient::from_lookup(|name| environment.get(name).cloned()).unwrap();
        let listener = tokio::net::UnixListener::bind(endpoint).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            let frame: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(frame["protocol"], BROKER_PROTOCOL);
            assert_eq!(frame["conversation_id"], "conversation-1");
            assert_eq!(frame["capability"], "b".repeat(64));
            for field in ["turn_id", "dispatch_receipt_id", "cancellation_epoch"] {
                assert!(frame.get(field).is_none());
            }
            let response = serde_json::json!({
                "protocol": TOOL_PROTOCOL, "ok": true,
                "request_id": frame["operation_request_id"], "operation": frame["operation"],
                "capability_generation": 9, "conversation_id": "conversation-1",
                "turn_id": "host-current-turn", "dispatch_receipt_id": "host-current-dispatch",
                "cancellation_epoch": 12, "result": {"artifacts": []}
            });
            let mut bytes = serde_json::to_vec(&response).unwrap();
            bytes.push(b'\n');
            stream.get_mut().write_all(&bytes).await.unwrap();
            // Real gates stay open for another frame. The client must finish
            // and close its socket without requiring the server to close first.
            line.clear();
            assert_eq!(stream.read_line(&mut line).await.unwrap(), 0);
        });
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            client.call("artifact_list", serde_json::json!({"limit": 1})),
        )
        .await
        .unwrap()
        .unwrap();
        assert_ne!(result.is_error, Some(true));
        server.await.unwrap();
    }

    #[test]
    fn gate_responses_require_bound_success_or_explicit_closed_failure() {
        let environment = gate_environment("/tmp/artifact-gate.sock");
        let client =
            ArtifactBrokerClient::from_lookup(|name| environment.get(name).cloned()).unwrap();
        let valid = serde_json::json!({
            "protocol": TOOL_PROTOCOL, "ok": true,
            "request_id": "request-1", "operation": "artifact_list",
            "capability_generation": 9, "conversation_id": "conversation-1",
            "turn_id": "host-turn", "dispatch_receipt_id": "host-dispatch",
            "cancellation_epoch": 12, "result": {"artifacts": []}
        });
        let validate = |value: Value| {
            serde_json::from_value::<BrokerResponseV1>(value)
                .unwrap()
                .validate("artifact_list", "request-1", &client)
        };
        assert!(validate(valid.clone()).is_ok());
        for (field, value) in [
            ("capability_generation", serde_json::json!(8)),
            ("conversation_id", serde_json::json!("other")),
            ("turn_id", Value::Null),
            ("dispatch_receipt_id", serde_json::json!("")),
            ("cancellation_epoch", serde_json::json!(0)),
            ("request_id", serde_json::json!("other")),
            ("operation", serde_json::json!("artifact_create")),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert!(validate(invalid).is_err(), "{field}");
        }
        let refusal = serde_json::json!({
            "protocol": TOOL_PROTOCOL, "ok": false,
            "request_id": "request-1", "operation": "artifact_list",
            "diagnostic_code": "no_active_owner_turn", "result": null
        });
        assert!(validate(refusal.clone()).is_ok());
        let legacy = broker_client(PathBuf::from("/tmp/legacy.sock"), 9);
        assert!(serde_json::from_value::<BrokerResponseV1>(refusal.clone())
            .unwrap()
            .validate("artifact_list", "request-1", &legacy)
            .is_err());
        for (field, value) in [
            ("ok", serde_json::json!(true)),
            ("result", serde_json::json!({"artifacts": []})),
            ("conversation_id", serde_json::json!("conversation-1")),
            ("diagnostic_code", serde_json::json!("unknown")),
        ] {
            let mut invalid = refusal.clone();
            invalid[field] = value;
            assert!(validate(invalid).is_err(), "{field}");
        }
    }

    #[tokio::test]
    async fn restricted_sidecar_roundtrips_exact_turn_broker_coordinates() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let directory = tempfile::tempdir().unwrap();
        let endpoint = directory.path().join("artifact.sock");
        let listener = tokio::net::UnixListener::bind(&endpoint).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            let frame: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(frame["protocol"], BROKER_PROTOCOL);
            assert_eq!(frame["conversation_id"], "conversation-1");
            assert_eq!(frame["turn_id"], "turn-1");
            assert_eq!(frame["dispatch_receipt_id"], "dispatch-1");
            assert_eq!(frame["cancellation_epoch"], 7);
            assert_eq!(frame["operation"], "artifact_list");
            let response = serde_json::json!({
                "protocol": TOOL_PROTOCOL,
                "ok": true,
                "request_id": frame["operation_request_id"],
                "operation": frame["operation"],
                "capability_generation": frame["capability_generation"],
                "conversation_id": frame["conversation_id"],
                "turn_id": frame["turn_id"],
                "dispatch_receipt_id": frame["dispatch_receipt_id"],
                "cancellation_epoch": frame["cancellation_epoch"],
                "result": {"receipt": "body-free"}
            });
            let mut bytes = serde_json::to_vec(&response).unwrap();
            bytes.push(b'\n');
            stream.get_mut().write_all(&bytes).await.unwrap();
        });
        let client = broker_client(endpoint, 9);
        let result = client
            .call("artifact_list", serde_json::json!({"limit": 1}))
            .await;
        assert!(result.is_ok());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn rotated_generation_and_stopped_broker_fail_closed() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

        let directory = tempfile::tempdir().unwrap();
        let endpoint = directory.path().join("artifact.sock");
        let listener = tokio::net::UnixListener::bind(&endpoint).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut line = String::new();
            stream.read_line(&mut line).await.unwrap();
            let frame: Value = serde_json::from_str(&line).unwrap();
            let response = serde_json::json!({
                "protocol": TOOL_PROTOCOL,
                "ok": true,
                "request_id": frame["operation_request_id"],
                "operation": frame["operation"],
                "capability_generation": 8,
                "conversation_id": frame["conversation_id"],
                "turn_id": frame["turn_id"],
                "dispatch_receipt_id": frame["dispatch_receipt_id"],
                "cancellation_epoch": frame["cancellation_epoch"],
                "result": {}
            });
            let mut bytes = serde_json::to_vec(&response).unwrap();
            bytes.push(b'\n');
            stream.get_mut().write_all(&bytes).await.unwrap();
        });
        let client = broker_client(endpoint.clone(), 9);
        assert!(client
            .call("artifact_list", serde_json::json!({"limit": 1}))
            .await
            .is_err());
        server.await.unwrap();
        assert!(client
            .call("artifact_list", serde_json::json!({"limit": 1}))
            .await
            .is_err());
    }
}

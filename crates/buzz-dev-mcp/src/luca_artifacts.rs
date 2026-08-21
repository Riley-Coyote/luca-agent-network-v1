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
    io::{AsyncReadExt, AsyncWriteExt},
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

#[derive(Clone)]
struct ArtifactBrokerClient {
    endpoint: PathBuf,
    capability: Arc<Zeroizing<String>>,
    capability_generation: u64,
    conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
}

impl ArtifactBrokerClient {
    fn from_environment() -> Result<Self, String> {
        let artifact_mode = std::env::var("LUCA_ARTIFACT_MODE").ok();
        let repository_mode = std::env::var("LUCA_REPOSITORY_MODE").ok();
        let communications_mode = std::env::var("LUCA_COMMUNICATIONS_MODE").ok();
        let enabled = [
            artifact_mode.as_deref() == Some("1"),
            repository_mode.as_deref() == Some("1"),
            communications_mode.as_deref() == Some("1"),
        ];
        if enabled.into_iter().filter(|value| *value).count() != 1 {
            return Err("Luca MCP personalities are mutually exclusive".into());
        }

        let endpoint = std::env::var("LUCA_ARTIFACT_ENDPOINT")
            .map(PathBuf::from)
            .map_err(|_| "artifact broker endpoint is unavailable".to_owned())?;
        let capability = Zeroizing::new(
            std::env::var("LUCA_ARTIFACT_CAPABILITY")
                .map_err(|_| "artifact broker capability is unavailable".to_owned())?,
        );
        let capability_generation = positive_safe_u53("LUCA_ARTIFACT_CAPABILITY_GENERATION")?;
        let cancellation_epoch = positive_safe_u53("LUCA_ARTIFACT_CANCELLATION_EPOCH")?;
        let conversation_id = required_bounded_env("LUCA_ARTIFACT_CONVERSATION_ID", 1024)?;
        let turn_id = required_bounded_env("LUCA_ARTIFACT_TURN_ID", 1024)?;
        let dispatch_receipt_id = required_bounded_env("LUCA_ARTIFACT_DISPATCH_RECEIPT_ID", 1024)?;
        if !endpoint.is_absolute()
            || capability.len() != 71
            || !capability.starts_with("sha256:")
            || !capability[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("artifact broker bootstrap is invalid".into());
        }
        Ok(Self {
            endpoint,
            capability: Arc::new(capability),
            capability_generation,
            conversation_id,
            turn_id,
            dispatch_receipt_id,
            cancellation_epoch,
        })
    }

    async fn call<T: Serialize>(
        &self,
        operation: &'static str,
        arguments: T,
    ) -> Result<CallToolResult, ErrorData> {
        let operation_request_id = mint_operation_request_id();
        let frame = BrokerFrameV1 {
            protocol: BROKER_PROTOCOL,
            capability: self.capability.as_str(),
            capability_generation: self.capability_generation,
            conversation_id: &self.conversation_id,
            turn_id: &self.turn_id,
            dispatch_receipt_id: &self.dispatch_receipt_id,
            cancellation_epoch: self.cancellation_epoch,
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
                && retries < TURN_REGISTRATION_RETRIES
            {
                retries += 1;
                tokio::time::sleep(TURN_REGISTRATION_RETRY_DELAY).await;
                continue;
            }
            break response;
        };
        let result = serde_json::to_string(&response.result)
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
            stream
                .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
                .read_to_end(&mut response)
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
    turn_id: &'a str,
    dispatch_receipt_id: &'a str,
    cancellation_epoch: u64,
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
    capability_generation: u64,
    conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
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
        if self.protocol != TOOL_PROTOCOL
            || self.request_id != request_id
            || self.operation != operation
            || self.capability_generation != client.capability_generation
            || self.conversation_id != client.conversation_id
            || self.turn_id != client.turn_id
            || self.dispatch_receipt_id != client.dispatch_receipt_id
            || self.cancellation_epoch != client.cancellation_epoch
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
        name = "artifact_create",
        description = "Create a durable Luca artifact from bounded inline text or a relative source path in the active project."
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

fn positive_safe_u53(name: &str) -> Result<u64, String> {
    let value = required_bounded_env(name, 32)?
        .parse::<u64>()
        .map_err(|_| "artifact broker bootstrap is invalid".to_owned())?;
    if value == 0 || value > 9_007_199_254_740_991 {
        return Err("artifact broker bootstrap is invalid".into());
    }
    Ok(value)
}

fn required_bounded_env(name: &str, max_len: usize) -> Result<String, String> {
    let value =
        std::env::var(name).map_err(|_| "artifact broker bootstrap is unavailable".to_owned())?;
    if value.is_empty() || value.len() > max_len || value.contains(['\0', '\n', '\r']) {
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
    fn artifact_personality_exposes_exactly_seven_tools() {
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
            ]
        );
    }
}

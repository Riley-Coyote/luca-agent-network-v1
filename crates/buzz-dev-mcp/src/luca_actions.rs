//! Narrow local MCP surface for owned Luca residents.
//!
//! This process receives only a per-resident Unix socket path and an opaque
//! token. It has no relay signer, owner key, resident key, or Tauri access.

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::stdio,
    ErrorData, ServerHandler, ServiceExt,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

const MAX_RESPONSE_BYTES: u64 = 64 * 1024;

#[derive(Clone)]
pub struct LucaActionMcp {
    socket_path: String,
    token: String,
    resident_pubkey: String,
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SourceChat {
    /// The canonical Chat UUID where the user made this request.
    source_chat_id: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ProposeAgentParams {
    source_chat_id: String,
    name: String,
    instructions: String,
    /// Simple runtime choice returned by list_agent_creation_options.
    runtime: String,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    team_id: Option<String>,
    #[serde(default)]
    create_first_chat: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ProposeNativeLinkParams {
    source_chat_id: String,
    candidate_id: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ProposeTeamParams {
    source_chat_id: String,
    name: String,
    #[serde(default)]
    instructions: Option<String>,
    member_pubkeys: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ProposeProjectParams {
    source_chat_id: String,
    name: String,
    #[serde(default)]
    instructions: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct AddParticipantsParams {
    source_chat_id: String,
    /// Defaults to the source Chat.
    #[serde(default)]
    chat_id: Option<String>,
    participant_pubkeys: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct DelegateWorkParams {
    source_chat_id: String,
    assignment: String,
    #[serde(default)]
    worker_pubkeys: Vec<String>,
    #[serde(default)]
    team_id: Option<String>,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    request_id: String,
    token: String,
    resident_pubkey: String,
    source_chat_id: String,
    action: String,
    payload: Value,
}

impl LucaActionMcp {
    pub fn from_env() -> Option<Self> {
        let socket_path = std::env::var("LUCA_ACTION_BRIDGE_PATH").ok()?;
        let token = std::env::var("LUCA_ACTION_BRIDGE_TOKEN").ok()?;
        let resident_pubkey = std::env::var("LUCA_MANAGED_RESIDENT_PUBKEY").ok()?;
        if socket_path.is_empty() || token.is_empty() || resident_pubkey.is_empty() {
            return None;
        }
        Some(Self {
            socket_path,
            token,
            resident_pubkey,
            tool_router: Self::tool_router(),
        })
    }

    async fn call(
        &self,
        action: &str,
        source_chat_id: String,
        payload: Value,
    ) -> Result<String, ErrorData> {
        let request = BridgeRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            token: self.token.clone(),
            resident_pubkey: self.resident_pubkey.clone(),
            source_chat_id,
            action: action.to_owned(),
            payload,
        };
        call_bridge(&self.socket_path, &request)
            .await
            .map_err(|error| ErrorData::internal_error(error, None))
    }

    pub async fn serve(self) -> Result<(), Box<dyn std::error::Error>> {
        let service = self
            .serve_with_ct(stdio(), tokio_util::sync::CancellationToken::new())
            .await?;
        service.waiting().await?;
        Ok(())
    }
}

#[tool_router]
impl LucaActionMcp {
    #[tool(
        description = "List the simple verified runtime choices Luca can use when creating an owned agent. Call this before propose_agent."
    )]
    async fn list_agent_creation_options(
        &self,
        Parameters(p): Parameters<SourceChat>,
    ) -> Result<String, ErrorData> {
        self.call("list_agent_creation_options", p.source_chat_id, json!({}))
            .await
    }

    #[tool(
        description = "Propose creating a persistent owned agent. Luca will show the user one compact confirmation before changing anything."
    )]
    async fn propose_agent(
        &self,
        Parameters(p): Parameters<ProposeAgentParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "propose_agent",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }

    #[tool(
        description = "Propose linking one verified existing Hermes or OpenClaw candidate. Luca never creates or modifies native configuration."
    )]
    async fn propose_native_link(
        &self,
        Parameters(p): Parameters<ProposeNativeLinkParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "propose_native_link",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }

    #[tool(
        description = "Propose saving a Team roster of persistent agent pubkeys. Luca will ask the user to confirm."
    )]
    async fn propose_team(
        &self,
        Parameters(p): Parameters<ProposeTeamParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "propose_team",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }

    #[tool(
        description = "Propose creating a Project. Machine-local folder selection remains in Luca and is never sent through this tool."
    )]
    async fn propose_project(
        &self,
        Parameters(p): Parameters<ProposeProjectParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "propose_project",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }

    #[tool(
        description = "Add existing people or agents to a Chat in place. This executes directly and leaves a visible receipt."
    )]
    async fn add_participants(
        &self,
        Parameters(p): Parameters<AddParticipantsParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "add_participants",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }

    #[tool(
        description = "Delegate a focused assignment to agents or a Team. Luca creates one focused Chat, links it to the source, and reports progress there."
    )]
    async fn delegate_work(
        &self,
        Parameters(p): Parameters<DelegateWorkParams>,
    ) -> Result<String, ErrorData> {
        let source = p.source_chat_id.clone();
        self.call(
            "delegate_work",
            source,
            serde_json::to_value(p).unwrap_or_default(),
        )
        .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LucaActionMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new("luca-actions", env!("CARGO_PKG_VERSION")))
            .with_instructions("Use these tools only to carry out explicit user requests in the current Luca Chat. Ask only for missing essentials. Creation is proposed for confirmation; adding participants and delegation execute directly.")
    }
}

#[cfg(unix)]
async fn call_bridge(path: &str, request: &BridgeRequest) -> Result<String, String> {
    let mut stream = tokio::net::UnixStream::connect(path)
        .await
        .map_err(|error| format!("Luca action bridge is unavailable: {error}"))?;
    let mut encoded = serde_json::to_vec(request)
        .map_err(|error| format!("encode Luca action request: {error}"))?;
    encoded.push(b'\n');
    stream
        .write_all(&encoded)
        .await
        .map_err(|error| format!("send Luca action request: {error}"))?;
    let mut response = String::new();
    BufReader::new(stream)
        .take(MAX_RESPONSE_BYTES)
        .read_line(&mut response)
        .await
        .map_err(|error| format!("read Luca action response: {error}"))?;
    if response.trim().is_empty() {
        return Err("Luca action bridge closed without a response".into());
    }
    Ok(response.trim().to_owned())
}

#[cfg(not(unix))]
async fn call_bridge(_path: &str, _request: &BridgeRequest) -> Result<String, String> {
    Err("Luca conversational actions are unavailable on this platform".into())
}

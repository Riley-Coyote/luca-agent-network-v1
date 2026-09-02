//! Repository-only MCP personality backed by the desktop authority broker.

use std::{path::PathBuf, sync::Arc, time::Duration};

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

const BROKER_PROTOCOL: &str = "luca.repository.broker.v1";
const MAX_BROKER_FRAME_BYTES: usize = 768 * 1024;
const BROKER_DEADLINE: Duration = Duration::from_secs(130);
const RUNTIME_TASK_BROKER_DEADLINE: Duration = Duration::from_secs(24 * 60 * 60 + 15 * 60);

#[derive(Clone)]
struct RepositoryBrokerClient {
    endpoint: PathBuf,
    capability: String,
    conversation_id: String,
}

impl RepositoryBrokerClient {
    fn from_environment() -> Result<Self, String> {
        if std::env::var("LUCA_REPOSITORY_MODE").as_deref() != Ok("1") {
            return Err("repository MCP mode is unavailable".into());
        }
        let endpoint = std::env::var("LUCA_REPOSITORY_ENDPOINT")
            .map(PathBuf::from)
            .map_err(|_| "repository MCP endpoint is unavailable".to_owned())?;
        let capability = std::env::var("LUCA_REPOSITORY_CAPABILITY")
            .map_err(|_| "repository MCP capability is unavailable".to_owned())?;
        let conversation_id = std::env::var("LUCA_REPOSITORY_CONVERSATION_ID")
            .map_err(|_| "repository MCP conversation is unavailable".to_owned())?;
        if !endpoint.is_absolute()
            || endpoint.as_os_str().len() > 4096
            || !is_sha256_ref(&capability)
            || !is_opaque_id(&conversation_id)
        {
            return Err("repository MCP bootstrap is invalid".into());
        }
        Ok(Self {
            endpoint,
            capability,
            conversation_id,
        })
    }

    async fn call<T: Serialize>(
        &self,
        operation: &'static str,
        arguments: T,
    ) -> Result<CallToolResult, ErrorData> {
        self.call_with_deadline(operation, arguments, BROKER_DEADLINE)
            .await
    }

    async fn call_with_deadline<T: Serialize>(
        &self,
        operation: &'static str,
        arguments: T,
        deadline: Duration,
    ) -> Result<CallToolResult, ErrorData> {
        let frame = BrokerFrameV1 {
            protocol: BROKER_PROTOCOL,
            capability: &self.capability,
            conversation_id: &self.conversation_id,
            operation,
            arguments,
        };
        let mut bytes = serde_json::to_vec(&frame)
            .map_err(|_| internal_error("repository request could not be encoded"))?;
        if bytes.len() >= MAX_BROKER_FRAME_BYTES {
            return Err(ErrorData::invalid_params(
                "repository request exceeds its bound",
                None,
            ));
        }
        bytes.push(b'\n');
        let response = tokio::time::timeout(deadline, async {
            let mut stream = UnixStream::connect(&self.endpoint)
                .await
                .map_err(|_| internal_error("repository broker is unavailable"))?;
            stream
                .write_all(&bytes)
                .await
                .map_err(|_| internal_error("repository broker request failed"))?;
            stream
                .flush()
                .await
                .map_err(|_| internal_error("repository broker request failed"))?;
            let mut response = Vec::new();
            stream
                .take((MAX_BROKER_FRAME_BYTES + 1) as u64)
                .read_to_end(&mut response)
                .await
                .map_err(|_| internal_error("repository broker response failed"))?;
            if response.len() > MAX_BROKER_FRAME_BYTES || !response.ends_with(b"\n") {
                return Err(internal_error("repository broker response is invalid"));
            }
            serde_json::from_slice::<BrokerResponseV1>(&response)
                .map_err(|_| internal_error("repository broker response is invalid"))
        })
        .await
        .map_err(|_| internal_error("repository broker request timed out"))??;
        if response.protocol != BROKER_PROTOCOL {
            return Err(internal_error("repository broker response is invalid"));
        }
        let content = vec![Content::text(response.content)];
        if response.ok {
            Ok(CallToolResult::success(content))
        } else {
            Ok(CallToolResult::error(content))
        }
    }
}

#[derive(Serialize)]
struct BrokerFrameV1<'a, T> {
    protocol: &'static str,
    capability: &'a str,
    conversation_id: &'a str,
    operation: &'static str,
    arguments: T,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BrokerResponseV1 {
    protocol: String,
    ok: bool,
    content: String,
    #[serde(default, rename = "receipt")]
    _receipt: Option<Value>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepositoriesParams {}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProposeRuntimeTaskParams {
    /// Runtime that should perform the task. Beta accepts `codex` or `claude_code` only.
    target_runtime: String,
    /// Concise owner-facing summary for the confirmation card.
    summary: String,
    /// Complete task instruction to deliver only after the owner confirms.
    task: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeTaskResultParams {
    /// Exact completed task ID shown in Polyphonic's durable result receipt.
    task_id: String,
}

impl RuntimeTaskResultParams {
    fn validate(&self) -> Result<(), ErrorData> {
        if is_opaque_id(&self.task_id) {
            Ok(())
        } else {
            Err(ErrorData::invalid_params(
                "runtime task result reference is invalid",
                None,
            ))
        }
    }
}

impl ProposeRuntimeTaskParams {
    fn validate(&self) -> Result<(), ErrorData> {
        let valid_target = matches!(self.target_runtime.as_str(), "codex" | "claude_code");
        let valid_summary = !self.summary.trim().is_empty()
            && self.summary.len() <= 240
            && !self.summary.chars().any(char::is_control);
        let valid_task = !self.task.trim().is_empty()
            && self.task.len() <= 64 * 1024
            && !self.task.chars().any(|character| {
                character.is_control() && !matches!(character, '\n' | '\r' | '\t')
            });
        if valid_target && valid_summary && valid_task {
            Ok(())
        } else {
            Err(ErrorData::invalid_params(
                "runtime task proposal is invalid",
                None,
            ))
        }
    }
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoTreeParams {
    /// Connected repository source ID returned by `repositories`.
    source_id: String,
    /// Optional relative directory prefix.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    /// Maximum directory depth, from 1 through 16.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    depth: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoSearchParams {
    source_id: String,
    query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoReadParams {
    source_id: String,
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    offset: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoApplyPatchParams {
    source_id: String,
    /// Unified diff using repository-relative paths.
    patch: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoRunParams {
    source_id: String,
    /// Executable name. Shell interpreters and network helpers are rejected.
    executable: String,
    /// Argument array; never interpolated as a shell string.
    #[serde(default)]
    args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoSourceParams {
    source_id: String,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoDiffParams {
    source_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RepoCommitParams {
    source_id: String,
    message: String,
}

#[derive(Clone)]
pub(crate) struct LucaRepositoriesMcp {
    client: Arc<RepositoryBrokerClient>,
    tool_router: ToolRouter<LucaRepositoriesMcp>,
}

#[tool_router]
impl LucaRepositoriesMcp {
    pub(crate) fn from_environment() -> Result<Self, String> {
        Ok(Self {
            client: Arc::new(RepositoryBrokerClient::from_environment()?),
            tool_router: Self::tool_router(),
        })
    }

    #[tool(
        name = "repositories",
        description = "List repositories connected to Luca and authorized for this resident session."
    )]
    async fn repositories(
        &self,
        Parameters(params): Parameters<RepositoriesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("list", params).await
    }

    #[tool(
        name = "polyphonic_status",
        description = "Read body-free local setup, runtime, Brain, access, and capability status for this resident. Returns no paths, credentials, source bodies, or machine topology."
    )]
    async fn polyphonic_status(
        &self,
        Parameters(params): Parameters<RepositoriesParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("operator_status", params).await
    }

    #[tool(
        name = "propose_runtime_task",
        description = "Ask the owner to confirm one new Codex or Claude Code task. This only opens Polyphonic's confirmation card; nothing runs until the owner chooses a working folder, permission mode, and Run. Use after a natural request such as 'send this to Codex'."
    )]
    async fn propose_runtime_task(
        &self,
        Parameters(params): Parameters<ProposeRuntimeTaskParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate()?;
        self.client
            .call_with_deadline("propose_runtime_task", params, RUNTIME_TASK_BROKER_DEADLINE)
            .await
    }

    #[tool(
        name = "read_runtime_task_result",
        description = "Read the private result of an already-completed Polyphonic runtime task for this exact resident and conversation. Use only when Polyphonic asks you to retry synthesis; this never reruns the provider task."
    )]
    async fn read_runtime_task_result(
        &self,
        Parameters(params): Parameters<RuntimeTaskResultParams>,
    ) -> Result<CallToolResult, ErrorData> {
        params.validate()?;
        self.client.call("read_runtime_task_result", params).await
    }

    #[tool(
        name = "repo_tree",
        description = "List safe repository-relative files. Excludes credentials, dependencies, build output, binaries, ignored files, and .git internals."
    )]
    async fn repo_tree(
        &self,
        Parameters(params): Parameters<RepoTreeParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("tree", params).await
    }

    #[tool(
        name = "repo_search",
        description = "Search text in one connected repository using its source ID and optional relative path."
    )]
    async fn repo_search(
        &self,
        Parameters(params): Parameters<RepoSearchParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("search", params).await
    }

    #[tool(
        name = "repo_read",
        description = "Read a bounded line window from one safe repository-relative text file."
    )]
    async fn repo_read(
        &self,
        Parameters(params): Parameters<RepoReadParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("read", params).await
    }

    #[tool(
        name = "repo_apply_patch",
        description = "Apply a unified diff to repository-relative paths after Luca asks the owner for permission."
    )]
    async fn repo_apply_patch(
        &self,
        Parameters(params): Parameters<RepoApplyPatchParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("apply_patch", params).await
    }

    #[tool(
        name = "repo_run",
        description = "Run an executable with an argument array inside a connected repository after Luca asks permission. No shell strings, network helpers, or mutating Git subcommands."
    )]
    async fn repo_run(
        &self,
        Parameters(params): Parameters<RepoRunParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("run", params).await
    }

    #[tool(
        name = "repo_status",
        description = "Read concise Git working-tree status for one connected repository."
    )]
    async fn repo_status(
        &self,
        Parameters(params): Parameters<RepoSourceParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("status", params).await
    }

    #[tool(
        name = "repo_diff",
        description = "Read the current local diff, optionally limited to one safe relative path."
    )]
    async fn repo_diff(
        &self,
        Parameters(params): Parameters<RepoDiffParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("diff", params).await
    }

    #[tool(
        name = "repo_commit",
        description = "Create one local commit after a separate Luca approval. Respects repository hooks and never pushes."
    )]
    async fn repo_commit(
        &self,
        Parameters(params): Parameters<RepoCommitParams>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client.call("commit", params).await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for LucaRepositoriesMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(
            rmcp::model::Implementation::new("luca-repositories", env!("CARGO_PKG_VERSION")),
        )
    }
}

fn internal_error(message: &'static str) -> ErrorData {
    ErrorData::internal_error(message, None)
}

fn is_sha256_ref(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_repository_tools_and_body_free_operator_status() {
        let mut names = LucaRepositoriesMcp::tool_router()
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            vec![
                "polyphonic_status",
                "propose_runtime_task",
                "read_runtime_task_result",
                "repo_apply_patch",
                "repo_commit",
                "repo_diff",
                "repo_read",
                "repo_run",
                "repo_search",
                "repo_status",
                "repo_tree",
                "repositories",
            ]
        );
        assert!(!names.iter().any(|name| name.contains("push")));
    }

    #[test]
    fn runtime_task_proposals_are_bounded_and_explicit() {
        assert!(ProposeRuntimeTaskParams {
            target_runtime: "codex".into(),
            summary: "Inspect the project".into(),
            task: "Find and report the failing check.".into(),
        }
        .validate()
        .is_ok());
        assert!(ProposeRuntimeTaskParams {
            target_runtime: "other".into(),
            summary: "Inspect the project".into(),
            task: "Find the failing check.".into(),
        }
        .validate()
        .is_err());
        assert!(ProposeRuntimeTaskParams {
            target_runtime: "claude_code".into(),
            summary: "Inspect\nthe project".into(),
            task: "Find the failing check.".into(),
        }
        .validate()
        .is_err());
    }

    #[test]
    fn bootstrap_validators_reject_unscoped_values() {
        assert!(is_sha256_ref(&format!("sha256:{}", "a".repeat(64))));
        assert!(!is_sha256_ref("not-a-capability"));
        assert!(is_opaque_id("123e4567-e89b-12d3-a456-426614174000"));
        assert!(!is_opaque_id("../conversation"));
    }
}

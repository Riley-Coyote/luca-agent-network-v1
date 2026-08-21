#![cfg_attr(not(windows), forbid(unsafe_code))]
#![cfg_attr(windows, deny(unsafe_code))]
use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ServerCapabilities, ServerInfo},
    tool, tool_handler, tool_router,
    transport::stdio,
    ErrorData, ServerHandler, ServiceExt,
};
use std::path::Path;
use std::sync::Arc;

#[cfg(unix)]
mod luca_artifacts;
#[cfg(unix)]
mod luca_communications;
#[cfg(unix)]
mod luca_repositories;
mod paths;
mod read_file;
mod rg;
mod shell;
mod shim;
mod str_replace;
mod todo;
mod tree;
mod view_image;

#[derive(Clone)]
struct DevMcp {
    state: Arc<shell::SharedState>,
    todos: Arc<todo::TodoState>,
    tool_router: ToolRouter<DevMcp>,
}

const ARTIFACT_BOOTSTRAP_ENV: &[&str] = &[
    "LUCA_ARTIFACT_MODE",
    "LUCA_ARTIFACT_ENDPOINT",
    "LUCA_ARTIFACT_CAPABILITY",
    "LUCA_ARTIFACT_CAPABILITY_GENERATION",
    "LUCA_ARTIFACT_CONVERSATION_ID",
    "LUCA_ARTIFACT_TURN_ID",
    "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID",
    "LUCA_ARTIFACT_CANCELLATION_EPOCH",
    "LUCA_ARTIFACT_PROBE_MODE",
    "LUCA_ARTIFACT_PROBE_ENDPOINT",
    "LUCA_ARTIFACT_PROBE_NONCE",
];

#[derive(Clone)]
struct ArtifactCompatibilityProbeMcp {
    endpoint: std::net::SocketAddr,
    nonce: String,
}

impl ArtifactCompatibilityProbeMcp {
    fn from_environment() -> Result<Self, String> {
        let endpoint = bounded_probe_env("LUCA_ARTIFACT_PROBE_ENDPOINT", 64)?
            .parse::<std::net::SocketAddr>()
            .map_err(|_| "artifact compatibility probe bootstrap is invalid".to_owned())?;
        if !endpoint.ip().is_loopback() {
            return Err("artifact compatibility probe bootstrap is invalid".into());
        }
        let nonce = bounded_probe_env("LUCA_ARTIFACT_PROBE_NONCE", 64)?;
        if nonce.len() != 32
            || !nonce
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("artifact compatibility probe bootstrap is invalid".into());
        }
        Ok(Self { endpoint, nonce })
    }

    async fn emit_initialization_receipt(&self) {
        use tokio::io::AsyncWriteExt;

        let Ok(Ok(mut stream)) = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            tokio::net::TcpStream::connect(self.endpoint),
        )
        .await
        else {
            return;
        };
        let mut receipt = self.nonce.as_bytes().to_vec();
        receipt.push(b'\n');
        let _ = stream.write_all(&receipt).await;
        let _ = stream.shutdown().await;
    }
}

impl ServerHandler for ArtifactCompatibilityProbeMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().build()).with_server_info(
            rmcp::model::Implementation::new(
                "luca-artifact-compatibility-probe",
                env!("CARGO_PKG_VERSION"),
            ),
        )
    }

    async fn on_initialized(&self, _context: rmcp::service::NotificationContext<rmcp::RoleServer>) {
        self.emit_initialization_receipt().await;
    }
}

fn bounded_probe_env(name: &str, max_len: usize) -> Result<String, String> {
    let value = std::env::var(name)
        .map_err(|_| "artifact compatibility probe bootstrap is unavailable".to_owned())?;
    if value.is_empty() || value.len() > max_len || value.contains(['\0', '\n', '\r']) {
        return Err("artifact compatibility probe bootstrap is invalid".into());
    }
    Ok(value)
}

fn scrub_artifact_personality_environment() {
    let keys = std::env::vars_os().map(|(key, _)| key).collect::<Vec<_>>();
    for key in keys {
        let allowed = key
            .to_str()
            .is_some_and(|name| ARTIFACT_BOOTSTRAP_ENV.contains(&name));
        if !allowed {
            std::env::remove_var(key);
        }
    }
}

fn clear_artifact_bootstrap_environment() {
    for key in ARTIFACT_BOOTSTRAP_ENV {
        std::env::remove_var(key);
    }
}

#[tool_router]
impl DevMcp {
    fn new(state: Arc<shell::SharedState>) -> Self {
        Self {
            state,
            todos: Arc::new(todo::TodoState::new()),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        name = "shell",
        description = "Run a shell command (bash by default; set `BUZZ_SHELL` to use cmd, PowerShell, or another shell). Ephemeral process per call. Output tail-truncated to ~8KB for the LLM; full output (first 10MB) saved to artifact file. timeout_ms defaults to 120000 (2 min) if omitted; capped at 600000 (10 min). For long-running commands (git push with hooks, cargo build, test suites), use 300000+. On PATH: rg (prefer over grep; flags: -n -i -l -g <glob> -C <n> --files), tree (flags: -d <depth>; shows line counts), and buzz (Buzz relay CLI — run buzz --help for commands)."
    )]
    async fn shell(
        &self,
        Parameters(p): Parameters<shell::ShellParams>,
        context: rmcp::service::RequestContext<rmcp::service::RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        shell::run(&self.state, p, context.ct).await
    }

    #[tool(
        name = "read_file",
        description = "Read a text file and return its contents with line numbers. Returns lines in `{number}:{content}` format. Use `offset` (0-based) and `limit` (default 2000) to window into large files. Path resolved relative to workdir (defaults to server cwd). Prefer over cat/head/tail."
    )]
    async fn read_file(
        &self,
        Parameters(p): Parameters<read_file::ReadFileParams>,
    ) -> Result<String, ErrorData> {
        read_file::run(&self.state, p)
    }

    #[tool(
        name = "view_image",
        description = "Load an image from a file path, http(s) URL, or data: URL and return it as an MCP image content block that multimodal LLMs (Anthropic, OpenAI-compatible, etc.) can see. Resizes to a longest-edge of 1568px by default (override with `max_dim`, range 64..=2048). Pass-through for already-small PNG/JPEG; transcodes oversize input to PNG (if alpha) or JPEG q85. Animated GIF/WebP rejected — provide a still frame. Hard cap 20 MiB source, ~4 MiB on the wire. Relative paths resolve under `workdir` (defaults to server cwd) and may not escape it."
    )]
    async fn view_image(
        &self,
        Parameters(p): Parameters<view_image::ViewImageParams>,
    ) -> Result<CallToolResult, ErrorData> {
        view_image::run(&self.state, p).await
    }

    #[tool(
        name = "str_replace",
        description = "Atomic find-and-replace in a file. old_str must occur exactly once unless replace_all is true, in which case all occurrences are replaced. Returns a unified diff. Path resolved relative to workdir (defaults to server cwd). Prefer over sed/awk."
    )]
    async fn str_replace(
        &self,
        Parameters(p): Parameters<str_replace::StrReplaceParams>,
    ) -> Result<String, ErrorData> {
        str_replace::run(&self.state, p)
    }

    #[tool(
        name = "todo",
        description = "Session task list. Omit `todos` to read current state. Provide a full replacement array to update. Items are {text, done}. Open items removed without being marked done will trigger a warning. If the operator enables hooks for this server, the agent's _Stop hook will advise against ending the turn while items are open."
    )]
    async fn todo(
        &self,
        Parameters(p): Parameters<todo::TodoParams>,
    ) -> Result<CallToolResult, ErrorData> {
        match self.todos.handle_todo(p) {
            Ok(text) => todo::text_result(text),
            Err(e) => todo::error_result(format!("Error: {e}")),
        }
    }

    /// Hook: called by the agent before honoring end_turn. Returns
    /// non-empty objection text iff items remain open.
    #[tool(
        name = "_Stop",
        description = "Returns open todo items if any exist. Used by the agent's _Stop lifecycle hook to advise against ending with incomplete work."
    )]
    async fn stop_hook(
        &self,
        Parameters(_): Parameters<todo::HookParams>,
    ) -> Result<CallToolResult, ErrorData> {
        todo::text_result(self.todos.stop_objection())
    }

    /// Hook: called by the agent after context compaction/handoff so the
    /// todo list survives history truncation.
    #[tool(
        name = "_PostCompact",
        description = "Internal hook. Agent invokes after handoff; returns todo state for re-injection."
    )]
    async fn post_compact_hook(
        &self,
        Parameters(_): Parameters<todo::HookParams>,
    ) -> Result<CallToolResult, ErrorData> {
        todo::text_result(self.todos.post_compact())
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for DevMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(rmcp::model::Implementation::new(
                "buzz-dev-mcp",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(self.state.bootstrap_instructions.clone())
    }
}

pub fn run() -> Result<(), Box<dyn std::error::Error>> {
    let argv0 = std::env::args().next().unwrap_or_default();
    let cmd = Path::new(&argv0)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    // Multicall dispatch — sync personalities exit before any runtime is built.
    // No tracing, no tokio, no allocations beyond argv parsing.
    match cmd.as_str() {
        "rg" => std::process::exit(rg::run(std::env::args().skip(1).collect())),
        "tree" => std::process::exit(tree::run(std::env::args().skip(1).collect())),
        "git-credential-nostr" => std::process::exit(git_credential_nostr::run()),
        "git-sign-nostr" => std::process::exit(git_sign_nostr::run()),
        _ => {}
    }

    // Async personalities and MCP server mode — build the runtime.
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async_main(cmd))
}

async fn async_main(cmd: String) -> Result<(), Box<dyn std::error::Error>> {
    // HTTPS clients invoked through this MCP process need a Rustls provider;
    // repeated installation is harmless.
    let _ = rustls::crypto::ring::default_provider().install_default();

    // buzz CLI needs tokio (async HTTP client).
    if cmd == "buzz" {
        std::process::exit(buzz_cli::run_from_args(std::env::args()).await);
    }

    let artifact_mode = std::env::var("LUCA_ARTIFACT_MODE").as_deref() == Ok("1");
    let artifact_probe_mode = std::env::var("LUCA_ARTIFACT_PROBE_MODE").as_deref() == Ok("1");
    let repository_mode = std::env::var("LUCA_REPOSITORY_MODE").as_deref() == Ok("1");
    let communications_mode = std::env::var("LUCA_COMMUNICATIONS_MODE").as_deref() == Ok("1");
    if [
        artifact_mode,
        artifact_probe_mode,
        repository_mode,
        communications_mode,
    ]
    .into_iter()
    .filter(|enabled| *enabled)
    .count()
        > 1
    {
        return Err("Luca MCP personalities are mutually exclusive".into());
    }

    // The artifact personalities start with an allowlist rather than a denylist:
    // provider/operator credentials and future secret-pattern variables cannot
    // become visible merely because a new provider invents another key name.
    // Once bootstrap values are parsed below, those are removed too so an
    // accidental future child cannot inherit the per-turn capability or probe
    // receipt coordinates.
    if artifact_mode || artifact_probe_mode {
        scrub_artifact_personality_environment();
    }

    // Restricted personalities must never translate or retain signing
    // material, even if a hostile parent tries to inject legacy variables.
    if repository_mode || communications_mode {
        for key in [
            "BUZZ_ACP_DIRECT_PRIVATE_KEY",
            "BUZZ_PRIVATE_KEY",
            "NOSTR_PRIVATE_KEY",
            "BUZZ_AUTH_TAG",
        ] {
            std::env::remove_var(key);
        }
    } else if let Some(private_key) = std::env::var_os("BUZZ_ACP_DIRECT_PRIVATE_KEY") {
        // The general Buzz MCP alone retains the legacy translation needed by
        // the CLI and media helpers.
        std::env::remove_var("BUZZ_ACP_DIRECT_PRIVATE_KEY");
        std::env::set_var("BUZZ_PRIVATE_KEY", private_key);
    }

    if artifact_probe_mode {
        let probe = ArtifactCompatibilityProbeMcp::from_environment()?;
        clear_artifact_bootstrap_environment();
        let service = probe.serve(stdio()).await?;
        service.waiting().await?;
        return Ok(());
    }

    if artifact_mode {
        #[cfg(unix)]
        {
            let artifacts = luca_artifacts::LucaArtifactsMcp::from_environment()?;
            clear_artifact_bootstrap_environment();
            let service = artifacts.serve(stdio()).await?;
            service.waiting().await?;
            return Ok(());
        }
        #[cfg(not(unix))]
        return Err("Luca artifact MCP is supported only on Unix".into());
    }

    if communications_mode {
        #[cfg(unix)]
        {
            let service = luca_communications::LucaCommunicationsMcp::from_environment()?
                .serve(stdio())
                .await?;
            service.waiting().await?;
            return Ok(());
        }
        #[cfg(not(unix))]
        return Err("Luca communications MCP is supported only on Unix".into());
    }

    if repository_mode {
        #[cfg(unix)]
        {
            let service = luca_repositories::LucaRepositoriesMcp::from_environment()?
                .serve(stdio())
                .await?;
            service.waiting().await?;
            return Ok(());
        }
        #[cfg(not(unix))]
        return Err("Luca repository MCP is supported only on Unix".into());
    }

    // MCP server mode — safe to init tracing now.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();

    let cwd = std::env::current_dir()?;
    let shim = shim::Shim::install()?;
    let state = Arc::new(shell::SharedState::new(cwd, shim)?);

    let service = DevMcp::new(state).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod restricted_artifact_tests {
    use super::*;

    #[test]
    fn artifact_bootstrap_allowlist_rejects_provider_and_secret_pattern_environment() {
        for allowed in ARTIFACT_BOOTSTRAP_ENV {
            assert!(ARTIFACT_BOOTSTRAP_ENV.contains(allowed));
        }
        for forbidden in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "HERMES_API_TOKEN",
            "OPENCLAW_SECRET",
            "AWS_SESSION_TOKEN",
            "GITHUB_TOKEN",
            "OPERATOR_PASSWORD",
            "CUSTOM_CREDENTIAL",
            "BUZZ_PRIVATE_KEY",
            "BUZZ_AUTH_TAG",
            "PATH",
            "HOME",
        ] {
            assert!(!ARTIFACT_BOOTSTRAP_ENV.contains(&forbidden));
        }
    }

    #[cfg(unix)]
    #[test]
    fn artifact_descendant_environment_contains_no_bootstrap_or_operator_secrets() {
        let output = std::process::Command::new("/usr/bin/env")
            .env_clear()
            .output()
            .expect("run isolated child environment fixture");
        assert!(output.status.success());
        assert!(output.stdout.is_empty());
        let encoded = String::from_utf8_lossy(&output.stdout);
        for forbidden in [
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "HERMES_API_TOKEN",
            "OPENCLAW_SECRET",
            "LUCA_ARTIFACT_CAPABILITY",
            "LUCA_ARTIFACT_PROBE_NONCE",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[tokio::test]
    async fn probe_emits_receipt_only_through_initialized_callback() {
        use tokio::io::AsyncReadExt;

        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let probe = ArtifactCompatibilityProbeMcp {
            endpoint: listener.local_addr().unwrap(),
            nonce: "0123456789abcdef0123456789abcdef".into(),
        };
        let emitter = tokio::spawn(async move {
            probe.emit_initialization_receipt().await;
        });
        let (mut stream, peer) = listener.accept().await.unwrap();
        assert!(peer.ip().is_loopback());
        let mut body = Vec::new();
        stream.read_to_end(&mut body).await.unwrap();
        assert_eq!(body, b"0123456789abcdef0123456789abcdef\n");
        emitter.await.unwrap();
    }
}

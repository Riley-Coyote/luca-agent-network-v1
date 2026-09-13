//! Opt-in, session-scoped isolation for the owner's existing Playwright MCP.
//!
//! The runtime's own MCP configuration remains the source of tool availability.
//! We only handle the known stdio Playwright launch; extension and remote-browser
//! configurations have different state and ownership boundaries.

use crate::acp::{EnvVar, McpServer};

pub(crate) const SERVER_NAME: &str = "polyphonic-browser";
pub(crate) const PROMPT: &str = "For browser tasks, use the polyphonic-browser tools. If they are not initially visible, use the runtime tool search/discovery to find them before reporting them unavailable (the exposed tool prefix may be polyphonic_browser). This runtime session has a fresh isolated browser context; sign-ins and cookies do not persist after it closes. Do not use a different browser tool for these tasks.";
pub(crate) const UNAVAILABLE_PROMPT: &str = "Isolated browser tools are unavailable in this runtime session. For browser tasks, report that limitation; do not fall back to a shared or personal browser. Other tools remain available.";

pub(crate) fn supported_runtime(name: &str) -> bool {
    matches!(
        name,
        "codex-acp"
            | "codex"
            | "@agentclientprotocol/codex-acp"
            | "claude-agent-acp"
            | "claude-code-acp"
            | "claude"
            | "@agentclientprotocol/claude-agent-acp"
    )
}

pub(crate) fn is_designated_server(server: &McpServer) -> bool {
    server.name == SERVER_NAME
        && server.command == "npx"
        && server.args.iter().any(|arg| arg == "--isolated")
        && server
            .env
            .iter()
            .any(|item| item.name == "PLAYWRIGHT_MCP_ISOLATED" && item.value == "true")
}

const SWITCH: &str = "LUCA_PLAYWRIGHT_ISOLATED";

pub(crate) fn enabled() -> bool {
    std::env::var(SWITCH).as_deref() == Ok("1")
}

pub(crate) fn designated_server(agent_command: &str) -> Option<McpServer> {
    if !enabled() {
        return None;
    }
    let runtime = crate::config::normalize_agent_command_identity(agent_command);
    if runtime == "claude-agent-acp" || runtime == "claude" {
        return claude_server();
    }
    if runtime != "codex-acp" && runtime != "codex" {
        return None;
    }
    let home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|path| std::path::PathBuf::from(path).join(".codex"))
        })?;
    let config = std::fs::read_to_string(home.join("config.toml")).ok()?;
    server_from_codex_toml(&config)
}

fn server_from_codex_toml(config: &str) -> Option<McpServer> {
    let config: toml::Value = toml::from_str(config).ok()?;
    let server = config.get("mcp_servers")?.get("playwright")?.as_table()?;
    if server.get("enabled").and_then(toml::Value::as_bool) == Some(false) {
        return None;
    }
    if server.get("command")?.as_str()? != "npx" {
        return None;
    }
    let args = server.get("args")?.as_array()?;
    let args = args
        .iter()
        .map(toml::Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if !supported_args(&args) {
        return None;
    }
    let mut env = Vec::new();
    // Do not project runtime-owned environment, which may contain credentials,
    // into another resident's MCP process.
    if server
        .get("env")
        .is_some_and(|env| !env.as_table().is_some_and(toml::map::Map::is_empty))
    {
        return None;
    }
    env.push(EnvVar {
        name: "PLAYWRIGHT_MCP_ISOLATED".into(),
        value: "true".into(),
    });
    Some(McpServer {
        name: SERVER_NAME.into(),
        command: "npx".into(),
        args: args
            .iter()
            .map(|arg| (*arg).to_owned())
            .chain(["--isolated".into()])
            .collect(),
        env,
    })
}

fn supported_args(args: &[&str]) -> bool {
    let package = match args {
        [package] | ["-y", package] => *package,
        _ => return false,
    };
    package == "@playwright/mcp"
        || package
            .strip_prefix("@playwright/mcp@")
            .is_some_and(|version| {
                !version.is_empty()
                    && version.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_')
                    })
            })
}

fn claude_server() -> Option<McpServer> {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from)?;
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(home.join(".claude.json")).ok()?).ok()?;
    let cwd = std::env::current_dir().ok()?;
    server_from_claude_json(&config, &cwd)
}

fn server_from_claude_json(config: &serde_json::Value, cwd: &std::path::Path) -> Option<McpServer> {
    if let Some(projects) = config
        .get("projects")
        .and_then(serde_json::Value::as_object)
    {
        for ancestor in cwd.ancestors() {
            let Some(project) = projects.get(ancestor.to_str()?) else {
                continue;
            };
            if claude_disables_playwright(project) {
                return None;
            }
            if let Some(server) = project
                .get("mcpServers")
                .and_then(|servers| servers.get("playwright"))
            {
                return claude_playwright_server(server);
            }
        }
    }
    if claude_disables_playwright(config) {
        return None;
    }
    claude_playwright_server(config.get("mcpServers")?.get("playwright")?)
}

fn claude_disables_playwright(scope: &serde_json::Value) -> bool {
    scope
        .get("disabledMcpServers")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("playwright")))
}

fn claude_playwright_server(server: &serde_json::Value) -> Option<McpServer> {
    if server.get("disabled").and_then(serde_json::Value::as_bool) == Some(true)
        || server.get("command")?.as_str()? != "npx"
        || server
            .get("env")
            .and_then(serde_json::Value::as_object)
            .is_some_and(|env| !env.is_empty())
    {
        return None;
    }
    let args = server
        .get("args")?
        .as_array()?
        .iter()
        .map(serde_json::Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if !supported_args(&args) {
        return None;
    }
    Some(McpServer {
        name: SERVER_NAME.into(),
        command: "npx".into(),
        args: args
            .iter()
            .map(|arg| (*arg).to_owned())
            .chain(["--isolated".into()])
            .collect(),
        env: vec![EnvVar {
            name: "PLAYWRIGHT_MCP_ISOLATED".into(),
            value: "true".into(),
        }],
    })
}

#[cfg(test)]
mod tests {
    use super::{server_from_claude_json, server_from_codex_toml, supported_runtime};

    #[test]
    fn installed_adapter_names_receive_browser_guidance() {
        assert!(supported_runtime("@agentclientprotocol/codex-acp"));
        assert!(supported_runtime("@agentclientprotocol/claude-agent-acp"));
        assert!(supported_runtime("claude-code-acp"));
        assert!(!supported_runtime("goose"));
    }

    #[test]
    fn designates_existing_default_playwright() {
        let server = server_from_codex_toml(
            "[mcp_servers.playwright]\ncommand = 'npx'\nargs = ['-y', '@playwright/mcp']\n",
        )
        .expect("supported server");
        assert_eq!(server.name, "polyphonic-browser");
        assert_eq!(server.args, ["-y", "@playwright/mcp", "--isolated"]);
        assert!(server
            .env
            .iter()
            .any(|item| item.name == "PLAYWRIGHT_MCP_ISOLATED" && item.value == "true"));
    }

    #[test]
    fn skips_absent_and_alternative_browser_connections() {
        assert!(server_from_codex_toml("[mcp_servers.other]\ncommand = 'x'\n").is_none());
        assert!(server_from_codex_toml("[mcp_servers.playwright]\ncommand = 'npx'\nargs = ['-y', '@playwright/mcp', '--extension']\n").is_none());
        assert!(server_from_codex_toml("[mcp_servers.playwright]\ncommand = 'npx'\nargs = ['-y', '@playwright/mcp']\n[mcp_servers.playwright.env]\nPLAYWRIGHT_MCP_USER_DATA_DIR = '/tmp/shared'\n").is_none());
        assert!(server_from_codex_toml("[mcp_servers.playwright]\ncommand = 'npx'\nargs = ['@playwright/mcp']\nenabled = false\n").is_none());
        assert!(server_from_codex_toml("[mcp_servers.playwright]\ncommand = 'npx'\nargs = ['@playwright/mcp']\n[mcp_servers.playwright.env]\nTOKEN = 'secret'\n").is_none());
    }

    #[test]
    fn claude_uses_only_enabled_current_project_launcher() {
        let config = serde_json::json!({"projects": {
            "/users/riley": {"mcpServers": {"playwright": {
                "command": "npx", "args": ["@playwright/mcp"], "env": {}
            }}}
        }});
        let cwd = std::path::Path::new("/users/riley/project");
        let server = server_from_claude_json(&config, cwd).expect("configured parent project");
        assert_eq!(server.args, ["@playwright/mcp", "--isolated"]);
        assert!(server_from_claude_json(&config, std::path::Path::new("/users/other")).is_none());
        let disabled = serde_json::json!({"projects": {
            "/users/riley": {"disabledMcpServers": ["playwright"], "mcpServers": {"playwright": {
                "command": "npx", "args": ["@playwright/mcp"]
            }}}
        }});
        assert!(server_from_claude_json(&disabled, cwd).is_none());
    }

    #[test]
    fn claude_global_fallback_yields_to_project_disable() {
        let cwd = std::path::Path::new("/users/riley/project");
        let config = serde_json::json!({
            "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp"]}},
            "projects": {"/users/riley": {"mcpServers": {}}}
        });
        assert_eq!(
            server_from_claude_json(&config, cwd)
                .expect("global server")
                .args,
            ["@playwright/mcp", "--isolated"]
        );
        let disabled = serde_json::json!({
            "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp"]}},
            "projects": {"/users/riley": {"disabledMcpServers": ["playwright"]}}
        });
        assert!(server_from_claude_json(&disabled, cwd).is_none());
    }
}

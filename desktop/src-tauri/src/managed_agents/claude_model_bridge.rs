//! App-owned launcher: expands Claude's alias picker without patching the
//! installed adapter, reading credentials, or changing native settings.
use super::{known_acp_runtime, resolve_command};
use std::{path::Path, process::Command, sync::Mutex};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const BRIDGE: &str = include_str!("claude_model_bridge.mjs");

pub(crate) fn configure_claude_model_bridge(
    cmd: &mut Command,
    agent_command: &str,
) -> Result<(), String> {
    if known_acp_runtime(agent_command).is_none_or(|r| r.id != "claude") {
        return Ok(());
    }
    let entry = resolve_command(agent_command)
        .ok_or("Claude Code adapter is missing")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let dist = entry
        .parent()
        .ok_or("Claude Code adapter directory is missing")?;
    let module = dist.join("acp-agent.js");
    if !module.is_file() {
        return Err(
            "Reinstall the Claude Code connection to enable version-specific models.".into(),
        );
    }
    let root = super::buzz_managed_npm_prefix()
        .ok_or("Runtime tooling directory unavailable")?
        .join("polyphonic-models");
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let launcher = root.join("claude-agent-acp");
    let source = launcher_source(&entry, &module)?;
    if std::fs::read_to_string(&launcher).ok().as_deref() != Some(&source) {
        let staging = root.join("claude-agent-acp.next");
        std::fs::write(&staging, source).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
        std::fs::rename(staging, &launcher).map_err(|e| e.to_string())?;
    }
    cmd.env("BUZZ_ACP_AGENT_COMMAND", launcher);
    // Explicit model binding must fail closed for these managed sessions.
    cmd.env("LUCA_REQUIRE_EXACT_MODEL", "1");
    Ok(())
}

fn launcher_source(entry: &Path, module: &Path) -> Result<String, String> {
    let entry = serde_json::to_string(&entry.to_string_lossy()).map_err(|e| e.to_string())?;
    let module = serde_json::to_string(&module.to_string_lossy()).map_err(|e| e.to_string())?;
    Ok(format!("#!/usr/bin/env node\n{BRIDGE}\nimport {{ pathToFileURL }} from 'node:url';\nconst upstream = await import(pathToFileURL({module}).href);\ninstallModelBridge(upstream.ClaudeAcpAgent);\nawait import(pathToFileURL({entry}).href);\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launcher_escapes_paths_and_preserves_upstream_entry() {
        let source =
            launcher_source(Path::new("/a b/\"index.js"), Path::new("/a b/acp-agent.js")).unwrap();
        assert!(source.contains("\\\"index.js"));
        assert!(source.contains("installModelBridge(upstream.ClaudeAcpAgent)"));
        assert!(source.contains("await import(pathToFileURL("));
    }
}

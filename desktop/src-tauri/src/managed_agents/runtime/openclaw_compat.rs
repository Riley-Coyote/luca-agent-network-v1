use crate::managed_agents::ResolvedNativeRuntime;

use super::{missing_command_message, normalize_agent_args, resolve_command};

/// Resolve the ACP-facing command while preserving the imported runtime as the
/// effective identity and runtime binding.
pub(super) fn resolve_agent_command(
    native_runtime: Option<&ResolvedNativeRuntime>,
    fallback_command: String,
    fallback_agent_args: Vec<String>,
) -> Result<(String, String, Vec<String>), String> {
    let effective_command = native_runtime
        .map(|runtime| runtime.command.display().to_string())
        .unwrap_or(fallback_command);
    let native_agent_args = native_runtime.map_or_else(
        || normalize_agent_args(&effective_command, fallback_agent_args),
        |runtime| runtime.args.clone(),
    );
    let needs_adapter = native_runtime.is_some_and(|runtime| {
        runtime
            .harness_environment
            .contains_key("LUCA_OPENCLAW_CONFIG_PATH")
    });
    if needs_adapter {
        let agent_id = native_runtime
            .and_then(|runtime| runtime.harness_environment.get("LUCA_OPENCLAW_AGENT_ID"))
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "OpenClaw ACP adapter requires an exact imported agent ID".to_owned())?;
        let command = resolve_command("buzz-agent")
            .ok_or_else(|| missing_command_message("buzz-agent", "OpenClaw ACP adapter"))?;
        return Ok((
            effective_command,
            command.display().to_string(),
            vec!["openclaw-compat".into(), agent_id.clone()],
        ));
    }
    Ok((
        effective_command.clone(),
        resolve_command(&effective_command)
            .map(|path| path.display().to_string())
            .unwrap_or(effective_command),
        native_agent_args,
    ))
}

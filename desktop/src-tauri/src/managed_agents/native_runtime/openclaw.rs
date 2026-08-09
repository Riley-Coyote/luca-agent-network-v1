use std::collections::BTreeMap;

use super::{checked_executable, checked_workspace, ResolvedNativeRuntime, RuntimeBinding};

pub(super) fn resolve(binding: &RuntimeBinding) -> Result<ResolvedNativeRuntime, String> {
    let RuntimeBinding::Openclaw {
        schema_version,
        agent_id,
        executable_path,
        gateway_identity,
        gateway_url_ref,
        state_directory,
        default_workspace,
        ..
    } = binding
    else {
        return Err("OpenClaw runtime binding is unavailable".into());
    };
    if *schema_version != 1 || agent_id.trim().is_empty() {
        return Err("unsupported or incomplete OpenClaw identity binding".into());
    }
    if gateway_identity.trim().is_empty()
        || gateway_url_ref.locator != "openclaw:gateway:url"
        || gateway_url_ref.identity_hash.as_deref() != Some(gateway_identity.as_str())
    {
        return Err("OpenClaw Gateway identity reference is invalid".into());
    }
    let command = checked_executable(executable_path)?;
    let bound_state_directory = state_directory
        .as_deref()
        .ok_or_else(|| "OpenClaw state directory is unavailable".to_owned())?;
    let state_directory = bound_state_directory
        .canonicalize()
        .map_err(|_| "OpenClaw state directory is unavailable".to_owned())?;
    if state_directory != bound_state_directory || !state_directory.is_dir() {
        return Err("OpenClaw state directory changed since import".into());
    }
    let config_path = state_directory
        .join("openclaw.json")
        .canonicalize()
        .map_err(|_| "OpenClaw native configuration is unavailable".to_owned())?;
    if config_path.parent() != Some(state_directory.as_path()) || !config_path.is_file() {
        return Err("OpenClaw native configuration changed since import".into());
    }
    let default_workspace = default_workspace
        .as_deref()
        .map(checked_workspace)
        .transpose()?;
    let command_path = command.display().to_string();
    Ok(ResolvedNativeRuntime {
        command,
        args: vec!["acp".into()],
        environment: BTreeMap::new(),
        harness_environment: BTreeMap::from([
            ("LUCA_OPENCLAW_AGENT_ID".into(), agent_id.clone()),
            ("LUCA_OPENCLAW_COMMAND".into(), command_path),
            (
                "LUCA_OPENCLAW_CONFIG_PATH".into(),
                config_path.display().to_string(),
            ),
            (
                "LUCA_OPENCLAW_STATE_DIR".into(),
                state_directory.display().to_string(),
            ),
        ]),
        default_workspace,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use std::{os::unix::fs::PermissionsExt, path::Path};

    use super::*;
    use crate::managed_agents::{SecretRef, SecretRefProvider};

    fn executable_fixture(directory: &Path) -> std::path::PathBuf {
        let path = directory.join("openclaw");
        std::fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write executable fixture");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("mark fixture executable");
        path.canonicalize().expect("canonical executable fixture")
    }

    #[test]
    fn resolution_preserves_exact_agent_and_workspace_without_secrets() {
        let fixture = tempfile::tempdir().expect("tempdir");
        let state_directory = fixture.path().join("state");
        let workspace = fixture.path().join("workspace");
        std::fs::create_dir_all(&state_directory).expect("state directory");
        std::fs::create_dir_all(&workspace).expect("workspace");
        std::fs::write(state_directory.join("openclaw.json"), "{}\n")
            .expect("native OpenClaw config");
        let executable = executable_fixture(fixture.path());
        let gateway_identity = "gateway:fixture".to_string();
        let binding = RuntimeBinding::Openclaw {
            schema_version: 1,
            agent_id: "main".into(),
            executable_path: executable.clone(),
            runtime_version: "fixture".into(),
            gateway_identity: gateway_identity.clone(),
            gateway_url_ref: SecretRef {
                provider: SecretRefProvider::NativeStore,
                locator: "openclaw:gateway:url".into(),
                identity_hash: Some(gateway_identity),
            },
            gateway_token_file_ref: None,
            gateway_password_file_ref: None,
            open_claw_profile: None,
            state_directory: Some(
                state_directory
                    .canonicalize()
                    .expect("canonical state directory"),
            ),
            default_workspace: Some(workspace.clone()),
        };

        let resolved = resolve(&binding).expect("resolved OpenClaw binding");
        assert_eq!(resolved.command, executable);
        assert_eq!(resolved.args, ["acp"]);
        assert!(resolved.environment.is_empty());
        assert_eq!(
            resolved.harness_environment.get("LUCA_OPENCLAW_AGENT_ID"),
            Some(&"main".to_string())
        );
        assert_eq!(
            resolved.harness_environment.get("LUCA_OPENCLAW_COMMAND"),
            Some(&executable.display().to_string())
        );
        assert_eq!(
            resolved
                .harness_environment
                .get("LUCA_OPENCLAW_CONFIG_PATH"),
            Some(
                &state_directory
                    .join("openclaw.json")
                    .canonicalize()
                    .expect("canonical native config")
                    .display()
                    .to_string()
            )
        );
        assert_eq!(
            resolved.harness_environment.get("LUCA_OPENCLAW_STATE_DIR"),
            Some(
                &state_directory
                    .canonicalize()
                    .expect("canonical state directory")
                    .display()
                    .to_string()
            )
        );
        assert_eq!(
            resolved.default_workspace,
            Some(workspace.canonicalize().expect("canonical workspace"))
        );
    }
}

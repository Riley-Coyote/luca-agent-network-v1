use std::path::PathBuf;

use super::RuntimeBinding;

pub(crate) fn openclaw_provisioning_context(
    binding: &RuntimeBinding,
) -> Option<(String, PathBuf, PathBuf, Option<PathBuf>)> {
    match binding {
        RuntimeBinding::Openclaw {
            agent_id,
            executable_path,
            state_directory: Some(state_directory),
            default_workspace,
            ..
        } => Some((
            agent_id.clone(),
            executable_path.clone(),
            state_directory.clone(),
            default_workspace.clone(),
        )),
        RuntimeBinding::Hermes { .. } | RuntimeBinding::Openclaw { .. } => None,
    }
}

pub(crate) fn with_openclaw_agent(
    binding: &RuntimeBinding,
    agent_id: String,
    default_workspace: PathBuf,
) -> Option<RuntimeBinding> {
    match binding {
        RuntimeBinding::Openclaw {
            executable_path,
            runtime_version,
            gateway_identity,
            gateway_url_ref,
            gateway_token_file_ref,
            gateway_password_file_ref,
            open_claw_profile,
            state_directory,
            ..
        } => Some(RuntimeBinding::Openclaw {
            schema_version: 1,
            agent_id,
            executable_path: executable_path.clone(),
            runtime_version: runtime_version.clone(),
            gateway_identity: gateway_identity.clone(),
            gateway_url_ref: gateway_url_ref.clone(),
            gateway_token_file_ref: gateway_token_file_ref.clone(),
            gateway_password_file_ref: gateway_password_file_ref.clone(),
            open_claw_profile: open_claw_profile.clone(),
            state_directory: state_directory.clone(),
            default_workspace: Some(default_workspace),
        }),
        RuntimeBinding::Hermes { .. } => None,
    }
}

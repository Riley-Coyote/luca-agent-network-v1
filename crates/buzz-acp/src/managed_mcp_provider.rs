//! One-shot, local-only MCP bootstrap reader for a Luca-managed agent.
//!
//! Decoded values are never logged. Errors expose only a body-free code and
//! fail soft at the caller.

use serde::Deserialize;

#[cfg(unix)]
use std::io::Read;
#[cfg(unix)]
use zeroize::Zeroizing;

use crate::acp::{EnvVar, McpServer};

const PROTOCOL: &str = "luca.managed.mcp-bootstrap.v1";
const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_SERVERS: usize = 32;
const MAX_ARGS: usize = 128;
const MAX_ENV: usize = 64;
const MAX_TEXT_BYTES: usize = 4096;

#[derive(Debug, Clone, Copy)]
pub(crate) enum ManagedMcpBootstrapError {
    Missing,
    InvalidDescriptor,
    ReadFailed,
    InvalidFrame,
    StaleBinding,
}

impl ManagedMcpBootstrapError {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Missing => "MCP_BOOTSTRAP_MISSING",
            Self::InvalidDescriptor => "MCP_BOOTSTRAP_DESCRIPTOR_INVALID",
            Self::ReadFailed => "MCP_BOOTSTRAP_READ_FAILED",
            Self::InvalidFrame => "MCP_BOOTSTRAP_INVALID",
            Self::StaleBinding => "MCP_BOOTSTRAP_STALE",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EnvironmentBinding {
    name: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ServerSpec {
    name: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    environment: Vec<EnvironmentBinding>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bootstrap {
    protocol: String,
    resident_pubkey: String,
    session_epoch: u64,
    #[serde(default)]
    servers: Vec<ServerSpec>,
}

#[cfg(unix)]
pub(crate) fn read_inherited_servers() -> Result<Vec<McpServer>, ManagedMcpBootstrapError> {
    use nix::fcntl::{fcntl, FcntlArg, FdFlag};
    use std::os::fd::{AsRawFd, RawFd};

    let raw: RawFd = std::env::var("LUCA_MANAGED_MCP_FD")
        .map_err(|_| ManagedMcpBootstrapError::Missing)?
        .parse()
        .map_err(|_| ManagedMcpBootstrapError::InvalidDescriptor)?;
    if raw != 6 {
        return Err(ManagedMcpBootstrapError::InvalidDescriptor);
    }
    // Open a close-on-exec duplicate using the same safe pattern as the
    // permission and continuity brokers, then close the inherited original.
    let mut file = std::fs::File::open(format!("/dev/fd/{raw}"))
        .map_err(|_| ManagedMcpBootstrapError::InvalidDescriptor)?;
    fcntl(&file, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))
        .map_err(|_| ManagedMcpBootstrapError::InvalidDescriptor)?;
    if file.as_raw_fd() == raw {
        return Err(ManagedMcpBootstrapError::InvalidDescriptor);
    }
    nix::unistd::close(raw).map_err(|_| ManagedMcpBootstrapError::InvalidDescriptor)?;
    let mut bytes = Zeroizing::new(Vec::new());
    file.by_ref()
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ManagedMcpBootstrapError::ReadFailed)?;
    if bytes.is_empty() || bytes.len() > MAX_FRAME_BYTES || !bytes.ends_with(b"\n") {
        return Err(ManagedMcpBootstrapError::InvalidFrame);
    }
    bytes.pop();
    let bootstrap: Bootstrap =
        serde_json::from_slice(&bytes).map_err(|_| ManagedMcpBootstrapError::InvalidFrame)?;
    validate_binding(&bootstrap)?;
    bootstrap.servers.into_iter().map(validate_server).collect()
}

#[cfg(not(unix))]
pub(crate) fn read_inherited_servers() -> Result<Vec<McpServer>, ManagedMcpBootstrapError> {
    Err(ManagedMcpBootstrapError::Missing)
}

fn validate_binding(bootstrap: &Bootstrap) -> Result<(), ManagedMcpBootstrapError> {
    if bootstrap.protocol != PROTOCOL || bootstrap.servers.len() > MAX_SERVERS {
        return Err(ManagedMcpBootstrapError::InvalidFrame);
    }
    let resident = std::env::var("LUCA_MANAGED_RESIDENT_PUBKEY")
        .map_err(|_| ManagedMcpBootstrapError::StaleBinding)?;
    let epoch = std::env::var("LUCA_MANAGED_SESSION_EPOCH")
        .map_err(|_| ManagedMcpBootstrapError::StaleBinding)?
        .parse::<u64>()
        .map_err(|_| ManagedMcpBootstrapError::StaleBinding)?;
    if bootstrap.resident_pubkey != resident || bootstrap.session_epoch != epoch {
        return Err(ManagedMcpBootstrapError::StaleBinding);
    }
    Ok(())
}

fn validate_server(server: ServerSpec) -> Result<McpServer, ManagedMcpBootstrapError> {
    if !valid_identifier(&server.name)
        || !valid_text(&server.command, false)
        || server.args.len() > MAX_ARGS
        || server.environment.len() > MAX_ENV
        || server
            .args
            .iter()
            .any(|argument| !valid_text(argument, true))
        || server
            .environment
            .iter()
            .any(|binding| !valid_env_name(&binding.name) || !valid_text(&binding.value, true))
    {
        return Err(ManagedMcpBootstrapError::InvalidFrame);
    }
    Ok(McpServer {
        name: server.name,
        command: server.command,
        args: server.args,
        env: server
            .environment
            .into_iter()
            .map(|binding| EnvVar {
                name: binding.name,
                value: binding.value,
            })
            .collect(),
    })
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn valid_text(value: &str, allow_empty: bool) -> bool {
    (allow_empty || !value.is_empty())
        && value.len() <= MAX_TEXT_BYTES
        && !value
            .chars()
            .any(|character| matches!(character, '\0' | '\r' | '\n'))
}

fn valid_env_name(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
        && value.len() <= 128
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_control_characters_and_malformed_environment_names() {
        assert!(!valid_text("node\n--inspect", false));
        assert!(!valid_env_name("1TOKEN"));
        assert!(valid_env_name("MCP_TOKEN"));
    }

    #[test]
    fn error_codes_are_body_free() {
        assert_eq!(
            ManagedMcpBootstrapError::InvalidFrame.code(),
            "MCP_BOOTSTRAP_INVALID"
        );
    }
}

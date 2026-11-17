//! One-shot, local-only MCP bootstrap reader for a Luca-managed agent.
//!
//! Decoded values are never logged. Errors expose only a body-free code and
//! fail soft at the caller.

#![cfg_attr(not(unix), allow(dead_code))]

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

/// The Mnemos mind the owner linked this resident to (see `mnemos_link`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemorySpec {
    command: String,
    db_path: String,
    agent_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Bootstrap {
    protocol: String,
    resident_pubkey: String,
    session_epoch: u64,
    #[serde(default)]
    servers: Vec<ServerSpec>,
    #[serde(default)]
    memory: Option<MemorySpec>,
}

/// Everything a managed resident inherits for its tools: its MCP servers and,
/// when the owner linked one, the Mnemos mind it remembers with.
#[derive(Default)]
pub(crate) struct Inherited {
    pub(crate) servers: Vec<McpServer>,
    pub(crate) memory: Option<crate::mnemos_link::MnemosLink>,
}

/// The inherited MCP servers alone, for a process that runs no conversation.
pub(crate) fn read_inherited_servers() -> Result<Vec<McpServer>, ManagedMcpBootstrapError> {
    read_inherited().map(|inherited| inherited.servers)
}

#[cfg(unix)]
pub(crate) fn read_inherited() -> Result<Inherited, ManagedMcpBootstrapError> {
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
    let memory = bootstrap.memory.map(validate_memory).transpose()?;
    let servers = bootstrap
        .servers
        .into_iter()
        .map(validate_server)
        .collect::<Result<_, _>>()?;
    Ok(Inherited { servers, memory })
}

#[cfg(not(unix))]
pub(crate) fn read_inherited() -> Result<Inherited, ManagedMcpBootstrapError> {
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

fn validate_memory(
    memory: MemorySpec,
) -> Result<crate::mnemos_link::MnemosLink, ManagedMcpBootstrapError> {
    let absolute =
        |value: &str| valid_text(value, false) && std::path::Path::new(value).is_absolute();
    let agent = &memory.agent_id;
    if !absolute(&memory.command)
        || !absolute(&memory.db_path)
        || agent.is_empty()
        || agent.len() > 128
        || agent.starts_with('-')
        || !agent.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
    {
        return Err(ManagedMcpBootstrapError::InvalidFrame);
    }
    Ok(crate::mnemos_link::MnemosLink::new(
        memory.command.into(),
        memory.db_path.into(),
        memory.agent_id,
    ))
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
    fn a_linked_memory_travels_with_the_servers() {
        let frame = br#"{"protocol":"luca.managed.mcp-bootstrap.v1","residentPubkey":"aa","sessionEpoch":1,"servers":[],"memory":{"command":"/Users/pat/.local/bin/mnemos","dbPath":"/Users/pat/.mnemos/wren.db","agentId":"wren"}}"#;
        let bootstrap: Bootstrap = serde_json::from_slice(frame).unwrap();
        assert!(validate_memory(bootstrap.memory.unwrap()).is_ok());
        let unlinked = br#"{"protocol":"luca.managed.mcp-bootstrap.v1","residentPubkey":"aa","sessionEpoch":1,"servers":[]}"#;
        assert!(serde_json::from_slice::<Bootstrap>(unlinked)
            .unwrap()
            .memory
            .is_none());
    }

    #[test]
    fn a_memory_link_names_absolute_paths_and_a_mnemos_agent() {
        for (command, db_path, agent_id) in [
            ("mnemos", "/a.db", "wren"),
            ("/bin/mnemos", "a.db", "wren"),
            ("/bin/mnemos", "/a.db", "Wren"),
            ("/bin/mnemos", "/a.db", "-wren"),
            ("/bin/mnemos", "/a.db", ""),
            ("/bin/mnemos", "/a\n.db", "wren"),
        ] {
            assert!(validate_memory(MemorySpec {
                command: command.into(),
                db_path: db_path.into(),
                agent_id: agent_id.into(),
            })
            .is_err());
        }
        let extra = br#"{"command":"/bin/m","dbPath":"/a.db","agentId":"w","more":1}"#;
        assert!(serde_json::from_slice::<MemorySpec>(extra).is_err());
    }

    #[test]
    fn error_codes_are_body_free() {
        assert_eq!(
            ManagedMcpBootstrapError::InvalidFrame.code(),
            "MCP_BOOTSTRAP_INVALID"
        );
    }
}

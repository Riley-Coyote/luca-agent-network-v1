//! One-way, local-only MCP bootstrap for a Luca-managed agent harness.
//!
//! Registry metadata stays in Luca's restricted local store and secret values
//! stay in Keychain until this exact resident session is launched. The resolved
//! stdio specifications cross only an anonymous inherited descriptor. They are
//! never placed in argv, relay events, native runtime configuration, or the
//! process-wide environment.

use std::io::Write;
use std::os::fd::{AsRawFd, OwnedFd, RawFd};

use serde::Serialize;
use tauri::AppHandle;
use zeroize::Zeroizing;

const MANAGED_MCP_BOOTSTRAP_PROTOCOL: &str = "luca.managed.mcp-bootstrap.v1";
const MANAGED_MCP_MAX_FRAME_BYTES: usize = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedMcpEnvironmentV1 {
    name: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedMcpServerV1 {
    name: String,
    command: String,
    args: Vec<String>,
    environment: Vec<ManagedMcpEnvironmentV1>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedMcpBootstrapV1 {
    protocol: &'static str,
    resident_pubkey: String,
    session_epoch: u64,
    servers: Vec<ManagedMcpServerV1>,
}

/// Child-side descriptor for the one-shot bootstrap frame.
pub(crate) struct ManagedMcpChildFd(OwnedFd);

impl ManagedMcpChildFd {
    pub(crate) fn raw_fd(&self) -> RawFd {
        self.0.as_raw_fd()
    }
}

/// Resolve the exact resident's grants and create a one-shot inherited frame.
///
/// Registry, validation, or Keychain failure deliberately yields an empty MCP
/// set. Agent messaging must remain available when optional connections fail.
pub(crate) fn create_endpoint(
    app: AppHandle,
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: luca_protocol::SafeU53,
) -> Result<ManagedMcpChildFd, String> {
    let resolved = super::mcp_registry::resolve_for_resident(&app, resident_pubkey.as_str())
        .unwrap_or_default();
    let servers = resolved
        .into_iter()
        .map(|server| ManagedMcpServerV1 {
            name: server.name,
            command: server.command,
            args: server.args,
            environment: server
                .environment
                .into_iter()
                .map(|(name, value)| ManagedMcpEnvironmentV1 { name, value })
                .collect(),
        })
        .collect();
    let frame = ManagedMcpBootstrapV1 {
        protocol: MANAGED_MCP_BOOTSTRAP_PROTOCOL,
        resident_pubkey: resident_pubkey.as_str().to_owned(),
        session_epoch: session_epoch.get(),
        servers,
    };
    let mut payload = Zeroizing::new(
        serde_json::to_vec(&frame).map_err(|_| "MCP bootstrap could not be encoded".to_string())?,
    );
    if payload.len() > MANAGED_MCP_MAX_FRAME_BYTES {
        return Err("MCP bootstrap exceeds the local transport bound".into());
    }
    payload.push(b'\n');

    let (mut desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed MCP socketpair: {error}"))?;
    std::thread::Builder::new()
        .name("luca-managed-mcp-bootstrap".into())
        .spawn(move || {
            let _ = desktop.write_all(&payload);
            let _ = desktop.flush();
        })
        .map_err(|error| format!("start managed MCP bootstrap: {error}"))?;
    Ok(ManagedMcpChildFd(child.into()))
}

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

use crate::commands::MNEMOS_SERVER;

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

/// The Mnemos mind a linked resident remembers with: the person's own command
/// and the exact store and agent, so the runner can wake the resident and cue
/// each message the way the person's other apps' hooks do.
#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedMemoryLinkV1 {
    command: String,
    db_path: String,
    agent_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedMcpBootstrapV1 {
    protocol: &'static str,
    resident_pubkey: String,
    session_epoch: u64,
    servers: Vec<ManagedMcpServerV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory: Option<ManagedMemoryLinkV1>,
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
    let mut servers: Vec<ManagedMcpServerV1> = resolved
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
    let memory = crate::commands::linked_mnemos_mind(&app, resident_pubkey.as_str())
        .and_then(|mind| link_mnemos(&mut servers, mind));
    let frame = ManagedMcpBootstrapV1 {
        protocol: MANAGED_MCP_BOOTSTRAP_PROTOCOL,
        resident_pubkey: resident_pubkey.as_str().to_owned(),
        session_epoch: session_epoch.get(),
        servers,
        memory,
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

/// Give a linked resident its mind's tools: the person's own `mnemos serve`
/// on the linked store and agent, as `mnemos connect` sets it up for their
/// other apps. The link replaces any other server of that name, so the
/// resident never holds two memories.
fn link_mnemos(
    servers: &mut Vec<ManagedMcpServerV1>,
    mind: crate::commands::LinkedMnemosMind,
) -> Option<ManagedMemoryLinkV1> {
    let command = mind.command.to_str()?.to_owned();
    let db_path = mind.db.to_str()?.to_owned();
    servers.retain(|server| !server.name.eq_ignore_ascii_case(MNEMOS_SERVER));
    servers.push(ManagedMcpServerV1 {
        name: MNEMOS_SERVER.to_owned(),
        command: command.clone(),
        args: vec![
            "serve".to_owned(),
            "--agent-id".to_owned(),
            mind.agent_id.clone(),
            "--db-path".to_owned(),
            db_path.clone(),
        ],
        environment: Vec::new(),
    });
    Some(ManagedMemoryLinkV1 {
        command,
        db_path,
        agent_id: mind.agent_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_linked_mind_brings_its_own_tools_and_replaces_any_other_mnemos() {
        let mut servers = vec![
            ManagedMcpServerV1 {
                name: "Mnemos".into(),
                command: "/elsewhere/mnemos".into(),
                args: vec!["serve".into()],
                environment: Vec::new(),
            },
            ManagedMcpServerV1 {
                name: "files".into(),
                command: "/usr/bin/files".into(),
                args: Vec::new(),
                environment: Vec::new(),
            },
        ];
        let memory = link_mnemos(
            &mut servers,
            crate::commands::LinkedMnemosMind {
                command: "/Users/pat/.local/bin/mnemos".into(),
                db: "/Users/pat/.mnemos/wren.db".into(),
                agent_id: "wren".into(),
            },
        )
        .unwrap();
        let names: Vec<_> = servers.iter().map(|server| server.name.as_str()).collect();
        assert_eq!(names, ["files", "mnemos"]);
        let mnemos = &servers[1];
        assert_eq!(mnemos.command, "/Users/pat/.local/bin/mnemos");
        assert_eq!(
            mnemos.args,
            [
                "serve",
                "--agent-id",
                "wren",
                "--db-path",
                "/Users/pat/.mnemos/wren.db"
            ]
        );
        let frame = serde_json::to_value(ManagedMcpBootstrapV1 {
            protocol: MANAGED_MCP_BOOTSTRAP_PROTOCOL,
            resident_pubkey: "a".repeat(64),
            session_epoch: 1,
            servers,
            memory: Some(memory),
        })
        .unwrap();
        assert_eq!(
            frame["memory"],
            serde_json::json!({
                "command": "/Users/pat/.local/bin/mnemos",
                "dbPath": "/Users/pat/.mnemos/wren.db",
                "agentId": "wren",
            })
        );
    }

    #[test]
    fn an_unlinked_frame_has_no_memory_field() {
        let frame = serde_json::to_value(ManagedMcpBootstrapV1 {
            protocol: MANAGED_MCP_BOOTSTRAP_PROTOCOL,
            resident_pubkey: "a".repeat(64),
            session_epoch: 1,
            servers: Vec::new(),
            memory: None,
        })
        .unwrap();
        assert!(frame.get("memory").is_none());
    }
}

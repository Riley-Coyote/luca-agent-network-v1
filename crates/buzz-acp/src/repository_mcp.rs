//! Per-conversation repository MCP capability projection.
//!
//! The desktop gives the harness one session master capability. The harness
//! never forwards that master: it derives an independent capability for each
//! channel and gives only that derived value to the repository MCP child.

use std::{fmt, path::Path, str::FromStr};

use luca_protocol::{Hex64, SafeU53, Sha256Ref};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::acp::{EnvVar, McpServer};

const BROKER_PROTOCOL: &str = "luca.repository.broker.v1";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RepositoryMcpBootstrapV1 {
    protocol: String,
    endpoint: String,
    master_capability: Sha256Ref,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
}

impl fmt::Debug for RepositoryMcpBootstrapV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RepositoryMcpBootstrapV1")
            .field("protocol", &self.protocol)
            .field("endpoint", &"<local socket>")
            .field("master_capability", &"<redacted>")
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("binding_ref", &self.binding_ref)
            .finish()
    }
}

impl FromStr for RepositoryMcpBootstrapV1 {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bootstrap: Self = serde_json::from_str(value)
            .map_err(|_| "repository MCP bootstrap is invalid".to_owned())?;
        if bootstrap.protocol != BROKER_PROTOCOL
            || !Path::new(&bootstrap.endpoint).is_absolute()
            || bootstrap.endpoint.len() > 4096
        {
            return Err("repository MCP bootstrap is invalid".into());
        }
        Ok(bootstrap)
    }
}

#[derive(Clone)]
pub(crate) struct RepositoryMcpConfig {
    command: String,
    bootstrap: RepositoryMcpBootstrapV1,
}

impl fmt::Debug for RepositoryMcpConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RepositoryMcpConfig")
            .field("command", &self.command)
            .field("bootstrap", &self.bootstrap)
            .finish()
    }
}

impl RepositoryMcpConfig {
    pub(crate) fn new(
        command: String,
        bootstrap: Option<RepositoryMcpBootstrapV1>,
        managed_identity: Option<(&Hex64, SafeU53, &Sha256Ref)>,
    ) -> Result<Option<Self>, String> {
        let command = command.trim().to_owned();
        match (command.is_empty(), bootstrap) {
            (true, None) => Ok(None),
            (false, Some(bootstrap)) => {
                let Some((resident_pubkey, session_epoch, binding_ref)) = managed_identity else {
                    return Err("repository MCP requires an exact managed desktop bootstrap".into());
                };
                if bootstrap.resident_pubkey != *resident_pubkey
                    || bootstrap.session_epoch != session_epoch
                    || bootstrap.binding_ref != *binding_ref
                {
                    return Err(
                        "repository MCP bootstrap does not match the managed session".into(),
                    );
                }
                Ok(Some(Self { command, bootstrap }))
            }
            _ => Err("repository MCP requires an exact managed desktop bootstrap".into()),
        }
    }

    pub(crate) fn server_for(&self, conversation_id: Uuid) -> McpServer {
        let conversation_id = conversation_id.to_string();
        let capability = derive_conversation_capability(
            self.bootstrap.master_capability.as_str(),
            &conversation_id,
        );
        McpServer {
            name: "luca-repositories".into(),
            command: self.command.clone(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_REPOSITORY_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_ENDPOINT".into(),
                    value: self.bootstrap.endpoint.clone(),
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_CAPABILITY".into(),
                    value: capability,
                },
                EnvVar {
                    name: "LUCA_REPOSITORY_CONVERSATION_ID".into(),
                    value: conversation_id,
                },
            ],
        }
    }
}

fn derive_conversation_capability(master_capability: &str, conversation_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"luca.repository.conversation-capability.v1\0");
    digest.update(master_capability.as_bytes());
    digest.update(b"\0");
    digest.update(conversation_id.as_bytes());
    format!("sha256:{}", hex::encode(digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bootstrap(master: &str) -> RepositoryMcpBootstrapV1 {
        serde_json::from_value(serde_json::json!({
            "protocol": BROKER_PROTOCOL,
            "endpoint": "/tmp/luca-repository.sock",
            "masterCapability": master,
            "residentPubkey": "11".repeat(32),
            "sessionEpoch": 7,
            "bindingRef": format!("sha256:{}", "22".repeat(32)),
        }))
        .expect("valid bootstrap")
    }

    #[test]
    fn server_receives_only_conversation_capability() {
        let master = format!("sha256:{}", "33".repeat(32));
        let resident = Hex64::parse("11".repeat(32)).expect("resident");
        let binding = Sha256Ref::parse(format!("sha256:{}", "22".repeat(32))).expect("binding");
        let config = RepositoryMcpConfig::new(
            "/opt/luca/buzz-dev-mcp".into(),
            Some(bootstrap(&master)),
            Some((&resident, SafeU53::new(7).expect("epoch"), &binding)),
        )
        .expect("config")
        .expect("present");
        let first_id = Uuid::new_v4();
        let second_id = Uuid::new_v4();
        let first = config.server_for(first_id);
        let second = config.server_for(second_id);
        assert_eq!(first.name, "luca-repositories");
        assert!(!first.env.iter().any(|entry| entry.value == master));
        assert_ne!(
            first
                .env
                .iter()
                .find(|entry| entry.name == "LUCA_REPOSITORY_CAPABILITY")
                .map(|entry| &entry.value),
            second
                .env
                .iter()
                .find(|entry| entry.name == "LUCA_REPOSITORY_CAPABILITY")
                .map(|entry| &entry.value),
        );
        let debug = format!("{config:?}");
        assert!(!debug.contains(&master));
        assert!(!debug.contains("/tmp/luca-repository.sock"));
    }

    #[test]
    fn repository_mcp_fails_closed_outside_managed_mode() {
        assert!(RepositoryMcpConfig::new(
            "buzz-dev-mcp".into(),
            Some(bootstrap(&format!("sha256:{}", "44".repeat(32)))),
            None,
        )
        .is_err());
        assert!(RepositoryMcpConfig::new("buzz-dev-mcp".into(), None, None).is_err());
    }
}

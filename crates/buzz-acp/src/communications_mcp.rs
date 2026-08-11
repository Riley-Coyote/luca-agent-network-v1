//! Per-turn Communications MCP capability projection.
//!
//! The trusted desktop gives the ACP harness one session master capability.
//! The harness never forwards that master: it derives an independent,
//! generation-bound capability for one exact ordinary channel turn and gives
//! only that derived value to the restricted Communications MCP child. A
//! conversation-scoped capability is deliberately insufficient: an MCP child
//! left over from an earlier turn must not gain authority merely because a new
//! turn starts in the same conversation.

use std::{fmt, path::Path, str::FromStr};

use luca_protocol::{Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::acp::{EnvVar, McpServer};

const BROKER_PROTOCOL: &str = "luca.communications.broker.v1";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommunicationsMcpBootstrapV1 {
    protocol: String,
    endpoint: String,
    master_capability: Sha256Ref,
    capability_generation: SafeU53,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
}

impl fmt::Debug for CommunicationsMcpBootstrapV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CommunicationsMcpBootstrapV1")
            .field("protocol", &self.protocol)
            .field("endpoint", &"<local socket>")
            .field("master_capability", &"<redacted>")
            .field("capability_generation", &self.capability_generation)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("binding_ref", &self.binding_ref)
            .finish()
    }
}

impl FromStr for CommunicationsMcpBootstrapV1 {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bootstrap: Self = serde_json::from_str(value)
            .map_err(|_| "Communications MCP bootstrap is invalid".to_owned())?;
        if bootstrap.protocol != BROKER_PROTOCOL
            || !Path::new(&bootstrap.endpoint).is_absolute()
            || bootstrap.endpoint.len() > 4096
            || bootstrap.capability_generation.get() == 0
        {
            return Err("Communications MCP bootstrap is invalid".into());
        }
        Ok(bootstrap)
    }
}

#[derive(Clone)]
pub(crate) struct CommunicationsMcpConfig {
    command: String,
    bootstrap: CommunicationsMcpBootstrapV1,
}

/// Exact managed-turn coordinates that must be frozen before an MCP sidecar is
/// attached to `session/new`.
///
/// ACP does not currently support changing MCP server environment variables on
/// an existing session. Callers therefore must create a fresh ACP session for
/// every communications-enabled turn and must never reuse this projection for
/// a later turn in the same conversation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CommunicationsTurnBindingV1 {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) turn_id: OpaqueId,
    pub(crate) dispatch_receipt_id: OpaqueId,
    pub(crate) cancellation_epoch: SafeU53,
}

impl fmt::Debug for CommunicationsMcpConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("CommunicationsMcpConfig")
            .field("command", &self.command)
            .field("bootstrap", &self.bootstrap)
            .finish()
    }
}

impl CommunicationsMcpConfig {
    pub(crate) fn new(
        command: String,
        bootstrap: Option<CommunicationsMcpBootstrapV1>,
        managed_identity: Option<(&Hex64, SafeU53, &Sha256Ref)>,
    ) -> Result<Option<Self>, String> {
        let command = command.trim().to_owned();
        match (command.is_empty(), bootstrap) {
            (true, None) => Ok(None),
            (false, Some(bootstrap)) => {
                let Some((resident_pubkey, session_epoch, binding_ref)) = managed_identity else {
                    return Err(
                        "Communications MCP requires an exact managed desktop bootstrap".into(),
                    );
                };
                if bootstrap.resident_pubkey != *resident_pubkey
                    || bootstrap.session_epoch != session_epoch
                    || bootstrap.binding_ref != *binding_ref
                {
                    return Err(
                        "Communications MCP bootstrap does not match the managed session".into(),
                    );
                }
                Ok(Some(Self { command, bootstrap }))
            }
            _ => Err("Communications MCP requires an exact managed desktop bootstrap".into()),
        }
    }

    /// Project one exact-turn child without forwarding the session master
    /// capability or any signing material.
    pub(crate) fn server_for_turn(&self, turn: &CommunicationsTurnBindingV1) -> McpServer {
        let capability = derive_turn_capability(
            self.bootstrap.master_capability.as_str(),
            self.bootstrap.capability_generation,
            &self.bootstrap.resident_pubkey,
            self.bootstrap.session_epoch,
            &self.bootstrap.binding_ref,
            turn,
        );
        McpServer {
            name: "luca-communications".into(),
            command: self.command.clone(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_ENDPOINT".into(),
                    value: self.bootstrap.endpoint.clone(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CAPABILITY".into(),
                    value: capability,
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CAPABILITY_GENERATION".into(),
                    value: self.bootstrap.capability_generation.get().to_string(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CONVERSATION_ID".into(),
                    value: turn.conversation_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_TURN_ID".into(),
                    value: turn.turn_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID".into(),
                    value: turn.dispatch_receipt_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_COMMUNICATIONS_CANCELLATION_EPOCH".into(),
                    value: turn.cancellation_epoch.get().to_string(),
                },
            ],
        }
    }
}

fn derive_turn_capability(
    master_capability: &str,
    capability_generation: SafeU53,
    resident_pubkey: &Hex64,
    session_epoch: SafeU53,
    binding_ref: &Sha256Ref,
    turn: &CommunicationsTurnBindingV1,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"luca.communications.turn-capability.v1\0");
    digest.update(master_capability.as_bytes());
    digest.update(b"\0");
    digest.update(capability_generation.get().to_be_bytes());
    digest.update(b"\0");
    digest.update(resident_pubkey.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(session_epoch.get().to_be_bytes());
    digest.update(b"\0");
    digest.update(binding_ref.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(turn.conversation_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(turn.turn_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(turn.dispatch_receipt_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(turn.cancellation_epoch.get().to_be_bytes());
    format!("sha256:{}", hex::encode(digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn bootstrap(master: &str, generation: u64) -> CommunicationsMcpBootstrapV1 {
        serde_json::from_value(serde_json::json!({
            "protocol": BROKER_PROTOCOL,
            "endpoint": "/tmp/luca-communications.sock",
            "masterCapability": master,
            "capabilityGeneration": generation,
            "residentPubkey": "11".repeat(32),
            "sessionEpoch": 7,
            "bindingRef": format!("sha256:{}", "22".repeat(32)),
        }))
        .expect("valid bootstrap")
    }

    fn config(master: &str, generation: u64) -> CommunicationsMcpConfig {
        let resident = Hex64::parse("11".repeat(32)).expect("resident");
        let binding = Sha256Ref::parse(format!("sha256:{}", "22".repeat(32))).expect("binding");
        CommunicationsMcpConfig::new(
            "/opt/luca/buzz-dev-mcp".into(),
            Some(bootstrap(master, generation)),
            Some((&resident, SafeU53::new(7).expect("epoch"), &binding)),
        )
        .expect("config")
        .expect("present")
    }

    fn turn(conversation: Uuid, turn: &str, dispatch: &str) -> CommunicationsTurnBindingV1 {
        CommunicationsTurnBindingV1 {
            conversation_id: OpaqueId::parse(conversation.to_string()).expect("conversation"),
            turn_id: OpaqueId::parse(turn).expect("turn"),
            dispatch_receipt_id: OpaqueId::parse(dispatch).expect("dispatch"),
            cancellation_epoch: SafeU53::new(7).expect("cancellation epoch"),
        }
    }

    #[test]
    fn child_receives_only_generation_and_exact_turn_bound_capability() {
        let master = format!("sha256:{}", "33".repeat(32));
        let config = config(&master, 9);
        let conversation = Uuid::new_v4();
        let first_turn = turn(conversation, "turn-1", "dispatch-1");
        let second_turn = turn(conversation, "turn-2", "dispatch-2");
        let first = config.server_for_turn(&first_turn);
        let second = config.server_for_turn(&second_turn);
        assert_eq!(first.name, "luca-communications");
        assert!(!first.env.iter().any(|entry| entry.value == master));
        assert_ne!(
            env_value(&first, "LUCA_COMMUNICATIONS_CAPABILITY"),
            env_value(&second, "LUCA_COMMUNICATIONS_CAPABILITY"),
        );
        assert_eq!(
            env_value(&first, "LUCA_COMMUNICATIONS_CAPABILITY_GENERATION"),
            Some("9")
        );
        assert_eq!(
            env_value(&first, "LUCA_COMMUNICATIONS_TURN_ID"),
            Some("turn-1")
        );
        assert_eq!(
            env_value(&first, "LUCA_COMMUNICATIONS_DISPATCH_RECEIPT_ID"),
            Some("dispatch-1")
        );
        assert_eq!(
            env_value(&first, "LUCA_COMMUNICATIONS_CANCELLATION_EPOCH"),
            Some("7")
        );
        assert!(!first
            .env
            .iter()
            .any(|entry| entry.name.contains("PRIVATE_KEY")
                || entry.name.contains("SIGNING")
                || entry.name == "LUCA_REPOSITORY_MODE"));
        let debug = format!("{config:?}");
        assert!(!debug.contains(&master));
        assert!(!debug.contains("/tmp/luca-communications.sock"));
    }

    #[test]
    fn generation_rotation_changes_the_projected_capability() {
        let master = format!("sha256:{}", "44".repeat(32));
        let conversation = Uuid::new_v4();
        let turn = turn(conversation, "turn-1", "dispatch-1");
        let first = config(&master, 1).server_for_turn(&turn);
        let second = config(&master, 2).server_for_turn(&turn);
        assert_ne!(
            env_value(&first, "LUCA_COMMUNICATIONS_CAPABILITY"),
            env_value(&second, "LUCA_COMMUNICATIONS_CAPABILITY"),
        );
    }

    #[test]
    fn every_exact_turn_coordinate_rotates_the_projected_capability() {
        let master = format!("sha256:{}", "77".repeat(32));
        let config = config(&master, 1);
        let conversation = Uuid::new_v4();
        let baseline = turn(conversation, "turn-1", "dispatch-1");
        let turn_changed = turn(conversation, "turn-2", "dispatch-1");
        let dispatch_changed = turn(conversation, "turn-1", "dispatch-2");
        let mut cancellation_changed = baseline.clone();
        cancellation_changed.cancellation_epoch = SafeU53::new(8).unwrap();
        let capability = |binding: &CommunicationsTurnBindingV1| {
            env_value(
                &config.server_for_turn(binding),
                "LUCA_COMMUNICATIONS_CAPABILITY",
            )
            .expect("capability")
            .to_owned()
        };
        assert_ne!(capability(&baseline), capability(&turn_changed));
        assert_ne!(capability(&baseline), capability(&dispatch_changed));
        assert_ne!(capability(&baseline), capability(&cancellation_changed));
    }

    #[test]
    fn communications_mcp_fails_closed_without_exact_managed_identity() {
        assert!(CommunicationsMcpConfig::new(
            "buzz-dev-mcp".into(),
            Some(bootstrap(&format!("sha256:{}", "55".repeat(32)), 1)),
            None,
        )
        .is_err());
        assert!(CommunicationsMcpConfig::new("buzz-dev-mcp".into(), None, None).is_err());
    }

    #[test]
    fn bootstrap_rejects_zero_generation() {
        let serialized = serde_json::to_string(&serde_json::json!({
            "protocol": BROKER_PROTOCOL,
            "endpoint": "/tmp/luca-communications.sock",
            "masterCapability": format!("sha256:{}", "66".repeat(32)),
            "capabilityGeneration": 0,
            "residentPubkey": "11".repeat(32),
            "sessionEpoch": 7,
            "bindingRef": format!("sha256:{}", "22".repeat(32)),
        }))
        .expect("serialize");
        assert!(serialized.parse::<CommunicationsMcpBootstrapV1>().is_err());
    }

    fn env_value<'a>(server: &'a McpServer, name: &str) -> Option<&'a str> {
        server
            .env
            .iter()
            .find(|entry| entry.name == name)
            .map(|entry| entry.value.as_str())
    }
}

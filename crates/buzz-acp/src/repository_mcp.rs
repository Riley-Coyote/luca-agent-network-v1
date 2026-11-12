//! Per-conversation repository MCP capability projection.
//!
//! The desktop gives the harness one session master capability. The harness
//! never forwards that master: it derives an independent capability for each
//! channel and gives only that derived value to the repository MCP child.

use std::{
    collections::HashMap,
    fmt,
    path::Path,
    str::FromStr,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    runtime_task_turn_signature, Hex64, OpaqueId, RuntimeTaskTurnProofV1, SafeU53, Sha256Ref,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::acp::{EnvVar, McpServer};
use crate::communications_mcp::CommunicationsTurnBindingV1;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
};

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
    gate: Arc<OnceLock<RepositoryTurnGate>>,
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
                Ok(Some(Self {
                    command,
                    bootstrap,
                    gate: Arc::new(OnceLock::new()),
                }))
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
        let mut server = McpServer {
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
        };
        // Keep all existing tools direct. Only runtime-task proposals need the
        // exact call-time lease; no ACP session is rotated for this feature.
        if let Ok(gate) = self.turn_gate() {
            server.env.push(EnvVar {
                name: "LUCA_REPOSITORY_TURN_GATE_ENDPOINT".into(),
                value: gate.endpoint.clone(),
            });
        }
        server
    }

    fn turn_gate(&self) -> Result<&RepositoryTurnGate, String> {
        if let Some(gate) = self.gate.get() {
            return Ok(gate);
        }
        let gate = RepositoryTurnGate::start(self.bootstrap.clone())?;
        let _ = self.gate.set(gate);
        self.gate
            .get()
            .ok_or_else(|| "Repository turn gate unavailable.".into())
    }

    pub(crate) fn open_turn(
        &self,
        turn: CommunicationsTurnBindingV1,
    ) -> Option<RepositoryTurnGuard> {
        let gate = self.turn_gate().ok()?;
        let mut state = gate.state.lock().ok()?;
        state.generation = state.generation.checked_add(1)?;
        let generation = state.generation;
        state
            .turns
            .insert(turn.conversation_id.clone(), (turn.clone(), generation));
        Some(RepositoryTurnGuard {
            state: Arc::clone(&gate.state),
            conversation: turn.conversation_id,
            generation,
        })
    }
}

#[derive(Default)]
struct TurnState {
    generation: u64,
    turns: HashMap<OpaqueId, (CommunicationsTurnBindingV1, u64)>,
}
struct RepositoryTurnGate {
    endpoint: String,
    state: Arc<Mutex<TurnState>>,
}
pub(crate) struct RepositoryTurnGuard {
    state: Arc<Mutex<TurnState>>,
    conversation: OpaqueId,
    generation: u64,
}
impl Drop for RepositoryTurnGuard {
    fn drop(&mut self) {
        self.close();
    }
}
impl RepositoryTurnGuard {
    pub(crate) fn close(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            if state
                .turns
                .get(&self.conversation)
                .is_some_and(|(_, generation)| *generation == self.generation)
            {
                state.turns.remove(&self.conversation);
            }
        }
    }
}
impl RepositoryTurnGate {
    fn start(bootstrap: RepositoryMcpBootstrapV1) -> Result<Self, String> {
        tokio::runtime::Handle::try_current()
            .map_err(|_| "Repository turn gate runtime unavailable.")?;
        let directory = Path::new(&bootstrap.endpoint)
            .parent()
            .ok_or("Repository gate directory unavailable.")?;
        let path = directory.join(format!(
            "rt-{}.sock",
            &Uuid::new_v4().simple().to_string()[..12]
        ));
        let listener =
            UnixListener::bind(&path).map_err(|_| "Repository turn gate unavailable.")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Repository turn gate unavailable.")?;
        }
        let state = Arc::new(Mutex::new(TurnState::default()));
        let shared = Arc::clone(&state);
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let shared = Arc::clone(&shared);
                let bootstrap = bootstrap.clone();
                tokio::spawn(async move {
                    let _ = serve_turn_call(stream, shared, bootstrap).await;
                });
            }
        });
        Ok(Self {
            endpoint: path.to_string_lossy().into_owned(),
            state,
        })
    }
}

async fn serve_turn_call(
    stream: UnixStream,
    state: Arc<Mutex<TurnState>>,
    bootstrap: RepositoryMcpBootstrapV1,
) -> Result<(), String> {
    let (read, mut write) = stream.into_split();
    // RepositoryBrokerClient writes one newline frame, flushes, then keeps
    // the SAME full-duplex stream open while reading the response. It never
    // half-closes its write side. Retain this reader (including read-ahead)
    // so EOF/error means that individual invocation ended, not turn-wide Stop.
    let mut upstream = BufReader::new(read).take(768 * 1024 + 1);
    let mut bytes = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(5),
        upstream.read_until(b'\n', &mut bytes),
    )
    .await
    .map_err(|_| "Repository turn call expired.")?
    .map_err(|_| "Repository turn call unavailable.")?;
    let outcome = async {
        if bytes.len() > 768 * 1024 || !bytes.ends_with(b"\n") { return Err("Repository turn call invalid."); }
        let mut frame: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "Repository turn call invalid.")?;
        let conversation = OpaqueId::parse(frame["conversation_id"].as_str().unwrap_or_default()).map_err(|_| "Repository turn call invalid.")?;
        if frame["protocol"] != BROKER_PROTOCOL || frame["operation"] != "propose_runtime_task"
            || frame.get("host_turn").is_some()
            || frame["capability"].as_str() != Some(derive_conversation_capability(bootstrap.master_capability.as_str(), conversation.as_str()).as_str()) {
            return Err("Repository turn capability invalid.");
        }
        // Snapshot once, before forwarding. No retry ever selects a new turn.
        let lease = state.lock().map_err(|_| "Repository turn unavailable.")?.turns.get(&conversation).cloned();
        let lease_generation = lease.as_ref().map(|(_, generation)| *generation);
        if let Some((turn, generation)) = lease {
            let mut proof = RuntimeTaskTurnProofV1 {
                trigger_event_id: Hex64::parse(turn.dispatch_receipt_id.as_str()).map_err(|_| "Repository owner trigger unavailable.")?,
                turn_id: turn.turn_id,
                cancellation_epoch: turn.cancellation_epoch,
                lease_generation: SafeU53::new(generation).map_err(|_| "Repository turn unavailable.")?,
                signature: bootstrap.master_capability.clone(),
            };
            proof.signature = runtime_task_turn_signature(&bootstrap.master_capability, &bootstrap.resident_pubkey, bootstrap.session_epoch, &bootstrap.binding_ref, &conversation, &proof, &frame["arguments"]).map_err(|_| "Repository turn invalid.")?;
            frame["host_turn"] = serde_json::to_value(&proof).map_err(|_| "Repository turn invalid.")?;
        }
        // Without an owner lease this remains an unproven legacy one-shot;
        // the desktop may review it, but it cannot mint a quiet root.
        let mut desktop = UnixStream::connect(&bootstrap.endpoint).await.map_err(|_| "Repository desktop unavailable.")?;
        if lease_generation.is_some_and(|expected| !lease_is_current(&state, &conversation, expected)) {
            return Err("Repository owner turn ended.");
        }
        let mut forwarded = serde_json::to_vec(&frame).map_err(|_| "Repository turn invalid.")?;
        forwarded.push(b'\n');
        desktop.write_all(&forwarded).await.map_err(|_| "Repository desktop unavailable.")?;
        let mut response = Vec::new();
        {
        let mut bounded_desktop = desktop.take(768 * 1024 + 1);
        let read_response = bounded_desktop.read_to_end(&mut response);
        tokio::pin!(read_response);
        let deadline = tokio::time::sleep(Duration::from_secs(16 * 60));
        tokio::pin!(deadline);
        let mut check = tokio::time::interval(Duration::from_millis(50));
        let mut unexpected = [0_u8; 1];
        loop {
            tokio::select! {
                biased;
                caller = upstream.read(&mut unexpected) => {
                    return Err(match caller {
                        Ok(0) => "Repository tool caller disconnected.",
                        Ok(_) => "Repository tool caller sent unexpected extra bytes.",
                        Err(_) => "Repository tool caller is unavailable.",
                    });
                }
                result = &mut read_response => { result.map_err(|_| "Repository desktop unavailable.")?; break; }
                _ = &mut deadline => return Err("Repository owner proposal expired."),
                _ = check.tick() => {
                    if lease_generation.is_some_and(|expected| !lease_is_current(&state, &conversation, expected)) {
                        // Dropping the desktop stream also cancels the native
                        // proposal's caller lease. Never rebind to a later ask.
                        return Err("Repository owner turn ended.");
                    }
                }
            }
        }
        }
        if response.len() > 768 * 1024 { return Err("Repository response invalid."); }
        Ok(response)
    }.await;
    let response = match outcome {
        Ok(response) => response,
        Err(error) => {
            let mut response = serde_json::to_vec(
                &serde_json::json!({"protocol": BROKER_PROTOCOL, "ok": false, "content": error}),
            )
            .map_err(|_| "Repository response invalid.")?;
            response.push(b'\n');
            response
        }
    };
    write
        .write_all(&response)
        .await
        .map_err(|_| "Repository response unavailable.".to_owned())
}

fn lease_is_current(state: &Mutex<TurnState>, conversation: &OpaqueId, expected: u64) -> bool {
    state.lock().ok().is_some_and(|state| {
        state
            .turns
            .get(conversation)
            .is_some_and(|(_, generation)| *generation == expected)
    })
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

    #[test]
    fn captured_lease_never_adopts_later_owner_turn_and_old_close_cannot_close_new() {
        let bootstrap = bootstrap(&format!("sha256:{}", "44".repeat(32)));
        let state = Arc::new(Mutex::new(TurnState::default()));
        let gate = Arc::new(OnceLock::new());
        assert!(gate
            .set(RepositoryTurnGate {
                endpoint: "/tmp/test-only.sock".into(),
                state: Arc::clone(&state)
            })
            .is_ok());
        let config = RepositoryMcpConfig {
            command: "test".into(),
            bootstrap,
            gate,
        };
        let turn = |id: &str| CommunicationsTurnBindingV1 {
            conversation_id: OpaqueId::parse("original-home").unwrap(),
            turn_id: OpaqueId::parse(id).unwrap(),
            dispatch_receipt_id: OpaqueId::parse("11".repeat(32)).unwrap(),
            cancellation_epoch: SafeU53::new(7).unwrap(),
        };
        let conversation = turn("first").conversation_id;
        assert!(!lease_is_current(&state, &conversation, 1));
        let mut first = config.open_turn(turn("first")).unwrap();
        let captured = first.generation;
        assert!(lease_is_current(&state, &conversation, captured));
        let mut second = config.open_turn(turn("second")).unwrap();
        assert!(!lease_is_current(&state, &conversation, captured));
        first.close();
        assert!(lease_is_current(&state, &conversation, second.generation));
        second.close();
        assert!(!lease_is_current(&state, &conversation, second.generation));
        assert_eq!(
            config.server_for(Uuid::new_v4()).env.last().unwrap().value,
            "/tmp/test-only.sock"
        );
    }

    #[tokio::test]
    async fn gate_forwards_one_signed_lease_then_closes_downstream_when_turn_ends() {
        let endpoint = std::env::temp_dir().join(format!(
            "rt-test-{}.sock",
            &Uuid::new_v4().simple().to_string()[..12]
        ));
        let listener = UnixListener::bind(&endpoint).unwrap();
        let mut bootstrap = bootstrap(&format!("sha256:{}", "44".repeat(32)));
        bootstrap.endpoint = endpoint.to_string_lossy().into_owned();
        let conversation = OpaqueId::parse("home").unwrap();
        let turn = CommunicationsTurnBindingV1 {
            conversation_id: conversation.clone(),
            turn_id: OpaqueId::parse("old-turn").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("11".repeat(32)).unwrap(),
            cancellation_epoch: SafeU53::new(7).unwrap(),
        };
        let state = Arc::new(Mutex::new(TurnState {
            generation: 1,
            turns: HashMap::from([(conversation.clone(), (turn, 1))]),
        }));
        let (mut child, gate) = UnixStream::pair().unwrap();
        let running = tokio::spawn(serve_turn_call(gate, Arc::clone(&state), bootstrap.clone()));
        let frame = serde_json::json!({"protocol": BROKER_PROTOCOL, "conversation_id": conversation, "operation": "propose_runtime_task", "capability": derive_conversation_capability(bootstrap.master_capability.as_str(), conversation.as_str()), "arguments": {"purpose":"ask"}});
        child
            .write_all((frame.to_string() + "\n").as_bytes())
            .await
            .unwrap();
        let (mut native, _) = listener.accept().await.unwrap();
        let mut line = String::new();
        BufReader::new(&mut native)
            .read_line(&mut line)
            .await
            .unwrap();
        let forwarded: serde_json::Value = serde_json::from_str(&line).unwrap();
        let proof: RuntimeTaskTurnProofV1 =
            serde_json::from_value(forwarded["host_turn"].clone()).unwrap();
        assert_eq!(proof.turn_id.as_str(), "old-turn");
        let expected = runtime_task_turn_signature(
            &bootstrap.master_capability,
            &bootstrap.resident_pubkey,
            bootstrap.session_epoch,
            &bootstrap.binding_ref,
            &conversation,
            &proof,
            &forwarded["arguments"],
        )
        .unwrap();
        assert!(luca_protocol::runtime_task_turn_signature_matches(
            &expected,
            &proof.signature
        ));
        state.lock().unwrap().turns.clear();
        let mut response = String::new();
        tokio::time::timeout(Duration::from_secs(1), child.read_to_string(&mut response))
            .await
            .unwrap()
            .unwrap();
        assert!(response.contains("owner turn ended"));
        let mut remaining = Vec::new();
        assert_eq!(native.read_to_end(&mut remaining).await.unwrap(), 0);
        running.await.unwrap().unwrap();
        std::fs::remove_file(endpoint).unwrap();
    }

    #[tokio::test]
    async fn individual_call_disconnect_or_extra_bytes_closes_review_while_turn_stays_active() {
        for mode in ["disconnect", "extra", "buffered_extra", "live"] {
            let endpoint = std::env::temp_dir().join(format!(
                "rt-call-{}.sock",
                &Uuid::new_v4().simple().to_string()[..12]
            ));
            let listener = UnixListener::bind(&endpoint).unwrap();
            let mut bootstrap = bootstrap(&format!("sha256:{}", "44".repeat(32)));
            bootstrap.endpoint = endpoint.to_string_lossy().into_owned();
            let conversation = OpaqueId::parse("still-active-home").unwrap();
            let turn = CommunicationsTurnBindingV1 {
                conversation_id: conversation.clone(),
                turn_id: OpaqueId::parse("still-active-turn").unwrap(),
                dispatch_receipt_id: OpaqueId::parse("11".repeat(32)).unwrap(),
                cancellation_epoch: SafeU53::new(7).unwrap(),
            };
            let state = Arc::new(Mutex::new(TurnState {
                generation: 1,
                turns: HashMap::from([(conversation.clone(), (turn, 1))]),
            }));
            let (mut child, gate) = UnixStream::pair().unwrap();
            let running =
                tokio::spawn(serve_turn_call(gate, Arc::clone(&state), bootstrap.clone()));
            let frame = serde_json::json!({"protocol": BROKER_PROTOCOL, "conversation_id": conversation, "operation": "propose_runtime_task", "capability": derive_conversation_capability(bootstrap.master_capability.as_str(), conversation.as_str()), "arguments": {"purpose":"ask"}});
            let request = frame.to_string()
                + if mode == "buffered_extra" {
                    "\nextra\n"
                } else {
                    "\n"
                };
            child.write_all(request.as_bytes()).await.unwrap();
            child.flush().await.unwrap();
            let (mut native, _) = listener.accept().await.unwrap();
            let mut line = String::new();
            BufReader::new(&mut native)
                .read_line(&mut line)
                .await
                .unwrap();
            assert!(line.contains("host_turn"));
            if mode == "live" {
                // Matches the real client's flush-then-read contract: an open
                // write half must not falsely cancel a healthy pending review.
                let mut probe = [0_u8; 1];
                assert!(
                    tokio::time::timeout(Duration::from_millis(30), native.read(&mut probe))
                        .await
                        .is_err()
                );
                native.write_all(b"{\"protocol\":\"luca.repository.broker.v1\",\"ok\":true,\"content\":\"accepted\"}\n").await.unwrap();
                drop(native);
                let mut response = String::new();
                tokio::time::timeout(Duration::from_secs(1), child.read_to_string(&mut response))
                    .await
                    .unwrap()
                    .unwrap();
                assert!(response.contains("accepted"));
                running.await.unwrap().unwrap();
            } else {
                if mode == "extra" {
                    child.write_all(b"unexpected second frame\n").await.unwrap();
                } else if mode == "disconnect" {
                    drop(child);
                }
                let mut remaining = Vec::new();
                assert_eq!(
                    tokio::time::timeout(
                        Duration::from_secs(1),
                        native.read_to_end(&mut remaining)
                    )
                    .await
                    .unwrap()
                    .unwrap(),
                    0
                );
                // A disconnected caller cannot receive the error response;
                // either result is fine, but the downstream must be closed.
                let _ = running.await.unwrap();
            }
            assert!(lease_is_current(&state, &conversation, 1));
            std::fs::remove_file(endpoint).unwrap();
        }
    }
}

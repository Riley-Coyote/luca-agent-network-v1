//! Harness turn gate: checks tool authority at call time, without ever
//! writing a turn, dispatch receipt or cancellation epoch into the sidecar's
//! environment.
//!
//! One conversation now keeps one long-lived Artifact Canvas sidecar process
//! (see [`crate::artifact_mcp::ArtifactMcpConfig::server_for_conversation`])
//! instead of a fresh sidecar per turn. That sidecar authenticates with a
//! random, conversation-scoped token — stored here only as its hash — and
//! this gate resolves *which* owner turn is currently open for that
//! conversation at the moment of each call, deriving the exact per-turn HMAC
//! capability the desktop broker still requires
//! ([`crate::artifact_mcp::GateBrokerBinding::frame`]) and forwarding the
//! call over the same private Unix socket the legacy per-turn sidecar used
//! directly.
//!
//! A call that arrives with no open owner turn for its conversation is
//! rejected with `no_active_owner_turn` — never retried, never forwarded.
//! A call whose token does not match its conversation's registered token is
//! rejected the same way, `foreign_conversation_token_rejected` in name only
//! (the wire diagnostic is `invalid_capability`, since presenting an
//! unregistered token and presenting another conversation's token are the
//! same failure from the gate's point of view — never seeing anything).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use luca_protocol::OpaqueId;
use nostr::prelude::rand::{rngs::OsRng, RngCore};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
};

use crate::artifact_mcp::{ArtifactTurnBindingV1, GateBrokerBinding};

#[cfg(not(test))]
const TURN_NOT_ACTIVE_RETRY_DELAY: Duration = Duration::from_millis(75);
#[cfg(test)]
const TURN_NOT_ACTIVE_RETRY_DELAY: Duration = Duration::from_millis(2);
#[cfg(not(test))]
const TURN_NOT_ACTIVE_RETRIES: usize = 40;
#[cfg(test)]
const TURN_NOT_ACTIVE_RETRIES: usize = 5;

const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
const DESKTOP_DEADLINE: Duration = Duration::from_secs(130);

const DIAGNOSTIC_NO_ACTIVE_OWNER_TURN: &str = "no_active_owner_turn";
const DIAGNOSTIC_INVALID_CAPABILITY: &str = "invalid_capability";
const DIAGNOSTIC_TURN_NOT_ACTIVE: &str = "turn_not_active";

/// A snapshot of the exact open owner turn for one conversation, plus the
/// generation it was opened at. The generation is how a call that is
/// mid-retry notices its turn was closed and a different one opened —
/// without ever silently adopting the new one.
#[derive(Clone)]
struct ActiveTurn {
    turn: ArtifactTurnBindingV1,
    generation: u64,
}

/// Registered state for one conversation's sidecar.
struct ConversationState {
    token_hash: [u8; 32],
    binding: GateBrokerBinding,
    active: Option<ActiveTurn>,
}

struct GateInner {
    socket_path: PathBuf,
    conversations: Mutex<HashMap<OpaqueId, ConversationState>>,
}

/// The turn gate. Cheap to clone — every clone shares the same registry and
/// (once [`ArtifactTurnGate::start`] has run) the same listening socket.
#[derive(Clone)]
pub(crate) struct ArtifactTurnGate {
    inner: Arc<GateInner>,
}

impl ArtifactTurnGate {
    /// Create the private socket directory, bind the listener and start
    /// accepting sidecar connections in the background. `app_data_dir` is
    /// where the private `0700` directory is created — callers pass the same
    /// root the desktop artifact broker itself uses for its own sockets.
    pub(crate) fn start(socket_root: &Path) -> Result<Self, String> {
        let directory =
            socket_root.join(format!("luca-atg-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&directory)
            .map_err(|_| "artifact turn gate directory could not be created".to_owned())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(|_| "artifact turn gate directory could not be secured".to_owned())?;
        }
        let socket_path = directory.join("gate.sock");
        let listener = UnixListener::bind(&socket_path)
            .map_err(|_| "artifact turn gate endpoint could not be created".to_owned())?;
        let inner = Arc::new(GateInner {
            socket_path,
            conversations: Mutex::new(HashMap::new()),
        });
        let accept_inner = inner.clone();
        tokio::spawn(async move {
            accept_loop(accept_inner, listener).await;
        });
        Ok(Self { inner })
    }

    /// Test-only constructor: no listener, no accept loop — just the
    /// registry, for tests that only exercise registration and env
    /// projection (e.g. confirming no turn field ever reaches the sidecar's
    /// environment).
    #[cfg(test)]
    pub(crate) fn start_for_test() -> Result<Self, String> {
        let socket_path = std::env::temp_dir().join(format!(
            "luca-atg-test-{}/gate.sock",
            uuid::Uuid::new_v4().simple()
        ));
        Ok(Self {
            inner: Arc::new(GateInner {
                socket_path,
                conversations: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub(crate) fn socket_path_string(&self) -> String {
        self.inner.socket_path.to_string_lossy().into_owned()
    }

    /// Register (or re-register) one conversation's sidecar, minting a fresh
    /// random token. Safe to call again for the same conversation — e.g. a
    /// resumed session rebuilding its `mcpServers` after an app restart —
    /// the previous token stops working the moment this one is stored.
    pub(crate) fn register_conversation(
        &self,
        conversation_id: OpaqueId,
        binding: GateBrokerBinding,
    ) -> String {
        let mut token_bytes = [0_u8; 32];
        OsRng.fill_bytes(&mut token_bytes);
        let token = hex::encode(token_bytes);
        let token_hash = sha256(token.as_bytes());
        if let Ok(mut conversations) = self.inner.conversations.lock() {
            let active = conversations
                .get(&conversation_id)
                .and_then(|existing| existing.active.clone());
            conversations.insert(
                conversation_id,
                ConversationState {
                    token_hash,
                    binding,
                    active,
                },
            );
        }
        token
    }

    /// Open the exact owner turn now bound for `conversation`, at
    /// `generation`. WP-B calls this when a turn starts, next to
    /// `communication_turn_registry`'s own bookkeeping.
    pub(crate) fn open(
        &self,
        conversation: &OpaqueId,
        turn: ArtifactTurnBindingV1,
        generation: u64,
    ) {
        if let Ok(mut conversations) = self.inner.conversations.lock() {
            if let Some(state) = conversations.get_mut(conversation) {
                state.active = Some(ActiveTurn { turn, generation });
            }
        }
    }

    /// Close `conversation`'s open turn, but only if it is still at
    /// `generation`. A close for a generation that has already been
    /// superseded by a newer `open` is a stale race and must not clobber the
    /// newer turn — see `late_call_never_binds_next_turn`.
    pub(crate) fn close(&self, conversation: &OpaqueId, generation: u64) {
        if let Ok(mut conversations) = self.inner.conversations.lock() {
            if let Some(state) = conversations.get_mut(conversation) {
                if state.active.as_ref().is_some_and(|active| active.generation == generation) {
                    state.active = None;
                }
            }
        }
    }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut out = [0_u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Constant-time-ish equality — both inputs are fixed-size hashes, so there
/// is no length side-channel to worry about, only per-byte timing.
fn hashes_match(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0_u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

async fn accept_loop(inner: Arc<GateInner>, listener: UnixListener) {
    loop {
        let (stream, _addr) = match listener.accept().await {
            Ok(pair) => pair,
            Err(_) => continue,
        };
        let call_inner = inner.clone();
        tokio::spawn(async move {
            handle_connection(call_inner, stream).await;
        });
    }
}

async fn handle_connection(inner: Arc<GateInner>, stream: UnixStream) {
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    loop {
        let mut line = String::new();
        let read = match reader.read_line(&mut line).await {
            Ok(read) => read,
            Err(_) => return,
        };
        if read == 0 {
            return;
        }
        if line.len() > MAX_FRAME_BYTES {
            return;
        }
        let Ok(request) = serde_json::from_str::<serde_json::Value>(line.trim_end()) else {
            return;
        };
        let response = handle_frame(&inner, request).await;
        let Ok(mut bytes) = serde_json::to_vec(&response) else {
            return;
        };
        bytes.push(b'\n');
        if write_half.write_all(&bytes).await.is_err() || write_half.flush().await.is_err() {
            return;
        }
    }
}

/// Snapshot taken once per call — every retry of the same call reuses this
/// exact turn and generation. A generation that has since moved on stops the
/// retry; it never causes the call to adopt the new turn.
struct CallBinding {
    binding: GateBrokerBinding,
    turn: ArtifactTurnBindingV1,
    generation: u64,
}

async fn handle_frame(inner: &Arc<GateInner>, request: serde_json::Value) -> serde_json::Value {
    let (Some(conversation_str), Some(capability), Some(operation_request_id), Some(operation)) = (
        request.get("conversation_id").and_then(|v| v.as_str()),
        request.get("capability").and_then(|v| v.as_str()),
        request
            .get("operation_request_id")
            .and_then(|v| v.as_str()),
        request.get("operation").and_then(|v| v.as_str()),
    ) else {
        return diagnostic_response(&request, DIAGNOSTIC_INVALID_CAPABILITY);
    };
    let arguments = request
        .get("arguments")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let Ok(conversation_id) = OpaqueId::parse(conversation_str) else {
        return diagnostic_response(&request, DIAGNOSTIC_INVALID_CAPABILITY);
    };
    let presented_hash = sha256(capability.as_bytes());

    // Capture exactly one snapshot up front. Every later re-check in the
    // retry loop below re-reads current state only to decide whether to
    // *keep* using this snapshot — never to replace it.
    let call = {
        let Ok(conversations) = inner.conversations.lock() else {
            return diagnostic_response(&request, DIAGNOSTIC_INVALID_CAPABILITY);
        };
        let Some(state) = conversations.get(&conversation_id) else {
            return diagnostic_response(&request, DIAGNOSTIC_INVALID_CAPABILITY);
        };
        if !hashes_match(&state.token_hash, &presented_hash) {
            return diagnostic_response(&request, DIAGNOSTIC_INVALID_CAPABILITY);
        }
        let Some(active) = state.active.as_ref() else {
            return diagnostic_response(&request, DIAGNOSTIC_NO_ACTIVE_OWNER_TURN);
        };
        CallBinding {
            binding: state.binding.clone(),
            turn: active.turn.clone(),
            generation: active.generation,
        }
    };

    let mut retries = 0;
    loop {
        let frame = call.binding.frame(
            &call.turn,
            operation_request_id,
            operation,
            arguments.clone(),
        );
        match forward_to_desktop(call.binding.endpoint(), &frame).await {
            Ok(response) => {
                let diagnostic = response.get("diagnostic_code").and_then(|v| v.as_str());
                if diagnostic == Some(DIAGNOSTIC_TURN_NOT_ACTIVE) && retries < TURN_NOT_ACTIVE_RETRIES
                {
                    // Only keep retrying while this exact generation is
                    // still the conversation's open turn. If it has moved
                    // on (closed, or a new turn opened), this call must not
                    // silently start using the new one — it fails closed.
                    let current_generation = inner.conversations.lock().ok().and_then(|conversations| {
                        conversations
                            .get(&conversation_id)
                            .and_then(|state| state.active.as_ref())
                            .map(|active| active.generation)
                    });
                    if current_generation != Some(call.generation) {
                        return diagnostic_response(&request, DIAGNOSTIC_NO_ACTIVE_OWNER_TURN);
                    }
                    retries += 1;
                    tokio::time::sleep(TURN_NOT_ACTIVE_RETRY_DELAY).await;
                    continue;
                }
                return response;
            }
            Err(_) => return diagnostic_response(&request, "artifact_broker_unavailable"),
        }
    }
}

fn diagnostic_response(request: &serde_json::Value, diagnostic_code: &str) -> serde_json::Value {
    serde_json::json!({
        "protocol": "luca.artifact.tool.v1",
        "ok": false,
        "request_id": request.get("operation_request_id").cloned().unwrap_or(serde_json::Value::Null),
        "operation": request.get("operation").cloned().unwrap_or(serde_json::Value::Null),
        "diagnostic_code": diagnostic_code,
        "result": serde_json::Value::Null,
    })
}

async fn forward_to_desktop(
    endpoint: &Path,
    frame: &serde_json::Value,
) -> Result<serde_json::Value, ()> {
    tokio::time::timeout(DESKTOP_DEADLINE, async {
        let mut stream = UnixStream::connect(endpoint).await.map_err(|_| ())?;
        let mut bytes = serde_json::to_vec(frame).map_err(|_| ())?;
        bytes.push(b'\n');
        stream.write_all(&bytes).await.map_err(|_| ())?;
        stream.flush().await.map_err(|_| ())?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        let read = reader.read_line(&mut line).await.map_err(|_| ())?;
        if read == 0 {
            return Err(());
        }
        serde_json::from_str(line.trim_end()).map_err(|_| ())
    })
    .await
    .map_err(|_| ())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{net::UnixListener as StubListener, sync::mpsc};

    fn turn(conversation: &str, turn_id: &str) -> ArtifactTurnBindingV1 {
        ArtifactTurnBindingV1 {
            conversation_id: OpaqueId::parse(conversation).unwrap(),
            turn_id: OpaqueId::parse(turn_id).unwrap(),
            dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
            cancellation_epoch: luca_protocol::SafeU53::new(1).unwrap(),
        }
    }

    /// Start a stub "desktop broker" that always answers with `response_fn`
    /// applied to the incoming frame, and reports every accepted frame in
    /// full on `seen`. Returns the socket path to point a
    /// [`GateBrokerBinding`] at.
    fn start_stub_broker(
        response_fn: impl Fn(&serde_json::Value) -> serde_json::Value + Send + Sync + 'static,
        seen: mpsc::UnboundedSender<serde_json::Value>,
    ) -> PathBuf {
        let dir = PathBuf::from("/tmp").join(format!("luca-atg-stub-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("desktop.sock");
        let listener = StubListener::bind(&path).unwrap();
        let response_fn = Arc::new(response_fn);
        tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let response_fn = response_fn.clone();
                let seen = seen.clone();
                tokio::spawn(async move {
                    let (read_half, mut write_half) = stream.into_split();
                    let mut reader = BufReader::new(read_half);
                    loop {
                        let mut line = String::new();
                        match reader.read_line(&mut line).await {
                            Ok(0) | Err(_) => return,
                            Ok(_) => {}
                        }
                        let Ok(request) = serde_json::from_str::<serde_json::Value>(line.trim_end())
                        else {
                            return;
                        };
                        let _ = seen.send(request.clone());
                        let response = response_fn(&request);
                        let mut bytes = serde_json::to_vec(&response).unwrap();
                        bytes.push(b'\n');
                        if write_half.write_all(&bytes).await.is_err() {
                            return;
                        }
                        let _ = write_half.flush().await;
                    }
                });
            }
        });
        path
    }

    fn ok_response(request: &serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "protocol": "luca.artifact.tool.v1",
            "ok": true,
            "request_id": request["operation_request_id"],
            "operation": request["operation"],
            "capability_generation": request["capability_generation"],
            "conversation_id": request["conversation_id"],
            "turn_id": request["turn_id"],
            "dispatch_receipt_id": request["dispatch_receipt_id"],
            "cancellation_epoch": request["cancellation_epoch"],
            "result": {"ok": true},
        })
    }

    fn always_turn_not_active(request: &serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "protocol": "luca.artifact.tool.v1",
            "ok": false,
            "request_id": request["operation_request_id"],
            "operation": request["operation"],
            "capability_generation": request["capability_generation"],
            "conversation_id": request["conversation_id"],
            "turn_id": request["turn_id"],
            "dispatch_receipt_id": request["dispatch_receipt_id"],
            "cancellation_epoch": request["cancellation_epoch"],
            "diagnostic_code": "turn_not_active",
            "result": serde_json::Value::Null,
        })
    }

    async fn send_call(
        socket_path: &Path,
        conversation_id: &str,
        capability: &str,
        operation_request_id: &str,
    ) -> serde_json::Value {
        let mut stream = UnixStream::connect(socket_path).await.unwrap();
        let frame = serde_json::json!({
            "protocol": "luca.artifact.broker.v1",
            "capability": capability,
            "capability_generation": 9,
            "conversation_id": conversation_id,
            "operation_request_id": operation_request_id,
            "operation": "resident_place_get",
            "arguments": {},
        });
        let mut bytes = serde_json::to_vec(&frame).unwrap();
        bytes.push(b'\n');
        stream.write_all(&bytes).await.unwrap();
        stream.flush().await.unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(line.trim_end()).unwrap()
    }

    #[tokio::test]
    async fn gate_rejects_without_prompt_in_flight() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let desktop = start_stub_broker(ok_response, tx);
        let gate = ArtifactTurnGate::start(Path::new("/tmp")).unwrap();
        let conversation = OpaqueId::parse("conv-no-turn").unwrap();
        let token = gate.register_conversation(
            conversation.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop),
        );
        // No `open` call — no owner turn is in flight for this conversation.
        let response = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-no-turn",
            &token,
            "req-1",
        )
        .await;
        assert_eq!(response["ok"], false);
        assert_eq!(response["diagnostic_code"], "no_active_owner_turn");
        // Never even reached the desktop broker.
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn foreign_conversation_token_rejected() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let desktop = start_stub_broker(ok_response, tx);
        let gate = ArtifactTurnGate::start(Path::new("/tmp")).unwrap();
        let conv_a = OpaqueId::parse("conv-a").unwrap();
        let conv_b = OpaqueId::parse("conv-b").unwrap();
        let token_a = gate.register_conversation(
            conv_a.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop.clone()),
        );
        let _token_b = gate.register_conversation(
            conv_b.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop),
        );
        gate.open(&conv_b, turn("conv-b", "turn-b"), 1);

        // conv-a's token presented against conv-b: rejected, not merely
        // "no active turn" — it never matches conv-b's registered token.
        let response = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-b",
            &token_a,
            "req-1",
        )
        .await;
        assert_eq!(response["ok"], false);
        assert_eq!(response["diagnostic_code"], "invalid_capability");

        // An entirely unregistered conversation is rejected the same way.
        let response = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-unknown",
            &token_a,
            "req-2",
        )
        .await;
        assert_eq!(response["ok"], false);
        assert_eq!(response["diagnostic_code"], "invalid_capability");
    }

    #[tokio::test]
    async fn gate_rejects_sibling_turn() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let desktop = start_stub_broker(ok_response, tx);
        let gate = ArtifactTurnGate::start(Path::new("/tmp")).unwrap();
        let conv_a = OpaqueId::parse("conv-a").unwrap();
        let conv_b = OpaqueId::parse("conv-b").unwrap();
        let token_a = gate.register_conversation(
            conv_a.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop.clone()),
        );
        let token_b = gate.register_conversation(
            conv_b.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop),
        );
        // Only conversation A has an open owner turn.
        gate.open(&conv_a, turn("conv-a", "turn-a"), 1);

        let response_a = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-a",
            &token_a,
            "req-a",
        )
        .await;
        assert_eq!(response_a["ok"], true);
        assert_eq!(rx.recv().await.unwrap()["turn_id"], "turn-a");

        // B's own (correctly authenticated) call must not see A's turn.
        let response_b = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-b",
            &token_b,
            "req-b",
        )
        .await;
        assert_eq!(response_b["ok"], false);
        assert_eq!(response_b["diagnostic_code"], "no_active_owner_turn");
    }

    #[tokio::test]
    async fn forwarded_capability_matches_per_turn_hmac_over_the_wire() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let desktop = start_stub_broker(ok_response, tx);
        let gate = ArtifactTurnGate::start(Path::new("/tmp")).unwrap();
        let conversation = OpaqueId::parse("conv-cap").unwrap();
        let token = gate.register_conversation(
            conversation.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop),
        );
        let bound_turn = turn("conv-cap", "turn-cap");
        gate.open(&conversation, bound_turn.clone(), 1);

        let response = send_call(
            &std::path::PathBuf::from(gate.socket_path_string()),
            "conv-cap",
            &token,
            "req-cap",
        )
        .await;
        assert_eq!(response["ok"], true);
        let received = rx.recv().await.unwrap();
        let expected = crate::artifact_mcp::test_gate_broker_binding(PathBuf::new())
            .frame(
                &bound_turn,
                "req-cap",
                "resident_place_get",
                serde_json::json!({}),
            )["capability"]
            .clone();
        // What the gate actually put on the wire to the desktop broker is
        // exactly the independently-derived per-turn HMAC for this turn —
        // not a stand-in, not the raw conversation token.
        assert_eq!(received["capability"], expected);
        assert_eq!(received["turn_id"], "turn-cap");
        assert_ne!(received["capability"].as_str().unwrap(), token);
    }

    #[tokio::test]
    async fn late_call_never_binds_next_turn() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let desktop = start_stub_broker(always_turn_not_active, tx);
        let gate = ArtifactTurnGate::start(Path::new("/tmp")).unwrap();
        let conversation = OpaqueId::parse("conv-race").unwrap();
        let token = gate.register_conversation(
            conversation.clone(),
            crate::artifact_mcp::test_gate_broker_binding(desktop),
        );
        gate.open(&conversation, turn("conv-race", "turn-1"), 1);

        let socket_path = std::path::PathBuf::from(gate.socket_path_string());
        let call = tokio::spawn(async move {
            send_call(&socket_path, "conv-race", &token, "req-race").await
        });

        // Wait for the first attempt to actually reach the stub — proof the
        // call started against turn-1 — then close it and open a new turn
        // at the next generation, exactly like a fresh owner turn starting
        // while a previous call is still mid-retry.
        assert_eq!(rx.recv().await.unwrap()["turn_id"], "turn-1");
        gate.close(&conversation, 1);
        gate.open(&conversation, turn("conv-race", "turn-2"), 2);

        let response = call.await.unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(response["diagnostic_code"], "no_active_owner_turn");

        // Drain whatever further attempts the retry loop made before it
        // noticed the generation had moved on — none of them may ever carry
        // turn-2's id.
        while let Ok(request) = rx.try_recv() {
            assert_eq!(request["turn_id"], "turn-1");
        }
    }
}

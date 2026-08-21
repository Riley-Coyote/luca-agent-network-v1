//! Per-turn Artifact Canvas MCP capability projection.
//!
//! The trusted desktop gives the ACP harness one session master capability.
//! The harness derives an independent capability for one exact managed turn;
//! neither the master capability nor desktop-owned working root is forwarded to
//! the model, prompt, relay, or the general development MCP.

use std::{
    collections::HashMap,
    fmt,
    path::Path,
    str::FromStr,
    sync::{Mutex, OnceLock},
};

use luca_protocol::{Hex64, OpaqueId, SafeU53, Sha256Ref};
use serde::Deserialize;
use sha2::{digest::Output, Digest, Sha256};
use zeroize::Zeroize;

use crate::acp::{EnvVar, McpServer};

#[cfg(not(test))]
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);
#[cfg(test)]
const PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const PROBE_RECEIPT_MAX_BYTES: u64 = 256;

const BROKER_PROTOCOL: &str = "luca.artifact.broker.v1";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ArtifactMcpBootstrapV1 {
    protocol: String,
    endpoint: String,
    master_capability: Sha256Ref,
    capability_generation: SafeU53,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
    working_root_id: OpaqueId,
}

impl fmt::Debug for ArtifactMcpBootstrapV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ArtifactMcpBootstrapV1")
            .field("protocol", &self.protocol)
            .field("endpoint", &"<local socket>")
            .field("master_capability", &"<redacted>")
            .field("capability_generation", &self.capability_generation)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("binding_ref", &self.binding_ref)
            .field("working_root_id", &self.working_root_id)
            .finish()
    }
}

impl FromStr for ArtifactMcpBootstrapV1 {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let bootstrap: Self = serde_json::from_str(value)
            .map_err(|_| "Artifact MCP bootstrap is invalid".to_owned())?;
        if bootstrap.protocol != BROKER_PROTOCOL
            || !Path::new(&bootstrap.endpoint).is_absolute()
            || bootstrap.endpoint.len() > 4096
            || bootstrap.capability_generation.get() == 0
            || bootstrap.session_epoch.get() == 0
        {
            return Err("Artifact MCP bootstrap is invalid".into());
        }
        Ok(bootstrap)
    }
}

#[derive(Clone)]
pub(crate) struct ArtifactMcpConfig {
    command: String,
    bootstrap: ArtifactMcpBootstrapV1,
    declared_support: ArtifactMcpSupport,
    probe_key: Option<Sha256Ref>,
    probe_adapter: Option<ArtifactProbeAdapterConfig>,
}

#[derive(Clone)]
pub(crate) struct ArtifactProbeAdapterConfig {
    command: String,
    args: Vec<String>,
    extra_env: Vec<(String, String)>,
    has_generated_codex_config: bool,
}

impl ArtifactProbeAdapterConfig {
    pub(crate) fn new(
        command: String,
        args: Vec<String>,
        extra_env: Vec<(String, String)>,
        has_generated_codex_config: bool,
    ) -> Self {
        Self {
            command,
            args,
            extra_env,
            has_generated_codex_config,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum ArtifactMcpSupport {
    #[value(name = "supported")]
    Supported,
    #[value(name = "probe_pending")]
    ProbePending,
    #[value(name = "unavailable")]
    Unavailable,
}

/// Exact managed-turn coordinates frozen before the restricted sidecar is
/// attached to `session/new`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ArtifactTurnBindingV1 {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) turn_id: OpaqueId,
    pub(crate) dispatch_receipt_id: OpaqueId,
    pub(crate) cancellation_epoch: SafeU53,
}

impl fmt::Debug for ArtifactMcpConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ArtifactMcpConfig")
            .field("command", &self.command)
            .field("bootstrap", &self.bootstrap)
            .field("declared_support", &self.declared_support)
            .field("probe_key", &self.probe_key)
            .field(
                "probe_adapter",
                &self.probe_adapter.as_ref().map(|_| "<disposable adapter>"),
            )
            .finish()
    }
}

impl ArtifactMcpConfig {
    pub(crate) fn new(
        command: String,
        bootstrap: Option<ArtifactMcpBootstrapV1>,
        managed_identity: Option<(&Hex64, SafeU53, &Sha256Ref)>,
        declared_support: ArtifactMcpSupport,
        probe_key: Option<Sha256Ref>,
        probe_adapter: ArtifactProbeAdapterConfig,
    ) -> Result<Option<Self>, String> {
        let command = command.trim().to_owned();
        match (command.is_empty(), bootstrap) {
            (true, None) => Ok(None),
            (false, Some(bootstrap)) => {
                let Some((resident_pubkey, session_epoch, binding_ref)) = managed_identity else {
                    return Err("Artifact MCP requires an exact managed desktop bootstrap".into());
                };
                if bootstrap.resident_pubkey != *resident_pubkey
                    || bootstrap.session_epoch != session_epoch
                    || bootstrap.binding_ref != *binding_ref
                {
                    return Err("Artifact MCP bootstrap does not match the managed session".into());
                }
                let (declared_support, probe_adapter) = match declared_support {
                    ArtifactMcpSupport::ProbePending if probe_key.is_some() => {
                        (declared_support, Some(probe_adapter))
                    }
                    // Missing host proof fails closed. A path, runtime binding,
                    // resident, or turn identifier is never accepted as a cache key.
                    ArtifactMcpSupport::ProbePending => (ArtifactMcpSupport::Unavailable, None),
                    support => (support, None),
                };
                Ok(Some(Self {
                    command,
                    bootstrap,
                    declared_support,
                    probe_key,
                    probe_adapter,
                }))
            }
            _ => Err("Artifact MCP requires an exact managed desktop bootstrap".into()),
        }
    }

    pub(crate) fn server_for_turn(&self, turn: &ArtifactTurnBindingV1) -> McpServer {
        let capability = derive_turn_capability(&self.bootstrap, turn);
        McpServer {
            name: artifact_server_name(turn),
            command: self.command.clone(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_ARTIFACT_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_ENDPOINT".into(),
                    value: self.bootstrap.endpoint.clone(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CAPABILITY".into(),
                    value: capability,
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CAPABILITY_GENERATION".into(),
                    value: self.bootstrap.capability_generation.get().to_string(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CONVERSATION_ID".into(),
                    value: turn.conversation_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_TURN_ID".into(),
                    value: turn.turn_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_DISPATCH_RECEIPT_ID".into(),
                    value: turn.dispatch_receipt_id.as_str().to_owned(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_CANCELLATION_EPOCH".into(),
                    value: turn.cancellation_epoch.get().to_string(),
                },
            ],
        }
    }

    fn probe_server(&self, receipt: &DisposableProbeReceipt) -> McpServer {
        McpServer {
            name: "luca-artifact-compatibility-probe".into(),
            command: self.command.clone(),
            args: Vec::new(),
            env: vec![
                EnvVar {
                    name: "LUCA_ARTIFACT_PROBE_MODE".into(),
                    value: "1".into(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_PROBE_ENDPOINT".into(),
                    value: receipt.endpoint.clone(),
                },
                EnvVar {
                    name: "LUCA_ARTIFACT_PROBE_NONCE".into(),
                    value: receipt.nonce.clone(),
                },
            ],
        }
    }

    pub(crate) fn effective_support(&self) -> ArtifactMcpSupport {
        match self.declared_support {
            ArtifactMcpSupport::ProbePending => self
                .probe_key
                .as_ref()
                .map(|probe_key| {
                    probe_cache()
                        .lock()
                        .ok()
                        .and_then(|cache| cache.get(probe_key.as_str()).copied())
                        .unwrap_or(ArtifactMcpSupport::ProbePending)
                })
                .unwrap_or(ArtifactMcpSupport::Unavailable),
            support => support,
        }
    }

    pub(crate) fn record_probe(&self, support: ArtifactMcpSupport) {
        if self.declared_support != ArtifactMcpSupport::ProbePending
            || support == ArtifactMcpSupport::ProbePending
        {
            return;
        }
        if let (Some(probe_key), Ok(mut cache)) = (&self.probe_key, probe_cache().lock()) {
            cache.insert(probe_key.as_str().to_owned(), support);
        }
    }

    /// Probe an unknown ACP executable in a disposable process. The live pool
    /// process never receives this test session or its MCP registration.
    pub(crate) async fn run_disposable_probe(&self, cwd: &str) -> ArtifactMcpSupport {
        let Some(adapter) = self.probe_adapter.as_ref() else {
            return ArtifactMcpSupport::Unavailable;
        };
        let Ok(receipt) = DisposableProbeReceipt::bind().await else {
            return ArtifactMcpSupport::Unavailable;
        };
        let spawned = crate::acp::AcpClient::spawn_managed(
            &adapter.command,
            &adapter.args,
            &adapter.extra_env,
            adapter.has_generated_codex_config,
        )
        .await;
        let Ok(mut client) = spawned else {
            return ArtifactMcpSupport::Unavailable;
        };
        let outcome = tokio::time::timeout(PROBE_TIMEOUT, async {
            client.initialize().await?;
            let response = client
                .session_new_full(cwd, vec![self.probe_server(&receipt)], None)
                .await?;
            let proof = receipt
                .receive()
                .await
                .map_err(|_| crate::acp::AcpError::Protocol("artifact MCP probe failed".into()));
            let cancellation = client.session_cancel(&response.session_id).await;
            proof?;
            cancellation
        })
        .await;
        client.shutdown().await;
        match outcome {
            Ok(Ok(())) => ArtifactMcpSupport::Supported,
            _ => ArtifactMcpSupport::Unavailable,
        }
    }
}

struct DisposableProbeReceipt {
    listener: tokio::net::TcpListener,
    endpoint: String,
    nonce: String,
}

impl DisposableProbeReceipt {
    async fn bind() -> std::io::Result<Self> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let endpoint = listener.local_addr()?.to_string();
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        Ok(Self {
            listener,
            endpoint,
            nonce,
        })
    }

    async fn receive(&self) -> std::io::Result<()> {
        use tokio::io::AsyncReadExt;

        let (stream, peer) = self.listener.accept().await?;
        if !peer.ip().is_loopback() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "artifact MCP probe callback was not loopback",
            ));
        }
        let mut body = Vec::new();
        stream
            .take(PROBE_RECEIPT_MAX_BYTES)
            .read_to_end(&mut body)
            .await?;
        let expected = format!("{}\n", self.nonce);
        if body != expected.as_bytes() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "artifact MCP probe callback was invalid",
            ));
        }
        Ok(())
    }
}

fn probe_cache() -> &'static Mutex<HashMap<String, ArtifactMcpSupport>> {
    static CACHE: OnceLock<Mutex<HashMap<String, ArtifactMcpSupport>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(test)]
impl ArtifactMcpConfig {
    pub(crate) fn test_fixture(declared_support: ArtifactMcpSupport, probe_hex: char) -> Self {
        Self {
            command: "/opt/luca/buzz-dev-mcp".into(),
            bootstrap: ArtifactMcpBootstrapV1 {
                protocol: BROKER_PROTOCOL.into(),
                endpoint: "/tmp/luca-ab-fixture/e7-0123456789abcdef.sock".into(),
                master_capability: Sha256Ref::parse(format!("sha256:{}", "a".repeat(64))).unwrap(),
                capability_generation: SafeU53::new(9).unwrap(),
                resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
                session_epoch: SafeU53::new(7).unwrap(),
                binding_ref: Sha256Ref::parse(format!("sha256:{}", "f".repeat(64))).unwrap(),
                working_root_id: OpaqueId::parse("root-fixture").unwrap(),
            },
            declared_support,
            probe_key: Some(
                Sha256Ref::parse(format!("sha256:{}", probe_hex.to_string().repeat(64))).unwrap(),
            ),
            probe_adapter: None,
        }
    }

    pub(crate) fn with_test_probe_adapter(mut self, command: &str, args: Vec<String>) -> Self {
        self.probe_adapter = Some(ArtifactProbeAdapterConfig::new(
            command.into(),
            args,
            Vec::new(),
            false,
        ));
        self
    }

    #[cfg(test)]
    pub(crate) fn with_test_sidecar_command(mut self, command: String) -> Self {
        self.command = command;
        self
    }
}

fn artifact_server_name(turn: &ArtifactTurnBindingV1) -> String {
    let mut material = Vec::with_capacity(256);
    material.extend_from_slice(turn.conversation_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(turn.turn_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(turn.dispatch_receipt_id.as_str().as_bytes());
    let digest = Sha256::digest(material);
    format!("luca-artifacts-{}", &hex::encode(digest)[..12])
}

fn derive_turn_capability(
    bootstrap: &ArtifactMcpBootstrapV1,
    turn: &ArtifactTurnBindingV1,
) -> String {
    let mut material = Vec::with_capacity(512);
    material.extend_from_slice(b"luca.artifact.turn-capability.v1\0");
    material.extend_from_slice(&bootstrap.capability_generation.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(bootstrap.resident_pubkey.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&bootstrap.session_epoch.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(bootstrap.binding_ref.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(bootstrap.working_root_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(turn.conversation_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(turn.turn_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(turn.dispatch_receipt_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&turn.cancellation_epoch.get().to_be_bytes());

    let digest = hmac_sha256(bootstrap.master_capability.as_str().as_bytes(), &material);
    material.zeroize();
    format!("sha256:{}", hex::encode(digest))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> Output<Sha256> {
    const BLOCK_SIZE: usize = 64;
    let mut key_block = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key);
        key_block[..hashed.len()].copy_from_slice(&hashed);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= key_block[index];
        outer_pad[index] ^= key_block[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let mut inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    let digest = outer.finalize();
    key_block.zeroize();
    inner_pad.zeroize();
    outer_pad.zeroize();
    inner_digest.zeroize();
    digest
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bootstrap() -> ArtifactMcpBootstrapV1 {
        ArtifactMcpBootstrapV1 {
            protocol: BROKER_PROTOCOL.into(),
            endpoint: "/tmp/luca-ab-fixture/e7-0123456789abcdef.sock".into(),
            master_capability: Sha256Ref::parse(format!("sha256:{}", "a".repeat(64))).unwrap(),
            capability_generation: SafeU53::new(9).unwrap(),
            resident_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
            session_epoch: SafeU53::new(7).unwrap(),
            binding_ref: Sha256Ref::parse(format!("sha256:{}", "b".repeat(64))).unwrap(),
            working_root_id: OpaqueId::parse("root-fixture").unwrap(),
        }
    }

    fn turn() -> ArtifactTurnBindingV1 {
        ArtifactTurnBindingV1 {
            conversation_id: OpaqueId::parse("conversation-1").unwrap(),
            turn_id: OpaqueId::parse("turn-1").unwrap(),
            dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
            cancellation_epoch: SafeU53::new(7).unwrap(),
        }
    }

    #[test]
    fn projection_contains_only_exact_sidecar_coordinates() {
        let config = ArtifactMcpConfig {
            command: "/opt/luca/buzz-dev-mcp".into(),
            bootstrap: bootstrap(),
            declared_support: ArtifactMcpSupport::Supported,
            probe_key: None,
            probe_adapter: None,
        };
        let server = config.server_for_turn(&turn());
        assert!(server.name.starts_with("luca-artifacts-"));
        assert_eq!(server.env.len(), 8);
        let serialized = serde_json::to_string(&server).unwrap();
        assert!(!serialized.contains("root-fixture"));
        assert!(!serialized.contains(&"a".repeat(64)));
        assert!(!serialized.contains("LUCA_MANAGED"));
        assert!(!serialized.contains("PRIVATE_KEY"));
    }

    #[test]
    fn capability_changes_with_dispatch_and_cancellation() {
        let bootstrap = bootstrap();
        let original = derive_turn_capability(&bootstrap, &turn());
        let mut changed = turn();
        changed.dispatch_receipt_id = OpaqueId::parse("dispatch-2").unwrap();
        assert_ne!(original, derive_turn_capability(&bootstrap, &changed));
        changed = turn();
        changed.cancellation_epoch = SafeU53::new(8).unwrap();
        assert_ne!(original, derive_turn_capability(&bootstrap, &changed));
    }

    #[tokio::test]
    async fn probe_projection_contains_no_authority_and_caches_by_executable_fingerprint() {
        probe_cache().lock().unwrap().clear();
        let config = ArtifactMcpConfig {
            command: "/opt/luca/buzz-dev-mcp".into(),
            bootstrap: bootstrap(),
            declared_support: ArtifactMcpSupport::ProbePending,
            probe_key: Some(Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).unwrap()),
            probe_adapter: None,
        };
        let receipt = DisposableProbeReceipt::bind().await.unwrap();
        let server = config.probe_server(&receipt);
        let serialized = serde_json::to_string(&server).unwrap();
        assert_eq!(server.env.len(), 3);
        assert!(serialized.contains("LUCA_ARTIFACT_PROBE_MODE"));
        assert!(serialized.contains("LUCA_ARTIFACT_PROBE_ENDPOINT"));
        assert!(serialized.contains("LUCA_ARTIFACT_PROBE_NONCE"));
        for forbidden in [
            "LUCA_ARTIFACT_CAPABILITY",
            "LUCA_ARTIFACT_ENDPOINT",
            "LUCA_ARTIFACT_TURN_ID",
            "root-fixture",
            "conversation-1",
        ] {
            assert!(!serialized.contains(forbidden));
        }
        assert_eq!(config.effective_support(), ArtifactMcpSupport::ProbePending);
        config.record_probe(ArtifactMcpSupport::Supported);
        assert_eq!(config.effective_support(), ArtifactMcpSupport::Supported);
        let mut different_authority = config.clone();
        different_authority.bootstrap.binding_ref =
            Sha256Ref::parse(format!("sha256:{}", "d".repeat(64))).unwrap();
        assert_eq!(
            different_authority.effective_support(),
            ArtifactMcpSupport::Supported,
            "authority changes must not change an executable capability fact"
        );
        probe_cache().lock().unwrap().clear();
    }

    #[test]
    fn probe_pending_without_host_executable_key_fails_closed() {
        let bootstrap = bootstrap();
        let resident_pubkey = bootstrap.resident_pubkey.clone();
        let session_epoch = bootstrap.session_epoch;
        let binding_ref = bootstrap.binding_ref.clone();
        let config = ArtifactMcpConfig::new(
            "/opt/luca/buzz-dev-mcp".into(),
            Some(bootstrap),
            Some((&resident_pubkey, session_epoch, &binding_ref)),
            ArtifactMcpSupport::ProbePending,
            None,
            ArtifactProbeAdapterConfig::new(
                "/opt/acp/future-agent".into(),
                Vec::new(),
                Vec::new(),
                false,
            ),
        )
        .unwrap()
        .unwrap();
        assert_eq!(config.effective_support(), ArtifactMcpSupport::Unavailable);
    }

    #[tokio::test]
    async fn probe_receipt_requires_the_exact_one_shot_nonce() {
        use tokio::io::AsyncWriteExt;

        let receipt = DisposableProbeReceipt::bind().await.unwrap();
        let endpoint = receipt.endpoint.clone();
        let nonce = receipt.nonce.clone();
        let sender = tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(endpoint).await.unwrap();
            stream.write_all(nonce.as_bytes()).await.unwrap();
            stream.write_all(b"\n").await.unwrap();
            stream.shutdown().await.unwrap();
        });
        receipt.receive().await.unwrap();
        sender.await.unwrap();
    }
}

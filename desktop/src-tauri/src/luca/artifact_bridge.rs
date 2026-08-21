//! Desktop-owned, exact-turn Artifact Canvas broker.
//!
//! The restricted MCP child knows only a private socket, a derived turn
//! capability, and public turn coordinates. Owner identity, resident identity,
//! session binding, and the canonical working root remain desktop-owned.

use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use luca_protocol::{
    ArtifactBrokerBindingV1, ArtifactSourceV1, ArtifactToolOperationV1, ArtifactToolOutcomeV1,
    ArtifactToolRequestV1, ArtifactToolResultV1, Hex64, OpaqueId, SafeU53, Sha256Ref,
    ARTIFACT_TOOL_PROTOCOL, MAX_ARTIFACT_FILE_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{digest::Output, Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Emitter, Manager};
use zeroize::{Zeroize, Zeroizing};

const BROKER_PROTOCOL: &str = "luca.artifact.broker.v1";
const MAX_BROKER_FRAME_BYTES: usize = 32 * 1024 * 1024;
const MAX_ACTIVE_CONNECTIONS: usize = 16;
static NEXT_CAPABILITY_GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(crate) struct ArtifactBrokerContext {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) session_epoch: SafeU53,
    pub(crate) binding_ref: Sha256Ref,
    pub(crate) working_root_id: OpaqueId,
    pub(crate) working_root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactMcpBootstrapV1<'a> {
    protocol: &'static str,
    endpoint: &'a str,
    master_capability: &'a str,
    capability_generation: u64,
    resident_pubkey: &'a str,
    session_epoch: u64,
    binding_ref: &'a str,
    working_root_id: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactBrokerFrameV1 {
    protocol: String,
    capability: String,
    capability_generation: u64,
    conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
    operation_request_id: String,
    operation: String,
    arguments: Value,
}

#[derive(Serialize)]
struct ArtifactBrokerResponseV1 {
    protocol: &'static str,
    ok: bool,
    request_id: String,
    operation: String,
    capability_generation: u64,
    conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic_code: Option<&'static str>,
    result: ArtifactToolResultV1,
}

/// Narrow integration seam for the durable artifact substrate. Implementors
/// receive an already validated, host-authorized request and canonical root.
pub(crate) trait ArtifactBrokerBackend: Send + Sync {
    fn dispatch(
        &self,
        request: ArtifactToolRequestV1,
        canonical_working_root: &Path,
    ) -> ArtifactToolResultV1;
}

struct ArtifactBrokerOwner {
    active: Arc<AtomicBool>,
    socket_path: PathBuf,
    directory: PathBuf,
    handle: JoinHandle<()>,
    resident_pubkey: String,
    operation_gate: Arc<Mutex<()>>,
}

impl ArtifactBrokerOwner {
    fn shutdown(self) {
        self.active.store(false, Ordering::SeqCst);
        // Wait for any operation that already crossed the socket boundary.
        // A queued request acquires the gate after this flag changes and fails
        // before authorization or storage dispatch.
        let gate = self.operation_gate.lock();
        let _ = UnixStream::connect(&self.socket_path);
        let _ = self.handle.join();
        drop(gate);
        let _ = fs::remove_file(&self.socket_path);
        let _ = fs::remove_dir(&self.directory);
    }
}

pub(crate) struct ArtifactBrokerLease {
    owner: Option<ArtifactBrokerOwner>,
    bootstrap_json: String,
}

impl ArtifactBrokerLease {
    pub(crate) fn bootstrap_json(&self) -> &str {
        &self.bootstrap_json
    }

    pub(crate) fn commit(mut self) -> Result<(), String> {
        let owner = self
            .owner
            .take()
            .ok_or_else(|| "artifact broker lease is unavailable".to_owned())?;
        let resident = owner.resident_pubkey.clone();
        let mut registry = match brokers().lock() {
            Ok(registry) => registry,
            Err(_) => {
                owner.shutdown();
                return Err("artifact broker registry is unavailable".into());
            }
        };
        if registry.contains_key(&resident) {
            drop(registry);
            owner.shutdown();
            return Err("artifact broker already exists for resident".into());
        }
        registry.insert(resident, owner);
        Ok(())
    }
}

impl Drop for ArtifactBrokerLease {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.take() {
            owner.shutdown();
        }
    }
}

fn brokers() -> &'static Mutex<HashMap<String, ArtifactBrokerOwner>> {
    static BROKERS: OnceLock<Mutex<HashMap<String, ArtifactBrokerOwner>>> = OnceLock::new();
    BROKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn create_broker_lease(
    app: &AppHandle,
    context: ArtifactBrokerContext,
    backend: Arc<dyn ArtifactBrokerBackend>,
) -> Result<ArtifactBrokerLease, String> {
    if context.session_epoch.get() == 0 {
        return Err("artifact broker session is invalid".into());
    }
    let canonical_working_root = fs::canonicalize(&context.working_root)
        .map_err(|_| "artifact working root is unavailable".to_owned())?;
    if !canonical_working_root.is_dir() {
        return Err("artifact working root is unavailable".into());
    }
    let context = ArtifactBrokerContext {
        working_root: canonical_working_root,
        ..context
    };
    let generation = next_generation()?;
    let master_capability = random_capability()?;
    let directory =
        PathBuf::from("/tmp").join(format!("luca-ab-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&directory)
        .map_err(|_| "artifact broker cache could not be prepared".to_owned())?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .map_err(|_| "artifact broker cache could not be secured".to_owned())?;
    let socket_path = directory.join(format!(
        "e{}-{}.sock",
        context.session_epoch.get(),
        &uuid::Uuid::new_v4().simple().to_string()[..16]
    ));
    let listener = UnixListener::bind(&socket_path)
        .map_err(|_| "artifact broker endpoint could not be created".to_owned())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "artifact broker endpoint could not be bounded".to_owned())?;
    let endpoint = socket_path
        .to_str()
        .ok_or_else(|| "artifact broker endpoint is invalid".to_owned())?;
    let bootstrap_json = serde_json::to_string(&ArtifactMcpBootstrapV1 {
        protocol: BROKER_PROTOCOL,
        endpoint,
        master_capability: master_capability.as_str(),
        capability_generation: generation.get(),
        resident_pubkey: context.resident_pubkey.as_str(),
        session_epoch: context.session_epoch.get(),
        binding_ref: context.binding_ref.as_str(),
        working_root_id: context.working_root_id.as_str(),
    })
    .map_err(|_| "artifact broker bootstrap is invalid".to_owned())?;
    let resident_pubkey = context.resident_pubkey.as_str().to_owned();

    let active = Arc::new(AtomicBool::new(true));
    let operation_gate = Arc::new(Mutex::new(()));
    let core = Arc::new(ArtifactBridgeCore {
        app: app.clone(),
        active: Arc::clone(&active),
        context,
        master_capability: Zeroizing::new(master_capability.as_str().to_owned()),
        capability_generation: generation,
        backend,
        operation_gate: Arc::clone(&operation_gate),
    });
    let thread_active = Arc::clone(&active);
    let handle = thread::Builder::new()
        .name("luca-artifact-broker".into())
        .spawn(move || serve(listener, thread_active, core))
        .map_err(|_| "artifact broker could not start".to_owned())?;
    Ok(ArtifactBrokerLease {
        owner: Some(ArtifactBrokerOwner {
            active,
            socket_path,
            directory,
            handle,
            resident_pubkey,
            operation_gate,
        }),
        bootstrap_json,
    })
}

pub(crate) fn stop_artifact_broker(resident_pubkey: &str) -> Result<(), String> {
    let owner = brokers()
        .lock()
        .map_err(|_| "artifact broker registry is unavailable".to_owned())?
        .remove(&resident_pubkey.to_ascii_lowercase());
    if let Some(owner) = owner {
        owner.shutdown();
    }
    Ok(())
}

struct ArtifactBridgeCore {
    app: AppHandle,
    active: Arc<AtomicBool>,
    context: ArtifactBrokerContext,
    master_capability: Zeroizing<String>,
    capability_generation: SafeU53,
    backend: Arc<dyn ArtifactBrokerBackend>,
    operation_gate: Arc<Mutex<()>>,
}

fn unavailable_response(frame: &ArtifactBrokerFrameV1) -> ArtifactBrokerResponseV1 {
    let request_id = OpaqueId::parse(frame.operation_request_id.clone())
        .unwrap_or_else(|_| OpaqueId::parse("invalid-request").expect("static request id"));
    ArtifactBrokerResponseV1 {
        protocol: ARTIFACT_TOOL_PROTOCOL,
        ok: false,
        request_id: frame.operation_request_id.clone(),
        operation: frame.operation.clone(),
        capability_generation: frame.capability_generation,
        conversation_id: frame.conversation_id.clone(),
        turn_id: frame.turn_id.clone(),
        dispatch_receipt_id: frame.dispatch_receipt_id.clone(),
        cancellation_epoch: frame.cancellation_epoch,
        diagnostic_code: Some("authority_unavailable"),
        result: ArtifactToolResultV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL.into(),
            request_id,
            outcome: ArtifactToolOutcomeV1::Rejected {
                code: "authority_unavailable".into(),
                message: "Artifact authority is unavailable.".into(),
            },
        },
    }
}

impl ArtifactBridgeCore {
    fn handle_frame(&self, frame: ArtifactBrokerFrameV1) -> ArtifactBrokerResponseV1 {
        let _operation_guard = match self.operation_gate.lock() {
            Ok(guard) => guard,
            Err(_) => return unavailable_response(&frame),
        };
        let fallback_id = OpaqueId::parse("invalid-request").expect("static request id");
        let request_id = OpaqueId::parse(frame.operation_request_id.clone()).unwrap_or(fallback_id);
        let rejected = |code: &'static str, message: &'static str| ArtifactToolResultV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL.into(),
            request_id: request_id.clone(),
            outcome: ArtifactToolOutcomeV1::Rejected {
                code: code.into(),
                message: message.into(),
            },
        };
        let response = |ok, diagnostic_code, result| ArtifactBrokerResponseV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL,
            ok,
            request_id: frame.operation_request_id.clone(),
            operation: frame.operation.clone(),
            capability_generation: frame.capability_generation,
            conversation_id: frame.conversation_id.clone(),
            turn_id: frame.turn_id.clone(),
            dispatch_receipt_id: frame.dispatch_receipt_id.clone(),
            cancellation_epoch: frame.cancellation_epoch,
            diagnostic_code,
            result,
        };

        if !self.active.load(Ordering::SeqCst)
            || frame.protocol != BROKER_PROTOCOL
            || frame.capability_generation != self.capability_generation.get()
        {
            return response(
                false,
                Some("authority_unavailable"),
                rejected(
                    "authority_unavailable",
                    "Artifact authority is unavailable.",
                ),
            );
        }
        let coordinates = match parse_coordinates(&frame) {
            Ok(coordinates) => coordinates,
            Err(()) => {
                return response(
                    false,
                    Some("invalid_request"),
                    rejected("invalid_request", "Artifact request is invalid."),
                )
            }
        };
        let expected = derive_turn_capability(
            self.master_capability.as_str(),
            self.capability_generation,
            &self.context,
            &coordinates,
        );
        if !constant_time_eq(frame.capability.as_bytes(), expected.as_bytes()) {
            return response(
                false,
                Some("authority_denied"),
                rejected("authority_denied", "Artifact authority was denied."),
            );
        }
        if authorize_turn(&self.app, &self.context, &coordinates).is_err() {
            return response(
                false,
                Some("turn_not_active"),
                rejected("turn_not_active", "The managed turn is no longer active."),
            );
        }
        let operation = match parse_operation(&frame.operation, frame.arguments.clone()) {
            Ok(operation) => operation,
            Err(()) => {
                return response(
                    false,
                    Some("invalid_arguments"),
                    rejected("invalid_arguments", "Artifact arguments are invalid."),
                )
            }
        };
        let request = ArtifactToolRequestV1 {
            protocol: ARTIFACT_TOOL_PROTOCOL.into(),
            request_id: request_id.clone(),
            binding: ArtifactBrokerBindingV1 {
                owner_pubkey: self.context.owner_pubkey.clone(),
                resident_pubkey: self.context.resident_pubkey.clone(),
                session_epoch: self.context.session_epoch,
                turn_id: coordinates.turn_id.clone(),
                conversation_id: coordinates.conversation_id.clone(),
                dispatch_receipt_id: coordinates.dispatch_receipt_id.clone(),
                cancellation_epoch: coordinates.cancellation_epoch,
                working_root_id: self.context.working_root_id.clone(),
            },
            operation,
        };
        if request.validate().is_err()
            || validate_workspace_source(&request.operation, &self.context.working_root).is_err()
        {
            return response(
                false,
                Some("invalid_arguments"),
                rejected("invalid_arguments", "Artifact arguments are invalid."),
            );
        }
        // Recheck after parsing and source resolution so cancellation cannot
        // race a slow canonicalization step and still reach durable storage.
        if !self.active.load(Ordering::SeqCst)
            || authorize_turn(&self.app, &self.context, &coordinates).is_err()
        {
            return response(
                false,
                Some("turn_not_active"),
                rejected("turn_not_active", "The managed turn is no longer active."),
            );
        }
        let binding = request.binding.clone();
        let result = self
            .backend
            .dispatch(request, self.context.working_root.as_path());
        let ok = !matches!(
            result.outcome,
            ArtifactToolOutcomeV1::Rejected { .. } | ArtifactToolOutcomeV1::Failed { .. }
        );
        if ok {
            emit_body_free_events(&self.app, &binding, &result);
        }
        response(ok, None, result)
    }
}

#[derive(Clone)]
struct TurnCoordinates {
    conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    cancellation_epoch: SafeU53,
}

fn parse_coordinates(frame: &ArtifactBrokerFrameV1) -> Result<TurnCoordinates, ()> {
    let cancellation_epoch = SafeU53::new(frame.cancellation_epoch).map_err(|_| ())?;
    if cancellation_epoch.get() == 0 {
        return Err(());
    }
    Ok(TurnCoordinates {
        conversation_id: OpaqueId::parse(frame.conversation_id.clone()).map_err(|_| ())?,
        turn_id: OpaqueId::parse(frame.turn_id.clone()).map_err(|_| ())?,
        dispatch_receipt_id: OpaqueId::parse(frame.dispatch_receipt_id.clone()).map_err(|_| ())?,
        cancellation_epoch,
    })
}

fn parse_operation(operation: &str, arguments: Value) -> Result<ArtifactToolOperationV1, ()> {
    serde_json::from_value(serde_json::json!({
        "operation": operation,
        "arguments": arguments,
    }))
    .map_err(|_| ())
}

fn authorize_turn(
    app: &AppHandle,
    context: &ArtifactBrokerContext,
    coordinates: &TurnCoordinates,
) -> Result<(), ()> {
    if coordinates.cancellation_epoch != context.session_epoch {
        return Err(());
    }
    super::communication_turn_registry::authorize(
        context.resident_pubkey.as_str(),
        context.session_epoch.get(),
        coordinates.conversation_id.as_str(),
        coordinates.turn_id.as_str(),
        coordinates.dispatch_receipt_id.as_str(),
    )
    .map_err(|_| ())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ())?
        .as_secs();
    let store = super::managed_dispatch_store::global_dispatch_store(app).map_err(|_| ())?;
    let dispatch = store
        .lock()
        .map_err(|_| ())?
        .recheck_communication_turn(
            coordinates.dispatch_receipt_id.as_str(),
            context.resident_pubkey.as_str(),
            coordinates.conversation_id.as_str(),
            context.session_epoch.get(),
            now,
        )
        .map_err(|_| ())?
        .clone();
    if dispatch.owner_pubkey != context.owner_pubkey.as_str()
        || dispatch.resident_pubkey != context.resident_pubkey.as_str()
        || dispatch.conversation_id != coordinates.conversation_id.as_str()
        || dispatch.session_epoch != Some(context.session_epoch.get())
    {
        return Err(());
    }
    let state = app.state::<crate::app_state::AppState>();
    let owner_keys = state.signing_keys().map_err(|_| ())?;
    if owner_keys.public_key().to_hex() != context.owner_pubkey.as_str() {
        return Err(());
    }
    Ok(())
}

fn validate_workspace_source(operation: &ArtifactToolOperationV1, root: &Path) -> Result<(), ()> {
    let source = match operation {
        ArtifactToolOperationV1::ArtifactCreate(args) => Some(&args.source),
        ArtifactToolOperationV1::ArtifactUpdate(args) => Some(&args.source),
        _ => None,
    };
    let Some(source) = source else {
        return Ok(());
    };
    let relative = match source {
        ArtifactSourceV1::InlineText { .. } => return Ok(()),
        ArtifactSourceV1::WorkspaceFile { relative_path, .. }
        | ArtifactSourceV1::WorkspaceDirectory { relative_path } => relative_path,
    };
    let resolved = fs::canonicalize(root.join(relative)).map_err(|_| ())?;
    if !resolved.starts_with(root) {
        return Err(());
    }
    let metadata = fs::metadata(&resolved).map_err(|_| ())?;
    match source {
        ArtifactSourceV1::WorkspaceFile { .. }
            if !metadata.is_file() || metadata.len() > MAX_ARTIFACT_FILE_BYTES =>
        {
            Err(())
        }
        ArtifactSourceV1::WorkspaceDirectory { .. } if !metadata.is_dir() => Err(()),
        _ => Ok(()),
    }
}

fn emit_body_free_events(
    app: &AppHandle,
    binding: &ArtifactBrokerBindingV1,
    result: &ArtifactToolResultV1,
) {
    match &result.outcome {
        ArtifactToolOutcomeV1::Committed { artifact, .. } => {
            let _ = app.emit(
                "luca://artifacts-changed",
                serde_json::json!({
                    "artifactId": artifact.artifact_id,
                    "currentVersion": artifact.current_version,
                    "receiptState": artifact.receipt_state,
                    "kind": artifact.kind,
                    "deleted": artifact.deleted,
                    "conversationId": binding.conversation_id,
                    "turnId": binding.turn_id,
                }),
            );
        }
        ArtifactToolOutcomeV1::Presented {
            artifact_id,
            version,
        } => {
            let _ = app.emit(
                "luca://canvas-present",
                serde_json::json!({
                    "artifactId": artifact_id,
                    "version": version,
                    "conversationId": binding.conversation_id,
                    "turnId": binding.turn_id,
                }),
            );
        }
        ArtifactToolOutcomeV1::PreviewAttached {
            preview_session_id,
            artifact_id,
            ..
        } => {
            let _ = app.emit(
                "luca://preview-state",
                serde_json::json!({
                    "previewSessionId": preview_session_id,
                    "artifactId": artifact_id,
                    "state": "attached",
                    "conversationId": binding.conversation_id,
                    "turnId": binding.turn_id,
                }),
            );
        }
        ArtifactToolOutcomeV1::PreviewDetached { preview_session_id } => {
            let _ = app.emit(
                "luca://preview-state",
                serde_json::json!({
                    "previewSessionId": preview_session_id,
                    "state": "detached",
                    "conversationId": binding.conversation_id,
                    "turnId": binding.turn_id,
                }),
            );
        }
        _ => {}
    }
}

fn serve(listener: UnixListener, active: Arc<AtomicBool>, core: Arc<ArtifactBridgeCore>) {
    let active_connections = Arc::new(AtomicUsize::new(0));
    while active.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if !active.load(Ordering::SeqCst) {
                    break;
                }
                if active_connections.fetch_add(1, Ordering::SeqCst) >= MAX_ACTIVE_CONNECTIONS {
                    active_connections.fetch_sub(1, Ordering::SeqCst);
                    drop(stream);
                    continue;
                }
                let core = Arc::clone(&core);
                let counter = Arc::clone(&active_connections);
                let _ = thread::Builder::new()
                    .name("luca-artifact-request".into())
                    .spawn(move || {
                        serve_connection(stream, &core);
                        counter.fetch_sub(1, Ordering::SeqCst);
                    });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }
}

fn serve_connection(stream: UnixStream, core: &ArtifactBridgeCore) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(130)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream).take((MAX_BROKER_FRAME_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    let response = match reader.read_until(b'\n', &mut bytes) {
        Ok(read) if read > 0 && bytes.len() <= MAX_BROKER_FRAME_BYTES && bytes.ends_with(b"\n") => {
            serde_json::from_slice(&bytes)
                .ok()
                .map(|frame| core.handle_frame(frame))
        }
        _ => None,
    };
    let Some(response) = response else {
        return;
    };
    if let Ok(bytes) = serde_json::to_vec(&response) {
        let mut writer = writer;
        let _ = writer
            .write_all(&bytes)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush());
    }
}

fn derive_turn_capability(
    master_capability: &str,
    capability_generation: SafeU53,
    context: &ArtifactBrokerContext,
    coordinates: &TurnCoordinates,
) -> String {
    let mut material = Vec::with_capacity(512);
    material.extend_from_slice(b"luca.artifact.turn-capability.v1\0");
    material.extend_from_slice(&capability_generation.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(context.resident_pubkey.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&context.session_epoch.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(context.binding_ref.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(context.working_root_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.conversation_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.turn_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.dispatch_receipt_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&coordinates.cancellation_epoch.get().to_be_bytes());
    let digest = hmac_sha256(master_capability.as_bytes(), &material);
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

fn next_generation() -> Result<SafeU53, String> {
    let generation = NEXT_CAPABILITY_GENERATION.fetch_add(1, Ordering::SeqCst);
    if generation == 0 {
        return Err("artifact broker generation is unavailable".into());
    }
    SafeU53::new(generation).map_err(|_| "artifact broker generation is unavailable".to_owned())
}

fn random_capability() -> Result<Sha256Ref, String> {
    let mut digest = Sha256::new();
    digest.update(b"luca.artifact.master-capability.v1\0");
    digest.update(uuid::Uuid::new_v4().as_bytes());
    digest.update(uuid::Uuid::new_v4().as_bytes());
    Sha256Ref::parse(format!("sha256:{}", hex::encode(digest.finalize())))
        .map_err(|_| "artifact broker capability is invalid".to_owned())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

pub(crate) fn working_root_id(root: &Path) -> Result<OpaqueId, String> {
    let canonical =
        fs::canonicalize(root).map_err(|_| "artifact working root is unavailable".to_owned())?;
    let mut digest = Sha256::new();
    digest.update(b"luca.artifact.working-root.v1\0");
    digest.update(canonical.as_os_str().as_encoded_bytes());
    OpaqueId::parse(format!("root-{}", &hex::encode(digest.finalize())[..32]))
        .map_err(|_| "artifact working root is invalid".to_owned())
}

#[cfg(test)]
#[path = "artifact_bridge_tests.rs"]
mod tests;

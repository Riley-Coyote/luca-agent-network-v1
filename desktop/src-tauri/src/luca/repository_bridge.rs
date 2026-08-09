//! Desktop-owned repository work broker for managed residents.
//!
//! The MCP process receives a conversation-scoped local capability, never an
//! owner key, resident key, absolute repository path, or durable approval.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use chrono::Utc;
use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, Hex64, ManagedPermissionOptionV1,
    ManagedPermissionRequestV1, OpaqueId, RepositoryToolOperationV1, RepositoryToolReceiptStatusV1,
    RepositoryToolReceiptV1, RepositoryToolRequestV1, SafeU53, Sha256Ref,
    MANAGED_PERMISSION_PROTOCOL, REPOSITORY_WORK_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

mod operations;

const BROKER_PROTOCOL: &str = "luca.repository.broker.v1";
const MAX_BROKER_FRAME_BYTES: usize = 768 * 1024;
const MAX_REPOSITORY_RECEIPTS: usize = 256;
const ALLOW_ONCE: &str = "luca-repository-allow-once";
const ALLOW_CONVERSATION: &str = "luca-repository-allow-conversation";
const REJECT: &str = "luca-repository-reject";

#[derive(Clone)]
struct BrokerContext {
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryMcpBootstrapV1<'a> {
    protocol: &'static str,
    endpoint: &'a str,
    master_capability: &'a str,
    resident_pubkey: &'a str,
    session_epoch: u64,
    binding_ref: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RepositoryBrokerFrameV1 {
    protocol: String,
    capability: String,
    conversation_id: OpaqueId,
    operation: RepositoryToolOperationV1,
    arguments: Value,
}

#[derive(Serialize)]
struct RepositoryBrokerResponseV1 {
    protocol: &'static str,
    ok: bool,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt: Option<RepositoryToolReceiptV1>,
}

struct RepositoryBrokerOwner {
    active: Arc<AtomicBool>,
    socket_path: PathBuf,
    handle: JoinHandle<()>,
    resident_pubkey: String,
    session_epoch: u64,
}

impl RepositoryBrokerOwner {
    fn shutdown(self) {
        self.active.store(false, Ordering::SeqCst);
        crate::luca::managed_permission::cancel_resident_session(
            &self.resident_pubkey,
            self.session_epoch,
        );
        let _ = UnixStream::connect(&self.socket_path);
        let _ = self.handle.join();
        let _ = fs::remove_file(&self.socket_path);
    }
}

pub(crate) struct RepositoryBrokerLease {
    owner: Option<RepositoryBrokerOwner>,
    bootstrap_json: String,
}

impl RepositoryBrokerLease {
    pub(crate) fn bootstrap_json(&self) -> &str {
        &self.bootstrap_json
    }

    pub(crate) fn commit(mut self) -> Result<(), String> {
        let owner = self
            .owner
            .take()
            .ok_or_else(|| "repository broker lease is unavailable".to_owned())?;
        let resident = owner.resident_pubkey.clone();
        let mut registry = brokers()
            .lock()
            .map_err(|_| "repository broker registry is unavailable".to_owned())?;
        if registry.contains_key(&resident) {
            drop(registry);
            owner.shutdown();
            return Err("repository broker already exists for resident".into());
        }
        registry.insert(resident, owner);
        Ok(())
    }
}

impl Drop for RepositoryBrokerLease {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.take() {
            owner.shutdown();
        }
    }
}

fn brokers() -> &'static Mutex<HashMap<String, RepositoryBrokerOwner>> {
    static BROKERS: OnceLock<Mutex<HashMap<String, RepositoryBrokerOwner>>> = OnceLock::new();
    BROKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn create_broker_lease(
    app: &AppHandle,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
) -> Result<RepositoryBrokerLease, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "repository broker cache is unavailable".to_owned())?
        .join("luca")
        .join("repository-broker");
    fs::create_dir_all(&directory)
        .map_err(|_| "repository broker cache could not be prepared".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "repository broker cache could not be secured".to_owned())?;
    }
    let socket_path = directory.join(format!(
        "{}-{}.sock",
        session_epoch.get(),
        uuid::Uuid::new_v4().simple()
    ));
    let listener = UnixListener::bind(&socket_path)
        .map_err(|_| "repository broker endpoint could not be created".to_owned())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "repository broker endpoint could not be bounded".to_owned())?;
    let master_capability = random_capability()?;
    let endpoint = socket_path
        .to_str()
        .ok_or_else(|| "repository broker endpoint is invalid".to_owned())?;
    let bootstrap_json = serde_json::to_string(&RepositoryMcpBootstrapV1 {
        protocol: BROKER_PROTOCOL,
        endpoint,
        master_capability: master_capability.as_str(),
        resident_pubkey: resident_pubkey.as_str(),
        session_epoch: session_epoch.get(),
        binding_ref: binding_ref.as_str(),
    })
    .map_err(|_| "repository broker bootstrap is invalid".to_owned())?;
    let active = Arc::new(AtomicBool::new(true));
    let context = BrokerContext {
        owner_pubkey,
        resident_pubkey: resident_pubkey.clone(),
        session_epoch,
        binding_ref,
    };
    let thread_active = Arc::clone(&active);
    let app = app.clone();
    let handle = thread::Builder::new()
        .name("luca-repository-broker".into())
        .spawn(move || serve(listener, thread_active, app, context, master_capability))
        .map_err(|_| "repository broker could not start".to_owned())?;
    Ok(RepositoryBrokerLease {
        owner: Some(RepositoryBrokerOwner {
            active,
            socket_path,
            handle,
            resident_pubkey: resident_pubkey.as_str().to_owned(),
            session_epoch: session_epoch.get(),
        }),
        bootstrap_json,
    })
}

pub(crate) fn stop_repository_broker(resident_pubkey: &str) -> Result<(), String> {
    let owner = brokers()
        .lock()
        .map_err(|_| "repository broker registry is unavailable".to_owned())?
        .remove(resident_pubkey);
    if let Some(owner) = owner {
        owner.shutdown();
    }
    Ok(())
}

pub(crate) fn derive_conversation_capability(
    master_capability: &str,
    conversation_id: &str,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"luca.repository.conversation-capability.v1\0");
    digest.update(master_capability.as_bytes());
    digest.update(b"\0");
    digest.update(conversation_id.as_bytes());
    format!("sha256:{}", hex::encode(digest.finalize()))
}

fn serve(
    listener: UnixListener,
    active: Arc<AtomicBool>,
    app: AppHandle,
    context: BrokerContext,
    master_capability: Sha256Ref,
) {
    let approvals = Arc::new(Mutex::new(BTreeSet::new()));
    while active.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if !active.load(Ordering::SeqCst) {
                    break;
                }
                let active = Arc::clone(&active);
                let app = app.clone();
                let context = context.clone();
                let master_capability = master_capability.clone();
                let approvals = Arc::clone(&approvals);
                let _ = thread::Builder::new()
                    .name("luca-repository-request".into())
                    .spawn(move || {
                        serve_connection(
                            stream,
                            &active,
                            &app,
                            &context,
                            &master_capability,
                            &approvals,
                        );
                    });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }
}

fn serve_connection(
    stream: UnixStream,
    active: &Arc<AtomicBool>,
    app: &AppHandle,
    context: &BrokerContext,
    master_capability: &Sha256Ref,
    approvals: &Arc<Mutex<BTreeSet<String>>>,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream).take((MAX_BROKER_FRAME_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    let response = match reader.read_until(b'\n', &mut bytes) {
        Ok(read) if read > 0 && bytes.len() <= MAX_BROKER_FRAME_BYTES && bytes.ends_with(b"\n") => {
            serde_json::from_slice::<RepositoryBrokerFrameV1>(&bytes)
                .map_err(|_| "repository broker request is invalid".to_owned())
                .and_then(|frame| {
                    handle_frame(active, app, context, master_capability, approvals, frame)
                })
                .unwrap_or_else(error_response)
        }
        _ => error_response("repository broker request is unavailable".into()),
    };
    if let Ok(bytes) = serde_json::to_vec(&response) {
        let mut writer = writer;
        let _ = writer
            .write_all(&bytes)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush());
    }
}

fn handle_frame(
    active: &Arc<AtomicBool>,
    app: &AppHandle,
    context: &BrokerContext,
    master_capability: &Sha256Ref,
    approvals: &Arc<Mutex<BTreeSet<String>>>,
    frame: RepositoryBrokerFrameV1,
) -> Result<RepositoryBrokerResponseV1, String> {
    if !active.load(Ordering::SeqCst)
        || frame.protocol != BROKER_PROTOCOL
        || frame.capability
            != derive_conversation_capability(
                master_capability.as_str(),
                frame.conversation_id.as_str(),
            )
    {
        return Err("repository broker capability is stale".into());
    }
    if frame.operation == RepositoryToolOperationV1::List {
        if frame
            .arguments
            .as_object()
            .is_none_or(|arguments| !arguments.is_empty())
        {
            return Err("repositories arguments are invalid".into());
        }
        return list_repositories(app, context);
    }

    let prepared = operations::prepare(frame.operation, &frame.arguments)?;
    let source_id = OpaqueId::parse(prepared.source_id)
        .map_err(|_| "repository source ID is invalid".to_owned())?;
    let fingerprint = operation_fingerprint(frame.operation, &source_id, &frame.arguments)?;
    let request = repository_request(
        context,
        frame.conversation_id,
        source_id.clone(),
        frame.operation,
        fingerprint.clone(),
        prepared.relative_paths,
        prepared.display_summary,
    )?;
    request
        .validate()
        .map_err(|_| "repository tool request is invalid".to_owned())?;
    let state = app.state::<crate::app_state::AppState>();
    state
        .authorized_repository_root(
            &context.owner_pubkey,
            &context.resident_pubkey,
            &context.binding_ref,
            &source_id,
        )
        .map_err(|error| error.code().to_owned())?;

    if frame.operation.requires_permission()
        && !permission_granted(app, &request, approvals, active)?
    {
        let receipt = receipt(&request, RepositoryToolReceiptStatusV1::Denied, 0)?;
        retain_receipt(&state, receipt.clone());
        return Ok(RepositoryBrokerResponseV1 {
            protocol: BROKER_PROTOCOL,
            ok: false,
            content: "Repository operation was not approved.".into(),
            receipt: Some(receipt),
        });
    }
    if !active.load(Ordering::SeqCst) {
        return Err("repository broker capability is stale".into());
    }
    let _operation_guard = state
        .repository_work_lock
        .lock()
        .map_err(|_| "repository work authority is unavailable".to_owned())?;
    let root = state
        .authorized_repository_root(
            &context.owner_pubkey,
            &context.resident_pubkey,
            &context.binding_ref,
            &source_id,
        )
        .map_err(|error| error.code().to_owned())?;
    match operations::execute(&root, frame.operation, &frame.arguments) {
        Ok(result) => {
            let receipt = receipt(
                &request,
                RepositoryToolReceiptStatusV1::Completed,
                result.changed_path_count,
            )?;
            retain_receipt(&state, receipt.clone());
            Ok(RepositoryBrokerResponseV1 {
                protocol: BROKER_PROTOCOL,
                ok: true,
                content: result.content,
                receipt: Some(receipt),
            })
        }
        Err(error) => {
            let receipt = receipt(&request, RepositoryToolReceiptStatusV1::Failed, 0)?;
            retain_receipt(&state, receipt.clone());
            Ok(RepositoryBrokerResponseV1 {
                protocol: BROKER_PROTOCOL,
                ok: false,
                content: error,
                receipt: Some(receipt),
            })
        }
    }
}

fn list_repositories(
    app: &AppHandle,
    context: &BrokerContext,
) -> Result<RepositoryBrokerResponseV1, String> {
    let state = app.state::<crate::app_state::AppState>();
    let repositories = state
        .authorized_repositories(
            &context.owner_pubkey,
            &context.resident_pubkey,
            &context.binding_ref,
        )
        .map_err(|error| error.code().to_owned())?
        .into_iter()
        .map(|repository| {
            serde_json::json!({
                "sourceId": repository.source_id.as_str(),
                "name": repository.display_name,
            })
        })
        .collect::<Vec<_>>();
    let content = serde_json::to_string(&serde_json::json!({"repositories": repositories}))
        .map_err(|_| "repository inventory response is invalid".to_owned())?;
    Ok(RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: true,
        content,
        receipt: None,
    })
}

fn repository_request(
    context: &BrokerContext,
    conversation_id: OpaqueId,
    source_id: OpaqueId,
    operation: RepositoryToolOperationV1,
    operation_fingerprint: Sha256Ref,
    relative_paths: Vec<String>,
    display_summary: String,
) -> Result<RepositoryToolRequestV1, String> {
    Ok(RepositoryToolRequestV1 {
        protocol: REPOSITORY_WORK_PROTOCOL.into(),
        request_id: opaque_id("repository-request")?,
        resident_pubkey: context.resident_pubkey.clone(),
        session_epoch: context.session_epoch,
        turn_id: opaque_id("repository-turn")?,
        conversation_id,
        source_id,
        binding_ref: context.binding_ref.clone(),
        operation,
        operation_fingerprint,
        relative_paths,
        display_summary,
    })
}

fn permission_granted(
    app: &AppHandle,
    request: &RepositoryToolRequestV1,
    approvals: &Arc<Mutex<BTreeSet<String>>>,
    active: &Arc<AtomicBool>,
) -> Result<bool, String> {
    let cache_key = canonical_sha256(&serde_json::json!({
        "resident": request.resident_pubkey,
        "session": request.session_epoch,
        "conversation": request.conversation_id,
        "source": request.source_id,
        "binding": request.binding_ref,
        "operation": request.operation,
        "fingerprint": request.operation_fingerprint,
    }))
    .map_err(|_| "repository permission fingerprint is invalid".to_owned())?;
    if approvals
        .lock()
        .map_err(|_| "repository permission cache is unavailable".to_owned())?
        .contains(&cache_key)
    {
        return Ok(true);
    }
    let decision = crate::luca::managed_permission::await_local_decision(
        app,
        ManagedPermissionRequestV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: request.session_epoch,
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            acp_request_id: request.operation_fingerprint.as_str().to_owned(),
            title: request.display_summary.clone(),
            tool_call_id: None,
            options: vec![
                ManagedPermissionOptionV1 {
                    option_id: ALLOW_ONCE.into(),
                    name: "Allow once".into(),
                    kind: "allow_once".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: ALLOW_CONVERSATION.into(),
                    name: "Allow for this conversation".into(),
                    kind: "allow_always".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: REJECT.into(),
                    name: "Reject".into(),
                    kind: "reject_once".into(),
                },
            ],
        },
    );
    if !active.load(Ordering::SeqCst) {
        return Ok(false);
    }
    match decision.option_id.as_deref() {
        Some(ALLOW_ONCE) => Ok(true),
        Some(ALLOW_CONVERSATION) => {
            approvals
                .lock()
                .map_err(|_| "repository permission cache is unavailable".to_owned())?
                .insert(cache_key);
            Ok(true)
        }
        Some(REJECT) | None | Some(_) => Ok(false),
    }
}

fn operation_fingerprint(
    operation: RepositoryToolOperationV1,
    source_id: &OpaqueId,
    arguments: &Value,
) -> Result<Sha256Ref, String> {
    let digest = canonical_sha256(&serde_json::json!({
        "domain": "luca.repository.operation.v1",
        "operation": operation,
        "source_id": source_id,
        "arguments": arguments,
    }))
    .map_err(|_| "repository operation fingerprint is invalid".to_owned())?;
    Sha256Ref::parse(format!("sha256:{digest}"))
        .map_err(|_| "repository operation fingerprint is invalid".to_owned())
}

fn receipt(
    request: &RepositoryToolRequestV1,
    status: RepositoryToolReceiptStatusV1,
    changed_path_count: usize,
) -> Result<RepositoryToolReceiptV1, String> {
    let receipt = RepositoryToolReceiptV1 {
        protocol: REPOSITORY_WORK_PROTOCOL.into(),
        receipt_id: opaque_id("repository-receipt")?,
        request_id: request.request_id.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        source_id: request.source_id.clone(),
        operation: request.operation,
        status,
        changed_path_count: SafeU53::new(changed_path_count as u64)
            .map_err(|_| "repository receipt is invalid".to_owned())?,
        created_at: CanonicalTimestamp::parse(
            Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        )
        .map_err(|_| "repository receipt timestamp is invalid".to_owned())?,
    };
    receipt
        .validate()
        .map_err(|_| "repository receipt is invalid".to_owned())?;
    Ok(receipt)
}

fn retain_receipt(state: &crate::app_state::AppState, receipt: RepositoryToolReceiptV1) {
    if let Ok(mut receipts) = state.repository_tool_receipts.lock() {
        receipts.push_back(receipt);
        while receipts.len() > MAX_REPOSITORY_RECEIPTS {
            receipts.pop_front();
        }
    }
}

fn error_response(content: String) -> RepositoryBrokerResponseV1 {
    RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: false,
        content,
        receipt: None,
    }
}

fn random_capability() -> Result<Sha256Ref, String> {
    let mut digest = Sha256::new();
    digest.update(b"luca.repository.master-capability.v1\0");
    digest.update(uuid::Uuid::new_v4().as_bytes());
    digest.update(uuid::Uuid::new_v4().as_bytes());
    Sha256Ref::parse(format!("sha256:{}", hex::encode(digest.finalize())))
        .map_err(|_| "repository broker capability is invalid".to_owned())
}

fn opaque_id(prefix: &str) -> Result<OpaqueId, String> {
    OpaqueId::parse(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()))
        .map_err(|_| "repository broker identifier is invalid".to_owned())
}

#[cfg(test)]
mod tests;

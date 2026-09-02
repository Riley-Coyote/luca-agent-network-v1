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
    canonical_sha256, CanonicalTimestamp, CapabilityKind, CapabilityReceiptStatus,
    CapabilityReceiptV1, CapabilityResourceV1, CapabilityRisk, Hex64, ManagedPermissionRequestV2,
    OpaqueId, RepositoryToolOperationV1, RepositoryToolReceiptStatusV1, RepositoryToolReceiptV1,
    RepositoryToolRequestV1, ResidentAccessLevel, SafeU53, Sha256Ref, CAPABILITY_RECEIPT_PROTOCOL,
    MANAGED_PERMISSION_V2_PROTOCOL, REPOSITORY_WORK_PROTOCOL,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

mod operations;

const BROKER_PROTOCOL: &str = "luca.repository.broker.v1";
const MAX_BROKER_FRAME_BYTES: usize = 768 * 1024;
const MAX_REPOSITORY_RECEIPTS: usize = 256;

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
    let directory = repository_broker_directory();
    fs::create_dir_all(&directory)
        .map_err(|_| "repository broker cache could not be prepared".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "repository broker cache could not be secured".to_owned())?;
    }
    let socket_path = repository_broker_socket_path(&directory, session_epoch.get());
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

fn repository_broker_directory() -> PathBuf {
    static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();
    DIRECTORY
        .get_or_init(|| {
            // Darwin limits Unix-domain socket paths to 103 visible bytes. App
            // cache paths can already exceed that before the unique endpoint
            // name is appended, so keep only the capability-bearing transport
            // in a private, process-owned short directory.
            PathBuf::from("/tmp").join(format!("luca-rb-{}", uuid::Uuid::new_v4().simple()))
        })
        .clone()
}

fn repository_broker_socket_path(directory: &std::path::Path, session_epoch: u64) -> PathBuf {
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    directory.join(format!("e{session_epoch}-{}.sock", &nonce[..16]))
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
    if frame.operation == RepositoryToolOperationV1::OperatorStatus {
        if frame
            .arguments
            .as_object()
            .is_none_or(|arguments| !arguments.is_empty())
        {
            return Err("operator status arguments are invalid".into());
        }
        return operator_status(app, context);
    }
    if frame.operation == RepositoryToolOperationV1::ProposeRuntimeTask {
        return crate::luca::runtime_tasks::propose_runtime_task(
            app,
            context.resident_pubkey.as_str(),
            frame.conversation_id.as_str(),
            frame.arguments,
        )
        .map(|content| RepositoryBrokerResponseV1 {
            protocol: BROKER_PROTOCOL,
            ok: true,
            content,
            receipt: None,
        });
    }
    if frame.operation == RepositoryToolOperationV1::ReadRuntimeTaskResult {
        return crate::luca::runtime_tasks::read_runtime_task_result_for_resident(
            app,
            context.resident_pubkey.as_str(),
            frame.conversation_id.as_str(),
            frame.arguments,
        )
        .map(|content| RepositoryBrokerResponseV1 {
            protocol: BROKER_PROTOCOL,
            ok: true,
            content,
            receipt: None,
        });
    }
    if frame.operation == RepositoryToolOperationV1::List {
        if frame
            .arguments
            .as_object()
            .is_none_or(|arguments| !arguments.is_empty())
        {
            return Err("repositories arguments are invalid".into());
        }
        if crate::luca::resident_capability_authority::effective_access(
            app,
            context.owner_pubkey.as_str(),
            context.resident_pubkey.as_str(),
        )? == ResidentAccessLevel::Restricted
            && !inventory_permission_granted(app, context, &frame.conversation_id)?
        {
            return Ok(RepositoryBrokerResponseV1 {
                protocol: BROKER_PROTOCOL,
                ok: false,
                content: "Repository inventory was not approved.".into(),
                receipt: None,
            });
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

    let access = crate::luca::resident_capability_authority::effective_access(
        app,
        context.owner_pubkey.as_str(),
        context.resident_pubkey.as_str(),
    )?;
    if (frame.operation.requires_permission() || access == ResidentAccessLevel::Restricted)
        && !permission_granted(
            app,
            context.owner_pubkey.as_str(),
            &request,
            approvals,
            active,
        )?
    {
        let receipt = receipt(&request, RepositoryToolReceiptStatusV1::Denied, 0)?;
        retain_receipt(&state, receipt.clone());
        record_capability_receipt(
            app,
            context.owner_pubkey.as_str(),
            &request,
            CapabilityReceiptStatus::Cancelled,
            "The repository operation was denied or cancelled.",
        )?;
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
    record_capability_receipt(
        app,
        context.owner_pubkey.as_str(),
        &request,
        CapabilityReceiptStatus::Approved,
        "The repository operation was approved for execution.",
    )?;
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
            let receipt_persistence = record_capability_receipt(
                app,
                context.owner_pubkey.as_str(),
                &request,
                CapabilityReceiptStatus::Committed,
                "The repository operation completed and was validated.",
            );
            Ok(preserve_terminal_operation_truth(
                RepositoryBrokerResponseV1 {
                    protocol: BROKER_PROTOCOL,
                    ok: true,
                    content: result.content,
                    receipt: Some(receipt),
                },
                receipt_persistence,
                "committed",
            ))
        }
        Err(error) => {
            let receipt = receipt(&request, RepositoryToolReceiptStatusV1::Failed, 0)?;
            retain_receipt(&state, receipt.clone());
            let receipt_persistence = record_capability_receipt(
                app,
                context.owner_pubkey.as_str(),
                &request,
                CapabilityReceiptStatus::Failed,
                "The repository operation failed without a committed success.",
            );
            Ok(preserve_terminal_operation_truth(
                RepositoryBrokerResponseV1 {
                    protocol: BROKER_PROTOCOL,
                    ok: false,
                    content: error,
                    receipt: Some(receipt),
                },
                receipt_persistence,
                "failed",
            ))
        }
    }
}

fn preserve_terminal_operation_truth<T>(
    response: T,
    receipt_persistence: Result<(), String>,
    terminal_status: &'static str,
) -> T {
    if receipt_persistence.is_err() {
        eprintln!(
            "buzz-desktop: capability receipt persistence failed after terminal repository operation ({terminal_status})"
        );
    }
    response
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

fn operator_status(
    app: &AppHandle,
    context: &BrokerContext,
) -> Result<RepositoryBrokerResponseV1, String> {
    let records = crate::managed_agents::load_managed_agents(app)?;
    let record = records
        .iter()
        .find(|record| {
            record
                .pubkey
                .eq_ignore_ascii_case(context.resident_pubkey.as_str())
        })
        .ok_or_else(|| "managed resident is unavailable".to_string())?;
    let personas = crate::managed_agents::load_personas(app)?;
    let legacy_persona_runtime = record.persona_id.as_deref().and_then(|persona_id| {
        personas
            .iter()
            .find(|persona| persona.id == persona_id)
            .and_then(|persona| persona.runtime.as_deref())
    });
    let (family, version, native_binding) = match record.native_runtime_binding.as_ref() {
        Some(crate::managed_agents::RuntimeBinding::Hermes {
            runtime_version, ..
        }) => ("hermes", Some(runtime_version.clone()), true),
        Some(crate::managed_agents::RuntimeBinding::Openclaw {
            runtime_version, ..
        }) => ("openclaw", Some(runtime_version.clone()), true),
        None => (
            current_managed_runtime_family(
                record.runtime.as_deref(),
                record.agent_command_override.as_deref(),
                legacy_persona_runtime,
            ),
            None,
            false,
        ),
    };
    let running = record.runtime_pid.is_some();
    let runtime_state = if record.last_error.is_some() {
        "degraded"
    } else if running {
        "ready"
    } else {
        "stopped"
    };
    let capability_manifest = crate::luca::runtime_capabilities::manifest(family);
    let surface_navigation = capability_manifest
        .as_ref()
        .map(|manifest| manifest.surface_navigation)
        .unwrap_or("unavailable_unknown_runtime");
    let discovery = crate::managed_agents::discover_native_resident_outcome();
    let hermes_candidates = discovery
        .runtimes
        .iter()
        .filter(|runtime| runtime.native_type == crate::managed_agents::NativeRuntimeKind::Hermes)
        .map(|runtime| runtime.candidates.len())
        .sum::<usize>();
    let openclaw_candidates = discovery
        .runtimes
        .iter()
        .filter(|runtime| runtime.native_type == crate::managed_agents::NativeRuntimeKind::Openclaw)
        .map(|runtime| runtime.candidates.len())
        .sum::<usize>();
    let state = app.state::<crate::app_state::AppState>();
    let brain = match state.read_owner_brain_catalog(&context.owner_pubkey) {
        Ok(catalog) => serde_json::json!({
            "state": "ready",
            "sourceCount": catalog.sources.len(),
            "residentGrantCount": catalog.grants.iter().filter(|entry| {
                entry.grant.resident_pubkey == context.resident_pubkey
            }).count(),
        }),
        Err(error) => serde_json::json!({
            "state": error.code(),
            "sourceCount": 0,
            "residentGrantCount": 0,
        }),
    };
    let access = crate::luca::resident_capability_authority::effective_access(
        app,
        context.owner_pubkey.as_str(),
        context.resident_pubkey.as_str(),
    )?;
    let onboarding = crate::luca::resident_capability_authority::onboarding_status(
        app,
        context.owner_pubkey.as_str(),
    )?;
    let capability_receipt_count = crate::luca::resident_capability_authority::receipt_count(
        app,
        context.owner_pubkey.as_str(),
    )?;
    let content = serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "onboarding": {
            "state": onboarding.as_ref().map(|status| if status.completed { "complete" } else { "incomplete" }).unwrap_or("unknown"),
            "chapter": onboarding.as_ref().map(|status| status.chapter.as_str()),
            "resumeAction": "open_onboarding",
        },
        "ownerProfile": { "available": true },
        "runtime": {
            "family": family,
            "version": version,
            "nativeBinding": native_binding,
            "state": runtime_state,
            "running": running,
            "ready": runtime_state == "ready",
            "capabilityManifest": capability_manifest,
            "surfaceNavigation": surface_navigation,
        },
        "nativeAgentCandidates": {
            "hermes": hermes_candidates,
            "openclaw": openclaw_candidates,
        },
        "brain": brain,
        "recoveryBackup": {
            "state": "not_observable",
            "reason": "Polyphonic does not retain exported-backup destinations or passphrases."
        },
        "accessLevel": access,
        "localCapabilityReceiptCount": capability_receipt_count,
        "capabilityCategories": [
            "filesystem_read", "filesystem_write", "process_execute", "network_access",
            "harness_manage", "package_install", "external_communication",
            "destructive_action", "credential_use"
        ],
        "ownerReviewSurfaces": [
            "open_onboarding", "review_native_agents", "create_or_update_agent",
            "review_brain", "open_profile", "open_recovery", "open_access_settings",
            "configure_runtime"
        ],
    }))
    .map_err(|_| "operator status response is invalid".to_string())?;
    Ok(RepositoryBrokerResponseV1 {
        protocol: BROKER_PROTOCOL,
        ok: true,
        content,
        receipt: None,
    })
}

fn current_managed_runtime_family(
    runtime_id: Option<&str>,
    command_override: Option<&str>,
    legacy_persona_runtime: Option<&str>,
) -> &'static str {
    if let Some(command) = command_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return match crate::managed_agents::known_acp_runtime(command).map(|runtime| runtime.id) {
            Some("claude") => "claude_code",
            Some("codex") => "codex",
            _ => "custom",
        };
    }
    let runtime = runtime_id
        .and_then(crate::managed_agents::known_acp_runtime_exact)
        .or_else(|| {
            legacy_persona_runtime.and_then(crate::managed_agents::known_acp_runtime_exact)
        });
    match runtime.map(|runtime| runtime.id) {
        Some("claude") => "claude_code",
        Some("codex") => "codex",
        _ => "custom",
    }
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
    owner_pubkey: &str,
    request: &RepositoryToolRequestV1,
    _approvals: &Arc<Mutex<BTreeSet<String>>>,
    active: &Arc<AtomicBool>,
) -> Result<bool, String> {
    let capability = repository_capability(request.operation);
    let decision = crate::luca::managed_permission::await_capability_decision(
        app,
        owner_pubkey,
        ManagedPermissionRequestV2 {
            protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
            resident_pubkey: request.resident_pubkey.clone(),
            session_epoch: request.session_epoch,
            turn_id: request.turn_id.clone(),
            conversation_id: request.conversation_id.clone(),
            request_id: request.request_id.clone(),
            capability,
            risk: repository_risk(request.operation),
            operation: request.display_summary.clone(),
            operation_fingerprint: request.operation_fingerprint.clone(),
            resource: CapabilityResourceV1 {
                kind: "repository".into(),
                resource_ref: request.source_id.as_str().to_owned(),
                display_name: "Connected repository".into(),
            },
        },
    );
    if !active.load(Ordering::SeqCst) {
        return Ok(false);
    }
    Ok(decision != crate::luca::managed_permission::CapabilityPermissionDecision::Deny)
}

fn repository_capability(operation: RepositoryToolOperationV1) -> CapabilityKind {
    match operation {
        RepositoryToolOperationV1::ApplyPatch => CapabilityKind::FilesystemWrite,
        RepositoryToolOperationV1::Run | RepositoryToolOperationV1::Commit => {
            CapabilityKind::ProcessExecute
        }
        RepositoryToolOperationV1::ProposeRuntimeTask => CapabilityKind::ProcessExecute,
        _ => CapabilityKind::FilesystemRead,
    }
}

fn repository_risk(operation: RepositoryToolOperationV1) -> CapabilityRisk {
    if operation == RepositoryToolOperationV1::Run {
        // The repository runner constrains cwd, environment, and a narrow
        // executable blocklist, but interpreters can still reach outside the
        // repository or the network. Until native containment exists, every
        // exact run is a non-durable, always-confirm operation.
        CapabilityRisk::HighImpact
    } else if operation.requires_permission() {
        CapabilityRisk::Elevated
    } else {
        CapabilityRisk::Routine
    }
}

fn inventory_permission_granted(
    app: &AppHandle,
    context: &BrokerContext,
    conversation_id: &OpaqueId,
) -> Result<bool, String> {
    let fingerprint = Sha256Ref::parse(format!(
        "sha256:{}",
        canonical_sha256(&serde_json::json!({
            "domain": "luca.repository.inventory.v1",
            "resident": context.resident_pubkey,
            "binding": context.binding_ref,
        }))
        .map_err(|_| "repository inventory fingerprint is invalid")?
    ))
    .map_err(|_| "repository inventory fingerprint is invalid".to_owned())?;
    let decision = crate::luca::managed_permission::await_capability_decision(
        app,
        context.owner_pubkey.as_str(),
        ManagedPermissionRequestV2 {
            protocol: MANAGED_PERMISSION_V2_PROTOCOL.into(),
            resident_pubkey: context.resident_pubkey.clone(),
            session_epoch: context.session_epoch,
            turn_id: opaque_id("repository-turn")?,
            conversation_id: conversation_id.clone(),
            request_id: opaque_id("repository-request")?,
            capability: CapabilityKind::FilesystemRead,
            risk: CapabilityRisk::Routine,
            operation: "Inspect connected repositories".into(),
            operation_fingerprint: fingerprint,
            resource: CapabilityResourceV1 {
                kind: "repository_inventory".into(),
                resource_ref: context.owner_pubkey.as_str().to_owned(),
                display_name: "Connected repositories".into(),
            },
        },
    );
    Ok(decision != crate::luca::managed_permission::CapabilityPermissionDecision::Deny)
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

fn record_capability_receipt(
    app: &AppHandle,
    owner_pubkey: &str,
    request: &RepositoryToolRequestV1,
    status: CapabilityReceiptStatus,
    summary: &str,
) -> Result<(), String> {
    crate::luca::resident_capability_authority::record_receipt(
        app,
        owner_pubkey,
        CapabilityReceiptV1 {
            protocol: CAPABILITY_RECEIPT_PROTOCOL.into(),
            receipt_id: opaque_id("capability-receipt")?,
            resident_pubkey: request.resident_pubkey.clone(),
            conversation_id: request.conversation_id.clone(),
            capability: repository_capability(request.operation),
            operation_fingerprint: request.operation_fingerprint.clone(),
            status,
            summary: summary.into(),
        },
    )
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

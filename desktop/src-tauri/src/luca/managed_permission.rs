//! Desktop-owned, local-only approval transport for managed ACP permissions.

use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Mutex, OnceLock},
    time::Duration,
};

use luca_protocol::{
    CapabilityKind, CapabilityRisk, ManagedPermissionDecisionV1, ManagedPermissionDispositionV1,
    ManagedPermissionRequestV1, ManagedPermissionRequestV2, PermissionEffectV1, PermissionRuleV1,
    ResidentAccessLevel, MANAGED_PERMISSION_PROTOCOL, MANAGED_PERMISSION_TIMEOUT_SECS,
    PERMISSION_RULE_PROTOCOL,
};
use tauri::{AppHandle, Emitter};

use super::permission_ledger::{
    self, AllowReason, ManagedPermissionTense, PermissionOfferV1, PermissionSubject, ProjectRef,
    Verdict,
};

const PENDING_EVENT: &str = "managed-permission-pending";
const RESOLVED_EVENT: &str = "managed-permission-resolved";

struct Pending {
    request: ManagedPermissionRequestV1,
    owner_pubkey: String,
    subject: PermissionSubject,
    offer: PermissionOfferV1,
    decision_tx: mpsc::Sender<ResolvedManagedPermission>,
}

struct PendingCapability {
    owner_pubkey: String,
    request: ManagedPermissionRequestV2,
    decision_tx: mpsc::Sender<CapabilityPermissionDecision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapabilityPermissionDecision {
    AllowOnce,
    AlwaysAllow,
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedPermissionResolutionOutcome {
    Approved,
    Rejected,
    Cancelled,
    Expired,
    SessionReplaced,
    ApplicationClosed,
}

#[derive(Debug, Clone)]
struct ResolvedManagedPermission {
    decision: ManagedPermissionDecisionV1,
    outcome: ManagedPermissionResolutionOutcome,
    /// The answer the owner actually pressed, when they pressed one. Absent on
    /// a cancellation and on the legacy path where the card echoed a runtime
    /// option directly.
    tense: Option<ManagedPermissionTense>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedPermissionResolvedEvent {
    pending_id: String,
    outcome: ManagedPermissionResolutionOutcome,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingManagedPermission {
    pub pending_id: String,
    pub request: PendingManagedPermissionRequest,
    /// Which answers this card may offer. Absent on a structured capability
    /// request, which has its own fixed options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer: Option<PermissionOfferV1>,
}

/// Both variants are boxed: a runtime request carries every match field the
/// ledger reads and is far larger than the capability one, and an untagged
/// enum is only ever moved around by the pending event. Boxing keeps the two
/// the same size and serialises identically.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(untagged)]
pub(crate) enum PendingManagedPermissionRequest {
    Runtime(Box<ManagedPermissionRequestV1>),
    Capability(Box<ManagedPermissionRequestV2>),
}

static PENDING: OnceLock<Mutex<HashMap<String, Pending>>> = OnceLock::new();
static CAPABILITY_PENDING: OnceLock<Mutex<HashMap<String, PendingCapability>>> = OnceLock::new();

fn pending() -> &'static Mutex<HashMap<String, Pending>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn capability_pending() -> &'static Mutex<HashMap<String, PendingCapability>> {
    CAPABILITY_PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn pending_id(request: &ManagedPermissionRequestV1) -> String {
    luca_protocol::canonical_sha256(request).unwrap_or_else(|_| uuid::Uuid::new_v4().to_string())
}

fn cancelled(request: &ManagedPermissionRequestV1) -> ManagedPermissionDecisionV1 {
    ManagedPermissionDecisionV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id: request.conversation_id.clone(),
        acp_request_id: request.acp_request_id.clone(),
        disposition: ManagedPermissionDispositionV1::Cancelled,
        option_id: None,
    }
}

fn cancelled_resolution(
    request: &ManagedPermissionRequestV1,
    outcome: ManagedPermissionResolutionOutcome,
) -> ResolvedManagedPermission {
    ResolvedManagedPermission {
        decision: cancelled(request),
        outcome,
        tense: None,
    }
}

/// The runtime's option for one semantic kind.
///
/// The kind is the only thing the desktop may reason about: an option id is the
/// runtime's private token for this one request and is never guessed, cached or
/// carried across requests. Spelling is normalised so an adapter that writes
/// `allowOnce` is understood exactly like one that writes `allow_once`.
fn option_by_kind<'a>(request: &'a ManagedPermissionRequestV1, kind: &str) -> Option<&'a str> {
    let wanted = kind.to_ascii_lowercase().replace('_', "");
    request
        .options
        .iter()
        .find(|option| option.kind.to_ascii_lowercase().replace('_', "") == wanted)
        .map(|option| option.option_id.as_str())
}

fn selected_decision(
    request: &ManagedPermissionRequestV1,
    option_id: Option<String>,
) -> ManagedPermissionDecisionV1 {
    ManagedPermissionDecisionV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id: request.conversation_id.clone(),
        acp_request_id: request.acp_request_id.clone(),
        disposition: if option_id.is_some() {
            ManagedPermissionDispositionV1::Selected
        } else {
            ManagedPermissionDispositionV1::Cancelled
        },
        option_id,
    }
}

/// Turn a verdict the ledger settled on its own into the exact decision the
/// runtime is told. `None` means there is nothing truthful to send — either the
/// verdict is a card, or the runtime advertised no option of the needed kind —
/// and the caller cancels instead of guessing.
fn decide_and_select(
    request: &ManagedPermissionRequestV1,
    verdict: &Verdict,
) -> Option<ManagedPermissionDecisionV1> {
    let kind = match verdict {
        Verdict::Allow(_) => "allow_once",
        Verdict::Deny { .. } => "reject_once",
        Verdict::Ask { .. } => return None,
    };
    let option_id = option_by_kind(request, kind)?.to_owned();
    let decision = selected_decision(request, Some(option_id));
    decision.validate_for(request).ok()?;
    Some(decision)
}

fn selected_outcome(
    request: &ManagedPermissionRequestV1,
    option_id: &str,
) -> ManagedPermissionResolutionOutcome {
    // The option ID remains the only protocol decision. This classification
    // reads the runtime-advertised semantic kind solely for local presentation
    // and never infers authority from its display label.
    if request.options.iter().any(|option| {
        option.option_id == option_id && option.kind.to_ascii_lowercase().starts_with("reject")
    }) {
        ManagedPermissionResolutionOutcome::Rejected
    } else {
        ManagedPermissionResolutionOutcome::Approved
    }
}

/// Child-side descriptor for the anonymous local permission socket.
#[cfg(unix)]
pub(crate) struct ManagedPermissionChildFd(std::os::fd::OwnedFd);

#[cfg(unix)]
impl ManagedPermissionChildFd {
    pub(crate) fn raw_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

/// Create a per-resident local socket and start its desktop-owned blocking server.
#[cfg(unix)]
pub(crate) fn create_endpoint(
    app: AppHandle,
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: luca_protocol::SafeU53,
    working_root: PathBuf,
) -> Result<ManagedPermissionChildFd, String> {
    use std::os::fd::{FromRawFd, IntoRawFd};
    let (desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed permission socketpair: {error}"))?;
    std::thread::Builder::new()
        .name("luca-managed-permission".into())
        .spawn(move || serve(app, desktop, resident_pubkey, session_epoch, working_root))
        .map_err(|error| format!("start managed permission server: {error}"))?;
    // The raw fd is immediately re-owned, avoiding a path/token/env secret.
    let owned = unsafe { std::os::fd::OwnedFd::from_raw_fd(child.into_raw_fd()) };
    Ok(ManagedPermissionChildFd(owned))
}

#[cfg(unix)]
fn serve(
    app: AppHandle,
    stream: std::os::unix::net::UnixStream,
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: luca_protocol::SafeU53,
    working_root: PathBuf,
) {
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        let Ok(read) = reader.read_line(&mut line) else {
            break;
        };
        if read == 0 || line.len() > 64 * 1024 {
            break;
        }
        let Ok(request) = serde_json::from_str::<ManagedPermissionRequestV1>(&line) else {
            break;
        };
        if request.validate().is_err()
            || request.resident_pubkey != resident_pubkey
            || request.session_epoch != session_epoch
        {
            break;
        }
        let decision = await_local_decision(&app, request.clone(), &working_root);
        let Ok(bytes) = serde_json::to_vec(&decision) else {
            break;
        };
        let mut writer = &writer;
        if writer
            .write_all(&bytes)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush())
            .is_err()
        {
            break;
        }
    }
}

/// The noun the room sees. It never names a command, a path or a host: the
/// people in the conversation learn that something was allowed, not what.
fn room_noun(subject: &PermissionSubject) -> &'static str {
    match subject.matchers.first() {
        Some(luca_protocol::PermissionMatcherV1::Command { .. }) => "a command",
        Some(luca_protocol::PermissionMatcherV1::Path { .. }) => "a file",
        Some(luca_protocol::PermissionMatcherV1::Domain { .. }) => "a website",
        _ => "a tool",
    }
}

/// One audited line: what the owner reads, what the room reads, and whether it
/// counts as done or refused.
struct AuditLine {
    text: String,
    room_text: String,
    allowed: bool,
}

fn audit_allowed(subject: &PermissionSubject, text: String) -> AuditLine {
    AuditLine {
        text,
        room_text: format!("Allowed {}", room_noun(subject)),
        allowed: true,
    }
}

fn audit_declined(subject: &PermissionSubject, text: String) -> AuditLine {
    AuditLine {
        text,
        room_text: format!("Declined {}", room_noun(subject)),
        allowed: false,
    }
}

fn automatic_audit_line(subject: &PermissionSubject, verdict: &Verdict) -> Option<AuditLine> {
    let name = subject.display_name.as_str();
    Some(match verdict {
        Verdict::Allow(AllowReason::PreAllowed) => {
            audit_allowed(subject, format!("Allowed on its own: {name}"))
        }
        Verdict::Allow(AllowReason::BrokerGuarded) => {
            audit_allowed(subject, format!("Handled by Polyphonic: {name}"))
        }
        Verdict::Allow(AllowReason::TurnRule) => {
            audit_allowed(subject, format!("Allowed for this task: {name}"))
        }
        Verdict::Allow(AllowReason::Rule { display_name, .. }) => audit_allowed(
            subject,
            match subject.project.as_ref() {
                Some(project) => format!(
                    "Allowed by your rule: {display_name} · Always in {}",
                    project.label()
                ),
                None => format!("Allowed by your rule: {display_name}"),
            },
        ),
        Verdict::Deny { reason } => {
            audit_declined(subject, format!("Declined by your rule: {reason}"))
        }
        Verdict::Ask { .. } => return None,
    })
}

fn answered_audit_line(
    subject: &PermissionSubject,
    outcome: ManagedPermissionResolutionOutcome,
    tense: Option<ManagedPermissionTense>,
) -> AuditLine {
    let name = subject.display_name.as_str();
    match outcome {
        ManagedPermissionResolutionOutcome::Approved => match tense {
            Some(ManagedPermissionTense::Task) => {
                audit_allowed(subject, format!("Allowed for this task: {name}"))
            }
            Some(ManagedPermissionTense::AlwaysHere) => audit_allowed(
                subject,
                match subject.project.as_ref() {
                    Some(project) => {
                        format!(
                            "Allowed by your rule: {name} · Always in {}",
                            project.label()
                        )
                    }
                    None => format!("Allowed by your rule: {name}"),
                },
            ),
            _ => audit_allowed(subject, format!("You allowed once: {name}")),
        },
        ManagedPermissionResolutionOutcome::Rejected => {
            audit_declined(subject, format!("You said no: {name}"))
        }
        ManagedPermissionResolutionOutcome::Expired => AuditLine {
            text: "No answer in time".into(),
            room_text: "No answer in time".into(),
            allowed: false,
        },
        ManagedPermissionResolutionOutcome::SessionReplaced => AuditLine {
            text: "Closed when the resident restarted".into(),
            room_text: "Closed when the resident restarted".into(),
            allowed: false,
        },
        ManagedPermissionResolutionOutcome::Cancelled
        | ManagedPermissionResolutionOutcome::ApplicationClosed => AuditLine {
            text: "Closed with Polyphonic".into(),
            room_text: "Closed with Polyphonic".into(),
            allowed: false,
        },
    }
}

fn audit(app: &AppHandle, request: &ManagedPermissionRequestV1, line: AuditLine) {
    let Ok(scope) = super::activity_trace::host_scope(app) else {
        return;
    };
    super::activity_trace::record_permission(
        app,
        &scope,
        request.resident_pubkey.as_str(),
        request.conversation_id.as_str(),
        request
            .dispatch_receipt_id
            .as_ref()
            .map(luca_protocol::OpaqueId::as_str),
        request.turn_id.as_str(),
        &line.text,
        &line.room_text,
        line.allowed,
    );
}

/// Present one desktop-owned permission request, after asking the ledger
/// whether it needs presenting at all.
///
/// The caller supplies only display-safe metadata and receives one exact,
/// request-bound decision; no capability or payload enters the event. A request
/// the ledger can answer never reaches the renderer: no pending event, no
/// resolution event, one audited line.
pub(crate) fn await_local_decision(
    app: &AppHandle,
    request: ManagedPermissionRequestV1,
    working_root: &Path,
) -> ManagedPermissionDecisionV1 {
    if request.validate().is_err() {
        return cancelled(&request);
    }
    // Without an active owner there is no ledger to consult and no authority to
    // answer on their behalf. Fail closed rather than guess.
    let owner = {
        use tauri::Manager;
        let state = app.state::<crate::app_state::AppState>();
        match super::conversation_context::active_scope(&state) {
            Ok((owner, _)) => owner,
            Err(_) => return cancelled(&request),
        }
    };
    let subject = permission_ledger::subject(app, &owner, &request, working_root);
    let verdict = permission_ledger::decide(app, owner.as_str(), &request, &subject);
    if !matches!(verdict, Verdict::Ask { .. }) {
        let settled = decide_and_select(&request, &verdict);
        if let (Some(decision), Some(line)) = (settled, automatic_audit_line(&subject, &verdict)) {
            audit(app, &request, line);
            return decision;
        }
        // The runtime advertised no option of the kind this verdict needs.
        return cancelled(&request);
    }
    let Verdict::Ask { offer } = verdict else {
        return cancelled(&request);
    };

    let id = pending_id(&request);
    let (tx, rx) = mpsc::channel();
    let inserted = pending().lock().ok().and_then(|mut entries| {
        if entries.contains_key(&id) {
            None
        } else {
            entries.insert(
                id.clone(),
                Pending {
                    request: request.clone(),
                    owner_pubkey: owner.as_str().to_owned(),
                    subject: subject.clone(),
                    offer: offer.clone(),
                    decision_tx: tx,
                },
            );
            Some(())
        }
    });
    let decision = if inserted.is_some() {
        let _ = app.emit(
            PENDING_EVENT,
            PendingManagedPermission {
                pending_id: id.clone(),
                request: PendingManagedPermissionRequest::Runtime(Box::new(request.clone())),
                offer: Some(offer),
            },
        );
        match rx.recv_timeout(Duration::from_secs(MANAGED_PERMISSION_TIMEOUT_SECS)) {
            Ok(resolution) => resolution,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Expired)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Cancelled)
            }
        }
    } else {
        cancelled_resolution(&request, ManagedPermissionResolutionOutcome::Cancelled)
    };
    if let Ok(mut entries) = pending().lock() {
        entries.remove(&id);
    }
    audit(
        app,
        &request,
        answered_audit_line(&subject, decision.outcome, decision.tense),
    );
    let _ = app.emit(
        RESOLVED_EVENT,
        ManagedPermissionResolvedEvent {
            pending_id: id,
            outcome: decision.outcome,
        },
    );
    decision.decision
}

pub(crate) fn list_pending() -> Result<Vec<PendingManagedPermission>, String> {
    let entries = pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?;
    let mut result = entries
        .iter()
        .map(|(id, pending)| PendingManagedPermission {
            pending_id: id.clone(),
            request: PendingManagedPermissionRequest::Runtime(Box::new(pending.request.clone())),
            offer: Some(pending.offer.clone()),
        })
        .collect::<Vec<_>>();
    drop(entries);
    let capability_entries = capability_pending()
        .lock()
        .map_err(|_| "capability permission registry unavailable".to_string())?;
    result.extend(
        capability_entries
            .iter()
            .map(|(id, pending)| PendingManagedPermission {
                pending_id: id.clone(),
                request: PendingManagedPermissionRequest::Capability(Box::new(
                    pending.request.clone(),
                )),
                offer: None,
            }),
    );
    Ok(result)
}

/// Whether the offer on this card actually contains the answer the owner sent.
/// A renderer that asks for an answer the card never offered is refused rather
/// than obeyed.
fn offer_allows(offer: &PermissionOfferV1, tense: ManagedPermissionTense) -> bool {
    match tense {
        ManagedPermissionTense::Once => offer.once,
        ManagedPermissionTense::Task => offer.task,
        ManagedPermissionTense::AlwaysHere => offer.always_here,
        ManagedPermissionTense::Deny => offer.deny,
    }
}

/// Mint the durable rules for an "Always here" answer: one per thing the
/// request asks for, so a compound command is remembered a segment at a time
/// and the permissions list shows each on its own line.
///
/// All of them or none: a line the owner said yes to must never end up half
/// remembered, so a single matcher that will not mint refuses the lot.
fn rules_for(subject: &PermissionSubject) -> Option<Vec<PermissionRuleV1>> {
    let source_id = subject.project.as_ref().map(ProjectRef::scope_id)?.clone();
    if subject.matchers.is_empty() {
        return None;
    }
    let mut rules = Vec::with_capacity(subject.matchers.len());
    for (matcher, display_name) in subject.asks() {
        let rule = PermissionRuleV1 {
            protocol: PERMISSION_RULE_PROTOCOL.into(),
            rule_id: luca_protocol::OpaqueId::parse(uuid::Uuid::new_v4().to_string()).ok()?,
            resident_pubkey: subject.resident.clone(),
            scope: luca_protocol::PermissionRuleScopeV1::Project {
                source_id: source_id.clone(),
            },
            matcher: matcher.clone(),
            effect: PermissionEffectV1::Allow,
            display_name: permission_ledger::rule_display_name(subject, matcher, display_name),
            created_at: chrono::Utc::now().to_rfc3339(),
            revoked_at: None,
            last_used_at: None,
            use_count: 0,
        };
        rule.validate().ok()?;
        rules.push(rule);
    }
    Some(rules)
}

pub(crate) fn resolve(
    pending_id: &str,
    option_id: Option<String>,
    tense: Option<ManagedPermissionTense>,
) -> Result<(), String> {
    resolve_runtime(None, pending_id, option_id, tense)
}

/// Resolve one pending runtime card.
///
/// `tense` is the beta.11 card's answer and decides everything; `option_id` is
/// the legacy path where the card echoed one of the runtime's own options. When
/// a tense is given the option is chosen BY KIND, never by id.
///
/// Remembering "Always here" needs the owner's authority, so it is only
/// possible with an `AppHandle`. Without one the answer degrades to allowing
/// this request alone, which is strictly narrower.
fn resolve_runtime(
    app: Option<&AppHandle>,
    pending_id: &str,
    option_id: Option<String>,
    tense: Option<ManagedPermissionTense>,
) -> Result<(), String> {
    let mut entries = pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?;
    let pending = entries.get(pending_id).ok_or_else(|| {
        "managed permission request is unknown, expired, or already resolved".to_string()
    })?;
    let (option_id, outcome) = match tense {
        Some(tense) => {
            if !offer_allows(&pending.offer, tense) {
                return Err("this permission cannot be answered that way".into());
            }
            let chosen = answer_option(app, pending, tense);
            let outcome = match tense {
                ManagedPermissionTense::Deny => ManagedPermissionResolutionOutcome::Rejected,
                _ => ManagedPermissionResolutionOutcome::Approved,
            };
            match chosen {
                Some(option_id) => (Some(option_id), outcome),
                // The runtime advertised nothing that means this answer. Say
                // nothing rather than something else.
                None => (None, ManagedPermissionResolutionOutcome::Cancelled),
            }
        }
        None => {
            let outcome = option_id
                .as_deref()
                .map_or(ManagedPermissionResolutionOutcome::Cancelled, |option_id| {
                    selected_outcome(&pending.request, option_id)
                });
            (option_id, outcome)
        }
    };
    let decision = selected_decision(&pending.request, option_id);
    decision
        .validate_for(&pending.request)
        .map_err(|error| error.to_string())?;
    let pending = entries
        .remove(pending_id)
        .ok_or_else(|| "managed permission request disappeared".to_string())?;
    pending
        .decision_tx
        .send(ResolvedManagedPermission {
            decision,
            outcome,
            tense,
        })
        .map_err(|_| "managed permission request is no longer waiting".to_string())
}

/// Apply one answer's memory and return the runtime option that carries it.
fn answer_option(
    app: Option<&AppHandle>,
    pending: &Pending,
    tense: ManagedPermissionTense,
) -> Option<String> {
    match tense {
        ManagedPermissionTense::Deny => {
            return option_by_kind(&pending.request, "reject_once").map(str::to_owned)
        }
        ManagedPermissionTense::Once => {}
        ManagedPermissionTense::Task => {
            for matcher in &pending.subject.matchers {
                permission_ledger::remember_for_turn(
                    pending.request.resident_pubkey.as_str(),
                    pending.request.session_epoch.get(),
                    pending.request.turn_id.as_str(),
                    matcher.clone(),
                );
            }
        }
        ManagedPermissionTense::AlwaysHere => {
            let remembered = app.and_then(|app| {
                let rules = rules_for(&pending.subject)?;
                // Every segment or none: a half-remembered line would allow
                // the part the owner saw and keep asking about the rest.
                for rule in rules {
                    super::resident_capability_authority::upsert_rule(
                        app,
                        &pending.owner_pubkey,
                        rule,
                    )
                    .ok()?;
                }
                Some(())
            });
            // Only once the answer is durably ours may the runtime be told to
            // stop asking inside its own session.
            if remembered.is_some() {
                if let Some(app) = app {
                    let family = super::permission_tier::resident_runtime_family(
                        app,
                        pending.request.resident_pubkey.as_str(),
                    );
                    if super::runtime_capabilities::forwards_native_always(family) {
                        if let Some(option_id) = option_by_kind(&pending.request, "allow_always") {
                            return Some(option_id.to_owned());
                        }
                    }
                }
            }
        }
    }
    option_by_kind(&pending.request, "allow_once").map(str::to_owned)
}

fn must_confirm_every_time(capability: CapabilityKind, risk: CapabilityRisk) -> bool {
    risk == CapabilityRisk::HighImpact
        || matches!(
            capability,
            CapabilityKind::ExternalCommunication
                | CapabilityKind::DestructiveAction
                | CapabilityKind::CredentialUse
        )
}

fn durable_grant_allowed(capability: CapabilityKind, risk: CapabilityRisk) -> bool {
    !must_confirm_every_time(capability, risk)
}

pub(crate) fn resolve_with_app(
    app: &AppHandle,
    pending_id: &str,
    option_id: Option<String>,
    tense: Option<ManagedPermissionTense>,
) -> Result<(), String> {
    if pending()
        .lock()
        .map_err(|_| "managed permission registry unavailable".to_string())?
        .contains_key(pending_id)
    {
        // Only "Always here" needs the owner's authority, to write the rule.
        // Every other answer is settled entirely inside this process.
        return if matches!(tense, Some(ManagedPermissionTense::AlwaysHere)) {
            resolve_runtime(Some(app), pending_id, option_id, tense)
        } else {
            resolve(pending_id, option_id, tense)
        };
    }
    let mut entries = capability_pending()
        .lock()
        .map_err(|_| "capability permission registry unavailable".to_string())?;
    let pending = entries.remove(pending_id).ok_or_else(|| {
        "managed permission request is unknown, expired, or already resolved".to_string()
    })?;
    // A structured capability request keeps its own two option ids. The card's
    // tense is translated onto them so one renderer can drive both surfaces.
    let option_id = option_id.or_else(|| {
        tense.map(|tense| {
            match tense {
                ManagedPermissionTense::Once | ManagedPermissionTense::Task => "allow_once",
                ManagedPermissionTense::AlwaysHere => "always_allow",
                ManagedPermissionTense::Deny => "deny",
            }
            .to_owned()
        })
    });
    let decision = match option_id.as_deref() {
        Some("allow_once") => CapabilityPermissionDecision::AllowOnce,
        Some("always_allow")
            if durable_grant_allowed(pending.request.capability, pending.request.risk) =>
        {
            super::resident_capability_authority::grant(
                app,
                &pending.owner_pubkey,
                pending.request.resident_pubkey.as_str(),
                pending.request.capability,
                pending.request.resource.clone(),
            )?;
            CapabilityPermissionDecision::AlwaysAllow
        }
        _ => CapabilityPermissionDecision::Deny,
    };
    let outcome = if decision == CapabilityPermissionDecision::Deny {
        ManagedPermissionResolutionOutcome::Rejected
    } else {
        ManagedPermissionResolutionOutcome::Approved
    };
    pending
        .decision_tx
        .send(decision)
        .map_err(|_| "capability permission request is no longer waiting".to_string())?;
    let _ = app.emit(
        RESOLVED_EVENT,
        ManagedPermissionResolvedEvent {
            pending_id: pending_id.to_owned(),
            outcome,
        },
    );
    Ok(())
}

/// Resolve one structured operator permission against resident policy, an
/// exact durable grant, or the existing inline conversation UI.
pub(crate) fn await_capability_decision(
    app: &AppHandle,
    owner_pubkey: &str,
    request: ManagedPermissionRequestV2,
) -> CapabilityPermissionDecision {
    if request.validate().is_err() {
        return CapabilityPermissionDecision::Deny;
    }
    let level = super::resident_capability_authority::effective_access(
        app,
        owner_pubkey,
        request.resident_pubkey.as_str(),
    )
    .unwrap_or(ResidentAccessLevel::Restricted);
    if durable_grant_allowed(request.capability, request.risk)
        && super::resident_capability_authority::is_granted(
            app,
            owner_pubkey,
            request.resident_pubkey.as_str(),
            request.capability,
            &request.resource.kind,
            &request.resource.resource_ref,
        )
        .unwrap_or(false)
    {
        return CapabilityPermissionDecision::AlwaysAllow;
    }
    if level == ResidentAccessLevel::Full
        && !must_confirm_every_time(request.capability, request.risk)
    {
        return CapabilityPermissionDecision::AllowOnce;
    }
    let id = luca_protocol::canonical_sha256(&request)
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
    let (tx, rx) = mpsc::channel();
    let inserted = capability_pending().lock().ok().and_then(|mut entries| {
        if entries.contains_key(&id) {
            None
        } else {
            entries.insert(
                id.clone(),
                PendingCapability {
                    owner_pubkey: owner_pubkey.to_owned(),
                    request: request.clone(),
                    decision_tx: tx,
                },
            );
            Some(())
        }
    });
    if inserted.is_none() {
        return CapabilityPermissionDecision::Deny;
    }
    let _ = app.emit(
        PENDING_EVENT,
        PendingManagedPermission {
            pending_id: id.clone(),
            request: PendingManagedPermissionRequest::Capability(Box::new(request)),
            offer: None,
        },
    );
    let decision = rx
        .recv_timeout(Duration::from_secs(MANAGED_PERMISSION_TIMEOUT_SECS))
        .unwrap_or(CapabilityPermissionDecision::Deny);
    if let Ok(mut entries) = capability_pending().lock() {
        entries.remove(&id);
    }
    decision
}

pub(crate) fn cancel_all() {
    permission_ledger::clear_all();
    if let Ok(mut entries) = pending().lock() {
        for (_, pending) in entries.drain() {
            let _ = pending.decision_tx.send(cancelled_resolution(
                &pending.request,
                ManagedPermissionResolutionOutcome::ApplicationClosed,
            ));
        }
    }
    if let Ok(mut entries) = capability_pending().lock() {
        for (_, pending) in entries.drain() {
            let _ = pending.decision_tx.send(CapabilityPermissionDecision::Deny);
        }
    }
}

/// Cancel pending prompts owned by an ACP session that exited or was replaced.
pub(crate) fn cancel_resident_session(resident_pubkey: &str, session_epoch: u64) {
    permission_ledger::clear_session(resident_pubkey, session_epoch);
    if let Ok(mut entries) = pending().lock() {
        let doomed: Vec<String> = entries
            .iter()
            .filter(|(_, pending)| {
                pending.request.resident_pubkey.as_str() == resident_pubkey
                    && pending.request.session_epoch.get() == session_epoch
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in doomed {
            if let Some(pending) = entries.remove(&id) {
                let _ = pending.decision_tx.send(cancelled_resolution(
                    &pending.request,
                    ManagedPermissionResolutionOutcome::SessionReplaced,
                ));
            }
        }
    }
    if let Ok(mut entries) = capability_pending().lock() {
        let doomed = entries
            .iter()
            .filter(|(_, pending)| {
                pending.request.resident_pubkey.as_str() == resident_pubkey
                    && pending.request.session_epoch.get() == session_epoch
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in doomed {
            if let Some(pending) = entries.remove(&id) {
                let _ = pending.decision_tx.send(CapabilityPermissionDecision::Deny);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use luca_protocol::{
        Hex64, ManagedPermissionOptionV1, OpaqueId, SafeU53, MANAGED_PERMISSION_PROTOCOL,
    };
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize)]
    struct ContinuityAbsentFixture {
        schema: String,
        fixture_class: String,
        proof_scope: String,
        semantic_fixtures: Vec<SemanticFixture>,
    }

    #[derive(Debug, Deserialize)]
    struct SemanticFixture {
        binding: String,
    }

    fn fixture() -> ContinuityAbsentFixture {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/luca-conformance/f10/continuity_absent.json"
        )))
        .expect("F10 fixture must be valid JSON")
    }

    #[test]
    fn full_access_still_confirms_high_impact_operations() {
        assert!(!must_confirm_every_time(
            CapabilityKind::FilesystemWrite,
            CapabilityRisk::Elevated
        ));
        assert!(must_confirm_every_time(
            CapabilityKind::DestructiveAction,
            CapabilityRisk::Routine
        ));
        assert!(must_confirm_every_time(
            CapabilityKind::ExternalCommunication,
            CapabilityRisk::Routine
        ));
        assert!(must_confirm_every_time(
            CapabilityKind::ProcessExecute,
            CapabilityRisk::HighImpact
        ));
    }

    #[test]
    fn high_impact_permissions_can_never_be_durable() {
        assert!(!durable_grant_allowed(
            CapabilityKind::CredentialUse,
            CapabilityRisk::Routine
        ));
        assert!(!durable_grant_allowed(
            CapabilityKind::FilesystemWrite,
            CapabilityRisk::HighImpact
        ));
        assert!(durable_grant_allowed(
            CapabilityKind::FilesystemWrite,
            CapabilityRisk::Elevated
        ));
    }

    fn request(acp_request_id: &str, session_epoch: u64) -> ManagedPermissionRequestV1 {
        ManagedPermissionRequestV1 {
            protocol: MANAGED_PERMISSION_PROTOCOL.into(),
            resident_pubkey: Hex64::parse("1".repeat(64)).expect("synthetic resident"),
            session_epoch: SafeU53::new(session_epoch).expect("synthetic epoch"),
            turn_id: OpaqueId::parse(format!("turn-{acp_request_id}")).expect("synthetic turn"),
            conversation_id: OpaqueId::parse("conversation-f10").expect("synthetic conversation"),
            acp_request_id: acp_request_id.into(),
            title: "Synthetic managed permission".into(),
            tool_call_id: None,
            action_preview: None,
            options: vec![
                ManagedPermissionOptionV1 {
                    option_id: "runtime-allow".into(),
                    name: "Allow".into(),
                    kind: "allow_once".into(),
                },
                ManagedPermissionOptionV1 {
                    option_id: "runtime-reject".into(),
                    name: "Reject".into(),
                    kind: "reject_once".into(),
                },
            ],
            dispatch_receipt_id: None,
            tool_kind: None,
            activity_kind: None,
            tool_name: None,
            mcp_server: None,
            mcp_tool: None,
            command_token: None,
            command_argv_prefix: Vec::new(),
            command_segments: Vec::new(),
            path: None,
            domain: None,
            write: None,
        }
    }

    fn test_subject(request: &ManagedPermissionRequestV1) -> PermissionSubject {
        PermissionSubject {
            resident: request.resident_pubkey.clone(),
            project: Some(ProjectRef::Source {
                source_id: OpaqueId::parse("source-a").expect("synthetic source"),
                canonical_root: std::path::PathBuf::from("/tmp/luca"),
                label: "Luca".into(),
            }),
            matchers: vec![luca_protocol::PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix: vec!["status".into()],
            }],
            matcher_names: vec!["git status".into()],
            is_door: false,
            is_pre_allowed: false,
            is_broker_guarded: false,
            inside_project: true,
            display_name: "git status".into(),
        }
    }

    fn full_offer() -> PermissionOfferV1 {
        PermissionOfferV1 {
            once: true,
            task: true,
            always_here: true,
            deny: true,
            project_label: Some("Luca".into()),
            remembers: vec!["git status".into()],
            note: None,
        }
    }

    fn insert_pending(
        request: ManagedPermissionRequestV1,
    ) -> (String, mpsc::Receiver<ResolvedManagedPermission>) {
        insert_pending_with(request, full_offer())
    }

    fn insert_pending_with(
        request: ManagedPermissionRequestV1,
        offer: PermissionOfferV1,
    ) -> (String, mpsc::Receiver<ResolvedManagedPermission>) {
        let subject = test_subject(&request);
        insert_pending_with_subject(request, offer, subject)
    }

    fn insert_pending_with_subject(
        request: ManagedPermissionRequestV1,
        offer: PermissionOfferV1,
        subject: PermissionSubject,
    ) -> (String, mpsc::Receiver<ResolvedManagedPermission>) {
        let id = pending_id(&request);
        let (tx, rx) = mpsc::channel();
        pending().lock().expect("pending registry").insert(
            id.clone(),
            Pending {
                request,
                owner_pubkey: "aa".repeat(32),
                subject,
                offer,
                decision_tx: tx,
            },
        );
        (id, rx)
    }

    #[test]
    fn f10_continuity_absence_keeps_managed_permission_selection_and_cancellation_independent() {
        let fixture = fixture();
        assert_eq!(fixture.schema, "luca.f10.continuity-absent.v2");
        assert_eq!(fixture.fixture_class, "generated_synthetic");
        assert_eq!(
            fixture.proof_scope,
            "synthetic_bindings_not_native_runtime_proof"
        );
        let bindings = fixture
            .semantic_fixtures
            .iter()
            .map(|semantic| semantic.binding.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            bindings,
            std::collections::BTreeSet::from(["hermes", "openclaw"])
        );

        let _guard = permission_ledger::test_global_state_guard();
        cancel_all();
        let allow_request = request("allow", 7);
        let (allow_id, allow_rx) = insert_pending(allow_request.clone());
        resolve(&allow_id, Some("runtime-allow".into()), None).expect("advertised allow resolves");
        let allow = allow_rx.recv().expect("allow decision delivered");
        assert_eq!(allow.outcome, ManagedPermissionResolutionOutcome::Approved);
        assert_eq!(
            allow.decision.disposition,
            ManagedPermissionDispositionV1::Selected
        );
        assert_eq!(allow.decision.option_id.as_deref(), Some("runtime-allow"));
        allow
            .decision
            .validate_for(&allow_request)
            .expect("allow binds exact request");
        assert!(
            resolve(&allow_id, Some("runtime-allow".into()), None).is_err(),
            "resolved ID is stale"
        );

        let reject_request = request("reject", 7);
        let (reject_id, reject_rx) = insert_pending(reject_request.clone());
        resolve(&reject_id, Some("runtime-reject".into()), None)
            .expect("advertised reject resolves");
        let reject = reject_rx.recv().expect("reject decision delivered");
        assert_eq!(reject.outcome, ManagedPermissionResolutionOutcome::Rejected);
        assert_eq!(
            reject.decision.disposition,
            ManagedPermissionDispositionV1::Selected
        );
        assert_eq!(reject.decision.option_id.as_deref(), Some("runtime-reject"));
        reject
            .decision
            .validate_for(&reject_request)
            .expect("reject binds exact request");

        let cancel_request = request("cancel", 7);
        let (cancel_id, cancel_rx) = insert_pending(cancel_request.clone());
        resolve(&cancel_id, None, None).expect("explicit cancellation resolves");
        let cancellation = cancel_rx.recv().expect("cancellation delivered");
        assert_eq!(
            cancellation.outcome,
            ManagedPermissionResolutionOutcome::Cancelled
        );
        assert_eq!(
            cancellation.decision.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        cancellation
            .decision
            .validate_for(&cancel_request)
            .expect("cancellation binds exact request");

        let session_request = request("session", 7);
        let resident = session_request.resident_pubkey.as_str().to_owned();
        let (session_id, session_rx) = insert_pending(session_request.clone());
        cancel_resident_session(&resident, 8);
        assert!(
            session_rx.try_recv().is_err(),
            "wrong epoch cannot cancel pending request"
        );
        assert!(list_pending()
            .expect("pending list")
            .iter()
            .any(|entry| entry.pending_id == session_id));
        cancel_resident_session(&resident, 7);
        let session_cancellation = session_rx.recv().expect("matching epoch cancels");
        assert_eq!(
            session_cancellation.outcome,
            ManagedPermissionResolutionOutcome::SessionReplaced
        );
        assert_eq!(
            session_cancellation.decision.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        session_cancellation
            .decision
            .validate_for(&session_request)
            .expect("session cancellation binds request");
        assert!(
            resolve(&session_id, None, None).is_err(),
            "cancelled ID is stale or unknown"
        );
        assert!(list_pending().expect("pending list").is_empty());

        let close_request = request("close", 8);
        let (_close_id, close_rx) = insert_pending(close_request.clone());
        cancel_all();
        let application_closed = close_rx.recv().expect("application close resolves");
        assert_eq!(
            application_closed.outcome,
            ManagedPermissionResolutionOutcome::ApplicationClosed
        );
        application_closed
            .decision
            .validate_for(&close_request)
            .expect("application close cancellation binds request");

        assert_eq!(
            cancelled_resolution(
                &request("expired", 9),
                ManagedPermissionResolutionOutcome::Expired,
            )
            .outcome,
            ManagedPermissionResolutionOutcome::Expired
        );
        let safe_event = serde_json::to_value(ManagedPermissionResolvedEvent {
            pending_id: "safe-id".into(),
            outcome: ManagedPermissionResolutionOutcome::Rejected,
        })
        .expect("serialize safe resolution event");
        assert_eq!(
            safe_event,
            serde_json::json!({"pendingId": "safe-id", "outcome": "rejected"})
        );
        assert_eq!(
            safe_event
                .as_object()
                .expect("safe resolution object")
                .len(),
            2,
            "resolution events never expose permission request metadata"
        );
        // This test reaches only the private desktop registry and local decisions;
        // it neither creates a relay event nor calls publication/signing authority.
    }

    /// A request the ledger settles is answered straight to the runtime: it
    /// never enters the pending registry, so no card and no pending event can
    /// exist for it.
    #[test]
    fn auto_allowed_requests_never_enter_pending_or_emit_pending_event() {
        let _guard = permission_ledger::test_global_state_guard();
        let request = request("auto", 11);
        let allowed = decide_and_select(&request, &Verdict::Allow(AllowReason::PreAllowed))
            .expect("an advertised allow_once carries the verdict");
        assert_eq!(allowed.option_id.as_deref(), Some("runtime-allow"));
        assert_eq!(
            allowed.disposition,
            ManagedPermissionDispositionV1::Selected
        );
        allowed
            .validate_for(&request)
            .expect("the automatic decision binds the exact request");

        let denied = decide_and_select(
            &request,
            &Verdict::Deny {
                reason: "Remembered answer".into(),
            },
        )
        .expect("an advertised reject_once carries the verdict");
        assert_eq!(denied.option_id.as_deref(), Some("runtime-reject"));

        // A card is never settled here.
        assert!(decide_and_select(
            &request,
            &Verdict::Ask {
                offer: full_offer()
            }
        )
        .is_none());

        // A runtime that advertises no matching kind is cancelled, never
        // answered with some other option.
        let mut bare = request.clone();
        bare.options.retain(|option| option.kind != "allow_once");
        assert!(decide_and_select(&bare, &Verdict::Allow(AllowReason::TurnRule)).is_none());

        // The option is chosen by kind, whatever the id happens to be.
        let mut renamed = request.clone();
        renamed.options[0].option_id = "opt-93f2".into();
        assert_eq!(
            decide_and_select(&renamed, &Verdict::Allow(AllowReason::PreAllowed))
                .and_then(|decision| decision.option_id)
                .as_deref(),
            Some("opt-93f2")
        );

        // And nothing above ever touched the pending registry.
        assert!(list_pending()
            .expect("pending list")
            .iter()
            .all(|entry| entry.pending_id != pending_id(&request)));
    }

    /// The subject for `ls -la /x; echo "exit=$?"` — two segments, one card.
    fn compound_subject(request: &ManagedPermissionRequestV1) -> PermissionSubject {
        let mut subject = test_subject(request);
        subject.matchers = vec![
            luca_protocol::PermissionMatcherV1::Command {
                token: "ls".into(),
                argv_prefix: Vec::new(),
            },
            luca_protocol::PermissionMatcherV1::Command {
                token: "echo".into(),
                argv_prefix: Vec::new(),
            },
        ];
        subject.matcher_names = vec!["ls".into(), "echo".into()];
        subject.display_name = "ls and echo".into();
        subject
    }

    #[test]
    fn always_here_saves_one_rule_per_segment() {
        let request = request("compound", 20);
        let subject = compound_subject(&request);
        let rules = rules_for(&subject).expect("a rule per segment");

        assert_eq!(rules.len(), 2);
        assert_eq!(
            rules
                .iter()
                .map(|rule| rule.display_name.clone())
                .collect::<Vec<_>>(),
            vec!["Run ls in Luca", "Run echo in Luca"]
        );
        assert_eq!(
            rules
                .iter()
                .map(|rule| rule.matcher.clone())
                .collect::<Vec<_>>(),
            subject.matchers
        );
        for rule in &rules {
            assert_eq!(rule.validate(), Ok(()));
            assert_eq!(rule.effect, PermissionEffectV1::Allow);
            assert_eq!(rule.resident_pubkey, subject.resident);
            assert!(matches!(
                rule.scope,
                luca_protocol::PermissionRuleScopeV1::Project { .. }
            ));
        }
        // Each rule is its own row in the permissions list, revocable alone.
        assert_ne!(rules[0].rule_id, rules[1].rule_id);

        // A single segment still mints exactly the one rule it always did.
        let single = rules_for(&test_subject(&request)).expect("one rule");
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].display_name, "Run git status in Luca");

        // With no project there is no "here", so nothing is written at all.
        let mut nowhere = compound_subject(&request);
        nowhere.project = None;
        assert!(rules_for(&nowhere).is_none());

        // Nothing to remember writes nothing.
        let mut bare = compound_subject(&request);
        bare.matchers.clear();
        bare.matcher_names.clear();
        assert!(rules_for(&bare).is_none());
    }

    #[test]
    fn task_remembers_every_segment_for_the_turn() {
        let _guard = permission_ledger::test_global_state_guard();
        cancel_all();
        let task_request = request("compound-task", 21);
        let resident = task_request.resident_pubkey.as_str().to_owned();
        let turn = task_request.turn_id.as_str().to_owned();
        let subject = compound_subject(&task_request);
        let expected = subject.matchers.clone();
        let (id, rx) = insert_pending_with_subject(task_request, full_offer(), subject);

        resolve(&id, None, Some(ManagedPermissionTense::Task)).expect("task resolves");
        assert_eq!(
            rx.recv().expect("decision").decision.option_id.as_deref(),
            Some("runtime-allow")
        );
        assert_eq!(
            permission_ledger::turn_hits(&resident, 21, &turn),
            expected,
            "a compound line is remembered a segment at a time"
        );
        permission_ledger::end_turn(&resident, 21, &turn);
    }

    #[test]
    fn tense_always_here_selects_allow_always_only_when_advertised() {
        let _guard = permission_ledger::test_global_state_guard();
        cancel_all();
        // Without an AppHandle the answer cannot be remembered durably, so it
        // degrades to allowing this one request — never to a native "always".
        let mut advertised = request("always-unremembered", 12);
        advertised.options.push(ManagedPermissionOptionV1 {
            option_id: "runtime-always".into(),
            name: "Always".into(),
            kind: "allow_always".into(),
        });
        let (id, rx) = insert_pending(advertised);
        resolve(&id, None, Some(ManagedPermissionTense::AlwaysHere)).expect("always here resolves");
        let resolution = rx.recv().expect("decision delivered");
        assert_eq!(
            resolution.decision.option_id.as_deref(),
            Some("runtime-allow"),
            "a rule that was not written cannot forward a native always"
        );
        assert_eq!(
            resolution.outcome,
            ManagedPermissionResolutionOutcome::Approved
        );
        assert_eq!(resolution.tense, Some(ManagedPermissionTense::AlwaysHere));

        // A runtime that advertises no always at all still answers once.
        let (id, rx) = insert_pending(request("always-unadvertised", 12));
        resolve(&id, None, Some(ManagedPermissionTense::AlwaysHere)).expect("always here resolves");
        assert_eq!(
            rx.recv().expect("decision").decision.option_id.as_deref(),
            Some("runtime-allow")
        );

        // "For this task" remembers the matcher for exactly this turn.
        let task_request = request("task", 12);
        let resident = task_request.resident_pubkey.as_str().to_owned();
        let turn = task_request.turn_id.as_str().to_owned();
        let (id, rx) = insert_pending(task_request);
        resolve(&id, None, Some(ManagedPermissionTense::Task)).expect("task resolves");
        assert_eq!(
            rx.recv().expect("decision").decision.option_id.as_deref(),
            Some("runtime-allow")
        );
        assert_eq!(
            permission_ledger::turn_hits(&resident, 12, &turn),
            vec![luca_protocol::PermissionMatcherV1::Command {
                token: "git".into(),
                argv_prefix: vec!["status".into()],
            }]
        );
        permission_ledger::end_turn(&resident, 12, &turn);
    }

    #[test]
    fn tense_refused_when_offer_forbids_it() {
        let _guard = permission_ledger::test_global_state_guard();
        cancel_all();
        let door = PermissionOfferV1 {
            once: true,
            task: false,
            always_here: false,
            deny: true,
            project_label: Some("Luca".into()),
            remembers: Vec::new(),
            note: Some("This one always asks.".into()),
        };
        let (id, rx) = insert_pending_with(request("door", 13), door);
        for refused in [
            ManagedPermissionTense::Task,
            ManagedPermissionTense::AlwaysHere,
        ] {
            assert!(
                resolve(&id, None, Some(refused)).is_err(),
                "a door may not be remembered"
            );
        }
        assert!(
            rx.try_recv().is_err(),
            "a refused answer leaves the request waiting"
        );
        resolve(&id, None, Some(ManagedPermissionTense::Once)).expect("once is on offer");
        assert_eq!(
            rx.recv().expect("decision").decision.option_id.as_deref(),
            Some("runtime-allow")
        );
    }

    #[test]
    fn deny_without_reject_option_is_cancelled() {
        let _guard = permission_ledger::test_global_state_guard();
        cancel_all();
        let mut unadvertised = request("deny-unadvertised", 14);
        unadvertised
            .options
            .retain(|option| option.kind != "reject_once");
        let (id, rx) = insert_pending(unadvertised.clone());
        resolve(&id, None, Some(ManagedPermissionTense::Deny)).expect("deny resolves");
        let resolution = rx.recv().expect("decision delivered");
        assert_eq!(
            resolution.decision.disposition,
            ManagedPermissionDispositionV1::Cancelled
        );
        assert_eq!(resolution.decision.option_id, None);
        assert_eq!(
            resolution.outcome,
            ManagedPermissionResolutionOutcome::Cancelled,
            "saying no with nothing to say it with is a cancellation, not an allow"
        );
        resolution
            .decision
            .validate_for(&unadvertised)
            .expect("cancellation binds the exact request");

        // With the option advertised, deny is a rejection.
        let (id, rx) = insert_pending(request("deny", 14));
        resolve(&id, None, Some(ManagedPermissionTense::Deny)).expect("deny resolves");
        let resolution = rx.recv().expect("decision delivered");
        assert_eq!(
            resolution.decision.option_id.as_deref(),
            Some("runtime-reject")
        );
        assert_eq!(
            resolution.outcome,
            ManagedPermissionResolutionOutcome::Rejected
        );
    }

    /// The owner's line may name the command; the room's line may not.
    #[test]
    fn audit_copy_keeps_arguments_out_of_the_room() {
        let request = request("audit", 15);
        let subject = test_subject(&request);
        let cases = [
            (
                Verdict::Allow(AllowReason::PreAllowed),
                "Allowed on its own: git status",
            ),
            (
                Verdict::Allow(AllowReason::BrokerGuarded),
                "Handled by Polyphonic: git status",
            ),
            (
                Verdict::Allow(AllowReason::TurnRule),
                "Allowed for this task: git status",
            ),
            (
                Verdict::Allow(AllowReason::Rule {
                    rule_ids: vec!["rule-1".into()],
                    display_name: "git status".into(),
                }),
                "Allowed by your rule: git status · Always in Luca",
            ),
        ];
        for (verdict, expected) in cases {
            let line = automatic_audit_line(&subject, &verdict).expect("an automatic line");
            assert_eq!(line.text, expected);
            assert_eq!(line.room_text, "Allowed a command");
            assert!(line.allowed);
        }
        let refused = automatic_audit_line(
            &subject,
            &Verdict::Deny {
                reason: "git status".into(),
            },
        )
        .expect("a refusal line");
        assert_eq!(refused.text, "Declined by your rule: git status");
        assert_eq!(refused.room_text, "Declined a command");
        assert!(!refused.allowed);
        assert!(automatic_audit_line(
            &subject,
            &Verdict::Ask {
                offer: full_offer()
            }
        )
        .is_none());

        let answered = [
            (
                ManagedPermissionResolutionOutcome::Approved,
                Some(ManagedPermissionTense::Once),
                "You allowed once: git status",
            ),
            (
                ManagedPermissionResolutionOutcome::Approved,
                Some(ManagedPermissionTense::Task),
                "Allowed for this task: git status",
            ),
            (
                ManagedPermissionResolutionOutcome::Approved,
                Some(ManagedPermissionTense::AlwaysHere),
                "Allowed by your rule: git status · Always in Luca",
            ),
            (
                ManagedPermissionResolutionOutcome::Rejected,
                Some(ManagedPermissionTense::Deny),
                "You said no: git status",
            ),
            (
                ManagedPermissionResolutionOutcome::Expired,
                None,
                "No answer in time",
            ),
            (
                ManagedPermissionResolutionOutcome::SessionReplaced,
                None,
                "Closed when the resident restarted",
            ),
            (
                ManagedPermissionResolutionOutcome::ApplicationClosed,
                None,
                "Closed with Polyphonic",
            ),
            (
                ManagedPermissionResolutionOutcome::Cancelled,
                None,
                "Closed with Polyphonic",
            ),
        ];
        for (outcome, tense, expected) in answered {
            let line = answered_audit_line(&subject, outcome, tense);
            assert_eq!(line.text, expected, "{outcome:?}");
            assert!(
                !line.room_text.contains("git"),
                "the room never learns the command"
            );
        }
    }

    /// The offer the card reads travels camelCase and carries no path, command
    /// or host.
    #[test]
    fn the_pending_event_carries_the_offer_and_nothing_more() {
        let event = serde_json::to_value(PendingManagedPermission {
            pending_id: "pending-1".into(),
            request: PendingManagedPermissionRequest::Runtime(Box::new(request("offer", 16))),
            offer: Some(full_offer()),
        })
        .expect("serialize pending event");
        let offer = event
            .get("offer")
            .and_then(serde_json::Value::as_object)
            .expect("offer object");
        assert_eq!(offer.get("alwaysHere"), Some(&serde_json::json!(true)));
        assert_eq!(offer.get("projectLabel"), Some(&serde_json::json!("Luca")));
        assert_eq!(
            offer.get("remembers"),
            Some(&serde_json::json!(["git status"])),
            "the card needs the names it would write down"
        );
        assert_eq!(offer.len(), 7);

        // An offer that remembers nothing says so by omission.
        let door = serde_json::to_value(PendingManagedPermission {
            pending_id: "pending-door".into(),
            request: PendingManagedPermissionRequest::Runtime(Box::new(request("door-offer", 16))),
            offer: Some(PermissionOfferV1 {
                once: true,
                task: false,
                always_here: false,
                deny: true,
                project_label: None,
                remembers: Vec::new(),
                note: Some("This one always asks.".into()),
            }),
        })
        .expect("serialize door event");
        assert!(door.pointer("/offer/remembers").is_none());

        // A structured capability request has no offer at all.
        let event = serde_json::to_value(PendingManagedPermission {
            pending_id: "pending-2".into(),
            request: PendingManagedPermissionRequest::Runtime(Box::new(request("no-offer", 16))),
            offer: None,
        })
        .expect("serialize pending event");
        assert!(event.get("offer").is_none());
    }
}

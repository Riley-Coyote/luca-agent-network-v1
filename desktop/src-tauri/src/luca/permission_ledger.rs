//! The desktop's memory of permission answers.
//!
//! Every managed runtime permission request passes through here before a card
//! is ever shown. The ledger answers three questions in order: what exactly is
//! being asked (the [`PermissionSubject`]), has the owner already answered it
//! (a turn-scoped or durable [`PermissionRuleV1`]), and if not, what may the
//! card offer (the [`PermissionOfferV1`]).
//!
//! Three invariants hold throughout:
//!
//! - **Deny wins.** An explicit deny rule beats every allowance, including
//!   Polyphonic's own pre-allowed reads.
//! - **A door always asks.** Shells, browsing, speaking to other people and
//!   deletions can be allowed once, never remembered.
//! - **A remembered answer never travels.** A rule stores an opaque project
//!   id, never a path, and a project rule cannot answer a card raised in a
//!   different project.

use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use luca_protocol::{
    is_secret_path, mcp_server_family, CommandSegmentV1, Hex64, ManagedPermissionRequestV1,
    OpaqueId, PermissionEffectV1, PermissionMatcherV1, PermissionRuleScopeV1, PermissionRuleV1,
    ResidentAccessLevel, DESTRUCTIVE_COMMAND_TOKENS, DOOR_SERVER_FAMILIES,
    MAX_PERMISSION_RULE_DISPLAY_BYTES, POLYPHONIC_BROKER_GUARDED_TOOLS, POLYPHONIC_DOOR_TOOLS,
    POLYPHONIC_PRE_ALLOWED_TOOLS,
};
use tauri::{AppHandle, Manager};

use crate::data_dir::BuzzPathExt;

/// Matchers remembered for one turn, and turns remembered at once. Both are
/// process-local ceilings; nothing here survives a restart.
const MAX_TURN_MATCHERS: usize = 64;
const MAX_REMEMBERED_TURNS: usize = 256;

/// The server family of Polyphonic's own communications tools. Any tool of
/// this family that is not pre-allowed is a door: speaking to somebody else is
/// always the owner's decision.
const COMMUNICATIONS_FAMILY: &str = "luca-communications";

/// Which project a request belongs to.
///
/// `Source` is a folder the owner connected to their Brain; `WorkingRoot` is
/// the resident's own working folder, used when a turn carries no frozen
/// context. Both carry a canonical root for path containment only — the root
/// never leaves this process, and never enters a rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProjectRef {
    Source {
        source_id: OpaqueId,
        canonical_root: PathBuf,
        label: String,
    },
    WorkingRoot {
        root_id: OpaqueId,
        canonical_root: PathBuf,
        label: String,
    },
}

impl ProjectRef {
    /// The opaque id a `Project`-scoped rule is anchored to.
    pub(crate) fn scope_id(&self) -> &OpaqueId {
        match self {
            ProjectRef::Source { source_id, .. } => source_id,
            ProjectRef::WorkingRoot { root_id, .. } => root_id,
        }
    }

    pub(crate) fn canonical_root(&self) -> &Path {
        match self {
            ProjectRef::Source { canonical_root, .. }
            | ProjectRef::WorkingRoot { canonical_root, .. } => canonical_root,
        }
    }

    pub(crate) fn label(&self) -> &str {
        match self {
            ProjectRef::Source { label, .. } | ProjectRef::WorkingRoot { label, .. } => label,
        }
    }
}

/// Exactly what one permission request is asking for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PermissionSubject {
    pub resident: Hex64,
    pub project: Option<ProjectRef>,
    /// Everything a rule could be written about here, in order. A simple
    /// request has one; a compound command has one per segment, and every one
    /// of them must be answered before the request is allowed without a card.
    /// Empty means there is nothing to remember, so the card offers Once.
    pub matchers: Vec<PermissionMatcherV1>,
    /// The short owner-facing phrase for each matcher, in the same order.
    pub matcher_names: Vec<String>,
    /// A door onto the machine or the world. Since beta.13 most doors ask
    /// first but may still be remembered; see `is_destructive` for the ones
    /// that never are.
    pub is_door: bool,
    /// A deletion or a destructive command (`rm`, `shred`, …): allowed once
    /// at most, never remembered, whatever else is true of the request.
    pub is_destructive: bool,
    /// A read-only path request outside the secrets list: allowed anywhere
    /// without a card at all.
    pub is_free_read: bool,
    /// A read the secrets list holds back: it would have been free, but the
    /// path looks like a credential. It asks every time, and the card says so
    /// rather than leaving the owner to guess why the button is missing.
    pub is_secret_read: bool,
    /// One of Polyphonic's own read-only tools.
    pub is_pre_allowed: bool,
    /// A tool whose side effect already goes through the desktop authority
    /// broker, which owns its own confirmation.
    pub is_broker_guarded: bool,
    /// Whether the request's path lies inside the project's root. False
    /// whenever there is no path or no project.
    pub inside_project: bool,
    /// The short owner-facing phrase for the whole request: one name, or the
    /// segment names read as a list.
    pub display_name: String,
}

impl PermissionSubject {
    /// Each matcher beside the phrase the owner reads for it.
    pub(crate) fn asks(&self) -> impl Iterator<Item = (&PermissionMatcherV1, &str)> {
        self.matchers
            .iter()
            .zip(self.matcher_names.iter().map(String::as_str))
    }
}

/// Why a request was allowed without a card.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AllowReason {
    PreAllowed,
    BrokerGuarded,
    /// A read-only path request outside the secrets list. Reads are free
    /// everywhere except that short list; see `is_free_read_path`.
    FreeRead,
    TurnRule,
    Rule {
        /// Every remembered rule that had to answer, one per segment.
        rule_ids: Vec<String>,
        display_name: String,
    },
    /// This resident is at Full access ("Don't ask me") — beta.13 P4. Every
    /// request that would otherwise ask, doors included, is allowed without
    /// a card. An explicit `Deny` rule still wins over this (checked first
    /// in `decide_with`), and this is always audited exactly like any other
    /// automatic allow — silence never means unaudited.
    FullAccess,
}

/// What the offer on the card may contain.
///
/// Serialised camelCase straight into the pending event the card reads. It
/// carries no path, no command and no host — only which answers are on offer,
/// the project's name, and an optional one-line note.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionOfferV1 {
    pub once: bool,
    pub task: bool,
    pub always_here: bool,
    pub deny: bool,
    pub project_label: Option<String>,
    /// What "For this task" and "Always here" would write down, one name per
    /// segment. A compound command remembers several, and the card says so
    /// rather than letting the owner guess.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub remembers: Vec<String>,
    pub note: Option<String>,
}

impl PermissionOfferV1 {
    /// The narrowest offer there is: answer this one, or say no.
    fn once_or_deny(project_label: Option<String>, note: Option<String>) -> Self {
        Self {
            once: true,
            task: false,
            always_here: false,
            deny: true,
            project_label,
            remembers: Vec::new(),
            note,
        }
    }
}

/// The ledger's answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Verdict {
    Deny { reason: String },
    Allow(AllowReason),
    Ask { offer: PermissionOfferV1 },
}

/// Which answer the owner gave on a card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ManagedPermissionTense {
    Once,
    Task,
    AlwaysHere,
    Deny,
}

// ── Subject ──────────────────────────────────────────────────────────────────

fn mcp_identity(request: &ManagedPermissionRequestV1) -> Option<(String, String)> {
    let server = request.mcp_server.as_deref()?;
    let tool = request.mcp_tool.as_deref()?;
    Some((mcp_server_family(server).to_owned(), tool.to_owned()))
}

fn inventory_contains(inventory: &[(&str, &str)], family: &str, tool: &str) -> bool {
    inventory.iter().any(|(candidate_family, candidate_tool)| {
        *candidate_family == family && *candidate_tool == tool
    })
}

/// A deletion, or a command word that is never remembered whatever the owner
/// answered once (`rm`, `shred`, …). Destructive requests are doors that stay
/// once-only even after beta.13 lets other doors be remembered.
fn is_destructive(request: &ManagedPermissionRequestV1) -> bool {
    request.tool_kind.as_deref() == Some("delete")
        || command_tokens(request).any(|token| DESTRUCTIVE_COMMAND_TOKENS.contains(&token))
}

/// A door is a way onto the machine or out into the world. Since beta.13 a
/// door asks first, same as anything else, but may still end up remembered —
/// except a destructive one (see `is_destructive`), which always asks.
///
/// Runtime-native shells are deliberately not doors. A `Bash` tool call the
/// runtime raises itself has no MCP identity, so it falls through to the
/// ordinary "ask once per new command, then remembered" rung; only Polyphonic's
/// own `buzz` `shell` tool is a door.
fn is_door(request: &ManagedPermissionRequestV1, identity: Option<&(String, String)>) -> bool {
    if is_destructive(request) {
        return true;
    }
    let Some((family, tool)) = identity else {
        return false;
    };
    if DOOR_SERVER_FAMILIES.contains(&family.as_str())
        || inventory_contains(POLYPHONIC_DOOR_TOOLS, family, tool)
    {
        return true;
    }
    if family == COMMUNICATIONS_FAMILY
        && !inventory_contains(POLYPHONIC_PRE_ALLOWED_TOOLS, family, tool)
    {
        return true;
    }
    // Viewing an image off the network is browsing, not reading a file.
    family == "buzz" && tool == "view_image" && request.domain.is_some()
}

/// Every command word this request would run, whether it came as one command
/// or as the segments of a compound line.
fn command_tokens(request: &ManagedPermissionRequestV1) -> impl Iterator<Item = &str> {
    let single = if request.command_segments.is_empty() {
        request.command_token.as_deref()
    } else {
        None
    };
    single.into_iter().chain(
        request
            .command_segments
            .iter()
            .map(|segment| segment.token.as_str()),
    )
}

/// Derive every matcher a rule could be written from, first kind wins: MCP
/// tool, then command, then host, then path.
///
/// A compound command yields one `Command` matcher per segment, and the
/// owner's answer has to cover all of them. Everything else yields exactly
/// one matcher, as it always did. An empty result means there is nothing here
/// a rule could be keyed on.
fn derive_matchers(
    request: &ManagedPermissionRequestV1,
    identity: Option<&(String, String)>,
) -> Vec<PermissionMatcherV1> {
    if let Some((server_family, tool)) = identity {
        return vec![PermissionMatcherV1::McpTool {
            server_family: server_family.clone(),
            tool: tool.clone(),
        }];
    }
    if !request.command_segments.is_empty() {
        let mut matchers: Vec<PermissionMatcherV1> = Vec::new();
        for segment in &request.command_segments {
            let matcher = command_matcher(segment);
            // `echo a; echo b` is one thing to remember, not two.
            if !matchers.contains(&matcher) {
                matchers.push(matcher);
            }
        }
        return matchers;
    }
    // A harness that predates segments still sends one command word.
    if let Some(token) = request.command_token.as_deref() {
        return vec![PermissionMatcherV1::Command {
            token: token.to_owned(),
            argv_prefix: request.command_argv_prefix.clone(),
        }];
    }
    if let Some(host) = request.domain.as_deref() {
        return vec![PermissionMatcherV1::Domain {
            host: host.to_owned(),
        }];
    }
    request
        .path
        .as_deref()
        .map(|_| {
            vec![PermissionMatcherV1::Path {
                write: request.write.unwrap_or(false),
            }]
        })
        .unwrap_or_default()
}

fn command_matcher(segment: &CommandSegmentV1) -> PermissionMatcherV1 {
    PermissionMatcherV1::Command {
        token: segment.token.clone(),
        argv_prefix: segment.argv_prefix.clone(),
    }
}

/// Whether `path` is the project root or lies under it, on a component
/// boundary. `/luca-secrets` is never inside `/luca`.
///
/// Both sides are canonicalised when they exist; a file the resident is about
/// to create does not yet, so an absent path falls back to its lexical form
/// with `.` and `..` removed. A path that still tries to climb out is refused.
fn is_inside(root: &Path, path: &Path) -> bool {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let candidate = std::fs::canonicalize(path).unwrap_or_else(|_| lexical_path(path));
    candidate == root || candidate.starts_with(&root)
}

fn lexical_path(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !resolved.pop() {
                    // A path that climbs above its own root is not a path we
                    // can reason about; leave it unresolvable.
                    return PathBuf::from("/\u{0}unresolvable");
                }
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// The app's own data directory, honouring the same override the rest of the
/// desktop uses. `None` when it cannot be resolved, which `is_free_read_path`
/// then treats as "cannot classify" rather than "safe".
fn app_data_dir(app: &AppHandle) -> Option<PathBuf> {
    app.buzz_path().app_data_dir().ok()
}

/// Whether reading `path` may be allowed everywhere, with no card at all.
///
/// Fails closed: a path that cannot be resolved to a real or lexical form —
/// the sentinel `lexical_path` returns for one that climbs above its own
/// root — is treated the same as a known secret: not free, so the request
/// still gets a card rather than being silently allowed.
fn is_free_read_path(path: &Path, app_data_dir: Option<&Path>) -> bool {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| lexical_path(path));
    if resolved == Path::new("/\u{0}unresolvable") {
        return false;
    }
    if app_data_dir.is_some_and(|dir| is_inside(dir, path)) {
        return false;
    }
    !is_secret_path(&resolved)
}

/// Whether a read of `path` is held back by the secrets list — the same
/// resolution `is_free_read_path` does, asking the opposite question, so the
/// card can say why it is asking rather than only why it cannot remember.
fn is_secret_read_path(path: &Path, app_data_dir: Option<&Path>) -> bool {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| lexical_path(path));
    if resolved == Path::new("/\u{0}unresolvable") {
        return false;
    }
    app_data_dir.is_some_and(|dir| is_inside(dir, path)) || is_secret_path(&resolved)
}

fn bounded_display(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'
                )
        })
        .collect();
    let mut end = clean.len().min(MAX_PERMISSION_RULE_DISPLAY_BYTES);
    while end > 0 && !clean.is_char_boundary(end) {
        end -= 1;
    }
    clean[..end].to_owned()
}

/// The short owner-facing phrase for one matcher: a command with its first
/// words, a tool name, a host, or a file name.
fn matcher_display_name(
    request: &ManagedPermissionRequestV1,
    matcher: &PermissionMatcherV1,
    is_pre_allowed: bool,
) -> String {
    let phrase = match matcher {
        PermissionMatcherV1::Command { token, argv_prefix } => {
            let mut words = vec![token.as_str()];
            words.extend(argv_prefix.iter().map(String::as_str));
            words.join(" ")
        }
        PermissionMatcherV1::McpTool { tool, .. } if is_pre_allowed => {
            format!("{tool} (Polyphonic tool)")
        }
        PermissionMatcherV1::McpTool { tool, .. } => tool.clone(),
        PermissionMatcherV1::Domain { host } => host.clone(),
        PermissionMatcherV1::Path { .. } => request
            .path
            .as_deref()
            .and_then(|path| path.rsplit('/').next())
            .filter(|name| !name.is_empty())
            .unwrap_or(request.title.as_str())
            .to_owned(),
    };
    let phrase = bounded_display(&phrase);
    if phrase.is_empty() {
        bounded_display(&request.title)
    } else {
        phrase
    }
}

/// Read a list of names the way a person would: "ls", "ls and echo",
/// "ls, echo and cat".
fn read_as_list(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [only] => only.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// The short owner-facing phrase for the whole request.
fn subject_display_name(request: &ManagedPermissionRequestV1, names: &[String]) -> String {
    let phrase = if names.is_empty() {
        request
            .tool_name
            .clone()
            .unwrap_or_else(|| request.title.clone())
    } else {
        read_as_list(names)
    };
    let phrase = bounded_display(&phrase);
    if phrase.is_empty() {
        bounded_display(&request.title)
    } else {
        phrase
    }
}

/// The sentence the permissions list shows for one remembered answer. A
/// compound command mints one of these per segment, so each rule reads as the
/// one thing it actually allows.
pub(crate) fn rule_display_name(
    subject: &PermissionSubject,
    matcher: &PermissionMatcherV1,
    display_name: &str,
) -> String {
    let verb = match matcher {
        PermissionMatcherV1::Command { .. } => "Run",
        PermissionMatcherV1::Domain { .. } => "Visit",
        PermissionMatcherV1::Path { write: true } => "Edit",
        PermissionMatcherV1::Path { write: false } => "Read",
        PermissionMatcherV1::McpTool { .. } => "Use",
    };
    let sentence = match subject.project.as_ref() {
        Some(project) => format!("{verb} {display_name} in {}", project.label()),
        None => format!("{verb} {display_name}"),
    };
    let sentence = bounded_display(&sentence);
    if sentence.is_empty() {
        "Remembered permission".to_owned()
    } else {
        sentence
    }
}

/// Read one request and say exactly what it is asking for.
pub(crate) fn subject(
    app: &AppHandle,
    owner: &Hex64,
    request: &ManagedPermissionRequestV1,
    working_root: &Path,
) -> PermissionSubject {
    let identity = mcp_identity(request);
    let is_pre_allowed = identity.as_ref().is_some_and(|(family, tool)| {
        inventory_contains(POLYPHONIC_PRE_ALLOWED_TOOLS, family, tool)
    });
    let is_broker_guarded = identity.as_ref().is_some_and(|(family, tool)| {
        inventory_contains(POLYPHONIC_BROKER_GUARDED_TOOLS, family, tool)
    });
    let is_destructive = is_destructive(request);
    let is_door = is_door(request, identity.as_ref());
    let matchers = derive_matchers(request, identity.as_ref());
    let matcher_names: Vec<String> = matchers
        .iter()
        .map(|matcher| matcher_display_name(request, matcher, is_pre_allowed))
        .collect();
    let project = resolve_project(app, owner, request, working_root);
    let inside_project = match (project.as_ref(), request.path.as_deref()) {
        (Some(project), Some(path)) => is_inside(project.canonical_root(), Path::new(path)),
        _ => false,
    };
    // A free read is exactly one bare read-only path matcher, outside the
    // secrets list. Anything else — a write, a command, an MCP tool, more
    // than one matcher — still goes through the ordinary card.
    let is_free_read = matches!(
        matchers.as_slice(),
        [PermissionMatcherV1::Path { write: false }]
    ) && request
        .path
        .as_deref()
        .is_some_and(|raw| is_free_read_path(Path::new(raw), app_data_dir(app).as_deref()));
    let is_secret_read = matches!(
        matchers.as_slice(),
        [PermissionMatcherV1::Path { write: false }]
    ) && request
        .path
        .as_deref()
        .is_some_and(|raw| is_secret_read_path(Path::new(raw), app_data_dir(app).as_deref()));
    PermissionSubject {
        resident: request.resident_pubkey.clone(),
        project,
        display_name: subject_display_name(request, &matcher_names),
        matchers,
        matcher_names,
        is_door,
        is_destructive,
        is_free_read,
        is_secret_read,
        is_pre_allowed,
        is_broker_guarded,
        inside_project,
    }
}

/// Resolve the project this turn belongs to.
///
/// The harness sends the dispatch receipt, which names the owner's dispatch
/// row; the row names the frozen context snapshot; the snapshot names the
/// working-folder source; the owner's own Brain candidate turns that into a
/// root. Every step is checked against this owner and this conversation, and a
/// failure anywhere falls back to the resident's own working folder.
fn resolve_project(
    app: &AppHandle,
    owner: &Hex64,
    request: &ManagedPermissionRequestV1,
    working_root: &Path,
) -> Option<ProjectRef> {
    source_project(app, owner, request).or_else(|| working_root_project(working_root))
}

fn source_project(
    app: &AppHandle,
    owner: &Hex64,
    request: &ManagedPermissionRequestV1,
) -> Option<ProjectRef> {
    let receipt = request.dispatch_receipt_id.as_ref()?;
    let binding = super::managed_dispatch_store::global_dispatch_store(app)
        .ok()?
        .lock()
        .ok()?
        .dispatch_context_binding(
            owner.as_str(),
            request.resident_pubkey.as_str(),
            request.conversation_id.as_str(),
            receipt.as_str(),
        )?;
    let source_id = super::conversation_context::primary_source_for_dispatch(
        app,
        owner,
        &request.conversation_id,
        &binding,
    )
    .ok()
    .flatten()?;
    let state = app.state::<crate::app_state::AppState>();
    let canonical_root = state
        .read_connected_brain_candidate(owner, &source_id)
        .ok()?
        .canonical_root;
    let label = root_label(&canonical_root)?;
    Some(ProjectRef::Source {
        source_id,
        canonical_root,
        label,
    })
}

fn working_root_project(working_root: &Path) -> Option<ProjectRef> {
    let root_id = super::artifact_bridge::working_root_id(working_root).ok()?;
    let canonical_root =
        std::fs::canonicalize(working_root).unwrap_or_else(|_| working_root.to_path_buf());
    let label = root_label(&canonical_root)?;
    Some(ProjectRef::WorkingRoot {
        root_id,
        canonical_root,
        label,
    })
}

/// A project's name is the last component of its root, and nothing else. The
/// rest of the path never reaches an event, a rule or the trace.
fn root_label(root: &Path) -> Option<String> {
    let label = bounded_display(&root.file_name()?.to_string_lossy());
    (!label.is_empty()).then_some(label)
}

// ── Turn memory ──────────────────────────────────────────────────────────────

type TurnKey = (String, u64, String);

#[derive(Default)]
struct TurnMemory {
    matchers: HashMap<TurnKey, Vec<PermissionMatcherV1>>,
    order: VecDeque<TurnKey>,
}

fn turn_memory() -> &'static Mutex<TurnMemory> {
    static MEMORY: OnceLock<Mutex<TurnMemory>> = OnceLock::new();
    MEMORY.get_or_init(|| Mutex::new(TurnMemory::default()))
}

/// Remember one matcher for the rest of this turn only. Nothing here is
/// written to disk and nothing survives the session that raised it.
pub(crate) fn remember_for_turn(
    resident_pubkey: &str,
    session_epoch: u64,
    turn_id: &str,
    matcher: PermissionMatcherV1,
) {
    let key = (
        resident_pubkey.to_owned(),
        session_epoch,
        turn_id.to_owned(),
    );
    let Ok(mut memory) = turn_memory().lock() else {
        return;
    };
    if !memory.matchers.contains_key(&key) {
        if memory.order.len() >= MAX_REMEMBERED_TURNS {
            if let Some(oldest) = memory.order.pop_front() {
                memory.matchers.remove(&oldest);
            }
        }
        memory.order.push_back(key.clone());
    }
    let matchers = memory.matchers.entry(key).or_default();
    if matchers.len() < MAX_TURN_MATCHERS && !matchers.contains(&matcher) {
        matchers.push(matcher);
    }
}

pub(crate) fn turn_hits(
    resident_pubkey: &str,
    session_epoch: u64,
    turn_id: &str,
) -> Vec<PermissionMatcherV1> {
    let key = (
        resident_pubkey.to_owned(),
        session_epoch,
        turn_id.to_owned(),
    );
    turn_memory()
        .lock()
        .ok()
        .and_then(|memory| memory.matchers.get(&key).cloned())
        .unwrap_or_default()
}

/// A turn's answers die with the turn.
pub(crate) fn end_turn(resident_pubkey: &str, session_epoch: u64, turn_id: &str) {
    let key = (
        resident_pubkey.to_owned(),
        session_epoch,
        turn_id.to_owned(),
    );
    if let Ok(mut memory) = turn_memory().lock() {
        memory.matchers.remove(&key);
        memory.order.retain(|candidate| candidate != &key);
    }
}

/// A session's answers die with the session, replaced or exited.
pub(crate) fn clear_session(resident_pubkey: &str, session_epoch: u64) {
    if let Ok(mut memory) = turn_memory().lock() {
        memory.matchers.retain(|(resident, epoch, _), _| {
            resident != resident_pubkey || *epoch != session_epoch
        });
        memory
            .order
            .retain(|(resident, epoch, _)| resident != resident_pubkey || *epoch != session_epoch);
    }
}

pub(crate) fn clear_all() {
    if let Ok(mut memory) = turn_memory().lock() {
        memory.matchers.clear();
        memory.order.clear();
    }
}

// ── Decision ─────────────────────────────────────────────────────────────────

fn matcher_answers(
    rule: &PermissionMatcherV1,
    asked: &PermissionMatcherV1,
    inside_project: bool,
) -> bool {
    match (rule, asked) {
        (
            PermissionMatcherV1::Command {
                token: remembered,
                argv_prefix: remembered_prefix,
            },
            PermissionMatcherV1::Command {
                token: asked_token,
                argv_prefix: asked_prefix,
            },
        ) => {
            remembered == asked_token
                && remembered_prefix.len() <= asked_prefix.len()
                && remembered_prefix
                    .iter()
                    .zip(asked_prefix.iter())
                    .all(|(remembered, asked)| remembered == asked)
        }
        (
            PermissionMatcherV1::McpTool {
                server_family: remembered_family,
                tool: remembered_tool,
            },
            PermissionMatcherV1::McpTool {
                server_family: asked_family,
                tool: asked_tool,
            },
        ) => remembered_family == asked_family && remembered_tool == asked_tool,
        (
            PermissionMatcherV1::Domain { host: remembered },
            PermissionMatcherV1::Domain { host: asked },
        ) => remembered == asked,
        (
            PermissionMatcherV1::Path { write: remembered },
            PermissionMatcherV1::Path { write: asked },
        ) => inside_project && (*remembered || !*asked),
        _ => false,
    }
}

/// Whether one remembered rule answers one of the things this request asks
/// for.
fn rule_answers(
    rule: &PermissionRuleV1,
    subject: &PermissionSubject,
    asked: &PermissionMatcherV1,
) -> bool {
    if rule.revoked_at.is_some() || rule.resident_pubkey != subject.resident {
        return false;
    }
    let in_scope = match &rule.scope {
        PermissionRuleScopeV1::Project { source_id } => subject
            .project
            .as_ref()
            .is_some_and(|project| project.scope_id() == source_id),
        // A rule that travels may only ever describe reading.
        PermissionRuleScopeV1::Everywhere => rule.matcher.is_read_only(),
    };
    in_scope && matcher_answers(&rule.matcher, asked, subject.inside_project)
}

/// The whole decision, as a pure function of what is remembered.
///
/// Order is the contract: an explicit deny beats everything; Polyphonic's own
/// reads never ask; a broker-guarded tool has its own gate; a free read is
/// allowed anywhere; a destructive or unmatchable door always asks; then this
/// turn's answers and the owner's durable rules together; then a card, which
/// picks the widest scope "Always" could still write.
///
/// A compound command is allowed without a card only when EVERY segment is
/// already answered. One remembered `ls` never lets an unseen `echo` through,
/// and a deny on any one segment refuses the whole line.
pub(crate) fn decide_with(
    rules: &[PermissionRuleV1],
    turn_hits: &[PermissionMatcherV1],
    subject: &PermissionSubject,
    full_access: bool,
) -> Verdict {
    if let Some(denied) = rules.iter().find(|rule| {
        rule.effect == PermissionEffectV1::Deny
            && subject
                .matchers
                .iter()
                .any(|asked| rule_answers(rule, subject, asked))
    }) {
        return Verdict::Deny {
            reason: denied.display_name.clone(),
        };
    }
    if subject.is_pre_allowed {
        return Verdict::Allow(AllowReason::PreAllowed);
    }
    if subject.is_broker_guarded {
        return Verdict::Allow(AllowReason::BrokerGuarded);
    }
    if subject.is_free_read {
        return Verdict::Allow(AllowReason::FreeRead);
    }
    // beta.13 P4: "Don't ask me" means it — including doors, including a
    // destructive one, including a compound command with nothing a rule
    // could be written from. Only an explicit `Deny` rule (checked above)
    // still stops something at Full access.
    if full_access {
        return Verdict::Allow(AllowReason::FullAccess);
    }
    let project_label = subject
        .project
        .as_ref()
        .map(|project| project.label().to_owned());
    // A destructive door, or one with nothing a rule could be written from
    // (a compound or wrapper command), never gets to remember: it asks every
    // time, and says so.
    if subject.is_door && (subject.is_destructive || subject.matchers.is_empty()) {
        return Verdict::Ask {
            offer: PermissionOfferV1::once_or_deny(
                project_label,
                Some("This one always asks.".into()),
            ),
        };
    }
    if let Some(answered) = every_matcher_answered(rules, turn_hits, subject) {
        return Verdict::Allow(answered);
    }
    let remembrable = !subject.matchers.is_empty();
    let has_path_matcher = subject
        .matchers
        .iter()
        .any(|matcher| matches!(matcher, PermissionMatcherV1::Path { .. }));
    // A path never travels outside the project it was raised in, read-only or
    // not — only a project rule can answer it, never `Everywhere`.
    let path_outside = has_path_matcher && !subject.inside_project;
    let scope_without_project = !has_path_matcher
        && subject
            .matchers
            .iter()
            .all(PermissionMatcherV1::is_read_only);
    let always_here = remembrable
        && !path_outside
        && !subject.is_secret_read
        && (subject.project.is_some() || scope_without_project);
    let note = if subject.is_secret_read {
        Some("This looks like a secrets file, so Polyphonic always asks.".to_owned())
    } else if !remembrable {
        Some("Polyphonic can only answer this one once.".to_owned())
    } else if always_here {
        None
    } else if path_outside {
        Some("This is outside your project, so Polyphonic can only answer once.".to_owned())
    } else {
        Some(
            "There's no project here to remember this in, so Polyphonic can only answer once."
                .to_owned(),
        )
    };
    Verdict::Ask {
        offer: PermissionOfferV1 {
            once: true,
            task: false,
            always_here,
            deny: true,
            project_label,
            remembers: if remembrable {
                subject.matcher_names.clone()
            } else {
                Vec::new()
            },
            note,
        },
    }
}

/// Why this request needs no card, when every one of its matchers is already
/// answered by this turn's memory or by a durable rule. `None` as soon as one
/// is not.
fn every_matcher_answered(
    rules: &[PermissionRuleV1],
    turn_hits: &[PermissionMatcherV1],
    subject: &PermissionSubject,
) -> Option<AllowReason> {
    if subject.matchers.is_empty() {
        return None;
    }
    let mut hit_rules: Vec<&PermissionRuleV1> = Vec::new();
    for asked in &subject.matchers {
        if turn_hits
            .iter()
            .any(|remembered| matcher_answers(remembered, asked, subject.inside_project))
        {
            continue;
        }
        let allowed = rules.iter().find(|rule| {
            rule.effect == PermissionEffectV1::Allow && rule_answers(rule, subject, asked)
        })?;
        hit_rules.push(allowed);
    }
    if hit_rules.is_empty() {
        return Some(AllowReason::TurnRule);
    }
    // One rule answering one thing reads as that rule; several rules
    // answering the segments of one line read as the line.
    let display_name = match hit_rules.as_slice() {
        [only] if subject.matchers.len() == 1 => only.display_name.clone(),
        _ => subject.display_name.clone(),
    };
    Some(AllowReason::Rule {
        rule_ids: hit_rules
            .iter()
            .map(|rule| rule.rule_id.as_str().to_owned())
            .collect(),
        display_name,
    })
}

/// The same decision, reading this owner's remembered answers. A durable rule
/// that answers the card is touched so the permissions list can show when it
/// was last used.
pub(crate) fn decide(
    app: &AppHandle,
    owner_pubkey: &str,
    request: &ManagedPermissionRequestV1,
    subject: &PermissionSubject,
) -> Verdict {
    let rules = super::resident_capability_authority::matching_rules(
        app,
        owner_pubkey,
        subject.resident.as_str(),
    )
    .unwrap_or_default();
    let hits = turn_hits(
        request.resident_pubkey.as_str(),
        request.session_epoch.get(),
        request.turn_id.as_str(),
    );
    // Fails closed: a lookup error (no store, corrupt file) is never read as
    // "Don't ask me" — only a resident actually recorded at Full access
    // silences a door.
    let full_access = super::resident_capability_authority::effective_access(
        app,
        owner_pubkey,
        subject.resident.as_str(),
    )
    .map(|level| level == ResidentAccessLevel::Full)
    .unwrap_or(false);
    let verdict = decide_with(&rules, &hits, subject, full_access);
    if let Verdict::Allow(AllowReason::Rule { rule_ids, .. }) = &verdict {
        for rule_id in rule_ids {
            let _ = super::resident_capability_authority::touch_rule(app, owner_pubkey, rule_id);
        }
    }
    verdict
}

/// Serialises the tests that reach the process-global permission state — this
/// module's turn memory and the pending registry next door. Both are one map
/// per process, so two tests draining them at once would race.
#[cfg(test)]
pub(crate) fn test_global_state_guard() -> std::sync::MutexGuard<'static, ()> {
    static GUARD: Mutex<()> = Mutex::new(());
    GUARD.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "permission_ledger_tests.rs"]
mod tests;

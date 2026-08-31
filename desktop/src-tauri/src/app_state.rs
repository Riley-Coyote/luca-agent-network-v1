use std::{
    collections::{HashMap, VecDeque},
    fmt,
    io::Write,
    sync::{
        atomic::{AtomicBool, AtomicU16},
        Arc, Mutex, MutexGuard,
    },
};

use nostr::{Keys, ToBech32};
use tauri::{AppHandle, Manager};
#[cfg(feature = "mesh-llm")]
use tokio::sync::Mutex as AsyncMutex;

use crate::huddle::HuddleState;
use crate::luca::continuity_runtime::{
    ContinuityReadLeaseOutcomeV1, ContinuityReadLeaseRequestV1, ContinuityReadLeaseViewV1,
    ContinuityRuntimeState, ResidentHandoffCommitOutcomeV1, ResidentHandoffCommitRequestV1,
};
use crate::luca::owner_brain::OwnerBrainPreviewCache;
use crate::luca::owner_brain_store::OwnerBrainStoreError;
use crate::luca::resident_notebook::{
    ResidentJournalCommitRequestV1, ResidentMetabolismCommitOutcomeV1,
    ResidentMetabolismCommitRequestV1, ResidentNotebookMutationOutcomeV1,
    ResidentNotebookReadOutcomeV1,
};
use crate::managed_agents::config_bridge::SessionConfigCache;
use crate::managed_agents::ManagedAgentProcess;

/// The one process-wide serialization authority for continuity lifecycle work.
///
/// Construction is intentionally private to [`build_app_state`]. Rotation,
/// backup, restore, and continuity read generations must all borrow this exact
/// AppState-owned instance rather than manufacture independent locks.
pub(crate) struct ContinuityLifecycleLock(Mutex<()>);

/// Typed proof that the one AppState-owned continuity lifecycle lock is held.
///
/// The inner guard is deliberately inaccessible. Trusted continuity code may
/// borrow this proof for locked variants, but cannot manufacture one or unlock
/// it early while retaining apparent authority.
pub(crate) struct ContinuityLifecycleGuard<'a> {
    _guard: MutexGuard<'a, ()>,
}

impl ContinuityLifecycleLock {
    fn new() -> Self {
        Self(Mutex::new(()))
    }

    pub(crate) fn lock(&self) -> Result<ContinuityLifecycleGuard<'_>, ()> {
        self.0
            .lock()
            .map(|guard| ContinuityLifecycleGuard { _guard: guard })
            .map_err(|_| ())
    }

    #[cfg(test)]
    pub(crate) fn new_for_test() -> Self {
        Self::new()
    }

    #[cfg(test)]
    pub(crate) fn is_locked_for_test(&self) -> bool {
        matches!(self.0.try_lock(), Err(std::sync::TryLockError::WouldBlock))
    }
}

impl fmt::Debug for ContinuityLifecycleLock {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ContinuityLifecycleLock([REDACTED])")
    }
}

pub struct AppState {
    pub keys: Mutex<Keys>,
    pub http_client: reqwest::Client,
    /// A no-redirect client for authenticated relay media fetches (download,
    /// clipboard copy, snapshot, editor). Every caller pre-validates the URL
    /// origin, but the app-wide `http_client` follows redirects by default, so
    /// a relay `/media/` URL returning a 3xx to an off-origin or private host
    /// would forward the minted media Authorization header across origins —
    /// a redirect-hop SSRF. This client treats any 3xx as a non-success
    /// response (surfaced as an error) so the auth token never leaves the
    /// validated relay origin.
    pub media_fetch_client: reqwest::Client,
    /// Workspace-provided relay URL override. Set by `apply_workspace` on app
    /// init and takes priority over env vars and compile-time defaults.
    pub relay_url_override: Mutex<Option<String>>,
    /// Set during backend setup when managed agents are eligible for launch
    /// restore. `apply_workspace` consumes it after installing the workspace
    /// relay and identity, so agents never start against the fallback relay.
    pub managed_agent_restore_pending: AtomicBool,
    /// Whether desktop may repair managed-agent kind:0 profiles from its local
    /// records. Disabled by the agent-managed profiles experiment so an agent's
    /// own profile updates are not overwritten on start or restore.
    pub managed_agent_profile_reconcile_enabled: AtomicBool,
    /// Shared shutdown signal checked by launch-time agent restoration.
    pub shutdown_started: AtomicBool,
    /// Serializes the restore spawn/register transition with shutdown cleanup,
    /// preventing an agent from spawning after shutdown has swept processes.
    pub managed_agent_restore_transition: Mutex<()>,
    pub managed_agents_store_lock: Mutex<()>,
    pub channel_templates_store_lock: Mutex<()>,
    pub luca_projects_store_lock: Mutex<()>,
    /// Single lifecycle lock shared by every trusted continuity entrypoint.
    continuity_lifecycle: ContinuityLifecycleLock,
    /// The one process-owned encrypted continuity store and its body-free
    /// readiness state. Callers use typed AppState methods; the raw mutex and
    /// SQLite connection are never exposed.
    continuity_runtime: Mutex<ContinuityRuntimeState>,
    /// Expiring, process-memory-only V1.2 source previews. The cache contains
    /// sensitive relative paths but no source bodies and is never persisted.
    pub(crate) owner_brain_previews: OwnerBrainPreviewCache,
    /// Bounded, process-memory-only body-free Brain retrieval activity.
    pub(crate) owner_brain_receipts: Mutex<VecDeque<luca_protocol::OwnerBrainContextReceiptV1>>,
    /// Bounded process-memory-only repository tool audit receipts.
    pub(crate) repository_tool_receipts: Mutex<VecDeque<luca_protocol::RepositoryToolReceiptV1>>,
    /// Serializes repository tools with disconnect so authorization cannot be
    /// revoked between a terminal grant check and a local operation.
    pub(crate) repository_work_lock: Mutex<()>,
    /// Expiring metadata-only discovery capabilities for V1.2.1 connections.
    pub(crate) connected_brain_discovery:
        crate::luca::connected_brain::ConnectedBrainDiscoveryCache,
    pub(crate) connected_brain_watcher: crate::luca::connected_brain::ConnectedBrainWatcherState,
    pub managed_agent_processes: Mutex<HashMap<String, ManagedAgentProcess>>,
    pub huddle_state: Mutex<HuddleState>,
    /// Tauri app handle — stored after setup so huddle commands can emit
    /// `huddle-state-changed` events without needing the handle threaded
    /// through every call site.
    ///
    /// Set once during `setup()` in `lib.rs`; never cleared.
    pub app_handle: Mutex<Option<AppHandle>>,
    /// Selected audio output device name. `None` = system default.
    /// Used by `connect_audio_relay` and TTS pipeline when opening sinks.
    pub audio_output_device: Mutex<Option<String>>,
    /// Port of the localhost media streaming proxy (set during setup).
    pub media_proxy_port: AtomicU16,
    /// Set when identity resolution detected a "keyring-locked" state: the
    /// keyring is unreachable this boot but a migration marker shows the key
    /// lives there. An ephemeral key is generated so the app can open; all
    /// signing commands check this flag via [`AppState::signing_keys`] and
    /// return `Err` so no events are published under the inaccessible identity.
    /// Mutually exclusive with `identity_lost` (guaranteed by `RecoveryState`
    /// at the resolve boundary).
    ///
    /// Ordering: writers store with `Ordering::Release` after `state.keys` is
    /// updated, so a reader observing `false` with `Ordering::Acquire` is
    /// guaranteed to see the updated keys. Writers: `setup()` (initial
    /// resolution via `resolve_persisted_identity`) and `import_identity`
    /// (clears the flag when the user successfully imports a new key).
    pub keyring_locked: AtomicBool,
    /// Set when identity resolution detected a "lost" state: the migration
    /// marker was present but the keyring was empty and no plaintext fallback
    /// existed. An ephemeral key was generated to let the app boot; the
    /// frontend checks this flag via `get_identity` and routes to the nsec
    /// re-import step instead of the normal onboarding profile flow.
    ///
    /// Ordering: writers store with `Ordering::Release` after `state.keys` is
    /// updated, so a reader observing `false` with `Ordering::Acquire` is
    /// guaranteed to see the updated keys. Writers: `setup()` (initial
    /// resolution) and `import_identity`/`persist_current_identity`
    /// (user-initiated key import).
    pub identity_lost: AtomicBool,
    /// Serializes runtime identity mutations (`import_identity` and
    /// `persist_current_identity`) so a stale ephemeral key can never overwrite
    /// a newer imported key during concurrent calls. Deliberately separate from
    /// `keys` so readers (signing, get_identity, etc.) are not blocked during
    /// keyring I/O.
    pub identity_mutation: Mutex<()>,
    /// Set when the boot-time Phase 2 reset attempted a wipe but verification
    /// failed. The sentinel is preserved so the next relaunch retries. All
    /// identity-dependent setup is skipped; the frontend shows a reset-failed
    /// recovery screen via `get_identity`.
    ///
    /// Ordering: written once in `setup()` with `Ordering::Release`; read in
    /// `get_identity` with `Ordering::Acquire`.
    pub reset_failed: AtomicBool,
    /// Cached ACP session config from running agents, keyed by agent pubkey.
    /// Populated when the harness emits `session_config_captured` observer events.
    pub session_config_cache: Mutex<HashMap<String, SessionConfigCache>>,
    /// IOKit power assertion state — prevents idle sleep while agents run.
    pub prevent_sleep: Arc<Mutex<crate::prevent_sleep::PreventSleepState>>,
    /// In-process mesh-llm node started by Buzz Desktop.
    #[cfg(feature = "mesh-llm")]
    pub mesh_llm_runtime: AsyncMutex<Option<crate::mesh_llm::DesktopMeshRuntime>>,
    /// Runtime-owned shared-compute coordinator. It publishes member-signed
    /// discovery status and reconciles MeshLLM's admission roster; MeshLLM
    /// itself owns direct QUIC/iroh connection establishment.
    #[cfg(feature = "mesh-llm")]
    pub mesh_coordinator: AsyncMutex<Option<crate::mesh_llm::MeshCoordinator>>,
    /// `(creator_pubkey_hex, channel_id)` pairs for channels the *named*
    /// identity created via `create_channel` and has not yet observed its own
    /// kind:39002 membership entry for. The relay provisions that entry
    /// asynchronously (#1761), so without this overlay a freshly created
    /// channel's owner reads back as `is_member=false` until the snapshot
    /// propagates, disabling their own composer. Entries are bound to the
    /// creating identity so an in-process identity swap (`import_identity`,
    /// workspace apply) can never inherit another identity's stale
    /// membership. Populated only by this process's own `create_channel`
    /// calls — a relay can never write into it — so it carries no
    /// trust-boundary risk. `get_channels` clears an entry once the real
    /// kind:39002 is observed for the current identity, keeping the set
    /// bounded and letting a later leave correctly flip the channel back to
    /// `is_member=false`.
    pub pending_owned_channels: Mutex<std::collections::HashSet<(String, String)>>,
}

/// Parse the `BUZZ_PRIVATE_KEY` env var into identity keys. `Some` means the
/// env var was present and valid and MUST win over any persisted/keyring key
/// (the dev/CI/harness override). `None` means absent or malformed — callers
/// fall through to persisted resolution. A malformed value is logged and
/// treated as absent rather than left on an ephemeral identity.
fn identity_from_env() -> Option<Keys> {
    match std::env::var("BUZZ_PRIVATE_KEY") {
        Ok(nsec) => match Keys::parse(zeroize::Zeroizing::new(nsec).trim()) {
            Ok(keys) => Some(keys),
            Err(error) => {
                eprintln!("buzz-desktop: invalid BUZZ_PRIVATE_KEY: {error}");
                None
            }
        },
        Err(std::env::VarError::NotUnicode(_)) => {
            eprintln!("buzz-desktop: BUZZ_PRIVATE_KEY contains invalid UTF-8");
            None
        }
        Err(std::env::VarError::NotPresent) => None,
    }
}

/// Build the no-redirect HTTP client used for authenticated relay media
/// fetches (download / copy).
///
/// This client is a security boundary, not a convenience: it carries a minted
/// media `Authorization` header, so it MUST NOT follow redirects. A relay 3xx
/// to an off-origin or private host would otherwise forward that header across
/// origins (a redirect-hop SSRF). `redirect::Policy::none()` returns the 3xx
/// verbatim so the caller can reject it.
///
/// Returned as a `Result` so the fail-closed invariant is testable — callers
/// must never substitute a redirect-following client on build failure. Shares
/// the localhost `resolve`/pool config with the app-wide `http_client`.
pub fn build_media_fetch_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .resolve("localhost", std::net::SocketAddr::from(([127, 0, 0, 1], 0)))
        .pool_idle_timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(1)
        .redirect(reqwest::redirect::Policy::none())
        .build()
}

pub fn build_app_state() -> AppState {
    // Env var takes precedence (dev/CI). If absent, resolve_persisted_identity()
    // in setup() will replace the ephemeral placeholder with a persisted key.
    let keys = match identity_from_env() {
        Some(keys) => {
            eprintln!(
                "buzz-desktop: configured identity pubkey {}",
                keys.public_key().to_hex()
            );
            keys
        }
        None => Keys::generate(),
    };

    AppState {
        keys: Mutex::new(keys),
        http_client: reqwest::Client::builder()
            .resolve("localhost", std::net::SocketAddr::from(([127, 0, 0, 1], 0)))
            .pool_idle_timeout(std::time::Duration::from_secs(10))
            .pool_max_idle_per_host(1)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new()),
        media_fetch_client: build_media_fetch_client().expect(
            "media_fetch_client must build with redirect::Policy::none(); a \
             redirect-following fallback would forward the minted media auth \
             header across origins (redirect-hop SSRF)",
        ),
        relay_url_override: Mutex::new(None),
        managed_agent_restore_pending: AtomicBool::new(false),
        managed_agent_profile_reconcile_enabled: AtomicBool::new(true),
        shutdown_started: AtomicBool::new(false),
        managed_agent_restore_transition: Mutex::new(()),
        identity_mutation: Mutex::new(()),
        managed_agents_store_lock: Mutex::new(()),
        channel_templates_store_lock: Mutex::new(()),
        luca_projects_store_lock: Mutex::new(()),
        continuity_lifecycle: ContinuityLifecycleLock::new(),
        continuity_runtime: Mutex::new(ContinuityRuntimeState::Uninitialized),
        managed_agent_processes: Mutex::new(HashMap::new()),
        session_config_cache: Mutex::new(HashMap::new()),
        huddle_state: Mutex::new(HuddleState::default()),
        app_handle: Mutex::new(None),
        audio_output_device: Mutex::new(None),
        media_proxy_port: AtomicU16::new(0),
        prevent_sleep: Arc::new(Mutex::new(
            crate::prevent_sleep::PreventSleepState::default(),
        )),
        keyring_locked: AtomicBool::new(false),
        identity_lost: AtomicBool::new(false),
        reset_failed: AtomicBool::new(false),
        #[cfg(feature = "mesh-llm")]
        mesh_llm_runtime: AsyncMutex::new(None),
        #[cfg(feature = "mesh-llm")]
        mesh_coordinator: AsyncMutex::new(None),
        pending_owned_channels: Mutex::new(std::collections::HashSet::new()),
        owner_brain_previews: Mutex::new(HashMap::new()),
        owner_brain_receipts: Mutex::new(VecDeque::new()),
        repository_tool_receipts: Mutex::new(VecDeque::new()),
        repository_work_lock: Mutex::new(()),
        connected_brain_discovery: Mutex::new(HashMap::new()),
        connected_brain_watcher: Default::default(),
    }
}

impl AppState {
    /// Initialize the process-owned continuity runtime once after owner
    /// identity resolution. Failure remains body-free and never blocks chat.
    pub(crate) fn initialize_continuity_runtime(
        &self,
        app_data_dir: &std::path::Path,
        owner_pubkey: luca_protocol::Hex64,
        identity_recovery_active: bool,
    ) {
        crate::luca::continuity_runtime::initialize_desktop_runtime(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            app_data_dir,
            owner_pubkey,
            identity_recovery_active,
        );
    }

    /// Execute one fixed-output, read-only continuity lease. This method keeps
    /// the runtime mutex private and prevents callers from extracting the
    /// store or returning arbitrary plaintext owners.
    pub(crate) fn read_continuity_lease<F>(
        &self,
        request: ContinuityReadLeaseRequestV1,
        consumer: F,
    ) -> ContinuityReadLeaseOutcomeV1
    where
        F: for<'lease> FnOnce(ContinuityReadLeaseViewV1<'lease>),
    {
        crate::luca::continuity_runtime::read_desktop_continuity_lease(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request,
            consumer,
        )
    }

    /// Return only the active continuity key version for the exact owner.
    /// This never creates custody and never exposes a key or memory body.
    pub(crate) fn continuity_owner_key_version(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
    ) -> Option<luca_protocol::SafeU53> {
        crate::luca::continuity_runtime::current_owner_key_version(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
        )
    }

    /// Preview one selected owner source with encrypted prior-snapshot diffing.
    pub(crate) fn preview_owner_brain_source(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        selected_path: &std::path::Path,
    ) -> Result<crate::luca::owner_brain::OwnerBrainPreviewHandleV1, OwnerBrainStoreError> {
        let prior = crate::luca::owner_brain_store::read_prior_snapshot(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            &owner_pubkey,
            selected_path,
        )?;
        crate::luca::owner_brain::create_preview_with_prior(
            &self.owner_brain_previews,
            owner_pubkey,
            selected_path,
            prior.as_ref(),
        )
        .map_err(|_| OwnerBrainStoreError::Invalid)
    }

    /// Atomically persist one exact, unexpired Owner Brain preview.
    pub(crate) fn commit_owner_brain_import(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        preview_id: &luca_protocol::OpaqueId,
        preview_token: &str,
    ) -> Result<(luca_protocol::OwnerBrainImportCommitV1, bool), OwnerBrainStoreError> {
        crate::luca::owner_brain_store::commit_preview(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            &self.owner_brain_previews,
            owner_pubkey,
            preview_id,
            preview_token,
        )
    }

    /// Cancel one preview/import before its atomic persistence claim.
    pub(crate) fn cancel_owner_brain_import(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        preview_id: &luca_protocol::OpaqueId,
        preview_token: &str,
    ) -> Result<bool, OwnerBrainStoreError> {
        crate::luca::owner_brain_store::cancel_preview(
            &self.owner_brain_previews,
            owner_pubkey,
            preview_id,
            preview_token,
        )
    }

    /// Read the owner-visible Brain catalog without exposing paths or bodies.
    pub(crate) fn read_owner_brain_catalog(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
    ) -> Result<crate::luca::owner_brain_store::OwnerBrainCatalogV1, OwnerBrainStoreError> {
        crate::luca::owner_brain_store::read_catalog(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
        )
    }

    /// Persist one exact resident/source Brain grant lifecycle action.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn mutate_owner_brain_grant(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        resident_pubkey: luca_protocol::Hex64,
        source_id: luca_protocol::OpaqueId,
        binding_ref: luca_protocol::Sha256Ref,
        provider_egress: luca_protocol::ProviderEgressV1,
        action: crate::luca::owner_brain_store::OwnerBrainGrantActionV1,
    ) -> Result<crate::luca::owner_brain_store::OwnerBrainGrantMutationResultV1, OwnerBrainStoreError>
    {
        crate::luca::owner_brain_store::mutate_grant(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            source_id,
            binding_ref,
            provider_egress,
            action,
        )
    }

    /// Perform one grant-first, bounded, read-only Brain retrieval and retain
    /// only its body-free receipts in a small process-memory activity ring.
    pub(crate) fn retrieve_owner_brain(
        &self,
        request: crate::luca::owner_brain_store::OwnerBrainRetrievalRequestV1,
    ) -> Result<crate::luca::owner_brain_store::OwnerBrainRetrievalResultV1, OwnerBrainStoreError>
    {
        let result = crate::luca::owner_brain_store::retrieve(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request,
        )?;
        if let Ok(mut receipts) = self.owner_brain_receipts.lock() {
            receipts.extend(result.receipts.iter().cloned());
            while receipts.len() > 128 {
                receipts.pop_front();
            }
        }
        Ok(result)
    }

    /// Return newest-first body-free Brain activity for the exact owner.
    pub(crate) fn owner_brain_receipts(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
    ) -> Vec<luca_protocol::OwnerBrainContextReceiptV1> {
        self.owner_brain_receipts
            .lock()
            .map(|receipts| {
                receipts
                    .iter()
                    .rev()
                    .filter(|receipt| &receipt.owner_pubkey == owner_pubkey)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Atomically persist one explicitly selected live source and its default
    /// current-resident grants. Original source bodies remain authoritative.
    pub(crate) fn connect_brain_source(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        candidate: crate::luca::connected_brain::ConnectedBrainDiscoveryCandidateV1,
        build: crate::luca::connected_brain::ConnectedBrainIndexBuildV1,
        authorities: &[crate::luca::owner_brain_store::ConnectedBrainResidentAuthorityV1],
    ) -> Result<crate::luca::owner_brain_store::ConnectedBrainConnectResultV1, OwnerBrainStoreError>
    {
        crate::luca::owner_brain_store::connect_source(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            candidate,
            build,
            authorities,
        )
    }

    /// Rebind one existing connected source to a newly selected local folder
    /// without changing its opaque identity or resident grants.
    pub(crate) fn rebind_connected_brain_source(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        source_id: luca_protocol::OpaqueId,
        candidate: crate::luca::connected_brain::ConnectedBrainDiscoveryCandidateV1,
        build: crate::luca::connected_brain::ConnectedBrainIndexBuildV1,
    ) -> Result<crate::luca::owner_brain_store::ConnectedBrainConnectResultV1, OwnerBrainStoreError>
    {
        crate::luca::owner_brain_store::rebind_source(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            candidate,
            build,
        )
    }

    /// Read body-free connected source and repository-grant inventory.
    pub(crate) fn read_connected_brain_catalog(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
    ) -> Result<crate::luca::owner_brain_store::ConnectedBrainCatalogV1, OwnerBrainStoreError> {
        crate::luca::owner_brain_store::read_connected_catalog(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
        )
    }

    /// Resolve an encrypted binding into a process-local refresh candidate.
    pub(crate) fn read_connected_brain_candidate(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
    ) -> Result<
        crate::luca::connected_brain::ConnectedBrainDiscoveryCandidateV1,
        OwnerBrainStoreError,
    > {
        crate::luca::owner_brain_store::read_connected_candidate(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
        )
    }

    /// Read bounded visible session metadata from one already-connected Brain
    /// history source. Native paths and provider session identifiers remain
    /// inside the trusted process.
    pub(crate) fn read_connected_brain_sessions(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
        budget: &mut crate::luca::connected_brain::SessionReadBudget,
    ) -> Result<crate::luca::connected_brain::IndexedSessionListV1, OwnerBrainStoreError> {
        crate::luca::owner_brain_store::read_connected_sessions(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            budget,
        )
    }

    /// Resolve an opaque local-session selection into the same bounded visible
    /// excerpts shown to the owner before a new Polyphonic conversation starts.
    pub(crate) fn read_connected_brain_session_context(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
        session_id: &luca_protocol::OpaqueId,
    ) -> Result<Option<crate::luca::connected_brain::IndexedSessionContextV1>, OwnerBrainStoreError>
    {
        crate::luca::owner_brain_store::read_connected_session_context(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            session_id,
        )
    }

    /// Materialize default access for a newly created or imported resident.
    pub(crate) fn provision_connected_brain_resident(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        authority: crate::luca::owner_brain_store::ConnectedBrainResidentAuthorityV1,
    ) -> Result<(), OwnerBrainStoreError> {
        crate::luca::owner_brain_store::provision_connected_resident(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            authority,
        )
    }

    /// Set one connected source's owner-visible fail-closed status.
    pub(crate) fn set_connected_brain_status(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
        status: luca_protocol::ConnectedBrainSourceStatusV1,
    ) -> Result<(), OwnerBrainStoreError> {
        crate::luca::owner_brain_store::set_connected_source_status(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            status,
        )
    }

    /// Disconnect immediately and physically forget current encrypted postings.
    pub(crate) fn disconnect_connected_brain_source(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
    ) -> Result<(), OwnerBrainStoreError> {
        let _work_guard = self
            .repository_work_lock
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        crate::luca::owner_brain_store::disconnect_source(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
        )
    }

    /// Rebind one resident's connected recall and repository grants to its
    /// current trusted runtime fingerprint after explicit owner review.
    pub(crate) fn reconfirm_connected_brain_source(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
        authority: crate::luca::owner_brain_store::ConnectedBrainResidentAuthorityV1,
    ) -> Result<(), OwnerBrainStoreError> {
        crate::luca::owner_brain_store::reconfirm_connected_source(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            authority,
        )
    }

    /// Revoke one resident's connected recall and repository work access.
    pub(crate) fn revoke_connected_brain_resident(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        source_id: &luca_protocol::OpaqueId,
        resident_pubkey: luca_protocol::Hex64,
    ) -> Result<(), OwnerBrainStoreError> {
        let _work_guard = self
            .repository_work_lock
            .lock()
            .map_err(|_| OwnerBrainStoreError::Unavailable)?;
        crate::luca::owner_brain_store::revoke_connected_resident(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            source_id,
            resident_pubkey,
        )
    }

    /// Return newest-first body-free repository activity for visible sources.
    pub(crate) fn repository_tool_receipts(
        &self,
        source_ids: &std::collections::BTreeSet<luca_protocol::OpaqueId>,
    ) -> Vec<luca_protocol::RepositoryToolReceiptV1> {
        self.repository_tool_receipts
            .lock()
            .map(|receipts| {
                receipts
                    .iter()
                    .rev()
                    .filter(|receipt| source_ids.contains(&receipt.source_id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    /// List repository sources authorized for one exact resident binding.
    pub(crate) fn authorized_repositories(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
        binding_ref: &luca_protocol::Sha256Ref,
    ) -> Result<Vec<crate::luca::owner_brain_store::AuthorizedRepositoryV1>, OwnerBrainStoreError>
    {
        crate::luca::owner_brain_store::read_authorized_repositories(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            binding_ref,
        )
    }

    /// Resolve one encrypted repository binding only after its exact grant.
    pub(crate) fn authorized_repository_root(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
        binding_ref: &luca_protocol::Sha256Ref,
        source_id: &luca_protocol::OpaqueId,
    ) -> Result<std::path::PathBuf, OwnerBrainStoreError> {
        crate::luca::owner_brain_store::resolve_authorized_repository_root(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            binding_ref,
            source_id,
        )
    }

    /// Commit one compact encrypted resident handoff. Every failure is
    /// fail-soft and body-free so messaging remains independent.
    pub(crate) fn commit_resident_handoff(
        &self,
        request: ResidentHandoffCommitRequestV1,
    ) -> ResidentHandoffCommitOutcomeV1 {
        crate::luca::continuity_runtime::commit_resident_handoff(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request,
        )
    }

    /// Atomically commit the V1.1 handoff and memory-note proposal.
    pub(crate) fn commit_resident_metabolism(
        &self,
        request: ResidentMetabolismCommitRequestV1,
    ) -> ResidentMetabolismCommitOutcomeV1 {
        crate::luca::resident_notebook::commit_resident_metabolism(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request,
        )
    }

    /// Commit one same-resident journal page after private cognition.
    pub(crate) fn commit_resident_journal_page(
        &self,
        request: ResidentJournalCommitRequestV1,
    ) -> ResidentNotebookMutationOutcomeV1 {
        crate::luca::resident_notebook::commit_resident_journal_page(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request,
        )
    }

    /// Explicitly disclose notebook items to an owner-facing command.
    pub(crate) fn read_resident_notebook(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
        include_history: bool,
    ) -> ResidentNotebookReadOutcomeV1 {
        crate::luca::resident_notebook::read_resident_notebook(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            include_history,
        )
    }

    /// Append a pinned owner correction to one resident memory-note lineage.
    pub(crate) fn correct_resident_memory_note(
        &self,
        owner_pubkey: luca_protocol::Hex64,
        resident_pubkey: luca_protocol::Hex64,
        target_note_id: luca_protocol::OpaqueId,
        request_id: luca_protocol::OpaqueId,
        note: luca_protocol::ResidentMemoryNoteV1,
    ) -> ResidentNotebookMutationOutcomeV1 {
        crate::luca::resident_notebook::correct_resident_memory_note(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            target_note_id,
            request_id,
            note,
        )
    }

    /// Attach a separate, visibly owner-authored annotation to a journal page.
    pub(crate) fn annotate_resident_journal_page(
        &self,
        request_id: luca_protocol::OpaqueId,
        annotation: luca_protocol::ResidentJournalAnnotationV1,
    ) -> ResidentNotebookMutationOutcomeV1 {
        crate::luca::resident_notebook::annotate_resident_journal_page(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            request_id,
            annotation,
        )
    }

    /// Archive or forget one exact resident notebook lineage.
    pub(crate) fn change_resident_notebook_lifecycle(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
        lineage_root_id: &luca_protocol::OpaqueId,
        request_id: &luca_protocol::OpaqueId,
        forget: bool,
    ) -> ResidentNotebookMutationOutcomeV1 {
        crate::luca::resident_notebook::change_resident_notebook_lifecycle(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            lineage_root_id,
            request_id,
            forget,
        )
    }

    /// Intentionally disclose the effective handoff to an owner-facing local
    /// inspector command. This path never serves normal runtime prompts.
    pub(crate) fn read_resident_handoff(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
    ) -> crate::luca::continuity_runtime::ResidentHandoffReadOutcomeV1 {
        crate::luca::continuity_runtime::read_resident_handoff(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
        )
    }

    /// Forget and physically purge the effective encrypted handoff lineage.
    pub(crate) fn forget_resident_handoff(
        &self,
        owner_pubkey: &luca_protocol::Hex64,
        resident_pubkey: &luca_protocol::Hex64,
        request_id: &luca_protocol::OpaqueId,
    ) -> crate::luca::continuity_runtime::ResidentHandoffForgetOutcomeV1 {
        crate::luca::continuity_runtime::forget_resident_handoff(
            &self.continuity_lifecycle,
            &self.continuity_runtime,
            owner_pubkey,
            resident_pubkey,
            request_id,
        )
    }

    /// Lock the huddle state mutex, converting a poisoned-lock error to a String.
    ///
    /// Convenience wrapper — replaces 15+ instances of
    /// `state.huddle_state.lock().map_err(|e| e.to_string())?` throughout the
    /// huddle module.
    pub fn huddle(&self) -> Result<std::sync::MutexGuard<'_, crate::huddle::HuddleState>, String> {
        self.huddle_state.lock().map_err(|e| e.to_string())
    }

    pub fn get_session_cache(&self, pubkey: &str) -> Option<SessionConfigCache> {
        self.session_config_cache.lock().ok()?.get(pubkey).cloned()
    }

    pub fn put_session_cache(&self, pubkey: &str, cache: SessionConfigCache) {
        if let Ok(mut map) = self.session_config_cache.lock() {
            map.insert(pubkey.to_string(), cache);
        }
    }

    pub fn clear_session_cache(&self, pubkey: &str) {
        if let Ok(mut map) = self.session_config_cache.lock() {
            map.remove(pubkey);
        }
    }

    /// Record that `channel_id` was just created by `creator_pubkey` and its
    /// kind:39002 owner membership has not yet been observed.
    pub fn mark_pending_owned_channel(&self, creator_pubkey: &str, channel_id: &str) {
        if let Ok(mut set) = self.pending_owned_channels.lock() {
            set.insert((creator_pubkey.to_string(), channel_id.to_string()));
        }
    }

    /// Whether `channel_id` is still awaiting `my_pubkey`'s kind:39002 entry.
    /// Bound to `my_pubkey` so an in-process identity swap never inherits
    /// another identity's pending-owner entry for the same channel id.
    pub fn is_pending_owned_channel(&self, my_pubkey: &str, channel_id: &str) -> bool {
        self.pending_owned_channels
            .lock()
            .map(|set| set.contains(&(my_pubkey.to_string(), channel_id.to_string())))
            .unwrap_or(false)
    }

    /// Drop the `(my_pubkey, channel_id)` entry from the pending-owner
    /// overlay once that identity's real kind:39002 membership has been
    /// observed.
    pub fn clear_pending_owned_channel(&self, my_pubkey: &str, channel_id: &str) {
        if let Ok(mut set) = self.pending_owned_channels.lock() {
            set.remove(&(my_pubkey.to_string(), channel_id.to_string()));
        }
    }

    /// Return the active identity keys if they are in a signable state.
    ///
    /// Returns `Err` when the identity is in a lost state (`identity_lost`
    /// — ephemeral key, user must re-import their nsec) or when the keyring
    /// is locked (`keyring_locked` — key is held in a keyring that is
    /// unavailable this boot). All signing and publish commands must call
    /// this instead of locking `state.keys` directly, so that recovery mode
    /// blocks publishing under an invalid or inaccessible identity.
    pub fn signing_keys(&self) -> Result<Keys, String> {
        if self
            .identity_lost
            .load(std::sync::atomic::Ordering::Acquire)
            || self
                .keyring_locked
                .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err("identity is in recovery mode; event signing is disabled \
                 until the identity is restored and Luca is relaunched"
                .to_string());
        }
        self.keys
            .lock()
            .map_err(|e| e.to_string())
            .map(|k| k.clone())
    }

    /// Emit the current huddle state to the frontend via Tauri event.
    ///
    /// Acquires both locks (app_handle + huddle_state), clones a snapshot,
    /// releases both, then emits. Best-effort — no-op if either lock is
    /// poisoned or the app_handle hasn't been set yet.
    pub fn emit_huddle_state_changed(&self) {
        let app = match self.app_handle.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };
        let Some(app) = app else { return };
        let snapshot = match self.huddle_state.lock() {
            Ok(hs) => hs.clone(),
            Err(_) => return,
        };
        crate::huddle::state::emit_huddle_state(&app, &snapshot);
    }
}

/// Resolve the user's identity key from the app data directory and wire
/// the resulting [`RecoveryState`] into `AppState`.
///
/// Priority: `BUZZ_PRIVATE_KEY` env var (already handled in `build_app_state`)
/// → keyring → `{app_data_dir}/identity.key` file → generate + save.
///
/// On success, writes the resolved keys into `state.keys` (with the mutex)
/// before storing the recovery flags (Release), so any thread that reads
/// either flag as `false` with Acquire is guaranteed to see the updated keys.
///
/// Sets `state.identity_lost` on `RecoveryState::Lost` (keyring empty after
/// migration — key gone externally) and `state.keyring_locked` on
/// `RecoveryState::KeyringLocked` (keyring unreachable — key still in keyring
/// but inaccessible this boot). Both states boot with an ephemeral key; the
/// frontend shows different recovery screens for each.
pub fn resolve_persisted_identity(app: &AppHandle, state: &AppState) -> Result<(), String> {
    // Only skip file-based resolution if the env var was present AND parsed
    // successfully. A malformed env var should fall through to the persisted
    // key rather than leaving the app on an ephemeral identity.
    if identity_from_env().is_some() {
        return Ok(());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create app data dir: {e}"))?;

    let resolved = load_or_create_identity(&data_dir)?;
    // Write keys before setting the recovery flags (Release) so any thread
    // that reads a flag as false with Acquire is guaranteed to see the keys.
    *state.keys.lock().map_err(|e| e.to_string())? = resolved.keys;
    state.identity_lost.store(
        resolved.recovery == RecoveryState::Lost,
        std::sync::atomic::Ordering::Release,
    );
    state.keyring_locked.store(
        resolved.recovery == RecoveryState::KeyringLocked,
        std::sync::atomic::Ordering::Release,
    );
    Ok(())
}

#[path = "app_state_keyring.rs"]
mod keyring_config;
pub(crate) use keyring_config::keyring_service;

mod identity;

pub(crate) use identity::persist_imported_identity;
#[cfg(test)]
use identity::*;
use identity::{load_or_create_identity, RecoveryState};

#[cfg(test)]
#[path = "app_state_tests.rs"]
mod tests;

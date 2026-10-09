use super::super::{policy::InitiativePolicyV1, schema::INITIATIVE_STORE_FILENAME};
use super::*;
use luca_protocol::{
    Hex64, InitiativeDispositionV1, InitiativePlanningDecisionV1, InitiativePlanningOutcomeV1,
    InitiativeSemanticThreadV1, InitiativeThreadKindV1, INITIATIVE_PLANNING_PROTOCOL,
    INITIATIVE_PROTOCOL, INITIATIVE_SEMANTIC_THREAD_PROTOCOL,
};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

fn id(s: &str) -> OpaqueId {
    OpaqueId::parse(s).expect("fixture ID")
}
fn number(n: u64) -> SafeU53 {
    SafeU53::new(n).expect("fixture integer")
}
fn reference(c: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", c.to_string().repeat(64))).expect("fixture ref")
}
fn timestamp(s: &str) -> CanonicalTimestamp {
    CanonicalTimestamp::parse(s).expect("fixture time")
}
fn scope() -> InitiativeRuntimeScopeV1 {
    InitiativeRuntimeScopeV1 {
        control: InitiativeControlScopeV1 {
            owner_pubkey: Hex64::parse("a".repeat(64)).expect("synthetic public owner"),
            resident_pubkey: Hex64::parse("b".repeat(64)).expect("synthetic resident"),
            window_id: id("window:fixture"),
            origin_scope_ref: reference('c'),
            now_unix_ms: 1791460800000,
        },
        binding_ref: reference('d'),
        session_epoch: number(1),
        foreground_active: false,
        outreach_authorized: false,
    }
}
fn semantic() -> InitiativeSemanticThreadV1 {
    let scope = scope();
    InitiativeSemanticThreadV1 {
        protocol: INITIATIVE_SEMANTIC_THREAD_PROTOCOL.into(),
        thread_id: id("thread:own-inquiry"),
        owner_pubkey: scope.control.owner_pubkey,
        resident_pubkey: scope.control.resident_pubkey,
        kind: InitiativeThreadKindV1::Own,
        disposition: InitiativeDispositionV1::Carried,
        revision: number(0),
        body: "PRIVATE_CARRIED_SENTINEL".into(),
        source_event_ids: Vec::new(),
        source_refs: vec![reference('e')],
        eligible_after: None,
        created_at: timestamp("2025-01-01T12:00:00Z"),
        updated_at: timestamp("2025-01-01T12:00:00Z"),
    }
}
fn private_path(temp: &tempfile::TempDir) -> std::path::PathBuf {
    let path = std::fs::canonicalize(temp.path()).expect("canonical disposable fixture");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .expect("private fixture");
    }
    path
}
fn enabled_store(temp: &tempfile::TempDir) -> InitiativeStore {
    let mut store = InitiativeStore::open(&private_path(temp).join(INITIATIVE_STORE_FILENAME))
        .expect("sentinel ledger");
    let mut policy = InitiativePolicyV1::disabled().expect("disabled default");
    policy.enabled = true;
    policy.paused = false;
    policy.revision = number(1);
    store
        .set_policy(
            &scope().control,
            &id("policy:explicit-owner-opt-in"),
            number(0),
            policy,
        )
        .expect("synthetic opt-in");
    store
}
fn prepare(store: &mut InitiativeStore) -> PreparedInitiativePlanningV1 {
    let scope = scope();
    let semantic = semantic();
    let canonical = semantic.revision_ref().expect("canonical ref");
    let input = InitiativeTickInputV1 {
        cycle: InitiativeCycleInputV1 {
            job_id: id("job:authored-one"),
            request_id: id("request:authored-one"),
            thread_id: semantic.thread_id.clone(),
            expected_thread_revision: number(1),
            canonical_revision_ref: canonical,
            dependency_ref: reference('0'),
            origin_conversation_id: None,
            budget: InitiativeTimeBudgetV1 {
                decision_ms: 1000,
                work_ms: 1000,
                return_ms: 0,
            },
            deadline_unix_ms: scope.control.now_unix_ms + 2000,
            continued_from: None,
        },
        idle_for_ms: INITIATIVE_MIN_IDLE_MS,
        evidence: Vec::new(),
        dependency_node: None,
    };
    match prepare_planning(
        store,
        &scope,
        input,
        CurrentInitiativeAdmissionV1::synthetic(&scope, semantic, reference('0')),
    )
    .expect("prepare")
    {
        InitiativePreparationV1::Prepared(prepared) => prepared,
        _ => panic!("expected prepared"),
    }
}
fn planning(request: &InitiativePlanningRequestV1) -> InitiativePlanningResultV1 {
    InitiativePlanningResultV1 {
        protocol: INITIATIVE_PLANNING_PROTOCOL.into(),
        job_id: request.job_id.clone(),
        binding_ref: request.binding_ref.clone(),
        session_epoch: request.session_epoch,
        context_ref: request.context_ref().expect("context"),
        decision: InitiativePlanningDecisionV1 {
            protocol: INITIATIVE_PROTOCOL.into(),
            request_id: request.job_id.clone(),
            owner_pubkey: request.owner_pubkey.clone(),
            resident_pubkey: request.resident_pubkey.clone(),
            thread_id: request.thread.thread_id.clone(),
            expected_revision: request.thread.revision,
            canonical_revision_ref: request.thread.canonical_revision_ref.clone(),
            result: InitiativePlanningOutcomeV1::Pursue,
        },
    }
}
fn authored(request: &InitiativePursuitRequestV1) -> InitiativePursuitResultV1 {
    InitiativePursuitResultV1 {
        protocol: INITIATIVE_PURSUIT_PROTOCOL.into(),
        job_id: request.job_id.clone(),
        owner_pubkey: request.owner_pubkey.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        thread_id: request.thread.thread_id.clone(),
        expected_revision: request.thread.revision,
        canonical_revision_ref: request.thread.canonical_revision_ref.clone(),
        binding_ref: request.binding_ref.clone(),
        session_epoch: request.session_epoch,
        context_ref: request.context_ref().expect("context"),
        result: InitiativePursuitOutcomeV1::Created {
            title: "A quiet inquiry".into(),
            markdown: "# PRIVATE_CREATION_SENTINEL\nAn authored thought.".into(),
            source_refs: vec![request.thread.canonical_revision_ref.clone()],
        },
    }
}

struct Host {
    store: RefCell<InitiativeStore>,
    artifacts: RefCell<ArtifactStore>,
    allowed: Rc<Cell<bool>>,
    held: Rc<Cell<bool>>,
    tracked: Cell<usize>,
}
impl Host {
    fn current(&self) -> CurrentInitiativeAdmissionV1 {
        CurrentInitiativeAdmissionV1::synthetic(&scope(), semantic(), reference('0'))
    }
}
struct Held<'a>(&'a Cell<bool>);
impl Drop for Held<'_> {
    fn drop(&mut self) {
        self.0.set(false);
    }
}
impl InitiativeExecutionHostV1<()> for Host {
    fn current_scope(&self) -> Result<InitiativeRuntimeScopeV1, InitiativeExecutorErrorV1> {
        Ok(scope())
    }
    fn with_current<T>(
        &self,
        _: &InitiativeRuntimeScopeV1,
        _: &PreparedInitiativePlanningV1,
        effect: impl FnOnce(
            &mut InitiativeStore,
            &CurrentInitiativeAdmissionV1,
        ) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1> {
        if !self.allowed.get() {
            return Err(InitiativeExecutorErrorV1::Unavailable);
        }
        self.held.set(true);
        let _held = Held(&self.held);
        effect(&mut self.store.borrow_mut(), &self.current())
    }
    fn with_creation<T>(
        &self,
        _: &InitiativeRuntimeScopeV1,
        _: &PreparedInitiativePlanningV1,
        _: &VerifiedInitiativePursuitV1,
        effect: impl FnOnce(
            &mut InitiativeStore,
            &mut ArtifactStore,
            InitiativeCreationModeV1,
        ) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1> {
        if !self.allowed.get() {
            return Err(InitiativeExecutorErrorV1::Unavailable);
        }
        self.held.set(true);
        let _held = Held(&self.held);
        effect(
            &mut self.store.borrow_mut(),
            &mut self.artifacts.borrow_mut(),
            InitiativeCreationModeV1::CanonicalOnly,
        )
    }
    fn with_own_inquiry<T>(
        &self, _: &InitiativeRuntimeScopeV1, _: &PreparedInitiativePlanningV1,
        _: &VerifiedInitiativePursuitV1,
        _: impl FnOnce(&mut InitiativeStore, InitiativeThreadCommitReceiptV1) -> Result<T, InitiativeExecutorErrorV1>,
    ) -> Result<T, InitiativeExecutorErrorV1> {
        // This legacy artifact-only sentinel host cannot authorize canonical Own
        // writes. The dedicated encrypted Own fixtures test that separate path.
        Err(InitiativeExecutorErrorV1::Unavailable)
    }
    fn track_cancellation(
        &self,
        _: &InitiativeRuntimeScopeV1,
        _: &OpaqueId,
        _: (),
    ) -> Result<(), InitiativeExecutorErrorV1> {
        self.tracked.set(self.tracked.get() + 1);
        Ok(())
    }
    fn clear_cancellation(&self, _: &InitiativeRuntimeScopeV1, _: &OpaqueId) {
        self.tracked.set(self.tracked.get().saturating_sub(1));
    }
    fn interrupt(&self, scope: &InitiativeControlScopeV1, job: &OpaqueId) {
        let _ = self.store.borrow_mut().interrupt_private_cycle(scope, job);
    }
}
struct Endpoint {
    held: Rc<Cell<bool>>,
    allowed: Rc<Cell<bool>>,
    revoke: bool,
    calls: Cell<usize>,
}
struct Claim {
    held: Rc<Cell<bool>>,
    allowed: Rc<Cell<bool>>,
    revoke: bool,
    result: ResidentPrivateCognitionResultV1,
}
impl InitiativePrivateClaimV1 for Claim {
    type Cancellation = ();
    fn cancellation(&self) {}
    fn wait(self) -> Result<ResidentPrivateCognitionResultV1, InitiativeExecutorErrorV1> {
        assert!(!self.held.get(), "model wait must not hold authority");
        if self.revoke {
            self.allowed.set(false);
        }
        Ok(self.result)
    }
}
impl InitiativePrivateEndpointV1 for Endpoint {
    type Claim = Claim;
    fn begin_planning(
        &self,
        request: &InitiativePlanningRequestV1,
        _: SafeU53,
    ) -> Result<Claim, InitiativeExecutorErrorV1> {
        assert!(self.held.get(), "frame must be fenced");
        self.calls.set(self.calls.get() + 1);
        Ok(Claim {
            held: self.held.clone(),
            allowed: self.allowed.clone(),
            revoke: false,
            result: ResidentPrivateCognitionResultV1::InitiativePlanning {
                result: planning(request),
            },
        })
    }
    fn begin_pursuit(
        &self,
        request: &InitiativePursuitRequestV1,
        _: SafeU53,
    ) -> Result<Claim, InitiativeExecutorErrorV1> {
        assert!(self.held.get());
        self.calls.set(self.calls.get() + 1);
        Ok(Claim {
            held: self.held.clone(),
            allowed: self.allowed.clone(),
            revoke: self.revoke,
            result: ResidentPrivateCognitionResultV1::InitiativePursuit {
                result: authored(request),
            },
        })
    }
}
fn fixture(
    revoke: bool,
) -> (
    tempfile::TempDir,
    Host,
    Endpoint,
    PreparedInitiativePlanningV1,
) {
    let temp = tempfile::tempdir().expect("isolated sentinel only");
    let mut store = enabled_store(&temp);
    let prepared = prepare(&mut store);
    let artifacts = ArtifactStore::open(&private_path(&temp))
        .expect("existing Library API in disposable fixture");
    let held = Rc::new(Cell::new(false));
    let allowed = Rc::new(Cell::new(true));
    let endpoint = Endpoint {
        held: held.clone(),
        allowed: allowed.clone(),
        revoke,
        calls: Cell::new(0),
    };
    (
        temp,
        Host {
            store: RefCell::new(store),
            artifacts: RefCell::new(artifacts),
            allowed,
            held,
            tracked: Cell::new(0),
        },
        endpoint,
        prepared,
    )
}

#[test]
fn fenced_frames_unlocked_wait_and_one_quiet_resident_authored_library_creation() {
    let (_temp, host, endpoint, prepared) = fixture(false);
    let outcome =
        execute_prepared(&host, &endpoint, prepared).expect("synthetic explicit execution");
    let InitiativeExecutionOutcomeV1::Creation(receipt) = outcome else {
        panic!("creation")
    };
    assert_eq!(endpoint.calls.get(), 2);
    assert_eq!(host.tracked.get(), 0);
    assert!(receipt
        .dependency_node
        .as_str()
        .starts_with(creations::CANONICAL_CREATION_PREFIX));
    let record = host
        .artifacts
        .borrow()
        .get(&scope().control.owner_pubkey, &receipt.artifact_id)
        .expect("quiet library metadata");
    assert_eq!(record.created_by_pubkey, "b".repeat(64));
    assert!(record.conversation_id.is_none());
    let job = host
        .store
        .borrow()
        .job(&scope().control, &id("job:authored-one"))
        .expect("job")
        .expect("current job");
    assert_eq!(job.state, InitiativeJobStateV1::Succeeded);
    assert!(job.native_task_id.is_none());
    assert_eq!(job.model_stages_reserved, 2);
    assert!(!serde_json::to_string(&job)
        .expect("operational metadata")
        .contains("PRIVATE_CREATION_SENTINEL"));
}
#[test]
fn revocation_during_unlocked_model_wait_blocks_local_creation_and_retains_uncertainty() {
    let (_temp, host, endpoint, prepared) = fixture(true);
    assert!(execute_prepared(&host, &endpoint, prepared).is_err());
    assert_eq!(endpoint.calls.get(), 2);
    let job = host
        .store
        .borrow()
        .job(&scope().control, &id("job:authored-one"))
        .expect("job")
        .expect("job");
    assert_eq!(job.state, InitiativeJobStateV1::Interrupted);
    assert_eq!(job.model_stages_reserved, 2);
    assert!(host
        .artifacts
        .borrow()
        .list(&scope().control.owner_pubkey, false, 10)
        .expect("library sentinel")
        .is_empty());
}

#[test]
fn quiet_library_retry_is_exact_job_idempotent_without_owner_import_or_another_model() {
    let (temp, _store, scope, request) = ready_store_fixture();
    let work = VerifiedInitiativePursuitV1 {
        result: authored(&request),
        request,
    };
    let mut artifacts = ArtifactStore::open(&private_path(&temp)).expect("disposable Library");
    let one = creations::persist_creation(
        &mut artifacts,
        &scope,
        &work,
        InitiativeCreationModeV1::CanonicalOnly,
    )
    .expect("first local preservation");
    let two = creations::persist_creation(
        &mut artifacts,
        &scope,
        &work,
        InitiativeCreationModeV1::CanonicalOnly,
    )
    .expect("same authored result retry");
    assert_eq!(one.artifact_id, two.artifact_id);
    assert_eq!(one.version, two.version);
    assert!(two.duplicate);
    let record = artifacts
        .get(&scope.control.owner_pubkey, &one.artifact_id)
        .expect("metadata");
    assert_eq!(
        record.created_by_pubkey,
        scope.control.resident_pubkey.as_str()
    );
    assert!(record.conversation_id.is_none());
}

pub(crate) fn ready_store_fixture() -> (
    tempfile::TempDir,
    InitiativeStore,
    InitiativeRuntimeScopeV1,
    InitiativePursuitRequestV1,
) {
    let temp = tempfile::tempdir().expect("fixture");
    let mut store = enabled_store(&temp);
    let prepared = prepare(&mut store);
    let scope = scope();
    let current = CurrentInitiativeAdmissionV1::synthetic(&scope, semantic(), reference('0'));
    admit_prepared(&mut store, &scope, &prepared, &current).expect("claim planning");
    let job = commit_planning(
        &mut store,
        &scope,
        &prepared,
        &planning(prepared.request()),
        &current,
    )
    .expect("authentic synthetic decision");
    let request = pursuit_request(&store, &scope, &prepared, &current, &job)
        .expect("current private request");
    (temp, store, scope, request)
}

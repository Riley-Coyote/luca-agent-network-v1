//! One chosen resident's default-off owned initiative loop. Initialization only
//! discovers explicit policy and recovers uncertainty; no model/source starts.
//! A separate metadata monitor preempts while the owned worker waits unlocked.

use super::{
    desktop_host::{foreground_active, runtime_scope, settle_disposition, verified_idle_ms, DesktopInitiativeExecutionHostV1},
    driver::{capture_admission, inspect_tick, prepare_planning, InitiativePreparationV1, InitiativeQuietReasonV1, InitiativeTickInputV1},
    executor::{execute_prepared, InitiativeExecutionOutcomeV1, InitiativeExecutorErrorV1, ManagedInitiativeEndpointV1},
    host_scope::home_scope,
    InitiativeControlScopeV1, InitiativeCycleInputV1, InitiativeStoreErrorV1, InitiativeTimeBudgetV1,
};
use crate::app_state::AppState;
use crate::luca::{companion_awareness::LiveAwarenessOwner, resident_notebook::InitiativeThreadHeadV1};
use luca_protocol::{Hex64, InitiativeDispositionV1, OpaqueId, SafeU53};
use std::{sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, thread::{self, JoinHandle}, time::Duration};
use tauri::{AppHandle, Manager};

const IDLE_TIMER: Duration = Duration::from_secs(60);
const CONTROL_TIMER: Duration = Duration::from_secs(5);
const DECISION_MS: u64 = 180_000;
const WORK_MS: u64 = 180_000;

/// Fail-soft body-free lifecycle outcome. CancelRequested is not a native stop
/// acknowledgement, Quiet is normal and Creation means a local shelf only.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InitiativeCoordinatorOutcomeV1 {
    Quiet(InitiativeQuietReasonV1),
    Unavailable,
    Busy,
    CancelRequested(usize),
    Completed(InitiativeExecutionOutcomeV1),
}
struct Running {
    scope: InitiativeControlScopeV1,
    job: OpaqueId,
    thread: OpaqueId,
}
struct Shared {
    closing: AtomicBool,
    busy: AtomicBool,
    target: Mutex<Option<Hex64>>,
    running: Mutex<Option<Running>>,
    last: Mutex<Option<InitiativeCoordinatorOutcomeV1>>,
    wake: mpsc::SyncSender<()>,
    control_wake: mpsc::SyncSender<()>,
}
struct Loops {
    app: AppHandle,
    shared: Arc<Shared>,
    worker: JoinHandle<()>,
    monitor: JoinHandle<()>,
}
/// Thin AppState handle. Default creates no thread/runtime/source/model. It has
/// no callbacks receiving bodies or target/model/provider selectors from content.
#[derive(Default)]
pub(crate) struct CompanionInitiativeCoordinatorV1 { inner: Mutex<Option<Loops>> }
impl CompanionInitiativeCoordinatorV1 {
    /// Restore one explicit enabled target and recover jobs metadata-only. No
    /// model on startup; initial explicit-activity floor forces fresh >=15m idle.
    pub(crate) fn initialize(&self, app: AppHandle) -> Result<(), InitiativeStoreErrorV1> {
        self.shutdown();
        let state = app.state::<AppState>();
        if state.shutdown_started.load(Ordering::Acquire) { return Err(InitiativeStoreErrorV1::Unavailable); }
        let owner = state.companion_awareness.control_owner().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        let selected = one_target(state.companion_initiative.enabled_residents(&owner)?)?;
        if let Some(resident) = &selected {
            let scope = home_scope(&state, &owner, resident)?;
            // Unknown active/interrupted work is never replayed or refunded.
            state.companion_initiative.with_control(&scope, |store| store.recover(&scope))?;
        }
        let (wake, events) = mpsc::sync_channel(1);
        let (control_wake, controls) = mpsc::sync_channel(1);
        let shared = Arc::new(Shared { closing:AtomicBool::new(false),busy:AtomicBool::new(false),target:Mutex::new(selected),running:Mutex::new(None),last:Mutex::new(None),wake,control_wake });
        let worker_app = app.clone(); let worker_shared = Arc::clone(&shared);
        let worker = thread::Builder::new().name("luca-companion-initiative".into()).spawn(move || worker_loop(worker_app, worker_shared, events)).map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let monitor_app = app.clone(); let monitor_shared = Arc::clone(&shared);
        let monitor = match thread::Builder::new().name("luca-companion-initiative-control".into()).spawn(move || control_loop(monitor_app, monitor_shared, controls)) {
            Ok(monitor) => monitor,
            Err(_) => { shared.closing.store(true,Ordering::Release); let _=shared.wake.try_send(()); let _=worker.join(); return Err(InitiativeStoreErrorV1::Unavailable); }
        };
        drop(state);
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(_) => { close_loops(Loops {app,shared,worker,monitor}); return Err(InitiativeStoreErrorV1::Unavailable); }
        };
        if app.state::<AppState>().shutdown_started.load(Ordering::Acquire) {
            drop(inner); close_loops(Loops {app,shared,worker,monitor}); return Err(InitiativeStoreErrorV1::Unavailable);
        }
        *inner = Some(Loops { app, shared, worker, monitor });
        Ok(())
    }
    /// Explicit owner policy/resident selection wakes metadata eligibility only.
    /// It cannot enable a policy, start a runtime, reset cadence or bypass idle.
    pub(crate) fn wake(&self, resident: &Hex64) -> Result<(), InitiativeStoreErrorV1> {
        let (app, shared) = self.handle()?;
        let state = app.state::<AppState>();
        let owner = state.companion_awareness.control_owner().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        let selected = one_target(state.companion_initiative.enabled_residents(&owner)?)?;
        if selected.as_ref() != Some(resident) { return Err(InitiativeStoreErrorV1::Disabled); }
        *shared.target.lock().map_err(|_| InitiativeStoreErrorV1::Unavailable)? = selected;
        let _ = shared.wake.try_send(());
        Ok(())
    }
    /// Explicit callable due check; worker/IPC never contend with ordinary chat
    /// for this coordinator lock and one compare-exchange owns the native wait.
    pub(crate) fn run_due(&self) -> Result<InitiativeCoordinatorOutcomeV1, InitiativeStoreErrorV1> {
        let (app, shared) = self.handle()?;
        Ok(run_due(&app, &shared))
    }
    /// Record actual owner interaction before its native turn. No key/input log,
    /// heartbeat or timer is treated as input. Cancels only owned initiative jobs.
    pub(crate) fn foreground_activity(&self, app: &AppHandle) -> Result<(), InitiativeStoreErrorV1> {
        let state = app.state::<AppState>();
        let now = u64::try_from(chrono::Utc::now().timestamp_millis()).map_err(|_| InitiativeStoreErrorV1::Invalid)?;
        state.companion_last_explicit_activity_ms.store(now,Ordering::Release);
        let shared = self.inner.lock().map_err(|_| InitiativeStoreErrorV1::Unavailable)?.as_ref().map(|loops| Arc::clone(&loops.shared));
        let Some(shared) = shared else { return Ok(()); };
        // Never put frame/gate/cancel/write latency on the ordinary send route.
        // The independently owned monitor wakes and performs exact preemption.
        let _=shared.control_wake.try_send(());
        Ok(())
    }
    /// Keyless exact-resident Stop/Pause request. This is not a claim the native
    /// model stopped; current frame gate denial precedes cancellation requests.
    pub(crate) fn resident_stop(&self, resident: &Hex64) -> Result<usize, InitiativeStoreErrorV1> {
        let (app,shared)=self.handle()?; let state=app.state::<AppState>();
        let owner=state.companion_awareness.control_owner().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        let scope=home_scope(&state,&owner,resident)?;
        let count=state.companion_execution.pause(&scope)?;
        state.companion_initiative.with_control(&scope,|store|store.cancel_owned(&scope))?;
        if let Ok(mut last)=shared.last.lock() { *last=Some(InitiativeCoordinatorOutcomeV1::CancelRequested(count)); }
        Ok(count)
    }
    /// Last body-free local lifecycle state, never model prose or a welfare meter.
    pub(crate) fn status(&self) -> Option<InitiativeCoordinatorOutcomeV1> {
        let shared=self.inner.lock().ok()?.as_ref().map(|loops|Arc::clone(&loops.shared))?;
        let last=shared.last.lock().ok()?.clone();
        last
    }
    /// Actual owned current job/thread references, never native PIDs or a claim
    /// of accepted/stopped work. Useful for an exact user Stop control.
    pub(crate) fn active_job(&self) -> Option<(Hex64,OpaqueId,OpaqueId)> {
        let shared=self.inner.lock().ok()?.as_ref().map(|loops|Arc::clone(&loops.shared))?;
        let running=shared.running.lock().ok()?;
        running.as_ref().map(|running|(running.scope.resident_pubkey.clone(),running.job.clone(),running.thread.clone()))
    }
    fn handle(&self)->Result<(AppHandle,Arc<Shared>),InitiativeStoreErrorV1> {
        let inner=self.inner.lock().map_err(|_|InitiativeStoreErrorV1::Unavailable)?;
        let loops=inner.as_ref().ok_or(InitiativeStoreErrorV1::Unavailable)?;
        if loops.shared.closing.load(Ordering::Acquire) {return Err(InitiativeStoreErrorV1::Unavailable);}
        Ok((loops.app.clone(),Arc::clone(&loops.shared)))
    }
    /// Owns cancellation, wake and join. Must run outside authority locks. No
    /// native PID/global task enumeration and no dropping a live untracked wait.
    pub(crate) fn shutdown(&self) {
        let loops=self.inner.lock().ok().and_then(|mut inner|inner.take());
        if let Some(loops)=loops {close_loops(loops);}
    }
}
impl Drop for CompanionInitiativeCoordinatorV1 {fn drop(&mut self){self.shutdown();}}
fn one_target(mut residents:Vec<Hex64>)->Result<Option<Hex64>,InitiativeStoreErrorV1> {
    residents.sort();residents.dedup();
    match residents.len(){0=>Ok(None),1=>Ok(residents.pop()),_=>Err(InitiativeStoreErrorV1::Scope)}
}
struct BusyGuard(Arc<Shared>);
impl Drop for BusyGuard {
    fn drop(&mut self){if let Ok(mut running)=self.0.running.lock(){*running=None;}self.0.busy.store(false,Ordering::Release);}
}
fn run_due(app:&AppHandle,shared:&Arc<Shared>)->InitiativeCoordinatorOutcomeV1 {
    if shared.closing.load(Ordering::Acquire)||app.state::<AppState>().shutdown_started.load(Ordering::Acquire){return InitiativeCoordinatorOutcomeV1::Unavailable;}
    if shared.busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err(){return InitiativeCoordinatorOutcomeV1::Busy;}
    let _busy=BusyGuard(Arc::clone(shared));
    let outcome=run_due_inner(app,shared).unwrap_or_else(|error|match error {
        InitiativeExecutorErrorV1::Busy=>InitiativeCoordinatorOutcomeV1::Busy,
        InitiativeExecutorErrorV1::Ledger(InitiativeStoreErrorV1::Disabled)=>InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::Disabled),
        _=>InitiativeCoordinatorOutcomeV1::Unavailable,
    });
    if let Ok(mut last)=shared.last.lock(){*last=Some(outcome.clone());}
    outcome
}
fn run_due_inner(app:&AppHandle,shared:&Arc<Shared>)->Result<InitiativeCoordinatorOutcomeV1,InitiativeExecutorErrorV1> {
    let state=app.state::<AppState>();
    let owner=state.companion_awareness.control_owner().ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    let target=one_target(state.companion_initiative.enabled_residents(&owner)?)?;
    let Some(resident)=target else{return Ok(InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::Disabled));};
    *shared.target.lock().map_err(|_|InitiativeExecutorErrorV1::Unavailable)?=Some(resident.clone());
    let control=home_scope(&state,&owner,&resident)?;
    let policy=state.companion_initiative.with_control(&control,|store|store.policy(&control))?;
    if !policy.enabled||policy.paused||!policy.allow_local_creations{return Ok(InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::Disabled));}
    // Do not touch native/canonical bodies or OS APIs on a disabled policy.
    let scope=runtime_scope(app,&resident)?;
    let idle=verified_idle_ms(&state,scope.control.now_unix_ms).ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    let quiet=state.companion_initiative.with_control(&scope.control,|store|Ok(inspect_tick(store,&scope,idle)))??;
    if let Some(reason)=quiet{return Ok(InitiativeCoordinatorOutcomeV1::Quiet(reason));}
    if scope.foreground_active{return Ok(InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::RecentActivity));}
    let snapshot=state.read_resident_initiative_threads(&owner,&resident,false).map_err(|_|InitiativeExecutorErrorV1::Unavailable)?.ok_or(InitiativeExecutorErrorV1::Unavailable)?;
    let now=chrono::DateTime::from_timestamp_millis(i64::try_from(scope.control.now_unix_ms).map_err(|_|InitiativeExecutorErrorV1::Invalid)?).ok_or(InitiativeExecutorErrorV1::Invalid)?;
    let now=luca_protocol::CanonicalTimestamp::parse(now.to_rfc3339_opts(chrono::SecondsFormat::Secs,true)).map_err(|_|InitiativeExecutorErrorV1::Invalid)?;
    let mut heads=snapshot.threads.into_iter().filter(|view|view.is_current&&(view.canonical_source_clean||view.canonical_own_authorship)&&matches!(view.thread.disposition,InitiativeDispositionV1::Carried|InitiativeDispositionV1::Deferred)&&view.thread.eligible_after.as_ref().is_none_or(|after|after<=&now)).collect::<Vec<_>>();
    let attempts=state.companion_initiative.with_control(&scope.control,|store|store.latest_attempt_for_threads(&scope.control))?;
    heads.sort_by(|left,right|head_priority(&attempts,&left.thread.thread_id,&left.thread.updated_at,&right.thread.thread_id,&right.thread.updated_at));
    let Some(head)=heads.into_iter().next()else{return Ok(InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::Unavailable));};
    let job=OpaqueId::parse(format!("initiative-job-{}",uuid::Uuid::new_v4())).map_err(|_|InitiativeExecutorErrorV1::Invalid)?;
    // Missing/unavailable awareness never prevents useful canonical work.
    // No fresh source is fetched merely to fill an evidence quota.
    let (evidence, dependency_node) = super::observed_evidence::prepare(&state, &scope, &job)
        .unwrap_or_else(|_| (Vec::new(), None));
    let host=DesktopInitiativeExecutionHostV1::new(app.clone(),resident.clone(),head.thread.thread_id.clone(),&evidence);
    let current=capture_admission(&host,&scope,&head.thread.thread_id,&evidence,dependency_node.as_ref())?;
    let dependency_ref=current.dependency_ref().clone();
    let canonical=current.semantic().revision_ref().map_err(|_|InitiativeExecutorErrorV1::Invalid)?;
    let revision=state.companion_initiative.with_control(&scope.control,|store|Ok(store.thread(&scope.control,&head.thread.thread_id)?.map(|thread|thread.revision)))?.unwrap_or(SafeU53::new(1).map_err(|_|InitiativeExecutorErrorV1::Invalid)?);
    let request=OpaqueId::parse(format!("initiative-cycle-{}",uuid::Uuid::new_v4())).map_err(|_|InitiativeExecutorErrorV1::Invalid)?;
    let cycle=InitiativeCycleInputV1 {job_id:job.clone(),request_id:request,thread_id:head.thread.thread_id.clone(),expected_thread_revision:revision,canonical_revision_ref:canonical.clone(),dependency_ref,
        origin_conversation_id:None,budget:InitiativeTimeBudgetV1 {decision_ms:DECISION_MS,work_ms:WORK_MS,return_ms:0},deadline_unix_ms:scope.control.now_unix_ms.checked_add(DECISION_MS+WORK_MS).ok_or(InitiativeExecutorErrorV1::Invalid)?,continued_from:None};
    let live=LiveAwarenessOwner::authenticate(&state).map_err(|_|InitiativeExecutorErrorV1::Unavailable)?;
    let preparation=state.companion_initiative.with_live(&live,&scope.control,|store|Ok(prepare_planning(store,&scope,InitiativeTickInputV1 {cycle,idle_for_ms:idle,evidence,dependency_node},current)))??;
    let prepared=match preparation {
        InitiativePreparationV1::Quiet(reason)=>return Ok(InitiativeCoordinatorOutcomeV1::Quiet(reason)),
        InitiativePreparationV1::PreemptionRequested(_)=>{let _=state.companion_execution.preempt(&scope.control);return Ok(InitiativeCoordinatorOutcomeV1::Quiet(InitiativeQuietReasonV1::RecentActivity));},
        InitiativePreparationV1::Prepared(prepared)=>prepared,
    };
    *shared.running.lock().map_err(|_|InitiativeExecutorErrorV1::Unavailable)?=Some(Running {scope:scope.control.clone(),job:job.clone(),thread:head.thread.thread_id.clone()});
    let _=shared.control_wake.try_send(());
    if shared.closing.load(Ordering::Acquire)||state.shutdown_started.load(Ordering::Acquire) {
        let _=state.companion_initiative.with_control(&scope.control,|store|store.cancel_owned(&scope.control));
        return Err(InitiativeExecutorErrorV1::Unavailable);
    }
    let expected=InitiativeThreadHeadV1 {record_id:head.record_id,revision:head.thread.revision};
    drop(state);
    // The executor waits outside every authority lock; the independent control
    // thread remains free to observe real input and cancel this exact owned job.
    let outcome=execute_prepared(&host,&ManagedInitiativeEndpointV1,prepared)?;
    if matches!(outcome,InitiativeExecutionOutcomeV1::Deferred|InitiativeExecutionOutcomeV1::Declined|InitiativeExecutionOutcomeV1::Retired) {
        let state=app.state::<AppState>();let control=home_scope(&state,&owner,&resident)?;
        settle_disposition(app,&control,&job,&expected,&canonical)?;
    }
    Ok(InitiativeCoordinatorOutcomeV1::Completed(outcome))
}

// Opportunity, not a quota: least-recently-attempted eligible head first. A new
// Own root cannot be stranded by its still-Carried older shared parent. Denied,
// closed and future-deferred heads are removed before this body-free ordering.
fn head_priority(attempts:&std::collections::BTreeMap<OpaqueId,u64>,left:&OpaqueId,left_updated:&luca_protocol::CanonicalTimestamp,right:&OpaqueId,right_updated:&luca_protocol::CanonicalTimestamp)->std::cmp::Ordering {
    attempts.get(left).cmp(&attempts.get(right)).then_with(||left_updated.cmp(right_updated)).then_with(||left.cmp(right))
}
fn preempt_current(app:&AppHandle,shared:&Shared)->Result<usize,InitiativeStoreErrorV1> {
    let scope=shared.running.lock().map_err(|_|InitiativeStoreErrorV1::Unavailable)?.as_ref().map(|running|running.scope.clone());
    let Some(mut scope)=scope else{return Ok(0);};
    scope.now_unix_ms=u64::try_from(chrono::Utc::now().timestamp_millis()).map_err(|_|InitiativeStoreErrorV1::Invalid)?;
    let state=app.state::<AppState>();
    let count=state.companion_execution.preempt(&scope)?;
    state.companion_initiative.with_control(&scope,|store|store.cancel_owned(&scope))?;
    Ok(count)
}
fn worker_loop(app:AppHandle,shared:Arc<Shared>,events:mpsc::Receiver<()>) {
    while !shared.closing.load(Ordering::Acquire) {
        let _=events.recv_timeout(IDLE_TIMER);
        if shared.closing.load(Ordering::Acquire)||app.state::<AppState>().shutdown_started.load(Ordering::Acquire){break;}
        let _=run_due(&app,&shared);
    }
}
fn control_loop(app:AppHandle,shared:Arc<Shared>,events:mpsc::Receiver<()>) {
    while !shared.closing.load(Ordering::Acquire) {
        let _=events.recv_timeout(CONTROL_TIMER);
        if shared.closing.load(Ordering::Acquire)||app.state::<AppState>().shutdown_started.load(Ordering::Acquire){break;}
        if !shared.busy.load(Ordering::Acquire){continue;}
        let target=shared.target.lock().ok().and_then(|target|target.clone());
        let Some(resident)=target else{continue;};
        let now=u64::try_from(chrono::Utc::now().timestamp_millis());
        if now.is_err()||now.is_ok_and(|now|foreground_active(&app,&resident,now)){let _=preempt_current(&app,&shared);}
    }
}
fn close_loops(loops:Loops) {
    loops.shared.closing.store(true,Ordering::Release);
    let _=preempt_current(&loops.app,&loops.shared);
    let _=loops.shared.wake.try_send(());let _=loops.shared.control_wake.try_send(());
    let _=loops.monitor.join();let _=loops.worker.join();
}

#[cfg(test)]
#[path="coordinator_tests.rs"]
mod tests;

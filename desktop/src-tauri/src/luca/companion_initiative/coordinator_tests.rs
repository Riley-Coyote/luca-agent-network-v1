//! Pure lifecycle/sentinel checks only, no native AppHandle/model/work launch.
use super::*;
use super::super::driver::{INITIATIVE_CADENCE_MS,INITIATIVE_MIN_IDLE_MS};

fn resident(value:&str)->Hex64 {Hex64::parse(value.repeat(64)).unwrap()}
fn shared()->Arc<Shared> {
    let (wake,_)=mpsc::sync_channel(1);let(control_wake,_)=mpsc::sync_channel(1);
    Arc::new(Shared {closing:AtomicBool::new(false),busy:AtomicBool::new(false),target:Mutex::new(None),running:Mutex::new(None),last:Mutex::new(None),wake,control_wake})
}
#[test]
fn no_enabled_target_is_quiet_and_multiple_targets_never_fan_out() {
    assert!(one_target(Vec::new()).unwrap().is_none());
    assert_eq!(one_target(vec![resident("a")]).unwrap(),Some(resident("a")));
    assert_eq!(one_target(vec![resident("a"),resident("b")]),Err(InitiativeStoreErrorV1::Scope));
}
#[test]
fn default_coordinator_starts_no_loop_and_shutdown_is_idempotent() {
    let coordinator=CompanionInitiativeCoordinatorV1::default();
    assert!(coordinator.inner.lock().unwrap().is_none());assert!(coordinator.status().is_none());
    coordinator.shutdown();coordinator.shutdown();assert!(coordinator.inner.lock().unwrap().is_none());
}
#[test]
fn one_owned_wait_claim_releases_on_early_error_without_catch_up() {
    let shared=shared();
    assert!(shared.busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_ok());
    let guard=BusyGuard(Arc::clone(&shared));
    assert!(shared.busy.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).is_err());
    drop(guard);assert!(!shared.busy.load(Ordering::Acquire));assert!(shared.running.lock().unwrap().is_none());
    assert_eq!(IDLE_TIMER,Duration::from_secs(60));assert_eq!(INITIATIVE_CADENCE_MS,4*60*60*1000);assert_eq!(INITIATIVE_MIN_IDLE_MS,15*60*1000);
}
#[test]
fn budgets_reserve_decision_and_authorship_separately_with_no_outreach_quota() {
    let budget=InitiativeTimeBudgetV1 {decision_ms:DECISION_MS,work_ms:WORK_MS,return_ms:0};
    assert_eq!(budget.model_stages(),2);assert_eq!(budget.total_ms().unwrap(),360_000);
    let policy=super::super::InitiativePolicyV1::disabled().unwrap();
    assert!(!policy.enabled&&policy.paused&&!policy.allow_local_creations);assert_eq!(policy.max_outreach_per_24h,0);
}

#[test]
fn independent_own_root_gets_an_opportunity_without_resetting_cadence_or_reopening_closed_work() {
    let shared=OpaqueId::parse("shared:older-carried").unwrap();let own=OpaqueId::parse("own:native-authored").unwrap();
    let old=luca_protocol::CanonicalTimestamp::parse("2026-01-01T10:00:00Z").unwrap();let new=luca_protocol::CanonicalTimestamp::parse("2026-10-08T12:00:00Z").unwrap();
    let mut attempts=std::collections::BTreeMap::new();attempts.insert(shared.clone(),1000);
    assert_eq!(head_priority(&attempts,&own,&new,&shared,&old),std::cmp::Ordering::Less);
    attempts.insert(own.clone(),2000);
    assert_eq!(head_priority(&attempts,&own,&new,&shared,&old),std::cmp::Ordering::Greater);
    assert_eq!(INITIATIVE_CADENCE_MS,4*60*60*1000);
}

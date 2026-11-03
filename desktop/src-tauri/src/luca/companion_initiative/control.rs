//! Exact owned background cancellation. Never enumerates D0-D6 tasks/processes.
use super::{InitiativeControlScopeV1, InitiativeRuntimeScopeV1, InitiativeStoreErrorV1};
use crate::luca::{
    companion_awareness::AwarenessGrantKeyV1, managed_cognition::ManagedInitiativeCancellation,
};
use luca_protocol::{Hex64, OpaqueId};
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

type Principal = (Hex64, Hex64);
type JobKey = (Hex64, Hex64, OpaqueId);
#[derive(Default)]
struct Gate {
    denied: HashSet<Principal>,
    denial_generations: HashMap<Principal, u64>,
}
struct Tracked {
    scope: InitiativeRuntimeScopeV1,
    job_id: OpaqueId,
    thread_id: OpaqueId,
    dependencies: Vec<AwarenessGrantKeyV1>,
    cancellation: ManagedInitiativeCancellation,
}
/// One process-only denial gate and owned handles. Restart is handled by the
/// durable ledger; these handles are not serialized or reused in another epoch.
#[derive(Default)]
pub(crate) struct InitiativeExecutionControlV1 {
    gate: Mutex<Gate>,
    pending: Mutex<HashMap<JobKey, Tracked>>,
}
impl InitiativeExecutionControlV1 {
    pub(crate) fn denial_generation(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<u64, InitiativeStoreErrorV1> {
        let gate = self
            .gate
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        Ok(*gate
            .denial_generations
            .get(&(scope.owner_pubkey.clone(), scope.resident_pubkey.clone()))
            .unwrap_or(&0))
    }

    /// Caller holds live identity before this gate. Commit and resume are one
    /// short critical section: an intervening Pause can never be overwritten
    /// by an older review, including a keyless Pause whose disk write failed.
    pub(crate) fn commit_reviewed_resume<T>(
        &self,
        scope: &InitiativeControlScopeV1,
        expected_generation: u64,
        resume: bool,
        commit: impl FnOnce() -> Result<T, InitiativeStoreErrorV1>,
    ) -> Result<T, InitiativeStoreErrorV1> {
        let mut gate = self
            .gate
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let principal = (scope.owner_pubkey.clone(), scope.resident_pubkey.clone());
        if *gate.denial_generations.get(&principal).unwrap_or(&0) != expected_generation {
            return Err(InitiativeStoreErrorV1::Stale);
        }
        let value = commit()?;
        if resume {
            gate.denied.remove(&principal);
        }
        Ok(value)
    }
    /// Body-free effective pause status. Saved policy alone does not represent
    /// a later keyless Pause; observation Resume does not clear this gate.
    pub(crate) fn is_paused(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<bool, InitiativeStoreErrorV1> {
        Ok(self
            .gate
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?
            .denied
            .contains(&(scope.owner_pubkey.clone(), scope.resident_pubkey.clone())))
    }
    /// Acquire after canonical authority, before awareness/ledger. Pause marks
    /// denial through this same short gate before it returns. No model wait.
    pub(crate) fn with_running<T>(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        effect: impl FnOnce() -> Result<T, InitiativeStoreErrorV1>,
    ) -> Result<T, InitiativeStoreErrorV1> {
        let gate = self
            .gate
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        if gate.denied.contains(&(
            scope.control.owner_pubkey.clone(),
            scope.control.resident_pubkey.clone(),
        )) {
            return Err(InitiativeStoreErrorV1::Disabled);
        }
        effect()
    }
    pub(crate) fn track(
        &self,
        scope: &InitiativeRuntimeScopeV1,
        job: &OpaqueId,
        thread: &OpaqueId,
        dependencies: Vec<AwarenessGrantKeyV1>,
        cancellation: ManagedInitiativeCancellation,
    ) -> Result<(), InitiativeStoreErrorV1> {
        if dependencies.iter().any(|key| {
            key.source.owner_pubkey != scope.control.owner_pubkey
                || key.resident_pubkey != scope.control.resident_pubkey
        }) {
            return Err(InitiativeStoreErrorV1::Scope);
        }
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
        let key = (
            scope.control.owner_pubkey.clone(),
            scope.control.resident_pubkey.clone(),
            job.clone(),
        );
        if pending.contains_key(&key) || pending.len() >= 32 {
            return Err(InitiativeStoreErrorV1::Conflict);
        }
        pending.insert(
            key,
            Tracked {
                scope: scope.clone(),
                job_id: job.clone(),
                thread_id: thread.clone(),
                dependencies,
                cancellation,
            },
        );
        Ok(())
    }
    pub(crate) fn clear(&self, scope: &InitiativeRuntimeScopeV1, job: &OpaqueId) {
        if let Ok(mut pending) = self.pending.lock() {
            let key = (
                scope.control.owner_pubkey.clone(),
                scope.control.resident_pubkey.clone(),
                job.clone(),
            );
            if pending.get(&key).is_some_and(|tracked| {
                tracked.scope.binding_ref == scope.binding_ref
                    && tracked.scope.session_epoch == scope.session_epoch
            }) {
                pending.remove(&key);
            }
        }
    }
    /// Keyless stop always establishes in-memory denial even if a durable write
    /// subsequently fails. Sending cancellation is not proof the native model stopped.
    pub(crate) fn pause(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        {
            let mut gate = self
                .gate
                .lock()
                .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
            let principal = (scope.owner_pubkey.clone(), scope.resident_pubkey.clone());
            gate.denied.insert(principal.clone());
            let generation = gate.denial_generations.entry(principal).or_default();
            *generation = generation
                .checked_add(1)
                .ok_or(InitiativeStoreErrorV1::Unavailable)?;
        }
        self.cancel_matching(|tracked| {
            tracked.scope.control.owner_pubkey == scope.owner_pubkey
                && tracked.scope.control.resident_pubkey == scope.resident_pubkey
        })
    }
    /// Caller first commits an explicit live owner Resume policy successfully.
    pub(crate) fn resume(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<(), InitiativeStoreErrorV1> {
        self.gate
            .lock()
            .map_err(|_| InitiativeStoreErrorV1::Unavailable)?
            .denied
            .remove(&(scope.owner_pubkey.clone(), scope.resident_pubkey.clone()));
        Ok(())
    }
    /// Foreground priority cancels current owned work without disabling future
    /// initiative. Durable preemption and OS idle/cadence prevent immediate retry.
    pub(crate) fn preempt(
        &self,
        scope: &InitiativeControlScopeV1,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        let handles = {
            // A foreground boundary cannot miss a frame that is in the middle
            // of installing its owned cancellation handle.
            let _gate = self
                .gate
                .lock()
                .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
            self.take_matching(|tracked| {
                tracked.scope.control.owner_pubkey == scope.owner_pubkey
                    && tracked.scope.control.resident_pubkey == scope.resident_pubkey
            })?
        };
        Ok(Self::request_cancellations(handles))
    }
    pub(crate) fn withdraw_grant(
        &self,
        key: &AwarenessGrantKeyV1,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        self.cancel_matching(|tracked| tracked.dependencies.contains(key))
    }
    /// Exact private initiative job interruption, never a resident/D0 scan.
    pub(crate) fn cancel_job(
        &self,
        scope: &InitiativeControlScopeV1,
        job: &OpaqueId,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        let handles = {
            let _gate = self
                .gate
                .lock()
                .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
            self.take_matching(|tracked| {
                tracked.scope.control.owner_pubkey == scope.owner_pubkey
                    && tracked.scope.control.resident_pubkey == scope.resident_pubkey
                    && &tracked.job_id == job
            })?
        };
        Ok(Self::request_cancellations(handles))
    }
    /// Owner-retired shared lineage stops only its currently owned worker.
    /// Sending cancellation does not certify native acknowledgement/stoppage.
    pub(crate) fn retire_thread(
        &self,
        scope: &InitiativeControlScopeV1,
        thread: &OpaqueId,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        let handles = {
            let _gate = self
                .gate
                .lock()
                .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
            self.take_matching(|tracked| {
                tracked.scope.control.owner_pubkey == scope.owner_pubkey
                    && tracked.scope.control.resident_pubkey == scope.resident_pubkey
                    && &tracked.thread_id == thread
            })?
        };
        Ok(Self::request_cancellations(handles))
    }
    fn cancel_matching(
        &self,
        predicate: impl Fn(&Tracked) -> bool,
    ) -> Result<usize, InitiativeStoreErrorV1> {
        let handles = self.take_matching(predicate)?;
        Ok(Self::request_cancellations(handles))
    }

    fn take_matching(
        &self,
        predicate: impl Fn(&Tracked) -> bool,
    ) -> Result<Vec<ManagedInitiativeCancellation>, InitiativeStoreErrorV1> {
        let handles = {
            let mut pending = self
                .pending
                .lock()
                .map_err(|_| InitiativeStoreErrorV1::Unavailable)?;
            let keys = pending
                .iter()
                .filter(|(_, tracked)| predicate(tracked))
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| pending.remove(&key))
                .map(|tracked| tracked.cancellation)
                .collect::<Vec<_>>()
        };
        Ok(handles)
    }

    fn request_cancellations(handles: Vec<ManagedInitiativeCancellation>) -> usize {
        let count = handles.len();
        for handle in handles {
            let _ = handle.cancel();
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn scope() -> InitiativeRuntimeScopeV1 {
        InitiativeRuntimeScopeV1 {
            control: InitiativeControlScopeV1 {
                owner_pubkey: Hex64::parse("a".repeat(64)).unwrap(),
                resident_pubkey: Hex64::parse("b".repeat(64)).unwrap(),
                window_id: OpaqueId::parse("home").unwrap(),
                origin_scope_ref: luca_protocol::Sha256Ref::parse(format!(
                    "sha256:{}",
                    "c".repeat(64)
                ))
                .unwrap(),
                now_unix_ms: 1,
            },
            binding_ref: luca_protocol::Sha256Ref::parse(format!("sha256:{}", "d".repeat(64)))
                .unwrap(),
            session_epoch: luca_protocol::SafeU53::new(1).unwrap(),
            foreground_active: false,
            outreach_authorized: false,
        }
    }
    #[test]
    fn pause_denies_frame_without_model_and_explicit_resume_clears_only_exact_resident() {
        let control = InitiativeExecutionControlV1::default();
        let scope = scope();
        assert!(!control.is_paused(&scope.control).unwrap());
        assert!(control.with_running(&scope, || Ok(())).is_ok());
        assert_eq!(control.pause(&scope.control).unwrap(), 0);
        assert!(control.is_paused(&scope.control).unwrap());
        assert!(control.with_running(&scope, || Ok(())).is_err());
        let mut other = scope.clone();
        other.control.resident_pubkey = Hex64::parse("e".repeat(64)).unwrap();
        assert!(!control.is_paused(&other.control).unwrap());
        control.resume(&other.control).unwrap();
        assert!(control.is_paused(&scope.control).unwrap());
        assert!(control.with_running(&scope, || Ok(())).is_err());
        control.resume(&scope.control).unwrap();
        assert!(!control.is_paused(&scope.control).unwrap());
        assert!(control.with_running(&scope, || Ok(())).is_ok());
    }

    #[test]
    fn each_pause_invalidates_an_older_review_even_if_already_paused() {
        let control = InitiativeExecutionControlV1::default();
        let scope = scope();
        let first = control.denial_generation(&scope.control).unwrap();
        control.pause(&scope.control).unwrap();
        let second = control.denial_generation(&scope.control).unwrap();
        control.pause(&scope.control).unwrap();
        assert_ne!(first, second);
        assert_ne!(second, control.denial_generation(&scope.control).unwrap());
        let mut committed = false;
        assert!(control
            .commit_reviewed_resume(&scope.control, second, true, || {
                committed = true;
                Ok(())
            })
            .is_err());
        assert!(!committed);
        assert!(control.is_paused(&scope.control).unwrap());
        let generation = control.denial_generation(&scope.control).unwrap();
        assert!(control
            .commit_reviewed_resume(&scope.control, generation, true, || Err::<(), _>(
                InitiativeStoreErrorV1::Stale
            ))
            .is_err());
        assert!(control.is_paused(&scope.control).unwrap());
        control
            .commit_reviewed_resume(&scope.control, generation, false, || Ok(()))
            .unwrap();
        assert!(control.is_paused(&scope.control).unwrap());
        control
            .commit_reviewed_resume(&scope.control, generation, true, || Ok(()))
            .unwrap();
        assert!(!control.is_paused(&scope.control).unwrap());
    }

    #[test]
    fn reviewed_commit_and_resume_linearize_before_a_concurrent_pause() {
        use std::sync::{mpsc, Arc};
        let control = Arc::new(InitiativeExecutionControlV1::default());
        let scope = scope();
        let generation = control.denial_generation(&scope.control).unwrap();
        let (entered, wait_entered) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let writer = Arc::clone(&control);
        let writer_scope = scope.control.clone();
        let thread = std::thread::spawn(move || {
            writer.commit_reviewed_resume(&writer_scope, generation, true, || {
                entered.send(()).unwrap();
                wait_release
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap();
                Ok(())
            })
        });
        wait_entered
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let stopper = Arc::clone(&control);
        let stop_scope = scope.control.clone();
        let pause = std::thread::spawn(move || stopper.pause(&stop_scope));
        release.send(()).unwrap();
        thread.join().unwrap().unwrap();
        pause.join().unwrap().unwrap();
        assert!(control.is_paused(&scope.control).unwrap());
        let mut other = scope.control.clone();
        other.resident_pubkey = Hex64::parse("e".repeat(64)).unwrap();
        assert_eq!(control.denial_generation(&other).unwrap(), 0);
        control
            .commit_reviewed_resume(&other, 0, true, || Ok(()))
            .unwrap();
        assert!(control.is_paused(&scope.control).unwrap());
    }
}

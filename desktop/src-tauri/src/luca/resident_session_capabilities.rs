//! Current native capability facts for managed resident sessions.

use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use luca_protocol::{Hex64, ResidentSessionCapabilityV1, SafeU53};
use tauri::{AppHandle, Emitter};

pub(crate) const CAPABILITY_EVENT: &str = "luca://resident-session-capabilities";

static SNAPSHOTS: OnceLock<Mutex<HashMap<String, ResidentSessionCapabilityV1>>> = OnceLock::new();

fn snapshots() -> &'static Mutex<HashMap<String, ResidentSessionCapabilityV1>> {
    SNAPSHOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn observe(
    app: &AppHandle,
    expected_resident: &Hex64,
    expected_epoch: SafeU53,
    snapshot: ResidentSessionCapabilityV1,
) -> bool {
    if snapshot.validate().is_err()
        || snapshot.resident_pubkey != *expected_resident
        || snapshot.session_epoch != expected_epoch
    {
        return false;
    }
    let accepted = snapshots().lock().is_ok_and(|mut entries| {
        let key = snapshot.resident_pubkey.as_str().to_owned();
        if entries
            .get(&key)
            .is_some_and(|current| current.session_epoch.get() > snapshot.session_epoch.get())
        {
            return false;
        }
        entries.insert(key, snapshot.clone());
        true
    });
    if accepted {
        let _ = app.emit(CAPABILITY_EVENT, snapshot);
    }
    accepted
}

pub(crate) fn current(resident_pubkey: &str) -> Option<ResidentSessionCapabilityV1> {
    snapshots()
        .lock()
        .ok()
        .and_then(|entries| entries.get(resident_pubkey).cloned())
}

pub(crate) fn clear_session(resident_pubkey: &str, session_epoch: u64) {
    if let Ok(mut entries) = snapshots().lock() {
        if entries
            .get(resident_pubkey)
            .is_some_and(|snapshot| snapshot.session_epoch.get() == session_epoch)
        {
            entries.remove(resident_pubkey);
        }
    }
}

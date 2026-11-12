//! Body-free admission records. A root is one host-attested owner event, never
//! the prompt, the foreground room, or an ID returned by the model.
use super::{
    delegation, delivery, storage, AppHandle, BuzzPathExt, Manager, RuntimeTaskAccessScopeV1,
};
use luca_protocol::{Hex64, Sha256Ref};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{File, OpenOptions},
    io::ErrorKind,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const UNAVAILABLE: &str = "Task approval storage is unavailable. Nothing new was launched.";
const MAX_GRANTS: usize = 128;
const MAX_STATE: usize = 64 * 1024;

#[derive(Clone)]
pub(super) struct Root {
    pub(super) task_id: String,
    folder: PathBuf,
    digest: String,
    pub(super) generation: Uuid,
    // Kept by the host for the pending launch, never supplied by a caller or re-created from a label.
    origin: Option<(RuntimeTaskAccessScopeV1, Sha256Ref)>,
}
#[derive(Clone)]
pub(super) struct Permit {
    pub(super) root: Root,
    pub(super) provider: Option<super::provider_scope::ProviderScopeWitnessV1>,
    // A one-shot approval is not a reusable grant.
    pub(super) grant: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Phase {
    Reviewing,
    Reserved,
    Declined,
    Stopped,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    task_id: String,
    digest: String,
    phase: Phase,
    #[serde(default)]
    grant: Option<String>,
    #[serde(default)]
    generation: Option<Uuid>,
    #[serde(default)]
    provider: Option<super::provider_scope::ProviderScopeWitnessV1>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grants {
    generation: Uuid,
    scopes: BTreeSet<String>,
}
pub(super) enum Begin {
    Review(Root),
    Existing(String),
}

fn digest(value: &impl Serialize) -> Result<String, String> {
    luca_protocol::canonical_sha256(&serde_json::to_value(value).map_err(|_| UNAVAILABLE)?)
        .map_err(|_| UNAVAILABLE.to_owned())
}
fn path_for(app: &AppHandle, owner: &Hex64, relay: &Sha256Ref) -> Result<PathBuf, String> {
    let root = app.buzz_path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    scope_folder(&root, owner, relay)
}
fn scope_folder(root: &Path, owner: &Hex64, relay: &Sha256Ref) -> Result<PathBuf, String> {
    Ok(root
        .join("runtime-task-admission-v1")
        .join(digest(&("scope-v1", owner, relay))?))
}
fn locked<T>(folder: &Path, action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    storage::prepare_private_directory(folder).map_err(|_| UNAVAILABLE)?;
    let mut opts = OpenOptions::new();
    opts.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let lock = opts
        .open(folder.join("admission.lock"))
        .map_err(|_| UNAVAILABLE)?;
    if !lock.metadata().map_err(|_| UNAVAILABLE)?.is_file() {
        return Err(UNAVAILABLE.into());
    }
    // Shared by all Tauri threads and cooperating processes for this owner/relay.
    File::lock(&lock).map_err(|_| UNAVAILABLE)?;
    action()
}
fn read<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match storage::read_bounded(path, MAX_STATE) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| UNAVAILABLE.into()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(UNAVAILABLE.into()),
    }
}
fn write<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(v).map_err(|_| UNAVAILABLE)?;
    if bytes.len() > MAX_STATE {
        return Err(UNAVAILABLE.into());
    }
    storage::atomic_write_private(path, &bytes).map_err(|_| UNAVAILABLE.into())
}
fn grants(folder: &Path) -> Result<Grants, String> {
    let path = folder.join("approvals.json");
    if let Some(v) = read(&path)? {
        return Ok(v);
    }
    let v = Grants {
        generation: Uuid::new_v4(),
        scopes: BTreeSet::new(),
    };
    write(&path, &v)?;
    Ok(v)
}
impl Root {
    fn file(&self) -> PathBuf {
        self.folder.join(format!("{}.json", self.task_id))
    }
    fn record(&self) -> Result<Record, String> {
        read::<Record>(&self.file())?
            .filter(|v| v.task_id == self.task_id && v.digest == self.digest)
            .ok_or_else(|| "The original task request no longer matches.".into())
    }
    pub(super) fn reusable(&self, scope: &str) -> Result<bool, String> {
        locked(&self.folder, || {
            let current = grants(&self.folder)?;
            Ok(current.generation == self.generation && current.scopes.contains(scope))
        })
    }
    pub(super) fn decline(&self) -> Result<(), String> {
        locked(&self.folder, || {
            let mut row = self.record()?;
            if row.phase == Phase::Reviewing {
                row.phase = Phase::Declined;
                write(&self.file(), &row)?;
            }
            Ok(())
        })
    }
    pub(super) fn reserve(
        &self,
        scope: Option<&str>,
        remember: bool,
        reused: bool,
        provider: Option<&super::provider_scope::ProviderScopeWitnessV1>,
    ) -> Result<(), String> {
        locked(&self.folder, || {
            let mut row = self.record()?;
            if row.phase != Phase::Reviewing {
                return Err(
                    "This owner request was already settled; no second task was started.".into(),
                );
            }
            let mut current = grants(&self.folder)?;
            if current.generation != self.generation
                || (reused && !scope.is_some_and(|k| current.scopes.contains(k)))
            {
                return Err("Task access changed during review. Nothing was launched.".into());
            }
            if remember {
                let k = scope.ok_or("No exact account and task scope to remember.")?;
                if current.scopes.len() >= MAX_GRANTS && !current.scopes.contains(k) {
                    return Err(
                        "Remembered task access is full. Forget unused access first.".into(),
                    );
                }
                current.scopes.insert(k.into());
                write(&self.folder.join("approvals.json"), &current)?;
            }
            // No confirmation/response can dispatch until this survives restart.
            row.phase = Phase::Reserved;
            row.grant = scope.filter(|_| remember || reused).map(str::to_owned);
            row.generation = Some(current.generation);
            row.provider = provider.cloned();
            write(&self.file(), &row)
        })
    }
}
impl Permit {
    pub(super) fn verify_destination(
        &self,
        app: &AppHandle,
        task: &super::RuntimeTaskProjectionV1,
    ) -> Result<(), String> {
        let (scope, relay) = self
            .root
            .origin
            .as_ref()
            .ok_or("The original private task scope is unavailable.")?;
        if task.task_id != self.root.task_id
            || task.resident_pubkey != scope.resident_pubkey.as_str()
            || task.owner_pubkey != scope.owner_pubkey.as_str()
            || task.conversation_id != scope.conversation_id.as_str()
            || task.origin_relay_ref.as_ref() != Some(relay)
            || delivery::current_origin(app)?.0 != *relay
            || !super::is_primary(app, &scope.owner_pubkey, &scope.resident_pubkey)?
            || super::super::managed_cognition::active_binding_ref(&scope.resident_pubkey)
                .ok()
                .as_ref()
                != Some(&scope.binding_ref)
        {
            return Err(
                "The original private task destination changed. Nothing new was sent.".into(),
            );
        }
        super::super::runtime_task_delivery::verify_private_return_dm(
            app,
            &scope.conversation_id,
            &scope.owner_pubkey,
            &scope.resident_pubkey,
        )
    }
    pub(super) fn check(&self) -> Result<(), String> {
        self.with_effect(|| Ok(()))
    }
    /// The side effect, not just its preflight, is ordered with Stop and Forget.
    pub(super) fn with_effect<T>(
        &self,
        effect: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        locked(&self.root.folder, || {
            let row = self.root.record()?;
            let current = grants(&self.root.folder)?;
            if row.phase != Phase::Reserved
                || row.grant != self.grant
                || row.provider != self.provider
                || (self.grant.is_some()
                    && (self.root.generation != current.generation
                        || row.generation != Some(current.generation)))
                || self
                    .grant
                    .as_ref()
                    .is_some_and(|k| !current.scopes.contains(k))
            {
                return Err("This task was stopped or its approval changed before launch.".into());
            }
            effect()
        })
    }
}
#[allow(clippy::too_many_arguments)]
pub(super) fn begin(
    app: &AppHandle,
    access: &RuntimeTaskAccessScopeV1,
    relay: &Sha256Ref,
    event: &Hex64,
    input: &impl Serialize,
) -> Result<Begin, String> {
    let folder = path_for(app, &access.owner_pubkey, relay)?;
    match begin_at(
        &folder,
        operation_id(access, relay, event)?,
        digest(&(&access.binding_ref, input))?,
    )? {
        Begin::Review(mut root) => {
            root.origin = Some((access.clone(), relay.clone()));
            Ok(Begin::Review(root))
        }
        existing => Ok(existing),
    }
}
fn operation_id(
    access: &RuntimeTaskAccessScopeV1,
    relay: &Sha256Ref,
    event: &Hex64,
) -> Result<String, String> {
    let id_hash = digest(&(
        "private-owner-operation.v1",
        &access.owner_pubkey,
        &access.resident_pubkey,
        relay,
        &access.conversation_id,
        event,
    ))?;
    let mut id = [0u8; 16];
    hex::decode_to_slice(&id_hash[..32], &mut id).map_err(|_| UNAVAILABLE)?;
    Ok(Uuid::from_bytes(id).to_string())
}
fn begin_at(folder: &Path, task_id: String, fingerprint: String) -> Result<Begin, String> {
    locked(folder, || {
        let root = Root {
            folder: folder.into(),
            task_id,
            digest: fingerprint,
            generation: grants(folder)?.generation,
            origin: None,
        };
        if let Some(row) = read::<Record>(&root.file())? {
            if row.task_id != root.task_id || row.digest != root.digest {
                return Err(
                    "This owner request already names different work. Nothing else ran.".into(),
                );
            }
            let (status,message) = match row.phase {
                Phase::Declined => ("declined","This request was declined. Nothing ran; do not ask again for this request."),
                Phase::Stopped => ("stopped","The owner stopped this request. Do not restart it."),
                Phase::Reserved => ("reserved_or_already_dispatched","This request was reserved. Inspect its exact task receipt; do not start it again."),
                Phase::Reviewing => ("review_not_dispatched","No worker has started. Use the existing review if it is still open; after a restart an owner can make a fresh request."),
            };
            return Ok(Begin::Existing(
                serde_json::json!({"task_id":root.task_id,"status":status,"message":message})
                    .to_string(),
            ));
        }
        write(
            &root.file(),
            &Record {
                task_id: root.task_id.clone(),
                digest: root.digest.clone(),
                phase: Phase::Reviewing,
                grant: None,
                generation: None,
                provider: None,
            },
        )?;
        Ok(Begin::Review(root))
    })
}

/// Exact owner and live surface, verified by the host dispatch store, never
/// merely the presence of two named participants or a stale model event ID.
pub(super) fn private_owner_turn(
    app: &AppHandle,
    access: &RuntimeTaskAccessScopeV1,
    trigger: &Hex64,
) -> Result<bool, String> {
    let store = super::super::managed_dispatch_store::global_dispatch_store(app)?;
    let valid = {
        let locked = store.lock().map_err(|_| UNAVAILABLE)?;
        let d = locked
            .recheck_communication_turn(
                trigger.as_str(),
                access.resident_pubkey.as_str(),
                access.conversation_id.as_str(),
                access.session_epoch.get(),
                chrono::Utc::now().timestamp().max(0) as u64,
            )
            .map_err(|_| "This task request no longer belongs to the active owner turn.")?;
        d.owner_pubkey == access.owner_pubkey.as_str()
            && d.descendant_depth == 0
            && d.inbox_task.is_none()
            && d.inbox_action.is_none()
            && d.inbox_owner_status.is_none()
            && !d.inbox_binding_required
            && d.causal_parent_action_id.is_none()
            && d.source_dispatch_id.as_deref() == Some(trigger.as_str())
            && d.causal_root_event_id.as_deref() == Some(trigger.as_str())
            && d.response_surface == Some(luca_protocol::ManagedResponseSurfaceV1::Timeline)
    };
    if !valid || !super::is_primary(app, &access.owner_pubkey, &access.resident_pubkey)? {
        return Ok(false);
    }
    let home = super::super::runtime_task_delivery::classify_private_return_home(
        app,
        &access.conversation_id,
        &access.owner_pubkey,
        &access.resident_pubkey,
    )?;
    Ok(matches!(
        home,
        super::super::runtime_task_delivery::VerifiedReturnHomeV1::ExactPrivate
    ))
}
/// Send only text signed by the owner for this exact request. Never use an
/// excerpt invented by the model, an earlier turn, or an activity/Brain source.
pub(super) fn owner_brief(
    app: &AppHandle,
    access: &RuntimeTaskAccessScopeV1,
    trigger: &Hex64,
) -> Result<String, String> {
    let state = app.state::<crate::app_state::AppState>();
    let events = tauri::async_runtime::block_on(async {
        tokio::time::timeout(std::time::Duration::from_secs(5),
            crate::relay::query_relay(&state,&[serde_json::json!({"ids":[trigger],"kinds":[9],"authors":[access.owner_pubkey],"#h":[access.conversation_id],"limit":1})]))
            .await.map_err(|_| "Could not verify the original writing request.")?
    })?;
    let mut found = events.into_iter().filter(|v| {
        v.id.to_hex() == trigger.as_str()
            && v.kind.as_u16() == 9
            && v.pubkey.to_hex() == access.owner_pubkey.as_str()
            && v.verify().is_ok()
            && v.tags
                .iter()
                .filter(|t| t.as_slice().first().map(String::as_str) == Some("h"))
                .map(|t| t.as_slice().get(1).map(String::as_str))
                .eq([Some(access.conversation_id.as_str())])
    });
    let event = found
        .next()
        .ok_or("Could not verify the owner's exact writing request.")?;
    if found.next().is_some() || event.content.trim().is_empty() || event.content.len() > 16 * 1024
    {
        return Err("A quick answer needs one bounded owner message.".into());
    }
    Ok(event.content)
}
pub(super) fn scope_key(
    access: &RuntimeTaskAccessScopeV1,
    origin: &Sha256Ref,
    scratch: &str,
    options: &luca_protocol::RuntimeTaskOptionsV1,
    pin: &super::provider_scope::ProviderScopeWitnessV1,
) -> Result<String, String> {
    digest(&(
        "ask-approval.v1",
        &access.owner_pubkey,
        &access.resident_pubkey,
        &access.conversation_id,
        &access.binding_ref,
        origin,
        "claude_code",
        "new_task",
        "normal",
        "exact-owner-message-only",
        "same-two-member-dm",
        "cli-budget-usd-0.25",
        scratch,
        options,
        pin,
    ))
}
fn exact_file(folder: &Path, id: &str) -> Result<PathBuf, String> {
    if !Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id) {
        return Err("Invalid task reference.".into());
    }
    Ok(folder.join(format!("{id}.json")))
}
fn return_record(folder: &Path, id: &str) -> Result<Record, String> {
    let row: Record = read(&exact_file(folder, id)?)?
        .ok_or("The originating task approval could not be verified.")?;
    let v = grants(folder)?;
    if row.task_id != id
        || row.phase != Phase::Reserved
        || row
            .grant
            .as_ref()
            .is_some_and(|k| row.generation != Some(v.generation) || !v.scopes.contains(k))
    {
        return Err("The originating task approval is no longer active.".into());
    }
    Ok(row)
}
pub(super) fn with_return<T>(
    app: &AppHandle,
    owner: &Hex64,
    relay: &Sha256Ref,
    id: &str,
    effect: impl FnOnce() -> T,
) -> Result<T, String> {
    let folder = path_for(app, owner, relay)?;
    locked(&folder, || {
        let row = return_record(&folder, id)?;
        if let Some(pin) = row.provider {
            return super::provider_scope::with_current_account(app, &pin, || Ok(effect()));
        }
        Ok(effect())
    })
}
pub(super) fn stop_if_reserved(app: &AppHandle, id: &str) -> Result<bool, String> {
    let folder = path_for(
        app,
        &delegation::owner(app)?,
        &delivery::current_origin(app)?.0,
    )?;
    stop_at(&folder, id)
}
fn stop_at(folder: &Path, id: &str) -> Result<bool, String> {
    if !folder.try_exists().map_err(|_| UNAVAILABLE)? {
        return Ok(false);
    }
    locked(folder, || {
        let path = exact_file(folder, id)?;
        let Some(mut r) = read::<Record>(&path)? else {
            return Ok(false);
        };
        if r.task_id != id {
            return Err(UNAVAILABLE.into());
        }
        if r.phase != Phase::Stopped {
            r.phase = Phase::Stopped;
            write(&path, &r)?;
        }
        Ok(true)
    })
}
pub(super) fn used_remembered(
    app: &AppHandle,
    owner: &Hex64,
    relay: &Sha256Ref,
    id: &str,
) -> Result<bool, String> {
    let folder = path_for(app, owner, relay)?;
    Ok(read::<Record>(&exact_file(&folder, id)?)?
        .is_some_and(|r| r.task_id == id && r.grant.is_some()))
}
pub(super) fn manage(app: &AppHandle, forget: bool) -> Result<usize, String> {
    let owner = delegation::owner(app)?;
    let relay = delivery::current_origin(app)?.0;
    let folder = path_for(app, &owner, &relay)?;
    manage_at(&folder, forget)
}
fn manage_at(folder: &Path, forget: bool) -> Result<usize, String> {
    if !forget && !folder.try_exists().map_err(|_| UNAVAILABLE)? {
        return Ok(0);
    }
    locked(folder, || {
        let mut v = grants(folder)?;
        if forget {
            v.generation = Uuid::new_v4();
            v.scopes.clear();
            write(&folder.join("approvals.json"), &v)?;
        }
        Ok(v.scopes.len())
    })
}

#[cfg(test)]
#[path = "admission_tests.rs"]
mod tests;

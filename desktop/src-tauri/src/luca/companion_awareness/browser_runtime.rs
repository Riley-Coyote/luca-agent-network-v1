//! AppState-owned browser ingress. Initialization restores metadata OFF; only an
//! explicit current-owner pairing action starts the private socket. The browser
//! cannot choose owner/resident/device, tools, native paths or egress authority.
use super::browser_bridge::{self, BrowserBridgeConfig,BrowserBridgeHandle,BrowserBridgeError,BrowserClientFrameV1,BrowserEventKindV1,BrowserHostCallback,BrowserRejectionV1,BrowserRequestV1,BrowserResponseV1};
use super::browser_configuration::{self as config,BrowserCatalogV1,BrowserPairingV1,BrowserSitePolicyV1,BrowserNativeBootstrapV1,BROWSER_ORIGIN,KINDS};
use super::browser_configuration::{BrowserInstallActorV1,BrowserInstallReceiptV1};
use super::{AwarenessGrantKeyV1,AwarenessSourceKeyV1,AwarenessStoreError,AwarenessWithdrawalV1,LiveAwarenessOwner};
use crate::app_state::AppState;
use luca_protocol::{AwarenessObservationRefV1,AwarenessSourceStateV1,CanonicalTimestamp,Hex64,OpaqueId,SafeU53,Sha256Ref};
use serde::Serialize;
use std::{sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant},path::PathBuf};
use tauri::{AppHandle,Manager};

struct Approval {resident:Hex64,policy:BrowserSitePolicyV1,code_ref:Sha256Ref,expires:Instant,attempts:u8}
struct InstallSelection {id:OpaqueId,resident:Hex64,actor:BrowserInstallActorV1,expires:Instant}
struct Actor {
    app:AppHandle,owner:Hex64,device:OpaqueId,directory:PathBuf,
    catalog:Mutex<BrowserCatalogV1>,approval:Mutex<Option<Approval>>,active:AtomicBool,
    records:Mutex<Vec<AwarenessObservationRefV1>>,
    collecting:Mutex<Vec<AwarenessGrantKeyV1>>,
    installs:Mutex<Vec<InstallSelection>>,
}
struct RunningBridge {handle:BrowserBridgeHandle,_directory:tempfile::TempDir}
/// Restore-only ownership handle. Default has no socket/browser/profile action.
#[derive(Default)]
pub(crate) struct CompanionBrowserRuntimeV1 {inner:Mutex<Option<Arc<Actor>>>,bridge:Mutex<Option<RunningBridge>>,operation:Mutex<()>}
/// Short-lived explicit app/UI secret; never Debug/log/model context.
pub(crate) struct BrowserPairApprovalV1 {pub(crate) code:String,pub(crate) expires_in_seconds:u64}
/// Body-free selected-companion control inventory, not source bodies/secrets.
#[derive(Debug,Clone,Serialize)]
pub(crate) struct BrowserPairControlV1 {
    pub(crate) profile_instance_id:OpaqueId,pub(crate) pairing_id:OpaqueId,pub(crate) enabled:bool,
    pub(crate) source_keys:Vec<AwarenessGrantKeyV1>,pub(crate) bridge_ready:bool,
}
impl CompanionBrowserRuntimeV1 {
    /// Startup reads only protected current-owner/device metadata, with all
    /// transport/capture OFF. It installs/opens no browser and creates no grant.
    pub(crate) fn initialize(&self,app:AppHandle)->Result<(),BrowserBridgeError> {
        self.shutdown();let state=app.state::<AppState>();
        if state.shutdown_started.load(Ordering::Acquire) {return Err(BrowserBridgeError::Unavailable);}
        let runtime=&state.companion_awareness;
        let owner=runtime.control_owner().ok_or(BrowserBridgeError::Unavailable)?;
        let device=runtime.device(&owner).map_err(|_|BrowserBridgeError::Unavailable)?;
        let directory=runtime.private_directory(&owner).map_err(|_|BrowserBridgeError::Unavailable)?;
        let catalog=BrowserCatalogV1::open(&directory,&owner,&device)?;drop(state);
        let actor=Arc::new(Actor {app,owner,device,directory,catalog:Mutex::new(catalog),approval:Mutex::new(None),active:AtomicBool::new(false),records:Mutex::new(Vec::new()),collecting:Mutex::new(Vec::new()),installs:Mutex::new(Vec::new())});
        if actor.app.state::<AppState>().shutdown_started.load(Ordering::Acquire) {return Err(BrowserBridgeError::Unavailable);}
        *self.inner.lock().map_err(|_|BrowserBridgeError::Unavailable)?=Some(actor);Ok(())
    }
    /// This owner's companion inventory only; no pairing/bridge secret or URLs.
    pub(crate) fn list(&self,owner:&Hex64,resident:&Hex64)->Result<Vec<BrowserPairControlV1>,BrowserBridgeError> {
        let actor=self.actor(owner)?;let pairs=actor.catalog.lock().map_err(|_|BrowserBridgeError::Unavailable)?.pairs()?;
        pairs.into_iter().filter(|p|&p.resident==resident).map(|pair|Ok(BrowserPairControlV1 {
            profile_instance_id:pair.profile.clone(),pairing_id:pair.pairing_id.clone(),enabled:pair.enabled,
            source_keys:KINDS.into_iter().map(|kind|pair.key(owner,&actor.device,kind)).collect::<Result<Vec<_>,_>>()?,bridge_ready:actor.active.load(Ordering::Acquire)})).collect()
    }
    /// Explicit app/UI approval for one companion and immutable exact site policy.
    /// Starts ONLY typed local ingress; pairing creates no observation grant.
    /// A code expires in two minutes, is one-use, and locks after eight attempts.
    pub(crate) fn approve_pair(&self,live:&LiveAwarenessOwner<'_>,resident:&Hex64,policy:BrowserSitePolicyV1)
        -> Result<BrowserPairApprovalV1,BrowserBridgeError> {
        if live.owner()==resident {return Err(BrowserBridgeError::UnsafeScope);}
        let _operation=self.operation.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
        let actor=self.actor(live.owner())?;let code=config::fresh_secret();let code_ref=config::secret_ref(&code)?;
        live.with_current(|| {
            self.start_bridge(&actor).map_err(|_|AwarenessStoreError::Unavailable)?;
            *actor.approval.lock().map_err(|_|AwarenessStoreError::Unavailable)?=Some(Approval {resident:resident.clone(),policy,code_ref,expires:Instant::now()+Duration::from_secs(120),attempts:0});
            Ok(())
        }).map_err(|_|BrowserBridgeError::Unavailable)?;
        Ok(BrowserPairApprovalV1 {code,expires_in_seconds:120})
    }
    fn actor(&self,owner:&Hex64)->Result<Arc<Actor>,BrowserBridgeError> {
        let inner=self.inner.lock().map_err(|_|BrowserBridgeError::Unavailable)?;let actor=inner.as_ref().ok_or(BrowserBridgeError::Unavailable)?;
        if &actor.owner!=owner {return Err(BrowserBridgeError::UnsafeScope);}Ok(Arc::clone(actor))
    }
    /// Explicit host setup starts private metadata ingress only, never a source.
    pub(crate) fn setup_native_host(&self,live:&LiveAwarenessOwner<'_>)->Result<(),BrowserBridgeError> {
        let _operation=self.operation.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
        let actor=self.actor(live.owner())?;
        live.with_current(||self.start_bridge(&actor).map_err(|_|AwarenessStoreError::Unavailable)).map_err(|_|BrowserBridgeError::Unavailable)
    }
    /// Store a short-lived non-serde native-picker actor, bound to this exact
    /// owner/device/companion. Only the random handle returns to the renderer.
    pub(crate) fn remember_install_selection(&self,live:&LiveAwarenessOwner<'_>,resident:&Hex64,selected:BrowserInstallActorV1)
        -> Result<OpaqueId,BrowserBridgeError> {
        let actor=self.actor(live.owner())?;
        if !selected.matches_scope(&actor.owner,&actor.device,&actor.directory) {return Err(BrowserBridgeError::UnsafeScope);}
        let id=id(&format!("browser-install-{}",uuid::Uuid::new_v4()))?;
        let mut installs=actor.installs.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
        installs.retain(|selection|selection.expires>Instant::now());if installs.len()==8 {return Err(BrowserBridgeError::Unavailable);}
        installs.push(InstallSelection {id:id.clone(),resident:resident.clone(),actor:selected,expires:Instant::now()+Duration::from_secs(300)});Ok(id)
    }
    /// Explicit human install consumes only a native-picker capability. No path,
    /// owner, device, executable or bootstrap selector is accepted from IPC.
    pub(crate) fn install_selected(&self,live:&LiveAwarenessOwner<'_>,resident:&Hex64,selection:&OpaqueId,confirmed:Option<Sha256Ref>)
        -> Result<BrowserInstallReceiptV1,BrowserBridgeError> {
        let actor=self.actor(live.owner())?;
        let selected={let mut installs=actor.installs.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
            let index=installs.iter().position(|entry|&entry.id==selection&&&entry.resident==resident&&entry.expires>Instant::now()).ok_or(BrowserBridgeError::UnsafeScope)?;
            installs.remove(index)};
        self.setup_native_host(live)?;
        selected.actor.install(live,&actor.app.state::<AppState>().companion_awareness,confirmed)
    }
    /// Explicit one-class Resume after the owner independently grants observe.
    /// Starting transport/pairing never resumes other saved profiles/classes.
    pub(crate) fn resume_source(&self,live:&LiveAwarenessOwner<'_>,key:&AwarenessGrantKeyV1)->Result<(),BrowserBridgeError> {
        let _operation=self.operation.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
        let actor=self.actor(live.owner())?;
        let pairs=actor.catalog.lock().map_err(|_|BrowserBridgeError::Unavailable)?.pairs()?;
        if !pairs.iter().any(|p|p.enabled&&KINDS.into_iter().any(|kind|p.key(&actor.owner,&actor.device,kind).is_ok_and(|k|&k==key))) {return Err(BrowserBridgeError::UnsafeScope);}
        live.with_current(||self.start_bridge(&actor).map_err(|_|AwarenessStoreError::Unavailable)).map_err(|_|BrowserBridgeError::Unavailable)?;
        let state=actor.app.state::<AppState>();
        state.companion_awareness.with_granted_source_read(live,key, |_| {
            let mut scopes=actor.collecting.lock().map_err(|_|AwarenessStoreError::Unavailable)?;
            if !scopes.contains(key) {scopes.push(key.clone());}Ok(())
        }).map_err(|_|BrowserBridgeError::Unavailable)
    }
    /// Keyless exact metadata stop after durable denial, without browser actions.
    pub(crate) fn after_grant_withdrawal(&self,owner:&Hex64,key:&AwarenessGrantKeyV1)->Result<(),BrowserBridgeError> {
        let actor=self.actor(owner)?;
        actor.collecting.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|scope|scope!=key);
        actor.records.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|r|r.source_id!=key.source.source_id||r.resident_pubkey!=key.resident_pubkey);Ok(())
    }
    /// Keyless source-wide stop after the source's durable deny barrier.
    pub(crate) fn after_source_withdrawal(&self,owner:&Hex64,key:&AwarenessSourceKeyV1)->Result<(),BrowserBridgeError> {
        let actor=self.actor(owner)?;
        actor.collecting.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|scope|&scope.source!=key);
        actor.records.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|r|r.source_id!=key.source_id||r.device_id!=key.device_id);Ok(())
    }
    /// Keyless resident Pause clears all runtime scopes; a later global Resume
    /// does not reactivate a saved browser class without explicit source Resume.
    pub(crate) fn after_pause(&self,owner:&Hex64,resident:&Hex64)->Result<(),BrowserBridgeError> {
        let actor=self.actor(owner)?;
        actor.collecting.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|key|&key.resident_pubkey!=resident);
        actor.records.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|r|&r.resident_pubkey!=resident);Ok(())
    }
    fn start_bridge(&self,actor:&Arc<Actor>)->Result<(),BrowserBridgeError> {
        if actor.app.state::<AppState>().shutdown_started.load(Ordering::Acquire) {return Err(BrowserBridgeError::Unavailable);}
        let mut running=self.bridge.lock().map_err(|_|BrowserBridgeError::Unavailable)?;
        if running.is_some() {return Ok(());}
        #[cfg(unix)] use std::os::unix::fs::PermissionsExt;
        let mut builder=tempfile::Builder::new();builder.prefix("pba-");
        #[cfg(unix)] builder.permissions(std::fs::Permissions::from_mode(0o700));
        let directory=builder.tempdir_in("/private/tmp").map_err(|_|BrowserBridgeError::Unavailable)?;
        let directory_path=directory.path().canonicalize().map_err(|_|BrowserBridgeError::UnsafeScope)?;
        let capability=config::fresh_secret();let current=Arc::clone(actor);
        let callback:BrowserHostCallback=Arc::new(move |client| {
            if !current.active.load(Ordering::Acquire) {return rejected(BrowserRejectionV1::Unavailable);}
            let state=current.app.state::<AppState>();ingress::handle(&current,&state,client)
        });
        let handle=browser_bridge::start_browser_bridge(BrowserBridgeConfig {directory:directory_path,allowed_origin:BROWSER_ORIGIN.into(),bridge_capability:capability.clone()},callback)?;
        BrowserNativeBootstrapV1::new(handle.endpoint().to_owned(),capability)?.write(&actor.directory)?;
        actor.active.store(true,Ordering::Release);*running=Some(RunningBridge {handle,_directory:directory});Ok(())
    }
    /// Keyless narrowing: disable token first, then durable source-wide deny for
    /// exactly this pairing's three principal/class scopes. Retry remains safe.
    pub(crate) fn disconnect(&self,state:&AppState,owner:&Hex64,resident:&Hex64,profile:&OpaqueId)->Result<(),BrowserBridgeError> {
        let actor=self.actor(owner)?;
        let pair=actor.catalog.lock().map_err(|_|BrowserBridgeError::Unavailable)?.disable(profile,resident)?;
        for kind in KINDS {
            let key=pair.key(owner,&actor.device,kind)?;
            if let Ok((_,revision))=state.companion_awareness.source_snapshot(owner,&key.source) {
                state.companion_awareness.withdraw_source(owner,&key.source,revision,AwarenessWithdrawalV1::Withdraw,
                    &id(&format!("browser-disconnect:{}:{}",pair.pairing_id.as_str(),kind_name(kind)))?).map_err(|_|BrowserBridgeError::Unavailable)?;
            }
        }
        actor.records.lock().map_err(|_|BrowserBridgeError::Unavailable)?.retain(|r|!KINDS.into_iter().any(|kind|pair.key(owner,&actor.device,kind).is_ok_and(|k|k.source.source_id==r.source_id)));
        Ok(())
    }
    /// Preload body-free configuration/candidates before effect leases. Restart
    /// has no raw candidates; retained source roots still need current DB checks.
    pub(crate) fn snapshot(&self,owner:&Hex64,resident:&Hex64,now:&CanonicalTimestamp)->Result<BrowserMaterialSnapshotV1,BrowserBridgeError> {
        let actor=self.actor(owner)?;let pairs=actor.catalog.lock().map_err(|_|BrowserBridgeError::Unavailable)?.pairs()?;
        let mut keys=Vec::new();for pair in pairs.into_iter().filter(|p|p.enabled&&&p.resident==resident) {for kind in KINDS {keys.push((pair.key(owner,&actor.device,kind)?,kind));}}
        let collecting=actor.collecting.lock().map_err(|_|BrowserBridgeError::Unavailable)?.clone();
        let records=actor.records.lock().map_err(|_|BrowserBridgeError::Unavailable)?.iter().filter(|r|&r.resident_pubkey==resident).cloned().collect();
        Ok(BrowserMaterialSnapshotV1 {active:actor.active.load(Ordering::Acquire),keys,collecting,records,now:now.clone()})
    }
    /// Stop local ingress only; no install/uninstall, app launch, grant widening
    /// or browser-profile mutation. Owned UDS is dropped outside state locks.
    pub(crate) fn shutdown(&self) {
        let _operation=self.operation.lock().ok();
        if let Ok(mut inner)=self.inner.lock() {if let Some(actor)=inner.take() {actor.active.store(false,Ordering::Release);
            if let Ok(mut approval)=actor.approval.lock() {*approval=None;}if let Ok(mut records)=actor.records.lock() {records.clear();}if let Ok(mut collecting)=actor.collecting.lock() {collecting.clear();}}}
        let running=self.bridge.lock().ok().and_then(|mut bridge|bridge.take());drop(running);
    }
}
impl Drop for CompanionBrowserRuntimeV1 {fn drop(&mut self) {self.shutdown();}}
/// No bodies/tokens/URLs; caller uses these alongside final grant/deny/egress.
pub(crate) struct BrowserMaterialSnapshotV1 {active:bool,keys:Vec<(AwarenessGrantKeyV1,BrowserEventKindV1)>,collecting:Vec<AwarenessGrantKeyV1>,records:Vec<AwarenessObservationRefV1>,now:CanonicalTimestamp}
impl BrowserMaterialSnapshotV1 {
    /// Exact locally stored principal/device/pairing/policy class, not a payload
    /// claim. Raw binding additionally requires the whole remembered reference.
    pub(crate) fn binding(&self,reference:&AwarenessObservationRefV1)->Option<BrowserEventKindV1> {
        self.keys.iter().find(|(key,_)|key.source.owner_pubkey==reference.owner_pubkey&&key.resident_pubkey==reference.resident_pubkey&&key.source.source_id==reference.source_id&&key.source.device_id==reference.device_id).map(|(_,kind)|*kind)
    }
    /// Exact recent observations only, never arbitrary source-wide fresh status.
    pub(crate) fn references(&self)->Vec<AwarenessObservationRefV1> {
        if !self.active {return Vec::new();}self.records.iter().filter(|r|self.collecting.iter().any(|k|k.source.source_id==r.source_id&&k.resident_pubkey==r.resident_pubkey)&&self.now>=r.captured_at && self.now<r.expires_at).cloned().collect()
    }
    /// IO-free root facts; final awareness store still rechecks current source
    /// epoch/consent/Pause/quarantine. Retained roots do not require a live sensor.
    pub(crate) fn resolve(&self,reference:&AwarenessObservationRefV1,retained:bool)->super::AwarenessMaterialFactsV1 {
        let bound=self.binding(reference).is_some();
        let raw=self.active&&self.collecting.iter().any(|k|k.source.source_id==reference.source_id&&k.resident_pubkey==reference.resident_pubkey)&&self.records.contains(reference)&&self.now>=reference.captured_at&&self.now<reference.expires_at;
        super::AwarenessMaterialFactsV1 {source_fresh:bound&&raw,material_state:if bound&&(retained||raw) {luca_protocol::AwarenessMaterialStateV1::Available} else {luca_protocol::AwarenessMaterialStateV1::Unavailable}}
    }
}
fn rejected(code:BrowserRejectionV1)->BrowserResponseV1 {BrowserResponseV1::Rejected {code}}
fn id(value:&str)->Result<OpaqueId,BrowserBridgeError> {OpaqueId::parse(value).map_err(|_|BrowserBridgeError::Invalid)}
fn kind_name(kind:BrowserEventKindV1)->&'static str {match kind {BrowserEventKindV1::Visit=>"visit",BrowserEventKindV1::Bookmark=>"bookmark",BrowserEventKindV1::Excerpt=>"excerpt"}}

/// Standalone early binary entry. Some(exit) means recognized native-host mode:
/// never fall through to Tauri/single-instance, even on invalid/missing config.
/// Stdout is native framing only; errors expose no secret/path/content detail.
pub(crate) fn browser_awareness_native_host_entry()->Option<i32> {
    let args=std::env::args_os().skip(1).collect::<Vec<_>>();
    let invocation=parse_native_entry(&args)?;
    let result=(|| {
        let (path,caller)=invocation?;
        let bootstrap=BrowserNativeBootstrapV1::read(&path)?;
        super::browser_native_host::run_browser_native_host(&super::browser_native_host::BrowserNativeHostConfig {
            endpoint:bootstrap.endpoint,bridge_capability:bootstrap.capability,expected_origin:BROWSER_ORIGIN.into(),caller_origin:caller},
            &mut std::io::stdin().lock(),&mut std::io::stdout().lock())
    })();Some(if result.is_ok() {0}else{1})
}
fn parse_native_entry(args:&[std::ffi::OsString])->Option<Result<(PathBuf,String),BrowserBridgeError>> {
    if args.first().and_then(|s|s.to_str())!=Some(config::NATIVE_ENTRY_FLAG) {return None;}
    Some((|| {
        if args.len()!=3 {return Err(BrowserBridgeError::Invalid);}
        let origin=args[2].to_str().ok_or(BrowserBridgeError::Invalid)?;
        if origin!=BROWSER_ORIGIN {return Err(BrowserBridgeError::UnsafeScope);}
        Ok((PathBuf::from(&args[1]),origin.to_owned()))
    })())
}
#[path="browser_runtime/ingress.rs"]
mod ingress;
#[cfg(test)]
#[path="browser_runtime_tests.rs"]
mod tests;

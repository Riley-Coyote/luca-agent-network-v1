//! Explicit owned AppMetadata dirty notification stream. The helper observes
//! NSWorkspace activation notifications but emits no IDs/titles/text. No stream
//! starts at initialization, and this cannot enable AX or screenshot capture.
use super::*;
use crate::luca::companion_awareness::machine_activity::MachineObservationClassV1;
use std::sync::mpsc;

/// Body-free observer lifecycle. Cancellation intent does not mean native reap.
#[derive(Debug,Clone,Copy,PartialEq,Eq)]
pub(crate) struct MachineActivationStatusV1 {
    pub(crate) cancel_requested:bool,
    pub(crate) terminal_seen:bool,
    pub(crate) unavailable:bool,
}
struct Control {
    cancel:AtomicBool,terminal:AtomicBool,unavailable:AtomicBool,dirty:AtomicBool,
    #[cfg(target_os="macos")]
    child:Mutex<Option<std::process::Child>>,
}
impl Default for Control {fn default()->Self {Self {cancel:AtomicBool::new(false),terminal:AtomicBool::new(false),
    unavailable:AtomicBool::new(false),dirty:AtomicBool::new(false),#[cfg(target_os="macos")] child:Mutex::new(None)}}}
/// Exactly one owned metadata notification process. Parent must retain it only
/// for the explicit current scope and call Stop/drop after durable denial. The
/// reader blocks on notification I/O; it never polls app/window state or models.
pub(crate) struct MachineActivationWatcherV1 {key:AwarenessGrantKeyV1,control:Arc<Control>}
impl MachineActivationWatcherV1 {
    /// Only the sealed metadata grant-read permit can launch a stream. Start
    /// framing/staging/spawn is bounded <=2s; no synthetic initial event/capture.
    pub(in crate::luca::companion_awareness) fn start(permit:MachineHelperReadPermitV1<'_>,wake:mpsc::SyncSender<()>,original_deadline:Instant)
        -> Result<Self,AwarenessStoreError> {
        if permit.request().class()!=MachineObservationClassV1::AppMetadata || permit.key().source.source_id!=permit.request().source_id()? {
            return Err(AwarenessStoreError::Invalid);
        }
        let deadline=original_deadline.min(Instant::now()+MAX_RUN_TIME);
        if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
        #[cfg(target_os="macos")] {
            use std::process::{Command,Stdio};
            let path=stage_helper(permit.directory(),include_bytes!(concat!(env!("OUT_DIR"),"/companion-awareness")),deadline)?;
            let policy=permit.request().encode()?;
            if policy.len()>MAX_MACHINE_REQUEST_BYTES || Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
            let mut child=Command::new(&path).arg("--activation-signals").env_clear().env("PATH","/usr/bin:/bin:/usr/sbin:/sbin")
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_|AwarenessStoreError::Unavailable)?;
            let control=Arc::new(Control::default());
            let Some(mut input)=child.stdin.take() else {dispose_stream(child,&control);return Err(AwarenessStoreError::Unavailable);};
            let Some(output)=child.stdout.take() else {dispose_stream(child,&control);return Err(AwarenessStoreError::Unavailable);};
            if nonblocking(&input).is_err() {dispose_stream(child,&control);return Err(AwarenessStoreError::Unavailable);}
            let mut sent=0;
            while sent<policy.len() && Instant::now()<deadline {
                match input.write(&policy[sent..]) {
                    Ok(0)=>break,Ok(count)=>sent+=count,
                    Err(e)if matches!(e.kind(),io::ErrorKind::WouldBlock|io::ErrorKind::Interrupted)=>std::thread::sleep(TICK),Err(_)=>break,
                }
            }
            drop(input);
            if sent!=policy.len() || Instant::now()>=deadline {dispose_stream(child,&control);return Err(AwarenessStoreError::Unavailable);}
            *control.child.lock().map_err(|_|AwarenessStoreError::Unavailable)?=Some(child);
            let read_control=Arc::clone(&control);
            if std::thread::Builder::new().name("luca-machine-activation-events".into()).spawn(move || read_stream(output,read_control,wake)).is_err() {
                request_stop(&control);
                let child=control.child.lock().ok().and_then(|mut child|child.take());
                if let Some(child)=child {dispose_stream(child,&control);}
                return Err(AwarenessStoreError::Unavailable);
            }
            Ok(Self {key:permit.key().clone(),control})
        }
        #[cfg(not(target_os="macos"))] {let _=(permit,wake,deadline);Err(AwarenessStoreError::Unavailable)}
    }
    /// Exact opaque host scope, not a native PID or general app-control authority.
    pub(crate) fn grant_key(&self)->&AwarenessGrantKeyV1 {&self.key}
    /// Consume a coalesced notification only while this exact stream is alive.
    /// Parent marks ONLY the metadata adapter dirty and rechecks its real grant
    /// inside sample_embedded. A notification alone admits no observation.
    pub(crate) fn take_changed(&self,key:&AwarenessGrantKeyV1)->bool {
        key==&self.key && !self.control.cancel.load(Ordering::Acquire) && !self.control.unavailable.load(Ordering::Acquire)
            && !self.control.terminal.load(Ordering::Acquire) && self.control.dirty.swap(false,Ordering::AcqRel)
    }
    /// Keyless narrow Stop request for exactly this owned source. Returns intent,
    /// not stopped; no unrelated process, public chat or native model is touched.
    pub(crate) fn cancel_grant(&self,key:&AwarenessGrantKeyV1)->bool {
        if key!=&self.key || self.control.terminal.load(Ordering::Acquire) {return false;}
        request_stop(&self.control);true
    }
    /// Inspect request/reap/availability without app/window or payload details.
    pub(crate) fn status(&self)->MachineActivationStatusV1 {MachineActivationStatusV1 {
        cancel_requested:self.control.cancel.load(Ordering::Acquire),terminal_seen:self.control.terminal.load(Ordering::Acquire),unavailable:self.control.unavailable.load(Ordering::Acquire)}}
    /// Optional bounded terminal wait OUTSIDE all source/identity/continuity
    /// locks. False means still unknown, never successful native Stop.
    pub(crate) fn wait_terminal(&self,key:&AwarenessGrantKeyV1,original_deadline:Instant)->bool {
        if key!=&self.key {return false;}let deadline=original_deadline.min(Instant::now()+MAX_RUN_TIME);
        while Instant::now()<deadline && !self.control.terminal.load(Ordering::Acquire) {std::thread::sleep(TICK);}
        self.control.terminal.load(Ordering::Acquire)
    }
}
impl Drop for MachineActivationWatcherV1 {fn drop(&mut self) {request_stop(&self.control);}}
fn request_stop(control:&Control) {
    control.cancel.store(true,Ordering::Release);control.dirty.store(false,Ordering::Release);
    #[cfg(target_os="macos")] if let Ok(mut child)=control.child.lock() {if let Some(child)=child.as_mut() {let _=child.kill();}}
}
/// Strict bounded fixed-signal stream. Unknown/partial/oversized framing denies
/// and stops rather than treating arbitrary helper output as app context.
#[derive(Default)]
struct SignalParser {count:usize,half:bool}
impl SignalParser {
    fn feed(&mut self,bytes:&[u8])->Result<bool,AwarenessStoreError> {
        let mut changed=false;
        for byte in bytes {
            self.count=self.count.checked_add(1).ok_or(AwarenessStoreError::Capacity)?;
            if self.count>MAX_MACHINE_REPLY_BYTES {return Err(AwarenessStoreError::Capacity);}
            if (!self.half && *byte!=b'1') || (self.half && *byte!=b'\n') {return Err(AwarenessStoreError::Invalid);}
            self.half=!self.half;if !self.half {changed=true;}
        }
        Ok(changed)
    }
}
#[cfg(target_os="macos")]
fn read_stream(mut output:std::process::ChildStdout,control:Arc<Control>,wake:mpsc::SyncSender<()>) {
    let mut parser=SignalParser::default();let mut bytes=[0_u8;1024];
    while !control.cancel.load(Ordering::Acquire) {
        match output.read(&mut bytes) {
            Ok(0)=>break,
            Ok(count)=>match parser.feed(&bytes[..count]) {
                Ok(true)=>{control.dirty.store(true,Ordering::Release);let _=wake.try_send(());},Ok(false)=>{},
                Err(_)=>{control.unavailable.store(true,Ordering::Release);break;}
            },
            Err(e)if e.kind()==io::ErrorKind::Interrupted=>continue,
            Err(_)=>{control.unavailable.store(true,Ordering::Release);break;}
        }
    }
    if !control.cancel.load(Ordering::Acquire) {control.unavailable.store(true,Ordering::Release);}
    control.dirty.store(false,Ordering::Release);request_stop(&control);reap_stream(&control);let _=wake.try_send(());
}
#[cfg(target_os="macos")]
fn reap_stream(control:&Control) {
    let child=control.child.lock().ok().and_then(|mut child|child.take());
    if let Some(mut child)=child {let _=child.kill();if child.wait().is_ok() {control.terminal.store(true,Ordering::Release);}}
}
#[cfg(target_os="macos")]
fn dispose_stream(mut child:std::process::Child,control:&Arc<Control>) {
    let _=child.kill();if matches!(child.try_wait(),Ok(Some(_))) {control.terminal.store(true,Ordering::Release);return;}
    let control=Arc::clone(control);
    let _=std::thread::Builder::new().name("luca-machine-activation-reap".into()).spawn(move || {
        if child.wait().is_ok() {control.terminal.store(true,Ordering::Release);}
    });
}
#[cfg(test)]
#[path="activation_tests.rs"]
mod tests;

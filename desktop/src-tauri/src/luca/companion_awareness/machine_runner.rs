//! Lazy, exact embedded helper runner. Constructing it observes/starts nothing.
//! Only the sealed machine-source read permit can launch it. No helper output,
//! app/window identity, command diagnostic or policy is logged/persisted here.
use super::machine_activity::{MachineHelperReadPermitV1,MAX_MACHINE_REPLY_BYTES,MAX_MACHINE_REQUEST_BYTES};
use super::{AwarenessGrantKeyV1,AwarenessStoreError};
use luca_protocol::{Hex64,OpaqueId};
use sha2::{Digest,Sha256};
use std::{fs,io::{self,Read,Write},path::{Component,Path,PathBuf},sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use zeroize::Zeroizing;
#[path="machine_runner/activation.rs"]
mod activation;
pub(crate) use activation::MachineActivationWatcherV1;

const MAX_RUN_TIME:Duration=Duration::from_secs(2);
const REAP_MARGIN:Duration=Duration::from_millis(100);
const TICK:Duration=Duration::from_millis(5);
const CACHE_DIRECTORY:&str="machine-helper-v1";
const HELPER_NAME:&str="companion-awareness";
const MAX_HELPER_BYTES:usize=16*1024*1024;
const INFO_PLIST:&[u8]=br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>companion-awareness</string>
<key>CFBundleIdentifier</key><string>com.luca.agent-network.companion-awareness</string>
<key>CFBundleName</key><string>Companion Awareness</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>"#;

struct RunScope {
    key:AwarenessGrantKeyV1,
    id:OpaqueId,
    cancel:AtomicBool,
    terminal:AtomicBool,
    spawned:AtomicBool,
}
/// Body-free local state. Cancellation requested is not proof of native reap.
#[derive(Debug,Clone,PartialEq,Eq)]
pub(crate) struct MachineOwnedRunStatusV1 {
    pub(crate) run_id:OpaqueId,
    pub(crate) spawned:bool,
    pub(crate) cancel_requested:bool,
    pub(crate) terminal_seen:bool,
}
/// One owned capture process at a time; default has no files/process/timer.
/// An unknown/unreaped previous run blocks another launch instead of duplicating
/// observation. This runner never owns public chat or any native model process.
#[derive(Default)]
pub(crate) struct MachineHelperRunnerV1 { active:Mutex<Option<Arc<RunScope>>> }
impl MachineHelperRunnerV1 {
    /// Keyless narrowing for one exact machine source; returns request accepted,
    /// never claims Stop before try_wait/wait observes this owned child's terminal.
    pub(crate) fn cancel_grant(&self,key:&AwarenessGrantKeyV1)->Result<bool,AwarenessStoreError> {
        self.cancel_matching(|run|&run.key==key)
    }
    /// Narrow all owned machine capture for this owner/resident only.
    pub(crate) fn cancel_resident(&self,owner:&Hex64,resident:&Hex64)->Result<bool,AwarenessStoreError> {
        self.cancel_matching(|run|&run.key.source.owner_pubkey==owner && &run.key.resident_pubkey==resident)
    }
    /// Exact local request/terminal detail, not source freshness or access proof.
    pub(crate) fn status(&self,key:&AwarenessGrantKeyV1)->Result<Option<MachineOwnedRunStatusV1>,AwarenessStoreError> {
        let active=self.active.lock().map_err(|_|AwarenessStoreError::Unavailable)?;
        Ok(active.as_ref().filter(|run|&run.key==key).map(|run|MachineOwnedRunStatusV1 {
            run_id:run.id.clone(),spawned:run.spawned.load(Ordering::Acquire),cancel_requested:run.cancel.load(Ordering::Acquire),terminal_seen:run.terminal.load(Ordering::Acquire)}))
    }
    fn cancel_matching(&self,matches:impl FnOnce(&RunScope)->bool)->Result<bool,AwarenessStoreError> {
        let active=self.active.lock().map_err(|_|AwarenessStoreError::Unavailable)?;
        let Some(run)=active.as_ref().filter(|run|matches(run)) else {return Ok(false);};
        if run.terminal.load(Ordering::Acquire) {return Ok(false);}
        run.cancel.store(true,Ordering::Release);Ok(true)
    }
    fn claim(&self,key:&AwarenessGrantKeyV1)->Result<Arc<RunScope>,AwarenessStoreError> {
        let mut active=self.active.lock().map_err(|_|AwarenessStoreError::Unavailable)?;
        if active.as_ref().is_some_and(|run|!run.terminal.load(Ordering::Acquire)) {return Err(AwarenessStoreError::Unavailable);}
        let run=Arc::new(RunScope {key:key.clone(),id:OpaqueId::parse(format!("machine-run-{}",uuid::Uuid::new_v4())).map_err(|_|AwarenessStoreError::Invalid)?,
            cancel:AtomicBool::new(false),terminal:AtomicBool::new(false),spawned:AtomicBool::new(false)});
        *active=Some(Arc::clone(&run));Ok(run)
    }
    /// Called only within the current exact-grant source-read fence. The original
    /// deadline includes staging/spawn/framing/read/reap, capped at two seconds.
    /// Private cache identity is embedded-byte equality, not signing/TCC proof.
    pub(super) fn run(&self,permit:MachineHelperReadPermitV1<'_>,original_deadline:Instant)->Result<Vec<u8>,AwarenessStoreError> {
        let deadline=original_deadline.min(Instant::now()+MAX_RUN_TIME);
        if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
        if permit.key().source.source_id!=permit.request().source_id()? {return Err(AwarenessStoreError::Invalid);}
        let input=permit.request().encode()?;
        if input.is_empty() || input.len()>MAX_MACHINE_REQUEST_BYTES {return Err(AwarenessStoreError::Capacity);}
        #[cfg(target_os="macos")] {
            let run=self.claim(permit.key())?;
            let result=(|| {
                let bytes=include_bytes!(concat!(env!("OUT_DIR"),"/companion-awareness"));
                let path=stage_helper(permit.directory(),bytes,deadline)?;
                if run.cancel.load(Ordering::Acquire) || Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
                let mut child=OwnedChild::spawn(&path,Arc::clone(&run))?;
                let remaining=deadline.saturating_duration_since(Instant::now());
                pump(&mut child,&input,&run.cancel,remaining).map_err(|_|AwarenessStoreError::Unavailable)
            })();
            // No spawn, or OwnedChild terminal/reaper handles the actual process.
            // Do not mark a spawned but unreaped child terminal on an error.
            if result.is_err() && !run.spawned.load(Ordering::Acquire) {run.terminal.store(true,Ordering::Release);}
            result
        }
        #[cfg(not(target_os="macos"))] {let _=(permit,input,deadline);Err(AwarenessStoreError::Unavailable)}
    }
}

#[derive(Debug,Clone,Copy,PartialEq,Eq)]
enum PumpFailure {Input,Output,Io,Deadline,Cancelled,Exit}
/// Small injectable process-I/O boundary used by the real owned child and pure
/// fake children. No arbitrary command/program/PID enters this interface.
trait ChildIo {
    fn elapsed(&self)->Duration;
    fn write_input(&mut self,bytes:&[u8])->io::Result<usize>;
    fn close_input(&mut self);
    fn read_output(&mut self,bytes:&mut[u8])->io::Result<usize>;
    fn terminal(&mut self)->io::Result<Option<bool>>;
    fn kill_owned(&mut self)->io::Result<()>;
    fn tick(&mut self);
}
fn pump(child:&mut impl ChildIo,input:&[u8],cancel:&AtomicBool,budget:Duration)->Result<Vec<u8>,PumpFailure> {
    if input.is_empty() || input.len()>MAX_MACHINE_REQUEST_BYTES {return Err(PumpFailure::Input);}
    let budget=budget.min(MAX_RUN_TIME);let capture_until=budget.saturating_sub(REAP_MARGIN);
    let mut sent=0;let mut input_closed=false;let mut output=Zeroizing::new(Vec::new());let mut eof=false;
    loop {
        let failure=if cancel.load(Ordering::Acquire) {Some(PumpFailure::Cancelled)}
            else if child.elapsed()>=capture_until {Some(PumpFailure::Deadline)} else {None};
        if let Some(failure)=failure {terminate(child,budget);return Err(failure);}
        if !input_closed {
            if sent<input.len() {
                match child.write_input(&input[sent..]) {
                    Ok(0)=>{terminate(child,budget);return Err(PumpFailure::Io);},
                    Ok(count) if count<=input.len()-sent=>sent+=count,
                    Ok(_)=>{terminate(child,budget);return Err(PumpFailure::Io);},
                    Err(e) if matches!(e.kind(),io::ErrorKind::WouldBlock|io::ErrorKind::Interrupted)=>{},
                    Err(_)=>{terminate(child,budget);return Err(PumpFailure::Io);},
                }
            }
            if sent==input.len() {child.close_input();input_closed=true;}
        }
        if !eof {
            let mut bytes=[0_u8;4096];
            match child.read_output(&mut bytes) {
                Ok(0)=>eof=true,
                Ok(count) if count<=bytes.len()=>{
                    if output.len()+count>MAX_MACHINE_REPLY_BYTES {terminate(child,budget);return Err(PumpFailure::Output);}
                    output.extend_from_slice(&bytes[..count]);
                },
                Ok(_)=>{terminate(child,budget);return Err(PumpFailure::Io);},
                Err(e) if matches!(e.kind(),io::ErrorKind::WouldBlock|io::ErrorKind::Interrupted)=>{},
                Err(_)=>{terminate(child,budget);return Err(PumpFailure::Io);},
            }
        }
        match child.terminal() {
            Ok(Some(false))=>return Err(PumpFailure::Exit),
            Ok(Some(true)) if eof && input_closed=>return if output.is_empty() {Err(PumpFailure::Output)} else {Ok(std::mem::take(&mut *output))},
            Ok(_)=>{},Err(_)=>{terminate(child,budget);return Err(PumpFailure::Io);},
        }
        child.tick();
    }
}
fn terminate(child:&mut impl ChildIo,budget:Duration) {
    child.close_input();let _=child.kill_owned();
    while child.elapsed()<budget {
        match child.terminal() {Ok(Some(_))=>return,Err(_)=>return,Ok(None)=>child.tick()}
    }
}

// Compiled helper binaries only, never config/profile/source data. Fresh owned
// files use create_new; foreign/mismatched cache objects are denied, not repaired.
fn stage_helper(directory:&Path,binary:&[u8],deadline:Instant)->Result<PathBuf,AwarenessStoreError> {
    if binary.is_empty() || binary.len()>MAX_HELPER_BYTES {return Err(AwarenessStoreError::Capacity);}
    verify_directory(directory,None)?;
    let cache=directory.join(CACHE_DIRECTORY);create_directory(&cache,directory)?;
    let digest=hex::encode(Sha256::digest(binary));let bundle=cache.join(format!("helper-{digest}.app"));
    create_directory(&bundle,&cache)?;
    let contents=bundle.join("Contents");create_directory(&contents,&bundle)?;
    let macos=contents.join("MacOS");create_directory(&macos,&contents)?;
    if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}
    let executable=macos.join(HELPER_NAME);ensure_file(&executable,binary,0o700)?;
    ensure_file(&contents.join("Info.plist"),INFO_PLIST,0o600)?;
    if Instant::now()>=deadline {return Err(AwarenessStoreError::Unavailable);}Ok(executable)
}
fn verify_directory(path:&Path,parent:Option<&Path>)->Result<(),AwarenessStoreError> {
    if !path.is_absolute() || path.starts_with("/Volumes") || path.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)) {
        return Err(AwarenessStoreError::UnsafePath);
    }
    let metadata=fs::symlink_metadata(path).map_err(|_|AwarenessStoreError::UnsafePath)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || fs::canonicalize(path).map_err(|_|AwarenessStoreError::UnsafePath)?!=path {
        return Err(AwarenessStoreError::UnsafePath);
    }
    #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};
        if metadata.permissions().mode()&0o777!=0o700 || parent.is_some_and(|p|fs::metadata(p).map_or(true,|m|m.uid()!=metadata.uid())) {
            return Err(AwarenessStoreError::UnsafePath);
        }}
    Ok(())
}
fn create_directory(path:&Path,parent:&Path)->Result<(),AwarenessStoreError> {
    let mut builder=fs::DirBuilder::new();
    #[cfg(unix)] {use std::os::unix::fs::DirBuilderExt;builder.mode(0o700);}
    match builder.create(path) {Ok(())=>{},Err(e)if e.kind()==io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err(AwarenessStoreError::Unavailable)}
    verify_directory(path,Some(parent))
}
fn ensure_file(path:&Path,expected:&[u8],mode:u32)->Result<(),AwarenessStoreError> {
    let mut create=fs::OpenOptions::new();create.write(true).create_new(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;create.mode(mode);}
    match create.open(path) {
        Ok(mut file)=>{file.write_all(expected).map_err(|_|AwarenessStoreError::Unavailable)?;file.sync_all().map_err(|_|AwarenessStoreError::Unavailable)?;},
        Err(e)if e.kind()==io::ErrorKind::AlreadyExists=>{},Err(_)=>return Err(AwarenessStoreError::Unavailable),
    }
    let metadata=fs::symlink_metadata(path).map_err(|_|AwarenessStoreError::UnsafePath)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len()!=expected.len() as u64 {return Err(AwarenessStoreError::UnsafePath);}
    #[cfg(unix)] {use std::os::unix::fs::{MetadataExt,PermissionsExt};
        let parent=path.parent().ok_or(AwarenessStoreError::UnsafePath)?;
        if metadata.nlink()!=1 || metadata.permissions().mode()&0o777!=mode || metadata.uid()!=fs::metadata(parent).map_err(|_|AwarenessStoreError::UnsafePath)?.uid() {return Err(AwarenessStoreError::UnsafePath);}}
    let mut read=fs::OpenOptions::new();read.read(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;read.custom_flags(libc::O_NOFOLLOW);}
    let file=read.open(path).map_err(|_|AwarenessStoreError::UnsafePath)?;
    #[cfg(unix)] {use std::os::unix::fs::MetadataExt;let opened=file.metadata().map_err(|_|AwarenessStoreError::UnsafePath)?;
        if opened.dev()!=metadata.dev() || opened.ino()!=metadata.ino() || opened.nlink()!=1 {return Err(AwarenessStoreError::UnsafePath);}}
    let mut bytes=Vec::new();file.take(expected.len() as u64+1).read_to_end(&mut bytes).map_err(|_|AwarenessStoreError::Unavailable)?;
    if bytes!=expected {return Err(AwarenessStoreError::UnsafePath);}Ok(())
}

#[cfg(target_os="macos")]
struct OwnedChild {
    child:Option<std::process::Child>,
    stdin:Option<std::process::ChildStdin>,
    stdout:std::process::ChildStdout,
    began:Instant,
    run:Arc<RunScope>,
}
#[cfg(target_os="macos")]
impl OwnedChild {
    fn spawn(path:&Path,run:Arc<RunScope>)->Result<Self,AwarenessStoreError> {
        use std::process::{Command,Stdio};
        let mut child=Command::new(path).env_clear().env("PATH","/usr/bin:/bin:/usr/sbin:/sbin")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|_|AwarenessStoreError::Unavailable)?;
        run.spawned.store(true,Ordering::Release);
        let stdin=child.stdin.take();let stdout=child.stdout.take();
        let Some(stdout)=stdout else {dispose(child,run);return Err(AwarenessStoreError::Unavailable);};
        let owned=Self {child:Some(child),stdin,stdout,began:Instant::now(),run};
        let stdin=owned.stdin.as_ref().ok_or(AwarenessStoreError::Unavailable)?;
        nonblocking(stdin)?;nonblocking(&owned.stdout)?;
        // Host-owned field only; no external PID or kill permission is exported.
        Ok(owned)
    }
}
#[cfg(target_os="macos")]
fn nonblocking(fd:&impl std::os::fd::AsFd)->Result<(),AwarenessStoreError> {
    let flags=rustix::fs::fcntl_getfl(fd).map_err(|_|AwarenessStoreError::Unavailable)?;
    rustix::fs::fcntl_setfl(fd,flags|rustix::fs::OFlags::NONBLOCK).map_err(|_|AwarenessStoreError::Unavailable)
}
#[cfg(target_os="macos")]
impl ChildIo for OwnedChild {
    fn elapsed(&self)->Duration {self.began.elapsed()}
    fn write_input(&mut self,bytes:&[u8])->io::Result<usize> {self.stdin.as_mut().ok_or_else(||io::Error::from(io::ErrorKind::BrokenPipe))?.write(bytes)}
    fn close_input(&mut self) {self.stdin.take();}
    fn read_output(&mut self,bytes:&mut[u8])->io::Result<usize> {self.stdout.read(bytes)}
    fn terminal(&mut self)->io::Result<Option<bool>> {
        let Some(child)=&mut self.child else {return Ok(Some(false));};
        let status=child.try_wait()?;
        if status.is_some() {self.run.terminal.store(true,Ordering::Release);}
        Ok(status.map(|s|s.success()))
    }
    fn kill_owned(&mut self)->io::Result<()> {self.child.as_mut().ok_or_else(||io::Error::from(io::ErrorKind::NotFound))?.kill()}
    fn tick(&mut self) {std::thread::sleep(TICK)}
}
#[cfg(target_os="macos")]
impl Drop for OwnedChild {fn drop(&mut self) {if let Some(child)=self.child.take() {dispose(child,Arc::clone(&self.run));}}}
#[cfg(target_os="macos")]
fn dispose(mut child:std::process::Child,run:Arc<RunScope>) {
    if matches!(child.try_wait(),Ok(Some(_))) {run.terminal.store(true,Ordering::Release);return;}
    let _=child.kill();
    if matches!(child.try_wait(),Ok(Some(_))) {run.terminal.store(true,Ordering::Release);return;}
    // Reaping may outlive the caller's deadline; the slot stays unknown/occupied
    // until wait actually returns. This thread never reads/captures or owns models.
    let _=std::thread::Builder::new().name("luca-machine-helper-reap".into()).spawn(move || {
        if child.wait().is_ok() {run.terminal.store(true,Ordering::Release);}
    });
}

#[cfg(test)]
#[path="machine_runner_tests.rs"]
mod tests;

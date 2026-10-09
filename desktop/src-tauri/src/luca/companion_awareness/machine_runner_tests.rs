//! Pure fake-child I/O; never spawn the helper, access a cache or observe apps.
use super::*;
enum Output {Never,Bytes(Vec<u8>)}
struct FakeChild {elapsed:Duration,input:Vec<u8>,closed:bool,output:Output,read:usize,killed:usize,terminal:bool}
impl FakeChild {fn new(output:Output)->Self {Self {elapsed:Duration::ZERO,input:Vec::new(),closed:false,output,read:0,killed:0,terminal:false}}}
impl ChildIo for FakeChild {
    fn elapsed(&self)->Duration {self.elapsed}
    fn write_input(&mut self,bytes:&[u8])->io::Result<usize> {let count=bytes.len().min(1024);self.input.extend_from_slice(&bytes[..count]);Ok(count)}
    fn close_input(&mut self) {self.closed=true;}
    fn read_output(&mut self,bytes:&mut[u8])->io::Result<usize> {match &self.output {
        Output::Never=>Err(io::Error::from(io::ErrorKind::WouldBlock)),Output::Bytes(output)=>{
            let count=(output.len()-self.read).min(bytes.len());bytes[..count].copy_from_slice(&output[self.read..self.read+count]);self.read+=count;Ok(count)}
    }}
    fn terminal(&mut self)->io::Result<Option<bool>> {if self.terminal {Ok(Some(false))}
        else if self.closed && matches!(&self.output,Output::Bytes(bytes)if self.read==bytes.len()) {Ok(Some(true))} else {Ok(None)}}
    fn kill_owned(&mut self)->io::Result<()> {self.killed+=1;self.terminal=true;Ok(())}
    fn tick(&mut self) {self.elapsed+=Duration::from_millis(5);}
}
#[test]
fn original_two_second_deadline_kills_only_the_owned_fake_and_observes_reap() {
    let mut child=FakeChild::new(Output::Never);
    assert_eq!(pump(&mut child,b"{}",&AtomicBool::new(false),Duration::from_secs(20)),Err(PumpFailure::Deadline));
    assert_eq!(child.killed,1);assert!(child.terminal);assert!(child.elapsed<=MAX_RUN_TIME);
}
#[test]
fn bounded_stdout_and_input_never_become_unbounded_wait_with_output() {
    let mut child=FakeChild::new(Output::Bytes(vec![b'x';MAX_MACHINE_REPLY_BYTES+1]));
    assert_eq!(pump(&mut child,b"{}",&AtomicBool::new(false),MAX_RUN_TIME),Err(PumpFailure::Output));
    assert_eq!(child.killed,1);
    let mut invalid=FakeChild::new(Output::Never);
    assert_eq!(pump(&mut invalid,&vec![b'x';MAX_MACHINE_REQUEST_BYTES+1],&AtomicBool::new(false),MAX_RUN_TIME),Err(PumpFailure::Input));
    assert!(invalid.input.is_empty());
    let mut valid=FakeChild::new(Output::Bytes(b"{\"status\":\"unavailable\"}".to_vec()));
    let input=vec![b'x';MAX_MACHINE_REQUEST_BYTES];
    assert!(pump(&mut valid,&input,&AtomicBool::new(false),MAX_RUN_TIME).is_ok());
    assert_eq!(valid.input,input);assert_eq!(valid.killed,0);assert!(valid.closed);
}
fn key(source:&str,resident:char)->AwarenessGrantKeyV1 {AwarenessGrantKeyV1 {
    source:super::super::AwarenessSourceKeyV1 {owner_pubkey:Hex64::parse("11".repeat(32)).unwrap(),source_id:OpaqueId::parse(source).unwrap(),device_id:OpaqueId::parse("internal-device").unwrap()},
    resident_pubkey:Hex64::parse(resident.to_string().repeat(64)).unwrap()}}
#[test]
fn cancellation_is_exact_owned_scope_and_request_is_not_stopped_proof() {
    let runner=MachineHelperRunnerV1::default();let scope=key("source-owned",'2');let run=runner.claim(&scope).unwrap();
    assert!(!runner.cancel_grant(&key("source-other",'2')).unwrap());
    assert!(!runner.cancel_resident(&scope.source.owner_pubkey,&key("source-owned",'3').resident_pubkey).unwrap());
    assert!(runner.cancel_grant(&scope).unwrap());let status=runner.status(&scope).unwrap().unwrap();
    assert!(status.cancel_requested);assert!(!status.terminal_seen);assert!(runner.claim(&scope).is_err());
    let mut child=FakeChild::new(Output::Never);assert_eq!(pump(&mut child,b"{}",&run.cancel,MAX_RUN_TIME),Err(PumpFailure::Cancelled));
    assert_eq!(child.killed,1);assert!(child.input.is_empty());
    run.terminal.store(true,Ordering::Release);assert!(runner.status(&scope).unwrap().unwrap().terminal_seen);
    assert!(runner.claim(&scope).is_ok());
}

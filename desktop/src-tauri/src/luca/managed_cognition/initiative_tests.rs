use super::*;
use luca_protocol::{Hex64, OpaqueId};

fn future_request() -> ResidentPrivateCognitionRequestV1 {
    let now = chrono::Utc::now();
    let admitted = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut semantic: luca_protocol::InitiativeSemanticThreadV1 = serde_json::from_value(serde_json::json!({
        "protocol":luca_protocol::INITIATIVE_SEMANTIC_THREAD_PROTOCOL,"thread_id":"thread:private-owned",
        "owner_pubkey":"a".repeat(64),"resident_pubkey":"b".repeat(64),"kind":"own","disposition":"carried","revision":0,
        "body":"PRIVATE_CARRIED_SENTINEL","source_event_ids":[],"source_refs":[format!("sha256:{}","e".repeat(64))],
        "created_at":admitted,"updated_at":admitted
    })).expect("canonical fixture");
    // Use current, not a stale calendar fixture, for synthetic socket framing.
    semantic.updated_at = luca_protocol::CanonicalTimestamp::parse(admitted.clone()).expect("time");
    let reference =
        |c: char| Sha256Ref::parse(format!("sha256:{}", c.to_string().repeat(64))).expect("ref");
    let thread = luca_protocol::InitiativeThreadV1 {
        protocol: luca_protocol::INITIATIVE_PROTOCOL.into(),
        thread_id: semantic.thread_id.clone(),
        owner_pubkey: semantic.owner_pubkey.clone(),
        resident_pubkey: semantic.resident_pubkey.clone(),
        kind: semantic.kind,
        disposition: luca_protocol::InitiativeDispositionV1::Carried,
        revision: SafeU53::new(1).expect("revision"),
        canonical_thread_ref: luca_protocol::derive_initiative_thread_ref(
            &semantic.owner_pubkey,
            &semantic.resident_pubkey,
            &semantic.thread_id,
        )
        .expect("identity"),
        canonical_revision_ref: semantic.revision_ref().expect("revision ref"),
        source_refs: semantic.source_refs.clone(),
        checkpoint_ref: None,
        eligible_after: None,
        updated_at: semantic.updated_at.clone(),
    };
    ResidentPrivateCognitionRequestV1::InitiativePursuit {
        request: luca_protocol::InitiativePursuitRequestV1 {
            protocol: luca_protocol::INITIATIVE_PURSUIT_PROTOCOL.into(),
            job_id: OpaqueId::parse("pursuit:socket-fixture").expect("job"),
            owner_pubkey: semantic.owner_pubkey.clone(),
            resident_pubkey: semantic.resident_pubkey.clone(),
            binding_ref: reference('c'),
            session_epoch: SafeU53::new(3).expect("epoch"),
            thread,
            semantic_thread: semantic,
            evidence: Vec::new(),
            admitted_at: luca_protocol::CanonicalTimestamp::parse(admitted).expect("time"),
            deadline_unix_ms: SafeU53::new(unix_time_millis() + 5000).expect("deadline"),
            max_result_bytes: SafeU53::new(24 * 1024).expect("bound"),
        },
    }
}
fn client(
    request: &ResidentPrivateCognitionRequestV1,
) -> (Arc<ManagedCognitionClient>, std::os::unix::net::UnixStream) {
    let (socket, remote) = std::os::unix::net::UnixStream::pair().expect("sentinel socketpair");
    let reader = socket.try_clone().expect("reader");
    let writer = socket.try_clone().expect("control writer");
    (
        Arc::new(ManagedCognitionClient {
            resident_pubkey: request.resident_pubkey().clone(),
            session_epoch: SafeU53::new(3).expect("epoch"),
            binding_ref: request.binding_ref().clone(),
            invalidated: AtomicBool::new(false),
            initiative_supported_adapter: AtomicBool::new(true),
            channel: Mutex::new(Channel {
                reader: BufReader::new(reader),
                writer: socket,
            }),
            control_writer: Mutex::new(writer),
            pending_initiative: Mutex::new(None),
        }),
        remote,
    )
}

#[test]
fn cancellation_uses_separate_writer_while_model_await_lock_is_held() {
    let request = future_request();
    let (client, remote) = client(&request);
    remote
        .set_read_timeout(Some(Duration::from_secs(1)))
        .expect("read bound");
    let claim = client
        .begin_initiative(request.clone())
        .expect("bounded write only");
    let cancellation = claim.cancellation();
    let model_await_lock = client
        .channel
        .lock()
        .expect("simulate blocked model reader");
    let mut reader = BufReader::new(remote);
    let mut bytes = Vec::new();
    reader.read_until(b'\n', &mut bytes).expect("request frame");
    assert!(
        serde_json::from_slice::<ResidentPrivateCognitionRequestV1>(&bytes)
            .expect("wire")
            .validate()
            .is_ok()
    );
    let wrong = ResidentPrivateCognitionControlV1::CancelInitiative {
        job_id: OpaqueId::parse("pursuit:other").expect("ID"),
        resident_pubkey: Hex64::parse("b".repeat(64)).expect("resident"),
        binding_ref: request.binding_ref().clone(),
        session_epoch: SafeU53::new(3).expect("epoch"),
    };
    assert!(!client.cancel_initiative(&wrong).expect("other job denied"));
    assert!(cancellation
        .cancel()
        .expect("must not wait behind model mutex"));
    bytes.clear();
    reader
        .read_until(b'\n', &mut bytes)
        .expect("bounded cancellation frame");
    let control: ResidentPrivateCognitionControlV1 =
        serde_json::from_slice(&bytes).expect("strict control");
    assert!(control.matches_initiative(&request));
    assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_CARRIED_SENTINEL"));
    drop(model_await_lock);
    drop(claim);
}

#[test]
fn undrained_claim_closes_only_private_transport_and_never_reassigns_late_reply() {
    let request = future_request();
    let (client, mut remote) = client(&request);
    let claim = client.begin_initiative(request.clone()).expect("begin");
    assert!(matches!(
        client.begin_initiative(request.clone()),
        Err(ManagedCognitionError::Busy)
    ));
    let mut reader = BufReader::new(remote.try_clone().expect("remote reader"));
    let mut frame = Vec::new();
    reader
        .read_until(b'\n', &mut frame)
        .expect("written request");
    drop(claim);
    assert!(client.invalidated.load(Ordering::Acquire));
    assert!(matches!(
        client.begin_initiative(request),
        Err(ManagedCognitionError::Unavailable)
    ));
    // No app, native process, model, public socket or profile is used by this fixture.
    let _ = remote.write_all(b"late reply must never be reused\n");
}

//! Trusted desktop endpoint for private resident continuity cognition.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};

#[cfg(unix)]
use std::{
    io::{BufRead, BufReader, Read, Write},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use luca_protocol::{
    CreateResidentJournalPageRequestV1, CreateResidentJournalPageResultV1,
    LocalContinuityCognitionRequestV1, LocalContinuityCognitionResultV1,
    ResidentPrivateCognitionRequestV1, ResidentPrivateCognitionResultV1,
    RuntimeTaskDeliveryRequestV1, RuntimeTaskDeliveryResultV1, SafeU53, Sha256Ref,
};
use serde::Deserialize;

const MAX_FRAME_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManagedCognitionError {
    /// A trusted pre-admission outcome proves this request was not admitted.
    Busy,
    Unavailable,
    Invalid,
    Timeout,
}

impl std::fmt::Display for ManagedCognitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Busy => "resident cognition is waiting for existing user work",
            Self::Unavailable => "resident cognition runtime is unavailable",
            Self::Invalid => "resident cognition request is invalid or stale",
            Self::Timeout => "resident cognition request timed out",
        })
    }
}

impl std::error::Error for ManagedCognitionError {}

#[cfg(unix)]
struct Channel {
    reader: BufReader<std::os::unix::net::UnixStream>,
    writer: std::os::unix::net::UnixStream,
}

pub(crate) struct ManagedCognitionClient {
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
    invalidated: AtomicBool,
    #[cfg(unix)]
    channel: Mutex<Channel>,
}

impl std::fmt::Debug for ManagedCognitionClient {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedCognitionClient")
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("binding_ref", &self.binding_ref)
            .finish_non_exhaustive()
    }
}

#[cfg(unix)]
#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
enum WireReply {
    Completed {
        result: Box<ResidentPrivateCognitionResultV1>,
    },
    Unavailable {
        job_id: luca_protocol::OpaqueId,
        code: String,
    },
}

#[cfg(unix)]
struct DecodedReply {
    result: Result<ResidentPrivateCognitionResultV1, ManagedCognitionError>,
    invalidates_channel: bool,
}

#[cfg(unix)]
fn decode_reply(response: &[u8], request: &ResidentPrivateCognitionRequestV1) -> DecodedReply {
    let Ok(reply) = serde_json::from_slice::<WireReply>(response) else {
        return DecodedReply {
            result: Err(ManagedCognitionError::Unavailable),
            invalidates_channel: true,
        };
    };
    match reply {
        WireReply::Completed { result } => {
            let valid = result.validate_against(request).is_ok();
            DecodedReply {
                result: if valid {
                    Ok(*result)
                } else {
                    Err(ManagedCognitionError::Invalid)
                },
                invalidates_channel: !valid,
            }
        }
        WireReply::Unavailable { job_id, code } => {
            if &job_id != request.job_id() {
                return DecodedReply {
                    result: Err(ManagedCognitionError::Unavailable),
                    invalidates_channel: true,
                };
            }
            DecodedReply {
                result: Err(match code.as_str() {
                    "runtime_busy" | "user_work_pending" => ManagedCognitionError::Busy,
                    "deadline_expired" => ManagedCognitionError::Timeout,
                    _ => ManagedCognitionError::Unavailable,
                }),
                invalidates_channel: false,
            }
        }
    }
}

/// Child-side descriptor for the dedicated private cognition socket.
#[cfg(unix)]
pub(crate) struct ManagedCognitionChildFd(std::os::fd::OwnedFd);

#[cfg(unix)]
impl ManagedCognitionChildFd {
    pub(crate) fn raw_fd(&self) -> std::os::fd::RawFd {
        use std::os::fd::AsRawFd;
        self.0.as_raw_fd()
    }
}

#[cfg(unix)]
pub(crate) fn create_endpoint(
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
) -> Result<(ManagedCognitionChildFd, Arc<ManagedCognitionClient>), String> {
    let (desktop, child) = std::os::unix::net::UnixStream::pair()
        .map_err(|error| format!("create managed cognition socketpair: {error}"))?;
    let reader = desktop
        .try_clone()
        .map_err(|error| format!("clone managed cognition socket: {error}"))?;
    let client = Arc::new(ManagedCognitionClient {
        resident_pubkey,
        session_epoch,
        binding_ref,
        invalidated: AtomicBool::new(false),
        channel: Mutex::new(Channel {
            reader: BufReader::new(reader),
            writer: desktop,
        }),
    });
    let owned = std::os::fd::OwnedFd::from(child);
    Ok((ManagedCognitionChildFd(owned), client))
}

fn clients() -> &'static Mutex<std::collections::HashMap<String, Arc<ManagedCognitionClient>>> {
    static CLIENTS: OnceLock<
        Mutex<std::collections::HashMap<String, Arc<ManagedCognitionClient>>>,
    > = OnceLock::new();
    CLIENTS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

pub(crate) fn register(client: Arc<ManagedCognitionClient>) -> Result<(), String> {
    let key = client.resident_pubkey.as_str().to_owned();
    let mut registry = clients()
        .lock()
        .map_err(|_| "managed cognition registry is unavailable".to_owned())?;
    if registry.contains_key(&key) {
        return Err("managed cognition client already exists".to_owned());
    }
    registry.insert(key, client);
    Ok(())
}

pub(crate) fn unregister(resident_pubkey: &str) {
    if let Ok(mut registry) = clients().lock() {
        registry.remove(resident_pubkey);
    }
}

pub(crate) fn active_binding_ref(
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<Sha256Ref, ManagedCognitionError> {
    clients()
        .lock()
        .map_err(|_| ManagedCognitionError::Unavailable)?
        .get(resident_pubkey.as_str())
        .filter(|client| !client.invalidated.load(Ordering::Acquire))
        .map(|client| client.binding_ref.clone())
        .ok_or(ManagedCognitionError::Unavailable)
}

/// Current broker-bound runtime epoch for an exact resident's delivery claim.
pub(crate) fn active_session_epoch(
    resident_pubkey: &luca_protocol::Hex64,
) -> Result<SafeU53, ManagedCognitionError> {
    clients()
        .lock()
        .map_err(|_| ManagedCognitionError::Unavailable)?
        .get(resident_pubkey.as_str())
        .filter(|client| {
            client.session_epoch.get() != 0 && !client.invalidated.load(Ordering::Acquire)
        })
        .map(|client| client.session_epoch)
        .ok_or(ManagedCognitionError::Unavailable)
}

pub(crate) fn request(
    request: &LocalContinuityCognitionRequestV1,
) -> Result<LocalContinuityCognitionResultV1, ManagedCognitionError> {
    let envelope = ResidentPrivateCognitionRequestV1::Metabolism {
        request: request.clone(),
    };
    match request_private(&envelope, None)? {
        ResidentPrivateCognitionResultV1::Metabolism { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

pub(crate) fn request_journal(
    request: &CreateResidentJournalPageRequestV1,
) -> Result<CreateResidentJournalPageResultV1, ManagedCognitionError> {
    let envelope = ResidentPrivateCognitionRequestV1::Journal {
        request: request.clone(),
    };
    match request_private(&envelope, None)? {
        ResidentPrivateCognitionResultV1::Journal { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

/// Synthesize one verified task result and receive its typed broker outcome.
pub(crate) fn request_runtime_task(
    request: &RuntimeTaskDeliveryRequestV1,
    session_epoch: SafeU53,
) -> Result<RuntimeTaskDeliveryResultV1, ManagedCognitionError> {
    let envelope = ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery {
        request: request.clone(),
    };
    match request_private(&envelope, Some(session_epoch))? {
        ResidentPrivateCognitionResultV1::RuntimeTaskDelivery { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

fn request_frame(
    request: &ResidentPrivateCognitionRequestV1,
) -> Result<Vec<u8>, ManagedCognitionError> {
    let mut frame = serde_json::to_vec(request).map_err(|_| ManagedCognitionError::Invalid)?;
    // Bounds apply to the actual escaped envelope including its delimiter,
    // not just the reference's UTF-8 byte count. Never grow the global frame.
    if frame.len() >= MAX_FRAME_BYTES {
        return Err(ManagedCognitionError::Invalid);
    }
    frame.push(b'\n');
    Ok(frame)
}

fn request_private(
    request: &ResidentPrivateCognitionRequestV1,
    expected_session_epoch: Option<SafeU53>,
) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
    request
        .validate()
        .map_err(|_| ManagedCognitionError::Invalid)?;
    let client = clients()
        .lock()
        .map_err(|_| ManagedCognitionError::Unavailable)?
        .get(request.resident_pubkey().as_str())
        .cloned()
        .ok_or(ManagedCognitionError::Unavailable)?;
    if expected_session_epoch.is_some_and(|epoch| epoch != client.session_epoch) {
        return Err(ManagedCognitionError::Busy);
    }
    client.request(request, expected_session_epoch.is_none())
}

impl ManagedCognitionClient {
    #[cfg(unix)]
    fn request(
        &self,
        request: &ResidentPrivateCognitionRequestV1,
        wait_for_channel: bool,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        if self.invalidated.load(Ordering::Acquire) {
            return Err(ManagedCognitionError::Unavailable);
        }
        if request.resident_pubkey() != &self.resident_pubkey
            || request.binding_ref() != &self.binding_ref
            || self.session_epoch.get() == 0
        {
            return Err(ManagedCognitionError::Invalid);
        }
        let frame = request_frame(request)?;
        let mut channel = if wait_for_channel {
            self.channel
                .lock()
                .map_err(|_| ManagedCognitionError::Unavailable)?
        } else {
            // Task delivery polls admission within one original deadline.
            // Waiting behind other private work must not extend that bound.
            self.channel.try_lock().map_err(|error| match error {
                std::sync::TryLockError::WouldBlock => ManagedCognitionError::Busy,
                std::sync::TryLockError::Poisoned(_) => ManagedCognitionError::Unavailable,
            })?
        };
        if self.invalidated.load(Ordering::Acquire) {
            return Err(ManagedCognitionError::Unavailable);
        }
        // Another private request may have held the channel. The original
        // deadline still applies after acquiring it; never extend admission.
        let remaining = request
            .deadline_unix_ms()
            .get()
            .saturating_sub(unix_time_millis());
        if remaining == 0 {
            return Err(ManagedCognitionError::Timeout);
        }
        let timeout = Duration::from_millis(remaining);
        channel
            .writer
            .set_write_timeout(Some(timeout))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        channel
            .reader
            .get_ref()
            .set_read_timeout(Some(timeout))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        if let Err(error) = channel
            .writer
            .write_all(&frame)
            .and_then(|_| channel.writer.flush())
        {
            self.invalidate_channel(&channel);
            return Err(map_io(error));
        }
        let mut response = Vec::new();
        let read = match channel
            .reader
            .by_ref()
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut response)
        {
            Ok(read) => read,
            Err(error) => {
                self.invalidate_channel(&channel);
                return Err(map_io(error));
            }
        };
        if read == 0 || response.len() > MAX_FRAME_BYTES || response.last() != Some(&b'\n') {
            self.invalidate_channel(&channel);
            return Err(ManagedCognitionError::Unavailable);
        }
        let result = decode_reply(&response, request);
        if result.invalidates_channel {
            self.invalidate_channel(&channel);
        }
        result.result
    }

    #[cfg(not(unix))]
    fn request(
        &self,
        _request: &ResidentPrivateCognitionRequestV1,
        _wait_for_channel: bool,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        Err(ManagedCognitionError::Unavailable)
    }
    #[cfg(unix)]
    fn invalidate_channel(&self, channel: &Channel) {
        // A transport timeout may leave a late reply for this same stable job
        // ID, including bytes already buffered by BufReader. Set the flag
        // before closing only this socket; public resident work is untouched.
        self.invalidated.store(true, Ordering::Release);
        let _ = channel.writer.shutdown(std::net::Shutdown::Both);
    }
}

#[cfg(unix)]
fn map_io(error: std::io::Error) -> ManagedCognitionError {
    if matches!(
        error.kind(),
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
    ) {
        ManagedCognitionError::Timeout
    } else {
        ManagedCognitionError::Unavailable
    }
}

#[cfg(unix)]
fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod runtime_task_delivery_tests {
    use super::*;

    fn request(excerpt: String) -> ResidentPrivateCognitionRequestV1 {
        ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery {
            request: serde_json::from_value(serde_json::json!({
                "protocol": luca_protocol::RUNTIME_TASK_DELIVERY_PROTOCOL,
                "delivery_id": format!("task-result:{}", "d".repeat(64)),
                "task_id": "task:fixture",
                "owner_pubkey": "a".repeat(64),
                "resident_pubkey": "b".repeat(64),
                "conversation_id": "conversation:fixture",
                "binding_ref": format!("sha256:{}", "c".repeat(64)),
                "result_sha256": format!("sha256:{}", "e".repeat(64)),
                "runtime_family": "claude",
                "summary": "PRIVATE_TASK_SUMMARY",
                "result_excerpt": excerpt,
                "result_total_bytes": 1024 * 1024,
                "result_is_excerpt": true,
                "deadline_unix_ms": 4000,
                "max_draft_bytes": 512,
            }))
            .expect("synthetic bounded delivery"),
        }
    }

    #[test]
    fn escaped_48k_reference_cannot_raise_private_cognition_frame_limit() {
        let request = request("\u{1}".repeat(48 * 1024));
        assert!(request.validate().is_ok());
        assert_eq!(request_frame(&request), Err(ManagedCognitionError::Invalid));
    }

    #[test]
    fn default_8k_reference_fits_even_worst_case_json_escape_expansion() {
        let request = request("\u{1}".repeat(8 * 1024));
        let frame = request_frame(&request).expect("bounded default frame");
        assert!(frame.len() <= MAX_FRAME_BYTES);
        assert_eq!(frame.last(), Some(&b'\n'));
        assert_eq!(
            serde_json::from_slice::<ResidentPrivateCognitionRequestV1>(&frame)
                .expect("strict private request frame"),
            request
        );
    }

    #[cfg(unix)]
    fn unavailable(code: &str, job_id: &str) -> Vec<u8> {
        let mut frame = serde_json::to_vec(&serde_json::json!({
            "status": "unavailable", "job_id": job_id, "code": code
        }))
        .unwrap();
        frame.push(b'\n');
        frame
    }

    #[cfg(unix)]
    #[test]
    fn only_correlated_pre_admission_replies_are_busy() {
        let request = request("verified result".into());
        for code in ["runtime_busy", "user_work_pending"] {
            let decoded = decode_reply(&unavailable(code, request.job_id().as_str()), &request);
            assert_eq!(decoded.result, Err(ManagedCognitionError::Busy));
            assert!(!decoded.invalidates_channel);
        }
        for code in [
            "runtime_failed",
            "invalid_or_duplicate",
            "publication_unavailable",
            "binding_unavailable",
            "invalid_result",
            "unknown_code",
        ] {
            let decoded = decode_reply(&unavailable(code, request.job_id().as_str()), &request);
            assert_eq!(decoded.result, Err(ManagedCognitionError::Unavailable));
            assert!(!decoded.invalidates_channel);
        }
        let decoded = decode_reply(
            &unavailable("deadline_expired", request.job_id().as_str()),
            &request,
        );
        assert_eq!(decoded.result, Err(ManagedCognitionError::Timeout));
        assert!(!decoded.invalidates_channel);
    }

    #[cfg(unix)]
    #[test]
    fn missing_mismatched_or_malformed_private_replies_cannot_prove_non_admission() {
        let request = request("verified result".into());
        for frame in [
            unavailable("runtime_busy", "different-job"),
            b"{\"status\":\"unavailable\",\"code\":\"runtime_busy\"}\n".to_vec(),
            b"PRIVATE_MALFORMED\n".to_vec(),
        ] {
            let decoded = decode_reply(&frame, &request);
            assert_eq!(decoded.result, Err(ManagedCognitionError::Unavailable));
            assert!(decoded.invalidates_channel);
        }
    }

    #[cfg(unix)]
    #[test]
    fn completed_private_result_still_requires_exact_task_and_digest() {
        let request = request("verified result".into());
        let ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery { request: task } = &request
        else {
            unreachable!();
        };
        let mut result = RuntimeTaskDeliveryResultV1 {
            protocol: luca_protocol::RUNTIME_TASK_DELIVERY_PROTOCOL.into(),
            delivery_id: task.delivery_id.clone(),
            task_id: task.task_id.clone(),
            result_sha256: task.result_sha256.clone(),
            publication: luca_protocol::ManagedMessagePublishResultV1::Unavailable {
                code: luca_protocol::OpaqueId::parse("publication_pending").unwrap(),
            },
        };
        for valid in [true, false] {
            if !valid {
                result.task_id = luca_protocol::OpaqueId::parse("wrong-task").unwrap();
            }
            let frame = serde_json::to_vec(&serde_json::json!({
                "status": "completed",
                "result": ResidentPrivateCognitionResultV1::RuntimeTaskDelivery {
                    result: result.clone()
                }
            }))
            .unwrap();
            let decoded = decode_reply(&frame, &request);
            assert_eq!(decoded.invalidates_channel, !valid);
            if valid {
                assert!(decoded.result.is_ok());
            } else {
                assert_eq!(decoded.result, Err(ManagedCognitionError::Invalid));
            }
        }
    }

    #[cfg(unix)]
    fn future_request() -> ResidentPrivateCognitionRequestV1 {
        let mut request = request("verified result".into());
        if let ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery { request } = &mut request {
            request.deadline_unix_ms = SafeU53::new(unix_time_millis() + 2_000).unwrap();
        }
        request
    }

    #[cfg(unix)]
    fn test_endpoint(
        request: &ResidentPrivateCognitionRequestV1,
    ) -> (std::os::unix::net::UnixStream, Arc<ManagedCognitionClient>) {
        let (child, client) = create_endpoint(
            request.resident_pubkey().clone(),
            SafeU53::new(7).unwrap(),
            request.binding_ref().clone(),
        )
        .unwrap();
        let stream = std::os::unix::net::UnixStream::from(child.0);
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        (stream, client)
    }

    #[cfg(unix)]
    #[test]
    fn runtime_task_channel_contention_is_unstarted_without_poisoning_or_writing() {
        let request = future_request();
        let (mut child, client) = test_endpoint(&request);
        let guard = client.channel.lock().unwrap();
        assert_eq!(
            client.request(&request, false),
            Err(ManagedCognitionError::Busy)
        );
        assert!(!client.invalidated.load(Ordering::Acquire));
        child.set_nonblocking(true).unwrap();
        assert_eq!(
            child.read(&mut [0_u8]).unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
        drop(guard);
    }

    #[cfg(unix)]
    #[test]
    fn correlated_busy_and_post_start_unavailable_keep_private_framing_usable() {
        let request = future_request();
        let (mut child, client) = test_endpoint(&request);
        let job_id = request.job_id().as_str().to_owned();
        let server = std::thread::spawn(move || {
            let mut reader = BufReader::new(child.try_clone().unwrap());
            for code in ["runtime_busy", "runtime_failed", "deadline_expired"] {
                let mut frame = Vec::new();
                assert!(reader.read_until(b'\n', &mut frame).unwrap() > 0);
                child.write_all(&unavailable(code, &job_id)).unwrap();
            }
        });
        for expected in [
            ManagedCognitionError::Busy,
            ManagedCognitionError::Unavailable,
            ManagedCognitionError::Timeout,
        ] {
            assert_eq!(client.request(&request, true), Err(expected));
            assert!(!client.invalidated.load(Ordering::Acquire));
        }
        server.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn late_same_job_busy_after_transport_timeout_cannot_cross_into_a_new_claim() {
        let mut request = future_request();
        if let ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery { request } = &mut request {
            request.deadline_unix_ms = SafeU53::new(unix_time_millis() + 500).unwrap();
        }
        let (mut child, client) = test_endpoint(&request);
        let job_id = request.job_id().as_str().to_owned();
        let server = std::thread::spawn(move || {
            let mut reader = BufReader::new(child.try_clone().unwrap());
            let mut frame = Vec::new();
            assert!(reader.read_until(b'\n', &mut frame).unwrap() > 0);
            std::thread::sleep(Duration::from_millis(750));
            // Some kernels still accept a peer write after shutdown. The
            // invalidation flag, not that write result, is the guard.
            let _ = child.write_all(&unavailable("runtime_busy", &job_id));
            frame.clear();
            assert_eq!(reader.read_until(b'\n', &mut frame).unwrap(), 0);
        });
        assert_eq!(
            client.request(&request, true),
            Err(ManagedCognitionError::Timeout)
        );
        assert!(client.invalidated.load(Ordering::Acquire));
        if let ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery { request } = &mut request {
            request.deadline_unix_ms = SafeU53::new(unix_time_millis() + 2_000).unwrap();
        }
        assert_eq!(
            client.request(&request, true),
            Err(ManagedCognitionError::Unavailable)
        );
        server.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn invalid_or_partial_frame_poison_discards_already_buffered_busy_bytes() {
        let request = future_request();
        for invalid in [
            b"PRIVATE_MALFORMED\n".to_vec(),
            unavailable("runtime_busy", "different-job"),
            b"{\"status\":".to_vec(),
            vec![b'x'; MAX_FRAME_BYTES + 1],
        ] {
            let (mut child, client) = test_endpoint(&request);
            let job_id = request.job_id().as_str().to_owned();
            let server = std::thread::spawn(move || {
                let mut reader = BufReader::new(child.try_clone().unwrap());
                let mut frame = Vec::new();
                assert!(reader.read_until(b'\n', &mut frame).unwrap() > 0);
                let mut reply = invalid;
                reply.extend(unavailable("runtime_busy", &job_id));
                let _ = child.write_all(&reply);
            });
            assert_eq!(
                client.request(&request, true),
                Err(ManagedCognitionError::Unavailable)
            );
            assert!(client.invalidated.load(Ordering::Acquire));
            assert_eq!(
                client.request(&request, true),
                Err(ManagedCognitionError::Unavailable)
            );
            server.join().unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn poisoned_private_client_is_not_an_active_binding_and_stale_epoch_never_dispatches() {
        let mut request = future_request();
        let unique_resident =
            luca_protocol::Hex64::parse(uuid::Uuid::new_v4().simple().to_string().repeat(2))
                .unwrap();
        if let ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery { request } = &mut request {
            request.resident_pubkey = unique_resident.clone();
        }
        let (_child, client) = test_endpoint(&request);
        register(Arc::clone(&client)).unwrap();
        assert!(active_binding_ref(&unique_resident).is_ok());
        assert_eq!(active_session_epoch(&unique_resident).unwrap().get(), 7);
        assert_eq!(
            request_private(&request, Some(SafeU53::new(8).unwrap())),
            Err(ManagedCognitionError::Busy)
        );
        client.invalidate_channel(&client.channel.lock().unwrap());
        assert_eq!(
            active_binding_ref(&unique_resident),
            Err(ManagedCognitionError::Unavailable)
        );
        assert_eq!(
            active_session_epoch(&unique_resident),
            Err(ManagedCognitionError::Unavailable)
        );
        unregister(unique_resident.as_str());
    }
}

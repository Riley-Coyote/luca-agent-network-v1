//! Trusted desktop endpoint for private resident continuity cognition.

use std::sync::{Arc, Mutex, OnceLock};

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
    Unavailable,
    Invalid,
    Timeout,
}

impl std::fmt::Display for ManagedCognitionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
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
        code: String,
    },
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
        .filter(|client| client.session_epoch.get() != 0)
        .map(|client| client.session_epoch)
        .ok_or(ManagedCognitionError::Unavailable)
}

pub(crate) fn request(
    request: &LocalContinuityCognitionRequestV1,
) -> Result<LocalContinuityCognitionResultV1, ManagedCognitionError> {
    let envelope = ResidentPrivateCognitionRequestV1::Metabolism {
        request: request.clone(),
    };
    match request_private(&envelope)? {
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
    match request_private(&envelope)? {
        ResidentPrivateCognitionResultV1::Journal { result } => Ok(result),
        _ => Err(ManagedCognitionError::Invalid),
    }
}

/// Synthesize one verified task result and receive its typed broker outcome.
pub(crate) fn request_runtime_task(
    request: &RuntimeTaskDeliveryRequestV1,
) -> Result<RuntimeTaskDeliveryResultV1, ManagedCognitionError> {
    let envelope = ResidentPrivateCognitionRequestV1::RuntimeTaskDelivery {
        request: request.clone(),
    };
    match request_private(&envelope)? {
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
    client.request(request)
}

impl ManagedCognitionClient {
    #[cfg(unix)]
    fn request(
        &self,
        request: &ResidentPrivateCognitionRequestV1,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        if request.resident_pubkey() != &self.resident_pubkey
            || request.binding_ref() != &self.binding_ref
            || self.session_epoch.get() == 0
        {
            return Err(ManagedCognitionError::Invalid);
        }
        let remaining = request
            .deadline_unix_ms()
            .get()
            .saturating_sub(unix_time_millis());
        if remaining == 0 {
            return Err(ManagedCognitionError::Timeout);
        }
        let frame = request_frame(request)?;
        let timeout = Duration::from_millis(remaining);
        let mut channel = self
            .channel
            .lock()
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        channel
            .writer
            .set_write_timeout(Some(timeout))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        channel
            .reader
            .get_ref()
            .set_read_timeout(Some(timeout))
            .map_err(|_| ManagedCognitionError::Unavailable)?;
        channel
            .writer
            .write_all(&frame)
            .and_then(|_| channel.writer.flush())
            .map_err(map_io)?;
        let mut response = Vec::new();
        let read = channel
            .reader
            .by_ref()
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut response)
            .map_err(map_io)?;
        if read == 0 || response.len() > MAX_FRAME_BYTES || response.last() != Some(&b'\n') {
            return Err(ManagedCognitionError::Unavailable);
        }
        match serde_json::from_slice::<WireReply>(&response)
            .map_err(|_| ManagedCognitionError::Invalid)?
        {
            WireReply::Completed { result } => {
                result
                    .validate_against(request)
                    .map_err(|_| ManagedCognitionError::Invalid)?;
                Ok(*result)
            }
            WireReply::Unavailable { code } if code == "deadline_expired" => {
                Err(ManagedCognitionError::Timeout)
            }
            WireReply::Unavailable { .. } => Err(ManagedCognitionError::Unavailable),
        }
    }

    #[cfg(not(unix))]
    fn request(
        &self,
        _request: &ResidentPrivateCognitionRequestV1,
    ) -> Result<ResidentPrivateCognitionResultV1, ManagedCognitionError> {
        Err(ManagedCognitionError::Unavailable)
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
}

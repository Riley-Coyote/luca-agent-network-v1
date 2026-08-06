//! Trusted desktop endpoint for private resident continuity cognition.

use std::{
    io::{BufRead, BufReader, Read, Write},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use luca_protocol::{
    LocalContinuityCognitionRequestV1, LocalContinuityCognitionResultV1, SafeU53, Sha256Ref,
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

struct Channel {
    reader: BufReader<std::os::unix::net::UnixStream>,
    writer: std::os::unix::net::UnixStream,
}

pub(crate) struct ManagedCognitionClient {
    resident_pubkey: luca_protocol::Hex64,
    session_epoch: SafeU53,
    binding_ref: Sha256Ref,
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

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
enum WireReply {
    Completed {
        result: Box<LocalContinuityCognitionResultV1>,
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

pub(crate) fn request(
    request: &LocalContinuityCognitionRequestV1,
) -> Result<LocalContinuityCognitionResultV1, ManagedCognitionError> {
    request
        .validate()
        .map_err(|_| ManagedCognitionError::Invalid)?;
    let client = clients()
        .lock()
        .map_err(|_| ManagedCognitionError::Unavailable)?
        .get(request.resident_pubkey.as_str())
        .cloned()
        .ok_or(ManagedCognitionError::Unavailable)?;
    client.request(request)
}

impl ManagedCognitionClient {
    fn request(
        &self,
        request: &LocalContinuityCognitionRequestV1,
    ) -> Result<LocalContinuityCognitionResultV1, ManagedCognitionError> {
        if request.resident_pubkey != self.resident_pubkey
            || request.binding_ref != self.binding_ref
            || self.session_epoch.get() == 0
        {
            return Err(ManagedCognitionError::Invalid);
        }
        let remaining = request
            .deadline_unix_ms
            .get()
            .saturating_sub(unix_time_millis());
        if remaining == 0 {
            return Err(ManagedCognitionError::Timeout);
        }
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
        let mut frame = serde_json::to_vec(request).map_err(|_| ManagedCognitionError::Invalid)?;
        if frame.len() > MAX_FRAME_BYTES {
            return Err(ManagedCognitionError::Invalid);
        }
        frame.push(b'\n');
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
}

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

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

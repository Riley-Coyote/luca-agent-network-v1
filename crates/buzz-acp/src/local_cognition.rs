//! Private inherited channel for resident-authored continuity cognition.
//!
//! The channel carries body-free job authority from the trusted desktop. The
//! harness reloads signed conversation history itself, executes a fresh
//! tool-free session on the already configured resident runtime/model, and
//! returns validated private output without relay publication authority.

use std::time::{SystemTime, UNIX_EPOCH};

use luca_protocol::{
    LocalContinuityCognitionRequestV1, LocalContinuityCognitionResultV1, Sha256Ref,
};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

const INHERITED_FD: i32 = 5;
const MAX_FRAME_BYTES: usize = 64 * 1024;

pub(crate) struct CognitionEnvelope {
    pub request: LocalContinuityCognitionRequestV1,
    pub reply_tx: tokio::sync::oneshot::Sender<CognitionReply>,
}

#[derive(Debug)]
pub(crate) enum CognitionReply {
    Completed(LocalContinuityCognitionResultV1),
    Unavailable(&'static str),
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum WireReply {
    Completed {
        result: LocalContinuityCognitionResultV1,
    },
    Unavailable {
        code: &'static str,
    },
}

impl From<CognitionReply> for WireReply {
    fn from(reply: CognitionReply) -> Self {
        match reply {
            CognitionReply::Completed(result) => Self::Completed { result },
            CognitionReply::Unavailable(code) => Self::Unavailable { code },
        }
    }
}

/// Adopt the dedicated inherited descriptor and return a local request queue.
/// Absence is expected for legacy/unmanaged harnesses.
#[cfg(unix)]
pub(crate) fn inherited_receiver(
) -> Result<Option<tokio::sync::mpsc::UnboundedReceiver<CognitionEnvelope>>, String> {
    use nix::fcntl::{fcntl, FcntlArg, FdFlag};
    use std::os::fd::AsRawFd;

    let raw = match std::env::var("LUCA_MANAGED_COGNITION_FD") {
        Ok(value) => value
            .parse::<i32>()
            .map_err(|_| "invalid managed cognition fd".to_owned())?,
        Err(std::env::VarError::NotPresent) => return Ok(None),
        Err(_) => return Err("invalid managed cognition fd".to_owned()),
    };
    if raw != INHERITED_FD {
        return Err("managed cognition fd is not the reserved descriptor".to_owned());
    }
    let resident_pubkey = std::env::var("LUCA_MANAGED_RESIDENT_PUBKEY")
        .ok()
        .and_then(|value| luca_protocol::Hex64::parse(value).ok())
        .ok_or_else(|| "managed cognition channel missing resident binding".to_owned())?;
    let binding_ref = std::env::var("LUCA_MANAGED_BINDING_REF")
        .ok()
        .and_then(|value| Sha256Ref::parse(value).ok())
        .ok_or_else(|| "managed cognition channel missing runtime binding".to_owned())?;

    let file = std::fs::File::open(format!("/dev/fd/{raw}"))
        .map_err(|error| format!("open managed cognition fd: {error}"))?;
    fcntl(&file, FcntlArg::F_SETFD(FdFlag::FD_CLOEXEC))
        .map_err(|error| format!("secure managed cognition fd: {error}"))?;
    if file.as_raw_fd() == raw {
        return Err("managed cognition fd was not duplicated".to_owned());
    }
    let stream = std::os::unix::net::UnixStream::from(std::os::fd::OwnedFd::from(file));
    nix::unistd::close(raw)
        .map_err(|error| format!("close managed cognition bootstrap fd: {error}"))?;
    stream
        .set_nonblocking(true)
        .map_err(|error| format!("configure managed cognition stream: {error}"))?;
    let stream = tokio::net::UnixStream::from_std(stream)
        .map_err(|error| format!("adopt managed cognition stream: {error}"))?;
    let (read_half, mut write_half) = stream.into_split();
    let mut reader = tokio::io::BufReader::new(read_half);
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

    tokio::spawn(async move {
        loop {
            let mut frame = Vec::new();
            let read = reader.read_until(b'\n', &mut frame).await;
            let Ok(read) = read else { break };
            if read == 0 || frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
                break;
            }
            let request = match serde_json::from_slice::<LocalContinuityCognitionRequestV1>(&frame)
            {
                Ok(request)
                    if request.validate().is_ok()
                        && request.resident_pubkey == resident_pubkey
                        && request.binding_ref == binding_ref =>
                {
                    request
                }
                _ => break,
            };
            let now = unix_time_millis();
            let remaining = request.deadline_unix_ms.get().saturating_sub(now);
            if remaining == 0 {
                if write_reply(
                    &mut write_half,
                    CognitionReply::Unavailable("deadline_expired"),
                )
                .await
                .is_err()
                {
                    break;
                }
                continue;
            }
            let (reply_tx, reply_rx) = tokio::sync::oneshot::channel();
            if tx.send(CognitionEnvelope { request, reply_tx }).is_err() {
                break;
            }
            let reply = tokio::time::timeout(std::time::Duration::from_millis(remaining), reply_rx)
                .await
                .ok()
                .and_then(Result::ok)
                .unwrap_or(CognitionReply::Unavailable("deadline_expired"));
            if write_reply(&mut write_half, reply).await.is_err() {
                break;
            }
        }
    });
    Ok(Some(rx))
}

#[cfg(not(unix))]
pub(crate) fn inherited_receiver(
) -> Result<Option<tokio::sync::mpsc::UnboundedReceiver<CognitionEnvelope>>, String> {
    Ok(None)
}

#[cfg(unix)]
async fn write_reply(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    reply: CognitionReply,
) -> Result<(), ()> {
    let mut bytes = serde_json::to_vec(&WireReply::from(reply)).map_err(|_| ())?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(());
    }
    bytes.push(b'\n');
    writer.write_all(&bytes).await.map_err(|_| ())?;
    writer.flush().await.map_err(|_| ())
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

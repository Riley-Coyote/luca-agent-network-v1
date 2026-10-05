//! Private inherited channel for resident-authored continuity cognition.
//!
//! The channel carries body-free job authority from the trusted desktop. The
//! harness reloads signed conversation history itself, executes a fresh
//! tool-free session on the already configured resident runtime/model, and
//! returns validated private output. A separately typed runtime-task delivery
//! may hand one bounded final draft to the existing signing broker; no model
//! output selects routing or gains generic relay/signing authority.

#![cfg_attr(not(unix), allow(dead_code))]

use std::time::{SystemTime, UNIX_EPOCH};

use luca_protocol::{
    OpaqueId, ResidentPrivateCognitionRequestV1, ResidentPrivateCognitionResultV1,
};
use serde::Serialize;

#[cfg(unix)]
use luca_protocol::Sha256Ref;
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

const INHERITED_FD: i32 = 5;
const MAX_FRAME_BYTES: usize = 64 * 1024;

pub(crate) struct CognitionEnvelope {
    pub request: ResidentPrivateCognitionRequestV1,
    pub reply_tx: tokio::sync::oneshot::Sender<CognitionReply>,
}

#[derive(Debug)]
pub(crate) enum CognitionReply {
    Completed(Box<ResidentPrivateCognitionResultV1>),
    Unavailable(&'static str),
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum WireReply {
    Completed {
        result: Box<ResidentPrivateCognitionResultV1>,
    },
    Unavailable {
        job_id: OpaqueId,
        code: &'static str,
    },
}

impl WireReply {
    fn for_request(reply: CognitionReply, job_id: OpaqueId) -> Self {
        match reply {
            CognitionReply::Completed(result) => Self::Completed { result },
            CognitionReply::Unavailable(code) => Self::Unavailable { job_id, code },
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
            let frame = match read_frame(&mut reader).await {
                Ok(Some(frame)) => frame,
                _ => break,
            };
            let request = match decode_request(&frame, &resident_pubkey, &binding_ref) {
                Ok(request) => request,
                Err(()) => break,
            };
            // Correlation comes from the validated desktop request, never
            // model output or a reply producer's choice of identity.
            let job_id = request.job_id().clone();
            let now = unix_time_millis();
            let remaining = request.deadline_unix_ms().get().saturating_sub(now);
            if remaining == 0 {
                if write_reply(
                    &mut write_half,
                    CognitionReply::Unavailable("deadline_expired"),
                    job_id,
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
            if write_reply(&mut write_half, reply, job_id).await.is_err() {
                break;
            }
        }
    });
    Ok(Some(rx))
}

#[cfg(unix)]
async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Vec<u8>>, ()> {
    let mut frame = Vec::with_capacity(MAX_FRAME_BYTES + 1);
    let read = reader
        .take((MAX_FRAME_BYTES + 1) as u64)
        .read_until(b'\n', &mut frame)
        .await
        .map_err(|_| ())?;
    if read == 0 {
        return Ok(None);
    }
    if frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
        return Err(());
    }
    Ok(Some(frame))
}

#[cfg(unix)]
fn decode_request(
    frame: &[u8],
    resident_pubkey: &luca_protocol::Hex64,
    binding_ref: &Sha256Ref,
) -> Result<ResidentPrivateCognitionRequestV1, ()> {
    let request: ResidentPrivateCognitionRequestV1 =
        serde_json::from_slice(frame).map_err(|_| ())?;
    if request.validate().is_err()
        || request.resident_pubkey() != resident_pubkey
        || request.binding_ref() != binding_ref
    {
        return Err(());
    }
    Ok(request)
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
    job_id: OpaqueId,
) -> Result<(), ()> {
    let mut bytes = serde_json::to_vec(&WireReply::for_request(reply, job_id)).map_err(|_| ())?;
    if bytes.len() >= MAX_FRAME_BYTES {
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

#[cfg(all(test, unix))]
mod runtime_task_delivery_frame_tests {
    use super::*;

    #[test]
    fn unavailable_private_reply_is_correlated_without_task_or_result_bodies() {
        let reply = WireReply::for_request(
            CognitionReply::Unavailable("runtime_busy"),
            OpaqueId::parse("task-result:fixture").unwrap(),
        );
        assert_eq!(
            serde_json::to_value(reply).unwrap(),
            serde_json::json!({
                "status": "unavailable",
                "job_id": "task-result:fixture",
                "code": "runtime_busy"
            })
        );
    }

    #[tokio::test]
    async fn overlength_private_frame_stops_at_bound_without_waiting_for_newline() {
        let bytes = vec![b'x'; MAX_FRAME_BYTES * 3];
        let mut reader = &bytes[..];
        assert_eq!(read_frame(&mut reader).await, Err(()));
        assert_eq!(reader.len(), bytes.len() - MAX_FRAME_BYTES - 1);
    }

    #[tokio::test]
    async fn private_frame_preserves_delimiters_and_rejects_unterminated_tail() {
        let mut reader = &b"{}\r\n{}\nPRIVATE_UNTERMINATED"[..];
        assert_eq!(read_frame(&mut reader).await, Ok(Some(b"{}\r\n".to_vec())));
        assert_eq!(read_frame(&mut reader).await, Ok(Some(b"{}\n".to_vec())));
        assert_eq!(read_frame(&mut reader).await, Err(()));
        assert_eq!(read_frame(&mut reader).await, Ok(None));
    }

    #[test]
    fn malformed_private_frame_is_body_free_and_not_recovered_as_a_request() {
        let resident = luca_protocol::Hex64::parse("b".repeat(64)).expect("fixture resident");
        let binding =
            Sha256Ref::parse(format!("sha256:{}", "c".repeat(64))).expect("fixture binding");
        for frame in [
            &b"PRIVATE_MALFORMED\n"[..],
            &b"{\"kind\":\"unknown\",\"PRIVATE_BODY\":true}\n"[..],
            &b"\xff\n"[..],
        ] {
            assert!(matches!(
                decode_request(frame, &resident, &binding),
                Err(())
            ));
        }
    }
}

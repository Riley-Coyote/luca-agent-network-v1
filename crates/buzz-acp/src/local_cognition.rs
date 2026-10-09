//! Private inherited channel for resident-authored continuity cognition.
//!
//! The channel carries bounded private requests from the trusted desktop.
//! Metabolism reloads signed history; planning uses host-bound canonical state
//! and admitted evidence, never a latest-chat replacement. Both execute a fresh
//! private session on the already configured resident runtime/model and
//! return validated private output. A separately typed runtime-task delivery
//! may hand one bounded final draft to the existing signing broker; no model
//! output selects routing or gains generic relay/signing authority. New initiative
//! work additionally requires verified adapter tool restrictions. The receiver
//! keeps reading exact initiative cancellation while awaiting a private result.

#![cfg_attr(not(unix), allow(dead_code))]

use std::time::{SystemTime, UNIX_EPOCH};

use luca_protocol::{
    OpaqueId, ResidentPrivateCognitionControlV1, ResidentPrivateCognitionRequestV1,
    ResidentPrivateCognitionResultV1,
};
use serde::Serialize;

#[cfg(unix)]
use luca_protocol::Sha256Ref;
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

const INHERITED_FD: i32 = 5;
const MAX_FRAME_BYTES: usize = 64 * 1024;

pub(crate) enum CognitionEnvelope {
    Request {
        request: ResidentPrivateCognitionRequestV1,
        reply_tx: tokio::sync::oneshot::Sender<CognitionReply>,
    },
    /// The inherited socket already matched this control to its current
    /// initiative request. No public conversation or legacy work is selected.
    CancelInitiative {
        control: ResidentPrivateCognitionControlV1,
    },
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
    let session_epoch = std::env::var("LUCA_MANAGED_SESSION_EPOCH")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|value| luca_protocol::SafeU53::new(value).ok())
        .filter(|epoch| epoch.get() != 0);

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
    let (read_half, write_half) = stream.into_split();
    let reader = tokio::io::BufReader::new(read_half);
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(serve_channel(
        reader,
        write_half,
        tx,
        resident_pubkey,
        binding_ref,
        session_epoch,
    ));
    Ok(Some(rx))
}

#[cfg(unix)]
async fn serve_channel<R: tokio::io::AsyncBufRead + Unpin, W: tokio::io::AsyncWrite + Unpin>(
    mut reader: R,
    mut writer: W,
    tx: tokio::sync::mpsc::UnboundedSender<CognitionEnvelope>,
    resident_pubkey: luca_protocol::Hex64,
    binding_ref: Sha256Ref,
    session_epoch: Option<luca_protocol::SafeU53>,
) {
    // Keep partial bytes outside select!: cancellation of read_until must not
    // drop part of a control frame when the model reply wins the race.
    let mut assembly = Vec::new();
    loop {
        let frame = match read_frame_into(&mut reader, &mut assembly).await {
            Ok(Some(frame)) => frame,
            _ => break,
        };
        if decode_control(&frame, &resident_pubkey, &binding_ref, session_epoch).is_ok() {
            // A valid late control has no current request and no effect.
            continue;
        }
        let request = match decode_request(&frame, &resident_pubkey, &binding_ref, session_epoch) {
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
                &mut writer,
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
        let (reply_tx, mut reply_rx) = tokio::sync::oneshot::channel();
        if tx
            .send(CognitionEnvelope::Request {
                request: request.clone(),
                reply_tx,
            })
            .is_err()
        {
            break;
        }
        let deadline = tokio::time::sleep(std::time::Duration::from_millis(remaining));
        tokio::pin!(deadline);
        let reply = loop {
            tokio::select! {
                biased;
                reply = &mut reply_rx => break reply.unwrap_or(CognitionReply::Unavailable("runtime_failed")),
                _ = &mut deadline => {
                    cancel_current_initiative(&tx, &request);
                    break CognitionReply::Unavailable("deadline_expired");
                }
                next = read_frame_into(&mut reader, &mut assembly) => {
                    let control = match next {
                        Ok(Some(frame)) => decode_control(&frame, &resident_pubkey, &binding_ref, session_epoch),
                        _ => { cancel_current_initiative(&tx, &request); return; }
                    };
                    match control {
                        Ok(control) if control.matches_initiative(&request) => {
                            let _ = tx.send(CognitionEnvelope::CancelInitiative { control });
                        }
                        Ok(_) => {}, // stale/other/legacy requests are never cancelled
                        Err(()) => { cancel_current_initiative(&tx, &request); return; }
                    }
                }
            }
        };
        if write_reply(&mut writer, reply, job_id).await.is_err() {
            cancel_current_initiative(&tx, &request);
            break;
        }
    }
}

fn cancel_current_initiative(
    tx: &tokio::sync::mpsc::UnboundedSender<CognitionEnvelope>,
    request: &ResidentPrivateCognitionRequestV1,
) {
    let epoch = match request {
        ResidentPrivateCognitionRequestV1::InitiativePlanning { request } => request.session_epoch,
        ResidentPrivateCognitionRequestV1::InitiativePursuit { request } => request.session_epoch,
        _ => return,
    };
    let _ = tx.send(CognitionEnvelope::CancelInitiative {
        control: ResidentPrivateCognitionControlV1::CancelInitiative {
            job_id: request.job_id().clone(),
            resident_pubkey: request.resident_pubkey().clone(),
            binding_ref: request.binding_ref().clone(),
            session_epoch: epoch,
        },
    });
}

#[cfg(all(unix, test))]
async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Vec<u8>>, ()> {
    read_frame_into(reader, &mut Vec::new()).await
}

#[cfg(unix)]
async fn read_frame_into<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
    frame: &mut Vec<u8>,
) -> Result<Option<Vec<u8>>, ()> {
    let remaining = (MAX_FRAME_BYTES + 1)
        .checked_sub(frame.len())
        .filter(|n| *n > 0)
        .ok_or(())?;
    let read = reader
        .take(remaining as u64)
        .read_until(b'\n', frame)
        .await
        .map_err(|_| ())?;
    if read == 0 {
        return Ok(None);
    }
    if frame.len() > MAX_FRAME_BYTES || frame.last() != Some(&b'\n') {
        return Err(());
    }
    Ok(Some(std::mem::take(frame)))
}

#[cfg(unix)]
fn decode_control(
    frame: &[u8],
    resident: &luca_protocol::Hex64,
    binding: &Sha256Ref,
    epoch: Option<luca_protocol::SafeU53>,
) -> Result<ResidentPrivateCognitionControlV1, ()> {
    let control: ResidentPrivateCognitionControlV1 =
        serde_json::from_slice(frame).map_err(|_| ())?;
    match &control {
        ResidentPrivateCognitionControlV1::CancelInitiative {
            resident_pubkey,
            binding_ref,
            session_epoch,
            ..
        } if resident_pubkey == resident
            && binding_ref == binding
            && session_epoch.get() != 0
            && Some(*session_epoch) == epoch =>
        {
            Ok(control)
        }
        _ => Err(()),
    }
}

#[cfg(unix)]
fn decode_request(
    frame: &[u8],
    resident_pubkey: &luca_protocol::Hex64,
    binding_ref: &Sha256Ref,
    session_epoch: Option<luca_protocol::SafeU53>,
) -> Result<ResidentPrivateCognitionRequestV1, ()> {
    let request: ResidentPrivateCognitionRequestV1 =
        serde_json::from_slice(frame).map_err(|_| ())?;
    if request.validate().is_err()
        || request.resident_pubkey() != resident_pubkey
        || request.binding_ref() != binding_ref
    {
        return Err(());
    }
    if let ResidentPrivateCognitionRequestV1::InitiativePlanning { request } = &request {
        if session_epoch != Some(request.session_epoch) {
            return Err(());
        }
    }
    if let ResidentPrivateCognitionRequestV1::InitiativePursuit { request } = &request {
        if session_epoch != Some(request.session_epoch) {
            return Err(());
        }
    }
    Ok(request)
}

#[cfg(not(unix))]
pub(crate) fn inherited_receiver(
) -> Result<Option<tokio::sync::mpsc::UnboundedReceiver<CognitionEnvelope>>, String> {
    Ok(None)
}

#[cfg(unix)]
async fn write_reply<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
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
mod initiative_planning_frame_tests {
    use super::*;
    use crate::pool::initiative_planning_tests::request;

    #[test]
    fn planning_frames_require_the_inherited_exact_runtime_epoch() {
        let request = request();
        let epoch = request.session_epoch;
        let resident = request.resident_pubkey.clone();
        let binding = request.binding_ref.clone();
        let envelope = ResidentPrivateCognitionRequestV1::InitiativePlanning { request };
        let encoded = serde_json::to_vec(&envelope).expect("private fixture frame");
        assert!(decode_request(&encoded, &resident, &binding, Some(epoch)).is_ok());
        assert!(decode_request(&encoded, &resident, &binding, None).is_err());
        assert!(decode_request(
            &encoded,
            &resident,
            &binding,
            Some(luca_protocol::SafeU53::new(4).expect("other epoch"))
        )
        .is_err());
    }
}

#[cfg(all(test, unix))]
mod initiative_cancellation_frame_tests {
    use super::*;

    fn future_request() -> ResidentPrivateCognitionRequestV1 {
        let mut request = crate::pool::initiative_pursuit_tests::request();
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        request.admitted_at =
            luca_protocol::CanonicalTimestamp::parse(now).expect("current fixture time");
        request.thread.updated_at = request.admitted_at.clone();
        request.evidence.clear();
        request.deadline_unix_ms =
            luca_protocol::SafeU53::new(unix_time_millis() + 5000).expect("fixture deadline");
        ResidentPrivateCognitionRequestV1::InitiativePursuit { request }
    }
    fn control(
        request: &ResidentPrivateCognitionRequestV1,
        job_id: OpaqueId,
    ) -> ResidentPrivateCognitionControlV1 {
        let epoch = match request {
            ResidentPrivateCognitionRequestV1::InitiativePursuit { request } => {
                request.session_epoch
            }
            _ => unreachable!("fixture initiative"),
        };
        ResidentPrivateCognitionControlV1::CancelInitiative {
            job_id,
            resident_pubkey: request.resident_pubkey().clone(),
            binding_ref: request.binding_ref().clone(),
            session_epoch: epoch,
        }
    }
    async fn write<T: serde::Serialize>(
        writer: &mut (impl tokio::io::AsyncWrite + Unpin),
        value: &T,
    ) {
        let mut bytes = serde_json::to_vec(value).expect("synthetic frame");
        bytes.push(b'\n');
        writer.write_all(&bytes).await.expect("synthetic write");
    }
    #[test]
    fn control_frame_requires_exact_inherited_binding_epoch_and_no_extra_selectors() {
        let request = future_request();
        let control = control(&request, request.job_id().clone());
        let bytes = serde_json::to_vec(&control).expect("control frame");
        let ResidentPrivateCognitionControlV1::CancelInitiative { session_epoch, .. } = &control;
        let epoch = *session_epoch;
        assert!(decode_control(
            &bytes,
            request.resident_pubkey(),
            request.binding_ref(),
            Some(epoch)
        )
        .is_ok());
        assert!(decode_control(
            &bytes,
            request.resident_pubkey(),
            request.binding_ref(),
            None
        )
        .is_err());
        let other = Sha256Ref::parse(format!("sha256:{}", "d".repeat(64))).expect("other binding");
        assert!(decode_control(&bytes, request.resident_pubkey(), &other, Some(epoch)).is_err());
        let mut injected = serde_json::to_value(control).expect("wire");
        injected["public_conversation_id"] = serde_json::json!("public:other");
        assert!(serde_json::from_value::<ResidentPrivateCognitionControlV1>(injected).is_err());
    }
    #[tokio::test]
    async fn private_receiver_delivers_exact_cancel_while_result_is_still_pending() {
        // Memory-only fake peer: no inherited fd, process, model, profile or config.
        let request = future_request();
        let resident = request.resident_pubkey().clone();
        let binding = request.binding_ref().clone();
        let epoch = match &request {
            ResidentPrivateCognitionRequestV1::InitiativePursuit { request } => {
                request.session_epoch
            }
            _ => unreachable!("fixture"),
        };
        let (desktop, harness) = tokio::io::duplex(128 * 1024);
        let (read_half, write_half) = tokio::io::split(harness);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let server = tokio::spawn(serve_channel(
            tokio::io::BufReader::new(read_half),
            write_half,
            tx,
            resident,
            binding,
            Some(epoch),
        ));
        let (desktop_read, mut desktop_write) = tokio::io::split(desktop);
        write(&mut desktop_write, &request).await;
        let reply_tx = match rx.recv().await.expect("request") {
            CognitionEnvelope::Request { reply_tx, .. } => reply_tx,
            _ => panic!("not a request"),
        };
        let wrong = control(
            &request,
            OpaqueId::parse("pursuit:other").expect("other job"),
        );
        write(&mut desktop_write, &wrong).await;
        let exact = control(&request, request.job_id().clone());
        write(&mut desktop_write, &exact).await;
        let cancelled = tokio::time::timeout(std::time::Duration::from_secs(1), rx.recv())
            .await
            .expect("no model wait")
            .expect("exact cancellation");
        match cancelled {
            CognitionEnvelope::CancelInitiative { control } => {
                assert!(control.matches_initiative(&request))
            }
            _ => panic!("unexpected request"),
        };
        reply_tx
            .send(CognitionReply::Unavailable("runtime_failed"))
            .expect("fake completion");
        let mut reader = tokio::io::BufReader::new(desktop_read);
        assert!(read_frame(&mut reader)
            .await
            .expect("body-free reply")
            .is_some());
        drop(reader);
        drop(desktop_write);
        tokio::time::timeout(std::time::Duration::from_secs(1), server)
            .await
            .expect("bounded source-only fixture")
            .expect("server exit");
    }
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
                decode_request(frame, &resident, &binding, None),
                Err(())
            ));
        }
    }
}

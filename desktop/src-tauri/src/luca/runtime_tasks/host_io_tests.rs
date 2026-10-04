use std::{
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    task::{Context, Poll},
    time::Duration,
};

use tokio::io::{AsyncWriteExt, ReadBuf};

use super::*;

async fn cancel_pending_line<R: AsyncRead + Unpin>(lines: &mut BoundedHostLines<R>) {
    tokio::select! {
        biased;
        value = lines.next_line() => panic!("line unexpectedly completed before cancellation: {value:?}"),
        _ = tokio::task::yield_now() => {}
    }
}

#[tokio::test]
async fn cancellation_preserves_partial_bytes_and_buffered_following_lines() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let mut lines = BoundedHostLines::new(reader, 32);
    writer.write_all(b"partial").await.unwrap();
    cancel_pending_line(&mut lines).await;
    assert_eq!(lines.partial_line, b"partial");
    writer.write_all(b" prefix\nnext\n").await.unwrap();
    assert_eq!(
        lines.next_line().await.unwrap().as_deref(),
        Some("partial prefix")
    );
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("next"));
    drop(writer);
    assert!(lines.next_line().await.unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn timer_select_cancellation_can_repeat_without_losing_prefixes() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let mut lines = BoundedHostLines::new(reader, 32);
    for chunk in [b"one".as_slice(), b" ", b"two"] {
        writer.write_all(chunk).await.unwrap();
        tokio::select! {
            biased;
            value = lines.next_line() => panic!("unexpected partial-line result: {value:?}"),
            _ = tokio::time::sleep(Duration::from_millis(120)) => {}
        }
    }
    assert_eq!(lines.partial_line, b"one two");
    writer.write_all(b"\n").await.unwrap();
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("one two"));
}

#[tokio::test]
async fn cancelled_split_utf8_is_validated_only_after_complete_framing() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let mut lines = BoundedHostLines::new(reader, 3);
    writer.write_all(&[0xe2, 0x82]).await.unwrap();
    cancel_pending_line(&mut lines).await;
    assert_eq!(lines.partial_line, [0xe2, 0x82]);
    assert!(lines.poisoned.is_none());
    writer.write_all(&[0xac, b'\n']).await.unwrap();
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("€"));
}

#[tokio::test]
async fn lf_and_crlf_split_exactly_without_dropping_embedded_cr() {
    let input = b"\nalpha\nbeta\r\nembedded\rcarriage\nextra\r\r\n".as_slice();
    let mut lines = BoundedHostLines::new(input, 32);
    for expected in ["", "alpha", "beta", "embedded\rcarriage", "extra\r"] {
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some(expected));
    }
    assert!(lines.next_line().await.unwrap().is_none());
    assert!(lines.next_line().await.unwrap().is_none());
}

#[tokio::test]
async fn crlf_at_exact_payload_limit_survives_cancelled_boundary() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let mut lines = BoundedHostLines::new(reader, 3);
    writer.write_all(b"abc\r").await.unwrap();
    cancel_pending_line(&mut lines).await;
    assert_eq!(lines.partial_line, b"abc");
    assert!(lines.pending_cr);
    assert!(lines.partial_line.capacity() <= 3);
    writer.write_all(b"\n").await.unwrap();
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("abc"));
    writer.write_all(b"xyz\r\n").await.unwrap();
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("xyz"));
}

#[tokio::test]
async fn bare_cr_at_eof_is_payload_and_subject_to_the_limit() {
    let mut accepted = BoundedHostLines::new(b"abc\r".as_slice(), 4);
    assert_eq!(
        accepted.next_line().await.unwrap().as_deref(),
        Some("abc\r")
    );
    assert!(accepted.next_line().await.unwrap().is_none());
    let mut rejected = BoundedHostLines::new(b"abc\r".as_slice(), 3);
    assert_eq!(
        rejected.next_line().await.unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
    assert!(rejected.next_line().await.is_err());
}

#[tokio::test]
async fn eof_returns_final_unterminated_line_once_without_an_extra_empty_line() {
    let mut lines = BoundedHostLines::new(b"first\nfinal".as_slice(), 5);
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("first"));
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("final"));
    assert!(lines.next_line().await.unwrap().is_none());
    assert!(lines.next_line().await.unwrap().is_none());
    let mut empty = BoundedHostLines::new(b"".as_slice(), 0);
    assert!(empty.next_line().await.unwrap().is_none());
    let mut terminated = BoundedHostLines::new(b"last\n".as_slice(), 4);
    assert_eq!(
        terminated.next_line().await.unwrap().as_deref(),
        Some("last")
    );
    assert!(terminated.next_line().await.unwrap().is_none());
}

#[tokio::test]
async fn zero_limit_accepts_empty_frames_but_no_payload() {
    let mut empty = BoundedHostLines::new(b"\n\r\n".as_slice(), 0);
    assert_eq!(empty.next_line().await.unwrap().as_deref(), Some(""));
    assert_eq!(empty.next_line().await.unwrap().as_deref(), Some(""));
    assert!(empty.next_line().await.unwrap().is_none());
    let mut rejected = BoundedHostLines::new(b"x\n".as_slice(), 0);
    assert!(rejected.next_line().await.is_err());
    assert_eq!(rejected.partial_line.capacity(), 0);
}

#[tokio::test]
async fn malformed_utf8_poison_is_terminal_and_does_not_skip_to_a_good_record() {
    for input in [b"\xff\nvalid\n".as_slice(), b"\xe2\x82".as_slice()] {
        let mut lines = BoundedHostLines::new(input, 32);
        let first = lines.next_line().await.unwrap_err();
        assert_eq!(first.kind(), io::ErrorKind::InvalidData);
        assert!(first.to_string().contains("UTF-8"));
        for _ in 0..3 {
            assert_eq!(
                lines.next_line().await.unwrap_err().kind(),
                io::ErrorKind::InvalidData
            );
        }
    }
}

#[tokio::test]
async fn byte_limit_is_not_a_unicode_character_count() {
    let mut rejected = BoundedHostLines::new("é\n".as_bytes(), 1);
    assert!(rejected
        .next_line()
        .await
        .unwrap_err()
        .to_string()
        .contains("byte limit"));
    let mut accepted = BoundedHostLines::new("é\r\n".as_bytes(), 2);
    assert_eq!(accepted.next_line().await.unwrap().as_deref(), Some("é"));
}

struct HugeNoLfReader {
    remaining: usize,
    polls: Arc<AtomicUsize>,
}

impl AsyncRead for HugeNoLfReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.polls.fetch_add(1, Ordering::Relaxed);
        let count = self
            .remaining
            .min(buffer.remaining())
            .min(READ_BUFFER_BYTES);
        buffer.put_slice(&[b'x'; READ_BUFFER_BYTES][..count]);
        self.remaining -= count;
        Poll::Ready(Ok(()))
    }
}

#[tokio::test]
async fn huge_no_lf_stream_is_rejected_before_over_limit_allocation_or_more_reads() {
    let polls = Arc::new(AtomicUsize::new(0));
    let reader = HugeNoLfReader {
        remaining: 16 * 1024 * 1024,
        polls: polls.clone(),
    };
    let mut lines = BoundedHostLines::new(reader, 64);
    let error = lines.next_line().await.unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    assert_eq!(polls.load(Ordering::Relaxed), 1);
    assert_eq!(lines.partial_line.capacity(), 0);
    for _ in 0..3 {
        assert!(lines.next_line().await.is_err());
    }
    assert_eq!(polls.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn over_limit_complete_line_is_not_skipped_and_existing_prefix_stays_bounded() {
    let (mut writer, reader) = tokio::io::duplex(64);
    let mut lines = BoundedHostLines::new(reader, 5);
    writer.write_all(b"12345").await.unwrap();
    cancel_pending_line(&mut lines).await;
    assert_eq!(lines.partial_line.len(), 5);
    assert!(lines.partial_line.capacity() <= 5);
    writer.write_all(b"6\nvalid\n").await.unwrap();
    assert_eq!(
        lines.next_line().await.unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
    assert!(lines.partial_line.capacity() <= 5);
    assert!(lines.next_line().await.is_err());
}

struct ErrorAfterPrefix {
    prefix: Option<Vec<u8>>,
    kind: io::ErrorKind,
    polls: Arc<AtomicUsize>,
}

impl AsyncRead for ErrorAfterPrefix {
    fn poll_read(
        mut self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.polls.fetch_add(1, Ordering::Relaxed);
        if let Some(prefix) = self.prefix.take() {
            buffer.put_slice(&prefix);
            Poll::Ready(Ok(()))
        } else {
            Poll::Ready(Err(io::Error::new(self.kind, "synthetic host I/O failure")))
        }
    }
}

#[tokio::test]
async fn io_errors_after_a_partial_record_poison_without_retry_or_false_eof() {
    for kind in [
        io::ErrorKind::BrokenPipe,
        io::ErrorKind::Interrupted,
        io::ErrorKind::Other,
    ] {
        let polls = Arc::new(AtomicUsize::new(0));
        let reader = ErrorAfterPrefix {
            prefix: Some(b"ok\npartial".to_vec()),
            kind,
            polls: polls.clone(),
        };
        let mut lines = BoundedHostLines::new(reader, 32);
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("ok"));
        let error = lines.next_line().await.unwrap_err();
        assert_eq!(error.kind(), kind);
        assert!(error.to_string().contains("synthetic host I/O failure"));
        assert_eq!(polls.load(Ordering::Relaxed), 2);
        for _ in 0..3 {
            assert_eq!(lines.next_line().await.unwrap_err().kind(), kind);
        }
        assert_eq!(polls.load(Ordering::Relaxed), 2);
    }
}

#[tokio::test]
async fn exact_read_buffer_sized_payload_and_crlf_do_not_exceed_the_line_cap() {
    let payload = "x".repeat(READ_BUFFER_BYTES);
    let input = format!("{payload}\r\nlast");
    let mut lines = BoundedHostLines::new(input.as_bytes(), READ_BUFFER_BYTES);
    assert_eq!(
        lines.next_line().await.unwrap().as_deref(),
        Some(payload.as_str())
    );
    assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("last"));
    assert!(lines.next_line().await.unwrap().is_none());
    let mut unterminated = BoundedHostLines::new(payload.as_bytes(), READ_BUFFER_BYTES);
    assert_eq!(
        unterminated.next_line().await.unwrap().as_deref(),
        Some(payload.as_str())
    );
    assert!(unterminated.next_line().await.unwrap().is_none());
}

#[tokio::test]
async fn one_byte_past_a_full_buffer_is_rejected_before_another_line_allocation() {
    let polls = Arc::new(AtomicUsize::new(0));
    let reader = HugeNoLfReader {
        remaining: READ_BUFFER_BYTES + 1,
        polls: polls.clone(),
    };
    let mut lines = BoundedHostLines::new(reader, READ_BUFFER_BYTES);
    assert_eq!(
        lines.next_line().await.unwrap_err().kind(),
        io::ErrorKind::InvalidData
    );
    assert_eq!(polls.load(Ordering::Relaxed), 2);
    assert_eq!(lines.partial_line.capacity(), READ_BUFFER_BYTES);
    assert!(lines.next_line().await.is_err());
    assert_eq!(polls.load(Ordering::Relaxed), 2);
}

#[test]
fn fragmented_line_growth_never_reserves_past_the_explicit_cap() {
    let mut line = Vec::new();
    for length in 1..=100 {
        append_bounded(&mut line, b"x", 100).unwrap();
        assert_eq!(line.len(), length);
        assert!(line.capacity() <= 100);
    }
    let capacity = line.capacity();
    assert!(append_bounded(&mut line, b"x", 100).is_err());
    assert_eq!(line.len(), 100);
    assert_eq!(line.capacity(), capacity);
}

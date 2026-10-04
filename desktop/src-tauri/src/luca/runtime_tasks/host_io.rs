//! Bounded, cancellation-safe framing for a private runtime-host JSONL stream.
//!
//! This reader owns partial-line bytes, not its `next_line` future. A cancelled
//! wait can therefore resume without losing a prefix or silently resynchronizing
//! past a bad record. JSON parsing remains the caller's responsibility.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt};

const READ_BUFFER_BYTES: usize = 8 * 1024;

/// A line reader with one fixed 8-KiB read buffer and at most `max_line_bytes`
/// of line allocation. Every framing, UTF-8, allocation, or I/O error poisons
/// the reader permanently; the caller must not treat such errors as EOF.
pub(super) struct BoundedHostLines<R: AsyncRead + Unpin> {
    reader: R,
    read_buffer: [u8; READ_BUFFER_BYTES],
    read_cursor: usize,
    read_filled: usize,
    partial_line: Vec<u8>,
    max_line_bytes: usize,
    pending_cr: bool,
    eof: bool,
    poisoned: Option<io::ErrorKind>,
}

impl<R: AsyncRead + Unpin> BoundedHostLines<R> {
    /// Create a bounded reader without allocating its maximum line capacity.
    /// The limit counts returned payload bytes: LF and the CR in CRLF are not
    /// part of the payload. A bare CR at unterminated EOF is payload instead.
    pub(super) fn new(reader: R, max_line_bytes: usize) -> Self {
        Self {
            reader,
            read_buffer: [0; READ_BUFFER_BYTES],
            read_cursor: 0,
            read_filled: 0,
            partial_line: Vec::new(),
            max_line_bytes,
            pending_cr: false,
            eof: false,
            poisoned: None,
        }
    }

    /// Return the next LF-delimited UTF-8 line, stripping one CR immediately
    /// before LF. The final unterminated line is returned once at EOF.
    ///
    /// This operation is cancellation-safe: the only suspension point is
    /// Tokio's cancellation-safe `read`, and consumed bytes are persisted in
    /// this object before the next suspension. Errors are never skipped.
    pub(super) async fn next_line(&mut self) -> io::Result<Option<String>> {
        if let Some(kind) = self.poisoned {
            return Err(io::Error::new(
                kind,
                "runtime task host stream is unusable after a framing or I/O error",
            ));
        }
        loop {
            if self.read_cursor < self.read_filled {
                let start = self.read_cursor;
                let newline = self.read_buffer[start..self.read_filled]
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .map(|offset| start + offset);
                let end = newline.unwrap_or(self.read_filled);
                let trailing_cr = end > start && self.read_buffer[end - 1] == b'\r';
                let payload_end = end - usize::from(trailing_cr);

                if self.pending_cr {
                    // A deferred CR belongs to CRLF only if LF is the very
                    // next byte. Otherwise it is ordinary line payload.
                    if newline != Some(start) {
                        if let Err(error) =
                            append_bounded(&mut self.partial_line, b"\r", self.max_line_bytes)
                        {
                            return Err(self.poison(error));
                        }
                    }
                    self.pending_cr = false;
                }
                if let Err(error) = append_bounded(
                    &mut self.partial_line,
                    &self.read_buffer[start..payload_end],
                    self.max_line_bytes,
                ) {
                    return Err(self.poison(error));
                }
                if let Some(newline) = newline {
                    self.read_cursor = newline + 1;
                    return self.finish_line();
                }
                self.read_cursor = self.read_filled;
                // Holding one CR as a flag keeps exactly-max payload + CRLF
                // within the line allocation cap across arbitrary read splits.
                self.pending_cr = trailing_cr;
                continue;
            }

            if self.eof {
                if self.pending_cr {
                    if let Err(error) =
                        append_bounded(&mut self.partial_line, b"\r", self.max_line_bytes)
                    {
                        return Err(self.poison(error));
                    }
                    self.pending_cr = false;
                }
                if self.partial_line.is_empty() {
                    return Ok(None);
                }
                return self.finish_line();
            }

            // `read` is cancel-safe. There is no await between its successful
            // return and storing the filled extent in the persistent object.
            let read = match self.reader.read(&mut self.read_buffer).await {
                Ok(read) => read,
                Err(error) => return Err(self.poison(error)),
            };
            self.read_cursor = 0;
            self.read_filled = read;
            if read == 0 {
                self.eof = true;
            }
        }
    }

    fn finish_line(&mut self) -> io::Result<Option<String>> {
        match String::from_utf8(std::mem::take(&mut self.partial_line)) {
            Ok(line) => Ok(Some(line)),
            Err(_) => Err(self.poison(io::Error::new(
                io::ErrorKind::InvalidData,
                "runtime task host line is not valid UTF-8",
            ))),
        }
    }

    fn poison(&mut self, error: io::Error) -> io::Error {
        self.poisoned = Some(error.kind());
        self.partial_line.clear();
        self.pending_cr = false;
        self.read_cursor = 0;
        self.read_filled = 0;
        error
    }
}

fn append_bounded(line: &mut Vec<u8>, bytes: &[u8], limit: usize) -> io::Result<()> {
    let length = line
        .len()
        .checked_add(bytes.len())
        .filter(|length| *length <= limit)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "runtime task host line exceeds its byte limit",
            )
        })?;
    if length > line.capacity() {
        // Grow geometrically for fragmented streams, but never ask Vec to
        // reserve beyond the explicit cap (automatic growth can overshoot it).
        let capacity = length.max(line.capacity().saturating_mul(2).min(limit));
        line.try_reserve_exact(capacity - line.len()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::OutOfMemory,
                "runtime task host line allocation failed",
            )
        })?;
    }
    line.extend_from_slice(bytes);
    Ok(())
}

#[cfg(test)]
#[path = "host_io_tests.rs"]
mod tests;

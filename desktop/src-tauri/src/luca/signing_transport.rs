//! Exclusive desktop-to-ACP transport for the typed managed signing broker.

use std::{
    io::{ErrorKind, Read, Write},
    time::{Duration, Instant},
};

use luca_protocol::BROKER_FRAME_MAX_BYTES;

/// Transport creation or framed-I/O failure.
#[derive(Debug)]
pub(crate) enum SigningTransportError {
    /// The current platform lacks the approved exclusive inherited transport.
    #[cfg(not(unix))]
    UnsupportedPlatform,
    /// Socketpair or stream I/O failed.
    Io(std::io::Error),
    /// No new bytes arrived before the bounded broker reconciliation tick.
    IdleTimeout,
    /// A peer began a frame but did not complete it within the absolute limit.
    PartialFrameTimeout,
    /// The peer declared a frame larger than the frozen protocol limit.
    FrameTooLarge,
    /// The supplied output was not one complete length-prefixed frame.
    InvalidFrameLength,
}

impl std::fmt::Display for SigningTransportError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            #[cfg(not(unix))]
            Self::UnsupportedPlatform => formatter
                .write_str("managed signing transport is not implemented for this platform"),
            Self::Io(error) => write!(formatter, "managed signing transport I/O failed: {error}"),
            Self::IdleTimeout => formatter.write_str("managed signing transport is idle"),
            Self::PartialFrameTimeout => {
                formatter.write_str("managed signing peer did not complete its frame in time")
            }
            Self::FrameTooLarge => {
                formatter.write_str("managed signing frame exceeds the frozen maximum")
            }
            Self::InvalidFrameLength => {
                formatter.write_str("managed signing output is not one complete framed message")
            }
        }
    }
}

impl std::error::Error for SigningTransportError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            #[cfg(not(unix))]
            Self::UnsupportedPlatform => None,
            Self::IdleTimeout
            | Self::PartialFrameTimeout
            | Self::FrameTooLarge
            | Self::InvalidFrameLength => None,
        }
    }
}

impl From<std::io::Error> for SigningTransportError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Desktop-owned endpoint of one exclusive managed ACP socketpair.
pub(crate) struct DesktopBrokerEndpoint {
    #[cfg(unix)]
    stream: std::os::unix::net::UnixStream,
}

impl std::fmt::Debug for DesktopBrokerEndpoint {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopBrokerEndpoint(<exclusive stream>)")
    }
}

impl DesktopBrokerEndpoint {
    /// Split into the sole serving stream and a shutdown-only wake handle.
    ///
    /// The shutdown half deliberately implements neither `Read` nor `Write`;
    /// runtime replacement can wake and join an idle broker without creating a
    /// second authority-capable transport owner.
    #[cfg(unix)]
    pub(crate) fn split_for_serve(
        self,
    ) -> Result<(std::os::unix::net::UnixStream, DesktopBrokerShutdown), SigningTransportError>
    {
        let shutdown_stream = self.stream.try_clone()?;
        Ok((
            self.stream,
            DesktopBrokerShutdown {
                stream: shutdown_stream,
            },
        ))
    }
}

/// Non-I/O runtime handle that wakes the serving broker during replacement.
pub(crate) struct DesktopBrokerShutdown {
    #[cfg(unix)]
    stream: std::os::unix::net::UnixStream,
}

impl std::fmt::Debug for DesktopBrokerShutdown {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("DesktopBrokerShutdown(<shutdown-only stream>)")
    }
}

impl DesktopBrokerShutdown {
    #[cfg(unix)]
    pub(crate) fn shutdown(&self) -> Result<(), SigningTransportError> {
        match self.stream.shutdown(std::net::Shutdown::Both) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotConnected => Ok(()),
            Err(error) => Err(SigningTransportError::Io(error)),
        }
    }
}

/// Child endpoint that can only be installed as managed ACP standard input.
pub(crate) struct ManagedAcpStdin {
    #[cfg(unix)]
    stdio: std::process::Stdio,
}

impl std::fmt::Debug for ManagedAcpStdin {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("ManagedAcpStdin(<exclusive child stdin>)")
    }
}

impl ManagedAcpStdin {
    /// Consume the endpoint for `std::process::Command::stdin`.
    #[cfg(unix)]
    pub(crate) fn into_stdio(self) -> std::process::Stdio {
        self.stdio
    }
}

/// Create one unnamed, exclusive socketpair with no path, token, argv or env coordinate.
pub(crate) fn create_exclusive_acp_socketpair(
) -> Result<(DesktopBrokerEndpoint, ManagedAcpStdin), SigningTransportError> {
    #[cfg(unix)]
    {
        use std::os::fd::OwnedFd;

        let (desktop, child) = create_socketpair_streams()?;
        let child_fd = OwnedFd::from(child);
        Ok((
            DesktopBrokerEndpoint { stream: desktop },
            ManagedAcpStdin {
                stdio: std::process::Stdio::from(child_fd),
            },
        ))
    }

    #[cfg(not(unix))]
    {
        Err(SigningTransportError::UnsupportedPlatform)
    }
}

#[cfg(unix)]
fn create_socketpair_streams() -> Result<
    (
        std::os::unix::net::UnixStream,
        std::os::unix::net::UnixStream,
    ),
    SigningTransportError,
> {
    Ok(std::os::unix::net::UnixStream::pair()?)
}

/// Read one complete u32-be length-prefixed frame.
///
/// EOF before any prefix byte is a clean peer shutdown. Truncated prefixes or
/// bodies are errors and must close the session.
#[cfg(test)]
pub(crate) fn read_next_frame<R: Read>(
    reader: &mut R,
) -> Result<Option<Vec<u8>>, SigningTransportError> {
    SigningFrameReader::new().read_next_frame(reader)
}

/// Persistent framed-read state for the broker's timed reconciliation loop.
///
/// A socket read timeout does not discard a partial frame. The absolute
/// partial-frame deadline prevents a peer from holding the sole authority
/// thread forever with a slow prefix or body.
pub(crate) struct SigningFrameReader {
    prefix: [u8; 4],
    prefix_read: usize,
    body: Vec<u8>,
    body_read: usize,
    partial_started: Option<Instant>,
    partial_frame_deadline: Duration,
}

impl SigningFrameReader {
    const PARTIAL_FRAME_DEADLINE: Duration = Duration::from_secs(30);

    pub(crate) fn new() -> Self {
        Self::with_partial_frame_deadline(Self::PARTIAL_FRAME_DEADLINE)
    }

    fn with_partial_frame_deadline(partial_frame_deadline: Duration) -> Self {
        Self {
            prefix: [0; 4],
            prefix_read: 0,
            body: Vec::new(),
            body_read: 0,
            partial_started: None,
            partial_frame_deadline,
        }
    }

    pub(crate) fn read_next_frame<R: Read>(
        &mut self,
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, SigningTransportError> {
        loop {
            if self.prefix_read < self.prefix.len() {
                match reader.read(&mut self.prefix[self.prefix_read..]) {
                    Ok(0) if self.prefix_read == 0 => return Ok(None),
                    Ok(0) => return Err(Self::unexpected_eof()),
                    Ok(read) => {
                        self.note_progress()?;
                        self.prefix_read += read;
                        if self.prefix_read < self.prefix.len() {
                            continue;
                        }
                        let declared = u32::from_be_bytes(self.prefix) as usize;
                        if declared > BROKER_FRAME_MAX_BYTES {
                            return Err(SigningTransportError::FrameTooLarge);
                        }
                        self.body.resize(declared, 0);
                        if declared == 0 {
                            return Ok(Some(self.take_frame()));
                        }
                    }
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(error)
                        if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
                    {
                        return self.timeout_result();
                    }
                    Err(error) => return Err(SigningTransportError::Io(error)),
                }
            }

            match reader.read(&mut self.body[self.body_read..]) {
                Ok(0) => return Err(Self::unexpected_eof()),
                Ok(read) => {
                    self.note_progress()?;
                    self.body_read += read;
                    if self.body_read == self.body.len() {
                        return Ok(Some(self.take_frame()));
                    }
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => {}
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
                {
                    return self.timeout_result();
                }
                Err(error) => return Err(SigningTransportError::Io(error)),
            }
        }
    }

    fn note_progress(&mut self) -> Result<(), SigningTransportError> {
        if self.partial_started.is_none() {
            self.partial_started = Some(Instant::now());
        }
        if self
            .partial_started
            .is_some_and(|started| started.elapsed() >= self.partial_frame_deadline)
        {
            return Err(SigningTransportError::PartialFrameTimeout);
        }
        Ok(())
    }

    fn timeout_result(&self) -> Result<Option<Vec<u8>>, SigningTransportError> {
        if self
            .partial_started
            .is_some_and(|started| started.elapsed() >= self.partial_frame_deadline)
        {
            Err(SigningTransportError::PartialFrameTimeout)
        } else {
            Err(SigningTransportError::IdleTimeout)
        }
    }

    fn take_frame(&mut self) -> Vec<u8> {
        let mut frame = Vec::with_capacity(4 + self.body.len());
        frame.extend_from_slice(&self.prefix);
        frame.append(&mut self.body);
        self.prefix = [0; 4];
        self.prefix_read = 0;
        self.body_read = 0;
        self.partial_started = None;
        frame
    }

    fn unexpected_eof() -> SigningTransportError {
        SigningTransportError::Io(std::io::Error::new(
            ErrorKind::UnexpectedEof,
            "managed signing peer closed a partial frame",
        ))
    }
}

/// Write one already-encoded frame and flush it before reading the next request.
pub(crate) fn write_frame<W: Write>(
    writer: &mut W,
    frame: &[u8],
) -> Result<(), SigningTransportError> {
    let prefix: [u8; 4] = frame
        .get(..4)
        .ok_or(SigningTransportError::InvalidFrameLength)?
        .try_into()
        .map_err(|_| SigningTransportError::InvalidFrameLength)?;
    let declared = u32::from_be_bytes(prefix) as usize;
    if declared > BROKER_FRAME_MAX_BYTES {
        return Err(SigningTransportError::FrameTooLarge);
    }
    if frame.len() != declared.saturating_add(4) {
        return Err(SigningTransportError::InvalidFrameLength);
    }
    writer.write_all(frame)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{Read, Write},
    };

    enum ReadStep {
        Bytes(Vec<u8>),
        Timeout,
    }

    struct ScriptedReader {
        steps: VecDeque<ReadStep>,
    }

    impl Read for ScriptedReader {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            match self.steps.pop_front().expect("scripted read step") {
                ReadStep::Timeout => Err(std::io::Error::from(ErrorKind::TimedOut)),
                ReadStep::Bytes(mut bytes) => {
                    let read = output.len().min(bytes.len());
                    output[..read].copy_from_slice(&bytes[..read]);
                    if read < bytes.len() {
                        bytes.drain(..read);
                        self.steps.push_front(ReadStep::Bytes(bytes));
                    }
                    Ok(read)
                }
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn luca_signing_transport_is_an_unnamed_bidirectional_socketpair() {
        use std::os::fd::AsRawFd;

        let (mut desktop, mut child) =
            create_socketpair_streams().expect("socketpair should be available");

        desktop.write_all(b"desktop").expect("desktop write");
        let mut from_desktop = [0_u8; 7];
        child.read_exact(&mut from_desktop).expect("child read");
        assert_eq!(&from_desktop, b"desktop");

        child.write_all(b"child").expect("child write");
        let mut from_child = [0_u8; 5];
        desktop.read_exact(&mut from_child).expect("desktop read");
        assert_eq!(&from_child, b"child");
        assert_ne!(desktop.as_raw_fd(), child.as_raw_fd());
    }

    #[test]
    fn luca_signing_transport_rejects_oversized_prefix_without_allocating_body() {
        let declared = u32::try_from(BROKER_FRAME_MAX_BYTES + 1)
            .expect("frozen maximum fits u32")
            .to_be_bytes();
        assert!(matches!(
            read_next_frame(&mut declared.as_slice()),
            Err(SigningTransportError::FrameTooLarge)
        ));
    }

    #[test]
    fn luca_signing_transport_retains_partial_frame_across_idle_ticks() {
        let payload = b"hello";
        let prefix = (payload.len() as u32).to_be_bytes();
        let mut reader = ScriptedReader {
            steps: VecDeque::from([
                ReadStep::Bytes(prefix[..2].to_vec()),
                ReadStep::Timeout,
                ReadStep::Bytes(prefix[2..].to_vec()),
                ReadStep::Bytes(payload.to_vec()),
            ]),
        };
        let mut framed = SigningFrameReader::new();
        assert!(matches!(
            framed.read_next_frame(&mut reader),
            Err(SigningTransportError::IdleTimeout)
        ));
        let frame = framed
            .read_next_frame(&mut reader)
            .expect("continued frame")
            .expect("frame");
        assert_eq!(&frame[..4], &prefix);
        assert_eq!(&frame[4..], payload);
    }

    #[test]
    fn luca_signing_transport_closes_slow_partial_frame_at_absolute_deadline() {
        let prefix = 5_u32.to_be_bytes();
        let mut reader = ScriptedReader {
            steps: VecDeque::from([ReadStep::Bytes(prefix[..1].to_vec()), ReadStep::Timeout]),
        };
        let mut framed = SigningFrameReader::with_partial_frame_deadline(Duration::ZERO);
        assert!(matches!(
            framed.read_next_frame(&mut reader),
            Err(SigningTransportError::PartialFrameTimeout)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn luca_signing_transport_reports_socket_idle_without_closing_session() {
        let (mut desktop, _child) =
            create_socketpair_streams().expect("socketpair should be available");
        desktop
            .set_read_timeout(Some(Duration::from_millis(10)))
            .expect("read timeout");
        let mut framed = SigningFrameReader::new();
        assert!(matches!(
            framed.read_next_frame(&mut desktop),
            Err(SigningTransportError::IdleTimeout)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn luca_signing_shutdown_wakes_an_idle_serving_read() {
        let (endpoint, child) =
            create_exclusive_acp_socketpair().expect("socketpair should be available");
        let (mut serving, shutdown) = endpoint.split_for_serve().expect("split endpoint");
        let waiting = std::thread::spawn(move || {
            let mut framed = SigningFrameReader::new();
            framed.read_next_frame(&mut serving)
        });
        std::thread::sleep(Duration::from_millis(10));
        shutdown.shutdown().expect("shutdown serving half");
        let result = waiting.join().expect("join serving read");
        assert!(
            matches!(result, Ok(None) | Err(SigningTransportError::Io(_))),
            "shutdown must wake the blocking read"
        );
        drop(child);
    }

    #[cfg(unix)]
    #[test]
    fn luca_signing_shutdown_is_idempotent_after_peer_close() {
        let (endpoint, child) =
            create_exclusive_acp_socketpair().expect("socketpair should be available");
        let (serving, shutdown) = endpoint.split_for_serve().expect("split endpoint");
        drop(serving);
        drop(child);
        shutdown.shutdown().expect("already-closed shutdown");
        shutdown.shutdown().expect("repeated shutdown");
    }
}

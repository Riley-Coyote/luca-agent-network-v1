//! Exclusive desktop-to-ACP transport for the typed managed signing broker.

use std::io::{Read, Write};

use luca_protocol::BROKER_FRAME_MAX_BYTES;

/// Transport creation or framed-I/O failure.
#[derive(Debug)]
pub(crate) enum SigningTransportError {
    /// The current platform lacks the approved exclusive inherited transport.
    #[cfg(not(unix))]
    UnsupportedPlatform,
    /// Socketpair or stream I/O failed.
    Io(std::io::Error),
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
            Self::FrameTooLarge | Self::InvalidFrameLength => None,
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
    /// Consume the endpoint into the blocking stream used by the broker loop.
    #[cfg(unix)]
    pub(crate) fn into_stream(self) -> std::os::unix::net::UnixStream {
        self.stream
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
pub(crate) fn read_next_frame<R: Read>(
    reader: &mut R,
) -> Result<Option<Vec<u8>>, SigningTransportError> {
    let mut prefix = [0_u8; 4];
    let first = match reader.read(&mut prefix[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => 1,
        Ok(_) => unreachable!("one-byte read cannot return more than one byte"),
        Err(error) => return Err(SigningTransportError::Io(error)),
    };
    debug_assert_eq!(first, 1);
    reader.read_exact(&mut prefix[1..])?;

    let declared = u32::from_be_bytes(prefix) as usize;
    if declared > BROKER_FRAME_MAX_BYTES {
        return Err(SigningTransportError::FrameTooLarge);
    }
    let mut frame = Vec::with_capacity(4 + declared);
    frame.extend_from_slice(&prefix);
    frame.resize(4 + declared, 0);
    reader.read_exact(&mut frame[4..])?;
    Ok(Some(frame))
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
    use std::io::{Read, Write};

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
}

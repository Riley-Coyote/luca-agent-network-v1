//! Standalone native-messaging stdio entry; the parent owns install/bootstrap.
//!
//! Call this before app/UI startup only for the explicitly installed native host.
//! It does not register Chrome manifests, launch the app, scan profiles, read
//! history, access provider credentials, or interpret payloads as instructions.

use super::browser_bridge::{
    self, BrowserBridgeError, BrowserBridgeFrameV1, BrowserClientFrameV1, BrowserReplyFrameV1,
    BROWSER_BRIDGE_PROTOCOL, BROWSER_PROTOCOL,
};
use std::{
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

/// Bootstrap from the parent's protected fixed internal file, never wire input.
/// Chrome supplies caller_origin as its first native-host argument. Parent must
/// check it against the exact installed manifest allowed_origins, not a wildcard.
pub(crate) struct BrowserNativeHostConfig {
    pub(crate) endpoint: PathBuf,
    pub(crate) bridge_capability: String,
    pub(crate) expected_origin: String,
    pub(crate) caller_origin: String,
}

/// Process a bounded JSON/native-byte-order framed stream. Stdout is framing only.
pub(crate) fn run_browser_native_host(
    config: &BrowserNativeHostConfig,
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> Result<(), BrowserBridgeError> {
    if !browser_bridge::valid_extension_origin(&config.expected_origin)
        || config.caller_origin != config.expected_origin
        || !config.endpoint.is_absolute()
        || config.endpoint.starts_with("/Volumes")
    {
        return Err(BrowserBridgeError::UnsafeScope);
    }
    while let Some(bytes) = browser_bridge::read_frame(reader)? {
        let client: BrowserClientFrameV1 =
            serde_json::from_slice(&bytes).map_err(|_| BrowserBridgeError::Invalid)?;
        client.validate()?;
        let request_id = client.request_id.clone();
        let frame = BrowserBridgeFrameV1 {
            protocol: BROWSER_BRIDGE_PROTOCOL.into(),
            bridge_capability: config.bridge_capability.clone(),
            caller_origin: config.caller_origin.clone(),
            client,
        };
        let reply = exchange(config, &frame)?;
        if reply.protocol != BROWSER_PROTOCOL || reply.request_id != request_id {
            return Err(BrowserBridgeError::Invalid);
        }
        browser_bridge::write_frame(
            writer,
            &serde_json::to_vec(&reply).map_err(|_| BrowserBridgeError::Invalid)?,
        )?;
    }
    Ok(())
}

fn exchange(
    config: &BrowserNativeHostConfig,
    frame: &BrowserBridgeFrameV1,
) -> Result<BrowserReplyFrameV1, BrowserBridgeError> {
    use std::os::unix::net::UnixStream;
    let mut stream =
        UnixStream::connect(&config.endpoint).map_err(|_| BrowserBridgeError::Unavailable)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| BrowserBridgeError::Unavailable)?;
    stream
        .set_write_timeout(Some(Duration::from_secs(1)))
        .map_err(|_| BrowserBridgeError::Unavailable)?;
    browser_bridge::write_frame(
        &mut stream,
        &serde_json::to_vec(frame).map_err(|_| BrowserBridgeError::Invalid)?,
    )?;
    let bytes = browser_bridge::read_frame(&mut stream)?.ok_or(BrowserBridgeError::Unavailable)?;
    serde_json::from_slice(&bytes).map_err(|_| BrowserBridgeError::Invalid)
}

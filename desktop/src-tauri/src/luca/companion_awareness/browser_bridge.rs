//! Narrow, parent-owned browser collector ingress; no tool or account authority.
//!
//! The parent callback authenticates profile/token pairing, current live owner,
//! per-kind/source grants and deny state. Neither Chrome permission nor these
//! validated collector claims authorize admission. Payloads never enter this
//! module's logs or a database. The native helper's private bridge capability
//! is separate from the extension profile's app-issued pairing token.

use luca_protocol::{OpaqueId, SafeU53};
use serde::{Deserialize, Serialize};
use std::{
    fmt, fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

/// Extension/native client wire version; not an awareness grant.
pub(crate) const BROWSER_PROTOCOL: &str = "polyphonic.browser-awareness.v1";
/// Private parent/helper envelope discriminator.
pub(crate) const BROWSER_BRIDGE_PROTOCOL: &str = "polyphonic.browser-bridge.v1";
/// Name for an explicitly installed Chrome native host manifest.
pub(crate) const BROWSER_NATIVE_HOST: &str = "chat.polyphonic.browser_awareness";
/// Stable unpacked-development ID derived from the manifest public key.
pub(crate) const DEVELOPMENT_EXTENSION_ID: &str = "cgeconjecinkbflofoimhcegaiebecgg";
/// Bound applied before allocation on both stdio and private UDS transport.
pub(crate) const MAX_BROWSER_FRAME_BYTES: usize = 64 * 1024;
const MAX_EXCERPT_BYTES: usize = 4096;

/// Body-free failure. No path, pairing secret, URL or collector content is exposed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserBridgeError {
    Invalid,
    UnsafeScope,
    Unavailable,
}
impl fmt::Display for BrowserBridgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "browser bridge: {self:?}")
    }
}
impl std::error::Error for BrowserBridgeError {}

/// Separate observation classes; granting visits never grants excerpts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BrowserEventKindV1 {
    Visit,
    Bookmark,
    Excerpt,
}

/// Untrusted collector reference. The parent assigns source/principals/time itself.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserEventV1 {
    pub(crate) event_id: OpaqueId,
    pub(crate) sequence: SafeU53,
    /// Browser timestamp is reference metadata, never host freshness authority.
    pub(crate) browser_time_ms: SafeU53,
    pub(crate) kind: BrowserEventKindV1,
    pub(crate) url: String,
    pub(crate) title: Option<String>,
    pub(crate) excerpt: Option<String>,
    pub(crate) incognito: bool,
    pub(crate) credential_context: bool,
    pub(crate) excluded: bool,
    pub(crate) scope_verified: bool,
}
impl fmt::Debug for BrowserEventV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BrowserEventV1")
            .field("event_id", &self.event_id)
            .field("kind", &self.kind)
            .field("payload", &"[REDACTED]")
            .finish()
    }
}
impl BrowserEventV1 {
    pub(crate) fn validate(&self) -> Result<(), BrowserBridgeError> {
        if self.incognito
            || self.credential_context
            || self.excluded
            || !self.scope_verified
            || self.sequence.get() == 0
            || self.url.len() > 2048
        {
            return Err(BrowserBridgeError::UnsafeScope);
        }
        let url = reqwest::Url::parse(&self.url).map_err(|_| BrowserBridgeError::UnsafeScope)?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
            || unsafe_route(url.path())
        {
            return Err(BrowserBridgeError::UnsafeScope);
        }
        if self
            .title
            .as_ref()
            .is_some_and(|value| value.len() > 256 || !safe_text(value))
        {
            return Err(BrowserBridgeError::UnsafeScope);
        }
        match (self.kind, self.excerpt.as_ref()) {
            (BrowserEventKindV1::Excerpt, Some(value))
                if !value.trim().is_empty()
                    && value.len() <= MAX_EXCERPT_BYTES
                    && safe_text(value) => {}
            (BrowserEventKindV1::Visit | BrowserEventKindV1::Bookmark, None) => {}
            _ => return Err(BrowserBridgeError::UnsafeScope),
        }
        Ok(())
    }
}

/// Only pairing/status/reference ingestion exists; no arbitrary method or tool args.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum BrowserRequestV1 {
    Pair {
        profile_instance_id: OpaqueId,
        pairing_code: String,
    },
    Status {
        profile_instance_id: OpaqueId,
        token: String,
    },
    Observe {
        profile_instance_id: OpaqueId,
        token: String,
        event: BrowserEventV1,
    },
}
impl fmt::Debug for BrowserRequestV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BrowserRequestV1")
            .field("profile", self.profile())
            .field("content_and_secret", &"[REDACTED]")
            .finish()
    }
}
impl BrowserRequestV1 {
    pub(crate) fn profile(&self) -> &OpaqueId {
        match self {
            Self::Pair {
                profile_instance_id,
                ..
            }
            | Self::Status {
                profile_instance_id,
                ..
            }
            | Self::Observe {
                profile_instance_id,
                ..
            } => profile_instance_id,
        }
    }
    pub(crate) fn validate(&self) -> Result<(), BrowserBridgeError> {
        if !self.profile().as_str().starts_with("profile-") {
            return Err(BrowserBridgeError::Invalid);
        }
        match self {
            Self::Pair { pairing_code, .. } if valid_secret(pairing_code, 6, 64) => Ok(()),
            Self::Status { token, .. } if valid_secret(token, 32, 128) => Ok(()),
            Self::Observe { token, event, .. } if valid_secret(token, 32, 128) => event.validate(),
            _ => Err(BrowserBridgeError::Invalid),
        }
    }
}

/// App-issued result. Pairing and kind grants are independent.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum BrowserResponseV1 {
    Paired {
        profile_instance_id: OpaqueId,
        token: String,
        collection_enabled: bool,
        allowed_kinds: Vec<BrowserEventKindV1>,
    },
    Status {
        profile_instance_id: OpaqueId,
        collection_enabled: bool,
        allowed_kinds: Vec<BrowserEventKindV1>,
    },
    Receipt {
        event_id: OpaqueId,
        admitted: bool,
    },
    Rejected {
        code: BrowserRejectionV1,
    },
}
impl fmt::Debug for BrowserResponseV1 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("BrowserResponseV1([REDACTED])")
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BrowserRejectionV1 {
    Invalid,
    Unpaired,
    NotGranted,
    Paused,
    UnsafeScope,
    Unavailable,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserClientFrameV1 {
    pub(crate) protocol: String,
    pub(crate) request_id: OpaqueId,
    pub(crate) request: BrowserRequestV1,
}
impl BrowserClientFrameV1 {
    pub(crate) fn validate(&self) -> Result<(), BrowserBridgeError> {
        if self.protocol != BROWSER_PROTOCOL {
            return Err(BrowserBridgeError::Invalid);
        }
        self.request.validate()
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserReplyFrameV1 {
    pub(crate) protocol: String,
    pub(crate) request_id: OpaqueId,
    pub(crate) response: BrowserResponseV1,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BrowserBridgeFrameV1 {
    pub(crate) protocol: String,
    pub(crate) bridge_capability: String,
    pub(crate) caller_origin: String,
    pub(crate) client: BrowserClientFrameV1,
}

/// The parent supplies an internal private transport directory and random secret.
/// Darwin UDS paths are short: use a parent-created short private internal dir,
/// not an overlong app-data path or a browser-owned directory.
pub(crate) struct BrowserBridgeConfig {
    pub(crate) directory: PathBuf,
    pub(crate) allowed_origin: String,
    pub(crate) bridge_capability: String,
}
pub(crate) type BrowserHostCallback =
    Arc<dyn Fn(BrowserClientFrameV1) -> BrowserResponseV1 + Send + Sync>;

/// Owns only the socket it created; startup does not install or activate a browser.
pub(crate) struct BrowserBridgeHandle {
    path: PathBuf,
    socket_identity: (u64, u64),
    active: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl BrowserBridgeHandle {
    pub(crate) fn endpoint(&self) -> &Path {
        &self.path
    }
}
impl Drop for BrowserBridgeHandle {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
        // Wake the blocking accept without a permanent polling/heartbeat loop.
        let _ = std::os::unix::net::UnixStream::connect(&self.path);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        use std::os::unix::fs::{FileTypeExt, MetadataExt};
        if fs::symlink_metadata(&self.path).is_ok_and(|metadata| {
            metadata.file_type().is_socket()
                && (metadata.dev(), metadata.ino()) == self.socket_identity
        }) {
            let _ = fs::remove_file(&self.path); // Exact owned socket only, never a directory.
        }
    }
}

/// Start only a local typed ingress after explicit parent admission. The callback
/// must be bounded and must not wait for UI, models, sign-in or another collector.
pub(crate) fn start_browser_bridge(
    config: BrowserBridgeConfig,
    callback: BrowserHostCallback,
) -> Result<BrowserBridgeHandle, BrowserBridgeError> {
    use std::os::unix::{
        fs::{MetadataExt, PermissionsExt},
        net::UnixListener,
    };
    validate_directory(&config.directory)?;
    if !valid_extension_origin(&config.allowed_origin)
        || !valid_secret(&config.bridge_capability, 32, 128)
    {
        return Err(BrowserBridgeError::Invalid);
    }
    let path = config
        .directory
        .join(format!("browser-{}.sock", uuid::Uuid::new_v4().simple()));
    if path.as_os_str().as_encoded_bytes().len() >= 104 {
        return Err(BrowserBridgeError::UnsafeScope);
    }
    let listener = UnixListener::bind(&path).map_err(|_| BrowserBridgeError::Unavailable)?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|_| BrowserBridgeError::Unavailable)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| BrowserBridgeError::Unavailable)?;
    let socket_identity = (metadata.dev(), metadata.ino());
    let active = Arc::new(AtomicBool::new(true));
    let serving = Arc::clone(&active);
    let thread = thread::Builder::new()
        .name("polyphonic-browser-ingress".into())
        .spawn(move || {
            while serving.load(Ordering::Acquire) {
                let Ok((mut stream, _)) = listener.accept() else {
                    break;
                };
                if !serving.load(Ordering::Acquire) {
                    break;
                }
                let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let _ = serve_one(
                    &mut stream,
                    &config.allowed_origin,
                    &config.bridge_capability,
                    &callback,
                );
            }
        })
        .map_err(|_| BrowserBridgeError::Unavailable)?;
    Ok(BrowserBridgeHandle {
        path,
        socket_identity,
        active,
        thread: Some(thread),
    })
}

fn serve_one(
    stream: &mut std::os::unix::net::UnixStream,
    allowed_origin: &str,
    capability: &str,
    callback: &BrowserHostCallback,
) -> Result<(), BrowserBridgeError> {
    let bytes = read_frame(stream)?.ok_or(BrowserBridgeError::Invalid)?;
    let frame: BrowserBridgeFrameV1 =
        serde_json::from_slice(&bytes).map_err(|_| BrowserBridgeError::Invalid)?;
    let response = if frame.protocol != BROWSER_BRIDGE_PROTOCOL
        || frame.caller_origin != allowed_origin
        || !secret_eq(&frame.bridge_capability, capability)
        || frame.client.validate().is_err()
    {
        BrowserResponseV1::Rejected {
            code: BrowserRejectionV1::Invalid,
        }
    } else {
        // Callback is trusted host code, synchronous/bounded, and must perform
        // profile/token/current owner/deny/per-kind grant checks. No model calls.
        callback(frame.client.clone())
    };
    let reply = BrowserReplyFrameV1 {
        protocol: BROWSER_PROTOCOL.into(),
        request_id: frame.client.request_id,
        response,
    };
    write_frame(
        stream,
        &serde_json::to_vec(&reply).map_err(|_| BrowserBridgeError::Invalid)?,
    )
}

pub(crate) fn read_frame(reader: &mut impl Read) -> Result<Option<Vec<u8>>, BrowserBridgeError> {
    let mut header = [0u8; 4];
    match reader.read(&mut header[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => {}
        _ => return Err(BrowserBridgeError::Invalid),
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|_| BrowserBridgeError::Invalid)?;
    let length = u32::from_ne_bytes(header) as usize;
    if length == 0 || length > MAX_BROWSER_FRAME_BYTES {
        return Err(BrowserBridgeError::Invalid);
    }
    let mut bytes = vec![0u8; length];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| BrowserBridgeError::Invalid)?;
    Ok(Some(bytes))
}
pub(crate) fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> Result<(), BrowserBridgeError> {
    if bytes.is_empty() || bytes.len() > MAX_BROWSER_FRAME_BYTES {
        return Err(BrowserBridgeError::Invalid);
    }
    writer
        .write_all(&(bytes.len() as u32).to_ne_bytes())
        .and_then(|_| writer.write_all(bytes))
        .and_then(|_| writer.flush())
        .map_err(|_| BrowserBridgeError::Unavailable)
}
pub(crate) fn valid_extension_origin(origin: &str) -> bool {
    origin
        .strip_prefix("chrome-extension://")
        .and_then(|value| value.strip_suffix('/'))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|value| (b'a'..=b'p').contains(&value)))
}
fn validate_directory(directory: &Path) -> Result<(), BrowserBridgeError> {
    use std::os::unix::fs::PermissionsExt;
    if !directory.is_absolute()
        || directory.starts_with("/Volumes")
        || directory
            .components()
            .any(|part| matches!(part, Component::CurDir | Component::ParentDir))
    {
        return Err(BrowserBridgeError::UnsafeScope);
    }
    let metadata = fs::symlink_metadata(directory).map_err(|_| BrowserBridgeError::UnsafeScope)?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || metadata.permissions().mode() & 0o077 != 0
        || fs::canonicalize(directory).map_err(|_| BrowserBridgeError::UnsafeScope)? != directory
    {
        return Err(BrowserBridgeError::UnsafeScope);
    }
    Ok(())
}
fn valid_secret(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
fn secret_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0u8, |different, (a, b)| different | (a ^ b))
        == 0
}
fn safe_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let compact = lower
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    !value
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t')
        && !lower.split_whitespace().any(|word| word == "bearer")
        && ![
            "api_key",
            "api-key",
            "apikey",
            "private_key",
            "privatekey",
            "password:",
            "password=",
            "secret:",
            "secret=",
            "nsec1",
            "sk-",
        ]
        .iter()
        .any(|term| compact.contains(term))
}
fn unsafe_route(path: &str) -> bool {
    // Percent-encoded path ambiguity is unsupported; never guess it safe.
    path.contains('%')
        || path.to_ascii_lowercase().split('/').any(|part| {
            matches!(
                part,
                "login"
                    | "log-in"
                    | "signin"
                    | "sign-in"
                    | "auth"
                    | "oauth"
                    | "callback"
                    | "password"
                    | "reset-password"
                    | "credentials"
                    | "checkout"
                    | "payment"
            )
        })
}

#[cfg(test)]
#[path = "browser_tests.rs"]
mod tests;

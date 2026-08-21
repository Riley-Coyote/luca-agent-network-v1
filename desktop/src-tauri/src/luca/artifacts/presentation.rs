use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

use chrono::{SecondsFormat, Utc};
use luca_protocol::{ArtifactKindV1, Hex64, OpaqueId, SafeU53};
use serde::Serialize;
use tauri::http::{self, HeaderValue, Method, StatusCode};

use super::{ArtifactStore, ArtifactStoreError};

const PRESENTATION_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_PRESENTATIONS: usize = 32;
const STATIC_HTML_CSP_PACKAGED: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'; frame-ancestors tauri://localhost http://tauri.localhost";
const STATIC_HTML_CSP_DEV: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'; frame-ancestors tauri://localhost http://tauri.localhost http://localhost:*";

fn static_html_csp_for(dev: bool) -> &'static str {
    if dev {
        STATIC_HTML_CSP_DEV
    } else {
        STATIC_HTML_CSP_PACKAGED
    }
}

fn static_html_csp() -> &'static str {
    static_html_csp_for(cfg!(debug_assertions))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
/// Revocable native-scheme capability for sandboxed static HTML.
pub(crate) struct PreparedArtifactPreviewV1 {
    pub renderer: &'static str,
    pub artifact_id: String,
    pub version: u64,
    pub presentation_id: String,
    pub uri: String,
    pub media_type: String,
    pub expires_at: String,
}

#[derive(Clone)]
struct StoredPresentation {
    owner_pubkey: String,
    artifact_id: String,
    presentation_id: String,
    media_type: String,
    content: Vec<u8>,
    created_at: SystemTime,
    expires_at: SystemTime,
}

static PRESENTATIONS: OnceLock<Mutex<HashMap<String, StoredPresentation>>> = OnceLock::new();

fn presentations() -> &'static Mutex<HashMap<String, StoredPresentation>> {
    PRESENTATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn random_capability() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn purge_expired(values: &mut HashMap<String, StoredPresentation>, now: SystemTime) {
    values.retain(|_, presentation| presentation.expires_at > now);
}

pub(crate) fn prepare(
    store: &ArtifactStore,
    owner_pubkey: &Hex64,
    artifact_id: &OpaqueId,
    version: Option<SafeU53>,
) -> Result<PreparedArtifactPreviewV1, ArtifactStoreError> {
    let preview = store.read_binary(owner_pubkey, artifact_id, version)?;
    if preview.artifact.deleted_at.is_some()
        || !is_authoritative_html(preview.artifact.kind, &preview.version.media_type)
    {
        return Err(ArtifactStoreError::Unsupported);
    }
    let now = SystemTime::now();
    let expires_at = now
        .checked_add(PRESENTATION_TTL)
        .ok_or(ArtifactStoreError::Unavailable)?;
    let presentation_id = uuid::Uuid::new_v4().to_string();
    let token = random_capability();
    let stored = StoredPresentation {
        owner_pubkey: owner_pubkey.as_str().to_owned(),
        artifact_id: artifact_id.as_str().to_owned(),
        presentation_id: presentation_id.clone(),
        media_type: preview.version.media_type.clone(),
        content: preview.content.ok_or(ArtifactStoreError::CorruptBlob)?,
        created_at: now,
        expires_at,
    };
    let mut values = presentations()
        .lock()
        .map_err(|_| ArtifactStoreError::Unavailable)?;
    purge_expired(&mut values, now);
    if values.len() >= MAX_PRESENTATIONS {
        if let Some(oldest) = values
            .iter()
            .min_by_key(|(_, value)| value.created_at)
            .map(|(token, _)| token.clone())
        {
            values.remove(&oldest);
        }
    }
    values.insert(token.clone(), stored);
    let expires_at =
        chrono::DateTime::<Utc>::from(expires_at).to_rfc3339_opts(SecondsFormat::Millis, true);
    Ok(PreparedArtifactPreviewV1 {
        renderer: "sandboxed_html",
        artifact_id: artifact_id.as_str().to_owned(),
        version: preview.version.version,
        presentation_id,
        uri: format!("luca-artifact://localhost/{token}"),
        media_type: preview.version.media_type,
        expires_at,
    })
}

fn is_authoritative_html(kind: ArtifactKindV1, media_type: &str) -> bool {
    kind == ArtifactKindV1::Html && media_type == "text/html; charset=utf-8"
}

pub(crate) fn revoke(owner_pubkey: &str, presentation_id: &str) -> Result<bool, String> {
    let mut values = presentations()
        .lock()
        .map_err(|_| "artifact-unavailable".to_owned())?;
    let token = values
        .iter()
        .find(|(_, value)| {
            value.owner_pubkey == owner_pubkey && value.presentation_id == presentation_id
        })
        .map(|(token, _)| token.clone());
    Ok(token.is_some_and(|token| values.remove(&token).is_some()))
}

pub(crate) fn revoke_for_artifact(owner_pubkey: &str, artifact_id: &str) -> Result<usize, String> {
    let mut values = presentations()
        .lock()
        .map_err(|_| "artifact-unavailable".to_owned())?;
    let before = values.len();
    values
        .retain(|_, value| value.owner_pubkey != owner_pubkey || value.artifact_id != artifact_id);
    Ok(before.saturating_sub(values.len()))
}

pub(crate) fn revoke_all() -> Result<usize, String> {
    let mut values = presentations()
        .lock()
        .map_err(|_| "artifact-unavailable".to_owned())?;
    let count = values.len();
    values.clear();
    Ok(count)
}

pub(crate) fn handle(
    owner_pubkey: Option<&str>,
    request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    if request.method() != Method::GET
        || request.uri().host() != Some("localhost")
        || request.uri().query().is_some()
    {
        return error_response(StatusCode::NOT_FOUND);
    }
    let Some(owner_pubkey) = owner_pubkey else {
        return error_response(StatusCode::NOT_FOUND);
    };
    let token = request.uri().path().trim_start_matches('/');
    if token.len() != 64 || !token.bytes().all(|value| value.is_ascii_hexdigit()) {
        return error_response(StatusCode::NOT_FOUND);
    }
    let presentation = {
        let Ok(mut values) = presentations().lock() else {
            return error_response(StatusCode::SERVICE_UNAVAILABLE);
        };
        purge_expired(&mut values, SystemTime::now());
        values
            .get(token)
            .filter(|value| value.owner_pubkey == owner_pubkey)
            .cloned()
    };
    let Some(presentation) = presentation else {
        return error_response(StatusCode::NOT_FOUND);
    };
    let mut response = http::Response::new(presentation.content);
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    insert_header(headers, "content-type", &presentation.media_type);
    insert_header(headers, "content-security-policy", static_html_csp());
    insert_header(headers, "cache-control", "no-store");
    insert_header(headers, "referrer-policy", "no-referrer");
    insert_header(headers, "x-content-type-options", "nosniff");
    insert_header(
        headers,
        "permissions-policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    response
}

fn insert_header(headers: &mut http::HeaderMap, name: &'static str, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        headers.insert(name, value);
    }
}

fn error_response(status: StatusCode) -> http::Response<Vec<u8>> {
    let mut response = http::Response::new(Vec::new());
    *response.status_mut() = status;
    insert_header(response.headers_mut(), "cache-control", "no-store");
    insert_header(response.headers_mut(), "x-content-type-options", "nosniff");
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn presentation_test_guard() -> std::sync::MutexGuard<'static, ()> {
        static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn insert_test_presentation(owner: &str, expired: bool) -> (String, String) {
        let token = random_capability();
        let presentation_id = uuid::Uuid::new_v4().to_string();
        let now = SystemTime::now();
        presentations().lock().unwrap().insert(
            token.clone(),
            StoredPresentation {
                owner_pubkey: owner.to_owned(),
                artifact_id: "artifact-1".to_owned(),
                presentation_id: presentation_id.clone(),
                media_type: "text/html; charset=utf-8".to_owned(),
                content: b"<!-- an attacker-controlled early comment --><meta http-equiv=\"Content-Security-Policy\" content=\"default-src * 'unsafe-inline'\"><meta http-equiv=\"refresh\" content=\"0;url=http://127.0.0.1:9/escaped\"><script>window.test = true</script>".to_vec(),
                created_at: now,
                expires_at: if expired {
                    SystemTime::UNIX_EPOCH
                } else {
                    now + PRESENTATION_TTL
                },
            },
        );
        (token, presentation_id)
    }

    fn request(token: &str) -> http::Request<Vec<u8>> {
        http::Request::builder()
            .uri(format!("luca-artifact://localhost/{token}"))
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn native_response_applies_non_weakenable_security_headers() {
        let _guard = presentation_test_guard();
        revoke_all().unwrap();
        let (token, _) = insert_test_presentation("owner", false);
        let response = handle(Some("owner"), &request(&token));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("content-security-policy").unwrap(),
            static_html_csp()
        );
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        assert_eq!(
            response.body(),
            b"<!-- an attacker-controlled early comment --><meta http-equiv=\"Content-Security-Policy\" content=\"default-src * 'unsafe-inline'\"><meta http-equiv=\"refresh\" content=\"0;url=http://127.0.0.1:9/escaped\"><script>window.test = true</script>"
        );
        assert!(static_html_csp().contains("navigate-to 'none'"));
    }

    #[test]
    fn semantic_kind_cannot_override_authoritative_media_type() {
        assert!(is_authoritative_html(
            ArtifactKindV1::Html,
            "text/html; charset=utf-8"
        ));
        assert!(!is_authoritative_html(
            ArtifactKindV1::Html,
            "text/plain; charset=utf-8"
        ));
        assert!(!is_authoritative_html(
            ArtifactKindV1::Text,
            "text/html; charset=utf-8"
        ));
    }

    #[test]
    fn parent_origin_policy_is_narrow_and_dev_aware() {
        let packaged = static_html_csp_for(false);
        assert!(packaged.contains("tauri://localhost http://tauri.localhost"));
        assert!(!packaged.contains("http://localhost:*"));
        let dev = static_html_csp_for(true);
        assert!(dev.contains("http://localhost:*"));
        assert!(!dev.contains("http://*"));
    }

    #[test]
    fn owner_host_expiry_and_revocation_fail_closed() {
        let _guard = presentation_test_guard();
        revoke_all().unwrap();
        let (token, presentation_id) = insert_test_presentation("owner", false);
        assert_eq!(
            handle(Some("other"), &request(&token)).status(),
            StatusCode::NOT_FOUND
        );
        let wrong_host = http::Request::builder()
            .uri(format!("luca-artifact://evil.invalid/{token}"))
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            handle(Some("owner"), &wrong_host).status(),
            StatusCode::NOT_FOUND
        );
        assert!(revoke("owner", &presentation_id).unwrap());
        assert_eq!(
            handle(Some("owner"), &request(&token)).status(),
            StatusCode::NOT_FOUND
        );

        let (expired, _) = insert_test_presentation("owner", true);
        assert_eq!(
            handle(Some("owner"), &request(&expired)).status(),
            StatusCode::NOT_FOUND
        );
    }
}

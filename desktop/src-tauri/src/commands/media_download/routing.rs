//! Narrow recovery of content-addressed attachments from a prior local port.
//! Signed message bytes are never changed, and the former port is never dialled.

use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::app_state::AppState;
use crate::relay::relay_api_base_url_with_override;

pub(crate) const LOCAL_RECOVERY_QUERY: &str = "buzz_local_recovery=1";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRoutingContext {
    relay_origin: String,
    supervised_local: bool,
}

pub(crate) fn context(state: &AppState) -> MediaRoutingContext {
    let base = relay_api_base_url_with_override(state);
    MediaRoutingContext {
        relay_origin: base.clone(),
        supervised_local: local_media_root(state, &base).is_some(),
    }
}

fn local_media_root(state: &AppState, base: &str) -> Option<PathBuf> {
    let app = state.app_handle.lock().ok()?.clone()?;
    let owner = state.keys.lock().ok()?.public_key().to_hex();
    let runtime = app.try_state::<crate::local_relay::RuntimeState>()?;
    crate::local_relay::supervised_media_root(&app, &runtime, &owner, base)
}

fn strict_filename(path: &str) -> Option<&str> {
    let filename = path.strip_prefix("/media/")?;
    let (hash, suffix) = filename.split_once('.')?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    let ext = suffix.strip_prefix("thumb.").unwrap_or(suffix);
    matches!(ext, "jpg" | "png" | "gif" | "webp" | "mp4" | "webm" | "mov").then_some(filename)
}

fn stale_local_filename(raw: &str) -> Option<&str> {
    // URL parsers normalize dot segments, backslashes, whitespace and encoded
    // paths. Recovery accepts only the original, literal, canonical media path.
    if raw.bytes().any(|b| b <= b' ' || b == b'\\') {
        return None;
    }
    let parsed = url::Url::parse(raw).ok()?;
    if parsed.scheme() != "http"
        || !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }
    let authority_and_path = raw.strip_prefix("http://")?;
    let slash = authority_and_path.find('/')?;
    if authority_and_path[..slash].contains('@') {
        return None;
    }
    let raw_path = &authority_and_path[slash..];
    if raw_path != parsed.path() {
        return None;
    }
    strict_filename(raw_path)
}

fn local_file_exists(root: &Path, filename: &str) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let path = root
        .join(&filename[..2])
        .join(&filename[2..4])
        .join(filename);
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    path.starts_with(&root) && path.is_file()
}

fn recovered_url(raw: &str, base: &str, root: Option<&Path>) -> Result<String, String> {
    let filename = stale_local_filename(raw)
        .ok_or_else(|| "attachment is not a recoverable local media URL".to_string())?;
    let root = root.ok_or_else(|| {
        "local media recovery requires the current supervised owner relay".to_string()
    })?;
    if !local_file_exists(root, filename) {
        return Err("attachment is not present in this local profile".to_string());
    }
    let resolved = format!("{base}/media/{filename}");
    super::validate_download_url(&resolved, base)?;
    Ok(resolved)
}

pub(crate) fn resolve_download_url(
    raw: &str,
    state: &AppState,
    base: &str,
) -> Result<String, String> {
    if super::validate_download_url(raw, base).is_ok() {
        return Ok(raw.to_string());
    }
    recovered_url(raw, base, local_media_root(state, base).as_deref())
}

/// The recovery marker is private routing metadata, never an upstream query.
/// Ordinary remote-community paths retain their existing exact-origin route.
pub(crate) fn resolve_proxy_url(
    path_and_query: &str,
    state: &AppState,
    base: &str,
) -> Result<String, String> {
    let Some(path) = recovery_path(path_and_query)? else {
        return Ok(format!("{base}{path_and_query}"));
    };
    recovered_url(
        &format!("http://127.0.0.1{path}"),
        base,
        local_media_root(state, base).as_deref(),
    )
}

fn recovery_path(path_and_query: &str) -> Result<Option<&str>, String> {
    let Some((path, query)) = path_and_query.split_once('?') else {
        return Ok(None);
    };
    if !query
        .split('&')
        .any(|part| part.split('=').next() == Some("buzz_local_recovery"))
    {
        return Ok(None);
    }
    if query != LOCAL_RECOVERY_QUERY || strict_filename(path).is_none() {
        return Err("invalid local media recovery path".to_string());
    }
    Ok(Some(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_port_requires_current_profile_content_and_never_preserves_old_origin() {
        let temp = tempfile::tempdir().unwrap();
        let filename = format!("{}.png", "a".repeat(64));
        let raw = format!("http://127.0.0.1:51477/media/{filename}");
        let base = "http://127.0.0.1:61234";
        assert!(recovered_url(&raw, base, None).is_err());
        assert!(recovered_url(&raw, base, Some(temp.path())).is_err());
        std::fs::create_dir_all(temp.path().join("aa/aa")).unwrap();
        std::fs::write(temp.path().join("aa/aa").join(&filename), b"fixture").unwrap();
        assert_eq!(
            recovered_url(&raw, base, Some(temp.path())).unwrap(),
            format!("{base}/media/{filename}")
        );
        let other_profile = tempfile::tempdir().unwrap();
        assert!(recovered_url(&raw, base, Some(other_profile.path())).is_err());
    }

    #[test]
    fn recovery_rejects_credentials_nonlocal_and_normalized_or_unbounded_paths() {
        let file = format!("{}.png", "b".repeat(64));
        for raw in [
            format!("https://127.0.0.1:1/media/{file}"),
            format!("http://evil.example/media/{file}"),
            format!("http://192.168.1.1/media/{file}"),
            format!("http://user:secret@127.0.0.1/media/{file}"),
            format!("http://127.0.0.1/media/{file}?token=secret"),
            format!("http://127.0.0.1/media/{file}#fragment"),
            format!("http://127.0.0.1/other/../media/{file}"),
            format!("http://127.0.0.1/media/%2e%2e/{file}"),
            format!("http://127.0.0.1/media/{file}/extra"),
            "http://127.0.0.1/media/short.png".to_string(),
            format!("http://127.0.0.1/media/{}.html", "b".repeat(64)),
        ] {
            assert!(stale_local_filename(&raw).is_none(), "accepted {raw}");
        }
        assert!(stale_local_filename(&format!(
            "http://localhost:1234/media/{}.thumb.jpg",
            "b".repeat(64)
        ))
        .is_some());
    }

    #[test]
    fn proxy_marker_is_stripped_and_cannot_carry_extra_upstream_parameters() {
        let path = format!("/media/{}.png", "b".repeat(64));
        assert_eq!(
            recovery_path(&format!("{path}?{LOCAL_RECOVERY_QUERY}")).unwrap(),
            Some(path.as_str())
        );
        assert_eq!(recovery_path(&format!("{path}?ordinary=1")).unwrap(), None);
        assert_eq!(recovery_path(&path).unwrap(), None);
        assert!(recovery_path(&format!("{path}?{LOCAL_RECOVERY_QUERY}&token=secret")).is_err());
        assert!(recovery_path(&format!("{path}?buzz_local_recovery=0")).is_err());
        assert!(recovery_path(&format!("/media/../secret?{LOCAL_RECOVERY_QUERY}")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn recovery_does_not_follow_a_hash_symlink_into_another_profile() {
        let current = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let filename = format!("{}.png", "a".repeat(64));
        std::fs::write(other.path().join(&filename), b"fixture").unwrap();
        std::fs::create_dir_all(current.path().join("aa/aa")).unwrap();
        std::os::unix::fs::symlink(
            other.path().join(&filename),
            current.path().join("aa/aa").join(&filename),
        )
        .unwrap();
        assert!(!local_file_exists(current.path(), &filename));
    }
}

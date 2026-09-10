//! Application data directory resolution.
//!
//! By default the desktop app stores everything under Tauri's `app_data_dir()`,
//! which is derived purely from the bundle identifier
//! (`~/Library/Application Support/<identifier>` on macOS).
//!
//! For release smoke tests we need a way to run a *real signed build* without it
//! writing into the tester's — or Riley's — actual account data. Setting
//! `BUZZ_DESKTOP_DATA_DIR` to an **absolute** path redirects every app-data
//! lookup at that directory instead. This is honoured in release builds on
//! purpose; unlike the keyring override (see `app_state_keyring`) there is
//! nothing destructive about writing app state somewhere else, and the variable
//! has to be set deliberately.
//!
//! Call sites use `manager.buzz_path().app_data_dir()` instead of
//! `manager.path().app_data_dir()`. Everything else on `PathResolver` is
//! unchanged and still reached through `.path()`.

use std::path::{Path, PathBuf};

use tauri::{Manager, Runtime};

pub(crate) const DATA_DIR_ENV: &str = "BUZZ_DESKTOP_DATA_DIR";

/// Validate a raw `BUZZ_DESKTOP_DATA_DIR` value.
///
/// Only absolute, non-empty paths are accepted. A relative path would resolve
/// against whatever working directory the app happened to be launched with,
/// which is exactly the kind of surprise this override must not create.
pub(crate) fn validate_override(raw: Option<&str>) -> Option<PathBuf> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return None;
    }
    Some(path.to_path_buf())
}

/// The configured override, resolved once per process.
pub(crate) fn data_dir_override() -> Option<&'static Path> {
    static OVERRIDE: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    OVERRIDE
        .get_or_init(|| {
            let raw = std::env::var(DATA_DIR_ENV).ok();
            let resolved = validate_override(raw.as_deref());
            match (&raw, &resolved) {
                (Some(value), None) if !value.trim().is_empty() => {
                    eprintln!(
                        "buzz-desktop: {DATA_DIR_ENV} ignored, the value must be an absolute path: {value}"
                    );
                }
                (_, Some(path)) => {
                    if let Err(error) = std::fs::create_dir_all(path) {
                        eprintln!(
                            "buzz-desktop: could not create the {DATA_DIR_ENV} directory {}: {error}",
                            path.display()
                        );
                    }
                    eprintln!(
                        "buzz-desktop: app data directory overridden by {DATA_DIR_ENV} -> {}",
                        path.display()
                    );
                }
                _ => {}
            }
            resolved
        })
        .as_deref()
}

/// A thin wrapper over Tauri's `PathResolver` that honours the override.
pub(crate) struct BuzzPaths<'a, R: Runtime> {
    inner: &'a tauri::path::PathResolver<R>,
}

impl<R: Runtime> BuzzPaths<'_, R> {
    /// The app data directory, honouring `BUZZ_DESKTOP_DATA_DIR`.
    pub(crate) fn app_data_dir(&self) -> tauri::Result<PathBuf> {
        if let Some(dir) = data_dir_override() {
            return Ok(dir.to_path_buf());
        }
        self.inner.app_data_dir()
    }
}

pub(crate) trait BuzzPathExt<R: Runtime> {
    fn buzz_path(&self) -> BuzzPaths<'_, R>;
}

impl<R: Runtime, T: Manager<R>> BuzzPathExt<R> for T {
    fn buzz_path(&self) -> BuzzPaths<'_, R> {
        BuzzPaths { inner: self.path() }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_override;
    use std::path::PathBuf;

    #[test]
    fn absolute_paths_are_accepted() {
        assert_eq!(
            validate_override(Some("/private/tmp/wt-rel2-out/data")),
            Some(PathBuf::from("/private/tmp/wt-rel2-out/data"))
        );
    }

    #[test]
    fn surrounding_whitespace_is_trimmed() {
        assert_eq!(
            validate_override(Some("  /private/tmp/data  ")),
            Some(PathBuf::from("/private/tmp/data"))
        );
    }

    #[test]
    fn relative_and_empty_values_are_rejected() {
        assert_eq!(validate_override(None), None);
        assert_eq!(validate_override(Some("")), None);
        assert_eq!(validate_override(Some("   ")), None);
        assert_eq!(validate_override(Some("relative/data")), None);
        assert_eq!(validate_override(Some("./data")), None);
    }
}

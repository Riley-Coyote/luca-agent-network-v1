//! Which build is this? — the bundle identity, exposed to the frontend.
//!
//! The development bundle (`com.luca.agent-network.dev`) and the beta bundle
//! (`chat.polyphonic.desktop`) render the same UI, which makes them easy to
//! confuse on a machine that has both installed. Dev-identified builds carry a
//! visible `DEV` mark; release builds carry nothing.
//!
//! The discriminator is the Tauri bundle identifier, not a cargo `debug_assertions`
//! check: the Dev app is a `--debug` bundle today, but the mark must follow the
//! *identity* of the bundle (what macOS installed and what data dir it owns),
//! not how it happened to be compiled.

use serde::Serialize;
use tauri::AppHandle;

/// Identifier suffix that marks a development bundle.
const DEV_IDENTIFIER_SUFFIX: &str = ".dev";

/// True when `identifier` names a development bundle — i.e. it ends in `.dev`.
///
/// `com.luca.agent-network.dev` → true. The release identities
/// (`com.luca.agent-network`, `chat.polyphonic.desktop`) → false.
pub(crate) fn is_dev_identifier(identifier: &str) -> bool {
    identifier.ends_with(DEV_IDENTIFIER_SUFFIX)
}

/// The running bundle's identity, as the frontend sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildIdentity {
    /// The Tauri bundle identifier this build was bundled with.
    pub identifier: String,
    /// Whether this build should show the `DEV` mark.
    pub is_dev: bool,
}

/// Report the running bundle's identity to the frontend.
#[tauri::command]
pub fn get_build_identity(app: AppHandle) -> BuildIdentity {
    let identifier = app.config().identifier.clone();
    let is_dev = is_dev_identifier(&identifier);
    BuildIdentity { identifier, is_dev }
}

#[cfg(test)]
mod tests {
    use super::is_dev_identifier;

    #[test]
    fn dev_bundle_identifier_is_dev() {
        assert!(is_dev_identifier("com.luca.agent-network.dev"));
    }

    #[test]
    fn release_identifiers_are_not_dev() {
        assert!(!is_dev_identifier("com.luca.agent-network"));
        assert!(!is_dev_identifier("chat.polyphonic.desktop"));
        assert!(!is_dev_identifier("xyz.block.buzz.app"));
    }

    #[test]
    fn dev_must_be_the_final_segment() {
        // A `.dev` in the middle, or a segment that merely starts with "dev",
        // is a release identity.
        assert!(!is_dev_identifier("com.luca.dev.agent-network"));
        assert!(!is_dev_identifier("com.luca.agent-network.developer"));
        assert!(!is_dev_identifier("chat.polyphonic.desktop.beta"));
    }

    #[test]
    fn empty_identifier_is_not_dev() {
        assert!(!is_dev_identifier(""));
    }
}

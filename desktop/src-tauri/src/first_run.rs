//! Whether this launch belongs to a brand-new owner, and how the webview
//! learns it before it paints.
//!
//! The native half has always known this — the card-sized first-run window
//! depends on it. The web half could not, and that was a bug worth a module:
//! the webview keys `localStorage` by bundle id, not by data directory, so a
//! fresh `BUZZ_DESKTOP_DATA_DIR`, a reinstall, or a second profile on a Mac
//! that already had one all open holding the *previous* owner's `buzz-theme`.
//! The shipped default (Vitesse Black) never applies, because storage is not
//! empty. A new owner should always open in the appearance the product ships.
//!
//! The answer reaches the webview two ways, and both are needed:
//!
//! 1. [`init_script`] — a plugin init script, which Tauri injects before the
//!    document is parsed and before any script the document includes. This is
//!    the only channel early enough for the pre-paint seed in `index.html`, so
//!    a first run never flashes the old owner's background. It is also why the
//!    answer is computed *before* the builder is assembled: plugins are
//!    registered before `Builder::build`, and the config-declared main window
//!    is created before the `setup` hook ever runs, so there is no later hook
//!    that would still beat the first paint.
//! 2. [`is_first_run`] — the command, which reads the store fresh on every
//!    call. The init script's value is baked once at launch and never updated,
//!    so a page that loads later in the same run (a pop-out, a reload) still
//!    receives the answer from startup. The web half therefore paints from the
//!    global but only ever *writes* on this command's answer, so an owner who
//!    finishes onboarding mid-run cannot have the theme they just chose reset
//!    by a stale `true`. See `firstRunTheme.ts`.
//!
//! Both answers are deliberately conservative in the same direction: an
//! install whose onboarding status cannot be read is NOT a first run. Every
//! departure keyed on this — the card-sized window, the hidden stoplights, and
//! now resetting an appearance choice — is a departure from how the app opens
//! for its owner, and only a confirmed answer is worth making one on. The cost
//! of guessing wrong the safe way is the old bug; the cost of guessing wrong
//! the other way is wiping a theme someone chose.

use tauri::AppHandle;

use crate::data_dir::app_data_dir_before_app;
use crate::luca::resident_capability_authority;
use crate::managed_agents::storage::MANAGED_AGENTS_DIR;

/// The webview global the answer arrives on.
///
/// `desktop/index.html` and `src/shared/theme/firstRunTheme.ts` both spell this
/// out — the inline seed runs before any module and can import nothing — so the
/// three have to be renamed together.
pub(crate) const FIRST_RUN_GLOBAL: &str = "__BUZZ_FIRST_RUN__";

/// A stranger's first launch: no owner has completed onboarding.
pub(crate) fn is_confirmed_first_run(app: &AppHandle) -> bool {
    confirmed(resident_capability_authority::any_owner_completed_onboarding(app))
}

/// The same question asked while the Tauri builder is still being assembled.
///
/// `identifier` is the bundle identifier from the generated context, which is
/// how [`app_data_dir_before_app`] lands on the directory the running app will
/// use. A data directory that cannot be resolved at all is treated exactly like
/// an unreadable store: a returning owner.
pub(crate) fn is_confirmed_first_run_before_app(identifier: &str) -> bool {
    let Some(data_dir) = app_data_dir_before_app(identifier) else {
        luca_log!(
            info,
            "buzz-desktop: app data directory is unresolvable before startup; opening as a returning owner"
        );
        return false;
    };
    confirmed(
        resident_capability_authority::any_owner_completed_onboarding_in(
            &data_dir.join(MANAGED_AGENTS_DIR),
        ),
    )
}

fn confirmed(completed: Result<bool, String>) -> bool {
    match completed {
        Ok(completed) => !completed,
        Err(_) => {
            luca_log!(
                info,
                "buzz-desktop: onboarding status is unavailable; opening as a returning owner"
            );
            false
        }
    }
}

/// The plugin init script that publishes the answer to every webview.
///
/// Tauri wraps an init script in its own function scope, so the value has to be
/// assigned onto `window` to be visible to the document's own scripts. `true`
/// and `false` are the only things ever interpolated here.
pub(crate) fn init_script(first_run: bool) -> String {
    format!("window.{FIRST_RUN_GLOBAL} = {first_run};")
}

/// The first-run answer, read fresh from the store on every call.
///
/// This, not the init script's global, is what the web half writes storage on.
/// The global is baked at launch and cannot change afterwards; this can, and an
/// owner completing onboarding mid-run flips it to `false` immediately. That
/// difference is the whole reason the command exists alongside the script.
#[tauri::command]
pub fn is_first_run(app: AppHandle) -> bool {
    is_confirmed_first_run(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_init_script_assigns_a_bare_boolean_onto_window() {
        assert_eq!(init_script(true), "window.__BUZZ_FIRST_RUN__ = true;");
        assert_eq!(init_script(false), "window.__BUZZ_FIRST_RUN__ = false;");
    }

    /// The web half compares with `=== true`, so anything but a real boolean
    /// literal silently reads as "returning owner" and the reset never fires.
    #[test]
    fn the_init_script_never_quotes_the_answer() {
        for script in [init_script(true), init_script(false)] {
            assert!(!script.contains('"'), "{script}");
            assert!(!script.contains('\''), "{script}");
        }
    }
}

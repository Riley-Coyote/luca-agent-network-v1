//! The rail and the frame in Apple's real glass.
//!
//! The Swift side (`native/glass/`) draws Apple's glass beneath the transparent
//! page, and the page reports where it goes (`app/shell/shellGlass.ts`, and
//! `NativeRailGlass.tsx` outside the shell). Every macOS build carries it
//! (`build.rs`), and it attaches on its own: the Swift side declines before
//! macOS 26, where the page draws its frosted fallback instead. A launch whose
//! environment sets `LUCA_NATIVE_RAIL_GLASS=0` leaves it out, for testing.
//! The plan: docs/luca/native-rail-glass/PLAN.md.

/// The environment switch that leaves the glass out of one launch.
#[cfg(target_os = "macos")]
const SWITCH: &str = "LUCA_NATIVE_RAIL_GLASS";

/// Whether a launch attaches the glass, given its `LUCA_NATIVE_RAIL_GLASS`:
/// always, unless it is `0`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn wanted(setting: Option<&str>) -> bool {
    setting.map(str::trim) != Some("0")
}

/// Puts the glass behind the main window's page. Best-effort: without it the
/// page draws its own frame and rail.
pub fn attach<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    #[cfg(target_os = "macos")]
    {
        let label = webview.label().to_owned();
        if !wanted(std::env::var(SWITCH).ok().as_deref()) {
            luca_log!(info, "native-glass: left out of {label} ({SWITCH}=0)");
            return;
        }
        let reached = webview.with_webview(move |platform| {
            // SAFETY: `with_webview` runs this on the main thread with this
            // webview's live WKWebView and NSWindow; the Swift side keeps
            // neither pointer, only the views they point to, through AppKit.
            let attached =
                unsafe { polyphonic_glass_attach(platform.ns_window(), platform.inner()) };
            if attached {
                luca_log!(info, "native-glass: attached behind {label}");
            } else {
                luca_log!(
                    info,
                    "native-glass: unavailable for {label} (macOS 26 or later)"
                );
            }
        });
        if let Err(error) = reached {
            luca_log!(warn, "native-glass: could not reach the web view: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = webview;
}

#[cfg(target_os = "macos")]
extern "C" {
    /// `native/glass/PolyphonicGlass.swift`: false before macOS 26, or without
    /// a web view in a window.
    fn polyphonic_glass_attach(
        window: *mut std::ffi::c_void,
        web_view: *mut std::ffi::c_void,
    ) -> bool;
}

#[cfg(test)]
mod tests {
    use super::wanted;

    #[test]
    fn the_glass_attaches_without_being_asked() {
        assert!(wanted(None));
        assert!(wanted(Some("")));
        assert!(wanted(Some("1")));
    }

    #[test]
    fn zero_leaves_the_glass_out() {
        assert!(!wanted(Some("0")));
        assert!(!wanted(Some(" 0\n")));
    }
}

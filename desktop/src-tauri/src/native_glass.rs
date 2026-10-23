//! The rail in Apple's real glass, for native test builds.
//!
//! The Swift side (`native/glass/`) draws the conversation card and the rail's
//! selection as Apple's glass beneath the transparent page, and the page
//! reports where they are (`NativeRailGlass.tsx`). It is compiled in only when
//! the build sets `LUCA_BUILD_NATIVE_GLASS=1` (the rail-glass candidate), and
//! it attaches only when the app's own environment carries
//! `LUCA_NATIVE_RAIL_GLASS=1` and the system is macOS 26 or later. Shipped
//! builds have neither. The plan: docs/luca/native-rail-glass/PLAN.md.

/// Puts the glass behind the main window's page when this build and this
/// launch both carry it. Best-effort: without it the page keeps drawing its
/// own rail and card.
pub fn attach<R: tauri::Runtime>(webview: &tauri::Webview<R>) {
    #[cfg(all(target_os = "macos", native_glass))]
    {
        if std::env::var("LUCA_NATIVE_RAIL_GLASS").as_deref() != Ok("1") {
            return;
        }
        let label = webview.label().to_owned();
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
    #[cfg(not(all(target_os = "macos", native_glass)))]
    let _ = webview;
}

#[cfg(all(target_os = "macos", native_glass))]
extern "C" {
    /// `native/glass/PolyphonicGlass.swift`: false before macOS 26, or without
    /// a web view in a window.
    fn polyphonic_glass_attach(
        window: *mut std::ffi::c_void,
        web_view: *mut std::ffi::c_void,
    ) -> bool;
}

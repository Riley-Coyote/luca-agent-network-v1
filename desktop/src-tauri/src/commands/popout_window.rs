//! Native pop-out chat windows.
//!
//! A pop-out is one conversation in its own window: no rail, no sidebar, sized
//! for an overlay rather than a workspace. It is a second webview on the same
//! bundle — `index.html?window=popout&channel=<id>#/channels/<id>` — so the
//! shipped channel route renders inside it unmodified.
//!
//! What lives here is the window half of that: the label a pop-out is known by,
//! the de-duplication that turns a second request into a focus, and the reveal
//! handshake that keeps an unpainted frame off the screen.

use std::fmt::Write as _;
use std::time::Duration;

use tauri::{Listener, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_window_state::{StateFlags, WindowExt};

/// Prefix every pop-out window label carries.
///
/// `capabilities/popout.json` scopes its grants to `popout-*`, so the prefix is
/// the security boundary between these windows and the main one — not a naming
/// convention.
pub const POPOUT_LABEL_PREFIX: &str = "popout-";

/// Opening size. Narrow enough to sit beside another app, tall enough to hold a
/// real exchange.
const POPOUT_WIDTH_PX: f64 = 380.0;
const POPOUT_HEIGHT_PX: f64 = 560.0;
/// Below this the composer and the timeline stop being usable together.
const POPOUT_MIN_WIDTH_PX: f64 = 320.0;
const POPOUT_MIN_HEIGHT_PX: f64 = 400.0;

/// Traffic lights sit inside the pop-out's own drag strip, which is shorter
/// than the main window's title area.
#[cfg(target_os = "macos")]
const POPOUT_TRAFFIC_LIGHT_X_PX: f64 = 12.0;
#[cfg(target_os = "macos")]
const POPOUT_TRAFFIC_LIGHT_Y_PX: f64 = 13.0;

/// How long the reveal waits for the pop-out to report a painted frame before
/// showing it anyway. A window that never arrives is worse than one that
/// arrives a beat early.
const POPOUT_REVEAL_TIMEOUT: Duration = Duration::from_secs(4);

/// Opaque native backing held across the first visible frames so the window
/// behind cannot show through a transparent-capable window before WebKit has
/// submitted a surface. Mirrors the main window's anti-flash recipe in
/// `lib.rs`; the webview paints its own themed background moments later.
#[cfg(target_os = "macos")]
const POPOUT_BACKING_COLOR: tauri::window::Color = tauri::window::Color(17, 21, 24, 255);

/// Geometry restore mirrors the main window's flags: everything except
/// visibility, which the reveal below owns.
fn popout_restore_flags() -> StateFlags {
    StateFlags::all() & !StateFlags::VISIBLE
}

/// The event a pop-out emits once React has committed its first frame.
fn popout_render_ready_event(label: &str) -> String {
    format!("popout-render-ready:{label}")
}

/// Percent-encode one URL component, keeping only the RFC 3986 unreserved set.
///
/// Channel ids are relay UUIDs in practice, but the id reaches the pop-out
/// through both a query parameter and the route hash, and neither may be
/// allowed to carry a raw `&`, `#` or space into the URL.
fn encode_url_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(char::from(*byte));
            }
            _ => {
                // Writing into a String is infallible.
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}

/// The in-bundle URL a pop-out loads.
///
/// The query tells the bootstrap which shell to mount; the hash is the shipped
/// channel route, so the conversation itself needs no pop-out-specific routing.
fn popout_url(channel_id: &str) -> String {
    let encoded = encode_url_component(channel_id);
    format!("index.html?window=popout&channel={encoded}#/channels/{encoded}")
}

/// Map a channel id onto the character set a window label may use.
///
/// Tauri restricts labels to alphanumerics plus `-`, `/`, `:` and `_`. A relay
/// channel id is already inside that set; this only guards ids from anywhere
/// else. The mapping is one character in, one character out, so two ids that
/// differ in an accepted character keep distinct labels. `None` means nothing
/// usable survived.
fn sanitize_channel_label_segment(channel_id: &str) -> Option<String> {
    let sanitized: String = channel_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.chars().any(|character| character.is_ascii_alphanumeric()) {
        Some(sanitized)
    } else {
        None
    }
}

/// The label the pop-out for `channel_id` is known by.
fn popout_label(channel_id: &str) -> Option<String> {
    sanitize_channel_label_segment(channel_id)
        .map(|segment| format!("{POPOUT_LABEL_PREFIX}{segment}"))
}

/// What opening a pop-out should actually do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PopoutAction {
    /// A window already carries this label — show and focus it instead of
    /// building a second one for the same conversation.
    Reveal,
    /// Nothing carries this label yet.
    Create,
}

/// The label and the action for one open request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PopoutPlan {
    pub label: String,
    pub action: PopoutAction,
}

/// Decide what to do about a pop-out request, given the labels already live.
///
/// Split out from the command so the label and de-duplication rules are
/// testable without a window server.
pub(crate) fn plan_popout(channel_id: &str, live_labels: &[String]) -> Result<PopoutPlan, String> {
    let label = popout_label(channel_id)
        .ok_or_else(|| "a pop-out needs a conversation id".to_string())?;
    let action = if live_labels.iter().any(|live| live == &label) {
        PopoutAction::Reveal
    } else {
        PopoutAction::Create
    };
    Ok(PopoutPlan { label, action })
}

/// Bring a pop-out to the front. Used both for de-duplication and for the
/// first reveal.
fn reveal_popout_window(window: &tauri::WebviewWindow) {
    if let Err(error) = window.show() {
        eprintln!("luca-popout: failed to reveal {}: {error}", window.label());
        return;
    }
    if let Err(error) = window.set_focus() {
        eprintln!("luca-popout: failed to focus {}: {error}", window.label());
    }
}

#[cfg(target_os = "macos")]
fn set_popout_backing(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_background_color(Some(POPOUT_BACKING_COLOR)) {
        eprintln!(
            "luca-popout: failed to set initial backing for {}: {error}",
            window.label()
        );
    }
}

#[cfg(target_os = "macos")]
async fn clear_popout_backing(window: &tauri::WebviewWindow) {
    tokio::time::sleep(Duration::from_millis(250)).await;
    if let Err(error) = window.set_background_color(None) {
        eprintln!(
            "luca-popout: failed to clear initial backing for {}: {error}",
            window.label()
        );
    }
}

/// Open the pop-out chat window for one conversation, or focus the one that is
/// already open for it.
///
/// Returns the window label so the caller can address the window later.
#[tauri::command]
pub async fn open_channel_popout(
    app_handle: tauri::AppHandle,
    channel_id: String,
    title: Option<String>,
) -> Result<String, String> {
    let live_labels: Vec<String> = app_handle.webview_windows().keys().cloned().collect();
    let plan = plan_popout(&channel_id, &live_labels)?;

    if plan.action == PopoutAction::Reveal {
        // The label was live a moment ago; if the window closed in between,
        // fall through and build a fresh one rather than failing the request.
        if let Some(window) = app_handle.get_webview_window(&plan.label) {
            reveal_popout_window(&window);
            return Ok(plan.label);
        }
    }

    // Registered before the window exists: the webview cannot report a painted
    // frame to a listener that is not there yet, and losing that race would
    // hold the window hidden until the fallback timeout instead of showing it
    // the moment it is ready.
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    app_handle.once(popout_render_ready_event(&plan.label), move |_| {
        let _ = ready_tx.send(());
    });

    let builder = WebviewWindowBuilder::new(
        &app_handle,
        plan.label.clone(),
        WebviewUrl::App(popout_url(&channel_id).into()),
    )
    .title(title.unwrap_or_default())
    .inner_size(POPOUT_WIDTH_PX, POPOUT_HEIGHT_PX)
    .min_inner_size(POPOUT_MIN_WIDTH_PX, POPOUT_MIN_HEIGHT_PX)
    .resizable(true)
    .always_on_top(false)
    // Revealed by the handshake below, never by the window server.
    .visible(false)
    // M1 paints an opaque surface on a transparent-capable window: a window
    // cannot become transparent after creation, so the capability has to be
    // claimed now even though the material stays opaque until M2 rules on it.
    .transparent(true)
    // An overlay chat that stops receiving while unfocused is not an overlay.
    .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(
            POPOUT_TRAFFIC_LIGHT_X_PX,
            POPOUT_TRAFFIC_LIGHT_Y_PX,
        ));

    let window = builder
        .build()
        .map_err(|error| format!("failed to open the pop-out window: {error}"))?;

    #[cfg(target_os = "macos")]
    set_popout_backing(&window);

    // Window state is keyed by label, so each conversation's pop-out keeps its
    // own geometry for free. The window-state plugin also restores on
    // window-ready; this call is the ordering guarantee that geometry has
    // landed before the reveal below, rather than a frame after it.
    if let Err(error) = window.restore_state(popout_restore_flags()) {
        eprintln!(
            "luca-popout: failed to restore geometry for {}: {error}",
            plan.label
        );
    }

    let reveal_label = plan.label.clone();
    tauri::async_runtime::spawn(async move {
        if tokio::time::timeout(POPOUT_REVEAL_TIMEOUT, ready_rx)
            .await
            .is_err()
        {
            eprintln!("luca-popout: {reveal_label} did not paint before the reveal timeout");
        }

        reveal_popout_window(&window);

        #[cfg(target_os = "macos")]
        clear_popout_backing(&window).await;
    });

    Ok(plan.label)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHANNEL_UUID: &str = "5f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

    #[test]
    fn relay_channel_ids_reach_the_label_untouched() {
        assert_eq!(
            popout_label(CHANNEL_UUID).as_deref(),
            Some("popout-5f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8")
        );
    }

    #[test]
    fn rejected_characters_become_underscores_one_for_one() {
        let sanitized =
            sanitize_channel_label_segment("general room/2!").expect("an id with letters survives");
        assert_eq!(sanitized, "general_room_2_");
        assert_eq!(sanitized.chars().count(), "general room/2!".chars().count());
    }

    #[test]
    fn ids_that_differ_keep_labels_that_differ() {
        assert_ne!(popout_label("room-a"), popout_label("room-b"));
        assert_ne!(popout_label("room a"), popout_label("rooma"));
    }

    #[test]
    fn an_id_with_nothing_usable_is_not_a_window() {
        assert_eq!(popout_label(""), None);
        assert_eq!(popout_label("   "), None);
        assert_eq!(popout_label("///"), None);
        assert!(plan_popout("", &[]).is_err());
    }

    #[test]
    fn every_label_sits_inside_the_capability_scope() {
        // `capabilities/popout.json` scopes its grants to `popout-*`; a label
        // that escaped the prefix would silently get the main window's rights.
        let label = popout_label(CHANNEL_UUID).expect("a uuid yields a label");
        assert!(label.starts_with(POPOUT_LABEL_PREFIX));
        assert!(!"main".starts_with(POPOUT_LABEL_PREFIX));
    }

    #[test]
    fn a_second_request_for_a_live_conversation_reveals_instead_of_creating() {
        let label = popout_label(CHANNEL_UUID).expect("a uuid yields a label");
        let live = vec!["main".to_string(), label.clone()];

        let plan = plan_popout(CHANNEL_UUID, &live).expect("a uuid plans");
        assert_eq!(
            plan,
            PopoutPlan {
                label,
                action: PopoutAction::Reveal,
            }
        );
    }

    #[test]
    fn a_conversation_without_a_window_is_created() {
        let live = vec!["main".to_string(), "popout-other".to_string()];
        let plan = plan_popout(CHANNEL_UUID, &live).expect("a uuid plans");
        assert_eq!(plan.action, PopoutAction::Create);
    }

    #[test]
    fn the_url_carries_the_channel_in_both_the_query_and_the_route() {
        assert_eq!(
            popout_url(CHANNEL_UUID),
            format!("index.html?window=popout&channel={CHANNEL_UUID}#/channels/{CHANNEL_UUID}")
        );
    }

    #[test]
    fn url_components_cannot_smuggle_separators() {
        assert_eq!(encode_url_component("a&b#c d"), "a%26b%23c%20d");
        assert!(!popout_url("a&window=main").contains("&window=main"));
    }

    #[test]
    fn the_reveal_event_is_scoped_to_one_window() {
        assert_eq!(
            popout_render_ready_event("popout-abc"),
            "popout-render-ready:popout-abc"
        );
    }

    #[test]
    fn geometry_restores_without_revealing() {
        let flags = popout_restore_flags();
        assert!(flags.contains(StateFlags::SIZE));
        assert!(flags.contains(StateFlags::POSITION));
        assert!(!flags.contains(StateFlags::VISIBLE));
    }
}

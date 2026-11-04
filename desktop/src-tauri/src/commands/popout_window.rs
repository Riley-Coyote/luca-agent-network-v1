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

use std::collections::HashMap;
use std::fmt::Write as _;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use tauri::{Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

/// Prefix every pop-out window label carries.
///
/// `capabilities/popout.json` scopes its grants to `popout-*`, so the prefix is
/// the security boundary between these windows and the main one — not a naming
/// convention.
pub const POPOUT_LABEL_PREFIX: &str = "popout-";

// Serialize only window creation, never message delivery. Concurrent receipt
// clicks must focus one webview rather than racing two builders for its label.
static OPEN_WINDOW: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static TASK_FOCUS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn close_correspondence_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("popout-correspondence-v1-") {
            let _ = window.close();
        }
    }
    if let Ok(mut focus) = TASK_FOCUS.lock() {
        focus.clear();
    }
}

fn emit_task_focus(window: &tauri::WebviewWindow) {
    let task = TASK_FOCUS
        .lock()
        .ok()
        .and_then(|focus| focus.get(window.label()).cloned());
    if let Some(task) = task {
        let _ = window.emit("luca://correspondence-focus", task);
    }
}

/// Opening size. Narrow enough to sit beside another app, tall enough to hold a
/// real exchange.
const POPOUT_WIDTH_PX: f64 = 380.0;
const POPOUT_HEIGHT_PX: f64 = 560.0;
/// Below this the composer and the timeline stop being usable together.
const POPOUT_MIN_WIDTH_PX: f64 = 320.0;
const POPOUT_MIN_HEIGHT_PX: f64 = 400.0;

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

    if sanitized
        .chars()
        .any(|character| character.is_ascii_alphanumeric())
    {
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
    let label =
        popout_label(channel_id).ok_or_else(|| "a pop-out needs a conversation id".to_string())?;
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
        luca_log!(
            warn,
            "luca-popout: failed to reveal {}: {error}",
            window.label()
        );
        return;
    }
    if let Err(error) = window.set_focus() {
        luca_log!(
            warn,
            "luca-popout: failed to focus {}: {error}",
            window.label()
        );
    }
}

#[cfg(target_os = "macos")]
fn set_popout_backing(window: &tauri::WebviewWindow) {
    if let Err(error) = window.set_background_color(Some(POPOUT_BACKING_COLOR)) {
        luca_log!(
            warn,
            "luca-popout: failed to set initial backing for {}: {error}",
            window.label()
        );
    }
}

#[cfg(target_os = "macos")]
async fn clear_popout_backing(window: &tauri::WebviewWindow) {
    tokio::time::sleep(Duration::from_millis(250)).await;
    if let Err(error) = window.set_background_color(None) {
        luca_log!(
            warn,
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
    open_popout(
        app_handle,
        channel_id.clone(),
        popout_url(&channel_id),
        title,
        None,
        None,
    )
    .await
}

/// A navigation target is not an execution request. The host resolves every
/// identifier using the current profile; callers cannot supply a source or owner.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ChatViewTarget {
    Channel {
        #[serde(rename = "channelId")]
        channel_id: String,
        title: Option<String>,
    },
    Correspondence {
        #[serde(rename = "exchangeId")]
        exchange_id: String,
    },
    RuntimeTask {
        #[serde(rename = "taskId")]
        task_id: String,
    },
}

#[tauri::command]
pub async fn open_chat_view(
    app_handle: tauri::AppHandle,
    target: ChatViewTarget,
) -> Result<Option<String>, String> {
    match target {
        ChatViewTarget::Channel { channel_id, title } => {
            use crate::luca::exchange_relay::{AppExchangeRelay, ExchangeRelay};
            let scope = crate::luca::agent_inbox::active_scope(&app_handle).await?;
            let source = luca_protocol::OpaqueId::parse(channel_id.clone())
                .map_err(|error| error.to_string())?;
            let app = app_handle.clone();
            let owner = scope.owner_pubkey.clone();
            tokio::task::spawn_blocking(move || {
                let members = AppExchangeRelay::new(app)
                    .conversation_members(&source)
                    .map_err(|error| error.to_string())?;
                members.contains(&owner).then_some(()).ok_or_else(|| {
                    "This conversation is not available in the current workspace".to_owned()
                })
            })
            .await
            .map_err(|error| error.to_string())??;
            let url = popout_url(&channel_id);
            open_popout(app_handle, channel_id, url, title, None, Some(scope))
                .await
                .map(Some)
        }
        ChatViewTarget::Correspondence { exchange_id } => {
            open_correspondence_popout(app_handle, exchange_id)
                .await
                .map(Some)
        }
        ChatViewTarget::RuntimeTask { task_id } => {
            // Existing runtime authority checks exact session support. This is
            // deliberately not a cloned transcript or an invented reply surface.
            super::runtime_tasks::open_runtime_task_native_session(app_handle, task_id)?;
            Ok(None)
        }
    }
}

/// Open a passive, authorized task view, reusing one window for the pair.
/// The caller supplies a task reference, never an authoritative owner/source.
#[tauri::command]
pub async fn open_correspondence_popout(
    app_handle: tauri::AppHandle,
    exchange_id: String,
) -> Result<String, String> {
    let scope = crate::luca::agent_inbox::active_scope(&app_handle).await?;
    let task_id = luca_protocol::Hex64::parse(exchange_id).map_err(|e| e.to_string())?;
    let page = crate::luca::agent_inbox::query_for_actor(
        &app_handle,
        scope.owner_pubkey.clone(),
        crate::luca::agent_inbox::InboxQuery {
            exchange_id: Some(task_id.clone()),
            ..Default::default()
        },
    )
    .await?;
    let task = page
        .tasks
        .first()
        .ok_or("This task is not available in the current workspace")?;
    if page.scope != scope || crate::luca::agent_inbox::active_scope(&app_handle).await? != scope {
        return Err("The active workspace changed; open the task again".into());
    }
    let pair = task
        .correspondence_id
        .as_ref()
        .ok_or("Group exchanges remain in their source conversation")?;
    let url = format!(
        "index.html?window=popout&correspondence={}&task={}#/",
        encode_url_component(pair),
        encode_url_component(task_id.as_str()),
    );
    open_popout(
        app_handle,
        pair.clone(),
        url,
        Some("Agent correspondence".into()),
        Some(task_id.as_str().to_owned()),
        Some(scope),
    )
    .await
}

async fn open_popout(
    app_handle: tauri::AppHandle,
    channel_id: String,
    url: String,
    title: Option<String>,
    task_focus: Option<String>,
    expected_scope: Option<crate::luca::agent_inbox::InboxScope>,
) -> Result<String, String> {
    let _opening = OPEN_WINDOW.lock().await;
    if let Some(expected) = &expected_scope {
        if crate::luca::agent_inbox::active_scope(&app_handle).await? != *expected {
            return Err("The active workspace changed; open the task again".into());
        }
    }
    let live_labels: Vec<String> = app_handle.webview_windows().keys().cloned().collect();
    let plan = plan_popout(&channel_id, &live_labels)?;
    let is_correspondence = task_focus.is_some();
    if let Some(task) = task_focus {
        TASK_FOCUS
            .lock()
            .map_err(|e| e.to_string())?
            .insert(plan.label.clone(), task);
    }

    if plan.action == PopoutAction::Reveal {
        // The label was live a moment ago; if the window closed in between,
        // fall through and build a fresh one rather than failing the request.
        if let Some(window) = app_handle.get_webview_window(&plan.label) {
            emit_task_focus(&window);
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

    let builder =
        WebviewWindowBuilder::new(&app_handle, plan.label.clone(), WebviewUrl::App(url.into()))
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

    // `Overlay` + `hidden_title` stay: they are what give the window native
    // resize edges, shadow and corner radius while leaving the title band to
    // the web side. The stoplights themselves are hidden after the build —
    // see `set_traffic_lights_hidden`.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let window = builder
        .build()
        .map_err(|error| format!("failed to open the pop-out window: {error}"))?;
    if let Some(expected) = &expected_scope {
        if crate::luca::agent_inbox::active_scope(&app_handle)
            .await
            .as_ref()
            != Ok(expected)
        {
            let _ = window.close();
            return Err("The active workspace changed while opening the task".into());
        }
    }

    // A new task window opens beside the main app where space permits. Keep
    // it inside the same display's usable area, including negative origins.
    if is_correspondence && !crate::has_saved_window_state(&app_handle, &plan.label) {
        if let Some(main) = app_handle.get_webview_window("main") {
            if let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
                main.current_monitor(),
                main.outer_position(),
                main.outer_size(),
            ) {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                let (x, y) = beside_position(
                    (position.x as f64, position.y as f64, size.width as f64),
                    (
                        area.position.x as f64,
                        area.position.y as f64,
                        area.size.width as f64,
                        area.size.height as f64,
                    ),
                    (POPOUT_WIDTH_PX * scale, POPOUT_HEIGHT_PX * scale),
                    12.0 * scale,
                );
                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            }
        }
    }
    if is_correspondence {
        let label = plan.label.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut focus) = TASK_FOCUS.lock() {
                    focus.remove(&label);
                }
            }
        });
    }

    #[cfg(target_os = "macos")]
    set_popout_backing(&window);

    // One bar, one set of controls, one hairline. The pop-out draws its own
    // minimise and close, so the native cluster goes; and AppKit's title-bar
    // separator would land a pixel under the bar's own border, which is a
    // second line the web side cannot reach. Both are shared with the main
    // window — see `window_chrome`.
    #[cfg(target_os = "macos")]
    {
        let ns_window = window.as_ref().window();
        super::window_chrome::set_traffic_lights_hidden(&ns_window, true);
        super::window_chrome::set_titlebar_separator_hidden(&ns_window, true);
    }

    // Window state is keyed by label, so each conversation's pop-out keeps
    // its own geometry for free: the window-state plugin restores every
    // non-denylisted label in its own window-created hook, on the main
    // thread, before the reveal below can run. Do NOT also call
    // `restore_state` here — the plugin's hook and a second caller take the
    // state mutex and the main thread in opposite orders, and the first live
    // pop-out deadlocked the entire app exactly that way (2026-08-27).

    let reveal_label = plan.label.clone();
    tauri::async_runtime::spawn(async move {
        if tokio::time::timeout(POPOUT_REVEAL_TIMEOUT, ready_rx)
            .await
            .is_err()
        {
            luca_log!(
                info,
                "luca-popout: {reveal_label} did not paint before the reveal timeout"
            );
        }

        if let Some(expected) = &expected_scope {
            if crate::luca::agent_inbox::active_scope(&app_handle)
                .await
                .as_ref()
                != Ok(expected)
            {
                let _ = window.close();
                return;
            }
        }

        // Re-emit the latest selection after React's listener is mounted. A
        // second click during cold creation must not be lost before that.
        emit_task_focus(&window);
        reveal_popout_window(&window);

        #[cfg(target_os = "macos")]
        clear_popout_backing(&window).await;
    });

    Ok(plan.label)
}

fn beside_position(
    main: (f64, f64, f64),
    area: (f64, f64, f64, f64),
    size: (f64, f64),
    gap: f64,
) -> (i32, i32) {
    let right = main.0 + main.2 + gap;
    let x = if right + size.0 <= area.0 + area.2 {
        right
    } else {
        main.0 + gap
    };
    (
        x.clamp(area.0, (area.0 + area.2 - size.0).max(area.0))
            .round() as i32,
        main.1
            .clamp(area.1, (area.1 + area.3 - size.1).max(area.1))
            .round() as i32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHANNEL_UUID: &str = "5f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

    #[test]
    fn view_target_rejects_caller_supplied_authority() {
        assert!(serde_json::from_value::<ChatViewTarget>(serde_json::json!({
            "kind": "correspondence", "exchangeId": "a".repeat(64),
        }))
        .is_ok());
        assert!(serde_json::from_value::<ChatViewTarget>(serde_json::json!({
            "kind": "correspondence", "exchangeId": "a".repeat(64), "owner": "b".repeat(64),
        }))
        .is_err());
        assert!(serde_json::from_value::<ChatViewTarget>(serde_json::json!({
            "kind": "runtimeTask", "taskId": "task-1", "providerSessionId": "unverified",
        }))
        .is_err());
    }

    #[test]
    fn correspondence_placement_stays_on_the_current_display() {
        assert_eq!(
            beside_position(
                (100.0, 100.0, 800.0),
                (0.0, 0.0, 1440.0, 900.0),
                (380.0, 560.0),
                12.0
            ),
            (912, 100)
        );
        assert_eq!(
            beside_position(
                (-1400.0, 700.0, 1200.0),
                (-1440.0, 0.0, 1440.0, 900.0),
                (380.0, 560.0),
                12.0
            ),
            (-1388, 340)
        );
        assert_eq!(
            beside_position(
                (1000.0, 500.0, 400.0),
                (0.0, 0.0, 320.0, 400.0),
                (380.0, 560.0),
                12.0
            ),
            (0, 0)
        );
    }

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
}

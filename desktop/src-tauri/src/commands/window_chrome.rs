use std::{collections::HashMap, sync::Mutex, sync::OnceLock};

use serde::Serialize;

const DEFAULT_ARTIFACT_CANVAS_WIDTH_PX: f64 = 680.0;
const MIN_ARTIFACT_CANVAS_WIDTH_PX: f64 = 420.0;
const MAX_ARTIFACT_CANVAS_WIDTH_PX: f64 = 960.0;
const MIN_CONTAINED_WINDOW_WIDTH_PX: f64 = 1_100.0;
const GEOMETRY_MATCH_TOLERANCE_PX: i64 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
/// Layout mode selected for the artifact Canvas at the current monitor size.
pub enum ArtifactCanvasWindowMode {
    /// The native window grew enough to preserve the existing conversation width.
    Expanded,
    /// Canvas shares the existing window because the preferred growth did not fit.
    Contained,
    /// Canvas should take focus because the available window is too narrow for two panes.
    Focus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
/// Result returned to the frontend after applying Canvas window geometry.
pub struct ArtifactCanvasWindowResult {
    /// Presentation mode the frontend should render.
    pub mode: ArtifactCanvasWindowMode,
    /// Whether this call changed the native window geometry.
    pub changed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CanvasWindowSnapshot {
    original: WindowRect,
    expanded: WindowRect,
    mode: ArtifactCanvasWindowMode,
}

static ARTIFACT_CANVAS_WINDOWS: OnceLock<Mutex<HashMap<String, CanvasWindowSnapshot>>> =
    OnceLock::new();

fn canvas_window_snapshots() -> &'static Mutex<HashMap<String, CanvasWindowSnapshot>> {
    ARTIFACT_CANVAS_WINDOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn classify_constrained_mode(width: u32, scale_factor: f64) -> ArtifactCanvasWindowMode {
    if f64::from(width) / scale_factor >= MIN_CONTAINED_WINDOW_WIDTH_PX {
        ArtifactCanvasWindowMode::Contained
    } else {
        ArtifactCanvasWindowMode::Focus
    }
}

fn plan_canvas_expansion(
    current: WindowRect,
    work_area: WindowRect,
    preferred_width: u32,
    scale_factor: f64,
) -> (WindowRect, ArtifactCanvasWindowMode) {
    let work_left = i64::from(work_area.x);
    let work_right = work_left + i64::from(work_area.width);
    let current_left = i64::from(current.x).max(work_left);
    let current_right = current_left + i64::from(current.width);
    let total_slack = i64::from(work_area.width).saturating_sub(i64::from(current.width));
    let growth = i64::from(preferred_width).min(total_slack).max(0);
    let right_slack = (work_right - current_right).max(0);
    let shift_left = (growth - right_slack).max(0);
    let next_left = (current_left - shift_left).max(work_left);
    let next_width = i64::from(current.width) + growth;
    let planned = WindowRect {
        x: i32::try_from(next_left).unwrap_or(current.x),
        y: current.y,
        width: u32::try_from(next_width).unwrap_or(current.width),
        height: current.height,
    };
    let mode = if growth >= i64::from(preferred_width) {
        ArtifactCanvasWindowMode::Expanded
    } else {
        classify_constrained_mode(planned.width, scale_factor)
    };
    (planned, mode)
}

fn geometry_matches(left: WindowRect, right: WindowRect) -> bool {
    i64::from(left.x).abs_diff(i64::from(right.x)) <= GEOMETRY_MATCH_TOLERANCE_PX as u64
        && i64::from(left.y).abs_diff(i64::from(right.y)) <= GEOMETRY_MATCH_TOLERANCE_PX as u64
        && i64::from(left.width).abs_diff(i64::from(right.width))
            <= GEOMETRY_MATCH_TOLERANCE_PX as u64
        && i64::from(left.height).abs_diff(i64::from(right.height))
            <= GEOMETRY_MATCH_TOLERANCE_PX as u64
}

fn read_window_rect(window: &tauri::Window) -> Result<WindowRect, String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn apply_window_rect(window: &tauri::Window, rect: WindowRect) -> Result<(), String> {
    window
        .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
        .map_err(|error| error.to_string())
}

/// Expands the primary app window for the artifact Canvas without exposing
/// general window mutation authority to the webview.
///
/// Expansion uses free space to the right first, then borrows only the minimum
/// space required from the left edge of the current monitor. Closing restores
/// the prior geometry only when the user has not moved or resized the expanded
/// window in the meantime.
#[tauri::command]
pub fn set_artifact_canvas_window_open(
    window: tauri::Window,
    open: bool,
    preferred_canvas_width_px: Option<f64>,
) -> Result<ArtifactCanvasWindowResult, String> {
    let label = window.label().to_owned();
    if !open {
        let snapshot = canvas_window_snapshots()
            .lock()
            .map_err(|_| "artifact Canvas window state is unavailable".to_string())?
            .remove(&label);
        let Some(snapshot) = snapshot else {
            return Ok(ArtifactCanvasWindowResult {
                mode: ArtifactCanvasWindowMode::Contained,
                changed: false,
            });
        };
        let current = read_window_rect(&window)?;
        if !geometry_matches(current, snapshot.expanded) {
            return Ok(ArtifactCanvasWindowResult {
                mode: snapshot.mode,
                changed: false,
            });
        }
        apply_window_rect(&window, snapshot.original)?;
        return Ok(ArtifactCanvasWindowResult {
            mode: snapshot.mode,
            changed: true,
        });
    }

    if let Some(snapshot) = canvas_window_snapshots()
        .lock()
        .map_err(|_| "artifact Canvas window state is unavailable".to_string())?
        .get(&label)
        .copied()
    {
        return Ok(ArtifactCanvasWindowResult {
            mode: snapshot.mode,
            changed: false,
        });
    }

    let current = read_window_rect(&window)?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(ArtifactCanvasWindowResult {
            mode: classify_constrained_mode(current.width, scale_factor),
            changed: false,
        });
    }
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "current monitor is unavailable".to_string())?;
    let work_area = monitor.work_area();
    let work_area = WindowRect {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
    };
    let preferred_logical = preferred_canvas_width_px
        .unwrap_or(DEFAULT_ARTIFACT_CANVAS_WIDTH_PX)
        .clamp(MIN_ARTIFACT_CANVAS_WIDTH_PX, MAX_ARTIFACT_CANVAS_WIDTH_PX);
    let preferred_physical = (preferred_logical * scale_factor).round();
    let preferred_physical = if preferred_physical.is_finite() && preferred_physical > 0.0 {
        preferred_physical.min(f64::from(u32::MAX)) as u32
    } else {
        (DEFAULT_ARTIFACT_CANVAS_WIDTH_PX * scale_factor).round() as u32
    };
    let (expanded, mode) =
        plan_canvas_expansion(current, work_area, preferred_physical, scale_factor);
    if expanded == current {
        return Ok(ArtifactCanvasWindowResult {
            mode,
            changed: false,
        });
    }
    apply_window_rect(&window, expanded)?;
    canvas_window_snapshots()
        .lock()
        .map_err(|_| "artifact Canvas window state is unavailable".to_string())?
        .insert(
            label,
            CanvasWindowSnapshot {
                original: current,
                expanded,
                mode,
            },
        );
    Ok(ArtifactCanvasWindowResult {
        mode,
        changed: true,
    })
}

/// Performs the platform's default sidebar alignment haptic when available.
#[tauri::command]
pub fn perform_sidebar_default_haptic() {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSHapticFeedbackManager, NSHapticFeedbackPattern, NSHapticFeedbackPerformanceTime,
            NSHapticFeedbackPerformer,
        };

        NSHapticFeedbackManager::defaultPerformer().performFeedbackPattern_performanceTime(
            NSHapticFeedbackPattern::Alignment,
            NSHapticFeedbackPerformanceTime::Now,
        );
    }
}

/// Performs the window action matching the macOS "double-click a window's
/// title bar to" preference (`AppleActionOnDoubleClick`).
///
/// macOS values are `Minimize`, `Maximize` (default when unset), `Fill`, or
/// `None`.
/// The desktop app uses a web-based title-bar drag region, so the frontend
/// forwards double-clicks here and suppresses Tauri's injected drag-region
/// handler, whose default macOS path hardcodes maximize.
///
/// For `Fill`, resize to the current monitor work area instead of using
/// Tauri's maximize path, which maps to macOS zoom for titled, resizable
/// windows.
///
/// On non-macOS platforms this always toggles maximize (the historical
/// behavior).
#[tauri::command]
pub fn title_bar_double_click(window: tauri::Window) {
    #[cfg(target_os = "macos")]
    {
        let action = {
            let output = std::process::Command::new("defaults")
                .args(["read", "-g", "AppleActionOnDoubleClick"])
                .output();
            match output {
                Ok(output) if output.status.success() => {
                    String::from_utf8_lossy(&output.stdout).trim().to_string()
                }
                _ => "Maximize".to_string(),
            }
        };

        match action.as_str() {
            "None" => {}
            "Minimize" => {
                let _ = window.minimize();
            }
            "Fill" => {
                fill_window(&window);
            }
            // "Maximize" or any unexpected value.
            _ => {
                toggle_maximize(&window);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        toggle_maximize(&window);
    }
}

/// Fills the current display work area, excluding system UI like the menu bar
/// and Dock.
#[cfg(target_os = "macos")]
fn fill_window(window: &tauri::Window) {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            if window.is_maximized().unwrap_or(false) {
                let _ = window.unmaximize();
            }

            let work_area = monitor.work_area();
            let _ = window.set_position(work_area.position);
            let _ = window.set_size(work_area.size);
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

/// Toggles the window between maximized and its previous size, matching the
/// historical double-click behavior.
fn toggle_maximize(window: &tauri::Window) {
    match window.is_maximized() {
        Ok(true) => {
            let _ = window.unmaximize();
        }
        _ => {
            let _ = window.maximize();
        }
    }
}

#[cfg(test)]
mod artifact_canvas_window_tests {
    use super::*;

    fn rect(x: i32, width: u32) -> WindowRect {
        WindowRect {
            x,
            y: 30,
            width,
            height: 800,
        }
    }

    #[test]
    fn expands_to_the_right_without_moving_when_space_is_available() {
        let (planned, mode) = plan_canvas_expansion(rect(40, 900), rect(0, 2_000), 680, 1.0);
        assert_eq!(planned, rect(40, 1_580));
        assert_eq!(mode, ArtifactCanvasWindowMode::Expanded);
    }

    #[test]
    fn shifts_left_only_for_the_missing_right_side_space() {
        let (planned, mode) = plan_canvas_expansion(rect(700, 900), rect(0, 2_000), 680, 1.0);
        assert_eq!(planned, rect(420, 1_580));
        assert_eq!(mode, ArtifactCanvasWindowMode::Expanded);
    }

    #[test]
    fn reports_contained_when_the_monitor_cannot_fit_the_preferred_canvas() {
        let (planned, mode) = plan_canvas_expansion(rect(100, 1_200), rect(0, 1_440), 680, 1.0);
        assert_eq!(planned, rect(0, 1_440));
        assert_eq!(mode, ArtifactCanvasWindowMode::Contained);
    }

    #[test]
    fn reports_focus_on_a_narrow_monitor() {
        let (planned, mode) = plan_canvas_expansion(rect(0, 760), rect(0, 900), 680, 1.0);
        assert_eq!(planned, rect(0, 900));
        assert_eq!(mode, ArtifactCanvasWindowMode::Focus);
    }
}

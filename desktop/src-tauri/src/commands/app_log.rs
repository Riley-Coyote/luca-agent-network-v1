//! The webview's end of the app log.
//!
//! `append_ui_log` is how a React error, an unhandled rejection, or a teed
//! `console.error` lands in the same `polyphonic.log` as the native lines, so a
//! bug report carries one ordered story instead of two halves.
//!
//! The command is rate-limited on purpose. A render loop that throws every
//! frame would otherwise turn a diagnostic into a denial of service against the
//! user's own disk; past the budget the log says how many lines were lost and
//! stays quiet until the next second.

use std::path::PathBuf;
use std::time::Instant;

use tauri::{AppHandle, Runtime};

use crate::data_dir::BuzzPathExt;
use crate::diag::{self, RateDecision};

/// Longest UI message kept. Stacks are trimmed to their first frames by the
/// frontend; this is the backstop against a megabyte of serialized state.
const MAX_UI_MESSAGE_CHARS: usize = 4000;

/// Append one line from the webview to the app log.
///
/// Never fails: a log that can refuse is a log the UI has to handle.
#[tauri::command]
pub fn append_ui_log(level: String, source: String, message: String) {
    let decision = match diag::ui_rate_limiter().lock() {
        Ok(mut limiter) => limiter.decide(Instant::now()),
        // A poisoned limiter should not silence the log it protects.
        Err(_) => RateDecision::Allow,
    };
    match decision {
        RateDecision::Drop => return,
        RateDecision::AllowAfterMarker(dropped) => {
            diag::emit_formatted(
                "warn",
                "ui",
                &format!("dropped {dropped} lines from the webview (rate limit)"),
            );
        }
        RateDecision::Allow => {}
    }

    let trimmed: String = message.chars().take(MAX_UI_MESSAGE_CHARS).collect();
    diag::emit_formatted(
        diag::normalize_level(&level),
        &diag::normalize_source(&source),
        &trimmed,
    );
}

/// Where the log file lives, so Settings can reveal it in the file manager.
#[tauri::command]
pub fn app_log_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(resolve_log_path(&app)?.to_string_lossy().into_owned())
}

/// The tail of the log.
///
/// `redact_paths` is the difference between a copy that stays on this Mac and
/// text that is about to be uploaded with a feedback report.
#[tauri::command]
pub fn read_recent_app_log<R: Runtime>(
    app: AppHandle<R>,
    redact_paths: bool,
) -> Result<String, String> {
    let path = resolve_log_path(&app)?;
    Ok(diag::read_recent_lines(
        &path,
        diag::RECENT_LINE_COUNT,
        redact_paths,
    ))
}

/// The path `diag` opened, or the one it would open.
fn resolve_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    if let Some(path) = diag::log_file_path() {
        return Ok(path.to_path_buf());
    }
    let data_dir = app
        .buzz_path()
        .app_data_dir()
        .map_err(|error| format!("app data directory is unavailable: {error}"))?;
    Ok(diag::logs_dir_for(&data_dir).join(diag::LOG_FILE_NAME))
}

//! One app log, on disk, that survives a launch from Finder.
//!
//! The desktop crate used to print several hundred `eprintln!` lines and keep
//! none of them: launched from the Dock there is no terminal attached, so every
//! line went to `/dev/null`. This module is the other half of that — the same
//! lines still reach stderr for `tauri dev`, and they are also appended to
//!
//! ```text
//! <app data dir>/logs/polyphonic.log
//! ```
//!
//! Shape of a line (one line per record, never wrapped):
//!
//! ```text
//! 2026-09-15T08:12:03.123Z warn buzz_lib::migration could not read the ledger: …
//! ```
//!
//! Three properties the rest of the app depends on:
//!
//! * **It never panics.** Every filesystem error is swallowed; a broken log is
//!   not worth taking the app down for.
//! * **It never blocks the caller on disk.** Formatting happens inline (cheap),
//!   the write happens on a dedicated thread behind a bounded queue. A full
//!   queue drops lines and records how many, rather than stalling the UI thread
//!   behind a stuck disk.
//! * **A secret never reaches the file.** Every line is run through
//!   `luca-diagnostics` for the `Secret` and `ProtectedBody` classes first. The
//!   log stays on this Mac, so absolute paths are kept — they are usually the
//!   most useful thing in the line. Anything that *leaves* the Mac goes through
//!   `luca_diagnostics::redact_diagnostic`, which also takes `AbsolutePath`.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use luca_diagnostics::SensitiveClass;

/// The one log file. Rotations are `polyphonic.log.1` … `polyphonic.log.3`.
pub(crate) const LOG_FILE_NAME: &str = "polyphonic.log";
/// Rotate once the active file would pass this size.
pub(crate) const MAX_LOG_BYTES: u64 = 5 * 1024 * 1024;
/// How many rotated files to keep alongside the active one.
pub(crate) const KEEP_ROTATIONS: usize = 3;
/// How many lines Settings and Send Feedback read back.
pub(crate) const RECENT_LINE_COUNT: usize = 200;
/// Bounded hand-off to the writer thread. Deep enough for a burst, shallow
/// enough that a wedged disk cannot grow it without bound.
const QUEUE_CAPACITY: usize = 2048;
/// Lines held before the data directory is known, then flushed in order.
const PREINIT_CAPACITY: usize = 256;
/// Ceiling on `append_ui_log`, per second.
pub(crate) const UI_LOG_LINES_PER_SECOND: u32 = 20;

/// Classes redacted out of a line before it is written locally.
const LOCAL_REDACTED_CLASSES: &[SensitiveClass] =
    &[SensitiveClass::Secret, SensitiveClass::ProtectedBody];

static SINK: OnceLock<SyncSender<String>> = OnceLock::new();
static PREINIT: Mutex<Vec<String>> = Mutex::new(Vec::new());
static DROPPED: AtomicU64 = AtomicU64::new(0);
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// `<app data dir>/logs`.
pub(crate) fn logs_dir_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs")
}

/// The active log file, once `init` has run.
pub(crate) fn log_file_path() -> Option<&'static Path> {
    LOG_PATH.get().map(PathBuf::as_path)
}

/// UTC, millisecond precision, `Z`-suffixed — the shape in every line.
fn timestamp_now() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Build one log line: flattened to a single line, then redacted.
///
/// Newlines inside a message are turned into spaces on purpose. A line-oriented
/// log that a caller can split with `\n` is worth more than the original
/// wrapping of a multi-line error.
pub(crate) fn format_line(timestamp: &str, level: &str, source: &str, message: &str) -> String {
    let flattened: String = message
        .chars()
        .map(|character| {
            if character == '\n' || character == '\r' {
                ' '
            } else {
                character
            }
        })
        .collect();
    let (redacted, _) =
        luca_diagnostics::redact_classes(flattened.trim_end(), LOCAL_REDACTED_CLASSES);
    format!("{timestamp} {level} {source} {redacted}")
}

/// The drop-in behind `luca_log!`: stderr now, disk shortly after.
pub(crate) fn emit(level: &str, source: &str, args: std::fmt::Arguments<'_>) {
    let line = format_line(&timestamp_now(), level, source, &args.to_string());
    eprintln!("{line}");
    enqueue(line);
}

/// Queue an already-formatted line for the writer thread.
fn enqueue(line: String) {
    if let Some(sender) = SINK.get() {
        if let Err(TrySendError::Full(_) | TrySendError::Disconnected(_)) = sender.try_send(line) {
            DROPPED.fetch_add(1, Ordering::Relaxed);
        }
        return;
    }
    // Before `init`, hold the line so the first moments of a launch — the ones
    // that explain a failed boot — are not the ones the log is missing.
    let Ok(mut pending) = PREINIT.lock() else {
        DROPPED.fetch_add(1, Ordering::Relaxed);
        return;
    };
    if pending.len() >= PREINIT_CAPACITY {
        DROPPED.fetch_add(1, Ordering::Relaxed);
        return;
    }
    pending.push(line);
}

/// A line that is already formatted (the UI bridge builds its own).
pub(crate) fn emit_formatted(level: &str, source: &str, message: &str) {
    let line = format_line(&timestamp_now(), level, source, message);
    eprintln!("{line}");
    enqueue(line);
}

/// Point the log at `<app data dir>/logs` and start the writer thread.
///
/// Safe to call more than once; only the first call wins.
pub(crate) fn init(app_data_dir: &Path) {
    if SINK.get().is_some() {
        return;
    }
    let dir = logs_dir_for(app_data_dir);
    let _ = LOG_PATH.set(dir.join(LOG_FILE_NAME));
    let (sender, receiver) = sync_channel::<String>(QUEUE_CAPACITY);
    if SINK.set(sender).is_err() {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("polyphonic-log".to_owned())
        .spawn(move || {
            let mut writer = LogWriter::new(dir, MAX_LOG_BYTES, KEEP_ROTATIONS);
            while let Ok(line) = receiver.recv() {
                let dropped = DROPPED.swap(0, Ordering::Relaxed);
                if dropped > 0 {
                    let marker = format_line(
                        &timestamp_now(),
                        "warn",
                        "buzz_lib::diag",
                        &format!("dropped {dropped} lines"),
                    );
                    writer.write_line(&marker);
                }
                writer.write_line(&line);
            }
        });
    if spawned.is_err() {
        // No thread, no file. stderr still works and the app still runs.
        return;
    }

    // Replay whatever happened before the data directory was known.
    if let Ok(mut pending) = PREINIT.lock() {
        let drained = std::mem::take(&mut *pending);
        drop(pending);
        for line in drained {
            if let Some(sender) = SINK.get() {
                if sender.try_send(line).is_err() {
                    DROPPED.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
    }
}

/// The one header line every launch starts with.
pub(crate) fn startup_header(version: &str, data_dir: &Path) -> String {
    let build = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    format!(
        "polyphonic starting: version={version} build={build} os={}/{} data_dir={}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        data_dir.display()
    )
}

/// Read back the tail of the log, newest last.
///
/// `redact_paths` is the difference between Settings' "Copy recent log" (local,
/// paths kept) and Send Feedback (leaves the Mac, paths redacted too).
pub(crate) fn read_recent_lines(path: &Path, limit: usize, redact_paths: bool) -> String {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(limit);
    let tail = lines[start..].join("\n");
    if redact_paths {
        luca_diagnostics::redact_diagnostic(&tail).0
    } else {
        tail
    }
}

// ── The writer ───────────────────────────────────────────────────────────────

/// Append-and-rotate over one file. Synchronous and directly testable; the
/// thread in `init` is the only production caller.
pub(crate) struct LogWriter {
    dir: PathBuf,
    max_bytes: u64,
    keep: usize,
    file: Option<File>,
    written: u64,
}

impl LogWriter {
    pub(crate) fn new(dir: PathBuf, max_bytes: u64, keep: usize) -> Self {
        Self {
            dir,
            max_bytes,
            keep,
            file: None,
            written: 0,
        }
    }

    pub(crate) fn path(&self) -> PathBuf {
        self.dir.join(LOG_FILE_NAME)
    }

    /// Append one line. Returns whether it reached the disk.
    ///
    /// Every failure path drops the line rather than retrying or blocking: an
    /// unwritable log directory must not become a hang.
    pub(crate) fn write_line(&mut self, line: &str) -> bool {
        let needed = line.len() as u64 + 1;
        if self.file.is_some() && self.written + needed > self.max_bytes {
            self.rotate();
        }
        if !self.ensure_open() {
            return false;
        }
        let Some(file) = self.file.as_mut() else {
            return false;
        };
        if writeln!(file, "{line}").is_err() || file.flush().is_err() {
            // Give up on this handle; the next line tries a fresh open.
            self.file = None;
            return false;
        }
        self.written += needed;
        if self.written >= self.max_bytes {
            self.rotate();
        }
        true
    }

    fn ensure_open(&mut self) -> bool {
        if self.file.is_some() {
            return true;
        }
        if std::fs::create_dir_all(&self.dir).is_err() {
            return false;
        }
        let path = self.path();
        let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) else {
            return false;
        };
        self.written = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
        self.file = Some(file);
        true
    }

    /// `polyphonic.log` → `.1`, `.1` → `.2`, … and the oldest is removed.
    fn rotate(&mut self) {
        self.file = None;
        self.written = 0;
        if self.keep == 0 {
            let _ = std::fs::remove_file(self.path());
            return;
        }
        let rotated = |index: usize| self.dir.join(format!("{LOG_FILE_NAME}.{index}"));
        let _ = std::fs::remove_file(rotated(self.keep));
        for index in (1..self.keep).rev() {
            let _ = std::fs::rename(rotated(index), rotated(index + 1));
        }
        let _ = std::fs::rename(self.path(), rotated(1));
    }
}

// ── The UI rate limit ────────────────────────────────────────────────────────

/// What the caller should do with one `append_ui_log` line.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RateDecision {
    /// Write it.
    Allow,
    /// Write a `dropped N lines` marker, then write it.
    AllowAfterMarker(u32),
    /// Over budget — say nothing.
    Drop,
}

/// A fixed-window limiter: at most `limit` lines in any one-second window, then
/// silence, then a single marker saying how much was lost.
pub(crate) struct RateLimiter {
    limit: u32,
    window_start: Instant,
    count: u32,
    dropped: u32,
}

impl RateLimiter {
    pub(crate) fn new(limit: u32, now: Instant) -> Self {
        Self {
            limit,
            window_start: now,
            count: 0,
            dropped: 0,
        }
    }

    pub(crate) fn decide(&mut self, now: Instant) -> RateDecision {
        if now.duration_since(self.window_start) >= Duration::from_secs(1) {
            self.window_start = now;
            self.count = 1;
            let dropped = std::mem::take(&mut self.dropped);
            return if dropped > 0 {
                RateDecision::AllowAfterMarker(dropped)
            } else {
                RateDecision::Allow
            };
        }
        if self.count < self.limit {
            self.count += 1;
            return RateDecision::Allow;
        }
        self.dropped = self.dropped.saturating_add(1);
        RateDecision::Drop
    }
}

/// The process-wide limiter behind `append_ui_log`.
pub(crate) fn ui_rate_limiter() -> &'static Mutex<RateLimiter> {
    static LIMITER: OnceLock<Mutex<RateLimiter>> = OnceLock::new();
    LIMITER.get_or_init(|| Mutex::new(RateLimiter::new(UI_LOG_LINES_PER_SECOND, Instant::now())))
}

/// `warn`/`error`/`debug` pass through; anything else is `info`.
pub(crate) fn normalize_level(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "error" => "error",
        "warn" | "warning" => "warn",
        "debug" => "debug",
        _ => "info",
    }
}

/// Keep a UI-supplied source label to something that cannot break the format.
pub(crate) fn normalize_source(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|character| !character.is_whitespace() && !character.is_control())
        .take(64)
        .collect();
    if cleaned.is_empty() {
        "ui".to_owned()
    } else {
        format!("ui:{cleaned}")
    }
}

/// `luca_log!(warn, "…", args)` — the drop-in for `eprintln!`.
///
/// Same format-args shape, plus a level and (via `module_path!`) the source.
macro_rules! luca_log {
    (info, $($arg:tt)*) => {
        $crate::diag::emit("info", module_path!(), format_args!($($arg)*))
    };
    (warn, $($arg:tt)*) => {
        $crate::diag::emit("warn", module_path!(), format_args!($($arg)*))
    };
    (error, $($arg:tt)*) => {
        $crate::diag::emit("error", module_path!(), format_args!($($arg)*))
    };
    (debug, $($arg:tt)*) => {
        $crate::diag::emit("debug", module_path!(), format_args!($($arg)*))
    };
}

#[cfg(test)]
mod tests;

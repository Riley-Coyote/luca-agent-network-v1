//! What the log file promises: it rotates, it keeps no secrets, it never
//! blocks, and the macro produces the one line shape everything else parses.

use super::*;

/// A sentinel the `luca-diagnostics` `Secret` class recognises without being a
/// real credential anywhere.
const FAKE_SECRET: &str = "LUCATEST_TOKEN_SENTINEL";

fn line_of(length: usize) -> String {
    "x".repeat(length)
}

#[test]
fn diag_writer_rotates_at_the_limit_and_keeps_three() {
    let temp = tempfile::tempdir().expect("temp dir");
    let dir = temp.path().join("logs");
    // Each line is 41 bytes on disk, so every second line forces a rotation.
    let mut writer = LogWriter::new(dir.clone(), 64, KEEP_ROTATIONS);

    for index in 0..6 {
        assert!(
            writer.write_line(&format!("{index:02} {}", line_of(37))),
            "line {index} should be written"
        );
    }

    assert!(dir.join(LOG_FILE_NAME).exists(), "active log exists");
    for index in 1..=KEEP_ROTATIONS {
        assert!(
            dir.join(format!("{LOG_FILE_NAME}.{index}")).exists(),
            "rotation {index} exists"
        );
    }
    assert!(
        !dir.join(format!("{LOG_FILE_NAME}.{}", KEEP_ROTATIONS + 1))
            .exists(),
        "only {KEEP_ROTATIONS} rotations are kept"
    );

    let active = std::fs::read_to_string(dir.join(LOG_FILE_NAME)).expect("active log");
    assert!(
        active.starts_with("05 "),
        "newest line is in the active file"
    );
    let oldest = std::fs::read_to_string(dir.join(format!("{LOG_FILE_NAME}.{KEEP_ROTATIONS}")))
        .expect("oldest rotation");
    assert!(
        oldest.starts_with("02 "),
        "the two oldest lines have aged out, got {oldest:?}"
    );
}

#[test]
fn diag_line_redacts_a_secret_and_keeps_the_absolute_path() {
    let line = format_line(
        "2026-09-15T08:12:03.123Z",
        "warn",
        "buzz_lib::identity",
        &format!("could not read /Users/riley/Library/keys: token={FAKE_SECRET}"),
    );

    assert!(
        !line.contains(FAKE_SECRET),
        "the secret must not reach disk: {line}"
    );
    assert!(
        line.contains("[REDACTED:secret]"),
        "the class is named: {line}"
    );
    assert!(
        line.contains("/Users/riley/Library/keys"),
        "a local log keeps its paths: {line}"
    );
}

#[test]
fn diag_line_flattens_newlines_into_one_record() {
    let line = format_line(
        "2026-09-15T08:12:03.123Z",
        "warn",
        "buzz_lib::migration",
        "failed\nsecond line\r\nthird",
    );

    assert_eq!(line.lines().count(), 1, "one record, one line: {line}");
    assert!(line.ends_with("failed second line  third"), "got {line}");
}

#[test]
fn diag_writer_drops_rather_than_blocking_on_an_unwritable_dir() {
    let temp = tempfile::tempdir().expect("temp dir");
    let readonly = temp.path().join("readonly");
    std::fs::create_dir(&readonly).expect("create dir");
    let mut permissions = std::fs::metadata(&readonly)
        .expect("metadata")
        .permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o500);
    }
    permissions.set_readonly(true);
    std::fs::set_permissions(&readonly, permissions).expect("set permissions");

    let mut writer = LogWriter::new(readonly.join("logs"), MAX_LOG_BYTES, KEEP_ROTATIONS);
    let started = Instant::now();
    for _ in 0..50 {
        assert!(
            !writer.write_line("this line has nowhere to go"),
            "an unwritable directory reports the drop"
        );
    }
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "dropping must not turn into waiting"
    );
}

#[test]
fn diag_macro_formats_a_line_and_appends_it_to_the_file() {
    let temp = tempfile::tempdir().expect("temp dir");
    init(temp.path());
    let expected_path = logs_dir_for(temp.path()).join(LOG_FILE_NAME);

    let detail = 7;
    luca_log!(warn, "buzz-desktop: could not park {detail} residents");

    let mut found = String::new();
    for _ in 0..200 {
        if let Ok(contents) = std::fs::read_to_string(&expected_path) {
            if contents.contains("could not park 7 residents") {
                found = contents;
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let line = found
        .lines()
        .find(|line| line.contains("could not park 7 residents"))
        .unwrap_or_else(|| panic!("the macro's line never reached {expected_path:?}: {found:?}"));
    let mut parts = line.splitn(4, ' ');
    let timestamp = parts.next().unwrap_or_default();
    assert_eq!(parts.next(), Some("warn"), "level follows the timestamp");
    assert_eq!(
        parts.next(),
        Some("buzz_lib::diag::tests"),
        "source is the calling module"
    );
    assert_eq!(
        parts.next(),
        Some("buzz-desktop: could not park 7 residents"),
        "the message is the formatted args"
    );
    assert!(
        timestamp.ends_with('Z') && timestamp.len() == 24,
        "timestamp is 2026-09-15T08:12:03.123Z shaped, got {timestamp:?}"
    );
}

#[test]
fn diag_rate_limiter_allows_twenty_then_drops_then_reports() {
    let start = Instant::now();
    let mut limiter = RateLimiter::new(UI_LOG_LINES_PER_SECOND, start);

    for index in 0..UI_LOG_LINES_PER_SECOND {
        assert_eq!(
            limiter.decide(start),
            RateDecision::Allow,
            "line {index} is inside the budget"
        );
    }
    assert_eq!(limiter.decide(start), RateDecision::Drop, "21st is dropped");
    assert_eq!(limiter.decide(start), RateDecision::Drop, "22nd is dropped");

    let next_window = start + Duration::from_secs(1);
    assert_eq!(
        limiter.decide(next_window),
        RateDecision::AllowAfterMarker(2),
        "the new window opens with one marker naming the loss"
    );
    assert_eq!(
        limiter.decide(next_window),
        RateDecision::Allow,
        "and the marker is not repeated"
    );
}

#[test]
fn diag_normalizes_ui_levels_and_sources() {
    assert_eq!(normalize_level("ERROR"), "error");
    assert_eq!(normalize_level(" warning "), "warn");
    assert_eq!(normalize_level("chatter"), "info");
    assert_eq!(normalize_source("window.onerror"), "ui:window.onerror");
    assert_eq!(normalize_source("  "), "ui");
    assert_eq!(
        normalize_source("console error with spaces"),
        "ui:consoleerrorwithspaces"
    );
}

#[test]
fn diag_recent_lines_returns_the_tail_and_can_redact_paths() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join(LOG_FILE_NAME);
    let body: String = (0..300)
        .map(|index| {
            format!("2026-09-15T08:12:03.123Z info buzz_lib::x line {index} /Users/riley/a\n")
        })
        .collect();
    std::fs::write(&path, body).expect("write log");

    let local = read_recent_lines(&path, RECENT_LINE_COUNT, false);
    assert_eq!(local.lines().count(), RECENT_LINE_COUNT);
    assert!(local.contains("line 299"), "the tail is the newest lines");
    assert!(!local.contains("line 99"), "older lines are left behind");
    assert!(local.contains("/Users/riley/a"), "local copy keeps paths");

    let outbound = read_recent_lines(&path, RECENT_LINE_COUNT, true);
    assert!(
        !outbound.contains("/Users/riley/a"),
        "text that leaves the Mac loses its paths: {outbound:?}"
    );
    assert!(outbound.contains("[REDACTED:absolute_path]"));
}

#[test]
fn diag_startup_header_names_the_launch() {
    let header = startup_header("0.4.22", Path::new("/Users/riley/Library/App"));
    assert!(header.contains("version=0.4.22"));
    assert!(header.contains("data_dir=/Users/riley/Library/App"));
    assert!(header.contains("os="));
    assert!(header.contains("build="));
}

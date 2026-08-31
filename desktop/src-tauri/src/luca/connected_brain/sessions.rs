use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::LazyLock,
};

#[cfg(test)]
use std::collections::{BTreeMap, BTreeSet};

use luca_protocol::ConnectedBrainSourceKindV1;
use regex::Regex;
use serde_json::Value;

use super::discovery::modified_timestamp;

const MAX_SESSION_FILES: usize = 20_000;
const MAX_SESSION_DEPTH: usize = 8;
const MAX_JSONL_LINE_BYTES: usize = 2 * 1024 * 1024;
const MAX_SESSION_SELECTIONS: usize = 32;
const MAX_INDEXED_MESSAGES_PER_SESSION: usize = 16;
const MAX_INDEX_SESSION_BYTES: usize = 2 * 1024 * 1024;
const MAX_INDEX_SESSION_LINES: usize = 4_000;
const MAX_RAIL_SESSION_FILES: usize = 200;
const MAX_RAIL_SESSION_BYTES: usize = 64 * 1024 * 1024;
const MAX_RAIL_SESSION_LINES: usize = 100_000;
const MAX_CONTEXT_SESSION_BYTES: usize = 32 * 1024 * 1024;
const MAX_CONTEXT_SESSION_LINES: usize = 50_000;
const SESSION_STREAM_BUFFER_BYTES: usize = 64 * 1024;

static HTTP_URL_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)https?://[^\s<>\"'`]+"#).expect("HTTP URL preservation regex must compile")
});

static PROBABLE_LOCAL_PATH_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?ix)
        (?P<prefix>^|[^a-z0-9/\\])
        (?:
            \\{2}\?\\(?:
                [a-z]:\\[^\s<>\"'`\])}]* |
                unc\\[^\\\s<>\"'`\])}]+\\[^\\\s<>\"'`\])}]+(?:\\[^\s<>\"'`\])}]*)?
            ) |
            \\{2}[^\\\s<>\"'`?\])}]+\\[^\\\s<>\"'`\])}]+(?:\\[^\s<>\"'`\])}]*)? |
            (?:file://(?:localhost)?)?/{1,2}[a-z0-9._~-]+(?:/[^\s<>\"'`\])}]*)? |
            [a-z]:\\(?:users\\)?[^\\\s<>\"'`]+(?:\\[^\s<>\"'`]*)?
        )"#,
    )
    .expect("local path redaction regex must compile")
});

#[derive(Debug)]
pub(crate) struct SessionReadBudget {
    remaining_files: usize,
    remaining_bytes: usize,
    remaining_lines: usize,
    exhausted: bool,
}

impl SessionReadBudget {
    pub(crate) fn for_rail_list() -> Self {
        Self::new(
            MAX_RAIL_SESSION_FILES,
            MAX_RAIL_SESSION_BYTES,
            MAX_RAIL_SESSION_LINES,
        )
    }

    pub(super) fn for_context() -> Self {
        Self::new(1, MAX_CONTEXT_SESSION_BYTES, MAX_CONTEXT_SESSION_LINES)
    }

    pub(super) fn new(max_files: usize, max_bytes: usize, max_lines: usize) -> Self {
        Self {
            remaining_files: max_files,
            remaining_bytes: max_bytes,
            remaining_lines: max_lines,
            exhausted: max_files == 0 || max_bytes == 0 || max_lines == 0,
        }
    }

    pub(super) fn is_exhausted(&self) -> bool {
        self.exhausted
            || self.remaining_files == 0
            || self.remaining_bytes == 0
            || self.remaining_lines == 0
    }

    fn begin_file(&mut self) -> Result<(), ()> {
        if self.is_exhausted() {
            self.exhausted = true;
            return Err(());
        }
        self.remaining_files -= 1;
        Ok(())
    }

    fn record_line(&mut self, bytes: usize) {
        self.remaining_bytes = self.remaining_bytes.saturating_sub(bytes);
        self.remaining_lines = self.remaining_lines.saturating_sub(1);
    }

    fn mark_exhausted(&mut self) {
        self.exhausted = true;
    }
}

enum BoundedLineReadError {
    Io,
    Budget,
}

pub(super) struct SessionMetadata {
    pub count: usize,
    pub earliest_at: Option<String>,
    pub latest_at: Option<String>,
}

#[derive(Clone, Debug)]
pub(super) struct SessionFileMetadata {
    pub relative_locator: String,
    pub updated_at: Option<String>,
}

pub(super) fn session_metadata(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
) -> Result<SessionMetadata, String> {
    let files = session_files(root, kind)?;
    let mut timestamps = files
        .iter()
        .filter_map(|path| modified_timestamp(path))
        .collect::<Vec<_>>();
    timestamps.sort();
    Ok(SessionMetadata {
        count: files.len(),
        earliest_at: timestamps.first().cloned(),
        latest_at: timestamps.last().cloned(),
    })
}

/// Return body-free native session metadata newest first. This is deliberately
/// independent from the bounded Brain search index: a very large conversation
/// must not prevent newer conversations from appearing in the session rail.
pub(super) fn session_file_metadata(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
) -> Result<Vec<SessionFileMetadata>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "session history is unavailable".to_owned())?;
    let mut files = session_files(&canonical_root, kind)?
        .into_iter()
        .filter_map(|path| {
            let relative = path.strip_prefix(&canonical_root).ok()?;
            let relative_locator = relative.to_str()?.replace('\\', "/");
            Some(SessionFileMetadata {
                relative_locator,
                updated_at: modified_timestamp(&path),
            })
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.relative_locator.cmp(&left.relative_locator))
    });
    Ok(files)
}

/// Visit visible session records in deterministic file/ordinal order. The
/// visitor can stop the source immediately, which lets index construction end
/// at its existing entry cap without collecting transcripts or opening the
/// remaining files.
pub(super) fn visit_messages(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    mut visitor: impl FnMut(&str, usize, String) -> Result<bool, String>,
) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "session history is unavailable".to_owned())?;
    for session in session_file_metadata(&canonical_root, kind)? {
        let mut budget =
            SessionReadBudget::new(1, MAX_INDEX_SESSION_BYTES, MAX_INDEX_SESSION_LINES);
        let messages = read_visible_prefix(
            &canonical_root,
            kind,
            &session.relative_locator,
            MAX_INDEXED_MESSAGES_PER_SESSION,
            &mut budget,
        )?;
        for (ordinal, message) in messages.into_iter().enumerate() {
            if !visitor(&session.relative_locator, ordinal, message)? {
                return Ok(());
            }
        }
    }
    Ok(())
}

/// Read the first visible user-facing messages from one native session under a
/// shared bounded budget. Hidden prompts, tools, credentials and local paths
/// pass through the same sanitizer as Brain indexing.
pub(super) fn read_visible_prefix(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    relative_path: &str,
    limit: usize,
    budget: &mut SessionReadBudget,
) -> Result<Vec<String>, String> {
    if limit == 0 || limit > MAX_SESSION_SELECTIONS {
        return Err("connected session prefix selection is invalid".to_owned());
    }
    budget
        .begin_file()
        .map_err(|_| "connected session read budget exhausted".to_owned())?;
    let canonical = resolved_session_path(root, kind, relative_path)?;
    let file = fs::File::open(canonical)
        .map_err(|_| "connected session selection is unavailable".to_owned())?;
    let mut reader = BufReader::with_capacity(SESSION_STREAM_BUFFER_BYTES, file);
    let mut selected = Vec::with_capacity(limit);
    let mut line = Vec::with_capacity(SESSION_STREAM_BUFFER_BYTES);
    loop {
        if budget.remaining_lines == 0 || budget.remaining_bytes == 0 {
            budget.mark_exhausted();
            return Ok(selected);
        }
        let Some((line_bytes, oversized)) =
            (match read_bounded_line(&mut reader, &mut line, budget.remaining_bytes) {
                Ok(line) => line,
                Err(BoundedLineReadError::Budget) => {
                    budget.mark_exhausted();
                    return Ok(selected);
                }
                Err(BoundedLineReadError::Io) => {
                    return Err("connected session selection is unavailable".to_owned());
                }
            })
        else {
            return Ok(selected);
        };
        budget.record_line(line_bytes);
        if oversized {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if let Some(message) = visible_session_message(&value, kind) {
            selected.push(message);
            if selected.len() == limit {
                return Ok(selected);
            }
        }
    }
}

pub(super) fn read_messages(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    relative_path: &str,
) -> Result<Vec<String>, String> {
    let canonical = resolved_session_path(root, kind, relative_path)?;
    parse_file(&canonical, kind)
}

fn resolved_session_path(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    relative_path: &str,
) -> Result<PathBuf, String> {
    if relative_path.is_empty()
        || Path::new(relative_path).is_absolute()
        || Path::new(relative_path)
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("session locator is unsafe".to_owned());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "session history is unavailable".to_owned())?;
    let canonical = canonical_root
        .join(relative_path)
        .canonicalize()
        .map_err(|_| "session locator is unavailable".to_owned())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("session locator escaped its source".to_owned());
    }
    if kind == ConnectedBrainSourceKindV1::ClaudeHistory
        && canonical
            .components()
            .any(|component| component.as_os_str() == "subagents")
    {
        return Err("subagent histories are excluded".to_owned());
    }
    Ok(canonical)
}

fn session_files(root: &Path, kind: ConnectedBrainSourceKindV1) -> Result<Vec<PathBuf>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "session history is unavailable".to_owned())?;
    let mut queue = VecDeque::from([(canonical_root.clone(), 0_usize)]);
    let mut files = Vec::new();
    while let Some((directory, depth)) = queue.pop_front() {
        if files.len() >= MAX_SESSION_FILES || depth > MAX_SESSION_DEPTH {
            break;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if files.len() >= MAX_SESSION_FILES {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if kind == ConnectedBrainSourceKindV1::ClaudeHistory
                    && entry.file_name() == "subagents"
                {
                    continue;
                }
                let Ok(canonical) = path.canonicalize() else {
                    continue;
                };
                if canonical.starts_with(&canonical_root) {
                    queue.push_back((canonical, depth + 1));
                }
            } else if file_type.is_file()
                && path.extension().and_then(|value| value.to_str()) == Some("jsonl")
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn parse_file(path: &Path, kind: ConnectedBrainSourceKindV1) -> Result<Vec<String>, String> {
    let file = fs::File::open(path).map_err(|_| "session history is unavailable".to_owned())?;
    let mut messages = Vec::new();
    let mut reader = BufReader::with_capacity(SESSION_STREAM_BUFFER_BYTES, file);
    visit_messages_from_reader(&mut reader, kind, |_ordinal, message| {
        messages.push(message);
        Ok(true)
    })?;
    Ok(messages)
}

fn visit_messages_from_reader<R: BufRead>(
    reader: &mut R,
    kind: ConnectedBrainSourceKindV1,
    mut visitor: impl FnMut(usize, String) -> Result<bool, String>,
) -> Result<bool, String> {
    let mut visible_ordinal = 0_usize;
    let mut line = Vec::with_capacity(SESSION_STREAM_BUFFER_BYTES);
    loop {
        let Some((_line_bytes, oversized)) = read_bounded_line(reader, &mut line, usize::MAX)
            .map_err(|_| "session history contains an unreadable JSONL record".to_owned())?
        else {
            return Ok(true);
        };
        if oversized {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let Some(message) = visible_session_message(&value, kind) else {
            continue;
        };
        if !visitor(visible_ordinal, message)? {
            return Ok(false);
        }
        visible_ordinal = visible_ordinal.saturating_add(1);
    }
}

#[cfg(test)]
fn select_messages_from_reader<R: BufRead>(
    reader: &mut R,
    kind: ConnectedBrainSourceKindV1,
    ordinals: &BTreeSet<usize>,
    budget: &mut SessionReadBudget,
) -> Result<BTreeMap<usize, String>, String> {
    let mut selected = BTreeMap::new();
    let mut visible_ordinal = 0_usize;
    let mut line = Vec::with_capacity(SESSION_STREAM_BUFFER_BYTES);

    loop {
        if budget.remaining_lines == 0 || budget.remaining_bytes == 0 {
            budget.mark_exhausted();
            return Err("connected session selection exceeded its read limit".to_owned());
        }
        let line_result = read_bounded_line(reader, &mut line, budget.remaining_bytes);
        let Some((line_bytes, oversized)) = (match line_result {
            Ok(line) => line,
            Err(BoundedLineReadError::Budget) => {
                budget.mark_exhausted();
                return Err("connected session selection exceeded its read limit".to_owned());
            }
            Err(BoundedLineReadError::Io) => {
                return Err("connected session selection is unavailable".to_owned());
            }
        }) else {
            return Ok(selected);
        };
        budget.record_line(line_bytes);
        if oversized {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let Some(message) = visible_session_message(&value, kind) else {
            continue;
        };
        if ordinals.contains(&visible_ordinal) {
            selected.insert(visible_ordinal, message);
            if selected.len() == ordinals.len() {
                return Ok(selected);
            }
        }
        visible_ordinal = visible_ordinal.saturating_add(1);
    }
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
    max_bytes: usize,
) -> Result<Option<(usize, bool)>, BoundedLineReadError> {
    line.clear();
    let mut bytes_read = 0_usize;
    let mut oversized = false;
    let mut saw_bytes = false;

    loop {
        let available = reader.fill_buf().map_err(|_| BoundedLineReadError::Io)?;
        if available.is_empty() {
            return if saw_bytes {
                Ok(Some((bytes_read, oversized)))
            } else {
                Ok(None)
            };
        }
        saw_bytes = true;
        let chunk_len = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |position| position + 1);
        let has_newline = available.get(chunk_len.saturating_sub(1)) == Some(&b'\n');
        if bytes_read.saturating_add(chunk_len) > max_bytes {
            return Err(BoundedLineReadError::Budget);
        }
        bytes_read = bytes_read.saturating_add(chunk_len);
        if !oversized {
            if line.len().saturating_add(chunk_len) <= MAX_JSONL_LINE_BYTES + 1 {
                line.extend_from_slice(&available[..chunk_len]);
            } else {
                line.clear();
                oversized = true;
            }
        }
        reader.consume(chunk_len);
        if has_newline {
            if !oversized {
                if line.last() == Some(&b'\n') {
                    line.pop();
                }
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
            }
            return Ok(Some((bytes_read, oversized)));
        }
    }
}

fn visible_session_message(value: &Value, kind: ConnectedBrainSourceKindV1) -> Option<String> {
    let extracted = match kind {
        ConnectedBrainSourceKindV1::CodexHistory => codex_visible_message(value),
        ConnectedBrainSourceKindV1::ClaudeHistory => claude_visible_message(value),
        ConnectedBrainSourceKindV1::Repository => None,
    };
    extracted.and_then(sanitize_visible_text)
}

fn codex_visible_message(value: &Value) -> Option<String> {
    let record_type = value.get("type")?.as_str()?;
    let payload = value.get("payload")?;
    match record_type {
        "event_msg" if payload.get("type")?.as_str()? == "user_message" => {
            strip_codex_ambient_prefix(payload.get("message")?.as_str()?)
        }
        "response_item"
            if payload.get("type")?.as_str()? == "message"
                && payload.get("role")?.as_str()? == "assistant"
                && payload.get("phase")?.as_str()? == "final_answer" =>
        {
            strict_visible_blocks(payload.get("content")?, &["output_text"])
        }
        _ => None,
    }
}

fn claude_visible_message(value: &Value) -> Option<String> {
    let kind = value.get("type")?.as_str()?;
    if !matches!(kind, "user" | "assistant") {
        return None;
    }
    let message = value.get("message")?;
    if claude_record_is_hidden(value)
        || claude_record_is_hidden(message)
        || (kind == "user"
            && (claude_record_is_sdk_prompt(value) || claude_record_is_sdk_prompt(message)))
    {
        return None;
    }
    let role = message.get("role")?.as_str()?;
    if role != kind {
        return None;
    }
    match role {
        "user" => strict_user_visible_content(message.get("content")?),
        "assistant" => visible_text_content(message.get("content")?),
        _ => None,
    }
}

fn claude_record_is_hidden(value: &Value) -> bool {
    ["isMeta", "isCompactSummary", "isSummary", "isSidechain"]
        .iter()
        .any(|field| value.get(*field).and_then(Value::as_bool) == Some(true))
}

fn claude_record_is_sdk_prompt(value: &Value) -> bool {
    ["promptSource", "prompt_source"]
        .iter()
        .filter_map(|field| value.get(*field).and_then(Value::as_str))
        .any(is_sdk_label)
        || value
            .get("entrypoint")
            .and_then(Value::as_str)
            .is_some_and(is_sdk_label)
}

fn is_sdk_label(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    normalized == "sdk" || normalized.starts_with("sdk-") || normalized.starts_with("sdk_")
}

fn strict_visible_blocks(content: &Value, allowed_types: &[&str]) -> Option<String> {
    let blocks = content.as_array()?;
    if blocks.is_empty()
        || blocks.iter().any(|block| {
            !block
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| allowed_types.contains(&kind))
                || block.get("text").and_then(Value::as_str).is_none()
        })
    {
        return None;
    }
    let text = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn strict_user_visible_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    strict_visible_blocks(content, &["text"])
}

fn visible_text_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    let blocks = content.as_array()?;
    let text = blocks
        .iter()
        .filter(|block| {
            block
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind == "text")
        })
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn strip_codex_ambient_prefix(text: &str) -> Option<String> {
    const OPEN_PREFIX: &str = "<in-app-browser-context";
    const CLOSE_TAG: &str = "</in-app-browser-context>";

    let mut visible = text.trim();
    while visible.starts_with(OPEN_PREFIX) {
        let boundary = visible.as_bytes().get(OPEN_PREFIX.len()).copied()?;
        if boundary != b'>' && !boundary.is_ascii_whitespace() {
            return None;
        }
        let open_end = visible.find('>')?;
        let close_start = visible[open_end + 1..].find(CLOSE_TAG)? + open_end + 1;
        visible = visible[close_start + CLOSE_TAG.len()..].trim_start();
    }
    (!visible.is_empty()).then(|| visible.to_owned())
}

fn sanitize_visible_text(text: String) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || contains_credential(trimmed)
        || contains_internal_prompt_markup(trimmed)
    {
        return None;
    }
    let redacted = redact_probable_local_paths(trimmed);
    let redacted = redacted.trim();
    if redacted.is_empty() || contains_probable_local_path(redacted) {
        return None;
    }
    Some(redacted.to_owned())
}

fn redact_probable_local_paths(text: &str) -> String {
    let mut redacted = String::with_capacity(text.len());
    let mut cursor = 0_usize;
    for url in HTTP_URL_PATTERN.find_iter(text) {
        redact_non_http_segment(&mut redacted, &text[cursor..url.start()]);
        redacted.push_str(url.as_str());
        cursor = url.end();
    }
    redact_non_http_segment(&mut redacted, &text[cursor..]);
    redacted
}

fn redact_non_http_segment(output: &mut String, segment: &str) {
    let replaced = PROBABLE_LOCAL_PATH_PATTERN.replace_all(segment, "${prefix}[local path]");
    output.push_str(&replaced);
}

fn contains_probable_local_path(text: &str) -> bool {
    let mut cursor = 0_usize;
    for url in HTTP_URL_PATTERN.find_iter(text) {
        let segment = &text[cursor..url.start()];
        if PROBABLE_LOCAL_PATH_PATTERN.is_match(segment)
            || segment.to_ascii_lowercase().contains("file://")
        {
            return true;
        }
        cursor = url.end();
    }
    let segment = &text[cursor..];
    PROBABLE_LOCAL_PATH_PATTERN.is_match(segment)
        || segment.to_ascii_lowercase().contains("file://")
}

fn contains_internal_prompt_markup(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let contains_tagged_markup = [
        "<environment_context",
        "</environment_context",
        "<permissions",
        "</permissions",
        "<skills_instructions",
        "</skills_instructions",
        "<recommended_plugins",
        "</recommended_plugins",
        "<app-context",
        "</app-context",
        "<in-app-browser-context",
        "</in-app-browser-context",
        "<apps_instructions",
        "<plugins_instructions",
        "<multi_agent_mode",
        "<collaboration_mode",
        "<system-reminder",
        "<command-",
        "<local-command-",
        "<ide_",
        "<developer",
        "</developer",
        "<system",
        "</system",
        "<user",
        "</user",
        "<assistant",
        "</assistant",
        "<tool",
        "</tool",
        "<memory",
        "</memory",
        "<instructions>",
        "# agents.md instructions",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    let contains_bracketed_envelope = lower.lines().any(|line| {
        let line = line.trim_start();
        [
            "[workspace]",
            "[base]",
            "[system]",
            "[context]",
            "[conversation context",
            "[team instructions]",
            "[agent memory",
            "[channel canvas]",
            "[buzz event:",
            "[thread context]",
        ]
        .iter()
        .any(|marker| line.starts_with(marker))
    });
    contains_tagged_markup || contains_bracketed_envelope
}

fn contains_credential(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "-----begin private key-----",
        "aws_secret_access_key",
        "openai_api_key=",
        "anthropic_api_key=",
        "github_token=",
        "password=",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

#[cfg(test)]
pub(super) fn parse_codex_fixture(value: &Value) -> Option<String> {
    codex_visible_message(value).and_then(sanitize_visible_text)
}

#[cfg(test)]
pub(super) fn parse_claude_fixture(value: &Value) -> Option<String> {
    claude_visible_message(value).and_then(sanitize_visible_text)
}

#[cfg(test)]
mod tests {
    use std::io::{self, BufReader, Cursor, Read};

    use serde_json::json;

    use super::*;

    struct FailIfReadTail;

    impl Read for FailIfReadTail {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("stream read continued into the tail"))
        }
    }

    #[test]
    fn codex_allowlist_excludes_ambient_records_and_redacts_local_paths() {
        let ambient_user = json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{
                    "type": "input_text",
                    "text": "<environment_context>/Users/riley/private</environment_context>"
                }]
            }
        });
        assert_eq!(parse_codex_fixture(&ambient_user), None);

        let visible_user = json!({
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "client_id": "fixture-client",
                "message": "<in-app-browser-context source=\"browser\">private ambient state at /Users/riley/browser</in-app-browser-context>\nOpen /Users/riley/Projects/Polyphonic and inspect it.",
                "images": [],
                "local_images": [],
                "text_elements": []
            }
        });
        let visible_user = parse_codex_fixture(&visible_user).unwrap();
        assert!(visible_user.starts_with("Open [local path]"));
        assert!(!visible_user.contains("private ambient state"));
        assert!(!visible_user.contains("/Users/"));

        let injected_user = json!({
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "Please use this. <recommended_plugins>private platform data</recommended_plugins>"
            }
        });
        assert_eq!(parse_codex_fixture(&injected_user), None);

        let commentary = json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "phase": "commentary",
                "content": [{"type": "output_text", "text": "Working in /Volumes/Secret"}]
            }
        });
        assert_eq!(parse_codex_fixture(&commentary), None);

        let mixed_final = json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "phase": "final_answer",
                "content": [
                    {"type": "output_text", "text": "Visible text"},
                    {"type": "tool_use", "input": {"path": "/Users/riley/private"}}
                ]
            }
        });
        assert_eq!(parse_codex_fixture(&mixed_final), None);

        let final_answer = json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "phase": "final_answer",
                "content": [{"type": "output_text", "text": "Keep https://example.com/docs/alpha/beta; redact workspace:/alpha/beta/secret.txt, label=/custom/private/file.txt, /Volumes/LaCie/Polyphonic, /workspace, file:///Users/riley/MyProject, C:\\Users\\riley\\Private\\file.txt, \\\\server\\share\\secret.txt, and \\\\?\\C:\\secret.txt."}]
            }
        });
        let final_answer = parse_codex_fixture(&final_answer).unwrap();
        assert!(final_answer.contains("[local path]"));
        assert!(final_answer.contains("https://example.com/docs/alpha/beta"));
        assert!(!final_answer.contains("workspace:/alpha"));
        assert!(!final_answer.contains("/alpha/beta/secret"));
        assert!(!final_answer.contains("/Volumes/"));
        assert!(!final_answer.contains("/workspace"));
        assert!(!final_answer.contains("/custom/"));
        assert!(!final_answer.contains("file:///"));
        assert!(!final_answer.contains("C:\\Users\\"));
        assert!(!final_answer.contains("\\\\server\\share"));
        assert!(!final_answer.contains("\\\\?\\C:"));
        assert!(!contains_probable_local_path(&final_answer));
    }

    #[test]
    fn selected_ordinal_reader_stops_before_unneeded_transcript_tail() {
        let visible = json!({
            "type": "event_msg",
            "payload": {
                "type": "user_message",
                "message": "Only this visible message is needed."
            }
        });
        let head = format!("{visible}\n").into_bytes();
        let reader = Cursor::new(head).chain(FailIfReadTail);
        let mut reader = BufReader::new(reader);
        let mut budget = SessionReadBudget::new(1, 1024 * 1024, 10);
        let selected = select_messages_from_reader(
            &mut reader,
            ConnectedBrainSourceKindV1::CodexHistory,
            &BTreeSet::from([0]),
            &mut budget,
        )
        .unwrap();
        assert_eq!(
            selected.get(&0).map(String::as_str),
            Some("Only this visible message is needed.")
        );
    }

    #[test]
    fn streaming_visitor_stops_before_the_unneeded_source_tail() {
        let visible = json!({
            "type": "event_msg",
            "payload": {"type": "user_message", "message": "Index only this record."}
        });
        let head = format!("{visible}\n").into_bytes();
        let reader = Cursor::new(head).chain(FailIfReadTail);
        let mut reader = BufReader::new(reader);
        let mut visited = 0_usize;

        let completed = visit_messages_from_reader(
            &mut reader,
            ConnectedBrainSourceKindV1::CodexHistory,
            |_ordinal, _message| {
                visited += 1;
                Ok(false)
            },
        )
        .unwrap();

        assert!(!completed);
        assert_eq!(visited, 1);
    }

    #[test]
    fn oversized_jsonl_line_is_skipped_without_hiding_the_next_visible_record() {
        let visible = json!({
            "type": "event_msg",
            "payload": {"type": "user_message", "message": "Visible after oversized input."}
        });
        let tail = format!("\n{visible}\n").into_bytes();
        let oversized = io::repeat(b'x').take((MAX_JSONL_LINE_BYTES + 1024) as u64);
        let mut reader = BufReader::with_capacity(
            SESSION_STREAM_BUFFER_BYTES,
            oversized.chain(Cursor::new(tail)),
        );
        let mut budget = SessionReadBudget::new(1, MAX_JSONL_LINE_BYTES + 128 * 1024, 2);

        let selected = select_messages_from_reader(
            &mut reader,
            ConnectedBrainSourceKindV1::CodexHistory,
            &BTreeSet::from([0]),
            &mut budget,
        )
        .unwrap();

        assert_eq!(
            selected.get(&0).map(String::as_str),
            Some("Visible after oversized input.")
        );
    }
}

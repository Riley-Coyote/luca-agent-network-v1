use std::{
    collections::VecDeque,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use luca_protocol::ConnectedBrainSourceKindV1;
use serde_json::Value;

use super::discovery::modified_timestamp;

const MAX_SESSION_FILES: usize = 20_000;
const MAX_SESSION_DEPTH: usize = 8;
const MAX_JSONL_LINE_BYTES: usize = 2 * 1024 * 1024;

pub(super) struct SessionMetadata {
    pub count: usize,
    pub earliest_at: Option<String>,
    pub latest_at: Option<String>,
}

pub(super) struct SessionDocument {
    pub relative_path: String,
    pub visible_messages: Vec<String>,
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

pub(super) fn documents(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
) -> Result<Vec<SessionDocument>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "session history is unavailable".to_owned())?;
    let mut documents = Vec::new();
    for path in session_files(&canonical_root, kind)? {
        let Ok(relative) = path.strip_prefix(&canonical_root) else {
            continue;
        };
        let Some(relative_path) = relative.to_str().map(|value| value.replace('\\', "/")) else {
            continue;
        };
        let visible_messages = parse_file(&path, kind)?;
        if !visible_messages.is_empty() {
            documents.push(SessionDocument {
                relative_path,
                visible_messages,
            });
        }
    }
    Ok(documents)
}

pub(super) fn read_messages(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    relative_path: &str,
) -> Result<Vec<String>, String> {
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
    parse_file(&canonical, kind)
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
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else {
            continue;
        };
        if line.len() > MAX_JSONL_LINE_BYTES {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let extracted = match kind {
            ConnectedBrainSourceKindV1::CodexHistory => codex_visible_message(&value),
            ConnectedBrainSourceKindV1::ClaudeHistory => claude_visible_message(&value),
            ConnectedBrainSourceKindV1::Repository => None,
        };
        if let Some(text) = extracted.and_then(sanitize_visible_text) {
            messages.push(text);
        }
    }
    Ok(messages)
}

fn codex_visible_message(value: &Value) -> Option<String> {
    if value.get("type")?.as_str()? != "response_item" {
        return None;
    }
    let payload = value.get("payload")?;
    if payload.get("type")?.as_str()? != "message" {
        return None;
    }
    let role = payload.get("role")?.as_str()?;
    if !matches!(role, "user" | "assistant") {
        return None;
    }
    visible_content(
        payload.get("content")?,
        &["input_text", "output_text", "text"],
    )
}

fn claude_visible_message(value: &Value) -> Option<String> {
    let kind = value.get("type")?.as_str()?;
    if !matches!(kind, "user" | "assistant")
        || value.get("isMeta").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let message = value.get("message")?;
    let role = message.get("role").and_then(Value::as_str).unwrap_or(kind);
    if !matches!(role, "user" | "assistant") {
        return None;
    }
    visible_content(message.get("content")?, &["text"])
}

fn visible_content(content: &Value, allowed_types: &[&str]) -> Option<String> {
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
                .is_some_and(|kind| allowed_types.contains(&kind))
        })
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n");
    (!text.is_empty()).then_some(text)
}

fn sanitize_visible_text(text: String) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || contains_credential(trimmed) {
        return None;
    }
    Some(trimmed.to_owned())
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

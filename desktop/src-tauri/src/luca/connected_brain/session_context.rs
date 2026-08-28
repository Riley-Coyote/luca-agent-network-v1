use std::{collections::BTreeMap, path::Path};

use luca_protocol::{ConnectedBrainIndexEntryV1, ConnectedBrainSourceKindV1, OpaqueId};
use sha2::{Digest, Sha256};

use super::{index::read_verified_session_excerpts, sessions};

const MAX_LISTED_SESSIONS: usize = 200;
const MAX_TITLE_CHARS: usize = 96;
const MAX_PREVIEW_CHARS: usize = 180;
const MAX_CONTEXT_EXCERPTS: usize = 6;
const MAX_CONTEXT_EXCERPT_CHARS: usize = 420;
const MAX_CONTEXT_SUMMARY_CHARS: usize = 3_000;

#[derive(Clone, Debug)]
pub(crate) struct IndexedSessionSummaryV1 {
    pub session_id: OpaqueId,
    pub title: String,
    pub preview: String,
    pub visible_message_count: usize,
    pub updated_at: Option<String>,
    pub available: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct IndexedSessionListV1 {
    pub sessions: Vec<IndexedSessionSummaryV1>,
    pub total_sessions: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct IndexedSessionContextV1 {
    pub session_id: OpaqueId,
    pub title: String,
    pub summary: String,
    pub visible_message_count: usize,
    pub updated_at: Option<String>,
}

struct IndexedSession<'a> {
    session_id: OpaqueId,
    relative_locator: &'a str,
    entries: Vec<&'a ConnectedBrainIndexEntryV1>,
    updated_at: Option<String>,
}

pub(crate) fn list_indexed_sessions(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    source_id: &OpaqueId,
    entries: &[ConnectedBrainIndexEntryV1],
) -> Result<IndexedSessionListV1, String> {
    let mut sessions = grouped_sessions(root, kind, source_id, entries)?;
    let total_sessions = sessions.len();
    sessions.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.relative_locator.cmp(left.relative_locator))
    });
    sessions.truncate(MAX_LISTED_SESSIONS);

    let sessions = sessions
        .into_iter()
        .map(|session| {
            let selected_entries = list_entry_indices(session.entries.len())
                .into_iter()
                .filter_map(|index| session.entries.get(index).copied())
                .collect::<Vec<_>>();
            let verified = read_verified_session_excerpts(root, kind, &selected_entries).ok();
            let first_excerpt = verified.as_ref().and_then(|values| values.first());
            let preview_excerpt = verified.as_ref().and_then(|values| values.last());
            let available = first_excerpt.is_some() && preview_excerpt.is_some();
            IndexedSessionSummaryV1 {
                session_id: session.session_id,
                title: first_excerpt
                    .map(String::as_str)
                    .map(|text| bounded_single_line(text, MAX_TITLE_CHARS))
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| "Session needs refresh".to_owned()),
                preview: preview_excerpt
                    .map(String::as_str)
                    .map(|text| bounded_single_line(text, MAX_PREVIEW_CHARS))
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| {
                        "Its indexed visible excerpts changed on disk. Refresh Brain to use it."
                            .to_owned()
                    }),
                visible_message_count: session.entries.len(),
                updated_at: session.updated_at,
                available,
            }
        })
        .collect();

    Ok(IndexedSessionListV1 {
        sessions,
        total_sessions,
    })
}

pub(crate) fn context_for_indexed_session(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    source_id: &OpaqueId,
    entries: &[ConnectedBrainIndexEntryV1],
    requested_session_id: &OpaqueId,
) -> Result<Option<IndexedSessionContextV1>, String> {
    let sessions = grouped_sessions(root, kind, source_id, entries)?;
    let Some(session) = sessions
        .into_iter()
        .find(|session| session.session_id == *requested_session_id)
    else {
        return Ok(None);
    };

    let selected_entries = context_entry_indices(session.entries.len())
        .into_iter()
        .map(|index| {
            session
                .entries
                .get(index)
                .copied()
                .ok_or_else(|| "connected session index is invalid".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let selected_excerpts = read_verified_session_excerpts(root, kind, &selected_entries)
        .map_err(|_| "connected session needs refresh".to_owned())?;
    let mut excerpts = Vec::with_capacity(selected_excerpts.len());
    for excerpt in selected_excerpts {
        let excerpt = bounded_single_line(&excerpt, MAX_CONTEXT_EXCERPT_CHARS);
        if !excerpt.is_empty() {
            excerpts.push(excerpt);
        }
    }
    if excerpts.is_empty() {
        return Err("connected session contains no visible excerpts".to_owned());
    }

    let title = excerpts
        .first()
        .map(|text| bounded_single_line(text, MAX_TITLE_CHARS))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Local session".to_owned());
    let mut summary = format!(
        "{} visible messages were indexed. Selected visible excerpts:",
        session.entries.len()
    );
    for excerpt in excerpts {
        let next = format!("\n\n- {excerpt}");
        if summary.chars().count() + next.chars().count() > MAX_CONTEXT_SUMMARY_CHARS {
            break;
        }
        summary.push_str(&next);
    }

    Ok(Some(IndexedSessionContextV1 {
        session_id: session.session_id,
        title,
        summary,
        visible_message_count: session.entries.len(),
        updated_at: session.updated_at,
    }))
}

fn grouped_sessions<'a>(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    source_id: &OpaqueId,
    entries: &'a [ConnectedBrainIndexEntryV1],
) -> Result<Vec<IndexedSession<'a>>, String> {
    if kind == ConnectedBrainSourceKindV1::Repository {
        return Err("repository sources do not contain runtime sessions".to_owned());
    }
    let mut grouped = BTreeMap::<&str, Vec<&ConnectedBrainIndexEntryV1>>::new();
    for entry in entries {
        entry
            .validate()
            .map_err(|_| "connected session index is invalid".to_owned())?;
        if entry.source_id != *source_id {
            return Err("connected session index source is invalid".to_owned());
        }
        grouped
            .entry(entry.relative_locator.as_str())
            .or_default()
            .push(entry);
    }

    grouped
        .into_iter()
        .map(|(relative_locator, mut entries)| {
            entries.sort_by(|left, right| left.ordinal.cmp(&right.ordinal));
            if entries
                .windows(2)
                .any(|pair| pair[0].ordinal == pair[1].ordinal)
            {
                return Err("connected session index contains duplicate messages".to_owned());
            }
            Ok(IndexedSession {
                session_id: session_id(source_id, relative_locator)?,
                relative_locator,
                updated_at: sessions::session_updated_at(root, kind, relative_locator),
                entries,
            })
        })
        .collect()
}

fn session_id(source_id: &OpaqueId, relative_locator: &str) -> Result<OpaqueId, String> {
    let mut digest = Sha256::new();
    digest.update(b"polyphonic-indexed-session-context-v1\0");
    digest.update(source_id.as_str().as_bytes());
    digest.update(b"\0");
    digest.update(relative_locator.as_bytes());
    OpaqueId::parse(format!("session-{}", hex::encode(digest.finalize())))
        .map_err(|_| "connected session ID is invalid".to_owned())
}

fn context_entry_indices(entry_count: usize) -> Vec<usize> {
    (0..entry_count.min(MAX_CONTEXT_EXCERPTS)).collect()
}

fn list_entry_indices(entry_count: usize) -> Vec<usize> {
    match entry_count {
        0 => Vec::new(),
        1 => vec![0],
        _ => vec![0, (entry_count - 1).min(MAX_CONTEXT_EXCERPTS - 1)],
    }
}

fn bounded_single_line(text: &str, max_chars: usize) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_chars {
        return normalized;
    }
    let mut bounded = normalized
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    bounded.push('…');
    bounded
}

#[cfg(test)]
mod tests {
    use std::{fs, time::Instant};

    use luca_protocol::ConnectedBrainSourceKindV1;
    use tempfile::tempdir;

    use super::*;
    use crate::luca::connected_brain::{build_index, ConnectedBrainDiscoveryCandidateV1};

    #[test]
    fn indexed_context_contains_only_bounded_visible_messages() {
        let root = tempdir().unwrap();
        let session_path = root.path().join("2026/08/28/session-native-id.jsonl");
        fs::create_dir_all(session_path.parent().unwrap()).unwrap();
        fs::write(
            &session_path,
            [
                r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>private ambient prompt at /Users/riley/secret</environment_context>"}]}}"#,
                r#"{"type":"event_msg","payload":{"type":"user_message","client_id":"fixture","message":"<in-app-browser-context source=\"browser\">private browser state at /Users/riley/browser</in-app-browser-context>\nPlan the checkpoint from /Users/riley/Projects/Polyphonic.","images":[],"local_images":[],"text_elements":[]}}"#,
                r#"{"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"private tool payload"}}"#,
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Internal progress at /Volumes/Private/worktree."}]}}"#,
                r#"{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Keep the handoff local, bounded, and visible at /Volumes/LaCie/Polyphonic."}]}}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        let canonical_root = root.path().canonicalize().unwrap();
        let source_id = OpaqueId::parse("connected-session-test").unwrap();
        let candidate = ConnectedBrainDiscoveryCandidateV1 {
            discovery_id: OpaqueId::parse("discovery-session-test").unwrap(),
            source_kind: ConnectedBrainSourceKindV1::CodexHistory,
            display_name: "Codex".to_owned(),
            canonical_root: canonical_root.clone(),
            item_count: 1,
            earliest_at: None,
            latest_at: None,
            discovered_at: Instant::now(),
        };
        let build = build_index(&source_id, &candidate).unwrap();

        let list = list_indexed_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &build.entries,
        )
        .unwrap();
        assert_eq!(list.total_sessions, 1);
        assert_eq!(list.sessions[0].visible_message_count, 2);
        assert!(list.sessions[0].available);
        assert!(list.sessions[0].title.contains("Plan the checkpoint"));
        assert!(!list.sessions[0].session_id.as_str().contains("native-id"));

        let context = context_for_indexed_session(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &build.entries,
            &list.sessions[0].session_id,
        )
        .unwrap()
        .unwrap();
        assert!(context.summary.contains("Plan the checkpoint"));
        assert!(context.summary.contains("Keep the handoff local"));
        assert!(context.summary.contains("[local path]"));
        assert!(!context.summary.contains("environment_context"));
        assert!(!context.summary.contains("private ambient prompt"));
        assert!(!context.summary.contains("Internal progress"));
        assert!(!context.summary.contains("/Users/"));
        assert!(!context.summary.contains("/Volumes/"));
        assert!(!context.summary.contains("private tool payload"));
        assert!(!context.summary.contains("session-native-id"));
        assert!(context.summary.chars().count() <= MAX_CONTEXT_SUMMARY_CHARS);
    }
}

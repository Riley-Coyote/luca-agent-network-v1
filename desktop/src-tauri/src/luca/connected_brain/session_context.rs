use std::{collections::HashSet, path::Path};

use luca_protocol::{ConnectedBrainSourceKindV1, OpaqueId};
use sha2::{Digest, Sha256};

use super::sessions;

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

/// Build the session rail from lightweight native file metadata rather than
/// from the bounded Brain search index. The index may intentionally retain
/// only a subset of a large history; catalogue browsing must not inherit that
/// truncation.
pub(crate) fn list_native_sessions(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    source_id: &OpaqueId,
    budget: &mut sessions::SessionReadBudget,
    excluded_provider_session_ids: &HashSet<String>,
) -> Result<IndexedSessionListV1, String> {
    if kind == ConnectedBrainSourceKindV1::Repository {
        return Err("repository sources do not contain runtime sessions".to_owned());
    }
    let files =
        sessions::session_file_metadata_excluding(root, kind, excluded_provider_session_ids)?;
    let total_sessions = files.len();
    let mut projected = Vec::with_capacity(total_sessions.min(MAX_LISTED_SESSIONS));
    for file in files.into_iter().take(MAX_LISTED_SESSIONS) {
        if budget.is_exhausted() {
            break;
        }
        let excerpts =
            match sessions::read_visible_prefix(root, kind, &file.relative_locator, 2, budget) {
                Ok(excerpts) => excerpts,
                Err(_) if budget.is_exhausted() => break,
                Err(_) => continue,
            };
        let Some(first) = excerpts.first() else {
            continue;
        };
        let title = bounded_single_line(first, MAX_TITLE_CHARS);
        if title.is_empty() {
            continue;
        }
        let preview = excerpts.get(1).unwrap_or(first).as_str();
        projected.push(IndexedSessionSummaryV1 {
            session_id: session_id(source_id, &file.relative_locator)?,
            title,
            preview: bounded_single_line(preview, MAX_PREVIEW_CHARS),
            visible_message_count: excerpts.len(),
            updated_at: file.updated_at,
            available: true,
        });
    }
    Ok(IndexedSessionListV1 {
        sessions: projected,
        total_sessions,
    })
}

/// Resolve a catalogue selection lazily from the authoritative native file.
/// The opaque ID is derived from the connected source and private locator, so
/// neither native path nor provider session identifier crosses IPC.
pub(crate) fn context_for_native_session(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    source_id: &OpaqueId,
    requested_session_id: &OpaqueId,
    excluded_provider_session_ids: &HashSet<String>,
) -> Result<Option<IndexedSessionContextV1>, String> {
    if kind == ConnectedBrainSourceKindV1::Repository {
        return Err("repository sources do not contain runtime sessions".to_owned());
    }
    let selected =
        sessions::session_file_metadata_excluding(root, kind, excluded_provider_session_ids)?
            .into_iter()
            .find_map(|file| {
                let candidate = session_id(source_id, &file.relative_locator).ok()?;
                (candidate == *requested_session_id).then_some((file, candidate))
            });
    let Some((file, selected_session_id)) = selected else {
        return Ok(None);
    };
    let mut budget = sessions::SessionReadBudget::for_context();
    let selected_excerpts = sessions::read_visible_prefix(
        root,
        kind,
        &file.relative_locator,
        MAX_CONTEXT_EXCERPTS,
        &mut budget,
    )?;
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
    let title = bounded_single_line(&excerpts[0], MAX_TITLE_CHARS);
    let mut summary = "Selected visible excerpts from this local session:".to_owned();
    for excerpt in &excerpts {
        let next = format!("\n\n- {excerpt}");
        if summary.chars().count() + next.chars().count() > MAX_CONTEXT_SUMMARY_CHARS {
            break;
        }
        summary.push_str(&next);
    }
    Ok(Some(IndexedSessionContextV1 {
        session_id: selected_session_id,
        title,
        summary,
        visible_message_count: excerpts.len(),
        updated_at: file.updated_at,
    }))
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
    use std::fs;

    use luca_protocol::ConnectedBrainSourceKindV1;
    use tempfile::tempdir;

    use super::*;
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
        let mut list_budget = sessions::SessionReadBudget::for_rail_list();
        let list = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &mut list_budget,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(list.total_sessions, 1);
        assert_eq!(list.sessions[0].visible_message_count, 2);
        assert!(list.sessions[0].available);
        assert!(list.sessions[0].title.contains("Plan the checkpoint"));
        assert!(!list.sessions[0].session_id.as_str().contains("native-id"));

        let context = context_for_native_session(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &list.sessions[0].session_id,
            &HashSet::new(),
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

    #[test]
    fn rail_list_shares_file_byte_and_line_budgets_across_all_cards() {
        let root = tempdir().unwrap();
        let record = r#"{"type":"event_msg","payload":{"type":"user_message","message":"One bounded visible record."}}"#;
        for index in 0..3 {
            fs::write(root.path().join(format!("session-{index}.jsonl")), record).unwrap();
        }
        let canonical_root = root.path().canonicalize().unwrap();
        let source_id = OpaqueId::parse("connected-session-budget-test").unwrap();
        let second_source_id = OpaqueId::parse("connected-session-budget-test-b").unwrap();
        let mut cross_source_budget = sessions::SessionReadBudget::new(1, 1024 * 1024, 100);
        let first_source = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &mut cross_source_budget,
            &HashSet::new(),
        )
        .unwrap();
        let second_source = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &second_source_id,
            &mut cross_source_budget,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(first_source.sessions.len(), 1);
        assert_eq!(second_source.sessions.len(), 0);
        assert_eq!(second_source.total_sessions, 3);

        let mut file_budget = sessions::SessionReadBudget::new(2, 1024 * 1024, 100);
        let file_limited = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &mut file_budget,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(file_limited.total_sessions, 3);
        assert_eq!(file_limited.sessions.len(), 2);

        let mut byte_budget = sessions::SessionReadBudget::new(3, record.len(), 100);
        let byte_limited = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &mut byte_budget,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(byte_limited.total_sessions, 3);
        assert_eq!(byte_limited.sessions.len(), 1);

        let mut line_budget = sessions::SessionReadBudget::new(3, 1024 * 1024, 1);
        let line_limited = list_native_sessions(
            &canonical_root,
            ConnectedBrainSourceKindV1::CodexHistory,
            &source_id,
            &mut line_budget,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(line_limited.total_sessions, 3);
        assert_eq!(line_limited.sessions.len(), 1);
    }
}

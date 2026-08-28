use std::{collections::BTreeSet, path::Path};

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, ConnectedBrainIndexEntryV1, ConnectedBrainSourceKindV1,
    OpaqueId, SafeU53, Sha256Ref, CONNECTED_BRAIN_PROTOCOL,
};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{repository, sessions, ConnectedBrainDiscoveryCandidateV1};

const INDEX_CHUNK_BYTES: usize = 4096;
const MAX_CONNECTED_INDEX_ENTRIES: usize = 16_384;
// The protocol permits larger token sets, but real conversation messages do not need hundreds of
// hashes to remain searchable. Keeping the generated index compact prevents encrypted continuity
// generations from becoming expensive to validate each time resident access is granted.
const MAX_INDEXED_TOKEN_HASHES_PER_ENTRY: usize = 16;

pub(crate) struct ConnectedBrainIndexBuildV1 {
    pub entries: Vec<ConnectedBrainIndexEntryV1>,
    pub index_revision: Sha256Ref,
    pub refresh_cursor: String,
    pub item_count: usize,
}

pub(crate) fn build_index(
    source_id: &OpaqueId,
    candidate: &ConnectedBrainDiscoveryCandidateV1,
) -> Result<ConnectedBrainIndexBuildV1, String> {
    let mut entries = Vec::new();
    let item_count = match candidate.source_kind {
        ConnectedBrainSourceKindV1::Repository => {
            let documents = repository::documents(&candidate.canonical_root)?;
            let count = documents.len();
            for document in documents {
                push_document_entries(
                    source_id,
                    &document.relative_path,
                    &document.body,
                    None,
                    &mut entries,
                )?;
                if entries.len() >= MAX_CONNECTED_INDEX_ENTRIES {
                    break;
                }
            }
            count
        }
        ConnectedBrainSourceKindV1::CodexHistory | ConnectedBrainSourceKindV1::ClaudeHistory => {
            push_session_entries_until_limit(
                source_id,
                &candidate.canonical_root,
                candidate.source_kind,
                MAX_CONNECTED_INDEX_ENTRIES,
                &mut entries,
            )?;
            candidate.item_count
        }
    };
    if entries.is_empty() {
        return Err("connected source contains no indexable text".to_owned());
    }
    entries.sort_by(|left, right| {
        left.relative_locator
            .cmp(&right.relative_locator)
            .then_with(|| left.ordinal.cmp(&right.ordinal))
            .then_with(|| left.entry_id.cmp(&right.entry_id))
    });
    let revision = canonical_sha256(&entries)
        .map_err(|_| "connected Brain index revision is invalid".to_owned())?;
    let revision = Sha256Ref::parse(format!("sha256:{revision}"))
        .map_err(|_| "connected Brain index revision is invalid".to_owned())?;
    let refresh_cursor = revision.as_str().to_owned();
    Ok(ConnectedBrainIndexBuildV1 {
        entries,
        index_revision: revision,
        refresh_cursor,
        item_count,
    })
}

pub(crate) fn read_verified_excerpt(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    entry: &ConnectedBrainIndexEntryV1,
) -> Result<String, String> {
    entry
        .validate()
        .map_err(|_| "connected Brain index entry is invalid".to_owned())?;
    let body = match kind {
        ConnectedBrainSourceKindV1::Repository => {
            let document = repository::read_document(root, &entry.relative_locator)?;
            normalized_chunks(&document)
                .into_iter()
                .nth(entry.ordinal.get() as usize)
                .ok_or_else(|| "connected repository excerpt changed".to_owned())?
        }
        ConnectedBrainSourceKindV1::CodexHistory | ConnectedBrainSourceKindV1::ClaudeHistory => {
            let message = sessions::read_messages(root, kind, &entry.relative_locator)?
                .into_iter()
                .nth(entry.ordinal.get() as usize)
                .ok_or_else(|| "connected session excerpt changed".to_owned())?;
            normalized_chunks(&message)
                .into_iter()
                .next()
                .ok_or_else(|| "connected session excerpt changed".to_owned())?
        }
    };
    let actual = content_hash(&body)?;
    if actual != entry.content_hash {
        return Err("connected source excerpt hash changed".to_owned());
    }
    Ok(body)
}

/// Verify a bounded selection from one session file in a single streaming
/// pass. Unlike `read_verified_excerpt`, this path never materializes the
/// transcript and is used by the runtime-session panel/context handoff only.
pub(super) fn read_verified_session_excerpts(
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    entries: &[&ConnectedBrainIndexEntryV1],
    budget: &mut sessions::SessionReadBudget,
) -> Result<Vec<String>, String> {
    if entries.is_empty() || kind == ConnectedBrainSourceKindV1::Repository || entries.len() > 8 {
        return Err("connected session selection is invalid".to_owned());
    }
    let relative_locator = entries[0].relative_locator.as_str();
    let mut ordinals = BTreeSet::new();
    for entry in entries {
        entry
            .validate()
            .map_err(|_| "connected session index entry is invalid".to_owned())?;
        if entry.relative_locator != relative_locator {
            return Err("connected session selection spans multiple files".to_owned());
        }
        let ordinal = usize::try_from(entry.ordinal.get())
            .map_err(|_| "connected session ordinal is invalid".to_owned())?;
        if !ordinals.insert(ordinal) {
            return Err("connected session selection contains duplicates".to_owned());
        }
    }
    let messages =
        sessions::read_messages_at_ordinals(root, kind, relative_locator, &ordinals, budget)?;
    entries
        .iter()
        .map(|entry| {
            let ordinal = usize::try_from(entry.ordinal.get())
                .map_err(|_| "connected session ordinal is invalid".to_owned())?;
            let message = messages
                .get(&ordinal)
                .ok_or_else(|| "connected session excerpt changed".to_owned())?;
            let body = normalized_chunks(message)
                .into_iter()
                .next()
                .ok_or_else(|| "connected session excerpt changed".to_owned())?;
            if content_hash(&body)? != entry.content_hash {
                return Err("connected source excerpt hash changed".to_owned());
            }
            Ok(body)
        })
        .collect()
}

fn push_session_entries_until_limit(
    source_id: &OpaqueId,
    root: &Path,
    kind: ConnectedBrainSourceKindV1,
    entry_limit: usize,
    entries: &mut Vec<ConnectedBrainIndexEntryV1>,
) -> Result<(), String> {
    if entry_limit == 0 || entries.len() >= entry_limit {
        return Ok(());
    }
    sessions::visit_messages(root, kind, |relative_path, ordinal, message| {
        push_message_entry(source_id, relative_path, ordinal, &message, entries)?;
        Ok(entries.len() < entry_limit)
    })
}

fn push_document_entries(
    source_id: &OpaqueId,
    relative_path: &str,
    body: &str,
    captured_at: Option<CanonicalTimestamp>,
    entries: &mut Vec<ConnectedBrainIndexEntryV1>,
) -> Result<(), String> {
    for (ordinal, chunk) in normalized_chunks(body).into_iter().enumerate() {
        push_entry(
            source_id,
            relative_path,
            ordinal,
            &chunk,
            captured_at.clone(),
            entries,
        )?;
        if entries.len() >= MAX_CONNECTED_INDEX_ENTRIES {
            break;
        }
    }
    Ok(())
}

fn push_message_entry(
    source_id: &OpaqueId,
    relative_path: &str,
    ordinal: usize,
    message: &str,
    entries: &mut Vec<ConnectedBrainIndexEntryV1>,
) -> Result<(), String> {
    // Each visible message is one stable locator. Oversized messages are
    // bounded before hashing rather than turning one JSONL line into a body copy.
    let body = normalized_chunks(message)
        .into_iter()
        .next()
        .ok_or_else(|| "connected session message is empty".to_owned())?;
    push_entry(source_id, relative_path, ordinal, &body, None, entries)
}

fn push_entry(
    source_id: &OpaqueId,
    relative_path: &str,
    ordinal: usize,
    body: &str,
    captured_at: Option<CanonicalTimestamp>,
    entries: &mut Vec<ConnectedBrainIndexEntryV1>,
) -> Result<(), String> {
    let content_hash = content_hash(body)?;
    let token_hashes = hashed_tokens(body)?;
    if token_hashes.is_empty() {
        return Ok(());
    }
    let ordinal = SafeU53::new(ordinal as u64)
        .map_err(|_| "connected Brain entry ordinal is invalid".to_owned())?;
    let id_hash = canonical_sha256(&json!({
        "source_id": source_id,
        "relative_locator": relative_path,
        "ordinal": ordinal,
        "content_hash": content_hash,
    }))
    .map_err(|_| "connected Brain entry ID is invalid".to_owned())?;
    let entry = ConnectedBrainIndexEntryV1 {
        protocol: CONNECTED_BRAIN_PROTOCOL.to_owned(),
        entry_id: OpaqueId::parse(format!(
            "entry-{}",
            id_hash.as_str().trim_start_matches("sha256:")
        ))
        .map_err(|_| "connected Brain entry ID is invalid".to_owned())?,
        source_id: source_id.clone(),
        relative_locator: relative_path.to_owned(),
        ordinal,
        content_hash,
        token_hashes,
        captured_at,
    };
    entry
        .validate()
        .map_err(|_| "connected Brain index entry is invalid".to_owned())?;
    entries.push(entry);
    Ok(())
}

fn normalized_chunks(text: &str) -> Vec<String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut remaining = normalized.trim();
    let mut chunks = Vec::new();
    while !remaining.is_empty() {
        let mut end = remaining.len().min(INDEX_CHUNK_BYTES);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        let body = remaining[..end].trim();
        if !body.is_empty() {
            chunks.push(body.to_owned());
        }
        remaining = remaining[end..].trim_start();
    }
    chunks
}

fn hashed_tokens(text: &str) -> Result<Vec<Sha256Ref>, String> {
    let mut tokens = text
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .map(str::trim)
        .filter(|token| token.len() >= 2)
        .map(str::to_lowercase)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(MAX_INDEXED_TOKEN_HASHES_PER_ENTRY)
        .map(|token| content_hash(&token))
        .collect::<Result<Vec<_>, _>>()?;
    tokens.sort();
    Ok(tokens)
}

fn content_hash(text: &str) -> Result<Sha256Ref, String> {
    let mut digest = Sha256::new();
    digest.update(text.as_bytes());
    Sha256Ref::parse(format!("sha256:{}", hex::encode(digest.finalize())))
        .map_err(|_| "connected Brain content hash is invalid".to_owned())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use tempfile::tempdir;

    #[test]
    fn generated_token_metadata_stays_compact() {
        let text = (0..256)
            .map(|index| format!("searchable-token-{index:03}"))
            .collect::<Vec<_>>()
            .join(" ");

        let hashes = hashed_tokens(&text).unwrap();

        assert_eq!(hashes.len(), MAX_INDEXED_TOKEN_HASHES_PER_ENTRY);
        assert!(hashes.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn session_index_stops_at_the_requested_entry_limit() {
        let root = tempdir().unwrap();
        fs::write(
            root.path().join("session.jsonl"),
            [
                r#"{"type":"event_msg","payload":{"type":"user_message","message":"First visible record."}}"#,
                r#"{"type":"event_msg","payload":{"type":"user_message","message":"Second record must be beyond the index limit."}}"#,
            ]
            .join("\n"),
        )
        .unwrap();
        let source_id = OpaqueId::parse("source-stream-limit").unwrap();
        let mut entries = Vec::new();

        push_session_entries_until_limit(
            &source_id,
            root.path(),
            ConnectedBrainSourceKindV1::CodexHistory,
            1,
            &mut entries,
        )
        .unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ordinal.get(), 0);
    }
}

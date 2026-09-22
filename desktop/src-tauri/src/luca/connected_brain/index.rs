use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, ConnectedBrainIndexEntryV1, ConnectedBrainSourceKindV1,
    OpaqueId, SafeU53, Sha256Ref, CONNECTED_BRAIN_PROTOCOL,
};
use serde::{Deserialize, Serialize};
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
    pub files: BTreeMap<String, IndexedFile>,
    pub expected_generation: Option<Sha256Ref>,
    #[cfg(test)]
    pub reused_files: usize,
    #[cfg(test)]
    pub extracted_files: usize,
}

/// Private, encrypted optimization metadata; never source text or authority.
/// Bump the fingerprint domain when extraction/tokenization rules change.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IndexedFile {
    pub fingerprint: String,
    pub entry_count: usize,
}

#[derive(Default)]
pub(crate) struct PriorIndex {
    pub established: bool,
    pub expected_generation: Option<Sha256Ref>,
    pub files: BTreeMap<String, IndexedFile>,
    pub entries: Vec<ConnectedBrainIndexEntryV1>,
}

fn file_fingerprint(root: &Path, relative: &str) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "index source is unavailable")?;
    let path = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "index file is unavailable")?;
    if !path.starts_with(&root) {
        return Err("index file escaped its source".into());
    }
    let metadata = path.metadata().map_err(|_| "index file is unavailable")?;
    if !metadata.is_file() {
        return Err("index file is unavailable".into());
    }
    let mut digest = Sha256::new();
    digest.update(b"connected-file-index-v1\0");
    digest.update(path.as_os_str().as_encoded_bytes());
    digest.update(metadata.len().to_le_bytes());
    digest.update(format!(
        "{:?}",
        metadata
            .modified()
            .map_err(|_| "index file timestamp unavailable")?
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        for value in [
            metadata.dev(),
            metadata.ino(),
            metadata.ctime() as u64,
            metadata.ctime_nsec() as u64,
        ] {
            digest.update(value.to_le_bytes());
        }
    }
    // On platforms without a change counter, hash the bounded indexable prefix
    // rather than trusting a user-restorable mtime. Never read a whole growing
    // transcript just to fingerprint it. Parsing/tokenization can be reused.
    #[cfg(not(unix))]
    {
        use std::io::Read;
        let mut file = std::fs::File::open(path)
            .map_err(|_| "index file is unavailable")?
            .take(sessions::MAX_INDEX_SESSION_BYTES as u64);
        let mut buffer = [0; 8192];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|_| "index file is unavailable")?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
    }
    Ok(hex::encode(digest.finalize()))
}

pub(crate) fn build_index(
    source_id: &OpaqueId,
    candidate: &ConnectedBrainDiscoveryCandidateV1,
) -> Result<ConnectedBrainIndexBuildV1, String> {
    build_index_incremental(source_id, candidate, &PriorIndex::default())
}

pub(crate) fn build_index_incremental(
    source_id: &OpaqueId,
    candidate: &ConnectedBrainDiscoveryCandidateV1,
    prior: &PriorIndex,
) -> Result<ConnectedBrainIndexBuildV1, String> {
    build_index_with_limit(source_id, candidate, prior, MAX_CONNECTED_INDEX_ENTRIES)
}

fn build_index_with_limit(
    source_id: &OpaqueId,
    candidate: &ConnectedBrainDiscoveryCandidateV1,
    prior: &PriorIndex,
    entry_limit: usize,
) -> Result<ConnectedBrainIndexBuildV1, String> {
    let mut entries = Vec::new();
    let mut files = BTreeMap::new();
    let mut _reused_files = 0;
    let mut _extracted_files = 0;
    let mut document_count = 0;
    let mut previous = BTreeMap::<&str, Vec<ConnectedBrainIndexEntryV1>>::new();
    for entry in &prior.entries {
        if &entry.source_id == source_id {
            previous
                .entry(&entry.relative_locator)
                .or_default()
                .push(entry.clone());
        }
    }
    let mut visit = |relative_path: &str| -> Result<bool, String> {
        let before = file_fingerprint(&candidate.canonical_root, relative_path)?;
        let cached = previous.get(relative_path);
        let reusable = prior.files.get(relative_path).is_some_and(|file| {
            file.fingerprint == before && file.entry_count == cached.map_or(0, Vec::len)
        });
        if reusable {
            _reused_files += 1;
            if candidate.source_kind == ConnectedBrainSourceKindV1::Repository {
                document_count += 1;
            }
        } else {
            _extracted_files += 1;
        }
        let mut file_entries = if reusable {
            cached.cloned().unwrap_or_default()
        } else {
            Vec::new()
        };
        if !reusable {
            match candidate.source_kind {
                ConnectedBrainSourceKindV1::Repository => {
                    // Preserve repository exclusions (binary, credentials, unreadable files).
                    if let Ok(body) =
                        repository::read_document(&candidate.canonical_root, relative_path)
                    {
                        document_count += 1;
                        push_document_entries(
                            source_id,
                            relative_path,
                            &body,
                            None,
                            &mut file_entries,
                        )?;
                    }
                }
                kind => {
                    let mut budget = sessions::SessionReadBudget::new(
                        1,
                        sessions::MAX_INDEX_SESSION_BYTES,
                        sessions::MAX_INDEX_SESSION_LINES,
                    );
                    for (ordinal, message) in sessions::read_visible_prefix(
                        &candidate.canonical_root,
                        kind,
                        relative_path,
                        sessions::MAX_INDEXED_MESSAGES_PER_SESSION,
                        &mut budget,
                    )?
                    .into_iter()
                    .enumerate()
                    {
                        push_message_entry(
                            source_id,
                            relative_path,
                            ordinal,
                            &message,
                            &mut file_entries,
                        )?;
                    }
                }
            }
        }
        if before != file_fingerprint(&candidate.canonical_root, relative_path)? {
            return Err("connected source changed during refresh; retry".into());
        }
        let remaining = entry_limit - entries.len();
        // Partial files must be read again if budget becomes available later.
        if file_entries.len() <= remaining && !file_entries.is_empty() {
            files.insert(
                relative_path.to_owned(),
                IndexedFile {
                    fingerprint: before,
                    entry_count: file_entries.len(),
                },
            );
        }
        file_entries.truncate(remaining);
        entries.extend(file_entries);
        Ok(entries.len() < entry_limit)
    };
    let item_count = match candidate.source_kind {
        ConnectedBrainSourceKindV1::Repository => {
            repository::visit_paths(&candidate.canonical_root, &mut visit)?;
            document_count
        }
        ConnectedBrainSourceKindV1::CodexHistory | ConnectedBrainSourceKindV1::ClaudeHistory => {
            let inventory = sessions::session_index_file_metadata(
                &candidate.canonical_root,
                candidate.source_kind,
                &|path| {
                    let Some(relative) = path
                        .strip_prefix(&candidate.canonical_root)
                        .ok()
                        .and_then(Path::to_str)
                    else {
                        return false;
                    };
                    let relative = relative.replace('\\', "/");
                    let Some(file) = prior.files.get(&relative) else {
                        return false;
                    };
                    previous
                        .get(relative.as_str())
                        .is_some_and(|entries| entries.len() == file.entry_count)
                        && file_fingerprint(&candidate.canonical_root, &relative)
                            .is_ok_and(|value| value == file.fingerprint)
                },
            )?;
            let count = inventory.len();
            for session in inventory {
                if !visit(&session.relative_locator)? {
                    break;
                }
            }
            count
        }
    };
    if entries.is_empty() && !prior.established {
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
        files,
        expected_generation: prior.expected_generation.clone(),
        #[cfg(test)]
        reused_files: _reused_files,
        #[cfg(test)]
        extracted_files: _extracted_files,
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
        let candidate = ConnectedBrainDiscoveryCandidateV1 {
            discovery_id: OpaqueId::parse("discovery-stream-limit").unwrap(),
            source_kind: ConnectedBrainSourceKindV1::CodexHistory,
            display_name: "fixture".into(),
            canonical_root: root.path().canonicalize().unwrap(),
            item_count: 1,
            earliest_at: None,
            latest_at: None,
            discovered_at: std::time::Instant::now(),
        };
        let built =
            build_index_with_limit(&source_id, &candidate, &PriorIndex::default(), 1).unwrap();
        assert_eq!(built.entries.len(), 1);
        assert_eq!(built.entries[0].ordinal.get(), 0);
        assert!(
            built.files.is_empty(),
            "partial files must not be reused as complete"
        );
    }
}

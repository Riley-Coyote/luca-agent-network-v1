//! Bounded, metadata-only permission recovery from exact native transcripts.
use super::{
    canonical_folder, exact_uuid, ClaudeMetadataRow, CLAUDE_POLICY_CHUNK_BYTES, LOOKUP_TIMEOUT,
    MAX_CLAUDE_POLICY_SCAN_BYTES, MAX_METADATA_BYTES,
};
use luca_protocol::{NativeCodexPolicyV1, NativeCodexSandboxV1};
use serde::Deserialize;
use std::{
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom},
    path::Path,
    time::Instant,
};
use uuid::Uuid;

enum Row<T> {
    Empty,
    Policy(Option<T>),
    Invalid,
}

fn latest<T>(
    reader: &mut BufReader<File>,
    mut parse: impl FnMut(&[u8]) -> Result<Row<T>, String>,
) -> Result<Option<T>, String> {
    let mut position = reader
        .get_ref()
        .metadata()
        .map_err(|_| "Native metadata unavailable")?
        .len();
    if position > 0 {
        reader
            .seek(SeekFrom::End(-1))
            .map_err(|_| "Native metadata unavailable")?;
        let mut terminator = [0];
        reader
            .read_exact(&mut terminator)
            .map_err(|_| "Native metadata unavailable")?;
        if terminator[0] != b'\n' {
            return Ok(None);
        }
    }
    let mut scanned = 0;
    let mut partial = Vec::new();
    let mut newest: Option<Option<T>> = None;
    let started = Instant::now();
    while position > 0 && scanned < MAX_CLAUDE_POLICY_SCAN_BYTES {
        if started.elapsed() > LOOKUP_TIMEOUT {
            return Ok(None);
        }
        let count = position
            .min(CLAUDE_POLICY_CHUNK_BYTES as u64)
            .min((MAX_CLAUDE_POLICY_SCAN_BYTES - scanned) as u64) as usize;
        position -= count as u64;
        reader
            .seek(SeekFrom::Start(position))
            .map_err(|_| "Native metadata unavailable")?;
        let mut bytes = vec![0; count];
        reader
            .read_exact(&mut bytes)
            .map_err(|_| "Native metadata unavailable")?;
        scanned += count;
        bytes.append(&mut partial);
        let start = if position == 0 {
            0
        } else if let Some(end) = bytes.iter().position(|b| *b == b'\n') {
            end + 1
        } else {
            if bytes.len() > MAX_METADATA_BYTES {
                return Ok(None);
            }
            partial = bytes;
            continue;
        };
        for line in bytes[start..]
            .split(|b| *b == b'\n')
            .rev()
            .filter(|line| !line.is_empty())
        {
            if line.len() > MAX_METADATA_BYTES {
                return Ok(None);
            }
            match parse(line)? {
                Row::Invalid => return Ok(None),
                Row::Policy(policy) if newest.is_none() => newest = Some(policy),
                _ => {}
            }
        }
        // Check at least the original tail's identity window, even if policy
        // sits at EOF. An unknown newest policy never falls back to an older one.
        if newest.is_some() && (scanned >= MAX_METADATA_BYTES || position == 0) {
            return Ok(newest.flatten());
        }
        partial = bytes[..start.saturating_sub(1)].to_vec();
        if partial.len() > MAX_METADATA_BYTES {
            return Ok(None);
        }
    }
    Ok(None)
}

pub(super) fn claude(
    reader: &mut BufReader<File>,
    native_id: Uuid,
    original_cwd: &Path,
) -> Result<Option<String>, String> {
    latest(reader, |line| {
        let Ok(row) = serde_json::from_slice::<ClaudeMetadataRow>(line) else {
            return Ok(Row::Invalid);
        };
        if row.is_sidechain == Some(true) {
            return Err("The selected Claude file contains sidechain metadata.".into());
        }
        if let Some(id) = row.session_id.as_deref() {
            if exact_uuid(id)? != native_id {
                return Err(
                    "Claude tail identity differs from the selected native session.".into(),
                );
            }
        }
        if let Some(folder) = row.cwd.as_deref() {
            if row.session_id.is_none() || canonical_folder(folder)? != original_cwd {
                return Err("The selected Claude session working folder changed.".into());
            }
        }
        let Some(policy) = row.permission_mode else {
            return Ok(Row::Empty);
        };
        if row.session_id.is_none() {
            return Err("Claude permission metadata has no native identity.".into());
        }
        Ok(Row::Policy(match policy.as_str() {
            "manual" | "default" => Some("default".into()),
            "auto" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions" => Some(policy),
            _ => None,
        }))
    })
}

pub(super) fn codex(
    reader: &mut BufReader<File>,
    native_id: Uuid,
    original_cwd: &Path,
) -> Result<Option<NativeCodexPolicyV1>, String> {
    #[derive(Deserialize)]
    struct Header {
        #[serde(rename = "type")]
        kind: String,
        payload: serde_json::Value,
    }
    latest(reader, |line| {
        let Ok(row) = serde_json::from_slice::<Header>(line) else {
            return Ok(Row::Invalid);
        };
        if row.kind == "session_meta" {
            if row
                .payload
                .get("id")
                .and_then(|id| id.as_str())
                .map(exact_uuid)
                .transpose()?
                != Some(native_id)
            {
                return Err("Codex tail identity differs from the selected native session.".into());
            }
        }
        if !matches!(row.kind.as_str(), "session_meta" | "turn_context") {
            return Ok(Row::Empty);
        }
        let Some(cwd) = row.payload.get("cwd").and_then(|cwd| cwd.as_str()) else {
            return Ok(Row::Invalid);
        };
        if canonical_folder(cwd)? != original_cwd {
            return Err("The selected Codex session working folder changed.".into());
        }
        if row.kind != "turn_context" {
            return Ok(Row::Empty);
        }
        let policy = serde_json::from_value::<NativeCodexPolicyV1>(serde_json::json!({
            "approval_policy": row.payload.get("approval_policy"),
            "approvals_reviewer": row.payload.get("approvals_reviewer").cloned().unwrap_or(serde_json::json!("user")),
            "sandbox_policy": row.payload.get("sandbox_policy"),
        }))
        .ok()
        .filter(|policy| {
            policy.is_bounded()
                && standard_codex_profile(row.payload.get("permission_profile"), policy, original_cwd)
        });
        Ok(Row::Policy(policy))
    })
}

/// New native versions also record a richer profile. Accept it only when it is
/// exactly the standard legacy sandbox projection; custom restrictions cannot
/// be discarded by replaying the coarser `--sandbox` flag.
pub(super) fn standard_codex_profile(
    profile: Option<&serde_json::Value>,
    policy: &NativeCodexPolicyV1,
    cwd: &Path,
) -> bool {
    use serde_json::json;
    let Some(profile) = profile else {
        return true;
    }; // Legacy native records.
    if matches!(
        policy.sandbox_policy,
        NativeCodexSandboxV1::DangerFullAccess {}
    ) {
        return profile == &json!({"type":"disabled"});
    }
    let mut entries =
        vec![json!({"path":{"type":"special","value":{"kind":"root"}},"access":"read"})];
    let mut network = false;
    if let NativeCodexSandboxV1::WorkspaceWrite {
        writable_roots,
        network_access,
        exclude_tmpdir_env_var,
        exclude_slash_tmp,
    } = &policy.sandbox_policy
    {
        network = *network_access;
        let roots: Vec<_> = std::iter::once(cwd.to_string_lossy().into_owned())
            .chain(writable_roots.iter().cloned())
            .collect();
        for root in &roots {
            entries.push(json!({"path":{"type":"path","path":root},"access":"write"}));
        }
        for (kind, excluded) in [
            ("slash_tmp", exclude_slash_tmp),
            ("tmpdir", exclude_tmpdir_env_var),
        ] {
            if !excluded {
                entries.push(
                    json!({"path":{"type":"special","value":{"kind":kind}},"access":"write"}),
                );
            }
        }
        for name in [".git", ".agents", ".codex", ".aws"] {
            for root in &roots {
                entries.push(json!({"path":{"type":"path","path":Path::new(root).join(name)},"access":"read","missing_path_behavior":"skip"}));
            }
        }
    }
    let expected = json!({"type":"managed","file_system":{"type":"restricted","entries":entries},"network":if network {"enabled"} else {"restricted"}});
    fn normalized(mut value: serde_json::Value) -> Option<serde_json::Value> {
        let entries = value.pointer_mut("/file_system/entries")?.as_array_mut()?;
        entries.sort_by_cached_key(|entry| entry.to_string());
        entries.dedup();
        Some(value)
    }
    normalized(profile.clone())
        .zip(normalized(expected))
        .is_some_and(|(actual, expected)| actual == expected)
}

use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Component, Path},
    process::{Command, Stdio},
};

const MAX_INDEX_FILE_BYTES: u64 = 1024 * 1024;
const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "vendor",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
    "coverage",
    "DerivedData",
    ".venv",
    "venv",
];
const CREDENTIAL_NAMES: &[&str] = &[
    ".env",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "credentials",
    "credentials.json",
    "secrets.json",
    "id_rsa",
    "id_ed25519",
];

/// Visit indexable repository documents one at a time in git's deterministic
/// path order. The visitor can stop as soon as the index entry budget is full,
/// so neither the repository inventory nor all document bodies need to coexist
/// in memory.
pub(crate) fn visit_documents(
    root: &Path,
    mut visitor: impl FnMut(&str, String) -> Result<bool, String>,
) -> Result<bool, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "repository is unavailable".to_owned())?;
    if !canonical_root.join(".git").exists() {
        return Err("connected repository metadata is unavailable".to_owned());
    }
    let mut child = Command::new("git")
        .args(["-C"])
        .arg(&canonical_root)
        .args([
            "ls-files",
            "-co",
            "--exclude-standard",
            "--deduplicate",
            "-z",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| "repository inventory is unavailable".to_owned())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "repository inventory is unavailable".to_owned())?;
    let completed = match visit_git_paths(BufReader::new(stdout), &canonical_root, &mut visitor) {
        Ok(completed) => completed,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    if !completed {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|_| "repository inventory is unavailable".to_owned())?;
    if completed && !status.success() {
        return Err("repository inventory failed".to_owned());
    }
    Ok(completed)
}

fn visit_git_paths(
    mut reader: impl BufRead,
    canonical_root: &Path,
    visitor: &mut impl FnMut(&str, String) -> Result<bool, String>,
) -> Result<bool, String> {
    let mut raw_path = Vec::new();
    loop {
        raw_path.clear();
        let read = reader
            .read_until(0, &mut raw_path)
            .map_err(|_| "repository inventory is unavailable".to_owned())?;
        if read == 0 {
            return Ok(true);
        }
        if raw_path.last() == Some(&0) {
            raw_path.pop();
        }
        if raw_path.is_empty() {
            continue;
        }
        let Ok(raw_path) = std::str::from_utf8(&raw_path) else {
            continue;
        };
        let Some(relative_path) = valid_relative_path(raw_path) else {
            continue;
        };
        let joined = canonical_root.join(&relative_path);
        let Ok(canonical) = joined.canonicalize() else {
            continue;
        };
        if !canonical.starts_with(canonical_root) || !canonical.is_file() {
            continue;
        }
        let Ok(metadata) = fs::metadata(&canonical) else {
            continue;
        };
        if metadata.len() == 0 || metadata.len() > MAX_INDEX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&canonical) else {
            continue;
        };
        if bytes.contains(&0) || credential_content(&bytes) {
            continue;
        }
        let Ok(body) = String::from_utf8(bytes) else {
            continue;
        };
        if !visitor(&relative_path, body)? {
            return Ok(false);
        }
    }
}

pub(crate) fn read_document(root: &Path, relative_path: &str) -> Result<String, String> {
    let relative_path = valid_relative_path(relative_path)
        .ok_or_else(|| "repository locator is unsafe".to_owned())?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "repository is unavailable".to_owned())?;
    let canonical = canonical_root
        .join(relative_path)
        .canonicalize()
        .map_err(|_| "repository locator is unavailable".to_owned())?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return Err("repository locator escaped its source".to_owned());
    }
    let bytes = fs::read(canonical).map_err(|_| "repository locator is unavailable".to_owned())?;
    if bytes.len() as u64 > MAX_INDEX_FILE_BYTES || bytes.contains(&0) || credential_content(&bytes)
    {
        return Err("repository locator is excluded".to_owned());
    }
    String::from_utf8(bytes).map_err(|_| "repository locator is not text".to_owned())
}

/// Read exactly one granted text file with a hard allocation ceiling. This
/// parser grants no Brain/awareness access; callers fence the read with current
/// host permission. A changed or redirected file produces no admitted snapshot.
pub(crate) fn read_document_bounded(
    root: &Path,
    relative_path: &str,
    max_bytes: usize,
) -> Result<String, String> {
    if max_bytes == 0 || max_bytes as u64 > MAX_INDEX_FILE_BYTES {
        return Err("selected document byte limit is invalid".into());
    }
    let relative =
        valid_relative_path(relative_path).ok_or("selected document locator is excluded")?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "selected source is unavailable".to_owned())?;
    let joined = canonical_root.join(relative);
    if fs::symlink_metadata(&joined)
        .map_err(|_| "selected document unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("selected document symlink is excluded".into());
    }
    let canonical = joined
        .canonicalize()
        .map_err(|_| "selected document unavailable".to_owned())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("selected document escaped its source".into());
    }
    let file =
        fs::File::open(&canonical).map_err(|_| "selected document unavailable".to_owned())?;
    let before = file
        .metadata()
        .map_err(|_| "selected document unavailable".to_owned())?;
    let path_before =
        fs::metadata(&canonical).map_err(|_| "selected document unavailable".to_owned())?;
    if !before.is_file()
        || before.len() == 0
        || before.len() > max_bytes as u64
        || joined.canonicalize().ok().as_ref() != Some(&canonical)
        || !same_file_snapshot(&before, &path_before)
    {
        return Err("selected document is oversized or changed".into());
    }
    let mut bytes = Vec::with_capacity(before.len() as usize);
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "selected document unavailable".to_owned())?;
    let after = fs::metadata(&canonical).map_err(|_| "selected document unavailable".to_owned())?;
    if bytes.len() > max_bytes
        || joined.canonicalize().ok().as_ref() != Some(&canonical)
        || !same_file_snapshot(&before, &after)
    {
        return Err("selected document is oversized or changed".into());
    }
    if bytes.contains(&0) || credential_content_all(&bytes) {
        return Err("selected document contains excluded material".into());
    }
    String::from_utf8(bytes).map_err(|_| "selected document is not text".into())
}

fn same_file_snapshot(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    if left.len() != right.len() || left.modified().ok() != right.modified().ok() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if left.dev() != right.dev() || left.ino() != right.ino() {
            return false;
        }
    }
    true
}

fn valid_relative_path(value: &str) -> Option<String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir
                    | Component::CurDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        })
    {
        return None;
    }
    let components = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    if components.is_empty()
        || components.iter().any(|component| {
            EXCLUDED_DIRECTORIES
                .iter()
                .any(|excluded| component.eq_ignore_ascii_case(excluded))
        })
        || credential_name(components.last().copied().unwrap_or_default())
    {
        return None;
    }
    Some(value.replace('\\', "/"))
}

fn credential_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    CREDENTIAL_NAMES.iter().any(|candidate| lower == *candidate)
        || lower.ends_with(".pem")
        || lower.ends_with(".key")
        || lower.contains("secret")
        || lower.contains("credential")
        || lower.contains("token")
}

fn credential_content(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(32 * 1024)];
    credential_content_all(sample)
}

fn credential_content_all(bytes: &[u8]) -> bool {
    let lower = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    [
        "-----begin private key-----",
        "-----begin rsa private key-----",
        "aws_secret_access_key",
        "github_token=",
        "openai_api_key=",
        "anthropic_api_key=",
        "nsec1",
        "sk-ant-",
        "sk-proj-",
        "ghp_",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub(crate) fn path_is_indexable(path: &str) -> bool {
    valid_relative_path(path).is_some()
}

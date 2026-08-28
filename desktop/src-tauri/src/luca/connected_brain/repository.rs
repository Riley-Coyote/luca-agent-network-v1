use std::{
    fs,
    io::{BufRead, BufReader},
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
    let lower = String::from_utf8_lossy(sample).to_ascii_lowercase();
    [
        "-----begin private key-----",
        "-----begin rsa private key-----",
        "aws_secret_access_key",
        "github_token=",
        "openai_api_key=",
        "anthropic_api_key=",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub(crate) fn path_is_indexable(path: &str) -> bool {
    valid_relative_path(path).is_some()
}

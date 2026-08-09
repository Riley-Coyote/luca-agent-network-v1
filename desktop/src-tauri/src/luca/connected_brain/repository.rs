use std::{
    fs,
    path::{Component, Path},
    process::Command,
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

pub(crate) struct RepositoryDocument {
    pub relative_path: String,
    pub body: String,
}

pub(crate) fn documents(root: &Path) -> Result<Vec<RepositoryDocument>, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "repository is unavailable".to_owned())?;
    if !canonical_root.join(".git").exists() {
        return Err("connected repository metadata is unavailable".to_owned());
    }
    let output = Command::new("git")
        .args(["-C"])
        .arg(&canonical_root)
        .args(["ls-files", "-co", "--exclude-standard", "-z"])
        .output()
        .map_err(|_| "repository inventory is unavailable".to_owned())?;
    if !output.status.success() {
        return Err("repository inventory failed".to_owned());
    }
    let mut paths = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .filter_map(|path| std::str::from_utf8(path).ok())
        .filter_map(valid_relative_path)
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();

    let mut documents = Vec::new();
    for relative_path in paths {
        let joined = canonical_root.join(&relative_path);
        let Ok(canonical) = joined.canonicalize() else {
            continue;
        };
        if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
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
        documents.push(RepositoryDocument {
            relative_path,
            body,
        });
    }
    Ok(documents)
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

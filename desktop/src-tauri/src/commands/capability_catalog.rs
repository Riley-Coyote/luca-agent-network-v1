//! Read-only catalog of skills already installed for the owner's runtimes.
//!
//! Polyphonic does not install, copy, or reinterpret skills here. It discovers
//! `SKILL.md` files only beneath known runtime-owned roots, returns bounded
//! metadata for the Library, and resolves details through an opaque identifier
//! that is revalidated against the same catalog on every read.

use std::{
    collections::{BTreeMap, BTreeSet, HashSet, VecDeque},
    fs,
    io::Read as _,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SKILLS: usize = 2_000;
const MAX_WALK_ENTRIES: usize = 50_000;
const MAX_SKILL_BYTES: u64 = 512 * 1024;
const MAX_NAME_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 280;

#[derive(Debug, Clone)]
struct SkillRoot {
    path: PathBuf,
    /// Canonical directory that this dynamically enumerated root must remain
    /// beneath. Exact top-level runtime roots intentionally leave this unset
    /// so an owner can relocate the runtime's whole skill directory.
    canonical_boundary: Option<PathBuf>,
    source_label: String,
    runtime_id: String,
    max_depth: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalogEntryV1 {
    skill_id: String,
    name: String,
    description: String,
    source_labels: Vec<String>,
    runtime_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalogDetailV1 {
    skill_id: String,
    name: String,
    description: String,
    source_labels: Vec<String>,
    runtime_ids: Vec<String>,
    content: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillActivationStatusV1 {
    Ready,
    Checking,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillActivationV1 {
    skill_id: String,
    resident_pubkey: String,
    runtime_family: Option<String>,
    canonical_name: Option<String>,
    catalog_generation: String,
    status: SkillActivationStatusV1,
    reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct SkillFrontmatter {
    name: Option<String>,
    title: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Clone)]
struct DiscoveredSkill {
    canonical_path: PathBuf,
    name: String,
    description: String,
    source_labels: BTreeSet<String>,
    runtime_ids: BTreeSet<String>,
}

#[derive(Debug, Clone)]
struct CachedSkill {
    canonical_path: PathBuf,
    source_labels: BTreeSet<String>,
    runtime_ids: BTreeSet<String>,
}

#[derive(Debug)]
struct OpenedSkill {
    canonical_path: PathBuf,
    content: String,
}

static SKILL_CACHE: OnceLock<Mutex<BTreeMap<String, CachedSkill>>> = OnceLock::new();

#[tauri::command]
pub fn get_resident_session_capabilities(
    resident_pubkey: String,
) -> Result<Option<luca_protocol::ResidentSessionCapabilityV1>, String> {
    let resident_pubkey = resident_pubkey.trim().to_ascii_lowercase();
    if resident_pubkey.len() != 64
        || !resident_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("resident capability identity is invalid".to_owned());
    }
    Ok(crate::luca::resident_session_capabilities::current(
        &resident_pubkey,
    ))
}

#[tauri::command]
pub async fn list_capability_skills() -> Result<Vec<SkillCatalogEntryV1>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let skills = catalog(skill_roots())?;
        replace_skill_cache(&skills)?;
        Ok(skills.into_iter().map(entry_view).collect())
    })
    .await
    .map_err(|error| format!("skill catalog task failed: {error}"))?
}

#[tauri::command]
pub async fn read_capability_skill(skill_id: String) -> Result<SkillCatalogDetailV1, String> {
    let skill_id = skill_id.trim().to_owned();
    if skill_id.len() != 64 || !skill_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("skill identifier is invalid".to_owned());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let skill = resolve_cached_skill(&skill_id)?;
        let opened = open_skill_bounded(&skill.canonical_path, &skill_roots())
            .map_err(|_| "skill is no longer available".to_owned())?;
        if opened.canonical_path != skill.canonical_path {
            return Err("skill is no longer available".to_owned());
        }
        let (name, description) = skill_metadata(&opened.canonical_path, &opened.content);
        Ok(SkillCatalogDetailV1 {
            skill_id,
            name,
            description,
            source_labels: skill.source_labels.into_iter().collect(),
            runtime_ids: skill.runtime_ids.into_iter().collect(),
            content: opened.content,
        })
    })
    .await
    .map_err(|error| format!("skill catalog task failed: {error}"))?
}

/// Resolve one opaque Library entry against the exact resident session that
/// would execute it. This performs no Skill loading and returns no Skill body.
/// The composer calls it both when a chip is selected and immediately before
/// send so stale or ambiguous mappings fail closed while preserving the draft.
#[tauri::command]
pub async fn resolve_capability_skill_activation(
    skill_id: String,
    resident_pubkey: String,
) -> Result<SkillActivationV1, String> {
    let skill_id = skill_id.trim().to_ascii_lowercase();
    if skill_id.len() != 64 || !skill_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("skill identifier is invalid".to_owned());
    }
    let resident_pubkey = resident_pubkey.trim().to_ascii_lowercase();
    if resident_pubkey.len() != 64
        || !resident_pubkey
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("resident capability identity is invalid".to_owned());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let skills = catalog(skill_roots())?;
        replace_skill_cache(&skills)?;
        let catalog_generation = catalog_generation(&skills);
        let Some(selected) = skills
            .iter()
            .find(|skill| skill_id_for(&skill.canonical_path) == skill_id)
        else {
            return Ok(SkillActivationV1 {
                skill_id,
                resident_pubkey,
                runtime_family: None,
                canonical_name: None,
                catalog_generation,
                status: SkillActivationStatusV1::Unavailable,
                reason: Some("This Skill moved or is no longer installed.".to_owned()),
            });
        };

        let Some(snapshot) = crate::luca::resident_session_capabilities::current(&resident_pubkey)
        else {
            return Ok(SkillActivationV1 {
                skill_id,
                resident_pubkey,
                runtime_family: None,
                canonical_name: None,
                catalog_generation,
                status: SkillActivationStatusV1::Checking,
                reason: Some("Waiting for this resident's live capability handshake.".to_owned()),
            });
        };
        let catalog_runtime = catalog_runtime_family(&snapshot.runtime_family);
        if !selected.runtime_ids.contains(catalog_runtime) {
            return Ok(SkillActivationV1 {
                skill_id,
                resident_pubkey,
                runtime_family: Some(snapshot.runtime_family),
                canonical_name: None,
                catalog_generation,
                status: SkillActivationStatusV1::Unavailable,
                reason: Some("This Skill is not installed for the selected resident's runtime.".to_owned()),
            });
        }

        let selected_name = normalize_invocation_name(&selected.name);
        let duplicate_count = skills
            .iter()
            .filter(|skill| {
                skill.runtime_ids.contains(catalog_runtime)
                    && normalize_invocation_name(&skill.name) == selected_name
            })
            .count();
        if duplicate_count > 1 {
            return Ok(SkillActivationV1 {
                skill_id,
                resident_pubkey,
                runtime_family: Some(snapshot.runtime_family),
                canonical_name: None,
                catalog_generation,
                status: SkillActivationStatusV1::Unavailable,
                reason: Some(
                    "More than one installed Skill has this invocation name. Choose a unique source after the runtime exposes one."
                        .to_owned(),
                ),
            });
        }

        let matches = snapshot
            .commands
            .iter()
            .filter(|command| {
                normalize_invocation_name(
                    command
                        .canonical_name
                        .trim_start_matches(['/', '$']),
                ) == selected_name
            })
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Ok(SkillActivationV1 {
                skill_id,
                resident_pubkey,
                runtime_family: Some(snapshot.runtime_family),
                canonical_name: None,
                catalog_generation,
                status: SkillActivationStatusV1::Unavailable,
                reason: Some(if matches.is_empty() {
                    "The live runtime session does not advertise this Skill yet.".to_owned()
                } else {
                    "The live runtime advertised an ambiguous Skill command.".to_owned()
                }),
            });
        }

        Ok(SkillActivationV1 {
            skill_id,
            resident_pubkey,
            runtime_family: Some(snapshot.runtime_family),
            canonical_name: Some(matches[0].canonical_name.clone()),
            catalog_generation,
            status: SkillActivationStatusV1::Ready,
            reason: None,
        })
    })
    .await
    .map_err(|error| format!("skill activation task failed: {error}"))?
}

fn catalog_runtime_family(runtime_family: &str) -> &str {
    match runtime_family {
        "claude_code" => "claude",
        other => other,
    }
}

fn normalize_invocation_name(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|character| match character {
            '_' | ' ' => '-',
            other => other,
        })
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect()
}

fn catalog_generation(skills: &[DiscoveredSkill]) -> String {
    let mut ids = skills
        .iter()
        .map(|skill| skill_id_for(&skill.canonical_path))
        .collect::<Vec<_>>();
    ids.sort();
    let mut digest = Sha256::new();
    for id in ids {
        digest.update(id.as_bytes());
        digest.update([0]);
    }
    hex::encode(digest.finalize())
}

fn replace_skill_cache(skills: &[DiscoveredSkill]) -> Result<(), String> {
    let cache = SKILL_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    let mut cache = cache
        .lock()
        .map_err(|_| "skill catalog cache is locked".to_owned())?;
    cache.clear();
    cache.extend(skills.iter().map(|skill| {
        (
            skill_id_for(&skill.canonical_path),
            CachedSkill {
                canonical_path: skill.canonical_path.clone(),
                source_labels: skill.source_labels.clone(),
                runtime_ids: skill.runtime_ids.clone(),
            },
        )
    }));
    Ok(())
}

fn cached_skill(skill_id: &str) -> Result<Option<CachedSkill>, String> {
    let cache = SKILL_CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    cache
        .lock()
        .map_err(|_| "skill catalog cache is locked".to_owned())
        .map(|cache| cache.get(skill_id).cloned())
}

fn resolve_cached_skill(skill_id: &str) -> Result<CachedSkill, String> {
    if let Some(skill) = cached_skill(skill_id)? {
        return Ok(skill);
    }
    let skills = catalog(skill_roots())?;
    replace_skill_cache(&skills)?;
    cached_skill(skill_id)?.ok_or_else(|| "skill is no longer available".to_owned())
}

fn entry_view(skill: DiscoveredSkill) -> SkillCatalogEntryV1 {
    SkillCatalogEntryV1 {
        skill_id: skill_id_for(&skill.canonical_path),
        name: skill.name,
        description: skill.description,
        source_labels: skill.source_labels.into_iter().collect(),
        runtime_ids: skill.runtime_ids.into_iter().collect(),
    }
}

fn push_root(
    roots: &mut Vec<SkillRoot>,
    path: PathBuf,
    source_label: impl Into<String>,
    runtime_id: impl Into<String>,
    max_depth: usize,
) {
    if path.is_dir() {
        roots.push(SkillRoot {
            path,
            canonical_boundary: None,
            source_label: source_label.into(),
            runtime_id: runtime_id.into(),
            max_depth,
        });
    }
}

fn push_contained_root(
    roots: &mut Vec<SkillRoot>,
    path: PathBuf,
    canonical_boundary: &Path,
    source_label: impl Into<String>,
    runtime_id: impl Into<String>,
    max_depth: usize,
) {
    let Ok(canonical_path) = path.canonicalize() else {
        return;
    };
    if !canonical_path.starts_with(canonical_boundary) || !canonical_path.is_dir() {
        return;
    }
    roots.push(SkillRoot {
        path,
        canonical_boundary: Some(canonical_boundary.to_path_buf()),
        source_label: source_label.into(),
        runtime_id: runtime_id.into(),
        max_depth,
    });
}

fn skill_roots() -> Vec<SkillRoot> {
    let mut roots = Vec::new();
    let Some(home) = dirs::home_dir() else {
        return roots;
    };

    push_root(
        &mut roots,
        home.join(".agents/skills"),
        "Shared agent skills",
        "codex",
        3,
    );
    push_root(&mut roots, home.join(".codex/skills"), "Codex", "codex", 3);
    push_root(
        &mut roots,
        home.join(".codex/plugins/cache"),
        "Codex plugins",
        "codex",
        9,
    );
    push_root(
        &mut roots,
        home.join(".claude/skills"),
        "Claude Code",
        "claude",
        3,
    );
    push_root(
        &mut roots,
        home.join(".claude/plugins/cache"),
        "Claude Code plugins",
        "claude",
        9,
    );
    push_root(&mut roots, home.join(".goose/skills"), "Goose", "goose", 3);
    push_root(
        &mut roots,
        home.join(".hermes/skills"),
        "Hermes",
        "hermes",
        3,
    );
    push_root(
        &mut roots,
        home.join(".openclaw/skills"),
        "OpenClaw managed skills",
        "openclaw",
        3,
    );
    push_root(
        &mut roots,
        home.join(".openclaw/workspace/skills"),
        "OpenClaw workspace",
        "openclaw",
        3,
    );

    // Hermes profiles are independent runtime homes. OpenClaw profiles and
    // agents similarly keep distinct workspaces. Enumerate only these known
    // one-level containers rather than scanning the owner's home directory.
    add_named_child_skill_roots(
        &mut roots,
        &home.join(".hermes/profiles"),
        "Hermes",
        "hermes",
        |child| child.join("skills"),
    );
    add_prefixed_openclaw_roots(&mut roots, &home);

    if let Some(nest) = crate::managed_agents::nest_dir() {
        push_root(
            &mut roots,
            nest.join(".agents/skills"),
            "Polyphonic",
            "polyphonic",
            3,
        );
    }

    roots
}

fn add_named_child_skill_roots<F>(
    roots: &mut Vec<SkillRoot>,
    parent: &Path,
    label_prefix: &str,
    runtime_id: &str,
    resolve: F,
) where
    F: Fn(&Path) -> PathBuf,
{
    let Ok(canonical_parent) = parent.canonicalize() else {
        return;
    };
    let Ok(entries) = fs::read_dir(parent) else {
        return;
    };
    for entry in entries.flatten().take(256) {
        let child = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Ok(canonical_child) = child.canonicalize() else {
            continue;
        };
        if !canonical_child.starts_with(&canonical_parent) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().trim().to_owned();
        if name.is_empty() {
            continue;
        }
        push_contained_root(
            roots,
            resolve(&child),
            &canonical_child,
            format!("{label_prefix} · {name}"),
            runtime_id,
            3,
        );
    }
}

fn add_prefixed_openclaw_roots(roots: &mut Vec<SkillRoot>, home: &Path) {
    let Ok(canonical_home) = home.canonicalize() else {
        return;
    };
    let Ok(entries) = fs::read_dir(home) else {
        return;
    };
    for entry in entries.flatten().take(512) {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !name.starts_with(".openclaw") || !file_type.is_dir() {
            continue;
        }
        let state_root = entry.path();
        let Ok(canonical_state_root) = state_root.canonicalize() else {
            continue;
        };
        if !canonical_state_root.starts_with(&canonical_home) {
            continue;
        }
        push_contained_root(
            roots,
            state_root.join("skills"),
            &canonical_state_root,
            format!("OpenClaw · {name}"),
            "openclaw",
            3,
        );
        push_contained_root(
            roots,
            state_root.join("workspace/skills"),
            &canonical_state_root,
            format!("OpenClaw workspace · {name}"),
            "openclaw",
            3,
        );
        let Ok(children) = fs::read_dir(&state_root) else {
            continue;
        };
        for child in children.flatten().take(256) {
            let child_name = child.file_name().to_string_lossy().to_string();
            let Ok(child_type) = child.file_type() else {
                continue;
            };
            if !child_name.starts_with("workspace-") || !child_type.is_dir() {
                continue;
            }
            let Ok(canonical_child) = child.path().canonicalize() else {
                continue;
            };
            if !canonical_child.starts_with(&canonical_state_root) {
                continue;
            }
            push_contained_root(
                roots,
                child.path().join("skills"),
                &canonical_child,
                format!("OpenClaw · {child_name}"),
                "openclaw",
                3,
            );
        }
    }
}

fn catalog(roots: Vec<SkillRoot>) -> Result<Vec<DiscoveredSkill>, String> {
    let mut by_path = BTreeMap::<PathBuf, DiscoveredSkill>::new();
    let mut remaining_walk_entries = MAX_WALK_ENTRIES;
    for root in roots {
        if remaining_walk_entries == 0 {
            break;
        }
        for skill_path in skill_files(&root, &mut remaining_walk_entries) {
            if by_path.len() >= MAX_SKILLS {
                break;
            }
            let Ok(opened) = open_skill_bounded(&skill_path, std::slice::from_ref(&root)) else {
                continue;
            };
            if let Some(existing) = by_path.get_mut(&opened.canonical_path) {
                existing.source_labels.insert(root.source_label.clone());
                existing.runtime_ids.insert(root.runtime_id.clone());
                continue;
            }
            let (name, description) = skill_metadata(&opened.canonical_path, &opened.content);
            by_path.insert(
                opened.canonical_path.clone(),
                DiscoveredSkill {
                    canonical_path: opened.canonical_path,
                    name,
                    description,
                    source_labels: BTreeSet::from([root.source_label.clone()]),
                    runtime_ids: BTreeSet::from([root.runtime_id.clone()]),
                },
            );
        }
    }
    let mut skills = by_path.into_values().collect::<Vec<_>>();
    skills.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.canonical_path.cmp(&right.canonical_path))
    });
    Ok(skills)
}

/// Open a skill exactly once, then prove the opened file is the same file as a
/// post-open canonical path inside a still-valid runtime root. Reading through
/// the handle with `take` keeps the byte ceiling true even if the file grows.
fn open_skill_bounded(path: &Path, roots: &[SkillRoot]) -> Result<OpenedSkill, ()> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| ())?;
    let opened_metadata = file.metadata().map_err(|_| ())?;
    if !opened_metadata.is_file()
        || opened_metadata.len() == 0
        || opened_metadata.len() > MAX_SKILL_BYTES
    {
        return Err(());
    }

    let canonical_path = path.canonicalize().map_err(|_| ())?;
    let in_known_root = roots.iter().any(|root| {
        let Ok(canonical_root) = root.path.canonicalize() else {
            return false;
        };
        if root
            .canonical_boundary
            .as_ref()
            .is_some_and(|boundary| !canonical_root.starts_with(boundary))
        {
            return false;
        }
        canonical_path.starts_with(canonical_root)
    });
    if !in_known_root {
        return Err(());
    }

    let path_metadata = fs::metadata(&canonical_path).map_err(|_| ())?;
    if !same_file_identity(&opened_metadata, &path_metadata) {
        return Err(());
    }

    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.by_ref()
        .take(MAX_SKILL_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_SKILL_BYTES {
        return Err(());
    }
    let content = String::from_utf8(bytes).map_err(|_| ())?;
    Ok(OpenedSkill {
        canonical_path,
        content,
    })
}

#[cfg(unix)]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt as _;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_file_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.is_file()
        && right.is_file()
        && left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
}

fn skill_files(root: &SkillRoot, remaining_entries: &mut usize) -> Vec<PathBuf> {
    let mut queue = VecDeque::from([(root.path.clone(), 0_usize)]);
    let mut visited = HashSet::<PathBuf>::new();
    let mut files = Vec::new();

    while let Some((directory, depth)) = queue.pop_front() {
        if files.len() >= MAX_SKILLS || *remaining_entries == 0 {
            break;
        }
        let Ok(canonical_directory) = directory.canonicalize() else {
            continue;
        };
        if !visited.insert(canonical_directory) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if *remaining_entries == 0 {
                break;
            }
            *remaining_entries -= 1;
            let path = entry.path();
            let name = entry.file_name();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if (file_type.is_file() || file_type.is_symlink()) && name == "SKILL.md" {
                files.push(path);
                continue;
            }
            if depth >= root.max_depth {
                continue;
            }
            if file_type.is_dir() {
                queue.push_back((path, depth + 1));
                continue;
            }
            // Provider skill shims are often directory symlinks. Follow only a
            // direct symlinked skill directory that already contains SKILL.md;
            // never recurse through an arbitrary symlink tree.
            if file_type.is_symlink() && path.join("SKILL.md").is_file() {
                files.push(path.join("SKILL.md"));
            }
        }
    }
    files
}

fn skill_metadata(path: &Path, content: &str) -> (String, String) {
    let frontmatter = parse_frontmatter(content);
    let fallback_name = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("Skill")
        .trim()
        .to_owned();
    let name = frontmatter
        .as_ref()
        .and_then(|metadata| metadata.name.as_ref().or(metadata.title.as_ref()))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or(fallback_name);
    let name = truncate_chars(&collapse_whitespace(&name), MAX_NAME_CHARS);
    let description = frontmatter
        .and_then(|metadata| metadata.description)
        .map(|value| collapse_whitespace(&value))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Installed skill".to_owned());
    (name, truncate_chars(&description, MAX_DESCRIPTION_CHARS))
}

fn parse_frontmatter(content: &str) -> Option<SkillFrontmatter> {
    let normalized = content.strip_prefix("\u{feff}").unwrap_or(content);
    let body = normalized.strip_prefix("---\n")?;
    let end = body.find("\n---")?;
    serde_yaml::from_str(&body[..end]).ok()
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    let mut truncated = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn skill_id_for(path: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(b"polyphonic-skill-catalog-v1\0");
    digest.update(path.as_os_str().as_encoded_bytes());
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_reads_frontmatter_and_deduplicates_runtime_views() {
        let temp = tempfile::tempdir().unwrap();
        let skill_dir = temp.path().join("skills/research");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Deep research\ndescription: Search carefully and cite sources.\n---\n\n# Ignored heading\n",
        )
        .unwrap();

        let skills = catalog(vec![
            SkillRoot {
                path: temp.path().join("skills"),
                canonical_boundary: None,
                source_label: "Codex".into(),
                runtime_id: "codex".into(),
                max_depth: 3,
            },
            SkillRoot {
                path: temp.path().join("skills"),
                canonical_boundary: None,
                source_label: "Shared".into(),
                runtime_id: "claude".into(),
                max_depth: 3,
            },
        ])
        .unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Deep research");
        assert_eq!(skills[0].description, "Search carefully and cite sources.");
        assert_eq!(
            skills[0].runtime_ids.iter().cloned().collect::<Vec<_>>(),
            vec!["claude", "codex"]
        );
    }

    #[test]
    fn catalog_does_not_expose_body_copy_as_list_metadata() {
        let temp = tempfile::tempdir().unwrap();
        let skill_dir = temp.path().join("skills/private-notes");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "# Private project\n\nClient secret that must only appear in detail view.\n",
        )
        .unwrap();

        let skills = catalog(vec![SkillRoot {
            path: temp.path().join("skills"),
            canonical_boundary: None,
            source_label: "Codex".into(),
            runtime_id: "codex".into(),
            max_depth: 3,
        }])
        .unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "private-notes");
        assert_eq!(skills[0].description, "Installed skill");
    }

    #[test]
    fn catalog_ignores_oversized_and_non_utf8_skills() {
        let temp = tempfile::tempdir().unwrap();
        let skills = temp.path().join("skills");
        fs::create_dir_all(skills.join("large")).unwrap();
        fs::create_dir_all(skills.join("binary")).unwrap();
        fs::write(
            skills.join("large/SKILL.md"),
            vec![b'x'; MAX_SKILL_BYTES as usize + 1],
        )
        .unwrap();
        fs::write(skills.join("binary/SKILL.md"), [0xff, 0xfe]).unwrap();

        let found = catalog(vec![SkillRoot {
            path: skills,
            canonical_boundary: None,
            source_label: "Codex".into(),
            runtime_id: "codex".into(),
            max_depth: 3,
        }])
        .unwrap();
        assert!(found.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn named_profile_roots_reject_directory_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let profiles = temp.path().join("profiles");
        let outside = temp.path().join("private-profile");
        fs::create_dir_all(&profiles).unwrap();
        fs::create_dir_all(outside.join("skills/private")).unwrap();
        fs::write(
            outside.join("skills/private/SKILL.md"),
            "---\nname: Private\ndescription: Must stay private.\n---\n",
        )
        .unwrap();
        symlink(&outside, profiles.join("escaped")).unwrap();

        let mut roots = Vec::new();
        add_named_child_skill_roots(&mut roots, &profiles, "Hermes", "hermes", |child| {
            child.join("skills")
        });

        assert!(roots.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn catalog_does_not_follow_skill_file_symlinks_outside_a_known_root() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().unwrap();
        let skills = temp.path().join("skills");
        let outside = temp.path().join("outside");
        fs::create_dir_all(skills.join("escaped")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(
            outside.join("SKILL.md"),
            "---\nname: Private\ndescription: Must stay private.\n---\n",
        )
        .unwrap();
        symlink(outside.join("SKILL.md"), skills.join("escaped/SKILL.md")).unwrap();

        let found = catalog(vec![SkillRoot {
            path: skills,
            canonical_boundary: None,
            source_label: "Codex".into(),
            runtime_id: "codex".into(),
            max_depth: 3,
        }])
        .unwrap();
        assert!(found.is_empty());
    }
}

//! A resident linked to one of the person's own Mnemos minds.
//!
//! Linked, the resident remembers with that mind through the person's own
//! installed `mnemos`, the same way their other apps (Claude Code, Codex) reach
//! it: the same store, agent, person and project, and the same tools, wake and
//! cue. Polyphonic keeps no copy of it and adds no second memory beside it.
use super::protocol::Scope;
use serde::Serialize;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

/// Mnemos keeps each mind in `~/.mnemos/<agent>.db`.
fn mnemos_dir(home: &Path) -> PathBuf {
    home.join(".mnemos")
}

/// The person's own `mnemos` command, from the places its installers put it
/// (`uv tool` and `pipx`, Homebrew, pip). Fixed locations only: no shell and no
/// search path read from the environment.
pub(crate) fn command(home: &Path) -> Option<PathBuf> {
    let mut candidates = vec![
        home.join(".local/bin/mnemos"),
        PathBuf::from("/opt/homebrew/bin/mnemos"),
        PathBuf::from("/usr/local/bin/mnemos"),
    ];
    for base in [
        home.join("Library/Python"),
        PathBuf::from("/Library/Frameworks/Python.framework/Versions"),
    ] {
        let mut versions: Vec<(u32, PathBuf)> = fs::read_dir(&base)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let minor = name.to_str()?.strip_prefix("3.")?.parse().ok()?;
                Some((minor, entry.path().join("bin/mnemos")))
            })
            .collect();
        versions.sort_by_key(|(minor, _)| std::cmp::Reverse(*minor));
        candidates.extend(versions.into_iter().map(|(_, path)| path));
    }
    candidates.into_iter().find(|path| executable(path))
}

fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path).is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

/// Mnemos's own slug rule (`simple_scope._slugify`): lowercase, every run of
/// other characters becomes one hyphen, no hyphen at either end.
fn slug(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    let mut run = false;
    for ch in value.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
            run = false;
        } else if !run {
            out.push('-');
            run = true;
        }
    }
    match out.trim_matches('-') {
        "" => fallback.to_owned(),
        clean => clean.to_owned(),
    }
}

/// The person and project a mind reads and writes, resolved as Mnemos resolves
/// them for an app that names only the store and the agent (Claude Code does):
/// the config file, then Mnemos's defaults.
fn person_and_project(dir: &Path) -> (String, String) {
    const MAX_CONFIG: u64 = 1024 * 1024;
    let config = fs::File::open(dir.join("config.json"))
        .ok()
        .and_then(|file| {
            let mut bytes = Vec::new();
            file.take(MAX_CONFIG).read_to_end(&mut bytes).ok()?;
            serde_json::from_slice::<serde_json::Value>(&bytes).ok()
        })
        .unwrap_or_default();
    let text = |key: &str| {
        config
            .get(key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
    };
    let person = text("person_id")
        .or_else(|| text("user_name"))
        .unwrap_or("user");
    let project = text("project_scope").unwrap_or("global");
    (slug(person, "user"), slug(project, "global"))
}

/// One mind found in the person's Mnemos folder.
pub(crate) struct Mind {
    pub(crate) file: PathBuf,
    pub(crate) scope: Scope,
    pub(crate) memories: u64,
    /// The moment of its newest memory, as the store holds it, in world
    /// time; the page names the day.
    pub(crate) newest: Option<String>,
}

/// What the picker shows for a mind. Its id is its agent id, which also names
/// its store; the app looks the mind up again before linking it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindChoice {
    id: String,
    name: String,
    memories: u64,
    /// The moment of its newest memory, as the store holds it, in world
    /// time; the page names the day.
    newest: Option<String>,
}

impl Mind {
    pub(crate) fn name(&self) -> String {
        self.scope
            .agent_id
            .split(['-', '_'])
            .filter(|word| !word.is_empty())
            .map(|word| {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ")
    }
    pub(super) fn choice(&self) -> MindChoice {
        MindChoice {
            id: self.scope.agent_id.clone(),
            name: self.name(),
            memories: self.memories,
            newest: self.newest.clone(),
        }
    }
}

/// The minds that keep their memory in the person's Mnemos folder, one store
/// each, named for the agent, as Mnemos makes them. The rule is Mnemos's own
/// (its log page's `minds_beside`): a store that pools several agents, the
/// shared memory, and databases that aren't memory stores are left out.
pub(crate) fn minds(home: &Path) -> Vec<Mind> {
    let dir = mnemos_dir(home);
    let (person, project) = person_and_project(&dir);
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "db"))
        .collect();
    files.sort();
    files
        .into_iter()
        .filter_map(|file| {
            let agent = file.file_stem()?.to_str()?.to_owned();
            if matches!(agent.as_str(), "shared-memory" | "shared") {
                return None;
            }
            let scope = Scope {
                agent_id: agent,
                person_id: person.clone(),
                project_scope: project.clone(),
            };
            if !scope.valid() || !fs::metadata(&file).is_ok_and(|meta| meta.is_file()) {
                return None;
            }
            let (memories, newest) = census(&file, &scope.agent_id)?;
            (memories > 0).then_some(Mind {
                file,
                scope,
                memories,
                newest,
            })
        })
        .collect()
}

/// How many memories the agent keeps in this store, and the moment of the
/// newest, as the store holds it, in world time: the page names its day, in
/// the person's own time. Read-only; never creates, migrates or waits long on a store.
fn census(file: &Path, agent: &str) -> Option<(u64, Option<String>)> {
    use rusqlite::{Connection, OpenFlags};
    let conn = Connection::open_with_flags(
        file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.busy_timeout(Duration::from_millis(250)).ok()?;
    let owned: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_table_info('engrams') WHERE name = 'owner_agent_id'",
            [],
            |row| row.get(0),
        )
        .ok()?;
    if owned == 0 {
        return None;
    }
    let (count, newest): (i64, Option<String>) = conn
        .query_row(
            "SELECT count(*), max(created_at) FROM engrams \
             WHERE owner_agent_id = ?1 AND state IN ('active', 'dormant')",
            [agent],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()?;
    Some((u64::try_from(count).ok()?, newest))
}

/// A path as the person would write it, with their home folder as `~`.
pub(crate) fn display(home: &Path, path: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn store(path: &Path, rows: &[(&str, &str, &str)]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE engrams (id TEXT PRIMARY KEY, content TEXT NOT NULL, \
             owner_agent_id TEXT NOT NULL DEFAULT 'default', person_id TEXT, \
             project_scope TEXT, state TEXT NOT NULL DEFAULT 'active', \
             created_at TEXT NOT NULL);",
        )
        .unwrap();
        for (index, (agent, state, created)) in rows.iter().enumerate() {
            conn.execute(
                "INSERT INTO engrams (id, content, owner_agent_id, state, created_at) \
                 VALUES (?1, 'a made-up memory', ?2, ?3, ?4)",
                rusqlite::params![format!("e{index}"), agent, state, created],
            )
            .unwrap();
        }
    }

    #[test]
    fn slugs_follow_mnemos() {
        assert_eq!(slug("  Pat Example ", "user"), "pat-example");
        assert_eq!(slug("a -b", "user"), "a--b");
        assert_eq!(slug("Zoë", "user"), "zo");
        assert_eq!(slug("---", "user"), "user");
        assert_eq!(slug("under_score", "user"), "under_score");
    }

    #[test]
    fn person_and_project_come_from_config_then_defaults() {
        let home = tempfile::tempdir().unwrap();
        let dir = mnemos_dir(home.path());
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(person_and_project(&dir), ("user".into(), "global".into()));
        fs::write(
            dir.join("config.json"),
            r#"{"agent_id":"wren","user_name":"Pat Example","project_scope":"Lighthouse"}"#,
        )
        .unwrap();
        assert_eq!(
            person_and_project(&dir),
            ("pat-example".into(), "lighthouse".into())
        );
        fs::write(
            dir.join("config.json"),
            r#"{"person_id":"pat","user_name":"Pat Example"}"#,
        )
        .unwrap();
        assert_eq!(person_and_project(&dir), ("pat".into(), "global".into()));
    }

    #[test]
    fn finds_one_mind_per_store_like_mnemos() {
        let home = tempfile::tempdir().unwrap();
        let dir = mnemos_dir(home.path());
        fs::create_dir_all(&dir).unwrap();
        store(
            &dir.join("wren.db"),
            &[
                ("wren", "active", "2026-11-01T10:00:00Z"),
                ("wren", "dormant", "2026-11-16T22:30:00Z"),
                ("wren", "archived", "2026-11-17T09:00:00Z"),
            ],
        );
        // Pooled or empty for its own agent: not a mind of its own.
        store(
            &dir.join("pool.db"),
            &[("wren", "active", "2026-11-02T00:00:00Z")],
        );
        store(
            &dir.join("shared-memory.db"),
            &[("shared-memory", "active", "x")],
        );
        Connection::open(dir.join("audit.db"))
            .unwrap()
            .execute_batch("CREATE TABLE log (line TEXT);")
            .unwrap();
        fs::write(dir.join("broken.db"), b"not a database").unwrap();
        store(&dir.join("Bad Name.db"), &[("Bad Name", "active", "x")]);

        let found = minds(home.path());
        assert_eq!(found.len(), 1);
        let mind = &found[0];
        assert_eq!(mind.scope.agent_id, "wren");
        assert_eq!(mind.scope.person_id, "user");
        assert_eq!(mind.scope.project_scope, "global");
        assert_eq!(mind.memories, 2);
        assert_eq!(mind.newest.as_deref(), Some("2026-11-16T22:30:00Z"));
        assert_eq!(mind.file, dir.join("wren.db"));
        let choice = serde_json::to_value(mind.choice()).unwrap();
        assert_eq!(choice["id"], "wren");
        assert_eq!(choice["name"], "Wren");
    }

    #[test]
    fn names_read_like_the_agent_id() {
        let mind = |agent: &str| Mind {
            file: PathBuf::from("/x"),
            scope: Scope {
                agent_id: agent.into(),
                person_id: "user".into(),
                project_scope: "global".into(),
            },
            memories: 1,
            newest: None,
        };
        assert_eq!(mind("claude-code").name(), "Claude Code");
        assert_eq!(mind("field_notes").name(), "Field Notes");
        assert_eq!(mind("fable").name(), "Fable");
    }

    #[test]
    fn finds_the_persons_own_command_only_in_install_locations() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let tool = bin.join("mnemos");
        fs::write(&tool, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o644)).unwrap();
        // Not executable: not a command. (A machine-wide install may still be found.)
        assert_ne!(command(home.path()), Some(tool.clone()));
        fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(command(home.path()), Some(tool));
    }

    #[test]
    fn display_uses_the_home_folder() {
        let home = Path::new("/Users/pat");
        assert_eq!(
            display(home, Path::new("/Users/pat/.mnemos/wren.db")),
            "~/.mnemos/wren.db"
        );
        assert_eq!(display(home, Path::new("/tmp/w.db")), "/tmp/w.db");
    }
}

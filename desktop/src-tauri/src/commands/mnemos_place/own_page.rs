//! Mnemos's own page for the open mind (WP-49, Decided 6): the person's
//! installed `mnemos log`, started only when they ask, for the mind the place
//! has open. It is looked up and scoped exactly as the place's own process
//! is (the same `mnemos`, the same four scope flags, the same environment
//! cleared down to `HOME` and a fixed `PATH`), and nothing waits on it: the
//! page opens in the person's browser and stays theirs. Jev is set there.
use super::{
    main_window,
    session::{place, MindKey, Spawn, PATH},
    UNAVAILABLE,
};
use crate::commands::mnemos_view::link;
use std::{
    collections::HashMap,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{Mutex, MutexGuard, OnceLock, PoisonError},
    time::Duration,
};
use tauri::Window;

/// The command for Mnemos's own page, built on `base` (the person's own
/// `mnemos`): `log` with all four scope flags, in an environment cleared of
/// everything the app had.
fn command(mut base: Command, spec: &Spawn) -> Command {
    base.env_clear()
        .env("HOME", &spec.home)
        .env("PATH", PATH)
        .current_dir(&spec.home)
        .arg("log")
        .arg("--db-path")
        .arg(&spec.db)
        .args([
            "--agent-id",
            &spec.agent,
            "--person-id",
            &spec.person,
            "--project-scope",
            &spec.project,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    base
}

/// The pages this app started, one per mind (by the mind's id), each held
/// by its own child handle: the only processes this file ever ends.
type Pages = Mutex<HashMap<String, Child>>;

fn pages() -> &'static Pages {
    static PAGES: OnceLock<Pages> = OnceLock::new();
    PAGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn held(pages: &Pages) -> MutexGuard<'_, HashMap<String, Child>> {
    pages.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Ends one page this app started, by its own handle, and reaps it.
fn end(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Starts the page for `mind` and returns at once. The one this app
/// started for that mind before is ended first, so a second click opens
/// the page afresh and servers never pile up. A thread of its own reaps it
/// once it ends by itself; the page runs as long as it likes.
fn start_in(pages: &'static Pages, mind: &str, mut command: Command) -> Result<u32, &'static str> {
    let mut held_now = held(pages);
    if let Some(before) = held_now.remove(mind) {
        end(before);
    }
    let child = command.spawn().map_err(|_| "own_page_unavailable")?;
    let pid = child.id();
    held_now.insert(mind.to_owned(), child);
    drop(held_now);
    let mind = mind.to_owned();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        let mut held_now = held(pages);
        match held_now.get_mut(&mind) {
            Some(child) if child.id() == pid => {
                if !matches!(child.try_wait(), Ok(None)) {
                    held_now.remove(&mind);
                    return;
                }
            }
            // Ended here, or replaced by a fresh one: nothing left to reap.
            _ => return,
        }
    });
    Ok(pid)
}

/// Ends every page `pages` holds.
fn end_all_in(pages: &Pages) {
    let all: Vec<Child> = held(pages).drain().map(|(_, child)| child).collect();
    for child in all {
        end(child);
    }
}

/// Ends every Mnemos page this app started: the app is quitting.
pub(crate) fn end_own_pages() {
    end_all_in(pages());
}

/// The spec for the open mind's own page: the mind the place holds, found
/// again by its id and its file, so it is the very store the place shows.
fn spec_for(home: &Path, key: &MindKey) -> Option<Spawn> {
    link::minds(home)
        .into_iter()
        .find(|found| {
            found.scope.agent_id == key.agent
                && found.file.canonicalize().ok().as_deref() == Some(key.file.as_path())
        })
        .map(|found| Spawn {
            home: home.to_owned(),
            db: key.file.clone(),
            agent: found.scope.agent_id.clone(),
            person: found.scope.person_id.clone(),
            project: found.scope.project_scope.clone(),
        })
}

/// Open Mnemos's own page for the mind open in the place, on the person's
/// click: start their `mnemos log` for it, and don't wait on it. A second
/// click ends the one this app started for that mind and starts it afresh.
#[tauri::command]
pub async fn open_mnemos_own_page(window: Window, mind: String) -> Result<(), String> {
    main_window(&window)?;
    let key = place().open_key(&mind).await.ok_or("not_open")?;
    let home = dirs::home_dir().ok_or(UNAVAILABLE)?;
    let program = link::command(&home).ok_or("mnemos_unavailable")?;
    let lookup = home.clone();
    let spec = tokio::task::spawn_blocking(move || spec_for(&lookup, &key))
        .await
        .map_err(|_| UNAVAILABLE)?
        .ok_or("mind_unavailable")?;
    let page = command(Command::new(program), &spec);
    tokio::task::spawn_blocking(move || start_in(pages(), &mind, page))
        .await
        .map_err(|_| UNAVAILABLE)?
        .map(|_| ())
        .map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{command, end_all_in, start_in, Pages, Spawn};
    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
        process::Command,
        sync::Mutex,
        time::{Duration, Instant},
    };

    /// A registry of its own for each test, so tests never end each
    /// other's pages.
    fn registry() -> &'static Pages {
        Box::leak(Box::new(Mutex::new(HashMap::new())))
    }

    /// A stand-in for `mnemos`: it writes the arguments and the environment
    /// it was started with, then stays for `stay` seconds, as a page would.
    fn fake(dir: &Path, stay: u32) -> PathBuf {
        let path = dir.join("fake-mnemos");
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{args}'\nenv > '{env}'\npwd > '{cwd}'\nexec sleep {stay}\n",
            args = dir.join("args.txt").display(),
            env = dir.join("env.txt").display(),
            cwd = dir.join("cwd.txt").display(),
        );
        std::fs::write(&path, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn spec(dir: &Path) -> Spawn {
        Spawn {
            home: dir.to_owned(),
            db: dir.join(".mnemos/kestrel.db"),
            agent: "kestrel".into(),
            person: "pat-example".into(),
            project: "lighthouse".into(),
        }
    }

    /// Waits for the fake to have written `name`.
    fn written(dir: &Path, name: &str) -> String {
        let path = dir.join(name);
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if let Ok(text) = std::fs::read_to_string(&path) {
                if !text.is_empty() {
                    return text;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("the fake never wrote {name}");
    }

    /// The process's state letter, or None once it is gone entirely.
    fn stat(pid: u32) -> Option<String> {
        let out = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let stat = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        (!stat.is_empty()).then_some(stat)
    }

    fn running(pid: u32) -> bool {
        stat(pid).is_some_and(|s| !s.starts_with('Z'))
    }

    /// Whether it is gone entirely (ended and reaped) within five seconds.
    fn gone(pid: u32) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if stat(pid).is_none() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    fn stop(pid: u32) {
        let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
    }

    #[test]
    fn the_page_gets_log_and_all_four_flags_and_none_of_the_apps_environment() {
        let dir = tempfile::tempdir().unwrap();
        let program = fake(dir.path(), 0);
        // The app's own environment, as a resident's shell might leave it.
        let mut base = Command::new(&program);
        base.env("CLAUDECODE", "1")
            .env("AI_AGENT", "someone")
            .env("MNEMOS_AGENT_ID", "another-mind")
            .env("MNEMOS_DB_PATH", "/elsewhere.db")
            .env("MNEMOS_PERSON_NAME", "someone else");
        let pages = registry();
        let pid = start_in(pages, "kestrel", command(base, &spec(dir.path()))).unwrap();
        let args: Vec<String> = written(dir.path(), "args.txt")
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(
            args,
            [
                "log",
                "--db-path",
                &dir.path().join(".mnemos/kestrel.db").display().to_string(),
                "--agent-id",
                "kestrel",
                "--person-id",
                "pat-example",
                "--project-scope",
                "lighthouse",
            ]
        );
        let env = written(dir.path(), "env.txt");
        let names: Vec<&str> = env
            .lines()
            .filter_map(|line| line.split('=').next())
            .filter(|name| !["PWD", "SHLVL", "_", "OLDPWD"].contains(name))
            .collect();
        assert_eq!(names.len(), 2, "only HOME and PATH: {env}");
        assert!(env
            .lines()
            .any(|l| l == format!("HOME={}", dir.path().display())));
        assert!(env
            .lines()
            .any(|l| l == "PATH=/usr/bin:/bin:/usr/sbin:/sbin"));
        for gone in ["CLAUDECODE", "AI_AGENT", "MNEMOS_"] {
            assert!(!env.contains(gone), "{gone} reached the page: {env}");
        }
        let cwd = written(dir.path(), "cwd.txt");
        assert_eq!(
            Path::new(cwd.trim()).canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
        assert!(gone(pid), "the page that ended was never reaped");
    }

    #[test]
    fn nothing_waits_on_the_page_and_it_is_reaped_when_it_ends() {
        let dir = tempfile::tempdir().unwrap();
        let program = fake(dir.path(), 30);
        let pages = registry();
        let began = Instant::now();
        let pid = start_in(
            pages,
            "kestrel",
            command(Command::new(&program), &spec(dir.path())),
        )
        .unwrap();
        assert!(
            began.elapsed() < Duration::from_secs(2),
            "start waited on the page: {:?}",
            began.elapsed()
        );
        written(dir.path(), "args.txt");
        assert!(
            running(pid),
            "the page is still running after start returned"
        );
        // It ends by itself (here, from outside): its own thread reaps it,
        // and lets go of its handle.
        stop(pid);
        assert!(gone(pid), "the ended page was never reaped");
        let deadline = Instant::now() + Duration::from_secs(5);
        while pages.lock().unwrap().contains_key("kestrel") && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(!pages.lock().unwrap().contains_key("kestrel"));
    }

    #[test]
    fn a_second_click_ends_the_first_page_and_starts_a_fresh_one() {
        let dir = tempfile::tempdir().unwrap();
        let program = fake(dir.path(), 30);
        let other = tempfile::tempdir().unwrap();
        let other_program = fake(other.path(), 30);
        let pages = registry();
        let first = start_in(
            pages,
            "kestrel",
            command(Command::new(&program), &spec(dir.path())),
        )
        .unwrap();
        // Another mind's page is its own, and stays.
        let wren = start_in(
            pages,
            "wren",
            command(Command::new(&other_program), &spec(other.path())),
        )
        .unwrap();
        written(dir.path(), "args.txt");
        let second = start_in(
            pages,
            "kestrel",
            command(Command::new(&program), &spec(dir.path())),
        )
        .unwrap();
        assert_ne!(first, second);
        assert!(gone(first), "the first page was not ended and reaped");
        assert!(running(second), "the fresh page isn't running");
        assert!(running(wren), "another mind's page was ended");
        assert_eq!(pages.lock().unwrap().len(), 2, "one page per mind");
        end_all_in(pages);
        assert!(gone(second) && gone(wren));
    }

    #[test]
    fn quitting_ends_every_page_this_app_started_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let program = fake(dir.path(), 30);
        let pages = registry();
        let a = start_in(
            pages,
            "kestrel",
            command(Command::new(&program), &spec(dir.path())),
        )
        .unwrap();
        let b = start_in(
            pages,
            "wren",
            command(Command::new(&program), &spec(dir.path())),
        )
        .unwrap();
        // A process this app did not start, as a page the person opened by
        // hand would be.
        let mut theirs = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        assert!(running(a) && running(b));
        end_all_in(pages);
        assert!(gone(a) && gone(b), "a page outlived the app");
        assert!(pages.lock().unwrap().is_empty());
        assert!(
            running(theirs.id()),
            "a process the app didn't start was ended"
        );
        let _ = theirs.kill();
        let _ = theirs.wait();
    }

    #[test]
    fn a_missing_mnemos_says_so_plainly() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("no-such-mnemos");
        assert_eq!(
            start_in(
                registry(),
                "kestrel",
                command(Command::new(missing), &spec(dir.path()))
            ),
            Err("own_page_unavailable")
        );
    }
}

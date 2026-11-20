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
    path::Path,
    process::{Command, Stdio},
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

/// Starts it and returns at once. A thread of its own waits for it to end,
/// so it never lingers once it does; the page runs as long as it likes.
fn start(mut command: Command) -> Result<u32, &'static str> {
    let mut child = command.spawn().map_err(|_| "own_page_unavailable")?;
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(pid)
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
/// click: start their `mnemos log` for it, and don't wait on it.
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
    start(command(Command::new(program), &spec))
        .map(|_| ())
        .map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::{command, start, Spawn};
    use std::{
        path::{Path, PathBuf},
        process::Command,
        time::{Duration, Instant},
    };

    /// A stand-in for `mnemos`: it writes the arguments and the environment
    /// it was started with, then stays for `stay` seconds, as a page would.
    fn fake(dir: &Path, stay: u32) -> PathBuf {
        let path = dir.join("fake-mnemos");
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{args}'\nenv > '{env}'\npwd > '{cwd}'\nsleep {stay}\n",
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

    /// Whether the process with this id has ended (gone, or only waiting to
    /// be reaped).
    fn running(pid: u32) -> bool {
        let out = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let stat = String::from_utf8_lossy(&out.stdout);
        !stat.trim().is_empty() && !stat.trim().starts_with('Z')
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
        let pid = start(command(base, &spec(dir.path()))).unwrap();
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
        assert!(env.lines().any(|l| l == "PATH=/usr/bin:/bin:/usr/sbin:/sbin"));
        for gone in ["CLAUDECODE", "AI_AGENT", "MNEMOS_"] {
            assert!(!env.contains(gone), "{gone} reached the page: {env}");
        }
        let cwd = written(dir.path(), "cwd.txt");
        assert_eq!(
            Path::new(cwd.trim()).canonicalize().unwrap(),
            dir.path().canonicalize().unwrap()
        );
        stop(pid);
    }

    #[test]
    fn nothing_waits_on_the_page_and_it_is_reaped_when_it_ends() {
        let dir = tempfile::tempdir().unwrap();
        let program = fake(dir.path(), 30);
        let began = Instant::now();
        let pid = start(command(Command::new(&program), &spec(dir.path()))).unwrap();
        assert!(
            began.elapsed() < Duration::from_secs(2),
            "start waited on the page: {:?}",
            began.elapsed()
        );
        written(dir.path(), "args.txt");
        assert!(running(pid), "the page is still running after start returned");
        // Once it ends, its own thread reaps it: no zombie is left behind.
        stop(pid);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut gone = false;
        while Instant::now() < deadline {
            let out = Command::new("/bin/ps")
                .args(["-o", "stat=", "-p", &pid.to_string()])
                .output()
                .unwrap();
            if String::from_utf8_lossy(&out.stdout).trim().is_empty() {
                gone = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(gone, "the ended page was never reaped");
    }

    #[test]
    fn a_missing_mnemos_says_so_plainly() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("no-such-mnemos");
        assert_eq!(
            start(command(Command::new(missing), &spec(dir.path()))),
            Err("own_page_unavailable")
        );
    }
}

//! The newer Mnemos: opened as the person with `hello`, the notebook passed
//! through, the three new writes, and the pictures. A fake program stands in
//! for every write of the quiet hours: no test sends a well-formed `hours`
//! to a real engine, because a real one puts a job in the Mac's scheduler.
use super::{
    session::{self, Fail, MindKey, Place, Spawn},
    wire::{self, Exchange, Part, Reply, Request, SharedAction, Write, Written},
};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;

const LIMIT: Duration = Duration::from_secs(5);

/// A stand-in for a newer `mnemos interface`. `noflags` is a Mnemos that
/// refuses the newer flags (and so knows no `hello`); `asagent` says it
/// writes as the agent.
fn fake(dir: &Path, mode: &str) -> PathBuf {
    let path = dir.join("fake-newer-mnemos");
    let studio = session::studio_of(dir, "wren");
    let script = format!(
        r#"#!/bin/sh
MODE='{mode}'
if [ "$MODE" = noflags ]; then
  case " $* " in *" --as-person "*) exit 2 ;; esac
fi
while IFS= read -r line; do
  printf '%s\n' "$*" >> '{argv}'
  id=$(printf '%s' "$line" | sed -n 's/.*"id": *\([0-9][0-9]*\).*/\1/p')
  cmd=$(printf '%s' "$line" | sed -n 's/.*"command": *"\([a-z]*\)".*/\1/p')
  part=$(printf '%s' "$line" | sed -n 's/.*"part": *"\([a-z]*\)".*/\1/p')
  [ "$MODE" = noflags ] && [ "$cmd" = hello ] && cmd=none
  printf '%s\n' "$cmd" >> '{sent}'
  case "$cmd" in
    hello)
      as=person; [ "$MODE" = asagent ] && as=agent
      printf '{{"id":%s,"result":{{"protocol":1,"mnemos":"0.7.0","schema":19,"commands":["memories","search","correct","forget","journal","notes","reply","note","hello","notebook","summary","read","hours","shared"],"parts":["life","memories","pulse"],"writes_as":"%s","strict_scope":true,"scope":{{"agent_id":"wren","person_id":"pat-example","project_scope":"lighthouse","held":true}}}}}}\n' "$id" "$as" ;;
    summary) printf '{{"id":%s,"result":{{"missing":false,"counts":{{"memories":2}},"unread":1,"waiting":0,"change_token":"t1"}}}}\n' "$id" ;;
    notebook)
      if [ "$part" = life ]; then
        printf '{{"id":%s,"result":{{"part":"life","document":{{"notes":[{{"id":"note_9","text":"A made-up note.","author":"agent"}}],"studio":[]}},"pictures":{{"week.png":"{studio}/week.png","big.png":"{studio}/big.png","linked.png":"{studio}/linked.png","fake.png":"{studio}/fake.png","dot.svg":"{studio}/dot.svg","outside.png":"{dir}/outside.png","hidden.png":"{studio}/.hidden/hidden.png"}}}}}}\n' "$id"
      elif [ "$MODE" = wrongpart ]; then
        printf '{{"id":%s,"result":{{"part":"life","document":{{"memories":[]}}}}}}\n' "$id"
      else
        printf '{{"id":%s,"result":{{"part":"memories","document":{{"version":"v1","memories":[{{"id":"engram_N","ties":[]}}]}},"page":{{"offset":0,"limit":1,"total":2,"next":1}}}}}}\n' "$id"
      fi ;;
    read|hours|shared)
      printf '%s\n' "$line" >> '{writes}'
      case "$cmd" in
        read) printf '{{"id":%s,"result":["note_9"]}}\n' "$id" ;;
        hours) printf '{{"id":%s,"result":"Quiet hours are on, a made-up answer."}}\n' "$id" ;;
        shared) printf '{{"id":%s,"result":"Added to the shared notebook."}}\n' "$id" ;;
      esac ;;
    memories) printf '{{"id":%s,"result":{{"memories":[],"counts":{{"active":0,"dormant":0,"archived":0}}}}}}\n' "$id" ;;
    *) printf '{{"id":%s,"error":"There is no command %s here."}}\n' "$id" "$cmd" ;;
  esac
done
"#,
        argv = dir.join("argv.log").display(),
        sent = dir.join("sent.log").display(),
        writes = dir.join("writes.log").display(),
        studio = studio.display(),
        dir = dir.display(),
    );
    std::fs::write(&path, script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

struct Rig {
    _dir: tempfile::TempDir,
    /// The temp folder's real path, as the engine names paths.
    home: PathBuf,
    place: &'static Place,
    key: MindKey,
}

impl Rig {
    fn spec(&self) -> Spawn {
        Spawn {
            home: self.home.clone(),
            db: self.key.file.clone(),
            agent: "wren".into(),
            person: "pat-example".into(),
            project: "lighthouse".into(),
        }
    }

    async fn open(&self, mode: &str) -> Result<(), Fail> {
        let program = fake(&self.home, mode);
        let spec = self.spec();
        self.place
            .open(
                |newer| session::command(Command::new(&program), &spec, newer),
                self.key.clone(),
                session::studio_of(&spec.home, &spec.agent),
                LIMIT,
            )
            .await
    }

    fn lines(&self, name: &str) -> Vec<String> {
        std::fs::read_to_string(self.home.join(name))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    // Real paths, as the engine gives them (the temp folder may be a link).
    let home = dir.path().canonicalize().unwrap();
    let db = home.join("wren.db");
    std::fs::write(&db, b"made-up store").unwrap();
    let key = MindKey::of("wren", &db).unwrap();
    Rig {
        _dir: dir,
        home,
        place: Box::leak(Box::new(Place::new())),
        key,
    }
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n made-up picture";

/// The studio's made-up pictures: two good ones, one too big, one a link,
/// one not a picture inside, one svg, one hidden, one outside the studio.
fn studio(rig: &Rig) -> PathBuf {
    let home = &rig.home;
    let studio = session::studio_of(home, "wren");
    std::fs::create_dir_all(studio.join(".hidden")).unwrap();
    std::fs::write(studio.join("week.png"), PNG).unwrap();
    std::fs::write(studio.join("night.gif"), b"GIF89a made-up").unwrap();
    let big = vec![0u8; session::MOST_PICTURE as usize + 1];
    let mut big_png = PNG.to_vec();
    big_png.extend(big);
    std::fs::write(studio.join("big.png"), big_png).unwrap();
    std::fs::write(home.join("outside.png"), PNG).unwrap();
    std::os::unix::fs::symlink(home.join("outside.png"), studio.join("linked.png")).unwrap();
    std::fs::write(studio.join("fake.png"), b"not a picture at all").unwrap();
    std::fs::write(studio.join("dot.svg"), b"<svg/>").unwrap();
    std::fs::write(studio.join(".hidden/hidden.png"), PNG).unwrap();
    studio
}

#[tokio::test]
async fn a_newer_mnemos_is_opened_as_the_person_and_says_hello() {
    let rig = rig();
    rig.open("plain").await.unwrap();
    let hello = rig.place.hello("wren").await.expect("hello kept");
    assert_eq!(hello["writes_as"], "person");
    assert!(hello["commands"]
        .as_array()
        .unwrap()
        .contains(&json!("notebook")));
    let argv = rig.lines("argv.log");
    assert!(argv
        .iter()
        .all(|l| l.contains("--as-person") && l.contains("--strict-scope")));
    assert!(argv.iter().all(|l| l.contains("--agent-id wren")
        && l.contains("--person-id pat-example")
        && l.contains("--project-scope lighthouse")));
    assert_eq!(rig.lines("sent.log"), ["hello"], "hello once, nothing else");
    rig.place.end().await;
}

#[tokio::test]
async fn a_mnemos_that_refuses_the_flags_is_opened_as_before() {
    let rig = rig();
    rig.open("noflags").await.unwrap();
    assert!(rig.place.hello("wren").await.is_none());
    let argv = rig.lines("argv.log");
    assert!(!argv.is_empty());
    assert!(argv.iter().all(|l| !l.contains("--as-person")));
    // The first eight still answer; nothing new is ever sent to it.
    assert!(rig.place.ask("wren", &memories(), LIMIT).await.is_ok());
    for request in [
        Request::Summary {},
        Request::Notebook {
            part: Part::Life,
            limit: None,
            offset: None,
            since: None,
        },
    ] {
        let fail = rig.place.ask("wren", &request, LIMIT).await.unwrap_err();
        assert_eq!(fail, Fail::Unanswered);
        assert_eq!(fail.code(), "mnemos_needs_newer");
    }
    let read = Write::Read {
        note_ids: vec!["note_9".into()],
    };
    assert_eq!(
        rig.place.ask("wren", &read, LIMIT).await.unwrap_err(),
        Fail::Unanswered
    );
    assert_eq!(rig.lines("sent.log"), ["none", "memories"]);
    assert!(rig.place.pid().is_some(), "the process stays");
    rig.place.end().await;
}

#[tokio::test]
async fn a_hello_that_writes_as_the_agent_is_refused() {
    let rig = rig();
    assert_eq!(rig.open("asagent").await.unwrap_err(), Fail::Invalid);
    assert!(rig.place.pid().is_none());
    assert_eq!(
        rig.place
            .ask("wren", &Request::Summary {}, LIMIT)
            .await
            .unwrap_err(),
        Fail::NotOpen
    );
}

fn memories() -> Request {
    Request::Memories {
        state: None,
        limit: 5,
        offset: 0,
    }
}

fn life() -> Request {
    Request::Notebook {
        part: Part::Life,
        limit: None,
        offset: None,
        since: None,
    }
}

#[tokio::test]
async fn the_notebook_passes_through_and_its_ids_are_known() {
    let rig = rig();
    rig.open("plain").await.unwrap();
    let Reply::Summary { summary } = rig
        .place
        .ask("wren", &Request::Summary {}, LIMIT)
        .await
        .unwrap()
    else {
        panic!("not a summary");
    };
    assert_eq!(summary["change_token"], "t1");
    let page = Request::Notebook {
        part: Part::Memories,
        limit: Some(1),
        offset: Some(0),
        since: None,
    };
    let Reply::Notebook {
        part,
        document,
        page,
        ..
    } = rig.place.ask("wren", &page, LIMIT).await.unwrap()
    else {
        panic!("not a notebook part");
    };
    assert_eq!(part, Part::Memories);
    assert_eq!(document["version"], "v1");
    assert_eq!(page.unwrap()["next"], 1);
    assert!(rig.place.admit("wren", "engram_N").await);
    assert!(!rig.place.admit("wren", "note_9").await, "not read yet");
    let reply = rig.place.ask("wren", &life(), LIMIT).await.unwrap();
    assert!(rig.place.admit("wren", "note_9").await);
    // The page is told the pictures' notebook paths, never the files.
    let shown = serde_json::to_value(&reply).unwrap();
    assert_eq!(shown["kind"], "notebook");
    assert!(shown["pictures"]
        .as_array()
        .unwrap()
        .contains(&json!("week.png")));
    assert!(!shown.to_string().contains(&rig.home.display().to_string()));
    rig.place.end().await;
}

#[tokio::test]
async fn a_notebook_answer_of_the_wrong_shape_is_refused() {
    let rig = rig();
    rig.open("wrongpart").await.unwrap();
    let page = Request::Notebook {
        part: Part::Memories,
        limit: Some(1),
        offset: Some(0),
        since: None,
    };
    assert_eq!(
        rig.place.ask("wren", &page, LIMIT).await.unwrap_err(),
        Fail::Invalid
    );
}

#[test]
fn the_notebooks_envelope_is_checked() {
    let memories = Request::Notebook {
        part: Part::Memories,
        limit: Some(500),
        offset: Some(0),
        since: None,
    };
    let ok = br#"{"id":1,"result":{"part":"memories","document":{"version":"v","memories":[]},"page":{"next":null}}}"#;
    assert!(wire::parse(ok, 1, &memories).is_ok());
    for bad in [
        br#"{"id":1,"result":{"part":"life","document":{"memories":[]}}}"#.as_slice(),
        br#"{"id":1,"result":{"part":"memories","document":[]}}"#,
        br#"{"id":1,"result":{"part":"memories","document":{"memories":{}}}}"#,
        br#"{"id":1,"result":{"part":"memories","document":{"memories":[]},"page":3}}"#,
        br#"{"id":1,"result":{"part":"memories"}}"#,
    ] {
        assert!(
            wire::parse(bad, 1, &memories).is_err(),
            "{}",
            String::from_utf8_lossy(bad)
        );
    }
    let life = life();
    let bad_pictures = br#"{"id":1,"result":{"part":"life","document":{},"pictures":{"a.png":3}}}"#;
    assert!(wire::parse(bad_pictures, 1, &life).is_err());
    let summary = Request::Summary {};
    assert!(wire::parse(br#"{"id":1,"result":{"counts":{}}}"#, 1, &summary).is_err());
    assert!(wire::parse(
        br#"{"id":1,"result":{"counts":{},"change_token":"x"}}"#,
        1,
        &summary
    )
    .is_ok());
    // What the page may ask is bounded too.
    for request in [
        Request::Notebook {
            part: Part::Memories,
            limit: Some(wire::MAX_NOTEBOOK_PAGE + 1),
            offset: None,
            since: None,
        },
        Request::Notebook {
            part: Part::Memories,
            limit: Some(0),
            offset: None,
            since: None,
        },
        Request::Notebook {
            part: Part::Life,
            limit: Some(5),
            offset: None,
            since: None,
        },
        Request::Notebook {
            part: Part::Pulse,
            limit: None,
            offset: None,
            since: Some("yesterday".into()),
        },
    ] {
        assert!(wire::Exchange::check(&request).is_err(), "{request:?}");
    }
    let from_page = json!({"command": "notebook", "part": "everything"});
    assert!(serde_json::from_value::<Request>(from_page).is_err());
}

#[tokio::test]
async fn the_three_new_writes_go_once_with_only_known_ids() {
    let rig = rig();
    rig.open("plain").await.unwrap();
    let read = Write::Read {
        note_ids: vec!["note_9".into()],
    };
    assert_eq!(
        rig.place.ask("wren", &read, LIMIT).await.unwrap_err(),
        Fail::UnknownItem,
        "no note read yet"
    );
    rig.place.ask("wren", &life(), LIMIT).await.unwrap();
    let Written::Read { ids } = rig.place.ask("wren", &read, LIMIT).await.unwrap() else {
        panic!("not read");
    };
    assert_eq!(ids, ["note_9"]);
    // The quiet hours, against this fake only.
    let hours: Write = serde_json::from_value(
        json!({"command": "hours", "hours": {"mine": {"on": true, "at": "03:00"}}}),
    )
    .unwrap();
    let Written::Hours { said } = rig.place.ask("wren", &hours, LIMIT).await.unwrap() else {
        panic!("not hours");
    };
    assert!(said.contains("made-up"));
    let shared = Write::Shared {
        action: SharedAction::Add,
        text: Some("We keep the lantern lit, made-up.".into()),
        memory_id: None,
        confirmed: false,
    };
    assert!(matches!(
        rig.place.ask("wren", &shared, LIMIT).await.unwrap(),
        Written::Shared { .. }
    ));
    let forget = Write::Shared {
        action: SharedAction::Forget,
        text: None,
        memory_id: Some("engram_unknown".into()),
        confirmed: true,
    };
    assert_eq!(
        rig.place.ask("wren", &forget, LIMIT).await.unwrap_err(),
        Fail::UnknownItem
    );
    let writes: Vec<serde_json::Value> = rig
        .lines("writes.log")
        .iter()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(writes.len(), 3, "each sent once");
    assert_eq!(
        writes[1],
        json!({"id": writes[1]["id"], "command": "hours", "hours": {"mine": {"on": true, "at": "03:00"}}})
    );
    assert_eq!(
        writes[2],
        json!({"id": writes[2]["id"], "command": "shared", "action": "add", "text": "We keep the lantern lit, made-up."})
    );
    rig.place.end().await;
}

#[tokio::test]
async fn only_a_listed_picture_inside_the_studio_is_read() {
    let rig = rig();
    studio(&rig);
    rig.open("plain").await.unwrap();
    assert_eq!(
        rig.place.picture("wren", "week.png").await.unwrap_err(),
        Fail::UnknownItem,
        "nothing listed yet"
    );
    rig.place.ask("wren", &life(), LIMIT).await.unwrap();
    assert_eq!(rig.place.picture("wren", "week.png").await.unwrap(), PNG);
    for refused in [
        "night.gif",   // in the studio, but never listed
        "../wren.db",  // not a path the engine listed
        "big.png",     // over 6 MB
        "linked.png",  // a link out of the studio
        "fake.png",    // named a picture, isn't one
        "dot.svg",     // not one of the four kinds
        "outside.png", // listed, but outside the studio
        "hidden.png",  // inside a hidden folder
    ] {
        assert!(
            rig.place.picture("wren", refused).await.is_err(),
            "{refused} was read"
        );
    }
    assert_eq!(
        rig.place
            .picture("field-notes", "week.png")
            .await
            .unwrap_err(),
        Fail::NotOpen
    );
    rig.place.end().await;
    assert!(rig.place.picture("wren", "week.png").await.is_err());
}

#[test]
fn a_picture_is_read_only_the_way_the_notebook_allows() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path().canonicalize().unwrap();
    let studio = session::studio_of(&home, "wren");
    std::fs::create_dir_all(&studio).unwrap();
    let good = studio.join("week.webp");
    let mut webp = b"RIFF\0\0\0\0WEBP".to_vec();
    webp.extend_from_slice(b"made-up");
    std::fs::write(&good, &webp).unwrap();
    assert_eq!(session::read_picture(&good, &studio).unwrap(), webp);
    // The same file named through a link to the studio is refused: the
    // engine names real paths.
    std::os::unix::fs::symlink(&studio, home.join("studio-link")).unwrap();
    assert!(session::read_picture(&home.join("studio-link/week.webp"), &studio).is_err());
    // A path that climbs out.
    std::fs::write(home.join("away.png"), PNG).unwrap();
    assert!(session::read_picture(&studio.join("../away.png"), &studio).is_err());
    // A folder, and nothing at all.
    assert!(session::read_picture(&studio, &studio).is_err());
    assert!(session::read_picture(&studio.join("none.png"), &studio).is_err());
}

/// The newer engine itself, through the test seam: its code from its own
/// worktree, run by the main Mnemos checkout's Python, with `HOME` and the
/// store in a temporary folder. The app's own lookup of `mnemos` is not
/// used or changed. It reads hello, the summary, the notebook a page at a
/// time, and marks a note read. It never sends `hours`.
#[tokio::test]
async fn the_newer_engine_through_the_test_seam() {
    let Some(real_home) = dirs::home_dir() else {
        return;
    };
    let python = real_home.join("Documents/Repositories/mnemos/.venv/bin/python");
    let engine = real_home.join("Documents/Repositories/.claude-worktrees/mnemos-wp46-interface");
    if !python.is_file() || !engine.join("mnemos/interface/person.py").is_file() {
        eprintln!("skipped: the newer engine's worktree isn't on this machine");
        return;
    }
    let home = tempfile::tempdir().unwrap();
    let home_path = home.path().canonicalize().unwrap();
    let db = home_path.join("made-up.db");
    const RUN: [&str; 2] = [
        "-c",
        "import sys; from mnemos.cli import main; sys.exit(main())",
    ];
    let seam = |base: &mut std::process::Command| {
        base.env_clear()
            .env("HOME", &home_path)
            .env("PATH", session::PATH)
            .env("PYTHONPATH", &engine)
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("HF_HUB_OFFLINE", "1")
            .args(RUN);
    };
    let scope = [
        "--db-path",
        db.to_str().unwrap(),
        "--agent-id",
        "wren",
        "--person-id",
        "pat-example",
        "--project-scope",
        "lighthouse",
    ];
    for words in [
        "The lantern is checked before dusk, a made-up memory.",
        "The ferry runs late in fog, a made-up memory.",
        "The tide tables live by the door, a made-up memory.",
    ] {
        let mut remember = std::process::Command::new(&python);
        seam(&mut remember);
        let kept = remember
            .arg("remember")
            .args(scope)
            .arg(words)
            .output()
            .unwrap();
        assert!(kept.status.success(), "remember failed");
    }
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO notes (id, agent_id, person_id, project_scope, kind, text, author, \
             created_at) VALUES ('note_agent', 'wren', 'pat-example', 'lighthouse', 'thought', \
             'The fog lifted early, a made-up note.', 'agent', '2026-11-01T10:00:00+00:00')",
            [],
        )
        .unwrap();
    }
    let key = MindKey::of("wren", &db).unwrap();
    let place: &'static Place = Box::leak(Box::new(Place::new()));
    let spec = Spawn {
        home: home_path.clone(),
        db: key.file.clone(),
        agent: "wren".into(),
        person: "pat-example".into(),
        project: "lighthouse".into(),
    };
    let limit = Duration::from_secs(60);
    place
        .open(
            |newer| {
                // The program's own arguments come before `interface`.
                let mut base = Command::new(&python);
                base.args(RUN);
                let mut command = session::command(base, &spec, newer);
                // After `command` clears the environment: the seam's own.
                command
                    .env("PYTHONPATH", &engine)
                    .env("PYTHONDONTWRITEBYTECODE", "1")
                    .env("HF_HUB_OFFLINE", "1");
                command
            },
            key,
            session::studio_of(&spec.home, &spec.agent),
            limit,
        )
        .await
        .unwrap();
    let hello = place
        .hello("wren")
        .await
        .expect("the newer engine says hello");
    assert_eq!(hello["writes_as"], "person");
    assert_eq!(hello["strict_scope"], true);
    assert_eq!(hello["scope"]["agent_id"], "wren");

    let Reply::Summary { summary } = place
        .ask("wren", &Request::Summary {}, limit)
        .await
        .unwrap()
    else {
        panic!("not a summary");
    };
    assert_eq!(summary["counts"]["memories"], 3);
    assert_eq!(summary["unread"], 1);
    let token = summary["change_token"].as_str().unwrap().to_owned();

    // The memories, a page of one at a time, following `next`.
    let mut offset = Some(0);
    let mut seen = Vec::new();
    let mut version = None;
    while let Some(at) = offset {
        let Reply::Notebook { document, page, .. } = place
            .ask(
                "wren",
                &Request::Notebook {
                    part: Part::Memories,
                    limit: Some(1),
                    offset: Some(at),
                    since: None,
                },
                limit,
            )
            .await
            .unwrap()
        else {
            panic!("not a notebook part");
        };
        let this = document["version"].as_str().unwrap().to_owned();
        assert!(version.get_or_insert(this.clone()) == &this, "one version");
        for memory in document["memories"].as_array().unwrap() {
            seen.push(memory["id"].as_str().unwrap().to_owned());
        }
        offset = page.unwrap()["next"].as_u64().map(|n| n as u32);
    }
    assert_eq!(seen.len(), 3);
    for id in &seen {
        assert!(place.admit("wren", id).await);
    }

    let Reply::Notebook { document, .. } = place.ask("wren", &life(), limit).await.unwrap() else {
        panic!("not life");
    };
    assert_eq!(document["identity"]["agentId"], "wren");
    let Written::Read { ids } = place
        .ask(
            "wren",
            &Write::Read {
                note_ids: vec!["note_agent".into()],
            },
            limit,
        )
        .await
        .unwrap()
    else {
        panic!("not read");
    };
    assert_eq!(ids, ["note_agent"]);
    let Reply::Summary { summary } = place
        .ask("wren", &Request::Summary {}, limit)
        .await
        .unwrap()
    else {
        panic!("not a summary");
    };
    assert_eq!(summary["unread"], 0);
    assert_ne!(
        summary["change_token"].as_str().unwrap(),
        token,
        "a note read"
    );
    place.end().await;
}

/// A change of the quiet hours as the webview sends one.
fn hours_write(hours: serde_json::Value) -> Write {
    serde_json::from_value(json!({"command": "hours", "hours": hours})).unwrap()
}

#[test]
fn the_older_all_at_once_hours_no_longer_parse() {
    for older in [
        json!({"command": "hours", "on": true, "mine": "08:00", "ours": "19:00", "dream": "03:30"}),
        json!({"command": "hours", "on": true, "mine": "", "ours": "", "dream": ""}),
        json!({"command": "hours", "on": false}),
        json!({"command": "hours", "on": false, "hours": {"mine": {"on": false}}}),
        json!({"command": "hours"}),
    ] {
        assert!(
            serde_json::from_value::<Write>(older.clone()).is_err(),
            "{older}"
        );
    }
}

#[test]
fn every_unfit_hours_change_is_refused_by_name() {
    let refused = |hours: serde_json::Value| wire::hours_unfit(hours.as_object().unwrap());
    // Only `mine`, `ours` and `dream`, and at least one of them.
    assert_eq!(
        refused(json!({})),
        Some("Nothing was sent: no quiet hour was changed.")
    );
    for name in ["nap", "Mine", "", "dreams"] {
        assert_eq!(
            refused(json!({name: {"on": true}})),
            Some("Nothing was sent: the quiet hours are its own hour, our hour and the dream."),
            "{name}"
        );
    }
    // Each has `on`, as true or false.
    for change in [
        json!({}),
        json!({"at": "08:00"}),
        json!({"on": "yes"}),
        json!(true),
        json!(null),
    ] {
        assert_eq!(
            refused(json!({"mine": change})),
            Some("Nothing was sent: each quiet hour that changes says whether it's on."),
            "{change}"
        );
    }
    // Nothing unknown.
    for change in [
        json!({"on": true, "length": 30}),
        json!({"on": true, "mine": "08:00"}),
        json!({"on": false, "when": "08:00"}),
    ] {
        assert_eq!(
            refused(json!({"ours": change})),
            Some("Nothing was sent: a quiet hour has only its switch, its start, its length and whether it can go online."),
            "{change}"
        );
    }
    // An hour turned off carries nothing else.
    for change in [
        json!({"on": false, "at": "08:00"}),
        json!({"on": false, "minutes": 30}),
        json!({"on": false, "online": false}),
    ] {
        assert_eq!(
            refused(json!({"mine": change})),
            Some("Nothing was sent: an hour being turned off carries nothing else."),
            "{change}"
        );
    }
    // `at` is HH:MM from 00:00 to 23:59.
    for at in [
        json!("24:00"),
        json!("23:60"),
        json!("8:00"),
        json!("08:00:00"),
        json!("3am"),
        json!(""),
        json!("+8:00"),
        json!(800),
        json!(null),
    ] {
        assert_eq!(
            refused(json!({"dream": {"on": true, "at": at}})),
            Some("Nothing was sent: an hour starts at a time from 00:00 to 23:59."),
            "{at}"
        );
    }
    // `minutes` is a whole number from 5 to 120.
    for minutes in [
        json!(4),
        json!(121),
        json!(0),
        json!(-10),
        json!(30.5),
        json!(30.0),
        json!("30"),
        json!(true),
        json!(null),
    ] {
        assert_eq!(
            refused(json!({"ours": {"on": true, "minutes": minutes}})),
            Some("Nothing was sent: an hour lasts a whole number of minutes, from 5 to 120."),
            "{minutes}"
        );
    }
    // `online` is refused for the dream, on or off, and is true or false.
    for online in [json!(true), json!(false)] {
        assert_eq!(
            refused(json!({"dream": {"on": true, "online": online}})),
            Some("Nothing was sent: the dream never goes online."),
            "{online}"
        );
    }
    for online in [json!("yes"), json!(1), json!(null)] {
        assert_eq!(
            refused(json!({"mine": {"on": true, "online": online}})),
            Some("Nothing was sent: whether an hour can go online is on or off."),
            "{online}"
        );
    }
    // One bad hour refuses the whole request.
    assert!(
        refused(json!({"mine": {"on": true}, "dream": {"on": true, "online": true}})).is_some()
    );
    // What fits.
    for fine in [
        json!({"mine": {"on": true}}),
        json!({"mine": {"on": false}}),
        json!({"ours": {"on": true, "at": "00:00", "minutes": 5, "online": true}}),
        json!({"dream": {"on": true, "at": "23:59", "minutes": 120}}),
        json!({"mine": {"on": true, "online": false}, "ours": {"on": false}, "dream": {"on": true, "minutes": 10}}),
    ] {
        assert_eq!(refused(fine.clone()), None, "{fine}");
        assert!(hours_write(fine).check().is_ok());
    }
    // `check` says the same sentence.
    assert_eq!(
        hours_write(json!({"dream": {"on": true, "online": true}})).check(),
        Err("Nothing was sent: the dream never goes online.")
    );
}

#[tokio::test]
async fn an_hours_change_is_sent_exactly_once_and_an_unfit_one_never() {
    let rig = rig();
    rig.open("plain").await.unwrap();
    // Refused here, in the place's own words, and never sent.
    let unfit = hours_write(json!({"mine": {"on": false, "at": "08:00"}}));
    let fail = rig.place.ask("wren", &unfit, LIMIT).await.unwrap_err();
    assert_eq!(
        fail,
        Fail::Unfit("Nothing was sent: an hour being turned off carries nothing else.")
    );
    assert_eq!(
        fail.told(),
        "invalid_request:Nothing was sent: an hour being turned off carries nothing else."
    );
    assert!(
        rig.lines("writes.log").is_empty(),
        "nothing reached the engine"
    );
    assert!(
        !rig.lines("sent.log").iter().any(|c| c == "hours"),
        "no hours line at all"
    );
    // The session is still open: a good change goes, once, with exactly its body.
    let change = json!({
        "mine": {"on": true, "online": true},
        "ours": {"on": false},
        "dream": {"on": true, "at": "04:15", "minutes": 10},
    });
    let Written::Hours { said } = rig
        .place
        .ask("wren", &hours_write(change.clone()), LIMIT)
        .await
        .unwrap()
    else {
        panic!("not hours");
    };
    assert_eq!(said, "Quiet hours are on, a made-up answer.");
    let writes = rig.lines("writes.log");
    assert_eq!(writes.len(), 1, "sent once");
    let body: serde_json::Value = serde_json::from_str(&writes[0]).unwrap();
    assert_eq!(
        body,
        json!({"id": body["id"], "command": "hours", "hours": change})
    );
    let mut keys: Vec<_> = body.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["command", "hours", "id"], "nothing more");
    rig.place.end().await;
}

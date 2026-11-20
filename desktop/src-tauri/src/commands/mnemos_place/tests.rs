use super::{
    grant::{self, Answer},
    session::{self, Fail, MindKey, Place, Spawn},
    wire::{self, Exchange, Reply, Request, Write, Written},
};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::process::Command;

/// A small stand-in for `mnemos interface`: it logs the flags it was started
/// with for every request it answers, and the environment it was given, and
/// answers each command with made-up words.
fn fake(dir: &Path, mode: &str) -> PathBuf {
    let path = dir.join("fake-mnemos");
    let script = format!(
        r#"#!/bin/sh
LOG='{log}'
env > '{env}'
MODE='{mode}'
[ "$MODE" = old ] && exit 2
while IFS= read -r line; do
  printf '%s\n' "$*" >> "$LOG"
  id=$(printf '%s' "$line" | sed -n 's/.*"id": *\([0-9][0-9]*\).*/\1/p')
  cmd=$(printf '%s' "$line" | sed -n 's/.*"command": *"\([a-z]*\)".*/\1/p')
  [ "$MODE" = slow ] && sleep 0.3
  [ "$MODE" = wrongid ] && id=999
  case "$cmd" in
    memories) printf '{{"id":%s,"result":{{"memories":[{{"id":"engram_A","words":"A made-up memory","kept":"2026-11-01T10:00:00+00:00","state":"active","alive":0.8,"conversation":null,"corrected":null,"impact":"","author":"agent"}}],"counts":{{"active":1,"dormant":0,"archived":0}}}}}}\n' "$id" ;;
    search) [ "$MODE" = hang ] && sleep 5
      printf '{{"id":%s,"result":{{"query":"q","results":[{{"id":"engram_A","words":"A made-up memory","kept":null,"closeness":1.0,"found":"meaning"}}]}}}}\n' "$id" ;;
    journal) if [ "$MODE" = huge ]; then printf '{{"id":%s,"result":"' "$id"; head -c 4200000 /dev/zero | tr '\0' x; printf '"}}\n'; else printf '{{"id":%s,"result":[]}}\n' "$id"; fi ;;
    notes) printf '{{"id":%s,"result":[{{"id":"note_1","kind":"question","text":"Shall I?","author":"agent","model":null,"in_reply_to":null,"created_at":"2026-11-01T10:00:00+00:00","read_at":null}}]}}\n' "$id" ;;
    reply|note)
      printf '%s\n' "$line" >> '{writes}'
      if [ "$MODE" = quiet ]; then printf '{{"id":%s,"error":"Nothing saved: A reply is the person\x27s own words, and no one is in the room during one of the agent\x27s hours."}}\n' "$id"
      else printf '{{"id":%s,"result":{{"id":"note_2","kind":null,"text":"Yes, keep them.","author":"person","model":null,"in_reply_to":"note_1","created_at":"2026-11-01T11:00:00+00:00","read_at":null,"delivered_at":null}}}}\n' "$id"; fi ;;
    correct)
      printf '%s\n' "$line" >> '{writes}'
      if [ "$MODE" = busy ]; then printf '{{"id":%s,"error":"Mnemos couldn\x27t do that (OperationalError: database is locked)."}}\n' "$id"
      else printf '{{"id":%s,"result":{{"id":"engram_B","replaces":"engram_A","corrected":"2026-11-01T12:00:00+00:00"}}}}\n' "$id"; fi ;;
    forget)
      printf '%s\n' "$line" >> '{writes}'
      printf '{{"id":%s,"result":{{"id":"engram_A","state":"archived","forgotten":"2026-11-01T12:00:00+00:00"}}}}\n' "$id" ;;
    *) printf '{{"id":%s,"error":"There is no command here"}}\n' "$id" ;;
  esac
done
"#,
        log = dir.join("argv.log").display(),
        env = dir.join("env.txt").display(),
        writes = dir.join("writes.log").display(),
    );
    std::fs::write(&path, script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

struct Rig {
    dir: tempfile::TempDir,
    place: &'static Place,
    key: MindKey,
}

impl Rig {
    fn spec(&self) -> Spawn {
        Spawn {
            home: self.dir.path().to_owned(),
            db: self.key.file.clone(),
            agent: "wren".into(),
            person: "pat-example".into(),
            project: "lighthouse".into(),
        }
    }
    async fn start(&self, mode: &str) {
        let program = fake(self.dir.path(), mode);
        // The app's own environment, as a resident's shell might leave it.
        let mut base = Command::new(&program);
        base.env("CLAUDECODE", "1")
            .env("AI_AGENT", "someone")
            .env("MNEMOS_AGENT_ID", "another-mind")
            .env("MNEMOS_DB_PATH", "/elsewhere.db");
        let command = session::command(base, &self.spec());
        self.place.start(command, self.key.clone()).await.unwrap();
    }
}

fn rig() -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("wren.db");
    std::fs::write(&db, b"made-up store").unwrap();
    let key = MindKey::of("wren", &db).unwrap();
    Rig {
        dir,
        place: Box::leak(Box::new(Place::new())),
        key,
    }
}

fn memories() -> Request {
    Request::Memories {
        state: None,
        limit: 50,
        offset: 0,
    }
}

/// Whether the process with this id has ended (gone, or only waiting to be
/// reaped).
fn ended(pid: u32) -> bool {
    for _ in 0..80 {
        let out = std::process::Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let stat = String::from_utf8_lossy(&out.stdout);
        if stat.trim().is_empty() || stat.trim().starts_with('Z') {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

#[tokio::test]
async fn every_request_carries_all_four_flags_and_none_of_the_apps_environment() {
    let rig = rig();
    rig.start("plain").await;
    let limit = Duration::from_secs(5);
    let asks = [
        memories(),
        Request::Search {
            query: "the light".into(),
        },
        Request::Journal { last: 5 },
        Request::Notes {},
    ];
    for request in &asks {
        rig.place.ask("wren", request, limit).await.unwrap();
    }
    let log = std::fs::read_to_string(rig.dir.path().join("argv.log")).unwrap();
    let lines: Vec<&str> = log.lines().collect();
    assert_eq!(lines.len(), asks.len());
    let db = rig.key.file.display().to_string();
    for line in lines {
        assert!(line.starts_with("interface "), "{line}");
        for flag in [
            format!("--db-path {db}"),
            "--agent-id wren".into(),
            "--person-id pat-example".into(),
            "--project-scope lighthouse".into(),
        ] {
            assert!(line.contains(&flag), "{flag} missing from {line}");
        }
    }
    let env = std::fs::read_to_string(rig.dir.path().join("env.txt")).unwrap();
    for name in ["CLAUDECODE", "AI_AGENT", "MNEMOS_"] {
        assert!(!env.contains(name), "{name} reached the process");
    }
    assert!(env.contains(&format!("HOME={}", rig.dir.path().display())));
    assert!(env.contains(&format!("PATH={}", session::PATH)));
    rig.place.end().await;
}

#[tokio::test]
async fn a_slow_answer_times_out_and_ends_the_process() {
    let rig = rig();
    rig.start("hang").await;
    let pid = rig.place.pid().unwrap();
    let asked = rig
        .place
        .ask(
            "wren",
            &Request::Search {
                query: "anything".into(),
            },
            Duration::from_millis(300),
        )
        .await;
    assert_eq!(asked.unwrap_err(), Fail::Timeout);
    assert!(ended(pid));
    assert_eq!(
        rig.place
            .ask("wren", &memories(), Duration::from_secs(2))
            .await
            .unwrap_err(),
        Fail::NotOpen
    );
}

#[tokio::test]
async fn an_oversized_answer_is_refused() {
    let rig = rig();
    rig.start("huge").await;
    let asked = rig
        .place
        .ask(
            "wren",
            &Request::Journal { last: 5 },
            Duration::from_secs(10),
        )
        .await;
    assert_eq!(asked.unwrap_err(), Fail::TooLarge);
    assert!(rig.place.pid().is_none());
}

#[tokio::test]
async fn an_answer_to_another_request_is_refused() {
    let rig = rig();
    rig.start("wrongid").await;
    let asked = rig
        .place
        .ask("wren", &memories(), Duration::from_secs(5))
        .await;
    assert_eq!(asked.unwrap_err(), Fail::Invalid);
}

#[tokio::test]
async fn a_second_request_waits_its_turn() {
    let rig = rig();
    rig.start("slow").await;
    let limit = Duration::from_secs(5);
    let started = Instant::now();
    let notes = Request::Notes {};
    let journal = Request::Journal { last: 3 };
    let (one, two) = tokio::join!(
        rig.place.ask("wren", &notes, limit),
        rig.place.ask("wren", &journal, limit)
    );
    assert!(matches!(one.unwrap(), Reply::Notes { .. }));
    assert!(matches!(two.unwrap(), Reply::Journal { .. }));
    assert!(started.elapsed() >= Duration::from_millis(600));
    rig.place.end().await;
}

#[tokio::test]
async fn the_process_ends_when_the_place_is_left() {
    let rig = rig();
    rig.start("plain").await;
    let pid = rig.place.pid().unwrap();
    rig.place.end().await;
    assert!(ended(pid));
    assert_eq!(
        rig.place
            .ask("wren", &memories(), Duration::from_secs(2))
            .await
            .unwrap_err(),
        Fail::NotOpen
    );
}

#[tokio::test]
async fn the_process_ends_after_the_window_stays_hidden_and_not_before() {
    let rig = rig();
    rig.start("plain").await;
    let pid = rig.place.pid().unwrap();
    rig.place.shown(false, Duration::from_millis(250));
    rig.place.shown(true, Duration::from_millis(250));
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(rig.place.pid().is_some(), "shown again before the limit");
    rig.place.shown(false, Duration::from_millis(150));
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(ended(pid));
    assert!(rig.place.pid().is_none());
}

#[tokio::test]
async fn the_process_ends_when_the_app_exits() {
    let rig = rig();
    rig.start("plain").await;
    let pid = rig.place.pid().unwrap();
    rig.place.end_now();
    assert!(ended(pid));
}

#[tokio::test]
async fn a_mnemos_without_the_interface_is_too_old() {
    let rig = rig();
    rig.start("old").await;
    let asked = rig
        .place
        .ask("wren", &memories(), Duration::from_secs(5))
        .await;
    assert_eq!(asked.unwrap_err(), Fail::TooOld);
}

#[tokio::test]
async fn another_mind_is_not_answered() {
    let rig = rig();
    rig.start("plain").await;
    let asked = rig
        .place
        .ask("field-notes", &memories(), Duration::from_secs(2))
        .await;
    assert_eq!(asked.unwrap_err(), Fail::NotOpen);
    rig.place.end().await;
}

#[tokio::test]
async fn a_replaced_store_ends_the_process() {
    let rig = rig();
    rig.start("plain").await;
    let db = rig.key.file.clone();
    std::fs::remove_file(&db).unwrap();
    std::fs::write(&db, b"another store").unwrap();
    let asked = rig
        .place
        .ask("wren", &memories(), Duration::from_secs(2))
        .await;
    assert_eq!(asked.unwrap_err(), Fail::Changed);
    assert!(rig.place.pid().is_none());
}

#[tokio::test]
async fn only_ids_the_engine_returned_are_admitted() {
    let rig = rig();
    rig.start("plain").await;
    assert!(
        !rig.place.admit("wren", "engram_A").await,
        "nothing read yet"
    );
    rig.place
        .ask("wren", &memories(), Duration::from_secs(5))
        .await
        .unwrap();
    rig.place
        .ask("wren", &Request::Notes {}, Duration::from_secs(5))
        .await
        .unwrap();
    assert!(rig.place.admit("wren", "engram_A").await);
    assert!(rig.place.admit("wren", "note_1").await);
    assert!(!rig.place.admit("wren", "engram_B").await);
    assert!(!rig.place.admit("field-notes", "engram_A").await);
    assert!(!rig.place.admit("wren", &"x".repeat(wire::MAX_ID + 1)).await);
    rig.place.end().await;
    assert!(!rig.place.admit("wren", "engram_A").await, "a new session");
}

#[test]
fn no_write_command_can_be_sent_as_a_read() {
    for request in [
        json!({"command": "correct", "memory_id": "engram_A", "text": "new words"}),
        json!({"command": "forget", "memory_id": "engram_A"}),
        json!({"command": "reply", "note_id": "note_1", "text": "yes"}),
        json!({"command": "note", "text": "hello"}),
        json!({"command": "read", "note_ids": ["note_1"]}),
        json!({"command": "remember", "content": "x"}),
        json!({"command": "notes", "mark_read": true}),
        json!({"command": "memories", "limit": 5, "text": "x"}),
    ] {
        assert!(
            serde_json::from_value::<Request>(request.clone()).is_err(),
            "{request}"
        );
    }
    let sent = [
        memories(),
        Request::Search { query: "q".into() },
        Request::Journal { last: 1 },
        Request::Notes {},
    ];
    for request in sent {
        let line: serde_json::Value = serde_json::from_str(&request.line(7)).unwrap();
        let command = line["command"].as_str().unwrap();
        assert!(["memories", "search", "journal", "notes"].contains(&command));
        assert_eq!(command, request.command());
        assert_eq!(line["id"], 7);
    }
}

#[test]
fn requests_stay_inside_the_limits() {
    let bad = [
        Request::Memories {
            state: None,
            limit: wire::MAX_PAGE + 1,
            offset: 0,
        },
        Request::Search { query: "  ".into() },
        Request::Search {
            query: "x".repeat(wire::MAX_QUERY + 1),
        },
        Request::Journal { last: 0 },
        Request::Journal {
            last: wire::MAX_JOURNAL + 1,
        },
    ];
    for request in bad {
        assert!(request.check().is_err(), "{request:?}");
    }
    assert!(memories().check().is_ok());
}

#[test]
fn replies_must_be_the_shape_promised() {
    let notes = Request::Notes {};
    let ok = br#"{"id":3,"result":[{"id":"n","kind":null,"text":"t","author":"person","model":null,"in_reply_to":"m","created_at":null,"read_at":null,"delivered_at":null}]}"#;
    assert!(wire::parse(ok, 3, &notes).is_ok());
    assert!(wire::parse(ok, 4, &notes).is_err());
    let stranger = br#"{"id":3,"result":[{"id":"n","kind":null,"text":"t","author":"someone","model":null,"in_reply_to":null,"created_at":null,"read_at":null}]}"#;
    assert!(wire::parse(stranger, 3, &notes).is_err());
    let long_id = format!(
        r#"{{"id":3,"result":[{{"id":"{}","kind":null,"text":"t","author":"agent","model":null,"in_reply_to":null,"created_at":null,"read_at":null}}]}}"#,
        "n".repeat(wire::MAX_ID + 1)
    );
    assert!(wire::parse(long_id.as_bytes(), 3, &notes).is_err());
    let search = Request::Search { query: "q".into() };
    let how = br#"{"id":1,"result":{"query":"q","results":[{"id":"e","words":"w","kept":null,"closeness":1.0,"found":"guess"}]}}"#;
    assert!(wire::parse(how, 1, &search).is_err());
}

#[test]
fn the_owners_answer_is_kept_per_owner_and_mind_and_file() {
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().join("app");
    let db = dir.path().join("wren.db");
    std::fs::write(&db, b"made-up store").unwrap();
    let key = MindKey::of("wren", &db).unwrap();
    let owner = "a".repeat(64);
    assert_eq!(grant::answer(&base, &owner, &key), Answer::Unasked);
    grant::remember(&base, &owner, &key).unwrap();
    assert_eq!(grant::answer(&base, &owner, &key), Answer::Shown);

    // Another owner never sees this owner's answer.
    let other = "b".repeat(64);
    assert_eq!(grant::answer(&base, &other, &key), Answer::Unasked);
    // A record copied under another owner's name says the wrong owner.
    let theirs = grant::record(&base, &other, "wren").unwrap();
    std::fs::create_dir_all(theirs.parent().unwrap()).unwrap();
    std::fs::copy(grant::record(&base, &owner, "wren").unwrap(), &theirs).unwrap();
    assert_eq!(grant::answer(&base, &other, &key), Answer::Unasked);

    // A replaced store is a change, never a yes.
    std::fs::remove_file(&db).unwrap();
    std::fs::write(&db, b"another store").unwrap();
    let replaced = MindKey::of("wren", &db).unwrap();
    assert_eq!(grant::answer(&base, &owner, &replaced), Answer::Changed);

    // A link in the record's place is never followed.
    let mine = grant::record(&base, &owner, "wren").unwrap();
    let real = dir.path().join("elsewhere.json");
    std::fs::rename(&mine, &real).unwrap();
    std::os::unix::fs::symlink(&real, &mine).unwrap();
    assert_eq!(grant::answer(&base, &owner, &key), Answer::Unasked);

    // An oversized record is never read.
    std::fs::remove_file(&mine).unwrap();
    std::fs::write(&mine, vec![b' '; 9000]).unwrap();
    assert_eq!(grant::answer(&base, &owner, &key), Answer::Unasked);

    // A name that isn't an id has no record at all.
    assert!(grant::record(&base, &owner, "../wren").is_none());
    assert!(grant::record(&base, "", "wren").is_none());
}

/// The person's real installed `mnemos interface`, against a store this test
/// makes in a temporary folder, with `HOME` pointed there too: never the
/// person's own memory.
#[tokio::test]
async fn the_real_interface_reads_a_store_this_test_made() {
    let real_home = dirs::home_dir().unwrap();
    let Some(program) = super::link::command(&real_home) else {
        eprintln!(
            "skipped: Mnemos isn't installed on this machine, so the real interface can't be run"
        );
        return;
    };
    let home = tempfile::tempdir().unwrap();
    let db = home.path().join("made-up.db");
    let flags = [
        "--db-path",
        db.to_str().unwrap(),
        "--agent-id",
        "wren",
        "--person-id",
        "pat-example",
        "--project-scope",
        "lighthouse",
    ];
    let kept = std::process::Command::new(&program)
        .env_clear()
        .env("HOME", home.path())
        .env("PATH", session::PATH)
        .arg("remember")
        .args(flags)
        .arg("The lantern is checked before dusk, a made-up memory.")
        .output()
        .unwrap();
    assert!(kept.status.success(), "remember failed");
    let key = MindKey::of("wren", &db).unwrap();
    let place: &'static Place = Box::leak(Box::new(Place::new()));
    let spec = Spawn {
        home: home.path().to_owned(),
        db: key.file.clone(),
        agent: "wren".into(),
        person: "pat-example".into(),
        project: "lighthouse".into(),
    };
    place
        .start(session::command(Command::new(&program), &spec), key)
        .await
        .unwrap();
    let limit = Duration::from_secs(60);
    let Reply::Memories { memories, counts } = place.ask("wren", &memories(), limit).await.unwrap()
    else {
        panic!("not memories");
    };
    assert_eq!(counts.active, 1);
    assert!(memories[0].words.contains("lantern"));
    let Reply::Search { results } = place
        .ask(
            "wren",
            &Request::Search {
                query: "lantern".into(),
            },
            limit,
        )
        .await
        .unwrap()
    else {
        panic!("not a search");
    };
    assert!(!results.is_empty());
    assert!(matches!(
        place
            .ask("wren", &Request::Journal { last: 5 }, limit)
            .await,
        Ok(Reply::Journal { .. })
    ));
    assert!(matches!(
        place.ask("wren", &Request::Notes {}, limit).await,
        Ok(Reply::Notes { .. })
    ));
    place.end().await;
}

fn written(rig: &Rig) -> Vec<serde_json::Value> {
    std::fs::read_to_string(rig.dir.path().join("writes.log"))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

#[test]
fn the_person_can_write_exactly_four_things() {
    for write in [
        json!({"command": "reply", "note_id": "note_1", "text": "yes"}),
        json!({"command": "note", "text": "hello"}),
        json!({"command": "correct", "memory_id": "engram_A", "text": "new words"}),
        json!({"command": "forget", "memory_id": "engram_A"}),
    ] {
        assert!(
            serde_json::from_value::<Write>(write.clone()).is_ok(),
            "{write}"
        );
    }
    for other in [
        json!({"command": "read", "note_ids": ["note_1"]}),
        json!({"command": "remember", "content": "x"}),
        json!({"command": "memories", "limit": 5, "offset": 0}),
        json!({"command": "notes"}),
        json!({"command": "reply", "note_id": "note_1", "text": "yes", "as": "agent"}),
        json!({"command": "forget", "memory_id": "engram_A", "delete": true}),
        json!({"command": "note", "text": "hi", "author": "agent"}),
    ] {
        assert!(
            serde_json::from_value::<Write>(other.clone()).is_err(),
            "{other}"
        );
    }
    // The limits: no empty words, nothing past Mnemos's own length, ids
    // that are ids.
    let long = "x".repeat(wire::MAX_TEXT + 1);
    for write in [
        Write::Note { text: "  ".into() },
        Write::Note { text: long.clone() },
        Write::Reply {
            note_id: "note\n1".into(),
            text: "yes".into(),
        },
        Write::Correct {
            memory_id: "engram_A".into(),
            text: long,
        },
        Write::Forget {
            memory_id: String::new(),
        },
    ] {
        assert!(write.check().is_err(), "{write:?}");
    }
    assert!(Write::Note {
        text: "x".repeat(wire::MAX_TEXT)
    }
    .check()
    .is_ok());
    // On the wire, each is its own command and carries only its own fields.
    let line: serde_json::Value = serde_json::from_str(
        &Write::Correct {
            memory_id: "engram_A".into(),
            text: "new".into(),
        }
        .line(4),
    )
    .unwrap();
    assert_eq!(
        line,
        json!({"id": 4, "command": "correct", "memory_id": "engram_A", "text": "new"})
    );
}

#[tokio::test]
async fn a_write_names_only_ids_the_engine_gave_and_is_sent_once() {
    let rig = rig();
    rig.start("plain").await;
    let limit = Duration::from_secs(5);
    let answer = Write::Reply {
        note_id: "note_1".into(),
        text: "Yes, keep them.".into(),
    };
    // Before the notes were read, note_1 isn't one the engine gave.
    assert_eq!(
        rig.place.ask("wren", &answer, limit).await.unwrap_err(),
        Fail::UnknownItem
    );
    assert!(written(&rig).is_empty(), "nothing was sent");
    rig.place
        .ask("wren", &Request::Notes {}, limit)
        .await
        .unwrap();
    let Written::Note { note } = rig.place.ask("wren", &answer, limit).await.unwrap() else {
        panic!("not a note");
    };
    assert_eq!(note.author, "person");
    assert_eq!(written(&rig).len(), 1, "sent once");
    // The new note is now one the engine gave.
    assert!(rig.place.admit("wren", "note_2").await);

    // A correction names a memory it gave; its new version is known after.
    let fix = Write::Correct {
        memory_id: "engram_A".into(),
        text: "Corrected words.".into(),
    };
    assert_eq!(
        rig.place.ask("wren", &fix, limit).await.unwrap_err(),
        Fail::UnknownItem
    );
    rig.place.ask("wren", &memories(), limit).await.unwrap();
    assert!(matches!(
        rig.place.ask("wren", &fix, limit).await.unwrap(),
        Written::Corrected { ref id, .. } if id == "engram_B"
    ));
    assert!(rig.place.admit("wren", "engram_B").await);
    assert!(matches!(
        rig.place
            .ask(
                "wren",
                &Write::Forget {
                    memory_id: "engram_A".into()
                },
                limit
            )
            .await
            .unwrap(),
        Written::Forgotten { .. }
    ));
    let sent: Vec<String> = written(&rig)
        .iter()
        .map(|w| w["command"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(sent, ["reply", "correct", "forget"]);
    // Every write went to the one process started with all four flags.
    let log = std::fs::read_to_string(rig.dir.path().join("argv.log")).unwrap();
    assert!(log
        .lines()
        .all(|l| l.contains("--person-id pat-example") && l.contains("--agent-id wren")));
}

#[tokio::test]
async fn a_quiet_hour_comes_back_in_the_engines_own_words() {
    let rig = rig();
    rig.start("quiet").await;
    let limit = Duration::from_secs(5);
    let fail = rig
        .place
        .ask(
            "wren",
            &Write::Note {
                text: "Good morning.".into(),
            },
            limit,
        )
        .await
        .unwrap_err();
    assert_eq!(fail.code(), "mnemos_refused");
    assert_eq!(
        fail.told(),
        "mnemos_refused:Nothing saved: A reply is the person's own words, and no one is in the room during one of the agent's hours."
    );
    // A refusal keeps the process: the next request is answered.
    assert!(rig.place.ask("wren", &memories(), limit).await.is_ok());
    // A read's refusal never carries the engine's words.
    let said = br#"{"id":1,"error":"Something about engram_A's words."}"#;
    assert!(matches!(
        wire::parse(said, 1, &memories()),
        Err(wire::Refusal::Refused(None))
    ));
}

#[tokio::test]
async fn a_busy_store_says_so_and_keeps_the_process() {
    let rig = rig();
    rig.start("busy").await;
    let limit = Duration::from_secs(5);
    rig.place.ask("wren", &memories(), limit).await.unwrap();
    let pid = rig.place.pid().unwrap();
    let fail = rig
        .place
        .ask(
            "wren",
            &Write::Correct {
                memory_id: "engram_A".into(),
                text: "Corrected words.".into(),
            },
            limit,
        )
        .await
        .unwrap_err();
    assert_eq!(fail, Fail::Busy);
    assert_eq!(fail.told(), "mnemos_busy");
    assert_eq!(rig.place.pid(), Some(pid), "the same process");
    // Never sent again by itself.
    assert_eq!(written(&rig).len(), 1);
}

/// The person's real installed `mnemos interface` writes, against a store
/// this test makes and fills in a temporary folder: answer, note, correct,
/// let go, each read back and each the person's, though the app here was
/// started as an agent would be (`CLAUDECODE`, `AI_AGENT`).
#[tokio::test]
async fn the_real_interface_writes_as_the_person_under_an_agents_environment() {
    let real_home = dirs::home_dir().unwrap();
    let Some(program) = super::link::command(&real_home) else {
        eprintln!("skipped: Mnemos isn't installed on this machine");
        return;
    };
    let home = tempfile::tempdir().unwrap();
    let db = home.path().join("made-up.db");
    let flags = [
        "--db-path",
        db.to_str().unwrap(),
        "--agent-id",
        "wren",
        "--person-id",
        "pat-example",
        "--project-scope",
        "lighthouse",
    ];
    let kept = std::process::Command::new(&program)
        .env_clear()
        .env("HOME", home.path())
        .env("PATH", session::PATH)
        .arg("remember")
        .args(flags)
        .arg("The ferry runs late in fog, a made-up memory.")
        .output()
        .unwrap();
    assert!(kept.status.success(), "remember failed");
    // One note of the mind's own to answer, put straight into this test's
    // own store (Mnemos keeps the agent's notes for its own tools).
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute(
            "INSERT INTO notes (id, agent_id, person_id, project_scope, kind, text, author, \
             model_id, in_reply_to, session_id, hour_id, created_at) \
             VALUES ('note_agent', 'wren', 'pat-example', 'lighthouse', 'question', \
             'Shall I keep the old tables?', 'agent', '', '', '', '', '2026-11-01T10:00:00+00:00')",
            [],
        )
        .unwrap();
    }
    let key = MindKey::of("wren", &db).unwrap();
    let place: &'static Place = Box::leak(Box::new(Place::new()));
    let spec = Spawn {
        home: home.path().to_owned(),
        db: key.file.clone(),
        agent: "wren".into(),
        person: "pat-example".into(),
        project: "lighthouse".into(),
    };
    let mut base = Command::new(&program);
    base.env("CLAUDECODE", "1").env("AI_AGENT", "claude-code");
    place
        .start(session::command(base, &spec), key)
        .await
        .unwrap();
    let limit = Duration::from_secs(90);

    let Reply::Notes { notes } = place.ask("wren", &Request::Notes {}, limit).await.unwrap() else {
        panic!("not notes");
    };
    assert_eq!(notes.len(), 1);
    let Written::Note { note } = place
        .ask(
            "wren",
            &Write::Reply {
                note_id: "note_agent".into(),
                text: "Keep them, a made-up answer.".into(),
            },
            limit,
        )
        .await
        .unwrap()
    else {
        panic!("not a note");
    };
    assert_eq!(note.author, "person");
    assert_eq!(note.in_reply_to.as_deref(), Some("note_agent"));
    let Written::Note { note } = place
        .ask(
            "wren",
            &Write::Note {
                text: "Good morning, a made-up note.".into(),
            },
            limit,
        )
        .await
        .unwrap()
    else {
        panic!("not a note");
    };
    assert_eq!(note.author, "person");
    let Reply::Notes { notes } = place.ask("wren", &Request::Notes {}, limit).await.unwrap() else {
        panic!("not notes");
    };
    assert_eq!(notes.len(), 3);
    assert!(notes
        .iter()
        .filter(|n| n.id != "note_agent")
        .all(|n| n.author == "person"));
    assert!(
        notes
            .iter()
            .find(|n| n.id == "note_agent")
            .and_then(|n| n.read_at.as_ref())
            .is_some(),
        "answering a note reads it"
    );

    let Reply::Memories { memories: list, .. } =
        place.ask("wren", &memories(), limit).await.unwrap()
    else {
        panic!("not memories");
    };
    let old = list[0].id.clone();
    let Written::Corrected { id: new, .. } = place
        .ask(
            "wren",
            &Write::Correct {
                memory_id: old.clone(),
                text: "The ferry runs late in fog and in wind, made-up.".into(),
            },
            limit,
        )
        .await
        .unwrap()
    else {
        panic!("not corrected");
    };
    let Reply::Memories {
        memories: list,
        counts,
    } = place.ask("wren", &memories(), limit).await.unwrap()
    else {
        panic!("not memories");
    };
    let fixed = list.iter().find(|m| m.id == new).expect("the new version");
    assert!(fixed.words.contains("and in wind"));
    assert_eq!(fixed.author, "person", "the person's, under an agent's env");
    assert!(fixed.corrected.is_some());
    assert!(list.iter().all(|m| m.id != old));
    assert_eq!(counts.active, 1);

    assert!(matches!(
        place
            .ask("wren", &Write::Forget { memory_id: new.clone() }, limit)
            .await
            .unwrap(),
        Written::Forgotten { ref id, .. } if *id == new
    ));
    let Reply::Memories { counts, .. } = place.ask("wren", &memories(), limit).await.unwrap()
    else {
        panic!("not memories");
    };
    assert_eq!(counts.active, 0);
    assert!(counts.archived >= 1, "let go is archived, not deleted");
    place.end().await;
}

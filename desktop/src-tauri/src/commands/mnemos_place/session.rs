//! The one `mnemos interface` the place keeps open: the person's own
//! installed Mnemos, started for one mind with all four scope flags stated,
//! in an environment cleared down to `HOME` and a fixed `PATH`. One request
//! at a time, a timeout on each, a size limit on each answer, and nothing it
//! says is ever logged. One mind at a time; it ends when the place is left,
//! when the window has been hidden for a while, and when the app exits.
//!
//! A Mnemos new enough is opened as the person, held to the stated scope
//! (`--as-person --strict-scope`), and asked `hello` once: the commands it
//! names are the only ones sent after. An older one refuses the flags, and
//! is opened as before, for the first eight commands.
use super::wire::{self, Answered, Exchange, Greeting, Hello, Refusal};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex as StdMutex, OnceLock,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
};

/// Where programs are found, and nothing else from the app's own environment.
pub(crate) const PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

/// Everything a mind's process is started with.
#[derive(Clone, Debug)]
pub(crate) struct Spawn {
    pub(crate) home: PathBuf,
    pub(crate) db: PathBuf,
    pub(crate) agent: String,
    pub(crate) person: String,
    pub(crate) project: String,
}

/// A mind's store, and the file it was when it was opened.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MindKey {
    pub(crate) agent: String,
    pub(crate) file: PathBuf,
    pub(crate) device: u64,
    pub(crate) inode: u64,
}

impl MindKey {
    /// The key for the store at `file`, followed to its real path.
    pub(crate) fn of(agent: &str, file: &Path) -> Option<Self> {
        use std::os::unix::fs::MetadataExt;
        let file = file.canonicalize().ok()?;
        let meta = std::fs::metadata(&file).ok()?;
        meta.is_file().then(|| Self {
            agent: agent.to_owned(),
            file,
            device: meta.dev(),
            inode: meta.ino(),
        })
    }

    /// Whether the store is still the same file, at the same path.
    pub(crate) fn same_file(&self) -> bool {
        Self::of(&self.agent, &self.file).is_some_and(|now| now == *self)
    }
}

/// Why a request got no answer. Each says one thing to the page.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Fail {
    /// No mind is open, or another one is.
    NotOpen,
    /// The mind's file was moved or replaced since it was opened.
    Changed,
    /// This Mnemos has no interface for apps.
    TooOld,
    /// This Mnemos doesn't answer this command: the page says it needs a
    /// newer one. The process stays.
    Unanswered,
    /// Mnemos didn't answer in time.
    Timeout,
    /// The answer was larger than the place reads.
    TooLarge,
    /// Mnemos stopped, or couldn't start.
    Failed,
    /// Mnemos answered something that isn't the answer promised.
    Invalid,
    /// Someone else is writing to the store just now.
    Busy,
    /// The page named an id the engine didn't give this mind this session.
    UnknownItem,
    /// Mnemos refused the request; for a write, in its own words.
    Refused(Option<String>),
}

impl Fail {
    pub(crate) fn code(&self) -> &'static str {
        match self {
            Self::NotOpen => "not_open",
            Self::Changed => "mind_changed",
            Self::TooOld => "mnemos_too_old",
            Self::Unanswered => "mnemos_needs_newer",
            Self::Timeout => "mnemos_timeout",
            Self::TooLarge => "reply_too_large",
            Self::Failed => "mnemos_failed",
            Self::Invalid => "invalid_reply",
            Self::Busy => "mnemos_busy",
            Self::UnknownItem => "unknown_item",
            Self::Refused(_) => "mnemos_refused",
        }
    }

    /// What the page is told: the code, and for a write's refusal the
    /// engine's own sentence after it ("mnemos_refused:<sentence>").
    pub(crate) fn told(&self) -> String {
        match self {
            Self::Refused(Some(said)) => format!("{}:{said}", self.code()),
            _ => self.code().to_owned(),
        }
    }

    /// Whether the process can't be trusted for another request.
    fn ends_session(&self) -> bool {
        !matches!(
            self,
            Self::Refused(_) | Self::NotOpen | Self::Busy | Self::UnknownItem | Self::Unanswered
        )
    }
}

/// The command a mind's process runs, built on `base` (the person's own
/// `mnemos`): the interface with all four scope flags (and with `newer`,
/// `--as-person --strict-scope`), and an environment cleared of everything
/// the app had (`CLAUDECODE`, `AI_AGENT` and every `MNEMOS_*` included).
pub(crate) fn command(mut base: Command, spec: &Spawn, newer: bool) -> Command {
    base.env_clear()
        .env("HOME", &spec.home)
        .env("PATH", PATH)
        .current_dir(&spec.home)
        .arg("interface")
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
        .args(if newer {
            &["--as-person", "--strict-scope"][..]
        } else {
            &[]
        })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    base
}

struct Session {
    mind: MindKey,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next: u64,
    /// Every id the engine returned for this mind in this session.
    seen: HashSet<String>,
    /// What the engine said to `hello`; none for an older Mnemos.
    hello: Option<Hello>,
    /// The mind's own studio, where its pictures are.
    studio: Option<PathBuf>,
    /// Each picture the engine listed this session: its notebook path, and
    /// the file it named.
    pictures: HashMap<String, PathBuf>,
}

/// Where a mind's studio is (Mnemos's own `studio_dir`).
pub(crate) fn studio_of(home: &Path, agent: &str) -> PathBuf {
    home.join(".mnemos").join("studio").join(agent)
}

/// The most a picture may weigh (the notebook's own `MOST_BYTES`).
pub(crate) const MOST_PICTURE: u64 = 6 * 1024 * 1024;

/// The place's one process, and what it knows.
pub(crate) struct Place {
    session: Mutex<Option<Session>>,
    /// The process itself, apart from the session, so it can be stopped at
    /// once even while a request waits on it.
    child: StdMutex<Option<Child>>,
    /// Bumped whenever the window is shown or hidden: a hidden timer ends
    /// the process only if nothing happened since it started.
    shown: AtomicU64,
}

/// The app's one place.
pub(crate) fn place() -> &'static Place {
    static PLACE: OnceLock<Place> = OnceLock::new();
    PLACE.get_or_init(Place::new)
}

impl Place {
    pub(crate) fn new() -> Self {
        Self {
            session: Mutex::new(None),
            child: StdMutex::new(None),
            shown: AtomicU64::new(0),
        }
    }

    /// Whether `mind`'s process is open, for that same file.
    pub(crate) async fn is_open(&self, mind: &MindKey) -> bool {
        self.session
            .lock()
            .await
            .as_ref()
            .is_some_and(|s| s.mind == *mind)
    }

    /// End any process, then start `mind`'s from `command`.
    pub(crate) async fn start(&self, mut command: Command, mind: MindKey) -> Result<(), Fail> {
        let mut session = self.session.lock().await;
        self.stop_child().await;
        *session = None;
        let mut child = command.spawn().map_err(|_| Fail::Failed)?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.start_kill();
            return Err(Fail::Failed);
        };
        self.child_slot().replace(child);
        *session = Some(Session {
            mind,
            stdin,
            stdout: BufReader::new(stdout),
            next: 1,
            seen: HashSet::new(),
            hello: None,
            studio: None,
            pictures: HashMap::new(),
        });
        Ok(())
    }

    /// Open `mind` from `build` (its command, with or without the newer
    /// flags): with them first, and `hello` asked; a Mnemos that refuses
    /// them is opened again without, as before. A `hello` must say the
    /// engine writes as the person, for this mind.
    pub(crate) async fn open(
        &self,
        build: impl Fn(bool) -> Command,
        mind: MindKey,
        studio: PathBuf,
        limit: Duration,
    ) -> Result<(), Fail> {
        let agent = mind.agent.clone();
        self.start(build(true), mind.clone()).await?;
        let greeted = match self.ask(&agent, &Greeting, limit).await {
            Err(Fail::TooOld | Fail::Failed) => {
                self.start(build(false), mind).await?;
                self.ask(&agent, &Greeting, limit).await
            }
            other => other,
        };
        let hello = match greeted {
            Ok(hello) => {
                let said = &hello.said;
                let person = said.get("writes_as").and_then(|w| w.as_str()) == Some("person");
                let ours = said
                    .pointer("/scope/agent_id")
                    .and_then(|a| a.as_str())
                    .is_none_or(|a| a == agent);
                if !(person && ours) {
                    self.end().await;
                    return Err(Fail::Invalid);
                }
                Some(hello)
            }
            Err(Fail::Unanswered) => None,
            Err(fail) => {
                self.end().await;
                return Err(fail);
            }
        };
        let mut guard = self.session.lock().await;
        let session = guard.as_mut().ok_or(Fail::Failed)?;
        session.hello = hello;
        session.studio = Some(studio);
        Ok(())
    }

    /// What the open mind's Mnemos said to `hello`, if it answers one.
    pub(crate) async fn hello(&self, agent: &str) -> Option<serde_json::Value> {
        self.session
            .lock()
            .await
            .as_ref()
            .filter(|s| s.mind.agent == agent)
            .and_then(|s| s.hello.as_ref())
            .map(|h| h.said.clone())
    }

    /// The bytes of a picture the engine listed for `agent`'s mind this
    /// session, by its notebook path: only from inside the mind's studio,
    /// never through a link, a png, jpeg, webp or gif, at most 6 MB.
    pub(crate) async fn picture(&self, agent: &str, path: &str) -> Result<Vec<u8>, Fail> {
        let (file, studio) = {
            let guard = self.session.lock().await;
            let session = guard
                .as_ref()
                .filter(|s| s.mind.agent == agent)
                .ok_or(Fail::NotOpen)?;
            let file = session
                .pictures
                .get(path)
                .cloned()
                .ok_or(Fail::UnknownItem)?;
            (file, session.studio.clone().ok_or(Fail::UnknownItem)?)
        };
        tokio::task::spawn_blocking(move || read_picture(&file, &studio))
            .await
            .map_err(|_| Fail::Failed)?
    }
    /// The open mind's key, if `agent`'s mind is the one open.
    pub(crate) async fn open_key(&self, agent: &str) -> Option<MindKey> {
        self.session
            .lock()
            .await
            .as_ref()
            .filter(|s| s.mind.agent == agent)
            .map(|s| s.mind.clone())
    }

    /// Ask the open process one thing, for `agent`'s mind, waiting at most
    /// `limit`: a reading request, or one of the person's writes, sent once
    /// and never again by itself. A second request waits for the first. Any
    /// id it names must be one the engine gave this mind in this session. A
    /// failure that leaves the process in doubt ends it.
    pub(crate) async fn ask<E: Exchange>(
        &self,
        agent: &str,
        exchange: &E,
        limit: Duration,
    ) -> Result<E::Answer, Fail> {
        exchange.check().map_err(|_| Fail::Invalid)?;
        let mut guard = self.session.lock().await;
        let Some(session) = guard.as_mut().filter(|s| s.mind.agent == agent) else {
            return Err(Fail::NotOpen);
        };
        let command = exchange.command();
        let answered = command == "hello"
            || match &session.hello {
                Some(hello) => hello.answers(command),
                None => wire::FIRST_EIGHT.contains(&command),
            };
        if !answered {
            return Err(Fail::Unanswered);
        }
        if exchange
            .names()
            .iter()
            .any(|id| !session.seen.contains(*id))
        {
            return Err(Fail::UnknownItem);
        }
        if !session.mind.same_file() {
            *guard = None;
            drop(guard);
            self.stop_child().await;
            return Err(Fail::Changed);
        }
        let id = session.next;
        session.next += 1;
        let outcome = tokio::time::timeout(limit, talk(session, exchange, id)).await;
        let outcome = match outcome {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(Fail::Failed)) => Err(self.why_stopped().await),
            Ok(Err(fail)) => Err(fail),
            Err(_) => Err(Fail::Timeout),
        };
        match outcome {
            Ok(answer) => {
                session
                    .seen
                    .extend(answer.ids().into_iter().map(str::to_owned));
                session.seen.extend(answer.more_ids());
                session.pictures.extend(answer.pictures());
                Ok(answer)
            }
            Err(fail) => {
                if fail.ends_session() {
                    *guard = None;
                    drop(guard);
                    self.stop_child().await;
                }
                Err(fail)
            }
        }
    }

    /// Whether `id` is one the engine returned for `agent`'s mind in this
    /// session: the only ids the place accepts back from the page.
    pub(crate) async fn admit(&self, agent: &str, id: &str) -> bool {
        wire::valid_id(id)
            && self
                .session
                .lock()
                .await
                .as_ref()
                .is_some_and(|s| s.mind.agent == agent && s.seen.contains(id))
    }

    /// End the process (the place was left, or another mind opened).
    pub(crate) async fn end(&self) {
        // The process first, so a request waiting on it returns at once.
        self.stop_child().await;
        *self.session.lock().await = None;
    }

    /// End the process now, without waiting: the app is exiting.
    pub(crate) fn end_now(&self) {
        if let Some(mut child) = self.child_slot().take() {
            let _ = child.start_kill();
        }
        if let Ok(mut session) = self.session.try_lock() {
            *session = None;
        }
    }

    /// The window was shown or hidden. Hidden for `after`, the process ends.
    pub(crate) fn shown(&'static self, visible: bool, after: Duration) {
        let mark = self.shown.fetch_add(1, Ordering::SeqCst) + 1;
        if visible {
            return;
        }
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(after).await;
            if self.shown.load(Ordering::SeqCst) == mark {
                self.end().await;
            }
        });
    }

    /// The running process's id, while there is one.
    #[cfg(test)]
    pub(crate) fn pid(&self) -> Option<u32> {
        self.child_slot().as_ref().and_then(Child::id)
    }

    fn child_slot(&self) -> std::sync::MutexGuard<'_, Option<Child>> {
        self.child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    async fn stop_child(&self) {
        let child = self.child_slot().take();
        if let Some(mut child) = child {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        }
    }

    /// Why the process stopped answering: a Mnemos too old for an app's
    /// interface exits at once with its usage error (status 2).
    async fn why_stopped(&self) -> Fail {
        for _ in 0..20 {
            let status = self.child_slot().as_mut().map(Child::try_wait);
            match status {
                Some(Ok(Some(status))) => {
                    return if status.code() == Some(2) {
                        Fail::TooOld
                    } else {
                        Fail::Failed
                    };
                }
                Some(Ok(None)) => tokio::time::sleep(Duration::from_millis(25)).await,
                _ => return Fail::Failed,
            }
        }
        Fail::Failed
    }
}

/// Write one request and read its one answer line, at most `MAX_LINE`.
async fn talk<E: Exchange>(
    session: &mut Session,
    exchange: &E,
    id: u64,
) -> Result<E::Answer, Fail> {
    session
        .stdin
        .write_all(exchange.line(id).as_bytes())
        .await
        .map_err(|_| Fail::Failed)?;
    session.stdin.flush().await.map_err(|_| Fail::Failed)?;
    let mut line = Vec::new();
    (&mut session.stdout)
        .take(wire::MAX_LINE as u64 + 1)
        .read_until(b'\n', &mut line)
        .await
        .map_err(|_| Fail::Failed)?;
    if line.is_empty() {
        return Err(Fail::Failed);
    }
    if line.len() > wire::MAX_LINE || line.last() != Some(&b'\n') {
        return Err(if line.len() > wire::MAX_LINE {
            Fail::TooLarge
        } else {
            Fail::Failed
        });
    }
    wire::parse(&line[..line.len() - 1], id, exchange).map_err(|refusal| match refusal {
        Refusal::Invalid => Fail::Invalid,
        Refusal::Unknown => Fail::Unanswered,
        Refusal::Busy => Fail::Busy,
        Refusal::Refused(said) => Fail::Refused(said),
    })
}

/// A picture's bytes, read the way the notebook allows: the file must be
/// inside `studio` once links are followed, not itself a link, with no
/// hidden part, a picture by its name and by its first bytes, and at most
/// `MOST_PICTURE`.
pub(crate) fn read_picture(file: &Path, studio: &Path) -> Result<Vec<u8>, Fail> {
    use std::{fs::OpenOptions, io::Read, os::unix::fs::OpenOptionsExt};
    let refuse = || Fail::UnknownItem;
    let studio = studio.canonicalize().map_err(|_| refuse())?;
    let linked = std::fs::symlink_metadata(file).map_err(|_| refuse())?;
    if !linked.file_type().is_file() {
        return Err(refuse());
    }
    let real = file.canonicalize().map_err(|_| refuse())?;
    let inside = real.strip_prefix(&studio).map_err(|_| refuse())?;
    if real != file
        || inside.as_os_str().is_empty()
        || inside
            .components()
            .any(|c| c.as_os_str().to_string_lossy().starts_with('.'))
    {
        return Err(refuse());
    }
    let kind = real
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if !matches!(
        kind.as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "gif")
    ) {
        return Err(refuse());
    }
    let mut opened = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&real)
        .map_err(|_| refuse())?;
    let meta = opened.metadata().map_err(|_| refuse())?;
    if !meta.is_file() || meta.len() > MOST_PICTURE {
        return Err(refuse());
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    (&mut opened)
        .take(MOST_PICTURE + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Fail::Failed)?;
    if bytes.len() as u64 > MOST_PICTURE || !looks_like_a_picture(&bytes) {
        return Err(refuse());
    }
    Ok(bytes)
}

/// Whether `bytes` begin as a png, jpeg, gif or webp does.
fn looks_like_a_picture(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(&[0xFF, 0xD8, 0xFF])
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || (bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
}

//! What the place may ask of the person's `mnemos interface`, and what it
//! takes back: the reading requests (`Request`: the first four, and the new
//! engine's `summary` and `notebook`), the opening `hello` (`Greeting`, the
//! app's own, never the page's), and the person's seven writes (`Write`:
//! answer a note, leave one, correct a memory, let one go, mark notes read,
//! the quiet hours, the shared notebook), each its own Tauri command. Nothing
//! else is a type, so nothing else can be built, sent or deserialized from
//! the webview. A notebook part passes through as JSON once its envelope is
//! checked: the page guards its shapes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf};

/// The longest id the place accepts from the engine.
pub(crate) const MAX_ID: usize = 128;
/// The longest answer line the place reads, in bytes.
pub(crate) const MAX_LINE: usize = 4 * 1024 * 1024;
/// A page of memories, at most.
pub(crate) const MAX_PAGE: u32 = 100;
/// Journal entries asked for at once, at most.
pub(crate) const MAX_JOURNAL: u32 = 500;
/// The longest search the place sends, in characters (the notebook's own).
pub(crate) const MAX_QUERY: usize = 400;
/// Results a search asks for (the notebook's own number).
pub(crate) const SEARCH_RESULTS: u32 = 24;
/// The longest note, answer or correction the person can send, in
/// characters (Mnemos's own `MAX_REPLY_CHARS`).
pub(crate) const MAX_TEXT: usize = 16_384;
/// The longest refusal of the engine's own the page is shown.
const MAX_SAID: usize = 300;
/// The most memories a notebook page asks for (the notebook's own page).
pub(crate) const MAX_NOTEBOOK_PAGE: u32 = 500;
/// The most notes marked read at once (the engine's own limit).
pub(crate) const MAX_READ: usize = 200;
/// The commands every `mnemos interface` answers, the first eight; an
/// engine that answers `hello` says which others it does.
pub(crate) const FIRST_EIGHT: [&str; 8] = [
    "memories", "search", "correct", "forget", "journal", "notes", "reply", "note",
];

/// One exchange with the interface: a reading request, or one of the
/// person's writes. A fifth reading command is one more variant of
/// `Request` and one more arm of its `answer`.
pub(crate) trait Exchange {
    /// What a good answer becomes.
    type Answer: Answered;
    /// Whether the engine's own words for a refusal may reach the page
    /// (a write's: a quiet hour, a note too long). A read's never do.
    const SAYS_WHY: bool;
    /// Refuse what is outside the place's limits.
    fn check(&self) -> Result<(), &'static str>;
    /// The command's name on the wire, which the engine must answer.
    fn command(&self) -> &'static str;
    /// The one JSON line the interface reads for this exchange.
    fn line(&self, id: u64) -> String;
    /// The `result` of a good answer, in its promised shape.
    fn answer(&self, result: Value) -> Result<Self::Answer, Refusal>;
    /// The ids this exchange names, each one the engine must have given
    /// for this mind in this session.
    fn names(&self) -> Vec<&str> {
        Vec::new()
    }
}

/// An answer that carries ids, kept for the session's record of them.
pub(crate) trait Answered {
    fn ids(&self) -> Vec<&str>;
    /// The pictures this answer lists, by the notebook's own path, each with
    /// the file the engine named for it.
    fn pictures(&self) -> Vec<(String, PathBuf)> {
        Vec::new()
    }
    /// Ids beyond `ids`: every id a notebook part names.
    fn more_ids(&self) -> Vec<String> {
        Vec::new()
    }
}

/// Which memories a page lists.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryState {
    Active,
    Dormant,
}

/// One reading request, as the webview sends it. Anything else is refused.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "command", rename_all = "lowercase", deny_unknown_fields)]
pub enum Request {
    /// A page of memories (oldest first, as the engine lists them), or with
    /// `limit` 0 only the counts.
    Memories {
        #[serde(default)]
        state: Option<MemoryState>,
        limit: u32,
        #[serde(default)]
        offset: u32,
    },
    /// The memories its own recall finds, by meaning and by words.
    Search { query: String },
    /// The newest journal entries.
    Journal { last: u32 },
    /// Every note, both ways. Reading marks nothing read.
    Notes {},
    /// What each part of the notebook counts, and its change token.
    Summary {},
    /// One part of the notebook, whole as the notebook's page is given it;
    /// `memories` a page at a time, `pulse` since a moment.
    Notebook {
        part: Part,
        #[serde(default)]
        limit: Option<u32>,
        #[serde(default)]
        offset: Option<u32>,
        #[serde(default)]
        since: Option<String>,
    },
}

/// A part of the notebook (`mnemos interface`'s `notebook`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Life,
    Memories,
    Pulse,
}

impl Exchange for Request {
    type Answer = Reply;
    const SAYS_WHY: bool = false;

    fn check(&self) -> Result<(), &'static str> {
        let fine = match self {
            Self::Memories { limit, offset, .. } => *limit <= MAX_PAGE && *offset <= 10_000_000,
            Self::Search { query } => {
                !query.trim().is_empty() && query.chars().count() <= MAX_QUERY
            }
            Self::Journal { last } => (1..=MAX_JOURNAL).contains(last),
            Self::Notes {} | Self::Summary {} => true,
            Self::Notebook {
                part,
                limit,
                offset,
                since,
            } => match part {
                Part::Memories => {
                    since.is_none()
                        && limit.is_none_or(|l| (1..=MAX_NOTEBOOK_PAGE).contains(&l))
                        && offset.is_none_or(|o| o <= 10_000_000)
                }
                Part::Life => limit.is_none() && offset.is_none() && since.is_none(),
                Part::Pulse => {
                    limit.is_none() && offset.is_none() && since.as_deref().is_none_or(moment)
                }
            },
        };
        if fine {
            Ok(())
        } else {
            Err("invalid_request")
        }
    }

    fn line(&self, id: u64) -> String {
        let mut body = json!({"id": id, "command": self.command()});
        match self {
            Self::Memories {
                state,
                limit,
                offset,
            } => {
                body["limit"] = json!(limit);
                body["offset"] = json!(offset);
                if let Some(state) = state {
                    body["state"] = json!(state);
                }
            }
            Self::Search { query } => {
                body["query"] = json!(query);
                body["max_results"] = json!(SEARCH_RESULTS);
            }
            Self::Journal { last } => body["last"] = json!(last),
            Self::Notes {} => body["unread"] = json!(false),
            Self::Summary {} => {}
            Self::Notebook {
                part,
                limit,
                offset,
                since,
            } => {
                body["part"] = json!(part);
                if let Some(limit) = limit {
                    body["limit"] = json!(limit);
                }
                if let Some(offset) = offset {
                    body["offset"] = json!(offset);
                }
                if let Some(since) = since {
                    body["since"] = json!(since);
                }
            }
        }
        format!("{body}\n")
    }

    fn command(&self) -> &'static str {
        match self {
            Self::Memories { .. } => "memories",
            Self::Search { .. } => "search",
            Self::Journal { .. } => "journal",
            Self::Notes {} => "notes",
            Self::Summary {} => "summary",
            Self::Notebook { .. } => "notebook",
        }
    }

    fn answer(&self, result: Value) -> Result<Reply, Refusal> {
        let reply = match self {
            Self::Memories { .. } => {
                #[derive(Deserialize)]
                struct Page {
                    memories: Vec<Memory>,
                    counts: Counts,
                }
                let page: Page = serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                Reply::Memories {
                    memories: page.memories,
                    counts: page.counts,
                }
            }
            Self::Search { .. } => {
                #[derive(Deserialize)]
                struct Results {
                    results: Vec<Found>,
                }
                let found: Results =
                    serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if found
                    .results
                    .iter()
                    .any(|r| !matches!(r.found.as_str(), "meaning" | "words" | "link"))
                {
                    return Err(Refusal::Invalid);
                }
                Reply::Search {
                    results: found.results,
                }
            }
            Self::Journal { .. } => Reply::Journal {
                entries: serde_json::from_value(result).map_err(|_| Refusal::Invalid)?,
            },
            Self::Notes {} => {
                let notes: Vec<Note> =
                    serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if !notes.iter().all(Note::by_someone_known) {
                    return Err(Refusal::Invalid);
                }
                Reply::Notes { notes }
            }
            Self::Summary {} => {
                let fine = result.get("counts").is_some_and(Value::is_object)
                    && result.get("change_token").is_some_and(Value::is_string);
                if !fine {
                    return Err(Refusal::Invalid);
                }
                Reply::Summary { summary: result }
            }
            Self::Notebook { part, .. } => notebook_answer(*part, result)?,
        };
        Ok(reply)
    }
}

/// A notebook part, its envelope checked: the part asked for, a document
/// that is an object (with its memories a list), a page where one was cut,
/// and for `life` the pictures it lists, each a path the engine named.
fn notebook_answer(part: Part, mut result: Value) -> Result<Reply, Refusal> {
    if result.get("part") != Some(&json!(part)) {
        return Err(Refusal::Invalid);
    }
    let document = result
        .get_mut("document")
        .map(Value::take)
        .ok_or(Refusal::Invalid)?;
    if !document.is_object() {
        return Err(Refusal::Invalid);
    }
    if part == Part::Memories && !document.get("memories").is_some_and(Value::is_array) {
        return Err(Refusal::Invalid);
    }
    let page = match result.get_mut("page").map(Value::take) {
        None | Some(Value::Null) => None,
        Some(page) if page.is_object() => Some(page),
        Some(_) => return Err(Refusal::Invalid),
    };
    let mut pictures = BTreeMap::new();
    if let Some(listed) = result.get("pictures") {
        let listed = listed.as_object().ok_or(Refusal::Invalid)?;
        for (path, file) in listed {
            let file = file.as_str().ok_or(Refusal::Invalid)?;
            if path.is_empty() || path.len() > 512 || path.chars().any(char::is_control) {
                return Err(Refusal::Invalid);
            }
            pictures.insert(path.clone(), PathBuf::from(file));
        }
    }
    Ok(Reply::Notebook {
        part,
        document,
        page,
        pictures,
    })
}

/// An ISO 8601 moment as the engine gives one: short, plain text.
fn moment(at: &str) -> bool {
    (10..=40).contains(&at.len())
        && at
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | 'T' | '.' | '+' | 'Z'))
}

/// Every id a notebook document names (each object's `id`), so the page may
/// name them back in a write.
fn ids_in(value: &Value, into: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                if key == "id" {
                    if let Some(id) = inner.as_str() {
                        if valid_id(id) {
                            into.push(id.to_owned());
                        }
                    }
                } else {
                    ids_in(inner, into);
                }
            }
        }
        Value::Array(list) => list.iter().for_each(|inner| ids_in(inner, into)),
        _ => {}
    }
}

/// The opening `hello`: the app asks it once as a mind opens, never the
/// page. An older Mnemos doesn't know it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Greeting;

/// What a Mnemos that answers `hello` says it can do.
#[derive(Clone, Debug, Serialize)]
pub struct Hello {
    /// Everything the engine said, for the page to guard and read.
    pub said: Value,
    #[serde(skip)]
    pub(crate) commands: Vec<String>,
}

impl Hello {
    /// Whether this engine answers `command`.
    pub(crate) fn answers(&self, command: &str) -> bool {
        self.commands.iter().any(|c| c == command)
    }
}

impl Answered for Hello {
    fn ids(&self) -> Vec<&str> {
        Vec::new()
    }
}

impl Exchange for Greeting {
    type Answer = Hello;
    const SAYS_WHY: bool = false;

    fn check(&self) -> Result<(), &'static str> {
        Ok(())
    }

    fn command(&self) -> &'static str {
        "hello"
    }

    fn line(&self, id: u64) -> String {
        format!("{}\n", json!({"id": id, "command": "hello"}))
    }

    fn answer(&self, result: Value) -> Result<Hello, Refusal> {
        let commands: Vec<String> = result
            .get("commands")
            .and_then(Value::as_array)
            .ok_or(Refusal::Invalid)?
            .iter()
            .filter_map(|c| c.as_str().map(str::to_owned))
            .collect();
        if result.get("protocol").and_then(Value::as_u64).is_none() {
            return Err(Refusal::Invalid);
        }
        Ok(Hello {
            said: result,
            commands,
        })
    }
}

/// One of the person's own writes, as the webview sends it: exactly these
/// four, and anything else is refused. Each is the person's: the interface
/// is started with the app's environment cleared, so Mnemos signs it as
/// theirs.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "command", rename_all = "lowercase", deny_unknown_fields)]
pub enum Write {
    /// Answer one of the mind's notes.
    Reply { note_id: String, text: String },
    /// Leave the mind a note of the person's own.
    Note { text: String },
    /// Correct a memory in the person's words; the old version is archived.
    Correct { memory_id: String, text: String },
    /// Let a memory go: archived, never deleted.
    Forget { memory_id: String },
    /// Mark the mind's notes read: the person saw them.
    Read { note_ids: Vec<String> },
    /// Turn the quiet hours on (with their times, `HH:MM` or empty for the
    /// default) or off. This writes a real job into the Mac's scheduler.
    Hours {
        on: bool,
        #[serde(default)]
        mine: Option<String>,
        #[serde(default)]
        ours: Option<String>,
        #[serde(default)]
        dream: Option<String>,
    },
    /// Add to the shared notebook, correct a row, or let one go (asked twice:
    /// `confirmed`).
    Shared {
        action: SharedAction,
        #[serde(default)]
        text: Option<String>,
        #[serde(default)]
        memory_id: Option<String>,
        #[serde(default)]
        confirmed: bool,
    },
}

/// What the person does to the shared notebook.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SharedAction {
    Add,
    Correct,
    Forget,
}

/// A quiet hour's time as the notebook takes one: `HH:MM`, or empty.
fn clock(at: &Option<String>) -> bool {
    at.as_deref().is_none_or(|t| {
        t.is_empty()
            || (t.len() == 5
                && t.as_bytes()[2] == b':'
                && t[..2].parse::<u8>().is_ok_and(|h| h < 24)
                && t[3..].parse::<u8>().is_ok_and(|m| m < 60))
    })
}

fn words_fit(text: &str) -> bool {
    !text.trim().is_empty() && text.chars().count() <= MAX_TEXT
}

impl Exchange for Write {
    type Answer = Written;
    const SAYS_WHY: bool = true;

    fn check(&self) -> Result<(), &'static str> {
        let fine = match self {
            Self::Reply { note_id, text } => valid_id(note_id) && words_fit(text),
            Self::Note { text } => words_fit(text),
            Self::Correct { memory_id, text } => valid_id(memory_id) && words_fit(text),
            Self::Forget { memory_id } => valid_id(memory_id),
            Self::Read { note_ids } => {
                (1..=MAX_READ).contains(&note_ids.len()) && note_ids.iter().all(|id| valid_id(id))
            }
            Self::Hours {
                on,
                mine,
                ours,
                dream,
            } => {
                clock(mine)
                    && clock(ours)
                    && clock(dream)
                    && (*on || (mine.is_none() && ours.is_none() && dream.is_none()))
            }
            Self::Shared {
                action,
                text,
                memory_id,
                confirmed,
            } => match action {
                SharedAction::Add => {
                    text.as_deref().is_some_and(words_fit) && memory_id.is_none() && !confirmed
                }
                SharedAction::Correct => {
                    text.as_deref().is_some_and(words_fit)
                        && memory_id.as_deref().is_some_and(valid_id)
                        && !confirmed
                }
                SharedAction::Forget => {
                    text.is_none() && memory_id.as_deref().is_some_and(valid_id) && *confirmed
                }
            },
        };
        if fine {
            Ok(())
        } else {
            Err("invalid_request")
        }
    }

    fn command(&self) -> &'static str {
        match self {
            Self::Reply { .. } => "reply",
            Self::Note { .. } => "note",
            Self::Correct { .. } => "correct",
            Self::Forget { .. } => "forget",
            Self::Read { .. } => "read",
            Self::Hours { .. } => "hours",
            Self::Shared { .. } => "shared",
        }
    }

    fn line(&self, id: u64) -> String {
        let mut body = json!({"id": id, "command": self.command()});
        match self {
            Self::Reply { note_id, text } => {
                body["note_id"] = json!(note_id);
                body["text"] = json!(text);
            }
            Self::Note { text } => body["text"] = json!(text),
            Self::Correct { memory_id, text } => {
                body["memory_id"] = json!(memory_id);
                body["text"] = json!(text);
            }
            Self::Forget { memory_id } => body["memory_id"] = json!(memory_id),
            Self::Read { note_ids } => body["note_ids"] = json!(note_ids),
            Self::Hours {
                on,
                mine,
                ours,
                dream,
            } => {
                body["on"] = json!(on);
                if *on {
                    body["mine"] = json!(mine.as_deref().unwrap_or(""));
                    body["ours"] = json!(ours.as_deref().unwrap_or(""));
                    body["dream"] = json!(dream.as_deref().unwrap_or(""));
                }
            }
            Self::Shared {
                action,
                text,
                memory_id,
                confirmed,
            } => {
                body["action"] = json!(action);
                if let Some(text) = text {
                    body["text"] = json!(text);
                }
                if let Some(memory_id) = memory_id {
                    body["memory_id"] = json!(memory_id);
                }
                if *confirmed {
                    body["confirmed"] = json!(true);
                }
            }
        }
        format!("{body}\n")
    }

    fn answer(&self, result: Value) -> Result<Written, Refusal> {
        let written = match self {
            Self::Reply { .. } | Self::Note { .. } => {
                let note: Note = serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if note.author != "person" {
                    return Err(Refusal::Invalid);
                }
                Written::Note { note }
            }
            Self::Correct { memory_id, .. } => {
                #[derive(Deserialize)]
                struct Corrected {
                    id: String,
                    replaces: String,
                    corrected: Option<String>,
                }
                let done: Corrected =
                    serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if done.replaces != *memory_id {
                    return Err(Refusal::Invalid);
                }
                Written::Corrected {
                    id: done.id,
                    replaces: done.replaces,
                    corrected: done.corrected,
                }
            }
            Self::Forget { memory_id } => {
                #[derive(Deserialize)]
                struct Forgotten {
                    id: String,
                    forgotten: Option<String>,
                }
                let done: Forgotten =
                    serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if done.id != *memory_id {
                    return Err(Refusal::Invalid);
                }
                Written::Forgotten {
                    id: done.id,
                    forgotten: done.forgotten,
                }
            }
            Self::Read { note_ids } => {
                let ids: Vec<String> =
                    serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
                if !ids.iter().all(|id| note_ids.contains(id)) {
                    return Err(Refusal::Invalid);
                }
                Written::Read { ids }
            }
            Self::Hours { .. } => Written::Hours {
                said: plain(result.as_str().ok_or(Refusal::Invalid)?),
            },
            Self::Shared { .. } => Written::Shared {
                said: plain(result.as_str().ok_or(Refusal::Invalid)?),
            },
        };
        Ok(written)
    }

    fn names(&self) -> Vec<&str> {
        match self {
            Self::Reply { note_id, .. } => vec![note_id.as_str()],
            Self::Note { .. } | Self::Hours { .. } => Vec::new(),
            Self::Correct { memory_id, .. } | Self::Forget { memory_id } => {
                vec![memory_id.as_str()]
            }
            Self::Read { note_ids } => note_ids.iter().map(String::as_str).collect(),
            Self::Shared { memory_id, .. } => memory_id.as_deref().into_iter().collect(),
        }
    }
}

/// What one of the person's writes gave back.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Written {
    /// The answer or note, as it is now kept.
    Note { note: Note },
    /// The memory's new version, and the one it replaced.
    Corrected {
        id: String,
        replaces: String,
        corrected: Option<String>,
    },
    /// The memory let go: archived, not deleted.
    Forgotten {
        id: String,
        forgotten: Option<String>,
    },
    /// The notes now read.
    Read { ids: Vec<String> },
    /// What the scheduler said.
    Hours { said: String },
    /// What the shared notebook said.
    Shared { said: String },
}

impl Answered for Written {
    fn ids(&self) -> Vec<&str> {
        match self {
            Self::Note { note } => note.ids(),
            Self::Corrected { id, .. } => vec![id.as_str()],
            Self::Forgotten { .. }
            | Self::Read { .. }
            | Self::Hours { .. }
            | Self::Shared { .. } => Vec::new(),
        }
    }
}

/// How many memories the mind holds, by state.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Counts {
    pub active: u64,
    pub dormant: u64,
    pub archived: u64,
}

/// One memory, as the place shows it.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Memory {
    pub id: String,
    pub words: String,
    pub kept: Option<String>,
    pub state: String,
    pub alive: f64,
    pub corrected: Option<String>,
    #[serde(default)]
    pub impact: String,
    pub author: String,
}

/// One search result: how close, and how it was found.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Found {
    pub id: String,
    pub words: String,
    pub kept: Option<String>,
    pub closeness: f64,
    pub found: String,
}

/// One journal entry.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Entry {
    pub id: String,
    pub text: String,
    pub mood: Option<String>,
    pub written: Option<String>,
    pub model: Option<String>,
    pub created_at: Option<String>,
}

/// One note, the mind's or the person's.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Note {
    pub id: String,
    pub kind: Option<String>,
    pub text: String,
    pub author: String,
    pub model: Option<String>,
    pub in_reply_to: Option<String>,
    pub created_at: Option<String>,
    pub read_at: Option<String>,
    #[serde(default)]
    pub delivered_at: Option<String>,
}

impl Note {
    fn by_someone_known(&self) -> bool {
        matches!(self.author.as_str(), "agent" | "person")
    }

    fn ids(&self) -> Vec<&str> {
        std::iter::once(self.id.as_str())
            .chain(self.in_reply_to.as_deref())
            .collect()
    }
}

/// What a reading request gives back to the page.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Reply {
    Memories {
        memories: Vec<Memory>,
        counts: Counts,
    },
    Search {
        results: Vec<Found>,
    },
    Journal {
        entries: Vec<Entry>,
    },
    Notes {
        notes: Vec<Note>,
    },
    /// The new engine's `summary`, passed through.
    Summary {
        summary: Value,
    },
    /// A notebook part, passed through. The pictures it lists reach the page
    /// by their notebook path only; the files stay with the session.
    Notebook {
        part: Part,
        document: Value,
        page: Option<Value>,
        #[serde(serialize_with = "picture_paths")]
        pictures: BTreeMap<String, PathBuf>,
    },
}

/// The pictures' notebook paths, never the files behind them.
fn picture_paths<S: serde::Serializer>(
    pictures: &BTreeMap<String, PathBuf>,
    to: S,
) -> Result<S::Ok, S::Error> {
    to.collect_seq(pictures.keys())
}

impl Answered for Reply {
    fn ids(&self) -> Vec<&str> {
        match self {
            Self::Memories { memories, .. } => memories.iter().map(|m| m.id.as_str()).collect(),
            Self::Search { results } => results.iter().map(|m| m.id.as_str()).collect(),
            Self::Journal { entries } => entries.iter().map(|e| e.id.as_str()).collect(),
            Self::Notes { notes } => notes.iter().flat_map(Note::ids).collect(),
            Self::Summary { .. } | Self::Notebook { .. } => Vec::new(),
        }
    }

    fn pictures(&self) -> Vec<(String, PathBuf)> {
        match self {
            Self::Notebook { pictures, .. } => pictures
                .iter()
                .map(|(path, file)| (path.clone(), file.clone()))
                .collect(),
            _ => Vec::new(),
        }
    }

    fn more_ids(&self) -> Vec<String> {
        let mut ids = Vec::new();
        if let Self::Notebook { document, .. } = self {
            ids_in(document, &mut ids);
        }
        ids
    }
}

/// Why an answer could not be taken.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Not the answer to this request, or not the shape it promised.
    Invalid,
    /// The engine said no; it doesn't know this command (too old).
    Unknown,
    /// The store is busy: someone else is writing to it.
    Busy,
    /// The engine said no. Its own sentence comes back only for a write
    /// (`Exchange::SAYS_WHY`), cut short and plain; it is never logged.
    Refused(Option<String>),
}

/// The engine's own refusal, as the page may show it: one plain line, short,
/// with no control characters.
fn plain(said: &str) -> String {
    let line: String = said
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    line.chars().take(MAX_SAID).collect()
}

/// An opaque id, as the place accepts one: short text with no control
/// characters.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && !id.chars().any(char::is_control)
}

/// The answer line for exchange `id`, parsed into the answer it promises.
pub(crate) fn parse<E: Exchange>(line: &[u8], id: u64, exchange: &E) -> Result<E::Answer, Refusal> {
    let v: Value = serde_json::from_slice(line).map_err(|_| Refusal::Invalid)?;
    if v.get("id").and_then(Value::as_u64) != Some(id) {
        return Err(Refusal::Invalid);
    }
    if let Some(error) = v.get("error") {
        let said = error.as_str().unwrap_or_default();
        return Err(if said.starts_with("There is no command") {
            Refusal::Unknown
        } else if said.contains("database is locked") {
            Refusal::Busy
        } else {
            Refusal::Refused(E::SAYS_WHY.then(|| plain(said)))
        });
    }
    let result = v.get("result").cloned().ok_or(Refusal::Invalid)?;
    let answer = exchange.answer(result)?;
    if answer.ids().iter().any(|id| !valid_id(id)) {
        return Err(Refusal::Invalid);
    }
    Ok(answer)
}

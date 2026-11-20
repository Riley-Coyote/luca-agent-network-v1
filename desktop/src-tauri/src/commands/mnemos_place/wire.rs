//! What the place may ask of the person's `mnemos interface`, and what it
//! takes back. Only the four reading commands exist here: no write command
//! is a type, so none can be built, sent or deserialized from the webview.
//! Replies are parsed into these shapes and nothing else reaches the page.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
}

impl Request {
    /// Refuse a request outside the place's limits.
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        let fine = match self {
            Self::Memories { limit, offset, .. } => *limit <= MAX_PAGE && *offset <= 10_000_000,
            Self::Search { query } => {
                !query.trim().is_empty() && query.chars().count() <= MAX_QUERY
            }
            Self::Journal { last } => (1..=MAX_JOURNAL).contains(last),
            Self::Notes {} => true,
        };
        if fine {
            Ok(())
        } else {
            Err("invalid_request")
        }
    }

    /// The command's name on the wire.
    pub(crate) fn command(&self) -> &'static str {
        match self {
            Self::Memories { .. } => "memories",
            Self::Search { .. } => "search",
            Self::Journal { .. } => "journal",
            Self::Notes {} => "notes",
        }
    }

    /// The one JSON line the interface reads for this request.
    pub(crate) fn line(&self, id: u64) -> String {
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
        }
        format!("{body}\n")
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
}

impl Reply {
    /// Every id this reply carries, for the session's record of them.
    pub(crate) fn ids(&self) -> Vec<&str> {
        match self {
            Self::Memories { memories, .. } => memories.iter().map(|m| m.id.as_str()).collect(),
            Self::Search { results } => results.iter().map(|m| m.id.as_str()).collect(),
            Self::Journal { entries } => entries.iter().map(|e| e.id.as_str()).collect(),
            Self::Notes { notes } => notes
                .iter()
                .flat_map(|n| std::iter::once(n.id.as_str()).chain(n.in_reply_to.as_deref()))
                .collect(),
        }
    }
}

/// Why an answer could not be taken.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Not the answer to this request, or not the shape it promised.
    Invalid,
    /// The engine said no; it doesn't know this command (too old).
    Unknown,
    /// The engine said no, in its own words (never shown or logged).
    Refused,
}

/// An opaque id, as the place accepts one: short text with no control
/// characters.
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && !id.chars().any(char::is_control)
}

/// The answer line for request `id`, parsed into the reply its command
/// promises.
pub(crate) fn parse(line: &[u8], id: u64, request: &Request) -> Result<Reply, Refusal> {
    let v: Value = serde_json::from_slice(line).map_err(|_| Refusal::Invalid)?;
    if v.get("id").and_then(Value::as_u64) != Some(id) {
        return Err(Refusal::Invalid);
    }
    if let Some(error) = v.get("error") {
        let said = error.as_str().unwrap_or_default();
        return Err(if said.starts_with("There is no command") {
            Refusal::Unknown
        } else {
            Refusal::Refused
        });
    }
    let result = v.get("result").cloned().ok_or(Refusal::Invalid)?;
    let reply = match request {
        Request::Memories { .. } => {
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
        Request::Search { .. } => {
            #[derive(Deserialize)]
            struct Results {
                results: Vec<Found>,
            }
            let found: Results = serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
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
        Request::Journal { .. } => Reply::Journal {
            entries: serde_json::from_value(result).map_err(|_| Refusal::Invalid)?,
        },
        Request::Notes {} => {
            let notes: Vec<Note> = serde_json::from_value(result).map_err(|_| Refusal::Invalid)?;
            if notes
                .iter()
                .any(|n| !matches!(n.author.as_str(), "agent" | "person"))
            {
                return Err(Refusal::Invalid);
            }
            Reply::Notes { notes }
        }
    };
    if reply.ids().iter().any(|id| !valid_id(id)) {
        return Err(Refusal::Invalid);
    }
    Ok(reply)
}

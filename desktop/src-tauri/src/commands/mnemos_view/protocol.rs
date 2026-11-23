//! Wire boundary for the engine-owned read view. Never return raw engine JSON,
//! diagnostics, SQL, paths, or links to the webview.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const MAX_REPLY: usize = 256 * 1024;
pub(super) const LIMIT: usize = 50;
pub(super) const INVALID: &str = "invalid_reply";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub agent_id: String,
    pub person_id: String,
    pub project_scope: String,
}
impl Scope {
    pub(super) fn valid(&self) -> bool {
        [&self.agent_id, &self.person_id, &self.project_scope]
            .iter()
            .all(|s| {
                !s.is_empty()
                    && s.len() <= 128
                    && !s.starts_with('-')
                    && !s.ends_with('-')
                    && s.bytes().all(|b| {
                        b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_')
                    })
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Section {
    Summary,
    Memories,
    Standing,
    Journal,
    Notes,
    Handoffs,
    Beliefs,
}
impl Section {
    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Summary => "summary",
            Self::Memories => "memories",
            Self::Standing => "standing",
            Self::Journal => "journal",
            Self::Notes => "notes",
            Self::Handoffs => "handoffs",
            Self::Beliefs => "beliefs",
        }
    }
}

#[derive(Deserialize, Serialize)]
pub struct MemoryCount {
    pub active: u64,
    pub dormant: u64,
    pub archived: u64,
}
#[derive(Deserialize, Serialize)]
pub struct NoteCount {
    pub all: u64,
    pub unread: u64,
}
#[derive(Deserialize, Serialize)]
pub struct Counts {
    pub memories: MemoryCount,
    pub standing: u64,
    pub journal: u64,
    pub notes: NoteCount,
    pub handoffs: u64,
    pub beliefs: u64,
}
#[derive(Serialize)]
pub struct Item {
    pub text: String,
    pub clipped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<&'static str>,
    /// When it was kept or written, as the view sends it (ISO 8601).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    /// A belief's confidence, 0 to 1, as the view sends it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}
/// A date the view sent, kept only when it is short text.
fn date_of(row: &Value, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 64)
        .map(str::to_owned)
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Page {
    Summary {
        counts: Counts,
    },
    Items {
        items: Vec<Item>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
}
fn valid_cursor(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 1024 // Same bound as the pinned reader's decoder.
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
pub(super) fn cursor_for<'a>(
    grant: &str,
    section: Section,
    cursor: &'a str,
) -> Result<&'a str, String> {
    let prefix = format!("{}:{}:", grant, section.label());
    cursor
        .strip_prefix(&prefix)
        .filter(|s| section != Section::Summary && valid_cursor(s))
        .ok_or_else(|| "stale_page".into())
}
pub(super) fn project(
    bytes: &[u8],
    scope: &Scope,
    grant: &str,
    section: Section,
) -> Result<Page, String> {
    // The CLI prints one newline after its bounded JSON document. Only that
    // terminator, not an extra byte of payload, sits outside the wire limit.
    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    if bytes.len() > MAX_REPLY {
        return Err(INVALID.into());
    }
    let v: Value = serde_json::from_slice(bytes).map_err(|_| INVALID)?;
    if v.get("protocol_version").and_then(Value::as_u64) != Some(1)
        || v.get("schema_version").and_then(Value::as_u64).is_none()
        || !v
            .get("mnemos_version")
            .and_then(Value::as_str)
            .is_some_and(|s| !s.is_empty() && s.len() <= 80)
        || v.get("section").and_then(Value::as_str) != Some(section.label())
        || v.get("scope") != Some(&serde_json::to_value(scope).map_err(|_| INVALID)?)
    {
        return Err(INVALID.into());
    }
    if section == Section::Summary {
        let counts =
            serde_json::from_value(v.get("counts").ok_or(INVALID)?.clone()).map_err(|_| INVALID)?;
        return Ok(Page::Summary { counts });
    }
    if v.get("limit").and_then(Value::as_u64) != Some(LIMIT as u64) {
        return Err(INVALID.into());
    }
    let rows = v
        .get("items")
        .and_then(Value::as_array)
        .filter(|r| r.len() <= LIMIT)
        .ok_or(INVALID)?;
    let key = if matches!(section, Section::Memories | Section::Standing) {
        "words"
    } else {
        "text"
    };
    let items = rows
        .iter()
        .map(|row| {
            let text = row
                .get(key)
                .and_then(Value::as_str)
                .filter(|s| s.chars().count() <= 16384)
                .ok_or(INVALID)?
                .to_owned();
            Ok::<_, String>(Item {
                text,
                clipped: match row.get("clipped") {
                    None => false,
                    Some(flag) => flag.as_bool().ok_or(INVALID)?,
                },
                author: match (section, row.get("author").and_then(Value::as_str)) {
                    (Section::Notes, Some("agent")) => Some("agent"),
                    (Section::Notes, Some("person")) => Some("person"),
                    _ => None,
                },
                at: if matches!(section, Section::Memories | Section::Standing) {
                    date_of(row, "kept")
                } else {
                    date_of(row, "created_at")
                },
                confidence: match section {
                    Section::Beliefs => row
                        .get("confidence")
                        .and_then(Value::as_f64)
                        .filter(|c| (0.0..=1.0).contains(c)),
                    _ => None,
                },
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = match (
        v.get("truncated").and_then(Value::as_bool),
        v.get("next_cursor"),
    ) {
        (Some(false), Some(Value::Null)) => None,
        (Some(true), Some(Value::String(s))) if !items.is_empty() && valid_cursor(s) => {
            Some(format!("{}:{}:{}", grant, section.label(), s))
        }
        _ => return Err(INVALID.into()),
    };
    Ok(Page::Items { items, next_cursor })
}

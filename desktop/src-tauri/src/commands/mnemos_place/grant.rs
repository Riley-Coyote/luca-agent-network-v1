//! The owner's answer to "show this mind here?", one small file per owner
//! and mind, bound to the store's file identity as the agent tab's own
//! connection is. A moved or replaced store asks again.
use super::session::MindKey;
use crate::managed_agents::storage::atomic_write_json_restricted;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_RECORD: u64 = 8192;
const UNAVAILABLE: &str = "view_unavailable";

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Grant {
    owner: String,
    mind: String,
    file: PathBuf,
    device: u64,
    inode: u64,
}

/// What the owner has said about showing a mind here.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Answer {
    /// Never asked (or the record was unreadable): ask.
    Unasked,
    /// Yes, for this very file.
    Shown,
    /// Yes, but for a file that has since moved or been replaced.
    Changed,
}

/// The record's place: `<base>/mnemos-place-v1/<owner>/<mind>.json`. Both
/// parts are ids already checked to be lowercase words (`Scope::valid`,
/// the owner's hex key).
pub(crate) fn record(base: &Path, owner: &str, mind: &str) -> Option<PathBuf> {
    let word = |s: &str| {
        !s.is_empty()
            && s.len() <= 128
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
    };
    (word(owner) && word(mind)).then(|| {
        base.join("mnemos-place-v1")
            .join(owner)
            .join(format!("{mind}.json"))
    })
}

/// The owner's answer for `key`'s mind. A record for another owner or mind,
/// one that is too large, or a link, device or pipe in its place reads as
/// never asked.
pub(crate) fn answer(base: &Path, owner: &str, key: &MindKey) -> Answer {
    let Some(path) = record(base, owner, &key.agent) else {
        return Answer::Unasked;
    };
    match load(&path) {
        Some(g) if g.owner == owner && g.mind == key.agent => {
            if g.file == key.file && g.device == key.device && g.inode == key.inode {
                Answer::Shown
            } else {
                Answer::Changed
            }
        }
        _ => Answer::Unasked,
    }
}

/// Remember yes for `key`'s mind, for this owner.
pub(crate) fn remember(base: &Path, owner: &str, key: &MindKey) -> Result<(), String> {
    let path = record(base, owner, &key.agent).ok_or(UNAVAILABLE)?;
    let grant = Grant {
        owner: owner.to_owned(),
        mind: key.agent.clone(),
        file: key.file.clone(),
        device: key.device,
        inode: key.inode,
    };
    fs::create_dir_all(path.parent().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    let bytes = serde_json::to_vec(&grant).map_err(|_| UNAVAILABLE)?;
    atomic_write_json_restricted(&path, &bytes).map_err(|_| UNAVAILABLE.into())
}

fn load(path: &Path) -> Option<Grant> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = fs::OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let file = options.open(path).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() > MAX_RECORD {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_RECORD {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

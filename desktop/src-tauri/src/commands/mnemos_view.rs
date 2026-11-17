//! A resident's Mnemos memory. Connected for viewing, it is an owner-only,
//! foreground view: no MCP registration, memory mutation or resident turn.
//! Linked (`link`), the resident remembers with it, the same way the person's
//! other apps do.
mod link;
mod protocol;
mod reader;
#[cfg(test)]
mod tests;
use crate::{
    app_state::AppState, data_dir::BuzzPathExt,
    managed_agents::storage::atomic_write_json_restricted,
};
use protocol::{Page, Scope, Section};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

static COMMIT: Mutex<()> = Mutex::new(());
const CHANGED: &str = "binding_changed";
const UNAVAILABLE: &str = "view_unavailable";

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Binding {
    owner: String,
    resident: String,
    grant: String,
    scope: Scope,
    file: PathBuf,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    /// The resident remembers with this store (a link), rather than the owner
    /// only viewing it. Records saved before links existed are views.
    #[serde(default)]
    linked: bool,
}
impl Binding {
    fn selected(
        owner: String,
        resident: String,
        scope: Scope,
        file: &Path,
    ) -> Result<Self, String> {
        let file = file.canonicalize().map_err(|_| "store_unavailable")?;
        let meta = fs::metadata(&file).map_err(|_| "store_unavailable")?;
        if !file.is_absolute() || !meta.is_file() || !scope.valid() {
            return Err("store_unavailable".into());
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            owner,
            resident,
            scope,
            file,
            grant: uuid::Uuid::new_v4().to_string(),
            #[cfg(unix)]
            device: meta.dev(),
            #[cfg(unix)]
            inode: meta.ino(),
            linked: false,
        })
    }
    fn same_file(&self) -> bool {
        let Ok(p) = self.file.canonicalize() else {
            return false;
        };
        if p != self.file {
            return false;
        }
        let Ok(meta) = fs::metadata(p) else {
            return false;
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            meta.is_file() && meta.dev() == self.device && meta.ino() == self.inode
        }
        #[cfg(not(unix))]
        {
            let _ = meta;
            false
        } // No file-identity protocol on those hosts yet.
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    grant: Option<String>,
    scope: Option<Scope>,
    reader_ready: bool,
    /// The resident remembers with the connected store.
    linked: bool,
    /// The person's own `mnemos` command is installed where its installers put it.
    mnemos_ready: bool,
}

fn main_window(win: &Window) -> Result<(), String> {
    if win.label() == "main" {
        Ok(())
    } else {
        Err("main_window_only".into())
    }
}
fn key(app: &AppHandle, resident: &str) -> Result<(String, String), String> {
    let (owner, resident, backend) =
        super::continuity::resident_authority_with_backend(app, &app.state::<AppState>(), resident)
            .map_err(|_| "resident_unavailable")?;
    require_local(&backend)?;
    Ok((owner.as_str().into(), resident.as_str().into()))
}
fn require_local(backend: &crate::managed_agents::BackendKind) -> Result<(), String> {
    match backend {
        crate::managed_agents::BackendKind::Local => Ok(()),
        _ => Err("resident_unavailable".into()),
    }
}
fn record(app: &AppHandle, k: &(String, String)) -> Result<PathBuf, String> {
    Ok(app
        .buzz_path()
        .app_data_dir()
        .map_err(|_| UNAVAILABLE)?
        .join("mnemos-view-v1")
        .join(&k.0)
        .join(format!("{}.json", &k.1)))
}
fn load(path: &Path, k: &(String, String)) -> Result<Option<Binding>, String> {
    use std::io::Read;
    // App grants are small regular files, never symlinks, devices or pipes.
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = match options.open(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        other => other.map_err(|_| UNAVAILABLE)?,
    };
    let meta = file.metadata().map_err(|_| UNAVAILABLE)?;
    const MAX_BINDING: u64 = 8192;
    if !meta.is_file() || meta.len() > MAX_BINDING {
        return Err(UNAVAILABLE.into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BINDING + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE)?;
    if bytes.len() as u64 > MAX_BINDING {
        return Err(UNAVAILABLE.into());
    }
    let b: Binding = serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?;
    if b.owner != k.0
        || b.resident != k.1
        || !b.scope.valid()
        || !b.file.is_absolute()
        || uuid::Uuid::parse_str(&b.grant).is_err()
    {
        return Err(UNAVAILABLE.into());
    }
    Ok(Some(b))
}
fn binding(app: &AppHandle, k: &(String, String)) -> Result<Option<Binding>, String> {
    load(&record(app, k)?, k)
}
fn require_grant(app: &AppHandle, k: &(String, String), grant: &str) -> Result<Binding, String> {
    binding(app, k)?
        .filter(|b| b.grant == grant)
        .ok_or_else(|| CHANGED.into())
}

/// A mind a resident remembers with, ready to run: the person's own `mnemos`
/// command and the exact store and agent the owner linked.
pub(crate) struct LinkedMnemosMind {
    pub(crate) command: PathBuf,
    pub(crate) db: PathBuf,
    pub(crate) agent_id: String,
}

/// Whether the owner linked this resident to a Mnemos mind. While linked,
/// Polyphonic's own notebook for the resident stays off, even if the mind's
/// store or command is missing for now: one memory, never a quiet second one.
pub(crate) fn mnemos_linked(app: &AppHandle, owner_pubkey: &str, resident_pubkey: &str) -> bool {
    let k = (owner_pubkey.to_owned(), resident_pubkey.to_owned());
    matches!(binding(app, &k), Ok(Some(b)) if b.linked)
}

/// The mind this resident remembers with, when it is linked and its store and
/// the person's `mnemos` command are both still there.
pub(crate) fn linked_mnemos_mind(
    app: &AppHandle,
    resident_pubkey: &str,
) -> Option<LinkedMnemosMind> {
    let k = key(app, resident_pubkey).ok()?;
    let b = binding(app, &k).ok()??;
    if !b.linked || !b.same_file() {
        return None;
    }
    Some(LinkedMnemosMind {
        command: link::command(&dirs::home_dir()?)?,
        db: b.file,
        agent_id: b.scope.agent_id,
    })
}

#[tauri::command]
pub async fn mnemos_view_status(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
) -> Result<Status, String> {
    main_window(&window)?;
    let k = key(&app, &resident_pubkey)?;
    let b = binding(&app, &k)?;
    Ok(Status {
        grant: b.as_ref().map(|b| b.grant.clone()),
        linked: b.as_ref().is_some_and(|b| b.linked),
        scope: b.map(|b| b.scope),
        reader_ready: reader::available(&app),
        mnemos_ready: dirs::home_dir().is_some_and(|home| link::command(&home).is_some()),
    })
}

/// The minds the person keeps in Mnemos on this Mac, for the link picker.
#[tauri::command]
pub async fn mnemos_minds(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
) -> Result<Vec<link::MindChoice>, String> {
    main_window(&window)?;
    key(&app, &resident_pubkey)?;
    let home = dirs::home_dir().ok_or(UNAVAILABLE)?;
    tokio::task::spawn_blocking(move || link::minds(&home).iter().map(link::Mind::choice).collect())
        .await
        .map_err(|_| UNAVAILABLE.into())
}

/// Link the resident to one of the person's minds, after the owner confirms
/// it in a native dialog. A view-only connection is replaced; an existing link
/// must be unlinked first.
#[tauri::command]
pub async fn link_mnemos_mind(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
    mind: String,
) -> Result<bool, String> {
    main_window(&window)?;
    let home = dirs::home_dir().ok_or(UNAVAILABLE)?;
    if link::command(&home).is_none() {
        return Err("mnemos_unavailable".into());
    }
    let k = key(&app, &resident_pubkey)?;
    let before = binding(&app, &k)?;
    if before.as_ref().is_some_and(|b| b.linked) {
        return Err(CHANGED.into());
    }
    let lookup = home.clone();
    let found = tokio::task::spawn_blocking(move || {
        link::minds(&lookup)
            .into_iter()
            .find(|found| found.scope.agent_id == mind)
    })
    .await
    .map_err(|_| UNAVAILABLE)?
    .ok_or("store_unavailable")?;
    let mut b = Binding::selected(k.0.clone(), k.1.clone(), found.scope.clone(), &found.file)?;
    b.linked = true;
    let name = crate::managed_agents::load_managed_agents(&app)
        .map_err(|_| UNAVAILABLE)?
        .into_iter()
        .find(|r| r.pubkey.eq_ignore_ascii_case(&k.1))
        .ok_or("resident_unavailable")?
        .name;
    let mind_name = found.name();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "{name} will remember with “{mind_name}”, your Mnemos memory on this Mac. It’s the same memory your other apps reach through Mnemos, like Claude Code.\n\n{name} can read it and add to it, and wakes up with it in each new conversation. While it’s linked, Polyphonic’s own notes for {name} stay off, so there’s one memory.\n\nYou can unlink at any time. Nothing is deleted.\n\n{}",
            link::display(&home, &b.file)
        ))
        .parent(&window)
        .title(format!("Give {name} this memory?"))
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Link memory".into(),
            "Cancel".into(),
        ))
        .show(move |allowed| {
            let _ = tx.send(allowed);
        });
    if !rx.await.map_err(|_| UNAVAILABLE)? {
        return Ok(false);
    }
    let _guard = COMMIT.lock().map_err(|_| UNAVAILABLE)?;
    if key(&app, &resident_pubkey)? != k || binding(&app, &k)? != before || !b.same_file() {
        return Err(CHANGED.into());
    }
    let path = record(&app, &k)?;
    fs::create_dir_all(path.parent().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    atomic_write_json_restricted(&path, &serde_json::to_vec(&b).map_err(|_| UNAVAILABLE)?)
        .map_err(|_| UNAVAILABLE)?;
    Ok(true)
}

#[tauri::command]
pub async fn connect_mnemos_view(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
    scope: Scope,
) -> Result<bool, String> {
    main_window(&window)?;
    if !scope.valid() {
        return Err("invalid_scope".into());
    }
    if !reader::available(&app) {
        return Err("reader_unavailable".into());
    }
    let k = key(&app, &resident_pubkey)?;
    if binding(&app, &k)?.is_some() {
        return Err(CHANGED.into());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose the Mnemos store to view")
        .set_parent(&window)
        .pick_file(move |selection| {
            let _ = tx.send(selection);
        });
    let Some(selection) = rx.await.map_err(|_| UNAVAILABLE)? else {
        return Ok(false);
    };
    let b = Binding::selected(
        k.0.clone(),
        k.1.clone(),
        scope,
        selection.as_path().ok_or("store_unavailable")?,
    )?;
    let name = crate::managed_agents::load_managed_agents(&app)
        .map_err(|_| UNAVAILABLE)?
        .into_iter()
        .find(|r| r.pubkey.eq_ignore_ascii_case(&k.1))
        .ok_or("resident_unavailable")?
        .name;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().message(format!("Allow the Mnemos tab for {name} to show this view on this Mac?\n\nStore: {}\nAgent: {}\nPerson: {}\nProject: {}\n\nThis does not share memory with a model or grant editing access. You can disconnect this view at any time.",
        b.file.display(),b.scope.agent_id,b.scope.person_id,b.scope.project_scope))
        .parent(&window).title("Connect read-only memory").buttons(MessageDialogButtons::OkCancelCustom("Connect view".into(),"Cancel".into()))
        .show(move |allowed|{let _=tx.send(allowed);});
    if !rx.await.map_err(|_| UNAVAILABLE)? {
        return Ok(false);
    }
    let _guard = COMMIT.lock().map_err(|_| UNAVAILABLE)?;
    if key(&app, &resident_pubkey)? != k || binding(&app, &k)?.is_some() || !b.same_file() {
        return Err(CHANGED.into());
    }
    let path = record(&app, &k)?;
    fs::create_dir_all(path.parent().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    atomic_write_json_restricted(&path, &serde_json::to_vec(&b).map_err(|_| UNAVAILABLE)?)
        .map_err(|_| UNAVAILABLE)?;
    Ok(true)
}

#[tauri::command]
pub async fn disconnect_mnemos_view(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
    grant: String,
) -> Result<(), String> {
    main_window(&window)?;
    let _guard = COMMIT.lock().map_err(|_| UNAVAILABLE)?;
    let k = key(&app, &resident_pubkey)?;
    require_grant(&app, &k, &grant)?;
    fs::remove_file(record(&app, &k)?).map_err(|_| UNAVAILABLE.into())
}

#[tauri::command]
pub async fn read_mnemos_view(
    window: Window,
    app: AppHandle,
    resident_pubkey: String,
    grant: String,
    section: Section,
    cursor: Option<String>,
) -> Result<Page, String> {
    main_window(&window)?;
    let k = key(&app, &resident_pubkey)?;
    let b = require_grant(&app, &k, &grant)?;
    if !b.same_file() {
        return Err("store_changed".into());
    }
    let cursor = cursor
        .as_deref()
        .map(|s| protocol::cursor_for(&grant, section, s))
        .transpose()?;
    let reply = reader::read(&app, &b, section, cursor).await?;
    // A pending reply is not a grant. Re-check both identity and binding at delivery.
    let _guard = COMMIT.lock().map_err(|_| UNAVAILABLE)?;
    if key(&app, &resident_pubkey)? != k || require_grant(&app, &k, &grant)? != b || !b.same_file()
    {
        return Err(CHANGED.into());
    }
    protocol::project(&reply, &b.scope, &grant, section)
}

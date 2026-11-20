//! The Mnemos place: the person's own notebook of a mind, inside the app.
//! Every word comes from the person's installed `mnemos interface`, for one
//! mind at a time (`session`); a mind is shown only once the owner said so,
//! or because one of their residents already remembers with it (`grant`).
//! The person can write exactly seven things there, as themselves: answer a
//! note, leave one, correct a memory, let one go, mark notes read, set the
//! quiet hours, and keep the shared notebook (`wire::Write`). A newer Mnemos
//! also gives the whole notebook (`summary`, `notebook`), and the pictures
//! it lists (`mnemos_place_picture`).
mod grant;
mod session;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_notebook;
mod wire;

use super::mnemos_view::link;
use crate::{app_state::AppState, data_dir::BuzzPathExt, managed_agents::BackendKind};
use serde::Serialize;
use session::{place, Fail, MindKey, Spawn};
use std::{path::Path, time::Duration};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
pub use wire::{Reply, Request, Write, Written};

/// How long a search may take: the first one waits for the meaning model.
const SEARCH_LIMIT: Duration = Duration::from_secs(25);
/// How long any other reading may take.
const READ_LIMIT: Duration = Duration::from_secs(12);
/// How long a write may take: a correction waits for the meaning model.
const WRITE_LIMIT: Duration = Duration::from_secs(30);
/// How long the window may stay hidden before the process ends.
const HIDDEN_LIMIT: Duration = Duration::from_secs(120);
const UNAVAILABLE: &str = "view_unavailable";

/// A resident that remembers with a mind.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedResident {
    pubkey: String,
    name: String,
}

/// A mind on this Mac, as the place lists it: never any of its words.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceMind {
    id: String,
    name: String,
    memories: u64,
    /// The day of its newest memory, YYYY-MM-DD.
    newest: Option<String>,
    /// The owner's residents that remember with it.
    linked: Vec<LinkedResident>,
}

/// The minds on this Mac, and whether the person's `mnemos` is here.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceMinds {
    mnemos_ready: bool,
    minds: Vec<PlaceMind>,
    /// The owner's residents on this Mac that remember with no memory yet.
    without_memory: Vec<LinkedResident>,
}

fn main_window(win: &Window) -> Result<(), String> {
    if win.label() == "main" {
        Ok(())
    } else {
        Err("main_window_only".into())
    }
}

fn owner(app: &AppHandle) -> Result<String, String> {
    Ok(app
        .state::<AppState>()
        .signing_keys()?
        .public_key()
        .to_hex()
        .to_ascii_lowercase())
}

/// The owner's residents on this Mac that remember with no memory yet.
fn without_memory(app: &AppHandle) -> Vec<LinkedResident> {
    crate::managed_agents::load_managed_agents(app)
        .unwrap_or_default()
        .into_iter()
        .filter(|r| matches!(r.backend, BackendKind::Local))
        .filter(|r| super::linked_mnemos_mind(app, &r.pubkey).is_none())
        .map(|r| LinkedResident {
            pubkey: r.pubkey.to_ascii_lowercase(),
            name: r.name,
        })
        .collect()
}

/// The owner's residents that remember with the store at `file`.
fn linked_to(app: &AppHandle, file: &Path) -> Vec<LinkedResident> {
    let Ok(file) = file.canonicalize() else {
        return Vec::new();
    };
    crate::managed_agents::load_managed_agents(app)
        .unwrap_or_default()
        .into_iter()
        .filter(|r| matches!(r.backend, BackendKind::Local))
        .filter(|r| {
            super::linked_mnemos_mind(app, &r.pubkey)
                .and_then(|m| m.db.canonicalize().ok())
                .is_some_and(|db| db == file)
        })
        .map(|r| LinkedResident {
            pubkey: r.pubkey.to_ascii_lowercase(),
            name: r.name,
        })
        .collect()
}

/// The minds the person keeps in Mnemos on this Mac: names and numbers.
#[tauri::command]
pub async fn mnemos_place_minds(window: Window, app: AppHandle) -> Result<PlaceMinds, String> {
    main_window(&window)?;
    let home = dirs::home_dir().ok_or(UNAVAILABLE)?;
    let ready = link::command(&home).is_some();
    let found = tokio::task::spawn_blocking(move || link::minds(&home))
        .await
        .map_err(|_| UNAVAILABLE)?;
    let minds = found
        .iter()
        .map(|mind| PlaceMind {
            id: mind.scope.agent_id.clone(),
            name: mind.name(),
            memories: mind.memories,
            newest: mind.newest.clone(),
            linked: linked_to(&app, &mind.file),
        })
        .collect();
    Ok(PlaceMinds {
        mnemos_ready: ready,
        minds,
        without_memory: without_memory(&app),
    })
}

/// Open a mind in the place. A mind one of the owner's residents remembers
/// with opens unasked; any other asks once, in a native confirm, and the
/// answer is remembered. Declined, nothing of it is read. `ask_again` asks
/// again for a mind whose file was moved or replaced since it was shown.
#[tauri::command]
pub async fn open_mnemos_mind(
    window: Window,
    app: AppHandle,
    mind: String,
    ask_again: bool,
) -> Result<bool, String> {
    main_window(&window)?;
    let home = dirs::home_dir().ok_or(UNAVAILABLE)?;
    let program = link::command(&home).ok_or("mnemos_unavailable")?;
    let lookup = home.clone();
    let found = tokio::task::spawn_blocking(move || {
        link::minds(&lookup)
            .into_iter()
            .find(|found| found.scope.agent_id == mind)
    })
    .await
    .map_err(|_| UNAVAILABLE)?
    .ok_or("mind_unavailable")?;
    let key = MindKey::of(&found.scope.agent_id, &found.file).ok_or("mind_unavailable")?;
    if place().is_open(&key).await {
        return Ok(true);
    }
    let owner = owner(&app)?;
    let base = app.buzz_path().app_data_dir().map_err(|_| UNAVAILABLE)?;
    if linked_to(&app, &key.file).is_empty() {
        match grant::answer(&base, &owner, &key) {
            grant::Answer::Shown => {}
            grant::Answer::Changed if !ask_again => return Err("mind_changed".into()),
            _ => {
                if !confirm(&app, &window, &found.name(), &home, &key.file).await? {
                    place().end().await;
                    return Ok(false);
                }
                grant::remember(&base, &owner, &key)?;
            }
        }
    }
    let spec = Spawn {
        home,
        db: key.file.clone(),
        agent: found.scope.agent_id.clone(),
        person: found.scope.person_id.clone(),
        project: found.scope.project_scope.clone(),
    };
    let studio = session::studio_of(&spec.home, &spec.agent);
    place()
        .open(
            |newer| session::command(tokio::process::Command::new(&program), &spec, newer),
            key,
            studio,
            READ_LIMIT,
        )
        .await
        .map_err(|fail| fail.code().to_owned())?;
    Ok(true)
}

async fn confirm(
    app: &AppHandle,
    window: &Window,
    name: &str,
    home: &Path,
    file: &Path,
) -> Result<bool, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(format!(
            "{name}’s memory will be shown here in Polyphonic, on this Mac, the same memory your other apps reach through Mnemos.\n\nShowing it changes nothing in it and shares nothing with a model.\n\n{}",
            link::display(home, file)
        ))
        .parent(window)
        .title(format!("Show {name} here?"))
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Show memory".into(),
            "Cancel".into(),
        ))
        .show(move |allowed| {
            let _ = tx.send(allowed);
        });
    rx.await.map_err(|_| UNAVAILABLE.into())
}

/// Read one thing from the open mind: a page of memories, a search, the
/// journal or the notes; from a newer Mnemos, its summary or a part of its
/// notebook. Nothing else can be asked.
#[tauri::command]
pub async fn read_mnemos_place(
    window: Window,
    mind: String,
    request: Request,
) -> Result<Reply, String> {
    main_window(&window)?;
    let limit = match request {
        Request::Search { .. } | Request::Notebook { .. } => SEARCH_LIMIT,
        _ => READ_LIMIT,
    };
    place()
        .ask(&mind, &request, limit)
        .await
        .map_err(|fail: Fail| fail.code().to_owned())
}

/// One of the person's own writes to the open mind, sent once: answer a
/// note, leave one, correct a memory, let one go, mark notes read, the quiet
/// hours, the shared notebook. The owner's act alone:
/// the main window, a mind they said to show (or one of their residents
/// remembers with), and only ids the engine gave this mind this session.
/// A refusal of the engine's own (a quiet hour, a note too long) comes back
/// in its words, after `mnemos_refused:`.
#[tauri::command]
pub async fn write_mnemos_place(
    window: Window,
    app: AppHandle,
    mind: String,
    write: Write,
) -> Result<Written, String> {
    main_window(&window)?;
    let key = place()
        .open_key(&mind)
        .await
        .ok_or_else(|| Fail::NotOpen.code().to_owned())?;
    if linked_to(&app, &key.file).is_empty() {
        let owner = owner(&app)?;
        let base = app.buzz_path().app_data_dir().map_err(|_| UNAVAILABLE)?;
        if grant::answer(&base, &owner, &key) != grant::Answer::Shown {
            return Err("not_shown".into());
        }
    }
    place()
        .ask(&mind, &write, WRITE_LIMIT)
        .await
        .map_err(|fail| fail.told())
}

/// What the open mind's Mnemos said to `hello`: the commands and parts it
/// answers, and the scope it holds. None from an older Mnemos.
#[tauri::command]
pub async fn mnemos_place_hello(
    window: Window,
    mind: String,
) -> Result<Option<serde_json::Value>, String> {
    main_window(&window)?;
    Ok(place().hello(&mind).await)
}

/// The bytes of one picture the open mind's notebook listed this session,
/// by its notebook path. Nothing else can be read this way.
#[tauri::command]
pub async fn mnemos_place_picture(
    window: Window,
    mind: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    main_window(&window)?;
    place()
        .picture(&mind, &path)
        .await
        .map(tauri::ipc::Response::new)
        .map_err(|fail| fail.code().to_owned())
}

/// Whether the page may open the item `id` names (an address can name any):
/// only an id the engine returned for this mind in this session.
#[tauri::command]
pub async fn mnemos_place_item(window: Window, mind: String, id: String) -> Result<bool, String> {
    main_window(&window)?;
    Ok(place().admit(&mind, &id).await)
}

/// The place was left: its process ends.
#[tauri::command]
pub async fn close_mnemos_place(window: Window) -> Result<(), String> {
    main_window(&window)?;
    place().end().await;
    Ok(())
}

/// The window was shown or hidden. Hidden two minutes, the process ends.
#[tauri::command]
pub async fn mnemos_place_shown(window: Window, visible: bool) -> Result<(), String> {
    main_window(&window)?;
    place().shown(visible, HIDDEN_LIMIT);
    Ok(())
}

/// The app is exiting: the process ends now.
pub(crate) fn shut_down_mnemos_place() {
    place().end_now();
}

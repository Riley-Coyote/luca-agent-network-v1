//! Owner-facing commands for a resident's agent folder.
//!
//! Three commands, matching `shared/api/tauriResidentDocuments.ts`: list the
//! folder, read one document, write one document. The store itself
//! ([`crate::luca::resident_documents`]) holds the file rules; this layer owns
//! the authority checks and keeps `ManagedAgentRecord.documents_hash` in step
//! with the disk after every write.

use tauri::{AppHandle, Emitter as _, State};

use luca_protocol::Hex64;

use crate::{
    app_state::AppState,
    luca::resident_documents::{
        self, DocumentContent, DocumentTarget, DocumentWriter, DocumentsInspector, WriteReceipt,
    },
    managed_agents::{load_managed_agents, save_managed_agents, BackendKind, ManagedAgentRecord},
};

/// Resolve a resident this workspace is actually allowed to speak for.
///
/// Deliberately mirrors `continuity::resident_authority` rather than calling
/// it: the two surfaces answer to the same owner but guard different stores,
/// and a shared helper would couple the folder to continuity's lifecycle.
fn resident_authority(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
) -> Result<ManagedAgentRecord, String> {
    let resident = Hex64::parse(resident_pubkey.trim().to_ascii_lowercase())
        .map_err(|_| "invalid resident identity".to_owned())?;
    let owner = Hex64::parse(state.signing_keys()?.public_key().to_hex())
        .map_err(|_| "invalid owner identity".to_owned())?;
    if resident == owner {
        return Err("owner identity is not a resident documents namespace".into());
    }
    load_managed_agents(app)?
        .into_iter()
        .find(|record| record.pubkey.eq_ignore_ascii_case(resident.as_str()))
        .ok_or_else(|| "resident is not managed by this Luca workspace".into())
}

/// Writes additionally require a local resident: a provider-backed agent runs
/// somewhere else, and its documents are not ours to author.
fn writable_resident(
    app: &AppHandle,
    state: &AppState,
    resident_pubkey: &str,
) -> Result<ManagedAgentRecord, String> {
    let record = resident_authority(app, state, resident_pubkey)?;
    if record.backend != BackendKind::Local {
        return Err("resident documents are editable only for local residents".into());
    }
    Ok(record)
}

#[tauri::command]
/// List one resident's agent folder: every document slot, every extra file,
/// and the folder hash.
pub fn list_resident_documents(
    resident_pubkey: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentsInspector, String> {
    let record = resident_authority(&app, &state, &resident_pubkey)?;
    // A native resident's documents are the runtime's own files, in place.
    if let Some(layout) = resident_documents::native_layout_for(Some(&record)) {
        return resident_documents::native::inspect(&layout, &record.pubkey);
    }
    let dir = resident_documents::resident_dir(&app, &record.pubkey)?;
    resident_documents::inspect(&dir, &record.pubkey)
}

#[tauri::command]
/// Read one document. A document that does not exist reads as empty with a
/// `null` hash — the value the editor passes back to create it.
pub fn read_resident_document(
    resident_pubkey: String,
    target: DocumentTarget,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DocumentContent, String> {
    let record = resident_authority(&app, &state, &resident_pubkey)?;
    if let Some(layout) = resident_documents::native_layout_for(Some(&record)) {
        return resident_documents::native::read(&layout, target);
    }
    let dir = resident_documents::resident_dir(&app, &record.pubkey)?;
    resident_documents::read(&dir, target)
}

#[tauri::command]
/// Write one document, then re-stamp the record's `documents_hash`.
///
/// `expected_hash` is the hash the editor loaded (`null` for a document that
/// did not exist). A mismatch fails with `document_conflict:<current_hash>`
/// so the editor can offer to reload rather than overwrite silently.
pub fn write_resident_document(
    resident_pubkey: String,
    target: DocumentTarget,
    content: String,
    expected_hash: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WriteReceipt, String> {
    let record = writable_resident(&app, &state, &resident_pubkey)?;
    let dir = resident_documents::ensure_resident_dir(&app, &record.pubkey)?;
    // The owner is the one editing from the desktop; the resident's own
    // writes arrive through its runtime, not this command. A native
    // resident's write lands in the runtime's file, journalled in our folder.
    let receipt = match resident_documents::native_layout_for(Some(&record)) {
        Some(layout) => resident_documents::native::write(
            &layout,
            &dir,
            target,
            &content,
            expected_hash.as_deref(),
            DocumentWriter::Owner,
        )?,
        None => resident_documents::write(
            &dir,
            target,
            &content,
            expected_hash.as_deref(),
            DocumentWriter::Owner,
        )?,
    };
    stamp_documents_hash(&app, &state, &record.pubkey)?;
    Ok(receipt)
}

/// Re-read the folder and persist its hash onto the record, under the
/// managed-agents store lock so a concurrent `update_managed_agent` cannot
/// lose the stamp.
///
/// The record is re-loaded rather than reusing the copy the authority check
/// returned: that copy predates the write and may predate another writer's
/// edits to unrelated fields.
fn stamp_documents_hash(app: &AppHandle, state: &AppState, pubkey: &str) -> Result<(), String> {
    let _store_guard = state
        .managed_agents_store_lock
        .lock()
        .map_err(|error| error.to_string())?;
    let mut records = load_managed_agents(app)?;
    let Some(record) = records
        .iter_mut()
        .find(|record| record.pubkey.eq_ignore_ascii_case(pubkey))
    else {
        return Ok(());
    };
    if resident_documents::refresh_documents_hash(app, record)? {
        record.updated_at = crate::util::now_iso();
        save_managed_agents(app, &records)?;
    }
    drop(_store_guard);
    let _ = app.emit("agents-data-changed", ());
    Ok(())
}

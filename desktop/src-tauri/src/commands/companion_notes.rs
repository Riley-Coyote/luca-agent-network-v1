//! One explicitly permitted source-derived note, staged until the actual reply
//! is accepted. No note body enters a receipt, log or a separate memory store.
use crate::{
    app_state::AppState,
    luca::{
        companion_awareness::{
            source_runtime::preload_retained_source_facts, AwarenessGrantKeyV1,
            AwarenessHostFactsV1, AwarenessSourceKeyV1,
            LiveAwarenessOwner,
        },
        continuity_jobs::{current_canonical_timestamp, with_enabled_goal_retention},
        managed_dispatch_store::{
            global_dispatch_store, ManagedTurnAwarenessBindingV1, ManagedTurnAwarenessLookupV1,
        },
        resident_notebook::source_notes::{
            self, SourceNoteCommitRequestV1, SourceNoteErrorV1, SourceNoteSealV1,
        },
        resident_proposals::{verify_origin, ResidentProposalScope},
    },
};
use luca_protocol::{
    AwarenessMaterialStateV1, AwarenessUseV1, Hex64, OpaqueId, ResidentContinuityModeV1,
    ResidentMemoryNoteCategoryV1, ResidentMemoryNoteV1, Sha256Ref, CONTINUITY_PROTOCOL,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::atomic::Ordering,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteDraft {
    category: ResidentMemoryNoteCategoryV1,
    body: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    action: String,
    #[serde(default)]
    harnesses: Vec<String>,
    note: NoteDraft,
}
struct Pending {
    binding: ManagedTurnAwarenessBindingV1,
    draft: NoteDraft,
    id: OpaqueId,
    expires: u64,
}
impl Drop for Pending {
    fn drop(&mut self) {
        self.draft.body.zeroize();
    }
}
// This bounded ephemeral staging queue is NOT durable memory. Unsaved drafts
// disappear on restart; the receipt never claims otherwise.
static PENDING: OnceLock<Mutex<BTreeMap<String, Pending>>> = OnceLock::new();
static RECEIPTS: OnceLock<Mutex<BTreeMap<String, Value>>> = OnceLock::new();
fn pending() -> &'static Mutex<BTreeMap<String, Pending>> {
    PENDING.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn receipts() -> &'static Mutex<BTreeMap<String, Value>> {
    RECEIPTS.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn key(owner: &Hex64, resident: &Hex64, event: &Hex64) -> String {
    format!(
        "{}:{}:{}",
        owner.as_str(),
        resident.as_str(),
        event.as_str()
    )
}
fn now_secs() -> u64 {
    chrono::Utc::now().timestamp().max(0) as u64
}
fn unavailable() -> String {
    "The note could not be retained under current conversation, source or memory permissions."
        .into()
}

pub(super) fn configure(
    app: &AppHandle,
    scope: ResidentProposalScope,
    arguments: Value,
    mut cancelled: impl FnMut() -> bool,
) -> Result<String, String> {
    let request: Request =
        serde_json::from_value(arguments).map_err(|_| "Invalid note request.")?;
    if request.action != "remember_note" || !request.harnesses.is_empty() || cancelled() {
        return Err("A note cannot configure harnesses.".into());
    }
    validate_body(&request.note.body)?;
    verify_origin(app, &scope)?;
    let state = app.state::<AppState>();
    if crate::luca::continuity_jobs::continuity_mode(app, &scope.owner, &scope.resident)?
        != ResidentContinuityModeV1::Enabled
    {
        return Err("Memory is disabled or unavailable; it was left unchanged.".into());
    }
    let dispatches = global_dispatch_store(app)?;
    let binding = {
        let store = dispatches.lock().map_err(|_| unavailable())?;
        let active = store
            .resolve_unique_cancellable(
                scope.owner.as_str(),
                scope.conversation.as_str(),
                scope.resident.as_str(),
            )
            .map_err(|_| unavailable())?;
        let trigger = Hex64::parse(active.dispatch_receipt_id).map_err(|_| unavailable())?;
        let checked = store
            .recheck_communication_turn(
                trigger.as_str(),
                scope.resident.as_str(),
                scope.conversation.as_str(),
                scope.session_epoch.get(),
                now_secs(),
            )
            .map_err(|_| unavailable())?;
        if checked.owner_pubkey != scope.owner.as_str() || checked.descendant_depth != 0 {
            return Err(unavailable());
        }
        let ManagedTurnAwarenessLookupV1::Bound(binding) = store.turn_awareness_context(
            &scope.owner,
            &scope.resident,
            &scope.conversation,
            &trigger,
        ) else {
            return Err(
                "This turn has no source-linked context to retain as a companion note.".into(),
            );
        };
        if binding.observations.is_empty()
            || binding.observations.len() > 4
            || binding.context_nodes.is_empty()
            || binding.binding_ref.as_ref() != Some(&scope.binding)
            || binding.session_epoch != Some(scope.session_epoch)
        {
            return Err(unavailable());
        }
        binding
    };
    check_note_consent(
        &state,
        &scope.owner,
        &scope.resident,
        &scope.binding,
        &binding,
    )?;
    let material = preload_retained_source_facts(
        &state,
        &scope.owner,
        &scope.resident,
        &current_canonical_timestamp()?,
    )
    .map_err(|_| unavailable())?;
    let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| unavailable())?;
    if live.owner() != &scope.owner {
        return Err(unavailable());
    }
    let now = current_canonical_timestamp()?;
    let facts = AwarenessHostFactsV1 {
        owner_pubkey: &scope.owner,
        resident_pubkey: &scope.resident,
        now: &now,
        source_fresh: false,
        material_state: AwarenessMaterialStateV1::Unavailable,
    };
    for parent in &binding.context_nodes {
        state
            .companion_awareness
            .with_dependency(
                &live,
                parent,
                &facts,
                AwarenessUseV1 {
                    promote: true,
                    provider_egress_binding: Some(&scope.binding),
                    ..Default::default()
                },
                |reference, retained| material.resolve(reference, retained),
                || (),
            )
            .map_err(|_| unavailable())?;
    }
    verify_origin(app, &scope)?;
    if cancelled() || !scope.active.load(Ordering::SeqCst) {
        return Err(unavailable());
    }
    let id = source_notes::note_id(
        &scope.owner,
        &scope.resident,
        request.note.category,
        &request.note.body,
    )
    .map_err(|_| unavailable())?;
    let mut queue = pending().lock().map_err(|_| unavailable())?;
    queue.retain(|_, value| value.expires > now_secs());
    let slot = key(&scope.owner, &scope.resident, &binding.trigger_event_id);
    if let Some(old) = queue.get(&slot) {
        if old.id != id {
            return Err("Only one compact note can be proposed per reply.".into());
        }
        return Ok(json!({"status":"already_pending","memorySaved":false,"noteId":id,
            "message":"This note is still pending the actual accepted reply; it has not been saved."}).to_string());
    }
    if queue.len() >= 64 {
        return Err("The local note staging limit was reached; no note was saved.".into());
    }
    queue.insert(
        slot,
        Pending {
            binding: *binding,
            draft: request.note,
            id: id.clone(),
            expires: now_secs() + 1800,
        },
    );
    Ok(json!({"status":"pending_final","memorySaved":false,"noteId":id,
        "message":"The note is proposed, not saved. It may be retained only after this exact reply is accepted and all source/memory permissions remain valid. Do not claim it is remembered yet."}).to_string())
}

fn validate_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty()
        || body.len() > 1024
        || body
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("Use one plain-text note of 1–1024 UTF-8 bytes.".into());
    }
    let (_, secrets) =
        luca_diagnostics::redact_classes(body, &[luca_diagnostics::SensitiveClass::Secret]);
    if secrets.secret_count > 0 {
        return Err("Credentials cannot be retained as a companion note.".into());
    }
    Ok(())
}

fn check_note_consent(
    state: &AppState,
    owner: &Hex64,
    resident: &Hex64,
    binding: &Sha256Ref,
    context: &ManagedTurnAwarenessBindingV1,
) -> Result<(), String> {
    for reference in &context.observations {
        let key = AwarenessGrantKeyV1 {
            source: AwarenessSourceKeyV1 {
                owner_pubkey: owner.clone(),
                source_id: reference.source_id.clone(),
                device_id: reference.device_id.clone(),
            },
            resident_pubkey: resident.clone(),
        };
        state
            .companion_awareness
            .recheck_semantic_note_choice(owner, &key, binding)
            .map_err(|_| unavailable())?;
    }
    Ok(())
}

/// Called ONLY for an accepted, persisted exact resident final. This deliberately
/// does not relax ordinary source-tainted automatic handoff/carry restrictions.
pub(crate) fn finish_final(
    app: &AppHandle,
    owner: &Hex64,
    resident: &Hex64,
    final_event: &Hex64,
    binding: &Sha256Ref,
) {
    let Some(context) = global_dispatch_store(app).ok().and_then(|store| {
        store.lock().ok().and_then(|store| {
            match store.final_event_awareness_context(owner, resident, final_event) {
                ManagedTurnAwarenessLookupV1::Bound(context) => Some(context),
                _ => None,
            }
        })
    }) else {
        return;
    };
    let slot = key(owner, resident, &context.trigger_event_id);
    let Some(pending) = pending()
        .lock()
        .ok()
        .and_then(|mut queue| queue.remove(&slot))
    else {
        return;
    };
    let saved = finish(
        app,
        owner,
        resident,
        final_event,
        binding,
        &context,
        pending,
    );
    let value = match saved {
        Ok(receipt) => json!({"status":if receipt.replayed {"already_retained"} else {"saved"},
            "memorySaved":!receipt.replayed,"noteId":receipt.lineage_root_id,"revision":receipt.revision,
            "message":"A source-linked semantic note was retained only after accepted reply and current permission checks."}),
        Err(_) => {
            json!({"status":"not_saved","memorySaved":false,"message":"The proposed note was not retained because its turn, source or memory permissions changed."})
        }
    };
    if let Ok(mut list) = receipts().lock() {
        if list.len() >= 64 {
            if let Some(old) = list.keys().next().cloned() {
                list.remove(&old);
            }
        }
        list.insert(format!("{}:{}", owner.as_str(), resident.as_str()), value);
    }
}

fn finish(
    app: &AppHandle,
    owner: &Hex64,
    resident: &Hex64,
    final_event: &Hex64,
    binding: &Sha256Ref,
    current: &ManagedTurnAwarenessBindingV1,
    pending: Pending,
) -> Result<crate::luca::resident_notebook::ResidentNotebookCommitReceiptV1, String> {
    if pending.expires <= now_secs()
        || pending.binding != *current
        || current.binding_ref.as_ref() != Some(binding)
    {
        return Err(unavailable());
    }
    let state = app.state::<AppState>();
    check_note_consent(&state, owner, resident, binding, current)?;
    let now = current_canonical_timestamp()?;
    let material =
        preload_retained_source_facts(&state, owner, resident, &now).map_err(|_| unavailable())?;
    with_enabled_goal_retention(app, owner, resident, || {
        let live = LiveAwarenessOwner::authenticate(&state).map_err(|_| unavailable())?;
        if live.owner() != owner
            || crate::luca::managed_cognition::active_binding_ref(resident)
                .ok()
                .as_ref()
                != Some(binding)
        {
            return Err(unavailable());
        }
        let lease = live.lease().map_err(|_| unavailable())?;
        let hash = pending
            .id
            .as_str()
            .strip_prefix(source_notes::SOURCE_NOTE_PREFIX)
            .ok_or_else(unavailable)?;
        let mut parents = current.context_nodes.clone();
        parents.sort();
        parents.dedup();
        let seal = SourceNoteSealV1 {
            protocol: "polyphonic.source-note-seal.v1".into(),
            owner_pubkey: owner.clone(),
            resident_pubkey: resident.clone(),
            lineage_root_id: pending.id.clone(),
            node: OpaqueId::parse(format!("{}{hash}", source_notes::SOURCE_NOTE_NODE_PREFIX))
                .map_err(|_| unavailable())?,
            parents,
            observations: current.observations.clone(),
        };
        let note = ResidentMemoryNoteV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            note_id: pending.id.clone(),
            category: pending.draft.category,
            body: pending.draft.body.clone(),
            source_event_ids: vec![final_event.clone()],
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        let request = SourceNoteCommitRequestV1 {
            owner_pubkey: owner.clone(),
            resident_pubkey: resident.clone(),
            request_id: OpaqueId::parse(format!("source-note-final-{}", final_event.as_str()))
                .map_err(|_| unavailable())?,
            note,
            seal: seal.clone(),
        };
        state
            .commit_resident_source_note(request, |commit| {
                let facts = AwarenessHostFactsV1 {
                    owner_pubkey: owner,
                    resident_pubkey: resident,
                    now: &now,
                    source_fresh: false,
                    material_state: AwarenessMaterialStateV1::Unavailable,
                };
                state
                    .companion_awareness
                    .with_semantic_note_promotion_lease(
                        &lease,
                        &seal,
                        binding,
                        &facts,
                        |reference, retained| material.resolve(reference, retained),
                        || {
                            commit().map_err(|_| {
                                crate::luca::companion_awareness::AwarenessStoreError::Invalid
                            })
                        },
                    )
                    .map_err(|_| SourceNoteErrorV1::Denied)?
                    .map_err(|_| SourceNoteErrorV1::Denied)
            })
            .map_err(|_| unavailable())
    })?
    .ok_or_else(unavailable)
}

pub(crate) fn status(owner: &Hex64, resident: &Hex64) -> Option<Value> {
    receipts()
        .lock()
        .ok()?
        .get(&format!("{}:{}", owner.as_str(), resident.as_str()))
        .cloned()
}

/// Denial-only control: discard unsaved drafts without touching observations.
pub(crate) fn cancel_pending_notes(owner: &Hex64, resident: &Hex64) {
    let prefix = format!("{}:{}:", owner.as_str(), resident.as_str());
    if let Ok(mut queue) = pending().lock() {
        queue.retain(|key, _| !key.starts_with(&prefix));
    }
    if let Ok(mut values) = receipts().lock() {
        values.remove(&format!("{}:{}", owner.as_str(), resident.as_str()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_note_draft_has_no_authority_or_source_selectors() {
        let valid = json!({"action":"remember_note","note":{"category":"durable_context","body":"Keep one shared build cache."}});
        assert!(serde_json::from_value::<Request>(valid.clone()).is_ok());
        for field in [
            "owner_pubkey",
            "resident_pubkey",
            "source_id",
            "path",
            "noteId",
            "seal",
        ] {
            let mut forged = valid.clone();
            forged[field] = json!("model-claimed-authority");
            assert!(
                serde_json::from_value::<Request>(forged).is_err(),
                "{field}"
            );
            let mut forged = valid.clone();
            forged["note"][field] = json!("model-claimed-authority");
            assert!(
                serde_json::from_value::<Request>(forged).is_err(),
                "note.{field}"
            );
        }
    }

    #[test]
    fn source_note_draft_is_compact_plain_text() {
        assert!(validate_body("A durable, useful decision.").is_ok());
        assert!(validate_body("").is_err());
        assert!(validate_body(" \n\t").is_err());
        assert!(validate_body(&"x".repeat(1025)).is_err());
        assert!(validate_body("hidden\u{0001}control").is_err());
        assert!(validate_body(&"é".repeat(513)).is_err());
    }
}

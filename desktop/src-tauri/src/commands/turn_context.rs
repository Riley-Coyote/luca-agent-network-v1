//! Owner-scoped, body-free inspection of context delivered to one exact turn.

use luca_protocol::{ContinuityLayerStatusV1, Hex64, OpaqueId, Sha256Ref};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    luca::{
        conversation_context::active_scope,
        managed_dispatch_store::{
            global_dispatch_store, ManagedTurnContextReceiptLookupV1, ManagedTurnContextReceiptV1,
            ManagedTurnSessionContextStatusV1,
        },
    },
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedTurnContextReceiptInputV1 {
    conversation_id: String,
    resident_pubkey: String,
    dispatch_receipt_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedTurnContextReceiptViewV1 {
    availability: &'static str,
    unavailable_reason: Option<&'static str>,
    attachment: Option<ManagedTurnContextAttachmentViewV1>,
    session_context: Option<ManagedTurnSessionContextViewV1>,
    continuity: Option<ManagedTurnContinuityViewV1>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedTurnContextAttachmentViewV1 {
    snapshot_ref: String,
    revision: u64,
    source_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedTurnSessionContextViewV1 {
    status: &'static str,
    delivered_to_acp: bool,
    attached_session_reference_delivered: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedTurnContinuityViewV1 {
    status: &'static str,
    layer_statuses: Vec<&'static str>,
    delivered_to_acp: bool,
}

#[tauri::command]
/// Return exact-turn delivery evidence without reading current source state,
/// decrypting bodies, or resolving paths. Delivery is to managed ACP only.
pub fn get_managed_turn_context_receipt(
    input: ManagedTurnContextReceiptInputV1,
    app: AppHandle,
) -> Result<ManagedTurnContextReceiptViewV1, String> {
    let state = app.state::<AppState>();
    let (owner, relay_scope) = active_scope(&state)?;
    let relay_scope = Sha256Ref::parse(relay_scope)
        .map_err(|_| "active community scope is invalid".to_owned())?;
    let resident = Hex64::parse(input.resident_pubkey.trim().to_ascii_lowercase())
        .map_err(|_| "invalid resident identity".to_owned())?;
    let dispatch = Hex64::parse(input.dispatch_receipt_id.trim().to_ascii_lowercase())
        .map_err(|_| "invalid dispatch receipt identity".to_owned())?;
    let conversation = OpaqueId::parse(input.conversation_id.clone())
        .map_err(|_| "invalid conversation identity".to_owned())?;

    let store = global_dispatch_store(&app)?;
    let lookup = store
        .lock()
        .map_err(|_| "managed dispatch store is locked".to_owned())?
        .turn_context_receipt(
            owner.as_str(),
            &relay_scope,
            resident.as_str(),
            conversation.as_str(),
            dispatch.as_str(),
        );
    Ok(match lookup {
        ManagedTurnContextReceiptLookupV1::Available(receipt) => receipt_view(receipt),
        ManagedTurnContextReceiptLookupV1::MissingDispatch => unavailable("missing_dispatch"),
        ManagedTurnContextReceiptLookupV1::WrongScope => unavailable("wrong_scope"),
        ManagedTurnContextReceiptLookupV1::NotAttached => unavailable("not_attached"),
        ManagedTurnContextReceiptLookupV1::NotDelivered => unavailable("not_delivered"),
    })
}

fn unavailable(reason: &'static str) -> ManagedTurnContextReceiptViewV1 {
    ManagedTurnContextReceiptViewV1 {
        availability: "unavailable",
        unavailable_reason: Some(reason),
        attachment: None,
        session_context: None,
        continuity: None,
    }
}

fn receipt_view(receipt: ManagedTurnContextReceiptV1) -> ManagedTurnContextReceiptViewV1 {
    let attachment = ManagedTurnContextAttachmentViewV1 {
        snapshot_ref: receipt.snapshot_ref.as_str().to_owned(),
        revision: receipt.revision.get(),
        source_ids: receipt
            .selected_source_ids
            .into_iter()
            .map(|source| source.as_str().to_owned())
            .collect(),
    };
    let session_context = receipt
        .session_context
        .map(|context| ManagedTurnSessionContextViewV1 {
            status: session_context_status(context.status),
            delivered_to_acp: true,
            attached_session_reference_delivered: context.attached_session_reference_delivered,
        });
    let continuity = receipt
        .continuity
        .map(|continuity| ManagedTurnContinuityViewV1 {
            status: layer_status(continuity.status),
            layer_statuses: continuity
                .layer_statuses
                .into_iter()
                .map(layer_status)
                .collect(),
            delivered_to_acp: true,
        });
    ManagedTurnContextReceiptViewV1 {
        availability: "available",
        unavailable_reason: None,
        attachment: Some(attachment),
        session_context,
        continuity,
    }
}

fn session_context_status(status: ManagedTurnSessionContextStatusV1) -> &'static str {
    match status {
        ManagedTurnSessionContextStatusV1::Ready => "ready",
        ManagedTurnSessionContextStatusV1::Degraded => "degraded",
    }
}

fn layer_status(status: ContinuityLayerStatusV1) -> &'static str {
    match status {
        ContinuityLayerStatusV1::Ready => "ready",
        ContinuityLayerStatusV1::Empty => "empty",
        ContinuityLayerStatusV1::Denied => "denied",
        ContinuityLayerStatusV1::Stale => "stale",
        ContinuityLayerStatusV1::Locked => "locked",
        ContinuityLayerStatusV1::Unavailable => "unavailable",
        ContinuityLayerStatusV1::Timeout => "timeout",
        ContinuityLayerStatusV1::Invalid => "invalid",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::luca::managed_dispatch_store::{
        ManagedTurnContinuityReceiptV1, ManagedTurnSessionContextReceiptV1,
    };

    #[test]
    fn receipt_projection_is_body_free_and_preserves_fixed_layer_order() {
        let receipt = ManagedTurnContextReceiptV1 {
            relay_scope: Sha256Ref::parse(format!("sha256:{}", "1".repeat(64)))
                .expect("relay scope"),
            snapshot_ref: Sha256Ref::parse(format!("sha256:{}", "2".repeat(64)))
                .expect("snapshot ref"),
            revision: luca_protocol::SafeU53::new(7).expect("revision"),
            selected_source_ids: vec![OpaqueId::parse("source-a").expect("source")],
            session_context: Some(ManagedTurnSessionContextReceiptV1 {
                status: ManagedTurnSessionContextStatusV1::Ready,
                attached_session_reference_delivered: true,
            }),
            continuity: Some(ManagedTurnContinuityReceiptV1 {
                status: ContinuityLayerStatusV1::Ready,
                layer_statuses: [
                    ContinuityLayerStatusV1::Ready,
                    ContinuityLayerStatusV1::Empty,
                    ContinuityLayerStatusV1::Ready,
                    ContinuityLayerStatusV1::Empty,
                    ContinuityLayerStatusV1::Ready,
                ],
            }),
        };

        let value = serde_json::to_value(receipt_view(receipt)).expect("serialize view");
        assert_eq!(value["availability"], "available");
        assert_eq!(
            value["continuity"]["layerStatuses"],
            serde_json::json!(["ready", "empty", "ready", "empty", "ready"])
        );
        assert!(value.get("relayScope").is_none());
        assert!(value.get("body").is_none());
        assert!(value.get("path").is_none());
        assert!(value.get("title").is_none());
    }
}

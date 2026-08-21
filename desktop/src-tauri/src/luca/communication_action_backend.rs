//! Concrete trusted-desktop adapter for the Luca Communications broker.
//!
//! Resident-authored kind-9 sends retain their encrypted exact-event
//! publisher. COM-102 adds only host-authorized adapters over existing owner
//! DM, channel-create, and membership operations; all other operations still
//! fail closed with controlled body-free results.

use std::{collections::BTreeSet, path::PathBuf, sync::Arc, thread, time::Duration};

use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, CommunicationActionRequestV1,
    CommunicationApprovalBindingV1, CommunicationDestinationV1, CommunicationOperationV1, Hex64,
    ManagedPermissionOptionV1, ManagedPermissionRequestV1, OpaqueArtifactHandleV1, OpaqueId,
    SafeU53, COMMUNICATION_APPROVAL_PROTOCOL, MANAGED_PERMISSION_PROTOCOL,
};
use nostr::Keys;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use super::{
    communication_action_publisher::{
        CommunicationPublicationError, ExistingConversationPublisher,
    },
    communication_bridge::{
        BrokerFailure, CommunicationBrokerBackend, CommunicationConversationAuthority,
        CommunicationConversationQuery, CommunicationInboxQuery, CommunicationReadScope,
        CommunicationTurnAuthoritySnapshot, ManagedConversationMutation, StagedCommunicationAction,
    },
};

const MANAGED_ROOM_NAMESPACE: Uuid = uuid::uuid!("c20e259b-1685-5e1d-9141-55ea3320f9c2");
const MEMBERSHIP_RECONCILE_ATTEMPTS: usize = 6;
const MEMBERSHIP_RECONCILE_DELAY: Duration = Duration::from_millis(100);
const COMMUNICATION_ALLOW_ONCE: &str = "communication_allow_once";
const COMMUNICATION_REJECT: &str = "communication_reject";

fn protocol_artifact_handles(
    bindings: Vec<super::managed_dispatch_store::ManagedArtifactBinding>,
) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure> {
    bindings
        .into_iter()
        .map(|binding| {
            Ok(OpaqueArtifactHandleV1 {
                handle_id: OpaqueId::parse(binding.handle_id)
                    .map_err(|_| BrokerFailure::artifact_denied())?,
                content_sha256: Hex64::parse(binding.content_sha256)
                    .map_err(|_| BrokerFailure::artifact_denied())?,
                byte_length: SafeU53::new(binding.byte_length)
                    .map_err(|_| BrokerFailure::artifact_denied())?,
                media_type: binding.media_type,
                display_name: binding.display_name,
            })
        })
        .collect()
}

/// Trusted construction inputs supplied by the managed-runtime lifecycle.
///
/// The resident key never crosses the desktop process. Independent encrypted
/// outbox/vault passphrases are derived internally by the publisher.
pub(crate) struct DesktopCommunicationBackendConfig {
    pub(crate) app: AppHandle,
    pub(crate) resident_keys: Keys,
    pub(crate) session_epoch: SafeU53,
    pub(crate) resident_auth_tag: Option<String>,
    pub(crate) relay_url: String,
    pub(crate) installation_session_id: OpaqueId,
    pub(crate) outbox_path: PathBuf,
    pub(crate) vault_directory: PathBuf,
}

pub(crate) struct DesktopCommunicationActionBackend {
    app: AppHandle,
    resident_pubkey: Hex64,
    publisher: Arc<ExistingConversationPublisher>,
}

impl DesktopCommunicationActionBackend {
    pub(crate) fn open(
        config: DesktopCommunicationBackendConfig,
    ) -> Result<Arc<Self>, CommunicationPublicationError> {
        let resident_pubkey = Hex64::parse(config.resident_keys.public_key().to_hex())
            .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
        let app = config.app.clone();
        let publisher = ExistingConversationPublisher::open(
            config.app,
            config.resident_keys,
            config.session_epoch,
            config.resident_auth_tag,
            config.relay_url,
            config.installation_session_id,
            config.outbox_path,
            config.vault_directory,
        )?;
        Ok(Arc::new(Self {
            app,
            resident_pubkey,
            publisher,
        }))
    }

    pub(crate) fn broker_backend(self: &Arc<Self>) -> Arc<dyn CommunicationBrokerBackend> {
        self.clone()
    }

    /// Reconcile one frozen action before exposing this backend to an agent.
    /// Callers deliberately treat failure as communication-tool degradation;
    /// ordinary messaging and resident startup remain available.
    pub(crate) fn reconcile_one_on_start(&self) -> Result<(), CommunicationPublicationError> {
        self.publisher.reconcile_one_on_start()
    }

    fn require_scope(&self, scope: &CommunicationReadScope) -> Result<(), BrokerFailure> {
        if scope.resident_pubkey != self.resident_pubkey {
            return Err(BrokerFailure::custody_denied());
        }
        Ok(())
    }

    fn require_authority(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<(), BrokerFailure> {
        if authority.resident_pubkey != self.resident_pubkey {
            return Err(BrokerFailure::custody_denied());
        }
        Ok(())
    }

    fn canonical_authority(
        &self,
        conversation_id: &OpaqueId,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        let mut authority = self
            .publisher
            .membership(conversation_id)
            .map(|membership| membership.as_authority())
            .map_err(|_| BrokerFailure::membership_denied())?;
        // Direct mode permits a same-owner membership request. The relay still
        // enforces the owner/admin rule on the actual existing operation.
        authority.agent_may_invite_same_owner = true;
        Ok(authority)
    }

    fn wait_for_membership(
        &self,
        conversation_id: &OpaqueId,
        expected_participants: &BTreeSet<Hex64>,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        for attempt in 0..MEMBERSHIP_RECONCILE_ATTEMPTS {
            if let Ok(authority) = self.canonical_authority(conversation_id) {
                if &authority.participant_pubkeys == expected_participants {
                    return Ok(authority);
                }
            }
            if attempt + 1 < MEMBERSHIP_RECONCILE_ATTEMPTS {
                thread::sleep(MEMBERSHIP_RECONCILE_DELAY);
            }
        }
        Err(BrokerFailure::membership_partial())
    }

    fn add_room_member(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        participant_pubkey: &Hex64,
    ) -> Result<(), BrokerFailure> {
        super::communication_bridge::recheck_desktop_communication_authority(&self.app, authority)?;
        let state = self.app.state::<crate::app_state::AppState>();
        let result = tauri::async_runtime::block_on(crate::commands::add_channel_members(
            conversation_id.as_str().to_owned(),
            vec![participant_pubkey.as_str().to_owned()],
            Some("bot".to_owned()),
            state,
        ))
        .map_err(|_| BrokerFailure::managed_operation_failed())?;
        if result
            .get("errors")
            .and_then(Value::as_array)
            .is_some_and(|errors| !errors.is_empty())
        {
            return Err(BrokerFailure::membership_partial());
        }
        Ok(())
    }

    fn add_member_to_conversation(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        participant_pubkey: &Hex64,
    ) -> Result<OpaqueId, BrokerFailure> {
        super::communication_bridge::recheck_desktop_communication_authority(&self.app, authority)?;
        let state = self.app.state::<crate::app_state::AppState>();
        let details = tauri::async_runtime::block_on(crate::commands::get_channel_details(
            conversation_id.as_str().to_owned(),
            state,
        ))
        .map_err(|_| BrokerFailure::managed_operation_failed())?;
        if details.channel_type != "dm" {
            self.add_room_member(authority, conversation_id, participant_pubkey)?;
            return Ok(conversation_id.clone());
        }

        super::communication_bridge::recheck_desktop_communication_authority(&self.app, authority)?;
        let channel_id = Uuid::parse_str(conversation_id.as_str())
            .map_err(|_| BrokerFailure::invalid_arguments())?;
        let builder = buzz_sdk_pkg::build_dm_add_member(channel_id, participant_pubkey.as_str())
            .map_err(|_| BrokerFailure::invalid_arguments())?;
        let state = self.app.state::<crate::app_state::AppState>();
        let submitted = tauri::async_runtime::block_on(crate::relay::submit_event(builder, &state))
            .map_err(|_| BrokerFailure::managed_operation_failed())?;
        let ack: DmMembershipAck = crate::relay::parse_command_response(&submitted.message)
            .map_err(|_| BrokerFailure::managed_operation_failed())?;
        OpaqueId::parse(ack.channel_id).map_err(|_| BrokerFailure::managed_operation_failed())
    }
}

#[derive(Deserialize)]
struct DmMembershipAck {
    channel_id: String,
}

fn managed_room_uuid(
    authority: &CommunicationTurnAuthoritySnapshot,
    operation_request_id: &OpaqueId,
    label: &str,
    purpose: Option<&str>,
    participant_pubkeys: &BTreeSet<Hex64>,
) -> Result<Uuid, BrokerFailure> {
    let material = serde_json::json!({
        "domain": "luca.managed-private-room.v1",
        "owner": &authority.owner_pubkey,
        "resident": &authority.resident_pubkey,
        "session_epoch": authority.session_epoch,
        "binding_ref": &authority.runtime_binding_ref,
        "operation_request_id": operation_request_id,
        "label": label,
        "purpose": purpose,
        "participant_pubkeys": participant_pubkeys,
    });
    let digest = canonical_sha256(&material).map_err(|_| BrokerFailure::invalid_arguments())?;
    Ok(Uuid::new_v5(&MANAGED_ROOM_NAMESPACE, digest.as_bytes()))
}

impl CommunicationBrokerBackend for DesktopCommunicationActionBackend {
    fn read_inbox(
        &self,
        scope: &CommunicationReadScope,
        _query: &CommunicationInboxQuery,
    ) -> Result<Value, BrokerFailure> {
        self.require_scope(scope)?;
        Err(BrokerFailure::operation_not_implemented())
    }

    fn read_conversation(
        &self,
        scope: &CommunicationReadScope,
        _query: &CommunicationConversationQuery,
    ) -> Result<Value, BrokerFailure> {
        self.require_scope(scope)?;
        Err(BrokerFailure::operation_not_implemented())
    }

    fn conversation_authority(
        &self,
        scope: &CommunicationReadScope,
        conversation_id: &OpaqueId,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        self.require_scope(scope)?;
        self.canonical_authority(conversation_id)
    }

    fn resolve_direct_conversation(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure> {
        self.require_authority(authority)?;
        super::communication_bridge::recheck_desktop_communication_authority(&self.app, authority)?;
        let others = participant_pubkeys
            .iter()
            .filter(|pubkey| *pubkey != &authority.owner_pubkey)
            .map(|pubkey| pubkey.as_str().to_owned())
            .collect::<Vec<_>>();
        let state = self.app.state::<crate::app_state::AppState>();
        let channel = tauri::async_runtime::block_on(crate::commands::open_dm(others, state))
            .map_err(|_| BrokerFailure::managed_operation_failed())?;
        let conversation_id =
            OpaqueId::parse(channel.id).map_err(|_| BrokerFailure::managed_operation_failed())?;
        self.wait_for_membership(&conversation_id, participant_pubkeys)
    }

    fn resolve_owned_resident_name(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        requested_name: &str,
    ) -> Result<Hex64, BrokerFailure> {
        self.require_authority(authority)?;
        super::resident_registry::resolve_owned_resident_name(
            &self.app,
            &authority.owned_resident_pubkeys,
            requested_name,
        )
        .map_err(|error| match error {
            super::resident_registry::ResidentNameResolutionError::Invalid => {
                BrokerFailure::invalid_arguments()
            }
            super::resident_registry::ResidentNameResolutionError::Unavailable => {
                BrokerFailure::custody_unavailable()
            }
            super::resident_registry::ResidentNameResolutionError::NotFound => {
                BrokerFailure::resident_not_found()
            }
            super::resident_registry::ResidentNameResolutionError::Ambiguous => {
                BrokerFailure::resident_name_ambiguous()
            }
        })
    }

    fn create_private_room(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        label: &str,
        purpose: Option<&str>,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<ManagedConversationMutation, BrokerFailure> {
        self.require_authority(authority)?;
        let room_uuid = managed_room_uuid(
            authority,
            operation_request_id,
            label,
            purpose,
            participant_pubkeys,
        )?;
        super::communication_bridge::recheck_desktop_communication_authority(&self.app, authority)?;
        let state = self.app.state::<crate::app_state::AppState>();
        let channel = tauri::async_runtime::block_on(
            crate::commands::create_channel_with_exact_uuid(room_uuid, label, purpose, &state),
        )
        .map_err(|_| BrokerFailure::managed_operation_failed())?;
        let conversation_id =
            OpaqueId::parse(channel.id).map_err(|_| BrokerFailure::managed_operation_failed())?;

        for participant in participant_pubkeys {
            if participant != &authority.owner_pubkey {
                if self
                    .canonical_authority(&conversation_id)
                    .is_ok_and(|current| current.participant_pubkeys.contains(participant))
                {
                    continue;
                }
                self.add_room_member(authority, &conversation_id, participant)?;
            }
        }
        self.wait_for_membership(&conversation_id, participant_pubkeys)?;
        Ok(ManagedConversationMutation {
            conversation_id,
            state: "created_or_existing",
        })
    }

    fn invite_same_owner_resident(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        participant_pubkey: &Hex64,
    ) -> Result<ManagedConversationMutation, BrokerFailure> {
        self.require_authority(authority)?;
        let current = self.canonical_authority(conversation_id)?;
        let mut expected = current.participant_pubkeys;
        expected.insert(participant_pubkey.clone());
        let resolved_id =
            self.add_member_to_conversation(authority, conversation_id, participant_pubkey)?;
        self.wait_for_membership(&resolved_id, &expected)?;
        Ok(ManagedConversationMutation {
            conversation_id: resolved_id,
            state: "member_added_or_present",
        })
    }

    fn resolve_artifact_handles(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: Option<&OpaqueId>,
        handle_ids: &[OpaqueId],
    ) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure> {
        self.require_authority(authority)?;
        if handle_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conversation_id = conversation_id.ok_or_else(BrokerFailure::artifact_denied)?;
        if conversation_id != &authority.coordinates.source_conversation_id {
            return Err(BrokerFailure::artifact_denied());
        }
        let store = super::managed_dispatch_store::global_dispatch_store(&self.app)
            .map_err(|_| BrokerFailure::artifact_denied())?;
        let now = chrono::Utc::now().timestamp().max(0) as u64;
        let bindings = store
            .lock()
            .map_err(|_| BrokerFailure::artifact_denied())?
            .resolve_artifact_bindings(
                authority.coordinates.dispatch_receipt_id.as_str(),
                authority.resident_pubkey.as_str(),
                conversation_id.as_str(),
                authority.session_epoch.get(),
                handle_ids,
                now,
            )
            .map_err(|_| BrokerFailure::artifact_denied())?;
        protocol_artifact_handles(bindings)
    }

    fn require_event_in_conversation(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        event_id: &Hex64,
    ) -> Result<(), BrokerFailure> {
        self.require_authority(authority)?;
        self.publisher
            .require_event(conversation_id, event_id)
            .map_err(|_| BrokerFailure::membership_denied())
    }

    fn reaction_author(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        target_event_id: &Hex64,
        reaction_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        self.require_authority(authority)?;
        self.publisher
            .reaction_author(conversation_id, target_event_id, reaction_event_id)
            .map_err(|_| BrokerFailure::membership_denied())
    }

    fn message_author(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        message_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        self.require_authority(authority)?;
        self.publisher
            .message_author(conversation_id, message_event_id)
            .map_err(|_| BrokerFailure::membership_denied())
    }

    fn stage_action(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        self.require_authority(expected_authority)?;
        self.publisher
            .stage_and_publish(request, expected_authority)
    }

    fn approve_and_stage_action(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        self.require_authority(expected_authority)?;
        if !matches!(
            &request.operation,
            CommunicationOperationV1::DeleteOwnMessage { .. }
        ) || request.approval_id.is_none()
        {
            return Err(BrokerFailure::approval_required());
        }
        let decision = crate::luca::managed_permission::await_local_decision(
            &self.app,
            delete_permission_request(&request)?,
        );
        if decision.option_id.as_deref() != Some(COMMUNICATION_ALLOW_ONCE) {
            return Err(BrokerFailure::approval_denied());
        }

        // The decision is not durable authority. Recheck the exact active turn
        // after the owner responds, then bind the approval to this exact action.
        super::communication_bridge::recheck_desktop_communication_authority(
            &self.app,
            expected_authority,
        )?;
        let approved_at = canonical_now()?;
        let approval = exact_approval_binding(&request, approved_at.clone())?;
        approval
            .validate_request(&request, &approved_at)
            .map_err(|_| BrokerFailure::approval_denied())?;
        self.publisher
            .stage_approved_and_publish(request, &approval, expected_authority)
    }
}

fn delete_permission_request(
    request: &CommunicationActionRequestV1,
) -> Result<ManagedPermissionRequestV1, BrokerFailure> {
    if !matches!(
        &request.operation,
        CommunicationOperationV1::DeleteOwnMessage { .. }
    ) || request.approval_id.is_none()
    {
        return Err(BrokerFailure::approval_required());
    }
    let conversation_id = match &request.destination {
        CommunicationDestinationV1::ExistingConversation {
            conversation_id, ..
        } => conversation_id.clone(),
        _ => return Err(BrokerFailure::approval_required()),
    };
    Ok(ManagedPermissionRequestV1 {
        protocol: MANAGED_PERMISSION_PROTOCOL.into(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        turn_id: request.turn_id.clone(),
        conversation_id,
        acp_request_id: request.action_fingerprint.as_str().to_owned(),
        title: "Delete this resident-authored message?".into(),
        tool_call_id: None,
        options: vec![
            ManagedPermissionOptionV1 {
                option_id: COMMUNICATION_ALLOW_ONCE.into(),
                name: "Allow once".into(),
                kind: "allow_once".into(),
            },
            ManagedPermissionOptionV1 {
                option_id: COMMUNICATION_REJECT.into(),
                name: "Reject".into(),
                kind: "reject_once".into(),
            },
        ],
    })
}

fn canonical_now() -> Result<CanonicalTimestamp, BrokerFailure> {
    CanonicalTimestamp::parse(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .map_err(|_| BrokerFailure::approval_denied())
}

fn exact_approval_binding(
    request: &CommunicationActionRequestV1,
    approved_at: CanonicalTimestamp,
) -> Result<CommunicationApprovalBindingV1, BrokerFailure> {
    Ok(CommunicationApprovalBindingV1 {
        protocol: COMMUNICATION_APPROVAL_PROTOCOL.into(),
        approval_id: request
            .approval_id
            .clone()
            .ok_or_else(BrokerFailure::approval_required)?,
        action_id: request.action_id.clone(),
        action_fingerprint: request.action_fingerprint.clone(),
        content_ref: request
            .content_ref()
            .map_err(|_| BrokerFailure::approval_denied())?,
        artifact_set_ref: request
            .artifact_set_ref()
            .map_err(|_| BrokerFailure::approval_denied())?,
        destination_ref: request
            .destination_ref()
            .map_err(|_| BrokerFailure::approval_denied())?,
        participant_set_ref: request.destination.participant_set_ref().clone(),
        operation: request.operation.kind(),
        actor_pubkey: request.actor_pubkey.clone(),
        owner_pubkey: request.owner_pubkey.clone(),
        resident_pubkey: request.resident_pubkey.clone(),
        session_epoch: request.session_epoch,
        runtime_binding_ref: request.runtime_binding_ref.clone(),
        source_conversation_id: request.source_conversation_id.clone(),
        turn_id: request.turn_id.clone(),
        dispatch_receipt_id: request.dispatch_receipt_id.clone(),
        causal_root_id: request.causal_root_id.clone(),
        causal_parent_action_id: request.causal_parent_action_id.clone(),
        causal_depth: request.causal_depth,
        idempotency_key: request.idempotency_key.clone(),
        cancellation_epoch: request.cancellation_epoch,
        approved_at,
        expires_at: request.expires_at.clone(),
    })
}

#[cfg(test)]
#[path = "communication_action_backend_tests.rs"]
mod tests;

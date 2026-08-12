//! Concrete trusted-desktop adapter for the Luca Communications broker.
//!
//! This first vertical slice deliberately exposes only resident-authored
//! kind-9 sends into an existing owner-visible conversation. Every other read
//! or mutation fails closed with a controlled body-free result until its own
//! durable authority path is implemented.

use std::{path::PathBuf, sync::Arc};

use luca_protocol::{
    CommunicationActionRequestV1, Hex64, OpaqueArtifactHandleV1, OpaqueId, SafeU53,
};
use nostr::Keys;
use serde_json::Value;
use tauri::AppHandle;

use super::{
    communication_action_publisher::{
        CommunicationPublicationError, ExistingConversationPublisher,
    },
    communication_bridge::{
        BrokerFailure, CommunicationBrokerBackend, CommunicationConversationAuthority,
        CommunicationConversationQuery, CommunicationInboxQuery, CommunicationReadScope,
        CommunicationTurnAuthoritySnapshot, StagedCommunicationAction,
    },
};

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
    resident_pubkey: Hex64,
    publisher: Arc<ExistingConversationPublisher>,
}

impl DesktopCommunicationActionBackend {
    pub(crate) fn open(
        config: DesktopCommunicationBackendConfig,
    ) -> Result<Arc<Self>, CommunicationPublicationError> {
        let resident_pubkey = Hex64::parse(config.resident_keys.public_key().to_hex())
            .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
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
            resident_pubkey,
            publisher,
        }))
    }

    pub(crate) fn broker_backend(self: &Arc<Self>) -> Arc<dyn CommunicationBrokerBackend> {
        self.clone()
    }

    pub(crate) fn resident_pubkey(&self) -> &Hex64 {
        &self.resident_pubkey
    }

    /// Reconcile one frozen action before exposing this backend to an agent.
    /// Callers deliberately treat failure as communication-tool degradation;
    /// ordinary messaging and resident startup remain available.
    pub(crate) fn reconcile_one_on_start(
        &self,
    ) -> Result<(), CommunicationPublicationError> {
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
        self.publisher
            .membership(conversation_id)
            .map(|membership| membership.as_authority())
            .map_err(|_| BrokerFailure::membership_denied())
    }

    fn resolve_artifact_handles(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        _conversation_id: Option<&OpaqueId>,
        handle_ids: &[OpaqueId],
    ) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure> {
        self.require_authority(authority)?;
        if handle_ids.is_empty() {
            Ok(Vec::new())
        } else {
            Err(BrokerFailure::artifact_denied())
        }
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
        _conversation_id: &OpaqueId,
        _reaction_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure> {
        self.require_authority(authority)?;
        Err(BrokerFailure::operation_not_implemented())
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
}

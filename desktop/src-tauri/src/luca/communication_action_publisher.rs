//! Durable publisher for resident-authored communication actions.
//!
//! This publisher supports the approved resident-authored message, reaction,
//! remove-own-reaction, and own-message-edit operations in an existing
//! owner-visible conversation. Exact event bytes are encrypted in
//! `CommunicationEventVault`; the sibling encrypted outbox owns lifecycle and
//! retry state. No raw event or filesystem capability crosses the desktop
//! boundary.

use std::{
    collections::BTreeSet,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use age::secrecy::SecretString;
use buzz_core_pkg::kind::{EXPECTED_MEMBERSHIP_SNAPSHOT_VERSION, TAG_EXPECTED_MEMBERSHIP_SNAPSHOT};
use chrono::{DateTime, SecondsFormat, Utc};
use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, CommunicationActionOutboxStateV1,
    CommunicationActionRequestV1, CommunicationApprovalBindingV1, CommunicationDestinationV1,
    CommunicationOperationV1, Hex64, OpaqueId, SafeU53, Sha256Ref,
};
use nostr::{Event, EventId, JsonUtil, Keys, Kind, Tag, Timestamp};
use reqwest::{blocking::Client, Method, StatusCode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use uuid::Uuid;
use zeroize::Zeroize;

use super::{
    communication_action_outbox::{CommunicationActionOutbox, CommunicationActionRequestPreflight},
    communication_bridge::{
        recheck_desktop_communication_authority, BrokerFailure, CommunicationConversationAuthority,
        CommunicationTurnAuthoritySnapshot, StagedCommunicationAction,
    },
    communication_event_vault::{
        CommunicationEventVault, CommunicationEventVaultError, CommunicationEventVaultTerminal,
    },
    managed_dispatch_store::ManagedArtifactBinding,
};

const MESSAGE_KIND: u16 = 9;
const REACTION_KIND: u16 = 7;
const MEMBERSHIP_KIND: u16 = 39_002;
const MAX_RELAY_QUERY_EVENTS: usize = 64;
const RELAY_TIMEOUT_SECS: u64 = 12;
const OUTBOX_PASSPHRASE_DOMAIN: &[u8] = b"luca-communication-action-outbox-passphrase-v1\0";
const VAULT_PASSPHRASE_DOMAIN: &[u8] = b"luca-communication-event-vault-passphrase-v1\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommunicationPublicationError {
    InvalidRequest,
    Authority,
    Membership,
    Unsupported,
    RelayUnavailable,
    RelayRejected,
    Persistence,
}

impl CommunicationPublicationError {
    pub(crate) const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "communication-publication-invalid-request",
            Self::Authority => "communication-publication-authority",
            Self::Membership => "communication-publication-membership",
            Self::Unsupported => "communication-publication-unsupported",
            Self::RelayUnavailable => "communication-publication-relay-unavailable",
            Self::RelayRejected => "communication-publication-relay-rejected",
            Self::Persistence => "communication-publication-persistence",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ExistingConversationMembership {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) participant_pubkeys: BTreeSet<Hex64>,
    pub(crate) participant_set_version: SafeU53,
    pub(crate) participant_set_ref: Sha256Ref,
    membership_event_id: Hex64,
}

impl ExistingConversationMembership {
    pub(crate) fn as_authority(&self) -> CommunicationConversationAuthority {
        CommunicationConversationAuthority {
            conversation_id: self.conversation_id.clone(),
            participant_pubkeys: self.participant_pubkeys.clone(),
            participant_set_version: self.participant_set_version,
            agent_may_invite_same_owner: false,
            read_only: false,
        }
    }
}

pub(crate) struct CommunicationStoragePassphrases {
    pub(crate) outbox: SecretString,
    pub(crate) vault: SecretString,
}

/// Derive independent store passphrases without exposing the resident nsec.
pub(crate) fn derive_communication_storage_passphrases(
    resident_keys: &Keys,
) -> Result<CommunicationStoragePassphrases, CommunicationPublicationError> {
    let mut secret_hex = resident_keys.secret_key().to_secret_hex();
    let outbox = derive_passphrase(OUTBOX_PASSPHRASE_DOMAIN, secret_hex.as_bytes());
    let vault = derive_passphrase(VAULT_PASSPHRASE_DOMAIN, secret_hex.as_bytes());
    secret_hex.zeroize();
    Ok(CommunicationStoragePassphrases { outbox, vault })
}

fn derive_passphrase(domain: &[u8], secret: &[u8]) -> SecretString {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(secret);
    SecretString::from(hex::encode(hasher.finalize()))
}

pub(crate) trait CommunicationRelayTransport: Send + Sync + 'static {
    fn relay_self_pubkey(&self) -> &Hex64;
    fn query(
        &self,
        filters: &[serde_json::Value],
    ) -> Result<Vec<Event>, CommunicationPublicationError>;
    fn probe_exact(&self, signed_event_json: &str) -> ExactEventProbeOutcome;
    fn submit_exact(&self, signed_event_json: &str) -> RelaySubmitOutcome;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExactEventProbeOutcome {
    Present,
    Absent,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RelaySubmitOutcome {
    Accepted {
        event_id: Hex64,
        receipt_id: OpaqueId,
    },
    ExplicitlyRejected,
    Unknown,
}

struct HttpCommunicationRelay {
    client: Client,
    http_base_url: String,
    resident_keys: Keys,
    resident_auth_tag: Option<String>,
    relay_self_pubkey: Hex64,
}

impl HttpCommunicationRelay {
    fn new(
        relay_url: &str,
        resident_keys: Keys,
        resident_auth_tag: Option<String>,
    ) -> Result<Self, CommunicationPublicationError> {
        let http_base_url = crate::relay::relay_http_base_url(relay_url);
        if http_base_url.is_empty() {
            return Err(CommunicationPublicationError::InvalidRequest);
        }
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(RELAY_TIMEOUT_SECS))
            .build()
            .map_err(|_| CommunicationPublicationError::RelayUnavailable)?;
        let relay_self_pubkey = fetch_relay_self_pubkey(&client, &http_base_url)?;
        Ok(Self {
            client,
            http_base_url,
            resident_keys,
            resident_auth_tag,
            relay_self_pubkey,
        })
    }

    fn post_exact(
        &self,
        endpoint: &str,
        body: Vec<u8>,
    ) -> Result<reqwest::blocking::Response, CommunicationPublicationError> {
        let url = format!("{}{endpoint}", self.http_base_url);
        let auth = crate::relay::build_nip98_auth_header_for_keys(
            &self.resident_keys,
            &Method::POST,
            &url,
            &body,
        )
        .map_err(|_| CommunicationPublicationError::RelayUnavailable)?;
        let mut request = self
            .client
            .post(url)
            .header("Authorization", auth)
            .header("Content-Type", "application/json");
        if let Some(tag) = &self.resident_auth_tag {
            request = request.header("x-auth-tag", tag);
        }
        request
            .body(body)
            .send()
            .map_err(|_| CommunicationPublicationError::RelayUnavailable)
    }
}

impl CommunicationRelayTransport for HttpCommunicationRelay {
    fn relay_self_pubkey(&self) -> &Hex64 {
        &self.relay_self_pubkey
    }

    fn query(
        &self,
        filters: &[serde_json::Value],
    ) -> Result<Vec<Event>, CommunicationPublicationError> {
        let body = serde_json::to_vec(filters)
            .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
        let response = self.post_exact("/query", body)?;
        if !response.status().is_success() {
            return Err(CommunicationPublicationError::RelayUnavailable);
        }
        response
            .json::<Vec<Event>>()
            .map_err(|_| CommunicationPublicationError::RelayUnavailable)
    }

    fn probe_exact(&self, signed_event_json: &str) -> ExactEventProbeOutcome {
        let expected_event_id = match Event::from_json(signed_event_json) {
            Ok(event) => event.id.to_hex(),
            Err(_) => return ExactEventProbeOutcome::Unknown,
        };
        let response =
            match self.post_exact("/events?mode=probe", signed_event_json.as_bytes().to_vec()) {
                Ok(response) if response.status().is_success() => response,
                _ => return ExactEventProbeOutcome::Unknown,
            };
        let response = match response.json::<RelaySubmitResponse>() {
            Ok(response) if response.event_id.eq_ignore_ascii_case(&expected_event_id) => response,
            _ => return ExactEventProbeOutcome::Unknown,
        };
        if response.accepted && response.message.starts_with("duplicate:") {
            ExactEventProbeOutcome::Present
        } else if !response.accepted && response.message.starts_with("absent:") {
            ExactEventProbeOutcome::Absent
        } else {
            ExactEventProbeOutcome::Unknown
        }
    }

    fn submit_exact(&self, signed_event_json: &str) -> RelaySubmitOutcome {
        let response = match self.post_exact("/events", signed_event_json.as_bytes().to_vec()) {
            Ok(response) => response,
            Err(_) => return RelaySubmitOutcome::Unknown,
        };
        if response.status() == StatusCode::BAD_REQUEST {
            return RelaySubmitOutcome::ExplicitlyRejected;
        }
        if !response.status().is_success() {
            return RelaySubmitOutcome::Unknown;
        }
        let response = match response.json::<RelaySubmitResponse>() {
            Ok(response) => response,
            Err(_) => return RelaySubmitOutcome::Unknown,
        };
        if !response.accepted {
            return RelaySubmitOutcome::ExplicitlyRejected;
        }
        let Ok(event_id) = Hex64::parse(response.event_id.to_ascii_lowercase()) else {
            return RelaySubmitOutcome::Unknown;
        };
        let receipt_material = serde_json::json!({
            "domain": "luca.communication.relay-receipt.v1",
            "event_id": &event_id,
            "message_sha256": hex::encode(Sha256::digest(response.message.as_bytes())),
        });
        let Ok(digest) = canonical_sha256(&receipt_material) else {
            return RelaySubmitOutcome::Unknown;
        };
        let Ok(receipt_id) = OpaqueId::parse(format!("communication-relay-{digest}")) else {
            return RelaySubmitOutcome::Unknown;
        };
        RelaySubmitOutcome::Accepted {
            event_id,
            receipt_id,
        }
    }
}

#[derive(Deserialize)]
struct RelayInformationDocument {
    #[serde(default, rename = "self")]
    self_: Option<String>,
}

fn fetch_relay_self_pubkey(
    client: &Client,
    http_base_url: &str,
) -> Result<Hex64, CommunicationPublicationError> {
    let response = client
        .get(http_base_url)
        .header("Accept", "application/nostr+json")
        .send()
        .map_err(|_| CommunicationPublicationError::RelayUnavailable)?;
    if !response.status().is_success() {
        return Err(CommunicationPublicationError::RelayUnavailable);
    }
    let document = response
        .json::<RelayInformationDocument>()
        .map_err(|_| CommunicationPublicationError::RelayUnavailable)?;
    Hex64::parse(
        document
            .self_
            .ok_or(CommunicationPublicationError::RelayUnavailable)?
            .to_ascii_lowercase(),
    )
    .map_err(|_| CommunicationPublicationError::RelayUnavailable)
}

#[derive(Deserialize)]
struct RelaySubmitResponse {
    event_id: String,
    accepted: bool,
    #[serde(default)]
    message: String,
}

struct PublicationStores {
    outbox: CommunicationActionOutbox,
    vault: CommunicationEventVault,
}

pub(crate) struct ExistingConversationPublisher {
    app: Option<AppHandle>,
    resident_keys: Keys,
    current_session_epoch: SafeU53,
    installation_session_id: OpaqueId,
    relay: Arc<dyn CommunicationRelayTransport>,
    stores: Mutex<PublicationStores>,
    #[cfg(test)]
    test_dispatch_store: Option<Arc<Mutex<super::managed_dispatch_store::ManagedDispatchStore>>>,
}

impl ExistingConversationPublisher {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn open(
        app: AppHandle,
        resident_keys: Keys,
        current_session_epoch: SafeU53,
        resident_auth_tag: Option<String>,
        relay_url: String,
        installation_session_id: OpaqueId,
        outbox_path: PathBuf,
        vault_directory: PathBuf,
    ) -> Result<Arc<Self>, CommunicationPublicationError> {
        let resident_pubkey = Hex64::parse(resident_keys.public_key().to_hex())
            .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
        let passphrases = derive_communication_storage_passphrases(&resident_keys)?;
        let outbox = CommunicationActionOutbox::load_encrypted(
            installation_session_id.clone(),
            outbox_path,
            passphrases.outbox,
        )
        .map_err(|_| CommunicationPublicationError::Persistence)?;
        let vault =
            CommunicationEventVault::open(vault_directory, passphrases.vault, resident_pubkey)
                .map_err(|_| CommunicationPublicationError::Persistence)?;
        let relay = Arc::new(HttpCommunicationRelay::new(
            relay_url.as_str(),
            resident_keys.clone(),
            resident_auth_tag,
        )?);
        Ok(Arc::new(Self {
            app: Some(app),
            resident_keys,
            current_session_epoch,
            installation_session_id,
            relay,
            stores: Mutex::new(PublicationStores { outbox, vault }),
            #[cfg(test)]
            test_dispatch_store: None,
        }))
    }

    #[cfg(test)]
    pub(crate) fn relay_for_tests(
        resident_keys: Keys,
        current_session_epoch: SafeU53,
        installation_session_id: OpaqueId,
        outbox: CommunicationActionOutbox,
        vault: CommunicationEventVault,
        relay: Arc<dyn CommunicationRelayTransport>,
    ) -> Arc<Self> {
        Arc::new(Self {
            app: None,
            resident_keys,
            current_session_epoch,
            installation_session_id,
            relay,
            stores: Mutex::new(PublicationStores { outbox, vault }),
            test_dispatch_store: None,
        })
    }

    #[cfg(test)]
    fn relay_with_dispatch_for_tests(
        resident_keys: Keys,
        current_session_epoch: SafeU53,
        installation_session_id: OpaqueId,
        outbox: CommunicationActionOutbox,
        vault: CommunicationEventVault,
        relay: Arc<dyn CommunicationRelayTransport>,
        dispatch_store: Arc<Mutex<super::managed_dispatch_store::ManagedDispatchStore>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            app: None,
            resident_keys,
            current_session_epoch,
            installation_session_id,
            relay,
            stores: Mutex::new(PublicationStores { outbox, vault }),
            test_dispatch_store: Some(dispatch_store),
        })
    }

    fn active_dispatch_store(
        &self,
    ) -> Result<
        Option<Arc<Mutex<super::managed_dispatch_store::ManagedDispatchStore>>>,
        CommunicationPublicationError,
    > {
        if let Some(app) = &self.app {
            return super::managed_dispatch_store::global_dispatch_store(app)
                .map(Some)
                .map_err(|_| CommunicationPublicationError::Persistence);
        }
        #[cfg(test)]
        {
            return Ok(self.test_dispatch_store.clone());
        }
        #[cfg(not(test))]
        Ok(None)
    }

    pub(crate) fn membership(
        &self,
        conversation_id: &OpaqueId,
    ) -> Result<ExistingConversationMembership, CommunicationPublicationError> {
        query_membership(self.relay.as_ref(), conversation_id)
    }

    pub(crate) fn require_event(
        &self,
        conversation_id: &OpaqueId,
        event_id: &Hex64,
    ) -> Result<(), CommunicationPublicationError> {
        query_message(self.relay.as_ref(), conversation_id, event_id).map(|_| ())
    }

    pub(crate) fn reaction_author(
        &self,
        conversation_id: &OpaqueId,
        target_event_id: &Hex64,
        reaction_event_id: &Hex64,
    ) -> Result<Hex64, CommunicationPublicationError> {
        let event = query_reaction(
            self.relay.as_ref(),
            conversation_id,
            target_event_id,
            reaction_event_id,
        )?;
        Hex64::parse(event.pubkey.to_hex()).map_err(|_| CommunicationPublicationError::Membership)
    }

    pub(crate) fn message_author(
        &self,
        conversation_id: &OpaqueId,
        message_event_id: &Hex64,
    ) -> Result<Hex64, CommunicationPublicationError> {
        let event = query_message(self.relay.as_ref(), conversation_id, message_event_id)?;
        Hex64::parse(event.pubkey.to_hex()).map_err(|_| CommunicationPublicationError::Membership)
    }

    /// Reconcile at most one frozen action before exposing a new broker lease.
    ///
    /// A Prepared action from an older resident session is proven unsent and
    /// terminalized. Submitted or publication-unknown actions are first
    /// probed by exact event ID; relay absence retries only the already-frozen
    /// bytes. This path never creates or signs a new event.
    pub(crate) fn reconcile_one_on_start(&self) -> Result<(), CommunicationPublicationError> {
        // Terminal tombstones retain only this private, body-free cleanup
        // authority when a prior vault deletion could not be committed.
        if let Some(cleanup) = self
            .stores
            .lock()
            .map_err(|_| CommunicationPublicationError::Persistence)?
            .outbox
            .terminal_cleanup_entries()
            .into_iter()
            .next()
        {
            let mut stores = self
                .stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            cleanup_terminal_event(&mut stores, cleanup)?;
            return Ok(());
        }
        let entry = {
            let stores = self
                .stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            stores.outbox.reconciliation_entries().into_iter().next()
        };
        let Some(entry) = entry else {
            return Ok(());
        };
        let row = entry.row().clone();
        let request = row.request.clone();

        if row.state == CommunicationActionOutboxStateV1::Prepared {
            if request.session_epoch != self.current_session_epoch {
                let mut stores = self
                    .stores
                    .lock()
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                stores
                    .outbox
                    .fail_before_submission(&request.idempotency_key, now_timestamp()?)
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(&request)
                    .map_err(|_| CommunicationPublicationError::Persistence)?
                    .ok_or(CommunicationPublicationError::Persistence)?;
                cleanup_terminal_event(&mut stores, cleanup)?;
            }
            self.stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?
                .outbox
                .advance_reconcile_cursor(entry.created_order)
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            return Ok(());
        }

        if !matches!(
            row.state,
            CommunicationActionOutboxStateV1::Submitted
                | CommunicationActionOutboxStateV1::PublicationUnknown
        ) {
            return Ok(());
        }
        let conversation_id = existing_conversation_id(&request)?;
        let exact_json = {
            let stores = self
                .stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            stores
                .vault
                .load_exact(
                    &row.sealed_event_handle,
                    &request,
                    &row.expected_event_id,
                    &row.exact_event_sha256,
                )
                .map_err(|_| CommunicationPublicationError::Persistence)?
        };
        match self.relay.probe_exact(exact_json.as_str()) {
            ExactEventProbeOutcome::Present => {
                let mut stores = self
                    .stores
                    .lock()
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                stores
                    .outbox
                    .mark_accepted(
                        &request.idempotency_key,
                        row.expected_event_id.clone(),
                        reconciliation_receipt_id(&row.expected_event_id)?,
                        now_timestamp()?,
                    )
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(&request)
                    .map_err(|_| CommunicationPublicationError::Persistence)?
                    .ok_or(CommunicationPublicationError::Persistence)?;
                cleanup_terminal_event(&mut stores, cleanup)?;
                stores
                    .outbox
                    .advance_reconcile_cursor(entry.created_order)
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                return Ok(());
            }
            ExactEventProbeOutcome::Absent => {}
            ExactEventProbeOutcome::Unknown => {
                self.stores
                    .lock()
                    .map_err(|_| CommunicationPublicationError::Persistence)?
                    .outbox
                    .advance_reconcile_cursor(entry.created_order)
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                return Ok(());
            }
        }

        if request.session_epoch != self.current_session_epoch {
            let mut stores = self
                .stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            stores
                .outbox
                .cancel_after_proven_absence(&request.idempotency_key, now_timestamp()?)
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            let cleanup = stores
                .outbox
                .terminal_cleanup_for_request(&request)
                .map_err(|_| CommunicationPublicationError::Persistence)?
                .ok_or(CommunicationPublicationError::Persistence)?;
            cleanup_terminal_event(&mut stores, cleanup)?;
            stores
                .outbox
                .advance_reconcile_cursor(entry.created_order)
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            return Ok(());
        }

        let membership = self.membership(conversation_id)?;
        validate_restart_membership(&request, &membership)?;
        {
            let mut stores = self
                .stores
                .lock()
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            stores
                .outbox
                .mark_submitted(
                    &request.idempotency_key,
                    &self.installation_session_id,
                    request.cancellation_epoch.get(),
                    false,
                    now_timestamp()?,
                )
                .map_err(|_| CommunicationPublicationError::Persistence)?;
        }
        let activation_targets = request
            .operation
            .activation_pubkeys()
            .iter()
            .map(|pubkey| pubkey.as_str().to_owned())
            .collect::<Vec<_>>();
        let dispatch_store = if activation_targets.is_empty() {
            None
        } else {
            self.active_dispatch_store()?
        };
        let mut dispatch_guard = dispatch_store
            .as_ref()
            .map(|store| {
                store
                    .lock()
                    .map_err(|_| CommunicationPublicationError::Persistence)
            })
            .transpose()?;
        let staged_descendants = if let Some(guard) = dispatch_guard.as_mut() {
            let event = Event::from_json(exact_json.as_str())
                .map_err(|_| CommunicationPublicationError::Persistence)?;
            guard
                .stage_descendant_event(
                    &event,
                    request.owner_pubkey.as_str(),
                    request.dispatch_receipt_id.as_str(),
                    request.causal_root_id.as_str(),
                    request.action_id.as_str(),
                    &activation_targets,
                    unix_now()?,
                )
                .map_err(|_| CommunicationPublicationError::Persistence)?
        } else {
            Vec::new()
        };
        let outcome = self.relay.submit_exact(exact_json.as_str());
        let mut stores = self
            .stores
            .lock()
            .map_err(|_| CommunicationPublicationError::Persistence)?;
        match outcome {
            RelaySubmitOutcome::Accepted {
                event_id,
                receipt_id,
            } if event_id == row.expected_event_id => {
                stores
                    .outbox
                    .mark_accepted(
                        &request.idempotency_key,
                        event_id,
                        receipt_id,
                        now_timestamp()?,
                    )
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(&request)
                    .map_err(|_| CommunicationPublicationError::Persistence)?
                    .ok_or(CommunicationPublicationError::Persistence)?;
                cleanup_terminal_event(&mut stores, cleanup)?;
            }
            RelaySubmitOutcome::ExplicitlyRejected => {
                if let Some(guard) = dispatch_guard.as_mut() {
                    guard
                        .mark_rejected(&staged_descendants)
                        .map_err(|_| CommunicationPublicationError::Persistence)?;
                }
                stores
                    .outbox
                    .reject_during_reconciliation(&request.idempotency_key, now_timestamp()?)
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(&request)
                    .map_err(|_| CommunicationPublicationError::Persistence)?
                    .ok_or(CommunicationPublicationError::Persistence)?;
                cleanup_terminal_event(&mut stores, cleanup)?;
            }
            _ => {
                stores
                    .outbox
                    .mark_publication_unknown(&request.idempotency_key)
                    .map_err(|_| CommunicationPublicationError::Persistence)?;
            }
        }
        stores
            .outbox
            .advance_reconcile_cursor(entry.created_order)
            .map_err(|_| CommunicationPublicationError::Persistence)?;
        Ok(())
    }

    fn recheck_authority(
        &self,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<(), BrokerFailure> {
        if let Some(app) = &self.app {
            return recheck_desktop_communication_authority(app, expected_authority);
        }
        #[cfg(test)]
        {
            Ok(())
        }
        #[cfg(not(test))]
        {
            Err(BrokerFailure::authority_unavailable())
        }
    }

    fn resolve_private_artifact_bindings(
        &self,
        request: &CommunicationActionRequestV1,
        authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<Vec<ManagedArtifactBinding>, BrokerFailure> {
        let CommunicationOperationV1::SendMessage {
            artifact_handles, ..
        } = &request.operation
        else {
            return Ok(Vec::new());
        };
        if artifact_handles.is_empty() {
            return Ok(Vec::new());
        }
        let app = self
            .app
            .as_ref()
            .ok_or_else(BrokerFailure::artifact_denied)?;
        let CommunicationDestinationV1::ExistingConversation {
            conversation_id, ..
        } = &request.destination
        else {
            return Err(BrokerFailure::artifact_denied());
        };
        let ids = artifact_handles
            .iter()
            .map(|handle| handle.handle_id.clone())
            .collect::<Vec<_>>();
        let store = super::managed_dispatch_store::global_dispatch_store(app)
            .map_err(|_| BrokerFailure::artifact_denied())?;
        let bindings = store
            .lock()
            .map_err(|_| BrokerFailure::artifact_denied())?
            .resolve_artifact_bindings(
                authority.coordinates.dispatch_receipt_id.as_str(),
                authority.resident_pubkey.as_str(),
                conversation_id.as_str(),
                authority.session_epoch.get(),
                &ids,
                chrono::Utc::now().timestamp().max(0) as u64,
            )
            .map_err(|_| BrokerFailure::artifact_denied())?;
        let exact = artifact_handles
            .iter()
            .zip(&bindings)
            .all(|(handle, binding)| {
                handle.handle_id.as_str() == binding.handle_id
                    && handle.content_sha256.as_str() == binding.content_sha256
                    && handle.byte_length.get() == binding.byte_length
                    && handle.media_type == binding.media_type
                    && handle.display_name == binding.display_name
            });
        if !exact || bindings.len() != artifact_handles.len() {
            return Err(BrokerFailure::artifact_denied());
        }
        Ok(bindings)
    }

    pub(crate) fn stage_and_publish(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        validate_narrow_request(&request, expected_authority).map_err(map_publication_failure)?;
        self.stage_validated_request(request, expected_authority)
    }

    pub(crate) fn stage_approved_and_publish(
        &self,
        request: CommunicationActionRequestV1,
        approval: &CommunicationApprovalBindingV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        let now = now_timestamp().map_err(map_publication_failure)?;
        validate_approved_delete_request(&request, approval, expected_authority, &now)
            .map_err(map_publication_failure)?;
        self.stage_validated_request(request, expected_authority)
    }

    fn stage_validated_request(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure> {
        if self.resident_keys.public_key().to_hex() != expected_authority.resident_pubkey.as_str() {
            return Err(BrokerFailure::custody_denied());
        }

        self.recheck_authority(expected_authority)?;
        let durable_preflight = self
            .stores
            .lock()
            .map_err(|_| BrokerFailure::outbox_unavailable())?
            .outbox
            .preflight_request(&request)
            .map_err(|_| BrokerFailure::outbox_unavailable())?;
        if let Some(existing) = durable_preflight {
            return match existing {
                CommunicationActionRequestPreflight::Terminal(receipt)
                    if receipt.state == CommunicationActionOutboxStateV1::Accepted =>
                {
                    self.retry_terminal_cleanup_for_request(&request)?;
                    Ok(staged(&request, "accepted"))
                }
                CommunicationActionRequestPreflight::Terminal(receipt)
                    if receipt.state == CommunicationActionOutboxStateV1::Rejected =>
                {
                    self.retry_terminal_cleanup_for_request(&request)?;
                    Err(map_publication_failure(
                        CommunicationPublicationError::RelayRejected,
                    ))
                }
                CommunicationActionRequestPreflight::Nonterminal(row)
                    if matches!(
                        row.state,
                        CommunicationActionOutboxStateV1::Prepared
                            | CommunicationActionOutboxStateV1::Submitted
                            | CommunicationActionOutboxStateV1::PublicationUnknown
                    ) =>
                {
                    self.publish_prepared(&request, expected_authority)?;
                    Ok(staged(&request, self.current_nonterminal_state(&request)?))
                }
                _ => Err(BrokerFailure::outbox_unavailable()),
            };
        }

        // A process may have died after the vault's atomic seal but before the
        // outbox commit. Probe that deterministic slot before asking nostr to
        // make another signature for the same semantic action.
        let recovered_sealed = {
            let stores = self
                .stores
                .lock()
                .map_err(|_| BrokerFailure::outbox_unavailable())?;
            match stores.vault.seal_or_recover(&request, None) {
                Ok(sealed) => Some(sealed),
                Err(CommunicationEventVaultError::NotFound) => None,
                Err(_) => return Err(BrokerFailure::outbox_unavailable()),
            }
        };

        let first_membership = self
            .membership(existing_conversation_id(&request).map_err(map_publication_failure)?)
            .map_err(map_publication_failure)?;
        validate_membership(&request, expected_authority, &first_membership)
            .map_err(map_publication_failure)?;
        let signed_event = if recovered_sealed.is_none() {
            let artifact_bindings =
                self.resolve_private_artifact_bindings(&request, expected_authority)?;
            Some(
                build_exact_communication_event(
                    &request,
                    &self.resident_keys,
                    &first_membership,
                    self.relay.as_ref(),
                    &artifact_bindings,
                )
                .map_err(map_publication_failure)?,
            )
        } else {
            None
        };

        // Cancellation, replacement, and membership can race construction.
        // Recheck both immediately before freezing the event and outbox row.
        self.recheck_authority(expected_authority)?;
        let final_membership = self
            .membership(existing_conversation_id(&request).map_err(map_publication_failure)?)
            .map_err(map_publication_failure)?;
        if !same_membership(&first_membership, &final_membership) {
            return Err(BrokerFailure::membership_denied());
        }
        validate_membership(&request, expected_authority, &final_membership)
            .map_err(map_publication_failure)?;
        self.recheck_authority(expected_authority)?;

        let prepared_at = now_timestamp().map_err(map_publication_failure)?;
        let (sealed, receipt) = {
            let mut stores = self
                .stores
                .lock()
                .map_err(|_| BrokerFailure::outbox_unavailable())?;
            let sealed = recovered_sealed.unwrap_or(
                stores
                    .vault
                    .seal_or_recover(&request, signed_event.as_deref())
                    .map_err(|_| BrokerFailure::outbox_unavailable())?,
            );
            if let Some(receipt) = stores
                .outbox
                .preflight_existing(
                    &request,
                    &sealed.handle,
                    &sealed.event_sha256,
                    &sealed.event_id,
                )
                .map_err(|_| BrokerFailure::outbox_unavailable())?
            {
                (sealed, receipt)
            } else {
                let receipt = stores
                    .outbox
                    .prepare(
                        &request,
                        sealed.handle.clone(),
                        sealed.event_sha256.clone(),
                        sealed.event_id.clone(),
                        &self.installation_session_id,
                        expected_authority.coordinates.cancellation_epoch.get(),
                        false,
                        prepared_at,
                    )
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
                (sealed, receipt)
            }
        };

        if receipt.state == CommunicationActionOutboxStateV1::Accepted {
            self.retry_terminal_cleanup_for_request(&request)?;
            return Ok(staged(&request, "accepted"));
        }
        if receipt.state != CommunicationActionOutboxStateV1::Prepared {
            return Err(BrokerFailure::outbox_unavailable());
        }

        self.publish_prepared(&request, expected_authority)?;
        let state = self
            .stores
            .lock()
            .map_err(|_| BrokerFailure::outbox_unavailable())?
            .outbox
            .preflight_existing(
                &request,
                &sealed.handle,
                &sealed.event_sha256,
                &sealed.event_id,
            )
            .map_err(|_| BrokerFailure::outbox_unavailable())?
            .map(|receipt| receipt.state);
        Ok(staged(
            &request,
            if state == Some(CommunicationActionOutboxStateV1::Accepted) {
                "accepted"
            } else {
                "prepared"
            },
        ))
    }

    fn current_nonterminal_state(
        &self,
        request: &CommunicationActionRequestV1,
    ) -> Result<&'static str, BrokerFailure> {
        let preflight = self
            .stores
            .lock()
            .map_err(|_| BrokerFailure::outbox_unavailable())?
            .outbox
            .preflight_request(request)
            .map_err(|_| BrokerFailure::outbox_unavailable())?;
        match preflight {
            Some(CommunicationActionRequestPreflight::Terminal(receipt))
                if receipt.state == CommunicationActionOutboxStateV1::Accepted =>
            {
                Ok("accepted")
            }
            Some(CommunicationActionRequestPreflight::Nonterminal(_)) => Ok("prepared"),
            _ => Err(BrokerFailure::outbox_unavailable()),
        }
    }

    fn publish_prepared(
        &self,
        request: &CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<(), BrokerFailure> {
        // First exact authority + current participant snapshot before bytes are
        // selected. The durable dispatch is checked again under its mutex below.
        self.recheck_authority(expected_authority)?;
        let membership = self
            .membership(existing_conversation_id(request).map_err(map_publication_failure)?)
            .map_err(map_publication_failure)?;
        validate_membership(request, expected_authority, &membership)
            .map_err(map_publication_failure)?;
        self.recheck_authority(expected_authority)?;

        let (row, exact_json) = {
            let stores = self
                .stores
                .lock()
                .map_err(|_| BrokerFailure::outbox_unavailable())?;
            let row = stores
                .outbox
                .row_for_submission(&request.idempotency_key)
                .map_err(|_| BrokerFailure::outbox_unavailable())?
                .clone();
            let exact_json = stores
                .vault
                .load_exact(
                    &row.sealed_event_handle,
                    request,
                    &row.expected_event_id,
                    &row.exact_event_sha256,
                )
                .map_err(|_| BrokerFailure::outbox_unavailable())?;
            (row, exact_json)
        };

        let dispatch_store = if self.app.is_some() {
            super::communication_turn_registry::authorize(
                expected_authority.resident_pubkey.as_str(),
                expected_authority.session_epoch.get(),
                expected_authority
                    .coordinates
                    .source_conversation_id
                    .as_str(),
                expected_authority.coordinates.turn_id.as_str(),
                expected_authority.coordinates.dispatch_receipt_id.as_str(),
            )
            .map_err(|_| BrokerFailure::authority_unavailable())?;
            self.active_dispatch_store()
                .map_err(map_publication_failure)?
        } else {
            self.active_dispatch_store()
                .map_err(map_publication_failure)?
        };
        let mut dispatch_guard = dispatch_store
            .as_ref()
            .map(|store| {
                let guard = store
                    .lock()
                    .map_err(|_| BrokerFailure::authority_unavailable())?;
                guard
                    .recheck_communication_turn(
                        expected_authority.coordinates.dispatch_receipt_id.as_str(),
                        expected_authority.resident_pubkey.as_str(),
                        expected_authority
                            .coordinates
                            .source_conversation_id
                            .as_str(),
                        expected_authority.session_epoch.get(),
                        unix_now().map_err(map_publication_failure)?,
                    )
                    .map_err(|_| BrokerFailure::authority_unavailable())?;
                Ok::<_, BrokerFailure>(guard)
            })
            .transpose()?;

        // Keep the durable dispatch lock across descendant staging, Submitted
        // persistence, and the first relay I/O. Cancellation cannot win
        // between them and retry sees the same exact descendant keys.
        let mut stores = self
            .stores
            .lock()
            .map_err(|_| BrokerFailure::outbox_unavailable())?;
        stores
            .outbox
            .mark_submitted(
                &request.idempotency_key,
                &self.installation_session_id,
                expected_authority.coordinates.cancellation_epoch.get(),
                false,
                now_timestamp().map_err(map_publication_failure)?,
            )
            .map_err(|_| BrokerFailure::outbox_unavailable())?;

        let activation_targets = request
            .operation
            .activation_pubkeys()
            .iter()
            .map(|pubkey| pubkey.as_str().to_owned())
            .collect::<Vec<_>>();
        let staged_descendants = if activation_targets.is_empty() {
            Vec::new()
        } else {
            let guard = dispatch_guard
                .as_mut()
                .ok_or_else(BrokerFailure::authority_unavailable)?;
            let event = Event::from_json(exact_json.as_str())
                .map_err(|_| BrokerFailure::outbox_unavailable())?;
            guard
                .stage_descendant_event(
                    &event,
                    expected_authority.owner_pubkey.as_str(),
                    expected_authority.coordinates.dispatch_receipt_id.as_str(),
                    expected_authority.causal_root_id.as_str(),
                    request.action_id.as_str(),
                    &activation_targets,
                    unix_now().map_err(map_publication_failure)?,
                )
                .map_err(|_| BrokerFailure::authority_unavailable())?
        };

        match self.relay.submit_exact(exact_json.as_str()) {
            RelaySubmitOutcome::Accepted {
                event_id,
                receipt_id,
            } if event_id == row.expected_event_id => {
                stores
                    .outbox
                    .mark_accepted(
                        &request.idempotency_key,
                        event_id,
                        receipt_id,
                        now_timestamp().map_err(map_publication_failure)?,
                    )
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(request)
                    .map_err(|_| BrokerFailure::outbox_unavailable())?
                    .ok_or_else(BrokerFailure::outbox_unavailable)?;
                cleanup_terminal_event(&mut stores, cleanup)
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
            }
            RelaySubmitOutcome::ExplicitlyRejected => {
                if let Some(guard) = dispatch_guard.as_mut() {
                    guard
                        .mark_rejected(&staged_descendants)
                        .map_err(|_| BrokerFailure::authority_unavailable())?;
                }
                stores
                    .outbox
                    .reject_during_reconciliation(
                        &request.idempotency_key,
                        now_timestamp().map_err(map_publication_failure)?,
                    )
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
                let cleanup = stores
                    .outbox
                    .terminal_cleanup_for_request(request)
                    .map_err(|_| BrokerFailure::outbox_unavailable())?
                    .ok_or_else(BrokerFailure::outbox_unavailable)?;
                cleanup_terminal_event(&mut stores, cleanup)
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
                return Err(map_publication_failure(
                    CommunicationPublicationError::RelayRejected,
                ));
            }
            _ => {
                stores
                    .outbox
                    .mark_publication_unknown(&request.idempotency_key)
                    .map_err(|_| BrokerFailure::outbox_unavailable())?;
                return Err(map_publication_failure(
                    CommunicationPublicationError::RelayUnavailable,
                ));
            }
        }
        drop(dispatch_guard);
        Ok(())
    }

    fn retry_terminal_cleanup_for_request(
        &self,
        request: &CommunicationActionRequestV1,
    ) -> Result<(), BrokerFailure> {
        let mut stores = self
            .stores
            .lock()
            .map_err(|_| BrokerFailure::outbox_unavailable())?;
        let Some(cleanup) = stores
            .outbox
            .terminal_cleanup_for_request(request)
            .map_err(|_| BrokerFailure::outbox_unavailable())?
        else {
            return Ok(());
        };
        cleanup_terminal_event(&mut stores, cleanup)
            .map_err(|_| BrokerFailure::outbox_unavailable())
    }
}

fn cleanup_terminal_event(
    stores: &mut PublicationStores,
    cleanup: super::communication_action_outbox::CommunicationActionTerminalCleanup,
) -> Result<(), CommunicationPublicationError> {
    let terminal = match cleanup.terminal {
        CommunicationActionOutboxStateV1::Accepted => {
            CommunicationEventVaultTerminal::AcceptedAndFinalized
        }
        CommunicationActionOutboxStateV1::Rejected => {
            CommunicationEventVaultTerminal::ExplicitlyRejected
        }
        CommunicationActionOutboxStateV1::Failed | CommunicationActionOutboxStateV1::Cancelled => {
            CommunicationEventVaultTerminal::ProvenNotPublished
        }
        _ => return Err(CommunicationPublicationError::Persistence),
    };
    stores
        .vault
        .delete_terminal_cleanup(
            &cleanup.sealed_event_handle,
            &cleanup.expected_event_id,
            &cleanup.exact_event_sha256,
            terminal,
        )
        .map_err(|_| CommunicationPublicationError::Persistence)?;
    stores
        .outbox
        .complete_terminal_cleanup(&cleanup.idempotency_key)
        .map_err(|_| CommunicationPublicationError::Persistence)
}

fn staged(
    request: &CommunicationActionRequestV1,
    state: &'static str,
) -> StagedCommunicationAction {
    StagedCommunicationAction {
        action_id: request.action_id.clone(),
        idempotency_key: request.idempotency_key.clone(),
        state,
    }
}

fn validate_narrow_request(
    request: &CommunicationActionRequestV1,
    authority: &CommunicationTurnAuthoritySnapshot,
) -> Result<(), CommunicationPublicationError> {
    request
        .validate()
        .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
    if request.owner_pubkey != authority.owner_pubkey
        || request.resident_pubkey != authority.resident_pubkey
        || request.actor_pubkey != authority.resident_pubkey
        || request.session_epoch != authority.session_epoch
        || request.runtime_binding_ref != authority.runtime_binding_ref
        || request.source_conversation_id != authority.coordinates.source_conversation_id
        || request.turn_id != authority.coordinates.turn_id
        || request.dispatch_receipt_id != authority.coordinates.dispatch_receipt_id
        || request.cancellation_epoch != authority.coordinates.cancellation_epoch
    {
        return Err(CommunicationPublicationError::Authority);
    }
    let CommunicationDestinationV1::ExistingConversation { .. } = &request.destination else {
        return Err(CommunicationPublicationError::Unsupported);
    };
    match &request.operation {
        CommunicationOperationV1::SendMessage {
            activation_pubkeys,
            mention_pubkeys,
            ..
        } => {
            if !activation_pubkeys.is_empty()
                && (request.causal_depth.get() != 0
                    || request.causal_parent_action_id.is_some()
                    || activation_pubkeys.iter().any(|target| {
                        target == &authority.owner_pubkey
                            || target == &authority.resident_pubkey
                            || !authority.owned_resident_pubkeys.contains(target)
                            || mention_pubkeys.binary_search(target).is_err()
                    }))
            {
                return Err(CommunicationPublicationError::Unsupported);
            }
        }
        CommunicationOperationV1::EditOwnMessage {
            artifact_handles, ..
        } if !artifact_handles.is_empty() => {
            return Err(CommunicationPublicationError::Unsupported);
        }
        CommunicationOperationV1::EditOwnMessage { .. }
        | CommunicationOperationV1::AddReaction { .. }
        | CommunicationOperationV1::RemoveOwnReaction { .. } => {}
        _ => return Err(CommunicationPublicationError::Unsupported),
    }
    Ok(())
}

fn validate_approved_delete_request(
    request: &CommunicationActionRequestV1,
    approval: &CommunicationApprovalBindingV1,
    authority: &CommunicationTurnAuthoritySnapshot,
    now: &CanonicalTimestamp,
) -> Result<(), CommunicationPublicationError> {
    request
        .validate_at(now)
        .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
    approval
        .validate_request(request, now)
        .map_err(|_| CommunicationPublicationError::Authority)?;
    if request.owner_pubkey != authority.owner_pubkey
        || request.resident_pubkey != authority.resident_pubkey
        || request.actor_pubkey != authority.resident_pubkey
        || request.session_epoch != authority.session_epoch
        || request.runtime_binding_ref != authority.runtime_binding_ref
        || request.source_conversation_id != authority.coordinates.source_conversation_id
        || request.turn_id != authority.coordinates.turn_id
        || request.dispatch_receipt_id != authority.coordinates.dispatch_receipt_id
        || request.cancellation_epoch != authority.coordinates.cancellation_epoch
        || !matches!(
            &request.destination,
            CommunicationDestinationV1::ExistingConversation { .. }
        )
        || !matches!(
            &request.operation,
            CommunicationOperationV1::DeleteOwnMessage { .. }
        )
    {
        return Err(CommunicationPublicationError::Authority);
    }
    Ok(())
}

fn existing_conversation_id(
    request: &CommunicationActionRequestV1,
) -> Result<&OpaqueId, CommunicationPublicationError> {
    match &request.destination {
        CommunicationDestinationV1::ExistingConversation {
            conversation_id, ..
        } => Ok(conversation_id),
        _ => Err(CommunicationPublicationError::Unsupported),
    }
}

fn validate_membership(
    request: &CommunicationActionRequestV1,
    authority: &CommunicationTurnAuthoritySnapshot,
    membership: &ExistingConversationMembership,
) -> Result<(), CommunicationPublicationError> {
    if !membership
        .participant_pubkeys
        .contains(&authority.owner_pubkey)
        || !membership
            .participant_pubkeys
            .contains(&authority.resident_pubkey)
        || membership.participant_pubkeys.iter().any(|participant| {
            participant != &authority.owner_pubkey
                && !authority.owned_resident_pubkeys.contains(participant)
        })
        || request
            .operation
            .activation_pubkeys()
            .iter()
            .any(|target| !membership.participant_pubkeys.contains(target))
    {
        return Err(CommunicationPublicationError::Membership);
    }
    match &request.destination {
        CommunicationDestinationV1::ExistingConversation {
            conversation_id,
            participant_set_version,
            participant_set_ref,
        } if conversation_id == &membership.conversation_id
            && participant_set_version == &membership.participant_set_version
            && participant_set_ref == &membership.participant_set_ref =>
        {
            Ok(())
        }
        _ => Err(CommunicationPublicationError::Membership),
    }
}

fn validate_restart_membership(
    request: &CommunicationActionRequestV1,
    membership: &ExistingConversationMembership,
) -> Result<(), CommunicationPublicationError> {
    if !membership
        .participant_pubkeys
        .contains(&request.owner_pubkey)
        || !membership
            .participant_pubkeys
            .contains(&request.resident_pubkey)
    {
        return Err(CommunicationPublicationError::Membership);
    }
    match &request.destination {
        CommunicationDestinationV1::ExistingConversation {
            conversation_id,
            participant_set_version,
            participant_set_ref,
        } if conversation_id == &membership.conversation_id
            && participant_set_version == &membership.participant_set_version
            && participant_set_ref == &membership.participant_set_ref =>
        {
            Ok(())
        }
        _ => Err(CommunicationPublicationError::Membership),
    }
}

fn reconciliation_receipt_id(event_id: &Hex64) -> Result<OpaqueId, CommunicationPublicationError> {
    OpaqueId::parse(format!("relay-reconciled-{}", event_id.as_str()))
        .map_err(|_| CommunicationPublicationError::Persistence)
}

fn same_membership(
    left: &ExistingConversationMembership,
    right: &ExistingConversationMembership,
) -> bool {
    left.conversation_id == right.conversation_id
        && left.participant_pubkeys == right.participant_pubkeys
        && left.participant_set_version == right.participant_set_version
        && left.participant_set_ref == right.participant_set_ref
        && left.membership_event_id == right.membership_event_id
}

fn query_membership(
    relay: &dyn CommunicationRelayTransport,
    conversation_id: &OpaqueId,
) -> Result<ExistingConversationMembership, CommunicationPublicationError> {
    let events = relay.query(&[serde_json::json!({
        "authors": [relay.relay_self_pubkey().as_str()],
        "kinds": [MEMBERSHIP_KIND],
        "#d": [conversation_id.as_str()],
        "limit": MAX_RELAY_QUERY_EVENTS,
    })])?;
    newest_membership(events, conversation_id, relay.relay_self_pubkey())
}

fn newest_membership(
    events: Vec<Event>,
    conversation_id: &OpaqueId,
    relay_self_pubkey: &Hex64,
) -> Result<ExistingConversationMembership, CommunicationPublicationError> {
    let mut candidates = Vec::new();
    for event in events {
        if event.kind != Kind::Custom(MEMBERSHIP_KIND)
            || !event.verify_id()
            || !event.verify_signature()
            || event.pubkey.to_hex() != relay_self_pubkey.as_str()
            || exact_tag_values(&event, "d") != vec![conversation_id.as_str().to_owned()]
        {
            continue;
        }
        let mut participants = event
            .tags
            .iter()
            .filter_map(|tag| {
                let values = tag.as_slice();
                (values.first().map(String::as_str) == Some("p"))
                    .then(|| values.get(1))
                    .flatten()
                    .and_then(|value| Hex64::parse(value.to_ascii_lowercase()).ok())
            })
            .collect::<Vec<_>>();
        participants.sort();
        participants.dedup();
        if participants.is_empty() {
            continue;
        }
        candidates.push((event.created_at.as_secs(), event.id.to_hex(), participants));
    }
    candidates.sort_by(|left, right| (left.0, &left.1).cmp(&(right.0, &right.1)));
    let (_, event_id, participants) = candidates
        .pop()
        .ok_or(CommunicationPublicationError::Membership)?;
    let participant_pubkeys = participants.iter().cloned().collect::<BTreeSet<_>>();
    let participant_set_ref = participant_ref(&participants)?;
    let version = u64::from_str_radix(&event_id[..13], 16)
        .map_err(|_| CommunicationPublicationError::Membership)?
        .max(1);
    Ok(ExistingConversationMembership {
        conversation_id: conversation_id.clone(),
        participant_pubkeys,
        participant_set_version: SafeU53::new(version)
            .map_err(|_| CommunicationPublicationError::Membership)?,
        participant_set_ref,
        membership_event_id: Hex64::parse(event_id)
            .map_err(|_| CommunicationPublicationError::Membership)?,
    })
}

fn participant_ref(participants: &[Hex64]) -> Result<Sha256Ref, CommunicationPublicationError> {
    let digest = canonical_sha256(&participants.to_vec())
        .map_err(|_| CommunicationPublicationError::Membership)?;
    Sha256Ref::parse(format!("sha256:{digest}"))
        .map_err(|_| CommunicationPublicationError::Membership)
}

fn exact_tag_values(event: &Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some(name))
                .then(|| values.get(1).cloned())
                .flatten()
        })
        .collect()
}

fn query_message(
    relay: &dyn CommunicationRelayTransport,
    conversation_id: &OpaqueId,
    event_id: &Hex64,
) -> Result<Event, CommunicationPublicationError> {
    let events = relay.query(&[serde_json::json!({
        "ids": [event_id.as_str()],
        "kinds": [MESSAGE_KIND],
        "#h": [conversation_id.as_str()],
        "limit": 2,
    })])?;
    let mut matches = events.into_iter().filter(|event| {
        event.id.to_hex() == event_id.as_str()
            && event.kind == Kind::Custom(MESSAGE_KIND)
            && event.verify_id()
            && event.verify_signature()
            && exact_tag_values(event, "h") == vec![conversation_id.as_str().to_owned()]
    });
    let event = matches
        .next()
        .ok_or(CommunicationPublicationError::Membership)?;
    if matches.next().is_some() {
        return Err(CommunicationPublicationError::Membership);
    }
    Ok(event)
}

fn query_reaction(
    relay: &dyn CommunicationRelayTransport,
    conversation_id: &OpaqueId,
    target_event_id: &Hex64,
    reaction_event_id: &Hex64,
) -> Result<Event, CommunicationPublicationError> {
    query_message(relay, conversation_id, target_event_id)?;
    let events = relay.query(&[serde_json::json!({
        "ids": [reaction_event_id.as_str()],
        "kinds": [REACTION_KIND],
        "#e": [target_event_id.as_str()],
        "limit": 2,
    })])?;
    let mut matches = events.into_iter().filter(|event| {
        event.id.to_hex() == reaction_event_id.as_str()
            && event.kind == Kind::Custom(REACTION_KIND)
            && event.verify_id()
            && event.verify_signature()
            && exact_tag_values(event, "e") == vec![target_event_id.as_str().to_owned()]
    });
    let event = matches
        .next()
        .ok_or(CommunicationPublicationError::Membership)?;
    if matches.next().is_some() {
        return Err(CommunicationPublicationError::Membership);
    }
    Ok(event)
}

fn build_exact_communication_event(
    request: &CommunicationActionRequestV1,
    keys: &Keys,
    membership: &ExistingConversationMembership,
    relay: &dyn CommunicationRelayTransport,
    artifact_bindings: &[ManagedArtifactBinding],
) -> Result<String, CommunicationPublicationError> {
    let channel_id = Uuid::parse_str(membership.conversation_id.as_str())
        .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
    let builder = match &request.operation {
        CommunicationOperationV1::SendMessage {
            body,
            reply_to_event_id,
            mention_pubkeys,
            activation_pubkeys: _,
            artifact_handles,
        } => {
            if artifact_handles.len() != artifact_bindings.len()
                || artifact_handles
                    .iter()
                    .zip(artifact_bindings)
                    .any(|(handle, binding)| {
                        handle.handle_id.as_str() != binding.handle_id
                            || handle.content_sha256.as_str() != binding.content_sha256
                            || handle.byte_length.get() != binding.byte_length
                            || handle.media_type != binding.media_type
                            || handle.display_name != binding.display_name
                    })
            {
                return Err(CommunicationPublicationError::Authority);
            }
            let thread_ref = reply_to_event_id
                .as_ref()
                .map(|event_id| {
                    let parent = query_message(relay, &membership.conversation_id, event_id)?;
                    let root = parent
                        .tags
                        .iter()
                        .find_map(|tag| {
                            let values = tag.as_slice();
                            (values.first().map(String::as_str) == Some("e")
                                && values.get(3).map(String::as_str) == Some("root"))
                            .then(|| values.get(1).cloned())
                            .flatten()
                        })
                        .unwrap_or_else(|| event_id.as_str().to_owned());
                    Ok::<crate::events::ThreadRef, CommunicationPublicationError>(
                        crate::events::ThreadRef {
                            root_event_id: EventId::from_hex(&root)
                                .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
                            parent_event_id: EventId::from_hex(event_id.as_str())
                                .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
                        },
                    )
                })
                .transpose()?;
            let mention_refs = mention_pubkeys
                .iter()
                .map(Hex64::as_str)
                .collect::<Vec<_>>();
            let client_tags = vec![vec![
                "client".to_owned(),
                "luca-communication-v1".to_owned(),
                request.action_id.as_str().to_owned(),
                membership.membership_event_id.as_str().to_owned(),
            ]];
            let media_tags = artifact_bindings
                .iter()
                .map(|binding| {
                    let mut tag = vec![
                        "imeta".to_owned(),
                        format!("url {}", binding.url),
                        format!("m {}", binding.media_type),
                        format!("x {}", binding.content_sha256),
                        format!("size {}", binding.byte_length),
                    ];
                    if let Some(name) = &binding.display_name {
                        tag.push(format!("filename {name}"));
                    }
                    tag
                })
                .collect::<Vec<_>>();
            crate::events::build_message_with_client_tags(
                channel_id,
                body,
                thread_ref.as_ref(),
                &mention_refs,
                &media_tags,
                &[],
                &[],
                &client_tags,
            )?
            .tag(
                Tag::parse([
                    TAG_EXPECTED_MEMBERSHIP_SNAPSHOT,
                    EXPECTED_MEMBERSHIP_SNAPSHOT_VERSION,
                    membership.membership_event_id.as_str(),
                ])
                .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
            )
        }
        CommunicationOperationV1::AddReaction {
            target_event_id,
            reaction,
        } => {
            query_message(relay, &membership.conversation_id, target_event_id)?;
            crate::events::build_reaction(
                EventId::from_hex(target_event_id.as_str())
                    .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
                reaction,
            )?
        }
        CommunicationOperationV1::RemoveOwnReaction {
            target_event_id,
            reaction_event_id,
        } => {
            let reaction = query_reaction(
                relay,
                &membership.conversation_id,
                target_event_id,
                reaction_event_id,
            )?;
            if reaction.pubkey != keys.public_key() {
                return Err(CommunicationPublicationError::Authority);
            }
            crate::events::build_remove_reaction(
                EventId::from_hex(reaction_event_id.as_str())
                    .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
            )?
        }
        CommunicationOperationV1::EditOwnMessage {
            target_event_id,
            replacement_body,
            artifact_handles,
        } => {
            if !artifact_handles.is_empty() {
                return Err(CommunicationPublicationError::Unsupported);
            }
            let target = query_message(relay, &membership.conversation_id, target_event_id)?;
            if target.pubkey != keys.public_key() {
                return Err(CommunicationPublicationError::Authority);
            }
            crate::events::build_message_edit(
                channel_id,
                EventId::from_hex(target_event_id.as_str())
                    .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
                replacement_body,
                &[],
                &[],
                &[],
            )?
        }
        CommunicationOperationV1::DeleteOwnMessage { target_event_id } => {
            let target = query_message(relay, &membership.conversation_id, target_event_id)?;
            if target.pubkey != keys.public_key() {
                return Err(CommunicationPublicationError::Authority);
            }
            crate::events::build_delete_compat(
                channel_id,
                EventId::from_hex(target_event_id.as_str())
                    .map_err(|_| CommunicationPublicationError::InvalidRequest)?,
            )?
        }
        _ => return Err(CommunicationPublicationError::Unsupported),
    };
    let event = builder
        .custom_created_at(Timestamp::from(deterministic_event_timestamp(request)?))
        .sign_with_keys(keys)
        .map_err(|_| CommunicationPublicationError::InvalidRequest)?;
    Ok(event.as_json())
}

fn deterministic_event_timestamp(
    request: &CommunicationActionRequestV1,
) -> Result<u64, CommunicationPublicationError> {
    let expiry = DateTime::parse_from_rfc3339(request.expires_at.as_str())
        .map_err(|_| CommunicationPublicationError::InvalidRequest)?
        .timestamp();
    u64::try_from(expiry.saturating_sub(30 * 60).max(1))
        .map_err(|_| CommunicationPublicationError::InvalidRequest)
}

fn now_timestamp() -> Result<CanonicalTimestamp, CommunicationPublicationError> {
    let seconds = unix_now()?;
    let seconds = i64::try_from(seconds).map_err(|_| CommunicationPublicationError::Authority)?;
    let timestamp = DateTime::<Utc>::from_timestamp(seconds, 0)
        .ok_or(CommunicationPublicationError::Authority)?;
    CanonicalTimestamp::parse(timestamp.to_rfc3339_opts(SecondsFormat::Secs, true))
        .map_err(|_| CommunicationPublicationError::Authority)
}

fn unix_now() -> Result<u64, CommunicationPublicationError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| CommunicationPublicationError::Authority)
}

fn map_publication_failure(error: CommunicationPublicationError) -> BrokerFailure {
    match error {
        CommunicationPublicationError::InvalidRequest => BrokerFailure::invalid_arguments(),
        CommunicationPublicationError::Authority => BrokerFailure::authority_unavailable(),
        CommunicationPublicationError::Membership => BrokerFailure::membership_denied(),
        CommunicationPublicationError::Unsupported => BrokerFailure::operation_not_implemented(),
        CommunicationPublicationError::RelayUnavailable
        | CommunicationPublicationError::RelayRejected
        | CommunicationPublicationError::Persistence => BrokerFailure::outbox_unavailable(),
    }
}

impl From<String> for CommunicationPublicationError {
    fn from(_: String) -> Self {
        Self::InvalidRequest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    use luca_protocol::{
        CommunicationDestinationV1, OpaqueArtifactHandleV1, COMMUNICATION_ACTION_PROTOCOL,
    };
    use nostr::{EventBuilder, Tag};
    use tempfile::TempDir;

    fn keys(byte: &str) -> Keys {
        Keys::parse(&byte.repeat(32)).expect("keys")
    }

    fn membership_event(
        signer: &Keys,
        conversation: &str,
        members: &[&Keys],
        created_at: u64,
    ) -> Event {
        let mut tags = vec![Tag::parse(["d", conversation]).expect("d")];
        tags.extend(members.iter().map(|member| {
            let pubkey = member.public_key().to_hex();
            Tag::parse(vec!["p".to_owned(), pubkey]).expect("p")
        }));
        EventBuilder::new(Kind::Custom(MEMBERSHIP_KIND), "")
            .tags(tags)
            .custom_created_at(Timestamp::from(created_at))
            .sign_with_keys(signer)
            .expect("membership")
    }

    #[derive(Debug, Clone, Copy)]
    enum FakeSubmitResult {
        Accepted,
        Unknown,
    }

    struct FakeRelay {
        relay_self_pubkey: Hex64,
        events: Vec<Event>,
        probe_results: Mutex<VecDeque<ExactEventProbeOutcome>>,
        submit_results: Mutex<VecDeque<FakeSubmitResult>>,
        submitted: Mutex<Vec<String>>,
    }

    impl FakeRelay {
        fn new(
            relay: &Keys,
            events: Vec<Event>,
            submit_results: impl IntoIterator<Item = FakeSubmitResult>,
        ) -> Arc<Self> {
            Arc::new(Self {
                relay_self_pubkey: Hex64::parse(relay.public_key().to_hex()).unwrap(),
                events,
                probe_results: Mutex::new(VecDeque::new()),
                submit_results: Mutex::new(submit_results.into_iter().collect()),
                submitted: Mutex::new(Vec::new()),
            })
        }

        fn submitted(&self) -> Vec<String> {
            self.submitted.lock().unwrap().clone()
        }

        fn events(&self) -> Vec<Event> {
            self.events.clone()
        }

        fn set_probe_results(&self, results: impl IntoIterator<Item = ExactEventProbeOutcome>) {
            *self.probe_results.lock().unwrap() = results.into_iter().collect();
        }
    }

    impl CommunicationRelayTransport for FakeRelay {
        fn relay_self_pubkey(&self) -> &Hex64 {
            &self.relay_self_pubkey
        }

        fn query(
            &self,
            filters: &[serde_json::Value],
        ) -> Result<Vec<Event>, CommunicationPublicationError> {
            let requested_kinds = filters
                .iter()
                .flat_map(|filter| {
                    filter
                        .get("kinds")
                        .and_then(serde_json::Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(serde_json::Value::as_u64)
                })
                .collect::<BTreeSet<_>>();
            Ok(self
                .events
                .iter()
                .filter(|event| requested_kinds.contains(&u64::from(event.kind.as_u16())))
                .cloned()
                .collect())
        }

        fn probe_exact(&self, signed_event_json: &str) -> ExactEventProbeOutcome {
            if let Some(result) = self.probe_results.lock().unwrap().pop_front() {
                return result;
            }
            let Ok(candidate) = Event::from_json(signed_event_json) else {
                return ExactEventProbeOutcome::Unknown;
            };
            if self
                .events
                .iter()
                .any(|event| event.id == candidate.id && event.as_json() == candidate.as_json())
            {
                ExactEventProbeOutcome::Present
            } else {
                ExactEventProbeOutcome::Absent
            }
        }

        fn submit_exact(&self, signed_event_json: &str) -> RelaySubmitOutcome {
            self.submitted
                .lock()
                .unwrap()
                .push(signed_event_json.to_owned());
            match self
                .submit_results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(FakeSubmitResult::Unknown)
            {
                FakeSubmitResult::Accepted => {
                    let event = Event::from_json(signed_event_json).expect("submitted event");
                    RelaySubmitOutcome::Accepted {
                        event_id: Hex64::parse(event.id.to_hex()).unwrap(),
                        receipt_id: OpaqueId::parse(format!("relay-{}", event.id.to_hex()))
                            .unwrap(),
                    }
                }
                FakeSubmitResult::Unknown => RelaySubmitOutcome::Unknown,
            }
        }
    }

    struct PublisherFixture {
        _directory: TempDir,
        publisher: Arc<ExistingConversationPublisher>,
        relay: Arc<FakeRelay>,
        request: CommunicationActionRequestV1,
        authority: CommunicationTurnAuthoritySnapshot,
    }

    fn publisher_fixture(
        submit_results: impl IntoIterator<Item = FakeSubmitResult>,
    ) -> PublisherFixture {
        let relay_keys = keys("41");
        let owner_keys = keys("42");
        let resident_keys = keys("43");
        let owner_pubkey = Hex64::parse(owner_keys.public_key().to_hex()).unwrap();
        let resident_pubkey = Hex64::parse(resident_keys.public_key().to_hex()).unwrap();
        let conversation_id = OpaqueId::parse("55555555-5555-4555-8555-555555555555").unwrap();
        let membership_event = membership_event(
            &relay_keys,
            conversation_id.as_str(),
            &[&owner_keys, &resident_keys],
            100,
        );
        let resident_message = EventBuilder::new(Kind::Custom(MESSAGE_KIND), "resident original")
            .tags([Tag::parse(["h", conversation_id.as_str()]).unwrap()])
            .custom_created_at(Timestamp::from(101))
            .sign_with_keys(&resident_keys)
            .unwrap();
        let owner_message = EventBuilder::new(Kind::Custom(MESSAGE_KIND), "owner original")
            .tags([Tag::parse(["h", conversation_id.as_str()]).unwrap()])
            .custom_created_at(Timestamp::from(102))
            .sign_with_keys(&owner_keys)
            .unwrap();
        let resident_reaction = crate::events::build_reaction(resident_message.id, "+")
            .unwrap()
            .custom_created_at(Timestamp::from(103))
            .sign_with_keys(&resident_keys)
            .unwrap();
        let owner_reaction = crate::events::build_reaction(resident_message.id, "-")
            .unwrap()
            .custom_created_at(Timestamp::from(104))
            .sign_with_keys(&owner_keys)
            .unwrap();
        let relay = FakeRelay::new(
            &relay_keys,
            vec![
                membership_event,
                resident_message,
                owner_message,
                resident_reaction,
                owner_reaction,
            ],
            submit_results,
        );
        let session = OpaqueId::parse("installation-test-1").unwrap();
        let directory = tempfile::tempdir().unwrap();
        let vault = CommunicationEventVault::open(
            directory.path().join("vault"),
            SecretString::from("test-vault-passphrase"),
            resident_pubkey.clone(),
        )
        .unwrap();
        let publisher = ExistingConversationPublisher::relay_for_tests(
            resident_keys,
            SafeU53::new(4).unwrap(),
            session.clone(),
            CommunicationActionOutbox::new(session),
            vault,
            relay.clone(),
        );
        let membership = publisher.membership(&conversation_id).unwrap();
        let source_conversation_id = OpaqueId::parse("source-conversation-test").unwrap();
        let turn_id = OpaqueId::parse("turn-test-1").unwrap();
        let dispatch_receipt_id = OpaqueId::parse("dispatch-test-1").unwrap();
        let runtime_binding_ref = Sha256Ref::parse(format!("sha256:{}", "4".repeat(64))).unwrap();
        let expires_at = CanonicalTimestamp::parse("2030-08-11T13:00:00Z").unwrap();
        let authority = CommunicationTurnAuthoritySnapshot {
            owner_pubkey: owner_pubkey.clone(),
            resident_pubkey: resident_pubkey.clone(),
            session_epoch: SafeU53::new(4).unwrap(),
            runtime_binding_ref: runtime_binding_ref.clone(),
            coordinates: super::super::communication_bridge::CommunicationTurnCoordinates {
                source_conversation_id: source_conversation_id.clone(),
                turn_id: turn_id.clone(),
                dispatch_receipt_id: dispatch_receipt_id.clone(),
                cancellation_epoch: SafeU53::new(2).unwrap(),
            },
            causal_root_id: OpaqueId::parse("causal-root-test-1").unwrap(),
            owned_resident_pubkeys: [resident_pubkey.clone()].into_iter().collect(),
            expires_at: expires_at.clone(),
        };
        let mut request = CommunicationActionRequestV1 {
            protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
            action_id: OpaqueId::parse("communication-action-test-1").unwrap(),
            idempotency_key: Hex64::parse("0".repeat(64)).unwrap(),
            action_fingerprint: Sha256Ref::parse(format!("sha256:{}", "0".repeat(64))).unwrap(),
            actor_pubkey: resident_pubkey.clone(),
            owner_pubkey,
            resident_pubkey,
            session_epoch: SafeU53::new(4).unwrap(),
            runtime_binding_ref,
            source_conversation_id,
            destination: CommunicationDestinationV1::ExistingConversation {
                conversation_id,
                participant_set_version: membership.participant_set_version,
                participant_set_ref: membership.participant_set_ref,
            },
            turn_id,
            dispatch_receipt_id,
            causal_root_id: OpaqueId::parse("causal-root-test-1").unwrap(),
            causal_parent_action_id: None,
            causal_depth: SafeU53::new(0).unwrap(),
            cancellation_epoch: SafeU53::new(2).unwrap(),
            expires_at,
            approval_id: None,
            operation: CommunicationOperationV1::SendMessage {
                body: "exact resident message".to_owned(),
                reply_to_event_id: None,
                mention_pubkeys: Vec::new(),
                activation_pubkeys: Vec::new(),
                artifact_handles: Vec::new(),
            },
        };
        request.action_fingerprint = request.derive_action_fingerprint().unwrap();
        request.idempotency_key = request.derive_idempotency_key().unwrap();
        request.validate().unwrap();
        PublisherFixture {
            _directory: directory,
            publisher,
            relay,
            request,
            authority,
        }
    }

    fn request_with_operation(
        request: &CommunicationActionRequestV1,
        suffix: &str,
        operation: CommunicationOperationV1,
    ) -> CommunicationActionRequestV1 {
        let mut request = request.clone();
        request.action_id = OpaqueId::parse(format!("communication-action-{suffix}")).unwrap();
        request.operation = operation;
        request.action_fingerprint = request.derive_action_fingerprint().unwrap();
        request.idempotency_key = request.derive_idempotency_key().unwrap();
        request.validate().unwrap();
        request
    }

    fn approved_delete_request(
        request: &CommunicationActionRequestV1,
        suffix: &str,
        target_event_id: Hex64,
    ) -> CommunicationActionRequestV1 {
        let mut request = request.clone();
        request.action_id = OpaqueId::parse(format!("communication-action-{suffix}")).unwrap();
        request.approval_id =
            Some(OpaqueId::parse(format!("communication-approval-{suffix}")).unwrap());
        request.operation = CommunicationOperationV1::DeleteOwnMessage { target_event_id };
        request.action_fingerprint = request.derive_action_fingerprint().unwrap();
        request.idempotency_key = request.derive_idempotency_key().unwrap();
        request.validate().unwrap();
        request
    }

    fn exact_test_approval(
        request: &CommunicationActionRequestV1,
    ) -> CommunicationApprovalBindingV1 {
        let approved_at = now_timestamp().expect("current timestamp");
        CommunicationApprovalBindingV1 {
            protocol: luca_protocol::COMMUNICATION_APPROVAL_PROTOCOL.into(),
            approval_id: request.approval_id.clone().expect("approval id"),
            action_id: request.action_id.clone(),
            action_fingerprint: request.action_fingerprint.clone(),
            content_ref: request.content_ref().expect("content ref"),
            artifact_set_ref: request.artifact_set_ref().expect("artifact ref"),
            destination_ref: request.destination_ref().expect("destination ref"),
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
        }
    }

    #[test]
    fn newest_membership_is_deterministic_and_owner_visible() {
        let relay = keys("11");
        let owner = keys("12");
        let resident = keys("13");
        let conversation = OpaqueId::parse("11111111-1111-4111-8111-111111111111").unwrap();
        let old = membership_event(&relay, conversation.as_str(), &[&owner], 10);
        let current = membership_event(&relay, conversation.as_str(), &[&owner, &resident], 11);
        let relay_pubkey = Hex64::parse(relay.public_key().to_hex()).unwrap();
        let snapshot =
            newest_membership(vec![current.clone(), old], &conversation, &relay_pubkey).unwrap();
        assert!(snapshot
            .participant_pubkeys
            .contains(&Hex64::parse(owner.public_key().to_hex()).unwrap()));
        assert!(snapshot
            .participant_pubkeys
            .contains(&Hex64::parse(resident.public_key().to_hex()).unwrap()));
        assert_eq!(snapshot.membership_event_id.as_str(), current.id.to_hex());
    }

    #[test]
    fn invalid_or_wrong_conversation_membership_is_rejected() {
        let relay = keys("21");
        let owner = keys("22");
        let expected = OpaqueId::parse("22222222-2222-4222-8222-222222222222").unwrap();
        let wrong = membership_event(
            &relay,
            "33333333-3333-4333-8333-333333333333",
            &[&owner],
            10,
        );
        assert_eq!(
            newest_membership(
                vec![wrong],
                &expected,
                &Hex64::parse(relay.public_key().to_hex()).unwrap(),
            )
            .unwrap_err(),
            CommunicationPublicationError::Membership
        );
    }

    #[test]
    fn newer_membership_from_wrong_signer_is_rejected() {
        let relay = keys("24");
        let attacker = keys("25");
        let owner = keys("26");
        let resident = keys("27");
        let conversation = OpaqueId::parse("44444444-4444-4444-8444-444444444444").unwrap();
        let canonical = membership_event(&relay, conversation.as_str(), &[&owner, &resident], 10);
        let forged = membership_event(&attacker, conversation.as_str(), &[&attacker], 11);
        let snapshot = newest_membership(
            vec![forged, canonical.clone()],
            &conversation,
            &Hex64::parse(relay.public_key().to_hex()).unwrap(),
        )
        .unwrap();
        assert_eq!(snapshot.membership_event_id.as_str(), canonical.id.to_hex());
    }

    #[test]
    fn passphrase_domains_are_distinct_and_stable() {
        let resident = keys("31");
        let first = derive_communication_storage_passphrases(&resident).unwrap();
        let second = derive_communication_storage_passphrases(&resident).unwrap();
        use age::secrecy::ExposeSecret;
        assert_ne!(first.outbox.expose_secret(), first.vault.expose_secret());
        assert_eq!(first.outbox.expose_secret(), second.outbox.expose_secret());
        assert_eq!(first.vault.expose_secret(), second.vault.expose_secret());
    }

    #[test]
    fn participant_reference_is_order_sensitive_but_callers_sort() {
        let a = Hex64::parse("a".repeat(64)).unwrap();
        let b = Hex64::parse("b".repeat(64)).unwrap();
        assert_ne!(
            participant_ref(&[a.clone(), b.clone()]).unwrap(),
            participant_ref(&[b, a]).unwrap()
        );
    }

    #[test]
    fn owner_visible_existing_conversation_accepts_exact_resident_kind_nine_once() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let staged = fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .unwrap();
        assert_eq!(staged.state, "accepted");
        let submitted = fixture.relay.submitted();
        assert_eq!(submitted.len(), 1);
        let event = Event::from_json(&submitted[0]).unwrap();
        assert_eq!(event.kind, Kind::Custom(MESSAGE_KIND));
        assert_eq!(
            event.pubkey.to_hex(),
            fixture.request.resident_pubkey.as_str()
        );
        assert_eq!(
            exact_tag_values(&event, "h"),
            vec![existing_conversation_id(&fixture.request)
                .unwrap()
                .as_str()
                .to_owned()]
        );
        let membership = fixture
            .publisher
            .membership(existing_conversation_id(&fixture.request).unwrap())
            .unwrap();
        assert!(event.tags.iter().any(|tag| {
            let values = tag.as_slice();
            values.len() == 3
                && values[0] == TAG_EXPECTED_MEMBERSHIP_SNAPSHOT
                && values[1] == EXPECTED_MEMBERSHIP_SNAPSHOT_VERSION
                && values[2] == membership.membership_event_id.as_str()
        }));

        let repeated = fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .unwrap();
        assert_eq!(repeated.state, "accepted");
        assert_eq!(fixture.relay.submitted().len(), 1);
    }

    #[test]
    fn exact_resident_message_uses_only_dispatch_bound_imeta_metadata() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let artifact = OpaqueArtifactHandleV1 {
            handle_id: OpaqueId::parse("artifact-upload-1").unwrap(),
            content_sha256: Hex64::parse("a".repeat(64)).unwrap(),
            byte_length: SafeU53::new(42).unwrap(),
            media_type: "text/plain".to_owned(),
            display_name: Some("notes.txt".to_owned()),
        };
        let request = request_with_operation(
            &fixture.request,
            "attachment",
            CommunicationOperationV1::SendMessage {
                body: "attached".to_owned(),
                reply_to_event_id: None,
                mention_pubkeys: Vec::new(),
                activation_pubkeys: Vec::new(),
                artifact_handles: vec![artifact],
            },
        );
        let membership = fixture
            .publisher
            .membership(existing_conversation_id(&request).unwrap())
            .unwrap();
        let binding = ManagedArtifactBinding {
            handle_id: "artifact-upload-1".to_owned(),
            url: "https://relay.invalid/blob".to_owned(),
            content_sha256: "a".repeat(64),
            byte_length: 42,
            media_type: "text/plain".to_owned(),
            display_name: Some("notes.txt".to_owned()),
            expires_at: u64::MAX,
        };
        let event = Event::from_json(
            build_exact_communication_event(
                &request,
                &fixture.publisher.resident_keys,
                &membership,
                fixture.publisher.relay.as_ref(),
                &[binding],
            )
            .unwrap(),
        )
        .unwrap();
        let imeta = event
            .tags
            .iter()
            .find(|tag| tag.as_slice().first().map(String::as_str) == Some("imeta"))
            .expect("imeta")
            .as_slice();
        assert!(imeta.contains(&"url https://relay.invalid/blob".to_owned()));
        assert!(imeta.contains(&format!("x {}", "a".repeat(64))));
        assert!(imeta.contains(&"size 42".to_owned()));
        assert!(imeta.contains(&"filename notes.txt".to_owned()));
        assert!(imeta
            .iter()
            .all(|field| !field.contains("artifact-upload-1")));
    }

    #[test]
    fn approved_reaction_remove_and_own_edit_reuse_existing_event_builders() {
        let fixture = publisher_fixture([
            FakeSubmitResult::Accepted,
            FakeSubmitResult::Accepted,
            FakeSubmitResult::Accepted,
        ]);
        let resident_pubkey = fixture.request.resident_pubkey.as_str();
        let events = fixture.relay.events();
        let resident_message = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() == resident_pubkey
            })
            .unwrap();
        let resident_reaction = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(REACTION_KIND)
                    && event.pubkey.to_hex() == resident_pubkey
            })
            .unwrap();
        let target_event_id = Hex64::parse(resident_message.id.to_hex()).unwrap();
        let reaction_event_id = Hex64::parse(resident_reaction.id.to_hex()).unwrap();

        let add = request_with_operation(
            &fixture.request,
            "add-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: target_event_id.clone(),
                reaction: "+1".to_owned(),
            },
        );
        fixture
            .publisher
            .stage_and_publish(add, &fixture.authority)
            .unwrap();

        let remove = request_with_operation(
            &fixture.request,
            "remove-reaction",
            CommunicationOperationV1::RemoveOwnReaction {
                target_event_id: target_event_id.clone(),
                reaction_event_id: reaction_event_id.clone(),
            },
        );
        fixture
            .publisher
            .stage_and_publish(remove, &fixture.authority)
            .unwrap();

        let edit = request_with_operation(
            &fixture.request,
            "edit-message",
            CommunicationOperationV1::EditOwnMessage {
                target_event_id: target_event_id.clone(),
                replacement_body: "resident replacement".to_owned(),
                artifact_handles: Vec::new(),
            },
        );
        fixture
            .publisher
            .stage_and_publish(edit, &fixture.authority)
            .unwrap();

        let submitted = fixture
            .relay
            .submitted()
            .into_iter()
            .map(|event| Event::from_json(event).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(submitted.len(), 3);
        assert_eq!(submitted[0].kind, Kind::Custom(REACTION_KIND));
        assert_eq!(submitted[0].content, "+1");
        assert_eq!(
            exact_tag_values(&submitted[0], "e"),
            vec![target_event_id.as_str().to_owned()]
        );
        assert_eq!(submitted[1].kind, Kind::Custom(5));
        assert_eq!(
            exact_tag_values(&submitted[1], "e"),
            vec![reaction_event_id.as_str().to_owned()]
        );
        assert_eq!(submitted[2].kind, Kind::Custom(40_003));
        assert_eq!(submitted[2].content, "resident replacement");
        assert_eq!(
            exact_tag_values(&submitted[2], "h"),
            vec![existing_conversation_id(&fixture.request)
                .unwrap()
                .as_str()
                .to_owned()]
        );
        assert_eq!(
            exact_tag_values(&submitted[2], "e"),
            vec![target_event_id.as_str().to_owned()]
        );
        assert!(submitted
            .iter()
            .all(|event| event.pubkey.to_hex() == resident_pubkey));
    }

    #[test]
    fn approved_own_delete_reuses_exact_compat_builder_and_vault_path() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let resident_pubkey = fixture.request.resident_pubkey.as_str();
        let target = fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() == resident_pubkey
            })
            .expect("resident message");
        let target_id = Hex64::parse(target.id.to_hex()).unwrap();
        let request = approved_delete_request(&fixture.request, "delete-own", target_id.clone());
        let approval = exact_test_approval(&request);
        let staged = fixture
            .publisher
            .stage_approved_and_publish(request, &approval, &fixture.authority)
            .expect("approved deletion");
        assert_eq!(staged.state, "accepted");

        let submitted = fixture.relay.submitted();
        assert_eq!(submitted.len(), 1);
        let event = Event::from_json(&submitted[0]).expect("delete event");
        assert_eq!(event.kind, Kind::Custom(5));
        assert!(event.content.is_empty());
        assert_eq!(
            exact_tag_values(&event, "h"),
            vec![existing_conversation_id(&fixture.request)
                .unwrap()
                .as_str()
                .to_owned()]
        );
        assert_eq!(
            exact_tag_values(&event, "e"),
            vec![target_id.as_str().to_owned()]
        );
        assert_eq!(event.pubkey.to_hex(), resident_pubkey);
    }

    #[test]
    fn foreign_delete_and_changed_approval_fail_before_signing_or_staging() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let resident_pubkey = fixture.request.resident_pubkey.as_str();
        let events = fixture.relay.events();
        let own = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() == resident_pubkey
            })
            .expect("own message");
        let foreign = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() != resident_pubkey
            })
            .expect("foreign message");

        let foreign_request = approved_delete_request(
            &fixture.request,
            "delete-foreign",
            Hex64::parse(foreign.id.to_hex()).unwrap(),
        );
        let foreign_approval = exact_test_approval(&foreign_request);
        assert!(fixture
            .publisher
            .stage_approved_and_publish(foreign_request, &foreign_approval, &fixture.authority,)
            .is_err());
        assert!(fixture.relay.submitted().is_empty());

        let request = approved_delete_request(
            &fixture.request,
            "delete-changed",
            Hex64::parse(own.id.to_hex()).unwrap(),
        );
        let mut stale_approval = exact_test_approval(&request);
        stale_approval.cancellation_epoch = SafeU53::new(3).unwrap();
        assert!(fixture
            .publisher
            .stage_approved_and_publish(request, &stale_approval, &fixture.authority)
            .is_err());
        assert!(fixture.relay.submitted().is_empty());
    }

    #[test]
    fn approved_delete_retry_and_restart_reuse_one_frozen_event() {
        let fixture = publisher_fixture([FakeSubmitResult::Unknown, FakeSubmitResult::Accepted]);
        let target = fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let request = approved_delete_request(
            &fixture.request,
            "delete-restart",
            Hex64::parse(target.id.to_hex()).unwrap(),
        );
        let approval = exact_test_approval(&request);
        assert!(fixture
            .publisher
            .stage_approved_and_publish(request.clone(), &approval, &fixture.authority)
            .is_err());
        fixture
            .publisher
            .reconcile_one_on_start()
            .expect("restart reconciliation");
        let submitted = fixture.relay.submitted();
        assert_eq!(submitted.len(), 2);
        assert_eq!(submitted[0], submitted[1]);

        let replay = fixture
            .publisher
            .stage_approved_and_publish(request, &approval, &fixture.authority)
            .expect("accepted replay");
        assert_eq!(replay.state, "accepted");
        assert_eq!(fixture.relay.submitted().len(), 2);
    }

    #[test]
    fn foreign_message_edits_and_foreign_reaction_removal_fail_before_signing() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let resident_pubkey = fixture.request.resident_pubkey.as_str();
        let events = fixture.relay.events();
        let resident_message = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() == resident_pubkey
            })
            .unwrap();
        let foreign_message = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND) && event.pubkey.to_hex() != resident_pubkey
            })
            .unwrap();
        let foreign_reaction = events
            .iter()
            .find(|event| {
                event.kind == Kind::Custom(REACTION_KIND)
                    && event.pubkey.to_hex() != resident_pubkey
            })
            .unwrap();

        let edit = request_with_operation(
            &fixture.request,
            "foreign-edit",
            CommunicationOperationV1::EditOwnMessage {
                target_event_id: Hex64::parse(foreign_message.id.to_hex()).unwrap(),
                replacement_body: "denied".to_owned(),
                artifact_handles: Vec::new(),
            },
        );
        assert!(fixture
            .publisher
            .stage_and_publish(edit, &fixture.authority)
            .is_err());

        let remove = request_with_operation(
            &fixture.request,
            "foreign-remove",
            CommunicationOperationV1::RemoveOwnReaction {
                target_event_id: Hex64::parse(resident_message.id.to_hex()).unwrap(),
                reaction_event_id: Hex64::parse(foreign_reaction.id.to_hex()).unwrap(),
            },
        );
        assert!(fixture
            .publisher
            .stage_and_publish(remove, &fixture.authority)
            .is_err());
        assert!(fixture.relay.submitted().is_empty());
    }

    #[test]
    fn visible_one_hop_activation_is_staged_before_relay_and_retry_is_idempotent() {
        let relay_keys = keys("51");
        let owner_keys = keys("52");
        let source_keys = keys("53");
        let target_keys = keys("54");
        let owner_pubkey = Hex64::parse(owner_keys.public_key().to_hex()).unwrap();
        let source_pubkey = Hex64::parse(source_keys.public_key().to_hex()).unwrap();
        let target_pubkey = Hex64::parse(target_keys.public_key().to_hex()).unwrap();
        let conversation_id = OpaqueId::parse("56565656-5656-4565-8565-565656565656").unwrap();
        let membership_event = membership_event(
            &relay_keys,
            conversation_id.as_str(),
            &[&owner_keys, &source_keys, &target_keys],
            100,
        );
        let relay = FakeRelay::new(
            &relay_keys,
            vec![membership_event],
            [FakeSubmitResult::Unknown, FakeSubmitResult::Accepted],
        );
        let directory = tempfile::tempdir().unwrap();
        let trigger = EventBuilder::new(Kind::Custom(MESSAGE_KIND), "Coordinate visibly")
            .tags([
                Tag::parse(["h", conversation_id.as_str()]).unwrap(),
                Tag::public_key(source_keys.public_key()),
            ])
            .custom_created_at(Timestamp::from(unix_now().unwrap()))
            .sign_with_keys(&owner_keys)
            .unwrap();
        let dispatch_store = Arc::new(Mutex::new(
            super::super::managed_dispatch_store::ManagedDispatchStore::load(
                directory.path().join("dispatches.json"),
            )
            .unwrap(),
        ));
        {
            let mut store = dispatch_store.lock().unwrap();
            store
                .stage_owner_event(
                    &trigger,
                    &[source_pubkey.as_str().to_owned()],
                    unix_now().unwrap(),
                )
                .unwrap();
            store.activate_session(source_pubkey.as_str(), 4).unwrap();
            store
                .bind_communication_turn_start(
                    &trigger.id.to_hex(),
                    source_pubkey.as_str(),
                    conversation_id.as_str(),
                    4,
                    unix_now().unwrap(),
                )
                .unwrap();
        }
        let session = OpaqueId::parse("installation-activation-test").unwrap();
        let vault = CommunicationEventVault::open(
            directory.path().join("vault"),
            SecretString::from("test-vault-passphrase"),
            source_pubkey.clone(),
        )
        .unwrap();
        let publisher = ExistingConversationPublisher::relay_with_dispatch_for_tests(
            source_keys,
            SafeU53::new(4).unwrap(),
            session.clone(),
            CommunicationActionOutbox::new(session),
            vault,
            relay.clone(),
            dispatch_store.clone(),
        );
        let membership = publisher.membership(&conversation_id).unwrap();
        let trigger_id = OpaqueId::parse(trigger.id.to_hex()).unwrap();
        let runtime_binding_ref = Sha256Ref::parse(format!("sha256:{}", "5".repeat(64))).unwrap();
        let expiry = CanonicalTimestamp::parse(
            DateTime::<Utc>::from_timestamp((unix_now().unwrap() + 30 * 60) as i64, 0)
                .unwrap()
                .to_rfc3339_opts(SecondsFormat::Secs, true),
        )
        .unwrap();
        let authority = CommunicationTurnAuthoritySnapshot {
            owner_pubkey: owner_pubkey.clone(),
            resident_pubkey: source_pubkey.clone(),
            session_epoch: SafeU53::new(4).unwrap(),
            runtime_binding_ref: runtime_binding_ref.clone(),
            coordinates: super::super::communication_bridge::CommunicationTurnCoordinates {
                source_conversation_id: conversation_id.clone(),
                turn_id: trigger_id.clone(),
                dispatch_receipt_id: trigger_id.clone(),
                cancellation_epoch: SafeU53::new(4).unwrap(),
            },
            causal_root_id: trigger_id.clone(),
            owned_resident_pubkeys: [source_pubkey.clone(), target_pubkey.clone()]
                .into_iter()
                .collect(),
            expires_at: expiry.clone(),
        };
        let mut request = CommunicationActionRequestV1 {
            protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
            action_id: OpaqueId::parse("communication-visible-activation").unwrap(),
            idempotency_key: Hex64::parse("0".repeat(64)).unwrap(),
            action_fingerprint: Sha256Ref::parse(format!("sha256:{}", "0".repeat(64))).unwrap(),
            actor_pubkey: source_pubkey.clone(),
            owner_pubkey,
            resident_pubkey: source_pubkey,
            session_epoch: SafeU53::new(4).unwrap(),
            runtime_binding_ref,
            source_conversation_id: conversation_id.clone(),
            destination: CommunicationDestinationV1::ExistingConversation {
                conversation_id,
                participant_set_version: membership.participant_set_version,
                participant_set_ref: membership.participant_set_ref,
            },
            turn_id: trigger_id.clone(),
            dispatch_receipt_id: trigger_id.clone(),
            causal_root_id: trigger_id,
            causal_parent_action_id: None,
            causal_depth: SafeU53::new(0).unwrap(),
            cancellation_epoch: SafeU53::new(4).unwrap(),
            expires_at: expiry,
            approval_id: None,
            operation: CommunicationOperationV1::SendMessage {
                body: "Please respond here.".to_owned(),
                reply_to_event_id: None,
                mention_pubkeys: vec![target_pubkey.clone()],
                activation_pubkeys: vec![target_pubkey.clone()],
                artifact_handles: Vec::new(),
            },
        };
        request.action_fingerprint = request.derive_action_fingerprint().unwrap();
        request.idempotency_key = request.derive_idempotency_key().unwrap();

        assert!(publisher
            .stage_and_publish(request.clone(), &authority)
            .is_err());
        let first_event = Event::from_json(&relay.submitted()[0]).unwrap();

        let staged = publisher.stage_and_publish(request, &authority).unwrap();
        assert_eq!(staged.state, "accepted");
        assert_eq!(relay.submitted().len(), 2);
        assert_eq!(relay.submitted()[0], relay.submitted()[1]);
        let child = {
            let mut store = dispatch_store.lock().unwrap();
            store.activate_session(target_pubkey.as_str(), 9).unwrap();
            store
                .bind_communication_turn_start(
                    &first_event.id.to_hex(),
                    target_pubkey.as_str(),
                    authority.coordinates.source_conversation_id.as_str(),
                    9,
                    unix_now().unwrap(),
                )
                .unwrap()
        };
        assert_eq!(child.descendant_depth, 1);
        assert_eq!(
            child.source_dispatch_id.as_deref(),
            Some(authority.coordinates.dispatch_receipt_id.as_str())
        );
        assert_eq!(
            child.resolved_p_tags,
            vec![authority.resident_pubkey.as_str()]
        );
    }

    #[test]
    fn publication_unknown_retry_reuses_identical_frozen_event() {
        let fixture = publisher_fixture([FakeSubmitResult::Unknown, FakeSubmitResult::Accepted]);
        assert!(fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .is_err());
        let accepted = fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .unwrap();
        assert_eq!(accepted.state, "accepted");
        let submitted = fixture.relay.submitted();
        assert_eq!(submitted.len(), 2);
        assert_eq!(submitted[0], submitted[1]);
        let first = Event::from_json(&submitted[0]).unwrap();
        let second = Event::from_json(&submitted[1]).unwrap();
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn reaction_retry_and_restart_reuse_the_exact_frozen_event() {
        let retry_fixture =
            publisher_fixture([FakeSubmitResult::Unknown, FakeSubmitResult::Accepted]);
        let target = retry_fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == retry_fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let reaction = request_with_operation(
            &retry_fixture.request,
            "retry-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: Hex64::parse(target.id.to_hex()).unwrap(),
                reaction: "+1".to_owned(),
            },
        );
        assert!(retry_fixture
            .publisher
            .stage_and_publish(reaction.clone(), &retry_fixture.authority)
            .is_err());
        let accepted = retry_fixture
            .publisher
            .stage_and_publish(reaction, &retry_fixture.authority)
            .expect("retry exact reaction");
        assert_eq!(accepted.state, "accepted");
        let retry_submitted = retry_fixture.relay.submitted();
        assert_eq!(retry_submitted.len(), 2);
        assert_eq!(retry_submitted[0], retry_submitted[1]);

        let restart_fixture =
            publisher_fixture([FakeSubmitResult::Unknown, FakeSubmitResult::Accepted]);
        let target = restart_fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == restart_fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let reaction = request_with_operation(
            &restart_fixture.request,
            "restart-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: Hex64::parse(target.id.to_hex()).unwrap(),
                reaction: "+1".to_owned(),
            },
        );
        assert!(restart_fixture
            .publisher
            .stage_and_publish(reaction, &restart_fixture.authority)
            .is_err());
        restart_fixture
            .publisher
            .reconcile_one_on_start()
            .expect("restart reconciliation");
        let restart_submitted = restart_fixture.relay.submitted();
        assert_eq!(restart_submitted.len(), 2);
        assert_eq!(restart_submitted[0], restart_submitted[1]);
    }

    #[test]
    fn restart_probe_accepts_an_already_published_reaction_without_resubmission() {
        let fixture = publisher_fixture([FakeSubmitResult::Unknown]);
        let target = fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let reaction = request_with_operation(
            &fixture.request,
            "present-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: Hex64::parse(target.id.to_hex()).unwrap(),
                reaction: "+1".to_owned(),
            },
        );
        assert!(fixture
            .publisher
            .stage_and_publish(reaction.clone(), &fixture.authority)
            .is_err());
        fixture
            .relay
            .set_probe_results([ExactEventProbeOutcome::Present]);
        fixture
            .publisher
            .reconcile_one_on_start()
            .expect("accept exact present reaction");
        assert_eq!(fixture.relay.submitted().len(), 1);
        let replay = fixture
            .publisher
            .stage_and_publish(reaction, &fixture.authority)
            .expect("replay accepted receipt");
        assert_eq!(replay.state, "accepted");
        assert_eq!(fixture.relay.submitted().len(), 1);
    }

    #[test]
    fn unknown_restart_probe_retains_the_frozen_reaction_without_resubmission() {
        let fixture = publisher_fixture([FakeSubmitResult::Unknown]);
        let target = fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let reaction = request_with_operation(
            &fixture.request,
            "unknown-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: Hex64::parse(target.id.to_hex()).unwrap(),
                reaction: "+1".to_owned(),
            },
        );
        assert!(fixture
            .publisher
            .stage_and_publish(reaction, &fixture.authority)
            .is_err());
        fixture
            .relay
            .set_probe_results([ExactEventProbeOutcome::Unknown]);
        fixture
            .publisher
            .reconcile_one_on_start()
            .expect("retain unknown exact reaction");
        assert_eq!(fixture.relay.submitted().len(), 1);
    }

    #[test]
    fn proven_absent_reaction_from_a_stale_session_is_cancelled_without_resubmission() {
        let mut fixture = publisher_fixture([FakeSubmitResult::Unknown]);
        let target = fixture
            .relay
            .events()
            .into_iter()
            .find(|event| {
                event.kind == Kind::Custom(MESSAGE_KIND)
                    && event.pubkey.to_hex() == fixture.request.resident_pubkey.as_str()
            })
            .expect("resident message");
        let reaction = request_with_operation(
            &fixture.request,
            "cancelled-stale-reaction",
            CommunicationOperationV1::AddReaction {
                target_event_id: Hex64::parse(target.id.to_hex()).unwrap(),
                reaction: "+1".to_owned(),
            },
        );
        assert!(fixture
            .publisher
            .stage_and_publish(reaction, &fixture.authority)
            .is_err());
        fixture
            .relay
            .set_probe_results([ExactEventProbeOutcome::Absent]);
        Arc::get_mut(&mut fixture.publisher)
            .expect("fixture owns the publisher")
            .current_session_epoch = SafeU53::new(5).unwrap();
        fixture
            .publisher
            .reconcile_one_on_start()
            .expect("cancel stale exact reaction after proven absence");
        assert_eq!(fixture.relay.submitted().len(), 1);
        assert!(fixture
            .publisher
            .stores
            .lock()
            .unwrap()
            .outbox
            .reconciliation_entries()
            .is_empty());
    }

    #[test]
    fn seal_before_prepare_crash_recovers_the_original_signed_event() {
        let fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let membership = fixture
            .publisher
            .membership(existing_conversation_id(&fixture.request).unwrap())
            .expect("membership");
        let frozen = build_exact_communication_event(
            &fixture.request,
            &fixture.publisher.resident_keys,
            &membership,
            fixture.publisher.relay.as_ref(),
            &[],
        )
        .expect("sign once");
        fixture
            .publisher
            .stores
            .lock()
            .unwrap()
            .vault
            .seal(&fixture.request, frozen.as_str())
            .expect("simulate vault commit before outbox prepare");

        let staged = fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .expect("recover and prepare frozen event");
        assert_eq!(staged.state, "accepted");
        assert_eq!(fixture.relay.submitted(), vec![frozen.to_string()]);
    }

    #[test]
    fn startup_reconciliation_resubmits_only_the_frozen_unknown_event() {
        let fixture = publisher_fixture([FakeSubmitResult::Unknown, FakeSubmitResult::Accepted]);
        assert!(fixture
            .publisher
            .stage_and_publish(fixture.request.clone(), &fixture.authority)
            .is_err());
        fixture.publisher.reconcile_one_on_start().unwrap();
        let submitted = fixture.relay.submitted();
        assert_eq!(submitted.len(), 2);
        assert_eq!(submitted[0], submitted[1]);
        let replay = fixture
            .publisher
            .stage_and_publish(fixture.request, &fixture.authority)
            .unwrap();
        assert_eq!(replay.state, "accepted");
        assert_eq!(fixture.relay.submitted().len(), 2);
    }

    #[test]
    fn wrong_participant_snapshot_fails_before_submission() {
        let mut fixture = publisher_fixture([FakeSubmitResult::Accepted]);
        let CommunicationDestinationV1::ExistingConversation {
            participant_set_version,
            ..
        } = &mut fixture.request.destination
        else {
            unreachable!();
        };
        *participant_set_version = SafeU53::new(participant_set_version.get() + 1).unwrap();
        fixture.request.action_fingerprint = fixture.request.derive_action_fingerprint().unwrap();
        fixture.request.idempotency_key = fixture.request.derive_idempotency_key().unwrap();
        assert!(fixture
            .publisher
            .stage_and_publish(fixture.request, &fixture.authority)
            .is_err());
        assert!(fixture.relay.submitted().is_empty());
    }
}

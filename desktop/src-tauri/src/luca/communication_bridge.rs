//! Trusted desktop bridge for turn-scoped resident communication.
//!
//! The restricted Communications MCP process can describe only six semantic
//! operations. This bridge authenticates the exact managed turn, rechecks the
//! process-local turn registry and durable dispatch state for every frame, and
//! resolves all identity, membership, artifact, signing, and publication
//! authority inside the desktop process.
//!
//! Resident-authored publications end at
//! [`CommunicationBrokerBackend::stage_action`]. Host-authorized DM resolution,
//! private-room creation, and same-owner membership reuse the existing desktop
//! operations through separate narrow backend methods; they cannot accept raw
//! events or signing material from the model descendant.

use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use chrono::{DateTime, SecondsFormat, Utc};
use luca_protocol::{
    canonical_sha256, CanonicalTimestamp, CommunicationActionRequestV1, CommunicationDestinationV1,
    CommunicationOperationV1, Hex64, OpaqueArtifactHandleV1, OpaqueId, SafeU53, Sha256Ref,
    COMMUNICATION_ACTION_PROTOCOL, MAX_COMMUNICATION_ARTIFACTS, MAX_COMMUNICATION_BODY_BYTES,
    MAX_COMMUNICATION_PARTICIPANTS, MAX_COMMUNICATION_REACTION_BYTES,
    MAX_COMMUNICATION_ROOM_LABEL_BYTES, MAX_COMMUNICATION_ROOM_METADATA_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::digest::Output;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, Manager};
use zeroize::{Zeroize, Zeroizing};

const BROKER_PROTOCOL: &str = "luca.communications.broker.v1";
const BROKER_RECEIPT_PROTOCOL: &str = "luca.communications.broker-receipt.v1";
const MAX_BROKER_FRAME_BYTES: usize = 768 * 1024;
const MAX_READ_RESULT_BYTES: usize = 512 * 1024;
const MAX_PAGE_ITEMS: usize = 256;
const MAX_CONCURRENT_CONNECTIONS: usize = 16;
const MAX_DM_PARTICIPANTS: usize = 9;

static NEXT_CAPABILITY_GENERATION: AtomicU64 = AtomicU64::new(1);

/// Session identity retained by the trusted desktop. No private key is ever
/// serialized into the MCP bootstrap or broker response.
#[derive(Clone)]
pub(crate) struct CommunicationBrokerContext {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) session_epoch: SafeU53,
    pub(crate) binding_ref: Sha256Ref,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommunicationsMcpBootstrapV1<'a> {
    protocol: &'static str,
    endpoint: &'a str,
    master_capability: &'a str,
    capability_generation: u64,
    resident_pubkey: &'a str,
    session_epoch: u64,
    binding_ref: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BrokerOperation {
    Inbox,
    Conversation,
    Send,
    React,
    Invite,
    CreatePrivateRoom,
}

impl BrokerOperation {
    fn parse(value: &str) -> Result<Self, BrokerFailure> {
        match value {
            "inbox" => Ok(Self::Inbox),
            "conversation" => Ok(Self::Conversation),
            "send" => Ok(Self::Send),
            "react" => Ok(Self::React),
            "invite" => Ok(Self::Invite),
            "create_private_room" => Ok(Self::CreatePrivateRoom),
            _ => Err(BrokerFailure::invalid_operation()),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Conversation => "conversation",
            Self::Send => "send",
            Self::React => "react",
            Self::Invite => "invite",
            Self::CreatePrivateRoom => "create_private_room",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CommunicationBrokerFrameV1 {
    protocol: String,
    capability: String,
    capability_generation: u64,
    source_conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
    operation_request_id: String,
    operation: String,
    arguments: Value,
}

#[derive(Serialize)]
struct CommunicationBrokerResponseV1 {
    protocol: &'static str,
    ok: bool,
    content: String,
    receipt: CommunicationBrokerReceiptV1,
}

#[derive(Serialize)]
struct CommunicationBrokerReceiptV1 {
    protocol: &'static str,
    receipt_id: String,
    operation: String,
    capability_generation: u64,
    source_conversation_id: String,
    turn_id: String,
    dispatch_receipt_id: String,
    cancellation_epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic_code: Option<&'static str>,
}

/// Exact coordinates rechecked against both active-turn authorities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationTurnCoordinates {
    pub(crate) source_conversation_id: OpaqueId,
    pub(crate) turn_id: OpaqueId,
    pub(crate) dispatch_receipt_id: OpaqueId,
    pub(crate) cancellation_epoch: SafeU53,
}

/// Body-free authority returned after a successful exact-turn recheck.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationTurnAuthoritySnapshot {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) session_epoch: SafeU53,
    pub(crate) runtime_binding_ref: Sha256Ref,
    pub(crate) coordinates: CommunicationTurnCoordinates,
    pub(crate) causal_root_id: OpaqueId,
    pub(crate) owned_resident_pubkeys: BTreeSet<Hex64>,
    pub(crate) expires_at: CanonicalTimestamp,
}

/// Exact owner-visible membership state for one relay conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationConversationAuthority {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) participant_pubkeys: BTreeSet<Hex64>,
    pub(crate) participant_set_version: SafeU53,
    pub(crate) agent_may_invite_same_owner: bool,
    pub(crate) read_only: bool,
}

impl CommunicationConversationAuthority {
    fn require_owner_visible_membership(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<(), BrokerFailure> {
        if !self.participant_pubkeys.contains(&authority.owner_pubkey)
            || !self
                .participant_pubkeys
                .contains(&authority.resident_pubkey)
        {
            return Err(BrokerFailure::membership_denied());
        }
        Ok(())
    }

    fn require_internal_write(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<(), BrokerFailure> {
        self.require_owner_visible_membership(authority)?;
        if self.read_only {
            return Err(BrokerFailure::read_only());
        }
        if self.participant_pubkeys.iter().any(|participant| {
            participant != &authority.owner_pubkey
                && !authority.owned_resident_pubkeys.contains(participant)
        }) {
            // External delivery requires a separately frozen one-shot owner
            // approval. That binding is intentionally not representable by
            // the five restricted MCP operations yet.
            return Err(BrokerFailure::approval_required());
        }
        Ok(())
    }

    fn destination(&self) -> Result<CommunicationDestinationV1, BrokerFailure> {
        let participants = self.participant_pubkeys.iter().cloned().collect::<Vec<_>>();
        Ok(CommunicationDestinationV1::ExistingConversation {
            conversation_id: self.conversation_id.clone(),
            participant_set_version: self.participant_set_version,
            participant_set_ref: participant_set_ref(&participants)?,
        })
    }
}

/// A read is always scoped to the exact acting resident. Implementations may
/// query the relay, but must return only canonical items visible to this scope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationReadScope {
    pub(crate) owner_pubkey: Hex64,
    pub(crate) resident_pubkey: Hex64,
    pub(crate) source_conversation_id: OpaqueId,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommunicationInboxCategory {
    #[default]
    All,
    Direct,
    Mentions,
    Threads,
    NeedsAction,
    Agents,
    Reminders,
    Drafts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationInboxQuery {
    pub(crate) category: CommunicationInboxCategory,
    pub(crate) cursor: Option<OpaqueId>,
    pub(crate) limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommunicationConversationQuery {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) thread_root_event_id: Option<Hex64>,
    pub(crate) cursor: Option<OpaqueId>,
    pub(crate) limit: usize,
}

/// Body-free proof that a semantic action was durably staged. A successful
/// value may be returned only after the sealed-event vault and encrypted
/// communication action outbox both accepted the exact action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StagedCommunicationAction {
    pub(crate) action_id: OpaqueId,
    pub(crate) idempotency_key: Hex64,
    pub(crate) state: &'static str,
}

/// Body-free result from one existing host-authorized conversation operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedConversationMutation {
    pub(crate) conversation_id: OpaqueId,
    pub(crate) state: &'static str,
}

/// Trusted desktop integration seam. There is deliberately no `publish`
/// method: mutating operations must pass through the durable action outbox.
pub(crate) trait CommunicationBrokerBackend: Send + Sync + 'static {
    fn read_inbox(
        &self,
        scope: &CommunicationReadScope,
        query: &CommunicationInboxQuery,
    ) -> Result<Value, BrokerFailure>;

    fn read_conversation(
        &self,
        scope: &CommunicationReadScope,
        query: &CommunicationConversationQuery,
    ) -> Result<Value, BrokerFailure>;

    fn conversation_authority(
        &self,
        scope: &CommunicationReadScope,
        conversation_id: &OpaqueId,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure>;

    /// Open or reuse the exact owner-visible direct participant set and return
    /// its canonical membership snapshot.
    fn resolve_direct_conversation(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<CommunicationConversationAuthority, BrokerFailure>;

    /// Create or recover one deterministic owner-visible private room through
    /// the existing owner channel and membership operations.
    fn create_private_room(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        label: &str,
        purpose: Option<&str>,
        participant_pubkeys: &BTreeSet<Hex64>,
    ) -> Result<ManagedConversationMutation, BrokerFailure>;

    /// Add one locally verified same-owner resident through the existing room
    /// or DM membership operation. Activation is deliberately not represented.
    fn invite_same_owner_resident(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        participant_pubkey: &Hex64,
    ) -> Result<ManagedConversationMutation, BrokerFailure>;

    fn resolve_artifact_handles(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: Option<&OpaqueId>,
        handle_ids: &[OpaqueId],
    ) -> Result<Vec<OpaqueArtifactHandleV1>, BrokerFailure>;

    fn require_event_in_conversation(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        event_id: &Hex64,
    ) -> Result<(), BrokerFailure>;

    fn reaction_author(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        conversation_id: &OpaqueId,
        reaction_event_id: &Hex64,
    ) -> Result<Hex64, BrokerFailure>;

    /// Seal/sign the exact semantic request and prepare it in the encrypted
    /// `CommunicationActionOutbox` before any relay I/O. Returning success for
    /// an untracked or directly published side effect violates this contract.
    fn stage_action(
        &self,
        request: CommunicationActionRequestV1,
        expected_authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<StagedCommunicationAction, BrokerFailure>;
}

trait CommunicationTurnAuthority: Send + Sync + 'static {
    fn recheck(
        &self,
        context: &CommunicationBrokerContext,
        coordinates: &CommunicationTurnCoordinates,
    ) -> Result<CommunicationTurnAuthoritySnapshot, BrokerFailure>;
}

struct DesktopCommunicationTurnAuthority {
    app: AppHandle,
}

/// Recheck the exact desktop authority immediately before a backend seals and
/// prepares an action, or before a publisher submits a prepared outbox row.
///
/// Backends must call this at those boundaries. A successful earlier broker
/// parse is never sufficient because cancellation and runtime replacement can
/// race event construction and relay submission.
pub(crate) fn recheck_desktop_communication_authority(
    app: &AppHandle,
    expected: &CommunicationTurnAuthoritySnapshot,
) -> Result<(), BrokerFailure> {
    let context = CommunicationBrokerContext {
        owner_pubkey: expected.owner_pubkey.clone(),
        resident_pubkey: expected.resident_pubkey.clone(),
        session_epoch: expected.session_epoch,
        binding_ref: expected.runtime_binding_ref.clone(),
    };
    let actual = DesktopCommunicationTurnAuthority { app: app.clone() }
        .recheck(&context, &expected.coordinates)?;
    require_exact_authority(&context, &expected.coordinates, &actual)?;
    if actual != *expected {
        return Err(BrokerFailure::stale_turn());
    }
    Ok(())
}

impl CommunicationTurnAuthority for DesktopCommunicationTurnAuthority {
    fn recheck(
        &self,
        context: &CommunicationBrokerContext,
        coordinates: &CommunicationTurnCoordinates,
    ) -> Result<CommunicationTurnAuthoritySnapshot, BrokerFailure> {
        if coordinates.cancellation_epoch != context.session_epoch {
            return Err(BrokerFailure::stale_turn());
        }

        super::communication_turn_registry::authorize(
            context.resident_pubkey.as_str(),
            context.session_epoch.get(),
            coordinates.source_conversation_id.as_str(),
            coordinates.turn_id.as_str(),
            coordinates.dispatch_receipt_id.as_str(),
        )
        .map_err(|_| BrokerFailure::turn_not_active())?;

        let now_unix_secs = unix_now()?;
        let dispatch_store = super::managed_dispatch_store::global_dispatch_store(&self.app)
            .map_err(|_| BrokerFailure::authority_unavailable())?;
        let dispatch = dispatch_store
            .lock()
            .map_err(|_| BrokerFailure::authority_unavailable())?
            .recheck_communication_turn(
                coordinates.dispatch_receipt_id.as_str(),
                context.resident_pubkey.as_str(),
                coordinates.source_conversation_id.as_str(),
                context.session_epoch.get(),
                now_unix_secs,
            )
            .map_err(|_| BrokerFailure::turn_not_active())?
            .clone();

        if dispatch.trigger_event_id != coordinates.dispatch_receipt_id.as_str()
            || dispatch.owner_pubkey != context.owner_pubkey.as_str()
            || dispatch.resident_pubkey != context.resident_pubkey.as_str()
            || dispatch.conversation_id != coordinates.source_conversation_id.as_str()
            || dispatch.session_epoch != Some(context.session_epoch.get())
        {
            return Err(BrokerFailure::stale_turn());
        }

        let state = self.app.state::<crate::app_state::AppState>();
        let owner_keys = state
            .signing_keys()
            .map_err(|_| BrokerFailure::custody_unavailable())?;
        if owner_keys.public_key().to_hex() != context.owner_pubkey.as_str() {
            return Err(BrokerFailure::custody_denied());
        }
        let owned_resident_pubkeys = verified_owned_residents(&self.app)?;
        if !owned_resident_pubkeys.contains(&context.resident_pubkey) {
            return Err(BrokerFailure::custody_denied());
        }

        Ok(CommunicationTurnAuthoritySnapshot {
            owner_pubkey: context.owner_pubkey.clone(),
            resident_pubkey: context.resident_pubkey.clone(),
            session_epoch: context.session_epoch,
            runtime_binding_ref: context.binding_ref.clone(),
            coordinates: coordinates.clone(),
            causal_root_id: OpaqueId::parse(
                dispatch
                    .causal_root_event_id
                    .clone()
                    .unwrap_or_else(|| dispatch.trigger_event_id.clone()),
            )
            .map_err(|_| BrokerFailure::stale_turn())?,
            owned_resident_pubkeys,
            expires_at: canonical_timestamp(dispatch.expires_at)?,
        })
    }
}

struct CommunicationBridgeCore {
    active: Arc<AtomicBool>,
    context: CommunicationBrokerContext,
    master_capability: Zeroizing<String>,
    capability_generation: SafeU53,
    authority: Arc<dyn CommunicationTurnAuthority>,
    backend: Arc<dyn CommunicationBrokerBackend>,
}

impl CommunicationBridgeCore {
    fn handle_frame(&self, frame: CommunicationBrokerFrameV1) -> CommunicationBrokerResponseV1 {
        let operation = match BrokerOperation::parse(&frame.operation) {
            Ok(operation) => operation,
            Err(failure) => return self.failure_response(&frame, failure),
        };
        match self.handle_frame_inner(operation, &frame) {
            Ok(content) => self.success_response(&frame, operation, content),
            Err(failure) => self.failure_response(&frame, failure),
        }
    }

    fn handle_frame_inner(
        &self,
        operation: BrokerOperation,
        frame: &CommunicationBrokerFrameV1,
    ) -> Result<String, BrokerFailure> {
        if !self.active.load(Ordering::SeqCst)
            || frame.protocol != BROKER_PROTOCOL
            || frame.capability_generation != self.capability_generation.get()
        {
            return Err(BrokerFailure::stale_capability());
        }
        let coordinates = parse_coordinates(frame)?;
        let operation_request_id = OpaqueId::parse(frame.operation_request_id.clone())
            .map_err(|_| BrokerFailure::invalid_arguments())?;
        let expected = derive_turn_capability(
            self.master_capability.as_str(),
            self.capability_generation,
            &self.context.resident_pubkey,
            self.context.session_epoch,
            &self.context.binding_ref,
            &coordinates,
        );
        if !constant_time_eq(frame.capability.as_bytes(), expected.as_bytes()) {
            return Err(BrokerFailure::stale_capability());
        }

        // Every frame, including read-only frames, crosses both the
        // process-local active-turn registry and the durable dispatch store.
        let authority = self.authority.recheck(&self.context, &coordinates)?;
        require_exact_authority(&self.context, &coordinates, &authority)?;

        let result = match operation {
            BrokerOperation::Inbox => self.handle_inbox(authority, frame.arguments.clone()),
            BrokerOperation::Conversation => {
                self.handle_conversation(authority, frame.arguments.clone())
            }
            BrokerOperation::Send => {
                self.handle_send(authority, &operation_request_id, frame.arguments.clone())
            }
            BrokerOperation::React => {
                self.handle_react(authority, &operation_request_id, frame.arguments.clone())
            }
            BrokerOperation::Invite => {
                self.handle_invite(authority, &operation_request_id, frame.arguments.clone())
            }
            BrokerOperation::CreatePrivateRoom => self.handle_create_private_room(
                authority,
                &operation_request_id,
                frame.arguments.clone(),
            ),
        }?;
        if result.len() > MAX_READ_RESULT_BYTES {
            return Err(BrokerFailure::response_too_large());
        }
        Ok(result)
    }

    fn handle_inbox(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawInboxParams = parse_arguments(arguments)?;
        let query = CommunicationInboxQuery {
            category: raw.category,
            cursor: parse_optional_opaque(raw.cursor)?,
            limit: bounded_limit(raw.limit)?,
        };
        let content = self.backend.read_inbox(&read_scope(&authority), &query)?;
        serialize_read_result(content)
    }

    fn handle_conversation(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawConversationParams = parse_arguments(arguments)?;
        let conversation_id = raw
            .conversation_id
            .map(OpaqueId::parse)
            .transpose()
            .map_err(|_| BrokerFailure::invalid_arguments())?
            .unwrap_or_else(|| authority.coordinates.source_conversation_id.clone());
        let conversation = self
            .backend
            .conversation_authority(&read_scope(&authority), &conversation_id)?;
        conversation.require_owner_visible_membership(&authority)?;
        let query = CommunicationConversationQuery {
            conversation_id,
            thread_root_event_id: parse_optional_hex(raw.thread_root_event_id)?,
            cursor: parse_optional_opaque(raw.cursor)?,
            limit: bounded_limit(raw.limit)?,
        };
        let content = self
            .backend
            .read_conversation(&read_scope(&authority), &query)?;
        serialize_read_result(content)
    }

    fn handle_send(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawSendParams = parse_arguments(arguments)?;
        validate_message_body(&raw.body, &raw.artifact_handle_ids)?;
        let mention_pubkeys = sorted_pubkeys(raw.mention_pubkeys)?;
        let activation_pubkeys = sorted_pubkeys(raw.activation_pubkeys)?;
        if !activation_pubkeys.is_empty()
            && authority.causal_root_id != authority.coordinates.dispatch_receipt_id
        {
            // A one-hop descendant may reply visibly but cannot activate a
            // further resident. This is enforced before destination mutation.
            return Err(BrokerFailure::approval_required());
        }
        if activation_pubkeys
            .iter()
            .any(|pubkey| mention_pubkeys.binary_search(pubkey).is_err())
        {
            return Err(BrokerFailure::invalid_arguments());
        }
        let (destination, conversation_id, participants) =
            self.resolve_send_destination(&authority, raw.destination)?;
        if mention_pubkeys
            .iter()
            .any(|pubkey| !participants.contains(pubkey))
            || activation_pubkeys.iter().any(|pubkey| {
                pubkey == &authority.owner_pubkey
                    || pubkey == &authority.resident_pubkey
                    || !authority.owned_resident_pubkeys.contains(pubkey)
            })
        {
            return Err(BrokerFailure::membership_denied());
        }

        let reply_to_event_id = match raw.reply {
            None => None,
            Some(RawReplyTarget::Message { event_id }) => Some(parse_hex(event_id)?),
            Some(RawReplyTarget::Thread {
                thread_root_event_id,
                reply_to_event_id,
            }) => Some(match reply_to_event_id {
                Some(reply) => parse_hex(reply)?,
                None => parse_hex(thread_root_event_id)?,
            }),
        };
        if let (Some(conversation_id), Some(event_id)) =
            (conversation_id.as_ref(), reply_to_event_id.as_ref())
        {
            self.backend
                .require_event_in_conversation(&authority, conversation_id, event_id)?;
        } else if reply_to_event_id.is_some() {
            return Err(BrokerFailure::invalid_arguments());
        }

        let requested_handles = sorted_opaque_ids(raw.artifact_handle_ids)?;
        if requested_handles.len() > MAX_COMMUNICATION_ARTIFACTS {
            return Err(BrokerFailure::invalid_arguments());
        }
        let mut artifact_handles = self.backend.resolve_artifact_handles(
            &authority,
            conversation_id.as_ref(),
            &requested_handles,
        )?;
        artifact_handles.sort_by(|left, right| left.handle_id.cmp(&right.handle_id));
        if artifact_handles
            .iter()
            .map(|handle| &handle.handle_id)
            .ne(requested_handles.iter())
        {
            return Err(BrokerFailure::artifact_denied());
        }

        let operation = CommunicationOperationV1::SendMessage {
            body: raw.body,
            reply_to_event_id,
            mention_pubkeys,
            activation_pubkeys,
            artifact_handles,
        };
        self.stage_request(authority, operation_request_id, destination, operation)
    }

    fn handle_react(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawReactParams = parse_arguments(arguments)?;
        let conversation_id = raw
            .conversation_id
            .map(OpaqueId::parse)
            .transpose()
            .map_err(|_| BrokerFailure::invalid_arguments())?
            .unwrap_or_else(|| authority.coordinates.source_conversation_id.clone());
        let conversation = self
            .backend
            .conversation_authority(&read_scope(&authority), &conversation_id)?;
        conversation.require_internal_write(&authority)?;
        let operation = match raw.mutation {
            RawReactionMutation::Add {
                target_event_id,
                reaction,
            } => {
                let target_event_id = parse_hex(target_event_id)?;
                validate_reaction(&reaction)?;
                self.backend.require_event_in_conversation(
                    &authority,
                    &conversation_id,
                    &target_event_id,
                )?;
                CommunicationOperationV1::AddReaction {
                    target_event_id,
                    reaction,
                }
            }
            RawReactionMutation::Remove {
                target_event_id,
                reaction_event_id,
            } => {
                let target_event_id = parse_hex(target_event_id)?;
                let reaction_event_id = parse_hex(reaction_event_id)?;
                self.backend.require_event_in_conversation(
                    &authority,
                    &conversation_id,
                    &target_event_id,
                )?;
                let author = self.backend.reaction_author(
                    &authority,
                    &conversation_id,
                    &reaction_event_id,
                )?;
                if author != authority.resident_pubkey {
                    return Err(BrokerFailure::authorship_denied());
                }
                CommunicationOperationV1::RemoveOwnReaction {
                    target_event_id,
                    reaction_event_id,
                }
            }
        };
        self.stage_request(
            authority,
            operation_request_id,
            conversation.destination()?,
            operation,
        )
    }

    fn handle_invite(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        _operation_request_id: &OpaqueId,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawInviteParams = parse_arguments(arguments)?;
        if raw.request_activation {
            // COM-103 owns explicit activation. COM-102 must not imply that a
            // successful membership mutation activated another resident.
            return Err(BrokerFailure::operation_not_implemented());
        }
        let participant_pubkey = parse_hex(raw.participant_pubkey)?;
        if participant_pubkey == authority.owner_pubkey
            || participant_pubkey == authority.resident_pubkey
            || !authority
                .owned_resident_pubkeys
                .contains(&participant_pubkey)
        {
            return Err(BrokerFailure::same_owner_required());
        }
        let conversation_id = raw
            .conversation_id
            .map(OpaqueId::parse)
            .transpose()
            .map_err(|_| BrokerFailure::invalid_arguments())?
            .unwrap_or_else(|| authority.coordinates.source_conversation_id.clone());
        let conversation = self
            .backend
            .conversation_authority(&read_scope(&authority), &conversation_id)?;
        conversation.require_internal_write(&authority)?;
        if !conversation.agent_may_invite_same_owner {
            return Err(BrokerFailure::membership_denied());
        }
        if conversation
            .participant_pubkeys
            .contains(&participant_pubkey)
        {
            return serialize_read_result(serde_json::json!({
                "conversation_id": conversation_id.as_str(),
                "membership": "already_member",
                "activation": "not_requested",
            }));
        }
        let rechecked = self.recheck_exact_authority(&authority)?;
        let result = self.backend.invite_same_owner_resident(
            &rechecked,
            &conversation_id,
            &participant_pubkey,
        )?;
        if !matches!(result.state, "member_added_or_present") {
            return Err(BrokerFailure::managed_operation_failed());
        }
        serialize_read_result(serde_json::json!({
            "conversation_id": result.conversation_id.as_str(),
            "membership": result.state,
            "activation": "not_requested",
        }))
    }

    fn handle_create_private_room(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        arguments: Value,
    ) -> Result<String, BrokerFailure> {
        let raw: RawCreatePrivateRoomParams = parse_arguments(arguments)?;
        validate_bounded_text(&raw.label, MAX_COMMUNICATION_ROOM_LABEL_BYTES)?;
        if let Some(purpose) = raw.purpose.as_deref() {
            validate_bounded_text(purpose, MAX_COMMUNICATION_ROOM_METADATA_BYTES)?;
        }
        let additional = sorted_pubkeys(raw.participant_pubkeys)?;
        if additional.contains(&authority.owner_pubkey)
            || additional.contains(&authority.resident_pubkey)
        {
            return Err(BrokerFailure::invalid_arguments());
        }
        if additional
            .iter()
            .any(|pubkey| !authority.owned_resident_pubkeys.contains(pubkey))
        {
            return Err(BrokerFailure::same_owner_required());
        }
        let mut participants = additional.into_iter().collect::<BTreeSet<_>>();
        participants.insert(authority.owner_pubkey.clone());
        participants.insert(authority.resident_pubkey.clone());
        if participants.len() > MAX_COMMUNICATION_PARTICIPANTS {
            return Err(BrokerFailure::invalid_arguments());
        }

        let rechecked = self.recheck_exact_authority(&authority)?;
        let result = self.backend.create_private_room(
            &rechecked,
            operation_request_id,
            &raw.label,
            raw.purpose.as_deref(),
            &participants,
        )?;
        if !matches!(result.state, "created_or_existing") {
            return Err(BrokerFailure::managed_operation_failed());
        }
        serialize_read_result(serde_json::json!({
            "conversation_id": result.conversation_id.as_str(),
            "room": result.state,
        }))
    }

    fn resolve_send_destination(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
        selector: RawDestination,
    ) -> Result<
        (
            CommunicationDestinationV1,
            Option<OpaqueId>,
            BTreeSet<Hex64>,
        ),
        BrokerFailure,
    > {
        match selector {
            RawDestination::CurrentConversation => {
                let conversation_id = authority.coordinates.source_conversation_id.clone();
                let conversation = self
                    .backend
                    .conversation_authority(&read_scope(authority), &conversation_id)?;
                conversation.require_internal_write(authority)?;
                let participants = conversation.participant_pubkeys.clone();
                Ok((
                    conversation.destination()?,
                    Some(conversation_id),
                    participants,
                ))
            }
            RawDestination::ExistingConversation { conversation_id } => {
                let conversation_id = OpaqueId::parse(conversation_id)
                    .map_err(|_| BrokerFailure::invalid_arguments())?;
                let conversation = self
                    .backend
                    .conversation_authority(&read_scope(authority), &conversation_id)?;
                conversation.require_internal_write(authority)?;
                let participants = conversation.participant_pubkeys.clone();
                Ok((
                    conversation.destination()?,
                    Some(conversation_id),
                    participants,
                ))
            }
            RawDestination::DirectParticipants {
                participant_pubkeys,
            } => {
                let mut participants = sorted_pubkeys(participant_pubkeys)?
                    .into_iter()
                    .collect::<BTreeSet<_>>();
                participants.insert(authority.owner_pubkey.clone());
                participants.insert(authority.resident_pubkey.clone());
                if participants.len() > MAX_DM_PARTICIPANTS {
                    return Err(BrokerFailure::invalid_arguments());
                }
                if participants.iter().any(|participant| {
                    participant != &authority.owner_pubkey
                        && !authority.owned_resident_pubkeys.contains(participant)
                }) {
                    return Err(BrokerFailure::same_owner_required());
                }
                let rechecked = self.recheck_exact_authority(authority)?;
                let conversation = self
                    .backend
                    .resolve_direct_conversation(&rechecked, &participants)?;
                conversation.require_internal_write(&rechecked)?;
                if conversation.participant_pubkeys != participants {
                    return Err(BrokerFailure::membership_denied());
                }
                let conversation_id = conversation.conversation_id.clone();
                Ok((
                    conversation.destination()?,
                    Some(conversation_id),
                    participants,
                ))
            }
        }
    }

    fn recheck_exact_authority(
        &self,
        authority: &CommunicationTurnAuthoritySnapshot,
    ) -> Result<CommunicationTurnAuthoritySnapshot, BrokerFailure> {
        let rechecked = self
            .authority
            .recheck(&self.context, &authority.coordinates)?;
        require_exact_authority(&self.context, &authority.coordinates, &rechecked)?;
        if &rechecked != authority {
            return Err(BrokerFailure::stale_turn());
        }
        Ok(rechecked)
    }

    fn stage_request(
        &self,
        authority: CommunicationTurnAuthoritySnapshot,
        operation_request_id: &OpaqueId,
        destination: CommunicationDestinationV1,
        operation: CommunicationOperationV1,
    ) -> Result<String, BrokerFailure> {
        if operation.always_requires_approval() {
            return Err(BrokerFailure::approval_required());
        }
        let request =
            build_action_request(&authority, operation_request_id, destination, operation)?;

        // Cancellation, turn completion, runtime replacement, membership, and
        // custody can race semantic resolution. Recheck the exact tuple again
        // immediately before handing the action to durable staging.
        let rechecked = self.recheck_exact_authority(&authority)?;
        let activation_requested = !request.operation.activation_pubkeys().is_empty();
        let staged = self.backend.stage_action(request.clone(), &rechecked)?;
        if staged.action_id != request.action_id
            || staged.idempotency_key != request.idempotency_key
            || !matches!(staged.state, "prepared" | "accepted" | "already_prepared")
        {
            return Err(BrokerFailure::outbox_unavailable());
        }
        Ok(if activation_requested {
            "Communication delivery and one-hop activation were requested and durably staged."
                .into()
        } else {
            "Communication action was durably staged.".into()
        })
    }

    fn success_response(
        &self,
        frame: &CommunicationBrokerFrameV1,
        operation: BrokerOperation,
        content: String,
    ) -> CommunicationBrokerResponseV1 {
        CommunicationBrokerResponseV1 {
            protocol: BROKER_PROTOCOL,
            ok: true,
            content,
            receipt: self.receipt(frame, operation.as_str(), None),
        }
    }

    fn failure_response(
        &self,
        frame: &CommunicationBrokerFrameV1,
        failure: BrokerFailure,
    ) -> CommunicationBrokerResponseV1 {
        CommunicationBrokerResponseV1 {
            protocol: BROKER_PROTOCOL,
            ok: false,
            content: failure.user_message.into(),
            receipt: self.receipt(frame, &frame.operation, Some(failure.code)),
        }
    }

    fn receipt(
        &self,
        frame: &CommunicationBrokerFrameV1,
        operation: &str,
        diagnostic_code: Option<&'static str>,
    ) -> CommunicationBrokerReceiptV1 {
        CommunicationBrokerReceiptV1 {
            protocol: BROKER_RECEIPT_PROTOCOL,
            receipt_id: receipt_id(frame, operation, diagnostic_code),
            operation: operation.to_owned(),
            capability_generation: frame.capability_generation,
            source_conversation_id: frame.source_conversation_id.clone(),
            turn_id: frame.turn_id.clone(),
            dispatch_receipt_id: frame.dispatch_receipt_id.clone(),
            cancellation_epoch: frame.cancellation_epoch,
            diagnostic_code,
        }
    }
}

struct CommunicationBrokerOwner {
    active: Arc<AtomicBool>,
    socket_path: PathBuf,
    directory: PathBuf,
    handle: JoinHandle<()>,
    resident_pubkey: String,
}

struct CommunicationConnectionPermit {
    active_connections: Arc<AtomicUsize>,
}

impl Drop for CommunicationConnectionPermit {
    fn drop(&mut self) {
        self.active_connections.fetch_sub(1, Ordering::SeqCst);
    }
}

fn try_acquire_connection(
    active_connections: &Arc<AtomicUsize>,
) -> Option<CommunicationConnectionPermit> {
    active_connections
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |active| {
            (active < MAX_CONCURRENT_CONNECTIONS).then_some(active + 1)
        })
        .ok()?;
    Some(CommunicationConnectionPermit {
        active_connections: Arc::clone(active_connections),
    })
}

impl CommunicationBrokerOwner {
    fn shutdown(self) {
        self.active.store(false, Ordering::SeqCst);
        let _ = UnixStream::connect(&self.socket_path);
        let _ = self.handle.join();
        let _ = fs::remove_file(&self.socket_path);
        let _ = fs::remove_dir(&self.directory);
    }
}

/// Uncommitted broker owner. Dropping the lease tears down the endpoint;
/// committing installs it as the one active broker for the resident.
pub(crate) struct CommunicationBrokerLease {
    owner: Option<CommunicationBrokerOwner>,
    bootstrap_json: String,
}

impl CommunicationBrokerLease {
    pub(crate) fn bootstrap_json(&self) -> &str {
        &self.bootstrap_json
    }

    pub(crate) fn commit(mut self) -> Result<(), String> {
        let owner = self
            .owner
            .take()
            .ok_or_else(|| "communications broker lease is unavailable".to_owned())?;
        let resident = owner.resident_pubkey.clone();
        let mut registry = brokers()
            .lock()
            .map_err(|_| "communications broker registry is unavailable".to_owned())?;
        if registry.contains_key(&resident) {
            drop(registry);
            owner.shutdown();
            return Err("communications broker already exists for resident".into());
        }
        registry.insert(resident, owner);
        Ok(())
    }
}

impl Drop for CommunicationBrokerLease {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.take() {
            owner.shutdown();
        }
    }
}

fn brokers() -> &'static Mutex<HashMap<String, CommunicationBrokerOwner>> {
    static BROKERS: OnceLock<Mutex<HashMap<String, CommunicationBrokerOwner>>> = OnceLock::new();
    BROKERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Start a private Unix-domain broker for one managed resident session.
pub(crate) fn create_communication_broker_lease(
    app: &AppHandle,
    context: CommunicationBrokerContext,
    backend: Arc<dyn CommunicationBrokerBackend>,
) -> Result<CommunicationBrokerLease, String> {
    let generation = next_generation()?;
    let master_capability = random_capability()?;
    let directory =
        PathBuf::from("/tmp").join(format!("luca-cb-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&directory)
        .map_err(|_| "communications broker cache could not be prepared".to_owned())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "communications broker cache could not be secured".to_owned())?;
    }
    let socket_path = directory.join(format!(
        "e{}-{}.sock",
        context.session_epoch.get(),
        &uuid::Uuid::new_v4().simple().to_string()[..16]
    ));
    let listener = UnixListener::bind(&socket_path)
        .map_err(|_| "communications broker endpoint could not be created".to_owned())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "communications broker endpoint could not be bounded".to_owned())?;
    let endpoint = socket_path
        .to_str()
        .ok_or_else(|| "communications broker endpoint is invalid".to_owned())?;
    let bootstrap_json = serde_json::to_string(&CommunicationsMcpBootstrapV1 {
        protocol: BROKER_PROTOCOL,
        endpoint,
        master_capability: master_capability.as_str(),
        capability_generation: generation.get(),
        resident_pubkey: context.resident_pubkey.as_str(),
        session_epoch: context.session_epoch.get(),
        binding_ref: context.binding_ref.as_str(),
    })
    .map_err(|_| "communications broker bootstrap is invalid".to_owned())?;

    let active = Arc::new(AtomicBool::new(true));
    let core = Arc::new(CommunicationBridgeCore {
        active: Arc::clone(&active),
        context: context.clone(),
        master_capability: Zeroizing::new(master_capability.as_str().to_owned()),
        capability_generation: generation,
        authority: Arc::new(DesktopCommunicationTurnAuthority { app: app.clone() }),
        backend,
    });
    let thread_active = Arc::clone(&active);
    let handle = thread::Builder::new()
        .name("luca-communications-broker".into())
        .spawn(move || serve(listener, thread_active, core))
        .map_err(|_| "communications broker could not start".to_owned())?;
    Ok(CommunicationBrokerLease {
        owner: Some(CommunicationBrokerOwner {
            active,
            socket_path,
            directory,
            handle,
            resident_pubkey: context.resident_pubkey.as_str().to_owned(),
        }),
        bootstrap_json,
    })
}

pub(crate) fn stop_communication_broker(resident_pubkey: &str) -> Result<(), String> {
    let owner = brokers()
        .lock()
        .map_err(|_| "communications broker registry is unavailable".to_owned())?
        .remove(&resident_pubkey.to_ascii_lowercase());
    if let Some(owner) = owner {
        owner.shutdown();
    }
    Ok(())
}

fn serve(listener: UnixListener, active: Arc<AtomicBool>, core: Arc<CommunicationBridgeCore>) {
    let active_connections = Arc::new(AtomicUsize::new(0));
    while active.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if !active.load(Ordering::SeqCst) {
                    break;
                }
                let Some(connection_permit) = try_acquire_connection(&active_connections) else {
                    drop(stream);
                    continue;
                };
                let core = Arc::clone(&core);
                let _ = thread::Builder::new()
                    .name("luca-communications-request".into())
                    .spawn(move || {
                        let _connection_permit = connection_permit;
                        serve_connection(stream, &core);
                    });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
            }
            Err(_) => break,
        }
    }
}

fn serve_connection(stream: UnixStream, core: &CommunicationBridgeCore) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    let writer = match stream.try_clone() {
        Ok(writer) => writer,
        Err(_) => return,
    };
    let mut reader = BufReader::new(stream).take((MAX_BROKER_FRAME_BYTES + 1) as u64);
    let mut bytes = Vec::new();
    let response = match reader.read_until(b'\n', &mut bytes) {
        Ok(read) if read > 0 && bytes.len() <= MAX_BROKER_FRAME_BYTES && bytes.ends_with(b"\n") => {
            serde_json::from_slice::<CommunicationBrokerFrameV1>(&bytes)
                .ok()
                .map(|frame| core.handle_frame(frame))
        }
        _ => None,
    };
    let Some(response) = response else {
        return;
    };
    if let Ok(bytes) = serde_json::to_vec(&response) {
        let mut writer = writer;
        let _ = writer
            .write_all(&bytes)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush());
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInboxParams {
    #[serde(default)]
    category: CommunicationInboxCategory,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConversationParams {
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    thread_root_event_id: Option<String>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(
    tag = "destination_type",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum RawDestination {
    CurrentConversation,
    ExistingConversation { conversation_id: String },
    DirectParticipants { participant_pubkeys: Vec<String> },
}

#[derive(Deserialize)]
#[serde(tag = "reply_type", rename_all = "snake_case", deny_unknown_fields)]
enum RawReplyTarget {
    Message {
        event_id: String,
    },
    Thread {
        thread_root_event_id: String,
        #[serde(default)]
        reply_to_event_id: Option<String>,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSendParams {
    destination: RawDestination,
    body: String,
    #[serde(default)]
    reply: Option<RawReplyTarget>,
    #[serde(default)]
    mention_pubkeys: Vec<String>,
    #[serde(default)]
    activation_pubkeys: Vec<String>,
    #[serde(default)]
    artifact_handle_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
enum RawReactionMutation {
    Add {
        target_event_id: String,
        reaction: String,
    },
    Remove {
        target_event_id: String,
        reaction_event_id: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawReactParams {
    #[serde(default)]
    conversation_id: Option<String>,
    mutation: RawReactionMutation,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInviteParams {
    #[serde(default)]
    conversation_id: Option<String>,
    participant_pubkey: String,
    #[serde(default)]
    request_activation: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCreatePrivateRoomParams {
    label: String,
    #[serde(default)]
    purpose: Option<String>,
    #[serde(default)]
    participant_pubkeys: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BrokerFailure {
    code: &'static str,
    user_message: &'static str,
}

impl BrokerFailure {
    fn new(code: &'static str, user_message: &'static str) -> Self {
        Self { code, user_message }
    }

    fn stale_capability() -> Self {
        Self::new("stale_capability", "Communication authority is stale.")
    }
    fn stale_turn() -> Self {
        Self::new("stale_turn", "The communication turn is stale.")
    }
    fn turn_not_active() -> Self {
        Self::new("turn_not_active", "The communication turn is not active.")
    }
    fn invalid_operation() -> Self {
        Self::new(
            "invalid_operation",
            "The communication operation is unavailable.",
        )
    }
    pub(crate) fn invalid_arguments() -> Self {
        Self::new("invalid_arguments", "The communication request is invalid.")
    }
    pub(crate) fn authority_unavailable() -> Self {
        Self::new(
            "authority_unavailable",
            "Communication authority is unavailable.",
        )
    }
    pub(crate) fn custody_unavailable() -> Self {
        Self::new(
            "custody_unavailable",
            "Local identity custody is unavailable.",
        )
    }
    pub(crate) fn custody_denied() -> Self {
        Self::new(
            "custody_denied",
            "Local identity custody could not be verified.",
        )
    }
    pub(crate) fn membership_denied() -> Self {
        Self::new(
            "membership_denied",
            "Conversation membership does not allow this action.",
        )
    }
    pub(crate) fn same_owner_required() -> Self {
        Self::new(
            "same_owner_required",
            "The recipient is not a verified same-owner agent.",
        )
    }
    pub(crate) fn approval_required() -> Self {
        Self::new(
            "approval_required",
            "This communication requires owner approval.",
        )
    }
    pub(crate) fn read_only() -> Self {
        Self::new("conversation_read_only", "This conversation is read-only.")
    }
    pub(crate) fn artifact_denied() -> Self {
        Self::new(
            "artifact_denied",
            "An artifact handle is unavailable for this turn.",
        )
    }
    pub(crate) fn authorship_denied() -> Self {
        Self::new(
            "authorship_denied",
            "The resident may remove only its own reaction.",
        )
    }
    pub(crate) fn outbox_unavailable() -> Self {
        Self::new(
            "outbox_unavailable",
            "The communication could not be durably staged.",
        )
    }
    pub(crate) fn operation_not_implemented() -> Self {
        Self::new(
            "operation_not_implemented",
            "This communication operation is not implemented yet.",
        )
    }
    pub(crate) fn managed_operation_failed() -> Self {
        Self::new(
            "managed_operation_failed",
            "The existing conversation operation could not be completed.",
        )
    }
    pub(crate) fn membership_partial() -> Self {
        Self::new(
            "membership_partial",
            "The conversation exists, but its requested membership is incomplete.",
        )
    }
    fn response_too_large() -> Self {
        Self::new(
            "response_too_large",
            "The communication result exceeds its bound.",
        )
    }
}

fn parse_coordinates(
    frame: &CommunicationBrokerFrameV1,
) -> Result<CommunicationTurnCoordinates, BrokerFailure> {
    Ok(CommunicationTurnCoordinates {
        source_conversation_id: OpaqueId::parse(frame.source_conversation_id.clone())
            .map_err(|_| BrokerFailure::invalid_arguments())?,
        turn_id: OpaqueId::parse(frame.turn_id.clone())
            .map_err(|_| BrokerFailure::invalid_arguments())?,
        dispatch_receipt_id: OpaqueId::parse(frame.dispatch_receipt_id.clone())
            .map_err(|_| BrokerFailure::invalid_arguments())?,
        cancellation_epoch: SafeU53::new(frame.cancellation_epoch)
            .map_err(|_| BrokerFailure::invalid_arguments())?,
    })
}

fn require_exact_authority(
    context: &CommunicationBrokerContext,
    coordinates: &CommunicationTurnCoordinates,
    authority: &CommunicationTurnAuthoritySnapshot,
) -> Result<(), BrokerFailure> {
    if authority.owner_pubkey != context.owner_pubkey
        || authority.resident_pubkey != context.resident_pubkey
        || authority.session_epoch != context.session_epoch
        || authority.runtime_binding_ref != context.binding_ref
        || &authority.coordinates != coordinates
        || !authority
            .owned_resident_pubkeys
            .contains(&context.resident_pubkey)
    {
        return Err(BrokerFailure::stale_turn());
    }
    Ok(())
}

fn build_action_request(
    authority: &CommunicationTurnAuthoritySnapshot,
    operation_request_id: &OpaqueId,
    destination: CommunicationDestinationV1,
    operation: CommunicationOperationV1,
) -> Result<CommunicationActionRequestV1, BrokerFailure> {
    let expiry = authority.expires_at.clone();
    let material = serde_json::json!({
        "domain": "luca.communication.bridge.action-id.v1",
        "resident": &authority.resident_pubkey,
        "session_epoch": authority.session_epoch,
        "binding_ref": &authority.runtime_binding_ref,
        "source_conversation_id": &authority.coordinates.source_conversation_id,
        "turn_id": &authority.coordinates.turn_id,
        "dispatch_receipt_id": &authority.coordinates.dispatch_receipt_id,
        "cancellation_epoch": authority.coordinates.cancellation_epoch,
        "operation_request_id": operation_request_id,
        "destination": &destination,
        "operation": &operation,
    });
    let digest = canonical_sha256(&material).map_err(|_| BrokerFailure::invalid_arguments())?;
    let action_id = OpaqueId::parse(format!("communication-{digest}"))
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    let zero_hex = Hex64::parse("0".repeat(64)).map_err(|_| BrokerFailure::invalid_arguments())?;
    let zero_ref = Sha256Ref::parse(format!("sha256:{}", "0".repeat(64)))
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    let mut request = CommunicationActionRequestV1 {
        protocol: COMMUNICATION_ACTION_PROTOCOL.into(),
        action_id,
        idempotency_key: zero_hex,
        action_fingerprint: zero_ref,
        actor_pubkey: authority.resident_pubkey.clone(),
        owner_pubkey: authority.owner_pubkey.clone(),
        resident_pubkey: authority.resident_pubkey.clone(),
        session_epoch: authority.session_epoch,
        runtime_binding_ref: authority.runtime_binding_ref.clone(),
        source_conversation_id: authority.coordinates.source_conversation_id.clone(),
        destination,
        turn_id: authority.coordinates.turn_id.clone(),
        dispatch_receipt_id: authority.coordinates.dispatch_receipt_id.clone(),
        causal_root_id: authority.causal_root_id.clone(),
        causal_parent_action_id: (authority.causal_root_id
            != authority.coordinates.dispatch_receipt_id)
            .then(|| authority.coordinates.dispatch_receipt_id.clone()),
        causal_depth: SafeU53::new(u64::from(
            authority.causal_root_id != authority.coordinates.dispatch_receipt_id,
        ))
        .map_err(|_| BrokerFailure::invalid_arguments())?,
        cancellation_epoch: authority.coordinates.cancellation_epoch,
        expires_at: expiry,
        approval_id: None,
        operation,
    };
    request.action_fingerprint = request
        .derive_action_fingerprint()
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    request.idempotency_key = request
        .derive_idempotency_key()
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    request
        .validate()
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    Ok(request)
}

fn verified_owned_residents(app: &AppHandle) -> Result<BTreeSet<Hex64>, BrokerFailure> {
    let mut records = crate::managed_agents::load_managed_agents(app)
        .map_err(|_| BrokerFailure::custody_unavailable())?;
    let mut verified = BTreeSet::new();
    for record in &records {
        if record.pubkey.is_empty() || record.private_key_nsec.is_empty() {
            continue;
        }
        let Ok(pubkey) = Hex64::parse(record.pubkey.to_ascii_lowercase()) else {
            continue;
        };
        let Ok(keys) = nostr::Keys::parse(record.private_key_nsec.trim()) else {
            continue;
        };
        if keys.public_key().to_hex() == pubkey.as_str() {
            verified.insert(pubkey);
        }
    }
    for record in &mut records {
        record.private_key_nsec.zeroize();
    }
    Ok(verified)
}

fn derive_turn_capability(
    master_capability: &str,
    capability_generation: SafeU53,
    resident_pubkey: &Hex64,
    session_epoch: SafeU53,
    binding_ref: &Sha256Ref,
    coordinates: &CommunicationTurnCoordinates,
) -> String {
    let mut material = Vec::with_capacity(512);
    material.extend_from_slice(b"luca.communications.turn-capability.v1\0");
    material.extend_from_slice(&capability_generation.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(resident_pubkey.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&session_epoch.get().to_be_bytes());
    material.push(0);
    material.extend_from_slice(binding_ref.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.source_conversation_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.turn_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(coordinates.dispatch_receipt_id.as_str().as_bytes());
    material.push(0);
    material.extend_from_slice(&coordinates.cancellation_epoch.get().to_be_bytes());
    let digest = hmac_sha256(master_capability.as_bytes(), &material);
    material.zeroize();
    format!("sha256:{}", hex::encode(digest))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> Output<Sha256> {
    const BLOCK_SIZE: usize = 64;
    let mut key_block = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key);
        key_block[..hashed.len()].copy_from_slice(&hashed);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36u8; BLOCK_SIZE];
    let mut outer_pad = [0x5cu8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= key_block[index];
        outer_pad[index] ^= key_block[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let mut inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    let result = outer.finalize();
    key_block.zeroize();
    inner_pad.zeroize();
    outer_pad.zeroize();
    inner_digest.zeroize();
    result
}

fn read_scope(authority: &CommunicationTurnAuthoritySnapshot) -> CommunicationReadScope {
    CommunicationReadScope {
        owner_pubkey: authority.owner_pubkey.clone(),
        resident_pubkey: authority.resident_pubkey.clone(),
        source_conversation_id: authority.coordinates.source_conversation_id.clone(),
    }
}

fn parse_arguments<T: for<'de> Deserialize<'de>>(arguments: Value) -> Result<T, BrokerFailure> {
    serde_json::from_value(arguments).map_err(|_| BrokerFailure::invalid_arguments())
}

fn parse_hex(value: String) -> Result<Hex64, BrokerFailure> {
    Hex64::parse(value.to_ascii_lowercase()).map_err(|_| BrokerFailure::invalid_arguments())
}

fn parse_optional_hex(value: Option<String>) -> Result<Option<Hex64>, BrokerFailure> {
    value.map(parse_hex).transpose()
}

fn parse_optional_opaque(value: Option<String>) -> Result<Option<OpaqueId>, BrokerFailure> {
    value
        .map(OpaqueId::parse)
        .transpose()
        .map_err(|_| BrokerFailure::invalid_arguments())
}

fn sorted_pubkeys(values: Vec<String>) -> Result<Vec<Hex64>, BrokerFailure> {
    if values.len() > MAX_COMMUNICATION_PARTICIPANTS {
        return Err(BrokerFailure::invalid_arguments());
    }
    let mut values = values
        .into_iter()
        .map(parse_hex)
        .collect::<Result<Vec<_>, _>>()?;
    values.sort();
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(BrokerFailure::invalid_arguments());
    }
    Ok(values)
}

fn sorted_opaque_ids(values: Vec<String>) -> Result<Vec<OpaqueId>, BrokerFailure> {
    let mut values = values
        .into_iter()
        .map(OpaqueId::parse)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| BrokerFailure::invalid_arguments())?;
    values.sort();
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(BrokerFailure::invalid_arguments());
    }
    Ok(values)
}

fn validate_message_body(body: &str, artifacts: &[String]) -> Result<(), BrokerFailure> {
    if (body.is_empty() && artifacts.is_empty())
        || body.len() > MAX_COMMUNICATION_BODY_BYTES
        || body.contains('\0')
    {
        return Err(BrokerFailure::invalid_arguments());
    }
    Ok(())
}

fn validate_bounded_text(value: &str, maximum: usize) -> Result<(), BrokerFailure> {
    if value.is_empty() || value.trim() != value || value.len() > maximum || value.contains('\0') {
        return Err(BrokerFailure::invalid_arguments());
    }
    Ok(())
}

fn validate_reaction(reaction: &str) -> Result<(), BrokerFailure> {
    if reaction.is_empty()
        || reaction.trim() != reaction
        || reaction.len() > MAX_COMMUNICATION_REACTION_BYTES
        || reaction.contains('\0')
    {
        return Err(BrokerFailure::invalid_arguments());
    }
    Ok(())
}

fn bounded_limit(limit: Option<usize>) -> Result<usize, BrokerFailure> {
    let limit = limit.unwrap_or(50);
    match limit {
        1..=MAX_PAGE_ITEMS => Ok(limit),
        _ => Err(BrokerFailure::invalid_arguments()),
    }
}

fn participant_set_ref(participants: &[Hex64]) -> Result<Sha256Ref, BrokerFailure> {
    let digest =
        canonical_sha256(&participants.to_vec()).map_err(|_| BrokerFailure::invalid_arguments())?;
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(|_| BrokerFailure::invalid_arguments())
}

fn serialize_read_result(content: Value) -> Result<String, BrokerFailure> {
    let content =
        serde_json::to_string(&content).map_err(|_| BrokerFailure::invalid_arguments())?;
    if content.len() > MAX_READ_RESULT_BYTES {
        return Err(BrokerFailure::response_too_large());
    }
    Ok(content)
}

fn receipt_id(
    frame: &CommunicationBrokerFrameV1,
    operation: &str,
    diagnostic_code: Option<&str>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(b"luca.communications.broker-receipt.v1\0");
    digest.update(frame.capability_generation.to_be_bytes());
    digest.update(frame.source_conversation_id.as_bytes());
    digest.update(b"\0");
    digest.update(frame.turn_id.as_bytes());
    digest.update(b"\0");
    digest.update(frame.dispatch_receipt_id.as_bytes());
    digest.update(b"\0");
    digest.update(frame.cancellation_epoch.to_be_bytes());
    digest.update(b"\0");
    digest.update(frame.operation_request_id.as_bytes());
    digest.update(operation.as_bytes());
    if let Some(code) = diagnostic_code {
        digest.update(b"\0");
        digest.update(code.as_bytes());
    }
    format!("communication-receipt-{}", hex::encode(digest.finalize()))
}

fn canonical_timestamp(unix_seconds: u64) -> Result<CanonicalTimestamp, BrokerFailure> {
    let seconds =
        i64::try_from(unix_seconds).map_err(|_| BrokerFailure::authority_unavailable())?;
    let timestamp = DateTime::<Utc>::from_timestamp(seconds, 0)
        .ok_or_else(BrokerFailure::authority_unavailable)?;
    CanonicalTimestamp::parse(timestamp.to_rfc3339_opts(SecondsFormat::Secs, true))
        .map_err(|_| BrokerFailure::authority_unavailable())
}

fn unix_now() -> Result<u64, BrokerFailure> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| BrokerFailure::authority_unavailable())
}

fn next_generation() -> Result<SafeU53, String> {
    let generation = NEXT_CAPABILITY_GENERATION.fetch_add(1, Ordering::SeqCst);
    if generation == 0 {
        return Err("communications broker generation is unavailable".into());
    }
    SafeU53::new(generation)
        .map_err(|_| "communications broker generation is unavailable".to_owned())
}

fn random_capability() -> Result<Sha256Ref, String> {
    let mut digest = Sha256::new();
    digest.update(b"luca.communications.master-capability.v1\0");
    digest.update(uuid::Uuid::new_v4().as_bytes());
    digest.update(uuid::Uuid::new_v4().as_bytes());
    Sha256Ref::parse(format!("sha256:{}", hex::encode(digest.finalize())))
        .map_err(|_| "communications broker capability is invalid".to_owned())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

#[cfg(test)]
#[path = "communication_bridge_tests.rs"]
mod tests;

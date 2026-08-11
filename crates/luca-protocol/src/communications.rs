//! Strict semantic communication, turn-authority, outbox, and Inbox contracts.
//!
//! These contracts deliberately cannot represent raw Nostr events, signing
//! keys, local filesystem paths, or free-form diagnostic bodies. The trusted
//! desktop remains responsible for resolving semantic requests into exact
//! events and for enforcing current custody, membership, cancellation, and
//! causal authority immediately before every durable side effect.

use crate::{
    canonical_sha256, CanonicalTimestamp, Hex64, OpaqueId, ProtocolValueError, SafeU53, Sha256Ref,
};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

/// Wire discriminator for semantic communication action requests and receipts.
pub const COMMUNICATION_ACTION_PROTOCOL: &str = "luca.communication.action.v1";
/// Wire discriminator for desktop-held active-turn communication authority.
pub const TURN_COMMUNICATION_CAPABILITY_PROTOCOL: &str = "luca.communication.turn-capability.v1";
/// Wire discriminator for exact, one-shot owner approval bindings.
pub const COMMUNICATION_APPROVAL_PROTOCOL: &str = "luca.communication.approval.v1";
/// Local persistence discriminator for the encrypted communication outbox.
pub const COMMUNICATION_ACTION_OUTBOX_PROTOCOL: &str = "luca.communication.action-outbox.v1";
/// Wire discriminator for deterministic Inbox projections.
pub const INBOX_PROJECTION_PROTOCOL: &str = "luca.inbox.projection.v1";

/// Largest accepted UTF-8 message or replacement body.
pub const MAX_COMMUNICATION_BODY_BYTES: usize = 65_536;
/// Largest accepted room label.
pub const MAX_COMMUNICATION_ROOM_LABEL_BYTES: usize = 120;
/// Largest accepted room topic or purpose.
pub const MAX_COMMUNICATION_ROOM_METADATA_BYTES: usize = 1_024;
/// Largest accepted reaction value.
pub const MAX_COMMUNICATION_REACTION_BYTES: usize = 64;
/// Maximum exact participant or mention set.
pub const MAX_COMMUNICATION_PARTICIPANTS: usize = 64;
/// Maximum immutable artifact handles attached to one action.
pub const MAX_COMMUNICATION_ARTIFACTS: usize = 16;
/// Maximum operation kinds carried by one turn capability.
pub const MAX_COMMUNICATION_OPERATIONS: usize = 32;
/// Maximum causal depth representable by the protocol. Product policy may be lower.
pub const MAX_COMMUNICATION_CAUSAL_DEPTH: u64 = 32;
/// Largest bounded Inbox preview.
pub const MAX_INBOX_PREVIEW_BYTES: usize = 512;
/// Maximum items returned in one Inbox projection page.
pub const MAX_INBOX_ITEMS: usize = 256;

/// Validation failure for a communication or Inbox contract.
#[derive(Debug, thiserror::Error)]
pub enum CommunicationContractError {
    /// A validated scalar was invalid.
    #[error(transparent)]
    Value(#[from] ProtocolValueError),
    /// The object named the wrong versioned protocol.
    #[error("invalid communication protocol discriminator")]
    Protocol,
    /// A semantic text or collection exceeded its frozen bound.
    #[error("communication semantic payload exceeds its frozen bound")]
    Bounds,
    /// A semantic collection was duplicated, unsorted, or internally inconsistent.
    #[error("communication semantic payload is not canonical")]
    Sequence,
    /// Exact authority fields did not bind the same actor, turn, or action.
    #[error("communication authority binding mismatch")]
    Binding,
    /// A capability or approval is stale or outside its exact time window.
    #[error("communication authority is expired or stale")]
    Expired,
    /// A request represented a forbidden raw event, path, or unsafe value.
    #[error("communication payload violates the semantic-only boundary")]
    UnsafePayload,
    /// Canonical fingerprinting failed.
    #[error("communication fingerprint could not be derived")]
    Fingerprint,
    /// An outbox or Inbox state combination is impossible.
    #[error("communication lifecycle state is inconsistent")]
    State,
}

fn require_protocol(value: &str, expected: &str) -> Result<(), CommunicationContractError> {
    (value == expected)
        .then_some(())
        .ok_or(CommunicationContractError::Protocol)
}

fn bounded_text(
    value: &str,
    maximum: usize,
    require_trimmed: bool,
) -> Result<(), CommunicationContractError> {
    if value.is_empty()
        || value.len() > maximum
        || value.trim().is_empty()
        || (require_trimmed && value.trim().len() != value.len())
        || value.chars().any(|character| {
            character == '\0' || (character.is_control() && character != '\n' && character != '\t')
        })
    {
        Err(CommunicationContractError::Bounds)
    } else {
        Ok(())
    }
}

fn bounded_sorted_unique<T: Ord>(
    values: &[T],
    maximum: usize,
) -> Result<(), CommunicationContractError> {
    if values.len() > maximum || values.windows(2).any(|pair| pair[0] >= pair[1]) {
        Err(CommunicationContractError::Sequence)
    } else {
        Ok(())
    }
}

fn sha256_ref<T: Serialize>(value: &T) -> Result<Sha256Ref, CommunicationContractError> {
    let digest = canonical_sha256(value).map_err(|_| CommunicationContractError::Fingerprint)?;
    Sha256Ref::parse(format!("sha256:{digest}")).map_err(CommunicationContractError::Value)
}

fn timestamp_before_or_equal(left: &CanonicalTimestamp, right: &CanonicalTimestamp) -> bool {
    left.as_str() <= right.as_str()
}

/// One immutable, desktop-issued artifact reference.
///
/// The handle is intentionally not a local path or URL. The trusted desktop
/// resolves it only after rechecking the active turn and conversation policy.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct OpaqueArtifactHandleV1 {
    /// Opaque desktop-local artifact identifier.
    pub handle_id: OpaqueId,
    /// Hash of the immutable artifact bytes.
    pub content_sha256: Hex64,
    /// Exact artifact byte length.
    pub byte_length: SafeU53,
    /// Bounded MIME media type.
    pub media_type: String,
    /// Optional path-free display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

impl std::fmt::Debug for OpaqueArtifactHandleV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OpaqueArtifactHandleV1")
            .field("handle_id", &self.handle_id)
            .field("content_sha256", &self.content_sha256)
            .field("byte_length", &self.byte_length)
            .field("media_type", &self.media_type)
            .field(
                "display_name",
                &self.display_name.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOpaqueArtifactHandleV1 {
    handle_id: OpaqueId,
    content_sha256: Hex64,
    byte_length: SafeU53,
    media_type: String,
    display_name: Option<String>,
}

impl OpaqueArtifactHandleV1 {
    /// Validate the immutable handle and reject path-shaped display metadata.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        if self.media_type.is_empty()
            || self.media_type.len() > 127
            || !self.media_type.is_ascii()
            || self.media_type.bytes().any(|byte| {
                !(byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'+' | b'.' | b'-'))
            })
        {
            return Err(CommunicationContractError::UnsafePayload);
        }
        if let Some(name) = &self.display_name {
            bounded_text(name, 255, true)?;
            if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
                return Err(CommunicationContractError::UnsafePayload);
            }
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for OpaqueArtifactHandleV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawOpaqueArtifactHandleV1::deserialize(deserializer)?;
        let value = Self {
            handle_id: raw.handle_id,
            content_sha256: raw.content_sha256,
            byte_length: raw.byte_length,
            media_type: raw.media_type,
            display_name: raw.display_name,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Exact semantic destination for a communication action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "destination_type",
    rename_all = "snake_case",
    deny_unknown_fields
)]
pub enum CommunicationDestinationV1 {
    /// An already resolved conversation and participant-set version.
    ExistingConversation {
        /// App-resolved conversation identifier.
        conversation_id: OpaqueId,
        /// Current participant-set version.
        participant_set_version: SafeU53,
        /// One-way fingerprint of the exact current participant set.
        participant_set_ref: Sha256Ref,
    },
    /// A new owner-visible direct conversation.
    DirectParticipants {
        /// Exact full participant set, including owner and acting resident.
        participant_pubkeys: Vec<Hex64>,
        /// One-way fingerprint of the exact participant set.
        participant_set_ref: Sha256Ref,
    },
    /// A new private room whose owner is visibly included.
    NewPrivateRoom {
        /// Exact initial participant set, including owner and acting resident.
        participant_pubkeys: Vec<Hex64>,
        /// One-way fingerprint of the exact participant set.
        participant_set_ref: Sha256Ref,
    },
    /// An expansive broadcast audience authorized only by exact approval.
    Broadcast {
        /// One-way audience fingerprint; raw recipient lists remain desktop-owned.
        audience_ref: Sha256Ref,
    },
}

impl CommunicationDestinationV1 {
    fn validate_for(
        &self,
        owner_pubkey: &Hex64,
        resident_pubkey: &Hex64,
    ) -> Result<(), CommunicationContractError> {
        match self {
            Self::ExistingConversation { .. } | Self::Broadcast { .. } => Ok(()),
            Self::DirectParticipants {
                participant_pubkeys,
                participant_set_ref,
            }
            | Self::NewPrivateRoom {
                participant_pubkeys,
                participant_set_ref,
            } => {
                bounded_sorted_unique(participant_pubkeys, MAX_COMMUNICATION_PARTICIPANTS)?;
                if participant_pubkeys.len() < 2
                    || !participant_pubkeys.contains(owner_pubkey)
                    || !participant_pubkeys.contains(resident_pubkey)
                    || &sha256_ref(participant_pubkeys)? != participant_set_ref
                {
                    return Err(CommunicationContractError::Binding);
                }
                Ok(())
            }
        }
    }

    /// Return the one-way fingerprint of this exact destination.
    pub fn destination_ref(&self) -> Result<Sha256Ref, CommunicationContractError> {
        sha256_ref(self)
    }

    /// Return the participant-set fingerprint carried by this destination.
    pub fn participant_set_ref(&self) -> &Sha256Ref {
        match self {
            Self::ExistingConversation {
                participant_set_ref,
                ..
            }
            | Self::DirectParticipants {
                participant_set_ref,
                ..
            }
            | Self::NewPrivateRoom {
                participant_set_ref,
                ..
            } => participant_set_ref,
            Self::Broadcast { audience_ref } => audience_ref,
        }
    }
}

/// Typed room visibility requests supported by the semantic action boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationRoomVisibilityV1 {
    /// Membership-restricted room.
    Private,
    /// Membership-restricted room with invitation-only discovery.
    Restricted,
}

/// Typed participant-add policy requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationMemberAddPolicyV1 {
    /// Only the owner may add participants.
    OwnerOnly,
    /// Owner and specifically authorized participants may add participants.
    OwnerAndAuthorizedParticipants,
}

/// Stable semantic operation categories used by capabilities and receipts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationOperationKindV1 {
    SendMessage,
    EditOwnMessage,
    DeleteOwnMessage,
    AddReaction,
    RemoveOwnReaction,
    CreatePrivateRoom,
    InviteSameOwnerAgent,
    InviteExternalIdentity,
    RemoveParticipant,
    UpdateRoomTopicOrPurpose,
    ChangeRoomAuthorityMetadata,
    LeaveRoom,
    ArchiveRoom,
    UnarchiveRoom,
    DeleteRoom,
    PublishBroadcast,
    AcknowledgeRead,
}

/// One bounded semantic operation. Raw event kinds, tags, signatures, and JSON
/// are intentionally not representable.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub enum CommunicationOperationV1 {
    /// Send an ordinary message, reply, mention, and/or immutable attachment.
    SendMessage {
        /// Message body. It may be empty only when an artifact is present.
        body: String,
        /// Optional exact event receiving a reply.
        #[serde(skip_serializing_if = "Option::is_none")]
        reply_to_event_id: Option<Hex64>,
        /// Exact mentioned public keys, sorted and unique.
        mention_pubkeys: Vec<Hex64>,
        /// Mentioned same-owner residents for which activation is requested.
        activation_pubkeys: Vec<Hex64>,
        /// Immutable desktop-issued artifact handles.
        artifact_handles: Vec<OpaqueArtifactHandleV1>,
    },
    /// Replace the body of one event authored by the acting resident.
    EditOwnMessage {
        target_event_id: Hex64,
        replacement_body: String,
        artifact_handles: Vec<OpaqueArtifactHandleV1>,
    },
    /// Request deletion of one event authored by the acting resident.
    DeleteOwnMessage { target_event_id: Hex64 },
    /// Add a reaction to one exact event.
    AddReaction {
        target_event_id: Hex64,
        reaction: String,
    },
    /// Remove one exact reaction authored by the acting resident.
    RemoveOwnReaction {
        target_event_id: Hex64,
        reaction_event_id: Hex64,
    },
    /// Create a new owner-visible private room.
    CreatePrivateRoom {
        label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        purpose: Option<String>,
    },
    /// Invite one locally verified same-owner resident.
    InviteSameOwnerAgent {
        participant_pubkey: Hex64,
        request_activation: bool,
    },
    /// Request an owner-approved invitation for an external identity.
    InviteExternalIdentity { participant_pubkey: Hex64 },
    /// Request owner-approved removal of one participant.
    RemoveParticipant { participant_pubkey: Hex64 },
    /// Change only human-readable room topic or purpose.
    UpdateRoomTopicOrPurpose {
        #[serde(skip_serializing_if = "Option::is_none")]
        topic: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        purpose: Option<String>,
    },
    /// Request an authority-bearing room metadata change.
    ChangeRoomAuthorityMetadata {
        #[serde(skip_serializing_if = "Option::is_none")]
        visibility: Option<CommunicationRoomVisibilityV1>,
        #[serde(skip_serializing_if = "Option::is_none")]
        member_add_policy: Option<CommunicationMemberAddPolicyV1>,
    },
    /// Request leaving the destination room.
    LeaveRoom,
    /// Request archival of the destination room.
    ArchiveRoom,
    /// Request restoration of the destination room.
    UnarchiveRoom,
    /// Request destructive deletion of the destination room.
    DeleteRoom,
    /// Request owner-approved expansive publication.
    PublishBroadcast {
        body: String,
        artifact_handles: Vec<OpaqueArtifactHandleV1>,
    },
    /// Acknowledge only the acting resident's read state through one exact event.
    AcknowledgeRead { through_event_id: Hex64 },
}

impl std::fmt::Debug for CommunicationOperationV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommunicationOperationV1")
            .field("kind", &self.kind())
            .field("semantic_payload", &"[REDACTED]")
            .finish()
    }
}

impl CommunicationOperationV1 {
    /// Return the stable operation category.
    pub fn kind(&self) -> CommunicationOperationKindV1 {
        match self {
            Self::SendMessage { .. } => CommunicationOperationKindV1::SendMessage,
            Self::EditOwnMessage { .. } => CommunicationOperationKindV1::EditOwnMessage,
            Self::DeleteOwnMessage { .. } => CommunicationOperationKindV1::DeleteOwnMessage,
            Self::AddReaction { .. } => CommunicationOperationKindV1::AddReaction,
            Self::RemoveOwnReaction { .. } => CommunicationOperationKindV1::RemoveOwnReaction,
            Self::CreatePrivateRoom { .. } => CommunicationOperationKindV1::CreatePrivateRoom,
            Self::InviteSameOwnerAgent { .. } => CommunicationOperationKindV1::InviteSameOwnerAgent,
            Self::InviteExternalIdentity { .. } => {
                CommunicationOperationKindV1::InviteExternalIdentity
            }
            Self::RemoveParticipant { .. } => CommunicationOperationKindV1::RemoveParticipant,
            Self::UpdateRoomTopicOrPurpose { .. } => {
                CommunicationOperationKindV1::UpdateRoomTopicOrPurpose
            }
            Self::ChangeRoomAuthorityMetadata { .. } => {
                CommunicationOperationKindV1::ChangeRoomAuthorityMetadata
            }
            Self::LeaveRoom => CommunicationOperationKindV1::LeaveRoom,
            Self::ArchiveRoom => CommunicationOperationKindV1::ArchiveRoom,
            Self::UnarchiveRoom => CommunicationOperationKindV1::UnarchiveRoom,
            Self::DeleteRoom => CommunicationOperationKindV1::DeleteRoom,
            Self::PublishBroadcast { .. } => CommunicationOperationKindV1::PublishBroadcast,
            Self::AcknowledgeRead { .. } => CommunicationOperationKindV1::AcknowledgeRead,
        }
    }

    /// Whether this operation always requires exact, one-shot owner approval.
    pub fn always_requires_approval(&self) -> bool {
        matches!(
            self,
            Self::DeleteOwnMessage { .. }
                | Self::InviteExternalIdentity { .. }
                | Self::RemoveParticipant { .. }
                | Self::ChangeRoomAuthorityMetadata { .. }
                | Self::LeaveRoom
                | Self::ArchiveRoom
                | Self::UnarchiveRoom
                | Self::DeleteRoom
                | Self::PublishBroadcast { .. }
        )
    }

    /// Return exact public keys for which this message requests activation.
    pub fn activation_pubkeys(&self) -> &[Hex64] {
        match self {
            Self::SendMessage {
                activation_pubkeys, ..
            } => activation_pubkeys,
            _ => &[],
        }
    }

    /// Return immutable artifact handles carried by this operation.
    pub fn artifact_handles(&self) -> &[OpaqueArtifactHandleV1] {
        match self {
            Self::SendMessage {
                artifact_handles, ..
            }
            | Self::EditOwnMessage {
                artifact_handles, ..
            }
            | Self::PublishBroadcast {
                artifact_handles, ..
            } => artifact_handles,
            _ => &[],
        }
    }

    /// Validate semantic bounds independently from current desktop authority.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        match self {
            Self::SendMessage {
                body,
                mention_pubkeys,
                activation_pubkeys,
                artifact_handles,
                ..
            } => {
                if body.is_empty() && artifact_handles.is_empty() {
                    return Err(CommunicationContractError::Bounds);
                }
                if !body.is_empty() {
                    bounded_text(body, MAX_COMMUNICATION_BODY_BYTES, false)?;
                }
                bounded_sorted_unique(mention_pubkeys, MAX_COMMUNICATION_PARTICIPANTS)?;
                bounded_sorted_unique(activation_pubkeys, MAX_COMMUNICATION_PARTICIPANTS)?;
                if activation_pubkeys
                    .iter()
                    .any(|pubkey| mention_pubkeys.binary_search(pubkey).is_err())
                {
                    return Err(CommunicationContractError::Binding);
                }
                validate_artifacts(artifact_handles)
            }
            Self::EditOwnMessage {
                replacement_body,
                artifact_handles,
                ..
            } => {
                bounded_text(replacement_body, MAX_COMMUNICATION_BODY_BYTES, false)?;
                validate_artifacts(artifact_handles)
            }
            Self::AddReaction { reaction, .. } => {
                bounded_text(reaction, MAX_COMMUNICATION_REACTION_BYTES, true)
            }
            Self::CreatePrivateRoom { label, purpose } => {
                bounded_text(label, MAX_COMMUNICATION_ROOM_LABEL_BYTES, true)?;
                if let Some(purpose) = purpose {
                    bounded_text(purpose, MAX_COMMUNICATION_ROOM_METADATA_BYTES, true)?;
                }
                Ok(())
            }
            Self::UpdateRoomTopicOrPurpose { topic, purpose } => {
                if topic.is_none() && purpose.is_none() {
                    return Err(CommunicationContractError::Bounds);
                }
                if let Some(topic) = topic {
                    bounded_text(topic, MAX_COMMUNICATION_ROOM_METADATA_BYTES, true)?;
                }
                if let Some(purpose) = purpose {
                    bounded_text(purpose, MAX_COMMUNICATION_ROOM_METADATA_BYTES, true)?;
                }
                Ok(())
            }
            Self::ChangeRoomAuthorityMetadata {
                visibility,
                member_add_policy,
            } if visibility.is_none() && member_add_policy.is_none() => {
                Err(CommunicationContractError::Bounds)
            }
            Self::PublishBroadcast {
                body,
                artifact_handles,
            } => {
                bounded_text(body, MAX_COMMUNICATION_BODY_BYTES, false)?;
                validate_artifacts(artifact_handles)
            }
            Self::DeleteOwnMessage { .. }
            | Self::RemoveOwnReaction { .. }
            | Self::InviteSameOwnerAgent { .. }
            | Self::InviteExternalIdentity { .. }
            | Self::RemoveParticipant { .. }
            | Self::ChangeRoomAuthorityMetadata { .. }
            | Self::LeaveRoom
            | Self::ArchiveRoom
            | Self::UnarchiveRoom
            | Self::DeleteRoom
            | Self::AcknowledgeRead { .. } => Ok(()),
        }
    }
}

fn validate_artifacts(
    artifact_handles: &[OpaqueArtifactHandleV1],
) -> Result<(), CommunicationContractError> {
    if artifact_handles.len() > MAX_COMMUNICATION_ARTIFACTS
        || artifact_handles
            .windows(2)
            .any(|pair| pair[0].handle_id >= pair[1].handle_id)
    {
        return Err(CommunicationContractError::Sequence);
    }
    artifact_handles
        .iter()
        .try_for_each(|handle| handle.validate())
}

/// Exact managed-turn request for one semantic communication action.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct CommunicationActionRequestV1 {
    pub protocol: String,
    pub action_id: OpaqueId,
    pub idempotency_key: Hex64,
    pub action_fingerprint: Sha256Ref,
    pub actor_pubkey: Hex64,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub runtime_binding_ref: Sha256Ref,
    pub source_conversation_id: OpaqueId,
    pub destination: CommunicationDestinationV1,
    pub turn_id: OpaqueId,
    pub dispatch_receipt_id: OpaqueId,
    pub causal_root_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causal_parent_action_id: Option<OpaqueId>,
    pub causal_depth: SafeU53,
    pub cancellation_epoch: SafeU53,
    pub expires_at: CanonicalTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_id: Option<OpaqueId>,
    pub operation: CommunicationOperationV1,
}

impl std::fmt::Debug for CommunicationActionRequestV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommunicationActionRequestV1")
            .field("protocol", &self.protocol)
            .field("action_id", &self.action_id)
            .field("idempotency_key", &self.idempotency_key)
            .field("action_fingerprint", &self.action_fingerprint)
            .field("actor_pubkey", &self.actor_pubkey)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("session_epoch", &self.session_epoch)
            .field("runtime_binding_ref", &self.runtime_binding_ref)
            .field("source_conversation_id", &self.source_conversation_id)
            .field("destination", &"[REDACTED]")
            .field("turn_id", &self.turn_id)
            .field("dispatch_receipt_id", &self.dispatch_receipt_id)
            .field("causal_root_id", &self.causal_root_id)
            .field("causal_parent_action_id", &self.causal_parent_action_id)
            .field("causal_depth", &self.causal_depth)
            .field("cancellation_epoch", &self.cancellation_epoch)
            .field("expires_at", &self.expires_at)
            .field("approval_id", &self.approval_id)
            .field("operation", &self.operation)
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommunicationActionRequestV1 {
    protocol: String,
    action_id: OpaqueId,
    idempotency_key: Hex64,
    action_fingerprint: Sha256Ref,
    actor_pubkey: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    runtime_binding_ref: Sha256Ref,
    source_conversation_id: OpaqueId,
    destination: CommunicationDestinationV1,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    causal_root_id: OpaqueId,
    causal_parent_action_id: Option<OpaqueId>,
    causal_depth: SafeU53,
    cancellation_epoch: SafeU53,
    expires_at: CanonicalTimestamp,
    approval_id: Option<OpaqueId>,
    operation: CommunicationOperationV1,
}

#[derive(Serialize)]
struct CommunicationActionFingerprintMaterial<'a> {
    protocol: &'a str,
    action_id: &'a OpaqueId,
    actor_pubkey: &'a Hex64,
    owner_pubkey: &'a Hex64,
    resident_pubkey: &'a Hex64,
    session_epoch: SafeU53,
    runtime_binding_ref: &'a Sha256Ref,
    source_conversation_id: &'a OpaqueId,
    destination: &'a CommunicationDestinationV1,
    turn_id: &'a OpaqueId,
    dispatch_receipt_id: &'a OpaqueId,
    causal_root_id: &'a OpaqueId,
    causal_parent_action_id: &'a Option<OpaqueId>,
    causal_depth: SafeU53,
    cancellation_epoch: SafeU53,
    expires_at: &'a CanonicalTimestamp,
    approval_id: &'a Option<OpaqueId>,
    operation: &'a CommunicationOperationV1,
}

impl CommunicationActionRequestV1 {
    fn fingerprint_material(&self) -> CommunicationActionFingerprintMaterial<'_> {
        CommunicationActionFingerprintMaterial {
            protocol: &self.protocol,
            action_id: &self.action_id,
            actor_pubkey: &self.actor_pubkey,
            owner_pubkey: &self.owner_pubkey,
            resident_pubkey: &self.resident_pubkey,
            session_epoch: self.session_epoch,
            runtime_binding_ref: &self.runtime_binding_ref,
            source_conversation_id: &self.source_conversation_id,
            destination: &self.destination,
            turn_id: &self.turn_id,
            dispatch_receipt_id: &self.dispatch_receipt_id,
            causal_root_id: &self.causal_root_id,
            causal_parent_action_id: &self.causal_parent_action_id,
            causal_depth: self.causal_depth,
            cancellation_epoch: self.cancellation_epoch,
            expires_at: &self.expires_at,
            approval_id: &self.approval_id,
            operation: &self.operation,
        }
    }

    /// Derive the one-way exact semantic action fingerprint.
    pub fn derive_action_fingerprint(&self) -> Result<Sha256Ref, CommunicationContractError> {
        sha256_ref(&self.fingerprint_material())
    }

    /// Derive the frozen action idempotency key.
    pub fn derive_idempotency_key(&self) -> Result<Hex64, CommunicationContractError> {
        derive_communication_action_idempotency_key(&self.action_id, &self.action_fingerprint)
    }

    /// Return a one-way exact destination binding.
    pub fn destination_ref(&self) -> Result<Sha256Ref, CommunicationContractError> {
        self.destination.destination_ref()
    }

    /// Return a one-way exact content and operation binding.
    pub fn content_ref(&self) -> Result<Sha256Ref, CommunicationContractError> {
        sha256_ref(&self.operation)
    }

    /// Return a one-way exact artifact-set binding.
    pub fn artifact_set_ref(&self) -> Result<Sha256Ref, CommunicationContractError> {
        sha256_ref(&self.operation.artifact_handles())
    }

    /// Validate all semantic and cross-field authority invariants.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, COMMUNICATION_ACTION_PROTOCOL)?;
        if self.actor_pubkey != self.resident_pubkey || self.owner_pubkey == self.resident_pubkey {
            return Err(CommunicationContractError::Binding);
        }
        self.destination
            .validate_for(&self.owner_pubkey, &self.resident_pubkey)?;
        self.operation.validate()?;
        if self.causal_depth.get() > MAX_COMMUNICATION_CAUSAL_DEPTH
            || (self.causal_depth.get() == 0) != self.causal_parent_action_id.is_none()
            || (self.operation.always_requires_approval() && self.approval_id.is_none())
        {
            return Err(CommunicationContractError::Binding);
        }
        if self.action_fingerprint != self.derive_action_fingerprint()?
            || self.idempotency_key != self.derive_idempotency_key()?
        {
            return Err(CommunicationContractError::Binding);
        }
        Ok(())
    }

    /// Validate this request at one canonical desktop time.
    pub fn validate_at(&self, now: &CanonicalTimestamp) -> Result<(), CommunicationContractError> {
        self.validate()?;
        if !timestamp_before_or_equal(now, &self.expires_at) {
            return Err(CommunicationContractError::Expired);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for CommunicationActionRequestV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawCommunicationActionRequestV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            action_id: raw.action_id,
            idempotency_key: raw.idempotency_key,
            action_fingerprint: raw.action_fingerprint,
            actor_pubkey: raw.actor_pubkey,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            runtime_binding_ref: raw.runtime_binding_ref,
            source_conversation_id: raw.source_conversation_id,
            destination: raw.destination,
            turn_id: raw.turn_id,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            causal_root_id: raw.causal_root_id,
            causal_parent_action_id: raw.causal_parent_action_id,
            causal_depth: raw.causal_depth,
            cancellation_epoch: raw.cancellation_epoch,
            expires_at: raw.expires_at,
            approval_id: raw.approval_id,
            operation: raw.operation,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Derive the frozen idempotency key from one action ID and exact fingerprint.
pub fn derive_communication_action_idempotency_key(
    action_id: &OpaqueId,
    action_fingerprint: &Sha256Ref,
) -> Result<Hex64, CommunicationContractError> {
    let fingerprint_hex = action_fingerprint
        .as_str()
        .strip_prefix("sha256:")
        .ok_or(CommunicationContractError::Fingerprint)?;
    let fingerprint = Hex64::parse(fingerprint_hex.to_owned())?.decode()?;
    let id_bytes = action_id.as_str().as_bytes();
    let id_length =
        u32::try_from(id_bytes.len()).map_err(|_| CommunicationContractError::Bounds)?;
    let mut hasher = Sha256::new();
    hasher.update(b"luca.communication.action.idempotency.v1\0");
    hasher.update(id_length.to_be_bytes());
    hasher.update(id_bytes);
    hasher.update(fingerprint);
    Hex64::parse(hex::encode(hasher.finalize())).map_err(CommunicationContractError::Value)
}

/// Desktop-held, non-bearer authority for one exact active managed turn.
///
/// The actual local broker transport remains independently authenticated. This
/// record is safe to persist as body-free authority evidence and is not a
/// signing or publication capability by itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TurnCommunicationCapabilityV1 {
    pub protocol: String,
    pub capability_id: OpaqueId,
    pub actor_pubkey: Hex64,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub runtime_binding_ref: Sha256Ref,
    pub source_conversation_id: OpaqueId,
    pub turn_id: OpaqueId,
    pub dispatch_receipt_id: OpaqueId,
    pub causal_root_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causal_parent_action_id: Option<OpaqueId>,
    pub causal_depth: SafeU53,
    pub cancellation_epoch: SafeU53,
    pub allowed_operations: Vec<CommunicationOperationKindV1>,
    pub issued_at: CanonicalTimestamp,
    pub expires_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawTurnCommunicationCapabilityV1 {
    protocol: String,
    capability_id: OpaqueId,
    actor_pubkey: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    runtime_binding_ref: Sha256Ref,
    source_conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    causal_root_id: OpaqueId,
    causal_parent_action_id: Option<OpaqueId>,
    causal_depth: SafeU53,
    cancellation_epoch: SafeU53,
    allowed_operations: Vec<CommunicationOperationKindV1>,
    issued_at: CanonicalTimestamp,
    expires_at: CanonicalTimestamp,
}

impl TurnCommunicationCapabilityV1 {
    /// Validate the capability independently from a particular action.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(
            self.protocol.as_str(),
            TURN_COMMUNICATION_CAPABILITY_PROTOCOL,
        )?;
        if self.actor_pubkey != self.resident_pubkey
            || self.owner_pubkey == self.resident_pubkey
            || self.causal_depth.get() > MAX_COMMUNICATION_CAUSAL_DEPTH
            || (self.causal_depth.get() == 0) != self.causal_parent_action_id.is_none()
            || self.allowed_operations.is_empty()
            || !timestamp_before_or_equal(&self.issued_at, &self.expires_at)
        {
            return Err(CommunicationContractError::Binding);
        }
        bounded_sorted_unique(&self.allowed_operations, MAX_COMMUNICATION_OPERATIONS)
    }

    /// Validate this capability against one canonical desktop time.
    pub fn validate_at(&self, now: &CanonicalTimestamp) -> Result<(), CommunicationContractError> {
        self.validate()?;
        if !timestamp_before_or_equal(&self.issued_at, now)
            || !timestamp_before_or_equal(now, &self.expires_at)
        {
            return Err(CommunicationContractError::Expired);
        }
        Ok(())
    }

    /// Prove that one action belongs to this exact active turn.
    pub fn validate_request(
        &self,
        request: &CommunicationActionRequestV1,
        now: &CanonicalTimestamp,
    ) -> Result<(), CommunicationContractError> {
        self.validate_at(now)?;
        request.validate_at(now)?;
        if self.actor_pubkey != request.actor_pubkey
            || self.owner_pubkey != request.owner_pubkey
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.runtime_binding_ref != request.runtime_binding_ref
            || self.source_conversation_id != request.source_conversation_id
            || self.turn_id != request.turn_id
            || self.dispatch_receipt_id != request.dispatch_receipt_id
            || self.causal_root_id != request.causal_root_id
            || self.causal_parent_action_id != request.causal_parent_action_id
            || self.causal_depth != request.causal_depth
            || self.cancellation_epoch != request.cancellation_epoch
            || !timestamp_before_or_equal(&request.expires_at, &self.expires_at)
            || self
                .allowed_operations
                .binary_search(&request.operation.kind())
                .is_err()
        {
            return Err(CommunicationContractError::Binding);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for TurnCommunicationCapabilityV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawTurnCommunicationCapabilityV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            capability_id: raw.capability_id,
            actor_pubkey: raw.actor_pubkey,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            runtime_binding_ref: raw.runtime_binding_ref,
            source_conversation_id: raw.source_conversation_id,
            turn_id: raw.turn_id,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            causal_root_id: raw.causal_root_id,
            causal_parent_action_id: raw.causal_parent_action_id,
            causal_depth: raw.causal_depth,
            cancellation_epoch: raw.cancellation_epoch,
            allowed_operations: raw.allowed_operations,
            issued_at: raw.issued_at,
            expires_at: raw.expires_at,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Exact one-shot owner approval bound to a single semantic action.
///
/// Only body-free fingerprints cross the approval boundary. Any content,
/// artifact, destination, runtime, participant-set, epoch, or turn change
/// invalidates the approval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommunicationApprovalBindingV1 {
    pub protocol: String,
    pub approval_id: OpaqueId,
    pub action_id: OpaqueId,
    pub action_fingerprint: Sha256Ref,
    pub content_ref: Sha256Ref,
    pub artifact_set_ref: Sha256Ref,
    pub destination_ref: Sha256Ref,
    pub participant_set_ref: Sha256Ref,
    pub operation: CommunicationOperationKindV1,
    pub actor_pubkey: Hex64,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub runtime_binding_ref: Sha256Ref,
    pub source_conversation_id: OpaqueId,
    pub turn_id: OpaqueId,
    pub dispatch_receipt_id: OpaqueId,
    pub causal_root_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causal_parent_action_id: Option<OpaqueId>,
    pub causal_depth: SafeU53,
    pub idempotency_key: Hex64,
    pub cancellation_epoch: SafeU53,
    pub approved_at: CanonicalTimestamp,
    pub expires_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommunicationApprovalBindingV1 {
    protocol: String,
    approval_id: OpaqueId,
    action_id: OpaqueId,
    action_fingerprint: Sha256Ref,
    content_ref: Sha256Ref,
    artifact_set_ref: Sha256Ref,
    destination_ref: Sha256Ref,
    participant_set_ref: Sha256Ref,
    operation: CommunicationOperationKindV1,
    actor_pubkey: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    runtime_binding_ref: Sha256Ref,
    source_conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    causal_root_id: OpaqueId,
    causal_parent_action_id: Option<OpaqueId>,
    causal_depth: SafeU53,
    idempotency_key: Hex64,
    cancellation_epoch: SafeU53,
    approved_at: CanonicalTimestamp,
    expires_at: CanonicalTimestamp,
}

impl CommunicationApprovalBindingV1 {
    /// Validate the internal shape of this one-shot approval.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, COMMUNICATION_APPROVAL_PROTOCOL)?;
        if self.actor_pubkey != self.resident_pubkey
            || self.owner_pubkey == self.resident_pubkey
            || self.causal_depth.get() > MAX_COMMUNICATION_CAUSAL_DEPTH
            || (self.causal_depth.get() == 0) != self.causal_parent_action_id.is_none()
            || !timestamp_before_or_equal(&self.approved_at, &self.expires_at)
        {
            return Err(CommunicationContractError::Binding);
        }
        Ok(())
    }

    /// Validate this approval against one exact request at desktop time `now`.
    pub fn validate_request(
        &self,
        request: &CommunicationActionRequestV1,
        now: &CanonicalTimestamp,
    ) -> Result<(), CommunicationContractError> {
        self.validate()?;
        request.validate_at(now)?;
        if !timestamp_before_or_equal(&self.approved_at, now)
            || !timestamp_before_or_equal(now, &self.expires_at)
        {
            return Err(CommunicationContractError::Expired);
        }
        if request.approval_id.as_ref() != Some(&self.approval_id)
            || self.action_id != request.action_id
            || self.action_fingerprint != request.action_fingerprint
            || self.content_ref != request.content_ref()?
            || self.artifact_set_ref != request.artifact_set_ref()?
            || self.destination_ref != request.destination_ref()?
            || self.participant_set_ref != *request.destination.participant_set_ref()
            || self.operation != request.operation.kind()
            || self.actor_pubkey != request.actor_pubkey
            || self.owner_pubkey != request.owner_pubkey
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.runtime_binding_ref != request.runtime_binding_ref
            || self.source_conversation_id != request.source_conversation_id
            || self.turn_id != request.turn_id
            || self.dispatch_receipt_id != request.dispatch_receipt_id
            || self.causal_root_id != request.causal_root_id
            || self.causal_parent_action_id != request.causal_parent_action_id
            || self.causal_depth != request.causal_depth
            || self.idempotency_key != request.idempotency_key
            || self.cancellation_epoch != request.cancellation_epoch
            || !timestamp_before_or_equal(&request.expires_at, &self.expires_at)
        {
            return Err(CommunicationContractError::Binding);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for CommunicationApprovalBindingV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawCommunicationApprovalBindingV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            approval_id: raw.approval_id,
            action_id: raw.action_id,
            action_fingerprint: raw.action_fingerprint,
            content_ref: raw.content_ref,
            artifact_set_ref: raw.artifact_set_ref,
            destination_ref: raw.destination_ref,
            participant_set_ref: raw.participant_set_ref,
            operation: raw.operation,
            actor_pubkey: raw.actor_pubkey,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            runtime_binding_ref: raw.runtime_binding_ref,
            source_conversation_id: raw.source_conversation_id,
            turn_id: raw.turn_id,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            causal_root_id: raw.causal_root_id,
            causal_parent_action_id: raw.causal_parent_action_id,
            causal_depth: raw.causal_depth,
            idempotency_key: raw.idempotency_key,
            cancellation_epoch: raw.cancellation_epoch,
            approved_at: raw.approved_at,
            expires_at: raw.expires_at,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Terminal semantic action outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationActionDispositionV1 {
    Published,
    Replayed,
    Denied,
    Cancelled,
    Expired,
    Failed,
}

/// Whether publication separately requested or produced resident activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationActivationStateV1 {
    NotRequested,
    Reserved,
    Activated,
    Skipped,
    Failed,
}

/// Body-free receipt for one exact semantic communication action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommunicationActionReceiptV1 {
    pub protocol: String,
    pub receipt_id: OpaqueId,
    pub action_id: OpaqueId,
    pub action_fingerprint: Sha256Ref,
    pub destination_ref: Sha256Ref,
    pub participant_set_ref: Sha256Ref,
    pub operation: CommunicationOperationKindV1,
    pub actor_pubkey: Hex64,
    pub owner_pubkey: Hex64,
    pub resident_pubkey: Hex64,
    pub session_epoch: SafeU53,
    pub runtime_binding_ref: Sha256Ref,
    pub source_conversation_id: OpaqueId,
    pub turn_id: OpaqueId,
    pub dispatch_receipt_id: OpaqueId,
    pub causal_root_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causal_parent_action_id: Option<OpaqueId>,
    pub causal_depth: SafeU53,
    pub idempotency_key: Hex64,
    pub cancellation_epoch: SafeU53,
    pub request_expires_at: CanonicalTimestamp,
    pub disposition: CommunicationActionDispositionV1,
    pub activation_state: CommunicationActivationStateV1,
    pub activated_resident_pubkeys: Vec<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_sha256: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_receipt_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<OpaqueId>,
    pub completed_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommunicationActionReceiptV1 {
    protocol: String,
    receipt_id: OpaqueId,
    action_id: OpaqueId,
    action_fingerprint: Sha256Ref,
    destination_ref: Sha256Ref,
    participant_set_ref: Sha256Ref,
    operation: CommunicationOperationKindV1,
    actor_pubkey: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    session_epoch: SafeU53,
    runtime_binding_ref: Sha256Ref,
    source_conversation_id: OpaqueId,
    turn_id: OpaqueId,
    dispatch_receipt_id: OpaqueId,
    causal_root_id: OpaqueId,
    causal_parent_action_id: Option<OpaqueId>,
    causal_depth: SafeU53,
    idempotency_key: Hex64,
    cancellation_epoch: SafeU53,
    request_expires_at: CanonicalTimestamp,
    disposition: CommunicationActionDispositionV1,
    activation_state: CommunicationActivationStateV1,
    activated_resident_pubkeys: Vec<Hex64>,
    event_id: Option<Hex64>,
    event_sha256: Option<Hex64>,
    publication_receipt_id: Option<OpaqueId>,
    diagnostic_code: Option<OpaqueId>,
    completed_at: CanonicalTimestamp,
}

impl CommunicationActionReceiptV1 {
    /// Validate body-free lifecycle fields.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, COMMUNICATION_ACTION_PROTOCOL)?;
        if self.actor_pubkey != self.resident_pubkey
            || self.owner_pubkey == self.resident_pubkey
            || self.causal_depth.get() > MAX_COMMUNICATION_CAUSAL_DEPTH
            || (self.causal_depth.get() == 0) != self.causal_parent_action_id.is_none()
        {
            return Err(CommunicationContractError::Binding);
        }
        bounded_sorted_unique(
            &self.activated_resident_pubkeys,
            MAX_COMMUNICATION_PARTICIPANTS,
        )?;
        let published = matches!(
            self.disposition,
            CommunicationActionDispositionV1::Published
                | CommunicationActionDispositionV1::Replayed
        );
        if published
            != (self.event_id.is_some()
                && self.event_sha256.is_some()
                && self.publication_receipt_id.is_some())
            || (published && self.diagnostic_code.is_some())
            || (!published && self.diagnostic_code.is_none())
            || (self.activation_state == CommunicationActivationStateV1::Activated
                && self.activated_resident_pubkeys.is_empty())
            || (self.activation_state != CommunicationActivationStateV1::Activated
                && !self.activated_resident_pubkeys.is_empty())
        {
            return Err(CommunicationContractError::State);
        }
        Ok(())
    }

    /// Validate that this body-free receipt binds one exact request.
    pub fn validate_request(
        &self,
        request: &CommunicationActionRequestV1,
    ) -> Result<(), CommunicationContractError> {
        self.validate()?;
        request.validate()?;
        if self.action_id != request.action_id
            || self.action_fingerprint != request.action_fingerprint
            || self.destination_ref != request.destination_ref()?
            || self.participant_set_ref != *request.destination.participant_set_ref()
            || self.operation != request.operation.kind()
            || self.actor_pubkey != request.actor_pubkey
            || self.owner_pubkey != request.owner_pubkey
            || self.resident_pubkey != request.resident_pubkey
            || self.session_epoch != request.session_epoch
            || self.runtime_binding_ref != request.runtime_binding_ref
            || self.source_conversation_id != request.source_conversation_id
            || self.turn_id != request.turn_id
            || self.dispatch_receipt_id != request.dispatch_receipt_id
            || self.causal_root_id != request.causal_root_id
            || self.causal_parent_action_id != request.causal_parent_action_id
            || self.causal_depth != request.causal_depth
            || self.idempotency_key != request.idempotency_key
            || self.cancellation_epoch != request.cancellation_epoch
            || self.request_expires_at != request.expires_at
        {
            return Err(CommunicationContractError::Binding);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for CommunicationActionReceiptV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawCommunicationActionReceiptV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            receipt_id: raw.receipt_id,
            action_id: raw.action_id,
            action_fingerprint: raw.action_fingerprint,
            destination_ref: raw.destination_ref,
            participant_set_ref: raw.participant_set_ref,
            operation: raw.operation,
            actor_pubkey: raw.actor_pubkey,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            session_epoch: raw.session_epoch,
            runtime_binding_ref: raw.runtime_binding_ref,
            source_conversation_id: raw.source_conversation_id,
            turn_id: raw.turn_id,
            dispatch_receipt_id: raw.dispatch_receipt_id,
            causal_root_id: raw.causal_root_id,
            causal_parent_action_id: raw.causal_parent_action_id,
            causal_depth: raw.causal_depth,
            idempotency_key: raw.idempotency_key,
            cancellation_epoch: raw.cancellation_epoch,
            request_expires_at: raw.request_expires_at,
            disposition: raw.disposition,
            activation_state: raw.activation_state,
            activated_resident_pubkeys: raw.activated_resident_pubkeys,
            event_id: raw.event_id,
            event_sha256: raw.event_sha256,
            publication_receipt_id: raw.publication_receipt_id,
            diagnostic_code: raw.diagnostic_code,
            completed_at: raw.completed_at,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Durable encrypted communication outbox lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationActionOutboxStateV1 {
    Prepared,
    Submitted,
    /// The exact signed event may or may not have reached the relay.
    ///
    /// This is deliberately nonterminal: relay absence is not proof that an
    /// earlier submission failed, so reconciliation may only query or retry
    /// the same frozen event.
    PublicationUnknown,
    Accepted,
    Cancelled,
    Rejected,
    Failed,
}

/// One encrypted exact-event outbox row.
///
/// The exact event bytes live behind `sealed_event_handle`; this contract can
/// carry only their hash and opaque encrypted-store handle, never raw JSON.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct CommunicationActionOutboxV1 {
    pub protocol: String,
    pub outbox_id: OpaqueId,
    pub request: CommunicationActionRequestV1,
    pub action_fingerprint: Sha256Ref,
    pub sealed_event_handle: OpaqueId,
    pub exact_event_sha256: Hex64,
    /// The immutable Nostr event ID computed from the exact signed event.
    pub expected_event_id: Hex64,
    pub state: CommunicationActionOutboxStateV1,
    pub prepared_at: CanonicalTimestamp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<CanonicalTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_at: Option<CanonicalTimestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_receipt_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<OpaqueId>,
}

impl std::fmt::Debug for CommunicationActionOutboxV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CommunicationActionOutboxV1")
            .field("protocol", &self.protocol)
            .field("outbox_id", &self.outbox_id)
            .field("request", &"[REDACTED]")
            .field("action_fingerprint", &self.action_fingerprint)
            .field("sealed_event_handle", &"[REDACTED]")
            .field("exact_event_sha256", &self.exact_event_sha256)
            .field("expected_event_id", &self.expected_event_id)
            .field("state", &self.state)
            .field("prepared_at", &self.prepared_at)
            .field("submitted_at", &self.submitted_at)
            .field("terminal_at", &self.terminal_at)
            .field("accepted_event_id", &self.accepted_event_id)
            .field("publication_receipt_id", &self.publication_receipt_id)
            .field("diagnostic_code", &self.diagnostic_code)
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommunicationActionOutboxV1 {
    protocol: String,
    outbox_id: OpaqueId,
    request: CommunicationActionRequestV1,
    action_fingerprint: Sha256Ref,
    sealed_event_handle: OpaqueId,
    exact_event_sha256: Hex64,
    expected_event_id: Hex64,
    state: CommunicationActionOutboxStateV1,
    prepared_at: CanonicalTimestamp,
    submitted_at: Option<CanonicalTimestamp>,
    terminal_at: Option<CanonicalTimestamp>,
    accepted_event_id: Option<Hex64>,
    publication_receipt_id: Option<OpaqueId>,
    diagnostic_code: Option<OpaqueId>,
}

impl CommunicationActionOutboxV1 {
    /// Validate exact request binding and lifecycle state.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, COMMUNICATION_ACTION_OUTBOX_PROTOCOL)?;
        self.request.validate()?;
        if self.action_fingerprint != self.request.action_fingerprint {
            return Err(CommunicationContractError::Binding);
        }
        let state_ok = match self.state {
            CommunicationActionOutboxStateV1::Prepared => {
                self.submitted_at.is_none()
                    && self.terminal_at.is_none()
                    && self.accepted_event_id.is_none()
                    && self.publication_receipt_id.is_none()
                    && self.diagnostic_code.is_none()
            }
            CommunicationActionOutboxStateV1::Submitted => {
                self.submitted_at.is_some()
                    && self.terminal_at.is_none()
                    && self.accepted_event_id.is_none()
                    && self.publication_receipt_id.is_none()
                    && self.diagnostic_code.is_none()
            }
            CommunicationActionOutboxStateV1::PublicationUnknown => {
                self.submitted_at.is_some()
                    && self.terminal_at.is_none()
                    && self.accepted_event_id.is_none()
                    && self.publication_receipt_id.is_none()
                    && self.diagnostic_code.is_some()
            }
            CommunicationActionOutboxStateV1::Accepted => {
                self.submitted_at.is_some()
                    && self.terminal_at.is_some()
                    && self.accepted_event_id.as_ref() == Some(&self.expected_event_id)
                    && self.publication_receipt_id.is_some()
                    && self.diagnostic_code.is_none()
            }
            CommunicationActionOutboxStateV1::Cancelled
            | CommunicationActionOutboxStateV1::Rejected
            | CommunicationActionOutboxStateV1::Failed => {
                self.terminal_at.is_some()
                    && self.accepted_event_id.is_none()
                    && self.publication_receipt_id.is_none()
                    && self.diagnostic_code.is_some()
            }
        };
        if !state_ok
            || self
                .submitted_at
                .as_ref()
                .is_some_and(|timestamp| !timestamp_before_or_equal(&self.prepared_at, timestamp))
            || self.terminal_at.as_ref().is_some_and(|timestamp| {
                let lower = self.submitted_at.as_ref().unwrap_or(&self.prepared_at);
                !timestamp_before_or_equal(lower, timestamp)
            })
        {
            return Err(CommunicationContractError::State);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for CommunicationActionOutboxV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawCommunicationActionOutboxV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            outbox_id: raw.outbox_id,
            request: raw.request,
            action_fingerprint: raw.action_fingerprint,
            sealed_event_handle: raw.sealed_event_handle,
            exact_event_sha256: raw.exact_event_sha256,
            expected_event_id: raw.expected_event_id,
            state: raw.state,
            prepared_at: raw.prepared_at,
            submitted_at: raw.submitted_at,
            terminal_at: raw.terminal_at,
            accepted_event_id: raw.accepted_event_id,
            publication_receipt_id: raw.publication_receipt_id,
            diagnostic_code: raw.diagnostic_code,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Stable filters for the unified owner or resident Inbox projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxCategoryV1 {
    All,
    Direct,
    Mentions,
    Threads,
    NeedsAction,
    Agents,
    Reminders,
    Drafts,
}

/// Stable source kind for an Inbox item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxItemKindV1 {
    DirectMessage,
    Mention,
    ThreadReply,
    PermissionRequest,
    AgentMessage,
    Reminder,
    Draft,
}

/// One deterministic Inbox projection item.
///
/// The item contains only semantic deep-link identifiers. It cannot carry a
/// filesystem path, raw relay event, signing material, or arbitrary diagnostic
/// text. Preview text is presentation content and is redacted from `Debug`.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct InboxItemV1 {
    pub protocol: String,
    pub item_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub viewer_pubkey: Hex64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_pubkey: Option<Hex64>,
    pub recipient_pubkeys: Vec<Hex64>,
    pub kind: InboxItemKindV1,
    pub primary_category: InboxCategoryV1,
    pub categories: Vec<InboxCategoryV1>,
    pub conversation_id: OpaqueId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_state_id: Option<OpaqueId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_root_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<Hex64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    pub occurred_at: CanonicalTimestamp,
    pub unread: bool,
    pub acknowledged: bool,
    pub handled: bool,
    pub muted: bool,
    pub requires_action: bool,
}

impl std::fmt::Debug for InboxItemV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("InboxItemV1")
            .field("item_id", &self.item_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("viewer_pubkey", &self.viewer_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("kind", &self.kind)
            .field("primary_category", &self.primary_category)
            .field("categories", &self.categories)
            .field("conversation_id", &self.conversation_id)
            .field("source_event_id", &self.source_event_id)
            .field("local_state_id", &self.local_state_id)
            .field("preview", &self.preview.as_ref().map(|_| "[REDACTED]"))
            .field("occurred_at", &self.occurred_at)
            .field("unread", &self.unread)
            .field("acknowledged", &self.acknowledged)
            .field("handled", &self.handled)
            .field("muted", &self.muted)
            .field("requires_action", &self.requires_action)
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInboxItemV1 {
    protocol: String,
    item_id: OpaqueId,
    owner_pubkey: Hex64,
    viewer_pubkey: Hex64,
    resident_pubkey: Option<Hex64>,
    recipient_pubkeys: Vec<Hex64>,
    kind: InboxItemKindV1,
    primary_category: InboxCategoryV1,
    categories: Vec<InboxCategoryV1>,
    conversation_id: OpaqueId,
    source_event_id: Option<Hex64>,
    local_state_id: Option<OpaqueId>,
    thread_root_event_id: Option<Hex64>,
    target_event_id: Option<Hex64>,
    preview: Option<String>,
    occurred_at: CanonicalTimestamp,
    unread: bool,
    acknowledged: bool,
    handled: bool,
    muted: bool,
    requires_action: bool,
}

impl InboxItemV1 {
    /// Validate deterministic category, viewer, and deep-link invariants.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, INBOX_PROJECTION_PROTOCOL)?;
        bounded_sorted_unique(&self.recipient_pubkeys, MAX_COMMUNICATION_PARTICIPANTS)?;
        bounded_sorted_unique(&self.categories, 8)?;
        if self.recipient_pubkeys.is_empty()
            || !self.recipient_pubkeys.contains(&self.viewer_pubkey)
            || !self.categories.contains(&InboxCategoryV1::All)
            || !self.categories.contains(&self.primary_category)
            || (self.source_event_id.is_none() == self.local_state_id.is_none())
            || self.acknowledged && self.unread
            || self.handled && self.requires_action
        {
            return Err(CommunicationContractError::State);
        }
        match &self.resident_pubkey {
            Some(resident) if resident != &self.viewer_pubkey => {
                return Err(CommunicationContractError::Binding)
            }
            None if self.viewer_pubkey != self.owner_pubkey => {
                return Err(CommunicationContractError::Binding)
            }
            _ => {}
        }
        if let Some(preview) = &self.preview {
            bounded_text(preview, MAX_INBOX_PREVIEW_BYTES, false)?;
        }
        if matches!(self.kind, InboxItemKindV1::ThreadReply) != self.thread_root_event_id.is_some()
            || matches!(self.kind, InboxItemKindV1::PermissionRequest) != self.requires_action
            || matches!(self.kind, InboxItemKindV1::Draft) != self.local_state_id.is_some()
        {
            return Err(CommunicationContractError::State);
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for InboxItemV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawInboxItemV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            item_id: raw.item_id,
            owner_pubkey: raw.owner_pubkey,
            viewer_pubkey: raw.viewer_pubkey,
            resident_pubkey: raw.resident_pubkey,
            recipient_pubkeys: raw.recipient_pubkeys,
            kind: raw.kind,
            primary_category: raw.primary_category,
            categories: raw.categories,
            conversation_id: raw.conversation_id,
            source_event_id: raw.source_event_id,
            local_state_id: raw.local_state_id,
            thread_root_event_id: raw.thread_root_event_id,
            target_event_id: raw.target_event_id,
            preview: raw.preview,
            occurred_at: raw.occurred_at,
            unread: raw.unread,
            acknowledged: raw.acknowledged,
            handled: raw.handled,
            muted: raw.muted,
            requires_action: raw.requires_action,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

/// Deterministic page of unified Inbox items for exactly one owner or resident.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct InboxProjectionV1 {
    pub protocol: String,
    pub projection_id: OpaqueId,
    pub owner_pubkey: Hex64,
    pub viewer_pubkey: Hex64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_pubkey: Option<Hex64>,
    pub category: InboxCategoryV1,
    pub generated_at: CanonicalTimestamp,
    pub items: Vec<InboxItemV1>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<OpaqueId>,
    pub has_more: bool,
}

impl std::fmt::Debug for InboxProjectionV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("InboxProjectionV1")
            .field("projection_id", &self.projection_id)
            .field("owner_pubkey", &self.owner_pubkey)
            .field("viewer_pubkey", &self.viewer_pubkey)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("category", &self.category)
            .field("generated_at", &self.generated_at)
            .field("item_count", &self.items.len())
            .field("next_cursor", &self.next_cursor)
            .field("has_more", &self.has_more)
            .finish()
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawInboxProjectionV1 {
    protocol: String,
    projection_id: OpaqueId,
    owner_pubkey: Hex64,
    viewer_pubkey: Hex64,
    resident_pubkey: Option<Hex64>,
    category: InboxCategoryV1,
    generated_at: CanonicalTimestamp,
    items: Vec<InboxItemV1>,
    next_cursor: Option<OpaqueId>,
    has_more: bool,
}

impl InboxProjectionV1 {
    /// Validate page size, viewer isolation, filters, and stable item identity.
    pub fn validate(&self) -> Result<(), CommunicationContractError> {
        require_protocol(&self.protocol, INBOX_PROJECTION_PROTOCOL)?;
        if self.items.len() > MAX_INBOX_ITEMS
            || self.has_more != self.next_cursor.is_some()
            || self
                .items
                .windows(2)
                .any(|pair| pair[0].item_id >= pair[1].item_id)
        {
            return Err(CommunicationContractError::Sequence);
        }
        match &self.resident_pubkey {
            Some(resident) if resident != &self.viewer_pubkey => {
                return Err(CommunicationContractError::Binding)
            }
            None if self.viewer_pubkey != self.owner_pubkey => {
                return Err(CommunicationContractError::Binding)
            }
            _ => {}
        }
        self.items.iter().try_for_each(|item| {
            item.validate()?;
            if item.owner_pubkey != self.owner_pubkey
                || item.viewer_pubkey != self.viewer_pubkey
                || item.resident_pubkey != self.resident_pubkey
                || !item.categories.contains(&self.category)
            {
                return Err(CommunicationContractError::Binding);
            }
            Ok(())
        })
    }
}

impl<'de> Deserialize<'de> for InboxProjectionV1 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RawInboxProjectionV1::deserialize(deserializer)?;
        let value = Self {
            protocol: raw.protocol,
            projection_id: raw.projection_id,
            owner_pubkey: raw.owner_pubkey,
            viewer_pubkey: raw.viewer_pubkey,
            resident_pubkey: raw.resident_pubkey,
            category: raw.category,
            generated_at: raw.generated_at,
            items: raw.items,
            next_cursor: raw.next_cursor,
            has_more: raw.has_more,
        };
        value.validate().map_err(serde::de::Error::custom)?;
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).expect("fixture hex")
    }

    fn id(value: &str) -> OpaqueId {
        OpaqueId::parse(value).expect("fixture ID")
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64)))
            .expect("fixture sha256 reference")
    }

    fn time(value: &str) -> CanonicalTimestamp {
        CanonicalTimestamp::parse(value).expect("fixture time")
    }

    fn safe(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("fixture safe integer")
    }

    fn refresh_request(request: &mut CommunicationActionRequestV1) {
        request.action_fingerprint = request
            .derive_action_fingerprint()
            .expect("action fingerprint");
        request.idempotency_key = request.derive_idempotency_key().expect("idempotency key");
    }

    fn request(operation: CommunicationOperationV1) -> CommunicationActionRequestV1 {
        let mut request = CommunicationActionRequestV1 {
            protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
            action_id: id("action-1"),
            idempotency_key: hex('0'),
            action_fingerprint: sha('0'),
            actor_pubkey: hex('2'),
            owner_pubkey: hex('1'),
            resident_pubkey: hex('2'),
            session_epoch: safe(4),
            runtime_binding_ref: sha('3'),
            source_conversation_id: id("conversation-source"),
            destination: CommunicationDestinationV1::ExistingConversation {
                conversation_id: id("conversation-destination"),
                participant_set_version: safe(7),
                participant_set_ref: sha('4'),
            },
            turn_id: id("turn-1"),
            dispatch_receipt_id: id("dispatch-1"),
            causal_root_id: id("causal-root-1"),
            causal_parent_action_id: None,
            causal_depth: safe(0),
            cancellation_epoch: safe(2),
            expires_at: time("2026-08-11T12:00:00Z"),
            approval_id: None,
            operation,
        };
        refresh_request(&mut request);
        request
    }

    fn send_request() -> CommunicationActionRequestV1 {
        request(CommunicationOperationV1::SendMessage {
            body: "bounded semantic message".to_owned(),
            reply_to_event_id: None,
            mention_pubkeys: Vec::new(),
            activation_pubkeys: Vec::new(),
            artifact_handles: Vec::new(),
        })
    }

    fn capability(request: &CommunicationActionRequestV1) -> TurnCommunicationCapabilityV1 {
        TurnCommunicationCapabilityV1 {
            protocol: TURN_COMMUNICATION_CAPABILITY_PROTOCOL.to_owned(),
            capability_id: id("capability-1"),
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
            cancellation_epoch: request.cancellation_epoch,
            allowed_operations: vec![request.operation.kind()],
            issued_at: time("2026-08-11T11:00:00Z"),
            expires_at: request.expires_at.clone(),
        }
    }

    fn approved_delete_request() -> CommunicationActionRequestV1 {
        let mut request = request(CommunicationOperationV1::DeleteOwnMessage {
            target_event_id: hex('5'),
        });
        request.approval_id = Some(id("approval-1"));
        refresh_request(&mut request);
        request
    }

    fn approval(request: &CommunicationActionRequestV1) -> CommunicationApprovalBindingV1 {
        CommunicationApprovalBindingV1 {
            protocol: COMMUNICATION_APPROVAL_PROTOCOL.to_owned(),
            approval_id: request.approval_id.clone().expect("approval ID"),
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
            approved_at: time("2026-08-11T11:05:00Z"),
            expires_at: request.expires_at.clone(),
        }
    }

    fn inbox_item(viewer_is_resident: bool) -> InboxItemV1 {
        let owner = hex('1');
        let resident = hex('2');
        InboxItemV1 {
            protocol: INBOX_PROJECTION_PROTOCOL.to_owned(),
            item_id: id("inbox-item-1"),
            owner_pubkey: owner.clone(),
            viewer_pubkey: if viewer_is_resident {
                resident.clone()
            } else {
                owner.clone()
            },
            resident_pubkey: viewer_is_resident.then_some(resident.clone()),
            recipient_pubkeys: vec![owner, resident],
            kind: InboxItemKindV1::DirectMessage,
            primary_category: InboxCategoryV1::Direct,
            categories: vec![InboxCategoryV1::All, InboxCategoryV1::Direct],
            conversation_id: id("conversation-destination"),
            source_event_id: Some(hex('5')),
            local_state_id: None,
            thread_root_event_id: None,
            target_event_id: None,
            preview: Some("private preview".to_owned()),
            occurred_at: time("2026-08-11T11:30:00Z"),
            unread: true,
            acknowledged: false,
            handled: false,
            muted: false,
            requires_action: false,
        }
    }

    #[test]
    fn valid_request_capability_and_approval_bind_exactly() {
        let request = send_request();
        let now = time("2026-08-11T11:30:00Z");
        capability(&request)
            .validate_request(&request, &now)
            .expect("valid exact turn binding");

        let delete = approved_delete_request();
        approval(&delete)
            .validate_request(&delete, &now)
            .expect("valid exact one-shot approval");
    }

    #[test]
    fn stale_and_mismatched_turn_authority_is_rejected() {
        let request = send_request();
        let capability = capability(&request);
        assert!(matches!(
            capability.validate_request(&request, &time("2026-08-11T12:00:01Z")),
            Err(CommunicationContractError::Expired)
        ));

        let mut wrong_turn = request.clone();
        wrong_turn.turn_id = id("turn-2");
        refresh_request(&mut wrong_turn);
        assert!(matches!(
            capability.validate_request(&wrong_turn, &time("2026-08-11T11:30:00Z")),
            Err(CommunicationContractError::Binding)
        ));

        let mut wrong_cancel = request.clone();
        wrong_cancel.cancellation_epoch = safe(3);
        refresh_request(&mut wrong_cancel);
        assert!(matches!(
            capability.validate_request(&wrong_cancel, &time("2026-08-11T11:30:00Z")),
            Err(CommunicationContractError::Binding)
        ));
    }

    #[test]
    fn approval_rejects_any_content_or_destination_change() {
        let request = approved_delete_request();
        let approval = approval(&request);
        let mut changed = request.clone();
        changed.destination = CommunicationDestinationV1::ExistingConversation {
            conversation_id: id("another-conversation"),
            participant_set_version: safe(7),
            participant_set_ref: sha('4'),
        };
        refresh_request(&mut changed);
        assert!(matches!(
            approval.validate_request(&changed, &time("2026-08-11T11:30:00Z")),
            Err(CommunicationContractError::Binding)
        ));
    }

    #[test]
    fn semantic_payload_bounds_are_enforced() {
        let oversized = CommunicationOperationV1::SendMessage {
            body: "x".repeat(MAX_COMMUNICATION_BODY_BYTES + 1),
            reply_to_event_id: None,
            mention_pubkeys: Vec::new(),
            activation_pubkeys: Vec::new(),
            artifact_handles: Vec::new(),
        };
        assert!(matches!(
            oversized.validate(),
            Err(CommunicationContractError::Bounds)
        ));

        let oversized_room = CommunicationOperationV1::CreatePrivateRoom {
            label: "x".repeat(MAX_COMMUNICATION_ROOM_LABEL_BYTES + 1),
            purpose: None,
        };
        assert!(matches!(
            oversized_room.validate(),
            Err(CommunicationContractError::Bounds)
        ));

        let mut item = inbox_item(false);
        item.preview = Some("x".repeat(MAX_INBOX_PREVIEW_BYTES + 1));
        assert!(matches!(
            item.validate(),
            Err(CommunicationContractError::Bounds)
        ));
    }

    #[test]
    fn raw_event_and_path_fields_are_not_representable() {
        let request = send_request();
        for forbidden in [
            "raw_event",
            "event_json",
            "kind",
            "tags",
            "signature",
            "local_path",
        ] {
            let mut value = serde_json::to_value(&request).expect("serialize request");
            value
                .as_object_mut()
                .expect("request object")
                .insert(forbidden.to_owned(), json!("forbidden"));
            assert!(serde_json::from_value::<CommunicationActionRequestV1>(value).is_err());
        }

        for forbidden_name in ["/Users/riley/secret.txt", "../secret.txt", "C:\\secret.txt"] {
            let value = json!({
                "handle_id": "artifact-1",
                "content_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "byte_length": 12,
                "media_type": "text/plain",
                "display_name": forbidden_name
            });
            assert!(serde_json::from_value::<OpaqueArtifactHandleV1>(value).is_err());
        }
    }

    #[test]
    fn strict_deserialization_rejects_unknown_nested_event_fields() {
        let request = send_request();
        let mut value = serde_json::to_value(&request).expect("serialize request");
        value["operation"]["raw_event"] = json!({"kind": 1, "tags": []});
        assert!(serde_json::from_value::<CommunicationActionRequestV1>(value).is_err());

        let mut destination = serde_json::to_value(&request.destination).expect("destination");
        destination["path"] = json!("/Users/riley/project");
        assert!(serde_json::from_value::<CommunicationDestinationV1>(destination).is_err());
    }

    #[test]
    fn receipt_is_body_free_and_exactly_bound() {
        let request = send_request();
        let receipt = CommunicationActionReceiptV1 {
            protocol: COMMUNICATION_ACTION_PROTOCOL.to_owned(),
            receipt_id: id("receipt-1"),
            action_id: request.action_id.clone(),
            action_fingerprint: request.action_fingerprint.clone(),
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
            causal_parent_action_id: None,
            causal_depth: safe(0),
            idempotency_key: request.idempotency_key.clone(),
            cancellation_epoch: request.cancellation_epoch,
            request_expires_at: request.expires_at.clone(),
            disposition: CommunicationActionDispositionV1::Published,
            activation_state: CommunicationActivationStateV1::NotRequested,
            activated_resident_pubkeys: Vec::new(),
            event_id: Some(hex('6')),
            event_sha256: Some(hex('7')),
            publication_receipt_id: Some(id("publication-1")),
            diagnostic_code: None,
            completed_at: time("2026-08-11T11:31:00Z"),
        };
        receipt
            .validate_request(&request)
            .expect("receipt exact binding");
        let encoded = serde_json::to_string(&receipt).expect("receipt JSON");
        for forbidden in ["body", "raw_event", "event_json", "local_path", "signature"] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[test]
    fn outbox_requires_consistent_body_free_lifecycle() {
        let request = send_request();
        let mut outbox = CommunicationActionOutboxV1 {
            protocol: COMMUNICATION_ACTION_OUTBOX_PROTOCOL.to_owned(),
            outbox_id: id("outbox-1"),
            action_fingerprint: request.action_fingerprint.clone(),
            request,
            sealed_event_handle: id("sealed-event-1"),
            exact_event_sha256: hex('8'),
            expected_event_id: hex('9'),
            state: CommunicationActionOutboxStateV1::Prepared,
            prepared_at: time("2026-08-11T11:30:00Z"),
            submitted_at: None,
            terminal_at: None,
            accepted_event_id: None,
            publication_receipt_id: None,
            diagnostic_code: None,
        };
        outbox.validate().expect("prepared outbox");
        outbox.state = CommunicationActionOutboxStateV1::Accepted;
        assert!(matches!(
            outbox.validate(),
            Err(CommunicationContractError::State)
        ));
    }

    #[test]
    fn inbox_projection_deduplicates_and_isolates_viewers() {
        let item = inbox_item(true);
        let projection = InboxProjectionV1 {
            protocol: INBOX_PROJECTION_PROTOCOL.to_owned(),
            projection_id: id("projection-1"),
            owner_pubkey: item.owner_pubkey.clone(),
            viewer_pubkey: item.viewer_pubkey.clone(),
            resident_pubkey: item.resident_pubkey.clone(),
            category: InboxCategoryV1::All,
            generated_at: time("2026-08-11T11:31:00Z"),
            items: vec![item.clone()],
            next_cursor: None,
            has_more: false,
        };
        projection.validate().expect("resident projection");

        let mut duplicate = projection.clone();
        duplicate.items.push(item);
        assert!(matches!(
            duplicate.validate(),
            Err(CommunicationContractError::Sequence)
        ));

        let mut cross_resident = projection;
        cross_resident.viewer_pubkey = hex('3');
        cross_resident.resident_pubkey = Some(hex('3'));
        assert!(matches!(
            cross_resident.validate(),
            Err(CommunicationContractError::Binding)
        ));
    }

    #[test]
    fn inbox_unknown_path_and_raw_event_fields_are_rejected() {
        let item = inbox_item(false);
        for forbidden in ["path", "deep_link", "raw_event", "diagnostic_body"] {
            let mut value = serde_json::to_value(&item).expect("serialize item");
            value
                .as_object_mut()
                .expect("item object")
                .insert(forbidden.to_owned(), Value::String("forbidden".to_owned()));
            assert!(serde_json::from_value::<InboxItemV1>(value).is_err());
        }
    }
}

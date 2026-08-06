//! Strict, versioned, body-safe continuity wire contracts.
//!
//! Every public record validates while deserializing. Invalid protocol
//! discriminators, unknown fields, cross-field mismatches, unbounded values,
//! and unsafe encrypted envelopes therefore fail before a caller can observe a
//! typed value. This module owns representations only: it has no storage, key
//! custody, retrieval, scheduling, or publication behavior.

use crate::{
    canonicalize, CanonicalError, CanonicalTimestamp, Hex64, OpaqueId, ProtocolValueError,
    SafeDiagnosticV1, SafeU53, Sha256Ref,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

/// Frozen discriminator shared by all G2 continuity V1 contracts.
pub const CONTINUITY_PROTOCOL: &str = "luca.continuity.v1";
/// Maximum RFC 8785 serialized size of a continuity packet.
pub const MAX_CONTINUITY_PACKET_BYTES: usize = 48 * 1024;
/// Maximum decoded ciphertext bytes in a single logical record.
pub const MAX_CONTINUITY_CIPHERTEXT_BYTES: usize = 1_048_576;
/// Maximum source/provenance references carried by one contract.
pub const MAX_CONTINUITY_REFS: usize = 256;
/// Maximum UTF-8 bytes in the compact resident handoff summary.
pub const MAX_HANDOFF_SUMMARY_BYTES: usize = 4 * 1024;
/// Maximum UTF-8 bytes in one handoff list item.
pub const MAX_HANDOFF_ITEM_BYTES: usize = 2 * 1024;
/// Maximum items in each compact handoff category.
pub const MAX_HANDOFF_ITEMS: usize = 32;

/// Semantic validation error for continuity V1 contracts.
#[derive(Debug, thiserror::Error)]
pub enum ContinuityError {
    /// The protocol discriminator was not the frozen V1 value.
    #[error("protocol must be luca.continuity.v1")]
    Protocol,
    /// A namespace or exact scope was structurally invalid.
    #[error("invalid continuity namespace or scope")]
    Namespace,
    /// A status-dependent field combination was invalid.
    #[error("invalid continuity status fields")]
    Status,
    /// A bounded sequence exceeded its maximum or contained duplicates.
    #[error("invalid bounded continuity sequence")]
    Sequence,
    /// The canonical packet exceeded 49152 bytes.
    #[error("canonical continuity packet exceeds 49152 bytes")]
    PacketSize,
    /// Encrypted or body-free data violated its representation boundary.
    #[error("continuity data violates its body-safe boundary")]
    BodySafety,
    /// Related authority or revision fields did not bind one another.
    #[error("invalid continuity binding")]
    Binding,
    /// RFC 8785 serialization failed during bounded validation.
    #[error(transparent)]
    Canonical(#[from] CanonicalError),
    /// An already-validated scalar could not be decoded for a derivation.
    #[error(transparent)]
    Value(#[from] ProtocolValueError),
}

fn require_protocol(value: &str) -> Result<(), ContinuityError> {
    (value == CONTINUITY_PROTOCOL)
        .then_some(())
        .ok_or(ContinuityError::Protocol)
}

fn bounded_refs<T: Ord>(values: &[T], require_nonempty: bool) -> Result<(), ContinuityError> {
    if values.len() > MAX_CONTINUITY_REFS
        || (require_nonempty && values.is_empty())
        || values.windows(2).any(|pair| pair[0] >= pair[1])
    {
        Err(ContinuityError::Sequence)
    } else {
        Ok(())
    }
}

fn bounded_handoff_text(
    value: &str,
    allow_empty: bool,
    max_bytes: usize,
) -> Result<(), ContinuityError> {
    let trimmed = value.trim();
    if (!allow_empty && trimmed.is_empty())
        || trimmed.len() != value.len()
        || value.len() > max_bytes
        || value.chars().any(|character| {
            character == '\0' || (character.is_control() && character != '\n' && character != '\t')
        })
    {
        Err(ContinuityError::BodySafety)
    } else {
        Ok(())
    }
}

fn bounded_handoff_items(values: &[String]) -> Result<(), ContinuityError> {
    if values.len() > MAX_HANDOFF_ITEMS {
        return Err(ContinuityError::Sequence);
    }
    values
        .iter()
        .try_for_each(|value| bounded_handoff_text(value, false, MAX_HANDOFF_ITEM_BYTES))
}

macro_rules! validated_deserialize {
    ($name:ident, $raw:ident) => {
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let raw = $raw::deserialize(deserializer)?;
                let value = Self::from(raw);
                value.validate().map_err(serde::de::Error::custom)?;
                Ok(value)
            }
        }
    };
}

/// Exhaustive G2 outcome vocabulary for one context layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityLayerStatusV1 {
    /// Authorized material was returned.
    Ready,
    /// The layer was authorized but contained no material.
    Empty,
    /// Current policy denied access.
    Denied,
    /// A binding or grant requires reconfirmation.
    Stale,
    /// Key custody is locked.
    Locked,
    /// The provider or store is unavailable.
    Unavailable,
    /// The layer missed its deadline.
    Timeout,
    /// The layer data or request was invalid.
    Invalid,
}

/// Authority domain represented by a continuity namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityNamespaceKindV1 {
    /// Owner-shared knowledge with explicit grant enforcement.
    OwnerBrain,
    /// One exact resident's isolated private continuity.
    ResidentPrivate,
}

/// Exact owner-brain or resident-private namespace identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityNamespaceV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Canonical owner public key.
    pub owner_pubkey: Hex64,
    /// Namespace authority domain.
    pub kind: ContinuityNamespaceKindV1,
    /// Exact resident key, present only for resident-private namespaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_pubkey: Option<Hex64>,
    /// One-way reference to the derived namespace identity.
    pub namespace_ref: Sha256Ref,
    /// Namespace encryption-key version.
    pub key_version: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityNamespaceV1 {
    protocol: String,
    owner_pubkey: Hex64,
    kind: ContinuityNamespaceKindV1,
    resident_pubkey: Option<Hex64>,
    namespace_ref: Sha256Ref,
    key_version: SafeU53,
}

impl From<RawContinuityNamespaceV1> for ContinuityNamespaceV1 {
    fn from(raw: RawContinuityNamespaceV1) -> Self {
        Self {
            protocol: raw.protocol,
            owner_pubkey: raw.owner_pubkey,
            kind: raw.kind,
            resident_pubkey: raw.resident_pubkey,
            namespace_ref: raw.namespace_ref,
            key_version: raw.key_version,
        }
    }
}

impl ContinuityNamespaceV1 {
    /// Validate namespace kind, key presence, and identity separation.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        match (&self.kind, &self.resident_pubkey) {
            (ContinuityNamespaceKindV1::OwnerBrain, None) if self.key_version.get() > 0 => Ok(()),
            (ContinuityNamespaceKindV1::ResidentPrivate, Some(resident))
                if resident != &self.owner_pubkey && self.key_version.get() > 0 =>
            {
                Ok(())
            }
            _ => Err(ContinuityError::Namespace),
        }
    }
}

validated_deserialize!(ContinuityNamespaceV1, RawContinuityNamespaceV1);

/// Exact source/project/room/conversation scope; membership is not represented.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityScopeV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Namespace reference this scope belongs to.
    pub namespace_ref: Sha256Ref,
    /// One-way reference to the canonical exact scope.
    pub scope_ref: Sha256Ref,
    /// Optional exact source identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<OpaqueId>,
    /// Optional exact project identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<OpaqueId>,
    /// Optional exact room identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub room_id: Option<OpaqueId>,
    /// Optional exact conversation identifier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<OpaqueId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityScopeV1 {
    protocol: String,
    namespace_ref: Sha256Ref,
    scope_ref: Sha256Ref,
    source_id: Option<OpaqueId>,
    project_id: Option<OpaqueId>,
    room_id: Option<OpaqueId>,
    conversation_id: Option<OpaqueId>,
}

impl From<RawContinuityScopeV1> for ContinuityScopeV1 {
    fn from(raw: RawContinuityScopeV1) -> Self {
        Self {
            protocol: raw.protocol,
            namespace_ref: raw.namespace_ref,
            scope_ref: raw.scope_ref,
            source_id: raw.source_id,
            project_id: raw.project_id,
            room_id: raw.room_id,
            conversation_id: raw.conversation_id,
        }
    }
}

impl ContinuityScopeV1 {
    /// Require at least one exact scope component.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.source_id.is_none()
            && self.project_id.is_none()
            && self.room_id.is_none()
            && self.conversation_id.is_none()
        {
            Err(ContinuityError::Namespace)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(ContinuityScopeV1, RawContinuityScopeV1);

/// Versioned encrypted logical record with body-free public metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityRecordV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable logical record identifier.
    pub record_id: OpaqueId,
    /// Exact authority namespace.
    pub namespace: ContinuityNamespaceV1,
    /// Exact retrieval scope.
    pub scope: ContinuityScopeV1,
    /// Stable machine-readable record kind.
    pub record_type: OpaqueId,
    /// Zero-based revision number.
    pub revision: SafeU53,
    /// Immediate predecessor, required after revision zero.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_record_id: Option<OpaqueId>,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Stable authorship category, never free-form prose.
    pub author_kind: OpaqueId,
    /// Sorted unique body-free provenance references.
    pub provenance_refs: Vec<Sha256Ref>,
    /// Encryption-key version, equal to the namespace key version.
    pub key_version: SafeU53,
    /// SHA-256 of canonical authenticated associated data.
    pub aad_sha256: Hex64,
    /// Canonical base64 of exactly one 24-byte XChaCha20 nonce.
    pub nonce_b64: String,
    /// Canonical base64 of non-empty bounded ciphertext.
    pub ciphertext_b64: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityRecordV1 {
    protocol: String,
    record_id: OpaqueId,
    namespace: ContinuityNamespaceV1,
    scope: ContinuityScopeV1,
    record_type: OpaqueId,
    revision: SafeU53,
    predecessor_record_id: Option<OpaqueId>,
    created_at: CanonicalTimestamp,
    author_kind: OpaqueId,
    provenance_refs: Vec<Sha256Ref>,
    key_version: SafeU53,
    aad_sha256: Hex64,
    nonce_b64: String,
    ciphertext_b64: String,
}

impl From<RawContinuityRecordV1> for ContinuityRecordV1 {
    fn from(raw: RawContinuityRecordV1) -> Self {
        Self {
            protocol: raw.protocol,
            record_id: raw.record_id,
            namespace: raw.namespace,
            scope: raw.scope,
            record_type: raw.record_type,
            revision: raw.revision,
            predecessor_record_id: raw.predecessor_record_id,
            created_at: raw.created_at,
            author_kind: raw.author_kind,
            provenance_refs: raw.provenance_refs,
            key_version: raw.key_version,
            aad_sha256: raw.aad_sha256,
            nonce_b64: raw.nonce_b64,
            ciphertext_b64: raw.ciphertext_b64,
        }
    }
}

impl ContinuityRecordV1 {
    /// Validate namespace/scope/revision bindings and the encrypted envelope.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        self.namespace.validate()?;
        self.scope.validate()?;
        bounded_refs(&self.provenance_refs, false)?;
        if self.scope.namespace_ref != self.namespace.namespace_ref
            || self.key_version != self.namespace.key_version
            || (self.revision.get() == 0) != self.predecessor_record_id.is_none()
        {
            return Err(ContinuityError::Binding);
        }
        let nonce = BASE64_STANDARD
            .decode(&self.nonce_b64)
            .map_err(|_| ContinuityError::BodySafety)?;
        let ciphertext = BASE64_STANDARD
            .decode(&self.ciphertext_b64)
            .map_err(|_| ContinuityError::BodySafety)?;
        if nonce.len() != 24
            || BASE64_STANDARD.encode(&nonce) != self.nonce_b64
            || ciphertext.is_empty()
            || ciphertext.len() > MAX_CONTINUITY_CIPHERTEXT_BYTES
            || BASE64_STANDARD.encode(&ciphertext) != self.ciphertext_b64
        {
            return Err(ContinuityError::BodySafety);
        }
        Ok(())
    }
}

validated_deserialize!(ContinuityRecordV1, RawContinuityRecordV1);

/// Provider/runtime data-egress classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderEgressV1 {
    /// Data remains in the trusted local installation.
    Local,
    /// Data may be sent to the named remote provider binding.
    Remote,
    /// Destination could not be classified and must fail closed as remote.
    Unknown,
}

/// Read-only per-responder context request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityContextRequestV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Request correlation identifier.
    pub request_id: OpaqueId,
    /// Canonical owner key.
    pub owner_pubkey: Hex64,
    /// Exact responding resident key.
    pub resident_pubkey: Hex64,
    /// Exact conversation identifier.
    pub conversation_id: OpaqueId,
    /// Current runtime/model binding reference.
    pub binding_ref: Sha256Ref,
    /// Canonical dispatch-set reference.
    pub canonical_dispatch_ref: Sha256Ref,
    /// Provider egress classification.
    pub provider_egress: ProviderEgressV1,
    /// Absolute request deadline in Unix milliseconds.
    pub deadline_unix_ms: SafeU53,
    /// Caller-requested canonical packet byte ceiling.
    pub max_packet_bytes: SafeU53,
    /// Ordered unique signed-history event identifiers.
    pub history_event_ids: Vec<Hex64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityContextRequestV1 {
    protocol: String,
    request_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    conversation_id: OpaqueId,
    binding_ref: Sha256Ref,
    canonical_dispatch_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
    deadline_unix_ms: SafeU53,
    max_packet_bytes: SafeU53,
    history_event_ids: Vec<Hex64>,
}

impl From<RawContinuityContextRequestV1> for ContinuityContextRequestV1 {
    fn from(raw: RawContinuityContextRequestV1) -> Self {
        Self {
            protocol: raw.protocol,
            request_id: raw.request_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            conversation_id: raw.conversation_id,
            binding_ref: raw.binding_ref,
            canonical_dispatch_ref: raw.canonical_dispatch_ref,
            provider_egress: raw.provider_egress,
            deadline_unix_ms: raw.deadline_unix_ms,
            max_packet_bytes: raw.max_packet_bytes,
            history_event_ids: raw.history_event_ids,
        }
    }
}

impl ContinuityContextRequestV1 {
    /// Validate responder separation and request bounds.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.deadline_unix_ms.get() == 0
            || self.max_packet_bytes.get() == 0
            || self.max_packet_bytes.get() as usize > MAX_CONTINUITY_PACKET_BYTES
            || self.history_event_ids.len() > MAX_CONTINUITY_REFS
        {
            return Err(ContinuityError::Binding);
        }
        let mut sorted = self.history_event_ids.clone();
        sorted.sort();
        sorted.dedup();
        if sorted.len() != self.history_event_ids.len() {
            return Err(ContinuityError::Sequence);
        }
        Ok(())
    }
}

validated_deserialize!(ContinuityContextRequestV1, RawContinuityContextRequestV1);

/// Bounded, structurally delimited untrusted reference material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityPacketV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Packet correlation identifier.
    pub packet_id: OpaqueId,
    /// Delimited untrusted reference content.
    pub content: String,
    /// Sorted unique provenance references.
    pub provenance_refs: Vec<Sha256Ref>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityPacketV1 {
    protocol: String,
    packet_id: OpaqueId,
    content: String,
    provenance_refs: Vec<Sha256Ref>,
}

impl From<RawContinuityPacketV1> for ContinuityPacketV1 {
    fn from(raw: RawContinuityPacketV1) -> Self {
        Self {
            protocol: raw.protocol,
            packet_id: raw.packet_id,
            content: raw.content,
            provenance_refs: raw.provenance_refs,
        }
    }
}

impl ContinuityPacketV1 {
    /// Validate provenance and total RFC 8785 packet size.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_refs(&self.provenance_refs, true)?;
        if self.content.is_empty() || canonicalize(self)?.len() > MAX_CONTINUITY_PACKET_BYTES {
            Err(ContinuityError::PacketSize)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(ContinuityPacketV1, RawContinuityPacketV1);

/// Result of one independently resolved context layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityLayerResultV1 {
    /// Stable layer identifier.
    pub layer: OpaqueId,
    /// Exhaustive layer outcome.
    pub status: ContinuityLayerStatusV1,
    /// Provenance present exactly when the layer is ready.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance_ref: Option<Sha256Ref>,
    /// Optional body-free diagnostic.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<SafeDiagnosticV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityLayerResultV1 {
    layer: OpaqueId,
    status: ContinuityLayerStatusV1,
    provenance_ref: Option<Sha256Ref>,
    diagnostic: Option<SafeDiagnosticV1>,
}

impl From<RawContinuityLayerResultV1> for ContinuityLayerResultV1 {
    fn from(raw: RawContinuityLayerResultV1) -> Self {
        Self {
            layer: raw.layer,
            status: raw.status,
            provenance_ref: raw.provenance_ref,
            diagnostic: raw.diagnostic,
        }
    }
}

impl ContinuityLayerResultV1 {
    /// Enforce symmetric ready/provenance representation.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        if (self.status == ContinuityLayerStatusV1::Ready) == self.provenance_ref.is_some() {
            Ok(())
        } else {
            Err(ContinuityError::Status)
        }
    }
}

validated_deserialize!(ContinuityLayerResultV1, RawContinuityLayerResultV1);

/// Layered read result with an optional bounded packet and body-free receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityContextResultV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Echoed request correlation identifier.
    pub request_id: OpaqueId,
    /// Exact responding resident.
    pub resident_pubkey: Hex64,
    /// Independently resolved layer results.
    pub layers: Vec<ContinuityLayerResultV1>,
    /// Packet present exactly when at least one layer is ready.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub packet: Option<ContinuityPacketV1>,
    /// One-way body-free receipt reference.
    pub receipt_ref: Sha256Ref,
    /// Body-free diagnostics only.
    pub diagnostics: Vec<SafeDiagnosticV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityContextResultV1 {
    protocol: String,
    request_id: OpaqueId,
    resident_pubkey: Hex64,
    layers: Vec<ContinuityLayerResultV1>,
    packet: Option<ContinuityPacketV1>,
    receipt_ref: Sha256Ref,
    diagnostics: Vec<SafeDiagnosticV1>,
}

impl From<RawContinuityContextResultV1> for ContinuityContextResultV1 {
    fn from(raw: RawContinuityContextResultV1) -> Self {
        Self {
            protocol: raw.protocol,
            request_id: raw.request_id,
            resident_pubkey: raw.resident_pubkey,
            layers: raw.layers,
            packet: raw.packet,
            receipt_ref: raw.receipt_ref,
            diagnostics: raw.diagnostics,
        }
    }
}

impl ContinuityContextResultV1 {
    /// Enforce bounded layers and symmetric ready/packet representation.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.layers.is_empty() || self.layers.len() > 16 || self.diagnostics.len() > 16 {
            return Err(ContinuityError::Sequence);
        }
        for layer in &self.layers {
            layer.validate()?;
        }
        if self.layers.iter().enumerate().any(|(index, layer)| {
            self.layers[..index]
                .iter()
                .any(|prior| prior.layer == layer.layer)
        }) {
            return Err(ContinuityError::Sequence);
        }
        let has_ready = self
            .layers
            .iter()
            .any(|layer| layer.status == ContinuityLayerStatusV1::Ready);
        if has_ready != self.packet.is_some() {
            return Err(ContinuityError::Status);
        }
        if let Some(packet) = &self.packet {
            packet.validate()?;
        }
        Ok(())
    }
}

validated_deserialize!(ContinuityContextResultV1, RawContinuityContextResultV1);

/// Authority state of a proposed or private continuity mutation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityMutationStateV1 {
    /// Review-gated proposal; never an owner-brain commit.
    Proposed,
    /// Committed resident-private change.
    Committed,
}

/// Proposed or committed private change with exact event provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityMutationV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable mutation identifier.
    pub mutation_id: OpaqueId,
    /// Exact namespace reference.
    pub namespace_ref: Sha256Ref,
    /// Exact scope reference.
    pub scope_ref: Sha256Ref,
    /// Proposal/commit authority state.
    pub state: ContinuityMutationStateV1,
    /// Logical record identifier.
    pub record_id: OpaqueId,
    /// Optional immediate predecessor record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predecessor_record_id: Option<OpaqueId>,
    /// Sorted unique exact signed source events.
    pub source_event_ids: Vec<Hex64>,
    /// Stable authorship category.
    pub author_kind: OpaqueId,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// One-way reference to encrypted mutation content.
    pub body_ciphertext_ref: Sha256Ref,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityMutationV1 {
    protocol: String,
    mutation_id: OpaqueId,
    namespace_ref: Sha256Ref,
    scope_ref: Sha256Ref,
    state: ContinuityMutationStateV1,
    record_id: OpaqueId,
    predecessor_record_id: Option<OpaqueId>,
    source_event_ids: Vec<Hex64>,
    author_kind: OpaqueId,
    created_at: CanonicalTimestamp,
    body_ciphertext_ref: Sha256Ref,
}

impl From<RawContinuityMutationV1> for ContinuityMutationV1 {
    fn from(raw: RawContinuityMutationV1) -> Self {
        Self {
            protocol: raw.protocol,
            mutation_id: raw.mutation_id,
            namespace_ref: raw.namespace_ref,
            scope_ref: raw.scope_ref,
            state: raw.state,
            record_id: raw.record_id,
            predecessor_record_id: raw.predecessor_record_id,
            source_event_ids: raw.source_event_ids,
            author_kind: raw.author_kind,
            created_at: raw.created_at,
            body_ciphertext_ref: raw.body_ciphertext_ref,
        }
    }
}

impl ContinuityMutationV1 {
    /// Require bounded, sorted, unique exact event provenance.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_refs(&self.source_event_ids, true)?;
        if self
            .predecessor_record_id
            .as_ref()
            .is_some_and(|predecessor| predecessor == &self.record_id)
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(ContinuityMutationV1, RawContinuityMutationV1);

/// Per-resident control for the lightweight Luca continuity overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResidentContinuityModeV1 {
    /// Generate and inject compact encrypted handoffs.
    Enabled,
    /// Neither generate nor inject a handoff; native memory remains untouched.
    Disabled,
}

/// One compact resident-authored handoff, encrypted before durable storage.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct ResidentHandoffV1 {
    /// Short working-state summary.
    pub summary: String,
    /// Work that remains unresolved.
    pub unresolved_threads: Vec<String>,
    /// Explicit commitments made in the cited conversation.
    pub commitments: Vec<String>,
    /// Explicit, non-inferred working preferences.
    pub explicit_preferences: Vec<String>,
    /// Sorted unique exact signed source events.
    pub source_event_ids: Vec<Hex64>,
    /// Canonical time this revision was authored.
    pub updated_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawResidentHandoffV1 {
    summary: String,
    unresolved_threads: Vec<String>,
    commitments: Vec<String>,
    explicit_preferences: Vec<String>,
    source_event_ids: Vec<Hex64>,
    updated_at: CanonicalTimestamp,
}

impl From<RawResidentHandoffV1> for ResidentHandoffV1 {
    fn from(raw: RawResidentHandoffV1) -> Self {
        Self {
            summary: raw.summary,
            unresolved_threads: raw.unresolved_threads,
            commitments: raw.commitments,
            explicit_preferences: raw.explicit_preferences,
            source_event_ids: raw.source_event_ids,
            updated_at: raw.updated_at,
        }
    }
}

impl ResidentHandoffV1 {
    /// Enforce the deliberately small V1 handoff and exact signed provenance.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        bounded_handoff_text(&self.summary, true, MAX_HANDOFF_SUMMARY_BYTES)?;
        bounded_handoff_items(&self.unresolved_threads)?;
        bounded_handoff_items(&self.commitments)?;
        bounded_handoff_items(&self.explicit_preferences)?;
        bounded_refs(&self.source_event_ids, true)?;
        if self.summary.is_empty()
            && self.unresolved_threads.is_empty()
            && self.commitments.is_empty()
            && self.explicit_preferences.is_empty()
        {
            return Err(ContinuityError::BodySafety);
        }
        Ok(())
    }
}

impl std::fmt::Debug for ResidentHandoffV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ResidentHandoffV1")
            .field("summary", &"[REDACTED]")
            .field("unresolved_thread_count", &self.unresolved_threads.len())
            .field("commitment_count", &self.commitments.len())
            .field(
                "explicit_preference_count",
                &self.explicit_preferences.len(),
            )
            .field("source_event_ids", &self.source_event_ids)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

validated_deserialize!(ResidentHandoffV1, RawResidentHandoffV1);

/// Body-free, authority-minimized request for one private handoff cognition turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalContinuityCognitionRequestV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Exact durable continuity job.
    pub job_id: OpaqueId,
    /// Canonical owner identity.
    pub owner_pubkey: Hex64,
    /// Exact resident that must author the result.
    pub resident_pubkey: Hex64,
    /// Exact conversation containing the final.
    pub conversation_id: OpaqueId,
    /// Exact accepted and finalized resident response.
    pub source_event_id: Hex64,
    /// Exact runtime/model binding that may execute the turn.
    pub binding_ref: Sha256Ref,
    /// Absolute local deadline.
    pub deadline_unix_ms: SafeU53,
    /// Maximum canonical result size.
    pub max_result_bytes: SafeU53,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLocalContinuityCognitionRequestV1 {
    protocol: String,
    job_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    conversation_id: OpaqueId,
    source_event_id: Hex64,
    binding_ref: Sha256Ref,
    deadline_unix_ms: SafeU53,
    max_result_bytes: SafeU53,
}

impl From<RawLocalContinuityCognitionRequestV1> for LocalContinuityCognitionRequestV1 {
    fn from(raw: RawLocalContinuityCognitionRequestV1) -> Self {
        Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            conversation_id: raw.conversation_id,
            source_event_id: raw.source_event_id,
            binding_ref: raw.binding_ref,
            deadline_unix_ms: raw.deadline_unix_ms,
            max_result_bytes: raw.max_result_bytes,
        }
    }
}

impl LocalContinuityCognitionRequestV1 {
    /// Require separated authority and a bounded nonzero result budget.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.deadline_unix_ms.get() == 0
            || self.max_result_bytes.get() == 0
            || self.max_result_bytes.get() as usize > MAX_CONTINUITY_PACKET_BYTES
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(
    LocalContinuityCognitionRequestV1,
    RawLocalContinuityCognitionRequestV1
);

/// Private handoff cognition terminal outcome.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub enum LocalContinuityCognitionOutcomeV1 {
    /// The resident found no durable working state to carry forward.
    NoChange,
    /// The resident authored one bounded handoff candidate.
    Handoff { handoff: ResidentHandoffV1 },
}

impl std::fmt::Debug for LocalContinuityCognitionOutcomeV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoChange => formatter.write_str("NoChange"),
            Self::Handoff { handoff } => formatter.debug_tuple("Handoff").field(handoff).finish(),
        }
    }
}

/// Result from the same resident/runtime binding requested for private cognition.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct LocalContinuityCognitionResultV1 {
    /// Frozen continuity protocol discriminator.
    pub protocol: String,
    /// Exact job being answered.
    pub job_id: OpaqueId,
    /// Exact resident author.
    pub resident_pubkey: Hex64,
    /// Exact finalized source event.
    pub source_event_id: Hex64,
    /// Either explicit no-change or one bounded handoff.
    pub result: LocalContinuityCognitionOutcomeV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLocalContinuityCognitionResultV1 {
    protocol: String,
    job_id: OpaqueId,
    resident_pubkey: Hex64,
    source_event_id: Hex64,
    result: LocalContinuityCognitionOutcomeV1,
}

impl From<RawLocalContinuityCognitionResultV1> for LocalContinuityCognitionResultV1 {
    fn from(raw: RawLocalContinuityCognitionResultV1) -> Self {
        Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            resident_pubkey: raw.resident_pubkey,
            source_event_id: raw.source_event_id,
            result: raw.result,
        }
    }
}

impl LocalContinuityCognitionResultV1 {
    /// Validate the outcome, including source provenance for a handoff.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if let LocalContinuityCognitionOutcomeV1::Handoff { handoff } = &self.result {
            handoff.validate()?;
            if handoff
                .source_event_ids
                .binary_search(&self.source_event_id)
                .is_err()
            {
                return Err(ContinuityError::Binding);
            }
        }
        Ok(())
    }

    /// Bind this result to the exact local request before it can be committed.
    pub fn validate_against(
        &self,
        request: &LocalContinuityCognitionRequestV1,
    ) -> Result<(), ContinuityError> {
        self.validate()?;
        request.validate()?;
        if self.job_id != request.job_id
            || self.resident_pubkey != request.resident_pubkey
            || self.source_event_id != request.source_event_id
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

impl std::fmt::Debug for LocalContinuityCognitionResultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LocalContinuityCognitionResultV1")
            .field("protocol", &self.protocol)
            .field("job_id", &self.job_id)
            .field("resident_pubkey", &self.resident_pubkey)
            .field("source_event_id", &self.source_event_id)
            .field("result", &self.result)
            .finish()
    }
}

validated_deserialize!(
    LocalContinuityCognitionResultV1,
    RawLocalContinuityCognitionResultV1
);

/// Resident's role in a durable post-publication job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityResidentRoleV1 {
    /// Resident authored the canonical final response.
    Primary,
    /// Resident was an authorized observer in the canonical dispatch set.
    Observer,
}

impl ContinuityResidentRoleV1 {
    fn derivation_label(self) -> &'static [u8] {
        match self {
            Self::Primary => b"primary",
            Self::Observer => b"observer",
        }
    }
}

/// Derive the durable continuity-job idempotency key.
///
/// The SHA-256 preimage uses the fixed `luca.continuity.job.idempotency.v1`
/// domain followed by length-prefixed decoded owner, resident, source-event,
/// and resident-role fields. Decoding keys and the event identifier before
/// hashing avoids textual representation ambiguity; length prefixes make the
/// framing explicit and stable across languages.
pub fn derive_continuity_job_idempotency_key(
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
    source_event_id: &Hex64,
    resident_role: ContinuityResidentRoleV1,
) -> Result<Hex64, ProtocolValueError> {
    fn frame(hasher: &mut Sha256, bytes: &[u8]) -> Result<(), ProtocolValueError> {
        let length = u32::try_from(bytes.len()).map_err(|_| {
            ProtocolValueError::new_for_internal_use(
                "continuity job idempotency input",
                "length does not fit u32",
            )
        })?;
        hasher.update(length.to_be_bytes());
        hasher.update(bytes);
        Ok(())
    }

    let owner = owner_pubkey.decode()?;
    let resident = resident_pubkey.decode()?;
    let source_event = source_event_id.decode()?;
    let mut hasher = Sha256::new();
    hasher.update(b"luca.continuity.job.idempotency.v1\0");
    frame(&mut hasher, &owner)?;
    frame(&mut hasher, &resident)?;
    frame(&mut hasher, &source_event)?;
    frame(&mut hasher, resident_role.derivation_label())?;
    Hex64::parse(hex::encode(hasher.finalize()))
}

/// Durable continuity job lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContinuityJobStateV1 {
    /// Durable and awaiting execution.
    Pending,
    /// Currently executing.
    Running,
    /// Terminal successful execution.
    Completed,
    /// Terminal cancellation.
    Cancelled,
    /// Terminal body-free failure.
    Failed,
}

/// Idempotent durable job keyed to an exact signed source event and resident role.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ContinuityJobV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Durable job identifier.
    pub job_id: OpaqueId,
    /// Deterministic domain-separated idempotency key.
    pub idempotency_key: Hex64,
    /// Canonical owner key.
    pub owner_pubkey: Hex64,
    /// Exact resident key.
    pub resident_pubkey: Hex64,
    /// Exact durable signed source event.
    pub source_event_id: Hex64,
    /// Primary or observer role.
    pub resident_role: ContinuityResidentRoleV1,
    /// Stable machine-readable job kind.
    pub job_kind: OpaqueId,
    /// Durable lifecycle state.
    pub state: ContinuityJobStateV1,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawContinuityJobV1 {
    protocol: String,
    job_id: OpaqueId,
    idempotency_key: Hex64,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_event_id: Hex64,
    resident_role: ContinuityResidentRoleV1,
    job_kind: OpaqueId,
    state: ContinuityJobStateV1,
    created_at: CanonicalTimestamp,
}

impl From<RawContinuityJobV1> for ContinuityJobV1 {
    fn from(raw: RawContinuityJobV1) -> Self {
        Self {
            protocol: raw.protocol,
            job_id: raw.job_id,
            idempotency_key: raw.idempotency_key,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            source_event_id: raw.source_event_id,
            resident_role: raw.resident_role,
            job_kind: raw.job_kind,
            state: raw.state,
            created_at: raw.created_at,
        }
    }
}

impl ContinuityJobV1 {
    /// Require a valid discriminator and separated owner/resident identities.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey {
            return Err(ContinuityError::Binding);
        }
        let expected = derive_continuity_job_idempotency_key(
            &self.owner_pubkey,
            &self.resident_pubkey,
            &self.source_event_id,
            self.resident_role,
        )?;
        if self.idempotency_key != expected {
            return Err(ContinuityError::Binding);
        }
        Ok(())
    }
}

validated_deserialize!(ContinuityJobV1, RawContinuityJobV1);

/// Persisted owner-brain grant lifecycle state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrainGrantStateV1 {
    /// Current grant usable for its exact non-unknown egress binding.
    Active,
    /// Explicitly revoked grant.
    Revoked,
    /// Binding changed and requires reconfirmation.
    Stale,
}

/// Persisted resident/source/scope/provider-egress consent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrainGrantV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable grant identifier.
    pub grant_id: OpaqueId,
    /// Canonical owner key.
    pub owner_pubkey: Hex64,
    /// Exact resident key.
    pub resident_pubkey: Hex64,
    /// Exact authorized source/scope reference.
    pub source_scope_ref: Sha256Ref,
    /// Authorized provider egress class.
    pub provider_egress: ProviderEgressV1,
    /// Exact runtime/model binding reference.
    pub binding_ref: Sha256Ref,
    /// Monotonic grant version.
    pub grant_version: SafeU53,
    /// Persisted grant state.
    pub state: BrainGrantStateV1,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Revocation timestamp, present exactly for revoked grants.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<CanonicalTimestamp>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBrainGrantV1 {
    protocol: String,
    grant_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    source_scope_ref: Sha256Ref,
    provider_egress: ProviderEgressV1,
    binding_ref: Sha256Ref,
    grant_version: SafeU53,
    state: BrainGrantStateV1,
    created_at: CanonicalTimestamp,
    revoked_at: Option<CanonicalTimestamp>,
}

impl From<RawBrainGrantV1> for BrainGrantV1 {
    fn from(raw: RawBrainGrantV1) -> Self {
        Self {
            protocol: raw.protocol,
            grant_id: raw.grant_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            source_scope_ref: raw.source_scope_ref,
            provider_egress: raw.provider_egress,
            binding_ref: raw.binding_ref,
            grant_version: raw.grant_version,
            state: raw.state,
            created_at: raw.created_at,
            revoked_at: raw.revoked_at,
        }
    }
}

impl BrainGrantV1 {
    /// Fail closed on unknown egress and enforce symmetric revocation metadata.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey
            || self.grant_version.get() == 0
            || (self.state == BrainGrantStateV1::Revoked) != self.revoked_at.is_some()
            || (self.state == BrainGrantStateV1::Active
                && self.provider_egress == ProviderEgressV1::Unknown)
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(BrainGrantV1, RawBrainGrantV1);

/// Safe discovery availability state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportSourceStateV1 {
    /// Source exists and is readable without secrets.
    Available,
    /// Source is not present.
    Absent,
    /// Source is partly readable; a safe code explains the limitation.
    Degraded,
    /// Discovery failed; a safe code explains the failure class.
    Failed,
}

/// One body-free source-discovery status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportSourceStatusV1 {
    /// Stable credential-excluding source kind.
    pub source_kind: OpaqueId,
    /// Discovery state.
    pub state: ImportSourceStateV1,
    /// Safe discovered item count.
    pub item_count: SafeU53,
    /// Bounded machine code, present exactly for degraded/failed states.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<OpaqueId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImportSourceStatusV1 {
    source_kind: OpaqueId,
    state: ImportSourceStateV1,
    item_count: SafeU53,
    code: Option<OpaqueId>,
}

impl From<RawImportSourceStatusV1> for ImportSourceStatusV1 {
    fn from(raw: RawImportSourceStatusV1) -> Self {
        Self {
            source_kind: raw.source_kind,
            state: raw.state,
            item_count: raw.item_count,
            code: raw.code,
        }
    }
}

impl ImportSourceStatusV1 {
    /// Enforce body-free state/code/count symmetry.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        match self.state {
            ImportSourceStateV1::Available if self.code.is_none() => Ok(()),
            ImportSourceStateV1::Absent if self.code.is_none() && self.item_count.get() == 0 => {
                Ok(())
            }
            ImportSourceStateV1::Degraded if self.code.is_some() => Ok(()),
            ImportSourceStateV1::Failed if self.code.is_some() && self.item_count.get() == 0 => {
                Ok(())
            }
            _ => Err(ContinuityError::Status),
        }
    }
}

validated_deserialize!(ImportSourceStatusV1, RawImportSourceStatusV1);

/// Credential-excluding source discovery report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportDiscoveryReportV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Discovery report identifier.
    pub report_id: OpaqueId,
    /// Canonical generation timestamp.
    pub generated_at: CanonicalTimestamp,
    /// Bounded source status list.
    pub sources: Vec<ImportSourceStatusV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImportDiscoveryReportV1 {
    protocol: String,
    report_id: OpaqueId,
    generated_at: CanonicalTimestamp,
    sources: Vec<ImportSourceStatusV1>,
}

impl From<RawImportDiscoveryReportV1> for ImportDiscoveryReportV1 {
    fn from(raw: RawImportDiscoveryReportV1) -> Self {
        Self {
            protocol: raw.protocol,
            report_id: raw.report_id,
            generated_at: raw.generated_at,
            sources: raw.sources,
        }
    }
}

impl ImportDiscoveryReportV1 {
    /// Validate the discriminator and bounded non-duplicated source list.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.sources.len() > 128
            || self.sources.iter().enumerate().any(|(index, item)| {
                self.sources[..index]
                    .iter()
                    .any(|prior| prior.source_kind == item.source_kind)
            })
        {
            Err(ContinuityError::Sequence)
        } else {
            for source in &self.sources {
                source.validate()?;
            }
            Ok(())
        }
    }
}

validated_deserialize!(ImportDiscoveryReportV1, RawImportDiscoveryReportV1);

/// Zero-write normalized import preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportPlanV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable preview plan identifier.
    pub plan_id: OpaqueId,
    /// Canonical preview timestamp.
    pub created_at: CanonicalTimestamp,
    /// Sorted unique exact input hashes.
    pub source_hashes: Vec<Hex64>,
    /// Sorted unique body-free normalized mapping references.
    pub mapping_refs: Vec<Sha256Ref>,
    /// Unsupported row/file count.
    pub unsupported_count: SafeU53,
    /// Persisted consent reference.
    pub consent_ref: Sha256Ref,
    /// Frozen false marker proving preview performs zero writes.
    pub write_intent: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImportPlanV1 {
    protocol: String,
    plan_id: OpaqueId,
    created_at: CanonicalTimestamp,
    source_hashes: Vec<Hex64>,
    mapping_refs: Vec<Sha256Ref>,
    unsupported_count: SafeU53,
    consent_ref: Sha256Ref,
    write_intent: bool,
}

impl From<RawImportPlanV1> for ImportPlanV1 {
    fn from(raw: RawImportPlanV1) -> Self {
        Self {
            protocol: raw.protocol,
            plan_id: raw.plan_id,
            created_at: raw.created_at,
            source_hashes: raw.source_hashes,
            mapping_refs: raw.mapping_refs,
            unsupported_count: raw.unsupported_count,
            consent_ref: raw.consent_ref,
            write_intent: raw.write_intent,
        }
    }
}

impl ImportPlanV1 {
    /// Enforce zero-write preview and bounded deterministic references.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.write_intent {
            return Err(ContinuityError::Binding);
        }
        bounded_refs(&self.source_hashes, true)?;
        bounded_refs(&self.mapping_refs, false)
    }
}

validated_deserialize!(ImportPlanV1, RawImportPlanV1);

/// Atomic import commit terminal state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportCommitStateV1 {
    /// Atomic commit completed.
    Committed,
    /// Commit was cancelled before exposing staged rows.
    Cancelled,
    /// Commit failed without exposing staged rows.
    Failed,
}

/// Body-free atomic import result receipt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportCommitReceiptV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable commit attempt identifier.
    pub commit_id: OpaqueId,
    /// Exact preview plan identifier.
    pub plan_id: OpaqueId,
    /// Atomic terminal state.
    pub state: ImportCommitStateV1,
    /// Sorted unique exact source hashes.
    pub source_hashes: Vec<Hex64>,
    /// Exposed imported row count; zero after cancellation/failure.
    pub imported_count: SafeU53,
    /// Unsupported row/file count.
    pub unsupported_count: SafeU53,
    /// Canonical completion timestamp.
    pub completed_at: CanonicalTimestamp,
    /// Bounded body-free diagnostics.
    pub diagnostics: Vec<SafeDiagnosticV1>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawImportCommitReceiptV1 {
    protocol: String,
    commit_id: OpaqueId,
    plan_id: OpaqueId,
    state: ImportCommitStateV1,
    source_hashes: Vec<Hex64>,
    imported_count: SafeU53,
    unsupported_count: SafeU53,
    completed_at: CanonicalTimestamp,
    diagnostics: Vec<SafeDiagnosticV1>,
}

impl From<RawImportCommitReceiptV1> for ImportCommitReceiptV1 {
    fn from(raw: RawImportCommitReceiptV1) -> Self {
        Self {
            protocol: raw.protocol,
            commit_id: raw.commit_id,
            plan_id: raw.plan_id,
            state: raw.state,
            source_hashes: raw.source_hashes,
            imported_count: raw.imported_count,
            unsupported_count: raw.unsupported_count,
            completed_at: raw.completed_at,
            diagnostics: raw.diagnostics,
        }
    }
}

impl ImportCommitReceiptV1 {
    /// Enforce atomic failure/cancellation counts and bounded receipt fields.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_refs(&self.source_hashes, true)?;
        if self.diagnostics.len() > 16
            || (self.state != ImportCommitStateV1::Committed && self.imported_count.get() != 0)
        {
            Err(ContinuityError::Status)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(ImportCommitReceiptV1, RawImportCommitReceiptV1);

/// Opt-in, bounded scheduled cognition policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CognitionScheduleV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Exact resident key.
    pub resident_pubkey: Hex64,
    /// Explicit opt-in switch; false by default in product policy.
    pub enabled: bool,
    /// Required idle minutes before eligibility.
    pub min_idle_minutes: SafeU53,
    /// Minimum minutes between eligible cycles.
    pub cadence_minutes: SafeU53,
    /// Hard daily model-assisted cycle ceiling.
    pub max_cycles_per_day: SafeU53,
    /// Hard rolling 24-hour proactive-message ceiling.
    pub max_proactive_per_24h: SafeU53,
    /// Local quiet-hour start, 0 through 23.
    pub quiet_start_hour: SafeU53,
    /// Local quiet-hour end, 0 through 23.
    pub quiet_end_hour: SafeU53,
    /// Whether one bounded relaunch catch-up is eligible.
    pub catch_up: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCognitionScheduleV1 {
    protocol: String,
    resident_pubkey: Hex64,
    enabled: bool,
    min_idle_minutes: SafeU53,
    cadence_minutes: SafeU53,
    max_cycles_per_day: SafeU53,
    max_proactive_per_24h: SafeU53,
    quiet_start_hour: SafeU53,
    quiet_end_hour: SafeU53,
    catch_up: bool,
}

impl From<RawCognitionScheduleV1> for CognitionScheduleV1 {
    fn from(raw: RawCognitionScheduleV1) -> Self {
        Self {
            protocol: raw.protocol,
            resident_pubkey: raw.resident_pubkey,
            enabled: raw.enabled,
            min_idle_minutes: raw.min_idle_minutes,
            cadence_minutes: raw.cadence_minutes,
            max_cycles_per_day: raw.max_cycles_per_day,
            max_proactive_per_24h: raw.max_proactive_per_24h,
            quiet_start_hour: raw.quiet_start_hour,
            quiet_end_hour: raw.quiet_end_hour,
            catch_up: raw.catch_up,
        }
    }
}

impl CognitionScheduleV1 {
    /// Enforce hard ceilings and nonzero enabled cadence/idle bounds.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.quiet_start_hour.get() > 23
            || self.quiet_end_hour.get() > 23
            || self.max_cycles_per_day.get() > 3
            || self.max_proactive_per_24h.get() > 1
            || (self.enabled
                && (self.min_idle_minutes.get() == 0 || self.cadence_minutes.get() == 0))
        {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(CognitionScheduleV1, RawCognitionScheduleV1);

/// Pre-publication proactive-message candidate state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProactiveCandidateStateV1 {
    /// Awaiting policy gates.
    Pending,
    /// Rejected by one or more gates.
    Rejected,
    /// Published through the normal signed resident DM outbox.
    Published,
    /// Expired without publication.
    Expired,
}

/// Resident-authored candidate with body-free pre-publication evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProactiveMessageCandidateV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable candidate identifier.
    pub candidate_id: OpaqueId,
    /// Exact resident author key.
    pub resident_pubkey: Hex64,
    /// Candidate lifecycle state.
    pub state: ProactiveCandidateStateV1,
    /// Sorted unique body-free source references.
    pub source_refs: Vec<Sha256Ref>,
    /// One-way topic novelty fingerprint.
    pub novelty_ref: Sha256Ref,
    /// Privacy gate evidence.
    pub privacy_passed: bool,
    /// Rate-limit and repetition gate evidence.
    pub rate_passed: bool,
    /// Quiet-hours gate evidence.
    pub quiet_hours_passed: bool,
    /// Normal signed-publication receipt, present exactly when published.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication_receipt_id: Option<OpaqueId>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawProactiveMessageCandidateV1 {
    protocol: String,
    candidate_id: OpaqueId,
    resident_pubkey: Hex64,
    state: ProactiveCandidateStateV1,
    source_refs: Vec<Sha256Ref>,
    novelty_ref: Sha256Ref,
    privacy_passed: bool,
    rate_passed: bool,
    quiet_hours_passed: bool,
    publication_receipt_id: Option<OpaqueId>,
}

impl From<RawProactiveMessageCandidateV1> for ProactiveMessageCandidateV1 {
    fn from(raw: RawProactiveMessageCandidateV1) -> Self {
        Self {
            protocol: raw.protocol,
            candidate_id: raw.candidate_id,
            resident_pubkey: raw.resident_pubkey,
            state: raw.state,
            source_refs: raw.source_refs,
            novelty_ref: raw.novelty_ref,
            privacy_passed: raw.privacy_passed,
            rate_passed: raw.rate_passed,
            quiet_hours_passed: raw.quiet_hours_passed,
            publication_receipt_id: raw.publication_receipt_id,
        }
    }
}

impl ProactiveMessageCandidateV1 {
    /// Require all gates and exactly one receipt only for published candidates.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        bounded_refs(&self.source_refs, true)?;
        let published = self.state == ProactiveCandidateStateV1::Published;
        if published != self.publication_receipt_id.is_some()
            || (published && !(self.privacy_passed && self.rate_passed && self.quiet_hours_passed))
        {
            Err(ContinuityError::Status)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(ProactiveMessageCandidateV1, RawProactiveMessageCandidateV1);

/// Compact versioned NIP-AE identity/current-state projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortableContinuityCapsuleV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable capsule identifier.
    pub capsule_id: OpaqueId,
    /// Canonical owner key.
    pub owner_pubkey: Hex64,
    /// Exact resident key.
    pub resident_pubkey: Hex64,
    /// Exact runtime/model binding reference.
    pub binding_ref: Sha256Ref,
    /// Compact encrypted current-state projection reference.
    pub current_state_ref: Sha256Ref,
    /// Projection revision.
    pub revision: SafeU53,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Integrity hash of the protected projection.
    pub integrity_sha256: Hex64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPortableContinuityCapsuleV1 {
    protocol: String,
    capsule_id: OpaqueId,
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    current_state_ref: Sha256Ref,
    revision: SafeU53,
    created_at: CanonicalTimestamp,
    integrity_sha256: Hex64,
}

impl From<RawPortableContinuityCapsuleV1> for PortableContinuityCapsuleV1 {
    fn from(raw: RawPortableContinuityCapsuleV1) -> Self {
        Self {
            protocol: raw.protocol,
            capsule_id: raw.capsule_id,
            owner_pubkey: raw.owner_pubkey,
            resident_pubkey: raw.resident_pubkey,
            binding_ref: raw.binding_ref,
            current_state_ref: raw.current_state_ref,
            revision: raw.revision,
            created_at: raw.created_at,
            integrity_sha256: raw.integrity_sha256,
        }
    }
}

impl PortableContinuityCapsuleV1 {
    /// Validate the discriminator and owner/resident separation.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.owner_pubkey == self.resident_pubkey {
            Err(ContinuityError::Binding)
        } else {
            Ok(())
        }
    }
}

validated_deserialize!(PortableContinuityCapsuleV1, RawPortableContinuityCapsuleV1);

/// Protected Luca backup contents, mappings, versions, and integrity hashes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LucaBackupManifestV1 {
    /// Frozen protocol discriminator.
    pub protocol: String,
    /// Stable protected backup identifier.
    pub backup_id: OpaqueId,
    /// Canonical creation timestamp.
    pub created_at: CanonicalTimestamp,
    /// Canonical owner key.
    pub owner_pubkey: Hex64,
    /// Backup format version.
    pub format_version: SafeU53,
    /// Sorted unique encrypted-content references.
    pub encrypted_content_refs: Vec<Sha256Ref>,
    /// Sorted unique source/identity mapping references.
    pub mapping_refs: Vec<Sha256Ref>,
    /// Integrity hash of the protected archive manifest.
    pub integrity_sha256: Hex64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLucaBackupManifestV1 {
    protocol: String,
    backup_id: OpaqueId,
    created_at: CanonicalTimestamp,
    owner_pubkey: Hex64,
    format_version: SafeU53,
    encrypted_content_refs: Vec<Sha256Ref>,
    mapping_refs: Vec<Sha256Ref>,
    integrity_sha256: Hex64,
}

impl From<RawLucaBackupManifestV1> for LucaBackupManifestV1 {
    fn from(raw: RawLucaBackupManifestV1) -> Self {
        Self {
            protocol: raw.protocol,
            backup_id: raw.backup_id,
            created_at: raw.created_at,
            owner_pubkey: raw.owner_pubkey,
            format_version: raw.format_version,
            encrypted_content_refs: raw.encrypted_content_refs,
            mapping_refs: raw.mapping_refs,
            integrity_sha256: raw.integrity_sha256,
        }
    }
}

impl LucaBackupManifestV1 {
    /// Validate a versioned, non-empty, deterministic protected manifest.
    pub fn validate(&self) -> Result<(), ContinuityError> {
        require_protocol(&self.protocol)?;
        if self.format_version.get() == 0 {
            return Err(ContinuityError::Binding);
        }
        bounded_refs(&self.encrypted_content_refs, true)?;
        bounded_refs(&self.mapping_refs, false)
    }
}

validated_deserialize!(LucaBackupManifestV1, RawLucaBackupManifestV1);

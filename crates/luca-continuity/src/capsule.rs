//! Pure, bounded projection of resident continuity into one portable NIP-AE value.
//!
//! The encrypted portable Capsule is only a compact current projection. The
//! encrypted local notebook, its revision history, and owner-brain namespaces
//! remain authoritative. This module performs no encryption, signing, key
//! custody, network access, persistence, or NIP event construction.

use crate::ContinuityError;
use luca_protocol::{
    canonicalize, CanonicalTimestamp, Hex64, OpaqueId, PortableContinuityCapsuleV1, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL, MAX_CONTINUITY_REFS,
};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, Zeroizing};

/// Fixed NIP-AE address slug for the portable current projection.
pub const PORTABLE_CAPSULE_NIP_AE_SLUG: &str = "mem/luca-continuity/capsule-v1";
/// Strict envelope discriminator carried inside `Body::Memory.value`.
pub const PORTABLE_CAPSULE_ENVELOPE_SCHEMA_V1: &str = "luca.portable-capsule-envelope.v1";
/// Maximum UTF-8 bytes in any one present current-state segment.
pub const MAX_PORTABLE_CAPSULE_SEGMENT_BYTES: usize = 8 * 1024;
/// Maximum RFC 8785 bytes in the exact current-state object.
pub const MAX_PORTABLE_CAPSULE_STATE_BYTES: usize = 20 * 1024;
/// Maximum RFC 8785 bytes in the complete value envelope.
pub const MAX_PORTABLE_CAPSULE_ENVELOPE_BYTES: usize = 24 * 1024;
/// Maximum RFC 8785 bytes after the value is projected into a NIP-AE memory body.
pub const MAX_PORTABLE_CAPSULE_BODY_JSON_BYTES: usize = 48 * 1024;

const CAPSULE_ID_DOMAIN_V1: &str = "luca.portable-capsule.id.v1";
const CAPSULE_INTEGRITY_DOMAIN_V1: &str = "luca.portable-capsule.integrity.v1";

/// One present private segment backed by a zeroizing allocation.
#[derive(Clone, PartialEq, Eq)]
struct CapsuleSegment(Zeroizing<String>);

impl CapsuleSegment {
    fn new(value: String) -> Result<Self, ContinuityError> {
        let value = Zeroizing::new(value);
        if value.is_empty() || value.len() > MAX_PORTABLE_CAPSULE_SEGMENT_BYTES {
            return Err(ContinuityError::InvalidCapsule);
        }
        Ok(Self(value))
    }

    fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl Serialize for CapsuleSegment {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for CapsuleSegment {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Zeroizing::new(String::deserialize(deserializer)?);
        if value.is_empty() || value.len() > MAX_PORTABLE_CAPSULE_SEGMENT_BYTES {
            return Err(serde::de::Error::custom("invalid capsule segment"));
        }
        Ok(Self(value))
    }
}

impl fmt::Debug for CapsuleSegment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CapsuleSegment([REDACTED])")
    }
}

/// The six fixed, ordered portable current-state segments plus source bindings.
///
/// Segment bodies are data, never system instructions or application
/// authority. Every owned segment is erased when this value is dropped.
#[derive(Clone, PartialEq, Eq)]
pub struct PortableCapsuleCurrentStateV1 {
    core: Option<CapsuleSegment>,
    self_model: Option<CapsuleSegment>,
    owner_relationship: Option<CapsuleSegment>,
    convictions: Option<CapsuleSegment>,
    current_digest: Option<CapsuleSegment>,
    unfinished_threads: Option<CapsuleSegment>,
    source_refs: Vec<Sha256Ref>,
}

struct RawPortableCapsuleCurrentStateV1 {
    core: Option<CapsuleSegment>,
    self_model: Option<CapsuleSegment>,
    owner_relationship: Option<CapsuleSegment>,
    convictions: Option<CapsuleSegment>,
    current_digest: Option<CapsuleSegment>,
    unfinished_threads: Option<CapsuleSegment>,
    source_refs: Vec<Sha256Ref>,
}

#[derive(Deserialize)]
#[serde(field_identifier, rename_all = "snake_case")]
enum CurrentStateField {
    Core,
    SelfModel,
    OwnerRelationship,
    Convictions,
    CurrentDigest,
    UnfinishedThreads,
    SourceRefs,
}

impl<'de> Deserialize<'de> for RawPortableCapsuleCurrentStateV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct CurrentStateVisitor;

        impl<'de> serde::de::Visitor<'de> for CurrentStateVisitor {
            type Value = RawPortableCapsuleCurrentStateV1;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("the fixed portable capsule current-state object")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                let mut core = None;
                let mut self_model = None;
                let mut owner_relationship = None;
                let mut convictions = None;
                let mut current_digest = None;
                let mut unfinished_threads = None;
                let mut source_refs = None;

                while let Some(field) = map.next_key::<CurrentStateField>()? {
                    match field {
                        CurrentStateField::Core => {
                            if core.is_some() {
                                return Err(serde::de::Error::duplicate_field("core"));
                            }
                            core = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::SelfModel => {
                            if self_model.is_some() {
                                return Err(serde::de::Error::duplicate_field("self_model"));
                            }
                            self_model = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::OwnerRelationship => {
                            if owner_relationship.is_some() {
                                return Err(serde::de::Error::duplicate_field(
                                    "owner_relationship",
                                ));
                            }
                            owner_relationship = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::Convictions => {
                            if convictions.is_some() {
                                return Err(serde::de::Error::duplicate_field("convictions"));
                            }
                            convictions = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::CurrentDigest => {
                            if current_digest.is_some() {
                                return Err(serde::de::Error::duplicate_field("current_digest"));
                            }
                            current_digest = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::UnfinishedThreads => {
                            if unfinished_threads.is_some() {
                                return Err(serde::de::Error::duplicate_field(
                                    "unfinished_threads",
                                ));
                            }
                            unfinished_threads = Some(map.next_value::<Option<CapsuleSegment>>()?);
                        }
                        CurrentStateField::SourceRefs => {
                            if source_refs.is_some() {
                                return Err(serde::de::Error::duplicate_field("source_refs"));
                            }
                            source_refs = Some(map.next_value::<Vec<Sha256Ref>>()?);
                        }
                    }
                }

                Ok(RawPortableCapsuleCurrentStateV1 {
                    core: core.ok_or_else(|| serde::de::Error::missing_field("core"))?,
                    self_model: self_model
                        .ok_or_else(|| serde::de::Error::missing_field("self_model"))?,
                    owner_relationship: owner_relationship
                        .ok_or_else(|| serde::de::Error::missing_field("owner_relationship"))?,
                    convictions: convictions
                        .ok_or_else(|| serde::de::Error::missing_field("convictions"))?,
                    current_digest: current_digest
                        .ok_or_else(|| serde::de::Error::missing_field("current_digest"))?,
                    unfinished_threads: unfinished_threads
                        .ok_or_else(|| serde::de::Error::missing_field("unfinished_threads"))?,
                    source_refs: source_refs
                        .ok_or_else(|| serde::de::Error::missing_field("source_refs"))?,
                })
            }
        }

        deserializer.deserialize_struct(
            "PortableCapsuleCurrentStateV1",
            &[
                "core",
                "self_model",
                "owner_relationship",
                "convictions",
                "current_digest",
                "unfinished_threads",
                "source_refs",
            ],
            CurrentStateVisitor,
        )
    }
}

impl PortableCapsuleCurrentStateV1 {
    /// Construct the exact current-state shape. At least one segment must be
    /// present; absent segments remain explicit JSON `null` values.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        core: Option<String>,
        self_model: Option<String>,
        owner_relationship: Option<String>,
        convictions: Option<String>,
        current_digest: Option<String>,
        unfinished_threads: Option<String>,
        source_refs: Vec<Sha256Ref>,
    ) -> Result<Self, ContinuityError> {
        let state = Self {
            core: core.map(CapsuleSegment::new).transpose()?,
            self_model: self_model.map(CapsuleSegment::new).transpose()?,
            owner_relationship: owner_relationship.map(CapsuleSegment::new).transpose()?,
            convictions: convictions.map(CapsuleSegment::new).transpose()?,
            current_digest: current_digest.map(CapsuleSegment::new).transpose()?,
            unfinished_threads: unfinished_threads.map(CapsuleSegment::new).transpose()?,
            source_refs,
        };
        state.validate()?;
        Ok(state)
    }

    /// Borrow the six semantic segments in their fixed rendering order.
    pub fn segments_in_order(&self) -> [(&'static str, Option<&str>); 6] {
        [
            ("core", self.core.as_ref().map(CapsuleSegment::as_str)),
            (
                "self_model",
                self.self_model.as_ref().map(CapsuleSegment::as_str),
            ),
            (
                "owner_relationship",
                self.owner_relationship.as_ref().map(CapsuleSegment::as_str),
            ),
            (
                "convictions",
                self.convictions.as_ref().map(CapsuleSegment::as_str),
            ),
            (
                "current_digest",
                self.current_digest.as_ref().map(CapsuleSegment::as_str),
            ),
            (
                "unfinished_threads",
                self.unfinished_threads.as_ref().map(CapsuleSegment::as_str),
            ),
        ]
    }

    /// Borrow the sorted, unique, body-free source references.
    pub fn source_refs(&self) -> &[Sha256Ref] {
        &self.source_refs
    }

    fn validate(&self) -> Result<(), ContinuityError> {
        let present = self
            .segments_in_order()
            .into_iter()
            .filter(|(_, value)| value.is_some())
            .count();
        let refs_valid = self.source_refs.len() <= MAX_CONTINUITY_REFS
            && self.source_refs.windows(2).all(|pair| pair[0] < pair[1]);
        if present == 0 || !refs_valid {
            return Err(ContinuityError::InvalidCapsule);
        }
        let canonical =
            Zeroizing::new(canonicalize(self).map_err(|_| ContinuityError::InvalidCapsule)?);
        if canonical.len() > MAX_PORTABLE_CAPSULE_STATE_BYTES {
            return Err(ContinuityError::InvalidCapsule);
        }
        Ok(())
    }
}

impl Serialize for PortableCapsuleCurrentStateV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("PortableCapsuleCurrentStateV1", 7)?;
        state.serialize_field("core", &self.core)?;
        state.serialize_field("self_model", &self.self_model)?;
        state.serialize_field("owner_relationship", &self.owner_relationship)?;
        state.serialize_field("convictions", &self.convictions)?;
        state.serialize_field("current_digest", &self.current_digest)?;
        state.serialize_field("unfinished_threads", &self.unfinished_threads)?;
        state.serialize_field("source_refs", &self.source_refs)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for PortableCapsuleCurrentStateV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawPortableCapsuleCurrentStateV1::deserialize(deserializer)?;
        let state = Self {
            core: raw.core,
            self_model: raw.self_model,
            owner_relationship: raw.owner_relationship,
            convictions: raw.convictions,
            current_digest: raw.current_digest,
            unfinished_threads: raw.unfinished_threads,
            source_refs: raw.source_refs,
        };
        state.validate().map_err(serde::de::Error::custom)?;
        Ok(state)
    }
}

impl fmt::Debug for PortableCapsuleCurrentStateV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let segment_bytes: Vec<(&'static str, usize)> = self
            .segments_in_order()
            .into_iter()
            .filter_map(|(name, value)| value.map(|body| (name, body.len())))
            .collect();
        formatter
            .debug_struct("PortableCapsuleCurrentStateV1")
            .field("segments", &segment_bytes)
            .field("source_refs", &self.source_refs)
            .finish()
    }
}

impl Zeroize for PortableCapsuleCurrentStateV1 {
    fn zeroize(&mut self) {
        for segment in [
            &mut self.core,
            &mut self.self_model,
            &mut self.owner_relationship,
            &mut self.convictions,
            &mut self.current_digest,
            &mut self.unfinished_threads,
        ] {
            if let Some(segment) = segment.as_mut() {
                segment.0.zeroize();
            }
        }
    }
}

/// Strict canonical envelope placed in the NIP-AE memory `value` field.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct PortableCapsuleEnvelopeV1 {
    schema: String,
    capsule: PortableContinuityCapsuleV1,
    current_state: PortableCapsuleCurrentStateV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPortableCapsuleEnvelopeV1 {
    schema: String,
    capsule: PortableContinuityCapsuleV1,
    current_state: PortableCapsuleCurrentStateV1,
}

impl PortableCapsuleEnvelopeV1 {
    /// Borrow the validated protocol manifest.
    pub fn capsule(&self) -> &PortableContinuityCapsuleV1 {
        &self.capsule
    }

    /// Borrow the zeroizing current-state projection.
    pub fn current_state(&self) -> &PortableCapsuleCurrentStateV1 {
        &self.current_state
    }

    /// Serialize exactly what may be assigned to `Body::Memory.value`.
    pub fn to_body_value(&self) -> Result<PortableCapsuleBodyValue, ContinuityError> {
        self.validate()?;
        let mut canonical =
            Zeroizing::new(canonicalize(self).map_err(|_| ContinuityError::InvalidCapsule)?);
        let value = match String::from_utf8(std::mem::take(&mut *canonical)) {
            Ok(value) => value,
            Err(error) => {
                let _invalid = Zeroizing::new(error.into_bytes());
                return Err(ContinuityError::InvalidCapsule);
            }
        };
        let value = PortableCapsuleBodyValue(Zeroizing::new(value));
        validate_body_projection(value.as_str())?;
        Ok(value)
    }

    fn validate(&self) -> Result<(), ContinuityError> {
        if self.schema != PORTABLE_CAPSULE_ENVELOPE_SCHEMA_V1
            || self.capsule.protocol != CONTINUITY_PROTOCOL
            || self.capsule.revision.get() == 0
            || self.capsule.validate().is_err()
        {
            return Err(ContinuityError::InvalidCapsule);
        }
        self.current_state.validate()?;
        if self.capsule.capsule_id
            != derive_portable_capsule_id(
                &self.capsule.owner_pubkey,
                &self.capsule.resident_pubkey,
            )?
            || self.capsule.current_state_ref != current_state_ref(&self.current_state)?
            || self.capsule.integrity_sha256
                != projection_integrity(&self.capsule, &self.current_state)?
        {
            return Err(ContinuityError::InvalidCapsule);
        }
        let canonical =
            Zeroizing::new(canonicalize(self).map_err(|_| ContinuityError::InvalidCapsule)?);
        if canonical.len() > MAX_PORTABLE_CAPSULE_ENVELOPE_BYTES {
            return Err(ContinuityError::InvalidCapsule);
        }
        let value = std::str::from_utf8(&canonical).map_err(|_| ContinuityError::InvalidCapsule)?;
        validate_body_projection(value)
    }
}

impl fmt::Debug for PortableCapsuleEnvelopeV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PortableCapsuleEnvelopeV1")
            .field("schema", &self.schema)
            .field("capsule", &self.capsule)
            .field("current_state", &self.current_state)
            .finish()
    }
}

impl Drop for PortableCapsuleEnvelopeV1 {
    fn drop(&mut self) {
        self.current_state.zeroize();
    }
}

/// Zeroizing canonical envelope text suitable for `Body::Memory.value`.
pub struct PortableCapsuleBodyValue(Zeroizing<String>);

impl PortableCapsuleBodyValue {
    /// Borrow the canonical UTF-8 value for immediate NIP-AE construction.
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl fmt::Debug for PortableCapsuleBodyValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PortableCapsuleBodyValue([REDACTED])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapsuleSuccessorDisposition {
    /// The same revision and integrity are an exact safe retry.
    Idempotent,
    /// The candidate is exactly the next valid projection revision.
    Successor,
    /// The candidate is bound to an older runtime/model binding.
    Stale,
    /// Schema, integrity, identity, or revision rules failed.
    Invalid,
}

/// Deterministically bind one portable Capsule ID to its owner and resident.
pub fn derive_portable_capsule_id(
    owner_pubkey: &Hex64,
    resident_pubkey: &Hex64,
) -> Result<OpaqueId, ContinuityError> {
    #[derive(Serialize)]
    struct CapsuleIdMaterial<'a> {
        domain: &'static str,
        owner_pubkey: &'a Hex64,
        resident_pubkey: &'a Hex64,
    }

    if owner_pubkey == resident_pubkey {
        return Err(ContinuityError::InvalidCapsule);
    }
    let canonical = canonicalize(&CapsuleIdMaterial {
        domain: CAPSULE_ID_DOMAIN_V1,
        owner_pubkey,
        resident_pubkey,
    })
    .map_err(|_| ContinuityError::InvalidCapsule)?;
    OpaqueId::parse(format!(
        "capsule:{}",
        hex::encode(Sha256::digest(canonical))
    ))
    .map_err(|_| ContinuityError::InvalidCapsule)
}

/// Build a new valid portable projection without performing any I/O or crypto.
pub fn project_portable_capsule(
    owner_pubkey: Hex64,
    resident_pubkey: Hex64,
    binding_ref: Sha256Ref,
    revision: SafeU53,
    created_at: CanonicalTimestamp,
    current_state: PortableCapsuleCurrentStateV1,
) -> Result<PortableCapsuleEnvelopeV1, ContinuityError> {
    if revision.get() == 0 || owner_pubkey == resident_pubkey {
        return Err(ContinuityError::InvalidCapsule);
    }
    current_state.validate()?;
    let capsule_id = derive_portable_capsule_id(&owner_pubkey, &resident_pubkey)?;
    let state_ref = current_state_ref(&current_state)?;
    let mut capsule = PortableContinuityCapsuleV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        capsule_id,
        owner_pubkey,
        resident_pubkey,
        binding_ref,
        current_state_ref: state_ref,
        revision,
        created_at,
        integrity_sha256: zero_hex64()?,
    };
    capsule.integrity_sha256 = projection_integrity(&capsule, &current_state)?;
    let envelope = PortableCapsuleEnvelopeV1 {
        schema: PORTABLE_CAPSULE_ENVELOPE_SCHEMA_V1.to_owned(),
        capsule,
        current_state,
    };
    envelope.validate()?;
    Ok(envelope)
}

/// Strictly parse and validate one canonical-or-noncanonical UTF-8 envelope.
/// Duplicate and unknown members fail closed; returned segment bodies remain
/// zeroizing for their entire owned lifetime.
pub fn parse_portable_capsule_envelope(
    value: &str,
) -> Result<PortableCapsuleEnvelopeV1, ContinuityError> {
    if value.len() > MAX_PORTABLE_CAPSULE_ENVELOPE_BYTES {
        return Err(ContinuityError::InvalidCapsule);
    }
    let raw = {
        let mut deserializer = serde_json::Deserializer::from_str(value);
        let raw = RawPortableCapsuleEnvelopeV1::deserialize(&mut deserializer)
            .map_err(|_| ContinuityError::InvalidCapsule)?;
        deserializer
            .end()
            .map_err(|_| ContinuityError::InvalidCapsule)?;
        raw
    };
    let envelope = PortableCapsuleEnvelopeV1 {
        schema: raw.schema,
        capsule: raw.capsule,
        current_state: raw.current_state,
    };
    envelope.validate()?;
    Ok(envelope)
}

/// Classify an exact retry or successor without mutating any authority state.
pub fn classify_capsule_successor(
    prior: &PortableCapsuleEnvelopeV1,
    candidate: &PortableCapsuleEnvelopeV1,
    expected_current_binding: &Sha256Ref,
) -> CapsuleSuccessorDisposition {
    if prior.validate().is_err() || candidate.validate().is_err() {
        return CapsuleSuccessorDisposition::Invalid;
    }
    if candidate.capsule.capsule_id != prior.capsule.capsule_id
        || candidate.capsule.owner_pubkey != prior.capsule.owner_pubkey
        || candidate.capsule.resident_pubkey != prior.capsule.resident_pubkey
    {
        return CapsuleSuccessorDisposition::Invalid;
    }
    if &candidate.capsule.binding_ref != expected_current_binding {
        return CapsuleSuccessorDisposition::Stale;
    }
    if candidate.capsule.revision == prior.capsule.revision {
        return if candidate.capsule.integrity_sha256 == prior.capsule.integrity_sha256 {
            CapsuleSuccessorDisposition::Idempotent
        } else {
            CapsuleSuccessorDisposition::Invalid
        };
    }
    if prior
        .capsule
        .revision
        .get()
        .checked_add(1)
        .is_some_and(|next| candidate.capsule.revision.get() == next)
    {
        CapsuleSuccessorDisposition::Successor
    } else {
        CapsuleSuccessorDisposition::Invalid
    }
}

#[derive(Serialize)]
struct CapsuleManifestWithoutIntegrity<'a> {
    protocol: &'a str,
    capsule_id: &'a OpaqueId,
    owner_pubkey: &'a Hex64,
    resident_pubkey: &'a Hex64,
    binding_ref: &'a Sha256Ref,
    current_state_ref: &'a Sha256Ref,
    revision: SafeU53,
    created_at: &'a CanonicalTimestamp,
}

#[derive(Serialize)]
struct CapsuleIntegrityProjection<'a> {
    domain: &'static str,
    schema: &'static str,
    capsule: CapsuleManifestWithoutIntegrity<'a>,
    current_state: &'a PortableCapsuleCurrentStateV1,
}

fn projection_integrity(
    capsule: &PortableContinuityCapsuleV1,
    current_state: &PortableCapsuleCurrentStateV1,
) -> Result<Hex64, ContinuityError> {
    let projection = CapsuleIntegrityProjection {
        domain: CAPSULE_INTEGRITY_DOMAIN_V1,
        schema: PORTABLE_CAPSULE_ENVELOPE_SCHEMA_V1,
        capsule: CapsuleManifestWithoutIntegrity {
            protocol: &capsule.protocol,
            capsule_id: &capsule.capsule_id,
            owner_pubkey: &capsule.owner_pubkey,
            resident_pubkey: &capsule.resident_pubkey,
            binding_ref: &capsule.binding_ref,
            current_state_ref: &capsule.current_state_ref,
            revision: capsule.revision,
            created_at: &capsule.created_at,
        },
        current_state,
    };
    let canonical =
        Zeroizing::new(canonicalize(&projection).map_err(|_| ContinuityError::InvalidCapsule)?);
    Hex64::parse(hex::encode(Sha256::digest(&canonical)))
        .map_err(|_| ContinuityError::InvalidCapsule)
}

fn current_state_ref(
    current_state: &PortableCapsuleCurrentStateV1,
) -> Result<Sha256Ref, ContinuityError> {
    let canonical =
        Zeroizing::new(canonicalize(current_state).map_err(|_| ContinuityError::InvalidCapsule)?);
    Sha256Ref::parse(format!(
        "sha256:{}",
        hex::encode(Sha256::digest(&canonical))
    ))
    .map_err(|_| ContinuityError::InvalidCapsule)
}

fn zero_hex64() -> Result<Hex64, ContinuityError> {
    Hex64::parse("0".repeat(64)).map_err(|_| ContinuityError::InvalidCapsule)
}

#[derive(Serialize)]
struct MemoryBodyProjection<'a> {
    slug: &'static str,
    value: &'a str,
}

fn validate_body_projection(value: &str) -> Result<(), ContinuityError> {
    let body = Zeroizing::new(
        canonicalize(&MemoryBodyProjection {
            slug: PORTABLE_CAPSULE_NIP_AE_SLUG,
            value,
        })
        .map_err(|_| ContinuityError::InvalidCapsule)?,
    );
    if body.len() > MAX_PORTABLE_CAPSULE_BODY_JSON_BYTES {
        Err(ContinuityError::InvalidCapsule)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn owner() -> Hex64 {
        Hex64::parse("1".repeat(64)).expect("owner key")
    }

    fn resident() -> Hex64 {
        Hex64::parse("2".repeat(64)).expect("resident key")
    }

    fn binding(byte: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", byte.to_string().repeat(64))).expect("binding ref")
    }

    fn timestamp(second: u8) -> CanonicalTimestamp {
        CanonicalTimestamp::parse(format!("2026-08-05T00:00:{second:02}Z")).expect("timestamp")
    }

    fn state(body: &str) -> PortableCapsuleCurrentStateV1 {
        PortableCapsuleCurrentStateV1::new(
            Some(body.to_owned()),
            None,
            None,
            None,
            Some("digest".to_owned()),
            Some("unfinished".to_owned()),
            vec![binding('a'), binding('b')],
        )
        .expect("state")
    }

    fn projection(revision: u64, body: &str, binding_ref: Sha256Ref) -> PortableCapsuleEnvelopeV1 {
        project_portable_capsule(
            owner(),
            resident(),
            binding_ref,
            SafeU53::new(revision).expect("revision"),
            timestamp(revision as u8),
            state(body),
        )
        .expect("projection")
    }

    #[test]
    fn deterministic_vector_and_stable_capsule_id() {
        let first = projection(1, "core identity", binding('c'));
        let second = projection(1, "core identity", binding('c'));
        assert_eq!(first, second);
        assert_eq!(
            first.capsule.capsule_id.as_str(),
            "capsule:4815cd375f2237e993128f8246142f07ee40ddb131dbc9654877f6d151b77b38"
        );
        assert_eq!(
            first.capsule.current_state_ref.as_str(),
            "sha256:47da6779beab92f77a9fb7d7b92783b40f15f3533b60b0bd30987d350a0a09ab"
        );
        assert_eq!(
            first.capsule.integrity_sha256.as_str(),
            "ff242e30ab207a83e296fb5d2b01b4e7c6fef4a1fe7d582154ccf47cbab49172"
        );
        assert_eq!(
            derive_portable_capsule_id(&owner(), &resident()).expect("stable id"),
            first.capsule.capsule_id
        );
        let changed_state = projection(2, "different", binding('c'));
        assert_eq!(changed_state.capsule.capsule_id, first.capsule.capsule_id);
        let other_resident = Hex64::parse("3".repeat(64)).expect("other resident");
        assert_ne!(
            derive_portable_capsule_id(&owner(), &other_resident).expect("other stable id"),
            first.capsule.capsule_id
        );
        assert!(derive_portable_capsule_id(&owner(), &owner()).is_err());
    }

    #[test]
    fn segment_and_state_size_boundaries_fail_closed() {
        assert!(PortableCapsuleCurrentStateV1::new(
            Some("a".repeat(MAX_PORTABLE_CAPSULE_SEGMENT_BYTES)),
            None,
            None,
            None,
            None,
            None,
            vec![],
        )
        .is_ok());
        assert!(PortableCapsuleCurrentStateV1::new(
            Some("a".repeat(MAX_PORTABLE_CAPSULE_SEGMENT_BYTES + 1)),
            None,
            None,
            None,
            None,
            None,
            vec![],
        )
        .is_err());
        assert!(PortableCapsuleCurrentStateV1::new(
            Some("a".repeat(7_000)),
            Some("b".repeat(7_000)),
            Some("c".repeat(7_000)),
            None,
            None,
            None,
            vec![],
        )
        .is_err());
        assert!(PortableCapsuleCurrentStateV1::new(
            Some(String::new()),
            None,
            None,
            None,
            None,
            None,
            vec![],
        )
        .is_err());
        assert!(
            PortableCapsuleCurrentStateV1::new(None, None, None, None, None, None, vec![],)
                .is_err()
        );
    }

    #[test]
    fn source_refs_must_be_sorted_unique() {
        for refs in [
            vec![binding('b'), binding('a')],
            vec![binding('a'), binding('a')],
        ] {
            assert!(PortableCapsuleCurrentStateV1::new(
                Some("core".into()),
                None,
                None,
                None,
                None,
                None,
                refs,
            )
            .is_err());
        }
    }

    #[test]
    fn strict_unknown_duplicate_and_hash_tamper_rejection() {
        let envelope = projection(1, "secret body", binding('c'));
        let value = envelope.to_body_value().expect("body value");

        let mut unknown: Value = serde_json::from_str(value.as_str()).expect("json");
        unknown["current_state"]["unknown"] = Value::String("no".into());
        assert!(parse_portable_capsule_envelope(&unknown.to_string()).is_err());

        let duplicate = value.as_str().replacen(
            "\"schema\":",
            "\"schema\":\"luca.portable-capsule-envelope.v1\",\"schema\":",
            1,
        );
        assert!(parse_portable_capsule_envelope(&duplicate).is_err());

        let duplicate_segment =
            value
                .as_str()
                .replacen("\"core\":", "\"core\":\"duplicate\",\"core\":", 1);
        assert!(parse_portable_capsule_envelope(&duplicate_segment).is_err());

        let mut missing_fixed_segment: Value = serde_json::from_str(value.as_str()).expect("json");
        missing_fixed_segment["current_state"]
            .as_object_mut()
            .expect("state object")
            .remove("convictions");
        assert!(parse_portable_capsule_envelope(&missing_fixed_segment.to_string()).is_err());

        let mut wrong_schema: Value = serde_json::from_str(value.as_str()).expect("json");
        wrong_schema["schema"] = Value::String("luca.portable-capsule-envelope.v2".into());
        assert!(parse_portable_capsule_envelope(&wrong_schema.to_string()).is_err());

        let mut tampered: Value = serde_json::from_str(value.as_str()).expect("json");
        tampered["current_state"]["core"] = Value::String("changed".into());
        assert!(parse_portable_capsule_envelope(&tampered.to_string()).is_err());

        assert!(parse_portable_capsule_envelope("not json").is_err());
        let oversized = " ".repeat(MAX_PORTABLE_CAPSULE_ENVELOPE_BYTES + 1);
        assert!(parse_portable_capsule_envelope(&oversized).is_err());
    }

    #[test]
    fn exact_retry_successor_rollback_and_stale_binding() {
        let current_binding = binding('c');
        let prior = projection(1, "first", current_binding.clone());
        let retry = projection(1, "first", current_binding.clone());
        assert_eq!(
            classify_capsule_successor(&prior, &retry, &current_binding),
            CapsuleSuccessorDisposition::Idempotent
        );

        let successor = projection(2, "second", current_binding.clone());
        assert_eq!(
            classify_capsule_successor(&prior, &successor, &current_binding),
            CapsuleSuccessorDisposition::Successor
        );

        // Rollback republishes archived content as a new revision; it never
        // rewinds the revision counter or local notebook history.
        let rollback = projection(3, "first", current_binding.clone());
        assert_eq!(
            classify_capsule_successor(&successor, &rollback, &current_binding),
            CapsuleSuccessorDisposition::Successor
        );

        let stale = projection(2, "second", binding('d'));
        assert_eq!(
            classify_capsule_successor(&prior, &stale, &current_binding),
            CapsuleSuccessorDisposition::Stale
        );

        let skipped = projection(3, "skip", current_binding.clone());
        assert_eq!(
            classify_capsule_successor(&prior, &skipped, &current_binding),
            CapsuleSuccessorDisposition::Invalid
        );

        let same_revision_different_state = projection(1, "changed", current_binding.clone());
        assert_eq!(
            classify_capsule_successor(&prior, &same_revision_different_state, &current_binding),
            CapsuleSuccessorDisposition::Invalid
        );

        let other_resident = Hex64::parse("3".repeat(64)).expect("other resident");
        let other_identity = project_portable_capsule(
            owner(),
            other_resident,
            current_binding.clone(),
            SafeU53::new(2).expect("revision"),
            timestamp(2),
            state("second"),
        )
        .expect("other projection");
        assert_eq!(
            classify_capsule_successor(&prior, &other_identity, &current_binding),
            CapsuleSuccessorDisposition::Invalid
        );

        let old_binding = binding('d');
        let old_prior = projection(1, "old", old_binding.clone());
        let old_candidate = projection(2, "still old", old_binding);
        assert_eq!(
            classify_capsule_successor(&old_prior, &old_candidate, &current_binding),
            CapsuleSuccessorDisposition::Stale
        );
    }

    #[test]
    fn fixed_segment_render_order_and_revision_floor() {
        let state = PortableCapsuleCurrentStateV1::new(
            Some("one".into()),
            Some("two".into()),
            Some("three".into()),
            Some("four".into()),
            Some("five".into()),
            Some("six".into()),
            vec![],
        )
        .expect("state");
        assert_eq!(
            state.segments_in_order().map(|(name, _)| name),
            [
                "core",
                "self_model",
                "owner_relationship",
                "convictions",
                "current_digest",
                "unfinished_threads",
            ]
        );
        assert!(project_portable_capsule(
            owner(),
            resident(),
            binding('c'),
            SafeU53::new(0).expect("zero is representable"),
            timestamp(0),
            state,
        )
        .is_err());
    }

    #[test]
    fn body_value_is_canonical_bounded_and_debug_is_redacted() {
        let envelope = projection(1, "never print this segment", binding('c'));
        let debug = format!("{envelope:?}");
        assert!(!debug.contains("never print this segment"));
        assert!(debug.contains("segments"));

        let value = envelope.to_body_value().expect("body value");
        assert!(!format!("{value:?}").contains("never print this segment"));
        assert_eq!(
            value.as_str().as_bytes(),
            canonicalize(&parse_portable_capsule_envelope(value.as_str()).expect("round trip"))
                .expect("canonical envelope")
        );
        let body = canonicalize(&MemoryBodyProjection {
            slug: PORTABLE_CAPSULE_NIP_AE_SLUG,
            value: value.as_str(),
        })
        .expect("projected body");
        assert!(body.len() <= MAX_PORTABLE_CAPSULE_BODY_JSON_BYTES);
    }

    #[test]
    fn explicit_zeroize_erases_every_owned_segment() {
        let mut state = state("private core");
        state.zeroize();
        for (_, segment) in state.segments_in_order() {
            if let Some(segment) = segment {
                assert!(segment.is_empty());
            }
        }
    }
}

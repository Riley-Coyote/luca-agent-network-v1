//! Strict, bounded decoding of authenticated retrieval material.
//!
//! The encrypted record body is the only serialized input. Text-bearing fields
//! move directly into [`RetrievalText`] owners, and partially decoded values are
//! therefore erased on every error path.

use crate::{
    retrieval::{
        MAX_AGGREGATE_TAG_BYTES, MAX_CONFIDENCE_BASIS_POINTS, MAX_INPUT_EDGES, MAX_PROVENANCE_REFS,
        MAX_RECORD_BODY_BYTES, MAX_TAGS,
    },
    ContinuityError, DecryptedRecordBody, NamespaceScope, RetrievalEdge, RetrievalRecordInput,
    RetrievalRecordState, RetrievalRelation, RetrievalText,
};
use luca_protocol::{OpaqueId, SafeU53, Sha256Ref};
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde::Deserializer;
use std::{collections::BTreeSet, fmt, marker::PhantomData};

/// Exact discriminator for the first retrieval-material representation.
pub const RETRIEVAL_MATERIAL_PROTOCOL_V1: &str = "luca.continuity.retrieval-material.v1";
/// Exact schema version for [`RetrievalMaterialV1`].
pub const RETRIEVAL_MATERIAL_VERSION_V1: u16 = 1;

/// Validated plaintext material decoded from one authenticated encrypted body.
///
/// Body and tags remain zeroizing. The type cannot be constructed outside this
/// module, so conversion to a retrieval input never bypasses strict decoding.
pub struct RetrievalMaterialV1 {
    body: RetrievalText,
    tags: Vec<RetrievalText>,
    confidence_basis_points: u16,
    provenance_refs: Vec<Sha256Ref>,
    outgoing_edges: Vec<RetrievalEdge>,
}

impl RetrievalMaterialV1 {
    /// Strictly decode one authenticated body.
    ///
    /// Unknown, duplicate, missing, malformed, unsorted, duplicate, or
    /// over-bound material fails closed. The source body remains zeroizing for
    /// the entire parse and is erased when this function returns.
    pub fn decode(body: DecryptedRecordBody) -> Result<Self, ContinuityError> {
        let result = {
            let mut deserializer = serde_json::Deserializer::from_slice(body.as_bytes());
            let decoded = MaterialSeed
                .deserialize(&mut deserializer)
                .map_err(|_| ContinuityError::InvalidRetrievalRecord)?;
            deserializer
                .end()
                .map_err(|_| ContinuityError::InvalidRetrievalRecord)?;
            decoded
        };
        Ok(result)
    }

    /// Return the exact material protocol discriminator.
    pub fn protocol(&self) -> &'static str {
        RETRIEVAL_MATERIAL_PROTOCOL_V1
    }

    /// Return the exact material schema version.
    pub fn version(&self) -> u16 {
        RETRIEVAL_MATERIAL_VERSION_V1
    }

    /// Borrow the private body for immediate guarded assembly only.
    pub fn body(&self) -> &str {
        self.body.as_str()
    }

    /// Borrow the zeroizing lexical tags.
    pub fn tags(&self) -> &[RetrievalText] {
        &self.tags
    }

    /// Return the source-backed confidence score.
    pub fn confidence_basis_points(&self) -> u16 {
        self.confidence_basis_points
    }

    /// Borrow the body-free provenance references.
    pub fn provenance_refs(&self) -> &[Sha256Ref] {
        &self.provenance_refs
    }

    /// Borrow the typed body-free graph edges.
    pub fn outgoing_edges(&self) -> &[RetrievalEdge] {
        &self.outgoing_edges
    }

    /// Consume validated material into the existing retrieval input contract.
    ///
    /// State-dependent provenance is checked before the input is constructed.
    pub fn into_record_input(
        self,
        address: NamespaceScope,
        record_id: OpaqueId,
        record_type: OpaqueId,
        revision: SafeU53,
        state: RetrievalRecordState,
    ) -> Result<RetrievalRecordInput, ContinuityError> {
        if state == RetrievalRecordState::Active && self.provenance_refs.is_empty() {
            return Err(ContinuityError::InvalidRetrievalRecord);
        }
        Ok(RetrievalRecordInput {
            address,
            record_id,
            record_type,
            revision,
            body: self.body,
            tags: self.tags,
            confidence_basis_points: self.confidence_basis_points,
            provenance_refs: self.provenance_refs,
            outgoing_edges: self.outgoing_edges,
            state,
        })
    }
}

impl fmt::Debug for RetrievalMaterialV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RetrievalMaterialV1")
            .field("protocol", &RETRIEVAL_MATERIAL_PROTOCOL_V1)
            .field("version", &RETRIEVAL_MATERIAL_VERSION_V1)
            .field("body", &"[REDACTED]")
            .field("tag_count", &self.tags.len())
            .field("confidence_basis_points", &self.confidence_basis_points)
            .field("provenance_count", &self.provenance_refs.len())
            .field("edge_count", &self.outgoing_edges.len())
            .finish()
    }
}

struct MaterialSeed;

impl<'de> DeserializeSeed<'de> for MaterialSeed {
    type Value = RetrievalMaterialV1;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(MaterialVisitor)
    }
}

struct MaterialVisitor;

impl<'de> Visitor<'de> for MaterialVisitor {
    type Value = RetrievalMaterialV1;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a strict Luca retrieval-material v1 object")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut protocol = None;
        let mut version = None;
        let mut body = None;
        let mut tags = None;
        let mut confidence = None;
        let mut provenance = None;
        let mut edges = None;

        while let Some(field) = map.next_key::<MaterialField>()? {
            match field {
                MaterialField::Protocol => set_once(
                    &mut protocol,
                    map.next_value_seed(ExactProtocolSeed)?,
                    "protocol",
                )?,
                MaterialField::Version => {
                    let value = map.next_value::<u16>()?;
                    if value != RETRIEVAL_MATERIAL_VERSION_V1 {
                        return Err(de::Error::custom("unsupported retrieval material version"));
                    }
                    set_once(&mut version, value, "version")?;
                }
                MaterialField::Body => set_once(
                    &mut body,
                    map.next_value_seed(TextSeed {
                        max_bytes: MAX_RECORD_BODY_BYTES,
                    })?,
                    "body",
                )?,
                MaterialField::Tags => set_once(&mut tags, map.next_value_seed(TagsSeed)?, "tags")?,
                MaterialField::Confidence => {
                    let value = map.next_value::<u16>()?;
                    if value > MAX_CONFIDENCE_BASIS_POINTS {
                        return Err(de::Error::custom("confidence exceeds retrieval bound"));
                    }
                    set_once(&mut confidence, value, "confidence_basis_points")?;
                }
                MaterialField::Provenance => set_once(
                    &mut provenance,
                    map.next_value_seed(
                        BoundedSequenceSeed::<Sha256Ref, ProvenanceValueSeed>::new(
                            MAX_PROVENANCE_REFS,
                            ProvenanceValueSeed,
                        ),
                    )?,
                    "provenance_refs",
                )?,
                MaterialField::Edges => set_once(
                    &mut edges,
                    map.next_value_seed(BoundedSequenceSeed::<RetrievalEdge, EdgeSeed>::new(
                        MAX_INPUT_EDGES,
                        EdgeSeed,
                    ))?,
                    "outgoing_edges",
                )?,
            }
        }

        required(protocol, "protocol")?;
        let _version = required(version, "version")?;
        let body = required(body, "body")?;
        let tags = required(tags, "tags")?;
        let confidence_basis_points = required(confidence, "confidence_basis_points")?;
        let provenance_refs = required(provenance, "provenance_refs")?;
        let outgoing_edges = required(edges, "outgoing_edges")?;

        if !strictly_sorted(&provenance_refs) || has_duplicate_edges(&outgoing_edges) {
            return Err(de::Error::custom("retrieval material is not canonical"));
        }

        Ok(RetrievalMaterialV1 {
            body,
            tags,
            confidence_basis_points,
            provenance_refs,
            outgoing_edges,
        })
    }
}

#[derive(Clone, Copy)]
enum MaterialField {
    Protocol,
    Version,
    Body,
    Tags,
    Confidence,
    Provenance,
    Edges,
}

impl<'de> serde::Deserialize<'de> for MaterialField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FieldVisitor;
        impl Visitor<'_> for FieldVisitor {
            type Value = MaterialField;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a retrieval-material field")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                match value {
                    "protocol" => Ok(MaterialField::Protocol),
                    "version" => Ok(MaterialField::Version),
                    "body" => Ok(MaterialField::Body),
                    "tags" => Ok(MaterialField::Tags),
                    "confidence_basis_points" => Ok(MaterialField::Confidence),
                    "provenance_refs" => Ok(MaterialField::Provenance),
                    "outgoing_edges" => Ok(MaterialField::Edges),
                    _ => Err(de::Error::unknown_field(value, MATERIAL_FIELDS)),
                }
            }
        }
        deserializer.deserialize_identifier(FieldVisitor)
    }
}

const MATERIAL_FIELDS: &[&str] = &[
    "protocol",
    "version",
    "body",
    "tags",
    "confidence_basis_points",
    "provenance_refs",
    "outgoing_edges",
];

struct ExactProtocolSeed;

impl<'de> DeserializeSeed<'de> for ExactProtocolSeed {
    type Value = ();
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ExactProtocolVisitor;
        impl Visitor<'_> for ExactProtocolVisitor {
            type Value = ();
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("the exact retrieval-material v1 protocol")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                (value == RETRIEVAL_MATERIAL_PROTOCOL_V1)
                    .then_some(())
                    .ok_or_else(|| de::Error::custom("invalid retrieval material protocol"))
            }
        }
        deserializer.deserialize_str(ExactProtocolVisitor)
    }
}

#[derive(Clone, Copy)]
struct TextSeed {
    max_bytes: usize,
}

impl<'de> DeserializeSeed<'de> for TextSeed {
    type Value = RetrievalText;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_string(TextVisitor {
            max_bytes: self.max_bytes,
        })
    }
}

struct TextVisitor {
    max_bytes: usize,
}

impl Visitor<'_> for TextVisitor {
    type Value = RetrievalText;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("bounded UTF-8 retrieval text")
    }
    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.len() > self.max_bytes {
            return Err(de::Error::custom("retrieval text exceeds bound"));
        }
        Ok(RetrievalText::from(value))
    }
    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        if value.len() > self.max_bytes {
            let _value = zeroize::Zeroizing::new(value);
            return Err(de::Error::custom("retrieval text exceeds bound"));
        }
        Ok(RetrievalText::new(value))
    }
}

struct TagsSeed;

impl<'de> DeserializeSeed<'de> for TagsSeed {
    type Value = Vec<RetrievalText>;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct TagsVisitor;
        impl<'de> Visitor<'de> for TagsVisitor {
            type Value = Vec<RetrievalText>;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("sorted unique bounded retrieval tags")
            }
            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut tags = Vec::with_capacity(sequence.size_hint().unwrap_or(0).min(MAX_TAGS));
                let mut total_bytes = 0_usize;
                while let Some(tag) = sequence.next_element_seed(TextSeed {
                    max_bytes: MAX_AGGREGATE_TAG_BYTES,
                })? {
                    if tags.len() == MAX_TAGS {
                        return Err(de::Error::custom("tag count exceeds retrieval bound"));
                    }
                    total_bytes = total_bytes
                        .checked_add(tag.as_str().len())
                        .ok_or_else(|| de::Error::custom("tag bytes exceed retrieval bound"))?;
                    if total_bytes > MAX_AGGREGATE_TAG_BYTES
                        || tags.last().is_some_and(|previous| previous >= &tag)
                    {
                        return Err(de::Error::custom("tags are over-bound or noncanonical"));
                    }
                    tags.push(tag);
                }
                Ok(tags)
            }
        }
        deserializer.deserialize_seq(TagsVisitor)
    }
}

#[derive(Clone)]
struct BoundedSequenceSeed<T, S> {
    max: usize,
    item_seed: S,
    marker: PhantomData<T>,
}

impl<T, S> BoundedSequenceSeed<T, S> {
    fn new(max: usize, item_seed: S) -> Self {
        Self {
            max,
            item_seed,
            marker: PhantomData,
        }
    }
}

impl<'de, T, S> DeserializeSeed<'de> for BoundedSequenceSeed<T, S>
where
    S: DeserializeSeed<'de, Value = T> + Clone,
{
    type Value = Vec<T>;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct SequenceVisitor<T, S> {
            max: usize,
            item_seed: S,
            marker: PhantomData<T>,
        }
        impl<'de, T, S> Visitor<'de> for SequenceVisitor<T, S>
        where
            S: DeserializeSeed<'de, Value = T> + Clone,
        {
            type Value = Vec<T>;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a bounded retrieval-material sequence")
            }
            fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut values =
                    Vec::with_capacity(sequence.size_hint().unwrap_or(0).min(self.max));
                while let Some(value) = sequence.next_element_seed(self.item_seed.clone())? {
                    if values.len() == self.max {
                        return Err(de::Error::custom("retrieval collection exceeds bound"));
                    }
                    values.push(value);
                }
                Ok(values)
            }
        }
        deserializer.deserialize_seq(SequenceVisitor {
            max: self.max,
            item_seed: self.item_seed,
            marker: PhantomData,
        })
    }
}

#[derive(Clone, Copy)]
struct ProvenanceValueSeed;

impl<'de> DeserializeSeed<'de> for ProvenanceValueSeed {
    type Value = Sha256Ref;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct ProvenanceVisitor;
        impl Visitor<'_> for ProvenanceVisitor {
            type Value = Sha256Ref;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("sha256:<64 lowercase hex>")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.len() != 71 {
                    return Err(de::Error::custom("invalid provenance reference"));
                }
                Sha256Ref::parse(value.to_owned()).map_err(de::Error::custom)
            }
        }
        deserializer.deserialize_str(ProvenanceVisitor)
    }
}

#[derive(Clone, Copy)]
struct EdgeSeed;

impl<'de> DeserializeSeed<'de> for EdgeSeed {
    type Value = RetrievalEdge;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(EdgeVisitor)
    }
}

struct EdgeVisitor;

impl<'de> Visitor<'de> for EdgeVisitor {
    type Value = RetrievalEdge;
    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a strict typed retrieval edge")
    }
    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut target = None;
        let mut relation = None;
        let mut weight = None;
        while let Some(field) = map.next_key::<EdgeField>()? {
            match field {
                EdgeField::Target => set_once(
                    &mut target,
                    map.next_value_seed(OpaqueIdSeed)?,
                    "target_record_id",
                )?,
                EdgeField::Relation => set_once(
                    &mut relation,
                    map.next_value_seed(RelationSeed)?,
                    "relation",
                )?,
                EdgeField::Weight => {
                    let value = map.next_value::<u16>()?;
                    if value > 10_000 {
                        return Err(de::Error::custom("edge weight exceeds retrieval bound"));
                    }
                    set_once(&mut weight, value, "weight_basis_points")?;
                }
            }
        }
        Ok(RetrievalEdge {
            target_record_id: required(target, "target_record_id")?,
            relation: required(relation, "relation")?,
            weight_basis_points: required(weight, "weight_basis_points")?,
        })
    }
}

enum EdgeField {
    Target,
    Relation,
    Weight,
}

impl<'de> serde::Deserialize<'de> for EdgeField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct EdgeFieldVisitor;
        impl Visitor<'_> for EdgeFieldVisitor {
            type Value = EdgeField;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a retrieval-edge field")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                match value {
                    "target_record_id" => Ok(EdgeField::Target),
                    "relation" => Ok(EdgeField::Relation),
                    "weight_basis_points" => Ok(EdgeField::Weight),
                    _ => Err(de::Error::unknown_field(value, EDGE_FIELDS)),
                }
            }
        }
        deserializer.deserialize_identifier(EdgeFieldVisitor)
    }
}

const EDGE_FIELDS: &[&str] = &["target_record_id", "relation", "weight_basis_points"];

#[derive(Clone, Copy)]
struct OpaqueIdSeed;

impl<'de> DeserializeSeed<'de> for OpaqueIdSeed {
    type Value = OpaqueId;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct OpaqueIdVisitor;
        impl Visitor<'_> for OpaqueIdVisitor {
            type Value = OpaqueId;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a bounded opaque identifier")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.len() > 128 {
                    return Err(de::Error::custom("opaque identifier exceeds bound"));
                }
                OpaqueId::parse(value.to_owned()).map_err(de::Error::custom)
            }
        }
        deserializer.deserialize_str(OpaqueIdVisitor)
    }
}

#[derive(Clone, Copy)]
struct RelationSeed;

impl<'de> DeserializeSeed<'de> for RelationSeed {
    type Value = RetrievalRelation;
    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RelationVisitor;
        impl Visitor<'_> for RelationVisitor {
            type Value = RetrievalRelation;
            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a typed retrieval relation")
            }
            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(match value {
                    "supports" => RetrievalRelation::Supports,
                    "elaborates" => RetrievalRelation::Elaborates,
                    "related" => RetrievalRelation::Related,
                    "contradicts" => RetrievalRelation::Contradicts,
                    other => RetrievalRelation::Unknown(
                        OpaqueId::parse(other.to_owned()).map_err(de::Error::custom)?,
                    ),
                })
            }
        }
        deserializer.deserialize_str(RelationVisitor)
    }
}

fn set_once<T, E: de::Error>(slot: &mut Option<T>, value: T, name: &'static str) -> Result<(), E> {
    if slot.replace(value).is_some() {
        return Err(de::Error::duplicate_field(name));
    }
    Ok(())
}

fn required<T, E: de::Error>(value: Option<T>, name: &'static str) -> Result<T, E> {
    value.ok_or_else(|| de::Error::missing_field(name))
}

fn strictly_sorted<T: Ord>(values: &[T]) -> bool {
    !values.windows(2).any(|pair| pair[0] >= pair[1])
}

fn has_duplicate_edges(edges: &[RetrievalEdge]) -> bool {
    let mut seen = BTreeSet::new();
    edges
        .iter()
        .any(|edge| !seen.insert((&edge.target_record_id, &edge.relation)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{decrypt_record, encrypt_record, RecordMetadata};
    use luca_protocol::{
        CanonicalTimestamp, ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1,
        Hex64, CONTINUITY_PROTOCOL,
    };
    use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

    const KEY: [u8; 32] = [7; 32];

    fn hex(digit: char) -> Hex64 {
        Hex64::parse(digit.to_string().repeat(64)).unwrap()
    }

    fn sha(digit: char) -> Sha256Ref {
        Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
    }

    fn metadata(record_id: &str) -> RecordMetadata {
        let namespace = ContinuityNamespaceV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            owner_pubkey: hex('1'),
            kind: ContinuityNamespaceKindV1::ResidentPrivate,
            resident_pubkey: Some(hex('2')),
            namespace_ref: sha('3'),
            key_version: SafeU53::new(1).unwrap(),
        };
        RecordMetadata {
            protocol: CONTINUITY_PROTOCOL.into(),
            record_id: OpaqueId::parse(record_id).unwrap(),
            namespace: namespace.clone(),
            scope: ContinuityScopeV1 {
                protocol: CONTINUITY_PROTOCOL.into(),
                namespace_ref: namespace.namespace_ref,
                scope_ref: sha('4'),
                source_id: Some(OpaqueId::parse("source-1").unwrap()),
                project_id: None,
                room_id: None,
                conversation_id: Some(OpaqueId::parse("conversation-1").unwrap()),
            },
            record_type: OpaqueId::parse("hypomnema").unwrap(),
            revision: SafeU53::new(0).unwrap(),
            predecessor_record_id: None,
            created_at: CanonicalTimestamp::parse("2026-08-05T00:00:00Z").unwrap(),
            author_kind: OpaqueId::parse("resident").unwrap(),
            provenance_refs: vec![sha('5')],
            key_version: SafeU53::new(1).unwrap(),
        }
    }

    fn decode_json(json: &str) -> Result<RetrievalMaterialV1, ContinuityError> {
        let encrypted = encrypt_record(metadata("material-test"), &KEY, json.as_bytes()).unwrap();
        RetrievalMaterialV1::decode(decrypt_record(&encrypted, &KEY).unwrap())
    }

    fn valid_json(body: &str) -> Zeroizing<String> {
        Zeroizing::new(format!(
            "{{\"protocol\":\"{RETRIEVAL_MATERIAL_PROTOCOL_V1}\",\"version\":1,\"body\":{},\"tags\":[\"continuity\",\"unresolved\"],\"confidence_basis_points\":8000,\"provenance_refs\":[\"{}\"],\"outgoing_edges\":[{{\"target_record_id\":\"record-2\",\"relation\":\"supports\",\"weight_basis_points\":9000}}]}}",
            serde_json::to_string(body).unwrap(),
            sha('6').as_str(),
        ))
    }

    #[test]
    fn strict_material_decodes_into_zeroizing_retrieval_input() {
        fn assert_zeroize_on_drop<T: ZeroizeOnDrop>() {}
        assert_zeroize_on_drop::<RetrievalText>();

        let json = valid_json("private notebook body");
        let material = decode_json(&json).unwrap();
        assert_eq!(material.protocol(), RETRIEVAL_MATERIAL_PROTOCOL_V1);
        assert_eq!(material.version(), 1);
        assert_eq!(material.body(), "private notebook body");
        assert!(!format!("{material:?}").contains("private notebook body"));
        assert!(!format!("{material:?}").contains("unresolved"));

        let mut clone = material.tags()[0].clone();
        clone.zeroize();
        assert!(clone.as_str().is_empty());
    }

    #[test]
    fn unknown_duplicate_missing_and_malformed_fields_fail_closed() {
        let valid = valid_json("secret");
        let unknown = valid.replace("\"version\":1", "\"version\":1,\"unexpected\":true");
        let duplicate = valid.replace("\"version\":1", "\"version\":1,\"body\":\"duplicate\"");
        let missing = valid.replace("\"tags\":[\"continuity\",\"unresolved\"],", "");
        let malformed = valid.trim_end_matches('}').to_owned();
        for candidate in [unknown, duplicate, missing, malformed] {
            assert!(matches!(
                decode_json(&candidate),
                Err(ContinuityError::InvalidRetrievalRecord)
            ));
        }
    }

    #[test]
    fn oversized_and_noncanonical_collections_fail_before_input_construction() {
        let tags = (0..=MAX_TAGS)
            .map(|index| format!("\"tag-{index:03}\""))
            .collect::<Vec<_>>()
            .join(",");
        let over_tags = valid_json("secret").replace("\"continuity\",\"unresolved\"", &tags);
        assert!(matches!(
            decode_json(&over_tags),
            Err(ContinuityError::InvalidRetrievalRecord)
        ));

        let unsorted =
            valid_json("secret").replace("\"continuity\",\"unresolved\"", "\"zeta\",\"alpha\"");
        assert!(matches!(
            decode_json(&unsorted),
            Err(ContinuityError::InvalidRetrievalRecord)
        ));
    }

    #[test]
    fn partial_decode_errors_redact_and_drop_all_material_text() {
        let partial = Zeroizing::new(format!(
            "{{\"protocol\":\"{RETRIEVAL_MATERIAL_PROTOCOL_V1}\",\"version\":1,\"body\":\"partial-private-body\",\"tags\":[\"partial-private-tag\"],\"confidence_basis_points\":8000,\"provenance_refs\":[\"not-a-reference\"],\"outgoing_edges\":[]}}"
        ));
        let error = decode_json(&partial).unwrap_err();
        assert_eq!(error, ContinuityError::InvalidRetrievalRecord);
        assert!(!format!("{error:?}").contains("partial-private"));
        assert!(!error.to_string().contains("partial-private"));
    }

    #[test]
    fn nested_edge_shape_and_active_provenance_are_strict() {
        let unknown_edge = valid_json("secret").replace(
            "\"weight_basis_points\":9000",
            "\"weight_basis_points\":9000,\"unknown\":true",
        );
        assert!(matches!(
            decode_json(&unknown_edge),
            Err(ContinuityError::InvalidRetrievalRecord)
        ));

        let no_provenance = valid_json("secret").replace(
            &format!("\"provenance_refs\":[\"{}\"]", sha('6').as_str()),
            "\"provenance_refs\":[]",
        );
        let material = decode_json(&no_provenance).unwrap();
        let address = NamespaceScope::new(
            crate::NamespaceKey::new(metadata("input").namespace).unwrap(),
            metadata("input").scope,
        )
        .unwrap();
        assert!(matches!(
            material.into_record_input(
                address,
                OpaqueId::parse("record-1").unwrap(),
                OpaqueId::parse("hypomnema").unwrap(),
                SafeU53::new(0).unwrap(),
                RetrievalRecordState::Active,
            ),
            Err(ContinuityError::InvalidRetrievalRecord)
        ));
    }

    #[test]
    fn retrieval_query_type_remains_zeroizing_at_the_public_boundary() {
        let query = crate::RetrievalQuery {
            address: NamespaceScope::new(
                crate::NamespaceKey::new(metadata("query").namespace).unwrap(),
                metadata("query").scope,
            )
            .unwrap(),
            cue: RetrievalText::from("private cue"),
            query_vector: None,
        };
        assert!(!format!("{query:?}").contains("private cue"));
    }
}

//! Deterministic, read-only synthetic fixtures for scope-isolation tests.

use crate::{ContinuityError, NamespaceKey, NamespaceScope};
use luca_protocol::{
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL,
};
use std::collections::BTreeMap;

/// One body-free synthetic record address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticFixture {
    /// Stable fixture identifier, sorted lexicographically in the index.
    pub fixture_id: String,
    /// Exact namespace and scope to which this fixture belongs.
    pub address: NamespaceScope,
}

/// Read-only deterministic index of synthetic fixture addresses.
#[derive(Debug, Clone, Default)]
pub struct FixtureIndex {
    fixtures: Vec<SyntheticFixture>,
}

impl FixtureIndex {
    /// Construct an immutable index, rejecting duplicate identifiers.
    pub fn new(
        fixtures: impl IntoIterator<Item = SyntheticFixture>,
    ) -> Result<Self, ContinuityError> {
        let mut sorted = BTreeMap::new();
        for fixture in fixtures {
            if sorted.insert(fixture.fixture_id.clone(), fixture).is_some() {
                return Err(ContinuityError::DuplicateFixtureId);
            }
        }
        Ok(Self {
            fixtures: sorted.into_values().collect(),
        })
    }

    /// Return all fixtures in repeatable fixture-id order.
    pub fn all(&self) -> &[SyntheticFixture] {
        &self.fixtures
    }

    /// Return fixtures matching the complete requested namespace and scope.
    ///
    /// This is read-only. It performs no membership inference, partial field
    /// matching, fallback selection, configuration lookup, or mutation.
    pub fn read_exact(&self, requested: &NamespaceScope) -> Vec<&SyntheticFixture> {
        self.fixtures
            .iter()
            .filter(|fixture| fixture.address.permits(requested))
            .collect()
    }
}

fn hex(digit: char) -> Result<Hex64, ContinuityError> {
    Hex64::parse(digit.to_string().repeat(64)).map_err(|_| ContinuityError::InvalidFixture)
}

fn sha(digit: char) -> Result<Sha256Ref, ContinuityError> {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64)))
        .map_err(|_| ContinuityError::InvalidFixture)
}

fn resident_namespace(
    owner: char,
    resident: char,
    namespace: char,
) -> Result<NamespaceKey, ContinuityError> {
    NamespaceKey::new(ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        owner_pubkey: hex(owner)?,
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex(resident)?),
        namespace_ref: sha(namespace)?,
        key_version: SafeU53::new(1).map_err(|_| ContinuityError::InvalidFixture)?,
    })
}

fn scoped(
    namespace: NamespaceKey,
    scope_ref: char,
    source: &str,
    project: &str,
    room: &str,
    conversation: &str,
) -> Result<NamespaceScope, ContinuityError> {
    let scope = ContinuityScopeV1 {
        protocol: CONTINUITY_PROTOCOL.to_owned(),
        namespace_ref: namespace.as_protocol().namespace_ref.clone(),
        scope_ref: sha(scope_ref)?,
        source_id: Some(OpaqueId::parse(source).map_err(|_| ContinuityError::InvalidFixture)?),
        project_id: Some(OpaqueId::parse(project).map_err(|_| ContinuityError::InvalidFixture)?),
        room_id: Some(OpaqueId::parse(room).map_err(|_| ContinuityError::InvalidFixture)?),
        conversation_id: Some(
            OpaqueId::parse(conversation).map_err(|_| ContinuityError::InvalidFixture)?,
        ),
    };
    NamespaceScope::new(namespace, scope)
}

/// Build the stable synthetic corpus used by isolation tests.
pub fn synthetic_fixture_index() -> Result<FixtureIndex, ContinuityError> {
    let owner_a_resident_a = resident_namespace('1', '2', 'a')?;
    let owner_a_resident_b = resident_namespace('1', '3', 'b')?;
    let owner_b_resident_a = resident_namespace('4', '5', 'c')?;
    FixtureIndex::new([
        SyntheticFixture {
            fixture_id: "owner-a-resident-a".to_owned(),
            address: scoped(
                owner_a_resident_a,
                'd',
                "source-a",
                "project-a",
                "room-a",
                "conversation-a",
            )?,
        },
        SyntheticFixture {
            fixture_id: "owner-a-resident-b".to_owned(),
            address: scoped(
                owner_a_resident_b,
                'e',
                "source-a",
                "project-a",
                "room-a",
                "conversation-a",
            )?,
        },
        SyntheticFixture {
            fixture_id: "owner-b-resident-a".to_owned(),
            address: scoped(
                owner_b_resident_a,
                'f',
                "source-b",
                "project-b",
                "room-b",
                "conversation-b",
            )?,
        },
    ])
}

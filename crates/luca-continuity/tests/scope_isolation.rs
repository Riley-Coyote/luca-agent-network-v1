use luca_continuity::{synthetic_fixture_index, ContinuityError, NamespaceKey, NamespaceScope};
use luca_protocol::{
    ContinuityNamespaceKindV1, ContinuityNamespaceV1, ContinuityScopeV1, Hex64, OpaqueId, SafeU53,
    Sha256Ref, CONTINUITY_PROTOCOL,
};

fn hex(digit: char) -> Hex64 {
    Hex64::parse(digit.to_string().repeat(64)).unwrap()
}

fn sha(digit: char) -> Sha256Ref {
    Sha256Ref::parse(format!("sha256:{}", digit.to_string().repeat(64))).unwrap()
}

fn resident_namespace(owner: char, resident: char, namespace: char) -> NamespaceKey {
    NamespaceKey::new(ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex(owner),
        kind: ContinuityNamespaceKindV1::ResidentPrivate,
        resident_pubkey: Some(hex(resident)),
        namespace_ref: sha(namespace),
        key_version: SafeU53::new(1).unwrap(),
    })
    .unwrap()
}

fn scope(
    namespace: NamespaceKey,
    scope_ref: char,
    source: &str,
    project: &str,
    room: &str,
    conversation: &str,
) -> NamespaceScope {
    NamespaceScope::new(
        namespace.clone(),
        ContinuityScopeV1 {
            protocol: CONTINUITY_PROTOCOL.into(),
            namespace_ref: namespace.as_protocol().namespace_ref.clone(),
            scope_ref: sha(scope_ref),
            source_id: Some(OpaqueId::parse(source).unwrap()),
            project_id: Some(OpaqueId::parse(project).unwrap()),
            room_id: Some(OpaqueId::parse(room).unwrap()),
            conversation_id: Some(OpaqueId::parse(conversation).unwrap()),
        },
    )
    .unwrap()
}

#[test]
fn same_exact_scope_is_authorized_and_repeatable_without_mutation() {
    let index = synthetic_fixture_index().unwrap();
    let requested = index.all()[0].address.clone();
    let first: Vec<_> = index
        .read_exact(&requested)
        .iter()
        .map(|f| f.fixture_id.clone())
        .collect();
    let second: Vec<_> = index
        .read_exact(&requested)
        .iter()
        .map(|f| f.fixture_id.clone())
        .collect();
    assert_eq!(first, vec!["owner-a-resident-a"]);
    assert_eq!(first, second);
    assert_eq!(index.all().len(), 3);
}

#[test]
fn cross_resident_and_cross_owner_access_are_denied() {
    let index = synthetic_fixture_index().unwrap();
    let resident_a = &index.all()[0].address;
    let resident_b = &index.all()[1].address;
    let other_owner = &index.all()[2].address;
    assert_eq!(index.read_exact(resident_b).len(), 1);
    assert_eq!(index.read_exact(other_owner).len(), 1);
    assert_eq!(
        resident_a.require_exact(resident_b),
        Err(ContinuityError::AccessDenied)
    );
    assert_eq!(
        resident_a.require_exact(other_owner),
        Err(ContinuityError::AccessDenied)
    );
}

#[test]
fn every_explicit_scope_component_requires_an_exact_match() {
    let index = synthetic_fixture_index().unwrap();
    let base = index.all()[0].address.clone();
    for (source, project, room, conversation) in [
        ("source-other", "project-a", "room-a", "conversation-a"),
        ("source-a", "project-other", "room-a", "conversation-a"),
        ("source-a", "project-a", "room-other", "conversation-a"),
        ("source-a", "project-a", "room-a", "conversation-other"),
    ] {
        let changed = scope(
            base.namespace().clone(),
            'd',
            source,
            project,
            room,
            conversation,
        );
        assert!(index.read_exact(&changed).is_empty());
        assert_eq!(
            base.require_exact(&changed),
            Err(ContinuityError::AccessDenied)
        );
    }
}

#[test]
fn same_scope_ref_with_different_explicit_fields_is_not_a_match() {
    let index = synthetic_fixture_index().unwrap();
    let base = index.all()[0].address.clone();
    let alias = scope(
        base.namespace().clone(),
        'd',
        "source-a",
        "project-a",
        "room-a",
        "conversation-other",
    );
    assert_eq!(base.as_protocol().scope_ref, alias.as_protocol().scope_ref);
    assert!(index.read_exact(&alias).is_empty());
}

#[test]
fn invalid_empty_and_mismatched_references_are_rejected() {
    assert!(OpaqueId::parse("").is_err());
    let namespace = resident_namespace('1', '2', 'a');
    let empty = ContinuityScopeV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        namespace_ref: namespace.as_protocol().namespace_ref.clone(),
        scope_ref: sha('d'),
        source_id: None,
        project_id: None,
        room_id: None,
        conversation_id: None,
    };
    assert_eq!(
        NamespaceScope::new(namespace.clone(), empty),
        Err(ContinuityError::InvalidScope)
    );
    let mismatched = ContinuityScopeV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        namespace_ref: sha('b'),
        scope_ref: sha('d'),
        source_id: Some(OpaqueId::parse("source-a").unwrap()),
        project_id: None,
        room_id: None,
        conversation_id: None,
    };
    assert_eq!(
        NamespaceScope::new(namespace, mismatched),
        Err(ContinuityError::ScopeNamespaceMismatch)
    );
}

#[test]
fn matching_namespace_reference_never_overrides_explicit_authority_fields() {
    let base = resident_namespace('1', '2', 'a');
    for candidate in [
        ContinuityNamespaceV1 {
            owner_pubkey: hex('4'),
            ..base.as_protocol().clone()
        },
        ContinuityNamespaceV1 {
            resident_pubkey: Some(hex('3')),
            ..base.as_protocol().clone()
        },
        ContinuityNamespaceV1 {
            key_version: SafeU53::new(2).unwrap(),
            ..base.as_protocol().clone()
        },
        ContinuityNamespaceV1 {
            kind: ContinuityNamespaceKindV1::OwnerBrain,
            resident_pubkey: None,
            ..base.as_protocol().clone()
        },
    ] {
        assert_eq!(candidate.namespace_ref, base.as_protocol().namespace_ref);
        assert!(!base.permits_namespace(&candidate));
    }
}

#[test]
fn owner_brain_never_equals_resident_private_even_if_owner_and_reference_match() {
    let resident = resident_namespace('1', '2', 'a');
    let owner_brain = NamespaceKey::new(ContinuityNamespaceV1 {
        protocol: CONTINUITY_PROTOCOL.into(),
        owner_pubkey: hex('1'),
        kind: ContinuityNamespaceKindV1::OwnerBrain,
        resident_pubkey: None,
        namespace_ref: sha('a'),
        key_version: SafeU53::new(1).unwrap(),
    })
    .unwrap();
    let resident_scope = scope(
        resident,
        'd',
        "source-a",
        "project-a",
        "room-a",
        "conversation-a",
    );
    let brain_scope = scope(
        owner_brain,
        'd',
        "source-a",
        "project-a",
        "room-a",
        "conversation-a",
    );
    assert_eq!(
        resident_scope.require_exact(&brain_scope),
        Err(ContinuityError::AccessDenied)
    );
}

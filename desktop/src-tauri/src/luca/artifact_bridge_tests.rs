use super::*;

fn context(root: PathBuf) -> ArtifactBrokerContext {
    ArtifactBrokerContext {
        owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        session_epoch: SafeU53::new(7).unwrap(),
        binding_ref: Sha256Ref::parse(format!("sha256:{}", "a".repeat(64))).unwrap(),
        working_root_id: OpaqueId::parse("root-fixture").unwrap(),
        working_root: root,
    }
}

fn coordinates() -> TurnCoordinates {
    TurnCoordinates {
        conversation_id: OpaqueId::parse("conversation-1").unwrap(),
        turn_id: OpaqueId::parse("turn-1").unwrap(),
        dispatch_receipt_id: OpaqueId::parse("dispatch-1").unwrap(),
        cancellation_epoch: SafeU53::new(7).unwrap(),
    }
}

#[test]
fn exact_turn_capability_binds_dispatch_epoch_and_working_root() {
    let root = tempfile::tempdir().unwrap();
    let original = derive_turn_capability(
        &format!("sha256:{}", "b".repeat(64)),
        SafeU53::new(9).unwrap(),
        &context(root.path().to_path_buf()),
        &coordinates(),
    );
    let mut changed = coordinates();
    changed.dispatch_receipt_id = OpaqueId::parse("dispatch-2").unwrap();
    assert_ne!(
        original,
        derive_turn_capability(
            &format!("sha256:{}", "b".repeat(64)),
            SafeU53::new(9).unwrap(),
            &context(root.path().to_path_buf()),
            &changed,
        )
    );
    let mut changed_context = context(root.path().to_path_buf());
    changed_context.working_root_id = OpaqueId::parse("root-other").unwrap();
    assert_ne!(
        original,
        derive_turn_capability(
            &format!("sha256:{}", "b".repeat(64)),
            SafeU53::new(9).unwrap(),
            &changed_context,
            &coordinates(),
        )
    );
}

#[test]
fn workspace_sources_cannot_escape_through_symlinks() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), "secret").unwrap();
    symlink(outside.path(), root.path().join("escape")).unwrap();
    let operation = ArtifactToolOperationV1::ArtifactCreate(luca_protocol::ArtifactCreateArgsV1 {
        title: "Escape".into(),
        kind: luca_protocol::ArtifactKindV1::Text,
        source: ArtifactSourceV1::WorkspaceFile {
            relative_path: "escape/secret.txt".into(),
            declared_media_type: None,
        },
        idempotency_key: OpaqueId::parse("idem-1").unwrap(),
    });
    assert!(validate_workspace_source(&operation, root.path()).is_err());
}

#[test]
fn inline_artifacts_never_require_source_path_access() {
    let root = tempfile::tempdir().unwrap();
    let operation = ArtifactToolOperationV1::ArtifactCreate(luca_protocol::ArtifactCreateArgsV1 {
        title: "Note".into(),
        kind: luca_protocol::ArtifactKindV1::Markdown,
        source: ArtifactSourceV1::InlineText {
            content_utf8: "hello".into(),
            declared_media_type: Some("text/markdown".into()),
        },
        idempotency_key: OpaqueId::parse("idem-2").unwrap(),
    });
    assert!(validate_workspace_source(&operation, root.path()).is_ok());
}

#[test]
fn highlight_arguments_cannot_carry_selectors_or_execution() {
    assert_eq!(
        parse_highlight(serde_json::json!({"target_id":"sidebar:projects"})),
        Ok("sidebar:projects".into())
    );
    for value in [
        serde_json::json!({"target_id":"#secret"}),
        serde_json::json!({"target_id":"settings","script":"run"}),
        serde_json::json!({"target_id":""}),
    ] {
        assert!(parse_highlight(value).is_err());
    }
}

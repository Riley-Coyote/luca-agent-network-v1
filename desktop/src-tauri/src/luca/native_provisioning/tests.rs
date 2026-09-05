use super::*;

fn request(mode: AgentProvisioningModeV1) -> NativeProvisioningRequestV1 {
    NativeProvisioningRequestV1 {
        display_name: "Research Helper".into(),
        system_prompt: "Find reliable sources.".into(),
        runtime: NativeRuntimeFamilyV1::Hermes,
        mode,
        source_semantic_id: None,
        selected_skills: Vec::new(),
        include_memory: false,
        workspace_documents: Vec::new(),
    }
}

#[test]
fn slug_is_bounded_and_rejects_reserved_names() {
    assert_eq!(slug_for_name("Research Helper").unwrap(), "research-helper");
    assert!(slug_for_name("main").is_err());
    assert!(slug_for_name("💫").is_err());
}

#[test]
fn fresh_request_rejects_clone_material() {
    let mut input = request(AgentProvisioningModeV1::Fresh);
    input.selected_skills.push("coding".into());
    assert!(normalize_request(input).is_err());
}

#[test]
fn clone_request_requires_a_locally_selected_source() {
    assert!(normalize_request(request(AgentProvisioningModeV1::Template)).is_err());
}

#[test]
fn request_rejects_absolute_paths_and_traversal() {
    let mut input = request(AgentProvisioningModeV1::Advanced);
    input.source_semantic_id = Some("source".into());
    input.workspace_documents = vec!["../.env".into()];
    assert!(normalize_request(input).is_err());
}

#[test]
fn strict_request_rejects_credentials_and_commands_as_fields() {
    for field in ["apiKey", "command", "environment", "nativePath"] {
        let mut value = serde_json::to_value(request(AgentProvisioningModeV1::Fresh)).unwrap();
        value[field] = serde_json::json!("forbidden");
        assert!(serde_json::from_value::<NativeProvisioningRequestV1>(value).is_err());
    }
}

#[test]
fn instructions_preserve_paragraphs_but_reject_control_sequences() {
    let mut input = request(AgentProvisioningModeV1::Fresh);
    input.system_prompt = "Read the project.\n\nReport evidence.\n\tKeep sources.".into();
    assert_eq!(
        normalize_request(input.clone())
            .expect("paragraphs")
            .system_prompt,
        input.system_prompt
    );
    for control in ['\0', '\u{1b}', '\u{7}'] {
        input.system_prompt = format!("Instructions{control}");
        assert!(normalize_request(input.clone()).is_err());
    }
}

#[test]
fn simultaneous_native_mutations_for_one_transaction_are_rejected_and_release_on_exit() {
    let owner = "guard-test-owner";
    let transaction = "guard-test-transaction";
    let held = NativeTransactionGuard::acquire(owner, transaction).expect("first action");
    let concurrent =
        std::thread::spawn(move || NativeTransactionGuard::acquire(owner, transaction).is_err());
    assert!(concurrent.join().expect("concurrent invocation"));
    assert!(NativeTransactionGuard::acquire(owner, "another-transaction").is_ok());
    assert!(NativeTransactionGuard::acquire("another-owner", transaction).is_ok());
    drop(held);
    assert!(NativeTransactionGuard::acquire(owner, transaction).is_ok());
}

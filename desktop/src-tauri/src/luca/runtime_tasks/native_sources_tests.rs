use super::*;
use std::sync::atomic::AtomicBool;
use tempfile::TempDir;

fn scope() -> RuntimeTaskAccessScopeV1 {
    RuntimeTaskAccessScopeV1 {
        owner_pubkey: Hex64::parse("11".repeat(32)).unwrap(),
        resident_pubkey: Hex64::parse("22".repeat(32)).unwrap(),
        session_epoch: luca_protocol::SafeU53::new(9).unwrap(),
        binding_ref: Sha256Ref::parse(format!("sha256:{}", "33".repeat(32))).unwrap(),
        conversation_id: OpaqueId::parse("synthetic-native-lookup-conversation").unwrap(),
        active: Arc::new(AtomicBool::new(true)),
    }
}

struct Fixture {
    _home: TempDir,
    _work: TempDir,
    root: PathBuf,
    work: PathBuf,
    scope: RuntimeTaskAccessScopeV1,
}

impl Fixture {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let work = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".codex/sessions")).unwrap();
        Self {
            root: home.path().join(".codex/sessions").canonicalize().unwrap(),
            work: work.path().canonicalize().unwrap(),
            _home: home,
            _work: work,
            scope: scope(),
        }
    }

    fn issue(
        &self,
        registry: &mut NativeLookupRegistry,
        decision: CapabilityPermissionDecision,
        now: Instant,
    ) -> Result<RuntimeTaskTargetSourceV1, String> {
        let request = permission_request(&self.scope, "codex", &self.root).unwrap();
        registry.issue(
            self.scope.clone(),
            "codex",
            self.root.clone(),
            request.resource,
            decision,
            now,
        )
    }

    fn write_session(&self) -> PathBuf {
        let path = self
            .root
            .join("rollout-synthetic-9ab62e3b-f826-4f2f-8e04-b06975506abc.jsonl");
        std::fs::write(&path, format!("{}\n{}\n", serde_json::json!({
            "type": "session_meta", "payload": {
                "id": "9ab62e3b-f826-4f2f-8e04-b06975506abc",
                "cwd": self.work, "source": "vscode", "originator": "Codex Desktop",
                "base_instructions": {"text": "PRIVATE_BODY_MUST_NOT_LEAK"}
            }
        }), serde_json::json!({"type": "response_item", "payload": {
            "type": "message", "role": "user", "content": [{"type":"input_text", "text":"PRIVATE_BODY_MUST_NOT_LEAK"}]
        }}))).unwrap();
        path
    }
}

fn revalidate(lease: &NativeLookupLease, fixture: &Fixture, now: Instant) -> Result<(), String> {
    lease.revalidate(&fixture.scope, &fixture.root, true, now)
}

#[test]
fn native_listing_works_without_any_brain_store_and_exposes_no_bodies_or_paths() {
    let fixture = Fixture::new();
    let path = fixture.write_session();
    let original = std::fs::read(&path).unwrap();
    let mut registry = NativeLookupRegistry::default();
    let now = Instant::now();
    let source = fixture
        .issue(&mut registry, CapabilityPermissionDecision::AllowOnce, now)
        .unwrap();
    let list =
        targets::list_connected_session_targets(&source, "codex", &HashSet::new(), 20).unwrap();
    assert_eq!(list.candidates.len(), 1);
    registry
        .remember(&fixture.scope, &source.source_id, &list, now)
        .unwrap();
    let lease = registry.get(&source.source_id, now).unwrap();
    assert!(revalidate(&lease, &fixture, now).is_ok());
    assert!(lease
        .listed_sessions
        .contains(list.candidates[0].session_ref.as_str()));
    let target = targets::resolve_connected_session_target(
        &source,
        &list.candidates[0].session_ref,
        "codex",
        None,
        &HashSet::new(),
    )
    .unwrap();
    target.require_codex_app_queue().unwrap();
    let projection = serde_json::json!({
        "source_id": source.source_id, "session_id": list.candidates[0].session_ref,
        "label": list.candidates[0].label, "workspace": list.candidates[0].workspace_basename,
    })
    .to_string();
    assert!(!projection.contains("PRIVATE_BODY_MUST_NOT_LEAK"));
    assert!(!projection.contains(fixture.root.to_str().unwrap()));
    assert!(!projection.contains(fixture.work.to_str().unwrap()));
    assert_eq!(std::fs::read(path).unwrap(), original);
    assert_eq!(std::fs::read_dir(fixture._home.path()).unwrap().count(), 1);
}

#[test]
fn native_lookup_permission_is_routine_filesystem_read_not_retained_brain_access() {
    let fixture = Fixture::new();
    let request = permission_request(&fixture.scope, "codex", &fixture.root).unwrap();
    request.validate().unwrap();
    assert_eq!(request.capability, CapabilityKind::FilesystemRead);
    assert_eq!(request.risk, CapabilityRisk::Routine);
    assert_eq!(request.resident_pubkey, fixture.scope.resident_pubkey);
    assert_eq!(request.session_epoch, fixture.scope.session_epoch);
    assert_eq!(request.conversation_id, fixture.scope.conversation_id);
    assert_eq!(request.resource.kind, "native_session_metadata");
    let encoded = serde_json::to_string(&request).unwrap();
    assert!(!encoded.contains(fixture.root.to_str().unwrap()));
    assert!(!encoded.to_lowercase().contains("brain"));
}

#[test]
fn denied_or_inactive_lookup_creates_no_handle_and_reads_no_session() {
    let fixture = Fixture::new();
    let mut registry = NativeLookupRegistry::default();
    assert!(fixture
        .issue(
            &mut registry,
            CapabilityPermissionDecision::Deny,
            Instant::now()
        )
        .is_err());
    assert!(registry.leases.is_empty());
    fixture.scope.active.store(false, Ordering::Release);
    assert!(fixture
        .issue(
            &mut registry,
            CapabilityPermissionDecision::AllowOnce,
            Instant::now()
        )
        .is_err());
    assert!(registry.leases.is_empty());
    assert_eq!(std::fs::read_dir(&fixture.root).unwrap().count(), 0);
}

#[test]
fn unknown_expired_and_shutdown_handles_fail_without_any_profile_fallback() {
    let fixture = Fixture::new();
    let mut registry = NativeLookupRegistry::default();
    let now = Instant::now();
    let unknown = OpaqueId::parse(format!("{SOURCE_PREFIX}unknown")).unwrap();
    assert!(registry
        .get(&unknown, now)
        .err()
        .unwrap()
        .contains("Refresh native session lookup"));
    let source = fixture
        .issue(&mut registry, CapabilityPermissionDecision::AllowOnce, now)
        .unwrap();
    assert!(registry.get(&source.source_id, now + LOOKUP_TTL).is_err());
    assert!(registry.leases.is_empty());
    let source = fixture
        .issue(&mut registry, CapabilityPermissionDecision::AllowOnce, now)
        .unwrap();
    fixture.scope.active.store(false, Ordering::Release);
    assert!(registry.get(&source.source_id, now).is_err());
    // A restarted process starts with no native-source capabilities.
    assert!(NativeLookupRegistry::default()
        .get(&source.source_id, now)
        .is_err());
}

#[test]
fn native_handles_are_bound_to_owner_resident_epoch_conversation_binding_and_broker() {
    let fixture = Fixture::new();
    let mut registry = NativeLookupRegistry::default();
    let source = fixture
        .issue(
            &mut registry,
            CapabilityPermissionDecision::AllowOnce,
            Instant::now(),
        )
        .unwrap();
    let lease = registry.get(&source.source_id, Instant::now()).unwrap();
    assert!(lease.require_scope(&fixture.scope).is_ok());
    let mut changed = fixture.scope.clone();
    changed.owner_pubkey = Hex64::parse("44".repeat(32)).unwrap();
    assert!(lease.require_scope(&changed).is_err());
    let mut changed = fixture.scope.clone();
    changed.resident_pubkey = Hex64::parse("44".repeat(32)).unwrap();
    assert!(lease.require_scope(&changed).is_err());
    let mut changed = fixture.scope.clone();
    changed.session_epoch = luca_protocol::SafeU53::new(10).unwrap();
    assert!(lease.require_scope(&changed).is_err());
    let mut changed = fixture.scope.clone();
    changed.conversation_id = OpaqueId::parse("other-conversation").unwrap();
    assert!(lease.require_scope(&changed).is_err());
    let mut changed = fixture.scope.clone();
    changed.binding_ref = Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap();
    assert!(lease.require_scope(&changed).is_err());
    let mut changed = fixture.scope.clone();
    changed.active = Arc::new(AtomicBool::new(true));
    assert!(lease.require_scope(&changed).is_err());
}

#[test]
fn native_dispatch_revalidation_rejects_profile_or_binding_change_and_revoked_durable_access() {
    let fixture = Fixture::new();
    let other_profile = tempfile::tempdir().unwrap();
    let mut registry = NativeLookupRegistry::default();
    let now = Instant::now();
    let source = fixture
        .issue(
            &mut registry,
            CapabilityPermissionDecision::AlwaysAllow,
            now,
        )
        .unwrap();
    let lease = registry.get(&source.source_id, now).unwrap();
    assert!(revalidate(&lease, &fixture, now).is_ok());
    assert!(lease
        .revalidate(&fixture.scope, other_profile.path(), true, now,)
        .is_err());
    let mut changed = fixture.scope.clone();
    changed.binding_ref = Sha256Ref::parse(format!("sha256:{}", "44".repeat(32))).unwrap();
    assert!(lease
        .revalidate(&changed, &fixture.root, true, now,)
        .is_err());
    assert!(lease
        .revalidate(&fixture.scope, &fixture.root, false, now,)
        .is_err());
}

#[test]
fn lookup_capacity_and_selected_session_set_remain_bounded() {
    let fixture = Fixture::new();
    let mut registry = NativeLookupRegistry::default();
    let now = Instant::now();
    for _ in 0..MAX_LOOKUPS {
        fixture
            .issue(&mut registry, CapabilityPermissionDecision::AllowOnce, now)
            .unwrap();
    }
    assert!(fixture
        .issue(&mut registry, CapabilityPermissionDecision::AllowOnce, now)
        .is_err());
    assert_eq!(registry.leases.len(), MAX_LOOKUPS);
    assert!(fixture
        .issue(
            &mut registry,
            CapabilityPermissionDecision::AllowOnce,
            now + LOOKUP_TTL
        )
        .is_ok());
    assert_eq!(registry.leases.len(), 1);
    let source = registry.leases.values().next().unwrap().source.clone();
    let list = RuntimeTaskTargetListV1 {
        candidates: vec![],
        truncated: false,
    };
    registry
        .remember(&fixture.scope, &source.source_id, &list, now + LOOKUP_TTL)
        .unwrap();
    assert!(registry
        .get(&source.source_id, now + LOOKUP_TTL)
        .unwrap()
        .require_listed_session(&OpaqueId::parse("model-invented-session").unwrap(),)
        .is_err());
}

#[test]
fn profile_roots_honor_exact_native_overrides_without_scanning_other_profiles() {
    let home = tempfile::tempdir().unwrap();
    let codex = tempfile::tempdir().unwrap();
    let claude = tempfile::tempdir().unwrap();
    for (root, child) in [
        (home.path(), ".codex/sessions"),
        (home.path(), ".claude/projects"),
        (codex.path(), "sessions"),
        (claude.path(), "projects"),
    ] {
        std::fs::create_dir_all(root.join(child)).unwrap();
    }
    assert_eq!(
        resolve_profile_root("codex", Some(home.path()), None).unwrap(),
        home.path().join(".codex/sessions").canonicalize().unwrap()
    );
    assert_eq!(
        resolve_profile_root("claude_code", Some(home.path()), None).unwrap(),
        home.path().join(".claude/projects").canonicalize().unwrap()
    );
    assert_eq!(
        resolve_profile_root("codex", Some(home.path()), Some(codex.path())).unwrap(),
        codex.path().join("sessions").canonicalize().unwrap()
    );
    assert_eq!(
        resolve_profile_root("claude_code", Some(home.path()), Some(claude.path())).unwrap(),
        claude.path().join("projects").canonicalize().unwrap()
    );
    assert!(resolve_profile_root(
        "codex",
        Some(home.path()),
        Some(Path::new("relative-profile"))
    )
    .is_err());
    let absent = home.path().join("absent-profile");
    assert!(resolve_profile_root("codex", Some(home.path()), Some(&absent)).is_err());
    assert!(resolve_profile_root("other", Some(home.path()), None).is_err());
}

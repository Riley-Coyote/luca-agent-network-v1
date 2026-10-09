use super::*;

#[tokio::test]
#[ignore = "explicit native model use: POLYPHONIC_CODEX_INITIATIVE_SMOKE_ADAPTER required"]
async fn scoped_codex_native_private_roundtrip() {
    let command = std::env::var("POLYPHONIC_CODEX_INITIATIVE_SMOKE_ADAPTER")
        .expect("explicit installed adapter");
    assert!(std::path::Path::new(&command).is_absolute());
    let now = chrono::Utc::now();
    let now_ms = u64::try_from(now.timestamp_millis()).unwrap();
    let mut request = pool::initiative_pursuit_tests::request();
    request.admitted_at = luca_protocol::CanonicalTimestamp::parse(
        now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
    .unwrap();
    request.deadline_unix_ms = luca_protocol::SafeU53::new(now_ms + 120_000).unwrap();
    request.semantic_thread.body="A synthetic private curiosity: explore a small tabletop garden that feels inviting rather than like another chore. A self-contained scratch experiment or an authored note is welcome; no external work or obligation to make a gift.".into();
    request.thread.canonical_revision_ref = request.semantic_thread.revision_ref().unwrap();
    request.max_result_bytes = luca_protocol::SafeU53::new(24_576).unwrap();
    let source = PromptSource::Continuity(Box::new(
        ResidentPrivateCognitionRequestV1::InitiativePursuit { request },
    ));
    let spawn = CodexContinuitySpawnSpec {
        command,
        args: Vec::new(),
        extra_env: vec![(
            "CODEX_CONFIG".into(),
            "{\"sandbox_workspace_write\":{\"network_access\":true}}".into(),
        )],
        has_generated_codex_config: true,
        observer: None,
        cwd: std::env::temp_dir().to_string_lossy().into(),
    };
    let binding = CodexContinuityWorkerBinding {
        index: 0,
        desired_model: None,
        desired_permission_mode: None,
        model_overridden: false,
    };
    let scratch = Scratch::create().unwrap();
    let mut native = Native::spawn(&spawn, &scratch).unwrap();
    let PromptSource::Continuity(request) = source else {
        unreachable!()
    };
    let result=tokio::time::timeout(Duration::from_secs(180),execute(&mut native,&scratch,&binding,&request,Some("You are a synthetic private Polyphonic assay resident, not the user's Luca. Do not claim personal history or access."))).await;
    let reaped = native.stop().await;
    assert!(reaped, "owned native worker must be reaped");
    std::fs::remove_dir_all(&scratch.root).unwrap();
    match result {Ok(Ok(_))=>println!("Scoped Codex native private outcome verified; owned workspace; ephemeral thread; exact result correlation."),Ok(Err(error))=>panic!("Scoped native assay failed: {error}"),Err(_)=>panic!("Scoped native assay timed out")}
}

#[test]
fn scoped_profile_has_no_root_read_network_or_inherited_workspace() {
    let scratch = Scratch {
        root: PathBuf::from("/private/tmp/owned-test"),
        work: PathBuf::from("/private/tmp/owned-test/work"),
    };
    let profile = profile(&scratch).unwrap();
    assert_eq!(profile["filesystem"][":root"], "deny");
    assert_eq!(profile["filesystem"][":minimal"], "read");
    assert_eq!(
        profile["filesystem"][scratch.work.to_str().unwrap()],
        "write"
    );
    assert_eq!(profile["network"]["enabled"], false);
    assert!(profile.get("extends").is_none());
    let encoded = toml_json(&profile).unwrap();
    let parsed = toml::from_str::<toml::Table>(&format!("profile={encoded}")).unwrap();
    assert!(parsed.contains_key("profile"));
    assert!(toml_json(&serde_json::json!({"unsafe":null})).is_err());
}

#[test]
fn scoped_prompt_preserves_correlation_and_does_not_claim_tool_free_or_outside_research() {
    let request = pool::initiative_pursuit_tests::request();
    let native = ResidentPrivateCognitionRequestV1::InitiativePursuit {
        request: request.clone(),
    };
    let text = scoped_prompt(&native, pool::initiative_planning_tests::admitted_ms()).unwrap();
    assert!(text.contains("self-contained work"));
    assert!(text.contains("No scratch file is automatically retained"));
    assert!(text.contains(request.job_id.as_str()));
    assert!(text.contains("canonical_revision_ref"));
    assert!(!text.contains("tool-free"));
    assert!(scoped_prompt(&native, request.deadline_unix_ms.get()).is_err());
}

#[test]
fn valid_native_result_still_needs_exact_job_epoch_binding_and_deadline() {
    let request = pool::initiative_pursuit_tests::request();
    let native = ResidentPrivateCognitionRequestV1::InitiativePursuit {
        request: request.clone(),
    };
    let output = serde_json::to_string(&pool::initiative_pursuit_tests::result(&request)).unwrap();
    validate_output(
        &native,
        &output,
        pool::initiative_planning_tests::admitted_ms(),
    )
    .unwrap();
    assert!(validate_output(&native, &output, request.deadline_unix_ms.get()).is_err());
    let mut wrong = request;
    wrong.binding_ref =
        luca_protocol::Sha256Ref::parse(format!("sha256:{}", "f".repeat(64))).unwrap();
    assert!(validate_output(
        &ResidentPrivateCognitionRequestV1::InitiativePursuit { request: wrong },
        &output,
        pool::initiative_planning_tests::admitted_ms()
    )
    .is_err());
}

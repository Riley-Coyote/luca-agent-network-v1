use luca_diagnostics::{classify_sensitive_content, redact_diagnostic, SensitiveClass};

#[test]
fn redacts_synthetic_secret_body_and_path_without_preserving_any_value() {
    let input = concat!(
        "provider=LUCATEST_PROVIDER_SENTINEL_DO_NOT_LOG ",
        "body=LUCATEST_PROTECTED_BODY_SENTINEL_DO_NOT_LOG ",
        "path=LUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL_DO_NOT_LOG"
    );

    let (redacted, summary) = redact_diagnostic(input);

    assert!(!redacted.contains("LUCATEST_"));
    assert!(redacted.contains("[REDACTED:secret]"));
    assert!(redacted.contains("[REDACTED:protected_body]"));
    assert!(redacted.contains("[REDACTED:absolute_path]"));
    assert_eq!(summary.secret_count, 1);
    assert_eq!(summary.protected_body_count, 1);
    assert_eq!(summary.absolute_path_count, 1);
}

#[test]
fn detects_real_shape_secrets_and_absolute_paths_without_exposing_them() {
    let input = concat!(
        "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq ",
        "api_key=synthetic-not-a-real-provider-credential ",
        "file=/Users/example/project/private-note.txt"
    );

    let (redacted, summary) = redact_diagnostic(input);

    assert!(!redacted.contains("nsec1"));
    assert!(!redacted.contains("synthetic-not-a-real-provider-credential"));
    assert!(!redacted.contains("/Users/example"));
    assert_eq!(summary.secret_count, 2);
    assert_eq!(summary.absolute_path_count, 1);
}

#[test]
fn classification_is_stable_and_ordered_by_source_position() {
    let classes = classify_sensitive_content(concat!(
        "LUCATEST_PROTECTED_BODY_SENTINEL_DO_NOT_LOG ",
        "LUCATEST_NSEC_SENTINEL_DO_NOT_LOG ",
        "LUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL_DO_NOT_LOG"
    ));
    assert_eq!(
        classes,
        vec![
            SensitiveClass::ProtectedBody,
            SensitiveClass::Secret,
            SensitiveClass::AbsolutePath,
        ]
    );
}

#[test]
fn exact_legacy_and_provider_assignment_corpus_matches_the_scanner_contract() {
    let corpus: serde_json::Value = serde_json::from_str(include_str!(
        "../../../fixtures/luca/secrets/credential-assignment-corpus.json"
    ))
    .expect("credential assignment corpus must be valid JSON");
    let cases = corpus["cases"]
        .as_array()
        .expect("corpus cases must be an array");

    for case in cases {
        let input = case["input"].as_str().expect("case input must be text");
        let expected = case["classification"]
            .as_str()
            .expect("case classification must be text");
        let observed = classify_sensitive_content(input);
        match expected {
            "secret" => assert_eq!(observed, vec![SensitiveClass::Secret], "{input}"),
            "none" => assert!(observed.is_empty(), "{input}"),
            unexpected => panic!("unsupported corpus classification: {unexpected}"),
        }
    }
}

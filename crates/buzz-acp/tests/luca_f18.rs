//! Cross-artifact secret-safe diagnostic and sentinel scanner proof for Luca V1.

use luca_diagnostics::{redact_diagnostic, SensitiveClass};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("buzz-acp crate is nested under the repository root")
        .to_path_buf()
}

fn run_scanner(root: &str, expectation: &str, output_name: &str) -> Value {
    let repository = repository_root();
    let output = std::env::temp_dir().join(format!(
        "luca-f18-{}-{}-{}.json",
        std::process::id(),
        output_name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must be after epoch")
            .as_nanos()
    ));
    let status = Command::new("python3")
        .current_dir(&repository)
        .args([
            "scripts/evidence/scan_artifacts.py",
            "--root",
            root,
            "--output",
        ])
        .arg(&output)
        .args(["--expect", expectation])
        .status()
        .expect("Python artifact scanner must be runnable");
    assert!(status.success(), "artifact scanner invocation must pass");
    let report = std::fs::read_to_string(&output).expect("scanner report must exist");
    std::fs::remove_file(&output).expect("temporary scanner report must be removable");
    serde_json::from_str(&report).expect("scanner report must be JSON")
}

#[test]
fn luca_f18_synthetic_sentinels_are_detected_without_disclosing_values_or_paths() {
    let report = run_scanner("fixtures/luca/secrets", "findings", "sentinels");
    assert_eq!(report["schema"], "luca.artifact-scanner.v1");
    assert_eq!(report["status"], "PASS");
    assert_eq!(report["mode"], "findings");
    let findings = report["findings"]
        .as_array()
        .expect("findings must be an array");
    assert_eq!(
        findings.len(),
        4,
        "each synthetic class must be detected once"
    );
    let classes: Vec<_> = findings
        .iter()
        .map(|finding| {
            finding["classification"]
                .as_str()
                .expect("class must be text")
        })
        .collect();
    assert!(classes.contains(&"secret"));
    assert!(classes.contains(&"protected_body"));
    assert!(classes.contains(&"absolute_path"));
    let serialized = serde_json::to_string(&report).expect("report must serialize");
    assert!(!serialized.contains("LUCATEST_"));
    assert!(!serialized.contains("fixtures/luca/secrets"));
    assert!(!serialized.contains("/Users/"));
}

#[test]
fn luca_f18_clean_public_fixture_artifacts_pass_the_gate_scan() {
    let report = run_scanner("fixtures/luca/residents", "clean", "clean");
    assert_eq!(report["status"], "PASS");
    assert!(report["findings"]
        .as_array()
        .expect("findings must be an array")
        .is_empty());
}

#[test]
fn luca_f18_redaction_never_returns_matched_secret_or_protected_body() {
    let input = concat!(
        "LUCATEST_NSEC_SENTINEL_DO_NOT_LOG ",
        "LUCATEST_PROTECTED_BODY_SENTINEL_DO_NOT_LOG ",
        "LUCATEST_ABSOLUTE_SOURCE_PATH_SENTINEL_DO_NOT_LOG"
    );
    let (redacted, summary) = redact_diagnostic(input);
    assert!(!redacted.contains("LUCATEST_"));
    assert_eq!(summary.secret_count, 1);
    assert_eq!(summary.protected_body_count, 1);
    assert_eq!(summary.absolute_path_count, 1);
    assert_eq!(SensitiveClass::Secret.as_str(), "secret");
}

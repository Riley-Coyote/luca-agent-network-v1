//! Cross-artifact secret-safe diagnostic and sentinel scanner proof for Luca V1.

use luca_diagnostics::{redact_diagnostic, SensitiveClass};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|path| path.parent())
        .expect("buzz-acp crate is nested under the repository root")
        .to_path_buf()
}

fn temporary_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "luca-f18-{}-{}-{}",
        std::process::id(),
        label,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock must be after epoch")
            .as_nanos()
    ))
}

fn scanner_output(root: &Path, expectation: &str, output_name: &str) -> (PathBuf, Output) {
    let repository = repository_root();
    let output = temporary_path(output_name).with_extension("json");
    let process = Command::new("python3")
        .current_dir(&repository)
        .args(["scripts/evidence/scan_artifacts.py", "--root"])
        .arg(root)
        .arg("--output")
        .arg(&output)
        .args(["--expect", expectation])
        .output()
        .expect("Python artifact scanner must be runnable");
    (output, process)
}

fn run_scanner(root: &Path, expectation: &str, output_name: &str) -> Value {
    let (output, process) = scanner_output(root, expectation, output_name);
    assert!(
        process.status.success(),
        "artifact scanner invocation must pass: {}",
        String::from_utf8_lossy(&process.stderr)
    );
    let report = std::fs::read_to_string(&output).expect("scanner report must exist");
    std::fs::remove_file(&output).expect("temporary scanner report must be removable");
    serde_json::from_str(&report).expect("scanner report must be JSON")
}

#[test]
fn luca_f18_synthetic_sentinels_are_detected_without_disclosing_values_or_paths() {
    let root = repository_root().join("fixtures/luca/secrets");
    let report = run_scanner(&root, "findings", "sentinels");
    assert_eq!(report["schema"], "luca.artifact-scanner.v1");
    assert_eq!(report["status"], "PASS");
    assert_eq!(report["mode"], "findings");
    let findings = report["findings"]
        .as_array()
        .expect("findings must be an array");
    assert!(findings.len() >= 4, "each synthetic class must be detected");
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
    let root = repository_root().join("fixtures/luca/residents");
    let report = run_scanner(&root, "clean", "clean");
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

#[test]
fn luca_f18_scan_local_ids_are_not_content_hash_oracles() {
    let root_a = temporary_path("opaque-a");
    let root_b = temporary_path("opaque-b");
    std::fs::create_dir_all(&root_a).expect("first temporary root must be created");
    std::fs::create_dir_all(&root_b).expect("second temporary root must be created");
    std::fs::write(
        root_a.join("candidate.txt"),
        "OPENAI_API_KEY=LUCATEST_PROVIDER_SENTINEL_DO_NOT_LOG",
    )
    .expect("first candidate must be written");
    std::fs::write(
        root_b.join("candidate.txt"),
        "OPENAI_API_KEY=LUCATEST_SECRET_SENTINEL_DO_NOT_LOG",
    )
    .expect("second candidate must be written");

    let first = run_scanner(&root_a, "findings", "opaque-a");
    let second = run_scanner(&root_b, "findings", "opaque-b");
    let first_ref = first["findings"][0]["artifact_ref"]
        .as_str()
        .expect("first artifact ref must be text");
    let second_ref = second["findings"][0]["artifact_ref"]
        .as_str()
        .expect("second artifact ref must be text");
    assert_eq!(first_ref, "scan-artifact:000001");
    assert_eq!(second_ref, "scan-artifact:000001");
    assert!(!first_ref.starts_with("sha256:"));
    std::fs::remove_dir_all(&root_a).expect("first temporary root must be removed");
    std::fs::remove_dir_all(&root_b).expect("second temporary root must be removed");
}

#[test]
fn luca_f18_scanner_rejects_empty_and_symlinked_roots_without_path_disclosure() {
    let root = temporary_path("safe-root");
    let outside = temporary_path("outside");
    std::fs::create_dir_all(&root).expect("temporary root must be created");
    std::fs::create_dir_all(&outside).expect("outside root must be created");
    std::fs::write(
        outside.join("sentinel.txt"),
        "LUCATEST_NSEC_SENTINEL_DO_NOT_LOG",
    )
    .expect("outside sentinel must be written");

    let (empty_output, empty) = scanner_output(&root, "clean", "empty");
    assert!(!empty.status.success());
    assert!(!empty_output.exists());
    assert_safe_failure(&empty, &root);

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let external_link = root.join("external-link");
        symlink(outside.join("sentinel.txt"), &external_link)
            .expect("outside link must be created");
        let (linked_output, linked) = scanner_output(&root, "findings", "external-link");
        assert!(!linked.status.success());
        assert!(!linked_output.exists());
        assert_safe_failure(&linked, &root);
        std::fs::remove_file(external_link).expect("external link must be removed");

        let broken_link = root.join("broken-link");
        symlink(root.join("missing-target"), &broken_link).expect("broken link must be created");
        let (broken_output, broken) = scanner_output(&root, "clean", "broken-link");
        assert!(!broken.status.success());
        assert!(!broken_output.exists());
        assert_safe_failure(&broken, &root);
        std::fs::remove_file(broken_link).expect("broken link must be removed");

        let root_link = temporary_path("root-link");
        symlink(&outside, &root_link).expect("root link must be created");
        let (root_link_output, root_link_process) =
            scanner_output(&root_link, "findings", "root-link");
        assert!(!root_link_process.status.success());
        assert!(!root_link_output.exists());
        assert_safe_failure(&root_link_process, &root_link);
        std::fs::remove_file(root_link).expect("root link must be removed");
    }

    std::fs::remove_dir_all(&root).expect("temporary root must be removed");
    std::fs::remove_dir_all(&outside).expect("outside root must be removed");
}

#[test]
fn luca_f18_scanner_detects_the_exact_legacy_and_provider_assignment_corpus() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../fixtures/luca/secrets/credential-assignment-corpus.json"
    ))
    .expect("credential assignment corpus must be valid JSON");
    for (index, case) in corpus["cases"]
        .as_array()
        .expect("corpus cases must be an array")
        .iter()
        .enumerate()
    {
        let root = temporary_path(&format!("corpus-{index}"));
        std::fs::create_dir_all(&root).expect("temporary corpus root must be created");
        std::fs::write(
            root.join("candidate.txt"),
            case["input"].as_str().expect("corpus input must be text"),
        )
        .expect("corpus case must be written");
        let expected = case["classification"]
            .as_str()
            .expect("corpus classification must be text");
        let report = run_scanner(
            &root,
            if expected == "secret" {
                "findings"
            } else {
                "clean"
            },
            &format!("corpus-{index}"),
        );
        let findings = report["findings"]
            .as_array()
            .expect("findings must be an array");
        if expected == "secret" {
            assert_eq!(findings.len(), 1, "case {index}");
            assert_eq!(findings[0]["classification"], "secret", "case {index}");
        } else {
            assert!(findings.is_empty(), "case {index}");
        }
        std::fs::remove_dir_all(&root).expect("temporary corpus root must be removed");
    }
}

#[test]
fn luca_f18_output_failures_are_path_safe_and_do_not_leave_a_report() {
    let root = repository_root().join("fixtures/luca/residents");
    let blocked_parent = temporary_path("blocked-output-parent");
    std::fs::write(&blocked_parent, "not a directory").expect("blocked parent must be written");
    let destination = blocked_parent.join("report.json");
    let repository = repository_root();
    let output = Command::new("python3")
        .current_dir(&repository)
        .args(["scripts/evidence/scan_artifacts.py", "--root"])
        .arg(&root)
        .arg("--output")
        .arg(&destination)
        .args(["--expect", "clean"])
        .output()
        .expect("scanner must be runnable");
    assert!(!output.status.success());
    assert!(!destination.exists());
    assert_safe_failure(&output, &blocked_parent);
    std::fs::remove_file(blocked_parent).expect("blocked parent must be removed");

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let output_root = temporary_path("symlink-output-root");
        std::fs::create_dir_all(&output_root).expect("output root must be created");
        let protected_target = output_root.join("protected-target.json");
        std::fs::write(&protected_target, "unchanged").expect("target must be written");
        let linked_destination = output_root.join("linked-report.json");
        symlink(&protected_target, &linked_destination).expect("destination link must be created");
        let linked = Command::new("python3")
            .current_dir(&repository)
            .args(["scripts/evidence/scan_artifacts.py", "--root"])
            .arg(&root)
            .arg("--output")
            .arg(&linked_destination)
            .args(["--expect", "clean"])
            .output()
            .expect("scanner must be runnable");
        assert!(!linked.status.success());
        assert_eq!(
            std::fs::read_to_string(&protected_target).expect("target must stay readable"),
            "unchanged"
        );
        assert_safe_failure(&linked, &output_root);
        std::fs::remove_file(linked_destination).expect("destination link must be removed");
        std::fs::remove_dir_all(output_root).expect("output root must be removed");

        let actual_parent = temporary_path("actual-output-parent");
        std::fs::create_dir_all(&actual_parent).expect("actual parent must be created");
        let linked_parent = temporary_path("linked-output-parent");
        symlink(&actual_parent, &linked_parent).expect("parent link must be created");
        let parent_linked = Command::new("python3")
            .current_dir(&repository)
            .args(["scripts/evidence/scan_artifacts.py", "--root"])
            .arg(&root)
            .arg("--output")
            .arg(linked_parent.join("report.json"))
            .args(["--expect", "clean"])
            .output()
            .expect("scanner must be runnable");
        assert!(!parent_linked.status.success());
        assert!(!actual_parent.join("report.json").exists());
        assert_safe_failure(&parent_linked, &linked_parent);
        std::fs::remove_file(linked_parent).expect("parent link must be removed");
        std::fs::remove_dir_all(actual_parent).expect("actual parent must be removed");
    }
}

fn assert_safe_failure(output: &Output, prohibited_path: &Path) {
    let rendered = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!rendered.contains("Traceback"));
    assert!(!rendered.contains(&prohibited_path.display().to_string()));
    assert!(rendered.contains("FAIL: artifact-scan"));
}

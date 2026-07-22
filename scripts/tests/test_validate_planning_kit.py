#!/usr/bin/env python3
"""Executable tests for Luca planning-kit gate evidence validation."""

from __future__ import annotations

from pathlib import Path
import hashlib
import importlib.util
import json
import shutil
import tempfile
import unittest

import yaml


SCRIPT = Path(__file__).resolve().parents[1] / "validate_planning_kit.py"
SPEC = importlib.util.spec_from_file_location("validate_planning_kit", SCRIPT)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)

CANDIDATE = validator.G0_CANDIDATE


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashed(root: Path, path: Path, **extra: str) -> dict:
    return {"path": path.relative_to(root).as_posix(), "sha256": digest(path), **extra}


def build_g0_fixture(root: Path) -> Path:
    gate_dir = root / "gates" / "G0"
    structural_log = gate_dir / "structural.log"
    unit_log = gate_dir / "validator-unit.log"
    feasibility_files = [root / relative for relative in validator.G0_PROOF_EVIDENCE_BINDINGS["feasibility"]]
    architecture_review = root / "reviews" / "ARCHITECTURE_PASS.md"
    graph_review = root / "reviews" / "GRAPH_PASS.md"
    routing_review = root / "reviews" / "ROUTING_PASS.md"
    scan_file = gate_dir / "artifact-secret-scan.json"
    review_file = gate_dir / "review.json"
    environment_file = gate_dir / "environment.json"
    index_file = gate_dir / "M0_evidence_index.json"
    limits_file = gate_dir / "known_limits.json"
    results_file = gate_dir / "results.json"
    write_text(structural_log, "planning kit valid\n")
    write_text(unit_log, "validator tests pass\n")
    for position, path in enumerate(feasibility_files):
        write_text(path, f"canonical feasibility evidence {position}\n")
    write_text(architecture_review, "architecture pass\n")
    write_text(graph_review, "graph pass\n")
    write_text(routing_review, "routing pass\n")
    sources = [dict(record) for record in validator.G0_SOURCE_COORDINATES]
    write_json(
        environment_file,
        {
            "schema": "luca.evidence.environment.v1",
            "candidate_commit": CANDIDATE,
            "captured_at": "2026-07-22T00:00:00Z",
            "sources": sources,
            "topology": {"mode": "planning-only"},
            "tool_versions": {"python": "test"},
        },
    )
    write_json(
        index_file,
        {
            "schema": "luca.evidence.m0-index.v1",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "sources": sources,
            "artifacts": [hashed(root, path) for path in feasibility_files],
        },
    )
    write_json(
        limits_file,
        {
            "schema": "luca.evidence.known-limits.v1",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "limits": [
                {
                    "id": "keep-thinking-excluded",
                    "title": "Keep Thinking excluded",
                    "impact": "No ambient cognition in V1",
                    "disposition": "Release 2",
                }
            ],
        },
    )
    write_json(
        scan_file,
        {
            "schema": "luca.evidence.artifact-scan.v1",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "scanned": ["M0 reports", "planning kit"],
            "findings": [],
        },
    )
    write_json(
        review_file,
        {
            "schema": "luca.evidence.review.v1",
            "subject_type": "gate",
            "subject_id": "G0",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "reviewer": {"id": "g0-reviewer", "independence_group": "review:g0"},
            "independent_of": ["g0-integrator"],
            "findings": [],
        },
    )
    proof_entries = []
    proof_sources = {
        "source_truth": [index_file, gate_dir / "source-state.log"],
        "feasibility": feasibility_files,
        "contract_completeness": [
            structural_log, unit_log, architecture_review, graph_review, routing_review
        ],
    }
    write_text(gate_dir / "source-state.log", "canonical source state\n")
    for proof_id in ("source_truth", "feasibility", "contract_completeness"):
        proof_file = gate_dir / f"{proof_id}.json"
        write_json(
            proof_file,
            {
                "schema": "luca.evidence.proof.v1",
                "proof_id": proof_id,
                "candidate_commit": CANDIDATE,
                "status": "PASS",
                "acceptance_assertions": validator.G0_PROOF_ASSERTIONS[proof_id],
                "mapped_tasks": [],
                "evidence": [hashed(root, path) for path in proof_sources[proof_id]],
            },
        )
        proof_entries.append({"proof_id": proof_id, "status": "PASS", "evidence": [hashed(root, proof_file)]})
    capsule = next(
        item for item in validator.load_yaml(validator.ROOT / "TASK_CAPSULE_CATALOG.yaml")["task_capsules"]
        if item["id"] == "G0"
    )
    test_logs = [
        hashed(root, structural_log, name="structure", command=capsule["tests"][0], status="PASS"),
        hashed(root, unit_log, name="validator-unit", command=capsule["tests"][1], status="PASS"),
    ]
    write_json(
        results_file,
        {
            "schema": "luca.evidence.g0-result.v1",
            "task": "G0",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "executor": {"id": "g0-integrator", "independence_group": "integration:M0"},
            "outputs": [
                hashed(root, index_file, name="M0_evidence_index"),
                hashed(root, limits_file, name="known_limits"),
            ],
            "test_logs": test_logs,
            "artifact_scan": hashed(root, scan_file),
        },
    )
    write_json(
        gate_dir / "gate-verdict.json",
        {
            "schema": "luca.evidence.gate-verdict.v1",
            "gate": "G0",
            "candidate_commit": CANDIDATE,
            "status": "PASS",
            "candidate_author": {"id": "g0-integrator", "independence_group": "integration:M0"},
            "dependency_gate_receipts": [],
            "task_results": [],
            "task_reviews": [],
            "proofs": proof_entries,
            "test_logs": [hashed(root, structural_log, name="m0-baseline", status="PASS")],
            "artifact_scan": hashed(root, scan_file),
            "review": hashed(root, review_file),
            "open_findings": [],
            "known_limits": ["keep-thinking-excluded"],
        },
    )
    return gate_dir


class GateEvidenceTests(unittest.TestCase):
    def test_synthetic_g0_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build_g0_fixture(root)
            self.assertEqual([], validator.validate_gate_evidence("G0", CANDIDATE, root))

    def test_hash_tamper_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate_dir = build_g0_fixture(root)
            (gate_dir / "structural.log").write_text("tampered after verdict\n")
            errors = validator.validate_gate_evidence("G0", CANDIDATE, root)
            self.assertTrue(any("hash mismatch" in error for error in errors), errors)

    def test_missing_g0_contract_file_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate_dir = build_g0_fixture(root)
            (gate_dir / "M0_evidence_index.json").unlink()
            errors = validator.validate_gate_evidence("G0", CANDIDATE, root)
            self.assertTrue(any("M0_evidence_index.json" in error for error in errors), errors)

    def test_arbitrary_proof_blob_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate_dir = build_g0_fixture(root)
            proof_path = gate_dir / "source_truth.json"
            write_json(proof_path, {"candidate_commit": CANDIDATE, "status": "PASS"})
            verdict_path = gate_dir / "gate-verdict.json"
            verdict = json.loads(verdict_path.read_text())
            verdict["proofs"][0]["evidence"][0]["sha256"] = digest(proof_path)
            write_json(verdict_path, verdict)
            errors = validator.validate_gate_evidence("G0", CANDIDATE, root)
            self.assertTrue(any("proof source_truth" in error for error in errors), errors)

    def test_unrelated_rehashed_feasibility_evidence_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate_dir = build_g0_fixture(root)
            proof_path = gate_dir / "feasibility.json"
            proof = json.loads(proof_path.read_text())
            proof["evidence"] = [hashed(root, gate_dir / "structural.log")]
            write_json(proof_path, proof)
            verdict_path = gate_dir / "gate-verdict.json"
            verdict = json.loads(verdict_path.read_text())
            feasibility = next(item for item in verdict["proofs"] if item["proof_id"] == "feasibility")
            feasibility["evidence"][0]["sha256"] = digest(proof_path)
            write_json(verdict_path, verdict)
            errors = validator.validate_gate_evidence("G0", CANDIDATE, root)
            self.assertTrue(any("proof feasibility: evidence bindings" in error for error in errors), errors)

    def test_fabricated_zero_commit_source_chain_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            gate_dir = build_g0_fixture(root)
            environment_path = gate_dir / "environment.json"
            index_path = gate_dir / "M0_evidence_index.json"
            for path in (environment_path, index_path):
                document = json.loads(path.read_text())
                document["sources"][2] = {
                    "name": "fabricated_repo",
                    "path": "/tmp/fabricated-repo",
                    "commit": "0" * 40,
                    "dirty_entries": 0,
                    "status": "clean",
                }
                write_json(path, document)

            source_truth_path = gate_dir / "source_truth.json"
            source_truth = json.loads(source_truth_path.read_text())
            source_truth["evidence"][0]["sha256"] = digest(index_path)
            write_json(source_truth_path, source_truth)

            results_path = gate_dir / "results.json"
            results = json.loads(results_path.read_text())
            index_output = next(item for item in results["outputs"] if item["name"] == "M0_evidence_index")
            index_output["sha256"] = digest(index_path)
            write_json(results_path, results)

            verdict_path = gate_dir / "gate-verdict.json"
            verdict = json.loads(verdict_path.read_text())
            source_truth_ref = next(item for item in verdict["proofs"] if item["proof_id"] == "source_truth")
            source_truth_ref["evidence"][0]["sha256"] = digest(source_truth_path)
            write_json(verdict_path, verdict)

            errors = validator.validate_gate_evidence("G0", CANDIDATE, root)
            self.assertTrue(any("named source set mismatch" in error for error in errors), errors)

    def test_wrong_named_task_output_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "repo"
            evidence = repo / "evidence"
            implementation = repo / "src" / "impl.rs"
            output = evidence / "M1" / "T1" / "outputs" / "real_output.json"
            log = evidence / "M1" / "T1" / "test.log"
            scan = evidence / "M1" / "T1" / "artifact-secret-scan.json"
            result = evidence / "M1" / "T1" / "results.json"
            write_text(implementation, "fn implemented() {}\n")
            write_text(log, "pass\n")
            write_json(
                scan,
                {
                    "schema": "luca.evidence.artifact-scan.v1",
                    "candidate_commit": CANDIDATE,
                    "status": "PASS",
                    "scanned": ["test"],
                    "findings": [],
                },
            )
            write_json(
                output,
                {
                    "schema": "luca.evidence.output.v1",
                    "task": "T1",
                    "name": "real_output",
                    "candidate_commit": CANDIDATE,
                    "declared_implementation_paths": ["src/impl.rs"],
                    "implementation_refs": [hashed(repo, implementation)],
                },
            )
            capsule = {
                "tests": ["test command"],
                "output_bindings": [
                    {
                        "name": "real_output",
                        "path": "evidence/M1/T1/outputs/real_output.json",
                        "implementation_paths": ["src/impl.rs"],
                    }
                ],
            }
            write_json(
                result,
                {
                    "schema": "luca.evidence.result.v1",
                    "task": "T1",
                    "candidate_commit": CANDIDATE,
                    "status": "PASS",
                    "executor": {"id": "worker", "independence_group": "implementation:T1"},
                    "outputs": [hashed(evidence, output, name="dummy_output")],
                    "test_logs": [hashed(evidence, log, name="test", command="test command", status="PASS")],
                    "artifact_scan": hashed(evidence, scan),
                },
            )
            errors: list[str] = []
            validator.validate_result_document(result, "T1", CANDIDATE, evidence, capsule, repo, errors)
            self.assertTrue(any("unknown output name" in error for error in errors), errors)

    def test_rehashed_routing_drift_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            copy = Path(temporary) / "kit"
            shutil.copytree(
                validator.ROOT,
                copy,
                ignore=shutil.ignore_patterns(
                    "G0_EVIDENCE", "M0_EVIDENCE", "evidence", "REVIEWS",
                    "__pycache__", "*.pyc",
                ),
            )
            graph_path = copy / "TASK_GRAPH.yaml"
            catalog_path = copy / "TASK_CAPSULE_CATALOG.yaml"
            graph = validator.load_yaml(graph_path)
            catalog = validator.load_yaml(catalog_path)
            task = next(item for item in graph["tasks"] if item["id"] == "F18")
            capsule = next(item for item in catalog["task_capsules"] if item["id"] == "F18")
            task["model"] = capsule["model"] = "gpt-5.6-sol"
            graph_path.write_text(yaml.safe_dump(graph, sort_keys=False, width=110))
            catalog_path.write_text(yaml.safe_dump(catalog, sort_keys=False, width=120))
            errors = validator.validate_structure(copy)
            self.assertTrue(
                any("execution routing count mismatch" in error for error in errors),
                errors,
            )

    def test_review_session_cannot_author_implementation(self) -> None:
        implementation_identity = {
            "id": "milestone-reviewer",
            "independence_group": "review:M1",
        }
        errors: list[str] = []
        validator.validate_milestone_independence(
            {"F01": {"executor_role": "bounded_worker"}},
            {"F01": {"executor": implementation_identity}},
            {
                "F01": {
                    "reviewer": implementation_identity,
                }
            },
            {"id": "integrator", "independence_group": "integration:M1"},
            {
                "reviewer": {"id": "gate-judge", "independence_group": "gate:M1"},
                "independent_of": ["integrator", "milestone-reviewer"],
            },
            "gate verdict G1",
            errors,
        )
        self.assertTrue(any("also authored implementation result F01" in error for error in errors), errors)

    def test_ultra_gate_reviewer_must_cover_and_differ_from_all_participants(self) -> None:
        errors: list[str] = []
        validator.validate_milestone_independence(
            {"F01": {"executor_role": "bounded_worker"}},
            {
                "F01": {
                    "executor": {"id": "worker", "independence_group": "implementation:M1"}
                }
            },
            {
                "F01": {
                    "reviewer": {"id": "reviewer", "independence_group": "review:M1"}
                }
            },
            {"id": "integrator", "independence_group": "integration:M1"},
            {
                "reviewer": {"id": "gate-judge", "independence_group": "review:M1"},
                "independent_of": ["integrator", "worker"],
            },
            "gate verdict G1",
            errors,
        )
        self.assertTrue(any("not independent" in error for error in errors), errors)
        self.assertTrue(any("omits milestone participants ['reviewer']" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()


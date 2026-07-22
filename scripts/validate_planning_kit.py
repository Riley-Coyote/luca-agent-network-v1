#!/usr/bin/env python3
"""Fail-closed structural and executable-evidence validation for Luca V1."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
import argparse
import collections
import fnmatch
import hashlib
import json
import re
import sys
from typing import Any, Iterable

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
ROOT = REPO_ROOT / ".codex" / "luca-v1"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
WILDCARD_RE = re.compile(r"[*?[]")
PASS = "PASS"
G0_CANDIDATE = "7e34bee62cacaa9d8a96c14d5892a471b59a1983"
G0_PROOF_ASSERTIONS = {
    "source_truth": ["Exact source commits, source preservation state and named baseline exceptions are recorded."],
    "feasibility": ["Buzz conversation/agent seams, Mnemos zero-write constraints and Polyphonic behavior reuse are evidenced without product mutation."],
    "contract_completeness": ["Normative contracts, executable task ownership and fail-closed evidence validation have no open P0/P1."],
}
G0_SOURCE_COORDINATES = (
    {
        "name": "buzz",
        "path": "/Users/rileycoyote/Documents/Codex/2026-07-21/will-you-look-into-this-new/work/buzz",
        "commit": G0_CANDIDATE,
        "dirty_entries": 0,
        "status": "clean",
    },
    {
        "name": "luca_v2",
        "path": "/Users/rileycoyote/clawd-luca/luca-terminal-v2",
        "commit": "c0aca265c91e73607dada86303833605beed32cc",
        "dirty_entries": 0,
        "status": "clean",
    },
    {
        "name": "mnemos",
        "path": "/Users/rileycoyote/Documents/Repositories/mnemos",
        "commit": "bd394748cd3cc0175e3bc31b27148a4760972b57",
        "dirty_entries": 37,
        "status": "pre_existing_dirty_preserved",
    },
    {
        "name": "polyphonic",
        "path": "/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-v2",
        "commit": "91bda36be79895c2be27cfa059bf1eae03bece3b",
        "dirty_entries": 114,
        "status": "pre_existing_dirty_preserved",
    },
)
G0_PROOF_DOCUMENT_BINDINGS = {
    proof_id: f"gates/G0/{proof_id}.json" for proof_id in G0_PROOF_ASSERTIONS
}
G0_PROOF_EVIDENCE_BINDINGS = {
    "source_truth": [
        "gates/G0/M0_evidence_index.json",
        "gates/G0/source-state.log",
    ],
    "feasibility": [
        "M0/buzz/AGENT_TO_AGENT_FEASIBILITY.md",
        "M0/memory/MEMORY_M0_REPORT.md",
        "M0/polyphonic/POLYPHONIC_REUSE_AUDIT.md",
    ],
    "contract_completeness": [
        "gates/G0/structural.log",
        "gates/G0/validator-unit.log",
        "reviews/ARCHITECTURE_PASS.md",
        "reviews/GRAPH_PASS.md",
        "reviews/ROUTING_PASS.md",
    ],
}
EXPECTED_SOL_HIGH_TASKS = {
    "F13", "F14", "F19", "C02", "C15", "C13", "C07", "B02", "B05",
    "B06", "B21", "B23", "B10", "B14", "B15", "R02", "R03", "R04",
    "R06", "P01", "P12", "P06", "L03", "L04", "L05",
}
EXPECTED_EXECUTION_COUNTS = {
    ("gpt-5.6-terra", "high"): 67,
    ("gpt-5.6-terra", "medium"): 12,
    ("gpt-5.6-sol", "high"): 25,
    ("gpt-5.6-sol", "ultra"): 8,
    ("human", "none"): 1,
}


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader: yaml.Loader, node: yaml.Node, deep: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in out:
            raise ValueError(f"duplicate YAML key {key!r} at line {key_node.start_mark.line + 1}")
        out[key] = loader.construct_object(value_node, deep=deep)
    return out


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.load(path.read_text(), Loader=UniqueKeyLoader)
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a YAML object")
    return value


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"{path}: cannot read valid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected a JSON object")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_fields(document: dict[str, Any], fields: Iterable[str], label: str, errors: list[str]) -> None:
    for field in fields:
        if field not in document or document[field] in (None, ""):
            errors.append(f"{label}: missing or empty field {field}")


def ancestors(task_id: str, by_id: dict[str, dict[str, Any]]) -> set[str]:
    seen: set[str] = set()
    pending = list(by_id[task_id].get("depends_on", []))
    while pending:
        current = pending.pop()
        if current in seen or current not in by_id:
            continue
        seen.add(current)
        pending.extend(by_id[current].get("depends_on", []))
    return seen


def glob_prefix(pattern: str) -> str:
    """Return the concrete path prefix preceding the first glob metacharacter."""
    normalized = pattern.replace("\\", "/").lstrip("./")
    match = WILDCARD_RE.search(normalized)
    prefix = normalized[: match.start()] if match else normalized
    return prefix.rstrip("/")


def could_overlap(left: str, right: str) -> bool:
    """Conservatively decide whether two ownership globs can name one path."""
    left = left.replace("\\", "/").lstrip("./")
    right = right.replace("\\", "/").lstrip("./")
    if left == right or fnmatch.fnmatchcase(left, right) or fnmatch.fnmatchcase(right, left):
        return True
    lp, rp = glob_prefix(left), glob_prefix(right)
    if not lp or not rp:
        return True
    return lp == rp or lp.startswith(rp + "/") or rp.startswith(lp + "/")


def output_binding_path(binding: Any) -> str | None:
    if isinstance(binding, str):
        return binding
    if isinstance(binding, dict):
        for key in ("path", "glob", "output_path"):
            value = binding.get(key)
            if isinstance(value, str):
                return value
    return None


def path_is_owned(path: str, includes: list[str]) -> bool:
    normalized = path.replace("\\", "/").lstrip("./")
    for pattern in includes:
        normalized_pattern = pattern.replace("\\", "/").lstrip("./")
        if fnmatch.fnmatchcase(normalized, normalized_pattern):
            return True
        if WILDCARD_RE.search(normalized) and could_overlap(normalized, normalized_pattern):
            return True
    return False


def validate_structure(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    try:
        graph = load_yaml(root / "TASK_GRAPH.yaml")
        catalog = load_yaml(root / "TASK_CAPSULE_CATALOG.yaml")
        proof_matrix = load_yaml(root / "PROOF_TRACE_MATRIX.yaml")
    except (OSError, ValueError, yaml.YAMLError) as exc:
        return [str(exc)]

    tasks = graph.get("tasks", [])
    if not isinstance(tasks, list):
        return ["TASK_GRAPH.yaml: tasks must be a list"]
    by_id = {task.get("id"): task for task in tasks if isinstance(task, dict)}
    if len(by_id) != len(tasks):
        errors.append("task IDs are not unique or a task is not an object")

    if graph.get("schema_version") != 5:
        errors.append("TASK_GRAPH.yaml: cost-optimized graph schema_version must be 5")
    if graph.get("lead_mode") != "high":
        errors.append("TASK_GRAPH.yaml: persistent lead_mode must be high")

    execution_counts = collections.Counter(
        (task.get("model"), task.get("reasoning_effort"))
        for task in tasks if isinstance(task, dict)
    )
    if dict(execution_counts) != EXPECTED_EXECUTION_COUNTS:
        errors.append(
            "TASK_GRAPH.yaml: execution routing count mismatch: "
            f"{dict(execution_counts)!r} != {EXPECTED_EXECUTION_COUNTS!r}"
        )
    sol_high_tasks = {
        task.get("id") for task in tasks
        if isinstance(task, dict)
        and task.get("model") == "gpt-5.6-sol"
        and task.get("reasoning_effort") == "high"
    }
    if sol_high_tasks != EXPECTED_SOL_HIGH_TASKS:
        errors.append(
            "TASK_GRAPH.yaml: Sol-high authority task set mismatch: "
            f"{sorted(sol_high_tasks, key=str)} != {sorted(EXPECTED_SOL_HIGH_TASKS)}"
        )

    execution_policy = graph.get("execution_policy", {})
    if execution_policy.get("persistent_lead") != {
        "model": "gpt-5.6-sol", "reasoning_effort": "high"
    }:
        errors.append("TASK_GRAPH.yaml: persistent lead execution policy mismatch")
    if execution_policy.get("routing_counts") != {
        "gpt-5.6-terra": 79,
        "gpt-5.6-sol_high": 25,
        "gpt-5.6-sol_ultra": 8,
        "human": 1,
    }:
        errors.append("TASK_GRAPH.yaml: declared routing_counts mismatch")
    if execution_policy.get("future_execution_sessions") != {
        "lane_sessions": 20, "ultra_gate_sessions": 7, "total": 27
    }:
        errors.append("TASK_GRAPH.yaml: future execution session budget mismatch")

    required_task = (
        "id", "milestone", "title", "depends_on", "lane", "risk", "executor_role",
        "model", "reasoning_effort", "outputs", "capsule",
    )
    for task in tasks:
        if not isinstance(task, dict):
            continue
        for field in required_task:
            if field not in task:
                errors.append(f"{task.get('id', '<unknown>')}: missing task field {field}")
        for dep in task.get("depends_on", []):
            if dep not in by_id:
                errors.append(f"{task.get('id')}: unknown dependency {dep}")

    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(task_id: str) -> None:
        if state.get(task_id) == 1:
            errors.append("dependency cycle: " + " -> ".join(stack + [task_id]))
            return
        if state.get(task_id) == 2:
            return
        state[task_id] = 1
        stack.append(task_id)
        for dep in by_id[task_id].get("depends_on", []):
            if dep in by_id:
                visit(dep)
        stack.pop()
        state[task_id] = 2

    for task_id in by_id:
        visit(task_id)

    capsules = catalog.get("task_capsules", [])
    if not isinstance(capsules, list):
        return errors + ["TASK_CAPSULE_CATALOG.yaml: task_capsules must be a list"]
    by_capsule = {capsule.get("id"): capsule for capsule in capsules if isinstance(capsule, dict)}
    if len(by_capsule) != len(capsules):
        errors.append("capsule IDs are not unique or a capsule is not an object")

    required_capsule = (
        "id", "objective", "contracts", "proofs", "source_refs", "owns",
        "ownership_mutex", "implementation_contract", "tests", "evidence",
        "output_bindings", "verifier", "done_when", "effort", "executor_role",
        "model", "reasoning_effort", "stop_conditions",
    )
    agreement_fields = ("id", "executor_role", "model", "reasoning_effort")
    for task in tasks:
        if not isinstance(task, dict):
            continue
        task_id = task.get("id")
        capsule = by_capsule.get(task.get("capsule"))
        if not capsule:
            errors.append(f"{task_id}: unresolved capsule {task.get('capsule')}")
            continue
        for field in required_capsule:
            value = capsule.get(field)
            if value is None or value == [] or value == "":
                errors.append(f"{task_id}: incomplete capsule field {field}")
        for field in agreement_fields:
            task_value = task_id if field == "id" else task.get(field)
            capsule_value = capsule.get(field)
            if task_value != capsule_value:
                errors.append(
                    f"{task_id}: graph/capsule disagreement for {field}: "
                    f"{task_value!r} != {capsule_value!r}"
                )

        owns = capsule.get("owns", {})
        includes = owns.get("include", []) if isinstance(owns, dict) else []
        forbids = owns.get("forbid", []) if isinstance(owns, dict) else []
        if not includes or not forbids:
            errors.append(f"{task_id}: owned and forbidden globs are required")
        for binding in capsule.get("output_bindings", []):
            path = output_binding_path(binding)
            if not path:
                errors.append(f"{task_id}: output binding lacks a path: {binding!r}")
            elif not path_is_owned(path, includes):
                errors.append(f"{task_id}: output binding is outside owned globs: {path}")
            implementation_paths = binding.get("implementation_paths", []) if isinstance(binding, dict) else []
            if task.get("type") != "gate":
                if not isinstance(implementation_paths, list) or not implementation_paths:
                    errors.append(f"{task_id}: output binding lacks implementation_paths: {binding!r}")
                else:
                    for implementation_path in implementation_paths:
                        if not path_is_owned(implementation_path, includes):
                            errors.append(
                                f"{task_id}: implementation path is outside owned globs: {implementation_path}"
                            )
        binding_names = {
            binding.get("name") for binding in capsule.get("output_bindings", []) if isinstance(binding, dict)
        }
        if binding_names != set(task.get("outputs", [])):
            errors.append(
                f"{task_id}: graph outputs/capsule output bindings disagree: "
                f"{sorted(task.get('outputs', []))} != {sorted(binding_names, key=str)}"
            )
        binding_paths = [output_binding_path(binding) for binding in capsule.get("output_bindings", [])]
        if len(binding_paths) != len(set(binding_paths)):
            errors.append(f"{task_id}: every named output requires a distinct evidence-manifest path")

        verifier = capsule.get("verifier", {})
        if task.get("risk") in ("high", "critical") and not verifier.get("independent"):
            errors.append(f"{task_id}: high/critical task lacks independent verifier")

    for capsule_id in set(by_capsule) - set(by_id):
        errors.append(f"orphan capsule {capsule_id}")

    expected_gates = {"G0", "G1", "G2", "G3", "G4", "G5", "G6", "G8"}
    ultra_tasks = {
        task.get("id") for task in tasks
        if isinstance(task, dict) and task.get("reasoning_effort") == "ultra"
    }
    if ultra_tasks != expected_gates:
        errors.append(
            f"Ultra is gate-only: {sorted(ultra_tasks, key=str)} != {sorted(expected_gates)}"
        )
    for gate in expected_gates:
        record = by_id.get(gate)
        if not record or record.get("type") != "gate":
            errors.append(f"missing explicit gate node {gate}")
        elif gate != "G0" and not record.get("depends_on"):
            errors.append(f"{gate}: gate has no independent-review dependency")
        if record and len(record.get("pass_conditions", [])) < 5:
            errors.append(f"{gate}: incomplete explicit pass conditions")

    milestones = graph.get("milestones", [])
    milestone_gates = {milestone.get("gate") for milestone in milestones}
    if milestone_gates != expected_gates - {"G0"}:
        errors.append(f"milestone gate set mismatch: {sorted(milestone_gates)}")
    for milestone in milestones:
        gate_id = milestone.get("gate")
        closure = ancestors(gate_id, by_id) if gate_id in by_id else set()
        for task in tasks:
            if (
                task.get("milestone") == milestone.get("id")
                and task.get("id") != gate_id
                and not task.get("post_gate")
                and task.get("id") not in closure
            ):
                errors.append(f"{gate_id}: milestone task {task.get('id')} is not in gate closure")

    # Every potentially overlapping production ownership pair must share one
    # scheduler mutex. Task-specific evidence directories are exempt.
    ownership_policy = graph.get("ownership_policy", {})
    overlap_allowlist = {
        frozenset(pair)
        for pair in ownership_policy.get("serialized_mutex_pairs", [])
        if isinstance(pair, list) and len(pair) == 2
    }
    explicit_overlap_allowlist = {
        frozenset(pair)
        for pair in ownership_policy.get("overlap_allowlist", [])
        if isinstance(pair, list) and len(pair) == 2
    }
    ownership: list[tuple[str, str, str]] = []
    for capsule in capsules:
        for pattern in capsule.get("owns", {}).get("include", []):
            normalized = pattern.replace("\\", "/").lstrip("./")
            if normalized.startswith("evidence/"):
                continue
            ownership.append((capsule["id"], normalized, capsule.get("ownership_mutex", "")))
    for index, (left_id, left, left_mutex) in enumerate(ownership):
        for right_id, right, right_mutex in ownership[index + 1 :]:
            mutex_pair = frozenset((left_mutex, right_mutex))
            task_pair = frozenset((left_id, right_id))
            if (
                left_id != right_id
                and left_mutex != right_mutex
                and mutex_pair not in overlap_allowlist
                and task_pair not in explicit_overlap_allowlist
                and could_overlap(left, right)
            ):
                errors.append(
                    f"cross-mutex ownership overlap: {left_id}:{left} ({left_mutex}) vs "
                    f"{right_id}:{right} ({right_mutex})"
                )

    # Migrations and schema-changing database paths are single-writer assets.
    # Ownership must be explicit and the owner must be an integrator lane/mutex.
    declared_single_writers = ownership_policy.get("single_writer_paths", {})
    if not isinstance(declared_single_writers, dict) or not declared_single_writers:
        errors.append("ownership_policy.single_writer_paths must be a non-empty mapping")
        declared_single_writers = {}
    migration_owners: list[tuple[str, str]] = []
    for capsule in capsules:
        task = by_id.get(capsule.get("id"), {})
        for pattern in capsule.get("owns", {}).get("include", []):
            parts = [part.lower() for part in PurePosixPath(pattern).parts]
            if any(part == "migrations" or part.startswith("migration") for part in parts):
                migration_owners.append((capsule["id"], pattern))
                if task.get("lane") != "integrator" or capsule.get("ownership_mutex") != "integrator":
                    errors.append(f"{capsule['id']}: migration ownership requires integrator lane and mutex: {pattern}")
    for index, (left_id, left) in enumerate(migration_owners):
        for right_id, right in migration_owners[index + 1 :]:
            if left_id != right_id and could_overlap(left, right):
                errors.append(f"single-writer migration overlap: {left_id}:{left} vs {right_id}:{right}")
    for pattern, owner in declared_single_writers.items():
        matches = [(task_id, owned) for task_id, owned in migration_owners if could_overlap(pattern, owned)]
        if matches != [(owner, pattern)]:
            errors.append(
                f"single-writer declaration {pattern}:{owner} does not resolve to exactly that owned glob: {matches}"
            )
    for task_id, pattern in migration_owners:
        if declared_single_writers.get(pattern) != task_id:
            errors.append(f"undeclared or mismatched migration owner {task_id}:{pattern}")

    # Shared schemas and the shared protocol crate have one writer: F13.
    for capsule in capsules:
        for pattern in capsule.get("owns", {}).get("include", []):
            if (
                could_overlap(pattern, "schemas/luca/**")
                or could_overlap(pattern, "crates/luca-protocol/**")
            ) and capsule.get("id") != "F13":
                errors.append(f"{capsule.get('id')}: shared schema/protocol ownership belongs only to F13: {pattern}")

    required_docs = [
        "ARCHITECTURE_IMPLEMENTATION_SPEC.md", "BRAIN_AND_CONTINUITY_SERVICE_SPEC.md",
        "CAPSULE_IMPLEMENTATION_SPEC.md", "POST_TURN_CHECKPOINT_SPEC.md",
        "GUARDED_ROOMS_SPEC.md", "RESIDENT_BACKUP_RESTORE_SPEC.md", "SECURITY_THREAT_MODEL.md",
        "TARGET_CODE_MAP.md", "MILESTONE_GATES.md", "DEMO_AND_ACCEPTANCE.md",
        "LOCAL_ARCHIVE_AND_OUTBOX_SPEC.md", "SIGNING_BROKER_SPEC.md",
        "MANAGED_CAPSULE_COORDINATOR_SPEC.md", "EVIDENCE_SCHEMAS.md",
        "SWARM_AND_RECURSIVE_VERIFICATION.md", "IMPLEMENTATION_ROADMAP.md",
        "BUILD_START_PROMPT_HIGH.md", "GATE_REVIEW_PROMPT_ULTRA.md",
    ]
    for name in required_docs:
        if not (root / name).is_file():
            errors.append(f"missing normative document {name}")

    expected_proofs = {"P1", "P2", "P3", "P4", "P5", "P6", "P7", "S1", "S2", "S3", "S4", "S5", "S6"}
    proof_records = proof_matrix.get("proofs", [])
    proofs = {item.get("proof"): item for item in proof_records if isinstance(item, dict)}
    if set(proofs) != expected_proofs:
        errors.append(f"proof trace set mismatch: {sorted(set(proofs))}")
    for proof_id, record in proofs.items():
        if not record.get("tasks"):
            errors.append(f"{proof_id}: has no mapped tasks")
        if not record.get("acceptance_assertions"):
            errors.append(f"{proof_id}: has no exact acceptance assertions")
        for mapped in record.get("tasks", []):
            if mapped.get("id") not in by_id:
                errors.append(f"{proof_id}: unknown mapped task {mapped.get('id')}")
            if not mapped.get("tests") or not mapped.get("evidence"):
                errors.append(f"{proof_id}/{mapped.get('id')}: missing tests/evidence")
    canonical_proof_ids = set(proofs)
    for milestone in milestones:
        unknown = set(milestone.get("proofs", [])) - canonical_proof_ids
        if unknown:
            errors.append(f"{milestone.get('id')}: undefined milestone proof IDs {sorted(unknown)}")

    return errors


def resolve_evidence_path(root: Path, relative: str, label: str, errors: list[str]) -> Path | None:
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        errors.append(f"{label}: evidence path must be non-empty and relative: {relative!r}")
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        errors.append(f"{label}: evidence path escapes evidence root: {relative}")
        return None
    if not candidate.is_file():
        errors.append(f"{label}: missing evidence file {relative}")
        return None
    return candidate


def validate_hashed_ref(
    reference: dict[str, Any], root: Path, label: str, errors: list[str]
) -> tuple[Path | None, dict[str, Any] | None]:
    if not isinstance(reference, dict):
        errors.append(f"{label}: expected path/hash object")
        return None, None
    require_fields(reference, ("path", "sha256"), label, errors)
    expected = reference.get("sha256")
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        errors.append(f"{label}: sha256 must be 64 lowercase hex characters")
    path = resolve_evidence_path(root, reference.get("path"), label, errors)
    if path and isinstance(expected, str) and SHA256_RE.fullmatch(expected):
        actual = sha256(path)
        if actual != expected:
            errors.append(f"{label}: hash mismatch for {reference.get('path')}: {actual} != {expected}")
    return path, reference


def validate_identity(identity: Any, label: str, errors: list[str]) -> None:
    if not isinstance(identity, dict):
        errors.append(f"{label}: expected identity object")
        return
    require_fields(identity, ("id", "independence_group"), label, errors)


def identities_conflict(left: Any, right: Any) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    return (
        left.get("id") == right.get("id")
        or left.get("independence_group") == right.get("independence_group")
    )


def validate_milestone_independence(
    by_id: dict[str, dict[str, Any]],
    results: dict[str, dict[str, Any]],
    task_review_documents: dict[str, dict[str, Any]],
    candidate_author: Any,
    gate_review: dict[str, Any],
    label: str,
    errors: list[str],
) -> None:
    """Separate implementation, milestone review and Ultra gate identities."""
    implementation_authors = {
        task_id: result.get("executor")
        for task_id, result in results.items()
        if by_id.get(task_id, {}).get("executor_role") != "independent_reviewer"
    }
    for reviewed_task, review_document in task_review_documents.items():
        reviewer_identity = review_document.get("reviewer")
        for implementation_task, author_identity in implementation_authors.items():
            if identities_conflict(reviewer_identity, author_identity):
                errors.append(
                    f"{label}: task reviewer for {reviewed_task} also authored "
                    f"implementation result {implementation_task}"
                )

    gate_reviewer = gate_review.get("reviewer")
    participant_identities = [
        candidate_author,
        *(result.get("executor") for result in results.values()),
        *(review.get("reviewer") for review in task_review_documents.values()),
    ]
    participant_ids = {
        identity.get("id")
        for identity in participant_identities
        if isinstance(identity, dict) and identity.get("id")
    }
    for participant in participant_identities:
        if identities_conflict(gate_reviewer, participant):
            errors.append(
                f"{label}: Ultra gate reviewer is not independent of milestone participant "
                f"{participant.get('id')!r}"
            )
    declared_independence = gate_review.get("independent_of")
    if isinstance(declared_independence, list):
        missing_participants = participant_ids - set(declared_independence)
        if missing_participants:
            errors.append(
                f"{label}: gate review independent_of omits milestone participants "
                f"{sorted(missing_participants)}"
            )


def validate_g0_source_coordinates(sources: Any, label: str, errors: list[str]) -> None:
    """Require the frozen M0 repos, commits and preservation states exactly."""
    if not isinstance(sources, list):
        errors.append(f"{label}: sources must be a list")
        return
    if len(sources) != len(G0_SOURCE_COORDINATES):
        errors.append(
            f"{label}: source coordinate count mismatch: "
            f"{len(sources)} != {len(G0_SOURCE_COORDINATES)}"
        )
    expected_by_name = {record["name"]: record for record in G0_SOURCE_COORDINATES}
    found_by_name: dict[Any, Any] = {}
    for position, record in enumerate(sources):
        if not isinstance(record, dict):
            errors.append(f"{label}: source {position} is not an object")
            continue
        require_fields(
            record,
            ("name", "path", "commit", "dirty_entries", "status"),
            f"{label} source {position}",
            errors,
        )
        name = record.get("name")
        if not isinstance(name, str):
            errors.append(f"{label}: source {position} name must be a string")
            continue
        if name in found_by_name:
            errors.append(f"{label}: duplicate source name {name!r}")
        found_by_name[name] = record
    if set(found_by_name) != set(expected_by_name):
        errors.append(
            f"{label}: named source set mismatch: "
            f"{sorted(found_by_name, key=str)} != {sorted(expected_by_name)}"
        )
    for name, expected in expected_by_name.items():
        found = found_by_name.get(name)
        if not isinstance(found, dict):
            continue
        actual_coordinate = {field: found.get(field) for field in expected}
        if actual_coordinate != expected:
            errors.append(
                f"{label}: source coordinate mismatch for {name}: "
                f"{actual_coordinate!r} != {expected!r}"
            )


def validate_artifact_scan(
    path: Path, candidate: str, label: str, errors: list[str]
) -> dict[str, Any] | None:
    try:
        scan = load_json(path)
    except ValueError as exc:
        errors.append(str(exc))
        return None
    require_fields(scan, ("schema", "candidate_commit", "status", "scanned", "findings"), label, errors)
    if scan.get("schema") != "luca.evidence.artifact-scan.v1":
        errors.append(f"{label}: unsupported schema {scan.get('schema')!r}")
    if scan.get("candidate_commit") != candidate:
        errors.append(f"{label}: candidate mismatch")
    if scan.get("status") != PASS:
        errors.append(f"{label}: artifact scan is not PASS")
    if not isinstance(scan.get("scanned"), list) or not scan.get("scanned"):
        errors.append(f"{label}: scanned must name at least one artifact")
    findings = scan.get("findings")
    if not isinstance(findings, list):
        errors.append(f"{label}: findings must be a list")
    elif findings:
        errors.append(f"{label}: artifact scan contains findings")
    return scan


def evidence_relative_binding(path: str) -> str:
    normalized = path.replace("\\", "/").lstrip("./")
    return normalized[len("evidence/") :] if normalized.startswith("evidence/") else normalized


def validate_output_manifest(
    path: Path,
    expected_task: str,
    binding: dict[str, Any],
    candidate: str,
    evidence_root: Path,
    kit_root: Path,
    errors: list[str],
) -> None:
    label = f"output {expected_task}/{binding.get('name')}"
    try:
        document = load_json(path)
    except ValueError as exc:
        errors.append(str(exc))
        return
    require_fields(
        document,
        ("schema", "task", "name", "candidate_commit", "declared_implementation_paths", "implementation_refs"),
        label,
        errors,
    )
    if document.get("schema") != "luca.evidence.output.v1":
        errors.append(f"{label}: unsupported schema {document.get('schema')!r}")
    if document.get("task") != expected_task or document.get("name") != binding.get("name"):
        errors.append(f"{label}: task/name mismatch")
    if document.get("candidate_commit") != candidate:
        errors.append(f"{label}: candidate mismatch")
    expected_patterns = binding.get("implementation_paths", [])
    if document.get("declared_implementation_paths") != expected_patterns:
        errors.append(f"{label}: declared implementation paths do not match the capsule")
    references = document.get("implementation_refs")
    if not isinstance(references, list) or not references:
        errors.append(f"{label}: implementation_refs must be non-empty")
        return
    for index, reference in enumerate(references):
        if not isinstance(reference, dict) or not any(
            path_is_owned(reference.get("path", ""), [pattern]) for pattern in expected_patterns
        ):
            errors.append(f"{label}: implementation ref {index} is outside declared paths")
            continue
        validate_hashed_ref(reference, kit_root, f"{label} implementation_refs[{index}]", errors)


def validate_result_document(
    path: Path,
    expected_task: str,
    candidate: str,
    root: Path,
    capsule: dict[str, Any],
    kit_root: Path,
    errors: list[str],
) -> dict[str, Any] | None:
    label = f"result {expected_task}"
    try:
        result = load_json(path)
    except ValueError as exc:
        errors.append(str(exc))
        return None
    require_fields(
        result,
        ("schema", "task", "candidate_commit", "status", "executor", "outputs", "test_logs", "artifact_scan"),
        label,
        errors,
    )
    if result.get("schema") != "luca.evidence.result.v1":
        errors.append(f"{label}: unsupported schema {result.get('schema')!r}")
    if result.get("task") != expected_task:
        errors.append(f"{label}: task mismatch {result.get('task')!r}")
    if result.get("candidate_commit") != candidate:
        errors.append(f"{label}: candidate mismatch")
    if result.get("status") != PASS:
        errors.append(f"{label}: result is not PASS")
    validate_identity(result.get("executor"), f"{label} executor", errors)
    bindings = {
        binding.get("name"): binding
        for binding in capsule.get("output_bindings", [])
        if isinstance(binding, dict)
    }
    outputs = result.get("outputs")
    found_outputs: set[str] = set()
    if not isinstance(outputs, list) or not outputs:
        errors.append(f"{label}: outputs must be non-empty")
    else:
        for index, reference in enumerate(outputs):
            output_name = reference.get("name") if isinstance(reference, dict) else None
            if output_name in found_outputs:
                errors.append(f"{label}: duplicate output name {output_name!r}")
            found_outputs.add(output_name)
            binding = bindings.get(output_name)
            path_ref, _ = validate_hashed_ref(reference, root, f"{label} outputs[{index}]", errors)
            if not binding:
                errors.append(f"{label}: unknown output name {output_name!r}")
                continue
            expected_path = evidence_relative_binding(binding.get("path", ""))
            if reference.get("path") != expected_path:
                errors.append(
                    f"{label}: output {output_name} path {reference.get('path')!r} != {expected_path!r}"
                )
            if path_ref:
                validate_output_manifest(path_ref, expected_task, binding, candidate, root, kit_root, errors)
    if found_outputs != set(bindings):
        errors.append(f"{label}: output name set mismatch: {sorted(found_outputs, key=str)} != {sorted(bindings)}")

    test_logs = result.get("test_logs")
    expected_commands = capsule.get("tests", [])
    found_commands: list[str] = []
    if not isinstance(test_logs, list) or not test_logs:
        errors.append(f"{label}: test_logs must be non-empty")
    else:
        for index, reference in enumerate(test_logs):
            if not isinstance(reference, dict):
                errors.append(f"{label}: test log {index} is not an object")
                continue
            require_fields(reference, ("name", "command", "status", "path", "sha256"), f"{label} test log {index}", errors)
            if reference.get("status") != PASS:
                errors.append(f"{label}: test log {index} is not PASS")
            found_commands.append(reference.get("command"))
            validate_hashed_ref(reference, root, f"{label} test_logs[{index}]", errors)
    if found_commands != expected_commands:
        errors.append(f"{label}: test command sequence does not match the capsule")
    scan_path, _ = validate_hashed_ref(result.get("artifact_scan"), root, f"{label} artifact_scan", errors)
    if scan_path:
        validate_artifact_scan(scan_path, candidate, f"{label} artifact_scan", errors)
    return result


def validate_review_document(
    path: Path,
    expected_type: str,
    expected_id: str,
    candidate: str,
    subject_author: dict[str, Any] | None,
    errors: list[str],
) -> dict[str, Any] | None:
    label = f"review {expected_type} {expected_id}"
    try:
        review = load_json(path)
    except ValueError as exc:
        errors.append(str(exc))
        return None
    require_fields(
        review,
        ("schema", "subject_type", "subject_id", "candidate_commit", "status", "reviewer", "independent_of", "findings"),
        label,
        errors,
    )
    if review.get("schema") != "luca.evidence.review.v1":
        errors.append(f"{label}: unsupported schema {review.get('schema')!r}")
    if review.get("subject_type") != expected_type or review.get("subject_id") != expected_id:
        errors.append(f"{label}: subject mismatch")
    if review.get("candidate_commit") != candidate:
        errors.append(f"{label}: candidate mismatch")
    if review.get("status") != PASS:
        errors.append(f"{label}: review is not PASS")
    reviewer = review.get("reviewer")
    validate_identity(reviewer, f"{label} reviewer", errors)
    independent_of = review.get("independent_of")
    if not isinstance(independent_of, list) or not independent_of:
        errors.append(f"{label}: independent_of must be non-empty")
    if subject_author and isinstance(reviewer, dict):
        if reviewer.get("id") == subject_author.get("id"):
            errors.append(f"{label}: reviewer is the candidate author")
        if reviewer.get("independence_group") == subject_author.get("independence_group"):
            errors.append(f"{label}: reviewer shares the candidate author's independence group")
        if subject_author.get("id") not in (independent_of or []):
            errors.append(f"{label}: independent_of omits candidate author {subject_author.get('id')!r}")
    findings = review.get("findings")
    if not isinstance(findings, list):
        errors.append(f"{label}: findings must be a list")
    else:
        for index, finding in enumerate(findings):
            if not isinstance(finding, dict):
                errors.append(f"{label}: finding {index} is not an object")
                continue
            require_fields(finding, ("id", "severity", "status"), f"{label} finding {index}", errors)
            severity = finding.get("severity")
            status = finding.get("status")
            if severity not in ("P0", "P1", "P2", "P3"):
                errors.append(f"{label}: finding {index} has invalid severity {severity!r}")
            if status not in ("CLOSED", "ACCEPTED"):
                errors.append(f"{label}: finding {index} is open ({status!r})")
            if severity in ("P0", "P1") and status != "CLOSED":
                errors.append(f"{label}: {severity} finding {finding.get('id')} is not CLOSED")
    return review


def validate_proof_document(
    path: Path,
    proof_id: str,
    candidate: str,
    expected_assertions: list[str],
    expected_tasks: list[str],
    expected_evidence_paths: list[str] | None,
    evidence_root: Path,
    errors: list[str],
) -> None:
    label = f"proof {proof_id}"
    try:
        document = load_json(path)
    except ValueError as exc:
        errors.append(str(exc))
        return
    require_fields(
        document,
        ("schema", "proof_id", "candidate_commit", "status", "acceptance_assertions", "mapped_tasks", "evidence"),
        label,
        errors,
    )
    if document.get("schema") != "luca.evidence.proof.v1":
        errors.append(f"{label}: unsupported schema {document.get('schema')!r}")
    if document.get("proof_id") != proof_id or document.get("candidate_commit") != candidate:
        errors.append(f"{label}: proof/candidate mismatch")
    if document.get("status") != PASS:
        errors.append(f"{label}: document is not PASS")
    if document.get("acceptance_assertions") != expected_assertions:
        errors.append(f"{label}: acceptance assertions do not match the frozen proof matrix")
    if document.get("mapped_tasks") != expected_tasks:
        errors.append(f"{label}: mapped task sequence does not match the frozen proof matrix")
    references = document.get("evidence")
    if not isinstance(references, list) or not references:
        errors.append(f"{label}: evidence must contain hashed references")
    else:
        found_paths = [
            reference.get("path") if isinstance(reference, dict) else None
            for reference in references
        ]
        if expected_evidence_paths is not None and found_paths != expected_evidence_paths:
            errors.append(
                f"{label}: evidence bindings do not match the frozen G0 contract: "
                f"{found_paths!r} != {expected_evidence_paths!r}"
            )
        for index, reference in enumerate(references):
            validate_hashed_ref(reference, evidence_root, f"{label} evidence[{index}]", errors)


def required_gate_proofs(gate: str, graph: dict[str, Any], catalog: dict[str, Any]) -> set[str]:
    if gate == "G0":
        capsule = next((item for item in catalog.get("task_capsules", []) if item.get("id") == gate), {})
        return set(capsule.get("proofs", []))
    gate_task = next((item for item in graph.get("tasks", []) if item.get("id") == gate), {})
    milestone_id = gate_task.get("milestone")
    milestone = next((item for item in graph.get("milestones", []) if item.get("id") == milestone_id), {})
    return set(milestone.get("proofs", []))


def gate_evidence_dir(evidence_root: Path, gate: str) -> Path | None:
    candidates = [
        evidence_root / "gates" / gate,
        evidence_root / ({"G0": "M0"}.get(gate, "")) / gate,
        evidence_root / gate,
    ]
    for candidate in candidates:
        if (candidate / "gate-verdict.json").is_file():
            return candidate
    matches = list(evidence_root.rglob("gate-verdict.json")) if evidence_root.is_dir() else []
    matching: list[Path] = []
    for path in matches:
        try:
            if load_json(path).get("gate") == gate:
                matching.append(path.parent)
        except ValueError:
            continue
    return matching[0] if len(matching) == 1 else None


def validate_g0_support_files(
    directory: Path,
    evidence_root: Path,
    candidate: str,
    capsule: dict[str, Any],
    errors: list[str],
) -> list[str]:
    required = {
        "environment": directory / "environment.json",
        "index": directory / "M0_evidence_index.json",
        "limits": directory / "known_limits.json",
        "results": directory / "results.json",
    }
    documents: dict[str, dict[str, Any]] = {}
    for label, path in required.items():
        if not path.is_file():
            errors.append(f"G0: missing required support file {path.name}")
            continue
        try:
            documents[label] = load_json(path)
        except ValueError as exc:
            errors.append(str(exc))

    environment = documents.get("environment", {})
    require_fields(environment, ("schema", "candidate_commit", "captured_at", "sources", "topology", "tool_versions"), "G0 environment", errors)
    if environment.get("schema") != "luca.evidence.environment.v1" or environment.get("candidate_commit") != candidate:
        errors.append("G0 environment: schema/candidate mismatch")
    validate_g0_source_coordinates(environment.get("sources"), "G0 environment", errors)

    index = documents.get("index", {})
    require_fields(index, ("schema", "candidate_commit", "status", "sources", "artifacts"), "G0 M0 index", errors)
    if index.get("schema") != "luca.evidence.m0-index.v1" or index.get("candidate_commit") != candidate or index.get("status") != PASS:
        errors.append("G0 M0 index: schema/candidate/status mismatch")
    validate_g0_source_coordinates(index.get("sources"), "G0 M0 index", errors)
    if environment.get("sources") != index.get("sources"):
        errors.append("G0 source manifests: environment and M0 index sources differ")
    artifacts = index.get("artifacts")
    if not isinstance(artifacts, list) or not artifacts:
        errors.append("G0 M0 index: artifacts must contain hashed references")
    else:
        for position, reference in enumerate(artifacts):
            validate_hashed_ref(reference, evidence_root, f"G0 M0 index artifact[{position}]", errors)

    limits = documents.get("limits", {})
    require_fields(limits, ("schema", "candidate_commit", "status", "limits"), "G0 known limits", errors)
    if limits.get("schema") != "luca.evidence.known-limits.v1" or limits.get("candidate_commit") != candidate or limits.get("status") != PASS:
        errors.append("G0 known limits: schema/candidate/status mismatch")
    limit_records = limits.get("limits")
    limit_ids: list[str] = []
    if not isinstance(limit_records, list) or not limit_records:
        errors.append("G0 known limits: limits must be non-empty")
    else:
        for position, record in enumerate(limit_records):
            if not isinstance(record, dict):
                errors.append(f"G0 known limits: record {position} is not an object")
                continue
            require_fields(record, ("id", "title", "impact", "disposition"), f"G0 known limit {position}", errors)
            limit_ids.append(record.get("id"))
        if len(limit_ids) != len(set(limit_ids)):
            errors.append("G0 known limits: IDs are not unique")

    results = documents.get("results", {})
    require_fields(results, ("schema", "task", "candidate_commit", "status", "executor", "outputs", "test_logs", "artifact_scan"), "G0 results", errors)
    if results.get("schema") != "luca.evidence.g0-result.v1" or results.get("task") != "G0" or results.get("candidate_commit") != candidate or results.get("status") != PASS:
        errors.append("G0 results: schema/task/candidate/status mismatch")
    validate_identity(results.get("executor"), "G0 results executor", errors)
    expected_output_paths = {
        "M0_evidence_index": (directory / "M0_evidence_index.json").relative_to(evidence_root).as_posix(),
        "known_limits": (directory / "known_limits.json").relative_to(evidence_root).as_posix(),
    }
    found_outputs: dict[str, str] = {}
    for position, reference in enumerate(results.get("outputs", []) if isinstance(results.get("outputs"), list) else []):
        name = reference.get("name") if isinstance(reference, dict) else None
        path = reference.get("path") if isinstance(reference, dict) else None
        found_outputs[name] = path
        validate_hashed_ref(reference, evidence_root, f"G0 results output[{position}]", errors)
    if found_outputs != expected_output_paths:
        errors.append(f"G0 results: output bindings mismatch: {found_outputs!r}")
    expected_commands = capsule.get("tests", [])
    found_commands: list[str] = []
    test_logs = results.get("test_logs")
    if not isinstance(test_logs, list) or not test_logs:
        errors.append("G0 results: test_logs must be non-empty")
    else:
        for position, reference in enumerate(test_logs):
            if not isinstance(reference, dict):
                errors.append(f"G0 results: test log {position} is not an object")
                continue
            require_fields(reference, ("name", "command", "status", "path", "sha256"), f"G0 results test log {position}", errors)
            found_commands.append(reference.get("command"))
            if reference.get("status") != PASS:
                errors.append(f"G0 results: test log {position} is not PASS")
            validate_hashed_ref(reference, evidence_root, f"G0 results test log[{position}]", errors)
    if found_commands != expected_commands:
        errors.append("G0 results: test command sequence does not match the G0 capsule")
    scan_path, _ = validate_hashed_ref(results.get("artifact_scan"), evidence_root, "G0 results artifact_scan", errors)
    if scan_path:
        validate_artifact_scan(scan_path, candidate, "G0 results artifact_scan", errors)
    return limit_ids


def validate_gate_evidence(
    gate: str, candidate: str, evidence_root: Path, kit_root: Path = ROOT
) -> list[str]:
    errors: list[str] = []
    if not COMMIT_RE.fullmatch(candidate):
        return ["--candidate must be exactly 40 lowercase hexadecimal characters"]
    try:
        graph = load_yaml(kit_root / "TASK_GRAPH.yaml")
        catalog = load_yaml(kit_root / "TASK_CAPSULE_CATALOG.yaml")
        proof_matrix = load_yaml(kit_root / "PROOF_TRACE_MATRIX.yaml")
    except (OSError, ValueError, yaml.YAMLError) as exc:
        return [str(exc)]
    tasks = graph.get("tasks", [])
    by_id = {task.get("id"): task for task in tasks if isinstance(task, dict)}
    by_capsule = {
        item.get("id"): item
        for item in catalog.get("task_capsules", [])
        if isinstance(item, dict)
    }
    proof_contracts = {
        item.get("proof"): item
        for item in proof_matrix.get("proofs", [])
        if isinstance(item, dict)
    }
    if gate not in by_id or by_id[gate].get("type") != "gate":
        return [f"unknown gate {gate!r}"]
    evidence_root = evidence_root.resolve()
    directory = gate_evidence_dir(evidence_root, gate)
    if directory is None:
        return [f"{gate}: expected exactly one gate-verdict.json under {evidence_root}"]
    verdict_path = directory / "gate-verdict.json"
    try:
        verdict = load_json(verdict_path)
    except ValueError as exc:
        return [str(exc)]
    label = f"gate verdict {gate}"
    require_fields(
        verdict,
        (
            "schema", "gate", "candidate_commit", "status", "candidate_author",
            "dependency_gate_receipts", "task_results", "task_reviews", "proofs",
            "test_logs", "artifact_scan", "review", "open_findings", "known_limits",
        ),
        label,
        errors,
    )
    if verdict.get("schema") != "luca.evidence.gate-verdict.v1":
        errors.append(f"{label}: unsupported schema {verdict.get('schema')!r}")
    if verdict.get("gate") != gate:
        errors.append(f"{label}: gate mismatch {verdict.get('gate')!r}")
    if verdict.get("candidate_commit") != candidate:
        errors.append(f"{label}: candidate mismatch")
    if verdict.get("status") != PASS:
        errors.append(f"{label}: verdict is not PASS")
    candidate_author = verdict.get("candidate_author")
    validate_identity(candidate_author, f"{label} candidate_author", errors)
    open_findings = verdict.get("open_findings")
    if not isinstance(open_findings, list):
        errors.append(f"{label}: open_findings must be a list")
    elif any(item.get("severity") in ("P0", "P1") for item in open_findings if isinstance(item, dict)):
        errors.append(f"{label}: open_findings contains P0/P1")
    if not isinstance(verdict.get("known_limits"), list):
        errors.append(f"{label}: known_limits must be a list")
    if gate == "G0":
        limit_ids = validate_g0_support_files(
            directory,
            evidence_root,
            candidate,
            by_capsule.get("G0", {}),
            errors,
        )
        if verdict.get("known_limits") != limit_ids:
            errors.append(f"{label}: known_limits must exactly match known_limits.json IDs")

    gate_ancestors = ancestors(gate, by_id)
    expected_dependency_gates = {task_id for task_id in gate_ancestors if by_id[task_id].get("type") == "gate"}
    dependency_refs = verdict.get("dependency_gate_receipts", [])
    if not isinstance(dependency_refs, list):
        errors.append(f"{label}: dependency_gate_receipts must be a list")
        dependency_refs = []
    found_dependency_gates: set[str] = set()
    for index, reference in enumerate(dependency_refs):
        dep_gate = reference.get("gate") if isinstance(reference, dict) else None
        found_dependency_gates.add(dep_gate)
        path, _ = validate_hashed_ref(reference, evidence_root, f"{label} dependency[{index}]", errors)
        if isinstance(reference, dict) and reference.get("status") != PASS:
            errors.append(f"{label}: dependency {dep_gate} is not PASS")
        if path:
            try:
                receipt = load_json(path)
                if receipt.get("schema") != "luca.evidence.gate-verdict.v1":
                    errors.append(f"{label}: dependency {dep_gate} has unsupported schema")
                if receipt.get("gate") != dep_gate or receipt.get("status") != PASS:
                    errors.append(f"{label}: dependency receipt content mismatch for {dep_gate}")
                if receipt.get("candidate_commit") != candidate:
                    errors.append(f"{label}: dependency {dep_gate} candidate mismatch")
            except ValueError as exc:
                errors.append(str(exc))
    if found_dependency_gates != expected_dependency_gates:
        errors.append(
            f"{label}: dependency gate receipt set mismatch: "
            f"{sorted(found_dependency_gates, key=str)} != {sorted(expected_dependency_gates)}"
        )
    else:
        for dependency_gate in sorted(expected_dependency_gates):
            for dependency_error in validate_gate_evidence(
                dependency_gate, candidate, evidence_root, kit_root
            ):
                errors.append(f"{label}: invalid dependency {dependency_gate}: {dependency_error}")

    expected_tasks = {
        task_id
        for task_id in gate_ancestors
        if by_id[task_id].get("type") != "gate"
        and by_id[task_id].get("milestone") == by_id[gate].get("milestone")
        and not by_id[task_id].get("post_gate")
    }
    result_refs = verdict.get("task_results", [])
    review_refs = verdict.get("task_reviews", [])
    if not isinstance(result_refs, list):
        errors.append(f"{label}: task_results must be a list")
        result_refs = []
    if not isinstance(review_refs, list):
        errors.append(f"{label}: task_reviews must be a list")
        review_refs = []
    results: dict[str, dict[str, Any]] = {}
    for index, reference in enumerate(result_refs):
        task_id = reference.get("task") if isinstance(reference, dict) else None
        path, _ = validate_hashed_ref(reference, evidence_root, f"{label} task_result[{index}]", errors)
        if path and isinstance(task_id, str):
            document = validate_result_document(
                path,
                task_id,
                candidate,
                evidence_root,
                by_capsule.get(task_id, {}),
                kit_root,
                errors,
            )
            if document:
                results[task_id] = document
    if set(results) != expected_tasks:
        errors.append(f"{label}: task result set mismatch: {sorted(results)} != {sorted(expected_tasks)}")

    reviewed_tasks: set[str] = set()
    task_review_documents: dict[str, dict[str, Any]] = {}
    for index, reference in enumerate(review_refs):
        task_id = reference.get("task") if isinstance(reference, dict) else None
        path, _ = validate_hashed_ref(reference, evidence_root, f"{label} task_review[{index}]", errors)
        author = results.get(task_id, {}).get("executor") if isinstance(task_id, str) else None
        if path and isinstance(task_id, str):
            document = validate_review_document(path, "task", task_id, candidate, author, errors)
            if document:
                reviewed_tasks.add(task_id)
                task_review_documents[task_id] = document
    if reviewed_tasks != expected_tasks:
        errors.append(f"{label}: task review set mismatch: {sorted(reviewed_tasks)} != {sorted(expected_tasks)}")

    expected_proofs = required_gate_proofs(gate, graph, catalog)
    proof_refs = verdict.get("proofs", [])
    if not isinstance(proof_refs, list):
        errors.append(f"{label}: proofs must be a list")
        proof_refs = []
    found_proofs: set[str] = set()
    for index, proof in enumerate(proof_refs):
        if not isinstance(proof, dict):
            errors.append(f"{label}: proof {index} is not an object")
            continue
        require_fields(proof, ("proof_id", "status", "evidence"), f"{label} proof {index}", errors)
        proof_id = proof.get("proof_id")
        found_proofs.add(proof_id)
        if proof.get("status") != PASS:
            errors.append(f"{label}: proof {proof_id} is not PASS")
        evidence = proof.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append(f"{label}: proof {proof_id} has no hashed evidence")
        else:
            if gate == "G0":
                expected_document_path = G0_PROOF_DOCUMENT_BINDINGS.get(proof_id)
                found_document_paths = [
                    reference.get("path") if isinstance(reference, dict) else None
                    for reference in evidence
                ]
                if found_document_paths != [expected_document_path]:
                    errors.append(
                        f"{label}: proof {proof_id} document binding mismatch: "
                        f"{found_document_paths!r} != {[expected_document_path]!r}"
                    )
            for evidence_index, reference in enumerate(evidence):
                path, _ = validate_hashed_ref(
                    reference,
                    evidence_root,
                    f"{label} proof {proof_id}[{evidence_index}]",
                    errors,
                )
                if path:
                    contract = proof_contracts.get(proof_id, {})
                    expected_assertions = (
                        G0_PROOF_ASSERTIONS.get(proof_id, [])
                        if gate == "G0"
                        else contract.get("acceptance_assertions", [])
                    )
                    expected_mapped_tasks = (
                        []
                        if gate == "G0"
                        else [item.get("id") for item in contract.get("tasks", [])]
                    )
                    validate_proof_document(
                        path,
                        proof_id,
                        candidate,
                        expected_assertions,
                        expected_mapped_tasks,
                        G0_PROOF_EVIDENCE_BINDINGS.get(proof_id) if gate == "G0" else None,
                        evidence_root,
                        errors,
                    )
    if found_proofs != expected_proofs:
        errors.append(f"{label}: proof set mismatch: {sorted(found_proofs, key=str)} != {sorted(expected_proofs)}")

    test_logs = verdict.get("test_logs", [])
    if not isinstance(test_logs, list) or not test_logs:
        errors.append(f"{label}: test_logs must be non-empty")
    else:
        for index, reference in enumerate(test_logs):
            if isinstance(reference, dict) and reference.get("status") != PASS:
                errors.append(f"{label}: test log {index} is not PASS")
            validate_hashed_ref(reference, evidence_root, f"{label} test_log[{index}]", errors)

    scan_path, _ = validate_hashed_ref(verdict.get("artifact_scan"), evidence_root, f"{label} artifact_scan", errors)
    if scan_path:
        validate_artifact_scan(scan_path, candidate, f"{label} artifact_scan", errors)

    review_path, _ = validate_hashed_ref(verdict.get("review"), evidence_root, f"{label} review", errors)
    if review_path:
        gate_review = validate_review_document(
            review_path, "gate", gate, candidate, candidate_author, errors
        )
        if gate_review:
            validate_milestone_independence(
                by_id,
                results,
                task_review_documents,
                candidate_author,
                gate_review,
                label,
                errors,
            )

    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence-only", action="store_true", help="validate one gate's executable evidence")
    parser.add_argument("--gate", help="gate ID, required with --evidence-only")
    parser.add_argument("--candidate", help="40-character candidate commit, required with --evidence-only")
    parser.add_argument("--evidence-root", type=Path, help="evidence root, required with --evidence-only")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.evidence_only:
        missing = [name for name in ("gate", "candidate", "evidence_root") if getattr(args, name) in (None, "")]
        if missing:
            print("EVIDENCE INVALID")
            print("- --evidence-only requires " + ", ".join(f"--{name.replace('_', '-')}" for name in missing))
            return 2
        errors = validate_gate_evidence(args.gate, args.candidate, args.evidence_root)
        if errors:
            print("EVIDENCE INVALID")
            for error in errors:
                print(f"- {error}")
            return 1
        print(f"EVIDENCE VALID: {args.gate} PASS for candidate {args.candidate}")
        return 0

    if any(value is not None for value in (args.gate, args.candidate, args.evidence_root)):
        print("PLANNING KIT INVALID")
        print("- --gate, --candidate and --evidence-root are only valid with --evidence-only")
        return 2
    errors = validate_structure()
    if errors:
        print("PLANNING KIT INVALID")
        for error in errors:
            print(f"- {error}")
        return 1
    graph = load_yaml(ROOT / "TASK_GRAPH.yaml")
    catalog = load_yaml(ROOT / "TASK_CAPSULE_CATALOG.yaml")
    print(
        f"PLANNING KIT VALID: {len(graph.get('tasks', []))} tasks, "
        f"{len(catalog.get('task_capsules', []))} complete capsules, 8 explicit gates, acyclic dependencies"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Validate the repository-native G2 control package without product data."""

from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTROL = ROOT / "docs/luca/continuity-g2"
GRAPH_PATH = CONTROL / "TASK_GRAPH.yaml"
REQUIRED = {
    "00_START_HERE.md",
    "G2_BUILD_SPEC.md",
    "TASK_GRAPH.yaml",
    "ACCEPTANCE_G2.md",
    "DECISION_LEDGER.md",
    "RUN_LOG.md",
    "receipts/README.md",
}
REQUIRED_INTERFACES = {
    "ContinuityNamespaceV1",
    "ContinuityScopeV1",
    "ContinuityRecordV1",
    "ContinuityContextRequestV1",
    "ContinuityContextResultV1",
    "ContinuityPacketV1",
    "ContinuityMutationV1",
    "ContinuityJobV1",
    "BrainGrantV1",
    "ImportDiscoveryReportV1",
    "ImportPlanV1",
    "ImportCommitReceiptV1",
    "CognitionScheduleV1",
    "ProactiveMessageCandidateV1",
    "PortableContinuityCapsuleV1",
    "LucaBackupManifestV1",
}


def fail(message: str) -> None:
    print(f"G2 control validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def validate_required_files() -> None:
    present = {
        str(path.relative_to(CONTROL))
        for path in CONTROL.rglob("*")
        if path.is_file()
    }
    missing = sorted(REQUIRED - present)
    if missing:
        fail(f"missing files: {', '.join(missing)}")


def validate_graph() -> None:
    graph = yaml.safe_load(GRAPH_PATH.read_text(encoding="utf-8"))
    if graph.get("baseline_commit") != "4781dca6":
        fail("baseline_commit must remain 4781dca6")
    if graph.get("max_parallel_write_lanes") != 3:
        fail("max_parallel_write_lanes must be exactly 3")

    lanes = graph.get("lanes", {})
    tasks = graph.get("tasks", [])
    gates = graph.get("gates", [])
    task_ids = [task.get("id") for task in tasks]
    if not task_ids or len(task_ids) != len(set(task_ids)):
        fail("task IDs must be present and unique")

    task_map = {task["id"]: task for task in tasks}
    required_task_fields = {
        "id",
        "gate",
        "title",
        "depends_on",
        "lane",
        "risk",
        "owner_role",
        "reviewer_role",
        "outputs",
        "checks",
        "acceptance",
    }
    for task in tasks:
        missing = required_task_fields - task.keys()
        if missing:
            fail(f"task {task.get('id')} missing {sorted(missing)}")
        if task["lane"] not in lanes:
            fail(f"task {task['id']} has unknown lane {task['lane']}")
        for dependency in task["depends_on"]:
            if dependency not in task_map:
                fail(f"task {task['id']} depends on unknown task {dependency}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            fail(f"dependency cycle includes {task_id}")
        if task_id in visited:
            return
        visiting.add(task_id)
        for dependency in task_map[task_id]["depends_on"]:
            visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)

    for task_id in task_ids:
        visit(task_id)

    expected_gate_order = ["G2.0", "G2.1", "G2.2", "G2.3", "G2.4", "G2.5", "G2.6"]
    gate_ids = {gate.get("id") for gate in gates}
    if gate_ids != set(expected_gate_order):
        fail("gate IDs must be exactly G2.0 through G2.6")
    if [gate.get("id") for gate in gates] != expected_gate_order:
        fail("gates must be ordered G2.0 through G2.6")
    listed_tasks: list[str] = []
    for gate in gates:
        if gate.get("barrier_task") not in gate.get("tasks", []):
            fail(f"gate {gate.get('id')} must name a barrier_task in its task list")
        listed_tasks.extend(gate.get("tasks", []))
    if sorted(listed_tasks) != sorted(task_ids):
        fail("every task must appear in exactly one gate task list")
    for task in tasks:
        if task["gate"] not in gate_ids:
            fail(f"task {task['id']} has unknown gate {task['gate']}")
    for gate in gates:
        for task_id in gate.get("tasks", []):
            if task_map[task_id]["gate"] != gate["id"]:
                fail(
                    f"task {task_id} is listed under {gate['id']} but declares "
                    f"{task_map[task_id]['gate']}"
                )

    ancestor_cache: dict[str, set[str]] = {}

    def ancestors(task_id: str) -> set[str]:
        if task_id in ancestor_cache:
            return ancestor_cache[task_id]
        result: set[str] = set()
        for dependency in task_map[task_id]["depends_on"]:
            result.add(dependency)
            result.update(ancestors(dependency))
        ancestor_cache[task_id] = result
        return result

    for gate_index in range(1, len(gates)):
        prior_barrier = gates[gate_index - 1]["barrier_task"]
        for task_id in gates[gate_index]["tasks"]:
            if prior_barrier not in ancestors(task_id):
                fail(
                    f"task {task_id} may start before prior gate barrier "
                    f"{prior_barrier}"
                )

    owned_roots: list[tuple[str, str]] = []
    for lane_name, lane in lanes.items():
        for raw_root in lane.get("owns", []):
            normalized = raw_root.rstrip("/")
            if not normalized:
                fail(f"lane {lane_name} contains an empty ownership root")
            for other_lane, other_root in owned_roots:
                if lane_name == other_lane:
                    continue
                if (
                    normalized == other_root
                    or normalized.startswith(f"{other_root}/")
                    or other_root.startswith(f"{normalized}/")
                ):
                    fail(
                        "ownership roots overlap across lanes: "
                        f"{lane_name}:{normalized} and {other_lane}:{other_root}"
                    )
            owned_roots.append((lane_name, normalized))

    acceptance_text = (CONTROL / "ACCEPTANCE_G2.md").read_text(encoding="utf-8")
    acceptance_ids = set(re.findall(r"^\| (A\d{3}) \|", acceptance_text, re.MULTILINE))
    mapped_acceptance: list[str] = []
    for task in tasks:
        for acceptance_id in task["acceptance"]:
            if acceptance_id not in acceptance_ids:
                fail(f"task {task['id']} maps unknown acceptance row {acceptance_id}")
            mapped_acceptance.append(acceptance_id)
    duplicates = sorted(
        acceptance_id
        for acceptance_id in set(mapped_acceptance)
        if mapped_acceptance.count(acceptance_id) > 1
    )
    if duplicates:
        fail(f"acceptance rows map to multiple tasks: {', '.join(duplicates)}")
    unmapped = sorted(acceptance_ids - set(mapped_acceptance))
    if unmapped:
        fail(f"unmapped acceptance rows: {', '.join(unmapped)}")

    receipt_dir = CONTROL / "receipts"
    missing_receipts = sorted(
        task_id for task_id in task_ids if not (receipt_dir / f"{task_id}.md").is_file()
    )
    if missing_receipts:
        fail(f"missing task receipt stubs: {', '.join(missing_receipts)}")
    for task in tasks:
        receipt_text = (receipt_dir / f"{task['id']}.md").read_text(encoding="utf-8")
        for acceptance_id in task["acceptance"]:
            if acceptance_id not in receipt_text:
                fail(f"receipt {task['id']} does not link acceptance {acceptance_id}")


def validate_interface_index() -> None:
    build_spec = (CONTROL / "G2_BUILD_SPEC.md").read_text(encoding="utf-8")
    missing = sorted(name for name in REQUIRED_INTERFACES if name not in build_spec)
    if missing:
        fail(f"build spec missing interfaces: {', '.join(missing)}")
    frozen = (CONTROL / "FROZEN_INTERFACES.md").read_text(encoding="utf-8")
    required_semantics = {
        "ready",
        "empty",
        "denied",
        "stale",
        "locked",
        "unavailable",
        "timeout",
        "invalid",
        "48 KiB",
        "read-only request",
        "age-protected archive",
        "Anti-rumination",
    }
    missing_semantics = sorted(value for value in required_semantics if value not in frozen)
    if missing_semantics:
        fail(f"frozen interface index missing semantics: {', '.join(missing_semantics)}")


def validate_audit_checksums() -> None:
    audit = ROOT / "docs/luca/continuity-audit"
    manifest = audit / "AUDIT_CHECKSUMS.sha256"
    if not manifest.is_file():
        fail("source audit checksum manifest missing")
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        expected, relative = line.split(maxsplit=1)
        relative = relative.lstrip("*")
        path = audit / relative
        if not path.is_file():
            fail(f"audit file missing: {relative}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            fail(f"audit checksum mismatch: {relative}")


def validate_git_baseline() -> None:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", "4781dca6", "HEAD"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        fail("HEAD does not descend from approved baseline 4781dca6")


def main() -> None:
    validate_required_files()
    validate_graph()
    validate_interface_index()
    validate_audit_checksums()
    validate_git_baseline()
    print("G2 control validation: PASS")


if __name__ == "__main__":
    main()

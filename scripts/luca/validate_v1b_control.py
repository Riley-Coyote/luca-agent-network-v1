#!/usr/bin/env python3
"""Validate the repository-native V1B control package."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
CONTROL = ROOT / "docs/luca/functional-beta"
GRAPH = CONTROL / "TASK_GRAPH.yaml"
REQUIRED = {
    "00_START_HERE.md",
    "V1B_BUILD_SPEC.md",
    "TASK_GRAPH.yaml",
    "ACCEPTANCE_V1B.md",
    "DECISION_LEDGER.md",
    "RUN_LOG.md",
    "receipts/README.md",
}


def fail(message: str) -> None:
    print(f"V1B control validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    present = {
        str(path.relative_to(CONTROL))
        for path in CONTROL.rglob("*")
        if path.is_file()
    }
    missing = sorted(REQUIRED - present)
    if missing:
        fail(f"missing files: {', '.join(missing)}")

    graph = yaml.safe_load(GRAPH.read_text(encoding="utf-8"))
    if graph.get("baseline_commit") != "dc1c2e63891ab0a53b2c4c948e0e7eed801d6f89":
        fail("unexpected baseline commit")
    tasks = graph.get("tasks", [])
    task_map = {task["id"]: task for task in tasks}
    if len(task_map) != len(tasks):
        fail("task IDs must be unique")
    for task in tasks:
        for dependency in task.get("depends_on", []):
            if dependency not in task_map:
                fail(f"{task['id']} depends on unknown {dependency}")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(task_id: str) -> None:
        if task_id in visiting:
            fail(f"dependency cycle includes {task_id}")
        if task_id in visited:
            return
        visiting.add(task_id)
        for dependency in task_map[task_id].get("depends_on", []):
            visit(dependency)
        visiting.remove(task_id)
        visited.add(task_id)

    for task_id in task_map:
        visit(task_id)

    gates = graph.get("gates", [])
    expected = ["V1B.0", "V1B.1", "V1B.2", "V1B.3", "V1B.4"]
    if [gate.get("id") for gate in gates] != expected:
        fail("gates must be ordered V1B.0 through V1B.4")
    listed = [task_id for gate in gates for task_id in gate.get("tasks", [])]
    if sorted(listed) != sorted(task_map):
        fail("every task must appear in exactly one gate")

    acceptance_text = (CONTROL / "ACCEPTANCE_V1B.md").read_text(encoding="utf-8")
    acceptance_ids = set(re.findall(r"^\| (A\d{3}) \|", acceptance_text, re.MULTILINE))
    mapped = [item for task in tasks for item in task.get("acceptance", [])]
    if set(mapped) != acceptance_ids or len(mapped) != len(set(mapped)):
        fail("acceptance rows must map exactly once")

    required_interfaces = {
        "ResidentHandoffV1",
        "ResidentContinuityModeV1",
        "LocalContinuityCognitionRequestV1",
        "LocalContinuityCognitionResultV1",
        "PromptSource::Continuity",
    }
    spec = (CONTROL / "V1B_BUILD_SPEC.md").read_text(encoding="utf-8")
    absent = sorted(required_interfaces - set(filter(lambda name: name in spec, required_interfaces)))
    if absent:
        fail(f"build spec missing interfaces: {', '.join(absent)}")

    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", graph["baseline_commit"], "HEAD"],
        cwd=ROOT,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        fail("HEAD does not descend from the approved baseline")

    print("V1B control validation: PASS")


if __name__ == "__main__":
    main()

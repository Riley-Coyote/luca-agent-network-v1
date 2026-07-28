#!/usr/bin/env python3
"""Validate Luca V1 task ownership from the target-local vendored kit.

This deliberately checks planning contracts and changed-path ownership only.
It never executes product code, opens live data, or modifies the worktree.
"""

from __future__ import annotations

import argparse
import fnmatch
import itertools
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ModuleNotFoundError as exc:  # pragma: no cover - environment diagnostic
    raise SystemExit("PyYAML is required; use the repository Hermit Python environment") from exc


ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / ".codex" / "luca-v1"
CAPSULES = KIT / "TASK_CAPSULE_CATALOG.yaml"
GRAPH = KIT / "TASK_GRAPH.yaml"
F04_TEST = "desktop/tests/e2e/luca/f04.spec.ts"
F03_PLAYWRIGHT_CONFIG = "desktop/playwright.config.ts"
F10_ACP_TEST = "cargo test -p buzz-acp luca_f10"
F13_BOOTSTRAP = {"Cargo.toml", "Cargo.lock", "desktop/src-tauri/Cargo.toml", "desktop/src-tauri/Cargo.lock", "crates/buzz-acp/Cargo.toml", "crates/luca-diagnostics/Cargo.toml", "crates/luca-signing-client/Cargo.toml"}
M1_AUTHORITY_MUTEX = "m1_authority_integration"


def load_yaml(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def matches(path: str, pattern: str) -> bool:
    normalized = path.replace("\\", "/").lstrip("./")
    pattern = pattern.replace("\\", "/").lstrip("./")
    if pattern.endswith("/**"):
        return normalized.startswith(pattern[:-3])
    return fnmatch.fnmatchcase(normalized, pattern)


def changed_paths(base: str, candidate: str) -> list[str]:
    command = ["git", "diff", "--name-only", base, candidate]
    completed = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=True)
    return [line for line in completed.stdout.splitlines() if line]


def capsule_by_id(capsules: list[dict[str, Any]], task_id: str) -> dict[str, Any]:
    for capsule in capsules:
        if not capsule.get("id", "").startswith("F"):
            continue
        if capsule.get("id") == task_id:
            return capsule
    raise ValueError(f"unknown task {task_id}")


def ownership_errors(capsule: dict[str, Any], paths: list[str]) -> list[str]:
    owns = capsule.get("owns", {})
    includes = owns.get("include", [])
    forbids = owns.get("forbid", [])
    errors: list[str] = []
    for path in paths:
        if any(matches(path, pattern) for pattern in forbids):
            errors.append(f"forbidden path changed: {path}")
        elif not any(matches(path, pattern) for pattern in includes):
            errors.append(f"unowned path changed: {path}")
    return errors


def depends_transitively(
    task_id: str, dependency_id: str, graph_tasks: dict[str, dict[str, Any]]
) -> bool:
    pending = list(graph_tasks.get(task_id, {}).get("depends_on", []))
    seen: set[str] = set()
    while pending:
        current = pending.pop()
        if current == dependency_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        pending.extend(graph_tasks.get(current, {}).get("depends_on", []))
    return False


def exact_ownership_errors(
    capsules: list[dict[str, Any]], graph_document: dict[str, Any]
) -> list[str]:
    errors: list[str] = []
    ownership_policy = graph_document.get("ownership_policy", {})
    overlap_allowlist = {
        frozenset(pair)
        for pair in ownership_policy.get("overlap_allowlist", [])
        if isinstance(pair, list) and len(pair) == 2
    }
    graph_tasks = {
        task["id"]: task
        for task in graph_document.get("tasks", [])
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    exact_owners: dict[str, list[dict[str, Any]]] = {}
    for capsule in capsules:
        for path in capsule.get("owns", {}).get("include", []):
            if "*" not in path and not path.startswith("evidence/"):
                exact_owners.setdefault(path, []).append(capsule)
    for path, owners in sorted(exact_owners.items()):
        if len(owners) <= 1:
            continue
        for left, right in itertools.combinations(owners, 2):
            left_mutex = left.get("ownership_mutex")
            right_mutex = right.get("ownership_mutex")
            task_pair = frozenset((left["id"], right["id"]))
            same_mutex = left_mutex is not None and left_mutex == right_mutex
            if same_mutex:
                continue
            if task_pair in overlap_allowlist:
                ordered = depends_transitively(left["id"], right["id"], graph_tasks) or depends_transitively(
                    right["id"], left["id"], graph_tasks
                )
                if not ordered:
                    errors.append(
                        "explicit ownership overlap is not dependency ordered: "
                        f"{path} ({left['id']}, {right['id']})"
                    )
                continue
            if task_pair not in overlap_allowlist:
                errors.append(
                    "exact ownership collision without shared mutex or explicit "
                    f"overlap approval: {path} ({left['id']}, {right['id']})"
                )
    return errors


def mutex_audit(
    capsules: list[dict[str, Any]], graph_document: dict[str, Any]
) -> list[str]:
    errors = exact_ownership_errors(capsules, graph_document)
    f04 = capsule_by_id(capsules, "F04")
    f04_owned = f04.get("owns", {}).get("include", [])
    if F04_TEST not in f04_owned:
        errors.append(f"F04 must own its declared Playwright test: {F04_TEST}")
    f03 = capsule_by_id(capsules, "F03")
    if F03_PLAYWRIGHT_CONFIG not in f03.get("owns", {}).get("include", []):
        errors.append(f"F03 must own Luca Playwright registration: {F03_PLAYWRIGHT_CONFIG}")
    f10 = capsule_by_id(capsules, "F10")
    if F10_ACP_TEST not in f10.get("tests", []):
        errors.append("F10 must retain its frozen ACP test target")
    f13 = capsule_by_id(capsules, "F13")
    if not F13_BOOTSTRAP.issubset(set(f13.get("owns", {}).get("include", []))):
        errors.append("F13 must own the complete M1 workspace bootstrap")
    for task_id in ("F14", "F19", "F15", "F10", "F09"):
        if capsule_by_id(capsules, task_id).get("ownership_mutex") != M1_AUTHORITY_MUTEX:
            errors.append(f"{task_id} must use the serialized M1 authority integration mutex")
    for task_id, test_path in (("F18", "crates/buzz-acp/tests/luca_f18.rs"), ("F15", "crates/buzz-acp/tests/luca_f15.rs")):
        if test_path not in capsule_by_id(capsules, task_id).get("owns", {}).get("include", []):
            errors.append(f"{task_id} must own its focused ACP test seam")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", help="validate changed paths against one task capsule")
    parser.add_argument("--base", help="git base revision for --task")
    parser.add_argument("--candidate", default="HEAD", help="git candidate revision (default: HEAD)")
    parser.add_argument("--audit", action="store_true", help="run deterministic ownership/mutex audit")
    args = parser.parse_args()

    if not CAPSULES.is_file() or not GRAPH.is_file():
        print("FAIL: vendored Luca V1 graph/capsules are missing", file=sys.stderr)
        return 2
    capsule_document = load_yaml(CAPSULES)
    graph_document = load_yaml(GRAPH)
    capsules = capsule_document.get("task_capsules") if isinstance(capsule_document, dict) else None
    graph = graph_document.get("tasks") if isinstance(graph_document, dict) else None
    if not isinstance(capsules, list) or not isinstance(graph, list):
        print("FAIL: vendored task graph/capsules have an unexpected structure", file=sys.stderr)
        return 2
    capsule_ids = {item.get("id") for item in capsules}
    graph_ids = {item.get("id") for item in graph}
    errors = [] if capsule_ids == graph_ids else ["task graph and capsule IDs differ"]

    if args.audit:
        errors.extend(mutex_audit(capsules, graph_document))
        print(f"AUDIT: {len(capsules)} capsules; F04/F10 execution seams checked")

    if args.task:
        if not args.base:
            parser.error("--task requires --base")
        try:
            capsule = capsule_by_id(capsules, args.task)
            paths = changed_paths(args.base, args.candidate)
        except (ValueError, subprocess.CalledProcessError) as exc:
            print(f"FAIL: {exc}", file=sys.stderr)
            return 2
        errors.extend(ownership_errors(capsule, paths))
        print(f"TASK: {args.task}; changed paths: {len(paths)}")

    if not args.audit and not args.task:
        parser.error("choose --audit and/or --task")
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("LUCA CONTRACT VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Task-graph-driven control plane for bounded Luca build swarms.

The checked-in task graph and capsule catalog remain authoritative. Mutable
claims live in the repository's common Git directory so worktrees coordinate
without adding a second tracked project state.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import subprocess
import sys
from typing import Any, Callable, Iterator

import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
KIT_ROOT = REPO_ROOT / ".codex" / "luca-v1"
GRAPH_PATH = KIT_ROOT / "TASK_GRAPH.yaml"
CATALOG_PATH = KIT_ROOT / "TASK_CAPSULE_CATALOG.yaml"
SATISFIED_STRICT = {"integrated_pass", "gate_pass"}
SATISFIED_BUILD = SATISFIED_STRICT | {
    "integrated_pending_receipt",
    "integrated_invalid_receipt",
}


def load_yaml(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path}: expected an object")
    return value


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def git(*args: str, cwd: Path = REPO_ROOT, check: bool = True) -> str:
    process = subprocess.run(
        ["git", *args], cwd=cwd, text=True, capture_output=True, check=False
    )
    if check and process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip())
    return process.stdout.strip()


def resolve_commit(value: str) -> str | None:
    output = git("rev-parse", "--verify", f"{value}^{{commit}}", check=False)
    return output if len(output) == 40 else None


def is_ancestor(ancestor: str, candidate: str) -> bool:
    return subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, candidate],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    ).returncode == 0


def is_patch_equivalent(commit: str, candidate: str) -> bool:
    """Return true when a single task commit was cherry-picked into candidate."""
    process = subprocess.run(
        ["git", "cherry", candidate, commit, f"{commit}^"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return process.returncode == 0 and process.stdout.startswith("- ")


def task_maps() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    graph = load_yaml(GRAPH_PATH)
    catalog = load_yaml(CATALOG_PATH)
    tasks = {item["id"]: item for item in graph.get("tasks", [])}
    capsules = {item["id"]: item for item in catalog.get("task_capsules", [])}
    return tasks, capsules


def expected_outputs(capsule: dict[str, Any]) -> list[str]:
    return [item["name"] for item in capsule.get("output_bindings", [])]


def result_path(task: dict[str, Any]) -> Path:
    return REPO_ROOT / "evidence" / task["milestone"] / task["id"] / "results.json"


def classify_result(
    result: dict[str, Any] | None,
    outputs: list[str],
    commit_relation: Callable[[str], str],
) -> str:
    """Classify implementation state without treating prose as completion."""
    if result is None:
        return "missing"
    actual_outputs = [item.get("name") for item in result.get("outputs", [])]
    if set(actual_outputs) != set(outputs):
        return "stale_contract"
    raw_commit = result.get("candidate_commit")
    if not isinstance(raw_commit, str) or not raw_commit:
        return "invalid_candidate"
    relation = commit_relation(raw_commit)
    if relation == "invalid":
        return "invalid_candidate"
    if relation == "diverged":
        return "branch_candidate"
    if actual_outputs != outputs:
        return "integrated_invalid_receipt"
    if result.get("status") == "PASS":
        return "integrated_pass"
    return "integrated_pending_receipt"


def gate_state(task_id: str) -> str:
    verdict = load_json(REPO_ROOT / "evidence" / "gates" / task_id / "gate-verdict.json")
    return "gate_pass" if verdict and verdict.get("status") == "PASS" else "gate_missing"


def all_states(candidate: str) -> dict[str, str]:
    tasks, capsules = task_maps()
    resolved_candidate = resolve_commit(candidate)
    if not resolved_candidate:
        raise ValueError(f"cannot resolve candidate commit: {candidate}")

    def relation(raw: str) -> str:
        resolved = resolve_commit(raw)
        if not resolved:
            return "invalid"
        if is_ancestor(resolved, resolved_candidate) or is_patch_equivalent(
            resolved, resolved_candidate
        ):
            return "ancestor"
        return "diverged"

    states: dict[str, str] = {}
    for task_id, task in tasks.items():
        if task.get("type") == "gate":
            states[task_id] = gate_state(task_id)
            continue
        capsule = capsules.get(task_id, {})
        states[task_id] = classify_result(
            load_json(result_path(task)), expected_outputs(capsule), relation
        )
    return states


def common_git_dir() -> Path:
    raw = git("rev-parse", "--git-common-dir")
    path = Path(raw)
    return path if path.is_absolute() else (REPO_ROOT / path).resolve()


def control_dir() -> Path:
    return common_git_dir() / "luca-swarm"


@contextmanager
def locked_claims() -> Iterator[tuple[Path, dict[str, Any]]]:
    root = control_dir()
    root.mkdir(parents=True, exist_ok=True)
    lock_path = root / "claims.lock"
    claims_path = root / "claims.json"
    with lock_path.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        claims = load_json(claims_path) or {"schema": "luca.swarm-claims.v1", "claims": {}}
        if not isinstance(claims.get("claims"), dict):
            raise ValueError(f"{claims_path}: invalid claims object")
        yield claims_path, claims


def write_claims(path: Path, claims: dict[str, Any]) -> None:
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(claims, indent=2, sort_keys=True) + "\n")
    temp.replace(path)


def read_claims() -> dict[str, Any]:
    with locked_claims() as (_, claims):
        return claims


def satisfied_states(mode: str) -> set[str]:
    return SATISFIED_BUILD if mode == "build" else SATISFIED_STRICT


def frontier_data(milestone: str, candidate: str, mode: str) -> dict[str, Any]:
    tasks, capsules = task_maps()
    states = all_states(candidate)
    claims = read_claims().get("claims", {})
    satisfied = satisfied_states(mode)
    ready: list[str] = []
    blocked: dict[str, list[str]] = {}

    for task_id, task in tasks.items():
        if task.get("milestone") != milestone or task.get("type") == "gate":
            continue
        if states[task_id] in satisfied or task_id in claims:
            continue
        reasons = [
            f"dependency:{dependency}:{states.get(dependency, 'unknown')}"
            for dependency in task.get("depends_on", [])
            if states.get(dependency) not in satisfied
        ]
        mutex = capsules.get(task_id, {}).get("ownership_mutex")
        for claimed_id, claim in claims.items():
            if claim.get("mutex") == mutex:
                reasons.append(f"mutex:{mutex}:claimed_by:{claimed_id}")
        if reasons:
            blocked[task_id] = reasons
        else:
            ready.append(task_id)

    return {
        "schema": "luca.swarm-frontier.v1",
        "candidate_commit": resolve_commit(candidate),
        "milestone": milestone,
        "mode": mode,
        "ready": ready,
        "blocked": blocked,
        "states": {key: value for key, value in states.items() if tasks[key].get("milestone") == milestone},
        "claims": claims,
    }


def render_capsule(task_id: str) -> str:
    tasks, capsules = task_maps()
    if task_id not in tasks or task_id not in capsules:
        raise ValueError(f"unknown or unresolved task: {task_id}")
    task = tasks[task_id]
    capsule = capsules[task_id]

    def section(name: str, values: list[Any]) -> list[str]:
        return [name, *[f"- {value}" for value in values], ""]

    lines = [
        f"TASK {task_id}: {capsule['objective']}",
        f"MILESTONE: {task['milestone']}",
        f"MODEL: {task['model']} / {task['reasoning_effort']}",
        f"MUTEX: {capsule['ownership_mutex']}",
        f"DEPENDENCIES: {', '.join(task.get('depends_on', [])) or 'none'}",
        "",
    ]
    lines += section("FROZEN CONTRACTS", capsule.get("contracts", []))
    lines += section("SOURCE REFERENCES", capsule.get("source_refs", []))
    lines += section("OWNED PATHS", capsule.get("owns", {}).get("include", []))
    lines += section("FORBIDDEN PATHS", capsule.get("owns", {}).get("forbid", []))
    lines += section("REQUIRED OUTPUTS", expected_outputs(capsule))
    lines += section("IMPLEMENTATION CONTRACT", capsule.get("implementation_contract", []))
    lines += section("TESTS", capsule.get("tests", []))
    lines += section("STOP CONDITIONS", capsule.get("stop_conditions", []))
    lines += [
        "RETURN FORMAT",
        "- status: complete | blocked | needs_decision",
        "- commit: full SHA or none",
        "- changed: short file list",
        "- verified: commands with pass/fail",
        "- evidence: paths",
        "- risks: at most five bullets",
    ]
    return "\n".join(lines) + "\n"


def claim_task(task_id: str, owner: str, worktree: str, candidate: str, mode: str) -> dict[str, Any]:
    tasks, capsules = task_maps()
    if task_id not in tasks or task_id not in capsules:
        raise ValueError(f"unknown or unresolved task: {task_id}")
    frontier = frontier_data(tasks[task_id]["milestone"], candidate, mode)
    if task_id not in frontier["ready"]:
        reasons = frontier["blocked"].get(task_id, [f"state:{frontier['states'].get(task_id)}"])
        raise ValueError(f"task {task_id} is not ready: {', '.join(reasons)}")
    worktree_path = Path(worktree).resolve()
    if not worktree_path.is_dir() or not (worktree_path / ".git").exists():
        raise ValueError(f"not a Git worktree: {worktree_path}")

    with locked_claims() as (path, document):
        claims = document["claims"]
        mutex = capsules[task_id]["ownership_mutex"]
        for claimed_id, existing in claims.items():
            if existing.get("mutex") == mutex:
                raise ValueError(f"mutex {mutex} is already claimed by {claimed_id}")
        claim = {
            "owner": owner,
            "mutex": mutex,
            "worktree": str(worktree_path),
            "candidate_commit": frontier["candidate_commit"],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        claims[task_id] = claim
        write_claims(path, document)
        return claim


def release_task(task_id: str, owner: str | None, force: bool) -> None:
    with locked_claims() as (path, document):
        existing = document["claims"].get(task_id)
        if not existing:
            raise ValueError(f"task {task_id} is not claimed")
        if not force and existing.get("owner") != owner:
            raise ValueError(f"task {task_id} is owned by {existing.get('owner')}")
        del document["claims"][task_id]
        write_claims(path, document)


def close_check(task_id: str, candidate: str) -> list[str]:
    tasks, capsules = task_maps()
    if task_id not in tasks or task_id not in capsules:
        return [f"unknown or unresolved task: {task_id}"]
    task = tasks[task_id]
    capsule = capsules[task_id]
    resolved = resolve_commit(candidate)
    if not resolved:
        return [f"cannot resolve candidate commit: {candidate}"]
    result = load_json(result_path(task))
    errors: list[str] = []
    if not result:
        return [f"missing or invalid result: {result_path(task)}"]
    if result.get("status") != "PASS":
        errors.append("result status is not PASS")
    if result.get("candidate_commit") != resolved:
        errors.append("result is not bound to the exact candidate commit")
    if [item.get("name") for item in result.get("outputs", [])] != expected_outputs(capsule):
        errors.append("result outputs do not exactly match the capsule")
    commands = [item.get("command") for item in result.get("test_logs", [])]
    if commands != capsule.get("tests", []):
        errors.append("test command sequence does not exactly match the capsule")
    scan_ref = result.get("artifact_scan", {}).get("path")
    scan = load_json(REPO_ROOT / "evidence" / scan_ref) if isinstance(scan_ref, str) else None
    if not scan or scan.get("status") != "PASS" or scan.get("findings"):
        errors.append("artifact scan is missing, failed, or contains findings")
    review = load_json(result_path(task).with_name("review.json"))
    if not review or review.get("status") != "PASS":
        errors.append("independent PASS review is missing")
    else:
        executor = result.get("executor", {})
        reviewer = review.get("reviewer", {})
        if reviewer.get("id") == executor.get("id") or reviewer.get("independence_group") == executor.get("independence_group"):
            errors.append("reviewer is not independent of the executor")
        for finding in review.get("findings", []):
            if finding.get("severity") in {"P0", "P1"} and finding.get("status") != "CLOSED":
                errors.append(f"open {finding.get('severity')} finding: {finding.get('id')}")
    return errors


def gate_readiness(gate_id: str, candidate: str) -> dict[str, Any]:
    tasks, _ = task_maps()
    if gate_id not in tasks or tasks[gate_id].get("type") != "gate":
        raise ValueError(f"not a gate task: {gate_id}")
    milestone = tasks[gate_id]["milestone"]
    checks: dict[str, list[str]] = {}
    for task_id, task in tasks.items():
        if task.get("milestone") == milestone and task.get("type") != "gate":
            errors = close_check(task_id, candidate)
            if errors:
                checks[task_id] = errors
    return {
        "schema": "luca.swarm-gate-readiness.v1",
        "gate": gate_id,
        "candidate_commit": resolve_commit(candidate),
        "ready": not checks,
        "task_errors": checks,
    }


def emit(value: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(value, indent=2, sort_keys=True))
    elif isinstance(value, str):
        print(value, end="" if value.endswith("\n") else "\n")
    else:
        print(json.dumps(value, indent=2, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    sub = root.add_subparsers(dest="command", required=True)

    frontier = sub.add_parser("frontier", help="show dependency- and mutex-safe work")
    frontier.add_argument("--milestone", default="M1")
    frontier.add_argument("--candidate", default="HEAD")
    frontier.add_argument("--mode", choices=("strict", "build"), default="strict")
    frontier.add_argument("--json", action="store_true")

    capsule = sub.add_parser("capsule", help="render one compact task capsule")
    capsule.add_argument("task")

    claims = sub.add_parser("claims", help="show active claims")
    claims.add_argument("--json", action="store_true")

    claim = sub.add_parser("claim", help="atomically claim a ready task and mutex")
    claim.add_argument("task")
    claim.add_argument("--owner", required=True)
    claim.add_argument("--worktree", required=True)
    claim.add_argument("--candidate", default="HEAD")
    claim.add_argument("--mode", choices=("strict", "build"), default="build")

    release = sub.add_parser("release", help="release a task claim")
    release.add_argument("task")
    release.add_argument("--owner")
    release.add_argument("--force", action="store_true")

    close = sub.add_parser("close-check", help="validate a candidate-bound task receipt")
    close.add_argument("task")
    close.add_argument("--candidate", default="HEAD")

    gate = sub.add_parser("gate-readiness", help="audit candidate-bound task closure for a gate")
    gate.add_argument("gate")
    gate.add_argument("--candidate", default="HEAD")
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "frontier":
            data = frontier_data(args.milestone, args.candidate, args.mode)
            emit(data, args.json)
        elif args.command == "capsule":
            emit(render_capsule(args.task), False)
        elif args.command == "claims":
            emit(read_claims(), args.json)
        elif args.command == "claim":
            emit(claim_task(args.task, args.owner, args.worktree, args.candidate, args.mode), True)
        elif args.command == "release":
            release_task(args.task, args.owner, args.force)
        elif args.command == "close-check":
            errors = close_check(args.task, args.candidate)
            emit({"task": args.task, "ready": not errors, "errors": errors}, True)
            return 1 if errors else 0
        elif args.command == "gate-readiness":
            data = gate_readiness(args.gate, args.candidate)
            emit(data, True)
            return 1 if not data["ready"] else 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

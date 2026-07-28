#!/usr/bin/env python3
"""Focused ownership-overlap tests for the Luca contract validator."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "evidence" / "validate_contracts.py"
SPEC = importlib.util.spec_from_file_location("validate_contracts", SCRIPT)
assert SPEC and SPEC.loader
validator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(validator)


def capsule(task_id: str, mutex: str | None, path: str) -> dict:
    return {
        "id": task_id,
        "ownership_mutex": mutex,
        "owns": {"include": [path]},
    }


class ContractOverlapTests(unittest.TestCase):
    def test_same_mutex_overlap_is_serialized(self) -> None:
        capsules = [
            capsule("B15", "acp_runtime", "crates/buzz-acp/src/queue.rs"),
            capsule("R05", "acp_runtime", "crates/buzz-acp/src/queue.rs"),
        ]
        self.assertEqual(validator.exact_ownership_errors(capsules, {}), [])

    def test_explicit_task_pair_allows_cross_mutex_overlap(self) -> None:
        capsules = [
            capsule("F14", "m1_authority_integration", "crates/buzz-acp/src/pool.rs"),
            capsule("B15", "acp_runtime", "crates/buzz-acp/src/pool.rs"),
        ]
        graph = {
            "tasks": [
                {"id": "F14", "depends_on": []},
                {"id": "G2", "depends_on": ["F14"]},
                {"id": "B15", "depends_on": ["G2"]},
            ],
            "ownership_policy": {"overlap_allowlist": [["F14", "B15"]]},
        }
        self.assertEqual(validator.exact_ownership_errors(capsules, graph), [])

    def test_three_owner_overlap_is_checked_pairwise(self) -> None:
        path = "crates/buzz-acp/src/queue.rs"
        capsules = [
            capsule("F14", "m1_authority_integration", path),
            capsule("B15", "acp_runtime", path),
            capsule("R05", "acp_runtime", path),
        ]
        graph = {
            "tasks": [
                {"id": "F14", "depends_on": []},
                {"id": "G2", "depends_on": ["F14"]},
                {"id": "B15", "depends_on": ["G2"]},
                {"id": "F09", "depends_on": ["F14"]},
                {"id": "R05", "depends_on": ["F09"]},
            ],
            "ownership_policy": {
                "overlap_allowlist": [["F14", "B15"], ["F14", "R05"]]
            },
        }
        self.assertEqual(validator.exact_ownership_errors(capsules, graph), [])

    def test_unapproved_cross_mutex_overlap_fails_closed(self) -> None:
        capsules = [
            capsule("F14", "m1_authority_integration", "crates/buzz-acp/src/pool.rs"),
            capsule("B15", "acp_runtime", "crates/buzz-acp/src/pool.rs"),
        ]
        errors = validator.exact_ownership_errors(capsules, {})
        self.assertEqual(len(errors), 1)
        self.assertIn("without shared mutex or explicit overlap approval", errors[0])

    def test_allowlisted_overlap_without_dependency_order_fails(self) -> None:
        capsules = [
            capsule("F14", "m1_authority_integration", "crates/buzz-acp/src/pool.rs"),
            capsule("B15", "acp_runtime", "crates/buzz-acp/src/pool.rs"),
        ]
        graph = {
            "tasks": [
                {"id": "F14", "depends_on": []},
                {"id": "B15", "depends_on": []},
            ],
            "ownership_policy": {"overlap_allowlist": [["F14", "B15"]]},
        }
        errors = validator.exact_ownership_errors(capsules, graph)
        self.assertEqual(len(errors), 1)
        self.assertIn("not dependency ordered", errors[0])


if __name__ == "__main__":
    unittest.main()

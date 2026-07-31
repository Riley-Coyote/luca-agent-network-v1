#!/usr/bin/env python3
"""Focused tests for the Luca swarm controller's fail-closed decisions."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "luca_swarm.py"
SPEC = importlib.util.spec_from_file_location("luca_swarm", SCRIPT)
assert SPEC and SPEC.loader
swarm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(swarm)


def result(status: str = "PASS", outputs: tuple[str, ...] = ("one",)) -> dict:
    return {
        "status": status,
        "candidate_commit": "a" * 40,
        "outputs": [{"name": name} for name in outputs],
    }


class ResultClassificationTests(unittest.TestCase):
    def test_contract_output_change_reopens_a_prior_pass(self) -> None:
        self.assertEqual(
            swarm.classify_result(result(), ["one", "new-proof"], lambda _: "ancestor"),
            "stale_contract",
        )

    def test_integrated_pending_receipt_is_not_a_strict_pass(self) -> None:
        state = swarm.classify_result(
            result(status="INTEGRATION_PENDING"), ["one"], lambda _: "ancestor"
        )
        self.assertEqual(state, "integrated_pending_receipt")
        self.assertNotIn(state, swarm.SATISFIED_STRICT)
        self.assertIn(state, swarm.SATISFIED_BUILD)

    def test_output_order_debt_does_not_force_reimplementation(self) -> None:
        state = swarm.classify_result(
            result(outputs=("two", "one")),
            ["one", "two"],
            lambda _: "ancestor",
        )
        self.assertEqual(state, "integrated_invalid_receipt")
        self.assertNotIn(state, swarm.SATISFIED_STRICT)
        self.assertIn(state, swarm.SATISFIED_BUILD)

    def test_diverged_candidate_does_not_unlock_work(self) -> None:
        self.assertEqual(
            swarm.classify_result(result(), ["one"], lambda _: "diverged"),
            "branch_candidate",
        )

    def test_exact_integrated_pass_unlocks_strict_work(self) -> None:
        state = swarm.classify_result(result(), ["one"], lambda _: "ancestor")
        self.assertEqual(state, "integrated_pass")
        self.assertIn(state, swarm.SATISFIED_STRICT)

    def test_invalid_json_or_commit_fails_closed(self) -> None:
        self.assertEqual(
            swarm.classify_result(None, ["one"], lambda _: "ancestor"), "missing"
        )
        self.assertEqual(
            swarm.classify_result(result(), ["one"], lambda _: "invalid"),
            "invalid_candidate",
        )


class CapsuleRenderingTests(unittest.TestCase):
    def test_capsule_is_bounded_and_contains_execution_controls(self) -> None:
        rendered = swarm.render_capsule("F09")
        self.assertIn("TASK F09:", rendered)
        self.assertIn("MUTEX: m1_authority_integration", rendered)
        self.assertIn("OWNED PATHS", rendered)
        self.assertIn("STOP CONDITIONS", rendered)
        self.assertNotIn("# Swarm Operating Model", rendered)


if __name__ == "__main__":
    unittest.main()

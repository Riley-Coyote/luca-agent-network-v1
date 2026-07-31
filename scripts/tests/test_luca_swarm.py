#!/usr/bin/env python3
"""Focused tests for the Luca swarm controller's fail-closed decisions."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


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
            result(status="INTEGRATION_PENDING", outputs=("two", "one")),
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

    def test_failed_receipt_never_unlocks_build_mode(self) -> None:
        state = swarm.classify_result(
            result(status="FAIL"), ["one"], lambda _: "ancestor"
        )
        self.assertEqual(state, "failed_receipt")
        self.assertNotIn(state, swarm.SATISFIED_BUILD)

    def test_failed_reordered_receipt_never_unlocks_build_mode(self) -> None:
        state = swarm.classify_result(
            result(status="FAIL", outputs=("two", "one")),
            ["one", "two"],
            lambda _: "ancestor",
        )
        self.assertEqual(state, "failed_receipt")
        self.assertNotIn(state, swarm.SATISFIED_BUILD)


class CapsuleRenderingTests(unittest.TestCase):
    def test_capsule_is_bounded_and_contains_execution_controls(self) -> None:
        rendered = swarm.render_capsule("F09")
        self.assertIn("TASK F09:", rendered)
        self.assertIn("MUTEX: m1_authority_integration", rendered)
        self.assertIn("OWNED PATHS", rendered)
        self.assertIn("STOP CONDITIONS", rendered)
        self.assertNotIn("# Swarm Operating Model", rendered)


class WorktreeClaimTests(unittest.TestCase):
    def test_claim_rejects_unrelated_repository(self) -> None:
        candidate = "a" * 40
        with tempfile.TemporaryDirectory() as raw:
            worktree = Path(raw)
            (worktree / ".git").write_text("gitdir: elsewhere\n")

            def fake_git(*args: str, cwd: Path = swarm.REPO_ROOT, check: bool = True) -> str:
                if args[:2] == ("rev-parse", "--git-common-dir"):
                    return "/unrelated/.git" if cwd == worktree else "/expected/.git"
                if args[:2] == ("rev-parse", "--verify"):
                    return candidate
                if args[0] == "status":
                    return ""
                raise AssertionError(args)

            with patch.object(swarm, "git", side_effect=fake_git):
                errors = swarm.claim_worktree_errors(worktree, candidate)
        self.assertIn("worktree does not belong to this repository", errors)

    def test_claim_requires_exact_clean_candidate(self) -> None:
        candidate = "a" * 40
        with tempfile.TemporaryDirectory() as raw:
            worktree = Path(raw)
            (worktree / ".git").write_text("gitdir: linked\n")

            def fake_git(*args: str, cwd: Path = swarm.REPO_ROOT, check: bool = True) -> str:
                if args[:2] == ("rev-parse", "--git-common-dir"):
                    return "/expected/.git"
                if args[:2] == ("rev-parse", "--verify"):
                    return "b" * 40
                if args[0] == "status":
                    return " M owned-file"
                raise AssertionError(args)

            with patch.object(swarm, "git", side_effect=fake_git):
                errors = swarm.claim_worktree_errors(worktree, candidate)
        self.assertTrue(any("does not equal candidate" in item for item in errors))
        self.assertIn("worktree is not clean", errors)


class GateStateTests(unittest.TestCase):
    def test_gate_state_uses_canonical_evidence_validation(self) -> None:
        class RejectingValidator:
            @staticmethod
            def validate_gate_evidence(*_args: object) -> list[str]:
                return ["hash mismatch"]

        verdict = {"status": "PASS", "candidate_commit": "a" * 40}
        with (
            patch.object(swarm, "load_json", return_value=verdict),
            patch.object(swarm, "resolve_commit", return_value="a" * 40),
            patch.object(swarm, "is_ancestor", return_value=True),
            patch.object(swarm, "evidence_validator", return_value=RejectingValidator()),
        ):
            self.assertEqual(
                swarm.gate_state("G0", "b" * 40), "invalid_gate_receipt"
            )


if __name__ == "__main__":
    unittest.main()

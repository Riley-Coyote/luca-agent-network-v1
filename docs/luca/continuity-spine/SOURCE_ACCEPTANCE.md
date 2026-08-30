# Continuity spine source acceptance

Status: assurance lane prepared on `codex/continuity-assurance`

Authority: [`BUILD_SPEC.md`](BUILD_SPEC.md)

Scope: source-only, body-free deterministic evidence

## Purpose

This record defines the focused source evidence required before the continuity
spine can be described as source-tested. It does not record installed behavior,
Riley's experiential judgment, or completion of reflection, metabolism, or the
broader Mnemos engine.

The machine-readable contract is
[`../../../tests/luca-conformance/continuity/spine-v1.json`](../../../tests/luca-conformance/continuity/spine-v1.json).
The standalone kernel acceptance tests are
[`../../../crates/luca-continuity/tests/spine_acceptance.rs`](../../../crates/luca-continuity/tests/spine_acceptance.rs).

## Evidence map

| Contract | Deterministic source proof | Integration proof still owned elsewhere |
|---|---|---|
| Frozen protocols, limits, selection order, capture outcomes, and deferrals | `frozen_spine_fixture_matches_the_approved_contract` | Core canonical protocol-vector parsing |
| Locked, unavailable, corrupt/invalid, timeout, Disabled/empty continuity never blocks ordinary generation | `every_frozen_fail_open_state_returns_a_body_free_result_without_a_packet` covers the pure resolver statuses and deadline | Host managed-dispatch tests cover Disabled mode and ordinary generation continuation |
| Exact owner-resident namespace isolation and structural Owner Brain separation | `resident_private_scope_is_exact_and_owner_brain_cannot_alias_it` | Core Wake canary mapping and Host prompt-section projection |
| Pinned owner correction cannot be automatically reversed | `pinned_correction_blocks_automatic_reversal_and_forget_survives_restart` | Host stale-job completion without mutation |
| Forget removes active retrieval and survives purge, restart, and replay | `pinned_correction_blocks_automatic_reversal_and_forget_survives_restart` | Host pending/running job cancellation |
| Operational surfaces remain body-free | `operational_debug_and_fixture_receipts_are_body_free` | Host logs, job rows, delivery receipts, and error projections |

## Commands

Run from the exact integrated candidate:

```bash
. ./bin/activate-hermit
cargo test -p luca-continuity --test spine_acceptance
cargo fmt --check -p luca-continuity
cargo clippy -p luca-continuity --test spine_acceptance -- -D warnings
git diff --check
```

Then run the complete focused source gate frozen in `BUILD_SPEC.md` after Core
and Host commits are integrated. A test filter that selects no intended test is
not evidence and must be replaced by the smallest exact target.

## Integration wiring checklist

The assurance fixture intentionally does not invent Phase 1 APIs before they
exist. When the Wake compiler lands, the integration owner must bind the same
fixture to the actual strict protocol types and add or retain deterministic
proof for:

- byte-identical Wake and body-free receipt for the same snapshot and cue;
- complete UTF-8 item admission and mandatory-category budget behavior;
- exact relationship `scope_ref` from `resident_notebook_address`;
- resident canaries appearing only in their matching Wake packet;
- Brain denial/revocation leaving resident-private Wake available;
- Owner Brain appearing only in `owner_brain_references`;
- a `changes` capture result reaching `unsupported_spine_outcome` with no write;
- malformed/wrong-source capture reaching `invalid_handoff_result` with no retry;
- failed, cancelled, interrupted, rejected, provisional, and unpublished turns
  creating no capture job;
- one finalized event producing one logical job and at most one handoff mutation.

These are integration requirements, not deferrals. This assurance commit is
complete when its standalone fixture and current stable-boundary tests pass; the
spine is complete only after every Core, Host, source, and installed gate in the
approved specification passes on one exact unified-branch candidate.

## Verdict vocabulary

- **Prepared:** fixture and standalone acceptance tests exist.
- **Source-tested:** all focused Core, Host, and assurance gates pass on one
  exact integrated commit.
- **Installed-tested:** the bounded installed walkthrough is recorded by the
  integration owner.
- **Riley-accepted:** Riley explicitly approves the felt continuity behavior.

This document may record the first three states only with exact evidence. It
must never infer Riley acceptance from source or installed tests.

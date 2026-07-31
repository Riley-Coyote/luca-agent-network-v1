# Luca V1 Vendored-Kit Corrections

This directory vendors the authorized V5 planning artifacts so task execution
can be checked from the target repository. It is not an authority to broaden
product scope. Each entry below is a narrow, auditable correction to a copied
artifact; the authoritative kit remains unchanged.

## 2026-07-22 — G0 architecture status

- Copied file: `ARCHITECTURE_IMPLEMENTATION_SPEC.md`
- Authoritative text: `Status: implementation contract, pending final G0 evidence reconciliation`
- Local correction: `Status: implementation contract; canonical G0 evidence PASS verified`
- Rationale: `G0_VERDICT.md` in the same authorized kit records PASS and
  implementation authorization. The old status line was stale at dispatch.
- Scope: status line only; no architecture rule or invariant changed.

## 2026-07-22 — F04 Playwright ownership

- Copied file: `TASK_CAPSULE_CATALOG.yaml`, F04 `owns.include`
- Authoritative omission: F04 requires
  `pnpm --dir desktop exec playwright test tests/e2e/luca/f04.spec.ts --project=smoke`
  but does not own `desktop/tests/e2e/luca/f04.spec.ts`.
- Local correction: add exactly `desktop/tests/e2e/luca/f04.spec.ts` to F04's
  owned paths.
- Rationale: the named test must be created or maintained by F04; without this
  narrow ownership entry the task cannot satisfy its own frozen test contract.
- Scope: this does not grant ownership of any other desktop test or shared
  testing infrastructure.

## 2026-07-22 — F03 Playwright project registration

- Copied file: `TASK_CAPSULE_CATALOG.yaml`, F03 `source_refs` and `owns.include`
- Authoritative omission: the smoke project does not match
  `desktop/tests/e2e/luca/f04.spec.ts`, and no M1 task owns the required
  `desktop/playwright.config.ts` registration.
- Local correction: assign exactly `desktop/playwright.config.ts` to F03, the
  first M1 task that introduces and executes a Luca smoke spec.
- Rationale: this is test-runner plumbing needed for F03's already frozen
  Playwright command and for later M1 Luca E2E specs to enter the smoke suite.
- Scope: no product behavior, browser configuration outside the Luca match, or
  unrelated test path is assigned.

## 2026-07-22 — F10 ACP test seam

- Copied file: `TASK_CAPSULE_CATALOG.yaml`, F10 `tests`
- Authoritative mismatch: F10's frozen command targets `buzz-acp`, but it did
  not own a narrow ACP test seam.
- Local correction: retain the authoritative command and assign exactly
  `crates/buzz-acp/tests/luca_f10.rs` to F10.
- Rationale: the targeted ACP test can now exercise the fault contract without
  changing the frozen capsule test sequence.
- Scope: test seam only.

## 2026-07-22 — M1 manifest and module registration ownership

- Copied file: `TASK_CAPSULE_CATALOG.yaml`, F13/F18/F14/F15/F09/F10/F19
- Local correction: F13 alone owns the complete M1 workspace/desktop/ACP
  manifest and lock bootstrap. F14 initializes the desktop Luca module registry, while F15, F10
  and F19 serialize later entries through `m1_authority_integration`. F09 owns
  the ACP publisher extension under that same conservative M1 mutex.
- Rationale: every M1 crate and Rust module now has an execution path without
  unowned manifest edits or implicit module registration.
- Scope: build/registration plumbing only; no authority or product behavior is
  changed.

## 2026-07-22 — Signing broker result reconciliation

- Copied file: `SIGNING_BROKER_SPEC.md`; local companion:
  `M1_PROTOCOL_CONSTANTS.md`.
- Local correction: freeze the body-free ACP result and the exact M1 bounds,
  identity, idempotency, diagnostic and synthetic-vector rules in the companion.
- Rationale: exact event JSON remains exclusively in the desktop outbox.
- Scope: contract reconciliation only; no new capability or scope is added.

## 2026-07-22 — Self-contained planning validator and serialized bootstrap seams

- Copied files: the remaining normative V5 contract documents,
  `scripts/validate_planning_kit.py`, and its unit tests.
- Authoritative omission: task receipts required
  `python3 scripts/validate_planning_kit.py`, but the fork did not contain that
  path and the vendored contract directory omitted documents required by the
  validator.
- Local correction: install the canonical validator and tests, point its
  structural root at `.codex/luca-v1`, and vendor the required normative
  documents without changing their content. F02 owns these execution-control
  files.
- Ownership reconciliation: explicitly allow only the four known sequential
  bootstrap seam pairs (`F13/F18`, `F13/F14`, `F14/R05`, `F09/R05`) that the
  local M1 manifest correction introduced. Their dependency order and existing
  task mutexes remain mandatory; this is not permission for concurrent writes.
- Rationale: planning and gate evidence must be reproducible from the fork,
  never from an undeclared external working directory.
- Scope: evidence and scheduler integrity only; no product or authority scope
  is added.

## 2026-07-27 — F14 managed-identity execution boundary

- Approved amendment: `F14_OPTION1_AMENDMENT.md`.
- Copied files corrected: `TASK_GRAPH.yaml`, `TASK_CAPSULE_CATALOG.yaml`,
  `PROOF_TRACE_MATRIX.yaml`, `SIGNING_BROKER_SPEC.md`,
  `ARCHITECTURE_IMPLEMENTATION_SPEC.md`, `SECURITY_THREAT_MODEL.md`,
  `TARGET_CODE_MAP.md`, `M1_PROTOCOL_CONSTANTS.md`,
  `OPEN_CONTRACT_DEFECTS.md`, `BUILD_START_PROMPT_HIGH.md` and
  `00_START_HERE.md`.
- Authoritative contradiction: F14 had to remove the raw resident key before
  `Config::from_cli`, but did not own `config.rs`, `relay.rs`, `pool.rs` or
  `setup_mode.rs`, `queue.rs` or the desktop reserved-environment seam; its
  focused test also named the F09-owned final publisher even though F09 depends
  on F14.
- Local correction: reopen F13 for the sole-writer
  `relay_auth.sign.v1` schema/vector repair; expand F14 to the exact ACP
  key-consuming seams; freeze `Legacy(Keys)` versus
  `Managed(public identity + typed desktop broker)`; return final-publisher
  ownership and proof entirely to F09. Serialize F14's `pool.rs` repair before
  B15's later G2-dependent continuity integration through the explicit
  `[F14, B15]` overlap entry.
- Claim correction: F14/G1 proves desktop-local installation/session binding
  and key isolation. Remote relay admission/revocation of an old installation
  remains a later managed-coordinator proof. The F14 output is renamed from
  `installation_attestation` to `local_broker_session_binding` so the receipt
  cannot be mistaken for the deferred server-side claim.
- Rationale: this is the owner-approved Option 1 response to a documented
  authority/security stop. It preserves the original no-key-in-ACP invariant
  and avoids inventing unplanned relay/database authority during M1.
- Scope: execution ownership, dependency proof and claim timing only. No
  conductor, new product feature or wider signing authority is added.
- Independent review repair: distinguish the managed ACP host's one typed
  broker stream from the complete absence of broker capability in provider,
  model and tool descendants. Add `broker_transport_isolation` as a bound F14
  output so stdin-only transport, close-on-exec duplication, replacement child
  stdin, bootstrap scrubbing and negative nested-descendant FD/argv/environment
  inspection are executable acceptance evidence rather than narrative.
- F13 review repair: require cryptographic and request-bound NIP-42/NIP-98
  results, sealed operation/payload coupling, NIP-98 POST body hash, nonce and
  60-second expiry, and one optional resident-verified NIP-OA owner attestation
  for Buzz's existing closed-relay delegation path. No arbitrary signing or tag
  surface is introduced.
- Validator repair: make the task contract audit consume the authoritative
  task-pair overlap allowlist, verify every owner pair, and require each
  cross-mutex exception to be transitively dependency ordered. Remove the
  hard-coded path bypass; the repository audit and five focused overlap tests
  now pass.

## 2026-07-30 — F09 exact relay idempotency

- Approved amendment: `F09_RELAY_IDEMPOTENCY_AMENDMENT.md`.
- Copied files corrected: `TASK_CAPSULE_CATALOG.yaml` and
  `PROOF_TRACE_MATRIX.yaml`.
- Authoritative contradiction: F09 required exact-byte restart recovery but
  treated access-filtered `/query` as proof that an event was absent. Current
  membership can hide an accepted event, while an absent retained event becomes
  too old for normal ingest after fifteen minutes.
- Local correction: make existing `POST /events` acknowledge an authenticated
  author's tenant-scoped, already-stored, byte-exact kind-9 event before current
  membership and freshness checks. New or nonexact events retain every existing
  relay policy. Add the relay bridge, a purpose-specific strict tenant-scoped
  DB lookup with no migration, and the focused relay E2E seam to F09 ownership.
- Rationale: this is the smallest way to preserve one immutable signed final,
  honest response-loss recovery, and at-most-once chronology without a new
  endpoint, migration, query bypass, or re-signing.
- Scope: exact duplicate acknowledgment plus its tests. It does not authorize
  new event ingestion, disclose stored content, weaken tenant binding, or widen
  resident/model authority.

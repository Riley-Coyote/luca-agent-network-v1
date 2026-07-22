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

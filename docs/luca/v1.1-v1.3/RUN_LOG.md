# V1.1-V1.3 run log

This log records planning, implementation checkpoints, ownership transfers,
focused checks, installed demonstrations, blockers, and release verdicts. It
must remain body-free and secret-free.

## 2026-08-06 — Roadmap package created

- Planning branch: `agent/v1.1-v1.3-roadmap`
- Planning baseline: `36472636af120cb3213dcae84b3ff5827a7c8e93`
- Product implementation: not started
- Source authorities reviewed:
  - functional-beta build contract, task graph, acceptance, verdict, and handoff;
  - continuity audit adopt/adapt/reject and V1 boundary;
  - accepted G2 protocol, encrypted kernel, pre-turn, and Capsule contracts;
  - Mnemos hypomnema and Polyphonic reflection/consolidation findings captured in
    the repository audit.
- Scope selected:
  - V1.1 resident notebook;
  - V1.2 narrow owner-brain sources and grants;
  - V1.3 manual resident-authored reflection.
- Product code changed: no
- Native app rebuilt: no

## Pending C00

- Exact accepted frontend/design commits: pending Riley/Claude handoff
- Overlap audit: pending
- Implementation branch/worktree: pending
- Functional-beta baseline smoke: pending

## 2026-08-06 — V1.1 implementation authorized

- Branch: `agent/v1.1-resident-notebook`
- Product baseline: `36472636af120cb3213dcae84b3ff5827a7c8e93`
- Roadmap control commit cherry-picked: `d72207d8`
- Sequence: backend-first; frontend integration deferred
- Added scope: manually requested resident-authored Markdown journal pages
- Journal authorship: resident body cannot be directly owner-edited; owner
  annotations and revision requests remain separate
- Journal recall: never automatic in ordinary chat
- Product implementation at this entry: not yet started

## Receipt template

For every task append:

```text
Task:
Owner/lane:
Base commit:
Owned paths:
Dependencies validated:
Implementation commit:
Focused checks:
Visual/native evidence:
Security/privacy evidence:
Reviewer:
Repair count:
Status: PASS | FAIL | BLOCKED
Safe notes:
```

## 2026-08-06 — V1.1 backend implementation checkpoint

- Branch: `agent/v1.1-resident-notebook`
- Base: `b3e5a88f`
- Tasks: H11-H16
- Product changes:
  - strict notebook and private-cognition protocol contracts;
  - encrypted resident-isolated memory notes, journal pages, annotations, and
    complete revisions;
  - one atomic handoff-plus-note metabolism commit;
  - a maximum of five memory notes in ordinary bounded recall;
  - journal pages and annotations excluded from automatic recall;
  - manual exact-resident journal cognition with body-free job state;
  - list/detail/history/lifecycle/journal commands and deterministic frontend
    fixtures;
  - renderer contract in `desktop/src/shared/api/tauriNotebook.ts`.
- Focused checks:
  - `cargo test -p luca-protocol --lib`: 8 passed;
  - `cargo test -p luca-continuity --lib`: 52 passed;
  - `cargo test -p buzz-acp --lib`: 617 passed;
  - focused signing startup regression: 2 passed;
  - `cargo clippy -p luca-protocol -p luca-continuity -p buzz-acp --all-targets -- -D warnings`: passed;
  - desktop clippy with warnings denied: passed;
  - desktop TypeScript typecheck and focused Biome check: passed.
- Full desktop suite first pass: 1752 passed, 13 ignored, 2 stale signing
  startup fixtures failed. Production source was byte-identical to the
  functional-beta baseline. The fixture was repaired to account for the
  already-required handoff-recorded terminal state; its two focused tests pass.
- Full desktop suite after that repair: 1753 passed, 13 ignored, with one
  unrelated macOS process-spawn test reporting a transient `ENOENT`. The exact
  isolated test passed immediately; no product source change was made for the
  environment-only failure.
- Production renderer build: passed (`tsc && vite build`).
- Privacy evidence:
  - journal scheduler schema contains no prompt, title, Markdown, body, or
    content columns;
  - unknown protocol fields and excessive bodies/counts fail closed;
  - ordinary context tests exclude journals and cap notes at five;
  - private body-bearing request/view types have no diagnostic `Debug` path.
- Real Hermes/OpenClaw proof: pending H17.
- Frontend and installed-app gates: intentionally deferred to H18/H19.

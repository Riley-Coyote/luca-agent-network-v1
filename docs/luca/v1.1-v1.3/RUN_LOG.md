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

## Historical C00 snapshot (resolved)

- These were the original preimplementation questions. The accepted design
  lineage, clean implementation worktrees, overlap audit, and functional-beta
  baseline were resolved during H11-H19. The final coordinates are recorded in
  `V1_1_VERDICT.md`.

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

## 2026-08-06 — H17 real-runtime backend and security gate

- Status: PASS
- Installed app: `Luca Agent Network Dev.app`
- Bundle identifier: `com.luca.agent-network.dev`
- Signing: stable Developer ID signature verified
- Real residents:
  - Hermes `default` (`35653885…c899`)
  - OpenClaw `main` (`09c26e21…5201`)
- DM proof:
  - each resident committed source-backed memory notes through its exact native
    runtime;
  - each resident was restarted under the same public key;
  - each fresh runtime received and correctly used Luca's private continuity
    reference while explicitly avoiding a native-session-resume claim.
- Group proof:
  - both residents responded in the same signed room chronology;
  - separate body-free jobs were bound to the same conversation and their own
    resident keys;
  - Hermes honestly returned `no_change` while OpenClaw committed only to its
    own namespace; no third-resident notebook mutation appeared.
- Living-journal proof:
  - an explicit owner request was submitted to each exact resident through the
    installed app's Tauri command boundary;
  - Hermes completed on attempt one and OpenClaw completed through the single
    bounded automatic retry;
  - one encrypted journal record exists in each resident namespace;
  - no journal chat event was published.
- Evidence-based repairs:
  - legacy managed-outbox canonicality now validates the original raw JSON
    before typed defaults are introduced;
  - owner-pinned handoff corrections no longer suppress independent valid
    memory-note commits;
  - private native cognition remains bounded but now allows a 180-second
    provider cold start.
- Security/privacy:
  - continuity and journal databases passed SQLite integrity checks;
  - the journal-job schema contains no prompt, title, Markdown, or body column;
  - private journal prompt fragments were absent from continuity files and the
    application log;
  - private journal prompt/job canaries were absent from stored relay events;
  - installed continuity tables expose ciphertext envelopes and minimized
    metadata only.
- Focused Rust, clippy, formatting, renderer typecheck/build, compatibility,
  and prior full desktop checks are recorded in H17's receipt.
- Production notebook UI: still intentionally deferred to Claude/H18.
- Installed release UX gate: still intentionally deferred to H19 after H18.

## 2026-08-06 — H18 notebook interface specification

- Status: specification complete; frontend implementation remains pending.
- Added `NOTEBOOK_INTERFACE_SPEC.md` as the product-facing H18 design authority.
- Reconciled the V1.1 product contract, frozen renderer API, deterministic
  fixtures, current resizable resident inspector, and Luca/Mnemos design
  language into one implementation brief for Claude.
- No product source, backend contract, migration, manifest, lockfile, or fixture
  behavior changed.

## 2026-08-08 — H18/H19 integrated completion and release promotion

- Status: PASS
- Canonical release branch: `luca/v1.1`
- Integrated implementation checkpoint: `80890a85`
- The production Notebook drawer, deterministic Notebook Field, and unified
  Luca Agent Library were integrated without changing the encrypted Notebook
  command authority.
- The installed application loaded real resident and Notebook state, opened the
  compact conversation resident projection, and completed live Hermes and
  OpenClaw mixed-room reply verification.
- Closeout rerun: frontend typecheck passed; focused Notebook and Agent Library
  unit tests passed 9/9; E2E production build passed; focused Playwright smoke
  passed 2/2.
- The accepted lineage was promoted from the implementation branch to the clean
  `luca/v1.1` release coordinate. The older dirty runtime/design checkout was
  preserved untouched.
- Release verdict: `V1_1_VERDICT.md`.

## 2026-08-08 — V1.2 scoped Brain implementation candidate

- Status: B21-B26 PASS; B27 BLOCKED on an unlocked native UI session.
- Branch: `codex/unified-brain-v1-2`
- Baseline: `34989f9` (`luca/v1.1`)
- Product checkpoint: `d633e92`
- Provider-capture regression checkpoint: `9f69b6c` (test-only; no executable
  source change after the installed product checkpoint)
- Implemented:
  - strict source, import, grant, receipt, and renderer contracts;
  - zero-write local preview for selected Markdown/text files and folders;
  - atomic encrypted import, rollback, deduplication, and changed-source diff;
  - explicit per-source resident grants, revocation, stale binding/egress
    behavior, and reconfirmation;
  - grant-first bounded retrieval with body-free receipts and a terminal
    dispatch recheck;
  - narrow Brain Setup import, source, grant, provenance, degraded, and mobile
    surfaces.
- Focused evidence:
  - protocol Brain vectors: 2 passed;
  - desktop Owner Brain suite: 15 passed;
  - managed continuity transport: 5 passed;
  - continuity-absent Hermes/OpenClaw DM and mixed-room regression: 1 passed;
  - desktop clippy with warnings denied: passed;
  - renderer typecheck and production build: passed;
  - affected Brain/Luca Playwright smoke: 8 passed;
  - provider capture contains the authorized selected chunk and excludes source
    paths, grant/source identifiers, rejected/private sentinels, and every
    non-ready Owner Brain layer.
- Installed evidence:
  - the product checkpoint was rebuilt, atomically installed, Developer-ID
    signed, registered, relaunched, and remained running;
  - bundle ID is `com.luca.agent-network.dev`;
  - installed executable SHA-256 is
    `7b426cfc7f1be53c016cd08df7def057f7ed399339588d5da479d8554a1b3ede`;
  - selected Hermes and OpenClaw config, identity, memory, and schedule hashes
    were byte-identical before and after rebuild/relaunch.
- Environment blocker:
  - macOS locked before the installed Brain screen and real Hermes/OpenClaw
    authorization matrix could be exercised;
  - A211 and A402 therefore remain unclaimed;
  - the final `just ci` invocation required by A405 was intentionally not spent
    before native completion.
- Release verdict: `V1_2_VERDICT.md`.

## 2026-08-08 — V1.2 installed authorization continuation

- The installed Brain Setup surface imported a disposable Markdown source
  through the native picker after a zero-write preview. Its SHA-256 remained
  `86f3d22fb2853515f24768a4478b9d9b173c6652a59e2a799641383d2e842747`
  before and after import and the complete demo.
- Real Hermes `default` and OpenClaw `main` residents were granted independently
  and each returned the corpus-only values `Cedar Meridian` and `4729-Aster`.
  The ungranted Luca resident could not surface either value.
- Brain Setup displayed separate body-free ready and denied receipts. Receipt
  activity cleared on relaunch as specified by the frozen process-memory-only
  retention contract.
- Hermes revocation required explicit confirmation and excluded Owner Brain
  content on its next turn while OpenClaw's grant remained active.
- Relaunch preserved one indexed source plus revoked/active/absent grant state.
  All native residents returned ready and Hermes/OpenClaw completed an ordinary
  mixed-room reply smoke.
- Strict deep signature verification still passes for
  `com.luca.agent-network.dev`; executable SHA-256 is
  `7b426cfc7f1be53c016cd08df7def057f7ed399339588d5da479d8554a1b3ede`.
- The selected Hermes/OpenClaw config, memory, model, and schedule snapshot was
  byte-identical before and after the complete installed flow.
- The first repository-gate invocation found one Clippy simplification in the
  new receipt validator. Commit `4ae6370` applies the semantics-preserving fix;
  strict focused Clippy and all 5 Brain protocol vectors pass afterward.
- The final-state `just ci` confirmation passes workspace formatting and strict
  workspace Clippy, then stops at the desktop file-size guard. Fourteen reported
  files already exceeded their configured limits at baseline `34989f9`; the new
  V1.2 `owner_brain_store.rs` is 2,697 lines against the 1,000-line default.
- No guard limit or exception was changed. B27 and A405 remain blocked pending a
  real Brain store split and reconciliation of inherited guard debt.
- Release verdict: `V1_2_VERDICT.md`.

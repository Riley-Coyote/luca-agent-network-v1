# Frontend integration and collaboration handoff

## Purpose

Riley and Claude are developing the production frontend/design direction while
Codex owns continuity architecture and native functionality. This document lets
both lanes move quickly without duplicating shells, inventing backend behavior,
or overwriting one another.

## First integration checkpoint

Before V1.1 product implementation:

1. Riley identifies the accepted frontend commit(s) or exact file set.
2. Codex compares them with the functional-beta checkpoint and classifies every
   overlap as `take design`, `keep functional`, or `compose`.
3. Accepted commits/components are applied intentionally. The design branch is
   not merged wholesale.
4. Existing functional-beta continuity controls, Tauri calls, conversation
   behavior, and native runtime state are reconnected where a design component
   replaced them.
5. Browser visual checks and one installed functional-beta smoke pass establish
   the implementation baseline.
6. The exact commit becomes the base for `agent/v1.1-resident-notebook` (or a
   replacement branch name recorded in the ledger).

## Ownership rule

A file has one writer at a time. Ownership transfers only through a short entry
in `RUN_LOG.md`. Cross-lane review is encouraged; cross-lane editing is not.

### Codex/backend-owned

- `crates/luca-protocol/**`
- `crates/luca-continuity/**`
- `crates/buzz-acp/**` for private cognition and context-provider seams
- `desktop/src-tauri/src/commands/continuity.rs`
- `desktop/src-tauri/src/luca/continuity_*.rs`
- `desktop/src-tauri/src/luca/managed_continuity.rs`
- Rust migrations, golden vectors, security tests, native fixtures, and installed
  app build/signing
- Release evidence, native demo, and final verdict

### Claude/frontend-owned after contract freeze

- `desktop/src/features/profile/ui/ResidentContinuityPanel.tsx` and newly split
  notebook/reflection children
- `desktop/src/features/agents/ui/ResidentContinuityActivity.tsx`
- new Brain Setup React surfaces under an agreed `desktop/src/features/luca/**`
  feature folder
- release-specific React unit tests, Story/fixture surfaces, CSS/tokens, focus,
  responsive, reduced-motion, empty/loading/error states
- focused Playwright visual flows that use the frozen fixtures

### Integration-owned shared files

Only Codex edits these while a release is in flight unless ownership is
explicitly transferred:

- `desktop/src/shared/api/tauriContinuity.ts`
- Tauri command registration
- serialized renderer view-model types
- deterministic fixture schema and canonical fixture data
- shared shell/router/provider files
- package manifests, lockfiles, migrations, and generated files

## Contract-first frontend workflow

For each release:

1. Codex freezes the Tauri command names, serialized view models, status enums,
   and deterministic fixtures in the release's first contract task.
2. Claude builds the UI against those fixtures without changing backend
   semantics or creating a parallel store.
3. Riley approves the representative surfaces visually.
4. Codex binds the same view models to real Tauri commands in parallel where
   ownership permits, then runs focused integration checks.
5. Claude addresses visual defects only within its owned files.
6. Codex builds the installed app and runs the native acceptance demo.

Fixture mode is design evidence, not product evidence. It must be impossible to
enable in a production build unless the existing test bridge is active.

## V1.1 frontend contract

Backend checkpoint status: implemented on `agent/v1.1-resident-notebook`.
Claude should import the frozen TypeScript contract directly from
`desktop/src/shared/api/tauriNotebook.ts` and use
`getResidentNotebookFixtures()` while building the surface. The fixture bundle
covers ready, empty, locked, unavailable, two journal revisions, an owner
annotation, and pending/running/completed/cancelled/failed jobs. Fixture mode
does not write notebook state.

The backend commands accept stable lineage IDs as well as current revision IDs.
Pagination defaults to 25 and is capped at 50. Journal activity is body-free.
No frontend code may persist or log the `body`, owner prompt, or selected page
content.

Representative surfaces to approve before expansion:

1. A resident inspector with distinct **Handoff** and **Notebook** sections.
2. One active continuity note with category, resident authorship, source link, and
   revision affordance.
3. One resident-authored Journal Page with explicit disclosure and annotation.
4. One owner-pinned note correction and its before/after history.
5. Empty, disabled, locked, unavailable, cancelled, and failed states.
6. Compact conversation/activity evidence without private bodies.

Required behavior:

- opening a note does not replace the conversation;
- source links jump to the signed conversation event using existing navigation;
- edit/pin/archive/forget actions require deliberate confirmation appropriate
  to their reversibility;
- revision history is readable without exposing raw storage objects;
- status is understandable without color or motion;
- the main conversation remains the dominant plane.

## V1.2 frontend contract

Representative surfaces:

1. Select one file or folder.
2. Zero-write preview with accepted/skipped/unsupported/unsafe rows.
3. Atomic import progress, completion, cancellation, and failure.
4. Source list with changed-source diff and reimport.
5. Per-resident grant, revoke, stale, and reconfirm controls.
6. Compact answer provenance and receipt detail.

Do not design a universal brain dashboard in V1.2. The surface is a precise
source-and-access control plane.

## V1.3 frontend contract

Representative surfaces:

1. **Review notebook** action with clear scope and no autonomy implication.
2. Body-free queued/running/cancelled/failed state.
3. Intentional disclosure of one resident-authored reflection.
4. Before/after notebook changes with provenance and rollback.
5. `no_change` as a legitimate, calm completion state.

Reflection text never appears in Activity, ordinary chat, notifications, or
collapsed inspector summaries.

## UX language constraints

Preferred:

- “Notebook” for the product surface; “hypomnema” may appear in developer or
  explanatory material.
- “Luca kept a private handoff”
- “This resident kept 2 notes from the conversation”
- “Continuity used”
- “Source available to Luca” / “Granted to Mara”
- “Review notebook”
- “No changes were needed”

Avoid:

- consciousness, sentience, soul, or simulated emotion claims;
- “trained,” “learned forever,” or “knows everything”;
- “resumed its native session” unless the runtime directly proves that;
- “autonomous inner life” for V1.3;
- presenting model changes as identity transfer encouragement;
- calling owner-brain access automatic or room-derived.

## Handoff checklist per frontend task

- Exact base commit and owned paths recorded.
- Frozen view model and fixture version named.
- No backend, shared API, manifest, lockfile, migration, or shell-provider edits.
- Typecheck, focused tests, and visual captures attached.
- Keyboard, focus, reduced motion, loading, empty, error, disabled, and narrow
  viewport states reviewed.
- No simulated capability is presented as live.
- One bounded commit suitable for selective integration.

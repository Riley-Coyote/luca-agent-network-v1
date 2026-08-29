# Unified desktop acceptance plan

Date: 2026-08-28

Status: integrated development candidate; final source and installed-app evidence pending

Canonical branch: `codex/unified-dev`

Starting baseline: `bfc71b7bce2e75cc6e42075be2ef6e982df253a7`

## Purpose

This document is the acceptance contract for the unified Polyphonic desktop
development app. It records the reliability and conversation-workspace work
integrated after the unified-development handoff. It is not a production-release
claim and does not expand the relay, runtime authentication, cloud, or public API
architecture.

The only installed review target is:

- `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`
- bundle ID `com.luca.agent-network.dev`

No additional persistent app bundle or profile is part of this run.

## Integrated commit sequence

The following subjects define the reviewable boundaries. Tests are committed
with the behavior they cover.

1. `docs(design-lab): preserve project room navigation study`
2. `fix(messaging): harden resident routing and delivery recovery`
3. `fix(brain): queue source connections and bound indexing`
4. `fix(desktop): stabilize contextual navigation layout`
5. `polish(desktop): curate runtimes and conversation controls`
6. `feat(desktop): add persisted tiled conversations`
7. `polish(desktop): integrate room picker and compact popouts`
8. `docs(luca): record unified desktop acceptance plan`

The design lab retains both project-room navigation variants. The dropdown room
picker is the approved production direction; lab HTML and lab-only styles do not
enter the application bundle.

## Product contracts

### Messaging is a blocking gate

- Owner sends render immediately, clear the composer, and retry in place.
- Rejection, retry, repeated room sends, and final publication cannot duplicate
  a row or create a phantom response.
- `@Agent` creates a temporary visit. Explicit Add/setup creates permanent
  membership.
- Agent actions retain their true actor and stable resident identity.
- Agent-to-agent detail stays in the right drawer while the main timeline shows
  one chronological receipt.
- Codex and Claude Code continue through their existing authenticated runtime
  paths. No alternate transport or message kind is introduced.

### Brain is a blocking gate

- Category connection opens a confirmation picker and performs no mutation
  before confirmation.
- Selected discoveries connect sequentially through the existing single-source
  native command, with source-level status, partial-failure isolation, bounded
  cancellation, and source-only retry.
- Existing retry, reconnect, relink, and disconnect operations remain available
  without resetting data or grants.
- Repository inventory and indexing use bounded-memory traversal off the
  renderer thread while preserving exclusion and path-safety rules.

### Shell and conversation workspace

- The shell has one mutually exclusive top-level mode and at most one contextual
  left navigator. Route changes retire stale panels.
- Responsive drawer behavior is decided from stable shell width, avoiding
  self-triggered resize oscillation.
- Curated runtime rows represent pinned installed runtime families, never each
  Hermes or OpenClaw resident.
- New Conversation lists residents before runtimes and keeps canonical identity
  marks. Existing model configuration remains in the authorized inspector.
- A versioned, owner/workspace-scoped local layout stores up to four fixed panes
  and ordered tabs using opaque IDs only. Corrupt or missing data degrades to a
  safe single-pane layout.
- Each pane owns its local composer, scroll, room selection, and panel state.
  Only the focused pane owns routing, global shortcuts, and the inspector.
- Full-page tools temporarily hide the conversation workspace and restore it
  without losing layout state.

### Room picker and popouts

- The project/room breadcrumb is the dropdown trigger in a tile or project-room
  popout. Selection affects only that surface.
- The picker supports mouse, visible keyboard focus, arrows, Home/End, Enter,
  Escape, and outside-click dismissal.
- Ordinary full project view retains the complete project navigator.
- Popouts keep conversation identity, content, essential status, and composer.
  Pin and Dock are progressive controls; duplicate inspector and popout controls
  are absent.
- Dock focuses an existing main-app copy or adds the conversation as a tab in
  the focused pane without silently replacing occupied panes.

## Source gates

Each scoped commit must pass its focused tests, a non-writing Biome check,
`git diff --check`, and one concise visual inspection when the UI changes.

The combined source gate is limited to the affected systems:

- focused messaging and Brain native suites;
- focused messaging, Brain, shell, rail, workspace, room-picker, and popout
  Playwright suites;
- `pnpm -C desktop typecheck`;
- `pnpm -C desktop build` and the affected E2E build;
- Rust formatting check;
- focused Biome over all files changed from the starting baseline;
- clean worktree.

Passing this gate means the integrated development candidate is ready for one
installed-app acceptance. It does not certify the unrelated repository matrix.

## Installed-app acceptance

After the source gate passes, run `./scripts/rebuild-luca-dev-app.sh` exactly
once. It must replace and relaunch the existing Dev bundle in place.

The bounded implementer walkthrough covers:

1. repeated Luca and Vektor sends, streaming, attribution, retry, and duplicate
   prevention;
2. temporary visits, explicit membership, and one agent-to-agent drawer detail;
3. Codex and Claude Code through their existing runtime sessions;
4. Brain selection, two small source connections, queue stop, failed-source
   retry, reconnect, and disconnect while unrelated cards remain responsive;
5. Brain to project to runtime to conversation navigation without stale panels,
   flicker, or a stuck drop overlay;
6. runtime pins, resident-first composition, identity marks, model selection,
   and restrained scrollbars;
7. two-, three-, and four-pane layouts, focused inspector ownership, tool
   hide/restore, and relaunch persistence;
8. dropdown room switching in a tile and popout, plus Pin and Dock;
9. light, dark, keyboard-focus, and compact-window behavior.

Any failure in messaging, Brain mutation/recovery, UI responsiveness, or layout
restoration reopens its owning phase. Riley's broader experiential walkthrough
is the subsequent polish pass, not a replacement for these gates.

## Explicit deferrals

This run does not add Pi or Cursor adapters, redesign Skills or MCP, add plugin
management, change Brain retrieval, replace agent personas, redesign groups,
alter production onboarding, add cloud sync, change relay protocols, or replace
runtime authentication. Existing behavior in those areas is preserved and only
receives regression coverage when directly touched.

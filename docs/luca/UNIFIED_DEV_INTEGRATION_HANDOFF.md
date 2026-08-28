# Unified development integration handoff

Date: 2026-08-28

Status: integrated development candidate, not a production-release claim

Canonical branch: `codex/unified-dev`

Integration baseline: `f27aaaf25a6b90cb1b3137b4ab3c4e93b26df263`

## Purpose

This handoff records the single caught-up Polyphonic desktop development line.
It joins the finished Claude and Codex work that belongs in the live app without
turning the integration pass into feature invention or release hardening.

The installed review target remains one bundle and one profile:

- `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`
- bundle ID `com.luca.agent-network.dev`

Do not create another persistent app copy or profile for ordinary review.

## Canonical product behavior

### Messaging, visits, and agent-to-agent exchange

- A rejected owner send stays in place and retries as the same optimistic row.
- Retry state is bounded and cleared when its community boundary changes.
- An explicit `@Agent` is a temporary visit. Explicit room setup or **Add** is
  permanent membership.
- A visit is committed only after relay acceptance; a failed send rolls back
  provisional visit state.
- Agent-to-agent turns live in **Between agents**. The main timeline shows one
  chronological receipt rather than duplicating the transcript.
- Only a genuinely new live exchange may open the drawer automatically. Manual
  close, refetch, or history backfill must not reopen it.
- Generic work state is described as working; the UI does not invent hidden
  reasoning or display raw chain-of-thought.

### Rooms and groups

- Ordinary room creation can start with selected permanent agents or a saved
  group.
- Partial member-add failure preserves the room and retries only failed members.
- **Groups** uses the existing `AgentTeam` model for create, rename, membership,
  delete, mentions, room setup, and templates. It is not a second grouping
  architecture.

### Brain and native responsiveness

- Resident notebook and related Brain reads run off the UI thread with
  single-flight refresh and stale-result guards.
- Brain source grants remain authoritative. Room/project context selection does
  not silently grant residents new source access.
- Repository/folder connection continues to use the existing preview,
  provenance, and non-mutating review contracts.

### Skills, MCP, and native sessions

- Library can browse bounded installed skills and inspect their `SKILL.md`.
  **Use** starts an ordinary compatible conversation; Polyphonic does not run,
  install, or edit the skill.
- Settings is the single MCP command center. Runtime-owned Codex, Claude Code,
  and Goose entries are sanitized and read-only; secrets, commands, arguments,
  environment values, and config paths do not cross the IPC boundary.
- Installed Codex and Claude Code sessions appear as a bounded, sanitized,
  read-only index. **Start with this context** creates a new Polyphonic chat; it
  does not claim to resume or synchronize the native session.
- Runtime/session/community changes invalidate stale asynchronous handoffs.

### Resident identity and defaults

- Luca remains Polyphonic's canonical resident concierge.
- Bundled Luca, Vektor, and Anima identity documents are seeded only when the
  corresponding canonical resident is provisioned and the files do not exist.
- Existing or customized documents are never overwritten.
- Vektor and Anima remain opt-in; integration does not silently provision them.
- Riley's private local personas and memories are not shipped as defaults.

### Shell and runtime truth

- Native macOS traffic-light clearance is shared across the shell, including
  the collapsed global rail and project-room rail.
- Fresh provider choices do not advertise legacy Databricks entries. An
  existing legacy selection remains representable so it can be changed safely.
- Runtime readiness comes from the native catalog. The renderer does not infer
  authentication from a provider label or reuse credentials across runtimes.

## Deliberately deferred

- Production release certification, migration, notarization, and broad matrix
  hardening.
- Skill installation/editing, a plugin manager, and a marketplace.
- Hermes/OpenClaw runtime-owned MCP readers.
- Native session resume, bidirectional synchronization, or terminal emulation.
- Copying Riley's private resident personas into distributable defaults.
- New conversation planes, alternate routing systems, cloud services, mobile
  work, or unrelated application redesign.

## Acceptance boundary

This integration is ready for Riley's live development walkthrough only after:

1. focused frontend and native tests pass;
2. focused Playwright flows pass and the key light/dark surfaces are inspected;
3. typecheck and production frontend build pass;
4. the canonical Dev bundle is rebuilt in place, remains running, and presents
   a visible window;
5. the worktree is clean and the exact verified HEAD is recorded below.

## Verification receipt

Completed by the 2026-08-28 integration run.

- Verified implementation HEAD: `05d8dc366f0df26015a0474066c4558de5714713`
- Focused frontend tests: **102/102 passed** across 14 integration files.
- Focused native tests: **117/117 passed** across Brain, visits, exchange,
  groups, capability discovery, MCP projection, bundled identity seeding, and
  runtime-readiness coverage.
- Playwright: **32/32 passed** across messaging/retry, direct runtimes,
  agent-to-agent receipts, Groups, Skills, runtime-session handoff, MCP,
  activity, shell clearance, and team mentions.
- Visual smoke: key light and dark Skills, MCP, Groups, room setup,
  agent-to-agent, runtime-session, and activity surfaces were inspected in the
  integrated browser build.
- Static verification: focused Biome, frontend typecheck, production frontend
  build, file-size reporting, typography, public-key truncation, communication
  parity, kind parity, and `git diff --check` passed.
- Installed-bundle smoke: the signed `com.luca.agent-network.dev` bundle was
  rebuilt atomically, launched from the canonical application path, presented
  a visible window, and stayed responsive while opening Brain, Connections &
  MCP, and the 1,326-item Skills index. The relay was listening on loopback.
- Workspace hygiene: the canonical worktree's frontend dependencies were
  rehydrated on LaCie against the LaCie pnpm store; it no longer relies on the
  old Claude messaging worktree's `node_modules` path.
- Known limitations: the current review profile contains previously connected
  repository sources whose local bindings report **Needs attention** and need
  an explicit retry or relink. Hermes is not currently detected, and the
  detected OpenClaw identities are not linked to Polyphonic residents. These
  are visible profile/runtime states rather than hidden integration failures.
  Production release certification and the deliberately deferred capabilities
  above remain outside this acceptance boundary.

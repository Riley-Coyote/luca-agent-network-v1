# Project–Room Navigation Run Log

Date: 2026-08-08

Delivery branch: `agent/project-room-blackout-shell`

Canonical branch: `luca/v1.1`

Starting commit: `1353a68`

Product implementation checkpoint: `1d3e6b13a30a20e4b5177b1c8b0d49783d3adf3c`

Final regression checkpoint: `b1e045a5f04a41a1824048fd05c485a1641534bc`

## Implemented

- Preserved the production global rail and conversation surface.
- Split loose rooms/DMs from project rows in the global rail.
- Added the project room view model, last-room preference, contextual room
  navigator, search, empty state, and mobile room-list transition.
- Scoped the device-local project catalog and room assignments by owner and
  relay, added validation/reactive writes, and migrated the old global
  prototype keys once.
- Kept `/channels/:channelId` canonical and added `/projects/:projectId` only
  for empty projects and project-entry resolution.
- Preserved the pre-existing repository project-detail route as the fallback
  for IDs outside Luca's local conversation-project catalog.
- Reused the real channel header, timeline, composer, inline replies, and
  optional inspector without adding a simulated conversation layer.

## Focused verification

- `node --test src/features/projects/lib/projectNavigator.test.mjs`: PASS (2)
- `node --test src/features/channels/lib/roomProjects.test.mjs`: PASS (5)
- `pnpm typecheck`: PASS
- Biome check over all changed TypeScript/TSX files and the focused E2E spec:
  PASS
- `pnpm build:e2e`: PASS
- `tests/e2e/luca/project-room-navigation.spec.ts`: PASS (3)
  - project entry and last-room restoration
  - DM returns to full-width conversation
  - search/no-results and empty-project route
  - mobile rail closure, room list, and conversation transition
- Existing focused regressions:
  - send message: PASS
  - unread pill: PASS

The three stale Buzz-era assertions were aligned with approved Luca behavior
before release integration:

- attachments now exercise `Add to message` → `Attach files`: PASS;
- focused inline replies now exercise the main timeline and composer instead of
  requiring the removed split thread drawer: PASS;
- the retained Workflows compatibility surface is exercised through its direct
  deep link rather than a removed primary-rail entry: PASS.

The historical split-thread test remains skipped and labeled as archival
coverage. The current focused-timeline test is the operative conversation-first
contract.

## Visual evidence

Captured populated project, direct DM, and empty project at:

- 1440 × 900
- 1280 × 800
- 1024 × 768
- 390 × 844

Additional captures cover the mobile project room list and inspector coexistence.
All reviewed states had zero horizontal overflow and no actual console errors.

Evidence: `evidence/project-room-navigation/visual/`

## Installed native gate

- Rebuild source: `1d3e6b13a30a20e4b5177b1c8b0d49783d3adf3c`
- `scripts/rebuild-luca-dev-app.sh`: PASS
- Installed path: `~/Applications/Luca Agent Network Dev.app`
- Bundle ID: `com.luca.agent-network.dev`
- Developer ID signature verification: PASS
- Stable keyring service: `buzz-desktop-dev.luca-v1`
- Exact installed process remained running: PASS
- Preserved owner profile, rooms, and conversation history: visually confirmed
- Existing global rail, timeline, inline replies, and composer: visually
  confirmed
- Executable SHA-256:
  `fc3f3dd38130d797df863f69bbf8112f0c423d16b89ad3c40e6d0aed0f01691c`
- Recoverable pre-install profile backup:
  `~/Library/Application Support/com.luca.agent-network.dev.project-nav-preinstall-20260808-172412`

The native profile did not contain a confirmed project catalog, so the app
correctly displayed its existing conversations under `Rooms`. The production
project write seam is ready for Brain Setup; no demo catalog was copied into
the native profile.

## Existing repository baseline findings

- The repository-wide file-size check still reports pre-existing oversized
  files; none of the new project-navigation files are included.
- The repository-wide pixel-text check still reports only pre-existing values
  in `ConversationContextPanel.tsx`; the new project-navigation CSS is clean.
- The E2E build retains the existing Vite chunk-size warnings.

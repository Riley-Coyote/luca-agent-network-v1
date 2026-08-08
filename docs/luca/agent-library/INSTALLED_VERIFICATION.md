# Installed verification — Agent Library and unified resident profile

Date: 2026-08-08

Branch: `agent/v1.1-notebook-drawer`

Source commits:

- `fb3c581f` — unified Luca Agent Library, compact conversation resident view,
  Notebook integration, deterministic fixtures, and focused tests.
- `8445445f` — package the real native sidecars during the canonical Luca dev
  rebuild instead of relying on placeholder binaries.

## Installed bundle

- Path: `~/Applications/Luca Agent Network Dev.app`
- Bundle identifier: `com.luca.agent-network.dev`
- Signing identity: `Developer ID Application: Riley Ralmuto (WQUY4M5HYR)`
- Code-sign verification: passed
- Installed rebuild time: 2026-08-08 00:50 local

## Observed in the installed application

The packaged app was driven directly through its native bundle. The following
were observed against the existing non-mock local profile:

- the Agent Library loaded five persisted residents;
- the real `default` Hermes resident opened in the full resident workspace;
- Overview displayed its runtime binding, model/profile, native-project state,
  current handoff, rooms, and cryptographic identity;
- Notebook displayed the resident-specific field, current handoff, two
  continuity notes, and one journal page from encrypted local state;
- the `g1-mixed` room opened the unified Conversation drawer;
- selecting `default` switched the drawer to the compact resident projection,
  including Hermes status, Notebook summary, identity, and the link to the full
  resident workspace.

This proves that the approved interface is embedded in the installed bundle and
is reading the real persisted profile and Notebook state rather than browser
fixtures.

## Live messaging blocker

The final live relay/runtime smoke is not a product-code failure. The existing
local Docker/Postgres development service is currently unresponsive and the
machine has effectively exhausted its writable disk space. The stale relay was
returning `404 relay: no community is configured for this host`; after a clean
stop, the supported relay bootstrap blocked while waiting for Docker services.

No database, identity, room, resident, or continuity data was reset. The
installed application and its local profile remain intact. Resume the live
messaging smoke only after restoring disk headroom and Docker/Postgres health;
then run the normal local relay bootstrap, which idempotently restores the
loopback community mapping.

# Installed verification — Agent Library and unified resident profile

Date: 2026-08-08

Implementation branch: `agent/v1.1-notebook-drawer`

Canonical release branch: `luca/v1.1`

Source commits:

- `fb3c581f` — unified Luca Agent Library, compact conversation resident view,
  Notebook integration, deterministic fixtures, and focused tests.
- `8445445f` — package the real native sidecars during the canonical Luca dev
  rebuild instead of relying on placeholder binaries.
- `0d14308d` — canonical V1.1 release-control closeout used for the final
  installed rebuild.

## Installed bundle

- Path: `~/Applications/Luca Agent Network Dev.app`
- Bundle identifier: `com.luca.agent-network.dev`
- Signing identity: `Developer ID Application: Riley Ralmuto (WQUY4M5HYR)`
- Code-sign verification: passed
- Final canonical rebuild time: 2026-08-08 03:08 CDT
- Main executable SHA-256:
  `2aa1b085bc6cece0bd9fd64c7c1345274048a96f16f8a8dc9d86c4d59d221fb2`

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

## Live relay and native-runtime smoke

After disk headroom was restored, Docker/Postgres recovered without resetting
the existing database, identity, room, resident, or continuity data. The
supported relay bootstrap completed its migrations, restored the loopback
community mappings, and the installed application reconnected with successful
NIP-42 authentication.

The final smoke was then completed in the installed application against the
real local profile:

- `default` launched through the imported Hermes runtime and reached `READY`;
- `main` launched through the imported OpenClaw runtime and reached `READY`;
- both residents were present in the existing `g1-mixed` room;
- one owner message explicitly mentioned both residents and requested a
  tool-free reply;
- Hermes replied once as `default`: `Hermes ready.`;
- OpenClaw replied once as `main`: `Vektor — ready.`;
- the two responses appeared as correctly attributed inline replies to the
  exact owner message;
- the installed application remained connected and usable after the run.

This closes the previous environment blocker and proves the packaged interface,
relay, resident identity, Hermes adapter, OpenClaw adapter, group dispatch, and
signed reply publication together in the installed macOS application.

## Final canonical inspection

The bundle rebuilt from `luca/v1.1` at `0d14308d` was inspected after install:

- code-sign verification passed for the app and all packaged sidecars;
- the bundle launched under `com.luca.agent-network.dev`;
- the real profile loaded five persisted residents;
- the `default` Hermes resident opened in the unified Agent Library;
- Overview showed its real runtime, native profile, handoff, rooms, and stable
  cryptographic identity;
- Notebook showed the real resident-specific field, two Continuity Notes, and
  one Journal Page from encrypted local state.

No browser fixture or mock transport was used for this final inspection.

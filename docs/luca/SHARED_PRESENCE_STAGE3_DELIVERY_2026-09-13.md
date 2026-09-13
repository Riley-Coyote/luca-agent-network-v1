# Stage 3 — resident-authored Place

Source: `codex/shared-presence-stage3`, based on `c407edd06` in the existing
internal-drive integration worktree. This is a Dev candidate, not a beta cut.

## Delivered contract

Place is the resident workspace's default section. Documents, Notebook, and
Settings keep their explicit deep links. The page contains deliberate plain-text
introduction and exploration fields and one selected immutable Artifact Library
version. Empty places remain empty until someone writes; navigation never
generates content or starts a turn.

Records are device-local, private, revisioned, and scoped by owner, active relay,
and resident public key. Atomic restricted files hold content and provenance;
there is no module-level content cache. Conflicting edits retain the owner's
draft. Changing the authoring switch does not take credit for existing writing.

Resident editing starts disabled. The owner can enable it for a local managed
resident. `resident_place_get` and `resident_place_update` use the existing
artifact MCP broker and exact-turn capability, with owner and relay frozen by
the host. They cannot accept another resident, permission, visibility, or author
override. Private current-room membership, active scope, enabled policy, and
turn authorization are checked before access and after asynchronous lookups.
Place tool bodies are redacted from observer/activity frames.

Selected work must be authored by the resident, belong to the owner, and have
an accessible private source conversation in the current workspace. The exact
version opens through existing Canvas. Missing or unauthorized work renders
unavailable without exposing its metadata. Resident selection is confined to
work from the current private conversation. The owner's picker considers the
100 most recent artifacts and returns at most 100 eligible versions; it is
loaded only when requested.

This stage adds no sharing, background authoring, archive mining, runtime/model
configuration, or prompt injection. It adds no new agent process or backend.
Stage 4's return/continuity experience remains separate.

## Verification and installation

Source checks passed: 7 focused native Place tests, the MCP payload and exact
10-tool inventory checks, the ACP observer redaction test, 4 focused Playwright
cases, TypeScript, scoped Biome, and px-text. The integrator inspected both wide
and narrow populated fixtures.

The first real Sol turn created a Markdown artifact but exposed a nested
snake_case/camelCase mismatch in its Place reference. The native boundary now
maps that object explicitly; the regression covers a non-null selected version.
The initial integrated build passed; one correction build follows that concrete
native failure. No broader suites were repeated.

Installed source: `5916ac567446fc744e49b85b5c8fc4976f98db4e`.

Foreground native acceptance passed:

- Sol's Place initially empty, editing disabled; Anima's Place independently empty
  with editing disabled.
- Owner enabled Sol, saved an owner draft, and saw “Edited by you”, revision 2.
- After the targeted fix, Sol read revision 2 and replaced that draft through the
  real tools. The 31-second turn saved “Written by Sol”, revision 3, and selected
  **A Small Lamp**, immutable version 1. No duplicate artifact was created.
- The page displayed the saved introduction/exploration and exact selected
  version. Canvas opened the Markdown content and identified Sol, DM, v1;
  Escape dismissed Canvas.
- A clean Dev quit/restart retained Sol's content, authorship, revision, editing
  permission, and selected work. No Dev bundle processes remained after quit;
  no new parent-PID-1 Node processes appeared relative to the pre-test snapshot.

Installed app: `/Users/rileycoyote/Applications/Luca Agent Network Dev.app`.
Identity/keyring remain `com.luca.agent-network.dev` /
`buzz-desktop-dev.luca-v1`. ACP and artifact MCP helpers were updated for the new
tools and observer privacy filtering. Deep strict signature verification passed.
The beta app was not modified.

Stable pre-Stage-3 rollback:
`/Users/rileycoyote/Applications/Luca Dev Rollbacks/shared-presence-stage3-2026-09-13/Luca Agent Network Dev.app`.

Local screenshots, process snapshots, and checks:
`/private/tmp/shared-presence-stage3-evidence` (temporary acceptance evidence).

Limits: private, device-local places only; owner-enabled managed-runtime tool
access; no sharing or synchronization. Owner/workspace isolation, conflicts, and
wire/privacy boundaries have focused automated coverage; a second-account live
walkthrough was not repeated. No Stage 4 return feed or beta release was built.

# Luca branch and artifact map

Audited from the local repository on 2026-08-12.

## Current integration line

| Coordinate | Purpose | Status |
|---|---|---|
| `codex/conversation-communication-integration` @ `5cd754e` | Newest combined product/evidence line | Clean; current integration authority |
| Product checkpoint `80510db` | Combined conversation + communication source verified by full `just ci` | Integrated source |
| Installed branch app | `~/Applications/Luca Agent Network Dev (luca-operator-native-forge).app` | Signed, launched, executable hash `ad607…f78` |
| `luca/v1.1` @ `10078f7` | Last canonical local release line before newer integrations | 97 commits behind integrated branch |
| `origin/luca/v1.1` | Published remote release line | 117 commits behind integrated branch |

The generic `~/Applications/Luca Agent Network Dev.app` also exists. It should
not be assumed to contain the newest integrated source without verifying its
bundle hash and source receipt.

## Integrated source branches

| Branch | Head | Relationship |
|---|---:|---|
| `codex/conversation-experience-polish` | `0bfbd7a` | Merged as the visual authority. |
| `codex/communication-parity` | `b49ee31` | Merged secure communication foundation. |
| `codex/luca-operator-native-forge` | `3dee0ce` | Ancestor of the combined line; includes source-passing Operator Forge and basic project creation. |
| `codex/settings-agent-system` | `4f0965b` | Ancestor through the shared baseline; installed Settings/MCP verdict. |
| `codex/unified-brain-v1-2` | `aacb518` | Accepted V1.2 evidence lineage. |
| `agent/project-room-blackout-shell` | `34989f9` | Accepted project-room navigation lineage. |

The smaller conversation correction worktrees are implementation archaeology;
their accepted commits were consolidated into the conversation-polish parent
before the integration merge.

## Material unmerged branch

### `codex/brain-onboarding-ux` @ `13c9ec9`

- Divergence from the integrated branch: integrated side has 97 unique commits;
  onboarding side has 8 unique commits.
- The onboarding branch changes 88 files: 4,484 insertions and 1,222 deletions.
- Unique commits:
  - `58b60fe` Unify Polyphonic onboarding state and bootstrap
  - `423a640` Connect production profile and resident setup
  - `356ba81` Connect production Brain onboarding
  - `e1477ba` Finalize onboarding accessibility and acceptance
  - `06f002f` Complete Polyphonic onboarding acceptance matrix
  - `a2d6dea` Remove onboarding prototype build dependency
  - `5b8d7a4` Fix healthy first-run identity setup
  - `13c9ec9` Refine conversation identity and navigation

This is real production code, not a mock. It is also too divergent to declare
integrated without a deliberate conflict and visual review.

## Locally dirty primary checkout

Path:
`/Users/rileycoyote/Documents/Repositories/luca-agent-network-v1`

Branch/head at audit:
`agent/runtime-reliability` @ `cc54ebf`

This checkout contains user work and untracked evidence. Do not clean, reset,
or bulk-add it. Important unintegrated material includes:

### Artifact/Canvas planning packet

`docs/luca/artifacts/`

Status: complete planning packet, no product implementation. Files include the
product scope, decision log, system contracts, experience/rendering, security,
source map, milestones, task graph, and kickoff.

### Unified Brain planning packet

`docs/luca/unified-brain/`

Status: long-range planning authority copied into the dirty checkout. The
integrated branch also contains this packet. The narrow V1.2/V1.2.1 release
contracts supersede it where they intentionally reduced first-wave scope.

### Mobile companion prototype

`prototypes/luca-mobile-companion/`

Status: browser prototype, research, screenshots, and tests. It is not a native
iOS app and is not connected to production pairing/runtime data.

### Design and dot-display work

The checkout contains modified identity/dot-display source, labs, generated
images, design archives, and screenshots. These belong to Riley and were not
assumed to be accepted production changes in this audit.

### Evidence and caches

Numerous untracked `evidence/M1/**`, generated bundles, caches, and archives
remain. They may be useful archaeology but are not release authority until
curated and scanned.

## Separate repositories and references

| Location/task | Classification |
|---|---|
| `/Users/rileycoyote/Documents/polychat` | Earlier real-runtime Codex/Claude group-chat implementation; architectural reference, not Luca product completion. |
| Mnemos roadmap and production-audit tasks | Upstream continuity source/research; not automatically a Luca backlog item. |
| Sanctuary, Prompt Ghost, vessel-chat, storage cleanup | False-positive session matches; excluded from Luca status. |
| Luca Design Artifacts folders | Visual/design references; not code authority unless explicitly integrated. |

## Documentation drift found

- Top-level `HANDOFF.md` still names `luca/v1.1` as authoritative and predates
  the combined integration.
- It says formal G1 is incomplete even though later G1 candidate evidence and
  functional-beta verdicts closed the runtime foundation. Historical G1 files
  should remain archaeology, not the current product gate.
- The conversation/communication receipt says a signed branch app was promoted,
  then lists “installed app rebuild or replacement” under deferred operations.
  The latter is stale pre-promotion wording; the signed promotion evidence and
  hash are the current truth.
- Communication `ACCEPTANCE.md` remains unchecked. Therefore the integration is
  a secure foundation, not full parity, regardless of broad test success.

## Git safety rule

Before new implementation:

1. keep every current worktree intact;
2. create the next integration worktree from `5cd754e`;
3. reconcile onboarding and any accepted dirty-checkout material explicitly;
4. stage named files only;
5. do not reset or clean the primary checkout;
6. push only after the canonical release coordinate is settled.

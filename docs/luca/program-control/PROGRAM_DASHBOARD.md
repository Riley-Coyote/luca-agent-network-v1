# Luca program dashboard

Updated: 2026-08-12

## Executive state

| Item | State | Next gate |
|---|---|---|
| Revised control package | `implemented_in_source` | Commit, validate exact SHA, then promote CTRL-003 |
| Product-truth and reuse audit | `implemented_in_source` | Exact-commit control validation |
| Riley revised-graph approval | `planned` | CTRL-004 explicit approval |
| Five product teams | `inactive / not created` | CTRL-004 plus final approved control SHA |
| P1 integration train | `inactive / not created` | P1/P2 team source gates |
| Product/shared-file writes | `not authorized` | CTRL-004 and bounded task activation |
| Proposed tester release | `luca/v1-beta` | P3 installed proof and promotion approval |

## Product classification

| Class | Current examples | Program action |
|---|---|---|
| Functional | Stable identity; native runtimes; owner-agent DM/group/reply; search/unread; human attachments/reactions/edit/delete; project-room navigation; Agent Library; Settings; Notebook; pairing foundation | Preserve and regression-test |
| Hidden or disconnected | Several existing channel/member/invite/mutation controls; owner Inbox/Activity projections; some native-agent lifecycle/presentation paths | Reconnect and present coherently |
| Reusable with Luca presentation | Signed event builders, relay, rooms/membership, DM/group, timeline, search, unread, media, feed/Inbox, runtime publication | Use existing domain/commands and apply Luca product presentation |
| Thin managed-agent adapter needed | Managed reaction/edit/delete, room/DM/member operations, attachment publication, explicit mention/invite activation | Add narrow typed adapters over existing operations |
| Genuinely missing | Complete combined onboarding/project/agent flow, coherent visible A2A activation, installed all-surface beta acceptance, P4 felt continuity | Build only the missing product seam |

## Milestone status

| Milestone | Status | Critical outcome |
|---|---|---|
| P0 | Active, approval-gated | Exact validated control truth and Riley approval |
| P1 | Planned | Complete visible messaging/A2A in Direct mode |
| P2 | Planned | Projects, native agents, Inbox/Activity, onboarding, core app UX |
| P3 | Planned | Installed truthful functional beta |
| P4 | Planned | Mnemos felt continuity and identity |
| P5 | Not activated | Optional hardening and deferred expansions |

## Reuse-first communication decision

The prior communication work is preserved. Existing secure send, exact-event
vault/outbox, membership checks, runtime wiring, and owner Inbox projections
remain foundations. The beta does not generalize them into a new workflow
system. Missing visible operations first reuse the existing Buzz command,
builder, relay, and UI behavior.

Routine local communication is direct and approval-free. Narrow confirmations
remain for deletion, external/unresolved recipients, authority/membership
changes, broad broadcasts, and material data effects.

## Current stop boundary

Do not create team worktrees, dispatch kickoff prompts, open a train, merge
product commits, or modify product/shared files. If exact-commit validation,
ancestry, worktree cleanliness, required-file, YAML/reference, link, or branch
non-activation checks fail, CTRL-003 remains unpromoted and work stops.

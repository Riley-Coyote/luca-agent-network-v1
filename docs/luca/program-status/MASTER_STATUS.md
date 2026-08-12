# Luca master product status

This document distinguishes the current integrated product from the broader
vision. “Built” means the repository and evidence support the claim; it does
not mean every related idea discussed in a task is finished.

## 1. Functional foundation

| Capability | Status | Current truth |
|---|---|---|
| Stable cryptographic resident identity | `VERIFIED_INSTALLED` | Resident keys, key-derived specimens, custody, and runtime-independent identity are implemented. |
| Hermes import and runtime | `VERIFIED_INSTALLED` | Discovery, idempotent import, degraded states, native binding, DM/group replies, restart, and no-write proofs passed. |
| OpenClaw import and runtime | `VERIFIED_INSTALLED` | Same core path passed; one later Settings MCP acceptance remained unclaimed after discovery degraded. |
| Claude Code and Codex residents | `VERIFIED_INSTALLED` | Luca-managed runtime targets exist and group acceptance evidence shows both responding under stable identities. |
| DMs, rooms, group chat, replies | `VERIFIED_INSTALLED` | Human-to-agent and multi-agent conversation, attribution, inline replies, signed publication, and exactly-once final authority work. |
| Search, unread state, human attachments | `VERIFIED_INSTALLED` | Preserved from the Buzz-derived foundation and included in functional-beta regression evidence. |
| Cancellation and permissions | `VERIFIED_INSTALLED` | Typed cancellation, fail-closed runtime permission cards, restart handling, and native tests passed. |
| Relaunch recovery | `VERIFIED_INSTALLED` | Fresh sessions rehydrate from signed Luca history; native transcript restoration is correctly not claimed. |
| Conversation-first shell | `VERIFIED_INSTALLED` | Direct-open timelines, inline replies, Graphite/blackout treatment, identity marks, activity shelf, and composer polish are integrated. |
| Project → Room navigation | `VERIFIED_INSTALLED` | Master-detail project navigator, DM/loose-room path, empty project, and responsive behavior passed. |
| Agent Library and resident inspector | `VERIFIED_INSTALLED` | Roster, overview, Notebook, settings, and compact conversation projection passed installed verification. |
| Settings and stdio MCP | `VERIFIED_INSTALLED` | Luca-native Settings, shared agent configuration, runtime health, Keychain secrets, per-agent MCP grants, pairing, diagnostics, and About passed. |

## 2. Continuity, Notebook, and Brain

| Capability | Status | Current truth |
|---|---|---|
| Compact encrypted resident handoff | `VERIFIED_INSTALLED` | Same-resident generation, bounded injection, owner correction/disable/retry/forget, and fail-soft behavior passed. |
| Continuity Notes | `VERIFIED_INSTALLED` | Source-backed, encrypted, revisioned, isolated notes are retrieved for future turns. |
| Journal Pages | `VERIFIED_INSTALLED` | Manual same-resident Markdown cognition, provenance, revisions, disclosure, annotation, archive, and forget are implemented. |
| Encrypted continuity kernel | `VERIFIED_INSTALLED` | Keychain custody, XChaCha20-Poly1305 storage, in-memory retrieval, revision authority, rotation, backup, and restore passed G2.2. |
| Scoped Owner Brain files | `VERIFIED_INSTALLED` | Explicit Markdown/text import, grants, lexical retrieval, revoke/stale/reconfirm, and native no-write proof passed V1.2. |
| Connected repositories, Codex, Claude Code | `VERIFIED_INSTALLED` | Metadata discovery, explicit connect, watchers, bounded recall, repository read/search and approved patch/run/commit passed V1.2.1. |
| Full Unified Brain discovery/import | `PARTIAL` | Narrow files, repositories, Codex, and Claude Code exist. Hermes/OpenClaw/Mnemos memory discovery, broad formats, imported-history archive, transactional migration, and full onboarding remain unbuilt. |
| Resident Reflection V1.3 | `NOT_STARTED` | Contract exists for explicit notebook review and revision proposals; no authorized implementation began. |
| Rich Mnemos/Polyphonic inner life | `DEFERRED` | Associative expansion, deep hypomnema, scheduled reflection, journal metabolism, proactive outreach, and long-running inner life remain long-range work. |

## 3. Communication parity

| Capability | Status | Current truth |
|---|---|---|
| Typed communication contracts and exact-turn authority | `INTEGRATED_SOURCE` | Strict protocol, exact-turn Communications MCP, custody/membership checks, cancellation/restart revocation, and security reviews are integrated. |
| Resident sends to existing owner-visible conversation | `INTEGRATED_SOURCE` | Trusted resident-signed kind-9 send, encrypted exact-event vault/outbox, membership compare-and-set, and frozen-byte retry exist. |
| Passive owner Inbox | `INTEGRATED_SOURCE` | Direct/Mentions/Threads/Needs Action/Agents/Reminders/Drafts projection and deterministic browser fixtures exist. Full native aggregation is narrower than the UI fixture. |
| Resident Inbox | `NOT_STARTED` | Current native projection is owner-only. A resident-specific native projection with custody/audience proof is not built. |
| Managed reactions | `NOT_STARTED` | Humans retain reaction behavior; managed-agent typed add/remove-own reaction is not connected. |
| Managed edits | `NOT_STARTED` | Typed author-only agent edit path is not connected. |
| Approved delete | `NOT_STARTED` | Exact owner-approved delete with stale-content binding is not connected. |
| Agent room creation and invitations | `NOT_STARTED` | Owner-visible A2A room/DM creation and invitation sagas are not connected. |
| Managed attachment publication | `NOT_STARTED` | Human attachments work; agent opaque artifact-handle send is not built. |
| Bounded A→B activation | `NOT_STARTED` | Delivery/activation separation was designed; causal depth, loop suppression, offline behavior, and native proof remain. |
| Full communication browser/native gate | `NOT_STARTED` | The acceptance matrix is still unchecked. The current receipt proves a secure foundation, not complete parity. |
| True NIP-17 end-to-end DMs | `DEFERRED` | Current DMs are signed, relay-membership-restricted kind-9 conversations, not gift-wrapped E2EE. |

## 4. Agents, creation, and onboarding

| Capability | Status | Current truth |
|---|---|---|
| Optional Luca operator | `SOURCE_PASS` | Integrated source provides an ordinary, non-privileged operator resident and proposal flow. |
| Agent Forge proposal/review | `SOURCE_PASS` | One shared owner-review model supports conversational and manual creation proposals. |
| Hermes/OpenClaw native provisioning | `SOURCE_PASS` | Transactional create, rediscovery, stable linking, reconciliation, and rollback source exists. Disposable signed native acceptance is still pending. |
| Production onboarding redesign | `UNMERGED` | Eight commits on `codex/brain-onboarding-ux` implement identity, resident, Brain, readiness, accessibility, and acceptance work. They diverge from the integrated branch and require reconciliation. |
| Unified creation flow | `NOT_STARTED` | A single project flow for project name, repository/folders, first room, existing/new residents, optional empty states, and future edits was designed but not completed. |
| Natural-language resident creation | `PARTIAL` | Proposal infrastructure exists; the complete effortless concierge experience and installed proof do not. |
| Polyphonic native multi-model agent | `SPEC_ONLY` | One enduring identity delegating among internal models, direct-chat/escalation lanes, and worker budgets are architecture only. |
| Skills Library | `NOT_STARTED` | Mentioned as the next product slice after MCP; no frozen specification or implementation was found. |

## 5. Projects, sources, and connectors

| Capability | Status | Current truth |
|---|---|---|
| Device-local project catalog | `VERIFIED_INSTALLED` | Projects organize rooms without granting filesystem, Brain, memory, or runtime authority. |
| Basic project creation | `INTEGRATED_SOURCE` | Operator branch commit `3dee0ce` restored project creation, first room, and linking existing Brain sources. |
| Project resident selection | `NOT_STARTED` | Choosing existing or newly created residents during project creation remains unbuilt. |
| Brain Add Folder picker | `PARTIAL` | Imported files and repository connection paths exist, but the discussed Add Folder repair is not complete. |
| Project Sources/Details | `PARTIAL` | Navigation/footer surfaces exist; full path/source management repair remains. |
| Filesystem access requests | `NOT_STARTED` | Agent-requested broader folder/repository access with owner review was designed, not built. |
| Obsidian connector | `SPEC_ONLY` | Read/search Markdown, preserve links/frontmatter, watch changes, exclusions, grants, and later approved writes were scoped. |
| Gmail/Google connector | `SPEC_ONLY` | Search/read first, drafts second, explicit send later, and eventual sync/webhooks were discussed. |
| Database adapters | `DEFERRED` | Suggested as a future Brain adapter slice; no implementation plan was activated. |
| Broad connector platform | `NOT_STARTED` | Shared discovery, authorization, provenance, egress, and action contracts remain future work. |

## 6. Mobile, artifacts, and collaboration

| Capability | Status | Current truth |
|---|---|---|
| Desktop companion pairing | `VERIFIED_INSTALLED` | QR/SAS pairing through the inherited NIP-AB bridge is present in Luca Settings. |
| Luca mobile product | `PROTOTYPE_ONLY` | The inherited Flutter app is still Buzz Mobile; a polished browser prototype exists locally, but no native SwiftUI companion or integrated shipping app exists. |
| Push enrollment/device administration | `PARTIAL` | Backend and pairing substrate exist; production phone enrollment and durable device management do not. |
| iMessage gateway | `DEFERRED` | Considered and explicitly postponed due to fragility and private-API/permission cost. |
| Artifact Library and static Canvas | `SPEC_ONLY` | A full implementation packet exists locally but is untracked and production work was never activated. |
| Live artifact apps/dev servers | `DEFERRED` | Static HTML/Markdown/image/PDF/file rendering is the intended first slice; live processes and network previews are later. |
| Multi-user collaboration | `DEFERRED` | Rooms can hold existing humans and agents, but the broader shared workspace/mobile administration product is not closed. |
| Voice | `DEFERRED` | No Luca-native voice product implementation was found in the audited branch history. |

## 7. Product cleanup and release state

| Item | Status | Current truth |
|---|---|---|
| Visible Buzz branding removal | `VERIFIED_INSTALLED` | Supported Settings/onboarding surfaces use Luca language; internal crate/protocol/binary names remain intentionally for compatibility. |
| Unsupported Buzz product surfaces | `HIDDEN_OR_REJECTED` | Communities, mesh compute, Goose, experiments, workflows, moderation, templates, and custom-emoji administration remain hidden unless separately reopened. |
| Communication-adjacent upstream capabilities | `PARTIAL` | Reactions/custom emoji rendering/forum-style compatibility may remain internally, but managed-agent authority and Luca UX are not complete. |
| Canonical release branch | `PARTIAL` | `luca/v1.1` contains accepted releases, but the newest integrated branch and onboarding work have not been consolidated or pushed. |
| Canonical tester app | `PARTIAL` | A signed branch-specific app exists beside the generic app. One unambiguous tester bundle has not been rebuilt from all accepted work. |
| Repository handoff | `PARTIAL` | Existing `HANDOFF.md` predates the combined integration and contains stale G1/release statements. This status package supersedes it. |

## 8. What is intentionally not a defect

The following are not missing beta requirements unless Riley reopens them:

- a conductor or privileged Luca router;
- arbitrary native Hermes/OpenClaw configuration editing;
- provider API-key storage or direct-provider execution;
- HTTP/SSE MCP transports;
- automatic MCP grants from room membership;
- mesh compute, Goose, hosted communities, experiments, workflows, forums,
  huddles, or broad moderation administration;
- emotional simulation, dream narratives, autonomous research, or a hidden
  background agent society;
- concurrent multi-device write authority.

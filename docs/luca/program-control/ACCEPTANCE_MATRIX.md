# Luca P0–P5 acceptance matrix

An acceptance row is not complete without an exact source commit, the named
surface, and stored evidence. Installed rows must name bundle identity,
signature state, executable hash, and source SHA. Product-language claims must
match observed behavior.

## P0 — Control and product truth

| ID | Acceptance |
|---|---|
| P0-A1 | Candidate integration commits remain ancestry-valid; historical reference commits exist, remain reachable from their recorded branches, retain exact hashes/roles/content, and the user checkout is preserved untouched. |
| P0-A2 | Historical CTRL-001/CTRL-002 status is tied to its recorded exact commits and is not rewritten. |
| P0-A3 | All required control/status documents parse, link, agree on P0–P5 order, use `luca/v1-beta`, and pass exact-commit validation before CTRL-003 promotion. |
| P0-A4 | Every visible capability is classified as functional, hidden/disconnected, reusable with presentation, thin managed adapter, or genuinely missing; communication commits are classified without deletion. |
| P0-A5 | Riley explicitly approves the revised graph, ownership, worktree topology, and activation order; no team or train exists beforehand. |

## P1 — Complete visible messaging and A2A

| ID | Acceptance |
|---|---|
| P1-A1 | Owner and resident exchange verbatim replies in real DMs and multi-agent rooms through Hermes and OpenClaw; attribution and chronology are correct. |
| P1-A2 | An authorized managed resident can use the existing DM/room/membership operations; unauthorized membership or recipient resolution fails visibly. |
| P1-A3 | Replies, mentions, invitations, and explicit A2A activation are visible; delivery and activation truth remain distinguishable without a new generalized causal system. |
| P1-A4 | Managed add/remove-own reaction and author edit use existing signed-event semantics and render in the ordinary timeline. |
| P1-A5 | Ordinary local communication has no confirmation; exact confirmation appears only for the five bounded risk classes in the charter. |
| P1-A6 | Managed attachments use the existing media pipeline and publish a safe handle/reference; failure is visible and conversation remains usable. |
| P1-A7 | No parallel message store, room model, membership authority, or signing path is introduced. |
| P1-A8 | Search, unread/read state, thread/reply links, and canonical deep links work for owner and managed-agent messages. |
| P1-A9 | Owner Inbox and useful Activity derive from existing events/projections, show no mock records, and survive restart. |
| P1-A10 | Direct mode is the default and Guarded/Restricted modes are absent from the Phase 1 UI. |
| P1-A11 | Cancel/restart/offline/duplicate tests prove at most one final publication and truthful unavailable/delivered state. |

## P2 — Projects, native agents, and app UX

| ID | Acceptance |
|---|---|
| P2-A1 | A clean profile completes identity, first resident, Brain/source choice, readiness, and first useful destination without dead ends. |
| P2-A2 | Returning profiles bypass onboarding; interrupted onboarding and recovery resume without duplication or data loss. |
| P2-A3 | Onboarding passes keyboard, screen-reader naming, reduced motion, 390×844, and desktop-width checks. |
| P2-A4 | Runtime discovery/import shows native identity, readiness, and degradation without mutation; any later explicit configuration write is owner-approved, journaled, and uses only the runtime-owned store. |
| P2-A5 | Manual and conversational resident creation converge on one reviewed, transactional native creation path. |
| P2-A6 | Start, stop, restart, relaunch, cancel, unavailable, and reconnect states are operable and truthful. |
| P2-A7 | Agent Library, Settings, runtime health, model/provider choice, and MCP grants agree on the same resident record. |
| P2-A8 | Stable crypto identity, host signing, credential isolation, read-only discovery, credential-value non-exposure, and unrelated native-state immutability around journaled owner-approved writes pass protected-state checks. |
| P2-A9 | One flow creates an optional project, first room, existing/new/no residents, and repository/folder/no sources. |
| P2-A10 | Add Folder, repository connection, source details, grants, stale/reconfirm, and disconnect are complete and legible. |
| P2-A11 | Project details support edit, reopen, empty states, moved-source recovery, and recoverable deletion. |
| P2-A12 | Project or room membership grants no filesystem, Brain, MCP, tool, provider, model, budget, or external-action authority. |
| P2-A13 | Project-room navigation, loose rooms, DMs, empty projects, and compact layouts retain selection and deep-link behavior. |
| P2-A14 | Blackout shell, composer, replies, mentions, reactions, edits, deletion confirmation, invitations, attachments, search, and unread states are polished together. |
| P2-A15 | Agent Library, Settings, Brain Setup, Notebook, Inbox, and Activity present one coherent resident/project model. |
| P2-A16 | Cancellation, restart, duplicate, offline, unavailable-runtime, and partial-failure states explain what happened and the next safe action. |
| P2-A17 | The combined shell passes visual, keyboard, focus, overflow, responsive, reduced-motion, and accessibility checks. |
| P2-A18 | Pairing is presented as phone access to Mac-hosted residents; no UI implies that durable residents run on the phone. |

## P3 — Installed functional beta

| ID | Acceptance |
|---|---|
| P3-A1 | The integration train is created only after P1/P2 source gates and contains an explicit ordered commit manifest. |
| P3-A2 | One train SHA passes focused gates, full repository checks, clean/returning profiles, restart/offline, and regression acceptance. |
| P3-A3 | The unchanged candidate builds, signs, installs, launches, and records bundle ID, signature, executable hash, and source SHA. |
| P3-A4 | A real Hermes/OpenClaw demo completes onboarding, agent lifecycle, DM/group/A2A, project/source, Inbox/Activity, search/unread, restart, and recovery flows. |
| P3-A5 | UI and release copy say preview/beta, do not claim E2EE or hardening, and warn against highly sensitive data on unfinished surfaces. |
| P3-A6 | `luca/v1-beta` points to the accepted unchanged candidate only after Riley promotion approval; the proposed release worktree matches it. |
| P3-A7 | A fresh handoff identifies one canonical source coordinate, one tester bundle, exact proof, known limitations, and rollback path. |

## P4 — Mnemos felt continuity

| ID | Acceptance |
|---|---|
| P4-A1 | The exact bound resident runtime/model reads its native identity documents without copying or rewriting native configuration. |
| P4-A2 | Handoffs are authored by that resident/runtime, stored verbatim, attributed, revisioned, and distinguishable from retrieval. |
| P4-A3 | Notes, notebooks, journals, and identity-aware retrieval share provenance and resident isolation without collapsing distinct artifact types. |
| P4-A4 | Reflection is explicit, same-resident, bounded, and proposes revisions rather than silently rewriting identity or history. |
| P4-A5 | Hypomnema/associative recall is supplemental context with disclosed sources, not an impersonating substitute author. |
| P4-A6 | Revisions, owner corrections, pins, annotations, archive, forget, and source lineage remain inspectable and reversible where promised. |
| P4-A7 | Native profile/identity remains authoritative; crypto keys prove address/authorship, not inner identity or meaning. |
| P4-A8 | Missing, locked, stale, corrupt, or failed continuity degrades visibly and never blocks ordinary conversation. |
| P4-A9 | Creative notebooks and inner-life surfaces remain resident-authored, private, attributable, and free of false consciousness/autonomy claims. |

## P5 — Optional hardening and deferred expansion

| ID | Acceptance |
|---|---|
| P5-A1 | Guarded/Restricted modes ship only after explicit activation, user need, clear semantics, and no regression to Direct mode. |
| P5-A2 | Generalized leases/outboxes/approval receipts demonstrate a concrete threat or reliability benefit before replacing any current adapter. |
| P5-A3 | Advanced causal/autonomy controls are bounded, visible, cancellable, budgeted, and do not create a privileged hidden router. |
| P5-A4 | Any E2EE work includes interoperability, metadata, recovery, group membership, and truthful migration acceptance. |
| P5-A5 | Key rotation/recovery and writer transfer protect current data, reject stale writers, and preserve stable resident identity. |
| P5-A6 | Adversarial/multi-tenant hardening has a reviewed threat model and cannot downgrade Phase 1 usability silently. |
| P5-A7 | Native mobile passes real-device pairing, messaging, reconnect, push, permission, attachment, and Mac-hosted-resident acceptance. |
| P5-A8 | Artifact Library/Canvas begins with safe static versioned local artifacts, restart recovery, diff, and revert-as-new-version. |
| P5-A9 | Skills Library distinguishes skills, MCP, instructions, and Brain sources and supports discovery, grants, lifecycle, and compatibility. |
| P5-A10 | Unified Brain import is staged, cancellable, atomic, idempotent, provenance-preserving, and never silently promotes imported history to identity. |
| P5-A11 | Connectors begin read/search only; writes and sends require separate exact acceptance and appropriate confirmation. |
| P5-A12 | Multi-model delegation preserves one resident identity, explicit budgets, attribution, cancellation, and no worker-facing durable secrets. |
| P5-A13 | An optional conductor is an ordinary replaceable resident role with explicit grants and no hidden routing or authority. |
| P5-A14 | Multi-user, voice, live artifacts, database adapters, and remote sync receive separate contracts and activations rather than one broad epic. |

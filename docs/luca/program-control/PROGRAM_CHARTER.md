# Luca V1 program charter

## Product outcome

Ship a truthful Luca functional beta in which one owner can create, import,
configure, run, stop, relaunch, and converse with persistent residents through
a polished installed macOS application. The product must visibly cover the
complete messaging, project, agent, Brain, Notebook, Inbox, Activity, search,
unread, and recovery experience before broader hardening leads the roadmap.

After that product works end to end, build Mnemos as resident-authored felt
continuity: native identity documents, handoffs, notes, notebooks, journals,
reflection, hypomnema, provenance, corrections, and richer creative inner-life
surfaces. Only then add optional production and adversarial hardening.

## Phase contract

| Phase | Milestones | Outcome |
|---|---|---|
| Functional product | P0–P3 | Verified truth, complete visible messaging/A2A, projects/agents/app UX, and an installed functional-beta demo |
| Mnemos continuity | P4 | Native-runtime-authored identity and continuity with provenance and fail-soft behavior |
| Optional hardening and expansion | P5 | Security upgrades and deferred product expansions activated explicitly |

## Non-negotiable visible scope for P1–P3

- clean and returning-profile onboarding;
- native Hermes and OpenClaw discovery/import without changing native config;
- in-app agent creation, configuration, start, stop, restart, and relaunch;
- DMs, groups, A2A communication, explicit mention/invite activation;
- rooms, replies, mentions, reactions, edits, invitations, attachments, search,
  unread/read state, and narrow destructive confirmations;
- projects containing rooms, repositories, folders, residents, and sources;
- project-room navigation and project create/edit/reopen/recovery;
- Agent Library, Settings, Brain Setup, Notebook, composer, and blackout shell;
- useful owner Inbox and Activity built from existing events/projections;
- cancellation, restart recovery, duplicate suppression, and exactly-once final
  publication;
- installed macOS acceptance with real agents and no mock-data claim.

Visible functionality is not cut to reduce engineering or test complexity.
Existing signed-event, relay, room, membership, DM/group, reply/mention,
reaction, edit/delete, attachment, search, unread, feed, Inbox, human UI, and
runtime-publication infrastructure is reused instead of replaced.

## Direct-mode communication policy

Direct mode is the default inside the owner's local network. Resident output is
published verbatim in ordinary authorized conversations. Routine local
communication does not require approval.

Confirmation is limited to destructive deletion, an external or unresolved
recipient, authority or membership-policy changes, broad broadcasts, and
material data effects. Guarded/Restricted product modes are not Phase 1 work.

## Protections that remain in force

- stable cryptographic resident identity and host signing;
- resident/owner key and credential isolation from models and descendants;
- read-only discovery plus explicit, owner-approved configuration through the
  runtime's supported native store; credential values never enter Luca;
- encrypted Brain and continuity storage;
- cancellation, restart recovery, duplicate suppression, and exactly-once
  final publication;
- project/membership separation from data, tool, provider, model, and budget
  authority;
- honest runtime readiness and truthful privacy language;
- continuity failure never blocks ordinary conversation.

These protections are functional constraints, not a mandate to invent new
security architecture before the beta works.

## Demo truth

The P3 artifact is a functional preview/beta, not a hardened production claim.
It must use real installed behavior, may not claim end-to-end encryption, and
must warn against highly sensitive real-world data on unfinished surfaces.

## Governance

Program Integration & Release owns the graph, control/status documents,
shared-file leases, integration train, installed proof, and release promotion.
Product teams own bounded feature slices. Independent QA verifies claims;
security review protects the existing non-negotiable boundaries without
reordering the program around speculative hardening.

CTRL-004, Riley approval of this revised graph, is mandatory before team
worktrees are created or kickoff prompts are dispatched.

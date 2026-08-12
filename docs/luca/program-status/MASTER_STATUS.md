# Luca master product status

## Verdict

Luca has a strong installed foundation, but the complete combined tester beta
is not yet closed. The next release must finish visible function first, then
Mnemos continuity, then optional hardening.

## Functional and preserved

| Capability | Verified truth |
|---|---|
| Resident identity/runtime | Stable crypto identity, host signing, native Hermes/OpenClaw discovery/import/runtime, Luca-managed runtimes, cancellation, permission, restart, exactly-once final publication |
| Core conversation | Owner-agent DM/group/reply/mention, signed chronology, attachments, search, unread/read, deep links, timeline/composer foundation |
| Human collaboration operations | Rooms/membership, invitations, reactions, edits/deletion, attachments and search are implemented in existing commands/builders/UI |
| Continuity/Brain | Encrypted handoff, Continuity Notes, Journal Pages, scoped files, repositories, Codex/Claude Code connections, provenance/revisions, fail-soft seams |
| Product surfaces | Blackout conversation shell, project-room navigation, Agent Library, Settings, Brain/Notebook surfaces, owner Inbox/activity inputs, desktop pairing foundation |

These capabilities must be reused and regression-tested, not rebuilt.

## Hidden/disconnected or requiring presentation

| Capability | Current truth | P1–P3 action |
|---|---|---|
| Managed communication mutations | Human reaction/edit/delete paths exist; managed connection is incomplete | Thin adapters over existing operations |
| Agent-created rooms/membership/invites | Existing room/DM/member/invite infrastructure exists | Connect managed operations and visible confirmation boundary |
| Explicit A2A activation | Managed dispatch exists; complete mention/invite activation semantics are not visibly closed | Minimal explicit activation and exact acceptance, not generalized causal architecture |
| Owner Inbox/useful Activity | Existing projections/events/fixtures are present but combined native product proof is incomplete | Restore/present existing data first |
| Onboarding | Complete source work exists on a divergent branch | Reconcile onto current shell and verify clean/returning profiles |
| Project creation/sources | Foundation/navigation exist; unified create/details/source recovery are incomplete | Complete visible flow without implicit authority |
| Agent creation/lifecycle | Forge/native paths exist; combined manual/conversational/start/stop/relaunch UX and installed proof remain | Reconcile and present one coherent system |

## Genuinely missing milestones

- complete all-surface P1 messaging/A2A installed behavior;
- complete combined P2 onboarding, projects, native agents, Inbox/Activity, and
  application UX;
- one unchanged P3 installed functional-beta demo and canonical tester release;
- P4 native-runtime-authored Mnemos felt continuity and richer creative
  notebooks;
- P5 tasks only when separately activated.

## Communication mode

Direct mode is the Phase 1 default. Ordinary authorized local messages publish
resident output verbatim with no routine approval. Confirmation is limited to
destructive deletion, external/unresolved recipients, authority/membership
policy changes, broad broadcasts, and material data effects.

## Protections retained in the beta

Stable identity, host signing, key/credential isolation, read-only native
configuration, encrypted Brain/continuity, cancellation, restart recovery,
duplicate suppression, exactly-once final, organization/authority separation,
and honest readiness/privacy remain mandatory.

Generalized leases/outboxes/receipts, advanced causal graphs, Guarded/
Restricted modes, NIP-17, production key rotation/recovery, and hostile
multi-tenant hardening are not beta dependencies unless a concrete functional
failure proves otherwise.

## Release truth

The proposed combined tester branch is `luca/v1-beta`. It does not yet exist as
an activated release coordinate. The P3 artifact will be labeled preview/beta,
will not claim E2EE or production hardening, and will warn against highly
sensitive data on unfinished surfaces.

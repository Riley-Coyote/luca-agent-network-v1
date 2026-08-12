# Luca QA and security topology

QA leads P1–P3 proof of the visible product. Security review protects the
existing indispensable boundaries and does not introduce a competing roadmap.

## Review layers

| Layer | Required evidence |
|---|---|
| Source-focused | Unit/widget/native tests for the bounded task on exact commit |
| Browser/mock bridge | Deterministic state, interactions, console cleanliness, accessibility, visual screenshots where applicable |
| Native development app | Real Tauri commands, runtime processes, signing/publication, storage, permissions, restart/offline behavior |
| Installed signed app | Clean and upgraded profiles, Hermes/OpenClaw, package/signature/hash/source identity, full P3 demo |
| Real device | Pairing truth in P2; full native mobile only when EXT-501 is activated |

## P1–P3 security acceptance

Required because functionality would otherwise be unsafe or dishonest:

- stable resident identity and host-only signing;
- no model/worker access to durable keys or native credentials;
- native Hermes/OpenClaw configuration remains byte-stable;
- authorization/membership/recipient checks for the existing operation;
- narrow confirmations only at the charter boundary;
- cancellation/restart/duplicate/exactly-once behavior;
- organization remains separate from authority;
- encrypted Brain/continuity already relied upon by the product;
- truthful runtime/privacy/degradation state.

Not a P1–P3 requirement without a proven blocker: generalized exact-turn
leases, universal action outboxes, complete receipt Activity, advanced causal
graphs, broad approval bindings, unrestricted autonomous reply controls,
NIP-17, production rotation/recovery, or hostile multi-tenant hardening.

## QA matrix emphasis

- clean and returning onboarding;
- Hermes and OpenClaw import/readiness/create/start/stop/relaunch;
- DM/group/A2A, replies/mentions/invites/reactions/edits/delete/attachments;
- search/unread/read/deep links, Inbox/Activity;
- projects/rooms/repos/folders/residents/sources and navigation;
- Agent Library, Settings, Brain Setup, Notebook, composer, blackout shell;
- cancel/restart/offline/duplicate/partial-failure;
- desktop and 390×844 layout, keyboard/focus/screen-reader/reduced motion;
- installed demo and truthful beta/privacy copy.

## Verdicts

Reviewers return `PASS`, `FAIL`, or `NEEDS_REPAIR` against an exact commit and
acceptance IDs. A PASS cannot promote beyond `source_tested`; Program performs
integration and installed/release promotion.

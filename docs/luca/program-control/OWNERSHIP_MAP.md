# Luca ownership and shared-file map

Ownership is a write boundary, not a reason to duplicate architecture.

| Area | Primary team | Typical owned paths after task activation |
|---|---|---|
| Program control/status/release | Program Integration & Release | `docs/luca/program-control/**`, `docs/luca/program-status/**`, `HANDOFF.md`, curated release evidence/metadata |
| Onboarding and combined product presentation | Experience & Onboarding | `desktop/src/features/onboarding/**`, activated shell/composer/accessibility files and E2E specs |
| Messaging/A2A/Inbox/Activity | Communications & Collaboration | existing communication-domain modules, narrow managed adapters, Inbox/Activity projections, communication tests |
| Projects/Brain/Notebook/Mnemos | Projects, Brain & Connections | `desktop/src/features/projects/**`, `desktop/src/features/brain/**`, activated Notebook/continuity modules and tests |
| Resident lifecycle/runtime/Library/Settings | Agent Platform | `desktop/src/features/agents/**`, activated native-runtime and Settings modules/tests |
| Pairing/mobile/artifacts/creative | Clients & Creative Surfaces | activated pairing/compact acceptance files; later mobile/artifact paths only under P5 activation |

Exact task capsules narrow these defaults.

## Existing owners to reuse

| Capability | Existing implementation authority |
|---|---|
| Message send, reply, mention, host publication | Existing desktop native commands and Buzz SDK event builders |
| Reaction/edit/delete | Existing message commands, wrappers, and event builders |
| DM/room/membership/invitation | Existing channel/DM commands, relay membership handling, and UI surfaces |
| Attachments | Existing media commands and message attachment presentation |
| Search/unread/read/deep links | Existing search, read-state, timeline, and route infrastructure |
| Owner Inbox/Activity | Existing unified Inbox/feed projections and runtime publication events |

Teams adapt these owners; they do not create alternate stores or semantics.

## Program-owned shared hotspots

An exact-file lease is required for:

- app/root provider, routing, onboarding gate, home/sidebar, timeline, composer,
  and shared navigation composition;
- frontend/native command registration and shared API clients;
- native app state, managed-runtime registry, signing/cancellation/permission
  seams, and event-kind registry;
- migrations, manifests, lockfiles, generated bindings, bundle/version/signing,
  updater, release scripts, canonical evidence, and status ledgers.

## Lease record

Every lease states exact file, task, branch SHA, semantic purpose, interfaces,
other consumers, reviewer, tests, expiry, and Program approver. Only one writer
owns a leased file. If a team discovers broader scope, it stops and requests a
new lease.

## Global forbidden operations

- Reset, discard, or clean user work.
- Merge an archaeology/reference branch wholesale.
- Change native Hermes/OpenClaw configuration or copy credentials.
- Give project/room membership implicit data/tool/model/provider/budget rights.
- Add a hidden conductor, parallel conversation plane, or model-owned signer.
- Claim integrated/installed/released status from a team branch.

# Luca ownership and conflict map

Ownership is a write boundary, not an architecture silo. Reading across the
repository is allowed; writing outside owned paths requires a Program-issued
lease recorded in the task receipt.

## Durable ownership

| Area | Primary owner | Typical paths |
|---|---|---|
| Program control/status/release | Program Integration & Release | `docs/luca/program-control/**`, `docs/luca/program-status/**`, release metadata, curated evidence |
| Onboarding/recovery experience | Experience & Onboarding | `desktop/src/features/onboarding/**`, onboarding E2E specs |
| Managed communication/Inbox/Activity | Communications & Collaboration | communication domain modules, managed message adapters, Inbox/Activity projections and tests |
| Projects/Brain/connections | Projects, Brain & Connections | `desktop/src/features/projects/**`, `desktop/src/features/brain/**`, approved Brain/source native modules |
| Forge/runtime/skills | Agent Platform | `desktop/src/features/agents/**`, Forge/runtime modules, skill domain and tests |
| Mobile/artifacts/creative clients | Clients & Creative Surfaces | approved native mobile paths, artifact/canvas modules, client-specific tests |

A task's exact `owned_paths` in `PROGRAM_GRAPH.yaml` is narrower than the team
default and controls.

## Program-owned shared hotspots

No product team edits these without a named lease:

- `desktop/src/app/**` and `desktop/src/main.tsx`;
- home/sidebar/navigation composition shared by two or more teams;
- frontend command clients and Tauri command registration;
- `desktop/src-tauri/src/lib.rs`, command module indexes, app state construction,
  and shared managed-runtime registries;
- `crates/buzz-core/src/kind.rs` and any protocol/event registry;
- shared signing, permission, cancellation, and outbox authority seams;
- migrations, `Cargo.lock`, `pnpm-lock.yaml`, Flutter lockfiles, workspace
  manifests, and generated bindings;
- bundle identifiers, versioning, signing, updater, release scripts, and tags;
- canonical status ledgers, integration receipts, and release verdicts.

## Overlap and merge-risk map

| Hotspot | Teams | Risk | Control |
|---|---|---|---|
| App/onboarding gate and route selection | Experience, Projects, Communications | Returning profiles or deep links enter wrong surface | `IF-01`; onboarding lands first; shared tails use leases |
| Resident picker/registry | Experience, Projects, Agent Platform | Duplicate residents or mutable identity | `IF-02`; Agent Platform owns domain, consumers use frozen selectors |
| Project-room membership | Projects, Communications | Organization becomes authority | `IF-03` + `IF-06`; negative grant tests required |
| Commands/API/registries | All product teams | Build conflicts and silent contract drift | `IF-04`; Program applies registration adapters |
| Timeline, Inbox, Activity, sidebar | Experience, Communications | UI merge conflict or false state | Onboarding shell checkpoint before communication UI tail |
| Communication/runtime lifecycle | Communications, Agent Platform | Duplicate finals, leaked capability, loops | `IF-05` + `IF-07`; Security pre-merge review |
| Brain/source picker and onboarding | Experience, Projects | Duplicate source state or hidden grant | Projects own transaction; Experience only presents it |
| Attachments and Artifact Library | Communications, Clients | Raw path/bytes leak or executable content | `IF-08`; opaque handles only in P0 |
| Pairing and mobile | Agent Platform, Communications, Clients | Phone gains resident authority or stale device access | `IF-09`; mobile is a client of Mac-hosted residents |
| Release metadata/evidence | All | Claims tied to different commits | `IF-10`; Program-only promotion |

## Shared-file lease protocol

A lease entry in the task receipt declares:

1. exact file(s), never a broad directory when a file is enough;
2. owning task and branch SHA;
3. intended semantic change;
4. frozen interfaces affected;
5. start and expiry gate;
6. other teams notified;
7. focused tests and reviewer;
8. Program approval.

Only one active writer owns a shared file. Other teams queue adapter requests or
continue in disjoint files. Program may revoke a lease when scope expands or
the task misses its repair limit.

## Global forbidden operations

- Reset, clean, discard, or bulk-stage any existing worktree.
- Merge `agent/vision-demo` or the onboarding branch wholesale.
- Copy dirty-checkout trees without a named inventory and review.
- Change shared contracts, event kinds, migrations, manifests, or lockfiles
  silently.
- Pass owner/resident secrets or durable authority to models/tools.
- Infer filesystem, Brain, MCP, provider, model, budget, or external-action
  authority from project or room membership.
- Claim integrated, installed, or released status from a team branch.

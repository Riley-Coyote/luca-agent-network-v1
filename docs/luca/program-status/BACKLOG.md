# Luca consolidated backlog

This backlog orders unfinished work by product risk and dependency. It is not a
promise to build every deferred idea. Each item states the proof required to
move it to complete.

## P0 — Establish one honest, canonical beta

### P0.1 Reconcile production onboarding

- Review the eight commits unique to `codex/brain-onboarding-ux`.
- Preserve its working first-run identity, profile, resident, Brain, readiness,
  recovery, and accessibility behavior.
- Resolve its 88-file overlap with the newer conversation and project shell;
  never merge it wholesale without visual regression review.
- Remove any prototype-only or stale fixture assumptions.

Done when: clean-profile onboarding passes in the combined app at desktop and
mobile widths, existing profiles do not re-enter onboarding, recovery works,
and the signed installed app is observed.

### P0.2 Complete communication parity

The secure-send foundation is integrated, but the original communication plan
is not complete.

Required remaining slices:

1. managed add/remove-own reactions;
2. author-only edit;
3. exact owner-approved delete;
4. owner-visible A2A DM/private-room creation;
5. same-owner invitations and membership changes with approval where required;
6. opaque artifact-handle attachment send;
7. bounded A→B and A→B→A activation with causal depth, cancellation, duplicate
   suppression, offline delivery, and `delivered_not_activated` truth;
8. resident-specific native Inbox projection;
9. complete owner Inbox aggregation, pagination, read/ack/handled state, and
   canonical deep links;
10. browser, restart, security, Hermes, OpenClaw, and installed-app acceptance.

Done when: every applicable row in
`docs/luca/communication-parity/ACCEPTANCE.md` has exact evidence and an
installed verdict. Do not call NIP-17 complete; that is a separate milestone.

### P0.3 Finish unified project creation and repair source entry points

- One optional project name and working context.
- Attach repository, knowledge folder, arbitrary folder, or no source.
- Create a first room or leave the project empty.
- Select existing residents, create/link a resident, or add none.
- Do not expose runtime selection unless an advanced user requests it.
- Support later room/resident/source add/remove operations.
- Repair Brain Add Folder and Project Sources/Details.
- Keep all filesystem and Brain grants separate from project membership.

Done when: fresh onboarding and existing profiles can create, reopen, edit, and
delete/recover project organization in the signed app without hidden authority
or mock data.

### P0.4 Close Agent Forge native acceptance

- Run the disposable signed-app Hermes and OpenClaw create/reconcile/rollback
  matrix in `docs/luca/operator-forge/ACCEPTANCE.md`.
- Verify unrelated native configuration, credentials, memory, workspace,
  schedules, and pairing remain byte-identical.
- Verify cancellation, partial failure, duplicate import, rediscovery, and
  rollback.

Done when: Operator Forge has an installed PASS verdict tied to one exact
product commit and bundle hash.

### P0.5 Consolidate and publish the repository

- Choose the integrated product head after P0.1–P0.4.
- Fast-forward or create one canonical release branch.
- Update top-level handoff/version/release records.
- Push all required branches and tags to GitHub.
- Build one clearly named signed tester app; remove ambiguity between the
  generic and branch-specific dev bundles without deleting rollback copies.

Done when: a new agent can clone the GitHub repository, check out one documented
branch, build the same product, and match the installed bundle's source commit.

## P1 — Tester-ready product completeness

### P1.1 Skills Library

No implementation was found. Freeze scope before work:

- discover Luca-owned and runtime-native skills;
- distinguish read-only native definitions from Luca-managed installations;
- per-agent grants and compatibility;
- secret/permission boundary;
- install/update/remove lifecycle;
- presentation in Settings and Agent Library.

Do not conflate skills, MCP servers, system instructions, or Brain sources.

### P1.2 Mobile companion product

- Decide SwiftUI product architecture and reuse the existing secure pairing
  protocol rather than shipping the inherited Buzz-branded Flutter UI.
- Implement rooms/DM/history, send, push enrollment, permission approvals,
  attachments, and reliable reconnect.
- Test on a real iPhone through TestFlight.

The existing browser prototype is design evidence only.

### P1.3 Brain and connection usability

- Complete folder/repository pickers and source detail flows.
- Make grants, stale/reconfirm, indexing, exclusions, and disconnect legible.
- Resolve degraded OpenClaw discovery before claiming its Luca-owned MCP path.
- Add source failure and moved-folder recovery without deleting conversations.

### P1.4 Release hardening

- Clean-profile and upgraded-profile migrations.
- Installed crash/relaunch and offline runtime drills.
- Accessibility, keyboard, reduced motion, 390×844 through large desktop.
- Packaging, updater, backup/restore, logs/diagnostics, and rollback.
- One full repository gate only on the final unchanged commit.

### P1.5 Effortless resident creation

- Complete the natural-language concierge path over the existing proposal and
  owner-review authority.
- Preserve one stable resident identity and advanced runtime configuration as
  an optional detail rather than a first-run requirement.
- Prove manual and conversational creation converge on the same review and
  installed native behavior.

### P1.6 Agent-requested source access

- Let a resident request a specific folder or repository scope for one stated
  purpose.
- Bind owner approval to the exact resident, source, action, and current
  content/path state.
- Keep project or room membership from granting access automatically.
- Prove revoke, stale/reconfirm, moved source, cancellation, and restart.

## P2 — High-impact product expansions

### P2.1 V1.3 Resident Reflection

Implement explicit owner-triggered notebook review using the same resident's
runtime/model. Allow private reflection and bounded note proposals; preserve
prior journal pages and owner-pinned corrections. No scheduler or proactive DM.

### P2.2 Obsidian connector

Recommended first external connector:

- choose vault/subfolder;
- read/search Markdown;
- preserve wiki links, tags, frontmatter, and provenance;
- watch changes and honor exclusions;
- grant per resident;
- add owner-approved diff/write/undo only after read-only acceptance.

### P2.3 Artifact Library and static Canvas

Activate the existing packet under `docs/luca/artifacts/` only after it is
reconciled and committed. First slice: owner import/open, local catalog,
immutable versions, static HTML/Markdown/image/PDF/text/file renderers,
Preview/Source/Versions, diff, revert-as-new-version, restart recovery. Then add
resident scoped create/update/read/list operations.

### P2.4 Expanded Unified Brain import

- discovery reports for Hermes, OpenClaw, Mnemos, repositories, folders, Codex,
  Claude Code, and optional Tab Ledger;
- manual ChatGPT/Claude/Luca/Mnemos/Polyphonic exports;
- broader safe formats and explicit unsupported files;
- staged, cancellable, atomic, idempotent import with source lineage;
- Imported History archive outside live conversations;
- proposal-based migration into resident continuity or owner Brain;
- provider-egress consent and body-free receipts.

### P2.5 Gmail/Google connector

Begin read-only search/read. Add drafts only after read proof. Sending requires
exact user approval. Sync/webhooks and calendar actions are later sub-slices.

## P3 — Long-range roadmap

These remain candidates, not current commitments:

- local embeddings and bounded associative graph expansion;
- revision-bound code graph and Graphify/Graphiti/GraphRAG experiments;
- scheduled reflection with visible budgets and quiet hours;
- conservative proactive outreach;
- richer hypomnema, personal journal metabolism, and inner-life behaviors;
- multimedia/creative Notebook artifacts, art, music, canvases, and resident
  projects;
- one native multi-model resident identity with direct-chat and escalation
  lanes plus bounded worker delegation;
- an optional conductor held by an ordinary resident as an explicit project
  role, after roles, grants, budgets, communication, activation, Inbox,
  receipt-backed Activity, approvals, recovery, and audit are complete;
- shared/multi-user administration and concurrent multi-device authority;
- native voice;
- true NIP-17/group end-to-end encrypted messaging;
- remote MCP transports and cloud synchronization.

## Explicitly closed unless reopened

Do not spend time restoring these merely because Buzz contains them:

- Goose;
- mesh compute;
- hosted communities as the Luca project model;
- experiments;
- broad workflow/canvas/forum/huddle product surfaces;
- moderation, templates, and custom emoji administration;
- hidden, privileged, mandatory, or authority-bypassing conductor behavior;
- unrestricted raw Nostr/CLI/signing authority for agents.

# Luca team charters

All six teams operate under `INTEGRATION_PROTOCOL.md`. Security and QA are
independent reviewers, not substitute implementation owners.

## 1. Program Integration & Release

**Mission:** preserve one truthful product line and turn reviewed team commits
into installed, reproducible releases.

**Owns:** graph and dashboard; status/decision/run ledgers; architecture and
shared-interface authority; branch/worktree registry; shared-file leases;
integration train; conflict resolution; evidence validation; installed builds;
release metadata; GitHub publication.

**Does not own:** implementing product slices on behalf of teams except a
minimal integration adapter approved and recorded after a merge conflict.

**First wave:** obtain Riley approval, ratify freezes, create team worktrees,
receive read-only conflict maps, and open the P0 train only after onboarding
reconciliation is reviewable.

**Required output:** exact train SHA, accepted commit list, conflicts and
resolutions, full gate receipts, installed bundle identity/hash, release branch
and push receipt.

## 2. Experience & Onboarding

**Mission:** make Luca feel like a simple, polished personal chat home for new
and returning owners while preserving the accepted conversation shell.

**Owns:** onboarding views/state/tests; owner identity/profile/recovery UX;
first resident and Brain readiness; returning-profile bypass; responsive and
accessibility acceptance for owned flows.

**Does not own:** messaging authority, resident signing/runtime policy, Brain
grant semantics, project persistence, app-wide registries, release files, or
other teams' feature directories.

**First wave:** read-only map the eight onboarding commits against `f1f1eb3`,
publish a file-by-file keep/adapt/drop/conflict plan, and request leases for
shared shell files. Write only after Program approval.

**Required output:** source-tested reconciliation commit(s), desktop and
390×844 screenshots, keyboard/screen-reader/reduced-motion checks, clean and
returning profile receipts, and no-regression evidence for the conversation
shell.

## 3. Communications & Collaboration

**Mission:** finish safe resident communication primitives and trustworthy
attention/activity projections without turning Luca into a mandatory workflow
engine.

**Owns:** managed message mutations; A2A room/DM creation and invitations;
attachment publication; bounded activation; owner/resident Inbox domain logic;
receipt-backed Activity for communications; communication acceptance tests.

**Does not own:** raw signing keys, universal orchestration, project/Brain
authority, hidden conductor privileges, generic app shell, event registries,
or NIP-17 in P0.

**First wave:** freeze operation envelopes and receipts, then implement disjoint
native/protocol slices. Defer shared timeline/sidebar UI until onboarding's
shell reconciliation point is frozen.

**Required output:** exact event/receipt fixtures, negative authority tests,
restart/offline/duplicate/causal-loop receipts, browser/native evidence, and
Hermes/OpenClaw acceptance tied to exact commits.

## 4. Projects, Brain & Connections

**Mission:** make projects, residents, and sources easy to compose while keeping
organization strictly separate from data/tool authority.

**Owns:** unified project creation and editing; source/folder/repository entry;
Project Details/Sources; Brain source usability and grants; later Reflection,
Unified Brain expansion, and connectors.

**Does not own:** resident runtime provisioning, signing, communication event
semantics, app-wide routing/registries, mobile, artifact rendering, or external
actions without a frozen connector approval contract.

**First wave:** freeze the creation transaction and membership/grant separation;
build deterministic fixtures; implement disjoint picker/detail repairs; defer
shared onboarding shell integration until the Program lease is granted.

**Required output:** create/reopen/edit/recover receipts, source-byte no-write
proof, grant/revoke/stale tests, moved-source failure states, responsive
screenshots, and exact commits.

## 5. Agent Platform

**Mission:** make residents easy to create and configure while preserving
stable identity, native-runtime ownership, and bounded model/tool authority.

**Owns:** Agent Forge; resident creation/configuration; runtime boundaries;
native interoperability; Skills Library; longer-term multi-model resident and
optional conductor role mechanics.

**Does not own:** project membership, conversation publication policy, owner
Inbox projection, Brain semantics, shared shell, release promotion, or native
credential/configuration migration.

**First wave:** acceptance-first. Prepare disposable signed Hermes/OpenClaw
fixtures and run the existing Forge matrix. Product writes require a specific
failed row and Program-approved repair capsule.

**Required output:** before/after protected-state hashes, create/reconcile/
rollback/cancel/duplicate receipts, signed bundle SHA, failure classification,
and exact repair commit if one is necessary.

## 6. Clients & Creative Surfaces

**Mission:** extend Luca to native companion and creative artifact surfaces
without moving residents or authority onto the phone or bypassing desktop
policy.

**Owns:** native mobile companion; Artifact Library; Static Canvas; later
creative Notebook artifacts, live surfaces, voice, and additional clients.

**Does not own:** desktop resident runtime, signing policy, core messaging
contracts, Brain authority, shared registries, or P0 shell/source work.

**First wave:** read-only preparation only. Reconcile the mobile and artifact
packets with P0 contracts, identify consumer interfaces, and publish an
activation plan. No P0 product code.

**Required output:** architecture delta, dependency/API list, real-device test
plan, artifact renderer threat model, and explicit statement that phone access
uses Mac-hosted residents.

## Universal team rules

- One task capsule, one bounded commit, named files only.
- One focused attempt plus at most one evidence-based repair before re-review.
- No silent shared-contract change; request a Program lease.
- No team claims integration, installed verification, or release completion.
- Reports include repository path, branch, full SHA, owned/forbidden paths,
  frozen interfaces, tests, evidence, risks, reviewer, and next safe action.
- Raw evidence is redacted, scanned, body-safe, and free of secrets.

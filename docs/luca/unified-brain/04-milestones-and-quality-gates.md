# Milestones and Quality Gates

The active implementation sequence is the V1.2 task graph in
[`TASK_GRAPH.yaml`](../v1.1-v1.3/TASK_GRAPH.yaml). The milestones below map the
long-range charter onto that graph. Do not bypass its dependency barriers.

## M0 — Repository reconciliation — Complete

**Outcome:** verified source map, local conventions, installed-app path, exact seams, and language-neutral fixtures.

**Gate:** conflicts are recorded in `RECONCILIATION.md`; work branches from
`luca/v1.1` at `34989f9`; active task IDs are namespace-qualified to avoid the
historical G2 collision.

## M1 — V1.2-A owner-source transaction

**Outcome:** frozen owner-source/import/grant/receipt contracts, deterministic
fixtures, zero-write Markdown/text preview, and atomic encrypted ingestion.

**Gate:** A201 through A205 and A212; tasks V1.2-B21 through V1.2-B23.

## M2 — V1.2-B grants and authorized recall

**Outcome:** per-resident grant, revoke, stale and reconfirm behavior plus bounded
local lexical retrieval and body-free receipts.

**Gate:** A206 through A209 and A212; tasks V1.2-B24 and V1.2-B25.

## M3 — V1.2-C Brain Setup and installed gate

**Outcome:** the narrow Brain Setup source-and-access control plane is connected
to the existing Project and resident seams and passes the installed release gate.

**Gate:** A210, A211, A401 through A405; tasks V1.2-B26 and V1.2-B27.

## Existing substrate — not a future milestone

Resident Notebook, Living Journal, read-only context packets, encrypted
namespaces, native Hermes/OpenClaw residents, and Project to Room navigation are
already shipped and remain regression dependencies for every Brain milestone.

## M4 — Real adapters and expanded Brain Setup

**Outcome:** Mnemos plus one agent/session adapter and one repository adapter work through discovery-first onboarding.

**Gate:** installed-app demo proves preview, consent, provenance, import, correction, forget, and removal.

## M5 — Code graph pilot

**Outcome:** one selected repository creates a read-only, revision-bound code graph usable as an authorized context projection.

**Gate:** graph answers trace to source locations; stale revisions are marked; source repository and external assistant config remain unmodified.

## M6 — Optional Tab Ledger and expansion

**Outcome:** Tab Ledger is an optional adapter following the same contracts, with no special-case authority.

**Gate:** a machine without Tab Ledger has an equally coherent onboarding experience.

## Cross-cutting release gates

- source provenance and deletion lineage;
- owner/resident/project/room/provider-egress authorization matrix;
- outbound payload capture for local-only and denied data;
- encrypted-at-rest proof for every claimed storage path;
- fresh-session continuity quality, correction, archive, forget, and restore;
- duplicate/failure/restart race handling;
- visual browser/installed-app inspection for onboarding and inspector surfaces;
- synthetic adversarial imports, including prompt-injection-shaped text;
- no Provider/Companion split-brain for native agent integrations.

## Evaluation fixture set

| Fixture | Proves |
|---|---|
| overlapping source exports | dedupe and source lineage |
| stale project decision | temporal state and correction |
| private resident handoff | resident isolation |
| denied local-only document | egress exclusion |
| malicious imported instruction | memory cannot become authority |
| cancel during import | deterministic rollback |
| repository changed after graph build | stale projection/rebuild behavior |
| no-brain runtime | fail-soft conversation |

## Definition of done for every milestone

1. Contract fixtures pass.
2. Focused unit/integration tests pass.
3. Negative-path and privacy tests pass.
4. The real app behavior is visually inspected when a UI exists.
5. The handoff decision log is updated only for a confirmed decision or discovered source constraint.

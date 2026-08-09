# Luca Unified Brain — Codex Handoff Packet

**Status:** reconciled long-range product charter. The active V1.2 implementation
authority remains [`docs/luca/v1.1-v1.3/`](../v1.1-v1.3/), starting from
`luca/v1.1` at `34989f9`.

**Purpose:** preserve the ambitious Unified Brain destination without replacing
Luca's already-shipped resident continuity, native-agent, Project to Room, or
encrypted storage foundations. No implementer may replace these boundaries with
a convenient generic RAG or graph-memory design.

## Read order

1. [Reconciliation with current Luca](RECONCILIATION.md)
2. [Vision and boundaries](00-vision-and-boundaries.md)
3. [Decision log](01-decision-log.md)
4. [System contracts](02-system-contracts.md)
5. [Onboarding and source adapters](03-onboarding-and-adapters.md)
6. [Milestones and quality gates](04-milestones-and-quality-gates.md)
7. [Codex kickoff brief](CODEX-KICKOFF.md)

## Delivery rule

Work one active V1.2 task at a time. The historical vendored G2 kit also uses
`B2x` identifiers for unrelated work, so evidence and commits must say
`V1.2-B21` through `V1.2-B27` rather than using an unqualified task ID.

Before touching production code, the implementing Codex session must:

1. inspect the current Luca repository, instructions, branch, installed-app path, and related contracts;
2. report any conflict between this packet and verified source reality;
3. use the frozen V1.2 interfaces and fixtures, recording any required contract
   change in the active decision ledger;
4. implement only the selected active task;
5. run its acceptance gates, including installed-app proof when UI or native behavior is involved.

## Status vocabulary

- **Settled** — user decision or established product invariant.
- **Proposed** — recommended direction; implementation requires confirmation only if a conflicting choice is material.
- **Open** — cannot be guessed by an implementer.
- **Deferred** — intentionally outside the first implementation wave.

## Anti-drift question

> Does this help a person effortlessly bring their chosen local intelligence into one governed brain, while preserving consent, provenance, private resident continuity, and fail-soft conversation?

If not, it is not part of Unified Brain.

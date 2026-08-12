# Luca model and token routing

Route by risk and ambiguity, not team prestige. Concrete model names are current
Codex examples as of 2026-08-12; the capability tier is authoritative if the
catalog changes.

## Routing tiers

| Tier | Use | Current example | Reasoning | Typical context envelope |
|---|---|---|---|---|
| R3 Authority | architecture, shared contracts, security, integration conflicts, release verdicts | `gpt-5.6-sol` | xhigh/max | 40k–100k tokens for one milestone |
| R2 Implementation | bounded Rust/TypeScript/SwiftUI work, focused diagnosis, code review | `gpt-5.6-sol` or `gpt-5.6-terra` | high/xhigh | 20k–60k per task capsule |
| R1 Mechanical | fixtures, doc normalization, static matrices, formatting, repetitive UI-state checks | `gpt-5.6-terra` | medium/high | 8k–25k per bounded job |

Use R3 for Program Lead decisions, IF-02/05/06/07/09 authority changes,
activation, conductor, NIP-17, external actions, merge conflicts, and installed
release promotion. Use R2 for implementation and independent code review. Use
R1 only when the task cannot change product authority or architecture.

## Team concurrency

Each top-level team may use one persistent lead plus up to three concurrent
bounded agents:

- one implementation lane;
- one tests/fixtures lane;
- one independent security, QA, or code-review lane.

Do not parallelize edits to shared files, app registries, contracts, migrations,
manifests, or lockfiles. Read-only audits may fan out when their outputs merge
as evidence rather than source.

## Context capsule budget

Every delegated capsule contains only:

- objective and current exact SHA;
- dependencies and frozen interfaces;
- owned/forbidden files;
- relevant contracts and tests;
- evidence target, reviewer, and repair limit.

Do not resend the full repository history or all program documents to
mechanical lanes. Team leads retain durable context and hand agents narrow
capsules. Escalate to R3 when a lane finds contradictory authority, cross-team
file ownership, data loss risk, secret exposure, migration, or release drift.

## Verification spend

During implementation, run the narrowest relevant tests and visual states.
Run full `just ci` once on the final unchanged candidate. Expensive native
installed matrices run at declared gates, not after every styling change.

## Stop rules

- One focused attempt plus one evidence-based repair per task.
- Stop and return to Program if a second repair is needed.
- Stop when a task needs an unfrozen interface, forbidden file, new migration,
  lockfile change, credential access, or broader authority.
- Never spend more context trying to prove completion when required native or
  external evidence is absent; report the exact missing proof.

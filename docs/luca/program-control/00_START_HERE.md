# Luca program control — start here

Updated: 2026-08-12

This package is the repository-native operating system for completing Luca. It
does not replace `docs/luca/program-status/`; that package remains the authority
for audited product state. Program control turns that state into owned tasks,
dependency gates, team boundaries, integration rules, and release evidence.

## Current control coordinate

- Program-control branch: `codex/program-control`
- Program-control worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/luca-agent-network-v1-program-control`
- Audited base: `f1f1eb3b135cae287c372c3210da635f324a1f81`
- Canonical integration target: `codex/conversation-communication-integration`
- Product checkpoint under the status audit: `80510dbe026039ea923bab81cde9cc65e049af4e`
- Installed-evidence commit under the status audit:
  `5cd754edf2710b22119517b68d169f3e645113b2`

The control branch may contain documentation and receipts only. Product changes
must arrive through the approved team and integration process.

## Verified coordinate drift

The audited base is valid, and the canonical integration worktree was clean at
program-control initialization. Three documented counts advanced because
`f1f1eb3` is the program-status documentation commit after `5cd754e`:

| Comparison | Status-package snapshot | Verified 2026-08-12 |
|---|---:|---:|
| Integration vs onboarding unique commits | 97 / 8 | 98 / 8 |
| Integration vs local `luca/v1.1` | 97 / 0 | 98 / 0 |
| Integration vs `origin/luca/v1.1` | 117 / 0 | 118 / 0 |

The user-opened checkout is a separate, dirty Git registry on
`agent/runtime-reliability` at `cc54ebf`; the audited commit is not present in
that registry. It was preserved untouched. The control worktree was therefore
created from the canonical integration repository, exactly as required.

## Read order

1. `docs/luca/program-status/00_START_HERE.md`
2. `PROGRAM_DASHBOARD.md`
3. `PROGRAM_GRAPH.md` and `PROGRAM_GRAPH.yaml`
4. `TEAM_CHARTERS.md` and `OWNERSHIP_MAP.md`
5. `INTERFACE_FREEZES.md`
6. `WAVE_PLAN.md`
7. `INTEGRATION_PROTOCOL.md`
8. `SECURITY_QA_TOPOLOGY.md`
9. `MODEL_ROUTING.md`
10. `TEAM_KICKOFF_PROMPTS.md`
11. `DECISION_LEDGER.md` and `RUN_LOG.md`

## Delivery-state vocabulary

Every task uses exactly one delivery state:

1. `planned` — authorized direction or queued work; no complete source slice.
2. `implemented_in_source` — source exists, but focused checks are incomplete.
3. `source_tested` — focused checks pass on an exact branch commit.
4. `integrated` — accepted into the current integration candidate.
5. `verified_in_installed_application` — observed in an installed signed app.
6. `release_complete_and_pushed` — installed proof is closed and the documented
   canonical source is published.

A supporting foundation never promotes a broader capability. For example,
secure resident send remains integrated while communication parity remains
planned.

## Approval boundary

PC-G0 was approved on 2026-08-12 with two bounded corrections: use
`luca/v1-beta` for the combined tester release and promote CTRL-001 only after
exact-commit validation. Approval authorizes creation of the five product-team
worktrees after the final control commit passes. It does not authorize opening
an integration train, merging product code, publishing a release branch, or
building a tester app.

Program Integration & Release remains the sole authority allowed to integrate,
claim installed verification, or publish release status.

## Reporting rule

Each team updates its repository-native report and attaches task receipts to
exact commits. A report must state owned and forbidden paths, frozen
interfaces, tests, risks, evidence, reviewer, and next safe action. Team chat
is never status authority.

Templates live in `team-reports/TEMPLATE.yaml` and
`task-receipts/TEMPLATE.yaml`.

## Current next action

Create the five clean team worktrees and initial reports from the final control
commit, then give Riley the complete matching prompts. No product
implementation or shared-file write is authorized.

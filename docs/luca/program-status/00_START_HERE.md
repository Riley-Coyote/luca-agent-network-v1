# Luca program status — start here

Audited: 2026-08-12

This package is the current cross-session source of truth for what Luca has,
what remains incomplete, what exists only on another branch or local checkout,
and what was deliberately deferred. It reconciles Codex task history with Git,
release verdicts, installed-application evidence, and untracked project
artifacts.

## Current coordinate

- Integrated branch: `codex/conversation-communication-integration`
- Evidence head: `5cd754edf2710b22119517b68d169f3e645113b2`
- Verified product checkpoint: `80510dbe026039ea923bab81cde9cc65e049af4e`
- Installed branch-specific application:
  `~/Applications/Luca Agent Network Dev (luca-operator-native-forge).app`
- Installed executable SHA-256:
  `ad607a83b9b567ad6b2efa1d79e6c32d42eed16991af92e3976642d987a80f78`
- Remote state: the integrated branch is local. `origin/luca/v1.1` is 117
  commits behind this evidence head.

The integrated branch is the most complete single code line today. It is not
yet a clean public beta release branch.

## Plain-language verdict

Luca already has a strong functional beta: real Hermes and OpenClaw residents,
stable identities, direct and group conversation, permissions, cancellation,
restart recovery, continuity handoffs, Notebook, scoped Brain sources,
connected repositories and coding-session sources, project-room navigation,
Luca-native Settings, stdio MCP connections, and the approved conversation
design.

The largest unfinished product work is:

1. complete agent communication parity beyond the secure send foundation;
2. reconcile and integrate the separate production onboarding branch;
3. finish the unified project creation, resident, and source flow;
4. close native Agent Forge acceptance;
5. consolidate, push, and rebuild one canonical tester application;
6. then choose among Resident Reflection, broader Brain/imports, mobile,
   artifacts/canvas, connectors, and the longer Mnemos/Polyphonic roadmap.

## Status vocabulary

| Status | Meaning |
|---|---|
| `VERIFIED_INSTALLED` | Built, integrated, and observed in a signed installed app. |
| `INTEGRATED_SOURCE` | Present on the current integrated branch, but its full product acceptance is incomplete. |
| `SOURCE_PASS` | Implemented and source-tested on a branch; native or release proof is still missing. |
| `UNMERGED` | Implemented on another branch and not reconciled into the integrated line. |
| `PROTOTYPE_ONLY` | Visual or interaction prototype only. |
| `SPEC_ONLY` | Durable plan/contracts exist; product implementation has not begun. |
| `PARTIAL` | A narrow useful subset is built; the broader promised capability is not. |
| `NOT_STARTED` | Discussed or planned, with no verified implementation. |
| `DEFERRED` | Intentionally postponed; not a current defect. |
| `HIDDEN_OR_REJECTED` | Upstream capability deliberately excluded from the Luca product unless reopened. |

## Read order

1. [`MASTER_STATUS.md`](MASTER_STATUS.md) — the complete product map.
2. [`BACKLOG.md`](BACKLOG.md) — prioritized unfinished work and completion proof.
3. [`BRANCH_AND_ARTIFACT_MAP.md`](BRANCH_AND_ARTIFACT_MAP.md) — where every
   important line of work actually lives.
4. [`SESSION_INDEX.md`](SESSION_INDEX.md) — the audited task history.
5. [`STATUS_LEDGER.yaml`](STATUS_LEDGER.yaml) — machine-readable status.
6. [`RECONCILIATION_LOG.md`](RECONCILIATION_LOG.md) — method, sources, and
   contradictions found during the audit.

## Authority rule

Use evidence in this order:

1. exact Git ancestry and current source;
2. installed-app evidence tied to an exact commit and executable hash;
3. focused source tests and release verdicts;
4. branch handoffs and run logs;
5. task conversation statements;
6. prototypes and design artifacts.

A task saying “complete” is not enough when its own acceptance file remains
unchecked or the implementation lives only on a divergent branch.

## Recommended next move

Do not start another broad feature slice yet. First create one clean release
candidate by:

1. reviewing and integrating the eight-commit onboarding branch;
2. completing the missing communication operations and native acceptance;
3. finishing the unified project/resident/source creation flow and picker
   repairs;
4. closing Agent Forge's disposable native provisioning matrix;
5. fast-forwarding a canonical release branch, pushing it, and rebuilding one
   unambiguously named tester application.

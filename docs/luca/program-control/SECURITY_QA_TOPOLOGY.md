# Luca security and QA topology

Security and QA are independent review swarms. They review implementation
owned by product teams and report to Program Integration & Release. They do not
own feature source and cannot promote release state.

## Security review lanes

| Lane | Reviews | Required for |
|---|---|---|
| Identity and custody | Stable identity, keys, signing broker, resident audience | onboarding, Forge, resident Inbox, mobile |
| Communication authority | authorship, membership, stale binding, exact turns, idempotency | every P0 communication task |
| Activation and budgets | causal depth, loop suppression, cancellation, delegation, spend | activation, multi-model, conductor |
| Data and grants | filesystem/Brain/connector scope, provenance, revoke/reconfirm, egress | projects, sources, connectors |
| Native interoperability | no-write native config/credentials/memory/workspace/schedules | Hermes/OpenClaw Forge and runtime work |
| Artifact/client isolation | opaque handles, renderer/process/network isolation, pairing/push | attachments, artifacts, mobile, voice |
| Release supply chain | exact SHA, dependencies, secrets, signing, bundle identity | every installed/release gate |

Security requires negative tests, not only happy paths. Any key/capability leak,
cross-owner access, authority inference, duplicate final, unbounded loop,
unapproved external action, or protected native mutation is a P0 stop.

## QA review lanes

| Lane | Coverage |
|---|---|
| Domain behavior | deterministic unit/integration tests and failure states |
| Browser experience | desktop and 390×844, keyboard/focus, overflow, empty/loading/error/recovery, reduced motion |
| Native desktop | clean/upgraded profile, real Tauri IPC, Hermes/OpenClaw, permission, cancel, restart, offline |
| Data durability | crash/relaunch, idempotency, duplicate suppression, stale state, rollback, backup/restore |
| Cross-surface | onboarding → home, project → room, Inbox/activity deep links, attachment/source flows |
| Packaging | clean build, signing, bundle metadata, install/launch, diagnostics/updater/rollback |
| Real device | iPhone/TestFlight only when mobile activates |

## Review topology by wave

1. **Contract review:** Security, QA, owning team, and Program review frozen
   semantics before authority-sensitive source work.
2. **Commit review:** one independent reviewer inspects the exact task diff and
   focused receipts. Security is mandatory for authority/data/runtime tasks.
3. **Integration review:** Program validates conflicts; Security/QA rerun
   seam-specific tests after each affected carriage.
4. **Candidate review:** independent Security and QA work from the same frozen
   SHA; neither relies solely on team verdicts.
5. **Installed/release review:** Program and Riley verify provenance, bundle,
   launch, and remote source identity.

## Verdicts

- **PASS:** exact commit, scope, tests, and evidence satisfy the task.
- **NEEDS_REPAIR:** bounded defect with one repair permitted.
- **FAIL:** authority violation, scope inversion, invalid evidence, or broad
  redesign; task returns to Program.
- **BLOCKED:** reserved for an external dependency or Riley decision that
  prevents meaningful progress, not ordinary incompleteness.

A reviewer records unresolved P0/P1 findings with owner and disposition. PC-G3
and later require none.

## Adversarial scenarios required across P0

- wrong owner/resident/conversation/session/epoch;
- stale message content or stale membership;
- duplicate delivery, retry after crash, and restart reconciliation;
- offline recipient and `delivered_not_activated` truth;
- causal-depth exhaustion and A→B→A loop suppression;
- permission pending during cancel/timeout/app close;
- revoked/stale/moved source and source-byte immutability;
- native provisioning partial failure and rollback;
- malicious imported text, artifact metadata, file path, and renderer content;
- dirty/stale build process, wrong bundle, wrong profile, and mismatched SHA.

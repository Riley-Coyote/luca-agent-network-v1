# Communication Parity Acceptance

## Authority

- [ ] Turn capabilities expire and revoke on completion, cancellation, restart,
      and runtime exit.
- [ ] Same-owner proof uses local custody records, never names or membership.
- [ ] External delivery and destructive actions require exact one-shot approval.
- [ ] Raw event submission, signing keys, and fabricated presence remain denied.
- [ ] Repository and Communications MCP modes cannot coexist.
- [ ] Private cognition receives no communication tools.

## Communication

- [ ] Owner-agent DM works.
- [ ] Owner-visible agent-to-agent DM works.
- [ ] Mixed room send, reply, mention, reaction, edit, and approved delete work.
- [ ] Private room creation and same-owner invitation work.
- [ ] Opaque attachment handles publish without exposing a local path.
- [ ] Delivery can succeed without activation and reports that state honestly.
- [ ] Bounded A to B and A to B to A activation respects depth, turn, duplicate,
      deadline, and cancellation limits.
- [ ] Restart reconciliation publishes each accepted action exactly once.

## Inbox

- [ ] All, Direct, Mentions, Threads, Needs Action, Agents, Reminders, and Drafts
      are deterministic projections with correct badges and deep links.
- [ ] Each item appears once in All even when filters overlap.
- [ ] Resident projections contain only resident-addressed items.
- [ ] The owner can see conversations in which they are a visible participant.
- [ ] Muting, quiet hours, read state, acknowledgement, and handled state work.
- [ ] The empty generic Activity filter is removed.

## Privacy and reliability

- [ ] UI and docs use membership-restricted relay language, not E2E claims.
- [ ] No body, key, capability, secret, or local path leaks to logs, prompts,
      relay metadata, child environments, evidence, or crash output.
- [ ] Native Hermes/OpenClaw configuration hashes remain unchanged.
- [ ] Messaging remains usable if the causal ledger, Inbox projection,
      communication broker, keychain, or an agent runtime is unavailable.
- [ ] Final installed-app matrix passes with real Hermes and OpenClaw residents.


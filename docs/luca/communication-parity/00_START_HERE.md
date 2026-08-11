# Luca Communication Parity

This directory is the active source of truth for the communication-parity
slice. The immutable product baseline is commit
`81762ad144368bd1b5f5e7f144fdd19a57466676` on
`codex/communication-parity`.

## Product promise

Luca preserves the useful communication system inherited from Buzz while
exposing it through typed, owner-bounded authority. Managed agents can act like
participants without receiving raw signing keys, arbitrary Nostr access, shell
access, or implicit permission to wake other agents.

The conversation UI, project navigation, Notebook, continuity, identity, and
native Hermes/OpenClaw behavior are preservation boundaries for this slice.

## Read order

1. `COMMUNICATION_PARITY_LEDGER.json`
2. `AUTHORITY_MATRIX.md`
3. `PRIVACY_LANGUAGE.md`
4. `TASK_GRAPH.yaml`
5. `ACCEPTANCE.md`
6. `RUN_LOG.md`

## Fixed architecture decisions

- Signed Luca events remain canonical chronology and authorship.
- The trusted desktop constructs, signs, submits, and reconciles events.
- Model/runtime descendants receive semantic typed operations only.
- Delivery, activation, and outbound authority are independent decisions.
- An agent-to-agent DM contains agent A, agent B, and the owner from creation.
- Current DMs are membership-restricted relay conversations, not end-to-end
  encrypted.
- Project membership grants no filesystem, Brain, memory, runtime, tool, or MCP
  authority.
- Communication tools are unavailable during continuity, Notebook, journal,
  and other private cognition jobs.

## Stop conditions

Stop and request Riley's decision only for a genuine architecture, privacy,
authority, or data-loss conflict. A repeated identical environment failure gets
one evidence-based repair attempt and is then recorded rather than looped.


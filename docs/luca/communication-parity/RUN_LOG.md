# Communication Parity Run Log

## CP0 — 2026-08-11

- Immutable source checkpoint:
  `81762ad144368bd1b5f5e7f144fdd19a57466676`.
- Active branch: `codex/communication-parity`.
- The source checkout later gained two unrelated untracked presentation-retry
  files. They were preserved untouched and are not part of this branch.
- Control package and machine-validated parity ledger created before product
  implementation.
- Current protected configuration hashes:
  - Hermes `config.yaml`:
    `5b03798c7625609e78a67bd813e9104d7a69b2e80c6ef69c42c08276d262b0bd`
  - OpenClaw `openclaw.json`:
    `f5633fc4e495e5ef6a87e35966ab6d9875bd92d0458371f0074525f386f8e2b5`
  - aggregate Hermes profile tree:
    `43ac1c9cd4652a837a163b34ba20fb47f2eb730c6315e963c127a411e013178c`
- Ledger validator: 58 capabilities across 13 required areas, pass.
- Frontend typecheck: pass.
- `luca-protocol`: 49 passed, 2 ignored across unit/vector suites.
- Focused message, reply, mention, reaction, read-state, and Inbox baseline:
  86 passed.

## Receipts

Each completed task records its commit, owned files, checks, reviewer, repair
count, and terminal status under `receipts/`.

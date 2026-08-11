# Secure Send Checkpoint Receipt

- Status: complete for the bounded existing-conversation send path
- Branch: `codex/communication-parity`
- Baseline: `81762ad144368bd1b5f5e7f144fdd19a57466676`
- Terminal checkpoint: `0c53239`
- Reviewer: independent exact-event/vault review plus focused automated checks
- Repair count: 1 bounded evidence-based repair

## Proven behavior

- exact-turn restricted Communications MCP capability;
- resident-signed kind-9 send to an existing owner-visible conversation;
- same-owner and relay membership enforcement;
- relay-atomic expected-membership compare-and-insert;
- encrypted exact-event vault and semantic action outbox;
- cancellation-safe pre-submission authority checks;
- byte-identical retry after ambiguous relay delivery or restart;
- recovery after a crash between vault seal and outbox preparation;
- durable retry of failed terminal vault cleanup;
- fail-soft runtime startup and complete broker teardown;
- passive owner Inbox projection without agent activation.

## Checks

- desktop communication action tests: 28 passed;
- desktop communication event-vault tests: 7 passed;
- ACP communications tests: 6 passed;
- restricted MCP tests: 9 passed;
- managed environment tests: 41 passed;
- managed runtime tests: 42 passed;
- relay expected-membership unit tests: 2 passed;
- desktop focused Clippy: passed;
- `git diff --check`: passed;
- Hermes and OpenClaw protected configuration hashes: unchanged from CP0.

## Deliberately not claimed

- complete CP2 causal activation;
- remaining communication mutations and room-management operations;
- attachment publication;
- resident-specific native Inbox;
- browser, full-repository, or installed-application gates;
- NIP-17 end-to-end encrypted DMs.

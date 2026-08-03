# Usable Build Mode

This directive supersedes milestone-grade verification until Riley explicitly
re-enables it.

## Immediate objective

Produce a locally usable Buzz-derived messaging app: open the app, enter a
conversation, exchange messages with one real resident, restart, and retain the
conversation. Build and manual usability come before exhaustive proof.

## Failure budget

- Run one focused attempt.
- Permit at most one repair only when the failure has one clear, evidenced
  cause and the repair is small.
- If the repair fails, stop. Report the failure, preserved state, and the
  simplest manual troubleshooting step. Do not begin a third attempt.
- Never turn macOS UI automation, test-harness behavior, or evidence formatting
  into an open-ended debugging loop.

## Verification level

- Use focused unit/type/build checks proportional to the changed code.
- Prefer a short manual smoke test in the real app for user-facing flows.
- Do not run G1/G2 gate reviews, full evidence regeneration, clean-room native
  matrices, recovery matrices, or `just ci` unless Riley explicitly requests
  production-grade verification again.
- A failed automated proof does not block a usable development build when the
  underlying product path can be tested manually and safely.

## Token and model routing

- Keep one integration lead. Do not launch speculative parallel lanes.
- Route deterministic edits, inventories, and focused tests to the lowest-cost
  capable model at low or medium effort.
- Use high reasoning only for architecture, security, identity authority, data
  loss risk, or integration decisions.
- Send workers compact task capsules and require compact results.

## Scope discipline

- Preserve Buzz messaging and UI foundations.
- Do not add deferred continuity sophistication while messaging usability is
  incomplete.
- Do not weaken secret handling, identity authority, or data-loss protections
  to move faster.

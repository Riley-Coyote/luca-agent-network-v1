# Polyphonic Luca operator and native Agent Forge run log

Date: 2026-08-10

## Implementation

- Restored only Luca, retaining `builtin:fizz` for migration compatibility.
- Added an owner-scoped versioned runtime target and deterministic recommendation.
- Extended strict chat proposals without exposing trusted runtime details.
- Added body-free provisioning transactions and owner-only activity listing.
- Added supported Hermes fresh/clone/validate/rollback behavior.
- Added supported OpenClaw isolated add/identity/validate/delete behavior.
- Added exact native rediscovery before resident linking and semantic-identity reconciliation after relaunch.
- Connected the same runtime selector and native review sheet to onboarding, Agents, Settings, and chat proposals.
- Added mock-bridge and Playwright acceptance for manual native creation and Luca-authored proposals.

## Focused checks

- operator-forge Rust tests: 5 passed;
- native-provisioning Rust tests: 5 passed;
- full desktop Tauri: 1,799 passed, 13 ignored; diagnostics 3 passed;
- renderer unit suite: 3,429 passed;
- focused Playwright: 4 passed;
- TypeScript, Biome, file-size, text, pubkey, production build, and diff checks: pass.

## Formal gate history

1. Product `53c3e42`: stopped at inherited desktop Rust formatting drift.
2. Product `cfa61aa`: formatting passed; stopped at one inherited strict-Clippy `bool::then` finding.
3. Product `3046784`: `just ci` passed completely with no source mutation during or after the gate.

## Native boundary

Automated tests used mocks or temporary/disposable filesystem fixtures and did not modify real Hermes/OpenClaw state. The installed signed native mutation and no-write matrix remains explicitly pending; see `ACCEPTANCE.md`.

## 2026-08-10 — Conversation reliability closure

- Froze strict managed-audience and response-surface contracts.
- Separated relay delivery recipients from the validated resident activation
  snapshot retained by each durable dispatch.
- Made causal managed finals ordinary linear turns while preserving explicit
  Buzz threads as a separate surface.
- Added process-memory-only provisional working phases and public response
  streaming with final-event replacement, cancellation, and community reset.
- Removed repeated parent quotes, synthetic linear reply summaries, persistent
  handoff banners, exact known runtime notices, and internal owner cancellation
  controls from the transcript.
- Corrected the late explicit-thread room leak before promotion.
- Exact product checkpoint: `4df383309b750311d796be9bee72f3969231e001`.
- Installed direct, group, directed, mention-subset, thread, per-resident stop,
  conversation stop, and relaunch acceptance: pass.
- Focused Playwright 4/4, renderer units 3,457, production build, protocol
  vectors, strict Clippy, and formal `just ci`: pass.
- Detailed evidence: `CONVERSATION_ACCEPTANCE.md` and
  `CONVERSATION_VERDICT.md`.

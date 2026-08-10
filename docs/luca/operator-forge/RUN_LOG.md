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

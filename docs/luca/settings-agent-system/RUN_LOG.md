# Luca Settings and Agent System Run Log

Date: 2026-08-10
Branch: `codex/settings-agent-system`
Base: `a461d8a`

## Checkpoints

| Commit | Result |
|---|---|
| `b3778c8` | Luca Settings information architecture, shared Agents workspace, Mobile, diagnostics, updates, About, fixtures, and E2E coverage |
| `87e0aa6` | Local stdio MCP registry, Keychain secret references, per-agent grants, trusted inherited bootstrap, and runtime integration |
| `db37bb3` | Final visible-product branding sweep across onboarding, runtime recovery, discovery, and legacy shared-compute surfaces |

## Frontend evidence

- Frontend unit suite: 3,423 passed.
- TypeScript typecheck: passed.
- Production frontend build: passed.
- Settings and Agent Library Playwright coverage: passed.
- Messaging, attachment, inline-reply, unread, and shell regression files: passed.
- The one pre-existing blackout-token assertion was updated to the current
  approved theme token; its focused E2E test then passed.
- Settings were visually inspected at 1440x900, 1280x800, 1024x768, and
  390x844. Desktop master-detail, compact tabs, mobile navigation, focus,
  overflow, and console state were checked.
- Post-sweep frontend unit suite: 3,423 passed.
- Post-sweep typecheck and production build: passed.

## Rust and trust-boundary evidence

- `cargo check -p buzz-agent -p buzz-acp`: passed.
- Desktop Tauri check: passed.
- MCP registry validation and redaction tests: passed.
- Real stdio MCP probe completed `initialize` and `tools/list`: passed.
- Managed MCP bootstrap validation and body-free error tests: passed.
- Managed permission independence regression: passed.
- Cancellation cleanup timeout regression: passed.
- Continuity terminal recheck after cancellation: passed.
- Messaging remains fail-soft when optional continuity or MCP state is absent,
  locked, invalid, or unavailable.
- Post-sweep desktop Tauri check and `buzz-agent`/`buzz-acp` cargo checks:
  passed.

## Visible-product branding sweep

- Built-in onboarding choices now render as Luca, Vektor, and Anima using the
  stable compatibility persona identifiers.
- Legacy shared-compute and managed-runtime errors use Luca-neutral product
  language.
- The obsolete relay-mesh harness is unavailable for new selection while saved
  legacy bindings remain readable and recoverable.
- Internal crate names, executable identifiers, protocol identifiers, storage
  keys, test fixtures, and required legal notices remain unchanged where
  renaming would break compatibility or erase attribution.
- No Buzz product branding remains on supported user-facing Settings,
  onboarding, discovery, or recovery surfaces outside third-party notices.

## Installed application

- Installed path: `~/Applications/Luca Agent Network Dev.app`
- Bundle identifier: `com.luca.agent-network.dev`
- Display name: `Luca Agent Network Dev`
- Signing identity: Developer ID Application, team `WQUY4M5HYR`
- Installed executable SHA-256:
  `593a5d8049d8e31d2134c41e544d921a5f706549441265769b3113f0b2dbc810`
- Bundle signature verification: passed.
- Exact installed executable remained running after relaunch: passed.
- Installed process ID at verification: `24589`.
- Final bundle was built from source commit `db37bb3`.

## Native configuration immutability

The audit covered 22 Hermes and OpenClaw configuration files without recording
their contents. Before and after snapshots were identical.

- Snapshot manifest SHA-256:
  `1747bf49f129b6e87ea94bd4a59cc08a1a2f8c39de678361f95443a7a83c1ffb`
- Byte-for-byte comparison: passed.

No provider credential, memory, pairing, schedule, or native runtime
configuration was copied or modified by this release.

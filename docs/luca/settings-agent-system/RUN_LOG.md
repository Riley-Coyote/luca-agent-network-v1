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
| `a457c30` | Consolidated release evidence before installed interactive MCP acceptance |

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
  `18be55fe53e4f5a242e310638e583d3a640f1dc888c714b82270dbb093471e4d`
- Bundle signature verification: passed.
- Exact installed executable remained running after relaunch: passed.
- Final bundle was rebuilt from source commit `a457c30` after another local
  build had temporarily replaced it.

## Installed interactive MCP acceptance

The final acceptance used a temporary environment-free stdio fixture in the
installed signed app. The fixture and all of its grants were removed afterward.

- Installed Settings test completed MCP `initialize` and `tools/list`: passed.
- The connection was granted to the exact default Hermes resident key: passed.
- A fresh Hermes session registered the single Luca-managed test tool: passed.
- The resident invoked that tool exactly once and returned `{"result":"ok"}`:
  passed.
- The grant was revoked and the resident was restarted into a fresh session:
  passed.
- The revoked Luca tool was absent from the new session while the resident
  remained ready: passed.
- A normal post-revocation DM returned `hermes-ordinary-ok` with zero tool
  turns: passed.
- Final local registry state contained zero test connections and zero grants.
- The managed tool crossed the trusted inherited descriptor boundary; it was
  not added to command-line arguments or native Hermes configuration.

The machine restarted unexpectedly during this acceptance pass. Docker, the
relay, and the installed app recovered without resetting product data, and the
remaining assertions were rerun from observable state rather than inferred
from the interrupted process.

The Settings runtime-health surface correctly reported Codex and Hermes ready.
OpenClaw had been observed ready before the machine restart, but its post-restart
discovery returned an unreadable agent list and was honestly shown as
unavailable; no installed OpenClaw MCP grant claim is made by this acceptance.

## Native configuration immutability

The audit covered 22 Hermes and OpenClaw configuration files without recording
their contents. Before and after snapshots were identical.

- Snapshot manifest SHA-256:
  `1747bf49f129b6e87ea94bd4a59cc08a1a2f8c39de678361f95443a7a83c1ffb`
- Byte-for-byte comparison: passed.

No provider credential, memory, pairing, schedule, or native runtime
configuration was copied or modified by this release.

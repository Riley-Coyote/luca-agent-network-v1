# Beta browser isolation candidate — September 13, 2026

Source: `d110179c6cf70b0c6e2ac599d8d78dc520aa19f8` on
`codex/beta-browser-isolation`, based on `23ccf2e7e`.

## Scope

App-managed Codex and Claude ACP sessions receive a designated
`polyphonic-browser` Playwright MCP server with `--isolated`. Discovery reuses
recognized existing default stdio Playwright configuration; it does not edit
runtime configuration, copy credentials, or use personal browser profiles.
Claude project settings take precedence over its global fallback. Disabled,
custom, extension, and remote browser launchers are not projected.

Ordinary supported sessions receive guidance to use the designated tools, or
report unavailable rather than fall back to a shared browser. This is a tool
routing policy, not a security sandbox: other runtime tools remain available.
Private continuity sessions retain their restricted configuration. Imported
native Hermes/OpenClaw runtimes are unchanged.

Browser state belongs to the live runtime session. Cookies and sign-ins do not
persist after that isolated browser closes. No live viewer or Computer drawer
is included.

## Completed checks

- Five focused Rust tests: launcher projection, unsupported/disabled settings,
  Claude project/global precedence, installed adapter names.
- Real Playwright MCP check: two independent contexts on the same local origin;
  cookie and local-storage marker from A absent in B. Closing and reopening A
  starts empty. Test clients and browser helpers exited afterward.
- Scoped Rust formatting and diff checks passed. The repository-wide native
  formatter exposed existing differences in unrelated files; those were left
  untouched.
- One integrated Dev build passed, including TypeScript and frontend build.
- Signed bundle verified with the existing Developer ID and Dev identity.
- Installed app launched and displayed existing conversation/history. Managed
  ACP processes received the isolation flag; native exclusions remained off.

## Installation

- Installed: `~/Applications/Luca Agent Network Dev.app`
- Bundle identity: `com.luca.agent-network.dev`
- Keyring: `buzz-desktop-dev.luca-v1`
- Rollback: `~/Applications/Luca Dev Rollbacks/browser-isolation-2026-09-13/Luca Agent Network Dev.app`
- Source receipt: `Contents/Resources/luca-source.json`
- Installed beta and release version unchanged.

## Remaining acceptance — not release-verified yet

The installed three-resident task is pending. App automation could read the
window and change selected rail controls, but keyboard input and animated chat
panels did not advance, including an attempt to foreground via the native
Window menu. Riley was asked to bring Dev fully into the foreground.

Resume with one bounded task in the existing Fable/Sol/Opus conversation:
each resident uses only `polyphonic-browser` on the same local fixture origin,
reports an empty prior marker and their own new marker, types into the test
field, scrolls, and closes the test browser. Confirm actual tool usage, no
cross-resident state, normal completion, and helper cleanup. Measure resource
usage during that task; startup-only samples do not establish browser-task
performance. Do not claim beta readiness before this check passes.

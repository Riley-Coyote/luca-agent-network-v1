# Beta browser isolation candidate — September 13, 2026

Installed source: `9f4e68e81` on
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

## Installed acceptance completed

The foreground input issue was cleared with Riley's help. Fable, Sol, and
Opus then ran the same bounded local-origin browser task concurrently on the
corrected candidate. All reported an empty prior marker, their own resident
marker, successful `ready` input, and a closed browser. Fable finished in 23s,
Opus in 28s, and Sol in 42s including tool discovery and review.

The first attempts exposed a concrete Codex integration issue: its installed
ACP adapter ignores `session/new.systemPrompt`, so browser routing guidance
was absent. Explicit tool-registry discovery proved the server was usable.
The final correction carries only browser routing guidance in ordinary Codex
turn prompts, including reused sessions. A focused test covers its scope;
continuity, other runtimes, and flag-off turns are excluded. The runtime helper
was rebuilt and the installed bundle re-signed; no additional full native
build was needed. Final acceptance used an ordinary browser request, without
instructing Sol how to discover tools.

Final bounded process sampling observed 24 Chrome processes at peak across
three browsers, approximately 2,656 MiB summed RSS, and a sampled peak of
126% aggregate CPU (100% is one core). Summed RSS can double-count shared
memory; this is a short local-page observation, not a heavy-site benchmark.
All new Chrome processes exited after closure. No new orphan Node/Chrome
processes remained in the final sample; Dev ACP harnesses sampled 0% CPU
when idle. The loopback fixture and process sampler were stopped.

The earlier fixture fit the agents' viewports, so scrolling produced no actual
movement. This pass verifies concurrent navigation, typing, state isolation,
and closure; it does not claim a separate scrolling/animation benchmark.

## Limits

This remains session isolation for supported default Codex/Claude Playwright
configuration, not a universal runtime browser or a security sandbox. Native
profiles and unsupported browser configurations remain untouched. Fresh
sessions require fresh website sign-in when applicable. The beta release is
still deferred; installed beta and its data were not replaced.

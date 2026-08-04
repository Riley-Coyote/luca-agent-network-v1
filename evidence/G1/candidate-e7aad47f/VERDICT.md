# G1 candidate verdict

Candidate: `e7aad47f5d0debc6681ceef55b7c74fff42b7f6c`

Verdict: **FUNCTIONALLY COMPLETE; FORMAL CLAIM AWAITS INDEPENDENT REVIEW**

The personal-agent-home contract has observed proof for onboarding, custody,
native discovery and import, idempotent identity, Hermes and OpenClaw direct
messages, a mixed-runtime room, restart continuity, cancellation, managed
permission decisions, crash recovery, exactly-once frozen-final publication,
degraded native bindings, attachment rendering, native search, unread state,
pagination, and scroll anchoring.

The remaining administrative gate is an independent review of this exact
candidate. No unresolved P0 or P1 defect was found. Historical M1 artifacts and
the older machine-validator corpus remain outside this candidate evidence set;
the operative contract is `docs/luca/G1_CHECKLIST.md`.

## Candidate lock

- Branch: `agent/runtime-reliability`
- Rust: 1.95.0
- Cargo: 1.95.0
- Node: 24.14.0
- pnpm: 11.4.0
- Hermes: 0.17.0
- OpenClaw: 2026.6.5
- Relay: local relay on port 3000, HTTP healthy
- Bundle: `com.luca.agent-network.dev`
- Installed binary SHA-256:
  `33a9ee168534b222d97da6957ca0b3bd92e268140014374d2a0529cc1d84855a`

The app was rebuilt, ad-hoc signed, installed, and relaunched from this exact
candidate. The preserved clean G1 profile reopened successfully with its prior
conversation history.

## Live runtime proof

### Native residents and messaging

- Hermes `default` retained resident fingerprint `35653885...2ec899`.
- OpenClaw `main` retained resident fingerprint `09c26e21...65201`.
- Both direct-message paths returned exactly one correctly attributed final.
- The mixed room returned one correctly attributed response from each runtime.
- Relaunch restored both resident identities and bounded signed conversation
  history without claiming native ACP transcript restoration.
- Removing the Hermes executable left the same resident visible with a useful
  degraded-state error; restoring the binding returned it to service.

### Cancellation

- A long Hermes turn was durably cancelled and the managed process restarted.
- A long OpenClaw turn was durably cancelled and the managed process restarted.
- One conversation Stop cancelled both active residents in the mixed room.
- The five-second cleanup grace and process-group replacement were observed.
- Cancelled dispatches had no later final publication.
- A prior submitted final maps to `publication_ambiguous`; focused tests verify
  that the UI contract never claims a guaranteed cancellation in that race.

### Managed permissions

- A deterministic ACP runtime exercised the production managed-permission
  channel through the installed Tauri application.
- The exact runtime-advertised allow and reject option identifiers were used.
- Cancel-while-pending, 120-second expiry, and app-close cleanup were observed.
- Stale epoch and stale request decisions fail closed.
- The live relay contained no permission request or decision payload.
- Managed model and nested tool descendants inherited neither signing
  authority nor the local permission socket.
- The separate unmanaged ACP test proves its legacy environment path remains
  unchanged.

### Recovery and exactly-once publication

- Crashing the app during generation produced an interrupted dispatch with no
  publication for the tested turn.
- A frozen final remained unpublished while the relay was unavailable, was
  reconciled after restart, and appeared exactly once.
- A second restart kept the event count at one.

### Messaging surface smoke

- Native search opened the exact frozen-final result in its conversation.
- A PNG attachment uploaded, sent, and rendered in the installed app.
- Inbox unread state and direct-message unread badges were observed.
- Scrolling away from the latest message exposed a working Jump-to-latest
  control without losing the timeline anchor.
- Forty-seven timeline unit tests passed for pagination, history prepends,
  deep-link resolution, stale-snapshot isolation, and scroll decisions.

## Verification summary

- `cargo test -p luca-protocol`: pass
- managed permission tests: 12 pass
- managed and legacy descendant isolation: 3 pass
- managed cancellation status tests: 2 pass
- managed dispatch-store tests: 19 pass
- desktop Cargo check: pass
- frontend typecheck: pass
- focused Biome checks: pass
- timeline snapshot tests: 47 pass
- production frontend build: pass
- upstream integration suite: pass
- native app build, signing verification, install, relaunch, and smoke: pass

The prior repository-wide Biome run contains pre-existing findings outside the
files changed for runtime reliability. Changed files pass focused formatting
and lint checks; the repository-wide cleanup remains normal technical debt, not
a runtime-slice regression.

## Evidence hygiene

This candidate directory is intentionally curated. It contains no private
identity material, provider secrets, permission payloads, or local machine
paths. Raw historical logs remain in the parent G1 directory for local
diagnosis and are not part of the public-safe candidate evidence set.


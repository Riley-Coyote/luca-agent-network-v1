# Polyphonic beta.12 — native session restoration

## Release state

Candidate branch: `fix/native-session-resume-beta12`, based on app commit
`84d3d7249e5ebb6229146156a78ada9fd155584e`. The public beta.11 permissions
update is included. The website checkout is a separate line and is untouched.

Automated source validation is complete. Local packaging and the owner's final
walkthrough precede any publication. No public tag, release, or update feed has
been changed by this work. Private build receipts record artifact status.

## What is implemented

The provider-owned conversation is restored through capability-negotiated
ACP resume/load with the same native session ID. The implementation keeps the
existing exact-turn tool credentials and cleanup rather than merging the
unfinished warm-session gate. A runtime that cannot restore a saved conversation
must report that limitation, not silently replace its history.

The private body-free pointer map is scoped by resident, native profile/store,
relay and conversation. Atomic writes, file locking, bounds, explicit-reset
revision checks and competing-creation rejection protect it. Mutable model,
permission and build settings do not themselves change native history identity.
The desktop-owned local relay has a stable namespace across port changes.

Historical load replay does not become a new live reply or a new permission
prompt. Restored sessions receive the current model and permission setup and
fresh exact-turn MCP credentials. Busy worker ownership stays visible so a
second worker cannot silently fork the conversation. Explicit rotation and
membership removal forget the pointer. Remembered grants remain desktop-owned:
a native allow-always grant cannot outlive the desktop's Forget action.

OpenClaw compatibility resume/idle-close preserves its native session key and
refuses malformed or busy replacements. Hermes uses load rather than its
create-on-missing resume behavior. Their deterministic coverage does not imply
live acceptance on those runtimes.

## Codex Manual limitation — deliberate fail-closed behavior

The current installed Codex ACP 1.11.0 adapter calls a workspace-write preset
`read-only`. Every native turn passes that preset's sandbox, overriding the
startup read-only configuration. The old `untrusted` approval policy is also
rejected by the installed native runtime. A successful startup or mode name
alone would therefore falsely claim restricted access.

This release does not claim Manual works on Codex. The interface disables that
choice for a Codex resident and explains why. Existing restricted selections
are preserved, but starting such a resident fails with an actionable error.
No stored setting is promoted. The owner can explicitly choose Accept edits
or Full access. Other runtimes retain their supported controls.

The attempted separate native policy relay was not applied and is not included.
This limitation must be accepted in the final walkthrough before publication.

## Native Codex evidence

An opt-in live test created a fresh disposable conversation. A random code was
available only in a local tool-read result, not the owner prompt. The agent
replied READY without the code. The test removed the original file, resumed the
same session, started and cancelled another turn, observed native Cancelled,
then stopped that process. A fresh adapter in a different project folder resumed
the same native session and recovered the code without relay replay or tools.
This passed. The earlier text-only restart test also passed.

The tests use the native user-approval preset and reject every ACP permission
request. They are not a claim of general native sandbox enforcement. The actual
Codex catalogue model used for the stronger proof was `gpt-5.6-terra`; a configured
unknown model with null catalogue description was excluded from test selection.
No user model or authentication setting was changed.

Claude subscription access is expired per the owner. All live acceptance for
this release uses Codex. Claude/Hermes/OpenClaw live compatibility is not newly
certified; deterministic tests retain their protocol coverage.

## Automated validation

- Full frontend: 4,083 tests passed, zero failures; TypeScript passed.
- Full ACP harness: 891 tests passed, zero failures; two opt-in native tests are
  excluded from the ordinary suite. The stronger Codex test was run separately.
- Agent library: 299 tests passed, including OpenClaw compatibility coverage.
- Full desktop library: 2,502 tests passed, zero failures, 18 existing opt-in or
  environment-specific tests ignored. The run used disposable app/keyring scope.
- Harness, agent and desktop strict all-target Clippy: passed, warnings denied.
- Owned-source formatting and whitespace checks: passed.

Baseline lint issues were corrected without suppressing lint checks. A boxed
SQLite connection avoids large enum payloads without changing the store API or
schema. Remaining baseline fixes are type aliases, borrow/counter simplification,
source-preserving test moves and stale fixtures. Node component tests now load
image URLs like Vite and stub browser-only Mote custom-element registration;
these tests do not validate WebGL rendering. That remains part of the walkthrough.

Dependencies were installed from the existing offline caches with frozen
lockfiles. All six packaged sidecars are rebuilt from this source, not copied
from a prior released application.

## What is not claimed

This is native conversation persistence, not a single permanently warm worker.
Existing scoped-session cleanup and Codex process replacement still occur.
Prompt-delta optimization and removal of repeated handoff/context work are not
included. History already lost before the update cannot be reconstructed by
this map. Native provider retention/compaction applies; the map is capped at
512 entries. Managed runtime transport remains Unix-only.

The final owner walkthrough must cover packaged-app conversation turns,
project change, Stop, quit/reopen, permission remembering/Forget, and visual
behavior. Review-only data/keyring/Nest isolation must never enter production
release configuration. Publishing requires a separate explicit approval after
that walkthrough.

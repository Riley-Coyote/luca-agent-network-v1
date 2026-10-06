# Companion delegation candidate handoff

Initial verification recorded 2026-10-05 UTC. Resumption authorized 2026-10-06.

Status: **Codex phased candidate ready for review, not full D0-D6 completion.**
No merge, installation, public release or updater change is authorized.

## What is implemented and proved

- New owned Codex tasks use an explicitly confirmed native working folder and
  the user's existing runtime profile, with normal approval/stop controls.
- Saved Codex CLI continuation preserves the exact native session ID and
  working folder; the production runner passed the same-ID/context proof.
- Existing Codex app chats accept exact-session queued follow-ups through the
  verified public queue. Queued input is not presented as completed work.
- Owned task results return through one private Luca synthesis and one signed
  message in the original chat. Results and receipts are persisted, bounded
  and restart-safe. Ambiguous execution is never blindly redispatched.
- The fresh native task returned an exact clean result, while away from the
  chat, in about 36.2 seconds after worker completion, on one synthesis attempt.
  The summary and raw result survived restart without duplicate publication,
  redispatch, new provider sessions or additional model turns.
- On 2026-10-06 the original Claude CLI fixture retained its native ID/folder
  and context through close/reopen, and a guarded native peer message reached
  its original live-idle controller. Native sender acknowledgement and receiver
  origin/marker are correlated; this is component proof, not product integration.

## Candidate and source

- Feature worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04`
- Feature branch: `codex/companion-delegation-2026-10-04` (checkpoint commits pushed).
- Shipped base: beta.13, `f84aaafa53386f213b832441983838b23c32c745`.
- Signed artifact source: `4c2a8448e7d1feba9212cff0e7d16e18579d652a`.
  The final handoff is a later documentation-only commit, not an artifact rebuild.
- Open app:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/debug/bundle/macos/Polyphonic Companion Delegation Candidate.app`
- Separate bundle ID: `chat.polyphonic.desktop.companion-delegation.dev`.
- Disposable state:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/companion-delegation-instance`
- Source receipt: `Contents/Resources/companion-delegation-source.json` inside
  that bundle. Six real ARM64 helpers and Developer ID deep/strict signatures
  verified; debug candidate, not notarized and not installed.

The rebuilt app last opened on the existing synthetic Luca conversation. It is
not currently running after the drive-disconnection cleanup. Its prior
task receipts and exact clean result are retained; the raw result still matches
`sha256:d9f19b6ed4ccb68f41b9fc5148d1867b2b03b7d6b3fe8a39ff70f5b81afa28d7`.
No new provider session/purpose rows were allocated on this restart, and the
installed Nest skill contains the corrected Brain-optional guidance. The old
Brain-required reply remains history, not a new response from this build. Its
test owner/profile is not Riley's live profile; no personal history was inspected
by these checks. Installed beta.13 and the shipping/design tree remain untouched.

The existing opt-in entrypoint is
`scripts/build-companion-delegation-candidate.sh`. Its exact-HEAD/clean-tree
guard deliberately will not label the older signed artifact as built from the
later docs commit. Keep the receipt intact. To build and run a newer checkpoint:

```sh
cd /Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04
. ./bin/activate-hermit
scripts/build-companion-delegation-candidate.sh stop --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
scripts/build-companion-delegation-candidate.sh build --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
scripts/build-companion-delegation-candidate.sh run --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
```

Stop only the exactly owned candidate through the same script's `stop` command
before rebuilding. Retain its disposable state. Do not use broad process kills.

## Verification and remaining gates

Latest source correction removes Brain as a prerequisite for requested native
session lookup and ordinary runtime work. Brain indexing/retrieval/retention
stays explicitly opt-in. Stock Luca instructions are safely refreshed only
when they still match the exact previous stock bytes; user edits are preserved.
Owned task permission scopes now close on Stop/terminal cleanup, late result
callbacks cannot cross tasks, and Stop failures/missed events are handled.
There are no separate design changes.

Current source checks pass: 4,106 frontend helper tests, 245 focused desktop
native tests, 15 repository MCP tests, four ACP managed-prompt tests, all three
relevant libraries' Clippy with warnings denied, scoped formatting, typecheck,
production/E2E builds, and diff checks. After native packaging, E2E assets were
regenerated again: all 46 task-card, first-conversation and activity-trace cases
pass, including all 31 task-card cases. The candidate's six real ARM64 helpers,
exact source/isolation receipt and Developer ID strict/deep signatures pass.
The native owned Codex loop was proved on previous signed source `3e2183ef4`;
this rebuild's launch/persistence inspection is not fresh provider proof of
the Brain-off lookup or cancellation paths.

Full certification remains incomplete:

- Claude quota no longer blocks the completed component checks: exact saved-ID
  context and live-idle native messaging passed. Its production continuation/
  peer transport integration, busy-tool delivery and user-facing return still
  need verification. Product gates remain; no model/provider fallback or global
  native-profile change was made.
- Externally owned Codex app progress/results, approval mediation and stopping
  are not verified public controls. Preserve the explicit native-app handoff;
  do not replace that session with CLI-owned work or claim result tracking.
- Controlled native release/candidate performance comparison and the remaining
  native interruption/approval cases are not certified by the single clean loop.
  Point samples and the receipt-cache microbenchmark are not substitutes.
- The Brain-off native-session lookup and cancellable permission paths have
  deterministic fixture coverage but not a new provider-backed native loop.
- Full CI stops on untouched beta.13 formatting. Known unchanged Sandpile
  assertions and native probe timeout failures are documented in the spec;
  scoped green checks do not mean the entire repository suite is green.
- Hard process termination and cross-toolchain pending-approval migration retain
  the explicit fail-closed limitations documented in the spec.

Current native usage: **12 disposable IDs, 31 prompt attempts**, including
automatic continuity/synthesis and peer receipt (29 completed turns, one earlier
aborted runner attempt, one historical Claude quota rejection). On 2026-10-06 Riley lifted the former
12-session/40-turn ceilings and authorized the remaining checks. Continue small
fixtures with usage tracking and at most two native workers. The explicit Claude
availability and original-session proofs succeeded, and both workers exited.
No quota retry loops, provider/model
fallback, personal-session tests, global configuration changes, merge or release.

Evidence and scope: [implementation spec](COMPANION_DELEGATION_IMPLEMENTATION_SPEC.md),
[Codex exact-session proof](COMPANION_DELEGATION_D1_CODEX_EVIDENCE.md),
[Claude gate](COMPANION_DELEGATION_D1_CLAUDE_EVIDENCE.md).

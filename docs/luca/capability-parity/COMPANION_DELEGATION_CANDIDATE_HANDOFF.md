# Companion delegation candidate handoff

Recorded 2026-10-05 UTC (October 4 evening in Riley's local time).

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

## Candidate and source

- Feature worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04`
- Feature branch: `codex/companion-delegation-2026-10-04` (checkpoint commits pushed).
- Shipped base: beta.13, `f84aaafa53386f213b832441983838b23c32c745`.
- Signed artifact source: `3e2183ef47760bdc48ca10dd97ef689e3409755d`.
  The final handoff is a later documentation-only commit, not an artifact rebuild.
- Open app:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/debug/bundle/macos/Polyphonic Companion Delegation Candidate.app`
- Separate bundle ID: `chat.polyphonic.desktop.companion-delegation.dev`.
- Disposable state:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/companion-delegation-instance`
- Source receipt: `Contents/Resources/companion-delegation-source.json` inside
  that bundle. Six real ARM64 helpers and Developer ID deep/strict signatures
  verified; debug candidate, not notarized and not installed.

The app is already open on the synthetic Luca conversation. Use Review task
result to see the exact marker. Its test owner/profile is not Riley's live data.
The installed beta.13 and the shipping/design worktree remain untouched.

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
production/E2E builds, 31 task-card Playwright cases and diff checks. The signed
artifact above is still the older checkpoint until the explicit rebuild.
The native owned Codex loop and post-publication restart passed on that older
signed source; they are not fresh provider proof of the Brain-off lookup.

Full certification remains incomplete:

- Claude same-ID continuation proof hit native account quota. This is unverified,
  not unsupported; continuation remains gated. No automatic retry, paid API,
  alternative model or native-profile change is authorized.
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

Native budget used: **11/12 disposable IDs, 23/40 prompt attempts**, including
automatic continuity/synthesis (21 completed Codex turns, one aborted runner
attempt, one Claude quota rejection). No further provider prompts are planned;
another full loop may exceed the single remaining ID. Riley's decision is
needed before expanding native proof or resuming the paused Claude gate.

Evidence and scope: [implementation spec](COMPANION_DELEGATION_IMPLEMENTATION_SPEC.md),
[Codex exact-session proof](COMPANION_DELEGATION_D1_CODEX_EVIDENCE.md),
[Claude gate](COMPANION_DELEGATION_D1_CLAUDE_EVIDENCE.md).

# Companion delegation candidate handoff

Updated 2026-10-06. **The approved phased D0-D6 implementation is delivered for Riley's review.**
This is an isolated native candidate, not a merge, installed-app replacement,
notarized release, or unrestricted external-harness control certification.

## What works

- New owned Codex/Claude Code work uses the confirmed project, existing native
  account/profile, and the existing approval/Stop controls.
- Saved native continuation preserves the selected session ID, real workspace,
  native policy and context. It does not replay a transcript or substitute a new
  session. Active/ambiguous/missing/unknown-policy targets fail closed.
- Existing Codex app chats accept exact-ID public queued follow-ups. Live idle
  or busy Claude sessions use the verified qualified native inbox route, with
  exact controller/name/folder/policy/message checks and one ephemeral courier.
  Inbox acceptance is not steering, read acknowledgement or completed work.
- Brain is optional. Requested native session metadata uses independent,
  bounded filesystem-read authority; no Brain connection/index/recall grant
  is required. No automatic whole-history ingestion was added.
- Real owned-task questions appear in Polyphonic and receive only the selected
  answer. Answers are not tool approvals. Stop removes that task's question,
  terminates only its owned worker tree and preserves the companion.
- Owned results return through one private Luca synthesis and one signed message
  in the original chat, including while that chat is off-screen. Restart retains
  the exact receipt/result/publication without redispatch or duplicate summary.
- Resident launches, model discovery and new owned work use the same discovered
  native executable. Codex no longer silently uses the adapter's older bundle.

External app-owned progress/results, questions, approvals and Stop stay in the
native app unless separately proved. Existing native permission holds are not
bypassed. Unsupported elicitation is declined, not presented as a credential form.

## Candidate and exact source

- Feature worktree:
  `/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04`
- Feature branch: `codex/companion-delegation-2026-10-04`; checkpoints pushed.
- Shipped base: beta.13, `f84aaafa53386f213b832441983838b23c32c745`.
- Signed artifact source: `81ca54bc105b777e5e685f14942841ac7ce8cc2e`.
  Later handoff/spec updates are documentation-only; the receipt is not relabelled.
- Candidate app:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/debug/bundle/macos/Polyphonic Companion Delegation Candidate.app`
- Bundle ID: `chat.polyphonic.desktop.companion-delegation.dev`.
- Disposable app/native state:
  `/Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target/companion-delegation-instance`.
- Source receipt: `Contents/Resources/companion-delegation-source.json`.
  Six real ARM64 helpers and Developer ID strict/deep signatures verified.
  Debug/app-only, not notarized, not installed.
- After the acceptance restart, exactly owned PID `82660` is running that artifact.
  The signed manifest and ownership record live in the instance's `control`
  directory. Native profiles/auth and installed beta.13 remain untouched.

The app opens on the existing synthetic test conversation, not Riley's live
profile. Earlier failed test receipts/messages are retained as history; they
do not mean the corrected task or current runtime is failing. The final raw
result is `POLYPHONIC_D6_CLAUDE_SAVED_9f31 Beta`.

The opt-in entrypoint is `scripts/build-companion-delegation-candidate.sh`.
Its build/run guard requires clean exact HEAD: it intentionally will not call
this artifact a build of a later documentation commit. Review the running
artifact without editing its receipt. To prepare a future source checkpoint:

```sh
cd /Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04
. ./bin/activate-hermit
scripts/build-companion-delegation-candidate.sh stop --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
scripts/build-companion-delegation-candidate.sh build --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
scripts/build-companion-delegation-candidate.sh run --target-dir /Volumes/LaCie/Luca-Development/build/companion-delegation-candidate-target
```

Stop addresses only the recorded exact PID/start identity. Never use broad kills,
wipe profiles, merge into the shipping/design tree or install/release without approval.

## Final native proof and checks

Fresh signed-app Claude question/Beta/result return passed. A distinct saved
Claude proof preserved native ID `beec542f-39b1-40a6-8fcd-9e7cc2eaa439`, original
folder/policy and its remembered answer. The actual new native instruction
matches exactly and does not supply Beta. Task
`c3f05c4a-2320-41ff-b2d9-dd0841bea220` succeeded; raw result SHA-256 is
`8ca9974f8347f3711e2b80ff5a20c82383f3a2ec2f7f65a558645f780bfb40de`.
One synthesis published one event in the original chat while Library was open.
Receipt/result/native-session map/purpose store survived restart byte-for-byte.
The independent native Stop fixture is stopped, with no result or summary.

Verified on this code: 4,114 frontend tests; full ACP serial and parallel each
995 passed/two explicit native-model tests ignored; 57 focused runner tests;
focused desktop/protocol/MCP checks; ACP/desktop Clippy with warnings denied;
scoped formatting; typecheck; production/native build; fresh post-packaging
65/65 UI cases with no retries, failures or skips; diff checks. Owned preview
servers are stopped. No experimental design/animation changes were integrated.

## Explicit limitations

- Global `just ci` is not green: unchanged shipped `buzz-db` formatting fails.
- Older full performance fixtures remain non-green: project navigation misses
  its budget on both revisions; the 68-reply setup is unavailable. Original
  whole-suite quiet typing showed a +28-ms difference under substantial machine
  load/memory pressure. That signal is retained, not dismissed.
- Distinct successful-empty-list quiet ABBA passed 4/4 with identical median
  pairs (32/24 ms), no repeated listing/focus/DOM churn and only a 4-ms mean p95
  difference. No sustained input-loop regression was reproduced; no speculative
  product fix was made. Host/native/browser measurements have their stated
  scope and are not optimized-release or universal latency certification.
- Earlier intermittent fake-child spawn failures remain recorded; final serial
  and parallel ACP passes do not retroactively establish their cause.
- Native external handoff/permission holds, unsupported versions, hard
  termination and changed authority retain fail-closed or unresolved receipts;
  there is no automatic resend, controller replacement or provider/model fallback.

Riley lifted the old disposable session/turn ceilings on October 6. The per-case
native IDs/markers and automatic work are retained in proof/purpose records.
This did not authorize more than two concurrent native proof workers, paid
provider changes, personal-session test targets, global configuration changes,
installation, merge or release. All test targets were identified disposable work.

Evidence: [implementation spec](COMPANION_DELEGATION_IMPLEMENTATION_SPEC.md),
[final D6 native/performance evidence](COMPANION_DELEGATION_D6_EVIDENCE.md),
[Codex controls](COMPANION_DELEGATION_D1_CODEX_EVIDENCE.md),
[Claude controls](COMPANION_DELEGATION_D1_CLAUDE_EVIDENCE.md).

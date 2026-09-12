# In-thread activity delivery — 2026-09-12

Installed source: `e6a7f512d00e2588f68e9d80b50542e3d934b6ac` on
`codex/in-thread-activity-2026-09-12`, based on the verified integrated candidate
`99e68f04a05c6b790925aafc1151234523480b9f`. No old feature branch was merged.

## Delivered

- Approved in-thread action/object line, public progress narration, visible Stop,
  and collapsed work record above the finished reply. Natural resident names,
  grouped alignment, existing Shimmer, reduced motion, hairlines, no filled cards
  or expanded elapsed-time column. Duplicate live working shelf removed.
- Native capture after authenticated presentation gates, independent of the
  mounted conversation. Exact owner, relay, resident, conversation, dispatch,
  turn and session boundaries; ordered, deduplicated entries; terminal and
  restart recovery; final-message association after successful publication.
- Atomic local history with owner-only file permissions and bounded retention.
  No thought chunks. Private detail remains restricted to verified private
  owner/resident conversations; shared rooms get generic activity text.
- Frontend receipt association survives optimistic-to-authenticated dispatch
  replacement. Conversation caches reset across account/community changes.

## Verification

Focused verification was completed; no exhaustive CI expansion was performed.

- 39 native activity/presentation/publication tests passed.
- Focused frontend activity, receipt, history, privacy and regression suites
  passed; typecheck, touched-file Biome/Rust formatting and text-size guard passed.
- 67 browser cases passed across activity, messaging, Quick Chat, polished rail,
  Canvas and session-context attachments. Activity coverage includes concurrent
  residents, Stop/Stop all, keyboard, zoom, narrow layout and reduced motion.
- One integrated native bundle build, reused internal-drive caches, signed and
  verified using the existing Dev signing identity.
- Installed-app real acceptance: Luca emitted public narration and a shell
  activity, then returned `ACTIVITY_OK — canvas, rail, quick chat`. Its collapsed
  record contained exactly one narration and one activity entry, above the reply.
- Sol emitted narration and a harmless sleep activity; visible Stop cancelled
  it. Its record retained two entries and the stopped terminal status.
- Quit and relaunched Dev: both records survived, remained in their own
  conversations and expanded correctly. Quick Chat picker/full-conversation
  navigation and disclosure keyboard interaction worked in the native app.
- No newly orphaned Node, ACP or relay processes at the lifecycle check. All
  eight Dev ACP children exited on quit. The beta binary hash was unchanged.

## Installation and rollback

- Installed: `~/Applications/Luca Agent Network Dev.app`.
- Identity: `com.luca.agent-network.dev`; existing Dev data/keyring preserved.
- Source receipt: `Contents/Resources/luca-source.json` inside the bundle.
- Rollback: `~/Applications/Luca Dev Rollbacks/20260912-135023-before-activity/Luca Agent Network Dev.app`.
- Local logs, browser captures and receipts: `/private/tmp/luca-activity-acceptance-20260912/`.
- Existing Dev Docker services were restarted to restore relay readiness.
  The installed beta and its relay were not replaced; no beta release was cut.

## Boundaries and remaining choices

- Shell wording remains undecided. Existing disclosure was retained: bounded,
  redacted command detail privately; generic activity in shared rooms.
- The runtime does not explicitly distinguish interim public text from a final
  segment. A subsequent tool step promotes buffered public text to narration;
  unconfirmed terminal text is not archived as narration. Signed final replies
  remain unchanged and may include the runtime's public preamble.
- History is local and bounded (512 traces, 256 entries per trace), not a relay
  archive or a backfill of turns before installation.
- Shared-room/concurrent-resident, failure/interruption and broad visual
  regressions were exercised in focused tests. The deliberately short native
  pass covered two real residents, completion, cancellation and app restart.
- Workspace-wide Rust formatting reports pre-existing differences outside this
  change; touched Rust files passed formatting. No unrelated cleanup was made.

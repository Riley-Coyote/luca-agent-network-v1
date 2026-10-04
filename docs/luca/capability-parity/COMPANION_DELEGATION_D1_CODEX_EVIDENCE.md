# D1 Codex control evidence

Date: 2026-10-04. Native CLI `0.160.0`; app `26.930.31730`.

## Verified native paths

All model requests below target newly created, explicitly identified disposable
sessions. Personal sessions, runtime settings, authentication, and the installed
Polyphonic app are unchanged. The existing native configuration was preserved;
unavailable configured MCP servers reported startup errors but did not prevent
the synthetic Codex turns from completing. No configuration repair was attempted.

The public CLI was `/Users/rileycoyote/.local/bin/codex`. The desktop-bundled
CLI at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`
reported the same version. Neither the existence of a session record nor an
assistant-hosted tool is treated as a production control interface for Polyphonic.

| Operation | Native evidence | Boundary |
|---|---|---|
| Send to an idle, existing app-owned chat | Public `codex queue --thread <exact UUID> --message <text>` returned an acknowledgement; the native app completed the next turn in the original chat with the exact synthetic response. | Delivery acknowledgement is not final completion. |
| Follow up while the original app chat is active | Native app reported the exact thread/turn as active before the second public CLI queue command. Both the original turn and a distinct follow-up turn subsequently completed in that same chat. | This is queued follow-up, not active-turn steering or cancellation. |
| Start a native CLI task in a specified folder | `codex exec --json --sandbox read-only --skip-git-repo-check --cd <fixture>` returned a native session ID and completed the synthetic turn. | This is CLI work; native-app visibility/ownership was not established. |
| Resume a saved CLI session with context | `codex exec ... resume <exact UUID> <prompt>` returned the original session ID and remembered the first turn's synthetic token without replaying the transcript. | Do not substitute this for messaging an already running app-owned session. |
| Observe app-owned progress/completion | Native app's host-bound `wait_threads`/`read_thread` reported correlated activity and final output. | These tools are available in the audit chat; no externally callable equivalent for Polyphonic was established. |
| Answer app-owned approvals or cancel its turn | Public protocol documents the methods, but no connection to the app-owning controller was available. | Unproved required control; no private IPC or broad process kill attempted. |

## Original app fixture

Thread: `01a1082d-50c1-7d03-a5f4-ca00e0361a78`.

Working directory:
`/Users/rileycoyote/Documents/Codex/2026-10-04/polyphonic-d1-exact-session-fixture-20261004`.

The audit chat's native `create_thread` tool created this fixture. That setup
does **not** prove Polyphonic can create a native-app task through a public CLI.

- Baseline turn `01a1082d-541f-7891-9198-4b920edef1e1`: exact result
  `POLYPHONIC_D1_CODEX_BASELINE_7d49ce`.
- Idle queue acknowledgement `01a10830-f6bb-7b00-a7e7-e16220a528c4`:
  CLI exit zero, explicitly addressed to the fixture UUID.
- Resulting native turn `01a10831-0809-77a1-adee-6363b6aa8fd7`: completed,
  exact result `POLYPHONIC_D1_CODEX_QUEUED_9e6a51`.
- Initial busy fixture turn `01a1083d-b21a-7063-a894-b380b2cd943b`:
  completed a harmless 15-second sleep and returned
  `POLYPHONIC_D1_BUSY_BASELINE_f901e4`. The active interval was missed by the
  initial observation, so this turn is not the active-follow-up proof.
- Active fixture turn `01a1083f-11aa-7cb1-81d7-32160fbfa72e`: independently
  observed `inProgress` in the original thread before follow-up enqueue.
  Completed `/bin/sleep 30` in the same fixture directory, then returned
  `POLYPHONIC_D1_ACTIVE_BASELINE_a31876` (native turn duration 37,800 ms).
- Queue acknowledgement during that active turn:
  `01a1083f-12da-7740-9c85-e2d0e3410dfa`, CLI exit zero.
- Follow-up turn `01a1083f-a568-70c0-9b07-af130bdef499`: completed after the
  original turn, exact result `POLYPHONIC_D1_ACTIVE_FOLLOWUP_a31876`
  (native turn duration 3,404 ms). It did not replace or interrupt the
  earlier turn.

The exact original thread is idle after these five turns. No terminal or worker
is left waiting on an approval or an automatic scheduled retry.

## Saved CLI fixture

Native session: `01a1083a-f0f0-76a3-b1d9-c0268a062636`, same fixture directory.

The first `--json` invocation emitted `thread.started` with that ID and final
`POLYPHONIC_D1_CLI_BASELINE_72c981`, followed by `turn.completed` and exit zero.
An exact-ID `exec resume` invocation emitted the same ID and returned the
remembered token `POLYPHONIC_D1_CONTEXT_72c981`, followed by `turn.completed`
and exit zero. Both commands preserved native model/profile configuration.
The read-only sandbox was a per-invocation narrowing for this test only.

This CLI fixture did not appear in a subsequent 50-entry native-app catalogue
snapshot. That is insufficient to conclude it can never appear; native-app
visibility and control of this newly created CLI task remain unverified.

## Controller availability and safe limits

`codex app-server daemon version`, the desktop-bundled equivalent, and explicit
`codex agents --remote unix:// --no-alt-screen` all found no public default
control socket at `~/.codex/app-server-control/app-server-control.sock`.
The public stdio proxy could not connect either. No public TCP controller
listener was observed for the running native app.

The separate native IPC socket was not connected to. No private database
contents, tokens, caller metadata, or undocumented IPC envelopes were used.
No daemon was started or restarted: a separate controller cannot be assumed to
own the already running app's sessions. A configured `codex_app` MCP entry was
disabled; its preference was not changed or treated as a granted interface.

[The public app-server protocol](https://learn.chatgpt.com/docs/app-server)
documents thread/turn reads, correlated approval requests, `turn/steer` with an
expected turn ID, and `turn/interrupt`. Those methods are not proof of a reachable
app-owning controller. The public queue command has an exact session argument
but no expected-turn, cancellation, status, or approval-response command.

## Gate outcome

Native exact-session input is proved for both saved CLI work and idle/active
app-owned work. A complete app-directed delegation loop remains gated on
public controller access for observation, correlated questions/approvals and
cancellation, plus new-task app visibility. Do not advertise those operations
or use a replacement controller/session to satisfy them.

Budget used by this Codex proof: two disposable session IDs, seven submitted
and completed model turns. Combined with Claude: three disposable session IDs,
eight prompt attempts (seven completed, one Claude quota rejection), zero
active owned test workers. The approved total limit remains 12 IDs / 40 attempts.

## D6 production-runner acceptance reservation

2026-10-04: reserve one further prompt attempt in the saved CLI fixture above,
using the freshly built production `buzz-acp runtime-task` continuation lane.
No new native session ID is authorized. The command preserves the native
profile, sends its prompt on stdin, and uses the existing exact UUID and folder.
Combined budget including this reserved attempt: **3 / 12 IDs, 9 / 40 attempts**.
The outcome will be appended before another native prompt is attempted.

Attempt 9: the production runner acknowledged the exact saved UUID, then
failed closed with `The native Codex event stream could not be verified` after
630ms. No completion or alternate session was reported. The top-level shared
Cargo helper was overwritten by Tauri's compile-only placeholder copy, so this
check used Cargo's corresponding fresh executable in `debug/deps` (same build
fingerprint, real ARM64 executable). An initial zero-helper preflight failed
before dispatch and consumed no prompt. This attempt is counted conservatively
even if the provider had not started its model turn.

Reserve attempt 10 in that same saved fixture to inspect bounded native JSONL
directly and determine the protocol mismatch. No configuration overrides or
new session are permitted. Combined budget: **3 / 12 IDs, 10 / 40 attempts**.

Attempt 10 completed in the original saved UUID and returned the synthetic
diagnostic marker. Native `0.160.0` emits a startup feature warning as
`item.completed` / `item.type=error` **before** `turn.started`, then a normal
agent result and `turn.completed` (exit zero). The runner incorrectly rejected
that pre-turn diagnostic. The fix discards only bounded, valid pre-turn error
items after exact thread acknowledgement; during-turn errors, native
`error`/`turn.failed`, missing completion, trailing events and mismatched IDs
still fail closed. Provider configuration was not changed to suppress warnings.

Reserve attempt 11 for the fixed production runner in the same saved fixture.
Combined budget: **3 / 12 IDs, 11 / 40 attempts**. No other worker is active.

Attempt 11 passed through the fixed production runner: exact original session
acknowledgement, body-free writing progress, original context token plus the
synthetic acceptance marker, `stopReason=end_turn`, exit zero after 11,691ms.
The actual runner command was `codex exec --json --cd <original folder> resume
<original UUID> -`, with no sandbox, model, profile or configuration override.
Its own stdout contained no startup warning body or native diagnostic stderr.
This verifies the production runner lane, not the full companion/UI result loop.

Reserve attempt 12 for one public queue input to the original disposable app
fixture, to fixture-check its exact acknowledgement format. The saved CLI
worker is terminal. Combined budget: **3 / 12 IDs, 12 / 40 attempts**.

Attempt 12: the CLI exited zero with the exact acknowledgement
`Queued message 01a10929-2076-7320-bd6a-0286709cc5c7 for thread 01a1082d-50c1-7d03-a5f4-ca00e0361a78.`
The live acknowledgement has a final period that the earlier parser fixture
omitted. The parser now accepts that one verified suffix (and its unsuffixed
fixture form), still rejecting other punctuation, appended text, nil message
IDs, duplicate acknowledgements and wrong targets. No second message was sent
to repair the acknowledgement. Work completion is independently checked below;
queue acceptance alone remains an externally owned, incomplete handoff.

The host-bound native app observation independently confirmed original-thread
turn `01a10929-23d8-7f12-885f-2fdb3d944f72` completed in 3,989ms with exact
`POLYPHONIC_D6_NATIVE_QUEUE_OK_88c35a`. The original app fixture is idle again.
This host-bound observation is acceptance evidence only, not a public
Polyphonic controller. No automatic queue retry, new thread or app replacement
occurred. Final native budget at this checkpoint: **3 / 12 IDs, 12 / 40 attempts**;
all owned test workers terminal (10 completed Codex turns, 1 runner attempt
aborted before verified turn completion, 1 Claude quota rejection).

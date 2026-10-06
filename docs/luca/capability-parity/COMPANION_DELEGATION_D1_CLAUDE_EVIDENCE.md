# D1 Claude Code control evidence

Initial audit: 2026-10-04. Updated: 2026-10-06.

Current status: native saved-session context retention and delivery to a live
idle interactive session are proved below. Production integration, busy-tool
delivery, arbitrary-session approvals/stopping and reconnect are not certified.
All owned fixture processes have exited.

Resumption note, 2026-10-06: Riley lifted the former native test-capacity cap and
authorized finishing the remaining proof. The historical results below remain
unchanged. Resume only the identified disposable fixture, check native account
availability once, and do not substitute a provider/model or retry a quota
failure automatically. Fresh results below supersede the historical quota block
for the successful cases only.

## Scope and safety

Read-only discovery uses supported CLI help/status plus official documentation.
Existing personal sessions are not changed, copied, interrupted, or messaged.
Private prompts and session titles are excluded from recorded discovery output.
Proof fixtures use the implementation worktree, native authentication and model,
and no installed-app replacement, global configuration change, or new provider.

## Verified discovery

- Initial native CLI: `/Users/rileycoyote/.local/bin/claude`, version `2.1.283`.
  Its already-configured native updater announced an installed update during
  fixture startup. A subsequent `claude --version` returned `2.1.289`; no
  install/update command or updater configuration change was made by this audit.
  All subsequent model proof evidence is tied to `2.1.289`.
- `claude agents --json` exposes `sessionId`, `cwd`, `kind`, `pid`, `status`, and
  `startedAt` for live interactive sessions. A pre-proof sanitized snapshot
  contained seven interactive sessions: six idle and one busy.
- `claude daemon status` reported no supervisor and zero background workers.
- `claude agents --help`, `claude attach --help`, `claude logs --help`,
  `claude stop --help`, and `claude daemon --help` have discovery/attachment/
  lifecycle controls, but expose no direct shell message command.
- `claude --help` explicitly distinguishes same-ID background resume from a
  copy made when the target is already running. A copy is not active control.
- `claude remote-control --help` describes local session access from
  claude.ai/code/mobile; it does not expose a third-party send endpoint.
- Neither `claude-agent-acp` nor `claude-code-acp` is on this shell's PATH.

Safe discovery command used:

```sh
claude agents --json | jq 'map({sessionId,cwd,kind,pid,status,startedAt})'
```

## Supported/documented versus native proof

| Operation | Supported/documented path | Native evidence here |
|---|---|---|
| Discover live native sessions | `claude agents --json` | Verified; prompts/titles excluded |
| New task and saved exact-ID resume | CLI `--session-id` / `--resume`; SDK `resume` | Original native ID/folder and context retained through exit/reopen; production continuation runner not yet integrated |
| Follow up in an original interactive session | Native `ListAgents` + `SendMessage` | Delivered into the original live idle controller, with correlated message ID, verified sender PID and remembered-marker response; busy-tool case unproved |
| Direct external interactive-session controller | No such CLI/SDK attach-by-ID endpoint found | Not established |
| Observe original interactive work | Native process/session status; optional native idle notice | Status verified; notice untested |
| Approve arbitrary interactive permissions | Peer messages are not user consent | Not established by cross-session messaging |
| Cancel arbitrary interactive turn | Peer slash commands are plain text; SDK interrupt controls its own subprocess | Not established |
| Pre-enabled channel ingress | MCP channel notifications, startup opt-in | Documented only; not an arbitrary-session retrofit |

[Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
is available from v2.1.224 on macOS. Native Claude discovers peers with
`ListAgents` and sends text with `SendMessage`. Active recipients read between
tool calls; idle recipients start a turn. Receiver policy independently accepts,
holds, or refuses delivery. A peer cannot approve pending permissions, change
configuration, or execute a slash command. `notify_when_idle` is a one-shot
idle/exit notice, not a durable completion contract.

The documented inbox socket exists, but the public page does not provide a
stable arbitrary-external-client message envelope. No private socket protocol,
caller impersonation, or messaging token is used by this proof.

[Agent SDK hosting](https://code.claude.com/docs/en/agent-sdk/hosting) describes
`query()` as spawning a CLI subprocess over stdio. Its `streamInput`,
`interrupt`, and permission callbacks apply to that owned transport, not
arbitrary interactive sessions discovered by UUID.

[SDK message origins](https://code.claude.com/docs/en/agent-sdk/typescript#peer-origin-fields)
provide peer-origin replay and a byte-exact body. `fromSession` is a navigation
hint, not verified identity; `verifiedPeerPid` identifies the kernel-verified
connector PID where available and is provenance, not an authentication token.

[Session management](https://code.claude.com/docs/en/sessions#resume-a-running-background-session)
describes automatic attachment/prompt sending to live background sessions only
from v2.1.285. That behavior could not be claimed for the initial v2.1.283 CLI;
the subsequent v2.1.289 CLI meets the documented version threshold, but this
path was not tested. Structured/piped invocations are also excluded by that
documented newer path, and it concerns background rather than arbitrary
interactive sessions.

[Channels](https://code.claude.com/docs/en/channels) require per-session startup
opt-in. [Channel events](https://code.claude.com/docs/en/channels-reference)
queue into the opted-in session; permission relay requires its separate
capability and a correlated request ID. None is enabled or installed here.

## Private local fixture tracker

Shared-budget allocation: at most two disposable native sessions and six prompt
turns. Counts below are specific to this Claude proof, not the overall queue.

| Fixture | Pre-generated native UUID | Name | Owned PID / exec session | Status |
|---|---|---|---|---|
| Interactive receiver | `f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0` | `pp-d1-f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0` | Final owned PID `21294` / exec `98836`; both exited | First prompt quota-rejected |
| Bounded sender | `f37dbb0a-677e-4d0d-8cc7-f03d2b7ff83c` | Reserved synthetic name only | Not started | Unused |

Fixture working directory:
`/Users/rileycoyote/Documents/Repositories/.codex-workspaces/polyphonic-companion-delegation-2026-10-04`.

Scratch directory `/private/tmp/polyphonic-claude-d1.ZxO96t` was created empty
and removed with `rmdir` after proof cleanup. No scratch content was deleted.

The initial launch used no permission-mode override and disabled receiver
built-in tools:

```sh
claude --session-id f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0 \
  --name pp-d1-f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0 --tools ''
```

No trust/auth acceptance was required. Initial startup displayed inherited
`bypass permissions on`; no bypass flag was supplied. Before any model turn,
the proof paused to coordinate a per-fixture narrowing to manual permissions.
No personal session or global setting was touched.

The coordinator approved that narrowing. The first fixture process (`11871`,
exec `53581`) exited via native `/exit`, and its UUID disappeared from the live
listing. Reusing the same unused UUID was successful with the documented
`--permission-mode manual` flag. The new native startup shows v2.1.289 and
`manual mode on`; `agents --json` confirms the same UUID/directory, interactive
kind, owned PID `14256`, and idle status. At that checkpoint no model prompt
had been sent.

Before the first model turn, the owned receiver was relaunched once more under
the same UUID with `--disallowedTools 'mcp__*'` (MCP tools excluded as well as
built-ins) and `--ax-screen-reader` (readable terminal evidence). The interim
owned PID `14256` exited first. Final PID `21294` was confirmed by native
session JSON; native startup still showed v2.1.289 and manual mode.

Final receiver invocation (own fixture only):

```sh
claude --session-id f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0 \
  --name pp-d1-f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0 \
  --tools '' --disallowedTools 'mcp__*' \
  --permission-mode manual --ax-screen-reader
```

The proposed sender was restricted to `ListAgents` and `SendMessage`, with a
per-invocation `PreToolUse` gate requiring the exact synthetic fixture UUID/name
and byte-exact test body. Purely synthetic gate checks passed for exact target
and body, while denying a different recipient, changed body, and multiple
recipients. This is gate logic verification, not native messaging proof.

The coordinator released the model-turn hold after its Codex proof finished.
One synthetic receiver prompt was submitted to establish remembered context:

```text
Remember the context marker PP_D1_CONTEXT_f8fc9abe for later.
Reply exactly PP_D1_READY_f8fc9abe.
```

The full synthetic prompt also prohibited tools, file/configuration changes,
and messages to other sessions. Native output rejected the prompt before any
model answer:

```text
You've hit your weekly limit · resets 6am (America/Chicago)
Usage limit reached · continuing automatically at 6am · esc to cancel
Worked for 0s
```

No sender was launched. No `ListAgents`/`SendMessage` model call was made, and no
personal or fixture peer received a message. No alternate model/provider,
paid credits, login, auth change, trust acceptance, or global setting change
was attempted.

Cleanup used only the owned receiver's native terminal controls. `Esc` returned
`Automatic continue cancelled`; `/exit` exited successfully. A final filtered
`claude agents --json` query returned `[]` for both pre-generated fixture UUIDs.
Owned fixture workers remaining: zero. Its ordinary synthetic native session
record is retained for truthful exact-ID retry, not copied or replayed elsewhere.

## Conclusion and next proof

Do not declare active Claude control unavailable solely from this quota block.
Native cross-session messaging is a documented supported candidate, but has not
passed native acceptance in this run. After the native account is available,
resume the exact synthetic fixture only under a new coordinated budget. Capture
the original receiver's output/process/session identity and receipt containing
the remembered marker; a sender's success prose alone is insufficient. Test a
busy recipient separately: this fixture was intended first to prove delivery
to a live but idle interactive controller, not interruption or active-tool
delivery. Arbitrary-session permission answering, cancellation, and durable
reconnect remain separate unsupported/unproven operations.

Consumed: one unique fixture UUID, one submitted prompt attempt, zero completed
model turns, zero sender prompts, zero peer sends. The second allocated UUID
and remaining five prompt attempts are unused; further attempts need fresh
coordination rather than automatic retry.

## Fresh native resumption and live-idle delivery — 2026-10-06

Riley authorized the needed proof capacity. No global settings, credentials,
personal sessions, installed application or provider/model fallback changed.
The existing native updater installed 2.1.291 without an update command from
this audit. Initial resumed PID 36486 still ran 2.1.289; subsequent receiver
40462 and sender 45579 ran 2.1.291. All used the existing Claude Max/default
Opus 5.5 profile, per-fixture manual mode, and an empty strict MCP configuration.

### Exact saved session and context

The exact `--resume f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0` reopened the original
fixture in the original implementation directory. Native `agents --json`
confirmed the same UUID, directory, interactive kind and owned PID 36486. One
fresh tool-free prompt returned `PP_D1_READY_f8fc9abe`. The old quota transcript
was replay, not a new quota failure or an automatically retried request.

After native `/exit`, the fixture disappeared from the live listing. A second
exact-ID resume opened PID 40462. A new request did not provide the marker; its
complete native response was:

```text
PP_D1_RESUMED PP_D1_CONTEXT_f8fc9abe
```

The native assistant event retained the original session ID and `end_turn`,
with zero tools. No fork, latest-session shortcut or alternative UUID was used.
This is CLI evidence, not production runner/UI acceptance.

### Delivery into the original live controller

Reserved sender UUID `f37dbb0a-677e-4d0d-8cc7-f03d2b7ff83c` opened PID 45579,
with only native `ListAgents`/`SendMessage` available. The original receiver
remained live and idle as PID 40462. No replacement receiver, SDK copy or
private-socket client was started.

A per-invocation PreToolUse guard fixed the sender identity, exact receiver
UUID/name, native PID/folder and one synthetic body. Twelve pure guard
assertions pass. Wrong targets/bodies/senders, conflicting recipient aliases,
unexpected tools and notification requests fail closed. Passing the guard does
not approve permissions; native policy still applies. It atomically claims at
most one send before execution, preventing blind duplicate dispatch.

Two native send calls were blocked before dispatch: their pre-hook inputs had
conflicting legacy `content` alongside canonical `message`. A truncated
unbracketed PTY paste and a model refusal to manufacture unsupported legacy
arguments also consumed turns without sending. These are not native successes.
The final attempt validated canonical `to`/`message` exactly and removed the
deprecated compatibility fields with documented hook `updatedInput`. The source
of those extra fields was not isolated to a native/customization component.
No permission decision or target/body check was bypassed.

One native `SendMessage` result then returned success and message ID
`bccce711-d447-42b4-b387-b097f3a333a7` at `2026-10-06T07:30:20.785Z`.
This was inbox acknowledgement, not recipient completion. Independently, the
original receiver's transcript recorded the original UUID/folder and:

- `origin.kind = peer`, `verifiedPeerPid = 45579`, the sender fixture name, and
  the same message ID `bccce711-d447-42b4-b387-b097f3a333a7`.
- The byte-exact synthetic body, with no files/history attached.
- An automatic tool-free receiver turn ending at `2026-10-06T07:30:23.240Z`,
  whose complete native assistant response was:

```text
PP_D1_PEER_RECEIVED PP_D1_CONTEXT_f8fc9abe
```

Only Claude used its native peer transport. The observed sender address was
not opened, inspected for secrets or impersonated. Sender prose alone was not
a receipt. This proves original-controller live-idle delivery and context,
not busy-tool interruption, arbitrary approvals/stopping, or Polyphonic return.

### Cleanup, usage and next work

Both exited through their own `/exit`; both exec sessions ended with exit zero.
A native listing returned zero owned fixtures and nine other sessions still
present. No unrelated PID was signalled or personal session modified. Synthetic
transcripts and bounded guard/audit files remain local; no personal transcript
is committed here.

Local guard: `/private/tmp/polyphonic-claude-d1-resume.fJ0Rci/peer-gate.mjs`.
SHA-256: `6df8f975fd0791677f3ecd1452de9b9cdb41384dd54ee6a2e643c3ddee8cbb89`.
Sender settings SHA-256:
`3730399d1259fb629dc1cda0331fca4a8b878370df0cc257c408cb375fed819d`.

Fresh usage: one extra UUID (the reserved sender), eight completed turns:
two receiver-owner, five sender, one automatic peer receiver. Overall queue:
**12 disposable IDs, 31 prompt attempts**, with 29 completed turns, one earlier
aborted Codex runner attempt and one historical Claude quota rejection. The old
fixed cap is lifted; usage is recorded for transparency, not a new stop limit.

Next: integrate/prove saved-session execution and the bounded peer lane through
Polyphonic's existing target, consent, receipt and return authorities. Do not
flip product operation gates solely from these CLI proofs. Busy delivery,
questions/approvals, stopping and native performance remain separate cases.
No installed replacement, merge or release.

## Production integration checkpoint — 2026-10-06

Native Claude CLI `2.1.291`, installed official ACP adapter `0.61.0`, existing
native authentication/profile; no model/provider substitution or global settings
edit. The feature worktree remains isolated from shipping/design work.

- Official `session/load` restored original fixture
  `f8fc9abe-d9b6-4e0f-8650-87e6a3b260e0`, replaying seven frames privately and
  retaining `PP_D1_CONTEXT_f8fc9abe`. The production `buzz-acp runtime-task`
  continuation path then returned `PP_D1_HOST_RESUMED PP_D1_CONTEXT_f8fc9abe`
  with the same UUID and `end_turn`, without rehydrating a Polyphonic transcript.
- Native question delivery initially failed because the SDK silently drops
  invalid `elicitation.form: true`. Corrected to the documented object marker
  `form: {}` and added an actual initialization-wire regression. Fresh fixture
  `beec542f-39b1-40a6-8fcd-9e7cc2eaa439` then issued one real AskUserQuestion
  form through the private channel, received exact `Beta`, and returned
  `PP_D1_INPUT_RECEIVED Beta`. An exact-ID restored turn received Skip and returned
  `PP_D1_INPUT_SKIPPED`. Stop during another pending native form produced failure,
  not completion. No tool permission was granted by any input answer.
- Native peer routing rejects the full session UUID and `@shortcode` alone.
  The provider-qualified `name [six-character code]`, taken from native
  ListAgents and bound to public native UUID/PID/folder metadata, is accepted.
  Qualified address proof correlated `c93d2fa0-4ca1-4d59-aaac-11a69b05373a`
  to the original receiver and its remembered-marker reply.
- The public adapter accepts invocation-local native command hooks, a
  ListAgents/SendMessage-only tool projection and `persistSession: false`.
  Native PostToolUse shapes are `{listing: text}` and structured
  `{success, message, display, msg_id}`. Only exact successful native `msg_id`,
  correlated to the one guarded tool invocation, is an inbox acknowledgement.
  Model prose is not delivery evidence.
- A deliberately mismatched sender policy produced a native held-message
  notice despite inbox acceptance. The courier now sets only its ephemeral
  sender to the selected receiver's verified policy and requires an exact
  returned config acknowledgement; it never changes the receiver or global
  settings. Unknown policy and stale/replaced/ambiguous controllers fail closed.
- The production peer runner emitted one native acknowledgement
  `044cccd0-b89c-4796-ab52-d93317c770b8`; original receiver UUID/PID `94318`
  recorded verified peer PID `22224`, identical body and
  `PP_D1_HOST_PEER_RECEIVED PP_D1_CONTEXT_f8fc9abe`. No replacement receiver or
  persistent courier history was created.
- A production dispatch started against original `beec...` controller PID
  `28366` while it was busy with a guarded harmless `/bin/sleep 45` command.
  Acknowledgement `59aa53e2-48a7-402d-94a6-7959f009f8a6` correlated to verified
  peer PID `33592`; the original receiver returned
  `PP_D1_BUSY_PEER_RECEIVED Beta`. The enqueue record was after the tool returned
  but before the original turn ended. This proves active-turn continuity,
  **not** tool-time enqueue or steering; a longer controlled tool case follows.
- The longer exact-ID case used original `beec...` controller PID `44633`,
  guarded `/bin/sleep 90` (no other command/tool), and the production courier.
  Tool call `toolu_01LQR2iiRe9hsf6fBQWtiuBH` began at `12:43:28.319Z`;
  native enqueue was `12:44:31.776Z`, **before** tool return `12:45:01.674Z`.
  Native acknowledgement was `699683c2-d0c4-4069-9b58-087606a8623e`.
  This establishes queued native delivery while the original controller's
  tool was running; it does not promise immediate steering or interrupt the tool.

These are production-runner/native component proofs, not certification of the
new signed Tauri build or every D6 case. Native acknowledgement remains inbox
acceptance, never receiver read, task completion, approval or stopping authority.
Private answers and native tool bodies are excluded from observers/logs/receipts.
Ephemeral guard metadata contains a message digest only and is removed on cleanup.

# D1 Claude Code control evidence

Date: 2026-10-04. Status: model proof blocked by native account usage limit;
no active-message success claimed. All owned fixture processes have exited.

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
| New task and saved exact-ID resume | CLI `--session-id` / `--resume`; SDK `resume` | New interactive identity verified; model/context proof quota-blocked |
| Follow up in an original interactive session | Native `ListAgents` + `SendMessage` | Disposable model proof quota-blocked before sender launch |
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

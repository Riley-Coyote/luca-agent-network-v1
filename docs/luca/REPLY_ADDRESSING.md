# Reply addressing — who a reply wakes up

**Status:** rule decided by Riley 2026-08-05. Not implemented.
**Owner:** Codex (send path + ACP interaction). Presentation is already built.

---

## The rule

> **Replying to a message addresses its author. The room still sees it, and
> stays quiet. To pull anyone else in, `@` them inside the reply.**

That is the whole rule. It keeps "reply" meaning the same thing socially and
mechanically, which is why the pattern works in every consumer messenger.

Concretely, in a room with the owner and residents Anima, Vektor and Luca:

| Action | Who is addressed | Who sees it |
|---|---|---|
| Plain message, no reply, no mentions | nobody in particular | everyone |
| Reply to Anima's message | **Anima** | everyone |
| Reply to Anima's message, `@Vektor` in the body | **Anima + Vektor** | everyone |
| `@Anima` with no reply | Anima | everyone |
| Reply to another human's message | that human (notification only) | everyone |

"Sees it" always means the full room. Scoping controls **who answers**, never
who can read — there is no private sub-channel here, and introducing one would
break the single-timeline model the UI is built on.

---

## Why this is not already true

The desktop currently sends `parentEventId` and `mentionPubkeys` as two
independent things. A reply carries a *pointer* to what it answers, but
addresses nobody.

- `desktop/src/features/channels/useChannelPaneHandlers.ts` — the send path
  takes `mentionPubkeys` straight from the composer's explicit mentions and
  `parentEventId` from the reply target. They never meet.
- `crates/buzz-acp/src/queue.rs` (`parse_thread_tags`) — already extracts BOTH
  `parent_event_id` (from the `e` tag with the `reply` marker) and
  `mentioned_pubkeys` (from `p` tags).
- `crates/buzz-acp/src/pool.rs` (`collect_prompt_pubkeys`) — builds the actor
  set from `p` tags.

So the ACP layer already receives the parent pointer. It simply does not treat
it as an address.

---

## Recommended implementation

**Do it on the desktop send path, not in Rust.**

When a message is sent with a reply target, add the target message's author
pubkey to the outgoing `p` tags (deduplicated against explicit mentions).

This is also the standard NIP-10 convention — replying p-tags the author you are
replying to — so it costs no protocol invention, and every downstream consumer
that already reads `p` tags starts behaving correctly for free. No ACP or relay
change is required for the basic rule.

Two details:

- **Dedupe.** If the user also `@`s the parent author, that must produce one
  `p` tag, not two.
- **Do not add a visible mention token.** The body text must stay exactly what
  the user typed. The quote block above the reply is already the visible signal
  of who is being addressed, and it is a better one than an `@chip` — it shows
  *which message*, not just which person.

---

## The risk that needs Codex's judgment

**Agent-to-agent reply loops.**

If a reply auto-addresses its target, and residents can reply to each other,
two residents can address each other indefinitely without a human in the loop.
This is the one way the rule can go badly wrong, and it must be settled before
shipping it.

There is already a guard in this area:
`crates/buzz-acp/src/queue.rs` (`turn_is_human_facing`) treats a turn as
human-facing when the sender is human OR a human is tagged, deliberately
excluding agent-only mentions so they "must not force flattening".

The open question is whether an auto-derived `p` tag should count as a real
address when **both** the replier and the target are agents. Options, in the
order I would consider them:

1. **Auto-address only when the sender is human.** An agent replying to another
   agent carries the parent pointer but adds no `p` tag; agents must `@` each
   other explicitly to hand off. Most conservative, preserves today's behaviour
   for agent-to-agent traffic, and the rule still reads the same to the owner.
2. Auto-address always, and rely on existing turn/budget limits to bound loops.
   Simpler rule, but it makes loop safety depend on a quota rather than on
   intent.
3. Auto-address always, with a depth cap on consecutive agent-to-agent replies.
   Correct in principle, more machinery.

**Recommendation: (1).** It gives Riley's rule exactly as stated for every
interaction he actually performs, and it does not create a new class of
autonomous chatter.

---

## Adjacent mechanism — do not duplicate it

`desktop/src/features/messages/lib/persistentAgentAudience.ts` already exists:
an audience keyed `owner:channel:thread:<rootId>`, behind the
`buzz:keep-addressed-agents-active` localStorage flag, **off by default**. It
keeps previously-addressed agents active for a thread.

It is adjacent to this rule but not the same thing — it *persists* an audience
across turns, where this rule *derives* one per message. Decide explicitly
whether they compose (a reply addresses its target AND refreshes the persistent
audience) or whether the persistent-audience flag is superseded. Do not
implement the new rule on top of it by accident.

---

## Open questions

- Replying to your **own** message: address nobody, or re-address the residents
  already in that exchange?
- Replying to a **human** in a room: notification parity suggests yes, p-tag
  them. Confirm that does not read as noisy.
- Does a reply into an exchange **refresh** the persistent audience, if that
  flag is ever turned on?

---

## What is already built (presentation only)

For context, so this is not re-litigated. All of the following is done and
verified in the desktop app:

- Replies stay in the main chronological flow carrying a quoted parent
  (`QuotedParent.tsx`), the iMessage/WhatsApp/Telegram convention.
- Quotes chain correctly on a reply-to-a-reply.
- Clicking a quote jumps to the original and flashes it
  (`lib/jumpToMessage.ts`).
- Thread roots carry a reply count; clicking it narrows the timeline to that one
  exchange (`buildFocusedThreadEntries`, `FocusedThreadBar.tsx`), Escape exits.
- Over-long replies collapse with a mask fade and a "Show more"
  (`CollapsibleMessageBody.tsx`) — the Luca-specific case, since residents
  answer at length.

None of it depends on the addressing rule; it will not need revisiting when the
rule lands.

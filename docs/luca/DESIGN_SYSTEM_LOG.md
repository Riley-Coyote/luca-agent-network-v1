# Luca design system — decisions, state, and lessons

Working log for the design track on `agent/runtime-reliability`. Companion to
[`DOT_MATRIX_DESIGN.md`](DOT_MATRIX_DESIGN.md) (the phosphor engine),
[`REPLY_ADDRESSING.md`](REPLY_ADDRESSING.md) (the unimplemented rule for who a
reply wakes up), and [`DESIGN_PUNCHLIST.md`](DESIGN_PUNCHLIST.md) (the backlog).

The commits say *what* changed. This says **why**, and what it cost to find out.

---

## How to actually see this work

```
cd desktop && VITE_PORT=5199 pnpm dev
open "http://localhost:5199/?e2e=mock"
```

`?e2e=mock` is a dev-only branch in `main.tsx` that installs the mock Tauri
bridge, seeds a community and skips onboarding — the whole UI in a plain browser,
no relay, no Postgres, no native shell. Add `&resetDevState=1` to wipe local
state.

**Port 5199 only.** Codex works in ~21 sibling worktrees under
`.codex-workspaces/`, and its preview binds **4173**. Never run
`just desktop-screenshot`, `just ci`, or anything else that binds 4173 while
Codex is live — the harness silently reuses an existing server on that port, so
you end up testing *their* build and drawing conclusions from it. This happened
once and produced a completely wrong "my change broke the pipeline" diagnosis.

### The trap that will waste your time

**The entire Luca shell only applies on the `buzz` theme.** `ThemeProvider`
sets `data-buzz-sidebar` only when `isBuzzTheme(name)`, and
`conversation-shell.css` scopes everything to `:root[data-buzz-sidebar]`. Pick
any other colourway in Appearance and every `--mn-*` variable resolves **empty**,
inline syntax-theme styles take over, and you are looking at a different app.

```js
localStorage.setItem("buzz-theme", "buzz");
localStorage.removeItem("buzz-theme-cache");
location.reload();
```

If something looks wrong in a way that makes no sense, check this first.

---

## The colour system

**Derived, not picked.** One OKLCH ramp, hue and chroma **locked** (H 265,
C 0.0045 surfaces / 0.004 ink), varying only L from a 0.168 floor. OKLCH's L is
perceptually uniform, so equal steps look equal; locking C and H makes the scale
*provably* monochromatic rather than approximately so. Stored as HSL because
that is what the codebase consumes.

The saturation column **varies per step on purpose** — constant OKLCH chroma maps
to different HSL saturation at different lightness. That variance is the
perceptual correction. Do not "tidy" it to one value.

What the previous scale got wrong, measured: hue drifted 220 → 210 between
surfaces and ink (not one grey family), luminance steps ran
`6.8 / 18.7 / 22.3 / 40.5` ×1e-4 (badly back-loaded, dark end collapsed to mush),
and `ink-faint` sat at **3.28:1** — failing WCAG AA.

**One step is deliberately uneven.** `raised` sits only 0.012 L above `surface`
where every other gap is 0.028+, because the composer must read as a distinct
object without being brighter than the card. Card→composer luminance gap is 14.7
×1e-4, down from 56.3.

**Accessibility is a constraint on the table, not a review afterthought.**
`ink-faint` is *solved* against `hover` (the lightest backdrop any ink lands on)
and **re-solved whenever the floor moves**. If you change a surface, re-run the
audit in the browser against *rendered* values, not the spec.

**Elevation is lightness, never shadow** — shadows are near-invisible on dark
surfaces. The one light effect is `--mn-lit-edge`, a 1px inset lit top edge on
raised objects. Shadow is reserved for things that genuinely float: popovers,
dialogs, the hover-peeked rail.

---

## The conversation model

**Quote-reply, not threads.** Replies stay in one chronological flow carrying a
quoted parent — the iMessage/WhatsApp/Telegram/Signal convention. Riley chose
this over a bespoke "docked active thread" I had built and prototyped.

He was right and the reasoning generalises: **quote-reply means nothing needs
protecting from group traffic, because a reply is self-contained.** I had
invented a solution to a problem the standard pattern does not have. When an
interaction problem feels like it needs a novel mechanism, check first whether
the mainstream pattern simply does not have the problem.

Shipped: `QuotedParent` (leading bar, not a box; clamped to two lines),
`jumpToMessage` (scroll + flash — a quote that cannot reach its source is a dead
end), reply counts opening a **focused view** that narrows the same timeline,
and `CollapsibleMessageBody` for long replies.

**`CollapsibleMessageBody` is the Luca-specific piece.** Measured on *rendered
height*, not character count — a 400-word answer and a 40-line code block are the
same problem and only one is long by characters. Re-measures via `ResizeObserver`
because bodies grow after mount. The fade is a **CSS mask, not a gradient
overlay**, because the row background changes on hover/focus/unread.

---

## The chat-app restructure (in progress, behind flags)

Diagnosis: most of what read as Slack was **structure, not words**. The model is
`ChannelType = "stream" | "forum" | "dm"` plus `visibility` and `role` — a
multi-tenant organisation model — and `dm` is branched on in **43 places**.

The model stays. Buzz's transport stays. Only the *surface* collapses to what one
owner experiences, which keeps the community-capable path open.

| flag | file | what it swaps |
|---|---|---|
| `USE_CHAT_LIST` | `AppSidebar.tsx` | one recency-sorted list ← `CHANNELS` / `DIRECT MESSAGES` |
| `USE_CONVERSATION_INTRO` | `ChannelIntroBlock.tsx` | marks + name ← `#` glyph, "beginning of the channel", admin tiles |
| `CONVERSATION_HEADER` | `ChannelScreenHeader.tsx` | mark stack + live subtitle ← channel icon, fingerprint, member count |

Naming settled: **Rooms** (not Threads — "thread" already means a reply
sub-conversation in both the UI and the code). **Groups** for multi-resident.

### Refinements that carry the "feels expensive" weight

- **Chrome that earns its place.** The rail's divider does not exist at rest; a
  hairline fades in only once rooms scroll under the pinned nav, and fades out at
  the top. Permanent chrome announces itself; earned chrome does not.
- **Search and nav are chrome, rooms are content.** They used to scroll away
  together, which is why the rail had no stable division.
- **Ring the avatar stack** in the surface colour so overlapping marks read as
  layered objects rather than one smudge. Without the ring a stack is a blur.
- **One trailing slot, never two.** Live state displaces the timestamp; unread
  displaces both. Tabular figures so the column does not jitter.
- **Timing matches the gesture.** Hover 100ms; active `duration-0`, because a
  press that animates feels laggy no matter how brief.
- **One signal at three scales** — rail row, header subtitle, pending row above
  the composer all read from the same source.

---

## Lessons

Ordered by how much they cost.

**1. Verifying one axis and calling it done.** I fixed the window controls'
*vertical* alignment, measured `misalignment: 0`, and shipped — while they sat
stranded 80px right of everything else in the same screenshot I took. A
measurement that passes is not the same as the thing being right. When something
is visibly wrong after a "verified" fix, assume the check was too narrow.

**2. Platform checks are not capability checks.** That stranded gap was
`isMacPlatform()` reserving room for traffic lights — it asks *what OS is this*,
not *is there a native window*, so a browser on a Mac reserved space for lights
that are never drawn. `isTauri()` was the real question, already used correctly
elsewhere in the codebase.

**3. Data can land correctly and never reach the UI.** The agent activity phase
was written to the store perfectly, and every label still said "working", because
the `acp_read` branch only called `notifyListeners()` when the *clock offset*
changed. Reading the code would not have caught it — only driving real frames did.

**4. Fixed-width columns eat names. Twice.** A hex fingerprint keyed off the
*window* width clipped resident names inside a 220px rail; later I added a 40px
trailing column and clipped them again. Content that identifies a thing beats
metadata about it, every time.

**5. Do not reinvent states the design system owns.** I hand-rolled active/hover
colours for the chat rows and produced a 10%-opacity pill with dark text on it.
`conversation-shell.css` already owned those states; wearing the app's own
`data-sidebar="menu-button"` identity fixed it and gave hover for free.

**6. Coupled values must be written down together — this bit three times.**
Top-chrome height ↔ `trafficLightPosition.y`; card lip ↔ header height ↔ lights;
header *title row* ↔ lights again when the header became two lines. They now
derive from `--mn-card-lip`, `--mn-header-height` and `--mn-header-title-row`
with the pairing documented in the CSS next to the values.

**7. A hardcoded colour is a time bomb.** `engine.ts` filled every mark's canvas
with `#0a0b0a` "so a mark reads the same everywhere" — true only while every
surface was near-black. On charcoal it would have punched a dark disc into every
avatar. Transparent backing now; the chip's CSS owns it.

**8. Semantics beat magnitude.** Colour-by-magnitude painted idle marks as solid
grey blocks because magnitude `0` sampled the cold end of the ramp. `0` means
*no event here*, not *a tiny event*. An epsilon fixed it. Structure stays ink;
only events take the ramp.

**9. New module-level caches must join the community reset.** `cachedChannelActivity`
would have leaked one community's working residents into the next.
`resetActiveAgentTurnsStore()` — see also the list in the root `CLAUDE.md`.

**10. Read every field that carries the data.** DMs use `participantPubkeys`,
rooms use `memberPubkeys`. Reading one made every room show a generic mark
instead of its members. The rule now lives once, in `conversationMarkSeeds`,
shared by rail + header + opener — because if those three disagree, the same room
wears different faces in different places.

**11. Test infrastructure is worth extending.** The observer→turn bridge only
syncs *registered* agents, so there was no way to test the live indicator at all
until `__BUZZ_E2E_SEED_ACTIVE_TURNS__` took a `payload`.

---

## Open

- **Reply addressing** — decided, unimplemented, Codex's side. See
  [`REPLY_ADDRESSING.md`](REPLY_ADDRESSING.md); carries an agent-to-agent loop
  risk that must be settled before it ships.
- **Are Groups permanent or disposable?** Unsettled, and it decides whether the
  room list behaves like a chat app or drifts back to channels.
- **New chat flow** — `✎` → pick residents → one is a chat, two+ is a Group.
- **DM intro path** still bypasses `ConversationIntro` (one of the 43 `dm`
  branches).
- **Typography** — Inter Tight / JetBrains Mono / Doto are all *specified and
  never loaded*.
- **Light mode** — its own pass; `:root[data-buzz-sidebar]` is dark-only today.
- **Traffic lights are unverifiable in a browser.** Every `trafficLightPosition`
  value here is reasoned from the CSS geometry, never seen. Confirm in the Tauri
  window before trusting it.

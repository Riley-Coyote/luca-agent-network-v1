# Polyphonic — Definitive 1:1 Human↔Agent Chat Audit Checklist

**Legend:** `[TABLE-STAKES]` = every shipped chat app has it; a miss is a defect. `[FRONTIER]` = the best-in-class touch that separates a premium app from a competent one.
**Audit method:** each line is pass/fail against the running build. Where a number appears, it is the threshold. Item IDs (`S1.4`) are stable for filing.

---

## 1. SEND — composer → timeline

**Keying & intent**
- S1.1 `Enter` sends; `Shift+Enter` inserts a newline. `[TABLE-STAKES]`
- S1.2 `Cmd+Enter` also sends, always, regardless of the Enter-key preference. `[TABLE-STAKES]`
- S1.3 A persisted preference exists for "Enter sends" vs "Enter newlines / Cmd+Enter sends." `[FRONTIER]`
- S1.4 Send button is disabled (not just inert) when the composer is empty or whitespace-only. `[TABLE-STAKES]`
- S1.5 Sending trims trailing whitespace/newlines but preserves internal blank lines and leading code indentation. `[TABLE-STAKES]`
- S1.6 IME composition (Japanese/Chinese/Korean) — `Enter` during composition commits the candidate, does not send. `[TABLE-STAKES]`
- S1.7 Auto-repeat: holding `Enter` sends exactly once, not N times. `[TABLE-STAKES]`

**Optimistic render**
- S1.8 The user message appears in the timeline within 100ms of the send gesture, before any network round-trip. `[TABLE-STAKES]`
- S1.9 The composer clears in the same frame the optimistic message is inserted — never gated on server ack. `[TABLE-STAKES]`
- S1.10 Composer height collapses back to single-line on clear; no residual height, scroll offset, or placeholder ghost. `[TABLE-STAKES]`
- S1.11 Caret/focus remains in the composer after send — the next keystroke types without a click. `[TABLE-STAKES]`
- S1.12 The optimistic message carries a distinguishable pending state (opacity step or a small mark), resolving on ack with zero layout shift. `[FRONTIER]`
- S1.13 The optimistic message is not duplicated or reordered when the authoritative server echo arrives (client-generated stable id). `[TABLE-STAKES]`
- S1.14 The optimistic message's rendered content is byte-identical to the confirmed version — no re-wrap, no markdown difference, no timestamp jump. `[FRONTIER]`

**Scroll on send**
- S1.15 Sending scrolls the timeline so the full sent message and the incoming response region are visible. `[TABLE-STAKES]`
- S1.16 Sending while scrolled far up returns to live — send is an explicit intent to rejoin the bottom. `[TABLE-STAKES]`
- S1.17 On send, the user's message settles near the top of the viewport (not glued to the bottom) so the reply has room to stream into view without chasing. `[FRONTIER]`

**Failure, retry, offline**
- S1.18 A failed send renders in place with an explicit failure affordance (icon + "Failed to send"), never silently vanishes. `[TABLE-STAKES]`
- S1.19 A one-click Retry on the failed message re-sends the exact original text. `[TABLE-STAKES]`
- S1.20 Failed-message text is recoverable to the composer (Copy, or "Edit and retry"). `[TABLE-STAKES]`
- S1.21 Offline sends queue and flush automatically on reconnect, in original order. `[FRONTIER]`
- S1.22 A queued/offline message is visually distinct from a failed one — "waiting for connection" ≠ "rejected." `[FRONTIER]`
- S1.23 Retry is idempotent: a double-tap on Retry does not produce two messages. `[TABLE-STAKES]`
- S1.24 A send that fails after the agent already began generating does not orphan a headless response. `[FRONTIER]`

**Drafts**
- S1.25 Draft text survives switching to another conversation and back, verbatim, including selection-independent caret position. `[TABLE-STAKES]`
- S1.26 Draft survives app quit and relaunch. `[FRONTIER]`
- S1.27 Drafts are per-conversation, not global — switching conversations never leaks text between them. `[TABLE-STAKES]`
- S1.28 A conversation with a draft is marked in the conversation list (pencil glyph or draft preview). `[FRONTIER]`
- S1.29 Pending attachments are part of the draft and survive the same switches. `[FRONTIER]`

**Composer body**
- S1.30 Composer grows with content up to a max height (~40% of window), then scrolls internally. `[TABLE-STAKES]`
- S1.31 Growth is smooth, does not overlap the last message, and pushes the timeline instead of covering it. `[TABLE-STAKES]`
- S1.32 Standard macOS text editing works: `Opt+←/→` word jump, `Cmd+←/→` line, `Cmd+A`, `Cmd+Z`/`Cmd+Shift+Z` undo/redo inside the field. `[TABLE-STAKES]`
- S1.33 `↑` on an empty composer recalls the previous user message for editing. `[FRONTIER]`
- S1.34 Character/token pressure is disclosed only near a real limit, never as an always-on counter. `[FRONTIER]`

**Paste & drop**
- S1.35 Paste of plain text inserts at caret without reformatting or smart-quote mangling. `[TABLE-STAKES]`
- S1.36 Paste of rich text (from a browser/Notes) is converted to a sane markdown or plain-text equivalent, not raw HTML. `[TABLE-STAKES]`
- S1.37 Paste of an image from the clipboard creates an inline attachment chip with a thumbnail. `[TABLE-STAKES]`
- S1.38 Paste of a file from Finder (`Cmd+C` on a file) attaches the file, not its path string. `[FRONTIER]`
- S1.39 Paste of a very large text blob (>N KB) offers to attach as a file instead of inlining. `[FRONTIER]`
- S1.40 Drag-and-drop of files onto the window shows a full-window drop target with a clear "drop to attach" state. `[TABLE-STAKES]`
- S1.41 Drop target appears only for droppable types and rejects unsupported types with a reason, not silence. `[FRONTIER]`
- S1.42 Multi-file drop attaches all files; each has an individual remove control. `[TABLE-STAKES]`
- S1.43 Attachment chips show name, type glyph, size, and upload progress; failure is per-file and retryable. `[TABLE-STAKES]`
- S1.44 Removing an attachment mid-upload cancels the upload. `[FRONTIER]`

**Send while streaming**
- S1.45 The composer remains focusable and typeable while a response is streaming. `[TABLE-STAKES]`
- S1.46 Sending while streaming has a defined, visible policy — either queue (with a visible queued chip) or interrupt-then-send — and never silently drops the message. `[TABLE-STAKES]`
- S1.47 If queued, the queued message is cancellable before it fires. `[FRONTIER]`
- S1.48 If interrupt-then-send, the truncated response is preserved in the timeline with a "stopped" marker before the new user turn. `[FRONTIER]`

---

## 2. AWAITING — send → first token

- S2.1 A thinking/working indicator appears within 300ms of send — the gap is never blank. `[TABLE-STAKES]`
- S2.2 The indicator occupies the position the response will occupy, so first-token arrival causes no jump. `[FRONTIER]`
- S2.3 The indicator is attached to the agent's identity (its mark/avatar row), not floating anonymously. `[FRONTIER]`
- S2.4 The indicator animates continuously (breathing/pulse), proving liveness — a static "…" fails. `[TABLE-STAKES]`
- S2.5 Under `prefers-reduced-motion`, the indicator changes to a non-animated or opacity-only form and still reads as active. `[TABLE-STAKES]`
- S2.6 A cancel/stop affordance is available during the wait, not only after the first token. `[TABLE-STAKES]`
- S2.7 Tier 1 (0–3s): bare indicator, no text — the app does not narrate normal latency. `[FRONTIER]`
- S2.8 Tier 2 (~3–10s): the indicator gains a specific one-liner ("Thinking", "Reading 3 files", "Searching the web"). `[FRONTIER]`
- S2.9 Tier 3 (~10–30s): an elapsed timer or step counter appears, so the user can tell "slow" from "stuck." `[FRONTIER]`
- S2.10 Tier 4 (>30s): an explicit reassurance + the option to stop, and long-running work is annotated ("still working — 1m 12s"). `[FRONTIER]`
- S2.11 A hard timeout exists (defined and documented) that converts the wait into a visible error rather than an infinite spinner. `[TABLE-STAKES]`
- S2.12 If the agent process/runtime is unreachable, the wait resolves into a specific diagnosis ("Sol's runtime isn't running"), not a generic failure. `[FRONTIER]`
- S2.13 Cancelling during the wait removes the indicator immediately and leaves the user's message intact and re-sendable. `[TABLE-STAKES]`
- S2.14 Time-to-first-token is measured and under 2s p50 for a warm local runtime; the number is a tracked metric, not a vibe. `[FRONTIER]`

---

## 3. STREAMING — token flow

**Render correctness**
- S3.1 Text appears progressively as tokens arrive; the response is never withheld until complete. `[TABLE-STAKES]`
- S3.2 Markdown renders progressively — headings, bold, italics, links, and lists format as they complete. `[TABLE-STAKES]`
- S3.3 Incomplete inline markers (`**wor`) do not flash raw asterisks; unmatched markers are held until their partner arrives. `[FRONTIER]`
- S3.4 An unclosed code fence renders as a code block immediately (monospace, correct background) rather than as prose that snaps into a block at close. `[FRONTIER]`
- S3.5 Syntax highlighting applies to the partial code block and does not re-tokenize the whole block on every chunk. `[FRONTIER]`
- S3.6 A streaming table does not render as broken pipe-characters; it renders as a table skeleton or is held until row-complete. `[FRONTIER]`
- S3.7 Ordered/unordered list items do not renumber or re-indent as later items arrive. `[TABLE-STAKES]`
- S3.8 Streamed LaTeX/math does not flash raw delimiters. `[FRONTIER]`
- S3.9 Parse/render is debounced to ~50–100ms (or rAF-batched), not per-token — verify with a CPU profile during a long response. `[FRONTIER]`
- S3.10 Only the streaming message re-renders; prior messages do not re-mount (verify via React DevTools highlight or a render counter). `[FRONTIER]`
- S3.11 CPU stays under a defined ceiling during a long stream (spot-check: no sustained 100% core, no fan spin on a 2,000-word response). `[FRONTIER]`
- S3.12 A caret/cursor glyph or equivalent marks the live write position and disappears on completion. `[FRONTIER]`

**Scroll behavior**
- S3.13 The viewport stays pinned to the bottom while streaming as long as the user is at the bottom. `[TABLE-STAKES]`
- S3.14 A single user scroll upward breaks the pin immediately and permanently for that response. `[TABLE-STAKES]`
- S3.15 Pin-break is triggered by wheel, trackpad, keyboard (`↑`, `PageUp`), and scrollbar drag alike. `[TABLE-STAKES]`
- S3.16 Scrolling back to the bottom (within a ~40px threshold) silently re-engages the pin. `[TABLE-STAKES]`
- S3.17 A "Jump to latest" control appears when the pin is broken during an active stream, and disappears at the bottom. `[TABLE-STAKES]`
- S3.18 The jump control indicates new content arrived (dot/count), not just scroll position. `[FRONTIER]`
- S3.19 Pinning does not fight the user: no snap-back, no scroll jitter, no "wrestling" on trackpad momentum. `[TABLE-STAKES]`
- S3.20 Text selected during streaming survives subsequent chunks — selection is not destroyed by re-render. `[FRONTIER]`
- S3.21 Content growth above the viewport (e.g. late-loading images) does not shift the reading position. `[FRONTIER]`

**Interruption & failure**
- S3.22 A Stop control is visible for the entire duration of streaming, in a fixed, predictable location. `[TABLE-STAKES]`
- S3.23 `Esc` stops generation when the timeline or composer has focus. `[TABLE-STAKES]`
- S3.24 Stop halts within 200ms visually and actually cancels the backend turn (verify the runtime stops billing/working, not just the UI). `[TABLE-STAKES]`
- S3.25 A stopped response is retained in the timeline, marked as stopped, and remains copyable. `[TABLE-STAKES]`
- S3.26 A stopped response can be continued ("Continue") or regenerated. `[FRONTIER]`
- S3.27 A stream that dies from a network/transport error retains the partial text and shows an inline error with Retry — it does not blank the message. `[TABLE-STAKES]`
- S3.28 Retry after a mid-stream failure either resumes or cleanly regenerates; it never appends a second partial to the first. `[TABLE-STAKES]`
- S3.29 A dropped connection reconnects automatically and reconciles the message state (completed responses that finished server-side appear in full). `[FRONTIER]`
- S3.30 Closing and reopening the conversation mid-stream shows the stream still in progress, not a frozen partial. `[FRONTIER]`
- S3.31 Quitting the app mid-stream and relaunching shows the final persisted message (or an explicit "interrupted"), never a permanently half-written one. `[FRONTIER]`

---

## 4. AGENT ACTIVITY — multi-step work display

**The activity line**
- S4.1 Each tool/step renders as a single human-readable line in present or past tense ("Searching the web", "Read `useComposer.ts`"), not a raw function name or JSON. `[TABLE-STAKES]`
- S4.2 The active line is visually distinct from completed lines (live glyph vs settled check/dash). `[TABLE-STAKES]`
- S4.3 Lines appear in chronological order and never reorder retroactively. `[TABLE-STAKES]`
- S4.4 The line updates to its completed form with the actual result count ("Searched the web — 8 results", "Read 3 files"). `[FRONTIER]`
- S4.5 Long-running steps show elapsed time after a threshold (~5s). `[FRONTIER]`
- S4.6 Parallel steps are shown as concurrently active, not serialized into a false sequence. `[FRONTIER]`
- S4.7 A failed step is marked failed inline with a reason, and does not silently disappear. `[TABLE-STAKES]`

**Disclosure**
- S4.8 Every activity line is expandable to its detail (query, arguments, output/diff). `[TABLE-STAKES]`
- S4.9 Detail is collapsed by default; the timeline stays readable at a glance. `[TABLE-STAKES]`
- S4.10 Expansion state is per-item and remembered for the session; it does not reset on re-render or scroll. `[FRONTIER]`
- S4.11 Expanded output is scroll-capped with its own internal scroll, so one large tool result cannot own the whole timeline. `[TABLE-STAKES]`
- S4.12 Expanding an item during streaming does not break scroll pinning in a surprising way. `[FRONTIER]`
- S4.13 A completed multi-step run collapses into a single summary row ("Worked for 47s · 6 steps") that re-expands on click. `[FRONTIER]`
- S4.14 The summary row persists after the response — the work history is not discarded on completion. `[FRONTIER]`
- S4.15 Thinking/reasoning is rendered distinctly from tool activity and from the answer (dimmer, italic, or a labelled block). `[TABLE-STAKES]`
- S4.16 Thinking collapses on completion but remains retrievable, and survives closing/reopening the conversation. `[FRONTIER]`
- S4.17 Thinking blocks render identically on a rebuilt transcript after app relaunch as they did live (this is a documented, real-world regression in shipped apps). `[FRONTIER]`

**Web activity identity**
- S4.18 Web steps show the site's favicon next to the domain. `[FRONTIER]`
- S4.19 Favicon load failure degrades to a neutral placeholder glyph — never a broken-image icon or a layout shift. `[TABLE-STAKES]`
- S4.20 Favicons are fetched without leaking the conversation to a third-party favicon service, or that trade-off is a documented setting. `[FRONTIER]`
- S4.21 Sources are surfaced as a compact set (stacked favicons / "12 sources") that expands to a list of title + domain. `[FRONTIER]`
- S4.22 Inline citations in the answer are clickable, show the destination on hover, and map to the sources list. `[FRONTIER]`
- S4.23 Search queries the agent actually ran are visible on expansion. `[FRONTIER]`

**File / code activity**
- S4.24 File operations name the file with a path that is truncated at the front (`…/features/chat/Composer.tsx`), keeping the filename visible. `[TABLE-STAKES]`
- S4.25 Edits show a diff (added/removed line counts at minimum) rather than only "Edited file." `[FRONTIER]`
- S4.26 Shell/command steps show the command and its exit status. `[FRONTIER]`
- S4.27 File paths and code identifiers render in mono; prose does not. `[TABLE-STAKES]`
- S4.28 Sensitive values in tool arguments/output are redacted in the UI, not just in logs. `[FRONTIER]`

**Long tasks**
- S4.29 A task exceeding ~60s shows aggregate progress (step N, elapsed) without requiring expansion. `[FRONTIER]`
- S4.30 The user can leave the conversation and return to find the work still running with correct state. `[FRONTIER]`
- S4.31 Background completion notifies (dock badge / notification) when the window is not focused. `[FRONTIER]`
- S4.32 An approval-required step blocks visibly with an explicit Allow/Deny, and the wait state is unambiguous. `[FRONTIER]`

---

## 5. MESSAGE ANATOMY

**The anchoring schools** — three live conventions, and who ships which:
- **Right-anchored bubbles both sides** (iMessage, Telegram, WhatsApp): identity via side + fill. Optimized for short conversational turns; poor for long-form, code, and tables because the bubble's max-width fights the content.
- **Right-anchored user bubble + left/full-width agent surface** (ChatGPT, most modern AI chat): the user's turn is a compact bubble; the agent's turn is unframed document-width text. This is the dominant AI convention — the user's messages are short and benefit from bubble compactness; the agent's are documents and need width.
- **Left-aligned, surface-differentiated, no bubbles** (Claude web/desktop, Claude Code, Linear, Slack): both turns are full-width rows differentiated by background tint, rail, mark, and typographic weight. Reads as a tool/document rather than a messenger; strongest for code, tables, and long output; requires more work to keep authorship instantly scannable.
- Audit rule: **pick one school and apply it without exception.** Mixed schools (a bubbled user message next to a rail-differentiated agent message with a second, different treatment for system rows) is the single most common tell of a rebuilt chat app.

- S5.1 User and agent turns are distinguishable at a 3-second glance from 2 feet away, without reading the text. `[TABLE-STAKES]`
- S5.2 Differentiation survives a screenshot with no color (works in greyscale). `[FRONTIER]`
- S5.3 The chosen school is applied consistently to every message type, including errors, system notices, and attachments. `[TABLE-STAKES]`
- S5.4 The agent's content column has a comfortable measure (~60–75ch) and does not stretch to full window width at 1600px+. `[FRONTIER]`
- S5.5 Code blocks, tables, and images may break the measure and use the wider container. `[FRONTIER]`
- S5.6 The agent has a persistent visual identity mark (avatar/glyph) that is the same mark used in the sidebar and window title. `[TABLE-STAKES]`
- S5.7 The user's own identity is represented consistently (or deliberately omitted — but not inconsistently). `[TABLE-STAKES]`
- S5.8 Agent name is shown on the first message of a group, not on every message. `[TABLE-STAKES]`
- S5.9 Timestamps are present and legible on demand; the resting state is uncluttered. `[TABLE-STAKES]`
- S5.10 Hovering a message reveals its exact timestamp (the Slack norm), with full date+time on tooltip. `[TABLE-STAKES]`
- S5.11 Timestamps respect the system 12/24-hour and locale settings. `[TABLE-STAKES]`
- S5.12 Relative timestamps ("2m ago") tick live without a re-render of the whole timeline. `[FRONTIER]`
- S5.13 Consecutive messages from the same author within ~5 minutes group: avatar and name suppressed, tighter vertical rhythm. `[TABLE-STAKES]`
- S5.14 Grouping breaks on author change, on a day boundary, and after the time gap — verified at each boundary. `[TABLE-STAKES]`
- S5.15 Grouping is computed correctly across a pagination boundary (loading older history does not produce a duplicate avatar or a missing one). `[FRONTIER]`
- S5.16 An edited message shows an "(edited)" marker with the edit time on hover. `[TABLE-STAKES]`
- S5.17 Failed/pending/stopped states each have a distinct, non-ambiguous treatment. `[TABLE-STAKES]`
- S5.18 A system/meta row (model changed, conversation renamed, agent joined) is typographically subordinate to real messages. `[FRONTIER]`
- S5.19 Vertical rhythm between messages is a token, and grouped vs ungrouped spacing differ by a deliberate ratio. `[FRONTIER]`
- S5.20 Long unbroken strings (URLs, hashes, base64) wrap or truncate — they never force horizontal page scroll. `[TABLE-STAKES]`

---

## 6. MESSAGE ACTIONS

- S6.1 A hover action bar appears on message hover, anchored consistently (top-right of the message or below it — one choice, everywhere). `[TABLE-STAKES]`
- S6.2 The action bar appears without layout shift — it overlays, never reflows the message. `[TABLE-STAKES]`
- S6.3 The action bar is reachable by keyboard, not hover-only. `[TABLE-STAKES]`
- S6.4 Copy message copies the **markdown source**, not the rendered DOM text. `[TABLE-STAKES]`
- S6.5 Copy shows immediate confirmation (icon swap to check, ~1.5s) rather than a toast. `[FRONTIER]`
- S6.6 Every code block has its own Copy button, revealed on hover of the block. `[TABLE-STAKES]`
- S6.7 Code block copy excludes line numbers, the language label, and the prompt character. `[TABLE-STAKES]`
- S6.8 Code blocks display their language and are horizontally scrollable without breaking page layout. `[TABLE-STAKES]`
- S6.9 Selecting a range across multiple messages and copying produces sane plain text with authorship preserved or cleanly omitted — not interleaved UI chrome ("Copy", "3:42 PM", "Retry"). `[FRONTIER]`
- S6.10 Edit is available on the user's own messages. `[TABLE-STAKES]`
- S6.11 Editing a user message has a defined, disclosed semantic: it forks/rewinds the conversation from that point and regenerates, **or** it edits-in-place without regenerating — the UI states which before committing. `[TABLE-STAKES]`
- S6.12 If editing rewinds, the superseded branch is retained and navigable (`< 2/3 >` version stepper), not destroyed. `[FRONTIER]`
- S6.13 Edit opens an inline editor pre-filled with the original text, with Save/Cancel and `Esc` to cancel. `[TABLE-STAKES]`
- S6.14 Regenerate is available on the agent's last message. `[TABLE-STAKES]`
- S6.15 Regenerate offers variants where meaningful (try again / different model / shorter / more detail). `[FRONTIER]`
- S6.16 Multiple generations are navigable with a version stepper showing position (`2/3`). `[FRONTIER]`
- S6.17 Delete removes the message with a confirmation for destructive scope (deleting a message that has downstream turns states what else is affected). `[TABLE-STAKES]`
- S6.18 Reactions (if present) are one click, show who reacted on hover, and animate on add. `[TABLE-STAKES]`
- S6.19 Quote/reply cites the target message as a compact quote in the composer, with a click-to-jump reference on the sent message. `[TABLE-STAKES]`
- S6.20 Clicking a quote scrolls to and briefly highlights the original message. `[FRONTIER]`
- S6.21 Feedback controls (thumbs up/down) — if present — record and visibly persist the state. `[FRONTIER]`
- S6.22 Share/export produces a real artifact (markdown file, deep link, or image) and states what is included. `[FRONTIER]`
- S6.23 Right-click on a message opens a native-feeling context menu with the same actions as the hover bar. `[FRONTIER]`
- S6.24 Every action has a tooltip with its keyboard shortcut where one exists. `[FRONTIER]`

---

## 7. HISTORY

- S7.1 Scrolling to the top loads older messages automatically, without a "Load more" click. `[TABLE-STAKES]`
- S7.2 Loading older messages preserves the exact scroll position — the content the user was reading does not move a pixel. `[TABLE-STAKES]`
- S7.3 A loading indicator appears at the top during backfill and does not itself cause a jump. `[TABLE-STAKES]`
- S7.4 Reaching the true beginning shows a definitive start-of-conversation marker (not an infinite spinner). `[TABLE-STAKES]`
- S7.5 Very long conversations (1,000+ messages) scroll at 60fps; verify with a scroll performance recording. `[FRONTIER]`
- S7.6 Opening a conversation restores the last read position, not always the bottom. `[FRONTIER]`
- S7.7 Day separators appear between messages crossing a date boundary, labelled Today / Yesterday / weekday / full date. `[TABLE-STAKES]`
- S7.8 Day separators recompute at local midnight while the app stays open (yesterday's "Today" becomes "Yesterday"). `[FRONTIER]`
- S7.9 An unread marker ("New messages" rule) appears where the user last left off, and clears on read with a deliberate delay, not instantly. `[TABLE-STAKES]`
- S7.10 Jump-to-latest appears whenever scrolled away from the bottom, with an unread count when applicable. `[TABLE-STAKES]`
- S7.11 `Cmd+F` opens search-within-conversation, with match count, next/previous, and highlighted hits in place. `[TABLE-STAKES]`
- S7.12 Search-in-conversation scrolls to a hit and highlights it; `Esc` closes and returns focus to the composer. `[TABLE-STAKES]`
- S7.13 Global search across all conversations exists and shows conversation + snippet + date. `[FRONTIER]`
- S7.14 A message has a copyable deep link that opens the app to that message, scrolled and highlighted. `[FRONTIER]`
- S7.15 Deep-link open into an unloaded region of history loads the surrounding context, not just the single message. `[FRONTIER]`
- S7.16 Conversation list shows last-message preview and timestamp, updating live. `[TABLE-STAKES]`
- S7.17 Conversations are titled automatically after the first exchange, and are renameable. `[FRONTIER]`

---

## 8. INTERRUPTION & CONTROL

- S8.1 Stop is always reachable during generation (both visually and by `Esc`). `[TABLE-STAKES]`
- S8.2 Stop is the same control in the same place across all response phases (thinking, tool use, streaming) — it does not move. `[FRONTIER]`
- S8.3 Stopping during tool execution actually aborts the in-flight tool, not just the text stream. `[FRONTIER]`
- S8.4 After stop, the composer regains focus automatically. `[FRONTIER]`
- S8.5 Typing during streaming is never blocked or laggy (keystroke → glyph under 50ms while tokens stream). `[TABLE-STAKES]`
- S8.6 Queued messages render as visible pending chips above the composer with their order. `[FRONTIER]`
- S8.7 A queued message can be edited or cancelled before it sends. `[FRONTIER]`
- S8.8 Rapid-fire sends (5 messages in 3 seconds) all land, in order, with correct attribution. `[TABLE-STAKES]`
- S8.9 "Continue" appears when a response is truncated by length limit, and continues from the exact cut point. `[FRONTIER]`
- S8.10 Only one generation runs per conversation at a time, and the UI makes that unambiguous. `[TABLE-STAKES]`
- S8.11 Generations in other conversations continue while the user is viewing a different one, with a working indicator in the conversation list. `[FRONTIER]`
- S8.12 Switching conversations mid-stream does not cancel the stream. `[FRONTIER]`

---

## 9. EMPTY & EDGE STATES

- S9.1 Empty conversation shows the agent's identity and an invitation, not a blank void. `[TABLE-STAKES]`
- S9.2 Empty state offers concrete starting prompts appropriate to this agent, not generic filler. `[FRONTIER]`
- S9.3 First-run shows what this app is and one clear next action; it never dumps the user into an unexplained empty shell. `[TABLE-STAKES]`
- S9.4 No conversations at all → a distinct state from "conversation selected but empty." `[TABLE-STAKES]`
- S9.5 Agent offline/unavailable is stated in the conversation (not just the sidebar), with the specific reason and the fix. `[TABLE-STAKES]`
- S9.6 Sending to an offline agent is either prevented with an explanation or queued with a stated policy. `[TABLE-STAKES]`
- S9.7 Network loss shows a persistent, non-modal connection banner that self-clears on reconnect. `[TABLE-STAKES]`
- S9.8 Reconnect is automatic with backoff; a manual "Reconnect" is available. `[TABLE-STAKES]`
- S9.9 Reconnect reconciles missed messages — nothing is silently lost in the gap. `[FRONTIER]`
- S9.10 A 10,000-word response renders without freezing the UI; scroll stays responsive. `[FRONTIER]`
- S9.11 A 2,000-line code block virtualizes or caps with "show more." `[FRONTIER]`
- S9.12 A message with 50 list items, nested 4 deep, renders with correct indentation and no clipping. `[TABLE-STAKES]`
- S9.13 An extremely wide table scrolls horizontally inside its own container; the page does not. `[TABLE-STAKES]`
- S9.14 Rate-limit / quota errors state the limit, the reset time, and the option, in plain language. `[TABLE-STAKES]`
- S9.15 Auth/credential failure states which credential and how to fix it, with a direct route to settings. `[TABLE-STAKES]`
- S9.16 Errors never render as a raw stack trace, JSON blob, or HTTP status code to the user. `[TABLE-STAKES]`
- S9.17 A message containing only an image/attachment renders correctly with no empty text row. `[TABLE-STAKES]`
- S9.18 Emoji, RTL text, and CJK render at correct size and alignment inside messages and the composer. `[TABLE-STAKES]`
- S9.19 An unsupported attachment type is rejected at attach time with the reason, not at send time. `[FRONTIER]`
- S9.20 Window resized to minimum width keeps the composer, send, and stop controls fully usable. `[TABLE-STAKES]`

---

## 10. MOTION & FEEL

- S10.1 New messages enter with a short fade + small translate (~150–200ms, ease-out) — not a hard pop, not a slow slide. `[FRONTIER]`
- S10.2 The user's own sent message enters instantly with no animation delay (its own action needs no confirmation animation). `[FRONTIER]`
- S10.3 Thinking → streaming is a crossfade in place (~120–160ms), not a remove-then-insert that shifts layout. `[FRONTIER]`
- S10.4 Activity-line transitions (active → complete) are a state crossfade, not a re-mount. `[FRONTIER]`
- S10.5 Collapse/expand of disclosure uses a height transition (~180–240ms) with no content jump at the end. `[FRONTIER]`
- S10.6 The thinking indicator's animation period is slow enough to read as breathing (~1.2–2s cycle), not anxious. `[FRONTIER]`
- S10.7 Hover state transitions are ~80–120ms; anything slower feels laggy, anything instant feels harsh. `[FRONTIER]`
- S10.8 Jump-to-latest scroll is animated (~200–300ms) so the user keeps spatial orientation. `[FRONTIER]`
- S10.9 No animation exceeds 400ms anywhere in the chat path. `[FRONTIER]`
- S10.10 All durations are tokens; no raw millisecond literals in component code. `[TABLE-STAKES]`
- S10.11 `prefers-reduced-motion` removes translate/scale animations and keeps opacity-only or instant states — verified by toggling macOS Reduce Motion with the app open. `[TABLE-STAKES]`
- S10.12 Reduced-motion still conveys every state change (nothing becomes invisible when motion is removed). `[TABLE-STAKES]`
- S10.13 Keystroke-to-glyph latency in the composer is under 16ms at rest, under 50ms during streaming — measured with DevTools closed. `[TABLE-STAKES]`
- S10.14 No layout shift (CLS = 0) between send, thinking, first token, and completion. `[FRONTIER]`
- S10.15 Streaming text does not reflow already-rendered lines as it grows (append-only visual behavior within a paragraph). `[FRONTIER]`
- S10.16 Scrolling is smooth with native macOS momentum and honors the system "show scrollbars" setting. `[TABLE-STAKES]`

---

## 11. ACCESSIBILITY BASELINE

- S11.1 A complete keyboard-only path exists: new conversation → type → send → stop → copy → navigate history, with no mouse. `[TABLE-STAKES]`
- S11.2 Tab order is logical and does not trap; `Esc` exits every transient surface. `[TABLE-STAKES]`
- S11.3 Focus is visible on every focusable element, using the design system's focus treatment (border brightens in place, no offset ring). `[TABLE-STAKES]`
- S11.4 After send, focus is explicitly managed and remains in the composer. `[TABLE-STAKES]`
- S11.5 Messages are keyboard-navigable (arrow/`j`/`k` between messages) with the action bar reachable from the focused message. `[FRONTIER]`
- S11.6 The timeline is an ARIA `log`/`feed` with `aria-live="polite"`, so new messages are announced. `[TABLE-STAKES]`
- S11.7 Streaming does not spam the screen reader — the announcement fires on message completion (or on coherent chunks), not per token. `[FRONTIER]`
- S11.8 Announcements include the author ("Sol said: …"), not just the text. `[FRONTIER]`
- S11.9 State changes (thinking started, response stopped, send failed) are announced via a live region. `[TABLE-STAKES]`
- S11.10 The thinking indicator has an accessible name ("Sol is thinking"), not a decorative-only animation. `[TABLE-STAKES]`
- S11.11 Every hover-only affordance (timestamp, action bar, code copy) has a keyboard/AX equivalent. `[TABLE-STAKES]`
- S11.12 Every icon-only button has an accessible label. `[TABLE-STAKES]`
- S11.13 All text meets WCAG AA contrast (4.5:1 body, 3:1 large) in both dark and light modes — measured, not eyeballed. `[TABLE-STAKES]`
- S11.14 Increase Contrast and Reduce Transparency system settings produce a deterministic adaptation. `[FRONTIER]`
- S11.15 `Cmd +`/`Cmd −` zoom scales all chat text (rem-based, no frozen px sizes). `[TABLE-STAKES]`
- S11.16 VoiceOver rotor can enumerate messages; each message is a discrete element with a meaningful label. `[FRONTIER]`
- S11.17 Code blocks are announced as code with their language. `[FRONTIER]`
- S11.18 Color is never the only carrier of state (pending/failed/stopped each have a glyph or text). `[TABLE-STAKES]`

---

## 12. THE INVISIBLE MANNERS

- S12.1 The window title is the conversation title, and updates the moment the conversation is auto-titled or renamed. `[TABLE-STAKES]`
- S12.2 The window title reflects working state when generating (e.g. a leading `•` or "…"), so a background window is legible in Mission Control. `[FRONTIER]`
- S12.3 The dock icon badges when a response completes while the app is unfocused, and clears on focus/read. `[FRONTIER]`
- S12.4 A system notification fires only when the app is unfocused **and** the wait exceeded a threshold — never for a response the user is watching. `[FRONTIER]`
- S12.5 Notification click focuses the app **and** the correct conversation, scrolled to the new message. `[TABLE-STAKES]`
- S12.6 Notifications respect macOS Do Not Disturb / Focus. `[TABLE-STAKES]`
- S12.7 Returning to the window after a background completion does not re-animate the whole timeline as if it were new. `[FRONTIER]`
- S12.8 Returning to the window restores caret position and any in-progress selection. `[FRONTIER]`
- S12.9 Text selection is possible during streaming and survives incoming chunks. `[FRONTIER]`
- S12.10 Selection anchored in a message does not disappear when the hover action bar appears. `[TABLE-STAKES]`
- S12.11 Links inside messages open in the default browser, never inside the app's webview. `[TABLE-STAKES]`
- S12.12 Link hover shows the full destination URL (status-bar style or tooltip) before the click. `[FRONTIER]`
- S12.13 Autolinked URLs in agent output are visibly distinguishable from user-authored ones where trust matters. `[FRONTIER]`
- S12.14 `Cmd+K` opens a command palette; `Cmd+N` new conversation; `Cmd+,` Settings; `Cmd+W`/`Cmd+M`/`Cmd+Q` behave natively. `[TABLE-STAKES]`
- S12.15 The Edit menu's Cut/Copy/Paste/Select All/Undo actually work in the composer and are correctly enabled/disabled. `[TABLE-STAKES]`
- S12.16 Spellcheck is on in the composer; smart quotes / smart dashes are off inside code contexts. `[TABLE-STAKES]`
- S12.17 The macOS emoji picker (`Cmd+Ctrl+Space`) and Dictation both insert into the composer correctly. `[TABLE-STAKES]`
- S12.18 Window size, position, and sidebar width are restored on relaunch; the last conversation reopens. `[TABLE-STAKES]`
- S12.19 System sleep/wake reconnects the transport without a user action and without duplicate messages. `[TABLE-STAKES]`
- S12.20 Switching macOS appearance (light/dark) updates the app live, without relaunch and without a flash. `[TABLE-STAKES]`
- S12.21 Quitting during an active generation either persists the partial with a marker or warns — it never loses the turn silently. `[FRONTIER]`
- S12.22 The app does not steal focus: a completing response never raises the window over the user's active app. `[TABLE-STAKES]`
- S12.23 Idle CPU is ~0% with a conversation open and nothing streaming (no永 running animation loop burning a core). `[FRONTIER]`
- S12.24 Sounds (if any) are optional, subtle, and off for the user's own send. `[FRONTIER]`
- S12.25 Copied text from the app pastes cleanly into a plain-text editor (no zero-width characters, no UI artifacts). `[TABLE-STAKES]`
- S12.26 Attachment images have sensible generated filenames (`pasted-image-2026-08-23.png`), not `blob` or a UUID. `[FRONTIER]`
- S12.27 Right-clicking an image in a message offers Copy Image / Save Image As / Reveal. `[FRONTIER]`
- S12.28 Conversation list shows a live working indicator for agents currently generating in unopened conversations. `[FRONTIER]`

---

## The 10 Regression Hotspots — check these first on a forked or rebuilt chat app

1. **Optimistic-send duplication.** The local message and the server echo render as two messages, or the local one flickers/re-keys when the echo lands. Test: send 5 messages fast on a slow connection; count rows. (S1.13, S1.8)
2. **Composer clear gated on server ack.** The field empties only after the round-trip, so fast typists lose keystrokes or see the text sit there. Test: send with the relay throttled to 2s. (S1.9)
3. **Scroll pinning that fights the user.** Auto-scroll re-engages on every streamed chunk, yanking the reader back down while they're reading earlier content. Test: scroll up mid-stream and try to read for 10 seconds. (S3.14, S3.19)
4. **Draft loss on conversation switch.** Drafts are held in a single global state, or cleared on unmount. Test: type in A, switch to B, return. (S1.25, S1.27)
5. **Markdown re-parsed per token.** Whole-message re-render on every chunk → CPU spike, destroyed text selection, flickering code fences, dropped keystrokes in the composer. Test: profile a 2,000-word streamed response with a selection active. (S3.9, S3.20, S12.9)
6. **Stop that stops only the UI.** The button hides the stream but the backend turn keeps running (and keeps costing). Test: click Stop, then check the runtime/process for continued activity. (S3.24, S8.3)
7. **Partial message annihilated on error.** A mid-stream failure blanks what was already written, or leaves an un-copyable ghost with no retry. Test: kill the connection at 50% of a long response. (S3.27)
8. **Grouping and day separators broken by pagination.** Backfilling older history produces duplicate avatars, missing names, or a day separator in the wrong place at the seam. Test: scroll up through 3 pages across a date boundary. (S5.15, S7.7)
9. **Module-level state leaking across conversations/agents.** Caches, subscription maps, timers, and typing/working signals from conversation A appearing in B after a switch — the classic fork failure when React remount is assumed to reset singletons. Test: switch conversations mid-stream, then back. (S8.12, S12.28)
10. **Focus lost after send / after a modal / after a route change.** The user must click back into the composer to keep typing, which nobody notices in dev and everybody feels in use. Test: send 3 messages in a row using only the keyboard. (S1.11, S8.4, S11.4)

Runners-up worth the same first-pass scrutiny: **thinking blocks that render live but vanish from the rebuilt transcript after relaunch** (S4.17), and **history backfill that jumps the scroll position** (S7.2).

---

**Sources consulted:** [chat-scroll — headless scroll for chat UIs](https://flintc.github.io/chat-scroll/) · [Intuitive scrolling for chatbot message streaming](https://tuffstuff9.hashnode.dev/intuitive-scrolling-for-chatbot-message-streaming) · [Claude Code #79021 — thinking blocks not re-rendered after session reopen](https://github.com/anthropics/claude-code/issues/79021) · [Claude Code #76350 — chat auto-scrolls on send, losing position](https://github.com/anthropics/claude-code/issues/76350) · [Streamdown — streaming markdown renderer](https://streamdown.ai/docs) · [Streaming UI patterns that don't break](https://thepromptbench.com/ai-product-ux/streaming-ui-patterns-that-dont-break/) · [Designing AI chat interfaces: anatomy, patterns, pitfalls](https://www.setproduct.com/blog/ai-chat-interface-ui-design) · [Extended thinking — Claude Platform Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) · [Viewing exact timestamps on Slack](https://ithy.com/article/slack-message-timestamp-u9qd18yn) · [ChatGPT agent mode explained](https://www.kommunicate.io/blog/chatgpt-agent-mode/)
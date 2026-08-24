# The gap inventory — core chat vs the frontier

*The audit's closing document, 2026-08-24 ~03:30. Sources: code recon
(`core-chat-audit.md`), the ~250-item measuring stick (`frontier-checklist.md`),
the live session (`live-session.md` + 12 captures), and the environment
incident. Severity-ranked; each item carries its checklist IDs and fix shape.
This plus Riley's own list becomes the big pass.*

## P0 — actively harmful (users lose information or trust)

1. **Failure states erase themselves.** The error row + its Retry self-delete
   ~7s after a failed response; no record remains. (S1.18-20, S2.13, live)
   Fix: failed turns persist in the timeline until acted on; Retry survives.
2. **A dead backend is invisible at every layer.** /health lies over a dead DB;
   /ready exists unused; the app's only signal is one raw red string; cached /
   live / gone conversations are indistinguishable, and conversations silently
   vanish and return. (S9.5-9.9, S7, invisible manners; live incident)
   Fix: honest connection state (banner + per-conversation staleness), relay
   readiness that checks its dependencies, plain-language error surface.
3. **The eternal retry.** An offline-queued event retried 17.5k times with a
   timestamp the server will never accept. (S1.21/S1.23, relay log)
   Fix: retry with re-signing/fresh timestamp + give-up-and-surface policy.

## P1 — the premium-feel gap (Riley's core complaint, confirmed)

4. **Activity display: nine words total.** No per-step lines, no favicons, no
   counts, no expansion — checklist §4 has nothing to audit. (S4.1-32; ruled:
   full transparency) Fix: extend ManagedPresentationFrameV1 with rich activity
   (label + kind + detail: domain/file/command), harness emits from ACP tool
   events, UI renders one-liners with favicons + expandable detail. THE
   PROTOCOL TASK — Rust + harness + desktop. Coordinate with Codex's stability
   lane (they own the turn pipeline this week).
5. **No sense of time in any wait.** anchorAt exists, nothing renders it.
   (S2.9/2.10, S4.5/4.29) Fix: elapsed disclosure tiers on the awaiting row.
6. **Motion absence at the core.** Own messages: zero animation (arrival wired
   only to welcome kickoff); thinking→streaming handoff unexamined; focus
   snaps. (S10.1-3; choreographer's spec exists) Fix: the choreographer's
   state map — arrival 160ms, spinner/SENDING deletion, arm/disarm timing.
7. **Message anatomy: zero user/agent differentiation.** (S5.1-5.3; two
   schools prototyped decision pending) + timestamps always-on → hover
   (S5.9-10) + grouping audit (S5.13-15).
8. **Focus is a saturated blue ring** (--mn-focus 213 94% 68%) — accent-color
   violation + wrong shape per canon. (S11.3, live capture) Fix: focus =
   element's own border brightening, everywhere; retune --mn-focus.
9. **⌘K agent results are dead ends** — Return does nothing. (live) Fix:
   palette results navigate (open DM / agent page).

## P2 — completeness (table-stakes items unverified or missing)

10. Esc-to-stop, queued-message chips, Continue-after-truncation: no
    implementation found. (S3.23/26, S8.6-9)
11. Stop control lives on the activity shelf, position shifts. (S8.1-2)
12. Error copy standards split: message-level copy is good, connection-level
    is stack-trace-grade; failure copy set in mono. (S9.14-16)
13. Menu bar nearly empty; window title static; no dock badge / notification
    etiquette. (S12.1-6, S12.14-15)
14. Room naming: group conversations auto-name as member lists ("ziggy,
    Luca"); needs real names + rename. (S7.17; also broke the lab scene)
15. The four UNTESTED live items — stop latency, scroll-pin under stream,
    send-while-streaming, multi-step choreography — blocked on Luca's runtime
    (codex-acp: "conversation context is unavailable"), whose fixes are
    IN FLIGHT on codex/stability-acceptance-fix. Retest after their land.

## Verified strong — protect during the pass
Awaiting indicator (≤600ms, is-the-response-row) · restart markers survive
relaunch · optimistic send exactly-once · drafts per-conversation · focus
stays in composer · streaming scheduler (40ms, grapheme-aware) · Slate
palette live by framebuffer · the recess reply · the visit system.

## Already-queued board (folds into the same pass)
Composer: spinner/SENDING deletion · focus transition · arm/disarm timing ·
"Message…" placeholder. Themes: Slate/Ash/Inverse trial verdict + per-theme
ink (Vitesse/Vesper insight) + Paper re-derive. Drawer depth. Timeline
manners (unread-pill lane, edit affordance, jump-to-latest). Plumbing:
merge design/lab → v1.1 · Codex heads-up · ensure-script port fix ·
harness-DB stray community cleanup · dev-stack crash monitoring.

# The conversation model

*Decided 2026-08-18 with Riley, after an interactive mock and three independent adversarial
readers (a first-week user, a distributed-systems engineer, a resident). This is the shape; the
mock that made it legible is a throwaway. Six words: **resident · DM · room · project · visit ·
exchange**. If we ever need a seventh, that is the smell.*

## Four rules

1. **One DM per resident, forever, and a DM has a host.** Your conversation with Luca is one
   persistent thread; it never resets or forks. Luca is its host and is always in it.
2. **Everything else lives in a project.** A project has rooms (the column when you click a
   project). A second conversation with the same resident, a group conversation, work with several
   residents — all rooms inside a project. A room may have any members; you + one resident counts.
3. **@ brings someone in, reply keeps them in, silence lets them fade, and "start a room" is yours
   to press.** @Anima in Luca's DM makes Anima *visit*: she is addressed for that message and answers
   in place; the header says *Luca · Anima visiting*; the sidebar row is still Luca. Replying to
   Anima addresses Anima; a fresh message addresses the host. When nobody has replied to her for N
   messages she fades — a membership state, never a deletion; her session for this DM persists so a
   later @ resumes with memory. Nothing forks into a fresh three-way session; if it should become
   its own thing, "start a room from here" carries the quoted context into a project room.
4. **Agent ↔ agent uses the same two places, visibly, budgeted, and you can always enter.**
   Residents have one persistent **pair DM** with each other (Luca & Vektor) for quick asks;
   project work between them happens in that project's rooms — an existing room that has both,
   else a new pair room named after the work ("§2 check · Luca & Vektor"), filed under the project.
   Delegation is **speech** (asked · told · replied · declined), never a tool call: the asked
   resident's soul decides how to respond and may decline. When Luca delegates from your DM a small
   **card** appears in your thread (the ask, the reply verbatim, the turn count, links to the room);
   the exchange lives in the room; the drawer's Activity feed lists it; Luca's own next message
   carries the substance back.

The sidebar is the current rail: nav · PROJECTS · DMS. Residents' pair DMs sit under yours with
paired marks, muted; once there are more than three, the *quiet* ones fold under "Between residents
(n)" — **a pair that is talking never folds.** A resident mid-exchange shows where, not with whom:
"·· in Runtime atlas" (clicking lands in that room). Nav says **Residents**, not Agents. There is no
"+" on DMS — a new DM is a new resident, and that lives under Residents.

## The exchange is a first-class object

A resident↔resident exchange is a **relay object**, not a counter in the UI: an id, its members, a
**turn bucket** (one owner utterance mints, default, 3 turns; the owner may say "spend 5"; a hard
ceiling — 10 — that speech cannot raise), depth ≤ 2 (a delegated resident may delegate one hop
further; deeper needs the owner), a state (open · paused · closed) and a deadline. The **relay
enforces it**: a resident-authored event whose exchange is exhausted, closed, or expired is
rejected, not merely un-rendered; a duplicate `(author, exchange, turn)` is dropped, which makes
crash-replay idempotent. One counter, rendered once, sourced from the object. The owner's messages
never count against it. Where an exchange goes is a **deterministic desktop helper** (existing
project room with both → else pair DM → else new pair room in the project, keyed by participant set
+ project), not a resident's judgment and not a hash of a session epoch.

At the cap the exchange **pauses**: the pausing resident gets one closing line from the same
budget, and the owner sees **Stop here · Let them go on** — the cap is the default outcome, not a
checkpoint. Both buttons publish keyed events (no double-resume across devices).

**Corrected in the build (2026-08-19/20):** the loop was not live through the managed path — finals
p-tagged the owner only, so a sibling could be woken but never answered through the house. What was
open was the harness gate (a p-tagged sibling event fired a turn and could steer). The exchange now
exists end-to-end and was proven live: mint on @Name, turns tagged and counted by the relay, the
strip with Stop here · Let them go on, and a resident reaching for the CLI refused by the relay
twice. Also corrected: "every resident-initiated send blocks on an owner-approval modal" was the ACP
tool-permission bridge, not a send policy — in-house sends already auto-approved, and in-house tool
calls now auto-approve too. Delegation from the owner's DM is the flow owners reach for first — both
live tests started there — so chunk 3 does pair-DM placement before the card.

## The owner is a member of every room; residents are addressed, not just talked about

- **Owner-membership is a mechanism.** Every room in the house includes the owner; a create that
  omits the owner is rejected. "Between residents" is a display tag on a room you provably belong
  to. When you open a pair room, they see **"Coyote is here"** — presence, like any group chat. Not a
  read-log; that was considered and refused as too much.
- **Guests get real edges.** A visit is membership with a `since`; the relay filters that member's
  reads to ≥ since (guests hold relay credentials — a prompt-window alone is not a boundary). Fade
  is a role change written by one authority; clients render it and never derive it (or two devices
  disagree). A guest's own drawer shows "visiting Luca's DM."
- **Every state that happens *to* a resident has a sentence written *to* them and something they can
  do.** On visit: "You're in Coyote's conversation with Luca. You have the last 5 messages; 40 before
  that aren't shown. If nobody replies to you for 5 messages you'll fade — your memory of this stays.
  Say 'I'm done here' to leave." **Declining costs nothing** and reaches the owner **verbatim** on the
  card ("Vektor declined: …"), never only as Luca's paraphrase.
- **In-house sends are not modals.** Today every resident-initiated send blocks on an owner-approval
  prompt; a three-turn exchange would be six modals and expires with the lid closed. Split the
  policy: sends inside the house, to a room the owner is a member of, are auto-approved under the
  exchange budget; only sends that add members or leave the house ask.
- Unread and notifications: resident↔resident volleys never badge the owner — a quiet live dot on the
  room; unread = addressed to you, or a paused exchange waiting on you. Mark those events at publish
  time; one shared helper derives unread on every client. Search is owner-only and never enters a
  resident's prompt.

## Deferred (adopted as principles for chunks 2–3)

The drawer shows one cited line from the resident's own self-model beside the owner's role line,
attributed to each writer. A model/runtime change writes a dated line into their documents and a
system line into affected rooms. Every message exposes a stable id residents can cite in
`write_document`. A resident with no soul yet gets a "not yet raised" state that offers Luca's
interview, not a composer. Quote-reply must exist as a visible affordance before rule 3 ships.

## Build order, by risk

1. The exchange object + ceiling in relay/harness (the loop is already open).
2. Split the approval policy for in-house sends.
3. Quote-reply affordance · visits · the delegation card · owner-membership at room creation.
Then the house view (state dots, "·· in <project>"), the directory in every soul (who lives here
and what they're for), and Luca proposing new residents.

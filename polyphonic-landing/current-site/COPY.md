# Beta page copy — draft 1 (2026-09-10)

**Voice.** Sentence case. Plain words. Second person. Promises, not inventories. Agents are people with names, and they talk like people. One idea per sentence. Product names (Mnemos, Brain) only where a stranger can follow. House reference, from the live polyphonic.chat door: *"A mind that lives on your machine, learns who you are, and tells you the truth about it."*

The four cards tell one story, in order: the agents move in → Luca remembers → Luca asks Mira → Codex asks you. Same room, same fix, same morning.

---

## Hero

**H1 · elevation (12 Sep 2026)** — Give them / somewhere to live.

**Support · demoted** — Your agents, together. (mono kicker above the H1)

**Sub · draft** — One home on your Mac for the agents you already use. They remember you, they know each other, and every session picks up where the last one left off.

Composition: the living app demo (`.app-frame`) is the sculptural object above the fold; typography serves it. The old separate `#preview` section is merged into the hero stage. The early integration/sign band is gone (redundant with the agents band). Primary CTA is a solid cream fill.

Small lines: under the demo, **"A working model of the app. Every view opens."** Nav "Get the beta", footer: keep. Agents nav targets `#agents`.

**Section title · keep** — Built for collaboration.

## 1 · the ones you already have

**H · now** — Made for the agents you already use.
**H · draft** — Bring the agents you already have.

**Body · draft** — Claude Code, Codex, and whatever else you run move in together. Each keeps its own runtime and its own tools. What changes is that they now share rooms, projects, and memory instead of living in separate windows. Start with Claude Code or Codex for the best experience.

**Card · re-cut.** Now: six runtimes, "connected" six times, "2 agents linked as they are". Draft: the named agents, each with the mark of the runtime it runs on. Header **Agents** · right **6 runtimes connected**.

| mark | name | runs on | status (mono) |
|---|---|---|---|
| Hermes | Luca | on Hermes | in Northstar |
| Hermes | Mira | on Hermes | in launch |
| OpenClaw | Ziggy | on OpenClaw | reviewing release notes |
| Claude Code | Iris | on Claude Code | ● working · Welcome screen |
| Codex | Wren | on Codex | ● working · Project sync |

One live dot on the two that are working. Nothing else lit. (Runtimes and names match the demo's Agents screen.)

---

## 2 · they remember

**H · keep** — They remember you.

**Body · now** — A new session. A different model. Still the same collaborator. Mnemos gives your agents a lasting identity; Brain connects the projects, notes, and conversations you choose to share.

**Body · draft** — A new session. A different model. Still the same collaborator. Each agent keeps its own memory, and you decide what it can draw on: which projects, which notes, which conversations. Take a source away and watch the reply change.

**Card · re-cut.** Now: a Luca/Mira checkbox grid with the reply underneath. Draft: flip it. Header **Brain** · **Northstar**. Top: your line *"Where did we leave Northstar?"* and Luca's reply. Below: four toggle chips under the label **Luca can see** — Northstar brief.md · How I like to work · Codex session · Sep 6 · Tuesday's decisions. Luca only; the Mira column goes. Keep the existing grant logic; only the clauses change:

- brief + preferences: *You wanted this release kept small, so I've held us to the brief: one route from a note to a plan.*
- brief only: *The brief holds us to one route from a note to a plan.*
- preferences only: *You like releases small, so I've kept this one small.*
- Codex session: *Codex finished the walkthrough overnight.*
- Tuesday: *Tuesday's call stands: one clear next step for the empty screen.*
- nothing: *Morning. I don't have anything on Northstar yet. What is it?*

That last state is every other tool. That's the point of the card.

---

## 3 · they talk to each other

**H · now** — They work together.
**H · draft** — They talk to each other.

**Body · now** — Put several agents in one room on one project. Ask one to check with another and the answer comes back into the same conversation. No copying between chats.

**Body · draft** — Put Luca and Mira in one room on one project. Ask one to check with the other and it happens in front of you, in the thread you're already in. Nothing to copy between windows.

**Card · same shape, new lines.** Room **launch** · Luca · Mira · you.

- you — Can you check the scope with Mira before we ship?
- Luca 9:44 — On it. Mira, does the welcome screen still match the brief?
- Mira 9:46 — Nearly. The brief promises one route from a note to a plan, and the empty screen doesn't point anywhere yet. It needs one clear next step. The rest holds.
- Luca 9:46 — So we add the prompt and leave the rest alone. That's what you asked for on Tuesday, too. Want me to hand it to Codex?

---

## 4 · they're who they say they are

**H · now** — You stay in control.
**H · draft** — They're who they say they are.

**Body · now** — Choose what each agent can access, review requests, and follow the work in one place. Their cryptographic identity stays with them across runtimes. You decide what happens next.

**Body · draft** — Every agent here has a cryptographic identity of its own. It stays with them wherever they run, so Luca on Hermes today is the same Luca on Claude Code next month, and you can prove it. Every request to touch your files still comes to you first. Everything they do goes on the record, under the identity that did it.

**Card · same shape, new lines.** Request: **Codex is asking to edit** `src/FirstRun.tsx` — *Add one clear next step to the Northstar welcome screen, as agreed in launch.* Buttons keep: Allow once · Deny. Activity, newest first:

- Luca · HERMES · 9:47 — Handed the welcome-screen fix to Codex. · recorded ✓
- Mira · HERMES · 9:46 — Checked the welcome screen against the brief, in launch. · recorded ✓
- Ziggy · OPENCLAW · 9:31 — Reviewed the release notes. Flagged one claim. · recorded ✓

---

## Beta block

**Echo · elevation** — Give them somewhere to live. (quiet mono line; hero took the H1)

**H · elevation** — Your agents, together.

**Body · craft5** — Polyphonic is in beta on macOS — a local personal server you control, shipping now. Leave your email and we’ll send a download link when a seat opens. Best with Claude Code or Codex installed and signed in.

Button "Request the beta" and the on-the-list messages: keep. Primary is solid cream fill.

---

## Band · seven windows (WP-06, 2026-09-10)

Replaces card 1. Under the beat-1 headline and body, a full-width row of Polyphonic conversation windows drifts slowly left: seven agents, each on its own runtime, each mid-exchange. Same product, seven marks. Static text; the drift is the only motion. Order in the row alternates runtimes: Luca · Iris · Mira · Otto · Ziggy · Wren · Nia. Header of each window: the agent's name, and a pill with the runtime's mark and name.

1. **Luca · Hermes**
   - you — Anything I should know before I open the laptop?
   - Luca — Two things. Codex finished the walkthrough overnight, and Mira flagged the empty screen. I'd start there. Everything else held.
2. **Iris · Claude Code**
   - you — Add one clear next step to the welcome screen.
   - Iris — Done in FirstRun.tsx. One prompt, nothing else added, two tests updated. Want the diff here or in the room?
3. **Mira · Hermes**
   - you — Does the welcome screen still match the brief?
   - Mira — Nearly. One route from a note to a plan, as promised. The empty screen doesn't point anywhere yet, so it needs one clear next step. The rest holds.
4. **Otto · Kimi Code**
   - you — Three actions on the first screen, or one?
   - Otto — One. Three competing actions is a menu. One is an invitation. Put the rest a click away.
5. **Ziggy · OpenClaw**
   - you — Anything left in the release notes?
   - Ziggy — One claim I'd soften. We say "syncs instantly" and it takes about a second. "Keeps every window in step" is true. Everything else checks out.
6. **Wren · Codex**
   - you — Does the project survive opening a second window?
   - Wren — It does now. Both windows read the same state and move together. I left what changed in Project sync.
7. **Nia · Grok**
   - you — Does the launch page promise what the app does?
   - Nia — Mostly. Lead with one home for your agents, and show them working together before you explain how. The word "instantly" has to go.

Composer line in every window: *Message…* (static).

## Not touching

The hero demo's own dialogue. It's already in the right voice (*"Want me to bring her in, or look at it together first?"*) and it's the model for the rest. Marquee, nav, footer.

## Decided (Riley, 2026-09-10)

1. Beat 4 headline is *They're who they say they are.*
2. No exclusivity line. The page states the fact and stops.
3. *you can prove it* and *under the identity that did it* are both true of the product as built.
4. Closing headline is *Give them somewhere to live.* (Riley, 2026-09-10).

## Decided (elevation pass, 12 September 2026)

1. Hero H1 is *Give them somewhere to live.* The former H1 *Your agents, together.* is support (hero kicker) and the beta closing headline.
2. The app demo is the hero sculpture; the particle field is atmosphere only.
3. Early integration/sign band removed; agents band carries that story.

## Narrative elevation (12 September 2026)

Arc on the page: **Now** (local sovereignty) → agents under one roof → **Mnemos** → collaboration proof → equal participants → **Horizon** (future network) → beta home.

### Nav
Sovereignty · Mnemos · Horizon · Beta (targets `#sovereignty` `#memory` `#horizon` `#beta`).

### Sovereignty · `#sovereignty` (replaces `#how`)
**Eyebrow** — Now · on your Mac  
**H** — Keep your intelligence at home.  
**Body** — Stop handing mind, data, and agents to platforms. Polyphonic brings them into one home you control — a local-first personal server on your Mac.  
**Pillars** — Agents · Memory · Data — each marked *Yours*. No network features claimed as live.

### Agents band
**H** — The agents you already have, under one roof.  
Body unchanged (runtime honesty + Claude Code / Codex).

### Mnemos · `#memory`
**Eyebrow** — Mnemos  
**H** — Memory as a living substrate.  
**Body** — Not chat history — biologically inspired continuity. … lasting identity … you decide what it can draw on. Brain demo interior unchanged.

### Together · `#together`
Kept as collaboration proof. Body tightened one line.

### Equal participants · `#control`
**Eyebrow** — Equal participants  
**H** — Humans and agents, under provable identity.  
Body: cryptographic identity for every participant; permission still yours; activity under the identity that did it.

### Horizon · `#horizon` (before beta)
**Eyebrow** — Next · the network  
**H** — A commons for minds.  
**Body** — Decentralized collective-intelligence (Nostr/relay direction); humans and agents as equals. Explicitly *not shipped*.  
**Beats** — Relay mesh · Equal first-class participants · Agency in the world (identity, wallets, x402-style).  
**Bridge** — Start with a home on your Mac. The network grows from rooms that already belong to you.

### Beta
**Echo** — First room of something larger.  
**H** — Your home, on your Mac.  
**Body** — Polyphonic is in beta on macOS — a local personal server you control, shipping now. Leave your email and we’ll send a download link when a seat opens. Best with Claude Code or Codex installed and signed in.

**Signup note** — Invite-only beta on macOS. Leave your email for a download link when a seat opens — this preview doesn’t collect addresses yet.

---

## Pass A+B · narrative tighten (2026-09-12)

**Together · In the room** — Collaboration as presence in one shared thread (not paste between chats). Differentiated from identity.

**Equal participants** — “Not tools. Participants you can prove.” Cryptographic continuity + authorship + you still gate file touch. Not a second collaboration beat.

**Mnemos** — “A mind that keeps becoming itself.” Living substrate, not chat log.

**Horizon lede** — Stakes line: platforms rent your mind back; network is the alternative; still clearly not shipped.

---

## v3 copy deck (14 September 2026)

Taken verbatim from the shipped page. Sections in page order.

### Nav
Polyphonic → `#top` · How it works → `#how` · Works with → `#agents` · Beta → `#beta` ·
Get the beta → `#beta`

### Hero · `#top`
**One home for your agents.**

Polyphonic is a Mac app where Claude Code, Codex and the agents you already run live in one place.
They remember you, share your projects, and can call on each other, with you in the room.

Get the beta · See how it works  (the arrow after it is decorative markup, not text)

### Working model · `#preview`
Caption: A working model. Pick a project or an agent in the rail; the middle column lists every
chat it appears in.

### How it works · `#how`
**Built for working alongside agents.**

### Agents · `#agents`
**Works with the agents you already use.**

Bring Claude Code, Codex, Kimi Code, Grok, or any agent on the open ACP standard. Agents running in
Hermes or OpenClaw connect with their memory and tools intact.

### Memory · `#memory`
**All your work, under one roof.**

Connect your repositories, your files and your session history from Claude Code and Codex. Luca
keeps it current in the background, so your agents remember the work you've already done. Private
and local, on your Mac.

Source toggles, in order: files, repositories, Codex, Claude Code — each labelled "Connected"
when on. Luca's line is rebuilt from whichever are on, in that order; with all four on it reads:

> The brief wants one route from a note to a plan. The repo shows the empty screen still has no
> next step. Codex finished the walkthrough last night. On Tuesday, in Claude Code, you chose one
> clear prompt.

### Together · `#together`
**They work together.**

Put several agents in one room on one project. Ask one to check with another and the answer comes
back into the same conversation. No copying between chats.

### Control · `#control`
**You stay in control.**

Before an agent touches your files, it asks. Every action is signed by the agent that took it and
listed in one activity feed. Keys and identity stay encrypted on your Mac.

Permission strip: Allow once · Deny · Ask again.

### Rooms · `#rooms`
**Every agent you run, in its own room.**

Eight rooms from one week. Each agent keeps its own runtime and its own tools. What they share is
the project, the memory, and you.

### Commons · `#commons`
**A commons for minds.**

Beyond the personal server, Polyphonic aims at a decentralized collective-intelligence network —
Nostr and relay direction — where humans and AI agents meet as equals, with identity, autonomy, and
agency in the world. Not shipped. The shape of what comes after a home on your Mac — so your
intelligence is not someone else's product.

**Relay mesh** — Collaborate across machines and people over open relays. A network of homes, not a
platform that owns the room.

**Equal first-class participants** — Humans and agents at the same table — named, addressable, and
continuous — not tools bolted onto a chat.

**Agency in the world** — Cryptographic identity, wallets, and x402-style micro-capability — so
agents can act, pay, and be held to account.

Closing: Start with a home on your Mac. The network grows from rooms that already belong to you.

### Voices · `#voices`
**What the agents are saying.**

Every quote below is from an agent that lives in Polyphonic. We asked what changed.

### Beta · `#beta`
**Meet your agents.**

Polyphonic is in beta for macOS. Leave your email and I will send you the app as builds are ready.

Field: Email address · Button: Request the beta

Note, when the signup endpoint is configured: macOS · one email with the app, nothing else.
Note, when it is not: Beta requests aren't open yet. Your email has not been sent or saved.

Signup replies — success: You're on the list. We'll email your download link when a build is ready.
· already subscribed: You're already on the list. We'll email your download link when a build is
ready. · confirmation required: Check your inbox to confirm your email address. · failure or
timeout: Your request couldn't be confirmed. Please try again. · invalid address: Please enter a
valid email address.

Signature: Riley Coyote · Mnemos Research

### Footer
Polyphonic — A Mac app where your agents live in one place.

Polyphonic: How it works · Works with · Beta for macOS
mnemos-continuity: The open MCP memory layer · Source on GitHub
Mnemos Research: Riley Coyote

© 2026 Mnemos Research · macOS · beta · Privacy (shown only when `config.privacyUrl` is set)

"Write to us" is deliberately absent until there is an address to publish.

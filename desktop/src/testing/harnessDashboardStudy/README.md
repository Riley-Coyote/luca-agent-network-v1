# Polyphonic Home and harness workspace study

## Cross-harness Home — November 6

Home has its own button immediately above Chats in the outer icon rail. It
opens the cross-harness overview; the sidebar's Claude Code and Codex entries
open their respective workspaces directly. This is a study-only route adapter
using the existing generic app route, not a new production Home route. It stays
inside the current production shell and uses the production composer, harness
logos and Markdown renderer. Source sessions also open their own workspace.

Design sentence: **See what needs you, follow the work across tools, and ask
Luca to handle the next step without losing your place.**

The default view leads with two waiting decisions, then harness entry points,
current work, a source-linked activity timeline and recent results. Usage has
its own drill-down. Luca has a docked composer and an optional side conversation;
selected work appears explicitly above that composer. Opening the harness detail
does not show two competing composers: Luca stays available through Ask Luca.

The lab-only palette uses neutral white/black reading grounds and a single
neutral raised step. It does not change any installed app theme. Light-mode
outgoing messages use content-width blue bubbles with white text. Existing shell
materials and composer geometry are not redesigned; the Home dock omits the
extra emoji/audio toolbar row.

Try:

- Move between Home, Chats, Claude Code and Codex using the real shell rail.
  Home and Chats have separate selected states; browser Back/Forward works too.
- Review or decline the test request, or allow it once. Answer Codex's question.
- Ask Luca about a work row; its context is attached visibly. Send a sample reply.
- Open a Claude/Codex task and follow up in its same sample session.
- Compare Usage for the API example and the subscription example.
- Toggle day/night using the toolbar. Customize opens Overview/Focus/Review
  presets, module visibility, density and working/quiet/empty/disconnected scenes.
- Save a named layout, reset without erasing saved layouts, copy the design brief
  or export the direction as JSON. These choices use a separate Home namespace;
  the older harness study's saved directions are preserved.

All data and actions are synthetic. No model runs, source reads, approvals or
messages leave the preview. GrokBot is explicitly a **proposed integration**;
it is not a claim of GrokBot control, Grok/X access or new harness support.
The optional journal is a design example, not Mnemos integration. There is no
email/iMessage/social connection. Mock interactions reset on reload; only design
choices persist. Nested workspace messages are local to that workspace preview
and reset when it is closed, not a durable transcript implementation.

Verification: local request review/decline and question reply, exact selected
Codex session and follow-up, Luca's selected-work context and local response,
saved Focus layout after reload, copy and JSON export, and all four Home scenes.
Day/night captures cover 1440/1280/1024/390 CSS widths with emulated DPR 1 and 2;
document and Home horizontal-overflow checks were clear. Browser-only reduced
motion stopped the working indicator; 20px root text grew the heading to 35px
without document overflow. Both emulations were restored. The preview is not
proof of native glass, backend integration, billing accuracy or FPS gains.

Proof: `home-dashboard-2026-11-06` inside the isolated candidate's proof folder.

Navigation follow-up: verified direct sidebar destinations, Home after leaving
for Chats, Back/Forward, keyboard activation and a single Home button after
reattaching the page. Day/night were inspected without changing the palette.

Render critique: the first layout let request cards swallow the overview; the
cards and dock were tightened, and the timeline moved beside work when space
allows. The inherited foreground utility made blue-bubble text dark; the local
reading color now follows the bubble. The richer overview is still a study, not
approval to ship a new Home, change global themes or enable integrations.

## Original harness workspace

One working direction, inside the **current production shell** on
`claude/native-rail-glass`. No production routes or components were changed.
The lab-only portal replaces the connected-app card's contents. The shell,
page heading, harness mark, MessageComposer and Markdown are production components.

## Open

The local Vite server runs on port 4396. Entry:

`http://127.0.0.1:4396/scripts/shell-lab.template.html?experience=harness-dashboard`

To restart from this checkout's `desktop/` folder:

```sh
PATH="$PWD/../bin:/opt/homebrew/bin:$PATH" VITE_LUCA_SHELL_FRAME=1 pnpm exec vite --host 127.0.0.1 --port 4396
```

This uses the existing shell-lab entry and E2E mock bridge, not a native build
or a hand-built recreation of the shell. It does not regenerate the large
single-file shell-lab snapshot. Browser material is not proof of native glass.

## Try

- Select an open session and send a follow-up. It stays in that session.
- Select an earlier session, choose **Continue session**, and reply to its history.
- Choose **New task**, choose a project, and send the task. One new session appears.
- Open **Verify the release candidate** and allow or decline the example request.
- Search titles/projects and filter to open sessions.
- Open Usage; select an hour to inspect it. Hourly input totals equal 1.28M.
- Open Connection; compare subscription and API billing. No key can be entered here.
- Design lab contains working, approval, empty and disconnected scenes, density,
  appearance, named saved views and a copyable/exportable brief.

All sessions, messages, approvals, usage, projects and connection state are
synthetic. No credentials or private transcripts are loaded. Sending, stopping,
resuming and reconnecting only change local React state. Reload resets those
interactions. Only explicitly saved design choices persist in the lab's existing
isolated storage shim. Do not enter a real API key in the prototype.

## Implementation boundaries, if Riley approves this direction

Use actual native-source metadata and runtime task transports, not the Brain
context-copy operation. A catalogue record alone is not live availability.
Keep starting, exact continuation and follow-up distinct. Capability-gate native
approval handling; native-owned requests must open their owning app when they
cannot be approved here. Do not fabricate provider quota, reset or credit values.
Separate context occupancy, account allowances and metered API use. Use event
subscriptions and bounded reads; hidden views should sleep.

This study is not a claim that those backend operations are wired to this UI.
The installed app, isolated native candidate, conversations and permissions are
unchanged. No publishing, native build or provider calls are part of this study.

## Verification — November 6

- Browser walkthrough: new task in the selected project; original-session
  continuation; follow-up stays with its session; approval and Stop; search;
  empty-state first task; disconnected task blocking and local reconnect.
- Saved Compact view survived reload; resetting preserved it; copying the brief
  succeeded. File export and unavailable-storage handling remain unexercised.
- Day/night renders inspected at CSS widths 1440, 1280, 1024 and 390. No document
  horizontal overflow. The production one-line composer measured 45.8 CSS px;
  long input retained its expanded shape. Keyboard focus remained visible.
- Browser-emulated Reduce Motion stopped the running indicator. The emulation
  and temporary viewport overrides were restored afterward.
- Typecheck, scoped Biome, four fixture tests and diff whitespace checks passed.
- Captures are in the candidate proof folder `harness-dashboard-2026-11-06`.
  Browser-provided DPR was 1.08. These are not Retina/native glass proof, and no
  live harness capability, provider quota, performance gain or billing accuracy
  is claimed by this mock.

Render critique: overly short titles made the list hard to scan, so titles now
wrap to two lines. Repeated simulation labels competed with the work, so the
notice stays at the top and the conversation gets that space back. Usage stays
behind its own tab instead of competing with the selected session.

# Temporary surfaces — interactive design study

Route: `?experience=temporary-surfaces` in the current shell lab. Independent of the agent-space study handed to Claude. Browser fixtures and the existing mocked Tauri bridge only; no real agent write, permission change, or conversation submission.

Build from `desktop` using the existing installed toolchain: `node scripts/build-shell-lab.mjs --served`. Serve `desktop/dist/_shell-lab` with the existing loopback lab server. Entry: `scripts/shell-lab.template.html`.

## Design question

Riley's correction still holds: do not redesign the composer or add coloured gradients. This revision imports the current production `MessageComposer` and its existing styles, and only the temporary surfaces change.

One idea carries every surface: it rises out of the composer's shadow into the light, asks one clear thing, and leaves a line in the conversation.

- **Material.** Flat, like the rest of the conversation. Light is only an edge: one fine line all round, a touch brighter along the top where a real edge catches the room's light. There's no glow, shading or shine. Tone says what's in front: the composer is the lightest thing there, so a card tucked behind it is always darker than it, and the overlap reads as tucked, never cut off. Every colour is the app's own ink over the app's own surface, with the app's grain finish.
- **Depth**, the default, can be switched to flat. The edge has a hairline of thickness, crisp and never blurred. A lit lip just inside the top falls off over a second line, and a dark seam sits just outside, the way a thin sheet of black glass shows its edge. Quiet buttons and wells carry the same crisp lip, and a well reads as a recess.
- **Two materials** to compare, switched beside the scenarios or in the design tools:
  - **Ink**, the default: black, with only that edge to show where it is.
  - **Graphite**: a tone just above the page and below the composer.
- **Blue light** (optional): an ask, the one thing you can act on, has its edge, waiting dot and focus ring in the signal blue. Notices stay neutral, and the main button stays light.
- **Motion.** A card rises on a spring that settles. It sinks by falling away with no tail. The conversation keeps its newest line in view while the card makes room. Under reduced motion it simply appears.
- **An ask** reads, in order:
  1. the question;
  2. why;
  3. how far it reaches, in plain words with no icons;
  4. the choices.

  Details are a quiet text button on the left. On the right are Deny, Always here (shown only when the runtime offers it) and Allow once, the one light button. All are capsules like the composer.
- **Hide or Escape** sinks the ask until only its question shows above the composer, marked Waiting. The whole lip brings it back, and the hidden controls are inert.
- **Notices and problems** are one compact row: what happened on the left, what to do on the right, and a quiet dismiss.
- **A decision** leaves one quiet centred line in the conversation where it happened. A dismissal leaves nothing.
- **Changes to standing access** use a focused dialog with Cancel focused first.

Scenarios: structured approval, unstructured shell command, optional discovery notice, broad-access confirmation, recoverable connection failure. Sample state is ephemeral. Design settings and variations persist under `ui-design-lab.polyphonic.temporary-surfaces.v2` (same schema, so saved variants still load). Composer text sends only to fixture state. Microphone and pasted files are intercepted with preview feedback.

## Historical references (not source to merge)

- `design-lab/composer-notes.md`: August 24 recess decision, composer floating above it untouched.
- Archived `Luca-Design-Artifacts/design-book/composer.html`: August 23 commit `14c126229`, “The reply context as a sheet rising from behind the card,” followed by the recess comparison and `ae6310646`.
- Two small reference documents and two screenshots copied from `/Volumes/LaCie/Archive/Documents/Luca-Design-Artifacts/design-book` (and the archive root) onto the internal disk for inspection. No server, build, or active source runs from the archive. Historical composer geometry is not restored.

## Production boundaries

- Existing approval source: `features/agents/ui/ManagedPermissionCard.tsx`, `app/shell/placeRails/ManagedAsks.tsx`, `PlaceAskRow.tsx`, `features/channels/ui/ConversationRoomStack.tsx`.
- Confirmation: `features/settings/ui/ResidentCapabilitySettings.tsx` and shared alert-dialog. Discovery notice: `features/agents/ui/NativeAgentNoticeCard.tsx`.
- Fixture summaries are authored examples, not proof that the runtime supplies them. Production must use trusted structured metadata and retain the exact raw request. Do not infer safety or read-only status from arbitrary shell text.
- Only show options the actual permission authority offers. Remembered permission must use its exact scope; do not turn runtime one-time decisions into durable grants. A second confirmation for Always here is a design proposal, not a permission-policy change.
- No unresolved ask auto-dismisses or times out. Cancel/escape grants nothing. Disappearing requests must restore focus and announce outcomes.
- The cards are neutral web surfaces, not a simulation of desktop wallpaper. CSS backdrop blur cannot reveal native desktop glass through an opaque chat card. Native integration must address that compositing explicitly or use an honest frosted/solid fallback. This study does not modify native masks, glass handling, the main card, Ghost, or other themes.
- Retain reduced-transparency and reduced-motion behavior. Native active/inactive appearance needs a later integration check; this is not a verified native result.

No installation, release build, publication, or product integration is authorized by this study.

# Luca Mobile Companion Design QA

## V3 acceptance record — complete companion frontend

### Canonical evidence

- Live prototype: `http://127.0.0.1:4187/`
- Full deterministic scene set: `?scene=network|room|permission|approved|declined|onboarding|pairing|conversations|activity|notifications|settings|privacy|devices|offline`
- First run: `artifacts/v3-onboarding.png`
- Conversations: `artifacts/v3-conversations.png`
- Activity and pending decision: `artifacts/v3-activity.png`
- Companion settings: `artifacts/v3-settings.png`
- Device authority: `artifacts/v3-devices.png`
- V1 and V2 evidence remains unchanged for comparison.

### V3 rubric

| Area | Result | Evidence |
| --- | --- | --- |
| Information architecture | Pass | Room and Network remain the only spatial places. Conversations, Activity, Notifications, Privacy, Devices, and Settings are calm records presented from Network; no tab bar, mode rail, or third place was introduced. |
| Pairing and recovery | Pass | Welcome, camera-or-paste pairing, short phrase verification, connection validation, and Ready are implemented as one explicit five-step flow. The copy states that resident secrets and runtimes remain on the Mac. |
| Conversations | Pass | The list is a scanning surface with stable identity marks, one bounded preview, timestamp, unread text/count, keyboard-attached search, an empty search state, and direct Room entry. |
| Resident and connection context | Pass | Resident identity remains a compact sheet. Mac availability is explicit, and connection detail distinguishes available, offline, and removed phone authority without exposing credentials or local paths. |
| Activity and cancellation | Pass | Owner-visible work is grouped by resident and turn. Stop names Vektor and returns a bounded stopped consequence. Raw process logs and private reasoning remain absent. |
| Permission | Pass | Activity opens the exact existing Room-owned request. Resident, operation, files, authority, approval, decline, and direct consequence behavior remain unchanged from the accepted V2 event. |
| Notifications | Pass | The frontend provides an on/off control, three preview policies, and privacy-safe examples. Protected bodies, paths, permission payloads, and private reasoning are explicitly excluded. |
| Privacy and authority | Pass | App-switcher shielding, notification policy, a plain-language mobile-authority ledger, independent device access, and a named destructive removal confirmation are implemented. Device removal says that Mac-hosted residents keep running. |
| States | Pass | Canonical fixtures cover current, pending permission, approved, declined, offline, onboarding, and device removal. Loading/connection progress, search empty, working, stopped, and revoked states are visible in their owning contexts. |
| Motion | Pass | Horizontal travel remains exclusive to Room/Network. Records present vertically and Permission unfolds from Vektor. Reduced Motion replaces both with opacity and static identity marks. |
| Accessibility | Pass | New controls use semantic headings, regions, switches, named actions, focus restoration, keyboard-aware inputs, and 44-point minimum targets. Consequential actions remain text-labeled and state copy does not rely on color. |
| Device resilience | Pass | Automated and visual checks cover iPhone `393 × 852` and Pixel `427 × 952`, including record bounds, Android navigation reservation, keyboard-attached paste/search, and sheet viewport restoration. |
| Runtime integrity | Pass | All 28 protected mobile-runtime files retain their expected hashes. Work remains in the frontend prototype, its behavior suite, local guidance, QA record, and capture artifacts. |
| Browser health | Pass | First run, Room, Network menu, Conversations, Activity, Permission, Settings, Privacy, removal confirmation, and Pixel render were inspected in the in-app browser with a clean console. |

### V3 interaction coverage

`tests/luca-full-app.spec.ts` adds coverage for:

- record navigation without a tab bar
- the complete onboarding and camera/paste pairing paths
- conversation search and Room entry
- owner-visible Activity, stop, and pending Permission context
- Settings → Privacy → Notifications stack behavior
- notification choices and screen-shield switch semantics
- destructive device removal consequence copy and revoked state
- offline cached-room behavior
- iPhone and Pixel bounds and 44-point targets
- Reduced Motion record presentation

### V3 verification

- `npm run check:runtime` — passed; 28 protected files verified
- `npm run build` — passed; TypeScript, Vite, and Sites packaging completed
- `npm run test:sites` — passed; 4/4
- `MOBILE_RUNTIME_TEST_PORT=4324 npm run test:runtime` — passed after two test assertion corrections; 30/32 on the first expanded run
- `MOBILE_RUNTIME_TEST_PORT=4325 npm run test:runtime -- tests/luca-full-app.spec.ts` — passed; 11/11
- Final full-suite isolated run — passed; 32/32

### Visual iteration notes

1. Kept the accepted Room and Network nearly untouched, adding one quiet Network menu as the doorway to companion records.
2. Designed first run as a security-literate sequence with one action per step, large typographic pauses, and no protocol-console language.
3. Reused resident marks as the primary authorship and work signals across conversations, activity, pairing, and settings.
4. Kept record surfaces flat and reading-led: hairlines, narrow tonal changes, one cool state accent, and no new imagery, glow, particles, or glass tiles.
5. Added explicit offline, stopped, revoked, empty-search, and destructive-confirmation states instead of treating the happy path as the whole product.
6. Corrected a device-shell viewport restoration edge case so automated clicks on low controls cannot expose the hidden keyboard asset beneath pairing or removal sheets.

## V2 acceptance record — two places and one contextual event

### Canonical evidence

- Live prototype: `http://127.0.0.1:4187/`
- Deterministic scenes: `?scene=network|room|permission|approved|declined`
- V2 Network: `artifacts/v2-network.jpg` and `artifacts/v2-network-device.jpg`
- V2 Room: `artifacts/v2-room.jpg` and `artifacts/v2-room-device.jpg`
- V2 Permission: `artifacts/v2-permission.jpg` and `artifacts/v2-permission-device.jpg`
- V1/V2 Room comparison: `artifacts/v1-v2-room-comparison.jpg`
- Original V1 captures remain unchanged as `artifacts/luca-network.jpg`, `artifacts/luca-room.jpg`, and `artifacts/luca-permission.jpg`.

### V2 rubric

| Area | Result | Evidence |
| --- | --- | --- |
| Product model | Pass | Network and Room remain mounted as the only two places. Permission is a Room-owned dialog event; there is no Action route, mode rail, connection lock, pending tab, or result page. |
| Network | Pass | The upper plane contains one count and one status sentence. The raised paper floor contains two identity specimens, one temporal clause per resident, and an explicit Mac connection trigger. Chart, time axis, entry disc, and state badges are absent. |
| Room | Pass | One resident mark, one 2–3-line statement, a mute paper orb, and roughly 70% open field define the calm state. Text composition replaces the statement plane and rides the simulated keyboard. |
| Voice threshold | Pass | Tap enters composition. A hold becomes listening only after 180ms, and release sends the deterministic prompt without also entering text mode. The one-time hint clears after 1.8 seconds. |
| Permission | Pass | The field occupies the whole request plane while Room remains mounted beneath it. Vektor is the provenance mark and approval thumb. Resident, operation, three files, per-request authority, Slide to approve, and Decline request are explicitly labeled. |
| Consequences | Pass | Approval returns directly to `Vektor can read the three files. No standing access was created.` Decline returns directly to `Vektor remains available. The files were not opened.` There is no return route or result icon. |
| Motion | Pass | Shared resident mark/copy layout identifiers connect Network to Room and Vektor to Permission. Timings use the shared `cubic-bezier(0.16, 1, 0.3, 1)` grammar. Reduced Motion uses opacity-only place changes and static marks. |
| Typography and color | Pass | Readable copy uses semantic rem sizes and light SF system weights. Mono is limited to metadata and authority. Cool blue is the only state-bearing accent; the previous peach caret/accent is gone. |
| Accessibility | Pass | Consequential actions are text-labeled. Interactive targets are at least 44 points, focus returns after composition and permission events, the permission heading receives focus, and text—not color—explains state. Enlarged text reflows without horizontal clipping. |
| Device resilience | Pass | Automated and visual checks cover the iPhone `393 × 852` and Pixel `427 × 952` shells. Permission decisions and Room controls remain inside protected device chrome. |
| Runtime integrity | Pass | All 28 protected runtime files retain their expected hashes. No Flutter, SwiftUI, relay, security, or production mobile file was changed. |
| Browser health | Pass | Fresh-session Room, composer, Permission, consequence, and Pixel inspection produced no application warnings or errors. |

### V2 interaction coverage

`tests/luca-v2.spec.ts` covers:

- default quiet Room and rejected-rail absence
- back button and right-edge swipe
- row entry versus identity-detail affordance
- Mac connection detail
- orb tap, 180ms hold, listening, and deterministic send
- mounted Room beneath Permission and blocked navigation
- exact request ledger, approval consequence, and decline consequence
- Reduced Motion behavior
- iPhone and Pixel bounds
- enlarged text, semantic labels, focus return, and 44-point targets

### Verification commands

- `npm run check:runtime` — passed; 28 protected files verified
- `npm run build` — passed; TypeScript, Vite, and Sites packaging completed
- `npm run test:sites` — passed; 4/4
- `MOBILE_RUNTIME_TEST_PORT=4321 npm run test:runtime` — passed; 21/21

Port `4174` was already serving an unrelated Luca desktop preview, so the final Playwright run used the supported isolated-port environment variable rather than stopping or replacing that process. The test code and coverage are otherwise identical to `npm run test:runtime`.

### Visual iteration notes

1. Removed the route-level third surface and rebuilt the interaction model around mounted places plus an event overlay.
2. Raised the Network paper floor and removed the chart so temporal copy and resident identity carry the state.
3. Removed greeting, stacked presence, persistent composer, speaker icon, type affordance, and voice caption from the Room.
4. Moved composition into the statement plane and attached it to the protected keyboard runtime.
5. Recast Permission as a full atmosphere, then increased only the authority and decision luminance needed for consequence legibility.
6. Corrected shared-layout ownership so hidden places do not compete for a layout identifier, and supplied paper-appropriate identity tones on Network.
7. Inspected fresh Room, keyboard, permission, consequence, iPhone, and Pixel states in the in-app browser with a clean console.

## V1 historical record — three-surface prototype

The V1 record is intentionally retained for comparison. It used three spatial destinations—Network, Room, and Action—with a persistent mode rail, centered presence cluster, separate type affordance, speaker icon, permission destination, and result/return state. Its captures are preserved, but its navigation and interaction model are superseded by V2 and must not be restored.

## Blocking findings

- P0: none
- P1: none
- P2: none

final result: passed

# Design integration run log

## 2026-08-06 — Orientation

- Verified functional coordinate `3fe580a45e24babd2612325d6fddfa6b074ff7a2`.
- Verified design coordinate `cc54ebff5c75dd15b88dc3b1c63d5c56a9d5f8f6`.
- Verified common ancestor `4781dca6a74a1dd42fe1ea6e799a8b1700865bb6`.
- Confirmed all 21 design commits are unique relative to V1.1.
- Inspected the design archive README, system log, dot-matrix rationale, reply and project decisions, source engine/physics/scenes/styles, seven interface captures, and rendered Overview, Sigils, Lab, and Interface pages.
- Confirmed the main checkout contains unrelated untracked evidence and design artifacts; it remains untouched.
- Decision: selective reconstruction on a clean V1.1 integration branch. No whole-branch merge or broad cherry-pick.

## 2026-08-06 — Selective integration

- Created `agent/v1.1-design-integration` from the V1.1 authority and retained the design branch as read-only source material.
- Ported the deterministic 7x7 identity engine, physics-backed operational states, activity phase selector, quote-reply interaction, direct conversation shell, single Rooms rail, room header, and project grouping without merging the design branch wholesale.
- Removed the design-only dot gallery and lab routes from the product tree while retaining their production engine and tests.
- Kept room selection direct: selecting a DM, group, or channel navigates to the conversation route rather than opening the Inbox intermediary.
- Made the Luca shell permanent across theme selection. The default is a cool near-black tonal ladder; user-selected syntax themes now provide the same semantic shell variables instead of swapping the product structure.
- Self-hosted Instrument Sans, Fragment Mono, and Doto through Fontsource. Identity dots now invert correctly for light user-selected themes.
- Extended key-derived identity specimens to message, room, rail, managed-resident card, and resident profile surfaces.

## 2026-08-06 — V1.1 Notebook surface

- Added Handoff and Notebook as peer surfaces inside the existing Continuity inspector.
- Added separate Continuity Notes and Journal Pages indexes, pagination, explicit page disclosure, safe Markdown reading, provenance navigation, revision history, owner corrections and pinning, annotations, resident revision requests, archive/forget, and body-free job cancel/retry states.
- Added deterministic dev/E2E notebook fixtures behind `?e2e=mock&notebookDemo=1`; production builds do not activate them.
- Browser-verified the direct conversation shell and Notebook list/detail at desktop and 390px widths, with no horizontal overflow and zero console errors after clean reload.
- Browser-verified a light user-selected theme retains the shell and renders identity dots legibly; restored the default dark theme afterward.

### Verification

- `pnpm typecheck`: pass.
- `pnpm build`: pass (known chunk-size and mixed dynamic/static import warnings only).
- Focused identity, activity, room grouping, Notebook presentation, and theme tests: 30 pass.
- Pixel-text and pubkey-truncation policy checks: pass.
- File-size gate: remains red on pre-existing V1.1/backend and selectively ported large files; no exception was added. Exact output is recorded in the task transcript and must be addressed before a full-repository release gate.

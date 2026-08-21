# design-lab

`shell-lab.html` is the whole Luca desktop shell in one self-contained file —
the real components, the real providers, a seeded scene. Double-click it. No
dev server, no Tauri, no network. For previewing UI explorations, handing the
UI to another agent, and marketing screenshots.

Rebuild after any shell change: `just shell-lab`.

- Scene data (people, rooms, transcript, exchange): `desktop/src/testing/labScene.ts` — edit freely.
- Boot machinery (storage seed, mock bridge, mount): `desktop/src/testing/labEntry.tsx`.
- Build: `desktop/scripts/build-shell-lab.mjs` + `shell-lab.template.html`.

Known noise: six console 404s for `/pow/*` poof-animation assets, which live in
`public/` and cannot be inlined. Harmless.

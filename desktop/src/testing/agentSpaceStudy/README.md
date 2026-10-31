# Agent spaces: interactive design study

2026-10-30. Browser-only prototype, **not integrated or approved for shipping**.

## Run

From the canonical `luca-beta14-polish` checkout:

```sh
. ./bin/activate-hermit
cd desktop
node scripts/build-shell-lab.mjs --served
```

Serve `desktop/dist/_shell-lab` on loopback. Current preview:

<http://127.0.0.1:8896/scripts/shell-lab.template.html?experience=agent-space>

This extends the current `ShellStudy` instead of importing an older shell.
It uses the existing app theme and real fingerprint component behind the
shell lab's mock bridge. The `--served` option keeps the fingerprint's worker
as a local asset; the default single-file export contract is unchanged.
No native build, live provider, app data, or permissions are involved.
The browser's glass frame is an approximation, not native material proof.

## What to explore

- Overview: current thread, question awaiting the user, links to authoritative controls.
- Companion: direct source review, distinct observation/background controls, note keeping.
- Notebook: filters, search, reading/editing, a new note, unsaved-edit protection.
- Identity: user instructions distinguished from agent-authored documents; readable editors.
- Settings: focused pages for runtime/model, access/tools, working location and advanced details.

Design lab opens the width/density controls and three coherent presets.
Try Established companion, Just arrived, and Needs attention states.
Save named variations; Reset preserves them. Copy the live brief or Export
the settings as JSON. Saved choices belong to this browser and origin.

Only design settings and named variations persist. Simulated edits, toggles,
and documents reset on reload. Native pickers and live catalogs are explicitly
described rather than executed. The model choices are placeholders, not a new
frontend catalog. Real integration must reuse existing runtime/consent authority.

## Verification

- TypeScript no-emit check and served Vite build passed.
- Scoped Biome error-level checks and git diff whitespace check passed.
- Browser: all five sections rendered and inspected; independent observation
  pause, source drill-in, note filtering, identity edit/save and leave-edit
  confirmation exercised. Settings model editor inspected.
- Narrow desktop viewport: pane/content/tabs had no horizontal overflow.
- Presets changed width/density; named variations survived reload; restore and
  reset preserved the saved collection. Clipboard brief and JSON download verified.
- First-use and source-unavailable scenarios exercised.
- No browser error logs were observed during these paths.
- State checks cover width bounds, defaults, malformed saved-data recovery,
  and generated brief values. No full native acceptance or live permission tests
  were run: this is intentionally a safe design study.

Next: Riley reviews the organization and feel before any product integration.

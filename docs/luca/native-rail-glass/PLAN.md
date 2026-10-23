# The rail in Apple's real glass: a test build

Plan, 2026-10-23. Nothing is built yet. Riley: "Plan how to bring this real-glass rail into Polyphonic as a native test
build on its own test profile. Don't build it yet."

## The idea

The conversation card is a slab of Apple's glass, and the rail's selection is a piece of it. Choosing a row, the card's
edge wells at that row and pours a piece of itself along it on a neck that pinches; the old selection melts back into
the card. It was prototyped and filmed in the Liquid Glass Workbench (creative-mind
`skills/liquid-glass/workbench/Sources/RailStudy.swift`, its spec in the file's header; in use:
`skills/liquid-glass/plates/rail-pour-in-use-2026-10-23.jpg`).

## How it fits together

A browser can't draw Apple's glass, but Polyphonic's window can hold native views beside its page. It already does:
`commands/window_vibrancy.rs` puts an `NSVisualEffectView` behind the web page, showing wherever the CSS is
transparent. The glass goes in the same place:

```
window content view
├─ native floor        the theme's floor colour (black)
├─ native glass stage  LiquidStageView: the card's glass and the selection's glass in one container, the house springs
└─ web page            WKWebView, transparent where the glass shows; every word stays here, above the glass
```

- **Words stay above the glass.** Under a thin capsule of Apple's glass they smear into streaks (workbench, 2026-10-23),
  and Apple keeps its labels above its glass too. This is also the only arrangement where the words stay crisp.
- **The page says where; the native side says how.** The page reports the card's place and corner radius, the chosen
  row's place and the rail's visible area. The native side moves the glass on its own clock (springs stepped 240 times
  a second) with the study's choreography.
- **What the glass can see.** Only the native floor behind the page, never the page's own content. On the black floor
  that is what the workbench showed in use: the lit rim, the necks, the pinch. An experiment for the test build: a fine
  grain on the native floor, so the glass has something to bend at its edges.
- **The mouse and keyboard** still go only to the page, which covers the whole window. Nothing native takes input.

## What changes, where

**Native glass (Swift, new), `desktop/src-tauri/native/glass/`**
- Copies of the skill's engines (`LiquidStage`, `LiquidSpring`, `LiquidOutline`, `LiquidMaterial`, `LiquidLight`), marked
  `@available(macOS 26, *)`: the app runs from macOS 14, Apple's glass from 26.
- `RailGlass.swift`: the floor, the card's glass, and RailStudy's choreography (Pour, Drop, Slide; melting home;
  interruptions), plus the rail's edges: a chosen row scrolling out of view squeezes its glass against the edge and
  pinches it away (the skill's "room's edges"). Glass can't be clipped or faded, so the edge is a change of shape.
- A C entry point for Rust: `pg_attach(nsWindow, wkWebView)`, `pg_update(json)`, `pg_detach()`.
- Compiled by `build.rs` with `xcrun swiftc -emit-library -static` and linked into the app, macOS only. Today
  `build.rs` compiles its Swift helpers as separate programs; linking Swift into the app itself is new here, so it is the
  first thing to prove.

**The bridge (Rust)**
- `commands/native_glass.rs`: `native_glass_status` (is it on) and `native_glass_update` (forwards the page's report to
  Swift on the main thread).
- `lib.rs`: attach once the main window exists, only when the test build's own environment carries
  `LUCA_NATIVE_RAIL_GLASS=1` and the system is macOS 26 or later. Shipped builds never set it, so nothing native is
  added to them.

**The page (React, CSS)**
- `features/sidebar/ui/RailGlass.tsx`: with native glass on, it reports instead of drawing: the chosen row's place on
  every choice, resize and scroll (batched to animation frames), and when the selection leaves the rail.
- A `data-luca-native-glass` mark on the root: the page's floor and the card's fill go transparent, the web pill and the
  card's grain step aside, and the card's top and bottom veils (painted in the card's colour today) become soft fades of
  the scrolling content. An opaque veil would be a grey patch over the glass.
- `features/settings/ui/ExperimentalFeaturesCard.tsx`, shown only in the test build: Material (Clear, Smoked, Dark),
  Motion (Pour, Drop, Slide), Floor (plain, grain).

**The test build: its own app and its own profile**
The repository's guarded candidate script, `scripts/build-companion-delegation-candidate.sh`, gains a fourth kind,
`rail-glass`, with `desktop/src-tauri/tauri.rail-glass-candidate.conf.json`:
- "Polyphonic Rail Glass Candidate", `chat.polyphonic.desktop.rail-glass.dev`, its own URL scheme
  (`polyphonic-rail-glass`), no updater endpoints or updater artifacts, a debug app bundle only, never notarized.
- Its own profile under its own instance folder: app data (`BUZZ_DESKTOP_DATA_DIR`), native state
  (`LUCA_NATIVE_STATE_ISOLATION_ROOT`), a scoped keychain service, and the local relay on this Mac. The bundle's
  environment adds `LUCA_NATIVE_RAIL_GLASS=1` (the script's plist check grows by that one key for this kind only).
- Built only from a clean, committed branch descended from shipped beta.13. `build` never launches; `run` starts only
  its own copy and records it; `stop` stops only that copy.

## Steps

1. **Branch.** `claude/native-rail-glass` in its own worktree, cut from `claude/beta14-polish` (it needs the rail work
   there, and it descends from shipped beta.13 at `f84aaafa5338`, which the candidate checks require). Commits stay local:
   the repository is public.
2. **Prove the two risky things first.**
   - Swift linked into the app: one bare glass panel behind the transparent page, in a dev build. Proof: a photograph of
     real glass behind the page, and the page still answering clicks.
   - Lag: how far the glass trails the page while the rail scrolls and while the window resizes, logged on both sides
     with timestamps. Aim: within one frame. If it's worse, the card's glass follows window resizes natively (pinned to
     the window's edges, so only a rail-width change needs reporting) and only scrolling is reported per frame.
3. **Build** the native layer, the bridge and the page changes, against RailStudy's spec.
4. **Check** with the repo's own gates for what changed: types, lint and unit tests; `cargo clippy` for the desktop crate
   (it sits outside the root workspace); the skill's engine checks; Reduce Motion, Reduce Transparency and Increase
   Contrast; and the web pill still working wherever native glass is off.
5. **Build the candidate.** Not launched.
6. **Show it, with Riley's go-ahead.** `run` opens it in front. In the fresh test profile: meet Luca, start two or three
   conversations so the rail has rows, then film the pour in the real app. Riley judges in front.

## Decisions for Riley before building

1. **Build storage.** The internal SSD has 22 GB free. A separate build folder for the candidate probably needs 10 to
   16 GB (Living Ink's is 16 GB). Either reuse the warm build cache (`~/Library/Caches/luca-build/cargo-target`, 9 GB),
   as the Companion Initiative candidate already does, or first archive the finished Living Ink build folder to the
   LaCie's cold archive. Recommended: reuse the warm cache. It is far faster, needs little new space, and the app's
   name, profile, keychain scope and running copy all stay separate.
2. **Signing.** By default the candidate script signs with the Developer ID certificate already on this Mac (it only
   reads it). The rebuilt app should then keep its own keychain items without macOS asking. The alternative is a
   local-only signature, which touches nothing of signing, but macOS may ask for keychain access after each rebuild.
   Recommended: the Developer ID default. Nothing is notarized, uploaded or published either way.

## Out of scope for this test

- Light mode, the glass themes (Obsidian, Crystalline), pop-out chats and the side chat. The test is the main window on
  the default black floor.
- Systems before macOS 26 keep the web pill.

## Risks

- **Swift inside the app** is new in this repository. If the static library fights the build, the fallbacks are a small
  dynamic library loaded at run time, or the glass views driven from Rust through `objc2` with the motion ported.
- **A frame of lag while scrolling.** Step 2 measures it before anything is built on top of it.
- **Other surfaces painted in the card's colour.** Each one found gets a fade or transparency in glass mode.
- **Apple changes its glass each release.** This is tuned on macOS 27.0.1.

## Never touched

The installed Polyphonic.app, Riley's profile and data, release tags, the update feed, the website, the waitlist and
download links. Nothing is pushed. Signing material is only read, and only if Riley picks the Developer ID.

# Landing capture tools

Real-Chromium captures for the landing prototypes. The in-app Browser pane is not a
valid check for these pages (a hidden pane pauses animation frames); these are.
They use the desktop app's Playwright install via `createRequire`, so they run from
anywhere:

```bash
node design-artifacts/landing/tools/chamber-beats.mjs   # hero, locked, the window — three frames + state
node design-artifacts/landing/tools/chamber-crops.mjs   # 2x hero + crops of the type edge and a mark
node design-artifacts/landing/tools/chamber-mobile.mjs  # 390x844 sanity: count, overflow, errors
node design-artifacts/landing/tools/aperture-beats.mjs ./out   # every beat of aperture.html, gated on scroll
node design-artifacts/landing/tools/aperture-extra.mjs ./out   # phone, reduced motion, focus, chord
```

Software GL (swiftshader) runs the Chamber at ~20–45 fps, so the scripts pass `?n=`
to cap the count and wait several seconds for the fluid to develop before capturing.
Frames land next to the script (or in the `./out` dir where a script takes one).
Dials for the Chamber are live on `window.__tune`; `?debug` shows state and fps.

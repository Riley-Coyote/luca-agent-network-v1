# Luca bundle icons

The app icon (`icon.png` 1024, `icon.icns`, `icon.ico`, the PNG sizes and
`icon.iconset`) is the onboarding door's own dendrite: the `recall` phosphor
field rendered by `DotSigil` at cell 8 instead of 4, one frame of its cycle
captured from the e2e build, composed on a pure-black superellipse (824 of
1024, n = 5) with Luca's identity glyph rendered from its vector path at 208 px, centred. Regenerate
the set from a new 1024 PNG with `pnpm exec tauri icon <png> -o src-tauri/icons`.
`icon.svg` is the previous lattice mark and is no longer used.

`dmg-background.png` is the flat, dark installer background for the Luca
Tauri bundle and uses the supplied Luca mark.

`buzz-source.png` is a legacy upstream source artifact. It is not referenced
by the Tauri bundle icon list or the DMG background configuration, and remains
only for upstream-history compatibility.

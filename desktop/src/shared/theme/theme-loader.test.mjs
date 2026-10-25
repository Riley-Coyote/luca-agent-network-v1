import assert from "node:assert/strict";
import test from "node:test";

import {
  BUZZ_DARK_THEME_NAME,
  BUZZ_THEME_NAME,
  CRYSTALLINE_THEME_NAME,
  DEFAULT_THEME_NAME,
  GLASS_THEME_MOVE_KEY,
  GLASS_THEME_SUCCESSORS,
  OBSIDIAN_THEME_NAME,
  GRAPHITE_BASE_THEME,
  GRAPHITE_THEME_NAME,
  LIGHT_THEMES,
  PAPER_THEME_NAME,
  SYNTAX_THEMES,
  getThemePair,
  isLightTheme,
  loadThemeData,
  resolveShikiThemeName,
  settleGlassThemeMove,
  THEME_CACHE_KEY,
  THEME_STORAGE_KEY,
} from "./theme-loader.ts";

test("Graphite is registered as a standalone dark app theme", () => {
  assert.equal(
    SYNTAX_THEMES.filter((name) => name === GRAPHITE_THEME_NAME).length,
    1,
  );
  assert.equal(isLightTheme(GRAPHITE_THEME_NAME), false);
  assert.equal(getThemePair(GRAPHITE_THEME_NAME), null);
});

test("Graphite resolves to its bundled syntax-highlighting baseline", async () => {
  assert.equal(resolveShikiThemeName(GRAPHITE_THEME_NAME), GRAPHITE_BASE_THEME);

  const theme = await loadThemeData(GRAPHITE_THEME_NAME);
  assert.equal(theme.type, "dark");
  assert.equal(typeof theme.colors?.["editor.background"], "string");
});

/**
 * Paper is the light half of the first-party shell. These assertions cover the
 * wiring the Appearance picker depends on but that no unit test could see:
 * before Paper existed, choosing "Light" offered nothing but syntax themes,
 * and the `buzz` ↔ `buzz-dark` pair meant System mode never actually went
 * light for the first-party palette.
 */
test("Paper is registered as the first-party light app theme", () => {
  assert.ok(SYNTAX_THEMES.includes(PAPER_THEME_NAME));
  assert.ok(
    LIGHT_THEMES.has(PAPER_THEME_NAME),
    "Paper must be in LIGHT_THEMES or the Light tab never lists it",
  );
});

test("Paper and Void are each other's counterpart, so System mode switches", () => {
  assert.equal(getThemePair(PAPER_THEME_NAME), BUZZ_THEME_NAME);
  assert.equal(getThemePair(BUZZ_THEME_NAME), PAPER_THEME_NAME);
});

test("Crystalline is the light glass and Obsidian's System partner", () => {
  assert.ok(SYNTAX_THEMES.includes(CRYSTALLINE_THEME_NAME));
  assert.ok(SYNTAX_THEMES.includes(OBSIDIAN_THEME_NAME));
  assert.ok(
    LIGHT_THEMES.has(CRYSTALLINE_THEME_NAME),
    "Crystalline must be in LIGHT_THEMES or the Light tab never lists it",
  );
  assert.ok(!LIGHT_THEMES.has(OBSIDIAN_THEME_NAME));
  assert.equal(getThemePair(CRYSTALLINE_THEME_NAME), OBSIDIAN_THEME_NAME);
  assert.equal(getThemePair(OBSIDIAN_THEME_NAME), CRYSTALLINE_THEME_NAME);
});

test("Crystalline resolves to a light syntax baseline for code blocks", () => {
  const resolved = resolveShikiThemeName(CRYSTALLINE_THEME_NAME);
  assert.notEqual(resolved, CRYSTALLINE_THEME_NAME);
  assert.ok(LIGHT_THEMES.has(resolved), `${resolved} should be a light theme`);
});

test("buzz-dark stays the always-dark choice rather than flipping to Paper", () => {
  // The standalone Void tile in System mode selects this key. If it paired to
  // a light palette there would be no way to say "dark, regardless of the OS".
  const pair = getThemePair(BUZZ_DARK_THEME_NAME);
  assert.ok(pair && !LIGHT_THEMES.has(pair));
});

test("Paper resolves to a light syntax baseline for code blocks", () => {
  // Shiki has no theme by this name; handing it the raw key makes it throw and
  // code blocks silently fall back to unhighlighted text.
  const resolved = resolveShikiThemeName(PAPER_THEME_NAME);
  assert.notEqual(resolved, PAPER_THEME_NAME);
  assert.ok(LIGHT_THEMES.has(resolved), `${resolved} should be a light theme`);
});

// ── WP-08d: the glass themes retire under the shell's frame ──────────────

const FRAME_KEY = "polyphonic-frame";

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test("frame on: Obsidian moves to Vitesse Black with the Glass frame, once", () => {
  const storage = memoryStorage({
    [THEME_STORAGE_KEY]: OBSIDIAN_THEME_NAME,
    [THEME_CACHE_KEY]: JSON.stringify({ themeName: OBSIDIAN_THEME_NAME }),
    "buzz-follow-system": "false",
    "buzz-accent-color": "#60a5fa",
  });
  assert.equal(
    settleGlassThemeMove(true, storage, FRAME_KEY),
    DEFAULT_THEME_NAME,
  );
  assert.equal(storage.getItem(THEME_STORAGE_KEY), "vitesse-black");
  assert.equal(storage.getItem(FRAME_KEY), "glass");
  assert.equal(storage.getItem(THEME_CACHE_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem(GLASS_THEME_MOVE_KEY)), {
    from: OBSIDIAN_THEME_NAME,
    to: DEFAULT_THEME_NAME,
    frame: null,
  });
  // The mode and the accent stay as chosen.
  assert.equal(storage.getItem("buzz-follow-system"), "false");
  assert.equal(storage.getItem("buzz-accent-color"), "#60a5fa");
  // Once: a second pass, and a later choice, are left alone.
  assert.equal(settleGlassThemeMove(true, storage, FRAME_KEY), null);
  storage.setItem(THEME_STORAGE_KEY, GRAPHITE_THEME_NAME);
  storage.setItem(FRAME_KEY, "solid");
  assert.equal(settleGlassThemeMove(true, storage, FRAME_KEY), null);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), GRAPHITE_THEME_NAME);
  assert.equal(storage.getItem(FRAME_KEY), "solid");
});

test("frame on: Crystalline moves to Paper with the Glass frame", () => {
  const storage = memoryStorage({
    [THEME_STORAGE_KEY]: CRYSTALLINE_THEME_NAME,
    [FRAME_KEY]: "solid",
  });
  assert.equal(
    settleGlassThemeMove(true, storage, FRAME_KEY),
    PAPER_THEME_NAME,
  );
  assert.equal(storage.getItem(THEME_STORAGE_KEY), PAPER_THEME_NAME);
  assert.equal(storage.getItem(FRAME_KEY), "glass");
  assert.equal(
    JSON.parse(storage.getItem(GLASS_THEME_MOVE_KEY)).frame,
    "solid",
  );
});

test("frame off: the glass theme and the old frame setting come back", () => {
  const storage = memoryStorage({
    [THEME_STORAGE_KEY]: CRYSTALLINE_THEME_NAME,
  });
  settleGlassThemeMove(true, storage, FRAME_KEY);
  assert.equal(
    settleGlassThemeMove(false, storage, FRAME_KEY),
    CRYSTALLINE_THEME_NAME,
  );
  assert.equal(storage.getItem(THEME_STORAGE_KEY), CRYSTALLINE_THEME_NAME);
  assert.equal(storage.getItem(FRAME_KEY), null);
  assert.equal(storage.getItem(GLASS_THEME_MOVE_KEY), null);
  // On again: they move again.
  assert.equal(
    settleGlassThemeMove(true, storage, FRAME_KEY),
    PAPER_THEME_NAME,
  );
});

test("frame off: a palette or frame chosen since the move is kept", () => {
  const storage = memoryStorage({ [THEME_STORAGE_KEY]: OBSIDIAN_THEME_NAME });
  settleGlassThemeMove(true, storage, FRAME_KEY);
  storage.setItem(THEME_STORAGE_KEY, GRAPHITE_THEME_NAME);
  storage.setItem(FRAME_KEY, "solid");
  assert.equal(settleGlassThemeMove(false, storage, FRAME_KEY), null);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), GRAPHITE_THEME_NAME);
  assert.equal(storage.getItem(FRAME_KEY), "solid");
  assert.equal(storage.getItem(GLASS_THEME_MOVE_KEY), null);
});

test("frame off, nothing recorded: nothing is written", () => {
  const storage = memoryStorage({ [THEME_STORAGE_KEY]: OBSIDIAN_THEME_NAME });
  const before = new Map(storage.map);
  assert.equal(settleGlassThemeMove(false, storage, FRAME_KEY), null);
  assert.deepEqual(storage.map, before);
  // Other palettes never move under the frame either.
  const other = memoryStorage({ [THEME_STORAGE_KEY]: PAPER_THEME_NAME });
  assert.equal(settleGlassThemeMove(true, other, FRAME_KEY), null);
  assert.equal(other.getItem(FRAME_KEY), null);
});

test("the successors are the dark default and Paper", () => {
  assert.equal(GLASS_THEME_SUCCESSORS[OBSIDIAN_THEME_NAME], "vitesse-black");
  assert.equal(GLASS_THEME_SUCCESSORS[CRYSTALLINE_THEME_NAME], "paper");
});

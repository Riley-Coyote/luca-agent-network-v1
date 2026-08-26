import assert from "node:assert/strict";
import test from "node:test";

import {
  BUZZ_DARK_THEME_NAME,
  BUZZ_THEME_NAME,
  CRYSTALLINE_THEME_NAME,
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

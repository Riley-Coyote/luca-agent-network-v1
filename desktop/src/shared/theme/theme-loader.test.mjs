import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPHITE_BASE_THEME,
  GRAPHITE_THEME_NAME,
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  createGraphiteThemeVars,
  createLucaThemeVars,
  createThemeVars,
  GRAPHITE_THEME_COLORS,
  hexToHsl,
  luminance,
} from "./adaptive-theme.ts";

test("the first-party Luca palette remains stylesheet-owned", () => {
  const { isDark, vars } = createLucaThemeVars();

  assert.equal(isDark, true);
  assert.equal(vars["--mn-floor"], undefined);
  assert.equal(vars["--mn-surface"], undefined);
});

test("a user-selected dark palette supplies the permanent Luca shell ladder", () => {
  const { isDark, vars } = createThemeVars("#0d1117", "#f0f6fc", "#8b949e");

  assert.equal(isDark, true);
  for (const key of [
    "--mn-floor",
    "--mn-surface",
    "--mn-raised",
    "--mn-hover",
    "--mn-border",
    "--mn-ink",
    "--mn-ink-muted",
  ]) {
    assert.equal(typeof vars[key], "string", `${key} was not projected`);
  }
  assert.notEqual(vars["--mn-floor"], vars["--mn-surface"]);
});

test("a user-selected light palette keeps the same shell contract", () => {
  const { isDark, vars } = createThemeVars("#ffffff", "#24292f", "#57606a");

  assert.equal(isDark, false);
  assert.equal(typeof vars["--mn-floor"], "string");
  assert.equal(typeof vars["--mn-surface"], "string");
  assert.equal(typeof vars["--mn-glass"], "string");
});

test("Graphite projects the approved charcoal study onto the Luca shell", () => {
  const { isDark, vars } = createGraphiteThemeVars();

  assert.equal(isDark, true);
  for (const [token, color] of [
    ["--mn-floor", GRAPHITE_THEME_COLORS.floor],
    ["--mn-navigator", GRAPHITE_THEME_COLORS.navigator],
    ["--mn-surface", GRAPHITE_THEME_COLORS.surface],
    ["--mn-raised", GRAPHITE_THEME_COLORS.raised],
    ["--mn-hover", GRAPHITE_THEME_COLORS.hover],
    ["--mn-glass", GRAPHITE_THEME_COLORS.glass],
    ["--mn-border", GRAPHITE_THEME_COLORS.border],
    ["--mn-border-strong", GRAPHITE_THEME_COLORS.borderStrong],
    ["--mn-ink", GRAPHITE_THEME_COLORS.ink],
    ["--mn-ink-muted", GRAPHITE_THEME_COLORS.inkMuted],
    ["--mn-ink-faint", GRAPHITE_THEME_COLORS.inkFaint],
    ["--mn-focus", GRAPHITE_THEME_COLORS.focus],
  ]) {
    assert.equal(vars[token], hexToHsl(color), `${token} drifted`);
  }
});

test("Graphite preserves semantic colors and accessible secondary copy", () => {
  const graphite = createGraphiteThemeVars().vars;
  const luca = createLucaThemeVars().vars;

  for (const token of [
    "--destructive",
    "--status-added",
    "--status-deleted",
    "--status-modified",
    "--ui-warning",
  ]) {
    assert.equal(graphite[token], luca[token], `${token} was recolored`);
  }

  const surface = luminance(GRAPHITE_THEME_COLORS.raised);
  const muted = luminance(GRAPHITE_THEME_COLORS.inkMuted);
  const contrast =
    (Math.max(surface, muted) + 0.05) / (Math.min(surface, muted) + 0.05);
  assert.ok(contrast >= 4.5, `secondary copy contrast was ${contrast}`);
});

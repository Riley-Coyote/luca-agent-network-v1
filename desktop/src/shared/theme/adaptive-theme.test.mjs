import assert from "node:assert/strict";
import test from "node:test";

import { createLucaThemeVars, createThemeVars } from "./adaptive-theme.ts";

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

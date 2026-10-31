import assert from "node:assert/strict";
import test from "node:test";

import {
  configGroupOf,
  configRowMatches,
  configRowOf,
  groupConfigRows,
} from "./mindConfigGroups.ts";

test("WP-43: a harness's settings fall into five groups", () => {
  assert.equal(configGroupOf("model"), "model");
  assert.equal(configGroupOf("alwaysThinkingEnabled"), "model");
  assert.equal(configGroupOf("effortLevel"), "model");
  assert.equal(
    configGroupOf("modelSettings.claude-opus-5-5.autoCompactWindow"),
    "model",
  );
  assert.equal(
    configGroupOf("enabledPlugins.playwright@claude-plugins-official"),
    "plugins",
  );
  assert.equal(
    configGroupOf("extraKnownMarketplaces.claude-plugins-official.source"),
    "sources",
  );
  assert.equal(configGroupOf("theme"), "look");
  assert.equal(configGroupOf("statusLine.command"), "look");
  assert.equal(configGroupOf("outputStyle"), "look");
  assert.equal(configGroupOf("permissions.allow"), "everything");
  assert.equal(configGroupOf("cleanupPeriodDays"), "everything");
});

test("WP-43: a plugin row is its own name, on or off", () => {
  assert.deepEqual(
    configRowOf("enabledPlugins.playwright@claude-plugins-official", "true"),
    {
      key: "enabledPlugins.playwright@claude-plugins-official",
      label: "playwright@claude-plugins-official",
      value: "On",
    },
  );
  assert.equal(configRowOf("enabledPlugins.x", "false").value, "Off");
  assert.deepEqual(configRowOf("theme", "dark"), {
    key: "theme",
    label: "theme",
    value: "dark",
  });
});

test("WP-43: search reads the key, the name and the value", () => {
  const row = configRowOf("enabledPlugins.plugin-dev@official", "true");
  assert.equal(configRowMatches(row, "PLUGIN"), true);
  assert.equal(configRowMatches(row, "on"), true);
  assert.equal(configRowMatches(row, "zzz"), false);
  assert.equal(configRowMatches(row, "  "), true);
});

test("WP-43: groups keep their order and drop when empty", () => {
  const rows = [
    configRowOf("cleanupPeriodDays", "36500"),
    configRowOf("enabledPlugins.a@b", "true"),
    configRowOf("model", "opus"),
    configRowOf("theme", "dark"),
  ];
  assert.deepEqual(
    groupConfigRows(rows).map((group) => [group.title, group.rows.length]),
    [
      ["Model and thinking", 1],
      ["Plugins", 1],
      ["Look and feel", 1],
      ["Everything else", 1],
    ],
  );
  assert.deepEqual(
    groupConfigRows(rows, "plugin").map((group) => group.id),
    ["plugins"],
  );
});

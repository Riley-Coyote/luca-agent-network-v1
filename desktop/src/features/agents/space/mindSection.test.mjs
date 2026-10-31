import assert from "node:assert/strict";
import test from "node:test";

import {
  MIND_PANES,
  mindBackLabel,
  mindPageDepth,
  mindPageOfLegacy,
  mindPageParent,
  mindPageWord,
  mindSettingsAtOfTab,
  parseMindPage,
  parseMindSettingsAt,
} from "./mindSection.ts";

test("the address's at names one of a mind's Settings rows, or none", () => {
  assert.equal(parseMindSettingsAt("read"), "read");
  assert.equal(parseMindSettingsAt("runtime"), "runtime");
  assert.equal(parseMindSettingsAt("permissions"), "permissions");
  assert.equal(parseMindSettingsAt("capabilities"), undefined);
  assert.equal(parseMindSettingsAt(""), undefined);
  assert.equal(parseMindSettingsAt(undefined), undefined);
  assert.equal(parseMindSettingsAt(3), undefined);
});

test("Settings > Agents' old tabs land on the row that holds them", () => {
  assert.equal(mindSettingsAtOfTab("runtime"), "runtime");
  assert.equal(mindSettingsAtOfTab("capabilities"), "permissions");
  assert.equal(mindSettingsAtOfTab("advanced"), undefined);
  assert.equal(mindSettingsAtOfTab("general"), undefined);
  assert.equal(mindSettingsAtOfTab(null), undefined);
});

test("WP-43: every page survives the address, both ways", () => {
  const pages = [
    { kind: "place" },
    { kind: "place", notebook: "pages" },
    { kind: "place", notebook: "open" },
    { kind: "settings" },
    ...MIND_PANES.map((pane) => ({ kind: "pane", pane })),
    { kind: "file", relPath: "notes/todo.md" },
    { kind: "made" },
    { kind: "piece", artifactId: "luca-tide", from: "made" },
    { kind: "piece", artifactId: "luca-tide", from: "place" },
    { kind: "reading", doc: "selfModel" },
  ];
  for (const page of pages)
    assert.deepEqual(parseMindPage(mindPageWord(page)), page);
  assert.equal(mindPageWord({ kind: "place" }), null);
});

test("WP-43: a word the page can't name is their page", () => {
  assert.deepEqual(parseMindPage("settings/nope"), { kind: "settings" });
  assert.deepEqual(parseMindPage("page/soul"), { kind: "place" });
  assert.deepEqual(parseMindPage("elsewhere"), { kind: "place" });
  assert.deepEqual(parseMindPage(7), { kind: "place" });
});

test("WP-43: a page's back link names where you came from", () => {
  const name = "Luca";
  assert.equal(mindBackLabel({ kind: "settings" }, name), "Luca");
  assert.equal(
    mindBackLabel({ kind: "pane", pane: "permissions" }, name),
    "Settings",
  );
  assert.equal(
    mindBackLabel({ kind: "piece", artifactId: "x", from: "made" }, name),
    "Made",
  );
  assert.equal(
    mindBackLabel({ kind: "piece", artifactId: "x", from: "place" }, name),
    "Luca",
  );
  assert.equal(mindBackLabel({ kind: "file", relPath: "a.md" }, name), "Files");
  assert.equal(mindBackLabel({ kind: "place" }, name), null);
  assert.deepEqual(mindPageParent({ kind: "file", relPath: "a.md" }), {
    kind: "pane",
    pane: "files",
  });
  assert.equal(mindPageDepth({ kind: "file", relPath: "a.md" }), 3);
  assert.equal(mindPageDepth({ kind: "pane", pane: "soul" }), 2);
  assert.equal(mindPageDepth({ kind: "place" }), 0);
});

test("WP-43: every old way in lands on its new home", () => {
  assert.deepEqual(mindPageOfLegacy({ at: "read" }), {
    kind: "pane",
    pane: "read",
  });
  assert.deepEqual(mindPageOfLegacy({ at: "runtime" }), {
    kind: "pane",
    pane: "harness",
  });
  assert.deepEqual(
    mindPageOfLegacy({ at: "permissions", section: "settings" }),
    {
      kind: "pane",
      pane: "permissions",
    },
  );
  assert.deepEqual(mindPageOfLegacy({ profileTab: "capabilities" }), {
    kind: "pane",
    pane: "permissions",
  });
  assert.deepEqual(mindPageOfLegacy({ profileTab: "runtime" }), {
    kind: "pane",
    pane: "harness",
  });
  assert.deepEqual(mindPageOfLegacy({ section: "settings" }), {
    kind: "settings",
  });
  // Self and Documents held what you write: Settings, at Who {name} is.
  for (const section of ["self", "documents"])
    assert.deepEqual(mindPageOfLegacy({ section }), { kind: "settings" });
  for (const section of ["overview", "place"])
    assert.deepEqual(mindPageOfLegacy({ section }), { kind: "place" });
  assert.deepEqual(mindPageOfLegacy({ section: "notebook" }), {
    kind: "place",
    notebook: "open",
  });
  assert.deepEqual(mindPageOfLegacy({ profileTab: "memories" }), {
    kind: "place",
  });
  assert.equal(mindPageOfLegacy({}), null);
});

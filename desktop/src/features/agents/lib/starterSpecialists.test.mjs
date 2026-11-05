import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { starterSpecialist } from "./starterSpecialists.ts";

const catalog = JSON.parse(
  readFileSync(
    new URL("../../../shared/content/starterSpecialists.json", import.meta.url),
    "utf8",
  ),
);

test("seven starters expose distinct roles and useful copy-only examples", () => {
  assert.equal(catalog.length, 7);
  assert.equal(new Set(catalog.map((entry) => entry.id)).size, 7);
  assert.equal(new Set(catalog.map((entry) => entry.role)).size, 7);
  for (const entry of catalog) {
    assert.equal(
      starterSpecialist({
        id: entry.id,
        displayName: entry.name,
        isBuiltIn: true,
      })?.role,
      entry.role,
    );
    assert.ok(entry.summary.length < 160);
    assert.ok(entry.method.length > 650);
    assert.ok(entry.examples.length >= 2);
    assert.ok(
      entry.examples.every(
        (example) => example.title && example.prompt.length > 80,
      ),
    );
    assert.equal(
      starterSpecialist({
        id: entry.id,
        displayName: "My own agent",
        isBuiltIn: true,
      }),
      undefined,
    );
    assert.equal(
      starterSpecialist({
        id: entry.id,
        displayName: entry.name,
        isBuiltIn: false,
      }),
      undefined,
    );
  }
});

test("Luca's examples demonstrate teams without silently starting them", () => {
  const luca = catalog.find((entry) => entry.id === "builtin:fizz");
  assert.equal(luca.examples.length, 3);
  assert.match(luca.method, /catalog templates, not installed residents/);
  assert.match(luca.method, /Do not ask the person to poll/);
  assert.ok(luca.examples.every((example) => /available/.test(example.prompt)));
});

test("new starter names remain owner-editable in the library", async () => {
  const { personaSummary } = await import("../ui/agentLibraryViewModel.ts");
  for (const id of ["builtin:mira", "builtin:coda"]) {
    const summary = personaSummary({
      id,
      displayName: "My specialist",
      isBuiltIn: true,
    });
    assert.equal(summary.displayName, "My specialist");
  }
});

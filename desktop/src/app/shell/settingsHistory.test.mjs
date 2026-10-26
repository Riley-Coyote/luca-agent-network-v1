import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recordEntry, stepsOutOfSettings } from "./settingsHistory.ts";

/** Entries from a list: true for a Settings entry, false for any other. */
const entries = (list) => new Map(list.map((inSettings, i) => [i, inSettings]));

describe("closing Settings steps back past its sections (WP-17)", () => {
  it("leaves from the first section to the place before it", () => {
    assert.equal(stepsOutOfSettings(entries([false, false, true]), 2), -1);
  });

  it("leaves past every section visited, in one go", () => {
    assert.equal(stepsOutOfSettings(entries([false, true, true, true]), 3), -3);
  });

  it("returns to the place just before Settings, not an older one", () => {
    assert.equal(
      stepsOutOfSettings(entries([false, true, false, true, true]), 4),
      -2,
    );
  });

  it("has nowhere to go back to when Settings is where it began", () => {
    assert.equal(stepsOutOfSettings(entries([true, true]), 1), null);
  });

  it("has nowhere to go back to when the entry before was never seen", () => {
    assert.equal(stepsOutOfSettings(new Map([[5, true]]), 5), null);
  });

  it("keeps the most recent entries only", () => {
    const kept = new Map();
    for (let i = 0; i < 450; i += 1) recordEntry(kept, i, i % 2 === 0);
    assert.equal(kept.size, 400);
    assert.equal(kept.has(0), false);
    assert.equal(kept.get(449), false);
  });
});

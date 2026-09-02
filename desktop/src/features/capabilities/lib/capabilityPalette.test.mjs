import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterCapabilityPaletteItems,
  nextCapabilityPaletteIndex,
} from "./capabilityPalette.ts";

const items = [
  { name: "/review", description: "Review the current work" },
  { name: "imagegen", description: "Create an image" },
  { name: "Linear", description: "Granted project connection" },
];

describe("capability palette", () => {
  it("searches bounded names and descriptions without changing order", () => {
    assert.deepEqual(filterCapabilityPaletteItems(items, "project"), [
      items[2],
    ]);
    assert.deepEqual(filterCapabilityPaletteItems(items, "IMAGE"), [items[1]]);
    assert.equal(filterCapabilityPaletteItems(items, "  "), items);
  });

  it("keeps keyboard selection inside enabled rows", () => {
    assert.equal(nextCapabilityPaletteIndex(0, 3, -1), 0);
    assert.equal(nextCapabilityPaletteIndex(0, 3, 1), 1);
    assert.equal(nextCapabilityPaletteIndex(2, 3, 1), 2);
    assert.equal(nextCapabilityPaletteIndex(4, 0, -1), 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  capabilitySkillStatus,
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

  it("does not imply a capability check before a resident is chosen", () => {
    assert.equal(
      capabilitySkillStatus({
        residentSelected: false,
        checking: false,
        ready: false,
      }),
      null,
    );
    assert.equal(
      capabilitySkillStatus({
        residentSelected: true,
        checking: true,
        ready: false,
      }),
      "Checking",
    );
    assert.equal(
      capabilitySkillStatus({
        residentSelected: true,
        checking: false,
        ready: true,
      }),
      "Ready",
    );
    assert.equal(
      capabilitySkillStatus({
        residentSelected: true,
        checking: false,
        ready: false,
      }),
      "Unavailable",
    );
  });
});

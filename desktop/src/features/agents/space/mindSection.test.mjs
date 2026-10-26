import assert from "node:assert/strict";
import test from "node:test";

import {
  mindSectionOf,
  mindSettingsAtOfTab,
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

test("the old detail's tabs read onto the rows that hold them now", () => {
  assert.equal(mindSettingsAtOfTab("runtime"), "runtime");
  assert.equal(mindSettingsAtOfTab("capabilities"), "permissions");
  assert.equal(mindSettingsAtOfTab("advanced"), undefined);
  assert.equal(mindSettingsAtOfTab("general"), undefined);
  assert.equal(mindSettingsAtOfTab(null), undefined);
});

test("the tabs still read as before", () => {
  assert.equal(mindSectionOf("settings"), "settings");
  assert.equal(mindSectionOf("documents"), "self");
  assert.equal(mindSectionOf(null), "notebook");
});

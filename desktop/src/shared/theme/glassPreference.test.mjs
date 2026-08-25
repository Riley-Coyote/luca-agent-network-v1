import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultMaterialFor,
  getGlassMaterial,
  setGlassMaterial,
} from "./glassPreference.ts";

test("glass themes resolve their own authored material defaults", () => {
  assert.equal(defaultMaterialFor("smoke", true), "neutral");
  assert.equal(defaultMaterialFor("dragon-glass", true), "dark");
  assert.equal(defaultMaterialFor("onyx", true), "dark");
  assert.equal(defaultMaterialFor("paper", false), "light");
});

test("an explicit material choice belongs only to the chosen theme", () => {
  setGlassMaterial("smoke", "dark");
  setGlassMaterial("dragon-glass", "neutral");

  assert.equal(getGlassMaterial("smoke", true), "dark");
  assert.equal(getGlassMaterial("dragon-glass", true), "neutral");
  assert.equal(getGlassMaterial("onyx", true), "dark");
  assert.equal(getGlassMaterial("paper", false), "light");
});

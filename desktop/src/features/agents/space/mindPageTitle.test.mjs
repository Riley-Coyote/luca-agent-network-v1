import assert from "node:assert/strict";
import test from "node:test";

import {
  mindPageTitle,
  resetMindPageTitle,
  setMindPageTitle,
  subscribeMindPageTitle,
} from "./mindPageTitle.ts";

test("WP-43: the pushed page's title is kept per mind, and reset", () => {
  resetMindPageTitle();
  let heard = 0;
  const stop = subscribeMindPageTitle(() => {
    heard += 1;
  });
  setMindPageTitle({ pubkey: "AA", title: "Settings" });
  assert.deepEqual(mindPageTitle(), { pubkey: "aa", title: "Settings" });
  // The same title again says nothing new.
  setMindPageTitle({ pubkey: "aa", title: "Settings" });
  assert.equal(heard, 1);
  setMindPageTitle(null);
  assert.equal(mindPageTitle(), null);
  setMindPageTitle({ pubkey: "aa", title: "Soul" });
  resetMindPageTitle();
  assert.equal(mindPageTitle(), null);
  stop();
  assert.equal(heard, 4);
});

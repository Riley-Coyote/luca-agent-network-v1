import assert from "node:assert/strict";
import test from "node:test";

import {
  isNewSince,
  lastVisitOf,
  mindVisitsVersion,
  recordVisit,
  resetMindVisits,
  subscribeMindVisits,
} from "./mindVisits.ts";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

test("WP-42: a visit is kept per agent, under the community", () => {
  resetMindVisits();
  const store = memoryStorage();
  assert.equal(lastVisitOf("one", "AA", store), null);
  recordVisit("one", "AA", 1000, store);
  assert.equal(lastVisitOf("one", "aa", store), 1000);
  assert.equal(lastVisitOf("two", "aa", store), null);
  assert.deepEqual(JSON.parse(store.map.get("luca-mind-visits-v1:one")), {
    aa: 1000,
  });
});

test("WP-42: the community switch clears the module's memory, not the record", () => {
  resetMindVisits();
  const store = memoryStorage();
  recordVisit("one", "aa", 5, store);
  const before = mindVisitsVersion();
  let heard = 0;
  const stop = subscribeMindVisits(() => {
    heard += 1;
  });
  resetMindVisits();
  stop();
  assert.equal(heard, 1);
  assert.ok(mindVisitsVersion() > before);
  // Read again from the community's own key.
  assert.equal(lastVisitOf("one", "aa", store), 5);
});

test("WP-42: a record that can't be read marks nothing new", () => {
  resetMindVisits();
  const store = memoryStorage();
  store.setItem("luca-mind-visits-v1:bad", "{not json");
  assert.equal(lastVisitOf("bad", "aa", store), null);
  store.setItem("luca-mind-visits-v1:odd", JSON.stringify({ aa: "x" }));
  assert.equal(lastVisitOf("odd", "aa", store), null);
});

test("WP-42: new is after the last visit; never visited is never new", () => {
  assert.equal(isNewSince(10, 5), true);
  assert.equal(isNewSince(5, 5), false);
  assert.equal(isNewSince(4, 5), false);
  assert.equal(isNewSince(10, null), false);
  assert.equal(isNewSince(Number.NaN, 5), false);
});

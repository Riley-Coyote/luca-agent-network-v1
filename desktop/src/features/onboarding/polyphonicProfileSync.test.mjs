import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPendingPolyphonicProfile,
  readPendingPolyphonicProfile,
  savePendingPolyphonicProfile,
} from "./polyphonicProfileSync.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("pending profile draft is pubkey scoped and body free", () => {
  const storage = memoryStorage();
  savePendingPolyphonicProfile(
    { version: 1, pubkey: "owner", displayName: "Riley" },
    storage,
  );
  assert.deepEqual(readPendingPolyphonicProfile("owner", storage), {
    version: 1,
    pubkey: "owner",
    displayName: "Riley",
  });
  assert.equal(readPendingPolyphonicProfile("other", storage), null);
  clearPendingPolyphonicProfile("owner", storage);
  assert.equal(readPendingPolyphonicProfile("owner", storage), null);
});

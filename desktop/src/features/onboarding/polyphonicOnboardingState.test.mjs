import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPolyphonicOnboardingSessionSkip,
  createPolyphonicOnboardingTransaction,
  isPolyphonicOnboardingSkippedForSession,
  readPolyphonicOnboardingTransaction,
  savePolyphonicOnboardingTransaction,
  skipPolyphonicOnboardingForSession,
} from "./polyphonicOnboardingState.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("transaction resumes at the last safe chapter without sensitive fields", () => {
  const storage = memoryStorage();
  const started = createPolyphonicOnboardingTransaction("owner-pubkey");
  savePolyphonicOnboardingTransaction(
    { ...started, chapter: "brain", agentsReviewed: true },
    storage,
  );

  const resumed = readPolyphonicOnboardingTransaction("owner-pubkey", storage);
  assert.equal(resumed?.chapter, "brain");
  assert.equal(resumed?.agentsReviewed, true);
  assert.deepEqual(Object.keys(resumed ?? {}).sort(), [
    "agentsReviewed",
    "brainReviewed",
    "chapter",
    "profileSaved",
    "pubkey",
    "updatedAt",
    "version",
  ]);
});

test("invalid, unknown, and cross-owner transactions fail closed", () => {
  const storage = memoryStorage({
    "polyphonic-onboarding-transaction.v1:owner-pubkey": JSON.stringify({
      version: 1,
      pubkey: "different-owner",
      chapter: "ready",
      profileSaved: true,
      agentsReviewed: true,
      brainReviewed: true,
      updatedAt: new Date().toISOString(),
      sourcePath: "/private/source",
    }),
  });
  assert.equal(
    readPolyphonicOnboardingTransaction("owner-pubkey", storage),
    null,
  );
});

test("set up later is session scoped and can be cleared", () => {
  const storage = memoryStorage();
  skipPolyphonicOnboardingForSession("owner-pubkey", storage);
  assert.equal(
    isPolyphonicOnboardingSkippedForSession("owner-pubkey", storage),
    true,
  );
  assert.equal(
    isPolyphonicOnboardingSkippedForSession("other-owner", storage),
    false,
  );
  clearPolyphonicOnboardingSessionSkip("owner-pubkey", storage);
  assert.equal(
    isPolyphonicOnboardingSkippedForSession("owner-pubkey", storage),
    false,
  );
});

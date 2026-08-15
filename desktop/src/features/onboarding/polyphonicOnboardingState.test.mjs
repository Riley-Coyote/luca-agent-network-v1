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
    { ...started, chapter: "agents", runtimeConfirmed: true },
    storage,
  );

  const resumed = readPolyphonicOnboardingTransaction("owner-pubkey", storage);
  assert.equal(resumed?.chapter, "agents");
  assert.equal(resumed?.runtimeConfirmed, true);
  assert.deepEqual(Object.keys(resumed ?? {}).sort(), [
    "agentsReviewed",
    "chapter",
    "profileSaved",
    "pubkey",
    "runtimeConfirmed",
    "updatedAt",
    "version",
  ]);
});

test("version one later chapters migrate back to required runtime confirmation", () => {
  const storage = memoryStorage({
    "polyphonic-onboarding-transaction.v1:owner-pubkey": JSON.stringify({
      version: 1,
      pubkey: "owner-pubkey",
      chapter: "ready",
      profileSaved: true,
      agentsReviewed: true,
      brainReviewed: true,
      updatedAt: "2026-08-09T00:00:00.000Z",
    }),
  });
  const migrated = readPolyphonicOnboardingTransaction("owner-pubkey", storage);
  assert.equal(migrated?.version, 3);
  assert.equal(migrated?.chapter, "runtime");
  assert.equal(migrated?.runtimeConfirmed, false);
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

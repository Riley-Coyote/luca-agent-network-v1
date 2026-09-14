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

const FIELDS = [
  "agentsReviewed",
  "brainReviewed",
  "chapter",
  "profileSaved",
  "pubkey",
  "residentMemory",
  "runtimeConfirmed",
  "updatedAt",
  "version",
];

test("older agent-import setups resume at preparation without sensitive fields", () => {
  // Version 3 had no agents chapter of its own: "agents" there was the import
  // step that has since moved into the conversation.
  const storage = memoryStorage({
    "polyphonic-onboarding-transaction.v1:owner-pubkey": JSON.stringify({
      version: 3,
      pubkey: "owner-pubkey",
      chapter: "agents",
      profileSaved: true,
      agentsReviewed: false,
      runtimeConfirmed: true,
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
  });

  const resumed = readPolyphonicOnboardingTransaction("owner-pubkey", storage);
  assert.equal(resumed?.chapter, "preparing");
  assert.equal(resumed?.runtimeConfirmed, true);
  assert.deepEqual(Object.keys(resumed ?? {}).sort(), FIELDS);
});

test("version three setups keep the chapter they stopped on", () => {
  for (const chapter of ["welcome", "runtime", "preparing"]) {
    const storage = memoryStorage({
      "polyphonic-onboarding-transaction.v1:owner": JSON.stringify({
        version: 3,
        pubkey: "owner",
        chapter,
        profileSaved: chapter !== "welcome",
        agentsReviewed: false,
        runtimeConfirmed: chapter === "preparing",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
    });
    const carried = readPolyphonicOnboardingTransaction("owner", storage);
    assert.equal(carried?.chapter, chapter);
    assert.equal(carried?.version, 4);
    // Memory is the default answer for a setup that was never asked.
    assert.equal(carried?.residentMemory, true);
  }
});

test("the agents and brain chapters are real places a setup can rest", () => {
  for (const chapter of ["agents", "brain"]) {
    const storage = memoryStorage();
    savePolyphonicOnboardingTransaction(
      {
        ...createPolyphonicOnboardingTransaction("owner"),
        chapter,
        runtimeConfirmed: true,
      },
      storage,
    );
    assert.equal(
      readPolyphonicOnboardingTransaction("owner", storage)?.chapter,
      chapter,
    );
  }
});

test("the memory answer survives a reload", () => {
  const storage = memoryStorage();
  savePolyphonicOnboardingTransaction(
    {
      ...createPolyphonicOnboardingTransaction("owner"),
      chapter: "agents",
      residentMemory: false,
      runtimeConfirmed: true,
    },
    storage,
  );
  assert.equal(
    readPolyphonicOnboardingTransaction("owner", storage)?.residentMemory,
    false,
  );
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
  assert.equal(migrated?.version, 4);
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

test("an unconfirmed runtime cannot be skipped by an old agents chapter", () => {
  const storage = memoryStorage({
    "polyphonic-onboarding-transaction.v1:owner": JSON.stringify({
      version: 3,
      pubkey: "owner",
      chapter: "agents",
      profileSaved: true,
      agentsReviewed: false,
      runtimeConfirmed: false,
      updatedAt: "2026-09-01T00:00:00.000Z",
    }),
  });
  assert.equal(
    readPolyphonicOnboardingTransaction("owner", storage)?.chapter,
    "runtime",
  );
});

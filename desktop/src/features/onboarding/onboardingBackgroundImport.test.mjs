import assert from "node:assert/strict";
import test from "node:test";

import {
  PENDING_NATIVE_IMPORT_PREFIX,
  pendingNativeImports,
  readStagedOnboardingAgentImports,
  resetOnboardingBackgroundImports,
  stageOnboardingAgentImports,
  startStagedOnboardingAgentImports,
  subscribeToPendingNativeImports,
} from "./onboardingBackgroundImport.ts";

function candidate(semanticId, displayName) {
  return {
    nativeType: semanticId.startsWith("hermes") ? "hermes" : "openclaw",
    nativeId: semanticId,
    semanticId,
    bindingFingerprint: `sha256:${semanticId}`,
    displayName,
    readiness: { status: "ready" },
    warnings: [],
    bindingPreview: {
      kind: "hermes",
      schemaVersion: 1,
      profileName: semanticId,
      hermesHome: `/fixture/${semanticId}`,
      executablePath: "hermes",
      runtimeVersion: "1.0.0",
    },
  };
}

/** Resolve once the queue has stopped moving. */
function settled() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("the queue brings agents in one at a time, in the order they were ticked", async (t) => {
  t.after(resetOnboardingBackgroundImports);
  resetOnboardingBackgroundImports();
  const order = [];
  let inFlight = 0;
  stageOnboardingAgentImports([
    candidate("hermes:one", "One"),
    candidate("hermes:two", "Two"),
    candidate("openclaw:three", "Three"),
  ]);
  startStagedOnboardingAgentImports({
    importAgent: async (entry) => {
      inFlight += 1;
      assert.equal(inFlight, 1, "two imports ran at once");
      await settled();
      order.push(entry.displayName);
      inFlight -= 1;
    },
  });
  // Nothing is awaited by the caller, so the rows are there immediately.
  assert.deepEqual(
    pendingNativeImports().map((entry) => entry.displayName),
    ["One", "Two", "Three"],
  );
  while (pendingNativeImports().length > 0) await settled();
  assert.deepEqual(order, ["One", "Two", "Three"]);
});

test("one failure keeps its reason and never stops the rest", async (t) => {
  t.after(resetOnboardingBackgroundImports);
  resetOnboardingBackgroundImports();
  const attempted = [];
  stageOnboardingAgentImports([
    candidate("hermes:one", "One"),
    candidate("hermes:two", "Two"),
    candidate("hermes:three", "Three"),
  ]);
  startStagedOnboardingAgentImports({
    importAgent: async (entry) => {
      attempted.push(entry.displayName);
      if (entry.displayName === "Two") {
        throw new Error("Start the OpenClaw gateway first.");
      }
    },
  });
  for (let tick = 0; tick < 20; tick += 1) await settled();
  assert.deepEqual(attempted, ["One", "Two", "Three"]);
  // The failed one is the only row left, and it says why.
  assert.deepEqual(pendingNativeImports(), [
    {
      semanticId: "hermes:two",
      displayName: "Two",
      error: "Start the OpenClaw gateway first.",
    },
  ]);
});

test("the staged list is taken exactly once, so nobody is imported twice", async (t) => {
  t.after(resetOnboardingBackgroundImports);
  resetOnboardingBackgroundImports();
  let imports = 0;
  stageOnboardingAgentImports([candidate("hermes:one", "One")]);
  assert.equal(readStagedOnboardingAgentImports().length, 1);
  const importAgent = async () => {
    imports += 1;
  };
  startStagedOnboardingAgentImports({ importAgent });
  startStagedOnboardingAgentImports({ importAgent });
  for (let tick = 0; tick < 10; tick += 1) await settled();
  startStagedOnboardingAgentImports({ importAgent });
  for (let tick = 0; tick < 10; tick += 1) await settled();
  assert.equal(imports, 1);
  assert.equal(readStagedOnboardingAgentImports().length, 0);
});

test("an empty selection queues nothing and tells the rail nothing", async (t) => {
  t.after(resetOnboardingBackgroundImports);
  resetOnboardingBackgroundImports();
  let notifications = 0;
  const stop = subscribeToPendingNativeImports(() => {
    notifications += 1;
  });
  let residentsChanged = 0;
  stageOnboardingAgentImports([]);
  startStagedOnboardingAgentImports({
    importAgent: async () => assert.fail("nothing should be imported"),
    onResidentsChanged: () => {
      residentsChanged += 1;
    },
  });
  for (let tick = 0; tick < 5; tick += 1) await settled();
  stop();
  assert.equal(notifications, 0);
  assert.equal(residentsChanged, 0);
  assert.deepEqual(pendingNativeImports(), []);
});

test("the rail is told after every attempt, not only at the end", async (t) => {
  t.after(resetOnboardingBackgroundImports);
  resetOnboardingBackgroundImports();
  const seen = [];
  stageOnboardingAgentImports([
    candidate("hermes:one", "One"),
    candidate("hermes:two", "Two"),
  ]);
  startStagedOnboardingAgentImports({
    importAgent: async (entry) => {
      if (entry.displayName === "One") throw new Error("nope");
    },
    onResidentsChanged: () => {
      seen.push(pendingNativeImports().length);
    },
  });
  for (let tick = 0; tick < 20; tick += 1) await settled();
  assert.deepEqual(seen, [2, 1]);
});

test("a pending row is marked so the rail never tries to open it", () => {
  assert.equal(PENDING_NATIVE_IMPORT_PREFIX, "pending-native-import:");
});

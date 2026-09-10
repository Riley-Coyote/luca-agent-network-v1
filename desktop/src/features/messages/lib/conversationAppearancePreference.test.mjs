import assert from "node:assert/strict";
import test from "node:test";

const OWNER = "a".repeat(64);
let importSequence = 0;

async function withStorage(storage, run) {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    const module = await import(
      `./conversationAppearancePreference.ts?test=${importSequence++}`
    );
    await run(module);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

test("missing, corrupt, and unsupported preferences default agent names on", async () => {
  for (const stored of [
    null,
    "{bad-json",
    JSON.stringify({ version: 1, residentMarksInMessages: true }),
    JSON.stringify({ version: 1, agentNamesInMessages: "no" }),
    JSON.stringify({ version: 2, agentNamesInMessages: false }),
    JSON.stringify({ version: 3, agentNamesInMessages: "yes" }),
    JSON.stringify({ version: 4, agentNamesInMessages: true }),
  ]) {
    await withStorage(
      { getItem: () => stored, setItem() {} },
      ({ getAgentNamesInMessages }) => {
        assert.equal(getAgentNamesInMessages(OWNER), true);
      },
    );
  }
});

test("an explicit name choice survives a cold read", async () => {
  await withStorage(
    {
      getItem: () =>
        JSON.stringify({ version: 3, agentNamesInMessages: false }),
      setItem() {},
    },
    ({ getAgentNamesInMessages }) =>
      assert.equal(getAgentNamesInMessages(OWNER), false),
  );
});

test("preference is scoped to the normalized owner pubkey", async () => {
  const secondOwner = "b".repeat(64);
  const storedByKey = new Map();
  await withStorage(
    {
      getItem: (key) => storedByKey.get(key) ?? null,
      setItem: (key, value) => storedByKey.set(key, value),
    },
    ({
      conversationAppearanceStorageKey,
      getAgentNamesInMessages,
      setAgentNamesInMessages,
    }) => {
      setAgentNamesInMessages(OWNER.toUpperCase(), false);
      assert.equal(getAgentNamesInMessages(OWNER), false);
      assert.equal(getAgentNamesInMessages(secondOwner), true);

      const key = conversationAppearanceStorageKey(OWNER);
      assert.ok(key);
      assert.deepEqual(JSON.parse(storedByKey.get(key)), {
        version: 3,
        agentNamesInMessages: false,
      });
      assert.equal(conversationAppearanceStorageKey("not-a-pubkey"), null);
    },
  );
});

test("the live value changes even when persistence is unavailable", async () => {
  await withStorage(
    {
      getItem: () => null,
      setItem() {
        throw new Error("quota exceeded");
      },
    },
    ({ getAgentNamesInMessages, setAgentNamesInMessages }) => {
      assert.equal(getAgentNamesInMessages(OWNER), true);
      assert.doesNotThrow(() => setAgentNamesInMessages(OWNER, false));
      assert.equal(getAgentNamesInMessages(OWNER), false);
    },
  );
});

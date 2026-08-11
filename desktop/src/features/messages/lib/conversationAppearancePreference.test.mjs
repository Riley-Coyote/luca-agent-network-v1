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

test("missing, corrupt, and unsupported preferences default marks on", async () => {
  for (const stored of [
    null,
    "{bad-json",
    JSON.stringify({ version: 2, residentMarksInMessages: false }),
    JSON.stringify({ version: 1, residentMarksInMessages: "no" }),
  ]) {
    await withStorage(
      { getItem: () => stored, setItem() {} },
      ({ getResidentMarksInMessages }) => {
        assert.equal(getResidentMarksInMessages(OWNER), true);
      },
    );
  }
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
      getResidentMarksInMessages,
      setResidentMarksInMessages,
    }) => {
      setResidentMarksInMessages(OWNER.toUpperCase(), false);
      assert.equal(getResidentMarksInMessages(OWNER), false);
      assert.equal(getResidentMarksInMessages(secondOwner), true);

      const key = conversationAppearanceStorageKey(OWNER);
      assert.ok(key);
      assert.deepEqual(JSON.parse(storedByKey.get(key)), {
        version: 1,
        residentMarksInMessages: false,
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
    ({ getResidentMarksInMessages, setResidentMarksInMessages }) => {
      assert.equal(getResidentMarksInMessages(OWNER), true);
      assert.doesNotThrow(() => setResidentMarksInMessages(OWNER, false));
      assert.equal(getResidentMarksInMessages(OWNER), false);
    },
  );
});

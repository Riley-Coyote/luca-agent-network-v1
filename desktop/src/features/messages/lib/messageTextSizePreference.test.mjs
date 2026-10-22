import assert from "node:assert/strict";
import test from "node:test";

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
      `./messageTextSizePreference.ts?test=${importSequence++}`
    );
    await run(module);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

test("missing, corrupt, and unsupported preferences read as the default size", async () => {
  for (const stored of [
    null,
    "{bad-json",
    JSON.stringify(["small"]),
    JSON.stringify({ version: 1, size: "tiny" }),
    JSON.stringify({ version: 2, size: "small" }),
    JSON.stringify({ size: "large" }),
  ]) {
    await withStorage(
      { getItem: () => stored, setItem() {} },
      ({ getMessageTextSize }) => {
        assert.equal(getMessageTextSize(), "default");
      },
    );
  }
});

test("a saved size survives a cold read", async () => {
  await withStorage(
    {
      getItem: () => JSON.stringify({ version: 1, size: "small" }),
      setItem() {},
    },
    ({ getMessageTextSize }) => assert.equal(getMessageTextSize(), "small"),
  );
});

test("choosing a size persists it once and publishes it immediately", async () => {
  const writes = [];
  await withStorage(
    {
      getItem: () => null,
      setItem: (key, value) => writes.push([key, value]),
    },
    ({ getMessageTextSize, setMessageTextSize }) => {
      setMessageTextSize("large");
      setMessageTextSize("large");
      assert.equal(getMessageTextSize(), "large");
      assert.deepEqual(writes, [
        [
          "luca.message-text-size.v1",
          JSON.stringify({ version: 1, size: "large" }),
        ],
      ]);
    },
  );
});

test("the live choice still applies when device storage refuses writes", async () => {
  await withStorage(
    {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    },
    ({ getMessageTextSize, setMessageTextSize }) => {
      setMessageTextSize("small");
      assert.equal(getMessageTextSize(), "small");
    },
  );
});

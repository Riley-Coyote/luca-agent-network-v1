import assert from "node:assert/strict";
import test from "node:test";
import {
  agentChatPictureKey,
  readAgentChatPicture,
  saveAgentChatPicture,
} from "./agentChatPicture.ts";

test("chat pictures stay local and are isolated by owner and resident", () => {
  const values = new Map();
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  });
  try {
    const key = agentChatPictureKey("A".repeat(64), "b".repeat(64));
    assert.equal(key, agentChatPictureKey("a".repeat(64), "b".repeat(64)));
    const otherOwner = agentChatPictureKey("c".repeat(64), "b".repeat(64));
    const otherResident = agentChatPictureKey("a".repeat(64), "c".repeat(64));
    const image = "data:image/png;base64,aGVsbG8=";
    saveAgentChatPicture(key, image);
    assert.equal(readAgentChatPicture(key), image);
    assert.equal(readAgentChatPicture(otherOwner), null);
    assert.equal(readAgentChatPicture(otherResident), null);
    assert.equal(agentChatPictureKey("invalid", "b".repeat(64)), null);
    for (const invalid of [
      "https://example.com/photo.png",
      "data:image/svg+xml;base64,aGVsbG8=",
      `data:image/png;base64,${"a".repeat(350_001)}`,
    ]) {
      assert.throws(() => saveAgentChatPicture(key, invalid));
      values.set(key, invalid);
      assert.equal(readAgentChatPicture(key), null);
    }
    saveAgentChatPicture(key, image);
    saveAgentChatPicture(key, null);
    assert.equal(readAgentChatPicture(key), null);
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

test("unavailable storage fails visibly rather than pretending a picture was saved", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("full");
      },
    },
  });
  try {
    const key = agentChatPictureKey("a".repeat(64), "b".repeat(64));
    assert.equal(readAgentChatPicture(key), null);
    assert.throws(() =>
      saveAgentChatPicture(key, "data:image/png;base64,aGVsbG8="),
    );
  } finally {
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
});

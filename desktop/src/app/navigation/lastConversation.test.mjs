import assert from "node:assert/strict";
import test from "node:test";

import {
  readLastConversation,
  rememberLastConversation,
} from "./lastConversation.ts";

function withLocalStorage(run) {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };

  try {
    run();
  } finally {
    globalThis.window = previousWindow;
  }
}

test("restores only a conversation still available to the owner", () => {
  withLocalStorage(() => {
    rememberLastConversation("room-a");
    assert.equal(readLastConversation(new Set(["room-a", "room-b"])), "room-a");
    assert.equal(readLastConversation(new Set(["room-b"])), null);
  });
});

test("storage failures never block navigation", () => {
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error("locked");
      },
      setItem: () => {
        throw new Error("locked");
      },
    },
  };

  try {
    assert.doesNotThrow(() => rememberLastConversation("room-a"));
    assert.equal(readLastConversation(new Set(["room-a"])), null);
  } finally {
    globalThis.window = previousWindow;
  }
});

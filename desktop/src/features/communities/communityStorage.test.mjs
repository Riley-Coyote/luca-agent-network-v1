import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCommunityStorage,
  deriveCommunityName,
  hasCommunityNetworkEndpoint,
  isLocalCommunityRelayUrl,
  LOCAL_COMMUNITY_NAME,
  LOCAL_COMMUNITY_RELAY_URL,
  migrateLegacyCommunityStorage,
} from "./communityStorage.ts";

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

test("migrateLegacyCommunityStorage promotes current Buzz workspace state", () => {
  const storage = createMemoryStorage({
    "buzz-workspaces": '[{"id":"current"}]',
    "buzz-active-workspace-id": "current",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("buzz-communities"), '[{"id":"current"}]');
  assert.equal(storage.getItem("buzz-active-community-id"), "current");
});

test("migrateLegacyCommunityStorage does not overwrite new community state", () => {
  const storage = createMemoryStorage({
    "buzz-communities": '[{"id":"new"}]',
    "buzz-active-community-id": "new",
    "buzz-workspaces": '[{"id":"old"}]',
    "buzz-active-workspace-id": "old",
  });

  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.getItem("buzz-communities"), '[{"id":"new"}]');
  assert.equal(storage.getItem("buzz-active-community-id"), "new");
});

test("only the local sentinel identifies the desktop-managed workspace", () => {
  assert.equal(isLocalCommunityRelayUrl(LOCAL_COMMUNITY_RELAY_URL), true);
  assert.equal(
    deriveCommunityName(LOCAL_COMMUNITY_RELAY_URL),
    LOCAL_COMMUNITY_NAME,
  );
  assert.equal(isLocalCommunityRelayUrl("ws://127.0.0.1:4317"), false);
  assert.equal(isLocalCommunityRelayUrl("ws://localhost:4317"), false);
  assert.equal(hasCommunityNetworkEndpoint(LOCAL_COMMUNITY_RELAY_URL), false);
  assert.equal(hasCommunityNetworkEndpoint("ws://127.0.0.1:4317"), true);
});

test("clearCommunityStorage removes new and legacy state", () => {
  const storage = createMemoryStorage({
    "buzz-communities": "new",
    "buzz-active-community-id": "new",
    "buzz-workspaces": "old",
    "buzz-active-workspace-id": "old",
  });

  clearCommunityStorage(storage);
  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.length, 0);
});

test("clearCommunityStorage removes new and legacy state", () => {
  const storage = createMemoryStorage({
    "buzz-communities": "new",
    "buzz-active-community-id": "new",
    "buzz-workspaces": "old",
    "buzz-active-workspace-id": "old",
  });

  clearCommunityStorage(storage);
  migrateLegacyCommunityStorage(storage);

  assert.equal(storage.length, 0);
});

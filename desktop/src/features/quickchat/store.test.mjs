import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyQuickChat,
  emptyRoom,
  newQuickChat,
  prepareQuickChatRoom,
  quickChatStorageKey,
  readQuickChat,
  updateQuickChatRoom,
} from "./store.ts";
const resident = "a".repeat(64);
test("membership failure retries the same created channel", async () => {
  let room = emptyRoom();
  let creates = 0;
  let attempts = 0;
  const create = async () => {
    creates++;
    return "room-1";
  };
  const attach = async (id) => {
    assert.equal(id, "room-1");
    if (++attempts === 1) throw Error("offline");
  };
  const save = (patch) => {
    room = { ...room, ...patch };
  };
  await assert.rejects(
    prepareQuickChatRoom(room, create, attach, save),
    /offline/,
  );
  assert.equal(room.channelId, "room-1");
  assert.equal(room.ready, false);
  assert.equal(
    await prepareQuickChatRoom(room, create, attach, save),
    "room-1",
  );
  assert.equal(creates, 1);
  assert.equal(room.ready, true);
});
test("new chat clears only selected resident pointer and draft", () => {
  const second = "b".repeat(64);
  let state = updateQuickChatRoom(emptyQuickChat(), resident, {
    channelId: "first",
    draft: "old",
    ready: true,
  });
  state = updateQuickChatRoom(state, second, {
    channelId: "other",
    draft: "keep",
  });
  const fresh = newQuickChat(state, resident);
  assert.equal(fresh.rooms[resident].channelId, null);
  assert.equal(fresh.rooms[resident].draft, "");
  assert.equal(fresh.rooms[second].channelId, "other");
  assert.equal(state.rooms[resident].channelId, "first");
});
test("account and community storage are isolated", () => {
  const entries = new Map();
  const storage = { getItem: (key) => entries.get(key) ?? null };
  const first = quickChatStorageKey("owner", "relay-a");
  entries.set(
    first,
    JSON.stringify(
      updateQuickChatRoom(emptyQuickChat(), resident, { draft: "private" }),
    ),
  );
  assert.equal(readQuickChat(storage, first).rooms[resident].draft, "private");
  assert.deepEqual(
    readQuickChat(storage, quickChatStorageKey("other", "relay-a")),
    emptyQuickChat(),
  );
  assert.deepEqual(
    readQuickChat(storage, quickChatStorageKey("owner", "relay-b")),
    emptyQuickChat(),
  );
});
test("invalid persisted state falls back without blocking chat", () => {
  assert.deepEqual(
    readQuickChat({ getItem: () => "{bad" }, "key"),
    emptyQuickChat(),
  );
  assert.deepEqual(
    readQuickChat(
      { getItem: () => JSON.stringify({ rooms: { bad: { draft: "x" } } }) },
      "key",
    ).rooms,
    {},
  );
});

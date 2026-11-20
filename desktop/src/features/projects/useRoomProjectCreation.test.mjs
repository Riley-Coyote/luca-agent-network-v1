import assert from "node:assert/strict";
import test from "node:test";

import { roomProjectCreationOperations } from "./useRoomProjectCreation.ts";

function chats() {
  const calls = [];
  return {
    calls,
    createChat: async (input, onCreated, options) => {
      calls.push({ input, options });
      await onCreated("chat-1");
    },
  };
}

test("the + dialog's chat is private and still opens the new chat", async () => {
  const { calls, createChat } = chats();
  const ops = roomProjectCreationOperations({
    createChat,
    ownerPubkey: "owner",
    relayUrl: "ws://relay",
  });
  let created = null;
  await ops.createRoom({ name: "general", description: "Studio" }, (id) => {
    created = id;
  });
  assert.equal(created, "chat-1");
  assert.deepEqual(calls, [
    {
      input: { description: "Studio", name: "general", visibility: "private" },
      options: { navigate: true },
    },
  ]);
});

test("a resident's project card makes the same chat without leaving the conversation", async () => {
  const { calls, createChat } = chats();
  const ops = roomProjectCreationOperations(
    { createChat, ownerPubkey: "owner", relayUrl: "ws://relay" },
    { navigate: false },
  );
  await ops.createRoom({ name: "general", description: "Build it." }, () => {});
  assert.deepEqual(calls[0].options, { navigate: false });
  assert.equal(calls[0].input.visibility, "private");
});

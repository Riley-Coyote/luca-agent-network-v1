import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { projectQuickChatMessages } from "./messages.ts";
import { FIRST_MEETING_MARKER } from "../luca/canonicalLucaResident.ts";
const relaySecret = new Uint8Array(32).fill(1);
const relay = getPublicKey(relaySecret);
const owner = "a".repeat(64),
  resident = "b".repeat(64);
const attributed = finalizeEvent(
  {
    created_at: 10,
    kind: 9,
    tags: [
      ["actor", owner],
      ["h", "room"],
    ],
    content: "Owner history",
  },
  relaySecret,
);
const latest = {
  id: "latest",
  pubkey: owner,
  created_at: 30,
  kind: 9,
  tags: [],
  content: "Latest",
  sig: "",
  pending: true,
};
const stream = {
  dispatchReceiptId: "dispatch",
  sessionEpoch: 1,
  conversationId: "room",
  residentPubkey: resident,
  publicText: "Reply",
  phase: "writing",
  anchorAt: 20000,
  finalMessageId: null,
};
test("canonical attributed owner survives refetch and streams sort chronologically", () => {
  const rows = projectQuickChatMessages(
    [latest, attributed],
    [stream],
    null,
    owner,
    resident,
    relay,
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Owner history", "Reply", "Latest"],
  );
  assert.deepEqual(
    rows.map((row) => row.role),
    ["owner", "assistant", "owner"],
  );
});
test("untrusted relay author claims stay hidden and signed final replaces stream", () => {
  const final = {
    ...latest,
    id: "final",
    pubkey: resident,
    created_at: 20,
    content: "Signed reply",
    pending: false,
  };
  const rows = projectQuickChatMessages(
    [attributed, final],
    [{ ...stream, finalMessageId: "final" }],
    null,
    owner,
    resident,
    null,
  );
  assert.deepEqual(
    rows.map((row) => row.text),
    ["Signed reply"],
  );
});

test("Stop controls stay out of history without hiding resident text", () => {
  const rows = projectQuickChatMessages(
    [
      { ...latest, content: "!cancel" },
      {
        ...latest,
        id: "resident-control-example",
        pubkey: resident,
        content: "!cancel",
      },
    ],
    [],
    null,
    owner,
    resident,
    relay,
  );
  assert.deepEqual(
    rows.map((row) => row.role),
    ["assistant"],
  );
});

test("canonical first meeting hides its trigger and choice metadata, not ordinary code", () => {
  const prose = "What would you like to work on?";
  const content = `${prose}\n\`\`\`polyphonic-choices\n{"options":["Think together","Build something"]}\n\`\`\``;
  const trigger = {
    ...latest,
    id: "meet",
    created_at: 10,
    pending: false,
    content: "Meet Luca",
    tags: [["client", FIRST_MEETING_MARKER]],
  };
  const reply = {
    ...latest,
    id: "greeting",
    created_at: 20,
    pending: false,
    pubkey: resident,
    content,
  };
  const events = [trigger, reply];
  const projected = projectQuickChatMessages(
    events,
    [],
    null,
    owner,
    resident,
    relay,
    resident,
  );
  assert.deepEqual(
    projected.map((row) => row.text),
    [prose],
  );
  const ordinary = projectQuickChatMessages(
    events,
    [],
    null,
    owner,
    resident,
    relay,
    "c".repeat(64),
  );
  assert.deepEqual(
    ordinary.map((row) => row.text),
    ["Meet Luca", content],
  );
  const streaming = projectQuickChatMessages(
    [trigger],
    [{ ...stream, publicText: `${prose}\n\`\`\`polyphonic-choices\n{` }],
    null,
    owner,
    resident,
    relay,
    resident,
  );
  assert.deepEqual(
    streaming.map((row) => row.text),
    [prose],
  );
});

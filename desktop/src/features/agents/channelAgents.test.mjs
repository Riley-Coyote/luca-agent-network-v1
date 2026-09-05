import assert from "node:assert/strict";
import test from "node:test";

import { attachManagedAgentToChannel } from "./channelAgents.ts";

const owner = "a".repeat(64);
const luca = "b".repeat(64);
const resident = "c".repeat(64);
const visitor = "d".repeat(64);
const agent = {
  pubkey: resident,
  name: "Scout",
  status: "running",
  backend: { type: "local" },
};

function channel(id, participants, channelType = "dm") {
  return {
    id,
    name: channelType === "dm" ? `DM ${participants.length}` : "Research",
    channel_type: channelType,
    participant_pubkeys: [...participants],
    participants: [...participants],
    member_pubkeys: [...participants],
  };
}

function installBridge(t, handlers) {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      async invoke(command, input) {
        calls.push({ command, input });
        if (command === "get_identity" && !handlers[command]) {
          return { pubkey: owner, display_name: "Owner" };
        }
        if (!handlers[command]) throw new Error(`Unexpected IPC: ${command}`);
        return handlers[command](input);
      },
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return calls;
}

test("DM attachment opens the canonical expanded participant set without mutating the source or admitting visitors", async (t) => {
  const source = channel("luca-dm", [owner, luca.toUpperCase()]);
  source.member_pubkeys.push(visitor);
  const original = structuredClone(source);
  const target = channel("canonical-group", [resident, owner, luca]);
  const calls = installBridge(t, {
    get_channel_details: () => structuredClone(source),
    open_dm: ({ pubkeys }) => {
      assert.deepEqual(new Set(pubkeys), new Set([luca, resident]));
      return target;
    },
  });
  const result = await attachManagedAgentToChannel(source.id, { agent });
  assert.equal(result.channelId, target.id);
  assert.equal(result.channelName, target.name);
  assert.equal(result.membershipAdded, true);
  assert.equal(result.started, false);
  assert.strictEqual(result.agent, agent);
  assert.deepEqual(source, original);
  assert.deepEqual(
    calls.map(({ command }) => command),
    ["get_channel_details", "get_identity", "open_dm"],
  );
});

test("expanding eight participants to nine leaves all eight other-participant slots available", async (t) => {
  const existing = [
    owner,
    luca,
    ...Array.from({ length: 6 }, (_, index) => String(index + 1).repeat(64)),
  ];
  installBridge(t, {
    get_channel_details: () => channel("eight-person-group", existing),
    open_dm: ({ pubkeys }) => {
      assert.equal(pubkeys.length, 8);
      assert.equal(pubkeys.includes(owner), false);
      assert.deepEqual(
        new Set(pubkeys),
        new Set([...existing.filter((pubkey) => pubkey !== owner), resident]),
      );
      return channel("nine-person-group", [owner, ...pubkeys]);
    },
  });
  const result = await attachManagedAgentToChannel("eight-person-group", {
    agent,
  });
  assert.equal(result.channelId, "nine-person-group");
});

test("an owner outside the source DM cannot become an implicit extra participant during expansion", async (t) => {
  const calls = installBridge(t, {
    get_channel_details: () => channel("another-dm", [luca, visitor]),
  });
  await assert.rejects(
    attachManagedAgentToChannel("another-dm", { agent }),
    /current owner is not a participant/,
  );
  assert.equal(
    calls.some(({ command }) => command === "open_dm"),
    false,
  );
});

test("retrying the returned group reuses its exact ID without expanding or adding members again", async (t) => {
  const target = channel("canonical-group", [owner, luca, resident]);
  const calls = installBridge(t, {
    get_channel_details: ({ channelId }) => {
      assert.equal(channelId, target.id);
      return target;
    },
  });
  const result = await attachManagedAgentToChannel(target.id, {
    agent: { ...agent, status: "stopped" },
    ensureRunning: false,
  });
  assert.equal(result.channelId, target.id);
  assert.equal(result.membershipAdded, false);
  assert.equal(result.started, false);
  assert.equal(result.agent.status, "stopped");
  assert.equal(calls.length, 1);
});

test("a participant already in a DM needs no generic membership operation", async (t) => {
  installBridge(t, {
    get_channel_details: () =>
      channel("existing-dm", [owner, resident.toUpperCase()]),
  });
  const result = await attachManagedAgentToChannel("existing-dm", { agent });
  assert.equal(result.channelId, "existing-dm");
  assert.equal(result.membershipAdded, false);
});

test("missing DM participants fail closed without inventing a replacement audience", async (t) => {
  const calls = installBridge(t, {
    get_channel_details: () => channel("empty-dm", []),
  });
  await assert.rejects(
    attachManagedAgentToChannel("empty-dm", { agent }),
    /participants are unavailable/,
  );
  assert.equal(calls.length, 1);
});

test("an unconfirmed expansion cannot start the resident or fall back to mutating the original DM", async (t) => {
  let target = channel("wrong-group", [owner, resident]);
  const calls = installBridge(t, {
    get_channel_details: () => channel("origin", [owner, luca]),
    open_dm: () => target,
  });
  for (const invalid of [
    target,
    channel("origin", [owner, luca, resident]),
    channel("wrong-group", [owner, luca, resident, visitor]),
    channel("wrong-room", [owner, luca, resident], "stream"),
  ]) {
    target = invalid;
    await assert.rejects(
      attachManagedAgentToChannel("origin", {
        agent: { ...agent, status: "stopped" },
      }),
      /participants could not be confirmed/,
    );
  }
  assert.equal(
    calls.some(({ command }) => command === "add_channel_members"),
    false,
  );
  assert.equal(
    calls.some(({ command }) => command === "start_managed_agent"),
    false,
  );
});

test("a room still adds the resident with its requested role and starts its exact identity", async (t) => {
  const calls = installBridge(t, {
    get_channel_details: () => channel("research", [], "stream"),
    get_channel_members: () => ({
      members: [{ pubkey: owner }],
      next_cursor: null,
    }),
    add_channel_members: (input) => {
      assert.deepEqual(input, {
        channelId: "research",
        pubkeys: [resident],
        role: "member",
      });
      return { added: [resident], errors: [] };
    },
    start_managed_agent: ({ pubkey }) => {
      assert.equal(pubkey, resident);
      return { ...agent, status: "running" };
    },
  });
  const result = await attachManagedAgentToChannel("research", {
    agent: { ...agent, status: "stopped" },
    role: "member",
  });
  assert.equal(result.channelId, "research");
  assert.equal(result.channelName, "Research");
  assert.equal(result.membershipAdded, true);
  assert.equal(result.started, true);
  assert.equal(result.agent.pubkey, resident);
  assert.deepEqual(
    calls.map(({ command }) => command),
    [
      "get_channel_details",
      "get_channel_members",
      "add_channel_members",
      "start_managed_agent",
    ],
  );
});

test("a room startup retry reuses successful membership before starting", async (t) => {
  const calls = installBridge(t, {
    get_channel_details: () => channel("research", [], "stream"),
    get_channel_members: () => ({
      members: [{ pubkey: resident.toUpperCase() }],
      next_cursor: null,
    }),
    start_managed_agent: () => ({ ...agent, status: "running" }),
  });
  const result = await attachManagedAgentToChannel("research", {
    agent: { ...agent, status: "stopped" },
  });
  assert.equal(result.membershipAdded, false);
  assert.equal(result.started, true);
  assert.equal(
    calls.some(({ command }) => command === "add_channel_members"),
    false,
  );
});

test("a room membership rejection prevents startup and remains actionable", async (t) => {
  installBridge(t, {
    get_channel_details: () => channel("research", [], "stream"),
    get_channel_members: () => ({ members: [], next_cursor: null }),
    add_channel_members: () => ({
      added: [],
      errors: [{ pubkey: resident, error: "Room access was revoked." }],
    }),
  });
  await assert.rejects(
    attachManagedAgentToChannel("research", {
      agent: { ...agent, status: "stopped" },
    }),
    /Room access was revoked/,
  );
});

test("an interrupted canonical open can be retried through the same participant set without membership writes", async (t) => {
  const target = channel("canonical-group", [owner, luca, resident]);
  let attempts = 0;
  const calls = installBridge(t, {
    get_channel_details: () => channel("origin", [owner, luca]),
    open_dm: ({ pubkeys }) => {
      assert.deepEqual(
        new Set([owner, ...pubkeys]),
        new Set(target.participant_pubkeys),
      );
      attempts += 1;
      if (attempts === 1) throw new Error("DM acknowledgment interrupted.");
      return target;
    },
  });
  await assert.rejects(
    attachManagedAgentToChannel("origin", { agent }),
    /acknowledgment interrupted/,
  );
  const result = await attachManagedAgentToChannel("origin", { agent });
  assert.equal(result.channelId, target.id);
  assert.equal(attempts, 2);
  assert.equal(
    calls.some(({ command }) => command === "add_channel_members"),
    false,
  );
});

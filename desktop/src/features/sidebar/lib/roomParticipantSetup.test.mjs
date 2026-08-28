import assert from "node:assert/strict";
import test from "node:test";

import { runRoomParticipantSetup } from "./roomParticipantSetup.ts";

test("room participant setup is sequential and retains only failures for retry", async () => {
  const order = [];
  let first = true;
  const candidates = [
    { id: "luca", name: "Luca" },
    { id: "anima", name: "Anima" },
    { id: "vektor", name: "Vektor" },
  ];

  const firstPass = await runRoomParticipantSetup(candidates, async (agent) => {
    order.push(agent.id);
    if (agent.id === "anima" && first) {
      first = false;
      throw new Error("runtime unavailable");
    }
  });

  assert.deepEqual(order, ["luca", "anima", "vektor"]);
  assert.deepEqual(firstPass.addedIds, ["luca", "vektor"]);
  assert.deepEqual(firstPass.failures, [
    { id: "anima", name: "Anima", error: "runtime unavailable" },
  ]);

  const retry = await runRoomParticipantSetup(
    firstPass.failures,
    async (agent) => {
      order.push(`retry:${agent.id}`);
    },
  );
  assert.deepEqual(retry, { addedIds: ["anima"], failures: [] });
  assert.deepEqual(order, ["luca", "anima", "vektor", "retry:anima"]);
});

test("room participant setup normalizes non-Error failures", async () => {
  const result = await runRoomParticipantSetup(
    [{ id: "codex", name: "Codex" }],
    async () => {
      throw "offline";
    },
  );
  assert.equal(result.failures[0]?.error, "Could not add agent.");
});

import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { subscribeCorrespondenceUpdates } from "./correspondenceLive.ts";

test("canonical relay stream changes and owner heads invalidate reads without a Refresh action", async () => {
  const subscriptions = [];
  let reconnect;
  let updates = 0;
  let closed = 0;
  const client = {
    async subscribeLive(filter, handler) {
      subscriptions.push({ filter, handler });
      return async () => {
        closed++;
      };
    },
    subscribeToReconnects(handler) {
      reconnect = handler;
      return () => {
        reconnect = null;
      };
    },
  };
  const dispose = await subscribeCorrespondenceUpdates(
    client,
    "owner",
    ["a", "b"],
    ["source"],
    () => {
      updates++;
    },
  );
  const heads = subscriptions.find(({ filter }) =>
    filter.kinds.includes(30178),
  );
  const messages = subscriptions.find(({ filter }) =>
    filter.kinds.includes(40002),
  );
  assert.deepEqual(messages.filter["#h"], ["source"]);
  assert.ok(messages.filter.kinds.includes(9));
  assert.deepEqual(heads.filter.authors, ["owner"]);
  const event = {
    pubkey: "a",
    tags: [
      ["h", "source"],
      ["exchange", "attempt"],
    ],
  };
  messages.handler(event);
  await delay(130);
  assert.equal(updates, 1);
  for (const other of [
    { ...event, pubkey: "outsider" },
    {
      ...event,
      tags: [
        ["h", "unrelated"],
        ["exchange", "attempt"],
      ],
    },
    { ...event, tags: [["h", "source"]] },
  ])
    messages.handler(other);
  assert.equal(updates, 1);
  heads.handler({
    pubkey: "owner",
    tags: [
      ["p", "a"],
      ["p", "b"],
    ],
  });
  heads.handler({
    pubkey: "owner",
    tags: [
      ["p", "a"],
      ["p", "c"],
    ],
  });
  await delay(130);
  assert.equal(updates, 2);
  reconnect();
  await delay(130);
  assert.equal(updates, 3);
  await dispose();
  messages.handler(event);
  assert.equal(updates, 3);
  assert.equal(closed, 2);
  assert.equal(reconnect, null);
});

test("stream bursts coalesce and a final arriving during a read queues one follow-up without cancelling", async () => {
  let messages;
  let finishRead;
  let updates = 0;
  const dispose = await subscribeCorrespondenceUpdates(
    {
      async subscribeLive(filter, handler) {
        if (filter.kinds.includes(9)) messages = handler;
        return async () => {};
      },
      subscribeToReconnects() {
        return () => {};
      },
    },
    "owner",
    ["a", "b"],
    ["source"],
    () => {
      updates++;
      if (updates === 1)
        return new Promise((resolve) => {
          finishRead = resolve;
        });
    },
  );
  const final = {
    pubkey: "a",
    tags: [
      ["h", "source"],
      ["exchange", "attempt"],
    ],
  };
  for (let index = 0; index < 30; index++) messages(final);
  await delay(130);
  assert.equal(updates, 1);
  messages(final);
  messages({
    pubkey: "owner",
    tags: [
      ["h", "source"],
      ["luca-task-reply", "attempt"],
    ],
  });
  await delay(130);
  assert.equal(updates, 1);
  finishRead();
  await delay(130);
  assert.equal(updates, 2);
  messages(final);
  await dispose();
  await delay(130);
  assert.equal(updates, 2);
});

test("partial subscription failure disposes established listeners", async () => {
  let calls = 0;
  let closed = 0;
  await assert.rejects(
    subscribeCorrespondenceUpdates(
      {
        async subscribeLive() {
          if (++calls === 2) throw new Error("disconnected");
          return async () => {
            closed++;
          };
        },
        subscribeToReconnects() {
          throw new Error("must not register");
        },
      },
      "owner",
      ["a", "b"],
      ["source"],
      () => {},
    ),
    /disconnected/,
  );
  assert.equal(closed, 1);
});

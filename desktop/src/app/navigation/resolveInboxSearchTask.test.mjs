import assert from "node:assert/strict";
import test from "node:test";
import { resolveInboxSearchTask } from "./resolveInboxSearchTask.ts";

const exchangeId = "a".repeat(64);
const resident = "b".repeat(64);
const other = "c".repeat(64);
const hit = { eventId: "event", channelId: "source", kind: 40002 };
const event = {
  id: "event",
  pubkey: resident,
  tags: [
    ["h", "source"],
    ["exchange", exchangeId, "1"],
  ],
};
const task = {
  correspondenceId: "pair",
  record: {
    exchangeId,
    conversationId: "source",
    owner: "owner",
    openedBy: resident,
    members: [resident, other],
  },
};
const page = {
  scope: { communityId: "community", ownerPubkey: "owner" },
  tasks: [task],
};

test("an authorized pair search result opens its exact existing task", async () => {
  let query;
  assert.deepEqual(
    await resolveInboxSearchTask(
      hit,
      async () => event,
      async (input) => {
        query = input;
        return page;
      },
    ),
    { exchangeId, correspondenceId: "pair", recipientPubkey: other },
  );
  assert.deepEqual(query, { exchangeId, limit: 1 });
});

test("group results and inaccessible tasks retain existing channel navigation", async () => {
  assert.equal(
    await resolveInboxSearchTask(
      hit,
      async () => event,
      async () => ({ ...page, tasks: [{ ...task, correspondenceId: null }] }),
    ),
    null,
  );
  assert.equal(
    await resolveInboxSearchTask(
      hit,
      async () => event,
      async () => ({ ...page, tasks: [] }),
    ),
    null,
  );
  assert.equal(
    await resolveInboxSearchTask(
      hit,
      async () => event,
      async () => {
        throw new Error("revoked");
      },
    ),
    null,
  );
});

test("source, author, event and owner substitutions cannot create task deep-links", async () => {
  for (const changedEvent of [
    { ...event, id: "different" },
    { ...event, pubkey: "outsider" },
    {
      ...event,
      tags: [
        ["h", "different"],
        ["exchange", exchangeId, "1"],
      ],
    },
  ]) {
    assert.equal(
      await resolveInboxSearchTask(
        hit,
        async () => changedEvent,
        async () => page,
      ),
      null,
    );
  }
  for (const record of [
    { ...task.record, owner: "other-owner" },
    { ...task.record, conversationId: "different" },
    { ...task.record, members: [resident, other, "third"] },
  ]) {
    assert.equal(
      await resolveInboxSearchTask(
        hit,
        async () => event,
        async () => ({ ...page, tasks: [{ ...task, record }] }),
      ),
      null,
    );
  }
});

test("ordinary message hits do not issue an inbox query", async () => {
  let queries = 0;
  assert.equal(
    await resolveInboxSearchTask(
      hit,
      async () => ({ ...event, tags: [["h", "source"]] }),
      async () => {
        queries += 1;
        return page;
      },
    ),
    null,
  );
  assert.equal(queries, 0);
});

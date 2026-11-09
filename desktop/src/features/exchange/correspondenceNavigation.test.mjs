import assert from "node:assert/strict";
import test from "node:test";
import {
  correspondencePathId,
  correspondenceSearch,
  generalCorrespondenceDraftKey,
} from "./correspondenceNavigation.ts";
import { correspondenceDraftKey } from "./correspondenceView.ts";

const task = "a".repeat(64);
const recipient = "b".repeat(64);
const pair = `correspondence-v1-${"c".repeat(64)}`;
const scope = { communityId: "community", ownerPubkey: "owner" };

test("main correspondence routes distinguish general history from explicit task replies", () => {
  assert.equal(correspondencePathId(`/correspondence/${pair}`), pair);
  for (const path of [
    "/channels/room",
    `/correspondence/${pair}/extra`,
    "/correspondence/arbitrary",
  ])
    assert.equal(correspondencePathId(path), null);
  assert.deepEqual(correspondenceSearch({ seed: task, recipient }), {
    seed: task,
    recipient,
  });
  assert.deepEqual(correspondenceSearch({ task, recipient, reply: task }), {
    task,
    recipient,
    reply: task,
  });
});

test("invalid route references fail closed and never become a different recipient", () => {
  for (const key of ["task", "seed", "recipient", "reply"]) {
    for (const value of [[], {}, "another-agent", "", true])
      assert.equal(correspondenceSearch({ [key]: value }).invalid, true);
  }
  assert.equal(correspondenceSearch({ seed: task, reply: task }).invalid, true);
  assert.deepEqual(
    correspondenceSearch({ content: "not a URL payload", permissions: "all" }),
    {},
  );
});

test("general drafts are stable across tasks and separate from task replies", () => {
  const general = generalCorrespondenceDraftKey(scope, pair, recipient, []);
  assert.equal(
    general,
    correspondenceDraftKey(scope, pair, "new-topic", recipient),
  );
  assert.notEqual(
    general,
    correspondenceDraftKey(scope, pair, task, recipient),
  );
  assert.equal(
    generalCorrespondenceDraftKey(scope, pair, recipient, [general]),
    general,
  );
  assert.notEqual(
    generalCorrespondenceDraftKey(scope, pair, "other", []),
    general,
  );
  assert.notEqual(
    generalCorrespondenceDraftKey(
      { ...scope, ownerPubkey: "other" },
      pair,
      recipient,
      [],
    ),
    general,
  );
});

test("legacy general drafts keep their exact keys and uncertain-send identities", () => {
  const legacy = correspondenceDraftKey(
    scope,
    pair,
    `new-topic:${task}`,
    recipient,
  );
  assert.equal(
    generalCorrespondenceDraftKey(scope, pair, recipient, [
      "other",
      "agent-inbox:not-json",
      legacy,
    ]),
    legacy,
  );
  for (const changed of [
    correspondenceDraftKey(
      { ...scope, communityId: "other" },
      pair,
      `new-topic:${task}`,
      recipient,
    ),
    correspondenceDraftKey(
      { ...scope, ownerPubkey: "other" },
      pair,
      `new-topic:${task}`,
      recipient,
    ),
    correspondenceDraftKey(scope, "other-pair", `new-topic:${task}`, recipient),
    correspondenceDraftKey(scope, pair, `new-topic:${task}`, "other-recipient"),
    correspondenceDraftKey(scope, pair, task, recipient),
  ])
    assert.notEqual(
      generalCorrespondenceDraftKey(scope, pair, recipient, [changed]),
      changed,
    );
  const canonical = correspondenceDraftKey(scope, pair, "new-topic", recipient);
  assert.equal(
    generalCorrespondenceDraftKey(scope, pair, recipient, [legacy, canonical]),
    canonical,
  );
});

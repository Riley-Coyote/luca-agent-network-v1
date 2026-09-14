import assert from "node:assert/strict";
import test from "node:test";
import {
  firstMeetingPresentation,
  parseFirstMeetingChoices,
  visibleFirstMeetingProse,
  latestFirstMeetingOffer,
} from "./firstMeetingChoices.ts";
import { FIRST_MEETING_MARKER } from "./canonicalLucaResident.ts";

const owner = "a".repeat(64);
const luca = "b".repeat(64);
const trigger = {
  id: "start",
  depth: 0,
  signerPubkey: owner,
  pubkey: owner,
  body: "Meet Luca",
  tags: [["client", FIRST_MEETING_MARKER]],
};
const reply = {
  id: "reply",
  depth: 0,
  signerPubkey: luca,
  pubkey: luca,
  body: 'What brings you here?\n```polyphonic-choices\n{"options":["Explore an idea","Start work now"]}\n```',
};

test("valid choices strip only final metadata and preserve exact labels", () => {
  assert.deepEqual(parseFirstMeetingChoices(reply.body), {
    prose: "What brings you here?",
    options: ["Explore an idea", "Start work now"],
  });
  assert.equal(
    visibleFirstMeetingProse("Question\n```polyphonic-choices\n{", true),
    "Question",
  );
});

test("answered offers keep prose clean while a later streaming fence stays hidden", () => {
  const ownerReply = {
    id: "owner-reply",
    depth: 0,
    signerPubkey: owner,
    pubkey: owner,
  };
  const draft = {
    id: "draft",
    depth: 0,
    pubkey: luca,
    body: "Next question\n```polyphonic-choices\n{",
    managedPresentation: { streaming: true },
  };
  const presentation = firstMeetingPresentation(
    [trigger, reply, ownerReply, draft],
    owner,
    luca,
  );
  assert.equal(presentation.triggerId, trigger.id);
  assert.equal(presentation.responseIds.has(reply.id), true);
  assert.equal(presentation.responseIds.has(draft.id), true);
  assert.equal(
    visibleFirstMeetingProse(reply.body, false),
    "What brings you here?",
  );
  assert.equal(visibleFirstMeetingProse(draft.body, true), "Next question");
  assert.equal(
    latestFirstMeetingOffer([trigger, reply, ownerReply, draft], owner, luca),
    null,
  );
  assert.equal(
    firstMeetingPresentation([reply], owner, luca).responseIds.size,
    0,
  );
});

test("invalid metadata is ordinary text", () => {
  for (const payload of [
    '{"options":["one"]}',
    '{"options":["same","same"]}',
    '{"options":["good","bad\u003cscript\u003e"]}',
    '{"options":["one","two"],"action":"open"}',
    '{"options":["one",42]}',
    '{"options":["one","two"],',
    `{"options":["${"x".repeat(2050)}","two"]}`,
  ])
    assert.equal(
      parseFirstMeetingChoices(
        `Question\n\`\`\`polyphonic-choices\n${payload}\n\`\`\``,
      ),
      null,
    );
});

test("only the latest unanswered canonical offer within five owner replies is active", () => {
  assert.deepEqual(
    latestFirstMeetingOffer([trigger, reply], owner, luca)?.options,
    ["Explore an idea", "Start work now"],
  );
  assert.equal(
    latestFirstMeetingOffer([trigger, reply], owner, "c".repeat(64)),
    null,
  );
  assert.equal(
    latestFirstMeetingOffer(
      [
        trigger,
        reply,
        { id: "owner", depth: 0, signerPubkey: owner, pubkey: owner },
      ],
      owner,
      luca,
    ),
    null,
  );
  assert.equal(
    latestFirstMeetingOffer(
      [trigger, { ...reply, pending: true }],
      owner,
      luca,
    ),
    null,
  );
  const five = Array.from({ length: 5 }, (_, index) => ({
    id: `owner-${index}`,
    depth: 0,
    signerPubkey: owner,
    pubkey: owner,
  }));
  assert.ok(latestFirstMeetingOffer([trigger, ...five, reply], owner, luca));
  assert.equal(
    latestFirstMeetingOffer(
      [trigger, ...five, { ...five[0], id: "owner-6" }, reply],
      owner,
      luca,
    ),
    null,
  );
});

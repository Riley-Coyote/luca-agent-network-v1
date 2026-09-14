import assert from "node:assert/strict";
import test from "node:test";
import { isUntouchedLucaGreeting } from "./firstConversation.ts";
import { FIRST_MEETING_MARKER } from "./canonicalLucaResident.ts";

const luca = "a".repeat(64);
const owner = "b".repeat(64);
const trigger = {
  id: "trigger",
  depth: 0,
  signerPubkey: owner,
  pubkey: owner,
  kind: 9,
  tags: [["client", FIRST_MEETING_MARKER]],
  body: "Meet Luca",
};
const greeting = {
  id: "reply",
  depth: 0,
  signerPubkey: luca,
  pubkey: luca,
  kind: 9,
  body: "Hello",
};

test("the centered composer requires a trusted greeting and complete history", () => {
  assert.equal(
    isUntouchedLucaGreeting([trigger, greeting], luca, owner, true, false),
    true,
  );
  assert.equal(
    isUntouchedLucaGreeting([trigger, greeting], luca, owner, false, false),
    false,
  );
  assert.equal(
    isUntouchedLucaGreeting([trigger, greeting], luca, owner, true, true),
    false,
  );
  assert.equal(
    isUntouchedLucaGreeting([trigger, greeting], null, owner, true, false),
    false,
  );
  assert.equal(
    isUntouchedLucaGreeting(
      [trigger, { ...greeting, signerPubkey: "c".repeat(64) }],
      luca,
      owner,
      true,
      false,
    ),
    false,
  );
});

test("pending, failed, historical, and resident replies keep the timeline visible", () => {
  for (const extra of [
    { pubkey: "owner", pending: true },
    { pubkey: "system", kind: 10004 },
    { pubkey: "owner", sendFailed: true },
    { pubkey: "owner" },
  ]) {
    assert.equal(
      isUntouchedLucaGreeting(
        [trigger, greeting, { id: "another", depth: 0, kind: 9, ...extra }],
        luca,
        owner,
        true,
        false,
      ),
      false,
    );
  }
});

test("the relay's invisible DM creation notice preserves the first composer", () => {
  const notice = {
    id: "created",
    depth: 0,
    kind: 40099,
    body: '{"type":"dm_created"}',
  };
  assert.equal(
    isUntouchedLucaGreeting(
      [notice, trigger, greeting],
      luca,
      owner,
      true,
      false,
    ),
    true,
  );
  for (const body of [
    '{"type":"member_removed"}',
    '{"type":"message_deleted"}',
    "invalid",
  ]) {
    assert.equal(
      isUntouchedLucaGreeting(
        [{ ...notice, body }, trigger, greeting],
        luca,
        owner,
        true,
        false,
      ),
      false,
    );
  }
});

// Live and unpublished replies retain their ordinary activity row and Stop.
test("a live first reply never hides its working controls", () => {
  for (const state of [
    { managedPresentation: { streaming: true } },
    { pending: true },
    { sendFailed: true },
  ]) {
    assert.equal(
      isUntouchedLucaGreeting(
        [trigger, { ...greeting, ...state }],
        luca,
        owner,
        true,
        false,
      ),
      false,
    );
  }
});

test("signed main-timeline replies keep their causal reference without losing the first meeting", () => {
  assert.equal(
    isUntouchedLucaGreeting(
      [
        trigger,
        {
          ...greeting,
          depth: 1,
          tags: [
            ["e", "trigger", "", "reply"],
            ["broadcast", "1"],
          ],
        },
      ],
      luca,
      owner,
      true,
      false,
    ),
    true,
  );
});

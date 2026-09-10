import assert from "node:assert/strict";
import test from "node:test";
import { isUntouchedLucaGreeting } from "./firstConversation.ts";
import { LUCA_GREETING_MARKER } from "./canonicalLucaResident.ts";

const luca = "a".repeat(64);
const greeting = {
  id: "greeting",
  depth: 0,
  signerPubkey: luca,
  pubkey: luca,
  kind: 9,
  tags: [["client", LUCA_GREETING_MARKER]],
  body: "Hello",
};

test("the centered composer requires a trusted greeting and complete history", () => {
  assert.equal(isUntouchedLucaGreeting([greeting], luca, true, false), true);
  assert.equal(isUntouchedLucaGreeting([greeting], luca, false, false), false);
  assert.equal(isUntouchedLucaGreeting([greeting], luca, true, true), false);
  assert.equal(isUntouchedLucaGreeting([greeting], null, true, false), false);
  assert.equal(
    isUntouchedLucaGreeting(
      [{ ...greeting, signerPubkey: "b".repeat(64) }],
      luca,
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
    { pubkey: luca, signerPubkey: luca },
  ]) {
    assert.equal(
      isUntouchedLucaGreeting(
        [greeting, { id: "reply", depth: 0, kind: 9, ...extra }],
        luca,
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
    isUntouchedLucaGreeting([notice, greeting], luca, true, false),
    true,
  );
  for (const body of [
    '{"type":"member_removed"}',
    '{"type":"message_deleted"}',
    "invalid",
  ]) {
    assert.equal(
      isUntouchedLucaGreeting(
        [{ ...notice, body }, greeting],
        luca,
        true,
        false,
      ),
      false,
    );
  }
});

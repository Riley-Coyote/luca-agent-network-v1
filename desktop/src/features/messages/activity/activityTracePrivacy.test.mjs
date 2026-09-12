import assert from "node:assert/strict";
import test from "node:test";
import { canShowPrivateActivityDetails } from "./activityTracePrivacy.ts";
const channel = {
  channelType: "stream",
  visibility: "private",
  memberPubkeys: ["owner", "resident"],
  participantPubkeys: [],
};
const allowed = (c = channel) =>
  canShowPrivateActivityDetails(c, "owner", (p) => p === "resident");
test("private Quick Chat streams and direct conversations allow owner-local activity detail", () => {
  assert.equal(allowed(), true);
  assert.equal(allowed({ ...channel, channelType: "dm" }), true);
});
test("public rooms, other humans, and incomplete membership stay generic", () => {
  assert.equal(allowed({ ...channel, visibility: "public" }), false);
  assert.equal(
    allowed({
      ...channel,
      memberPubkeys: [...channel.memberPubkeys, "other-person"],
    }),
    false,
  );
  assert.equal(allowed({ ...channel, memberPubkeys: ["resident"] }), false);
  assert.equal(allowed({ ...channel, memberPubkeys: [] }), false);
  assert.equal(
    canShowPrivateActivityDetails(undefined, "owner", () => true),
    false,
  );
});

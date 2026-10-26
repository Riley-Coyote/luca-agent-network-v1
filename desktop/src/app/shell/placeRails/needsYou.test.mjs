import assert from "node:assert/strict";
import test from "node:test";

import { needsYouCount, needsYouNote, orderNeedsYou } from "./needsYou.ts";
import { pickIdOf } from "./placePicks.ts";

test("needsYou_newestFirst_timelessRequestsLead", () => {
  const ordered = orderNeedsYou([
    { key: "proposal:old", at: 1_000 },
    { key: "permission:a", at: null },
    { key: "exchange:new", at: 5_000 },
    { key: "question:b", at: null },
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.key),
    ["permission:a", "question:b", "exchange:new", "proposal:old"],
  );
});

test("needsYou_countsEveryKind_andSaysNothingAtZero", () => {
  assert.equal(
    needsYouCount({
      permissions: 1,
      questions: 1,
      proposals: 1,
      pausedExchanges: 1,
    }),
    4,
  );
  assert.equal(needsYouNote(0), undefined);
  assert.equal(needsYouNote(4), "4");
  assert.equal(needsYouNote(140), "99+");
});

test("activity_streamWords_onlyItsOwn", () => {
  assert.equal(pickIdOf("activity", { stream: "needs-you" }), "needs-you");
  assert.equal(pickIdOf("activity", { stream: "side" }), "side");
  assert.equal(pickIdOf("activity", { stream: "elsewhere" }), null);
});

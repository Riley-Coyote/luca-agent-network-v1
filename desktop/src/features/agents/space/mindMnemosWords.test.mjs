import assert from "node:assert/strict";
import test from "node:test";

import { describeMind } from "./MindMnemos.tsx";

const mind = (newest) => ({ id: "wren", name: "Wren", memories: 2431, newest });
const said = (at) =>
  `2,431 memories · newest ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

test("a mind's line names its newest memory's day in the viewer's own time", () => {
  // Built from local parts, so it means the same in any time zone: a memory
  // made at half past seven this evening, stamped by the store in world time.
  const evening = new Date(2026, 10, 24, 19, 30);
  const stamp = evening.toISOString().replace("Z", "678+00:00");
  assert.equal(describeMind(mind(stamp)), said(new Date(2026, 10, 24)));
  // Only a calendar day, as the app handed over before: still that day.
  assert.equal(describeMind(mind("2026-11-16")), said(new Date(2026, 10, 16)));
  // Nothing, or what can't be read: only the count, never "Invalid Date".
  assert.equal(describeMind(mind(null)), "2,431 memories");
  assert.equal(describeMind(mind("soon")), "2,431 memories");
  assert.equal(describeMind(mind("2026-02-30")), "2,431 memories");
  assert.equal(describeMind({ ...mind(null), memories: 1 }), "1 memory");
});

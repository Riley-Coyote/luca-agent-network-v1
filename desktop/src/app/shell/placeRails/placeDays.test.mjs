import assert from "node:assert/strict";
import test from "node:test";

import { dayLabel, groupMindDays } from "@/features/agents/space/mindStream";
import { sideDays } from "@/features/exchange/sideConversations";
import { placeDayLabel } from "./placeDays.ts";

const NOW = new Date(2026, 9, 26, 12, 0);

test("today, yesterday, then the weekday and the date", () => {
  assert.equal(placeDayLabel(new Date(2026, 9, 26, 0, 5), NOW), "Today");
  assert.equal(placeDayLabel(new Date(2026, 9, 25, 23, 59), NOW), "Yesterday");
  assert.equal(
    placeDayLabel(new Date(2026, 9, 23, 9), NOW, "en-US"),
    "Friday, Oct 23",
  );
});

test("the year shows only when it isn't this year", () => {
  assert.equal(
    placeDayLabel(new Date(2025, 9, 23, 9), NOW, "en-US"),
    "Thursday, Oct 23, 2025",
  );
});

test("the Notebook and All activity name the same days the same way", () => {
  const ats = [
    new Date(2026, 9, 26, 10).getTime(),
    new Date(2026, 9, 25, 9).getTime(),
    new Date(2026, 9, 23, 9).getTime(),
    new Date(2025, 11, 31, 9).getTime(),
  ];
  const activity = sideDays(
    ats.map((at) => ({ at })),
    NOW,
  ).map((day) => day.label);
  const notebook = groupMindDays(
    ats.map((at, index) => ({
      at,
      id: `e${index}`,
      kind: "own",
      text: "",
    })),
    "all",
    NOW.getTime(),
  ).map((day) => day.label);
  assert.deepEqual(notebook, activity);
  assert.deepEqual(
    ats.map((at) => dayLabel(at, NOW.getTime())),
    activity,
  );
  assert.equal(activity[0], "Today");
  assert.equal(activity[1], "Yesterday");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  hhmm,
  nextWords,
  railStateLine,
  scheduleOf,
  soonest,
  tempWord,
  temperature,
  ago,
  clock,
} from "./boardWords.ts";
import {
  angleOf,
  arcPath,
  arcsOf,
  DIAL,
  dialSentence,
  hourOfDay,
  pointAt,
} from "./dial.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} is not ${b}`);

test("time to angle: noon at the top, 6 pm a quarter turn, midnight at the foot", () => {
  near(angleOf(12), 0);
  near(angleOf(18), Math.PI / 2);
  near(angleOf(0), -Math.PI);
  near(angleOf(24), Math.PI);
  near(angleOf(6), -Math.PI / 2);
  const { centre: c, radius: r } = DIAL;
  assert.deepEqual(pointAt(12), [c, c - r]);
  assert.deepEqual(pointAt(18), [c + r, c]);
  assert.deepEqual(pointAt(0), [c, c + r]);
  assert.deepEqual(pointAt(6), [c - r, c]);
  near(hourOfDay(new Date(2026, 10, 20, 15, 30)), 15.5);
});

test("an arc across midnight goes on clockwise past the foot", () => {
  // 23:30 for an hour: from just right of the foot (evening is the right
  // half) to just left of it (the small hours are the left).
  const path = arcPath(23.5, 1);
  const [x1, y1] = pointAt(23.5);
  const [x2, y2] = pointAt(0.5);
  assert.equal(
    path,
    `M ${x1} ${y1} A ${DIAL.radius} ${DIAL.radius} 0 0 1 ${x2} ${y2}`,
  );
  assert.ok(x1 > DIAL.centre && x2 < DIAL.centre, "it crosses the foot");
  assert.ok(y1 > DIAL.centre && y2 > DIAL.centre, "both ends are low");
  // The end is the same point as 24.5 (the face is periodic).
  assert.deepEqual(pointAt(24.5), pointAt(0.5));
  // Only an arc longer than half the day takes the large way round.
  assert.match(arcPath(1, 13), / 0 1 1 /);
});

test("arcs: one per scheduled hour that names a time, each as long as its kind", () => {
  const plan = scheduleOf([
    { kind: "mine", when: { Hour: 8, Minute: 0 }, loaded: true },
    { kind: "ours", when: { Hour: 19, Minute: 0 }, loaded: true },
    { kind: "dream", when: { Hour: 3, Minute: 30 }, loaded: true },
    { kind: "dream", when: null, loaded: false },
    { when: { Hour: 1 } },
  ]);
  assert.equal(plan.length, 4);
  const arcs = arcsOf(plan, "ours");
  assert.deepEqual(
    arcs.map((a) => [a.kind, a.start, a.length, a.last]),
    [
      ["mine", 8, 1, false],
      ["ours", 19, 0.5, true],
      ["dream", 3.5, 0.25, false],
    ],
  );
  // The engine's own shape, and a written time, are both read.
  assert.deepEqual(scheduleOf([{ kind: "mine", when: "03:00" }])[0].at, {
    hour: 3,
    minute: 0,
  });
  assert.equal(hhmm({ hour: 3, minute: 5 }), "03:05");
});

test("the soonest hour: a loaded one first, then the nearest; it rolls to tomorrow", () => {
  const plan = scheduleOf([
    { kind: "mine", when: { Hour: 8, Minute: 0 }, loaded: true },
    { kind: "ours", when: { Hour: 19, Minute: 0 }, loaded: true },
    { kind: "dream", when: { Hour: 3, Minute: 30 }, loaded: true },
  ]);
  const at2pm = new Date(2026, 10, 20, 14, 0);
  const next = soonest(plan, at2pm);
  assert.equal(next.kind, "ours");
  assert.equal(new Date(next.at).getHours(), 19);
  assert.equal(nextWords(next), "Next, our hour at 7:00 pm");
  // After 7 pm, the dream at 3:30 tomorrow.
  const late = soonest(plan, new Date(2026, 10, 20, 22, 0));
  assert.equal(late.kind, "dream");
  assert.equal(new Date(late.at).getDate(), 21);
  assert.equal(nextWords(late), "Next, a dream at 3:30 am");
  // A loaded hour comes before a nearer one that isn't.
  const mixed = scheduleOf([
    { kind: "ours", when: { Hour: 15, Minute: 0 }, loaded: false },
    { kind: "mine", when: { Hour: 8, Minute: 0 }, loaded: true },
  ]);
  assert.equal(soonest(mixed, at2pm).kind, "mine");
  assert.equal(soonest([], at2pm), null);
  assert.equal(nextWords(null), "Hours not scheduled");
  assert.equal(
    nextWords(soonest(scheduleOf([{ kind: "dream", loaded: true }]), at2pm)),
    "Next, a dream",
  );
});

test("warmth and its word, by the notebook's half-life of six hours", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const ended = (ms) => ({ end: new Date(now - ms).toISOString() });
  near(temperature(ended(0), now), 1);
  near(temperature(ended(6 * 3_600_000), now), 0.5);
  assert.equal(tempWord(temperature(ended(10 * 60_000), now), {}), "White-hot");
  assert.equal(
    tempWord(temperature(ended(3 * 3_600_000), now), {}),
    "Still warm",
  );
  assert.equal(tempWord(temperature(ended(12 * 3_600_000), now), {}), "Embers");
  assert.equal(tempWord(temperature(ended(7 * 86_400_000), now), {}), "Cold");
  assert.equal(tempWord(1, null), "Cold");
  assert.equal(ago(20_000), "just now");
  assert.equal(ago(12 * 60_000), "12 min ago");
  assert.equal(ago(4.3 * 3_600_000), "4.3 h ago");
  assert.equal(ago(7 * 86_400_000), "7 days ago");
  assert.equal(clock(new Date(2026, 0, 1, 15, 30)), "3:30 pm");
});

test("the rail's line, by the notebook's own rule", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const life = (hours) => ({
    hours,
    memory: { states: { active: 11, dormant: 1, archived: 2 }, count: 12 },
  });
  const ours = {
    kind: "ours",
    practice: false,
    end: new Date(now - 7 * 86_400_000).toISOString(),
  };
  assert.equal(
    railStateLine(life([ours]), now),
    "Cold · our hour ended 7 days ago",
  );
  assert.equal(
    railStateLine(life([{ ...ours, practice: true }]), now),
    "Cold · our hour ended 7 days ago · practice",
  );
  assert.equal(
    railStateLine(life([]), now),
    "12 memories · no quiet hours yet",
  );
});

test("the dial's text alternative says it all in one sentence", () => {
  const now = new Date(2026, 10, 20, 14, 10);
  const plan = scheduleOf([
    { kind: "mine", when: { Hour: 8, Minute: 0 }, loaded: true },
    { kind: "dream", when: { Hour: 3, Minute: 30 }, loaded: true },
  ]);
  const life = {
    hours: [
      {
        kind: "mine",
        practice: false,
        end: new Date(now.getTime() - 3_600_000).toISOString(),
      },
    ],
    memory: { states: { active: 1, dormant: 0, archived: 0 } },
  };
  const sentence = dialSentence({
    arcs: arcsOf(plan, "mine"),
    life,
    next: soonest(plan, now),
    now,
  });
  assert.equal(
    sentence,
    "Still warm: its own hour ended 1 h ago; its hours fall at 8:00 am for its own hour and 3:30 am for a dream; it is now 2:10 pm; next, a dream at 3:30 am.",
  );
  assert.equal(sentence.match(/\./g).length, 1, "one sentence");
});

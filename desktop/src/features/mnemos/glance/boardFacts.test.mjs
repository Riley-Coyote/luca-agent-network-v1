import assert from "node:assert/strict";
import test from "node:test";

import { kestrelNotebook } from "../../../../tests/e2e/luca/mnemos-newer-fixture.ts";
import { lifeOf, memoryOfNotebook } from "../notebookShapes.ts";
import {
  asksByKind,
  beliefsHeld,
  beliefsRange,
  carriedBy,
  heldWords,
  memoryNumbers,
  monthMarks,
  STRIP_DAYS,
  newest,
  newestDayKept,
  picturesMadeBy,
  picturesOf,
  stepTo,
} from "./boardFacts.ts";

/** Kestrel, the made-up mind the browser tests read, as the place reads it. */
function kestrel(now) {
  const made = kestrelNotebook(now.getTime());
  return {
    life: lifeOf(made.life),
    memories: made.memories.map(memoryOfNotebook).filter(Boolean),
  };
}

const NOW = new Date(2026, 10, 20, 15, 0);

test("Memory: how many it can reach, let go, the days kept and since when", () => {
  const { life, memories } = kestrel(NOW);
  const n = memoryNumbers(life, memories, NOW);
  assert.equal(n.reach, 12);
  assert.equal(n.letGo, 2);
  // Twelve memories, two days apart: twelve days with something kept,
  // from the first, 22 days and 5 hours ago, to today.
  assert.equal(n.days, 12);
  assert.equal(n.since, "Oct 29");
  // The strip always spans the last six months, ending today: a young
  // mind is a few ticks at its right end.
  assert.equal(n.strip.length, STRIP_DAYS);
  assert.equal(n.strip.at(-1).key, "2026-11-20");
  assert.equal(n.strip.at(-1).count, 1);
  assert.equal(
    n.strip.reduce((sum, d) => sum + d.count, 0),
    12,
  );
  assert.equal(
    n.strip.findIndex((d) => d.count > 0),
    STRIP_DAYS - 23,
  );
  // Its months, each named at its first day.
  assert.deepEqual(
    monthMarks(n.strip).map((m) => m.name),
    ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"],
  );
});

test("the newest day with something kept, and what was kept, newest first", () => {
  const { life, memories } = kestrel(NOW);
  const day = newestDayKept(life, memories, NOW);
  assert.equal(day.name, "Today");
  assert.equal(day.kept, 1);
  // Its own hour and the newest memory, both five hours ago.
  assert.deepEqual(
    new Set(day.rows.map((r) => `${r.room}:${r.item}`)),
    new Set(["hours:kes-h1", "memories:kes-m11"]),
  );
  const hour = day.rows.find((r) => r.room === "hours");
  const memory = day.rows.find((r) => r.room === "memories");
  assert.equal(hour.tag, "its own hour");
  assert.equal(hour.time, "10:00 am");
  assert.match(hour.text, /^It woke with one memory in hand/);
  assert.equal(
    memory.text,
    "When the wind backs south, the swell follows by evening.",
  );
  // Newest first, whatever their order in the notebook.
  const later = newestDayKept(
    {
      ...life,
      hours: [
        {
          ...life.hours[0],
          start: new Date(NOW.getTime() - 60_000).toISOString(),
        },
      ],
    },
    memories,
    NOW,
  );
  assert.equal(later.rows[0].room, "hours");
  assert.equal(newestDayKept({ ...life, hours: [] }, [], NOW), null);
});

test("Beliefs: the most firmly held first; the range; one picked, stepped", () => {
  const { life } = kestrel(NOW);
  const list = beliefsHeld(life.beliefs);
  assert.deepEqual(
    list.map((b) => b.confidence),
    [0.84, 0.58],
  );
  assert.equal(beliefsRange(list), "2, held at 58% to 84%");
  assert.equal(beliefsRange(list.slice(0, 1)), "1, held at 84%");
  assert.equal(beliefsRange([]), "0");
  assert.equal(heldWords(list[1]), "Held at 58%");
  // Stepping stays inside the list.
  assert.equal(stepTo(0, 1, 2), 1);
  assert.equal(stepTo(1, 1, 2), 1);
  assert.equal(stepTo(0, -1, 2), 0);
});

test("What its memory asks: open, by kind, in the notebook's order", () => {
  const { life } = kestrel(NOW);
  assert.deepEqual(asksByKind(life.questions), [
    { kind: "lesson", count: 1, title: "What did it teach?" },
    { kind: "fact", count: 1, title: "Is it still true?" },
    { kind: "impact", count: 1, title: "What did it change?" },
  ]);
  assert.equal(
    newest(life.questions.answered).answer,
    "Still true. Pat said so again last week.",
  );
});

test("Journal and Carrying forward: the newest, and who left it", () => {
  const { life } = kestrel(NOW);
  assert.equal(newest(life.journal).id, "kes-j1");
  const h = newest(life.handoffs);
  assert.equal(h.text, "Ask Pat whether calm days still lead with the tide.");
  assert.equal(carriedBy(h, life.identity.model), "The note it left itself");
  assert.equal(
    carriedBy(life.handoffs[1], life.identity.model),
    "Left by Sonnet 5, a colleague",
  );
});

test("Made lately: its pictures newest first, each with the hour that made it", () => {
  const { life } = kestrel(NOW);
  const pictures = picturesOf(life);
  assert.deepEqual(
    pictures.map((p) => [p.path, p.name, p.hour?.id ?? null]),
    [
      ["tide-chart.png", "tide-chart", "kes-h1"],
      ["night-sky.png", "night-sky", "kes-h2"],
    ],
  );
  assert.deepEqual(
    picturesMadeBy(life, life.hours[0]).map((p) => p.path),
    ["tide-chart.png"],
  );
  assert.deepEqual(picturesMadeBy(life, life.hours[2]), []);
  // Stepping through four pictures stops at either end.
  assert.equal(stepTo(3, 1, 4), 3);
  assert.equal(stepTo(2, 1, 4), 3);
  assert.equal(stepTo(0, -1, 4), 0);
});

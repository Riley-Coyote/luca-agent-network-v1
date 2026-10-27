import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMindEntries,
  dayLabel,
  emptyDaysLine,
  firstLine,
  firstLines,
  forYouOrOwn,
  groupMindDays,
  presentKinds,
} from "./mindStream.ts";

const NOW = Date.parse("2026-10-26T15:00:00");
const today = (h, m = 0) =>
  Math.floor(new Date(2026, 9, 26, h, m).getTime() / 1000);
const yesterday = (h) => Math.floor(new Date(2026, 9, 25, h).getTime() / 1000);

function input(overrides = {}) {
  return {
    notebook: [],
    engrams: [],
    records: [],
    artifacts: [],
    memberChannelIds: new Set(["general"]),
    channelNames: new Map([
      ["general", "general"],
      ["engineering", "engineering"],
    ]),
    ...overrides,
  };
}

test("firstLine drops heading marks and bullets", () => {
  assert.equal(firstLine("## Working note\n\nBody"), "Working note");
  assert.equal(firstLine("\n- a point"), "a point");
  assert.equal(
    firstLines("## Head\n\nOne.\n- two\n- three"),
    "One. · two · three",
  );
});

test("the For you rule: a member's conversation, else their own", () => {
  assert.equal(forYouOrOwn("general", new Set(["general"])), "you");
  assert.equal(forYouOrOwn("engineering", new Set(["general"])), "own");
  assert.equal(forYouOrOwn(null, new Set(["general"])), "own");
});

test("speech collapses to one line per conversation per day; signals go", () => {
  const records = [
    {
      id: "1",
      family: "speech",
      verb: "Posted a message",
      object: "a",
      channelId: "general",
      createdAt: today(9),
    },
    {
      id: "2",
      family: "speech",
      verb: "Posted a message",
      object: "b",
      channelId: "general",
      createdAt: today(10),
    },
    {
      id: "3",
      family: "speech",
      verb: "Posted a message",
      object: "c",
      channelId: "general",
      createdAt: yesterday(10),
    },
    {
      id: "4",
      family: "signal",
      verb: "Reacted",
      object: null,
      channelId: "general",
      createdAt: today(11),
    },
    {
      id: "5",
      family: "code",
      verb: "Opened a pull request",
      object: "Fix the build",
      channelId: "engineering",
      createdAt: today(8),
    },
  ];
  const entries = buildMindEntries(input({ records }));
  const texts = entries.map((entry) => `${entry.kind}|${entry.text}`);
  assert.deepEqual(texts, [
    "you|Talked in general · 2 messages",
    "own|Opened a pull request: Fix the build",
    "you|Talked in general · 1 message",
  ]);
});

test("journal pages carry their annotations; memory reads Kept", () => {
  const notebook = [
    {
      itemId: "p",
      kind: "journal_page",
      status: "active",
      authorship: "resident",
      title: "A night",
      body: "Quiet.\nStill.",
      sourcePageIds: [],
      createdAt: "2026-10-26T04:05:00",
    },
    {
      itemId: "a",
      kind: "journal_annotation",
      status: "active",
      authorship: "owner",
      title: null,
      body: "Keep this.",
      sourcePageIds: ["p"],
      createdAt: "2026-10-26T05:00:00",
    },
    {
      itemId: "n",
      kind: "memory_note",
      status: "active",
      authorship: "resident",
      title: null,
      body: "Sam reads after lunch",
      sourcePageIds: [],
      createdAt: "2026-10-26T07:58:00",
    },
    {
      itemId: "old",
      kind: "memory_note",
      status: "forgotten",
      authorship: "resident",
      title: null,
      body: "Gone",
      sourcePageIds: [],
      createdAt: "2026-10-26T07:00:00",
    },
  ];
  const engrams = [
    { slug: "tide", body: "Tide tables matter", createdAt: today(6) },
  ];
  const entries = buildMindEntries(input({ notebook, engrams }));
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["Kept: Sam reads after lunch", "Kept: Tide tables matter", "A night"],
  );
  const page = entries.find((entry) => entry.kind === "journal");
  assert.equal(page.excerpt, "Quiet. Still.");
  assert.deepEqual(page.annotations, ["Keep this."]);
});

test("what they made is For you or their own by its conversation", () => {
  const artifacts = [
    {
      id: "x",
      title: "tide.png",
      kind: "image",
      summary: null,
      currentVersion: 1,
      conversationId: "general",
      createdAt: "2026-10-26T03:30:00",
    },
    {
      id: "y",
      title: "notes.md",
      kind: "markdown",
      summary: "Release notes",
      currentVersion: 2,
      conversationId: "elsewhere",
      createdAt: "2026-10-26T03:00:00",
    },
  ];
  const entries = buildMindEntries(input({ artifacts }));
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.text, entry.made.id]),
    [
      ["you", "tide.png", "x"],
      ["own", "Release notes", "y"],
    ],
  );
});

test("days group newest first and filters keep only their kind", () => {
  const records = [
    {
      id: "1",
      family: "work",
      verb: "Finished a job",
      object: null,
      channelId: "general",
      createdAt: today(9),
    },
    {
      id: "2",
      family: "work",
      verb: "Accepted a job",
      object: null,
      channelId: "engineering",
      createdAt: yesterday(9),
    },
  ];
  const entries = buildMindEntries(input({ records }));
  const all = groupMindDays(entries, "all", NOW);
  assert.deepEqual(
    all.map((day) => day.label),
    ["Today", "Yesterday"],
  );
  const own = groupMindDays(entries, "own", NOW);
  assert.deepEqual(
    own.map((day) => day.label),
    ["Yesterday"],
  );
  assert.deepEqual([...presentKinds(entries)].sort(), ["own", "you"]);
});

test("day labels: today, yesterday, then dates", () => {
  assert.equal(dayLabel(today(1) * 1000, NOW), "Today");
  assert.equal(dayLabel(yesterday(1) * 1000, NOW), "Yesterday");
  assert.notEqual(dayLabel(Date.parse("2026-10-20T10:00:00"), NOW), "Today");
});

test("an empty Notebook says what it holds", () => {
  assert.equal(
    emptyDaysLine("Atlas"),
    "Atlas's days will gather here: what they do for you, their own work, their journal.",
  );
});

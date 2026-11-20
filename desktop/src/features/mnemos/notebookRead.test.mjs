import assert from "node:assert/strict";
import test from "node:test";

import {
  AWAY_MS,
  arrange,
  filtersFor,
  heatOf,
  readingsOf,
  temperature,
  visitSince,
} from "./memoryArrange.ts";
import {
  answeredKey,
  beliefKey,
  dayName,
  dayWords,
  leftKey,
  logDays,
  spanWords,
} from "./notebookLog.ts";
import {
  draftKey,
  forgetDraft,
  holdsMindWords,
  keepDraft,
  letGoMindWordsDrafts,
  mindWordsDraftKey,
  readDraft,
} from "./drafts.ts";
import { possessive, restsOnWords } from "./notebookWords.ts";
import { showing, sightReader } from "./readOnSight.ts";

const NOW = Date.UTC(2026, 10, 20, 15, 0);
const H = 36e5;
const iso = (t) => new Date(t).toISOString();

/** A made-up memory, with only what the rules read. */
const mem = (id, o = {}) => ({
  id,
  born: iso(NOW - (o.ago ?? 0)),
  content: `Memory ${id}.`,
  impact: "",
  state: o.state ?? "active",
  author: "agent",
  acc: o.acc ?? 0.5,
  touched: null,
  kind: "",
  lesson: o.lesson ?? false,
  standing: o.standing ?? false,
  asked: o.asked ?? false,
  model: o.model ?? "claude-opus-5-5",
  recalls: o.recalls ?? 0,
  ties: o.ties ?? [],
  strength: o.strength,
  stability: o.stability,
});

const hour = (id, endAgo, trail) => ({
  id,
  kind: "mine",
  practice: false,
  status: "done",
  reason: "",
  start: iso(NOW - endAgo - H),
  end: iso(NOW - endAgo),
  minutes: 60,
  model: "",
  modelName: "",
  tokens: null,
  untouched: null,
  journal: [],
  notes: [],
  made: [],
  said: "",
  refused: [],
  trail: { woke: [], waiting: [], reached: [], ...trail },
});

test("filters and sorts are the notebook's own", () => {
  const all = [
    mem("a", { ago: 1 * H, lesson: true, recalls: 2, acc: 0.2 }),
    mem("b", { ago: 30 * H, standing: true, recalls: 9, acc: 0.9 }),
    mem("c", { ago: 60 * H, asked: true, model: "claude-sonnet-5" }),
    mem("d", { ago: 90 * H, state: "dormant", ties: [["a"], ["b"], ["c"]] }),
    mem("e", { ago: 2 * H, state: "archived" }),
  ];
  const ctx = {
    since: NOW - 24 * H,
    heat: heatOf([hour("h", 2 * H, { reached: ["c"] })], NOW),
    model: "claude-opus-5-5",
  };
  const ids = (filter, sort = "newest") =>
    arrange(all, filter, sort, ctx).map((m) => m.id);
  assert.deepEqual(ids("all"), ["a", "b", "c", "d"], "never the archived");
  assert.deepEqual(ids("new"), ["a"], "formed since the last visit");
  assert.deepEqual(ids("warm"), ["c"], "lit by an hour lately");
  assert.deepEqual(ids("lessons"), ["a"]);
  assert.deepEqual(ids("standing"), ["b"]);
  assert.deepEqual(ids("asked"), ["c"]);
  assert.deepEqual(ids("quiet"), ["d"]);
  assert.deepEqual(ids("colleagues"), ["c"], "signed by another model");
  assert.deepEqual(ids("all", "oldest"), ["d", "c", "b", "a"]);
  assert.deepEqual(ids("all", "recalled"), ["b", "a", "c", "d"]);
  assert.equal(ids("all", "connected")[0], "d");
  assert.equal(ids("all", "easiest")[0], "b");

  assert.deepEqual(
    filtersFor(all, ctx).map((f) => [f.id, f.n]),
    [
      ["all", 4],
      ["new", 1],
      ["warm", 1],
      ["lessons", 1],
      ["standing", 1],
      ["asked", 1],
      ["quiet", 1],
      ["colleagues", 1],
    ],
  );
  // Every filter stays, at 0 when it holds nothing; New only once the
  // last visit is known.
  const plain = filtersFor([mem("x", { ago: 50 * H })], {
    since: 0,
    heat: new Map(),
    model: "claude-opus-5-5",
  }).map((f) => [f.id, f.n]);
  assert.deepEqual(plain, [
    ["all", 1],
    ["warm", 0],
    ["lessons", 0],
    ["standing", 0],
    ["asked", 0],
    ["quiet", 0],
    ["colleagues", 0],
  ]);
});

test("warmth cools with a six-hour half-life, and adds the way light does", () => {
  assert.equal(temperature({ end: iso(NOW) }, NOW), 1);
  assert.ok(Math.abs(temperature({ end: iso(NOW - 6 * H) }, NOW) - 0.5) < 1e-9);
  assert.equal(temperature({ end: null }, NOW), 0);
  const heat = heatOf(
    [
      hour("h1", 0, { reached: ["m"], woke: ["w"] }),
      hour("h2", 6 * H, { reached: ["m"] }),
      hour("cold", 80 * H, { reached: ["z"] }),
    ],
    NOW,
  );
  assert.equal(heat.get("m"), 1, "never more than white");
  assert.ok(Math.abs(heat.get("w") - 0.42) < 1e-9);
  assert.equal(heat.has("z"), false, "an hour long cold warms nothing");
});

test("a visit begins after half an hour away", () => {
  const kept = new Map();
  const store = {
    get: (k) => kept.get(k) ?? null,
    set: (k, v) => kept.set(k, v),
  };
  assert.equal(visitSince("kes", NOW, store), 0, "a first visit has no since");
  // Back within half an hour: the same visit, still no since.
  assert.equal(visitSince("kes", NOW + 10 * 60_000, store), 0);
  // Away longer: since is when the last visit was last seen.
  const back = NOW + 10 * 60_000 + AWAY_MS + 1;
  assert.equal(visitSince("kes", back, store), NOW + 10 * 60_000);
  assert.equal(visitSince("kes", back + 1000, store), NOW + 10 * 60_000);
  // Each mind its own; a store that throws costs nothing.
  assert.equal(visitSince("ori", back, store), 0);
  const broken = {
    get: () => {
      throw new Error("no");
    },
    set: () => {
      throw new Error("no");
    },
  };
  assert.equal(visitSince("kes", NOW, broken), 0);
  assert.equal(visitSince("kes", NOW, null), 0);
  assert.ok(
    [...kept.values()].every((v) => /^\{"since":\d+,"seen":\d+\}$/.test(v)),
  );
});

test("a memory's readings: its own numbers, and links to memories in view", () => {
  const m = mem("a", {
    acc: 0.7,
    recalls: 4,
    strength: 0.8,
    ties: [["b"], ["c"], ["gone"]],
  });
  assert.deepEqual(readingsOf(m, new Set(["a", "b", "c"])), {
    strength: 0.8,
    stability: 0.5,
    reach: 0.7,
    links: 2,
    recalled: 4,
  });
});

test("the log gathers a mind's days, newest first, each thing once", () => {
  const life = {
    hours: [
      {
        ...hour("h1", 2 * H, {}),
        journal: [],
      },
    ],
    journal: [
      {
        id: "j1",
        at: iso(NOW - 3 * H),
        text: "A.",
        mood: "",
        written: "",
        model: "",
      },
      {
        id: "j2",
        at: iso(NOW - 2.5 * H),
        text: "In the hour.",
        mood: "",
        written: "",
        model: "",
        hour: "h1",
      },
    ],
    notes: [
      {
        id: "n1",
        at: iso(NOW - 26 * H),
        kind: "",
        text: "Q?",
        author: "agent",
        model: "",
        replyTo: "",
        delivered: null,
        read: null,
      },
      {
        id: "n2",
        at: iso(NOW - 25 * H),
        kind: "",
        text: "A.",
        author: "person",
        model: "",
        replyTo: "n1",
        delivered: null,
        read: null,
      },
    ],
    handoffs: [{ text: "Carry.", at: iso(NOW - 4 * H), model: "" }],
    questions: {
      open: 0,
      byKind: {},
      asked: [],
      answered: [
        {
          kind: "lesson",
          prompt: "What?",
          excerpt: "",
          answer: "This.",
          at: iso(NOW - 27 * H),
          about: "",
        },
      ],
    },
    beliefs: [
      {
        text: "B.",
        confidence: 0.6,
        born: null,
        revised: null,
        revisions: 1,
        history: [{ at: iso(NOW - 5 * H), from: 0.5, to: 0.6 }],
        supports: [],
      },
    ],
  };
  const memories = [
    mem("m1", { ago: 1 * H }),
    mem("m2", { ago: 1.5 * H }),
    mem("m3", { ago: 28 * H }),
    mem("gone", { ago: 1 * H, state: "archived" }),
  ];
  const days = logDays(life, memories);
  const today = days.find((d) => d.events.some((e) => e.type === "hour"));
  assert.ok(today);
  const types = today.events.map((e) => e.type);
  assert.ok(types.includes("journal"), "a journal entry of its own");
  assert.equal(
    today.events.filter((e) => e.type === "journal").length,
    1,
    "an entry written in an hour is the hour's",
  );
  assert.ok(types.includes("left") && types.includes("belief"));
  const theHour = today.events.find((e) => e.type === "hour");
  assert.deepEqual(
    theHour.journal.map((e) => e.id),
    ["j2"],
    "the hour carries what was written in it",
  );
  const formed = today.events.find((e) => e.type === "formed");
  assert.deepEqual(
    formed.memories.map((m) => m.id),
    ["m1", "m2"],
    "formed today, never the archived",
  );
  // Newest first within the day and across days.
  const times = days.flatMap((d) => d.events.map((e) => Date.parse(e.at)));
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
  // Every note opens its thread; the keys are the sections' own.
  const notes = days.flatMap((d) => d.events).filter((e) => e.type === "note");
  assert.deepEqual(
    notes.map((e) => e.thread),
    ["n1", "n1"],
  );
  const keyed = days.flatMap((d) => d.events).filter((e) => "key" in e);
  assert.deepEqual(keyed.map((e) => e.key.replace(/-.*$/, "")).sort(), [
    "#answered",
    "#belief",
    "#left",
  ]);
  assert.match(
    dayWords(today),
    /2 memories · 1 quiet hour · 2 journal entries/,
  );
  const now = new Date(NOW);
  assert.equal(dayName(iso(NOW), now), "Today");
  assert.equal(dayName(iso(NOW - 24 * H), now), "Yesterday");
});

test("a note is read after 1.2 seconds mostly on screen, with someone looking", () => {
  // The 60% rule: of the note, or of the screen when the note is taller.
  assert.equal(
    showing({ intersecting: true, shownHeight: 60, height: 100 }, 800),
    true,
  );
  assert.equal(
    showing({ intersecting: true, shownHeight: 59, height: 100 }, 800),
    false,
  );
  assert.equal(
    showing({ intersecting: true, shownHeight: 480, height: 2000 }, 800),
    true,
  );
  assert.equal(
    showing({ intersecting: false, shownHeight: 100, height: 100 }, 800),
    false,
  );

  // A made-up clock.
  let now = 0;
  const timers = new Map();
  let next = 1;
  const setTimer = (run, ms) => {
    const id = next++;
    timers.set(id, { at: now + ms, run });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = until;
  };
  const said = [];
  let looking = false;
  const reader = sightReader({
    read: async (ids) => said.push(ids),
    looking: () => looking,
    setTimer,
    clearTimer,
  });
  // Nobody has touched the page: nothing counts.
  reader.shown("n1", true);
  advance(5000);
  assert.deepEqual(said, []);
  looking = true;
  reader.shown("n1", false);
  reader.shown("n1", true);
  advance(1199);
  assert.deepEqual(said, [], "not before 1.2 seconds");
  // Scrolled away before then: the clock starts over.
  reader.shown("n1", false);
  advance(1000);
  reader.shown("n1", true);
  reader.shown("n2", true);
  advance(1200);
  assert.deepEqual(said, [], "said a moment after, together");
  advance(300);
  assert.deepEqual(said, [["n1", "n2"]]);
  // Said once only.
  reader.shown("n1", false);
  reader.shown("n1", true);
  advance(5000);
  assert.equal(said.length, 1);
  // The window hid while it was showing: it isn't read.
  reader.shown("n3", true);
  advance(600);
  looking = false;
  reader.pause();
  advance(5000);
  assert.equal(said.length, 1);
  // Hidden at the moment it would be read: not read either.
  looking = true;
  reader.shown("n4", true);
  advance(1000);
  looking = false;
  advance(5000);
  assert.equal(said.length, 1);
});

test("a read that fails leaves the note unread, for the next look", async () => {
  const unseen = [];
  let fail = true;
  const calls = [];
  const reader = sightReader({
    read: async (ids) => {
      calls.push(ids);
      if (fail) throw new Error("no");
    },
    looking: () => true,
    onUnseen: (id) => unseen.push(id),
    setTimer: (run) => {
      queueMicrotask(run);
      return 0;
    },
    clearTimer: () => {},
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  reader.shown("n1", true);
  await settle();
  assert.deepEqual(unseen, ["n1"]);
  assert.equal(reader.said("n1"), false);
  // Still on screen (its dot back, looked at again): not tried again, so
  // a failing read never runs in a loop.
  reader.shown("n1", true);
  reader.shown("n1", true);
  await settle();
  assert.deepEqual(calls, [["n1"]]);
  // It leaves the screen and comes back: the next sight tries again.
  reader.shown("n1", false);
  reader.shown("n1", true);
  await settle();
  assert.deepEqual(calls, [["n1"], ["n1"]]);
  assert.equal(reader.said("n1"), false, "failed again");
  // The window hid and showed again: a new sight too.
  fail = false;
  reader.shown("n1", true);
  await settle();
  assert.equal(calls.length, 2);
  reader.pause();
  reader.shown("n1", true);
  await settle();
  assert.deepEqual(calls, [["n1"], ["n1"], ["n1"]]);
  assert.equal(reader.said("n1"), true);
});

test("a draft made of the mind's words goes with them; the owner's own stay", () => {
  const note = draftKey("kestrel", "note");
  const reply = draftKey("kestrel", "reply:kes-n1");
  const correct = mindWordsDraftKey("kestrel", "correct:kes-m01");
  const other = mindWordsDraftKey("wren", "correct:w1");
  keepDraft(note, "Calm days too, please.");
  keepDraft(reply, "Yes, lead with it.");
  keepDraft(correct, "Pat reads the tide chart first, then the weather.");
  keepDraft(other, "Edited words.");
  // Shared's two fields keep the one rule: a correction holds another's
  // words and goes; an addition is the owner's own and stays.
  const sharedCorrect = mindWordsDraftKey("kestrel", "shared:correct:kes-s1");
  const sharedAdd = draftKey("kestrel", "shared:add");
  keepDraft(sharedCorrect, "We keep the harbour log in ink now.");
  keepDraft(sharedAdd, "My own words, not sent yet.");
  assert.equal(holdsMindWords(sharedCorrect), true);
  assert.equal(holdsMindWords(sharedAdd), false);
  assert.equal(holdsMindWords(correct), true);
  assert.equal(holdsMindWords(note), false);
  assert.notEqual(correct, draftKey("kestrel", "correct:kes-m01"));
  // Leaving the place, or the window hiding: the mind's words go.
  letGoMindWordsDrafts();
  assert.equal(readDraft(correct), undefined);
  assert.equal(readDraft(other), undefined);
  assert.equal(readDraft(sharedCorrect), undefined);
  // The owner's own words are kept exactly as before.
  assert.equal(readDraft(note), "Calm days too, please.");
  assert.equal(readDraft(reply), "Yes, lead with it.");
  assert.equal(readDraft(sharedAdd), "My own words, not sent yet.");
  forgetDraft(note);
  forgetDraft(reply);
  forgetDraft(sharedAdd);
});

test("a name as its owner's: an s takes only the apostrophe", () => {
  assert.equal(possessive("Kestrel"), "Kestrel’s");
  assert.equal(possessive("Field Notes"), "Field Notes’");
  assert.equal(possessive("Wren"), "Wren’s");
  assert.equal(possessive("JAMES"), "JAMES’");
});

test("a thing with no id is keyed by itself, so an insert never moves a link", () => {
  const at = (h) => iso(NOW - h * H);
  const lists = [
    [
      leftKey,
      [
        { text: "Carry the tide.", at: at(3) },
        { text: "Check the buoy.", at: at(30) },
      ],
      { text: "A new note to itself.", at: at(10) },
    ],
    [
      beliefKey,
      [
        { text: "The tide comes first.", born: at(100) },
        { text: "Fog and ferries.", born: at(50) },
      ],
      { text: "A new belief.", born: at(70) },
    ],
    [
      answeredKey,
      [
        { prompt: "What did it teach?", answer: "This.", at: at(5) },
        { prompt: "Still true?", answer: "Yes.", at: at(9) },
      ],
      { prompt: "What did it change?", answer: "That.", at: at(7) },
    ],
  ];
  for (const [key, before, inserted] of lists) {
    const keys = before.map(key);
    assert.equal(new Set(keys).size, keys.length, "each its own key");
    // One inserted in the middle: every old key still names its own thing.
    const after = [before[0], inserted, before[1]];
    for (const [i, k] of keys.entries())
      assert.equal(
        after.find((each) => key(each) === k),
        before[i],
        `${k} still opens the same thing`,
      );
    // Gone, its key names nothing, never a neighbour.
    assert.equal(
      [inserted, before[1]].find((each) => key(each) === keys[0]),
      undefined,
    );
    // Same time, other words: another key.
    const twin = { ...before[0], text: "x", prompt: "x" };
    assert.notEqual(key(twin), keys[0]);
  }
});

test("an hour's span, as the notebook says one", () => {
  const d = (h, m) => new Date(2026, 10, 20, h, m).toISOString();
  assert.equal(spanWords(d(1, 26), d(1, 56)), "1:26 to 1:56 AM");
  assert.equal(spanWords(d(11, 40), d(12, 20)), "11:40 AM to 12:20 PM");
  assert.equal(spanWords(d(13, 5), null), "1:05 PM");
  assert.equal(spanWords(null, d(1, 0)), "");
});

test("what a belief rests on agrees with what is under it", () => {
  const own = { model: "claude-opus-5-5" };
  const sonnet = { model: "claude-sonnet-5" };
  const me = "claude-opus-5-5";
  assert.equal(restsOnWords([], me), "resting on no memory in view");
  assert.equal(restsOnWords([own], me), "rests on a memory of its own");
  assert.equal(
    restsOnWords([own, own], me),
    "rests on two memories of its own",
  );
  assert.equal(
    restsOnWords([sonnet], me),
    "rests on a memory Sonnet 5 wrote, a colleague",
  );
  assert.equal(
    restsOnWords([own, sonnet], me),
    "rests on a memory of its own and one Sonnet 5 wrote, a colleague",
  );
  assert.equal(
    restsOnWords([sonnet, own, sonnet], me),
    "rests on a memory of its own and two memories Sonnet 5 wrote, a colleague",
  );
  // A memory with no signature is counted as its own, as the notebook does.
  assert.equal(restsOnWords([{}], me), "rests on a memory of its own");
});

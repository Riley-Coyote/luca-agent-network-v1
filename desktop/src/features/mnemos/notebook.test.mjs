import assert from "node:assert/strict";
import test from "node:test";

import {
  bookOf,
  entryOf,
  memoryOf,
  noteOf,
  writeFailure,
  writesOf,
} from "./adapt.ts";
import {
  afterLetGo,
  countPerDay,
  fieldState,
  MAX_TEXT,
  dayLine,
  foundWords,
  goneQuiet,
  newestFirst,
  newestFirstPage,
  railLine,
  signedBy,
  stateLine,
  threads,
  titleOf,
  unread,
  waitingOnYou,
  withNote,
} from "./notebook.ts";

const note = (id, at, author, text, replyTo = "", read = null) => ({
  id,
  at,
  kind: "",
  text,
  author,
  model: "",
  replyTo,
  delivered: null,
  read,
});

test("notes gather into threads by what each answers, newest thread first", () => {
  const list = threads([
    note("a", "2026-11-10T10:00:00Z", "agent", "Did the move go well?"),
    note("b", "2026-11-11T10:00:00Z", "person", "It did.", "a"),
    note("c", "2026-11-12T09:00:00Z", "agent", "Should I keep the old notes?"),
    note("d", "2026-11-12T10:00:00Z", "person", "Thanks for yesterday."),
    note("e", "2026-11-11T12:00:00Z", "agent", "Glad.", "b"),
  ]);
  assert.deepEqual(
    list.map((t) => [t.id, t.notes.map((n) => n.id)]),
    [
      ["d", ["d"]],
      ["c", ["c"]],
      ["a", ["a", "b", "e"]],
    ],
  );
  assert.equal(list[2].last.id, "e");
});

test("what waits on you: the mind's last word ends in a question", () => {
  const list = threads([
    note("a", "2026-11-10T10:00:00Z", "agent", "Did the move go well?"),
    note("b", "2026-11-11T10:00:00Z", "person", "It did.", "a"),
    note(
      "c",
      "2026-11-12T09:00:00Z",
      "agent",
      "Should I keep the old notes?  ",
    ),
    note("d", "2026-11-12T10:00:00Z", "agent", "I kept them."),
  ]);
  assert.deepEqual(
    waitingOnYou(list).map((t) => t.id),
    ["c"],
  );
});

test("unread is the mind's note with no read time; the person's never are", () => {
  assert.equal(unread(note("a", null, "agent", "hi")), true);
  assert.equal(unread(note("a", null, "agent", "hi", "", "2026-11-12")), false);
  assert.equal(unread(note("a", null, "person", "hi")), false);
});

test("newest first: pages asked from the end of an oldest-first list", () => {
  assert.deepEqual(newestFirstPage(120, 0, 50), { offset: 70, limit: 50 });
  assert.deepEqual(newestFirstPage(120, 1, 50), { offset: 20, limit: 50 });
  assert.deepEqual(newestFirstPage(120, 2, 50), { offset: 0, limit: 20 });
  assert.equal(newestFirstPage(120, 3, 50), null);
  assert.equal(newestFirstPage(0, 0, 50), null);
  assert.deepEqual(newestFirstPage(3, 0, 5), { offset: 0, limit: 3 });
  assert.deepEqual(
    newestFirst([{ id: "old" }, { id: "new" }]).map((m) => m.id),
    ["new", "old"],
  );
});

test("counts per day, in the viewer's own days, and every day to today", () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const days = countPerDay([
    { born: at(2026, 11, 14) },
    { born: at(2026, 11, 14, 23) },
    { born: at(2026, 11, 16) },
    { born: null },
    { born: "not a date" },
  ]);
  assert.deepEqual(
    [...days.entries()],
    [
      ["2026-11-14", 2],
      ["2026-11-16", 1],
    ],
  );
  const line = dayLine(days, new Date(2026, 10, 17, 9));
  assert.deepEqual(line, [
    { key: "2026-11-14", count: 2 },
    { key: "2026-11-15", count: 0 },
    { key: "2026-11-16", count: 1 },
    { key: "2026-11-17", count: 0 },
  ]);
  assert.deepEqual(dayLine(new Map()), []);
});

test("the head's state line and the rail's line, from real numbers only", () => {
  const today = new Date(2026, 10, 16, 15);
  const mind = {
    memories: 2804,
    newest: "2026-11-16",
    linked: [{ pubkey: "a", name: "Luca" }],
  };
  assert.equal(
    stateLine(mind, today),
    "2,804 memories it can reach · newest today · Luca remembers with this",
  );
  assert.equal(
    stateLine({ memories: 1, newest: null, linked: [] }, today),
    "1 memory it can reach",
  );
  assert.equal(
    stateLine(
      {
        memories: 2,
        newest: "2026-11-15",
        linked: [
          { pubkey: "a", name: "Luca" },
          { pubkey: "b", name: "Wren" },
        ],
      },
      today,
    ),
    "2 memories it can reach · newest yesterday · Luca and Wren remember with this",
  );
  assert.equal(
    railLine({ memories: 86, newest: "2026-03-02" }, today),
    "86 memories · newest Mar 2",
  );
});

test("the notebook's words: titles, who wrote it, how it was found", () => {
  assert.deepEqual(titleOf("A quiet day. Then the rain came."), {
    title: "A quiet day.",
    body: "Then the rain came.",
  });
  assert.equal(foundWords("meaning"), "by meaning");
  assert.equal(foundWords("words"), "by its words");
  assert.equal(foundWords("link"), "through a link");
  const who = { name: "Wren", model: "claude-opus-5-5" };
  assert.equal(signedBy({ author: "person" }, who), "in your words");
  assert.equal(signedBy({ author: "agent" }, who), "written by Wren");
  assert.equal(
    signedBy({ author: "agent", model: "" }, who),
    "written by Wren before memories were signed",
  );
  assert.equal(
    signedBy({ author: "agent", model: "claude-opus-5-5" }, who),
    "signed Wren",
  );
  assert.equal(
    signedBy({ author: "agent", model: "claude-fable-5-2" }, who),
    "written by Fable 5.2, a colleague",
  );
  assert.equal(
    signedBy({ author: "unknown" }, who),
    "no one can say who wrote it",
  );
});

test("the one adapter: the interface's answers in the notebook's shapes", async () => {
  const wire = {
    id: "m1",
    words: "The lighthouse keeps a log.",
    kept: "2026-11-14T10:00:00Z",
    state: "dormant",
    alive: 0.03,
    corrected: null,
    impact: "",
    author: "agent",
  };
  assert.deepEqual(memoryOf(wire), {
    id: "m1",
    born: "2026-11-14T10:00:00Z",
    content: "The lighthouse keeps a log.",
    impact: "",
    state: "dormant",
    author: "agent",
    acc: 0.03,
    corrected: null,
  });
  assert.equal(memoryOf({ ...wire, author: "someone" }).author, "unknown");
  assert.deepEqual(
    goneQuiet([
      memoryOf(wire),
      memoryOf({ ...wire, id: "m2", state: "active" }),
    ]).map((m) => m.id),
    ["m1"],
  );
  assert.deepEqual(
    noteOf({
      id: "n1",
      kind: null,
      text: "Hi?",
      author: "agent",
      model: null,
      in_reply_to: null,
      created_at: "2026-11-14T10:00:00Z",
      read_at: null,
    }),
    note("n1", "2026-11-14T10:00:00Z", "agent", "Hi?"),
  );
  assert.equal(
    entryOf({
      id: "j1",
      text: "x",
      mood: null,
      written: "between_sessions",
      model: "claude-opus-5-5",
      created_at: "2026-11-14T10:00:00Z",
    }).mood,
    "",
  );
  const asked = [];
  const book = bookOf(async (request) => {
    asked.push(request);
    if (request.command === "journal")
      return {
        kind: "journal",
        entries: [
          {
            id: "old",
            text: "a",
            mood: null,
            written: null,
            model: null,
            created_at: "2026-11-01T00:00:00Z",
          },
          {
            id: "new",
            text: "b",
            mood: null,
            written: null,
            model: null,
            created_at: "2026-11-02T00:00:00Z",
          },
        ],
      };
    return {
      kind: "memories",
      memories: [wire],
      counts: { active: 5, dormant: 1, archived: 2 },
    };
  });
  assert.deepEqual(
    (await book.journal(2)).map((e) => e.id),
    ["new", "old"],
  );
  assert.deepEqual(await book.facts(), {
    states: { active: 5, dormant: 1, archived: 2 },
  });
  assert.deepEqual(asked[1], { command: "memories", limit: 0, offset: 0 });
  await assert.rejects(() => book.notes(), /invalid_reply/);
});

test("the field: a count only near the limit, and no sending past it or empty", () => {
  assert.deepEqual(fieldState(""), {
    count: null,
    over: false,
    canSend: false,
  });
  assert.deepEqual(fieldState("   \n"), {
    count: null,
    over: false,
    canSend: false,
  });
  assert.deepEqual(fieldState("Yes, keep them."), {
    count: null,
    over: false,
    canSend: true,
  });
  assert.equal(fieldState("x".repeat(14_999)).count, null);
  assert.deepEqual(fieldState("x".repeat(15_000)), {
    count: "1,384 left",
    over: false,
    canSend: true,
  });
  assert.deepEqual(fieldState("x".repeat(MAX_TEXT)), {
    count: "0 left",
    over: false,
    canSend: true,
  });
  assert.deepEqual(fieldState("x".repeat(MAX_TEXT + 2)), {
    count: "2 over",
    over: true,
    canSend: false,
  });
  // Counted as Mnemos counts: characters, not UTF-16 halves.
  assert.equal(fieldState("😀".repeat(MAX_TEXT)).over, false);
});

test("the thread after a send: the answer in it at once, its question read", () => {
  const before = [
    note("q", "2026-11-12T09:00:00Z", "agent", "Should I keep the old notes?"),
    note("x", "2026-11-10T09:00:00Z", "agent", "Another."),
  ];
  const answer = note("r", "2026-11-20T10:00:00Z", "person", "Keep them.", "q");
  const after = withNote(before, answer);
  assert.equal(after.length, 3);
  assert.equal(after.find((n) => n.id === "q").read, "2026-11-20T10:00:00Z");
  assert.equal(after.find((n) => n.id === "x").read, null);
  const thread = threads(after).find((t) => t.id === "q");
  assert.deepEqual(
    thread.notes.map((n) => n.id),
    ["q", "r"],
  );
  assert.equal(thread.waits, false);
  assert.equal(unread(after.find((n) => n.id === "q")), false);
  // Kept once, even if the same answer comes back twice.
  assert.equal(withNote(after, answer).length, 3);
  // A note of the person's own starts its own thread.
  const own = note("n", "2026-11-20T11:00:00Z", "person", "Morning.");
  assert.ok(threads(withNote(after, own)).some((t) => t.id === "n"));
});

test("counts after a memory is let go: one fewer where it was, one more let go", () => {
  const facts = { states: { active: 115, dormant: 6, archived: 3 } };
  assert.deepEqual(afterLetGo(facts, "active").states, {
    active: 114,
    dormant: 6,
    archived: 4,
  });
  assert.deepEqual(afterLetGo(facts, "dormant").states, {
    active: 115,
    dormant: 5,
    archived: 4,
  });
  assert.equal(afterLetGo(facts, "archived"), facts);
  assert.deepEqual(facts.states, { active: 115, dormant: 6, archived: 3 });
});

test("the four writes: one send each, in the notebook's shapes, failures by kind", async () => {
  const sent = [];
  const wireNote = {
    id: "r",
    kind: "reply",
    text: "Keep them.",
    author: "person",
    model: null,
    in_reply_to: "q",
    created_at: "2026-11-20T10:00:00Z",
    read_at: null,
    delivered_at: null,
  };
  const writes = writesOf(async (write) => {
    sent.push(write);
    if (write.command === "reply" || write.command === "note")
      return { kind: "note", note: wireNote };
    if (write.command === "correct")
      return {
        kind: "corrected",
        id: "new",
        replaces: write.memory_id,
        corrected: "2026-11-20T10:00:00Z",
      };
    return { kind: "forgotten", id: write.memory_id, forgotten: null };
  });
  assert.equal((await writes.reply("q", "Keep them.")).replyTo, "q");
  assert.equal((await writes.note("Morning.")).author, "person");
  assert.deepEqual(await writes.correct("m1", "Better words."), {
    id: "new",
    replaces: "m1",
    corrected: "2026-11-20T10:00:00Z",
  });
  await writes.forget("m2");
  assert.deepEqual(sent, [
    { command: "reply", note_id: "q", text: "Keep them." },
    { command: "note", text: "Morning." },
    { command: "correct", memory_id: "m1", text: "Better words." },
    { command: "forget", memory_id: "m2" },
  ]);

  const quiet =
    "Nothing saved: A reply is the person's own words, and no one is in the room during one of the agent's hours.";
  let tries = 0;
  const refusing = writesOf(async () => {
    tries++;
    throw `mnemos_refused:${quiet}`;
  });
  await assert.rejects(
    () => refusing.reply("q", "Hello"),
    (failure) => failure.kind === "said" && failure.said === quiet,
  );
  assert.equal(tries, 1, "a refused write is never sent again by itself");
  assert.deepEqual(writeFailure("mnemos_busy"), { kind: "busy" });
  assert.deepEqual(writeFailure(new Error("not_shown")), {
    kind: "failed",
    code: "not_shown",
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import { bookOf, entryOf, memoryOf, noteOf } from "./adapt.ts";
import {
  countPerDay,
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

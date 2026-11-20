import assert from "node:assert/strict";
import test from "node:test";

import {
  bookOfNotebook,
  loadMemories,
  NOTHING_LOADED,
  readerOfNotebook,
  refresh,
} from "./notebookLoad.ts";
import {
  answers,
  givesNotebook,
  helloOf,
  lifeOf,
  memoryPageOf,
  summaryOf,
} from "./notebookShapes.ts";

/** A made-up newer engine: `n` memories in `version`, read in pages, with
 *  a summary whose token the test changes. Counts every request. */
function engine(n, version = "v1") {
  const state = {
    version,
    token: "t1",
    memories: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      content: `Made-up memory ${i}.`,
      state: i === 3 ? "dormant" : "active",
      author: "agent",
      born: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
      standing: i === 1,
      ties: [],
    })),
    asked: [],
    /** Called before a memories page is answered (to change it mid-way). */
    beforePage: null,
  };
  const life = () => ({
    journal: [{ id: "j1", at: "2026-11-19T10:00:00Z", text: "An entry." }],
    notes: [
      {
        id: "n1",
        at: "2026-11-19T11:00:00Z",
        text: "A note?",
        author: "agent",
        read: null,
      },
    ],
    beliefs: [{ text: "A belief.", confidence: 0.7, supports: ["m1"] }],
    handoffs: [{ text: "Carry this.", at: "2026-11-19T09:00:00Z" }],
    memory: {
      states: { active: n - 1, dormant: 1, archived: 0 },
      version: state.version,
      count: n,
    },
  });
  const ask = async (request) => {
    state.asked.push(
      request.command === "notebook"
        ? `${request.part}${request.part === "memories" ? `@${request.offset}` : ""}`
        : request.command,
    );
    if (request.command === "summary")
      return {
        kind: "summary",
        summary: {
          counts: { memories: n, journal: 1 },
          unread: 1,
          waiting: 0,
          change_token: state.token,
        },
      };
    if (request.part === "life")
      return {
        kind: "notebook",
        part: "life",
        document: life(),
        page: null,
        pictures: [],
      };
    if (request.part === "memories") {
      state.beforePage?.(request.offset);
      const slice = state.memories.slice(
        request.offset,
        request.offset + request.limit,
      );
      const end = request.offset + slice.length;
      return {
        kind: "notebook",
        part: "memories",
        document: {
          version: state.version,
          memories: slice,
          ...(request.offset === 0 ? { recalled: ["m2"] } : {}),
        },
        page: {
          offset: request.offset,
          limit: request.limit,
          total: state.memories.length,
          next: end < state.memories.length ? end : null,
        },
        pictures: [],
      };
    }
    throw new Error(`unexpected ${request.command}`);
  };
  return { state, ask };
}

test("memories come in pages of 500, following next", async () => {
  const { state, ask } = engine(1203);
  const all = await loadMemories(ask);
  assert.equal(all.memories.length, 1203);
  assert.equal(all.version, "v1");
  assert.deepEqual(all.recalled, ["m2"]);
  assert.deepEqual(state.asked, [
    "memories@0",
    "memories@500",
    "memories@1000",
  ]);
});

test("memories that change while being read are read again from the start", async () => {
  const { state, ask } = engine(1100);
  let once = true;
  state.beforePage = (offset) => {
    if (offset === 500 && once) {
      once = false;
      state.version = "v2";
      state.memories.push({ id: "m-new", content: "New.", state: "active" });
    }
  };
  const all = await loadMemories(ask);
  assert.equal(all.version, "v2");
  assert.equal(all.memories.length, 1101);
  assert.deepEqual(state.asked, [
    "memories@0",
    "memories@500",
    "memories@0",
    "memories@500",
    "memories@1000",
  ]);
  // Always changing: it gives up rather than show a mix of versions.
  let n = 0;
  state.beforePage = (offset) => {
    if (offset === 500) state.version = `v${3 + n++}`;
  };
  await assert.rejects(() => loadMemories(ask), /notebook_changing/);
});

test("the token loop reads the parts again only when the token changes", async () => {
  const { state, ask } = engine(12);
  let held = NOTHING_LOADED;
  let turn = await refresh(ask, held);
  assert.deepEqual(turn.fetched, ["summary", "life", "memories"]);
  held = turn.next;
  assert.equal(held.memories.memories.length, 12);
  // The same token: the summary only, everything else as it was.
  turn = await refresh(ask, held);
  assert.deepEqual(turn.fetched, ["summary"]);
  assert.equal(turn.next.life, held.life);
  assert.equal(turn.next.memories, held.memories);
  held = turn.next;
  // A new token, the same memories: life again, the memories kept.
  state.token = "t2";
  turn = await refresh(ask, held);
  assert.deepEqual(turn.fetched, ["summary", "life"]);
  assert.equal(turn.next.memories, held.memories);
  held = turn.next;
  // A new token and a new version: the memories too.
  state.token = "t3";
  state.version = "v2";
  turn = await refresh(ask, held);
  assert.deepEqual(turn.fetched, ["summary", "life", "memories"]);
  assert.equal(turn.next.memories.version, "v2");
});

test("the rooms read the notebook the way they read the older interface", async () => {
  const { ask, state } = engine(8);
  const { next } = await refresh(ask, NOTHING_LOADED);
  const book = bookOfNotebook(next.life, next.memories, ask);
  state.asked = [];
  const facts = await book.facts();
  assert.deepEqual(facts.states, { active: 7, dormant: 1, archived: 0 });
  const page = await book.memories({ limit: 3, offset: 0 });
  assert.deepEqual(
    page.memories.map((m) => m.id),
    ["m0", "m1", "m2"],
  );
  const quiet = await book.memories({ state: "dormant", limit: 5, offset: 0 });
  assert.deepEqual(
    quiet.memories.map((m) => m.id),
    ["m3"],
  );
  assert.equal((await book.notes())[0].id, "n1");
  assert.equal((await book.journal(5))[0].id, "j1");
  assert.deepEqual(state.asked, [], "nothing asked of the engine");
  // The old reader's sections, from the notebook.
  const reader = readerOfNotebook(next.life, next.memories);
  assert.equal(reader.kind, "ready");
  assert.deepEqual(
    (await reader.read("standing")).map((i) => i.text),
    ["Made-up memory 1."],
  );
  assert.equal((await reader.read("beliefs"))[0].confidence, 0.7);
  assert.equal((await reader.counts()).handoffs, 1);
});

test("the notebook's shapes are guarded, forgivingly", () => {
  assert.equal(helloOf(null), null);
  assert.equal(helloOf({ commands: [] }), null, "no protocol, no hello");
  const hello = helloOf({
    protocol: 1,
    mnemos: "0.7.0",
    commands: ["notebook", "summary", 3],
    parts: ["life", "memories"],
  });
  assert.deepEqual(hello.commands, ["notebook", "summary"]);
  assert.equal(givesNotebook(hello), true);
  assert.equal(givesNotebook(null), false);
  assert.equal(answers(null, "memories"), true);
  assert.equal(answers(null, "hours"), false);

  const summary = summaryOf({
    counts: { memories: 3, states: { active: 3 }, journal: "x" },
    change_token: "abc",
  });
  assert.deepEqual(summary.counts, { memories: 3 });
  assert.equal(summary.changeToken, "abc");
  assert.equal(summary.unread, 0);

  const page = memoryPageOf(
    {
      version: "v",
      memories: [
        {
          id: "a",
          content: "A.",
          state: "nonsense",
          ties: [["b", "supports", 0.5, null, "agent", 0], [3]],
        },
        { content: "no id" },
        "not a memory",
      ],
    },
    { next: 2 },
  );
  assert.deepEqual(
    page.memories.map((m) => [m.id, m.state, m.ties.length]),
    [["a", "active", 1]],
  );
  assert.equal(page.next, 2);

  const life = lifeOf({
    hours: [
      { id: "h1", kind: "mine", trail: { woke: ["a", 1] } },
      { kind: "no id" },
    ],
    notes: [
      { id: "n", author: "someone", text: "?" },
      { id: "n2", author: "agent", text: "Hi." },
    ],
    questions: {
      asked: [{ id: "q", prompt: "Why?" }],
      answered: [{ prompt: "Was it?", answer: "Yes." }],
      byKind: { lesson: 1, odd: "x" },
    },
    beliefs: [
      { text: "B.", history: [{ at: "2026-11-01", from: 0.5, to: 0.6 }] },
      { text: "" },
    ],
    shared: { rows: [{ id: "s", content: "S." }] },
  });
  assert.equal(life.hours.length, 1);
  assert.deepEqual(life.hours[0].trail, {
    woke: ["a"],
    waiting: [],
    reached: [],
  });
  assert.deepEqual(
    life.notes.map((n) => n.id),
    ["n2"],
  );
  assert.deepEqual(life.questions.byKind, { lesson: 1 });
  assert.equal(life.beliefs.length, 1);
  assert.equal(life.beliefs[0].history[0].to, 0.6);
  assert.equal(life.shared.rows[0].content, "S.");
  assert.equal(life.jev, null);
  assert.deepEqual(life.memory.states, { active: 0, dormant: 0, archived: 0 });
});

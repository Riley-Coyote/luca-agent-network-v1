import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COPY_DIR,
  checkCopy,
  FILES,
} from "../../../../scripts/mnemos-mind-copy.mjs";
import { cellOfMemory, drawingWords, firstLine } from "./drawingShape.ts";
import {
  answerFeed,
  kindOf,
  nothingToDraw,
  REFUSED,
  recalledOf,
} from "./mindFeed.ts";
import { inkOnPaper, MindFrame, memoryStorage } from "./mindFrame.ts";

// ── the copy (WP-50, Decided 1) ──────────────────────────────────────

test("the copy is Mnemos's own files, unchanged, with its notice", () => {
  assert.deepEqual(checkCopy(), []);
  assert.ok(FILES.includes("mind/index.html"));
  assert.ok(FILES.includes("shared/herbarium/specimen.js"));
});

test("a changed, missing or extra file is caught", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mnemos-mind-"));
  try {
    cpSync(COPY_DIR, dir, { recursive: true });
    writeFileSync(path.join(dir, "engine/post.js"), "// changed\n", {
      flag: "a",
    });
    writeFileSync(path.join(dir, "mind/extra.js"), "export {};\n");
    rmSync(path.join(dir, "NOTICE"));
    const problems = checkCopy(dir);
    assert.ok(problems.includes("changed: engine/post.js"), problems);
    assert.ok(problems.includes("not part of the copy: mind/extra.js"));
    assert.ok(problems.includes("no NOTICE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── the feed (Decided 2) ─────────────────────────────────────────────

const root = new URL("http://app.test/mnemos-mind/");
const at = (p) => new URL(p, "http://app.test/mnemos-mind/mind/index.html");

function holdings() {
  const asked = [];
  return {
    asked,
    life: {
      made: "2026-11-20T08:00:00Z",
      identity: { agentId: "heron", name: "Heron" },
      studio: [
        { path: "a.png", bytes: 1, at: null, picture: "data/studio/a.png" },
      ],
      memory: { states: { active: 2, dormant: 0, archived: 0 }, version: "v1" },
    },
    memories: {
      version: "v1",
      memories: [{ id: "m1" }, { id: "m2" }],
      recalled: ["m1"],
    },
    pulse: async (since) => {
      asked.push(since);
      return { now: "2026-11-20T08:00:01Z", events: [] };
    },
  };
}

test("each of the page's requests is known by what it is", () => {
  assert.equal(kindOf(at("../data/life.json"), root), "life");
  assert.equal(kindOf(at("../data/memories.json"), root), "memories");
  assert.equal(kindOf(at("../data/pulse.json?since=x"), root), "pulse");
  assert.equal(kindOf(at("../data/search.json?q=tide"), root), "search");
  assert.equal(kindOf(at("../act"), root), "act");
  assert.equal(kindOf(at("../data/studio/a.png"), root), "other");
  assert.equal(
    kindOf(new URL("https://example.com/data/life.json"), root),
    "other",
  );
});

test("life and memories are answered from what the place holds", async () => {
  const h = holdings();
  const life = await answerFeed(at("../data/life.json"), "GET", root, h);
  assert.equal(life.answered, "memory");
  assert.equal(life.status, 200);
  assert.equal(life.body.identity.name, "Heron");
  // No picture is addressed: the page would load them for its hidden paper.
  assert.equal(life.body.studio[0].picture, null);
  assert.equal(h.life.studio[0].picture, "data/studio/a.png");
  const mem = await answerFeed(at("../data/memories.json"), "GET", root, h);
  assert.equal(mem.answered, "memory");
  assert.deepEqual(mem.body, {
    version: "v1",
    made: "2026-11-20T08:00:00Z",
    memories: [{ id: "m1" }, { id: "m2" }],
    recalled: [],
  });
});

test("the engine's recall log is handed on whole, when the place read it", async () => {
  const h = holdings();
  const log = [
    ["m1", "2026-11-20T07:00:00Z"],
    ["m2", "2026-11-20T07:00:02Z"],
  ];
  h.memories = { ...h.memories, recalledLog: log };
  const mem = await answerFeed(at("../data/memories.json"), "GET", root, h);
  assert.deepEqual(mem.body.recalled, log);
  assert.deepEqual(recalledOf({ memories: [] }), []);
  assert.deepEqual(recalledOf({ recalledLog: "no" }), []);
  assert.deepEqual(
    recalledOf({ recalledLog: [["m1", "t"], ["m2"], [3, "t"], null] }),
    [["m1", "t"]],
  );
});

test("what comes to mind is asked through the session, since a moment", async () => {
  const h = holdings();
  const first = await answerFeed(at("../data/pulse.json"), "GET", root, h);
  const next = await answerFeed(
    at("../data/pulse.json?since=2026-11-20T07:59:57.000Z"),
    "GET",
    root,
    h,
  );
  assert.equal(first.answered, "memory");
  assert.equal(next.answered, "memory");
  assert.deepEqual(h.asked, [null, "2026-11-20T07:59:57.000Z"]);
  const silent = { ...h, pulse: async () => null };
  const none = await answerFeed(at("../data/pulse.json"), "GET", root, silent);
  assert.equal(none.answered, "refused");
  assert.equal(none.status, 503);
});

test("its writes are always refused, and its search is off", async () => {
  const h = holdings();
  for (const method of ["POST", "GET"]) {
    const act = await answerFeed(at("../act"), method, root, h);
    assert.equal(act.answered, "refused");
    assert.equal(act.status, 403);
    assert.equal(act.body.error, REFUSED.act);
  }
  const search = await answerFeed(
    at("../data/search.json?q=tide"),
    "GET",
    root,
    h,
  );
  assert.equal(search.answered, "refused");
  assert.deepEqual(search.body.results, []);
  const other = await answerFeed(at("../data/studio/a.png"), "GET", root, h);
  assert.equal(other.answered, "refused");
  assert.equal(other.status, 404);
  const post = await answerFeed(at("../data/life.json"), "POST", root, h);
  assert.equal(post.answered, "refused");
  assert.deepEqual(h.asked, []);
});

test("once the section has gone, the frame is given nothing", async () => {
  for (const p of [
    "../data/life.json",
    "../data/memories.json",
    "../data/pulse.json",
  ]) {
    const answer = await answerFeed(at(p), "GET", root, null);
    assert.equal(answer.answered, "refused");
    assert.equal(answer.status, 503);
  }
});

// ── teardown under the words rule (Decided 5) ────────────────────────

function fakeDom() {
  const listeners = new Map();
  const blank = { readyState: "complete" };
  const frame = {
    dataset: {},
    removed: false,
    src: "",
    contentDocument: blank,
    contentWindow: { location: { href: "about:blank" } },
    remove() {
      this.removed = true;
    },
  };
  globalThis.document = { createElement: () => frame };
  globalThis.window = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  return { frame, listeners };
}

test("the frame is destroyed, not hidden: its element, its timers, its listener", async () => {
  const { frame, listeners } = fakeDom();
  const host = { append: () => {} };
  const states = [];
  const made = new MindFrame(host, {
    holdings: () => null,
    light: {
      floor: [0, 0, 0],
      fire: [1, 1, 1],
      pulse: [0, 0, 1],
      floorCss: "rgb(0 0 0)",
      invert: false,
    },
    ids: () => [],
    onState: (s) => states.push(s),
    onPick: () => {},
    onLetGo: () => {},
    onHover: () => {},
    shown: true,
  });
  assert.equal(frame.src, "/mnemos-mind/mind/index.html?behind");
  assert.ok(listeners.has("message"));
  made.destroy();
  made.destroy();
  assert.equal(frame.removed, true);
  assert.equal(listeners.has("message"), false);
  await new Promise((done) => setTimeout(done, 20));
  // Nothing it started speaks after it has gone.
  assert.deepEqual(states, []);
  delete globalThis.document;
  delete globalThis.window;
});

// ── shown and not (review, 2) ────────────────────────────────────────

const LIGHT = {
  floor: [0, 0, 0],
  fire: [1, 1, 1],
  pulse: [0, 0, 1],
  floorCss: "rgb(0 0 0)",
  invert: false,
};

/** A frame whose page commits: its window and document, as far as the
 *  frame touches them before the page's script runs. */
function committingDom() {
  const { frame } = fakeDom();
  const ran = [];
  const events = [];
  class FakeDocument {
    get hidden() {
      return false;
    }
    get visibilityState() {
      return "visible";
    }
  }
  const doc = Object.assign(Object.create(FakeDocument.prototype), {
    readyState: "loading",
    head: { append() {} },
    createElement: () => ({ dataset: {} }),
    addEventListener() {},
    dispatchEvent: (event) => events.push(event.type),
  });
  class FakeWorker {
    constructor(url) {
      this.url = String(url);
    }
  }
  const win = {
    location: { href: "http://app.test/mnemos-mind/mind/index.html?behind" },
    navigator: {},
    Request,
    Response,
    DOMException,
    Event,
    Worker: FakeWorker,
    structuredClone,
    Document: FakeDocument,
    requestAnimationFrame: (run) => ran.push(run),
    cancelAnimationFrame() {},
    addEventListener() {},
    document: doc,
  };
  return {
    frame,
    win,
    doc,
    ran,
    events,
    commit() {
      frame.contentDocument = doc;
      frame.contentWindow = win;
    },
  };
}

async function startedFrame(asked) {
  const dom = committingDom();
  const made = new MindFrame(
    { append() {} },
    {
      holdings: () => {
        asked.push("read");
        return holdings();
      },
      light: LIGHT,
      ids: () => [],
      onState() {},
      onPick() {},
      onLetGo() {},
      onHover() {},
      shown: true,
    },
  );
  dom.commit();
  await new Promise((done) => setTimeout(done, 10));
  return { made, ...dom };
}

const settled = (promise, ms = 30) =>
  Promise.race([
    promise.then(() => "answered"),
    new Promise((done) => setTimeout(() => done("waiting"), ms)),
  ]);

test("not shown, it draws nothing and asks nothing; shown again, it goes on as it was", async () => {
  const asked = [];
  const { made, frame, win, doc, ran, events } = await startedFrame(asked);
  try {
    assert.equal(made.fedInTime, true);
    win.requestAnimationFrame(() => {});
    assert.equal(ran.length, 1);

    made.setShown(false);
    assert.equal(frame.dataset.shown, "false");
    assert.equal(doc.hidden, true);
    assert.equal(doc.visibilityState, "hidden");
    assert.deepEqual(events, ["visibilitychange"]);
    // Its frames wait, and so does what it asks.
    win.requestAnimationFrame(() => {});
    assert.equal(ran.length, 1);
    const life = win.fetch("http://app.test/mnemos-mind/data/life.json");
    assert.equal(await settled(life), "waiting");
    assert.deepEqual(asked, []);

    made.setShown(true);
    assert.equal(doc.hidden, false);
    assert.deepEqual(events, ["visibilitychange", "visibilitychange"]);
    assert.equal(ran.length, 2);
    const answer = await life;
    assert.equal(answer.status, 200);
    assert.equal((await answer.json()).identity.name, "Heron");
    assert.deepEqual(asked, ["read"]);
    // The same frame: nothing was let go, nothing made again.
    assert.equal(frame.removed, false);
  } finally {
    made.destroy();
  }
});

test("gone while not shown, what it was asking is answered with nothing", async () => {
  const asked = [];
  const { made, win } = await startedFrame(asked);
  made.setShown(false);
  const pending = win.fetch("http://app.test/mnemos-mind/data/memories.json");
  made.destroy();
  const answer = await pending;
  assert.equal(answer.status, 503);
  assert.deepEqual(asked, []);
});

test("nothing of a mind is kept: storage in memory, no IndexedDB, no keeper", async () => {
  const { made, win, doc } = await startedFrame([]);
  try {
    win.localStorage.setItem("mnemos.mind.budget.v3", "2400000");
    assert.equal(win.localStorage.getItem("mnemos.mind.budget.v3"), "2400000");
    assert.equal(win.localStorage.length, 1);
    assert.equal(win.sessionStorage.getItem("mnemos.mind.budget.v3"), null);
    assert.throws(() => win.indexedDB.open("mnemos-mind", 1), {
      name: "SecurityError",
    });
    await assert.rejects(win.caches.open("x"));
    doc.cookie = "kept=1";
    assert.equal(doc.cookie, "");
    const drawing = new ArrayBuffer(64);
    const keeper = new win.Worker(
      new URL("./keep.js", "http://app.test/mnemos-mind/mind/mind.js"),
    );
    keeper.postMessage({ record: { out: { data: drawing } } }, [drawing]);
    // Handed over and let go: the page holds none of it after.
    assert.equal(drawing.byteLength, 0);
    const builder = new win.Worker("./build.js", { type: "module" });
    assert.equal(builder.url, "./build.js");
  } finally {
    made.destroy();
  }
});

test("a storage in memory behaves as a Storage", () => {
  const store = memoryStorage();
  store.setItem("a", 1);
  store.setItem("b", "two");
  assert.equal(store.getItem("a"), "1");
  assert.equal(store.key(1), "b");
  store.removeItem("a");
  assert.equal(store.length, 1);
  store.clear();
  assert.equal(store.getItem("b"), null);
});

// ── the light (Decided 3) ─────────────────────────────────────────────

test("ink on paper is its own inverse, and keeps greys grey", () => {
  for (const c of [
    [0.1, 0.1, 0.1],
    [0.43, 0.58, 0.79],
    [0.95, 0.95, 0.95],
  ]) {
    const back = inkOnPaper(inkOnPaper(c));
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(back[k] - c[k]) < 1e-9);
  }
  const grey = inkOnPaper([0.2, 0.2, 0.2]);
  for (const v of grey) assert.ok(Math.abs(v - 0.8) < 1e-9);
});

// ── the drawing (Decided 8) ──────────────────────────────────────────

const memory = (more = {}) => ({
  id: "m1",
  born: "2026-11-01T00:00:00Z",
  content: "The tide came in early.",
  impact: "",
  state: "active",
  author: "agent",
  acc: 0.6,
  lesson: false,
  recalls: 3,
  strength: 0.7,
  stability: 0.4,
  ties: [
    ["m2", "co_activated", 0.5, "2026-11-02T00:00:00Z", "agent", 1],
    ["m3", "supports", 0.8, "2026-11-03T00:00:00Z", "agent", 0],
  ],
  ...more,
});

test("one memory alone is one cell, a spine for each of its links", () => {
  const cell = cellOfMemory(memory());
  assert.equal(cell.inc.length, 2);
  assert.equal(cell.links, 2);
  assert.deepEqual(
    cell.inc.map((l) => [l.s, l.t, l.rel, l.w]),
    [
      [0, -1, "co_activated", 0.5],
      [-1, 0, "supports", 0.8],
    ],
  );
  assert.equal(cell.accessCount, 3);
  assert.equal(cell.accessibility, 0.6);
  const many = Array.from({ length: 80 }, (_, i) => [
    `x${i}`,
    i === 79 ? "distilled_into" : "co_activated",
    i / 100,
    null,
    "agent",
    1,
  ]);
  const crowded = cellOfMemory(memory({ ties: many }));
  assert.equal(crowded.links, 80);
  assert.equal(crowded.inc.length, 64);
  assert.equal(crowded.inc[0].rel, "distilled_into");
});

test("a memory is named by its first line", () => {
  assert.equal(
    firstLine("\n  The path along the sea wall\nmore"),
    "The path along the sea wall",
  );
  assert.equal(firstLine(""), "");
});

test("the drawing's words say what it shows", () => {
  assert.equal(
    drawingWords(memory()),
    "An experience, with 2 links, come back 3 times",
  );
  assert.equal(
    drawingWords(
      memory({ lesson: true, ties: [], recalls: 0, state: "dormant" }),
    ),
    "A lesson, tied to nothing yet, gone quiet",
  );
});

// ── an empty mind (WP-51, check 2) ───────────────────────────────────

test("an empty mind has nothing to draw; a mind with one memory awake does", () => {
  const book = (states, memories) => ({
    life: { memory: { states } },
    memories: { memories },
  });
  const none = { active: 0, dormant: 0, archived: 0 };
  assert.equal(
    nothingToDraw(book(none, []))?.("Heron"),
    "Heron has no memories yet, so there is nothing to draw.",
  );
  assert.equal(
    nothingToDraw(book({ ...none, archived: 2 }, []))?.("Heron"),
    "Heron has let every memory go, so there is nothing to draw.",
  );
  assert.equal(nothingToDraw(book({ ...none, dormant: 1 }, [])), null);
  // Counts the life didn't give: the memories read say there is one.
  assert.equal(
    nothingToDraw(book(none, [{ id: "m1", state: "active" }])),
    null,
  );
});

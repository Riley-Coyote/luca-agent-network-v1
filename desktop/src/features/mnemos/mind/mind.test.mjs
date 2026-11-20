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
import { cellOfMemory, drawingWords } from "./drawingShape.ts";
import { answerFeed, kindOf, REFUSED } from "./mindFeed.ts";
import { inkOnPaper, MindFrame } from "./mindFrame.ts";

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

import assert from "node:assert/strict";
import test from "node:test";

import rehypeStreamingWords, {
  createStreamingWordSchedule,
  DEFAULT_STREAMING_TEXT_EFFECT,
  STREAMING_BLOCK_PAUSE_MS,
  STREAMING_GAP_FIRST_MS,
  STREAMING_GAP_STEADY_MS,
  STREAMING_TEXT_EFFECTS,
  STREAMING_WORD_ANIMATIONS,
  STREAMING_WORD_ATTRIBUTE,
  STREAMING_WORD_CLASS,
  STREAMING_WORD_MS,
  streamingWordAnimation,
  streamingWordGapMs,
  streamingWordProgress,
} from "./markdownStreamingText.ts";

function fakeNode() {
  return { style: {} };
}

function startsOf(count, { now = 0, blockAt = new Set() } = {}) {
  const schedule = createStreamingWordSchedule();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(schedule.startAtMs(i, blockAt.has(i), now));
  }
  return { schedule, starts: out };
}

function gapsOf(starts) {
  return starts.slice(1).map((value, index) => value - starts[index]);
}

test("the stagger ramps from 44ms to 26ms over ten words, then holds", () => {
  assert.equal(streamingWordGapMs(0), STREAMING_GAP_FIRST_MS);
  assert.equal(streamingWordGapMs(10), STREAMING_GAP_STEADY_MS);
  assert.equal(streamingWordGapMs(11), STREAMING_GAP_STEADY_MS);
  assert.equal(streamingWordGapMs(400), STREAMING_GAP_STEADY_MS);
  // Monotonically shortening across the ramp — never a constant gap.
  for (let i = 1; i <= 10; i += 1) {
    assert.ok(
      streamingWordGapMs(i) < streamingWordGapMs(i - 1),
      `gap ${i} should be shorter than gap ${i - 1}`,
    );
  }
});

test("word start times follow the ramp when the whole stream is already here", () => {
  const { starts } = startsOf(14);
  assert.equal(starts[0], 0);
  const gaps = gapsOf(starts);
  assert.ok(Math.abs(gaps[0] - STREAMING_GAP_FIRST_MS) < 1e-9, `${gaps[0]}`);
  assert.ok(Math.abs(gaps[1] - 42.2) < 1e-9, `${gaps[1]}`);
  assert.ok(Math.abs(gaps[2] - 40.4) < 1e-9, `${gaps[2]}`);
  assert.ok(Math.abs(gaps[9] - 27.8) < 1e-9, `${gaps[9]}`);
  // Word 10 onward holds the steady rhythm.
  assert.ok(Math.abs(gaps[10] - STREAMING_GAP_STEADY_MS) < 1e-9, `${gaps[10]}`);
  assert.ok(Math.abs(gaps[12] - STREAMING_GAP_STEADY_MS) < 1e-9, `${gaps[12]}`);
});

test("a word that starts a new block waits an extra 120ms", () => {
  const plain = startsOf(8).starts;
  const broken = startsOf(8, { blockAt: new Set([4]) }).starts;
  for (let i = 0; i < 4; i += 1) assert.equal(broken[i], plain[i]);
  for (let i = 4; i < 8; i += 1) {
    assert.equal(broken[i], plain[i] + STREAMING_BLOCK_PAUSE_MS);
  }
});

test("the very first word never pays the block pause", () => {
  const { starts } = startsOf(2, { now: 0, blockAt: new Set([0]) });
  assert.equal(starts[0], 0);
});

test("an index keeps the clock it was first given", () => {
  const schedule = createStreamingWordSchedule();
  const first = schedule.startAtMs(0, false, 1_000);
  const second = schedule.startAtMs(1, false, 1_000);
  // The same index asked again — much later, and claiming a block break —
  // still answers with the clock it was assigned the first time.
  assert.equal(schedule.startAtMs(0, true, 9_999_999), first);
  assert.equal(schedule.startAtMs(1, true, 9_999_999), second);
  assert.equal(schedule.assignedAtMs(0), first);
  assert.equal(schedule.assignedAtMs(2), null);
  assert.equal(schedule.assignedCount(), 2);
});

test("a word never starts before it exists", () => {
  const schedule = createStreamingWordSchedule();
  schedule.startAtMs(0, false, 0);
  // Word 1 arrives long after the ramp would have started it.
  const late = schedule.startAtMs(1, false, 5_000);
  assert.equal(late, 5_000);
  // …and word 2 picks the rhythm back up from there.
  assert.ok(schedule.startAtMs(2, false, 5_000) > 5_000);
});

test("the stream settles one word duration after the last start", () => {
  const { schedule, starts } = startsOf(6);
  assert.equal(schedule.latestStartMs(), starts[5]);
  const settledAt = schedule.latestStartMs() + STREAMING_WORD_MS;
  assert.equal(streamingWordProgress(starts[5], settledAt - 1) < 1, true);
  assert.equal(streamingWordProgress(starts[5], settledAt), 1);
  assert.equal(streamingWordProgress(starts[5], settledAt + 10_000), 1);
  assert.equal(streamingWordProgress(starts[5], starts[5] - 1), 0);
});

test("several words are in flight at once", () => {
  const { starts } = startsOf(40);
  const now = starts[20];
  const inFlight = starts.filter(
    (at) => at <= now && streamingWordProgress(at, now) < 1,
  ).length;
  assert.ok(inFlight >= 8 && inFlight <= 14, `in flight: ${inFlight}`);
});

test("both effects settle to no filter and no transform", () => {
  for (const key of ["bloom", "diffusion"]) {
    const node = fakeNode();
    STREAMING_WORD_ANIMATIONS[key].apply(node, 1);
    assert.equal(node.style.filter, "none", key);
    assert.equal(node.style.transform, "none", key);
    assert.equal(node.style.opacity, "", key);
  }
});

test("diffusion blurs and rises from one progress value", () => {
  const node = fakeNode();
  STREAMING_WORD_ANIMATIONS.diffusion.apply(node, 0);
  assert.equal(node.style.opacity, "0.000");
  assert.equal(node.style.filter, "blur(5.00px)");
  assert.equal(node.style.transform, "translateY(2.00px)");

  STREAMING_WORD_ANIMATIONS.diffusion.apply(node, 0.5);
  assert.equal(node.style.filter, "blur(2.50px)");
  assert.equal(node.style.transform, "translateY(1.00px)");
});

test("bloom peaks at 1.10 and contracts to size", () => {
  const node = fakeNode();
  STREAMING_WORD_ANIMATIONS.bloom.apply(node, 0);
  assert.equal(node.style.transform, "scale(1.1000)");
  assert.equal(node.style.filter, "blur(2.00px)");

  STREAMING_WORD_ANIMATIONS.bloom.apply(node, 0.5);
  assert.equal(node.style.transform, "scale(1.0500)");
  // Never past the cap: a transform reserves no layout, so the row's
  // word-spacing is sized for exactly this peak.
  for (let p = 0; p <= 1; p += 0.05) {
    STREAMING_WORD_ANIMATIONS.bloom.apply(node, p);
    const scale = Number(/scale\(([\d.]+)\)/.exec(node.style.transform)?.[1]);
    if (Number.isFinite(scale)) assert.ok(scale <= 1.1 + 1e-9, `${scale}`);
  }
  assert.equal(STREAMING_WORD_ANIMATIONS.bloom.spacedRow, true);
  assert.equal(STREAMING_WORD_ANIMATIONS.diffusion.spacedRow, false);
});

test("reset puts a word back at the start of its own clock", () => {
  for (const key of ["bloom", "diffusion"]) {
    const reset = fakeNode();
    const zero = fakeNode();
    STREAMING_WORD_ANIMATIONS[key].reset(reset);
    STREAMING_WORD_ANIMATIONS[key].apply(zero, 0);
    assert.deepEqual(reset.style, zero.style, key);
  }
});

test("both effects share one clock and one ramp", () => {
  const { bloom, diffusion } = STREAMING_WORD_ANIMATIONS;
  assert.equal(bloom.durationMs, STREAMING_WORD_MS);
  assert.equal(diffusion.durationMs, STREAMING_WORD_MS);
  assert.equal(bloom.gapMs, diffusion.gapMs);
  assert.equal(bloom.unit, "word");
  assert.equal(diffusion.unit, "word");
});

test("off has no animation, and bloom is the default", () => {
  assert.equal(streamingWordAnimation("off"), null);
  assert.equal(
    streamingWordAnimation("bloom"),
    STREAMING_WORD_ANIMATIONS.bloom,
  );
  assert.equal(DEFAULT_STREAMING_TEXT_EFFECT, "bloom");
  assert.deepEqual([...STREAMING_TEXT_EFFECTS], ["bloom", "diffusion", "off"]);
});

// --- the rehype pass -------------------------------------------------------

function element(tagName, children, properties = {}) {
  return { type: "element", tagName, properties, children };
}

function text(value) {
  return { type: "text", value };
}

function run(children) {
  const tree = { type: "root", children };
  rehypeStreamingWords()(tree);
  return tree;
}

function wordsIn(node) {
  if (node.type === "text") return [];
  if (node.type !== "element") return [];
  if (node.properties?.[STREAMING_WORD_ATTRIBUTE] !== undefined) {
    return [node.children.map((child) => child.value).join("")];
  }
  return node.children.flatMap(wordsIn);
}

test("prose is split into one inline-block span per word", () => {
  const tree = run([element("p", [text("Your draft makes one claim")])]);
  assert.deepEqual(wordsIn(tree.children[0]), [
    "Your",
    "draft",
    "makes",
    "one",
    "claim",
  ]);
  const first = tree.children[0].children[0];
  assert.equal(first.tagName, "span");
  assert.deepEqual(first.properties.className, [STREAMING_WORD_CLASS]);
  assert.equal(first.properties[STREAMING_WORD_ATTRIBUTE], "");
});

test("the whitespace between words survives as whitespace", () => {
  const tree = run([element("p", [text(" a  b\nc ")])]);
  const parts = tree.children[0].children.map((child) =>
    child.type === "text" ? child.value : " ",
  );
  assert.deepEqual(parts, [" ", " ", "  ", " ", "\n", " ", " "]);
});

test("link and emphasis structure is kept, only their text is split", () => {
  const tree = run([
    element("p", [
      text("see "),
      element("a", [text("the draft")], { href: "https://example.test" }),
      text(" now"),
    ]),
  ]);
  const anchor = tree.children[0].children.find(
    (child) => child.tagName === "a",
  );
  assert.ok(anchor, "the anchor element itself must survive");
  assert.equal(anchor.properties.href, "https://example.test");
  assert.deepEqual(wordsIn(anchor), ["the", "draft"]);
  assert.deepEqual(wordsIn(tree.children[0]), ["see", "the", "draft", "now"]);
});

test("code arrives plain — no spans inside pre, code, or a pill", () => {
  const tree = run([
    element("pre", [element("code", [text("const a = 1")])]),
    element("p", [
      element("code", [text("inline code here")]),
      text(" and prose"),
    ]),
    element("p", [element("mention", [text("Aster Fieldwright")])]),
    element("p", [element("emoji", [text(":wave:")])]),
    element("p", [element("spoiler", [text("hidden words")])]),
  ]);
  assert.deepEqual(wordsIn(tree.children[0]), []);
  assert.deepEqual(wordsIn(tree.children[1]), ["and", "prose"]);
  assert.deepEqual(wordsIn(tree.children[2]), []);
  assert.deepEqual(wordsIn(tree.children[3]), []);
  assert.deepEqual(wordsIn(tree.children[4]), []);
  // The skipped subtrees are handed back untouched, not rebuilt.
  assert.equal(tree.children[0].children[0].children[0].value, "const a = 1");
});

test("a whitespace-only text node is left exactly as it was", () => {
  const node = text("\n  ");
  const tree = run([element("p", [node])]);
  assert.equal(tree.children[0].children.length, 1);
  assert.equal(tree.children[0].children[0], node);
});

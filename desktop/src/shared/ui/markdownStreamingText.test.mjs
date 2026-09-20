import assert from "node:assert/strict";
import test from "node:test";

import rehypeStreamingWords, {
  createStreamingWordSchedule,
  DEFAULT_STREAMING_TEXT_EFFECT,
  STREAMING_BLOCK_PAUSE_MS,
  STREAMING_GAP_FIRST_MS,
  STREAMING_GAP_STEADY_MS,
  STREAMING_TAIL_BUDGET_MS,
  STREAMING_TEXT_EFFECTS,
  STREAMING_WORD_ANIMATIONS,
  STREAMING_WORD_ATTRIBUTE,
  STREAMING_WORD_CLASS,
  STREAMING_WORD_MS,
  streamingWordAnimation,
  streamingWordGapMs,
  streamingWordProgress,
} from "./markdownStreamingText.ts";

function fakeNode(kind = "") {
  return { style: {}, getAttribute: () => kind };
}

function startsOf(count, { now = 0, blockAt = new Set() } = {}) {
  const schedule = createStreamingWordSchedule();
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(schedule.startAtMs(i, `w${i}`, blockAt.has(i), now));
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

test("an index keeps the clock it was first given for the same word", () => {
  const schedule = createStreamingWordSchedule();
  const first = schedule.startAtMs(0, "So", false, 1_000);
  const second = schedule.startAtMs(1, "much", false, 1_000);
  // The same index and word asked again — much later, and claiming a block
  // break — still answers with the clock assigned the first time.
  assert.equal(schedule.startAtMs(0, "So", true, 9_999_999), first);
  assert.equal(schedule.startAtMs(1, "much", true, 9_999_999), second);
  assert.equal(schedule.assignedAtMs(0, "So"), first);
  assert.equal(schedule.assignedAtMs(2, "anything"), null);
  assert.equal(schedule.assignedCount(), 2);
});

test("a word that changed under its index gets its own clock", () => {
  const schedule = createStreamingWordSchedule();
  // A word that is genuinely new at this index — `##` became a title when the
  // heading parsed and shifted everything after it down one — takes a fresh
  // clock rather than the spent one the index was holding.
  schedule.startAtMs(0, "##", false, 0);
  assert.equal(schedule.assignedAtMs(0, "Title"), null);
  assert.equal(schedule.startAtMs(0, "Title", false, 900), 900);

  // But markdown only decorates around a word. `[So` and `here?](color:x~y)`
  // were already on screen and part-way through their clocks; when the tail
  // parses them into `So` and `here?` they carry on rather than restart, or
  // the line would land its ends after its middle.
  const tail = createStreamingWordSchedule();
  const opener = tail.startAtMs(0, "[So", false, 0);
  const closer = tail.startAtMs(1, "here?](color:warmth~care)", false, 0);
  assert.equal(tail.startAtMs(0, "So", false, 900), opener);
  assert.equal(tail.startAtMs(1, "here?", false, 900), closer);

  // …and a word that never changed keeps the clock it had.
  const stable = createStreamingWordSchedule();
  const at = stable.startAtMs(4, "questions", false, 0);
  assert.equal(stable.startAtMs(4, "questions", false, 5_000), at);
});

test("a fresh clock never overtakes the words around it", () => {
  const schedule = createStreamingWordSchedule();
  schedule.startAtMs(0, "one", false, 0);
  schedule.startAtMs(1, "two", false, 0);
  schedule.startAtMs(2, "three", false, 0);
  const after = schedule.assignedAtMs(2, "three");
  // Word 1 is re-tokenised into something new long after its neighbours
  // started. It arrives with them rather than after the rest of its line.
  const reclocked = schedule.startAtMs(1, "|", false, 9_000);
  assert.ok(reclocked <= after, `${reclocked} <= ${after}`);
  assert.ok(reclocked >= schedule.assignedAtMs(0, "one"));
  // Order holds across the whole run.
  const starts = [0, 1, 2].map((i) =>
    schedule.assignedAtMs(i, ["one", "|", "three"][i]),
  );
  assert.deepEqual(
    [...starts].sort((a, b) => a - b),
    starts,
  );
});

test("a backlog tightens the rhythm instead of trickling it out", () => {
  // A live stream is one or two words behind: the ramp stands.
  assert.equal(streamingWordGapMs(0, 1), STREAMING_GAP_FIRST_MS);
  assert.equal(streamingWordGapMs(20, 2), STREAMING_GAP_STEADY_MS);
  // A whole remainder landing at once closes the gaps so the sentence ends
  // inside the tail budget rather than reading back out over half a minute.
  const backlog = 200;
  const gap = streamingWordGapMs(20, backlog);
  assert.ok(gap < STREAMING_GAP_STEADY_MS, `${gap}`);
  assert.ok(
    gap * backlog + STREAMING_WORD_MS <= STREAMING_TAIL_BUDGET_MS + 1,
    `${gap * backlog + STREAMING_WORD_MS}`,
  );
  // Never faster than the floor, and never slower than the ramp.
  assert.ok(streamingWordGapMs(0, 100_000) >= 4);
  assert.ok(streamingWordGapMs(0, 100_000) <= STREAMING_GAP_FIRST_MS);
});

test("a word never starts before it exists", () => {
  const schedule = createStreamingWordSchedule();
  schedule.startAtMs(0, "a", false, 0);
  // Word 1 arrives long after the ramp would have started it.
  const late = schedule.startAtMs(1, "b", false, 5_000);
  assert.equal(late, 5_000);
  // …and word 2 picks the rhythm back up from there.
  assert.ok(schedule.startAtMs(2, "c", false, 5_000) > 5_000);
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
  // Never past the cap: kept modest because nothing compensates for it —
  // the overlap with a neighbour must stay slight, not because a row-level
  // spacing was ever sized to exactly this peak.
  for (let p = 0; p <= 1; p += 0.05) {
    STREAMING_WORD_ANIMATIONS.bloom.apply(node, p);
    const scale = Number(/scale\(([\d.]+)\)/.exec(node.style.transform)?.[1]);
    if (Number.isFinite(scale)) assert.ok(scale <= 1.1 + 1e-9, `${scale}`);
  }
  // Neither effect reserves row space: a layout property eased shut is what
  // used to re-wrap the paragraph once the last word landed.
  assert.equal(STREAMING_WORD_ANIMATIONS.bloom.spacedRow, false);
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

function kindsIn(node, out = []) {
  if (node.type !== "element") return out;
  const kind = node.properties?.[STREAMING_WORD_ATTRIBUTE];
  if (kind !== undefined) {
    out.push([node.children.map((child) => child.value).join(""), kind]);
    return out;
  }
  for (const child of node.children) kindsIn(child, out);
  return out;
}

test("words under a gradient expression carry their own clip", () => {
  const tree = run([
    element("p", [
      element("span", [text("So much depends")], {
        "data-expression-tone": "",
        "data-expression-gradient": "",
      }),
      text(" on it"),
    ]),
  ]);
  assert.deepEqual(kindsIn(tree.children[0]), [
    ["So", "clip"],
    ["much", "clip"],
    ["depends", "clip"],
    ["on", ""],
    ["it", ""],
  ]);
});

test("a plain expression only loses its filter, not its colour", () => {
  const tree = run([
    element("p", [
      element("span", [text("warm words")], { "data-expression-tone": "" }),
      element("span", [text("lit words")], { "data-expression-color": "rose" }),
    ]),
  ]);
  assert.deepEqual(kindsIn(tree.children[0]), [
    ["warm", "plain"],
    ["words", "plain"],
    ["lit", "plain"],
    ["words", "plain"],
  ]);
});

test("the kind reaches words nested below the expression", () => {
  const tree = run([
    element("p", [
      element(
        "span",
        [element("strong", [element("em", [text("deep inside")])])],
        { "data-expression-gradient": "" },
      ),
    ]),
  ]);
  assert.deepEqual(kindsIn(tree.children[0]), [
    ["deep", "clip"],
    ["inside", "clip"],
  ]);
});

test("an expression word is never given a filter", () => {
  for (const key of ["bloom", "diffusion"]) {
    for (const kind of ["clip", "plain"]) {
      const node = fakeNode(kind);
      STREAMING_WORD_ANIMATIONS[key].apply(node, 0.4);
      assert.equal(node.style.filter, "none", `${key}/${kind}`);
      // …but it still moves and still fades.
      assert.notEqual(node.style.transform, "none", `${key}/${kind}`);
      assert.ok(Number(node.style.opacity) > 0, `${key}/${kind}`);
      assert.ok(Number(node.style.opacity) < 1, `${key}/${kind}`);
    }
    const prose = fakeNode("");
    STREAMING_WORD_ANIMATIONS[key].apply(prose, 0.4);
    assert.match(prose.style.filter, /^blur\(/, key);
  }
});

test("a whitespace-only text node is left exactly as it was", () => {
  const node = text("\n  ");
  const tree = run([element("p", [node])]);
  assert.equal(tree.children[0].children.length, 1);
  assert.equal(tree.children[0].children[0], node);
});

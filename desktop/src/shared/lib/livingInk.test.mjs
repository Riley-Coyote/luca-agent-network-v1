import assert from "node:assert/strict";
import test from "node:test";
import { InkGestureLedger, inkGestureKey } from "./inkGestureLifecycle.ts";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LIVING_INK,
  livingInkPhase,
  livingInkRate,
  livingInkSeed,
  inkNoise,
  livingInkColor,
  inkContrast,
  livingInkPress,
  livingInkGive,
  livingInkTake,
} from "./livingInkMath.ts";
import { parseExpressionColor } from "./expressionColorMath.ts";
import {
  renderCachedMarkdown,
  renderUncachedMarkdown,
} from "../ui/markdown/nodeCache.ts";

const render = (content, { livingInk = true, streamWords = false } = {}) =>
  renderToStaticMarkup(
    renderUncachedMarkdown({
      content,
      components: {},
      variant: "living-test",
      livingInk,
      streamWords,
    }),
  );

test("gesture identity survives remounts but not different messages or revised words", () => {
  const key = inkGestureKey("message-a", 0, "Hello 👋", "breathe", "");
  assert.equal(key, inkGestureKey("message-a", 0, "Hello 👋", "breathe", ""));
  for (const args of [
    ["message-b", 0, "Hello 👋", "breathe", ""],
    ["message-a", 1, "Hello 👋", "breathe", ""],
    ["message-a", 0, "Hello again", "breathe", ""],
    ["message-a", 0, "Hello 👋", "wave", ""],
  ])
    assert.notEqual(key, inkGestureKey(...args));
  assert.ok(!key.includes("Hello"));
});

test("playback memory is bounded, replayable, and cleared between communities", () => {
  const ledger = new InkGestureLedger(2);
  ledger.mark("a");
  ledger.mark("b");
  ledger.mark("a");
  ledger.mark("c");
  assert.equal(ledger.has("a"), true);
  assert.equal(ledger.has("b"), false);
  ledger.replay("a");
  assert.equal(ledger.has("a"), false);
  ledger.clear();
  assert.equal(ledger.has("c"), false);
});

test("Ghost's analytic drift and resting rates retain the Oct 27 constants", () => {
  assert.equal(LIVING_INK.resting, 0.16);
  assert.equal(livingInkPhase(0), 0);
  assert.ok(Math.abs(livingInkPhase(60) - 36) < 1e-8);
  assert.equal(livingInkRate(99), 12);
  assert.equal(livingInkRate(100), 3);
  assert.ok(livingInkPhase(1000) > livingInkPhase(999));
  assert.ok(
    Math.abs(livingInkPhase(1000) - livingInkPhase(999) - 0.096) < 1e-8,
  );
  for (const age of [-1, 0, 60, 100, 86400, 1e10]) {
    assert.ok(livingInkPhase(age) >= 0 && livingInkPhase(age) <= 10000);
    assert.equal(livingInkPhase(age, true), 0);
  }
});
test("field seeds are the native Unicode-scalar FNV, stable beyond 96 scalars", () => {
  assert.equal(
    livingInkSeed("a"),
    Number(0xaf63dc4c8601ec8cn % 10000n) / 10000,
  );
  assert.equal(
    livingInkSeed(`${"a".repeat(96)}left`),
    livingInkSeed(`${"a".repeat(96)}right`),
  );
  assert.notEqual(livingInkSeed("👋a"), livingInkSeed("a"));
});
test("the simplex field is finite and locally continuous", () => {
  assert.equal(inkNoise(0, 0), 0);
  for (let i = -20; i < 20; i++) {
    const a = inkNoise(i / 3, i / 7),
      b = inkNoise(i / 3 + 0.00001, i / 7);
    assert.ok(Number.isFinite(a) && Math.abs(a) < 1.2);
    assert.ok(Math.abs(a - b) < 0.001);
  }
});
test("paint moves in its own field, not a palette cycling unrelated colours", () => {
  const stops = [parseExpressionColor("#16ccef")];
  const a = livingInkColor(stops, 3, 1, 0, 0.3, 0.5, [0, 0, 0]);
  const b = livingInkColor(stops, 3, 1, 30, 0.3, 0.5, [0, 0, 0]);
  assert.notDeepEqual(a, b);
  for (const color of [a, b]) assert.ok(color[2] > color[0]);
});
test("native pigment stays legible on both themes, including wet hushed paint", () => {
  for (const ground of [
    [0, 0, 0],
    [0.98, 0.98, 0.98],
  ])
    for (const paint of ["#ffd21f", "#4285ff", "#a65cff", "#ff4f91"]) {
      for (const hush of [false, true])
        for (const phase of [0, 36, 100]) {
          const rgb = livingInkColor(
            [parseExpressionColor(paint)],
            3,
            1,
            phase,
            0.3,
            0.5,
            ground,
            hush,
            true,
          );
          assert.ok(rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 1));
          assert.ok(
            inkContrast(rgb, ground, hush ? 0.6 : 1) >= 4.4999,
            `${paint}, ${ground}, ${hush}`,
          );
        }
    }
});
test("the pressed passage's spring settles and is bounded", () => {
  assert.equal(livingInkPress(0), 0);
  assert.equal(livingInkPress(0.9), 0);
  const values = Array.from({ length: 90 }, (_, i) => livingInkPress(i / 100));
  assert.ok(Math.max(...values) < 0.12);
  assert.ok(Math.min(...values) < 0);
  assert.equal(livingInkGive(0.9), 0);
  assert.equal(livingInkTake(0.9), 0);
  assert.ok(
    livingInkGive(0.06) > 0 && livingInkGive(0.06) < livingInkPress(0.06),
  );
  assert.ok(livingInkTake(0.06) > 0.2 && livingInkTake(0.06) < 0.4);
});
test("a press wraps only its immediate plain neighbours within the same span budget", () => {
  const html = render(
    "A quiet word [lands here](ink:resolve?land) then settles.",
  );
  assert.match(html, /data-ink-give="before">word<\/span>/);
  assert.match(html, /data-ink-give="after">then<\/span>/);
  assert.doesNotMatch(
    render("`code` [lands](ink:land) `literal`"),
    /data-ink-give/,
  );
  assert.doesNotMatch(
    render("before [land](ink:land) after", { livingInk: false }),
    /data-ink-give/,
  );
});
test("only recognized ink receives fields; literal code, links and unknown input remain readable", () => {
  const html = render(
    "[alive](ink:calm~curiosity?wave) ` [literal](ink:care) ` [site](https://example.com) [unknown](ink:bad)",
  );
  assert.match(html, /data-ink-field="#16ccef~#a65cff"/);
  assert.match(html, /<code>\[literal\]\(ink:care\)<\/code>/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="ink:|data-ink-field="bad"/);
});
test("field spans retain emphasis, graphemes, code and the shared 512-span budget", () => {
  for (const streamWords of [false, true]) {
    const html = render("[**A👩🏽‍💻é** and `code`](ink:care~calm?wet)", {
      streamWords,
    });
    assert.match(html, /<strong>/);
    assert.match(html, /👩🏽‍💻é/);
    assert.match(html, /<code>code<\/code>/);
    assert.doesNotMatch(html, /<code>[^<]*data-ink/);
    assert.ok((html.match(/data-ink-field-part=/g) ?? []).length <= 512);
  }
  const many = render(
    Array.from({ length: 600 }, () => "[word](ink:care)").join(" "),
  );
  assert.equal((many.match(/data-ink-field-part=/g) ?? []).length, 512);
  assert.equal((many.match(/data-ink-field=/g) ?? []).length, 512);
  assert.match(render("[مرحبا بالعالم](ink:care)"), />مرحبا بالعالم<\/span>/);
});
test("phone touch marks preserve shared text expression without desktop actuation", () => {
  const html = render(
    "[hello](ink:care?pulse&breathe) [again](ink:calm?knock&wet)",
  );
  assert.match(html, /data-ink-field="#ff4f91"/);
  assert.match(html, /data-expression-motion="breathe"/);
  assert.match(html, /data-expression-wet=""/);
  assert.doesNotMatch(html, /href="ink:|data-expression-touch/);
  assert.doesNotMatch(
    render("[conflict](ink:care?pulse&knock)"),
    /data-ink-field/,
  );
});
test("live field parsing is independently cache keyed; the legacy parse stays exact", () => {
  const base = {
    content: "[hello](ink:care)",
    components: {},
    variant: "same",
  };
  const before = renderCachedMarkdown(base),
    after = renderCachedMarkdown({ ...base, livingInk: true });
  assert.notEqual(before, after);
  assert.equal(renderCachedMarkdown({ ...base, livingInk: true }), after);
  assert.doesNotMatch(renderToStaticMarkup(before), /data-ink-field/);
  assert.match(renderToStaticMarkup(after), /data-ink-field/);
});

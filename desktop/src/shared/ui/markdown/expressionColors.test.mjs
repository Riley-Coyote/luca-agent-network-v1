import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EXPRESSION_COLORS } from "../../lib/remarkExpressionColors.ts";
import { renderCachedMarkdown, renderUncachedMarkdown } from "./nodeCache.ts";

function render(content, streaming = false) {
  return renderToStaticMarkup(
    (streaming ? renderUncachedMarkdown : renderCachedMarkdown)({
      content,
      components: {},
      variant: "expression-test",
    }),
  );
}

test("expression preserves emphasis in both finalized and provisional output", () => {
  for (const streaming of [false, true]) {
    const html = render(
      "[**A little warmth** and *care*.](color:warmth)",
      streaming,
    );
    assert.match(
      html,
      /<span data-expression-color="amber"><strong>A little warmth<\/strong> and <em>care<\/em>\.<\/span>/,
    );
    assert.doesNotMatch(html, /href|style=/);
  }
});

test("named hues, unknown values and code have safe readable behavior", () => {
  assert.match(
    render("[Explore](color:violet)"),
    /data-expression-color="violet"/,
  );
  for (const value of [
    "unknown",
    "__proto__",
    "constructor",
    "red;background:url(x)",
  ]) {
    const html = render(`[Visible](color:${value})`);
    assert.match(html, /Visible/);
    assert.doesNotMatch(html, /data-expression-color|href|style=/);
  }
  assert.match(
    render("`[literal](color:joy)`"),
    /<code>\[literal\]\(color:joy\)<\/code>/,
  );
  assert.match(
    render("[Website](https://example.com)"),
    /href="https:\/\/example.com"/,
  );
  assert.doesNotMatch(render("![Image](color:joy)"), /data-expression-color/);
  assert.doesNotMatch(
    render("[unfinished](color:", true),
    /data-expression-color/,
  );
});

test("named palette matches shipped CSS without theme remapping", () => {
  const css = readFileSync(
    new URL("../../styles/globals/markdown.css", import.meta.url),
    "utf8",
  );
  for (const [name, fill] of Object.entries(EXPRESSION_COLORS)) {
    assert.ok(
      css.includes(
        `[data-expression-color="${name}"] {\n  --expression-fill: ${fill};`,
      ),
    );
  }
  assert.doesNotMatch(css, /\.dark \[data-expression-/);
});

test("precise hex and HSL fills preserve authored color in finalized and streaming text", () => {
  for (const streaming of [false, true]) {
    for (const [color, expected] of [
      ["#f5a", "#ff55aa"],
      ["#0000ff", "#0000ff"],
      ["hsl(120,100%,50%)", "#00ff00"],
      ["#000000", "#000000"],
      ["#ffffff", "#ffffff"],
    ]) {
      const html = render(`[a](color:${color})`, streaming);
      assert.ok(html.includes(`--expression-fill:${expected}`));
      assert.doesNotMatch(html, /href=|--expression-dark|--expression-light/);
    }
  }
});

test("flow, character and row gradients preserve content and emphasis", () => {
  assert.match(
    render("[**Between worlds**](color:violet~cyan~rose)"),
    /linear-gradient/,
  );
  const letters = render("[A👩🏽‍💻é](color:#ff55aa~#44ccff?axis=letters)");
  assert.match(letters, />👩🏽‍💻<\/span>/);
  assert.match(letters, />é<\/span>/);
  const rows = render("[First\n**Second**\nThird](color:blue~rose?axis=lines)");
  assert.equal((rows.match(/<br\/>/g) ?? []).length, 2);
  const tones = [...rows.matchAll(/--expression-fill:(#[a-f0-9]{6})/g)].map(
    (m) => m[1],
  );
  assert.equal(new Set(tones).size, 3);
  assert.match(rows, /<strong>/);
});

test("gestures are bounded; joining scripts and large texts retain natural shaping", () => {
  const wave = render(
    "[Hello](color:cyan~violet?motion=wave&pace=medium&weight=550&tracking=0.04)",
  );
  assert.equal((wave.match(/data-expression-glyph/g) ?? []).length, 5);
  assert.match(wave, /--expression-duration:2.4s/);
  assert.doesNotMatch(
    render("[مرحبا](color:cyan~violet?motion=wave)"),
    /data-expression-glyph/,
  );
  assert.doesNotMatch(
    render(`[${"a".repeat(513)}](color:cyan~violet?motion=wave)`),
    /data-expression-glyph/,
  );
  const many = render(
    Array.from(
      { length: 100 },
      () => "[abcdefghij](color:cyan~violet?motion=wave)",
    ).join(" "),
  );
  assert.ok((many.match(/data-expression-glyph/g) ?? []).length <= 512);
});

test("malformed colors and unbounded style requests never become CSS", () => {
  for (const value of [
    "url(https://example.com/x)",
    "#fff?motion=spin",
    "#fff?tracking=999",
    "#fff?weight=Infinity",
    "hsl(20,101%,50%)",
    "#fff?position=fixed",
    "#fff~invalid",
    "#fff?motion=wave&pace=0.01",
  ]) {
    const html = render(`[Visible](color:${value})`);
    assert.match(html, /Visible/);
    assert.doesNotMatch(html, /style=|data-expression-motion|href=/);
  }
});

test("full-spectrum colors and gradient stops round-trip faithfully", async () => {
  const { parseExpressionColor, formatExpressionColor, mixExpressionColors } =
    await import("../../lib/expressionColorMath.ts");
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        assert.equal(formatExpressionColor(parseExpressionColor(hex)), hex);
      }
    }
  }
  const stops = ["#0000ff", "#ff0000", "#00ff00"].map(parseExpressionColor);
  for (const [i, stop] of stops.entries()) {
    assert.deepEqual(mixExpressionColors(stops, i / 2), stop);
  }
});

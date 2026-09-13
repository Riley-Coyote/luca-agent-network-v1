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

function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
test("all palette fills meet normal text contrast and match the shipped CSS", () => {
  const css = readFileSync(
    new URL("../../styles/globals/markdown.css", import.meta.url),
    "utf8",
  );
  for (const [name, [light, dark]] of Object.entries(EXPRESSION_COLORS)) {
    for (const [fill, background] of [
      [light, "#f3f1ee"],
      [dark, "#333333"],
    ]) {
      const values = [luminance(fill), luminance(background)].sort(
        (a, b) => b - a,
      );
      assert.ok(
        (values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
        `${name} on ${background}`,
      );
      assert.ok(css.includes(fill), `${name} CSS uses ${fill}`);
    }
  }
});

test("precise hex and HSL colors become normalized theme-aware fills", () => {
  for (const color of ["#f5a", "#ff55aa", "hsl(280,95%,65%)"]) {
    const html = render(`[a](color:${color})`);
    assert.match(html, /data-expression-tone/);
    assert.match(html, /--expression-dark:#[a-f0-9]{6}/);
    assert.doesNotMatch(html, /href=/);
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
  const tones = [...rows.matchAll(/--expression-dark:(#[a-f0-9]{6})/g)].map(
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

test("custom fills and every gradient sample stay readable across the color wheel", async () => {
  const {
    parseExpressionColor,
    readableExpressionColor,
    expressionLuminance,
    mixExpressionColors,
  } = await import("../../lib/expressionColorMath.ts");
  for (let hue = 0; hue < 360; hue += 10) {
    const stops = [
      parseExpressionColor(`hsl(${hue},100%,50%)`),
      parseExpressionColor(`hsl(${(hue + 140) % 360},95%,60%)`),
    ];
    for (let step = 0; step <= 32; step++) {
      for (const dark of [true, false]) {
        const fill = parseExpressionColor(
          readableExpressionColor(mixExpressionColors(stops, step / 32), dark),
        );
        const background = parseExpressionColor(dark ? "#333333" : "#f3f1ee");
        const pair = [
          expressionLuminance(fill),
          expressionLuminance(background),
        ].sort((a, b) => b - a);
        assert.ok(
          (pair[0] + 0.05) / (pair[1] + 0.05) >= 4.5,
          `${hue}/${step}/${dark}`,
        );
      }
    }
  }
});

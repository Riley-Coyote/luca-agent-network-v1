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

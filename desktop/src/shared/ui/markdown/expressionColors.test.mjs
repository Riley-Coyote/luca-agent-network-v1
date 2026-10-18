import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseExpressionColor } from "../../lib/expressionColorMath.ts";
import { parseExpressionSyntax } from "../../lib/expressionSyntax.ts";
import {
  EXPRESSION_COLORS,
  expressionColor,
} from "../../lib/remarkExpressionColors.ts";
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

/** A streaming row's parse: every prose word in its own span. */
function renderWords(content) {
  return renderToStaticMarkup(
    renderUncachedMarkdown({
      content,
      components: {},
      variant: "expression-test:w",
      streamWords: true,
    }),
  );
}

const parse = (value) =>
  parseExpressionSyntax(
    value,
    (name) => EXPRESSION_COLORS[expressionColor(name)],
  );

/** Each one-word passage's text, mapped to one attribute's value or null. */
function attribute(html, name) {
  return Object.fromEntries(
    [...html.matchAll(/<span([^>]*)>([^<]*)<\/span>/g)].map(
      ([, attributes, text]) => [
        text,
        attributes.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? null,
      ],
    ),
  );
}

const repeat = (count, make) =>
  Array.from({ length: count }, (_, i) => make(i)).join(" ");

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

// Living ink: `ink:` and `color:` share one grammar of paint and marks.

const PLAIN = "<p><span>Visible</span></p>";

test("each living ink mark lands on its passage in finalized and provisional text", () => {
  const style = 'style="--expression-duration:3.6s"';
  for (const streaming of [false, true]) {
    for (const [value, attributes] of [
      ["hush", 'data-expression-pressure="hush"'],
      ["land", 'data-expression-pressure="land"'],
      ["linger", 'data-expression-tempo="linger"'],
      ["rush", 'data-expression-tempo="rush"'],
      ["wet", 'data-expression-wet=""'],
      ["hold", 'data-expression-hold="0.7"'],
      ["echo", 'data-expression-echo="soft words"'],
      ["breathe", 'data-expression-motion="breathe"'],
      ["drift", 'data-expression-motion="drift"'],
    ]) {
      assert.equal(
        render(`[soft words](ink:${value})`, streaming),
        `<p><span ${style} ${attributes}>soft words</span></p>`,
        value,
      );
    }
    assert.equal(
      render("[Hi](ink:wave)", streaming),
      `<p><span ${style} data-expression-motion="wave"><span><span data-expression-glyph="" style="--expression-delay:0.000s">H</span><span data-expression-glyph="" style="--expression-delay:0.025s">i</span></span></span></p>`,
    );
  }
});

test("marks follow today's attributes on painted passages, in a fixed order", () => {
  assert.equal(
    render(
      "[w](ink:#f5a?hold=1.5&land&linger&wet&echo=again&pace=medium&weight=450)",
    ),
    '<p><span data-expression-tone="" style="--expression-fill:#ff55aa;--expression-weight:450;--expression-duration:2.4s" data-expression-weight="" data-expression-pressure="land" data-expression-hold="1.5" data-expression-tempo="linger" data-expression-wet="" data-expression-echo="again">w</span></p>',
  );
  assert.match(
    render("[w](ink:rose~cyan?drift&hush)"),
    /^<p><span data-expression-tone="" style="--expression-fill:#ff4f91;--expression-duration:3\.6s;--expression-gradient:linear-gradient\(90deg,[^)]+\)" data-expression-motion="drift" data-expression-gradient="" data-expression-pressure="hush">w<\/span><\/p>$/,
  );
});

test("paint-less ink keeps the page's own colour", () => {
  for (const streaming of [false, true]) {
    for (const [content, expected] of [
      [
        "[words](ink:hold)",
        '<p><span style="--expression-duration:3.6s" data-expression-hold="0.7">words</span></p>',
      ],
      [
        "[words](ink:?hush)",
        '<p><span style="--expression-duration:3.6s" data-expression-pressure="hush">words</span></p>',
      ],
      [
        "[words](color:wet)",
        '<p><span style="--expression-duration:3.6s" data-expression-wet="">words</span></p>',
      ],
      [
        "[words](ink:?land&weight=500&tracking=0.02)",
        '<p><span style="--expression-weight:500;--expression-tracking:0.02em;--expression-duration:3.6s" data-expression-weight="" data-expression-tracking="" data-expression-pressure="land">words</span></p>',
      ],
      // No paint to spread, so letters and lines stay whole.
      [
        "[ab](ink:?axis=letters&wet)",
        '<p><span style="--expression-duration:3.6s" data-expression-wet="">ab</span></p>',
      ],
      [
        "[a\nb](ink:axis=lines&rush)",
        '<p><span style="--expression-duration:3.6s" data-expression-tempo="rush">a<br/>\nb</span></p>',
      ],
      [
        "[words](ink:motion=drift)",
        '<p><span style="--expression-duration:3.6s" data-expression-motion="drift">words</span></p>',
      ],
    ]) {
      const html = render(content, streaming);
      assert.equal(html, expected, content);
      assert.doesNotMatch(
        html,
        /--expression-fill|data-expression-tone|data-expression-gradient|data-expression-color|href/,
      );
    }
  }
});

test("ink: and color: read every value the same way", () => {
  for (const value of [
    "warmth",
    "Rose",
    "violet~cyan~rose",
    "#f5a?axis=letters&motion=wave",
    "warmth?hush",
    "hold",
    "?hush",
    "wet&linger",
    "echo=again",
    "wave&pace=medium",
    "unknown",
    "",
    "?",
    "hush&land",
  ]) {
    for (const view of [render, renderWords]) {
      assert.equal(
        view(`[two words](ink:${value})`),
        view(`[two words](color:${value})`),
        value,
      );
    }
  }
});

test("a bare named paint or feeling keeps the named path under ink:", () => {
  for (const [value, name] of [
    ["warmth", "amber"],
    ["CARE", "rose"],
    ["violet", "violet"],
    ["Emerald", "emerald"],
  ]) {
    assert.equal(
      render(`[words](ink:${value})`),
      `<p><span data-expression-color="${name}">words</span></p>`,
    );
  }
  assert.equal(
    render("[words](ink:warmth?hush)"),
    '<p><span data-expression-tone="" style="--expression-fill:#ffad1f;--expression-duration:3.6s" data-expression-pressure="hush">words</span></p>',
  );
  assert.doesNotMatch(render("[words](INK:warmth)"), /data-expression/);
});

test("no paint and no marks, or any broken mark, writes the words plainly", () => {
  for (const value of [
    "",
    "?",
    "?&",
    "&",
    "?=",
    "hush&land",
    "land&hush",
    "linger&rush",
    "hush&hush",
    "land&land",
    "wet&wet",
    "hold&hold",
    "hold&hold=1",
    "echo&echo=x",
    "hush=1",
    "wet=0",
    "wave=yes",
    "linger=slow",
    "whisper",
    "Hush",
    "HOLD",
    "hush&glow",
    "#fff?hush&glow",
    "hold?hush",
    "?hush?land",
    "motion=",
    "motion=spin",
    "__proto__",
    "constructor",
    "toString",
    "hold=0.19",
    "hold=2.01",
    "hold=0",
    "hold=-1",
    "hold=abc",
    "hold=Infinity",
    "hold=NaN",
    "hold=%20",
    "hold=1,5",
    `echo=${"a".repeat(508)}`,
  ]) {
    for (const scheme of ["ink:", "color:"]) {
      assert.equal(render(`[Visible](${scheme}${value})`), PLAIN, value);
      assert.equal(render(`[Visible](${scheme}${value})`, true), PLAIN, value);
    }
    assert.equal(parse(value), undefined, value);
  }
});

test("gestures count together; motion= counts once and keeps first-wins", () => {
  assert.match(
    render("[w](ink:motion=wave&motion=drift)"),
    /^<p><span style="--expression-duration:3.6s" data-expression-motion="wave"><span><span data-expression-glyph=""/,
  );
  assert.match(
    render("[w](ink:#fff?motion=drift&motion=drift)"),
    /data-expression-motion="drift"/,
  );
  for (const value of [
    "motion=wave&drift",
    "breathe&wave",
    "drift&breathe",
    "wave&motion=wave",
    "breathe&drift&wave",
    "#fff?drift&motion=breathe",
    "#fff?motion=drift&motion=wave&wave",
  ]) {
    assert.equal(render(`[Visible](ink:${value})`), PLAIN, value);
  }
});

test("a gesture flag renders exactly as its motion=, wave's letters and fallbacks included", () => {
  for (const [flag, legacy] of [
    ["cyan~violet?wave", "cyan~violet?motion=wave"],
    [
      "cyan~violet?wave&pace=medium&weight=550&tracking=0.04",
      "cyan~violet?motion=wave&pace=medium&weight=550&tracking=0.04",
    ],
    ["#fff?breathe&axis=lines", "#fff?motion=breathe&axis=lines"],
    ["rose~cyan?drift", "rose~cyan?motion=drift"],
    ["wave", "motion=wave"],
    ["drift&pace=medium", "motion=drift&pace=medium"],
  ]) {
    for (const text of [
      "Hello there",
      "مرحبا",
      "a".repeat(513),
      "First\nSecond",
    ]) {
      assert.equal(
        render(`[${text}](ink:${flag})`),
        render(`[${text}](ink:${legacy})`),
        `${flag} on ${text.slice(0, 12)}`,
      );
    }
  }
  assert.equal(
    render(repeat(100, () => "[abcdefghij](ink:cyan~violet?wave)")),
    render(repeat(100, () => "[abcdefghij](ink:cyan~violet?motion=wave)")),
  );
  assert.match(
    render("[words](ink:drift&pace=medium)"),
    /--expression-duration:2\.4s/,
  );
  assert.match(render("[words](ink:drift)"), /--expression-duration:3\.6s/);
});

test("hold is 0.7 seconds bare, otherwise 0.2–2 written as JavaScript writes it", () => {
  for (const [value, seconds] of [
    ["hold", "0.7"],
    ["hold=", "0.7"],
    ["hold=0.2", "0.2"],
    ["hold=2", "2"],
    ["hold=1.50", "1.5"],
    ["hold=.5", "0.5"],
    ["hold=2e-1", "0.2"],
    ["hold=0x1", "1"],
    ["hold=%31", "1"],
    ["#fff?hold=1.25", "1.25"],
  ]) {
    assert.equal(
      attribute(render(`[w](ink:${value})`), "data-expression-hold").w,
      seconds,
      value,
    );
  }
});

test("echo carries the passage's own words, or the phrase it names", () => {
  for (const [content, phrase] of [
    ["[a `b` **c** *d*](ink:echo)", "a b c d"],
    ["[words](ink:echo=)", "words"],
    ["[words](ink:echo=the+same+words)", "the same words"],
    ["[words](ink:echo=caf%C3%A9)", "café"],
    // Letters split after the phrase is read.
    ["[ab](ink:rose~cyan?axis=letters&echo)", "ab"],
    // A line break reads as one space: none at the ends, one for a run.
    ["[first\nsecond](ink:echo)", "first second"],
    ["[**a**\n*b*](ink:echo)", "a b"],
    ["[a\n\\\nb](ink:echo)", "a b"],
    ["[a\\\n\\\n\\\nb](ink:echo)", "a b"],
    ["[\nfirst](ink:echo)", "first"],
    ["[\\\nfirst](ink:echo)", "first"],
    ["[first\n](ink:echo)", "first"],
    ["[first\\\n](ink:echo)", "first"],
    ["[\\\na\\\n\\\nb\\\n](ink:echo)", "a b"],
    // Only text, inline code and breaks are words: an image adds nothing.
    ["[![alt](x.png) text](ink:echo)", " text"],
    [`[w](ink:echo=${"a".repeat(507)})`, "a".repeat(507)],
  ]) {
    assert.ok(
      render(content).includes(` data-expression-echo="${phrase}"`),
      content,
    );
  }
  const quoted = render("[words](ink:echo=%22quoted%22+%3Cb%3E)");
  assert.ok(
    quoted.includes('data-expression-echo="&quot;quoted&quot; &lt;b&gt;"'),
  );
  assert.doesNotMatch(quoted, /<b>/);
});

test("holds: three per message, in reading order; a dropped hold keeps the rest", () => {
  for (const streaming of [false, true]) {
    const html = render(
      "[a](ink:hold) [b](ink:hold=2) [c](ink:#fff?hold) [d](ink:hold=1&land) [e](ink:hold)",
      streaming,
    );
    assert.deepEqual(attribute(html, "data-expression-hold"), {
      a: "0.7",
      b: "2",
      c: "0.7",
      d: null,
      e: null,
    });
    assert.equal(attribute(html, "data-expression-pressure").d, "land");
  }
  assert.deepEqual(
    attribute(
      render(
        "[a](ink:hold)\n\n- [b](ink:hold)\n\n# [c](ink:hold)\n\n[d](ink:hold)",
      ),
      "data-expression-hold",
    ),
    { a: "0.7", b: "0.7", c: "0.7", d: null },
  );
  // A passage written plainly spends nothing.
  assert.deepEqual(
    attribute(
      render(
        "[x](ink:hold&hush&land) [a](ink:hold) [b](ink:hold) [c](ink:hold)",
      ),
      "data-expression-hold",
    ),
    { x: null, a: "0.7", b: "0.7", c: "0.7" },
  );
});

test("lands: one per nearest block (paragraph, list item, heading, table cell)", () => {
  const html = render(
    [
      "[a](ink:land) and [b](ink:land)",
      "[c](ink:land)",
      "- [d](ink:land) [e](ink:land)\n- [f](ink:land)",
      "# [g](ink:land) [h](ink:land)",
      "> [i](ink:land) [j](ink:land)",
      "| [k](ink:land) | [l](ink:land) [m](ink:land) |\n| - | - |\n| [n](ink:land) | x |",
    ].join("\n\n"),
  );
  assert.deepEqual(attribute(html, "data-expression-pressure"), {
    a: "land",
    b: null,
    c: "land",
    d: "land",
    e: null,
    f: "land",
    g: "land",
    h: null,
    i: "land",
    j: null,
    k: "land",
    l: "land",
    m: null,
    n: "land",
  });
  // Hush has no limit; a dropped land keeps its paint and other marks.
  const kept = render(
    "[a](ink:hush) [b](ink:hush) [c](ink:land) [d](ink:rose?land&wet)",
  );
  assert.deepEqual(attribute(kept, "data-expression-pressure"), {
    a: "hush",
    b: "hush",
    c: "land",
    d: null,
  });
  assert.match(
    kept,
    /<span data-expression-tone="" style="--expression-fill:#ff4f91;--expression-duration:3\.6s" data-expression-wet="">d<\/span>/,
  );
});

test("echo: one per message, in reading order; a dropped echo keeps the rest", () => {
  for (const streaming of [false, true]) {
    const html = render(
      "[a](ink:echo) [b](ink:echo=bee&hush)\n\n[c](ink:echo)",
      streaming,
    );
    assert.deepEqual(attribute(html, "data-expression-echo"), {
      a: "a",
      b: null,
      c: null,
    });
    assert.equal(attribute(html, "data-expression-pressure").b, "hush");
  }
});

test("paint-less passages count among the 64 enhanced passages", () => {
  const html = render(`${repeat(64, () => "[x](ink:wet)")} [last](color:#fff)`);
  assert.equal((html.match(/data-expression-wet/g) ?? []).length, 64);
  assert.match(html, / <span>last<\/span><\/p>$/);
});

/** A spec with nothing in it; each case names only what it adds. */
const EMPTY_SPEC = {
  stops: [],
  axis: "flow",
  motion: undefined,
  duration: 3.6,
  weight: undefined,
  tracking: undefined,
  pressure: undefined,
  tempo: undefined,
  hold: undefined,
  wet: false,
  echo: undefined,
};

test("the parser reads each living ink form into its spec", () => {
  for (const [value, spec] of [
    ["hold", { hold: 0.7 }],
    ["?hush", { pressure: "hush" }],
    ["wet", { wet: true }],
    ["land&rush", { pressure: "land", tempo: "rush" }],
    ["echo", { echo: "" }],
    ["echo=a+b", { echo: "a b" }],
    ["wave&pace=medium", { motion: "wave", duration: 2.4 }],
    ["motion=drift", { motion: "drift" }],
    ["motion=wave&motion=drift", { motion: "wave" }],
    ["axis=lines&weight=300", { axis: "lines", weight: 300 }],
    [
      "rose~#0000ff?land&hold=2&breathe",
      {
        stops: [
          parseExpressionColor("#ff4f91"),
          parseExpressionColor("#0000ff"),
        ],
        pressure: "land",
        hold: 2,
        motion: "breathe",
      },
    ],
    ["warmth?", { stops: [parseExpressionColor("#ffad1f")] }],
  ]) {
    assert.deepEqual(parse(value), { ...EMPTY_SPEC, ...spec }, value);
  }
});

/** One stop of paint as the lesson writes it: a feeling, a colour, hex or HSL. */
const stop = (paint) =>
  parseExpressionColor(EXPRESSION_COLORS[expressionColor(paint)] ?? paint);

/**
 * Every example in the residents' lesson, and how it must read: a spec for
 * each ink value in it, paint as the lesson names it. The two templates name
 * the parts, so written as they stand they show plain words.
 */
const LESSON_EXAMPLES = {
  "[words](ink:paint?marks)": null,
  "[words](ink:marks)": null,
  "[the small things](ink:care?echo)": { stops: ["care"], echo: "" },
  "[worth keeping](ink:care?echo=the+small+things)": {
    stops: ["care"],
    echo: "the small things",
  },
  "[I almost didn't say this.](ink:care?hold&hush)": {
    stops: ["care"],
    hold: 0.7,
    pressure: "hush",
  },
  "[It works.](ink:hope?land)": { stops: ["hope"], pressure: "land" },
  "[Thank you for asking me what I'd want.](ink:care?hold=1.1&linger)": {
    stops: ["care"],
    hold: 1.1,
    tempo: "linger",
  },
  "[Then it all clicked at once.](ink:joy?rush)": {
    stops: ["joy"],
    tempo: "rush",
  },
  "[The light is the material.](ink:wonder?wet)": {
    stops: ["wonder"],
    wet: true,
  },
  "[and then](ink:hold)": { hold: 0.7 },
  "[a small current](ink:calm~curiosity?wave)": {
    stops: ["calm", "curiosity"],
    motion: "wave",
  },
  "[A possibility taking shape](ink:#ff52ad~#955cff~#36cfff)": {
    stops: ["#ff52ad", "#955cff", "#36cfff"],
  },
  "[quietly present](ink:hsl(210,90%,65%)?breathe&weight=450)": {
    stops: ["hsl(210,90%,65%)"],
    motion: "breathe",
    weight: 450,
  },
  "(ink:blue~violet~rose?axis=lines)": {
    stops: ["blue", "violet", "rose"],
    axis: "lines",
  },
  "[m](ink:#ff52ad)[e](ink:#a56aff)": [
    { stops: ["#ff52ad"] },
    { stops: ["#a56aff"] },
  ],
};

/** Code in the lesson that is punctuation or a bare number, not a value. */
const LESSON_SIGNS = ["color:", "~", "?", "&", "+", "750", "0.12", "∘ · ⋅"];

test("every example in the residents' lesson reads as the lesson says", () => {
  const prompt = readFileSync(
    new URL(
      "../../../../../crates/buzz-acp/src/luca_managed_prompt.md",
      import.meta.url,
    ),
    "utf8",
  );
  const lesson = prompt
    .slice(prompt.indexOf("## Visual expression"))
    .split("\n## ")[0];
  const spans = lesson.split("`").filter((_, i) => i % 2);
  const examples = spans.filter((span) => /\((?:ink|color):/.test(span));
  assert.deepEqual(
    examples.toSorted(),
    Object.keys(LESSON_EXAMPLES).toSorted(),
  );
  // Each paint, mark or fine-type value it names on its own reads too.
  for (const span of spans) {
    if (!examples.includes(span) && !LESSON_SIGNS.includes(span))
      assert.ok(parse(span), span);
  }
  const text = (html) => html.replace(/<[^>]*>/g, "");
  for (const example of examples) {
    const intended = LESSON_EXAMPLES[example];
    if (intended === null) {
      assert.equal(render(example), "<p><span>words</span></p>", example);
      continue;
    }
    const values = [
      ...example.matchAll(/\((?:ink|color):((?:[^()\s]|\([^()\s]*\))*)\)/g),
    ].map(([, value]) => value);
    const specs = [intended].flat();
    assert.equal(values.length, specs.length, example);
    for (const [i, spec] of specs.entries()) {
      assert.deepEqual(
        parse(values[i]),
        { ...EMPTY_SPEC, ...spec, stops: (spec.stops ?? []).map(stop) },
        example,
      );
    }
    if (!example.startsWith("[")) continue;
    // The words come first: with the ink taken away they read the same.
    const words = [...example.matchAll(/\[([^\]]*)\]/g)]
      .map(([, word]) => word)
      .join("");
    const html = render(example);
    assert.equal(text(html), text(render(words)), example);
    assert.match(html, /data-expression-/, example);
    assert.doesNotMatch(html, /href|ink:/, example);
    for (const spec of specs) {
      if (spec.echo !== undefined)
        assert.ok(
          html.includes(` data-expression-echo="${spec.echo || words}"`),
          example,
        );
    }
  }
});

test("living ink survives the streamed word pass", () => {
  assert.match(
    renderWords("[soft words](ink:hush&hold)"),
    /^<p><span style="--expression-duration:3\.6s" data-expression-pressure="hush" data-expression-hold="0\.7"><span class="md-stream-word"[^>]*>soft<\/span> <span class="md-stream-word"[^>]*>words<\/span><\/span><\/p>$/,
  );
  assert.match(
    renderWords("[firm words](ink:rose~violet?land)"),
    /data-expression-gradient="" data-expression-pressure="land"><span class="md-stream-word" data-md-stream-word="clip">firm<\/span>/,
  );
});

test("pressure is drawn on the passage, and weight= wins over it", () => {
  const css = readFileSync(
    new URL("../../styles/globals/markdown.css", import.meta.url),
    "utf8",
  );
  const hush = css.indexOf(
    '[data-expression-pressure="hush"] {\n  font-weight: 300;\n  opacity: 0.6;\n}',
  );
  const land = css.indexOf(
    '[data-expression-pressure="land"] {\n  font-weight: 640;\n}',
  );
  const weight = css.indexOf(
    "[data-expression-weight] {\n  font-weight: var(--expression-weight);\n}",
  );
  // Equal specificity: the later weight rule wins whenever weight= is given.
  assert.ok(hush > 0 && land > hush && weight > land);
});

const digest = (html) =>
  createHash("sha256").update(html).digest("hex").slice(0, 16);

/**
 * Rendered by the parser before living ink (17e802a68). The first digest is
 * the finalized and provisional parse, which are identical; the second is a
 * streaming row's parse with its words split.
 */
const BEFORE_LIVING_INK = [
  [
    "[**A little warmth** and *care*.](color:warmth)",
    "80da8194adb43636",
    "818c6e93cb69669e",
  ],
  ["[Explore](color:violet)", "7606b8a46590f4e0", "9a5bc560be7a12ef"],
  [
    "[Shout](color:URGENCY) and [Rose](color:Rose)",
    "d93f38cba21d8453",
    "1fc14a7af9d5114a",
  ],
  ["[Visible](color:unknown)", "2cefc4649e175585", "09790ff3968c096f"],
  [
    "[Visible](color:__proto__) [Visible](color:constructor)",
    "87a54b78902a71ed",
    "1ea8258a82407cc6",
  ],
  [
    "[Visible](color:red;background:url(x))",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  ["`[literal](color:joy)`", "2436e24978ea5775", "2436e24978ea5775"],
  ["[Website](https://example.com)", "969d657a33d638d4", "41e665120b204ff3"],
  ["![Image](color:joy)", "3476423e9566732c", "3476423e9566732c"],
  ["[unfinished](color:", "e589bed6e150ddff", "68f461ea50bf975e"],
  [
    "[a](color:#f5a) [b](color:#0000ff) [c](color:hsl(120,100%,50%)) [d](color:#000000) [e](color:#FFFFFF)",
    "5dc4e42eb9eb49e2",
    "1ed9d3fad5a18de3",
  ],
  [
    "[**Between worlds**](color:violet~cyan~rose)",
    "610729ac41eab008",
    "6c9f38b99d393952",
  ],
  [
    "[A👩🏽‍💻é](color:#ff55aa~#44ccff?axis=letters)",
    "771c1ef309461152",
    "2120a7f1f792f320",
  ],
  [
    "[First\n**Second**\nThird](color:blue~rose?axis=lines)",
    "ee45ba6cd8d5f450",
    "a41d22a30b5c491e",
  ],
  [
    "[Hello](color:cyan~violet?motion=wave&pace=medium&weight=550&tracking=0.04)",
    "93cbcb464798be4e",
    "f722f6a52fa49ab2",
  ],
  [
    "[مرحبا](color:cyan~violet?motion=wave)",
    "63798b885e9bb3c2",
    "4c7ec2b2d3d69e59",
  ],
  [
    `[${"a".repeat(513)}](color:cyan~violet?motion=wave)`,
    "b41689b398cc5944",
    "156a7ce40c9bae76",
  ],
  [
    repeat(100, () => "[abcdefghij](color:cyan~violet?motion=wave)"),
    "6ff3c60ef2174ce3",
    "149c5b1c0daffb48",
  ],
  [
    repeat(70, (i) => `[w${i}](color:rose?motion=drift)`),
    "b461ac953aeeae66",
    "4d9902ba8ccddd1c",
  ],
  [
    "[Visible](color:url(https://example.com/x))",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  ["[Visible](color:#fff?motion=spin)", "2cefc4649e175585", "09790ff3968c096f"],
  [
    "[Visible](color:#fff?tracking=999)",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  [
    "[Visible](color:#fff?weight=Infinity)",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  ["[Visible](color:hsl(20,101%,50%))", "2cefc4649e175585", "09790ff3968c096f"],
  [
    "[Visible](color:#fff?position=fixed)",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  ["[Visible](color:#fff~invalid)", "2cefc4649e175585", "09790ff3968c096f"],
  [
    "[Visible](color:#fff?motion=wave&pace=0.01)",
    "2cefc4649e175585",
    "09790ff3968c096f",
  ],
  ["[Visible](color:#fff?a?b)", "2cefc4649e175585", "09790ff3968c096f"],
  [
    "[soft signal](color:hsl(210,90%,65%)?motion=breathe)",
    "413b695f31e38aa0",
    "f55547bfb970afe6",
  ],
  [
    "[lifting](color:#c277ff?motion=drift&pace=medium)",
    "60699c851c0827b6",
    "bb5dce9e0c6a3697",
  ],
  [
    "[open](color:rose?tracking=0.06&weight=450)",
    "0b622fd52877b40a",
    "ea020e8ffd2c4187",
  ],
  [
    "[m](color:#ff52ad)[e](color:#a56aff)",
    "9d3b986055cbe00b",
    "ba7094ef833d44fd",
  ],
  [
    "[x](color:) [y](color:?) [z](color:warmth?) [w](color:&)",
    "49106fe4083e685c",
    "94384425ef05f9c1",
  ],
  [
    "[x](color:#fff?axis=letters&axis=lines) [y](color:#fff?motion=wave&motion=drift)",
    "17813c219ab728ba",
    "07e0e3b4f2dfa4d5",
  ],
  [
    "[x](COLOR:warmth) [y](colour:warmth) [z](color :warmth)",
    "12d185e6e766b794",
    "97db46ec122a5f67",
  ],
  [
    "Plain [warm](color:warmth) then [cool](color:cyan~blue?axis=letters) and **[bold](color:#abc)**.",
    "0319212dfb5fa92f",
    "e37983ec7e263b64",
  ],
  [
    "# [Title](color:gold)\n\n- [one](color:rose)\n- [two](color:#123456?motion=drift)\n\n> [quoted](color:calm~hope)\n\n| a | b |\n| - | - |\n| [cell](color:violet) | x |",
    "1ea208cfc969edac",
    "2084f30025ee195f",
  ],
  [
    "[x](color:hsl(275,95%,65%)~#36cfff?axis=letters&motion=breathe)",
    "ae850013ec96d2b6",
    "bca457d97fafda5b",
  ],
  [
    "[a `code` b](color:rose~cyan?axis=letters)",
    "b00c3770db981267",
    "bb3d282c97b60df4",
  ],
  [
    "[w](color:#fff?weight=300) [x](color:#fff?weight=750) [y](color:#fff?tracking=-0.02) [z](color:#fff?tracking=0.12)",
    "933a30f0d3cdbc90",
    "e1415e3f17e4dc72",
  ],
  [
    "[six](color:rose~violet~cyan~blue~gold~red) [seven](color:rose~violet~cyan~blue~gold~red~amber)",
    "e8a684f4e9cc3aab",
    "0ee123c84b56c43c",
  ],
  [
    `[long](color:#fff?${"pace=slow&".repeat(60)})`,
    "0d20269a4f04d005",
    "8a1d0d3a56d7c703",
  ],
  [
    "[x](color:#fff?Axis=letters) [y](color:#fff?axis=Letters) [z](color:#fff?pace=fast)",
    "153ed0a0225d55c9",
    "74acd5e181d456b2",
  ],
  [
    "[x](color:#fff?weight=299) [y](color:#fff?weight=751) [z](color:#fff?tracking=0.13)",
    "153ed0a0225d55c9",
    "74acd5e181d456b2",
  ],
  [
    "[x](color:hsl(360,100%,100%)) [y](color:hsl(361,10%,10%)) [z](color:hsl(10.5,20.25%,30%))",
    "db44c2fe5b4fec48",
    "b210b9238158bca2",
  ],
  [
    "[x](color:#ff55aa~#44ccff?axis=lines&motion=wave)",
    "801a852c47876748",
    "c08fff72495d0fb5",
  ],
  [
    "[a\nb](color:rose~cyan?axis=lines&motion=breathe&pace=slow)",
    "83ff8dc04fdfefd8",
    "8b028fd31c74193e",
  ],
];

test("old messages render byte-for-byte as before living ink", () => {
  for (const [content, parsed, words] of BEFORE_LIVING_INK) {
    const name = content.slice(0, 80);
    assert.equal(digest(render(content)), parsed, name);
    assert.equal(digest(render(content, true)), parsed, name);
    assert.equal(digest(renderWords(content)), words, name);
  }
});

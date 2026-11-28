import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  advanceProgressiveMarkdownSnapshot,
  streamingTailShown,
} from "./progressiveMarkdown.ts";
import { ProgressiveMarkdownRenderer } from "./ProgressiveMarkdownRenderer.tsx";

/** Every moment of `text` arriving after `before`, character by character. */
function eachCut(text, before = "") {
  const cuts = [];
  for (let end = 1; end <= text.length; end += 1) {
    cuts.push(`${before}${text.slice(0, end)}`);
  }
  return cuts;
}

function assertHeldWhileOpen(before, construct, after = " and on") {
  // Open: from its first character to its last, nothing of it shows.
  for (const tail of eachCut(construct.slice(0, -1), before)) {
    assert.equal(streamingTailShown(tail), before, JSON.stringify(tail));
  }
  // Closed, and decided by the character after it: it shows whole.
  const closed = `${before}${construct}${after}`;
  assert.equal(streamingTailShown(closed), closed, JSON.stringify(closed));
}

test("emphasis, strike-through and spoilers wait until they close", () => {
  for (const construct of [
    "**an important point**",
    "__an important point__",
    "*a softer point*",
    "_a softer point_",
    "~~a withdrawn point~~",
    "||a hidden point||",
  ]) {
    assertHeldWhileOpen("Then ", construct);
  }
});

test("inline code waits from its backtick until it closes", () => {
  assertHeldWhileOpen("Use ", "`repo_read`");
  assertHeldWhileOpen("Use ", "``a ` tick``");
});

test("a link and a picture wait for their words and their address", () => {
  assertHeldWhileOpen("See ", "[the style notes](https://example.com/notes)");
  assertHeldWhileOpen(
    "See ",
    '[the style notes](https://example.com/notes "Notes")',
  );
  assertHeldWhileOpen("Here: ", "![a chart](https://example.com/chart.png)");
});

test("a bracket that cannot be a link is released at once", () => {
  for (const tail of [
    "see [1] and more",
    "[note] (later)",
    "[spaced](ink:care? hold",
    "a [link](https://example.com/one two",
  ]) {
    assert.equal(streamingTailShown(tail), tail, tail);
  }
  // The `]` decides as soon as the character after it arrives.
  assert.equal(streamingTailShown("see [1]"), "see ");
  assert.equal(streamingTailShown("see [1] "), "see [1] ");
});

test("markers the parser could never open are never held", () => {
  for (const tail of [
    "a * b",
    "a ** b",
    "snake_case_name",
    "a _ b",
    "a ~ b",
    "x ~~ y",
    "Price: 5 * 3",
    "under_score",
  ]) {
    assert.equal(streamingTailShown(tail), tail, tail);
  }
});

test("a table's first row waits until the next line shows it is a table", () => {
  const header = "| Part | Words |";
  // The delimiter row decides when it is complete: until its newline, one
  // more `-` or `|` could still change how many columns it has.
  for (const tail of eachCut(`${header}\n| --- | --- |`)) {
    assert.equal(streamingTailShown(tail), "", JSON.stringify(tail));
  }
  const table = `${header}\n| --- | --- |\n`;
  assert.equal(streamingTailShown(table), table);
  assert.equal(streamingTailShown(`${table}| 1`), `${table}| 1`);
  const notTable = `${header}\nthen words`;
  assert.equal(streamingTailShown(notTable), notTable);
  assert.equal(streamingTailShown(`${header}\nt`), `${header}\nt`);
});

test("a code fence's opening line waits until it is complete", () => {
  for (const tail of eachCut("```ts", "Intro:\n")) {
    assert.equal(streamingTailShown(tail), "Intro:\n", JSON.stringify(tail));
  }
  const opened = "Intro:\n```ts\n";
  assert.equal(streamingTailShown(opened), opened);
  const code = `${opened}const a = 1;\nconst b`;
  assert.equal(streamingTailShown(code), code);
});

test("inside an open code block only a line that may be its close waits", () => {
  const body = "```ts\nconst a = 1;\n";
  for (const partial of ["`", "``", "```", "  ", "~~"]) {
    assert.equal(streamingTailShown(`${body}${partial}`), body, partial);
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal code text a reply writes
  for (const partial of ["`${a}`", "co", "**not bold"]) {
    const tail = `${body}${partial}`;
    assert.equal(streamingTailShown(tail), tail, partial);
  }
});

test("a line that is only a list, quote or heading marker waits for its words", () => {
  for (const marker of ["-", "- ", "1.", "1. ", ">", "> ", "#", "## "]) {
    assert.equal(streamingTailShown(`Intro\n${marker}`), "Intro\n", marker);
  }
  assert.equal(streamingTailShown("Intro\n- a"), "Intro\n- a");
});

test("each kind is shown as written at its limit, not before", () => {
  const limits = [
    ["**", 200],
    ["`", 200],
    ["![", 200],
    ["~~", 200],
  ];
  for (const [opener, limit] of limits) {
    const atLimit = `A ${opener}${"w".repeat(limit - opener.length)}`;
    assert.equal(streamingTailShown(atLimit), "A ", `${opener} at limit`);
    const past = `${atLimit}w`;
    assert.equal(streamingTailShown(past), past, `${opener} past limit`);
  }
  // A link's address has its own 512 after the words.
  const words = "[notes](";
  const atLimit = `A ${words}https://${"a".repeat(512 - 8)}`;
  assert.equal(streamingTailShown(atLimit), "A ");
  assert.equal(streamingTailShown(`${atLimit}a`), `${atLimit}a`);
  // A table's first row: 300 from the `|`.
  const row = `|${" cell |".repeat(43)}`.slice(0, 300);
  assert.equal(row.length, 300);
  assert.equal(streamingTailShown(row), "");
  assert.equal(streamingTailShown(`${row} `), `${row} `);
});

test("a paragraph's end releases what it left open", () => {
  // A new list item ends the one before it; its unclosed marker is final.
  const tail = "- one **unclosed\n- two";
  assert.equal(streamingTailShown(tail), tail);
  // A fence interrupts a paragraph the same way.
  const fenced = "A **loose\n```ts\nx";
  assert.equal(streamingTailShown(fenced), fenced);
});

test("the coloured phrase keeps its own limits", () => {
  const link = "[I almost didn't say this.](ink:care?hold&hush)";
  for (const tail of eachCut(link.slice(0, -1), "Well. ")) {
    assert.equal(streamingTailShown(tail), "Well. ", tail);
  }
  // Its words may run to 1,024 characters while it may still become one.
  const long = `[${"w".repeat(900)}`;
  assert.equal(streamingTailShown(long), "");
});

/* ── The open code block is drawn in the finished block's own frame ───── */

function renderStreaming(content) {
  return renderToStaticMarkup(
    React.createElement(ProgressiveMarkdownRenderer, {
      channelNames: [],
      components: {},
      content,
      mentionNames: [],
      variant: "hold-test",
      withholdOpenInk: true,
    }),
  );
}

test("an open code block is a code block from its first line, without colours", () => {
  const html = renderStreaming(
    "Here it is:\n\n```ts\nconst a = 1;\nconst b = 2;",
  );
  assert.match(html, /data-code-block=""/);
  assert.match(html, /<div class="mb-1 text-xs text-ink-faint">ts<\/div>/);
  assert.match(
    html,
    /<code class="code-block-lines[^"]*"><span data-line="">const a = 1;<\/span><span data-line="">const b = 2;<\/span><\/code>/,
  );
  assert.doesNotMatch(html, /```/);
  assert.doesNotMatch(html, /style="color/);
  assert.doesNotMatch(html, /data-streaming-tail="">```/);
});

test("words before an open fence in the same block stay prose", () => {
  const html = renderStreaming("Here it is:\n```ts\nconst a = 1;");
  assert.match(html, /<p[^>]*>Here it is:<\/p>/);
  assert.match(html, /data-code-block=""/);
  assert.doesNotMatch(html, /```/);
});

test("a settled message's open fence is drawn as it is today", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProgressiveMarkdownRenderer, {
      channelNames: [],
      components: {},
      content: "```ts\nconst a = 1;",
      mentionNames: [],
      variant: "hold-test",
    }),
  );
  assert.doesNotMatch(html, /data-code-block/);
});

/* ── Property: over realistic replies cut at every character ──────────── */

const CORPUS = [
  [
    "Part one opens. The **important point** stays short, and *a softer one* follows.",
    "",
    "See the [style notes](https://example.com/notes/1) and ~~the old plan~~ before ||the ending||.",
    "Use `repo_read` with __care__ and _tact_. Then [a warm phrase lands](color:warmth~care) here.",
    "",
    "Here is the code:",
    "```ts",
    "const calibrated = questions.filter((q) => q.honest);",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal code text a reply writes
    "const template = `${calibrated.length} kept`;",
    "export default calibrated;",
    "```",
    "",
    "- first item with **bold**",
    "- second item with `inline code`",
    "",
    "| Part | Words |",
    "| --- | --- |",
    "| one | 120 |",
    "",
    "![a chart](https://example.com/chart.png)",
    "",
    "That is all, with [one more link](https://example.com/end).",
  ].join("\n"),
  [
    "## A heading for the second reply",
    "",
    "1. Step one, *gently*.",
    "2. Step two, **firmly**.",
    "",
    "> A quoted line with `code` inside.",
    "",
    "~~~",
    "plain fenced text",
    "~~~",
    "",
    "Closing words with a final **flourish**.",
  ].join("\n"),
  [
    "Steps, with no blank line before them:",
    "1. Open **the `config` file** first.",
    "2. Then ***both at once*** and a [**bold link**](https://example.com/b).",
    "Here is code right under a line:",
    "```js",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal code text a reply writes
    "const tick = `${a}`; // a `tick` inside",
    "",
    "if (a ** 2 > b) run();",
    "```",
    "And after it, *one* more ~~line~~ with ||a secret||, 2024 and 3 pm.",
    "",
    "| A | B | C |",
    "|:--|:-:|--:|",
    "| x | **y** | `z` |",
    "| [w](https://example.com/w) | v | u |",
  ].join("\n"),
];

function shownReply(content, snapshot) {
  const next = advanceProgressiveMarkdownSnapshot(snapshot, content);
  const frozen = next.blocks.map((block) => block.content).join("");
  return { shown: frozen + streamingTailShown(next.trailing), next };
}

const RAW = /\*|__|~~|\|\||`|\[|\]|\]\(|(^|\s)_\S|\|/;

function visibleProse(html) {
  return html
    .replace(/<pre[\s\S]*?<\/pre>/g, "")
    .replace(/<code[\s\S]*?<\/code>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

test("shown text is a prefix, never shrinks, and shows no unfinished markup", () => {
  for (const reply of CORPUS) {
    let snapshot = null;
    let previous = "";
    for (let end = 1; end <= reply.length; end += 1) {
      const content = reply.slice(0, end);
      const { shown, next } = shownReply(content, snapshot);
      snapshot = next;
      assert.ok(reply.startsWith(shown), `not a prefix at ${end}`);
      assert.ok(
        shown.length >= previous.length,
        `shrank at ${end}: ${JSON.stringify(content.slice(-40))}`,
      );
      previous = shown;
      const prose = visibleProse(renderStreaming(next.trailing));
      assert.doesNotMatch(
        prose,
        RAW,
        `raw markup at ${end}: ${JSON.stringify(content.slice(-40))} -> ${JSON.stringify(prose.slice(-60))}`,
      );
    }
  }
});

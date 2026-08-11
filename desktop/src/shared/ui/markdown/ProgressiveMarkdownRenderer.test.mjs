import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ProgressiveMarkdownRenderer,
  progressiveMarkdownRendererPropsEqual,
} from "./ProgressiveMarkdownRenderer.tsx";

const COMPONENTS = {};
const BASE_PROPS = {
  channelNames: [],
  components: COMPONENTS,
  mentionNames: [],
  variant: "progressive-test",
};

function renderProgressive(content) {
  return renderToStaticMarkup(
    React.createElement(ProgressiveMarkdownRenderer, {
      ...BASE_PROPS,
      content,
    }),
  );
}

test("plain streaming prose keeps final paragraph geometry without parsing syntax", () => {
  const html = renderProgressive("Café 👩🏽‍💻 — शांत");
  assert.match(html, /^<p class="whitespace-pre-wrap"/);
  assert.match(html, /data-streaming-tail=""/);
  assert.match(html, /Café 👩🏽‍💻 — शांत/);
  assert.doesNotMatch(html, /�/);
});

test("completed blocks and the active tail render as independent siblings", () => {
  const html = renderProgressive(
    "First **settled** paragraph.\n\nforming thought",
  );
  assert.match(html, /<strong>settled<\/strong>/);
  assert.match(html, /data-streaming-tail="">forming thought<\/p>$/);
  assert.equal((html.match(/<p/g) ?? []).length, 2);
});

test("terminal headings, lists, quotes, tables, and fences use final geometry", () => {
  const cases = [
    ["# Calm heading", /<h1>Calm heading<\/h1>/],
    ["- one\n- two", /<ul>.*<li>one<\/li>.*<li>two<\/li>.*<\/ul>/s],
    ["> quoted", /<blockquote>.*quoted.*<\/blockquote>/s],
    [
      "| Name | State |\n| --- | --- |\n| Luca | Ready |",
      /<table>.*<th>Name<\/th>.*<td>Luca<\/td>.*<\/table>/s,
    ],
    ["```ts\nconst ready = true;\n```", /<pre><code class="language-ts"/],
  ];
  for (const [content, pattern] of cases) {
    const html = renderProgressive(content);
    assert.match(html, pattern, content);
    assert.doesNotMatch(html, /data-streaming-tail/, content);
  }
});

test("memo equality ignores fresh value-equal name arrays", () => {
  const previous = {
    ...BASE_PROPS,
    channelNames: ["general"],
    content: "Stable body",
    customEmoji: [{ shortcode: "luca", url: "https://example.test/luca.png" }],
    mentionNames: ["Luca"],
  };
  const next = {
    ...previous,
    channelNames: ["general"],
    customEmoji: [{ shortcode: "luca", url: "https://example.test/luca.png" }],
    mentionNames: ["Luca"],
  };
  assert.equal(progressiveMarkdownRendererPropsEqual(previous, next), true);
  assert.equal(
    progressiveMarkdownRendererPropsEqual(previous, {
      ...next,
      content: "Changed body",
    }),
    false,
  );
  assert.equal(
    progressiveMarkdownRendererPropsEqual(previous, {
      ...next,
      customEmoji: [
        { shortcode: "luca", url: "https://example.test/changed.png" },
      ],
    }),
    false,
  );
});

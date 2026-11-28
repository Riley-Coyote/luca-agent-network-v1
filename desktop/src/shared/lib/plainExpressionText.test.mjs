import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { renderCachedMarkdown } from "../ui/markdown/nodeCache.ts";
import {
  plainExpressionText,
  plainExpressionTail,
} from "./plainExpressionText.ts";

test("each of the four forms reads as its words", () => {
  assert.equal(
    plainExpressionText("[Good to see you.](ink:warmth?hush)"),
    "Good to see you.",
  );
  assert.equal(plainExpressionText("a [word](ink:hush) here"), "a word here");
  assert.equal(plainExpressionText("a [word](ink:warmth) here"), "a word here");
  assert.equal(
    plainExpressionText("a [word](color:amber) here"),
    "a word here",
  );
});

test("a feeling, colour or motion the renderer does not know still reads as words", () => {
  assert.equal(plainExpressionText("[odd](ink:sorrowful?spin)"), "odd");
  assert.equal(plainExpressionText("[odd](color:plaid)"), "odd");
});

test("several in one line", () => {
  assert.equal(
    plainExpressionText(
      "[One](ink:warmth), [two](color:amber) and [three](ink:calm?breathe).",
    ),
    "One, two and three.",
  );
});

test("brackets and parentheses inside the words", () => {
  assert.equal(
    plainExpressionText("[see (this) [now]](ink:warmth) ok"),
    "see (this) [now] ok",
  );
  assert.equal(
    plainExpressionText(String.raw`[a \] b](ink:joy)`),
    String.raw`a \] b`,
  );
});

test("everything else is left exactly as written", () => {
  const untouched = [
    "an [ordinary link](https://example.com) stays",
    "hello @Luca, see #general",
    "**bold** and _soft_ and `code`",
    "# A heading\n\n- a list",
    "`[code](ink:warmth)` stays code",
    "![an image](ink:warmth) is not a phrase",
    "```\n[fenced](ink:warmth)\n```",
    "a bare ink:warmth address",
    "",
  ];
  for (const text of untouched) assert.equal(plainExpressionText(text), text);
  assert.equal(
    plainExpressionText("**[bold words](ink:warmth)** and [docs](https://x.y)"),
    "**bold words** and [docs](https://x.y)",
  );
});

test("empty words", () => {
  assert.equal(plainExpressionText("a [](ink:warmth) b"), "a  b");
  assert.equal(plainExpressionText("[](color:amber)"), "");
});

test("non-Latin text and emoji", () => {
  assert.equal(
    plainExpressionText("[会えて嬉しい](ink:joy) 🌱"),
    "会えて嬉しい 🌱",
  );
  assert.equal(
    plainExpressionText("[👋🏽 مرحبا](color:rose?hush) — ok"),
    "👋🏽 مرحبا — ok",
  );
});

test("a cut-off tail where the address had clearly begun", () => {
  assert.equal(
    plainExpressionText("Hi. [Good to see](ink:war"),
    "Hi. Good to see",
  );
  assert.equal(
    plainExpressionText("Hi. [Good to see](color:"),
    "Hi. Good to see",
  );
  assert.equal(
    plainExpressionText("[Good to see](ink:warmth?hu…"),
    "Good to see…",
  );
  assert.equal(
    plainExpressionText("[Good to see](ink:warmth..."),
    "Good to see...",
  );
  assert.equal(
    plainExpressionText("[One](ink:joy) and [Good to see](ink:war"),
    "One and Good to see",
  );
  assert.equal(plainExpressionTail("x [Good to see](ink:war"), "x Good to see");
  // The tail alone keeps finished phrases for a renderer that draws them.
  assert.equal(
    plainExpressionTail("[One](ink:joy) and [Good to see](ink:war"),
    "[One](ink:joy) and Good to see",
  );
});

test("a tail that is less certain is left alone", () => {
  for (const text of [
    "[Good to see](ink",
    "[Good to see](co",
    "[Good to see](",
    "[Good to se",
    "[Good to see](https://exa",
    "[Good to see](ink:warmth and more",
    "Good to see](ink:war",
  ])
    assert.equal(plainExpressionText(text), text);
});

test("a 200,000-character hostile input finishes fast", () => {
  const inputs = [
    "[".repeat(200_000),
    "](ink:".repeat(33_334),
    "[a](ink:b".repeat(22_223),
    `${"[".repeat(100_000)}${"](ink:x)".repeat(12_500)}`,
    "[w](ink:warmth) ".repeat(12_500),
  ];
  for (const input of inputs) {
    const started = performance.now();
    plainExpressionText(input);
    plainExpressionTail(input);
    const took = performance.now() - started;
    assert.ok(took < 2_000, `took ${Math.round(took)} ms`);
  }
  assert.equal(
    plainExpressionText("[w](ink:warmth) ".repeat(12_500)),
    "w ".repeat(12_500),
  );
});

test("finds exactly the phrases the renderer draws", () => {
  const leaks = (text) => /\]\((?:ink|color):/.test(text);
  const drawn = (content) =>
    renderToStaticMarkup(
      renderCachedMarkdown({
        components: {},
        content,
        variant: "plain-ink-test",
      }),
    );
  const corpus = [
    "[a](ink:warmth)",
    "[a](color:amber) and [b](ink:hush)",
    "`[a](ink:warmth)` then [b](ink:joy)",
    "``[a](ink:warmth)`` and `x`",
    "```\n[a](ink:warmth)\n```\n[b](ink:joy)",
    String.raw`\[a](ink:warmth)`,
    String.raw`[a\](ink:warmth)`,
    "[a [b](ink:joy) c](ink:warmth)",
    "[a](ink:warmth) [b](https://x.y) [c](color:rose?hush)",
    "[a (b) c](ink:calm?breathe)",
    "[a](ink:wa rmth)",
    "[a] (ink:warmth)",
    "**[a](ink:warmth)** _[b](color:gold)_",
    "> [quoted](ink:care)\n\n- [item](ink:hope)",
    "| h |\n|---|\n| [cell](ink:joy) |",
    "[a](ink:sorrow?spin)",
  ];
  for (const text of corpus)
    assert.equal(
      leaks(plainExpressionText(text)),
      leaks(drawn(text)),
      `disagrees with the renderer on ${JSON.stringify(text)}`,
    );
});

test("places the browser cannot reach read the words too", async () => {
  const { truncateNotificationBody } = await import(
    "../../features/notifications/lib/notificationFormat.ts"
  );
  const { noteSnippet } = await import("../../features/pulse/lib/replies.ts");
  // A reminder preview saved raw in the past, cut inside the address.
  assert.equal(
    truncateNotificationBody("Older. [Good to see](ink:war", "A reminder"),
    "Older. Good to see",
  );
  // Reduced before the cut: the 140-character cut lands in plain words.
  const long = `${"a".repeat(130)} [Good to see you.](ink:warmth?hush) more`;
  const body = truncateNotificationBody(long, "New message");
  assert.equal(body, `${"a".repeat(130)} Good t...`);
  assert.equal(
    noteSnippet("Replying to [Good to see you.](color:amber) here"),
    "Replying to Good to see you. here",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { renderCachedMarkdown } from "../ui/markdown/nodeCache.ts";
import { inkHeardEqual, inkHeardOf } from "./inkHeard.ts";

const render = (content, inkHeard) =>
  renderToStaticMarkup(
    renderCachedMarkdown({
      components: {},
      content,
      inkHeard,
      variant: "ink-heard-test",
    }),
  );

test("a reply's echo is read by the parse that draws it", () => {
  assert.deepEqual(inkHeardOf("[So calming](ink:calm?echo) is the point."), {
    phrase: "So calming",
    colour: "#16ccef",
  });
  assert.deepEqual(
    inkHeardOf("[worth keeping](ink:care?echo=the+small+things)"),
    { phrase: "the small things", colour: "#ff4f91" },
  );
  // Paint-less ink keeps only the thread.
  assert.deepEqual(inkHeardOf("[the stairs](ink:echo)"), {
    phrase: "the stairs",
    colour: null,
  });
  // A gradient lends the middle of its colours.
  assert.match(
    inkHeardOf("[a thread](ink:calm~care?echo)")?.colour ?? "",
    /^#[0-9a-f]{6}$/,
  );
});

test("one echo per message, the first in reading order; nothing else echoes", () => {
  assert.equal(
    inkHeardOf("[first](ink:echo) and [second](ink:echo=other)")?.phrase,
    "first",
  );
  for (const content of [
    "plain words about an echo",
    "[a link](https://example.com/echo)",
    "`[code](ink:echo)`",
    "[broken](ink:echo&echo)",
    "[no marks](ink:calm)",
  ]) {
    assert.equal(inkHeardOf(content), null, content);
  }
});

test("the person's words are lit where they first appear, as whole words", () => {
  const html = render("I keep forgetting the small things, the small things.", [
    { phrase: "the small things", colour: "#ff4f91" },
  ]);
  assert.equal(
    html,
    '<p>I keep forgetting <span data-ink-heard="" style="--ink-heard:#ff4f91">the small things</span>, the small things.</p>',
  );
  // Case does not matter; the person's own spelling is kept.
  assert.match(
    render("So Calming, really.", [{ phrase: "so calming", colour: null }]),
    /<span data-ink-heard="">So Calming<\/span>/,
  );
  // Part of a word is not the word.
  assert.doesNotMatch(
    render("theory", [{ phrase: "the", colour: null }]),
    /data-ink-heard/,
  );
});

test("an echo lights nothing it cannot find, and never code", () => {
  assert.equal(
    render("nothing like it", [{ phrase: "the stairs", colour: null }]),
    "<p>nothing like it</p>",
  );
  assert.doesNotMatch(
    render("`the stairs` again", [{ phrase: "the stairs", colour: null }]),
    /data-ink-heard/,
  );
});

test("a fresh echo warms in once", () => {
  assert.match(
    render("the stairs", [
      { phrase: "the stairs", colour: "#16ccef", fresh: true },
    ]),
    /<span data-ink-heard="fresh" style="--ink-heard:#16ccef">the stairs<\/span>/,
  );
});

test("echoes compare by what they light, not by identity", () => {
  const one = [{ phrase: "a", colour: "#000000" }];
  assert.equal(inkHeardEqual(one, [{ phrase: "a", colour: "#000000" }]), true);
  assert.equal(inkHeardEqual(undefined, []), true);
  assert.equal(inkHeardEqual(one, [{ phrase: "b", colour: "#000000" }]), false);
  assert.equal(
    inkHeardEqual(one, [{ phrase: "a", colour: "#000000", fresh: true }]),
    false,
  );
});

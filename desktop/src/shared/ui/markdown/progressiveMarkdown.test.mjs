import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceProgressiveMarkdownSnapshot,
  progressiveMarkdownTailIsStructurallyStable,
  progressiveMarkdownTailMode,
  splitProgressiveMarkdown,
  splitProgressiveMarkdownBlocks,
} from "./progressiveMarkdown.ts";

test("keeps one unfinished paragraph literal", () => {
  assert.deepEqual(splitProgressiveMarkdown("A calm unfinished thought"), {
    complete: "",
    trailing: "A calm unfinished thought",
  });
});

test("freezes blocks before the unfinished tail", () => {
  assert.deepEqual(
    splitProgressiveMarkdown("First paragraph.\n\n- one\n- two"),
    {
      complete: "First paragraph.\n\n",
      trailing: "- one\n- two",
    },
  );
});

test("returns completed blocks independently so earlier parses stay frozen", () => {
  assert.deepEqual(
    splitProgressiveMarkdownBlocks(
      "First paragraph.\n\nSecond paragraph.\n\nforming",
    ),
    {
      blocks: [
        { content: "First paragraph.\n\n", start: 0 },
        { content: "Second paragraph.\n\n", start: 18 },
      ],
      trailing: "forming",
    },
  );
});

test("keeps an open fenced block literal", () => {
  assert.deepEqual(
    splitProgressiveMarkdown("Intro.\n\n```ts\nconst answer = 42;"),
    {
      complete: "Intro.\n\n",
      trailing: "```ts\nconst answer = 42;",
    },
  );
});

test("treats a closed fenced block as complete", () => {
  const content = "```ts\nconst answer = 42;\n```";
  assert.deepEqual(splitProgressiveMarkdown(content), {
    complete: content,
    trailing: "",
  });
});

test("never freezes incomplete emphasis or inline code", () => {
  assert.deepEqual(splitProgressiveMarkdown("A **forming idea"), {
    complete: "",
    trailing: "A **forming idea",
  });
  assert.deepEqual(splitProgressiveMarkdown("Use `repo_"), {
    complete: "",
    trailing: "Use `repo_",
  });
});

test("advances across appended characters without rescanning frozen blocks", () => {
  const first = advanceProgressiveMarkdownSnapshot(
    null,
    "First paragraph.\n\nforming",
  );
  const frozenBlock = first.blocks[0];
  const second = advanceProgressiveMarkdownSnapshot(
    first,
    "First paragraph.\n\nforming thought",
  );

  assert.equal(second.blocks, first.blocks);
  assert.equal(second.blocks[0], frozenBlock);
  assert.equal(second.lastAdvanceScannedCharacters, " thought".length);
  assert.equal(
    second.totalScannedCharacters,
    "First paragraph.\n\nforming thought".length,
  );

  const third = advanceProgressiveMarkdownSnapshot(
    second,
    "First paragraph.\n\nforming thought\n\nnext",
  );
  assert.notEqual(third.blocks, second.blocks);
  assert.equal(third.blocks[0], frozenBlock);
  assert.equal(third.blocks[1].content, "forming thought\n\n");
  assert.equal(third.trailing, "next");
});

test("a corrected signed body rebuilds instead of retaining stale blocks", () => {
  const streamed = advanceProgressiveMarkdownSnapshot(
    null,
    "First paragraph.\n\nsecond",
  );
  const corrected = advanceProgressiveMarkdownSnapshot(
    streamed,
    "Corrected paragraph.\n\nsecond",
  );

  assert.equal(corrected.blocks[0].content, "Corrected paragraph.\n\n");
  assert.notEqual(corrected.blocks[0], streamed.blocks[0]);
  assert.equal(
    corrected.lastAdvanceScannedCharacters,
    "Corrected paragraph.\n\nsecond".length,
  );
});

test("preserves Unicode content while incrementally extending the tail", () => {
  const first = advanceProgressiveMarkdownSnapshot(null, "Café 👩🏽‍💻");
  const second = advanceProgressiveMarkdownSnapshot(first, "Café 👩🏽‍💻 — शांत");
  assert.equal(second.trailing, "Café 👩🏽‍💻 — शांत");
  assert.equal(second.lastAdvanceScannedCharacters, " — शांत".length);
  assert.doesNotMatch(second.trailing, /�/);
});

test("renders established terminal block geometry before signing", () => {
  for (const content of [
    "# A terminal heading",
    "- first\n- second",
    "> a quoted answer",
    "| Name | State |\n| --- | --- |\n| Luca | Ready |",
    "```ts\nconst ready = true;\n```",
  ]) {
    assert.equal(progressiveMarkdownTailMode(content), "markdown", content);
    assert.equal(
      progressiveMarkdownTailIsStructurallyStable(content),
      true,
      content,
    );
  }
});

test("keeps ordinary and syntactically open tails literal", () => {
  for (const content of [
    "A calm paragraph",
    "```ts\nconst open = true",
    "A **forming idea",
    "Use `repo_",
  ]) {
    assert.equal(progressiveMarkdownTailMode(content), "literal", content);
  }
  for (const content of [
    "A **complete** idea",
    "A *complete* idea",
    "Use `repo_read`",
    "Open [Brain](https://example.test)",
    "Ask @Luca in #general",
    "Visit https://example.test",
  ]) {
    assert.equal(progressiveMarkdownTailMode(content), "markdown", content);
  }
});

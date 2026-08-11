import assert from "node:assert/strict";
import test from "node:test";

import {
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

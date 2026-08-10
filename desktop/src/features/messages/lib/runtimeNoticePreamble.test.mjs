import assert from "node:assert/strict";
import test from "node:test";

import { stripRuntimeNoticePreamble } from "./runtimeNoticePreamble.ts";

const notice =
  "Warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.";

test("removes the known Codex notice only when it is a preamble", () => {
  assert.equal(
    stripRuntimeNoticePreamble(`${notice}\n\nThe actual answer.`),
    "The actual answer.",
  );
  assert.equal(stripRuntimeNoticePreamble(notice), "");
});

test("preserves ordinary warnings and quoted runtime text", () => {
  assert.equal(
    stripRuntimeNoticePreamble("Warning: the build failed."),
    "Warning: the build failed.",
  );
  assert.equal(
    stripRuntimeNoticePreamble(`Here is the notice:\n${notice}`),
    `Here is the notice:\n${notice}`,
  );
});

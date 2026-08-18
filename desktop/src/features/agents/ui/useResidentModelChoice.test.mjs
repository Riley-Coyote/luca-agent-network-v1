import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeResidentModelOptions,
  tidyRuntimeCommandLabel,
} from "./useResidentModelChoice.ts";

// ── mergeResidentModelOptions ────────────────────────────────────────────────

test("mergeResidentModelOptions maps discovered options preserving order", () => {
  const options = mergeResidentModelOptions({
    currentModel: "claude-sonnet-4-5",
    discovered: [
      { id: "", label: "Default model (claude-sonnet-4-5)" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    ],
  });

  assert.deepEqual(options, [
    { label: "Default model (claude-sonnet-4-5)", value: "" },
    { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
    { label: "Claude Opus 4.1", value: "claude-opus-4-1" },
  ]);
});

test("mergeResidentModelOptions appends currentModel when discovery does not list it", () => {
  const options = mergeResidentModelOptions({
    currentModel: "gpt-5-codex",
    discovered: [{ id: "gpt-5", label: "GPT-5" }],
  });

  assert.deepEqual(options, [
    { label: "GPT-5", value: "gpt-5" },
    { label: "gpt-5-codex", value: "gpt-5-codex" },
  ]);
});

test("mergeResidentModelOptions does not duplicate a currentModel already listed", () => {
  const options = mergeResidentModelOptions({
    currentModel: "gpt-5",
    discovered: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
  });

  assert.equal(options.filter((option) => option.value === "gpt-5").length, 1);
  assert.deepEqual(options, [
    { label: "GPT-5", value: "gpt-5" },
    { label: "GPT-5 mini", value: "gpt-5-mini" },
  ]);
});

test("mergeResidentModelOptions matches currentModel ignoring surrounding whitespace", () => {
  const options = mergeResidentModelOptions({
    currentModel: "  gpt-5  ",
    discovered: [{ id: " gpt-5 ", label: "GPT-5" }],
  });

  assert.deepEqual(options, [{ label: "GPT-5", value: "gpt-5" }]);
});

test("mergeResidentModelOptions de-dupes repeated discovered ids, first label wins", () => {
  const options = mergeResidentModelOptions({
    currentModel: null,
    discovered: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5", label: "GPT-5 (duplicate)" },
    ],
  });

  assert.deepEqual(options, [{ label: "GPT-5", value: "gpt-5" }]);
});

test("mergeResidentModelOptions offers only the current model when discovery yields nothing", () => {
  assert.deepEqual(
    mergeResidentModelOptions({
      currentModel: "claude-opus-4-1",
      discovered: null,
    }),
    [{ label: "claude-opus-4-1", value: "claude-opus-4-1" }],
  );
  assert.deepEqual(
    mergeResidentModelOptions({ currentModel: "gpt-5", discovered: [] }),
    [{ label: "gpt-5", value: "gpt-5" }],
  );
});

test("mergeResidentModelOptions returns empty when nothing is known", () => {
  assert.deepEqual(
    mergeResidentModelOptions({ currentModel: null, discovered: null }),
    [],
  );
  assert.deepEqual(
    mergeResidentModelOptions({ currentModel: "   ", discovered: [] }),
    [],
  );
});

test("mergeResidentModelOptions falls back to the id when a discovered label is blank", () => {
  assert.deepEqual(
    mergeResidentModelOptions({
      currentModel: null,
      discovered: [{ id: "gpt-5", label: "   " }],
    }),
    [{ label: "gpt-5", value: "gpt-5" }],
  );
});

test("mergeResidentModelOptions keeps the empty-id default row distinct from an empty currentModel", () => {
  const options = mergeResidentModelOptions({
    currentModel: "",
    discovered: [{ id: "", label: "Default model" }],
  });

  assert.deepEqual(options, [{ label: "Default model", value: "" }]);
});

// ── tidyRuntimeCommandLabel ──────────────────────────────────────────────────

test("tidyRuntimeCommandLabel strips directories, arguments, and script extensions", () => {
  assert.equal(
    tidyRuntimeCommandLabel("/opt/homebrew/bin/claude-code-acp --stdio"),
    "claude-code-acp",
  );
  assert.equal(tidyRuntimeCommandLabel("buzz-agent"), "buzz-agent");
  assert.equal(tidyRuntimeCommandLabel("C:\\Program\\bin\\codex.exe"), "codex");
  assert.equal(tidyRuntimeCommandLabel("  ./scripts/hermes.mjs  "), "hermes");
});

test("tidyRuntimeCommandLabel returns null when there is no command", () => {
  assert.equal(tidyRuntimeCommandLabel(""), null);
  assert.equal(tidyRuntimeCommandLabel("   "), null);
});

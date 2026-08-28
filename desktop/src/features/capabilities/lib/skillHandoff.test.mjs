import assert from "node:assert/strict";
import test from "node:test";

import { preferredReadySkillRuntime } from "./skillHandoff.ts";

function runtime(id, { ready = true } = {}) {
  return {
    id,
    availability: ready ? "available" : "not_installed",
    authStatus: { status: ready ? "logged_in" : "logged_out" },
  };
}

test("uses only a ready direct conversational runtime", () => {
  assert.equal(
    preferredReadySkillRuntime(
      ["claude", "codex"],
      [runtime("claude", { ready: false }), runtime("codex")],
    ),
    "codex",
  );
});

test("does not prefilter unsupported or unavailable skill runtimes", () => {
  assert.equal(
    preferredReadySkillRuntime(
      ["goose", "openclaw"],
      [runtime("goose"), runtime("openclaw")],
    ),
    undefined,
  );
  assert.equal(
    preferredReadySkillRuntime(
      ["claude"],
      [runtime("claude", { ready: false })],
    ),
    undefined,
  );
});

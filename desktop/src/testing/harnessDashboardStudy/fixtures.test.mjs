import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESIGN,
  designBrief,
  normalizeDesign,
  SESSIONS,
} from "./fixtures.ts";

test("invalid saved choices return the starting direction", () => {
  for (const value of [
    null,
    [],
    4,
    "compact",
    { density: "tiny", scene: "run-tool" },
  ]) {
    assert.deepEqual(normalizeDesign(value), DEFAULT_DESIGN);
  }
});
test("only the supported local scenes and density survive normalization", () => {
  assert.deepEqual(
    normalizeDesign({
      density: "compact",
      scene: "approval",
      apiKey: "not-a-key",
    }),
    { density: "compact", scene: "approval" },
  );
});
test("fixture sessions have stable unique identities and readable histories", () => {
  assert.equal(new Set(SESSIONS.map((s) => s.id)).size, SESSIONS.length);
  for (const session of SESSIONS) {
    assert.ok(session.title && session.project && session.turns.length);
    assert.ok(session.context > 0 && session.context <= 100);
  }
});
test("the handoff records simulation and original-session boundaries", () => {
  const brief = designBrief(DEFAULT_DESIGN);
  assert.match(brief, /not approved for production/);
  assert.match(brief, /No context-copy disguised as continuation/);
  assert.match(brief, /calls no harness and changes no permissions/);
});

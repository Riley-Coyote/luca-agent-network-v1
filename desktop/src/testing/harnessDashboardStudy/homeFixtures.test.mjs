import assert from "node:assert/strict";
import test from "node:test";
import {
  HOME_DEFAULT,
  HOME_PRESETS,
  HOME_WORK,
  homeBrief,
  normalizeHome,
} from "./homeFixtures.ts";

test("invalid Home settings recover without accepting extra authority", () => {
  for (const value of [
    null,
    false,
    [],
    "working",
    { scene: "send", apiKey: "never-read" },
  ])
    assert.deepEqual(normalizeHome(value), HOME_DEFAULT);
});
test("saved module choices and named directions normalize independently", () => {
  for (const preset of Object.values(HOME_PRESETS))
    assert.deepEqual(normalizeHome(preset), preset);
  assert.deepEqual(
    normalizeHome({
      timeline: false,
      journal: true,
      results: false,
      density: "compact",
      scene: "quiet",
      live: true,
    }),
    {
      timeline: false,
      journal: true,
      results: false,
      density: "compact",
      scene: "quiet",
    },
  );
});
test("timeline intervals remain bounded with stable source sessions", () => {
  assert.equal(new Set(HOME_WORK.map((s) => s.id)).size, HOME_WORK.length);
  for (const work of HOME_WORK) {
    assert.ok(work.start >= 0 && work.start < work.end && work.end <= 100);
    assert.ok(work.project && work.title && work.runtime);
  }
});
test("Home handoff separates mock interactions from integration promises", () => {
  const brief = homeBrief(HOME_DEFAULT);
  assert.match(
    brief,
    /Every session, message, approval, usage value and result is synthetic/,
  );
  assert.match(brief, /GrokBot is a proposed integration/);
  assert.match(brief, /not Mnemos integration/);
  assert.match(brief, /Opening a surface must not start or stop execution/);
});
